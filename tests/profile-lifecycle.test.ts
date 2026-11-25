import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { draftSocialLinks, profiles, publishedProfiles, publishedSocialLinks, reservedSlugs, users, type Profile } from "@/lib/db/schema";
import { loadPublishedProfile } from "@/lib/public/published-profile";
import { publish, suspend } from "@/lib/profile-lifecycle";
import { createTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;

async function seed(id: string, values: Partial<Profile> = {}) {
  await t.db.insert(users).values({ id: `u-${id}`, googleSub: `sub-${id}`, email: `${id}@example.test` });
  const [profile] = await t.db.insert(profiles).values({ id, userId: `u-${id}`, slug: id, displayName: id, role: "Peer Adviser", evaluationUrl: "https://forms.example/e", ...values }).returning();
  return profile;
}

const statusOf = async (id: string) => (await t.db.select({ status: profiles.status }).from(profiles).where(eq(profiles.id, id)))[0].status;
const snapshotOf = async (id: string) => (await t.db.select().from(publishedProfiles).where(eq(publishedProfiles.profileId, id)))[0];

beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.dispose());

describe("publish", () => {
  it("copies the Draft Profile and its Draft Social Links into the Published Profile and reserves the Slug", async () => {
    const profile = await seed("ana", { bio: "Hello", studentNumber: "2020123456" });
    await t.db.insert(draftSocialLinks).values([
      { id: "ana-2", profileId: "ana", service: "website", url: "https://ana.example", displayOrder: 1 },
      { id: "ana-1", profileId: "ana", service: "github", url: "https://github.com/ana", displayOrder: 0 },
    ]);

    expect(await publish(t.db, profile)).toEqual({ ok: true, slug: "ana" });

    expect(await statusOf("ana")).toBe("published");
    const published = await loadPublishedProfile(t.db, "ana");
    expect(published).toMatchObject({ displayName: "ana", role: "Peer Adviser", bio: "Hello", evaluationUrl: "https://forms.example/e", studentNumber: null });
    expect(published?.links).toEqual([{ service: "github", url: "https://github.com/ana" }, { service: "website", url: "https://ana.example" }]);
    expect(await t.db.select().from(reservedSlugs).where(eq(reservedSlugs.slug, "ana"))).toMatchObject([{ profileId: "ana" }]);
  });

  it("replaces the previous Published Profile on a second publish", async () => {
    const [profile] = await t.db.update(profiles).set({ bio: "Updated" }).where(eq(profiles.id, "ana")).returning();
    await t.db.delete(draftSocialLinks).where(eq(draftSocialLinks.id, "ana-2"));

    expect((await publish(t.db, profile)).ok).toBe(true);

    expect((await snapshotOf("ana")).bio).toBe("Updated");
    expect(await t.db.select().from(publishedSocialLinks).where(eq(publishedSocialLinks.profileId, "ana"))).toHaveLength(1);
  });

  it("refuses a Profile without a Slug, name or role, and publishes nothing", async () => {
    const profile = await seed("noslug", { slug: null });
    expect(await publish(t.db, profile)).toEqual({ ok: false, status: 400, error: "Add a permanent address, name, and role before publishing" });
    expect(await publish(t.db, { ...profile, slug: "noslug", role: "" })).toMatchObject({ ok: false, status: 400 });
    expect(await snapshotOf("noslug")).toBeUndefined();
    expect(await statusOf("noslug")).toBe("draft");
  });

  it("refuses the CSA evaluation form, or a shown student number, without a student number", async () => {
    const csa = await seed("csa", { evaluationUrl: null });
    expect(await publish(t.db, csa)).toEqual({ ok: false, status: 400, error: "Add your student number before publishing with the CSA evaluation form" });
    const shown = await seed("shown", { showStudentNumber: true });
    expect(await publish(t.db, shown)).toEqual({ ok: false, status: 400, error: "Enter a student number or turn off its display before publishing" });
  });

  it("refuses a Suspended Profile", async () => {
    const profile = await seed("banned", { status: "suspended" });
    expect(await publish(t.db, profile)).toEqual({ ok: false, status: 403, error: "This profile is suspended" });
    expect(await snapshotOf("banned")).toBeUndefined();
  });

  it("refuses a Slug another Profile has reserved", async () => {
    await seed("owner", { slug: null });
    await t.db.insert(reservedSlugs).values({ slug: "taken", profileId: "owner", createdAt: 0 });
    const profile = await seed("late", { slug: "taken" });
    expect(await publish(t.db, profile)).toEqual({ ok: false, status: 409, error: "That permanent profile address is already taken" });
    expect(await snapshotOf("late")).toBeUndefined();
  });

  it("keeps a Profile suspended when an Administrator suspends it while the publish is under way", async () => {
    const profile = await seed("racer");
    expect(await suspend(t.db, "racer", { actorGoogleSub: "admin", reason: "abuse" })).toBe(true);

    // `profile` was read before the suspension, so it still says draft.
    expect(await publish(t.db, profile)).toEqual({ ok: false, status: 403, error: "This profile is suspended" });

    expect(await statusOf("racer")).toBe("suspended");
    expect(await snapshotOf("racer")).toBeUndefined();
  });
});
