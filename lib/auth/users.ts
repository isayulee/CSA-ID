import { eq } from "drizzle-orm";
import { users } from "@/lib/db/schema";
import type { GoogleIdentity } from "./google";
import type { Db } from "./session";

/**
 * Finds the User by Google subject ID, or creates one. The sign-in page says that
 * continuing confirms the User is at least 18, so creating the account records that
 * time in `age_confirmed_at`. Email and name are refreshed on every sign-in.
 */
export async function findOrCreateUser(db: Db, identity: GoogleIdentity, now = Math.floor(Date.now() / 1000)) {
  const name = (identity.name?.trim() || identity.email.split("@")[0]).slice(0, 128);
  await db
    .insert(users)
    .values({ id: crypto.randomUUID(), googleSub: identity.sub, email: identity.email, name, ageConfirmedAt: now, createdAt: now })
    .onConflictDoUpdate({ target: users.googleSub, set: { email: identity.email, name } });
  const [user] = await db.select().from(users).where(eq(users.googleSub, identity.sub));
  return user;
}
