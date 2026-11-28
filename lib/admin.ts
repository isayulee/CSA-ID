import "server-only";
import { desc, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { z } from "zod";
import * as schema from "@/lib/db/schema";
import { removeImages } from "@/lib/images/profile-images";
import * as lifecycle from "@/lib/profile-lifecycle";

type Db = DrizzleD1Database<typeof schema>;

/** What every Administrator function needs. `adminSubs` is the ADMIN_GOOGLE_SUBS Worker secret. */
export type AdminDeps = {
  db: Db;
  kv: Pick<KVNamespace, "delete">;
  adminSubs: string | undefined;
};

/** The signed-in User asking for an administrative action. */
export type Actor = Pick<schema.User, "id" | "googleSub">;

export type AdminResult<B = { ok: true; slug: string | null }> = { status: number; body: B | { error: string } };

const fail = (status: number, error: string) => ({ status, body: { error } });

/** Administrator rights come only from the server-side allowlist of Google subject IDs. */
export function isAdministrator(actor: Pick<schema.User, "googleSub"> | null | undefined, adminSubs: string | undefined) {
  if (!actor || !adminSubs) return false;
  return adminSubs.split(",").map((sub) => sub.trim()).filter(Boolean).includes(actor.googleSub);
}

const adminActionInput = z.object({
  profileId: z.string().min(1).max(64),
  reason: z.string().trim().min(1).max(1000),
});

async function loadTarget(db: Db, profileId: string) {
  const [profile] = await db.select({ id: schema.profiles.id, slug: schema.profiles.slug, status: schema.profiles.status, avatarKey: schema.profiles.avatarKey, backgroundKey: schema.profiles.backgroundKey })
    .from(schema.profiles).where(eq(schema.profiles.id, profileId)).limit(1);
  return profile ?? null;
}

export type OpenReport = {
  id: string;
  reason: string;
  details: string;
  createdAt: number;
  profileId: string | null;
  slug: string | null;
  displayName: string | null;
  profileStatus: schema.Profile["status"] | null;
};

const OPEN_REPORTS_LIMIT = 200;

/** Open Abuse Reports, newest first, with the reported Profile (null once its account is deleted). */
export async function listOpenReports(deps: AdminDeps, actor: Actor): Promise<AdminResult<{ reports: OpenReport[] }>> {
  if (!isAdministrator(actor, deps.adminSubs)) return fail(401, "Unauthorized");
  const { abuseReports, profiles } = schema;
  const reports = await deps.db.select({
    id: abuseReports.id,
    reason: abuseReports.reason,
    details: abuseReports.details,
    createdAt: abuseReports.createdAt,
    profileId: abuseReports.profileId,
    slug: abuseReports.slug,
    displayName: profiles.displayName,
    profileStatus: profiles.status,
  }).from(abuseReports).leftJoin(profiles, eq(profiles.id, abuseReports.profileId))
    .where(eq(abuseReports.status, "open")).orderBy(desc(abuseReports.createdAt)).limit(OPEN_REPORTS_LIMIT);
  return { status: 200, body: { reports } };
}

/** Removes a Profile's public images through the Profile image module, which explains the order. */
export async function removeProfileImages(deps: AdminDeps, actor: Actor, raw: unknown): Promise<AdminResult> {
  if (!isAdministrator(actor, deps.adminSubs)) return fail(401, "Unauthorized");
  const parsed = adminActionInput.safeParse(raw);
  if (!parsed.success) return fail(400, "Give a reason of 1 to 1000 characters");
  const target = await loadTarget(deps.db, parsed.data.profileId);
  if (!target) return fail(404, "Profile not found");
  const removed = await removeImages(deps, target, { actorGoogleSub: actor.googleSub, reason: parsed.data.reason });
  if (!removed) return fail(409, "This Profile has no images to remove");
  return { status: 200, body: { ok: true, slug: target.slug } };
}

/**
 * Suspends a Profile through the Profile lifecycle module. The caller purges the
 * edge-cached page for the returned Slug.
 */
export async function suspendProfile(deps: AdminDeps, actor: Actor, raw: unknown): Promise<AdminResult> {
  if (!isAdministrator(actor, deps.adminSubs)) return fail(401, "Unauthorized");
  const parsed = adminActionInput.safeParse(raw);
  if (!parsed.success) return fail(400, "Give a reason of 1 to 1000 characters");
  const { db } = deps;
  const target = await loadTarget(db, parsed.data.profileId);
  if (!target) return fail(404, "Profile not found");
  if (target.status === "suspended") return fail(409, "This Profile is already suspended");
  const suspended = await lifecycle.suspend(db, target.id, { actorGoogleSub: actor.googleSub, reason: parsed.data.reason });
  if (!suspended) return fail(409, "This Profile is already suspended");
  return { status: 200, body: { ok: true, slug: target.slug } };
}
