import { NextResponse } from "next/server";
import { and, eq, exists, ne } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getCurrentAccount } from "@/lib/auth/current-user";
import { guardMutation } from "@/lib/http/mutation-guard";
import { getDb } from "@/lib/db";
import { purgeProfilePage } from "@/lib/edge-cache";
import { draftSocialLinks, profiles, publishedProfiles, publishedSocialLinks, reservedSlugs } from "@/lib/db/schema";

export async function POST(request: Request) {
  const guard = await guardMutation(request, getCurrentAccount, { body: false });
  if (!guard.ok) return guard.response;
  const profile = guard.account.profile;
  if (!profile.slug || !profile.displayName || !profile.role || !profile.evaluationUrl) return NextResponse.json({ error: "Add a permanent address, name, role, and evaluation form before publishing" }, { status: 400 });
  if (profile.status === "suspended") return NextResponse.json({ error: "This profile is suspended" }, { status: 403 });
  const db = getDb();
  const [reservation] = await db.select().from(reservedSlugs).where(eq(reservedSlugs.slug, profile.slug)).limit(1);
  if (reservation && reservation.profileId !== profile.id) return NextResponse.json({ error: "That permanent profile address is already taken" }, { status: 409 });
  const links = await db.select().from(draftSocialLinks).where(eq(draftSocialLinks.profileId, profile.id)).orderBy(draftSocialLinks.displayOrder);
  const now = Math.floor(Date.now() / 1000);
  // An Administrator may suspend the Profile after the status check above. D1 has no
  // interactive transactions, so the batch repeats that check: the status stays
  // `suspended` and the snapshot just written is removed again.
  const setPublished = db.update(profiles).set({ status: "published", updatedAt: now }).where(and(eq(profiles.id, profile.id), ne(profiles.status, "suspended")));
  const queries: BatchItem<"sqlite">[] = [
    db.insert(reservedSlugs).values({ slug: profile.slug, profileId: profile.id, createdAt: now }).onConflictDoNothing(),
    db.delete(publishedSocialLinks).where(eq(publishedSocialLinks.profileId, profile.id)),
    db.delete(publishedProfiles).where(eq(publishedProfiles.profileId, profile.id)),
    db.insert(publishedProfiles).values({ profileId: profile.id, slug: profile.slug, displayName: profile.displayName, role: profile.role, bio: profile.bio, accentColor: profile.accentColor, avatarKey: profile.avatarKey, backgroundKey: profile.backgroundKey, evaluationUrl: profile.evaluationUrl, publishedAt: now }),
    ...links.map((link) => db.insert(publishedSocialLinks).values({ id: crypto.randomUUID(), profileId: profile.id, service: link.service, url: link.url, displayOrder: link.displayOrder })),
    setPublished,
    db.delete(publishedProfiles).where(and(eq(publishedProfiles.profileId, profile.id), exists(db.select({ id: profiles.id }).from(profiles).where(and(eq(profiles.id, profile.id), eq(profiles.status, "suspended")))))),
  ];
  let results: unknown[];
  try { results = await db.batch(queries as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]); }
  catch { return NextResponse.json({ error: "That permanent profile address is already taken" }, { status: 409 }); }
  const statusUpdate = results[queries.indexOf(setPublished)] as D1Result;
  if (!statusUpdate.meta.changes) return NextResponse.json({ error: "This profile is suspended" }, { status: 403 });
  await purgeProfilePage(profile.slug, request.url);
  return NextResponse.json({ ok: true, slug: profile.slug });
}
