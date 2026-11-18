import "server-only";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { z } from "zod";
import * as schema from "@/lib/db/schema";
import { snapshotDeleteStatements } from "@/lib/public/published-profile";

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

export const adminActionInput = z.object({
  profileId: z.string().min(1).max(64),
  reason: z.string().trim().min(1).max(1000),
});

async function loadTarget(db: Db, profileId: string) {
  const [profile] = await db.select({ id: schema.profiles.id, slug: schema.profiles.slug, status: schema.profiles.status, avatarKey: schema.profiles.avatarKey, backgroundKey: schema.profiles.backgroundKey })
    .from(schema.profiles).where(eq(schema.profiles.id, profileId)).limit(1);
  return profile ?? null;
}

function auditEntry(db: Db, actor: Actor, action: schema.AdminAuditAction, target: { id: string; slug: string | null }, reason: string) {
  return db.insert(schema.adminAuditLog).values({ id: crypto.randomUUID(), actorGoogleSub: actor.googleSub, action, targetProfileId: target.id, targetSlug: target.slug, reason });
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
    slug: profiles.slug,
    displayName: profiles.displayName,
    profileStatus: profiles.status,
  }).from(abuseReports).leftJoin(profiles, eq(profiles.id, abuseReports.profileId))
    .where(eq(abuseReports.status, "open")).orderBy(desc(abuseReports.createdAt)).limit(OPEN_REPORTS_LIMIT);
  return { status: 200, body: { reports } };
}

/**
 * Removes a Profile's public images: deletes every image key the Profile or its
 * Published Profile snapshot points at from KV, then one D1 batch clears those
 * keys on both rows and writes the audit entry.
 *
 * KV goes first on purpose: if D1 then fails, the Profile still holds the keys,
 * so a retry finds and removes them. The other order could leave an abusive
 * image reachable at its /media URL with nothing in D1 pointing to it.
 */
export async function removeProfileImages(deps: AdminDeps, actor: Actor, raw: unknown): Promise<AdminResult> {
  if (!isAdministrator(actor, deps.adminSubs)) return fail(401, "Unauthorized");
  const parsed = adminActionInput.safeParse(raw);
  if (!parsed.success) return fail(400, "Give a reason of 1 to 1000 characters");
  const { db } = deps;
  const target = await loadTarget(db, parsed.data.profileId);
  if (!target) return fail(404, "Profile not found");
  const [published] = await db.select({ avatarKey: schema.publishedProfiles.avatarKey, backgroundKey: schema.publishedProfiles.backgroundKey })
    .from(schema.publishedProfiles).where(eq(schema.publishedProfiles.profileId, target.id)).limit(1);
  const keys = new Set([target.avatarKey, target.backgroundKey, published?.avatarKey, published?.backgroundKey].filter((key): key is string => Boolean(key)));
  if (keys.size === 0) return fail(409, "This Profile has no images to remove");
  await Promise.all([...keys].map((key) => deps.kv.delete(key)));
  await db.batch([
    db.update(schema.profiles).set({ avatarKey: null, backgroundKey: null }).where(eq(schema.profiles.id, target.id)),
    db.update(schema.publishedProfiles).set({ avatarKey: null, backgroundKey: null }).where(eq(schema.publishedProfiles.profileId, target.id)),
    auditEntry(db, actor, "remove_images", target, parsed.data.reason),
  ]);
  return { status: 200, body: { ok: true, slug: target.slug } };
}

/**
 * Suspends a Profile: one D1 batch removes the Published Profile snapshot, sets
 * the status to `suspended` and writes the audit entry. Ownership and the
 * reserved Slug stay. The caller purges the edge-cached page for the returned Slug.
 */
export async function suspendProfile(deps: AdminDeps, actor: Actor, raw: unknown): Promise<AdminResult> {
  if (!isAdministrator(actor, deps.adminSubs)) return fail(401, "Unauthorized");
  const parsed = adminActionInput.safeParse(raw);
  if (!parsed.success) return fail(400, "Give a reason of 1 to 1000 characters");
  const { db } = deps;
  const target = await loadTarget(db, parsed.data.profileId);
  if (!target) return fail(404, "Profile not found");
  if (target.status === "suspended") return fail(409, "This Profile is already suspended");
  // D1 runs batches one at a time. The audit entry is written first and only while
  // the Profile is not yet suspended, so when two suspensions race, the second one
  // writes nothing and reports 409 instead of adding a second entry.
  const { profiles, adminAuditLog } = schema;
  const [audit] = await db.batch([
    db.insert(adminAuditLog).select(db.select({
      id: sql<string>`${crypto.randomUUID()}`.as("id"),
      actorGoogleSub: sql<string>`${actor.googleSub}`.as("actor_google_sub"),
      action: sql<schema.AdminAuditAction>`'suspend'`.as("action"),
      targetProfileId: profiles.id,
      targetSlug: profiles.slug,
      reason: sql<string>`${parsed.data.reason}`.as("reason"),
      createdAt: sql<number>`unixepoch()`.as("created_at"),
    }).from(profiles).where(and(eq(profiles.id, target.id), ne(profiles.status, "suspended")))),
    ...snapshotDeleteStatements(db, target.id),
    db.update(schema.profiles).set({ status: "suspended", updatedAt: Math.floor(Date.now() / 1000) }).where(and(eq(schema.profiles.id, target.id), ne(schema.profiles.status, "suspended"))),
  ]);
  if (!audit.meta.changes) return fail(409, "This Profile is already suspended");
  return { status: 200, body: { ok: true, slug: target.slug } };
}
