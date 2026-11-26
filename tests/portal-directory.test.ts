import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { adminAuditLog, peerAdvisers, profiles, publishedProfiles, reservedSlugs, users } from "@/lib/db/schema";
import { createTestDb } from "./helpers";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;
const state = vi.hoisted(() => ({ db: null as unknown, current: null as unknown, bindings: {} as Record<string, unknown> }));

vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/cloudflare", () => ({ getBindings: () => state.bindings }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentAccount: async () => state.current }));

const directory = await import("@/app/api/portal/directory/route");
const officer = await import("@/app/api/admin/peer-advisers/officer/route");

let t: TestDb;
const ORIGIN = "http://localhost:3100";
const post = (body: unknown, headers: Record<string, string> = { origin: ORIGIN }) =>
  new Request(`${ORIGIN}/api/admin/peer-advisers/officer`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const getDirectory = () => directory.GET(new Request(`${ORIGIN}/api/portal/directory`));

async function seedUser(id: string, name = id) {
  await t.db.insert(users).values({ id, googleSub: `sub-${id}`, email: `${id}@example.test`, name });
}
async function seedPeerAdviser(id: string, name: string, officerPosition: string | null = null, officerOrder: number | null = null) {
  await seedUser(id, name);
  await t.db.insert(peerAdvisers).values({ userId: id, campusId: "intramuros", officerPosition, officerOrder });
}
async function seedProfile(userId: string, slug: string, status: "draft" | "published" | "suspended", avatarKey: string | null = null) {
  await t.db.insert(reservedSlugs).values({ slug });
  await t.db.insert(profiles).values({ id: `p-${userId}`, userId, slug, status, displayName: `${userId} display`, avatarKey });
  await t.db.insert(publishedProfiles).values({ profileId: `p-${userId}`, slug, displayName: `${userId} display`, roleTitle: "", bio: "", accentColor: "#B5121B", avatarKey, evaluationUrl: "https://example.test/form" });
}
const signIn = async (id: string) => {
  const [user] = await t.db.select().from(users).where(eq(users.id, id));
  state.current = { user, profile: null };
};
const officerOf = async (id: string) =>
  (await t.db.select({ officerPosition: peerAdvisers.officerPosition, officerOrder: peerAdvisers.officerOrder }).from(peerAdvisers).where(eq(peerAdvisers.userId, id)))[0];
const auditFor = (targetId: string) => t.db.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, targetId));

beforeAll(async () => {
  t = await createTestDb();
  state.db = t.db;
  await seedUser("admin", "Admin");
  await seedUser("una", "Una Outsider");
  await seedPeerAdviser("zed", "Zed Published");
  await seedProfile("zed", "zed-slug", "published", "img/zed/avatar/a.webp");
  await seedPeerAdviser("bea", "bea Draft");
  await seedProfile("bea", "bea-slug", "draft", "img/bea/avatar/b.webp");
  await seedPeerAdviser("cal", "Cal Suspended");
  await seedProfile("cal", "cal-slug", "suspended", "img/cal/avatar/c.webp");
  await seedPeerAdviser("amy", "Amy NoProfile");
  await seedPeerAdviser("vp", "Vic Officer", "Vice President", 2);
  await seedPeerAdviser("pres", "Yara Officer", "President", 1);
  await seedProfile("pres", "pres-slug", "published");
});
afterAll(() => t.dispose());
beforeEach(() => {
  state.current = null;
  state.bindings = { ADMIN_GOOGLE_SUBS: "sub-admin" };
});

