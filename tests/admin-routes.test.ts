import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { loadPublishedProfile } from "@/lib/public/published-profile";
import { draftSocialLinks, profiles, publishedProfiles, publishedSocialLinks, reservedSlugs, users } from "@/lib/db/schema";
import { createTestDb } from "./helpers";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;
const state = vi.hoisted(() => ({
  db: null as unknown,
  current: null as unknown,
  bindings: {} as Record<string, unknown>,
  purged: [] as string[],
}));

vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/cloudflare", () => ({ getBindings: () => state.bindings }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentAccount: async () => state.current }));
vi.mock("@/lib/edge-cache", () => ({ purgeProfilePage: async (slug: string) => void state.purged.push(slug) }));

const publish = await import("@/app/api/profile/publish/route");

let t: TestDb;
const ORIGIN = "http://localhost:3100";
const post = (path: string, body?: unknown, headers: Record<string, string> = { origin: ORIGIN }) =>
  new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

async function seedUserWithProfile(id: string, status: "draft" | "published" | "suspended") {
  await t.db.insert(users).values({ id: `u-${id}`, googleSub: `sub-${id}`, email: `${id}@example.test`, name: id });
  await t.db.insert(reservedSlugs).values({ slug: id });
  await t.db.insert(profiles).values({ id, userId: `u-${id}`, slug: id, displayName: id, roleTitle: "Peer Adviser", evaluationUrl: "https://forms.example/e", status });
  const [user] = await t.db.select().from(users).where(eq(users.id, `u-${id}`));
  const [profile] = await t.db.select().from(profiles).where(eq(profiles.id, id));
  return { user, profile };
}

beforeAll(async () => {
  t = await createTestDb();
  state.db = t.db;
});
afterAll(() => t.dispose());
beforeEach(() => {
  state.purged = [];
  state.bindings = { KV: { delete: async () => {} }, ADMIN_GOOGLE_SUBS: "sub-admin" };
});

describe("publish after a suspension", () => {
  it("does not put a Profile back online when it was suspended after Publish read it", async () => {
    const account = await seedUserWithProfile("gus", "draft");
    await t.db.insert(draftSocialLinks).values({ id: "d-gus", profileId: "gus", service: "github", url: "https://github.com/gus", displayOrder: 0 });
    await t.db.update(profiles).set({ status: "suspended" }).where(eq(profiles.id, "gus"));
    state.current = account; // still the pre-suspension read
    const response = await publish.POST(post("/api/profile/publish"));
    expect(response.status).toBe(403);
    const [row] = await t.db.select().from(profiles).where(eq(profiles.id, "gus"));
    expect(row.status).toBe("suspended");
    expect(await loadPublishedProfile(t.db, "gus")).toBeNull();
    expect(await t.db.select().from(publishedProfiles).where(eq(publishedProfiles.profileId, "gus"))).toEqual([]);
    expect(await t.db.select().from(publishedSocialLinks).where(eq(publishedSocialLinks.profileId, "gus"))).toEqual([]);
  });
});

const suspend = await import("@/app/api/admin/suspend/route");
const removeImages = await import("@/app/api/admin/remove-images/route");

describe("administrator routes", () => {
  it("reject a request without a same-origin Origin header", async () => {
    state.current = await seedUserWithProfile("admin", "draft");
    const response = await suspend.POST(post("/api/admin/suspend", { profileId: "x", reason: "Spam" }, {}));
    expect(response.status).toBe(403);
  });

  it("treat a signed-in User who is not on the allowlist like a signed-out visitor", async () => {
    const target = await seedUserWithProfile("hal", "published");
    state.current = target;
    for (const route of [suspend, removeImages]) {
      const response = await route.POST(post("/api/admin/x", { profileId: "hal", reason: "Spam" }));
      expect(response.status).toBe(401);
    }
    state.current = null;
    expect((await suspend.POST(post("/api/admin/suspend", { profileId: "hal", reason: "Spam" }))).status).toBe(401);
    const [row] = await t.db.select().from(profiles).where(eq(profiles.id, "hal"));
    expect(row.status).toBe("published");
  });

  it("let an Administrator suspend a Profile and purge its cached public page", async () => {
    await seedUserWithProfile("ivy", "published");
    const [admin] = await t.db.select().from(users).where(eq(users.id, "u-admin"));
    state.current = { user: admin, profile: null };
    const response = await suspend.POST(post("/api/admin/suspend", { profileId: "ivy", reason: "Impersonation" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, slug: "ivy" });
    expect(state.purged).toEqual(["ivy"]);
    const [row] = await t.db.select().from(profiles).where(eq(profiles.id, "ivy"));
    expect(row.status).toBe("suspended");
  });

  it("let an Administrator remove a Profile's images and purge its cached public page", async () => {
    await seedUserWithProfile("joy", "published");
    await t.db.update(profiles).set({ avatarKey: "img/joy/a1" }).where(eq(profiles.id, "joy"));
    const deleted: string[] = [];
    state.bindings = { ...state.bindings, KV: { delete: async (key: string) => void deleted.push(key) } };
    const [admin] = await t.db.select().from(users).where(eq(users.id, "u-admin"));
    state.current = { user: admin, profile: null };
    const response = await removeImages.POST(post("/api/admin/remove-images", { profileId: "joy", reason: "Offensive photo" }));
    expect(response.status).toBe(200);
    expect(deleted).toEqual(["img/joy/a1"]);
    expect(state.purged).toEqual(["joy"]);
  });
});
