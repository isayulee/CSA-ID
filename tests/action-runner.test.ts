import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { profiles, publishedProfiles, users } from "@/lib/db/schema";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { createTestDb } from "./helpers";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;
const state = vi.hoisted(() => ({
  db: null as unknown,
  current: null as unknown,
  purged: [] as string[],
  purgeFails: false,
}));

vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/cloudflare", () => ({ getBindings: () => ({ KV: { delete: async () => {}, list: async () => ({ keys: [], list_complete: true }) }, ADMIN_GOOGLE_SUBS: "sub-admin" }) }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentAccount: async () => state.current }));
vi.mock("@/lib/edge-cache", () => ({
  purgeProfilePage: async (slug: string) => {
    if (state.purgeFails) throw new Error("cache unavailable");
    state.purged.push(slug);
  },
}));

const publish = await import("@/app/api/profile/publish/route");
const unpublish = await import("@/app/api/profile/unpublish/route");
const slug = await import("@/app/api/profile/slug/route");
const profile = await import("@/app/api/profile/route");
const account = await import("@/app/api/account/route");
const suspend = await import("@/app/api/admin/suspend/route");

let t: TestDb;
const ORIGIN = "http://localhost:3100";
const send = (method: string, path: string, body?: unknown) =>
  new Request(`${ORIGIN}${path}`, { method, headers: { origin: ORIGIN, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

async function signIn(id: string, values: Partial<typeof profiles.$inferInsert> = {}) {
  await t.db.insert(users).values({ id: `u-${id}`, googleSub: `sub-${id}`, email: `${id}@example.test` });
  await t.db.insert(profiles).values({ id, userId: `u-${id}`, displayName: id, role: "Peer Adviser", evaluationUrl: "https://forms.example/e", ...values });
  const [user] = await t.db.select().from(users).where(eq(users.id, `u-${id}`));
  const [row] = await t.db.select().from(profiles).where(eq(profiles.id, id));
  state.current = { user, profile: row };
}

beforeAll(async () => {
  t = await createTestDb();
  state.db = t.db;
});
afterAll(() => t.dispose());
beforeEach(() => {
  state.purged = [];
  state.purgeFails = false;
  state.current = null;
});

describe("which cached public page each mutation clears", () => {
  it("publish clears the published Slug", async () => {
    await signIn("pia", { slug: "pia" });
    const response = await publish.POST(send("POST", "/api/profile/publish"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, slug: "pia" });
    expect(state.purged).toEqual(["pia"]);
  });

  it("a refused publish clears nothing", async () => {
    await signIn("nos");
    const response = await publish.POST(send("POST", "/api/profile/publish"));
    expect(response.status).toBe(400);
    expect(state.purged).toEqual([]);
  });

  it("unpublish clears the Profile's Slug, and nothing when it has none", async () => {
    await signIn("una", { slug: "una", status: "published" });
    const response = await unpublish.POST(send("POST", "/api/profile/unpublish"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(state.purged).toEqual(["una"]);

    state.purged = [];
    await signIn("nobody");
    expect((await unpublish.POST(send("POST", "/api/profile/unpublish"))).status).toBe(200);
    expect(state.purged).toEqual([]);
  });

  it("claiming a Slug and saving the draft clear nothing", async () => {
    await signIn("cal");
    const claim = await slug.POST(send("POST", "/api/profile/slug", { slug: "cal-id" }));
    expect(await claim.json()).toEqual({ ok: true, slug: "cal-id" });
    const save = await profile.PUT(send("PUT", "/api/profile", { displayName: "Cal", role: "Role", bio: "", accentColor: "#B5121B", evaluationUrl: "", links: [] }));
    expect(save.status).toBe(200);
    expect(state.purged).toEqual([]);
  });

  it("account deletion clears the Slug, ends the Session cookie and sends no-store", async () => {
    await signIn("del", { slug: "del", status: "published" });
    const response = await account.DELETE(send("DELETE", "/api/account"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=;`);
    expect(state.purged).toEqual(["del"]);
  });
});

describe("a failed clear never fails a committed write", () => {
  it("publish still answers 200 and the Profile is published", async () => {
    await signIn("fae", { slug: "fae" });
    state.purgeFails = true;
    const response = await publish.POST(send("POST", "/api/profile/publish"));
    expect(response.status).toBe(200);
    expect(await t.db.select().from(publishedProfiles).where(eq(publishedProfiles.profileId, "fae"))).toHaveLength(1);
  });

  it("unpublish still answers 200", async () => {
    await signIn("fun", { slug: "fun", status: "published" });
    state.purgeFails = true;
    expect((await unpublish.POST(send("POST", "/api/profile/unpublish"))).status).toBe(200);
  });

  it("account deletion still answers 200 and ends the Session cookie", async () => {
    await signIn("fad", { slug: "fad", status: "published" });
    state.purgeFails = true;
    const response = await account.DELETE(send("DELETE", "/api/account"));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=;`);
  });

  it("an Administrator suspension still answers 200", async () => {
    await signIn("fas", { slug: "fas", status: "published" });
    await t.db.insert(users).values({ id: "u-admin", googleSub: "sub-admin", email: "admin@example.test" });
    const [admin] = await t.db.select().from(users).where(eq(users.id, "u-admin"));
    state.current = { user: admin, profile: null };
    state.purgeFails = true;
    const response = await suspend.POST(send("POST", "/api/admin/suspend", { profileId: "fas", reason: "Spam" }));
    expect(response.status).toBe(200);
    const [row] = await t.db.select().from(profiles).where(eq(profiles.id, "fas"));
    expect(row.status).toBe("suspended");
  });
});
