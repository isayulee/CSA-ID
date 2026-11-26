import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { campuses, profiles, reservedSlugs, users } from "@/lib/db/schema";
import { createTestDb } from "./helpers";

// What migrations/0000 adds beyond the Drizzle schema: the hand-written triggers and
// seed rows, and the constraints the app relies on instead of checking in code.
// The admin_audit_log triggers are tested in admin.test.ts.

let t: Awaited<ReturnType<typeof createTestDb>>;

async function seedProfile(id: string, values: Partial<typeof profiles.$inferInsert> = {}) {
  await t.db.insert(users).values({ id: `u-${id}`, googleSub: `sub-${id}`, email: `${id}@example.test`, name: id });
  await t.db.insert(profiles).values({ id, userId: `u-${id}`, displayName: id, ...values });
}

const run = (query: string, ...params: unknown[]) => t.d1.prepare(query).bind(...params).run();
const profileRow = async (id: string) => (await t.db.select().from(profiles).where(eq(profiles.id, id)))[0];

beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.dispose());

describe("profiles_updated_at trigger", () => {
  it("stamps updated_at on every Profile update, even one that does not set it", async () => {
    await seedProfile("stamp", { createdAt: 0, updatedAt: 0 });
    await run("UPDATE profiles SET bio = 'Changed' WHERE id = ?", "stamp");
    const row = await profileRow("stamp");
    expect(row.updatedAt).toBeGreaterThan(Math.floor(Date.now() / 1000) - 60);
    expect(row.createdAt).toBe(0);
  });
});

describe("profiles_slug_immutable trigger", () => {
  it("lets a Slug be chosen once and never changed or cleared", async () => {
    await t.db.insert(reservedSlugs).values([{ slug: "first-choice" }, { slug: "second-choice" }]);
    await seedProfile("fixed");
    await run("UPDATE profiles SET slug = ? WHERE id = ?", "first-choice", "fixed");
    await expect(run("UPDATE profiles SET slug = ? WHERE id = ?", "second-choice", "fixed")).rejects.toThrow(/profile slug is permanent/);
    await expect(run("UPDATE profiles SET slug = NULL WHERE id = ?", "fixed")).rejects.toThrow(/profile slug is permanent/);
    await run("UPDATE profiles SET slug = ?, bio = 'Same Slug' WHERE id = ?", "first-choice", "fixed");
    expect(await profileRow("fixed")).toMatchObject({ slug: "first-choice", bio: "Same Slug" });
  });
});

describe("Slug ownership", () => {
  it("gives a Profile only a reserved Slug, and each Slug to one Profile", async () => {
    await seedProfile("holder");
    await expect(run("UPDATE profiles SET slug = 'never-reserved' WHERE id = 'holder'")).rejects.toThrow(/FOREIGN KEY/);
    await t.db.insert(reservedSlugs).values({ slug: "only-one" });
    await run("UPDATE profiles SET slug = 'only-one' WHERE id = 'holder'");
    await seedProfile("second");
    await expect(run("UPDATE profiles SET slug = 'only-one' WHERE id = 'second'")).rejects.toThrow(/UNIQUE/);
  });

  it("keeps the reservation when the Profile's User is deleted", async () => {
    await t.db.insert(reservedSlugs).values({ slug: "outlives-user" });
    await seedProfile("leaver", { slug: "outlives-user" });
    await t.db.delete(users).where(eq(users.id, "u-leaver"));
    expect(await profileRow("leaver")).toBeUndefined();
    expect(await t.db.select().from(reservedSlugs).where(eq(reservedSlugs.slug, "outlives-user"))).toHaveLength(1);
  });
});

describe("card style columns", () => {
  it("are all set or all empty", async () => {
    await seedProfile("styled", { iconColor: "#112233", cardColor: "#FFFFFF", cardOpacity: 90, cardFrosted: false });
    await seedProfile("plain");
    await expect(run("UPDATE profiles SET icon_color = '#000000' WHERE id = 'plain'")).rejects.toThrow(/profiles_card_style_check/);
    await expect(run("UPDATE profiles SET card_opacity = NULL WHERE id = 'styled'")).rejects.toThrow(/profiles_card_style_check/);
  });
});

describe("Campus seed rows", () => {
  it("start the Campus list with Intramuros and Makati", async () => {
    expect(await t.db.select({ id: campuses.id, name: campuses.name }).from(campuses).orderBy(campuses.id)).toEqual([
      { id: "intramuros", name: "Intramuros" },
      { id: "makati", name: "Makati" },
    ]);
  });
});
