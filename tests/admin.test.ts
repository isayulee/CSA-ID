import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { listOpenReports, removeProfileImages, suspendProfile } from "@/lib/admin";
import { loadPublishedProfile } from "@/lib/public/published-profile";
import { abuseReports, adminAuditLog, profiles, publishedProfiles, reservedSlugs, users } from "@/lib/db/schema";
import { createTestDb } from "./helpers";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;
let t: TestDb;

const ADMIN = { id: "u-admin", googleSub: "admin-sub" };
const deps = () => ({ db: t.db, kv: { delete: async () => {} }, adminSubs: "other-sub, admin-sub" });

async function seedPublished(id: string, keys: { avatar?: string; background?: string } = {}) {
  await t.db.insert(users).values({ id: `u-${id}`, googleSub: `sub-${id}`, email: `${id}@example.test`, name: id });
  await t.db.insert(reservedSlugs).values({ slug: id });
  await t.db.insert(profiles).values({ id, userId: `u-${id}`, slug: id, displayName: id, evaluationUrl: "https://forms.example/e", status: "published", avatarKey: keys.avatar ?? null, backgroundKey: keys.background ?? null });
  await t.db.insert(publishedProfiles).values({ profileId: id, slug: id, displayName: id, roleTitle: "Peer Adviser", bio: "", accentColor: "#B5121B", evaluationUrl: "https://forms.example/e", avatarKey: keys.avatar ?? null, backgroundKey: keys.background ?? null });
}

const auditFor = (profileId: string) => t.db.select().from(adminAuditLog).where(and(eq(adminAuditLog.targetType, "profile"), eq(adminAuditLog.targetId, profileId)));

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.dispose());

describe("listOpenReports", () => {
  it("shows an Administrator the open Abuse Reports, newest first, with the reported Profile", async () => {
    await seedPublished("fay");
    await t.db.insert(abuseReports).values([
      { id: "r-old", profileId: "fay", slug: "fay", reason: "impersonation", details: "Not the real Fay", createdAt: 100 },
      { id: "r-new", profileId: "fay", slug: "fay", reason: "malicious-link", details: "Phishing link", createdAt: 200 },
      { id: "r-done", profileId: "fay", slug: "fay", reason: "prohibited-content", details: "Old", status: "resolved", createdAt: 300 },
    ]);
    const result = await listOpenReports(deps(), ADMIN);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ reports: [
      { id: "r-new", reason: "malicious-link", details: "Phishing link", createdAt: 200, profileId: "fay", slug: "fay", displayName: "fay", profileStatus: "published" },
      { id: "r-old", reason: "impersonation", details: "Not the real Fay", createdAt: 100, profileId: "fay", slug: "fay", displayName: "fay", profileStatus: "published" },
    ] });
  });

  it("still names the reported Slug after the Profile's account is deleted", async () => {
    await seedPublished("gil");
    await t.db.insert(abuseReports).values({ id: "r-gil", profileId: "gil", slug: "gil", reason: "impersonation", details: "Not the real Gil", createdAt: 400 });
    await t.db.delete(users).where(eq(users.id, "u-gil"));
    const result = await listOpenReports(deps(), ADMIN);
    expect("reports" in result.body && result.body.reports.find((report) => report.id === "r-gil")).toEqual(
      { id: "r-gil", reason: "impersonation", details: "Not the real Gil", createdAt: 400, profileId: null, slug: "gil", displayName: null, profileStatus: null },
    );
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
    expect(await auditFor("ada")).toEqual([expect.objectContaining({ actorGoogleSub: "admin-sub", action: "suspend", targetType: "profile", targetId: "ada", targetLabel: "ada", reason: "Impersonating a staff member" })]);
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

  it("records one suspension, not two, when two Administrators suspend at the same moment", async () => {
    await seedPublished("kit");
    const results = await Promise.all([
      suspendProfile(deps(), ADMIN, { profileId: "kit", reason: "First" }),
      suspendProfile(deps(), { id: "u-other", googleSub: "other-sub" }, { profileId: "kit", reason: "Second" }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(await auditFor("kit")).toHaveLength(1);
  });

  it("requires a reason and an existing, not-yet-suspended Profile", async () => {
    await seedPublished("cyd");
    expect((await suspendProfile(deps(), ADMIN, { profileId: "cyd", reason: "   " })).status).toBe(400);
    expect((await suspendProfile(deps(), ADMIN, { profileId: "nobody", reason: "Spam" })).status).toBe(404);
    expect((await suspendProfile(deps(), ADMIN, { profileId: "cyd", reason: "Spam" })).status).toBe(200);
    expect((await suspendProfile(deps(), ADMIN, { profileId: "cyd", reason: "Spam again" })).status).toBe(409);
    expect(await auditFor("cyd")).toHaveLength(1);
  });
});

describe("admin audit log", () => {
  it("keeps entries append-only: they can be written but never changed or deleted", async () => {
    const run = (query: string) => t.d1.prepare(query).run();
    await run("INSERT INTO admin_audit_log (id, actor_google_sub, action, target_type, target_id, target_label, reason) VALUES ('a1', 'admin-sub', 'suspend', 'profile', 'p-x', 'x', 'Impersonation')");
    await expect(run("UPDATE admin_audit_log SET reason = 'edited' WHERE id = 'a1'")).rejects.toThrow(/append-only/);
    await expect(run("DELETE FROM admin_audit_log WHERE id = 'a1'")).rejects.toThrow(/append-only/);
    const rows = await t.db.all<{ reason: string }>(sql`SELECT reason FROM admin_audit_log WHERE id = 'a1'`);
    expect(rows).toEqual([{ reason: "Impersonation" }]);
  });

  it("refuses an entry whose target type does not fit its action", async () => {
    const insert = (id: string, action: string, targetType: string) => t.d1.prepare("INSERT INTO admin_audit_log (id, actor_google_sub, action, target_type, target_id) VALUES (?, 'admin-sub', ?, ?, 'target')").bind(id, action, targetType).run();
    await expect(insert("a2", "suspend", "course")).rejects.toThrow(/admin_audit_log_target_matches_action_check/);
    await insert("a3", "add_campus", "campus");
  });
});
