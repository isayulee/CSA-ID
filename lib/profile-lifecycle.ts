import "server-only";
import { and, eq, exists, ne, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "@/lib/auth/session";
import { evaluationFormUrl, isCsaEvaluationForm } from "@/lib/evaluation-form";
import { adminAuditLog, draftSocialLinks, profiles, publishedProfiles, publishedSocialLinks, reservedSlugs, sessions, users, type AdminAuditAction, type Profile } from "@/lib/db/schema";

/**
 * Every Profile status change: publish, unpublish, suspend and account deletion.
 * Nothing outside this module writes `profiles.status` or the Published Profile
 * tables. Each change is one D1 batch, which D1 applies as one transaction.
 */

export type PublishResult = { ok: true; slug: string } | { ok: false; status: 400 | 403 | 409; error: string };

const unixNow = () => Math.floor(Date.now() / 1000);

// A Suspended Profile never comes back through any status change. These two
// conditions are the only place that rule is written.
const isSuspended = (profileId: string) => and(eq(profiles.id, profileId), eq(profiles.status, "suspended"));
const notSuspended = (profileId: string) => and(eq(profiles.id, profileId), ne(profiles.status, "suspended"));

const SUSPENDED = { ok: false, status: 403, error: "This profile is suspended" } as const;
const SLUG_TAKEN = { ok: false, status: 409, error: "That permanent profile address is already taken" } as const;

function snapshotDeleteStatements(db: Db, profileId: string) {
  return [
    db.delete(publishedSocialLinks).where(eq(publishedSocialLinks.profileId, profileId)),
    db.delete(publishedProfiles).where(eq(publishedProfiles.profileId, profileId)),
  ] as const;
}

function unpublishStatements(db: Db, profileId: string) {
  return [
    ...snapshotDeleteStatements(db, profileId),
    db.update(profiles).set({ status: "draft", updatedAt: unixNow() }).where(and(eq(profiles.id, profileId), eq(profiles.status, "published"))),
  ] as const;
}

/** Copies the Draft Profile and its Draft Social Links into a fresh Published Profile. `profile` is the owner's row from the validated Session. */
export async function publish(db: Db, profile: Profile): Promise<PublishResult> {
  if (!profile.slug || !profile.displayName || !profile.role) return { ok: false, status: 400, error: "Add a permanent address, name, and role before publishing" };
  if (profile.status === "suspended") return SUSPENDED;
  const evaluationUrl = profile.evaluationUrl || evaluationFormUrl;
  const usesCsaForm = isCsaEvaluationForm(evaluationUrl);
  if (usesCsaForm && !profile.studentNumber) return { ok: false, status: 400, error: "Add your student number before publishing with the CSA evaluation form" };
  if (profile.showStudentNumber && !profile.studentNumber) return { ok: false, status: 400, error: "Enter a student number or turn off its display before publishing" };
  const [reservation] = await db.select().from(reservedSlugs).where(eq(reservedSlugs.slug, profile.slug)).limit(1);
  if (reservation && reservation.profileId !== profile.id) return SLUG_TAKEN;
  const links = await db.select().from(draftSocialLinks).where(eq(draftSocialLinks.profileId, profile.id)).orderBy(draftSocialLinks.displayOrder);
  const now = unixNow();
  // An Administrator may suspend the Profile after the status check above. D1 has no
  // interactive transactions, so the batch repeats that check: the status stays
  // `suspended` and the snapshot just written is removed again.
  const setPublished = db.update(profiles).set({ status: "published", updatedAt: now }).where(notSuspended(profile.id));
  const queries: BatchItem<"sqlite">[] = [
    db.insert(reservedSlugs).values({ slug: profile.slug, profileId: profile.id, createdAt: now }).onConflictDoNothing(),
    ...snapshotDeleteStatements(db, profile.id),
    db.insert(publishedProfiles).values({ profileId: profile.id, slug: profile.slug, displayName: profile.displayName, role: profile.role, bio: profile.bio, accentColor: profile.accentColor, appearance: profile.appearance, avatarKey: profile.avatarKey, backgroundKey: profile.backgroundKey, evaluationUrl, studentNumber: usesCsaForm || profile.showStudentNumber ? profile.studentNumber : null, showStudentNumber: profile.showStudentNumber, publishedAt: now }),
    ...links.map((link) => db.insert(publishedSocialLinks).values({ id: crypto.randomUUID(), profileId: profile.id, service: link.service, url: link.url, displayOrder: link.displayOrder })),
    setPublished,
    db.delete(publishedProfiles).where(and(eq(publishedProfiles.profileId, profile.id), exists(db.select({ id: profiles.id }).from(profiles).where(isSuspended(profile.id))))),
  ];
  let results: unknown[];
  try { results = await db.batch(queries as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]); }
  catch { return SLUG_TAKEN; }
  const statusUpdate = results[queries.indexOf(setPublished)] as D1Result;
  if (!statusUpdate.meta.changes) return SUSPENDED;
  return { ok: true, slug: profile.slug };
}

