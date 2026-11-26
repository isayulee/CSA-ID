import { and, eq } from "drizzle-orm";
import "server-only";
import type { BatchItem } from "drizzle-orm/batch";
import { draftSocialLinks, profiles, publishedProfiles, publishedSocialLinks, reservedSlugs } from "@/lib/db/schema";
import { evaluationFormUrl, isCsaEvaluationForm } from "@/lib/evaluation-form";
import { defaultAppearance } from "@/lib/profile-appearance";
import type { Db } from "@/lib/auth/session";
import { checkSlug, type ProfileInput } from "@/lib/profile-validation";

/** Owner-scoped access: every function takes the signed-in user's id and filters by it. */

export async function readDraft(db: Db, userId: string) {
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!profile) return null;
  const links = await db.select().from(draftSocialLinks).where(eq(draftSocialLinks.profileId, profile.id)).orderBy(draftSocialLinks.displayOrder);
  return { profile, links };
}

export async function readProfileEditor(db: Db, userId: string) {
  const draft = await readDraft(db, userId);
  if (!draft) return null;
  const { profile, links } = draft;
  if (profile.status !== "published") return { ...draft, hasUnpublishedChanges: false };

  const owner = and(eq(profiles.id, profile.id), eq(profiles.userId, userId));
  const [[published], publicLinks] = await db.batch([
    db.select({ snapshot: publishedProfiles }).from(publishedProfiles)
      .innerJoin(profiles, eq(publishedProfiles.profileId, profiles.id)).where(owner),
    db.select({ service: publishedSocialLinks.service, url: publishedSocialLinks.url })
      .from(publishedSocialLinks).innerJoin(profiles, eq(publishedSocialLinks.profileId, profiles.id))
      .where(owner).orderBy(publishedSocialLinks.displayOrder),
  ]);
  if (!published) return { ...draft, hasUnpublishedChanges: true };

  const snapshot = published.snapshot;
  const evaluationUrl = profile.evaluationUrl || evaluationFormUrl;
  const studentNumber = profile.showStudentNumber || isCsaEvaluationForm(evaluationUrl) ? profile.studentNumber : null;
  const appearance = profile.appearance ?? defaultAppearance;
  const publicAppearance = snapshot.appearance ?? defaultAppearance;
  const hasUnpublishedChanges =
    profile.displayName !== snapshot.displayName || profile.role !== snapshot.role ||
    profile.bio !== snapshot.bio || profile.accentColor.toLowerCase() !== snapshot.accentColor.toLowerCase() ||
    profile.avatarKey !== snapshot.avatarKey || profile.backgroundKey !== snapshot.backgroundKey ||
    evaluationUrl !== snapshot.evaluationUrl || studentNumber !== snapshot.studentNumber ||
    profile.showStudentNumber !== snapshot.showStudentNumber ||
    appearance.iconColor.toLowerCase() !== publicAppearance.iconColor.toLowerCase() ||
    appearance.cardColor.toLowerCase() !== publicAppearance.cardColor.toLowerCase() ||
    appearance.cardOpacity !== publicAppearance.cardOpacity || appearance.frosted !== publicAppearance.frosted ||
    links.length !== publicLinks.length || links.some((link, index) =>
      link.service !== publicLinks[index]?.service || link.url !== publicLinks[index]?.url
    );
  return { ...draft, hasUnpublishedChanges };
}

export async function saveDraft(db: Db, userId: string, input: ProfileInput) {
  const [profile] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!profile) return false;
  const update = db.update(profiles).set({ displayName: input.displayName, role: input.role, bio: input.bio, accentColor: input.accentColor.toUpperCase(), appearance: input.appearance, evaluationUrl: input.evaluationUrl || null, showStudentNumber: input.showStudentNumber, studentNumber: input.studentNumber === undefined ? undefined : input.studentNumber || null, updatedAt: Math.floor(Date.now() / 1000) }).where(and(eq(profiles.id, profile.id), eq(profiles.userId, userId)));
  const removeLinks = db.delete(draftSocialLinks).where(eq(draftSocialLinks.profileId, profile.id));
  const inserts = input.links.map((link, index) => db.insert(draftSocialLinks).values({ id: crypto.randomUUID(), profileId: profile.id, service: link.service, url: link.url, displayOrder: index }));
  await db.batch([update, removeLinks, ...inserts] as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return true;
}

export type ClaimResult =
  | { ok: true; slug: string }
  | { ok: false; status: 400 | 404 | 409; message: string };

export async function claimSlug(db: Db, userId: string, rawSlug: unknown): Promise<ClaimResult> {
  const checked = checkSlug(rawSlug);
  if (!checked.ok) return { ok: false, status: 400, message: checked.message };
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!profile) return { ok: false, status: 404, message: "Profile not found" };
  if (profile.slug) {
    return profile.slug === checked.slug
      ? { ok: true, slug: profile.slug }
      : { ok: false, status: 409, message: "Your permanent address is already chosen and cannot be changed" };
  }
  const now = Math.floor(Date.now() / 1000);
  try {
    await db.batch([
      db.insert(reservedSlugs).values({ slug: checked.slug, profileId: profile.id, createdAt: now }),
      db.update(profiles).set({ slug: checked.slug, updatedAt: now }).where(and(eq(profiles.id, profile.id), eq(profiles.userId, userId))),
    ]);
  } catch {
    const [after] = await db.select({ slug: profiles.slug }).from(profiles).where(eq(profiles.id, profile.id)).limit(1);
    if (after?.slug === checked.slug) return { ok: true, slug: checked.slug };
    return { ok: false, status: 409, message: "That address is already taken. Please choose another" };
  }
  return { ok: true, slug: checked.slug };
}
