import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminAuditLog, adviseeContacts, advisingNotes, advisingRequests, advisingRequestSlots, peerAdvisers, users } from "@/lib/db/schema";
import { createTestDb } from "./helpers";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;
const state = vi.hoisted(() => ({ db: null as unknown, current: null as unknown, bindings: {} as Record<string, unknown> }));

vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/cloudflare", () => ({ getBindings: () => state.bindings }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentAccount: async () => state.current }));

const listRoute = await import("@/app/api/portal/advising-requests/route");
const readRoute = await import("@/app/api/portal/advising-requests/[id]/route");
const claimRoute = await import("@/app/api/portal/advising-requests/claim/route");
const giveBackRoute = await import("@/app/api/portal/advising-requests/give-back/route");
const updateRoute = await import("@/app/api/portal/advising-requests/update/route");
const notesRoute = await import("@/app/api/portal/advising-requests/notes/route");
const assignRoute = await import("@/app/api/admin/advising-requests/assign/route");
const { claimAdvisingRequest } = await import("@/lib/portal/advising-requests");

let t: TestDb;
const ORIGIN = "http://localhost:3100";
const post = (path: string, body: unknown) =>
  new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) });

async function call(response: Promise<Response>) {
  const res = await response;
  return { status: res.status, json: await res.json() as Record<string, unknown> & { error?: string } };
}
const claim = (requestId: string) => call(claimRoute.POST(post("/api/portal/advising-requests/claim", { requestId })));
const giveBack = (requestId: string) => call(giveBackRoute.POST(post("/api/portal/advising-requests/give-back", { requestId })));
const update = (body: unknown) => call(updateRoute.POST(post("/api/portal/advising-requests/update", body)));
const note = (requestId: string, body: string) => call(notesRoute.POST(post("/api/portal/advising-requests/notes", { requestId, body })));
const assign = (requestId: string, userId: string) => call(assignRoute.POST(post("/api/admin/advising-requests/assign", { requestId, userId })));
const list = (query = "") => call(listRoute.GET(new Request(`${ORIGIN}/api/portal/advising-requests${query}`)));
const read = (id: string) => call(readRoute.GET(new Request(`${ORIGIN}/api/portal/advising-requests/${id}`), { params: Promise.resolve({ id }) }));

async function seedUser(id: string, peerAdviser: boolean) {
  await t.db.insert(users).values({ id, googleSub: `sub-${id}`, email: `${id}@example.test`, name: `${id} name` });
  if (peerAdviser) await t.db.insert(peerAdvisers).values({ userId: id, campusId: "intramuros" });
}
const signIn = async (id: string | null) => {
  if (id === null) return void (state.current = null);
  const [user] = await t.db.select().from(users).where(eq(users.id, id));
  state.current = { user, profile: null };
};

let seq = 0;
/** One request as intake would write it, with an advisee contact and a weekly Monday 13:00 slot. */
async function seedRequest(overrides: Partial<typeof advisingRequests.$inferInsert> = {}) {
  const id = `req-${++seq}`;
  await t.db.insert(advisingRequests).values({
    id, intakeKey: String(seq).padStart(64, "0"), submittedAt: 1_700_000_000 + seq, campusText: "Intramuros", campusId: "intramuros",
    courseText: "Calculus 1/MATH146", topic: "Limits", availableDayText: "Monday", availableTimeText: "1-2pm", ...overrides,
  });
  await t.db.insert(adviseeContacts).values({ requestId: id, fullName: "Test Advisee", studentNumber: "2024000000", email: "advisee@example.test", cardinalMail: "advisee@mymail.example.test" });
  await t.db.insert(advisingRequestSlots).values({ requestId: id, weekday: 1, onDate: "", hour: 13 });
  return id;
}
const requestRow = async (id: string) => (await t.db.select().from(advisingRequests).where(eq(advisingRequests.id, id)))[0];
const slotsOf = (id: string) => t.db.select({ weekday: advisingRequestSlots.weekday, onDate: advisingRequestSlots.onDate, hour: advisingRequestSlots.hour })
  .from(advisingRequestSlots).where(eq(advisingRequestSlots.requestId, id)).orderBy(advisingRequestSlots.onDate, advisingRequestSlots.weekday, advisingRequestSlots.hour);

beforeAll(async () => {
  t = await createTestDb();
  state.db = t.db;
  state.bindings = { ADMIN_GOOGLE_SUBS: "sub-admin" };
  await seedUser("amy", true);
  await seedUser("ben", true);
  await seedUser("admin", false);
  await seedUser("una", false);
});
afterAll(() => t.dispose());
beforeEach(() => {
  state.current = null;
});