/** Removes the Published Profile and sets the status back to draft. The Draft Profile is untouched, and a Suspended Profile stays suspended. */
export async function unpublish(db: Db, profileId: string) {
  await db.batch(unpublishStatements(db, profileId));
}

/**
 * Removes the Published Profile, sets the status to `suspended` and writes the
 * audit entry. Ownership and the reserved Slug stay. Returns false, writing
 * nothing, when the Profile is already suspended.
 */
export async function suspend(db: Db, profileId: string, audit: { actorGoogleSub: string; reason: string }) {
  // D1 runs batches one at a time. The audit entry is written first and only while
  // the Profile is not yet suspended, so when two suspensions race, the second one
  // writes nothing instead of adding a second entry.
  const [entry] = await db.batch([
    db.insert(adminAuditLog).select(db.select({
      id: sql<string>`${crypto.randomUUID()}`.as("id"),
      actorGoogleSub: sql<string>`${audit.actorGoogleSub}`.as("actor_google_sub"),
      action: sql<AdminAuditAction>`'suspend'`.as("action"),
      targetProfileId: profiles.id,
      targetSlug: profiles.slug,
      reason: sql<string>`${audit.reason}`.as("reason"),
      createdAt: sql<number>`unixepoch()`.as("created_at"),
    }).from(profiles).where(notSuspended(profileId))),
    ...snapshotDeleteStatements(db, profileId),
    db.update(profiles).set({ status: "suspended", updatedAt: unixNow() }).where(notSuspended(profileId)),
  ]);
  return entry.meta.changes > 0;
}

/** Clears the image keys on the Draft Profile and its Published Profile and writes the audit entry. */
export async function clearImageKeys(db: Db, profile: { id: string; slug: string | null }, audit: { actorGoogleSub: string; reason: string }) {
  await db.batch([
    db.update(profiles).set({ avatarKey: null, backgroundKey: null }).where(eq(profiles.id, profile.id)),
    db.update(publishedProfiles).set({ avatarKey: null, backgroundKey: null }).where(eq(publishedProfiles.profileId, profile.id)),
    db.insert(adminAuditLog).values({ id: crypto.randomUUID(), actorGoogleSub: audit.actorGoogleSub, action: "remove_images", targetProfileId: profile.id, targetSlug: profile.slug, reason: audit.reason }),
  ]);
}

/**
 * Deletes the User's account. Deleting the user row cascades to the Profile,
 * Draft Social Links and Sessions, and `reserved_slugs` keeps the Slug with its
 * profile_id cleared. A failure leaves the account exactly as it was.
 */
export async function deleteAccount(db: Db, userId: string, profileId: string) {
  await db.batch([
    ...unpublishStatements(db, profileId),
    db.delete(sessions).where(eq(sessions.userId, userId)),
    db.delete(users).where(eq(users.id, userId)),
  ]);
}