describe("GET /api/portal/directory", () => {
  it("is closed to a signed-out visitor and a User who isn't approved", async () => {
    const signedOut = await getDirectory();
    expect(signedOut.status).toBe(401);
    expect(await signedOut.json()).toEqual({ error: "Unauthorized" });
    await signIn("una");
    const outsider = await getDirectory();
    expect(outsider.status).toBe(403);
    expect(await outsider.json()).toEqual({ error: "Forbidden" });
  });

  it("is open to a Peer Adviser and to an Administrator without a peer_advisers row", async () => {
    for (const id of ["amy", "admin"]) {
      await signIn(id);
      const response = await getDirectory();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it("lists Officers by order, then everyone else by name, with a photo and link only for a Published Profile", async () => {
    await signIn("amy");
    const { directory: entries } = await (await getDirectory()).json() as { directory: { userId: string }[] };
    expect(entries).toEqual([
      { userId: "pres", name: "pres display", officerPosition: "President", photoUrl: null, profileUrl: "/id/pres-slug" },
      { userId: "vp", name: "Vic Officer", officerPosition: "Vice President", photoUrl: null, profileUrl: null },
      { userId: "amy", name: "Amy NoProfile", officerPosition: null, photoUrl: null, profileUrl: null },
      { userId: "bea", name: "bea Draft", officerPosition: null, photoUrl: null, profileUrl: null },
      { userId: "cal", name: "Cal Suspended", officerPosition: null, photoUrl: null, profileUrl: null },
      { userId: "zed", name: "zed display", officerPosition: null, photoUrl: "/media/img/zed/avatar/a.webp", profileUrl: "/id/zed-slug" },
    ]);
    expect(entries.map((entry) => entry.userId)).not.toContain("una");
    expect(entries.map((entry) => entry.userId)).not.toContain("admin");
  });
});

describe("POST /api/admin/peer-advisers/officer", () => {
  it("lets only an Administrator set an Officer position, and never parses anyone else's body", async () => {
    for (const id of ["amy", "una"]) {
      await signIn(id);
      expect((await officer.POST(post({ userId: "amy", officerPosition: "Treasurer", officerOrder: 3 }))).status).toBe(401);
    }
    await signIn("admin");
    expect((await officer.POST(post({ userId: "amy", officerPosition: "Treasurer", officerOrder: 3 }, {}))).status).toBe(403);
    expect(await officerOf("amy")).toEqual({ officerPosition: null, officerOrder: null });
    expect(await auditFor("amy")).toEqual([]);
  });

  it("sets and clears an Officer position and Directory order, each with one audit entry", async () => {
    await signIn("admin");
    expect((await officer.POST(post({ userId: "amy", officerPosition: "  Treasurer ", officerOrder: 3 }))).status).toBe(200);
    expect(await officerOf("amy")).toEqual({ officerPosition: "Treasurer", officerOrder: 3 });
    // Setting the same values again changes nothing and writes no second entry.
    expect((await officer.POST(post({ userId: "amy", officerPosition: "Treasurer", officerOrder: 3 }))).status).toBe(200);
    expect((await officer.POST(post({ userId: "amy", officerPosition: "Treasurer", officerOrder: 4 }))).status).toBe(200);
    expect((await officer.POST(post({ userId: "amy", officerPosition: null, officerOrder: null }))).status).toBe(200);
    expect(await officerOf("amy")).toEqual({ officerPosition: null, officerOrder: null });
    const entries = await auditFor("amy");
    expect(entries.map((entry) => [entry.actorGoogleSub, entry.action, entry.targetType, entry.targetLabel])).toEqual(expect.arrayContaining([
      ["sub-admin", "update_peer_adviser", "user", "amy@example.test · Officer: Treasurer (#3)"],
      ["sub-admin", "update_peer_adviser", "user", "amy@example.test · Officer: Treasurer (#4)"],
      ["sub-admin", "update_peer_adviser", "user", "amy@example.test · Officer position cleared"],
    ]));
    expect(entries).toHaveLength(3);
  });

  it("rejects a half-set Officer, an order out of range, and a User who isn't a Peer Adviser", async () => {
    await signIn("admin");
    for (const body of [
      { userId: "amy", officerPosition: "Treasurer", officerOrder: null },
      { userId: "amy", officerPosition: null, officerOrder: 2 },
      { userId: "amy", officerPosition: "Treasurer", officerOrder: 100 },
      { userId: "amy", officerPosition: "   ", officerOrder: 1 },
      { userId: "amy", officerPosition: "x".repeat(65), officerOrder: 1 },
    ]) expect((await officer.POST(post(body))).status).toBe(400);
    expect((await officer.POST(post({ userId: "una", officerPosition: "Treasurer", officerOrder: 1 }))).status).toBe(404);
    expect(await auditFor("una")).toEqual([]);
  });
});
