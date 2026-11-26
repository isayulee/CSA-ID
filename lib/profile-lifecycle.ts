import "server-only";
import { and, eq, exists, ne, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "@/lib/auth/session";
import { evaluationFormUrl, isCsaEvaluationForm } from "@/lib/evaluation-form";
import { adminAuditLog, draftSocialLinks, profiles, publishedProfiles, publishedSocialLinks, sessions, users, type AdminAuditAction, type AdminAuditTarget, type Profile } from "@/lib/db/schema";

/**
 * Every Profile status change: publish, unpublish, suspend and deleting a User.
 * It is the only writer of `profiles.status` and the Published Profile tables,
 * so the Administrator's image removal clears its keys here too. Each change is
 * one D1 batch, which D1 applies as one transaction.
 */

/** Who asked for an Administrator action, and why. Written to the audit log. */
export type AuditNote = { actorGoogleSub: string; reason: string };

export type PublishResult = { ok: true; slug: string } | { ok: false; status: 400 | 403; error: string };

const unixNow = () => Math.floor(Date.now() / 1000);

// A Suspended Profile never comes back: publish and suspend guard their writes
// with these two conditions, and unpublish only moves a `published` Profile.
const isSuspended = (profileId: string) => and(eq(profiles.id, profileId), eq(profiles.status, "suspended"));
const notSuspended = (profileId: string) => and(eq(profiles.id, profileId), ne(profiles.status, "suspended"));

const SUSPENDED = { ok: false, status: 403, error: "This profile is suspended" } as const;

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

/**
 * Copies the Draft Profile and its Draft Social Links into a fresh Published Profile.
 * `profile` is the owner's row from the validated Session. Its Slug is already
 * reserved: `profiles.slug` references `reserved_slugs` and is unique.
 */
export async function publish(db: Db, profile: Profile): Promise<PublishResult> {
  if (!profile.slug || !profile.displayName || !profile.roleTitle) return { ok: false, status: 400, error: "Add a permanent address, name, and role before publishing" };
  if (profile.status === "suspended") return SUSPENDED;
  const evaluationUrl = profile.evaluationUrl || evaluationFormUrl;
  const usesCsaForm = isCsaEvaluationForm(evaluationUrl);
  if (usesCsaForm && !profile.studentNumber) return { ok: false, status: 400, error: "Add your student number before publishing with the CSA evaluation form" };
  if (profile.showStudentNumber && !profile.studentNumber) return { ok: false, status: 400, error: "Enter a student number or turn off its display before publishing" };
  const links = await db.select().from(draftSocialLinks).where(eq(draftSocialLinks.profileId, profile.id)).orderBy(draftSocialLinks.displayOrder);
  const now = unixNow();
  // An Administrator may suspend the Profile after the status check above. D1 has no
  // interactive transactions, so the batch repeats that check: the status stays
  // `suspended` and the snapshot just written is removed again.
  const setPublished = db.update(profiles).set({ status: "published", updatedAt: now }).where(notSuspended(profile.id));
  const queries: BatchItem<"sqlite">[] = [
    ...snapshotDeleteStatements(db, profile.id),
    db.insert(publishedProfiles).values({ profileId: profile.id, slug: profile.slug, displayName: profile.displayName, roleTitle: profile.roleTitle, bio: profile.bio, accentColor: profile.accentColor, iconColor: profile.iconColor, cardColor: profile.cardColor, cardOpacity: profile.cardOpacity, cardFrosted: profile.cardFrosted, avatarKey: profile.avatarKey, backgroundKey: profile.backgroundKey, evaluationUrl, studentNumber: usesCsaForm || profile.showStudentNumber ? profile.studentNumber : null, showStudentNumber: profile.showStudentNumber, publishedAt: now }),
    ...links.map((link) => db.insert(publishedSocialLinks).values({ id: crypto.randomUUID(), profileId: profile.id, service: link.service, url: link.url, displayOrder: link.displayOrder })),
    setPublished,
    db.delete(publishedProfiles).where(and(eq(publishedProfiles.profileId, profile.id), exists(db.select({ id: profiles.id }).from(profiles).where(isSuspended(profile.id))))),
  ];
  const results = await db.batch(queries as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
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
export async function suspend(db: Db, profileId: string, audit: AuditNote) {
  // D1 runs batches one at a time. The audit entry is written first and only while
  // the Profile is not yet suspended, so when two suspensions race, the second one
  // writes nothing instead of adding a second entry. The fields follow the table's
  // column order, because an INSERT ... SELECT lists every column.
  const [entry] = await db.batch([
    db.insert(adminAuditLog).select(db.select({
      id: sql<string>`${crypto.randomUUID()}`.as("id"),
      actorGoogleSub: sql<string>`${audit.actorGoogleSub}`.as("actor_google_sub"),
      action: sql<AdminAuditAction>`'suspend'`.as("action"),
      targetType: sql<AdminAuditTarget>`'profile'`.as("target_type"),
      targetId: profiles.id,
      targetLabel: sql<string>`coalesce(${profiles.slug}, '')`.as("target_label"),
      reason: sql<string>`${audit.reason}`.as("reason"),
      createdAt: sql<number>`unixepoch()`.as("created_at"),
    }).from(profiles).where(notSuspended(profileId))),
    ...snapshotDeleteStatements(db, profileId),
    db.update(profiles).set({ status: "suspended", updatedAt: unixNow() }).where(notSuspended(profileId)),
  ]);
  return entry.meta.changes > 0;
}

/** Clears the image keys on the Draft Profile and its Published Profile and writes the audit entry. */
export async function clearImageKeys(db: Db, profile: { id: string; slug: string | null }, audit: AuditNote) {
  await db.batch([
    db.update(profiles).set({ avatarKey: null, backgroundKey: null }).where(eq(profiles.id, profile.id)),
    db.update(publishedProfiles).set({ avatarKey: null, backgroundKey: null }).where(eq(publishedProfiles.profileId, profile.id)),
    db.insert(adminAuditLog).values({ id: crypto.randomUUID(), actorGoogleSub: audit.actorGoogleSub, action: "remove_images", targetType: "profile", targetId: profile.id, targetLabel: profile.slug ?? "", reason: audit.reason }),
  ]);
}

/**
 * Deletes the User. Deleting the user row cascades to the Profile,
 * Draft Social Links and Sessions, and `reserved_slugs` keeps the Slug.
 * A failure leaves the account exactly as it was.
 */
export async function deleteUser(db: Db, userId: string, profileId: string) {
  await db.batch([
    ...unpublishStatements(db, profileId),
    db.delete(sessions).where(eq(sessions.userId, userId)),
    db.delete(users).where(eq(users.id, userId)),
  ]);
}
