import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { listOpenReports, removeProfileImages, suspendProfile } from "@/lib/admin";
import { loadPublishedProfile } from "@/lib/public/published-profile";
import { abuseReports, adminAuditLog, profiles, publishedProfiles, reservedSlugs, users } from "@/lib/db/schema";
import { createTestDb } from "./helpers";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;
let t: TestDb;

const ADMIN = { id: "u-admin", googleSub: "admin-sub" };
const deps = () => ({ db: t.db, kv: { delete: async () => {} }, adminSubs: "other-sub, admin-sub" });

async function seedPublished(id: string, keys: { avatar?: string; background?: string } = {}) {
  await t.db.insert(users).values({ id: `u-${id}`, googleSub: `sub-${id}`, email: `${id}@example.test` });
  await t.db.insert(profiles).values({ id, userId: `u-${id}`, slug: id, displayName: id, evaluationUrl: "https://forms.example/e", status: "published", avatarKey: keys.avatar ?? null, backgroundKey: keys.background ?? null });
  await t.db.insert(reservedSlugs).values({ slug: id, profileId: id });
  await t.db.insert(publishedProfiles).values({ profileId: id, slug: id, displayName: id, role: "Student assistant", bio: "", accentColor: "#B5121B", evaluationUrl: "https://forms.example/e", avatarKey: keys.avatar ?? null, backgroundKey: keys.background ?? null });
}

const auditFor = (profileId: string) => t.db.select().from(adminAuditLog).where(eq(adminAuditLog.targetProfileId, profileId));

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.dispose());

describe("listOpenReports", () => {
  it("shows an Administrator the open Abuse Reports, newest first, with the reported Profile", async () => {
    await seedPublished("fay");
    await t.db.insert(abuseReports).values([
      { id: "r-old", profileId: "fay", reason: "impersonation", details: "Not the real Fay", createdAt: 100 },
      { id: "r-new", profileId: "fay", reason: "malicious-link", details: "Phishing link", createdAt: 200 },
      { id: "r-done", profileId: "fay", reason: "prohibited-content", details: "Old", status: "resolved", createdAt: 300 },
    ]);
    const result = await listOpenReports(deps(), ADMIN);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ reports: [
      { id: "r-new", reason: "malicious-link", details: "Phishing link", createdAt: 200, profileId: "fay", slug: "fay", displayName: "fay", profileStatus: "published" },
      { id: "r-old", reason: "impersonation", details: "Not the real Fay", createdAt: 100, profileId: "fay", slug: "fay", displayName: "fay", profileStatus: "published" },
    ] });
  });

  it("shows nothing to a User who is not an Administrator", async () => {
    expect(await listOpenReports(deps(), { id: "u-fay", googleSub: "sub-fay" })).toEqual({ status: 401, body: { error: "Unauthorized" } });
  });
});

describe("removeProfileImages", () => {
  it("deletes the public images from KV, clears them on the Profile and its public page, and audits it", async () => {
    await seedPublished("dee", { avatar: "img/dee/a1", background: "img/dee/b1" });
    await t.db.update(profiles).set({ avatarKey: "img/dee/a2" }).where(eq(profiles.id, "dee"));
    const deleted: string[] = [];
    const result = await removeProfileImages({ ...deps(), kv: { delete: async (key: string) => void deleted.push(key) } }, ADMIN, { profileId: "dee", reason: "Offensive photo" });
    expect(result).toEqual({ status: 200, body: { ok: true, slug: "dee" } });
    expect(deleted.sort()).toEqual(["img/dee/a1", "img/dee/a2", "img/dee/b1"]);
    expect(await loadPublishedProfile(t.db, "dee")).toMatchObject({ avatarKey: null, backgroundKey: null, displayName: "dee" });
    const [profile] = await t.db.select().from(profiles).where(eq(profiles.id, "dee"));
    expect(profile).toMatchObject({ avatarKey: null, backgroundKey: null, status: "published" });
    expect(await auditFor("dee")).toEqual([expect.objectContaining({ action: "remove_images", reason: "Offensive photo", actorGoogleSub: "admin-sub" })]);
  });

  it("refuses a non-administrator and leaves the images in place", async () => {
    await seedPublished("eve", { avatar: "img/eve/a1" });
    const deleted: string[] = [];
    const result = await removeProfileImages({ ...deps(), kv: { delete: async (key: string) => void deleted.push(key) } }, { id: "u-eve", googleSub: "sub-eve" }, { profileId: "eve", reason: "x" });
    expect(result.status).toBe(401);
    expect(deleted).toEqual([]);
    expect(await loadPublishedProfile(t.db, "eve")).toMatchObject({ avatarKey: "img/eve/a1" });
    expect(await auditFor("eve")).toEqual([]);
  });
});

