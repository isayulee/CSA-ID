import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { adminAuditLog, advisingRequests, courses, peerAdviserAvailability, peerAdviserCourses, peerAdvisers, profiles, users } from "@/lib/db/schema";
import { createTestDb } from "./helpers";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;
const state = vi.hoisted(() => ({ db: null as unknown, current: null as unknown, bindings: {} as Record<string, unknown> }));

vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/cloudflare", () => ({ getBindings: () => state.bindings }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentAccount: async () => state.current }));

const access = await import("@/lib/portal/access");
const approve = await import("@/app/api/admin/peer-advisers/approve/route");
const revoke = await import("@/app/api/admin/peer-advisers/revoke/route");
const campus = await import("@/app/api/admin/peer-advisers/campus/route");

let t: TestDb;
const ORIGIN = "http://localhost:3100";
const post = (path: string, body?: unknown, headers: Record<string, string> = { origin: ORIGIN }) =>
  new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

async function seedUser(id: string) {
  await t.db.insert(users).values({ id, googleSub: `sub-${id}`, email: `${id}@example.test`, name: id });
  await t.db.insert(profiles).values({ id: `p-${id}`, userId: id, displayName: id });
  const [user] = await t.db.select().from(users).where(eq(users.id, id));
  return user;
}
const signIn = async (id: string) => {
  const [user] = await t.db.select().from(users).where(eq(users.id, id));
  state.current = { user, profile: null };
};
const auditFor = (targetId: string) => t.db.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, targetId));

beforeAll(async () => {
  t = await createTestDb();
  state.db = t.db;
  await seedUser("admin");
  await seedUser("ana");
  await t.db.insert(peerAdvisers).values({ userId: "ana", campusId: "intramuros" });
  await seedUser("una");
});
afterAll(() => t.dispose());
beforeEach(() => {
  state.current = null;
  state.bindings = { ADMIN_GOOGLE_SUBS: "sub-admin" };
});

describe("requirePeerAdviser", () => {
  it("lets in a Peer Adviser and an Administrator without a peer_advisers row", async () => {
    await signIn("ana");
    expect(await access.requirePeerAdviser()).toMatchObject({ user: { id: "ana" }, isPeerAdviser: true, isAdministrator: false });
    await signIn("admin");
    expect(await access.requirePeerAdviser()).toMatchObject({ user: { id: "admin" }, isPeerAdviser: false, isAdministrator: true });
  });

  it("keeps out a signed-out visitor and a User who isn't approved", async () => {
    expect(await access.requirePeerAdviser()).toBeNull();
    await signIn("una");
    expect(await access.requirePeerAdviser()).toBeNull();
  });

  it("shows a User who isn't approved the 404 page", async () => {
    await signIn("una");
    await expect(access.requirePeerAdviserPage()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    await signIn("ana");
    await expect(access.requirePeerAdviserPage()).resolves.toMatchObject({ user: { id: "ana" } });
  });
});

describe("Portal endpoints", () => {
  const read = vi.fn(async () => ({ status: 200, body: { secret: "Portal data" } }));
  const get = () => access.runPortalRead(new Request(`${ORIGIN}/api/portal/x`), read);

  it("give a User who isn't approved a 403 and never read Portal data", async () => {
    read.mockClear();
    expect((await get()).status).toBe(401);
    await signIn("una");
    const response = await get();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(read).not.toHaveBeenCalled();
  });

  it("serve Portal data to a Peer Adviser as private and uncached", async () => {
    await signIn("ana");
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ secret: "Portal data" });
  });

  it("reject a mutation from a User who isn't approved before reading its body", async () => {
    const action = vi.fn(async () => ({ status: 200, body: { ok: true } }));
    await signIn("una");
    const response = await access.runPortalMutation(post("/api/portal/x", "not json at all", { origin: ORIGIN, "content-length": "99999999" }), action);
    expect(response.status).toBe(403);
    expect(action).not.toHaveBeenCalled();
    await signIn("ana");
    expect((await access.runPortalMutation(post("/api/portal/x", { a: 1 }), action)).status).toBe(200);
    expect(action).toHaveBeenCalledWith(t.db, expect.objectContaining({ user: expect.objectContaining({ id: "ana" }) }), { a: 1 });
  });
});

