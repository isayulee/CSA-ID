import { eq } from "drizzle-orm";
import { publishedProfiles, users } from "@/lib/db/schema";
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
    profile: { slug: profile.slug, status: profile.status, displayName: profile.displayName, role: profile.role, bio: profile.bio, accentColor: profile.accentColor, appearance: profile.appearance, evaluationUrl: profile.evaluationUrl, studentNumber: profile.studentNumber, showStudentNumber: profile.showStudentNumber, createdAt: profile.createdAt, updatedAt: profile.updatedAt },
    socialLinks: links.map(({ service, url, displayOrder }) => ({ service, url, displayOrder })),
  };
}

async function deleteImages(kv: KVNamespace, profileId: string, known: Array<string | null>) {
  const keys = new Set(known.filter((key): key is string => Boolean(key)));
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: `img/${profileId}/`, cursor });
    for (const { name } of page.keys) keys.add(name);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  await Promise.all([...keys].map((key) => kv.delete(key)));
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
  const [published] = await db.select({ avatarKey: publishedProfiles.avatarKey, backgroundKey: publishedProfiles.backgroundKey }).from(publishedProfiles).where(eq(publishedProfiles.profileId, profile.id)).limit(1);
  await lifecycle.deleteAccount(db, userId, profile.id);
  try {
    await deleteImages(kv, profile.id, [profile.avatarKey, profile.backgroundKey, published?.avatarKey ?? null, published?.backgroundKey ?? null]);
  } catch (error) {
    console.error(`account deleted but images under img/${profile.id}/ were not`, error);
  }
  return { slug: profile.slug };
}
