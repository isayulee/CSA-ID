import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { prepareSignIn } from "@/lib/auth/sign-in-landing";
import { claimSlug } from "@/lib/profile-data";
import { profiles, users } from "@/lib/db/schema";
import { createTestDb } from "./helpers";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;
let t: TestDb;

async function addUser(id: string) {
  await t.db.insert(users).values({ id, googleSub: `sub-${id}`, email: `${id}@example.test`, name: id });
}

beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.dispose());

describe("prepareSignIn", () => {
  it("creates the Profile of a new User and lands on the setup wizard", async () => {
    await addUser("new");
    expect(await prepareSignIn(t.db, "new", { displayName: "New User" })).toBe("/dashboard/setup");
    const rows = await t.db.select().from(profiles).where(eq(profiles.userId, "new"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ displayName: "New User", slug: null });
  });

  it("keeps landing on the wizard while the Profile has no Slug", async () => {
    await addUser("skipper");
    await prepareSignIn(t.db, "skipper", { displayName: "Skipper" });
    await t.db.update(profiles).set({ roleTitle: "Peer Adviser" }).where(eq(profiles.userId, "skipper"));
    expect(await prepareSignIn(t.db, "skipper", { displayName: "Ignored" })).toBe("/dashboard/setup");
    const rows = await t.db.select().from(profiles).where(eq(profiles.userId, "skipper"));
    expect(rows).toHaveLength(1);
    expect(rows[0].displayName).toBe("Skipper");
  });

  it("lands on the dashboard once the User has claimed a Slug", async () => {
    await addUser("claimed");
    await prepareSignIn(t.db, "claimed", { displayName: "Claimed" });
    expect(await claimSlug(t.db, "claimed", "claimed-user")).toMatchObject({ ok: true });
    expect(await prepareSignIn(t.db, "claimed", { displayName: "Claimed" })).toBe("/dashboard");
  });

  it("decides by the signed-in User's own Profile only", async () => {
    await addUser("other");
    expect(await prepareSignIn(t.db, "other", { displayName: "Other" })).toBe("/dashboard/setup");
  });
});
