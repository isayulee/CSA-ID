import "server-only";
import { and, eq, exists, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { isAdministrator, type Actor } from "@/lib/admin";
import { adminAuditLog, advisingRequests, campuses, peerAdvisers, users } from "@/lib/db/schema";
import { portalFail, type PortalAdminDeps, type PortalDb, type PortalResult } from "./access";
import { auditColumns } from "./audit";
import { constraintFailed } from "./batch";

const userId = z.string().min(1).max(64);
const campusId = z.string().min(2).max(32);

export const approveInput = z.object({ userId, campusId });
export const revokeInput = z.object({ userId, reason: z.string().trim().min(1).max(1000) });
export const campusInput = z.object({ userId, campusId });

const UNAUTHORIZED = portalFail(401, "Unauthorized");
const NOT_A_PEER_ADVISER = portalFail(404, "This User is not a Peer Adviser");
const OK = { status: 200, body: { ok: true } };

async function loadUser(db: PortalDb, id: string) {
  const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
}

export async function loadCampus(db: PortalDb, id: string) {
  const [campus] = await db.select().from(campuses).where(eq(campuses.id, id)).limit(1);
  return campus ?? null;
}

async function loadPeerAdviser(db: PortalDb, id: string) {
  const [row] = await db.select({ userId: peerAdvisers.userId, campusId: peerAdvisers.campusId, email: users.email })
    .from(peerAdvisers).innerJoin(users, eq(users.id, peerAdvisers.userId)).where(eq(peerAdvisers.userId, id)).limit(1);
  return row ?? null;
}

const peerAdviserRow = (id: string) => eq(peerAdvisers.userId, id);

/** Approves a User as a Peer Adviser on a Campus: the `peer_advisers` row and its audit entry in one batch (§14.2). */
export async function approvePeerAdviser({ db, adminSubs }: PortalAdminDeps, actor: Actor, raw: unknown): Promise<PortalResult> {
  if (!isAdministrator(actor, adminSubs)) return UNAUTHORIZED;
  const parsed = approveInput.safeParse(raw);
  if (!parsed.success) return portalFail(400, "Choose a User and a Campus");
  const [user, campus, existing] = await Promise.all([loadUser(db, parsed.data.userId), loadCampus(db, parsed.data.campusId), loadPeerAdviser(db, parsed.data.userId)]);
  if (!user) return portalFail(404, "User not found");
  if (!campus) return portalFail(400, "Choose a Campus from the list");
  const ALREADY = portalFail(409, "This User is already a Peer Adviser");
  if (existing) return ALREADY;
  try {
    // A racing second approval fails on the primary key, and the batch rolls its audit entry back with it.
    await db.batch([
      db.insert(peerAdvisers).values({ userId: user.id, campusId: campus.id }),
      db.insert(adminAuditLog).values({ id: crypto.randomUUID(), actorGoogleSub: actor.googleSub, action: "approve_peer_adviser", targetType: "user", targetId: user.id, targetLabel: `${user.email} · ${campus.name}`.slice(0, 128) }),
    ]);
  } catch (error) {
    if (constraintFailed(error, "UNIQUE")) return ALREADY;
    throw error;
  }
  return OK;
}

/**
 * Revokes a Peer Adviser in one batch (§14.2): the audit entry with its reason,
 * giving back their `pending` and `rescheduled` Advising Requests, then deleting
 * the `peer_advisers` row, which cascades to their courses taught and
 * Availability. Every statement is conditional on that row, so a racing second
 * revocation writes nothing.
 */
export async function revokePeerAdviser({ db, adminSubs }: PortalAdminDeps, actor: Actor, raw: unknown): Promise<PortalResult> {
  if (!isAdministrator(actor, adminSubs)) return UNAUTHORIZED;
  const parsed = revokeInput.safeParse(raw);
  if (!parsed.success) return portalFail(400, "Choose a Peer Adviser and give a reason of 1 to 1000 characters");
  const target = await loadPeerAdviser(db, parsed.data.userId);
  if (!target) return NOT_A_PEER_ADVISER;
  const [entry] = await db.batch([
    db.insert(adminAuditLog).select(db.select(auditColumns({ actorGoogleSub: actor.googleSub, action: "revoke_peer_adviser", targetType: "user", targetId: target.userId, targetLabel: target.email, reason: parsed.data.reason }))
      .from(peerAdvisers).where(peerAdviserRow(target.userId))),
    db.update(advisingRequests).set({ claimedByUserId: null, claimedAt: null, updatedAt: Math.floor(Date.now() / 1000) }).where(and(
      eq(advisingRequests.claimedByUserId, target.userId),
      inArray(advisingRequests.status, ["pending", "rescheduled"]),
      exists(db.select({ userId: peerAdvisers.userId }).from(peerAdvisers).where(peerAdviserRow(target.userId))),
    )),
    db.delete(peerAdvisers).where(peerAdviserRow(target.userId)),
  ]);
  if (!entry.meta.changes) return NOT_A_PEER_ADVISER;
  return OK;
}

/** Moves a Peer Adviser to another Campus, with its audit entry in the same batch. */
export async function updatePeerAdviserCampus({ db, adminSubs }: PortalAdminDeps, actor: Actor, raw: unknown): Promise<PortalResult> {
  if (!isAdministrator(actor, adminSubs)) return UNAUTHORIZED;
  const parsed = campusInput.safeParse(raw);
  if (!parsed.success) return portalFail(400, "Choose a Peer Adviser and a Campus");
  const [target, campus] = await Promise.all([loadPeerAdviser(db, parsed.data.userId), loadCampus(db, parsed.data.campusId)]);
  if (!target) return NOT_A_PEER_ADVISER;
  if (!campus) return portalFail(400, "Choose a Campus from the list");
  const changesCampus = and(peerAdviserRow(target.userId), ne(peerAdvisers.campusId, campus.id));
  await db.batch([
    db.insert(adminAuditLog).select(db.select(auditColumns({ actorGoogleSub: actor.googleSub, action: "update_peer_adviser", targetType: "user", targetId: target.userId, targetLabel: `${target.email} · Campus: ${campus.name}` }))
      .from(peerAdvisers).where(changesCampus)),
    db.update(peerAdvisers).set({ campusId: campus.id }).where(changesCampus),
  ]);
  return OK;
}
