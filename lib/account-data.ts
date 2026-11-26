import "server-only";
import { eq } from "drizzle-orm";
import { users } from "@/lib/db/schema";
import { deleteAllImages, keysInUse } from "@/lib/images/profile-images";
import { readDraft } from "@/lib/profile-data";
import type { Db } from "@/lib/auth/session";
import * as lifecycle from "@/lib/profile-lifecycle";

export async function exportAccount(db: Db, userId: string, now = new Date()) {
  const draft = await readDraft(db, userId);
  if (!draft) return null;
  const { profile, links } = draft;
  const [user] = await db.select({ name: users.name, email: users.email, createdAt: users.createdAt }).from(users).where(eq(users.id, userId)).limit(1);
  return {
    exportedAt: now.toISOString(),
    account: user,
    profile: { slug: profile.slug, status: profile.status, displayName: profile.displayName, roleTitle: profile.roleTitle, bio: profile.bio, accentColor: profile.accentColor, iconColor: profile.iconColor, cardColor: profile.cardColor, cardOpacity: profile.cardOpacity, cardFrosted: profile.cardFrosted, evaluationUrl: profile.evaluationUrl, studentNumber: profile.studentNumber, showStudentNumber: profile.showStudentNumber, createdAt: profile.createdAt, updatedAt: profile.updatedAt },
    socialLinks: links.map(({ service, url, displayOrder }) => ({ service, url, displayOrder })),
  };
}

/**
 * The D1 rows go in one batch (see the Profile lifecycle module), so a failure
 * leaves the account exactly as it was and the User can retry.
 *
 * KV cannot join that transaction, so images go only after the account is gone.
 * If that fails the account is still deleted; the leftover keys sit under
 * unguessable `img/<profileId>/` paths and are logged for cleanup.
 */
export async function deleteAccount(db: Db, kv: KVNamespace, userId: string) {
  const draft = await readDraft(db, userId);
  if (!draft) return null;
  const { profile } = draft;
  const images = await keysInUse(db, profile);
  await lifecycle.deleteUser(db, userId, profile.id);
  try {
    await deleteAllImages(kv, profile.id, images);
  } catch (error) {
    console.error(`account deleted but images under img/${profile.id}/ were not`, error);
  }
  return { slug: profile.slug };
}