describe("who reaches the Scheduler", () => {
  it("refuses signed-out visitors and Users who aren't Peer Advisers", async () => {
    const id = await seedRequest();
    expect((await list()).status).toBe(401);
    await signIn("una");
    expect((await list()).status).toBe(403);
    expect((await read(id)).status).toBe(403);
    expect((await claim(id)).status).toBe(403);
  });
});

describe("claiming", () => {
  it("gives one winner when two Peer Advisers claim at once", async () => {
    const id = await seedRequest();
    const actor = (userId: string) => ({ user: { id: userId, googleSub: `sub-${userId}`, name: userId }, isPeerAdviser: true, isAdministrator: false });
    // Called below the route, so each claim carries its own Peer Adviser while both run at once.
    const results = await Promise.all([
      claimAdvisingRequest(t.db, actor("amy"), { requestId: id }),
      claimAdvisingRequest(t.db, actor("ben"), { requestId: id }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = results[0].status === 200 ? "amy" : "ben";
    expect((await requestRow(id)).claimedByUserId).toBe(winner);
  });

  it("lets an Administrator assign but not claim, and audits the assignment", async () => {
    const id = await seedRequest();
    await signIn("admin");
    expect((await claim(id)).status).toBe(403);
    expect((await assign(id, "una")).status).toBe(404);
    expect((await assign(id, "amy")).status).toBe(200);
    expect((await requestRow(id)).claimedByUserId).toBe("amy");
    expect((await assign(id, "ben")).status).toBe(200);
    expect((await requestRow(id)).claimedByUserId).toBe("ben");
    const entries = await t.db.select().from(adminAuditLog).where(and(eq(adminAuditLog.action, "assign_advising_request"), eq(adminAuditLog.targetId, id)));
    expect(entries.map((e) => e.targetLabel)).toEqual(expect.arrayContaining(["Calculus 1/MATH146 · amy@example.test", "Calculus 1/MATH146 · ben@example.test"]));
    expect(entries).toHaveLength(2);
  });

  it("refuses assigning for a User who is not an Administrator", async () => {
    const id = await seedRequest();
    await signIn("amy");
    expect((await assign(id, "amy")).status).toBe(401);
    expect((await requestRow(id)).claimedByUserId).toBeNull();
  });

  it("lets only the claimant give a request back", async () => {
    const id = await seedRequest();
    await signIn("amy");
    expect((await claim(id)).status).toBe(200);
    await signIn("ben");
    expect((await giveBack(id)).status).toBe(403);
    expect((await requestRow(id)).claimedByUserId).toBe("amy");
    await signIn("amy");
    expect((await giveBack(id)).status).toBe(200);
    const row = await requestRow(id);
    expect([row.claimedByUserId, row.claimedAt]).toEqual([null, null]);
  });
});

describe("advisee personal data and notes", () => {
  it("reach the claimant and Administrators, never another Peer Adviser", async () => {
    const id = await seedRequest();
    await signIn("amy");
    await claim(id);
    expect((await note(id, "Met on Teams")).status).toBe(200);

    const mine = (await read(id)).json.request as Record<string, unknown>;
    expect(mine.access).toBe("full");
    expect(mine.contact).toMatchObject({ fullName: "Test Advisee", cardinalMail: "advisee@mymail.example.test" });
    expect(mine.notes).toMatchObject([{ body: "Met on Teams", authorName: "amy name" }]);

    await signIn("ben");
    const theirs = (await read(id)).json.request as Record<string, unknown>;
    expect(theirs).toEqual({
      access: "claimed", id, status: "pending", courseCode: null, courseText: "Calculus 1/MATH146",
      campusId: "intramuros", campusText: "Intramuros", claimant: { userId: "amy", name: "amy name" },
    });
    const listed = ((await list("?claimant=amy")).json.requests as Record<string, unknown>[]).find((r) => r.id === id);
    expect(listed).toEqual(theirs);
    const serialized = JSON.stringify((await list()).json);
    expect(serialized).not.toContain("Test Advisee");
    expect(serialized).not.toContain("Met on Teams");

    await signIn("admin");
    const administrator = (await read(id)).json.request as Record<string, unknown>;
    expect(administrator.contact).toMatchObject({ fullName: "Test Advisee" });
    expect(administrator.notes).toHaveLength(1);
  });

  it("shows an unclaimed request's topic and times, without the contact", async () => {
    const id = await seedRequest();
    await signIn("ben");
    const open = (await read(id)).json.request as Record<string, unknown>;
    expect(open).toMatchObject({ access: "open", topic: "Limits", availableTimeText: "1-2pm", slots: [{ weekday: 1, onDate: "", hour: 13 }] });
    expect(open).not.toHaveProperty("contact");
    expect(open).not.toHaveProperty("notes");
  });
});

describe("changing a request", () => {
  it("lets only the claimant change status, schedule, slots and notes", async () => {
    const id = await seedRequest();
    await signIn("ben");
    expect((await update({ requestId: id, status: "done" })).status).toBe(403);
    await signIn("amy");
    await claim(id);
    await signIn("ben");
    expect((await update({ requestId: id, status: "done" })).status).toBe(403);
    expect((await update({ requestId: id, slots: [{ weekday: 2, hour: 9 }] })).status).toBe(403);
    expect((await note(id, "Not my request")).status).toBe(403);
    expect((await requestRow(id)).status).toBe("pending");
    expect(await slotsOf(id)).toEqual([{ weekday: 1, onDate: "", hour: 13 }]);
    expect(await t.db.select().from(advisingNotes).where(eq(advisingNotes.requestId, id))).toEqual([]);

    await signIn("amy");
    expect((await update({ requestId: id, status: "rescheduled", schedule: { on: "2026-12-01", start: "13:30" } })).status).toBe(200);
    expect(await requestRow(id)).toMatchObject({ status: "rescheduled", scheduledOn: "2026-12-01", scheduledStart: "13:30" });
    expect((await update({ requestId: id, schedule: null })).status).toBe(200);
    expect(await requestRow(id)).toMatchObject({ scheduledOn: null, scheduledStart: null });
  });

  it("lets an Administrator change any request without claiming it", async () => {
    const id = await seedRequest();
    await signIn("amy");
    await claim(id);
    await signIn("admin");
    expect((await update({ requestId: id, status: "cancelled" })).status).toBe(200);
    expect((await note(id, "Advisee withdrew")).status).toBe(200);
    expect(await requestRow(id)).toMatchObject({ status: "cancelled", claimedByUserId: "amy" });
  });

  it("clears times unclear when slots are set by hand", async () => {
    const id = await seedRequest({ timesUnclear: true });
    await signIn("amy");
    await claim(id);
    const slots = [{ weekday: 3, hour: 10 }, { weekday: 3, hour: 10 }, { onDate: "2026-12-05", hour: 16 }];
    expect((await update({ requestId: id, slots })).status).toBe(200);
    expect((await requestRow(id)).timesUnclear).toBe(false);
    // 2026-12-05 is a Saturday, so the dated slot stores weekday 6; the duplicate weekly slot is kept once.
    expect(await slotsOf(id)).toEqual([{ weekday: 3, onDate: "", hour: 10 }, { weekday: 6, onDate: "2026-12-05", hour: 16 }]);
  });

  it("refuses slots on a Sunday or outside 08:00 to 17:00, and empty updates", async () => {
    const id = await seedRequest();
    await signIn("amy");
    await claim(id);
    expect((await update({ requestId: id, slots: [{ onDate: "2026-12-06", hour: 10 }] })).status).toBe(400);
    expect((await update({ requestId: id, slots: [{ weekday: 1, hour: 17 }] })).status).toBe(400);
    expect((await update({ requestId: id, schedule: { on: "2026-02-30", start: null } })).status).toBe(400);
    expect((await update({ requestId: id })).status).toBe(400);
    expect(await slotsOf(id)).toEqual([{ weekday: 1, onDate: "", hour: 13 }]);
  });
});

describe("listing", () => {
  it("filters by claimant and status", async () => {
    const mine = await seedRequest({ status: "rescheduled" });
    const open = await seedRequest();
    await signIn("amy");
    await claim(mine);
    const ids = (r: { json: Record<string, unknown> }) => (r.json.requests as { id: string }[]).map((x) => x.id);
    expect(ids(await list("?claimant=me&status=rescheduled"))).toContain(mine);
    expect(ids(await list("?claimant=me&status=rescheduled"))).not.toContain(open);
    expect(ids(await list("?claimant=none"))).toContain(open);
    expect(ids(await list("?claimant=none"))).not.toContain(mine);
    expect((await list("?status=unknown")).status).toBe(400);
  });
});