describe("Administrator Peer Adviser endpoints", () => {
  it("treat a Peer Adviser who isn't an Administrator like a signed-out visitor", async () => {
    await seedUser("ben");
    await signIn("ana");
    expect((await approve.POST(post("/api/admin/peer-advisers/approve", { userId: "ben", campusId: "makati" }))).status).toBe(401);
    expect((await revoke.POST(post("/api/admin/peer-advisers/revoke", { userId: "ana", reason: "x" }))).status).toBe(401);
    expect((await campus.POST(post("/api/admin/peer-advisers/campus", { userId: "ana", campusId: "makati" }))).status).toBe(401);
    expect(await t.db.select().from(peerAdvisers).where(eq(peerAdvisers.userId, "ben"))).toEqual([]);
    expect(await t.db.select().from(adminAuditLog)).toEqual([]);
  });

  it("approve a User with a Campus and audit it in the same batch", async () => {
    await seedUser("cy");
    await signIn("admin");
    const response = await approve.POST(post("/api/admin/peer-advisers/approve", { userId: "cy", campusId: "makati" }));
    expect(response.status).toBe(200);
    expect(await t.db.select({ campusId: peerAdvisers.campusId }).from(peerAdvisers).where(eq(peerAdvisers.userId, "cy"))).toEqual([{ campusId: "makati" }]);
    expect(await auditFor("cy")).toEqual([expect.objectContaining({ actorGoogleSub: "sub-admin", action: "approve_peer_adviser", targetType: "user", targetLabel: "cy@example.test · Makati", reason: null })]);
    expect((await approve.POST(post("/api/admin/peer-advisers/approve", { userId: "cy", campusId: "makati" }))).status).toBe(409);
    expect(await auditFor("cy")).toHaveLength(1);
  });

  it("let only one of two racing approvals through, with one audit entry", async () => {
    await seedUser("dee");
    await signIn("admin");
    const statuses = await Promise.all([1, 2].map(async () => (await approve.POST(post("/api/admin/peer-advisers/approve", { userId: "dee", campusId: "intramuros" }))).status));
    expect(statuses.sort()).toEqual([200, 409]);
    expect(await auditFor("dee")).toHaveLength(1);
  });

  it("reject an unknown Campus or User", async () => {
    await signIn("admin");
    expect((await approve.POST(post("/api/admin/peer-advisers/approve", { userId: "una", campusId: "nowhere" }))).status).toBe(400);
    expect((await approve.POST(post("/api/admin/peer-advisers/approve", { userId: "ghost", campusId: "makati" }))).status).toBe(404);
    expect(await auditFor("una")).toEqual([]);
  });

  it("change a Peer Adviser's Campus with an audit entry", async () => {
    await seedUser("eve");
    await t.db.insert(peerAdvisers).values({ userId: "eve", campusId: "intramuros" });
    await signIn("admin");
    expect((await campus.POST(post("/api/admin/peer-advisers/campus", { userId: "eve", campusId: "makati" }))).status).toBe(200);
    expect(await t.db.select({ campusId: peerAdvisers.campusId }).from(peerAdvisers).where(eq(peerAdvisers.userId, "eve"))).toEqual([{ campusId: "makati" }]);
    expect(await auditFor("eve")).toEqual([expect.objectContaining({ action: "update_peer_adviser", targetLabel: "eve@example.test · Campus: Makati" })]);
    expect((await campus.POST(post("/api/admin/peer-advisers/campus", { userId: "una", campusId: "makati" }))).status).toBe(404);
  });

  it("require a reason to revoke", async () => {
    await signIn("admin");
    expect((await revoke.POST(post("/api/admin/peer-advisers/revoke", { userId: "ana", reason: "  " }))).status).toBe(400);
    expect(await t.db.select().from(peerAdvisers).where(eq(peerAdvisers.userId, "ana"))).toHaveLength(1);
  });

  it("revoke in one batch: delete the row and its courses and Availability, unclaim pending and rescheduled requests, and audit the reason", async () => {
    await seedUser("fay");
    await t.db.insert(peerAdvisers).values({ userId: "fay", campusId: "intramuros" });
    await t.db.insert(courses).values({ code: "MATH146", title: "Calculus" });
    await t.db.insert(peerAdviserCourses).values({ userId: "fay", courseCode: "MATH146" });
    await t.db.insert(peerAdviserAvailability).values({ userId: "fay", weekday: 1, hour: 9 });
    const request = (id: string, status: "pending" | "rescheduled" | "done", claimedByUserId = "fay") =>
      ({ id, intakeKey: id.padEnd(64, "0"), submittedAt: 1, campusText: "Intramuros", courseText: "MATH146", status, claimedByUserId, claimedAt: 1 });
    await t.db.insert(advisingRequests).values([request("r-pending", "pending"), request("r-resched", "rescheduled"), request("r-done", "done"), request("r-other", "pending", "ana")]);
    await signIn("admin");
    const response = await revoke.POST(post("/api/admin/peer-advisers/revoke", { userId: "fay", reason: "Graduated" }));
    expect(response.status).toBe(200);
    expect(await t.db.select().from(peerAdvisers).where(eq(peerAdvisers.userId, "fay"))).toEqual([]);
    expect(await t.db.select().from(peerAdviserCourses).where(eq(peerAdviserCourses.userId, "fay"))).toEqual([]);
    expect(await t.db.select().from(peerAdviserAvailability).where(eq(peerAdviserAvailability.userId, "fay"))).toEqual([]);
    const claims = Object.fromEntries((await t.db.select({ id: advisingRequests.id, by: advisingRequests.claimedByUserId, at: advisingRequests.claimedAt }).from(advisingRequests)).map((r) => [r.id, [r.by, r.at]]));
    expect(claims).toEqual({ "r-pending": [null, null], "r-resched": [null, null], "r-done": ["fay", 1], "r-other": ["ana", 1] });
    expect(await auditFor("fay")).toEqual([expect.objectContaining({ action: "revoke_peer_adviser", reason: "Graduated", targetLabel: "fay@example.test" })]);
    expect((await revoke.POST(post("/api/admin/peer-advisers/revoke", { userId: "fay", reason: "Again" }))).status).toBe(404);
    expect(await auditFor("fay")).toHaveLength(1);
    state.current = { user: (await t.db.select().from(users).where(eq(users.id, "fay")))[0], profile: null };
    expect(await access.requirePeerAdviser()).toBeNull();
  });
});