describe("suspendProfile", () => {
  it("takes the Profile off its public page, keeps owner and Slug, and audits the action", async () => {
    await seedPublished("ada");
    const result = await suspendProfile(deps(), ADMIN, { profileId: "ada", reason: "Impersonating a staff member" });
    expect(result).toEqual({ status: 200, body: { ok: true, slug: "ada" } });
    expect(await loadPublishedProfile(t.db, "ada")).toBeNull();
    const [profile] = await t.db.select().from(profiles).where(eq(profiles.id, "ada"));
    expect(profile).toMatchObject({ status: "suspended", userId: "u-ada", slug: "ada" });
    expect(await auditFor("ada")).toEqual([expect.objectContaining({ actorGoogleSub: "admin-sub", action: "suspend", targetSlug: "ada", reason: "Impersonating a staff member" })]);
  });

  it("refuses a User who is not on the allowlist, or any User when the allowlist is unset, and changes nothing", async () => {
    await seedPublished("bea");
    const owner = { id: "u-bea", googleSub: "sub-bea" };
    expect((await suspendProfile(deps(), owner, { profileId: "bea", reason: "x" })).status).toBe(401);
    expect((await suspendProfile({ ...deps(), adminSubs: undefined }, ADMIN, { profileId: "bea", reason: "x" })).status).toBe(401);
    expect((await suspendProfile({ ...deps(), adminSubs: " , " }, ADMIN, { profileId: "bea", reason: "x" })).status).toBe(401);
    expect(await loadPublishedProfile(t.db, "bea")).not.toBeNull();
    expect(await auditFor("bea")).toEqual([]);
  });

  it("requires a reason and an existing, not-yet-suspended Profile", async () => {
    await seedPublished("cy");
    expect((await suspendProfile(deps(), ADMIN, { profileId: "cy", reason: "   " })).status).toBe(400);
    expect((await suspendProfile(deps(), ADMIN, { profileId: "nobody", reason: "Spam" })).status).toBe(404);
    expect((await suspendProfile(deps(), ADMIN, { profileId: "cy", reason: "Spam" })).status).toBe(200);
    expect((await suspendProfile(deps(), ADMIN, { profileId: "cy", reason: "Spam again" })).status).toBe(409);
    expect(await auditFor("cy")).toHaveLength(1);
  });
});

describe("admin audit log", () => {
  it("keeps entries append-only: they can be written but never changed or deleted", async () => {
    await t.db.run(sql`INSERT INTO admin_audit_log (id, actor_google_sub, action, target_profile_id, target_slug, reason) VALUES ('a1', 'admin-sub', 'suspend', 'p-x', 'x', 'Impersonation')`);
    await expect(t.db.run(sql`UPDATE admin_audit_log SET reason = 'edited' WHERE id = 'a1'`)).rejects.toThrow();
    await expect(t.db.run(sql`DELETE FROM admin_audit_log WHERE id = 'a1'`)).rejects.toThrow();
    const rows = await t.db.all<{ reason: string }>(sql`SELECT reason FROM admin_audit_log WHERE id = 'a1'`);
    expect(rows).toEqual([{ reason: "Impersonation" }]);
  });
});
