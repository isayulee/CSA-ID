import "server-only";
import { eq } from "drizzle-orm";
import { profiles } from "@/lib/db/schema";
import type { Db } from "./session";

export const setupWizardPath = "/dashboard/setup";
export type SignInLanding = "/dashboard" | typeof setupWizardPath;

type NewProfile = Pick<typeof profiles.$inferInsert, "displayName" | "roleTitle" | "bio">;

/**
 * Creates the User's Profile on first sign-in and picks where sign-in lands. A User
 * without a Slug lands on the setup wizard, so the wizard comes back at every
 * sign-in until a Slug is claimed. Claiming a Slug is what "setup done" means.
 */
export async function prepareSignIn(db: Db, userId: string, newProfile: NewProfile): Promise<SignInLanding> {
  const [profile] = await db.select({ slug: profiles.slug }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!profile) await db.insert(profiles).values({ id: crypto.randomUUID(), userId, ...newProfile });
  return profile?.slug ? "/dashboard" : setupWizardPath;
}
