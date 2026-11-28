import "server-only";
import { and, asc, desc, eq, exists, isNull, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { isAdministrator, type Actor } from "@/lib/admin";
import { adminAuditLog, adviseeContacts, advisingNotes, advisingRequests, advisingRequestSlots, peerAdvisers, users } from "@/lib/db/schema";
import { portalFail, type PortalActor, type PortalAdminDeps, type PortalDb, type PortalResult } from "./access";
import { auditColumns } from "./audit";
import { chunk } from "./batch";

// The server side of the Peer Advising Scheduler (§14.2, §14.10): reading, claiming, giving back,
// updating, noting and assigning Advising Requests.

type AdvisingRequest = typeof advisingRequests.$inferSelect;
const STATUSES = advisingRequests.status.enumValues;

/**
 * What a viewer may see of one request (§14.2). `full` is the claimant or an Administrator; `open` is any
 * Peer Adviser on an unclaimed request; `claimed` is a Peer Adviser looking at someone else's request.
 */
type Access = "full" | "open" | "claimed";

function accessTo(actor: PortalActor, claimedByUserId: string | null): Access {
  if (actor.isAdministrator || claimedByUserId === actor.user.id) return "full";
  return claimedByUserId === null ? "open" : "claimed";
}

const columns = {
  id: advisingRequests.id,
  submittedAt: advisingRequests.submittedAt,
  status: advisingRequests.status,
  courseCode: advisingRequests.courseCode,
  courseText: advisingRequests.courseText,
  campusId: advisingRequests.campusId,
  campusText: advisingRequests.campusText,
  topic: advisingRequests.topic,
  attendeeCount: advisingRequests.attendeeCount,
  availableDayText: advisingRequests.availableDayText,
  availableTimeText: advisingRequests.availableTimeText,
  timesUnclear: advisingRequests.timesUnclear,
  claimedByUserId: advisingRequests.claimedByUserId,
  claimantName: users.name,
  claimedAt: advisingRequests.claimedAt,
  scheduledOn: advisingRequests.scheduledOn,
  scheduledStart: advisingRequests.scheduledStart,
  sheetPeerAdviser: advisingRequests.sheetPeerAdviser,
  sheetRemarks: advisingRequests.sheetRemarks,
};
const selectRequests = (db: PortalDb) =>
  db.select(columns).from(advisingRequests).leftJoin(users, eq(users.id, advisingRequests.claimedByUserId));
type Row = Awaited<ReturnType<typeof selectRequests>>[number];

/** One request cut down to what `access` allows. */
function shape(row: Row, access: Access) {
  const claimant = row.claimedByUserId === null ? null : { userId: row.claimedByUserId, name: row.claimantName };
  const seen = { id: row.id, status: row.status, courseCode: row.courseCode, courseText: row.courseText, campusId: row.campusId, campusText: row.campusText, claimant };
  if (access === "claimed") return { access, ...seen };
  const open = {
    ...seen, submittedAt: row.submittedAt, topic: row.topic, attendeeCount: row.attendeeCount,
    availableDayText: row.availableDayText, availableTimeText: row.availableTimeText, timesUnclear: row.timesUnclear,
  };
  if (access === "open") return { access, ...open };
  return {
    access, ...open, claimedAt: row.claimedAt, scheduledOn: row.scheduledOn, scheduledStart: row.scheduledStart,
    sheetPeerAdviser: row.sheetPeerAdviser, sheetRemarks: row.sheetRemarks,
  };
}

const LIST_LIMIT = 100;
const listQuery = z.object({
  status: z.enum(STATUSES).optional(),
  course: z.string().min(1).max(32).optional(),
  campus: z.string().min(1).max(32).optional(),
  // "me", "none" (unclaimed), or a claimant's User ID.
  claimant: z.string().min(1).max(64).optional(),
  // Pages back by `submittedAt`: pass the oldest `submittedAt` from the previous page.
  before: z.coerce.number().int().positive().optional(),
});

/** `GET /api/portal/advising-requests`: newest first, filterable by status, Course, campus and claimant. */
export async function listAdvisingRequests(db: PortalDb, actor: PortalActor, url: URL): Promise<PortalResult> {
  const parsed = listQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return portalFail(400, "Filter by a status, Course, campus or claimant");
  const { status, course, campus, claimant, before } = parsed.data;
  const filters: (SQL | undefined)[] = [
    status ? eq(advisingRequests.status, status) : undefined,
    course ? eq(advisingRequests.courseCode, course) : undefined,
    campus ? eq(advisingRequests.campusId, campus) : undefined,
    claimant === "none" ? isNull(advisingRequests.claimedByUserId)
      : claimant ? eq(advisingRequests.claimedByUserId, claimant === "me" ? actor.user.id : claimant) : undefined,
    before === undefined ? undefined : lt(advisingRequests.submittedAt, before),
  ];
  const rows = await selectRequests(db).where(and(...filters))
    .orderBy(desc(advisingRequests.submittedAt), asc(advisingRequests.id)).limit(LIST_LIMIT + 1);
  return {
    status: 200,
    body: { requests: rows.slice(0, LIST_LIMIT).map((row) => shape(row, accessTo(actor, row.claimedByUserId))), hasMore: rows.length > LIST_LIMIT },
  };
}

const REQUEST_NOT_FOUND = portalFail(404, "Advising Request not found");

/**
 * `GET /api/portal/advising-requests/[id]`. The advisee's contact and the notes go only to the claimant and
 * Administrators; the free-time slots to anyone who may see the times.
 */
export async function readAdvisingRequest(db: PortalDb, actor: PortalActor, id: string): Promise<PortalResult> {
  const [row] = await selectRequests(db).where(eq(advisingRequests.id, id)).limit(1);
  if (!row) return REQUEST_NOT_FOUND;
  const access = accessTo(actor, row.claimedByUserId);
  if (access === "claimed") return { status: 200, body: { request: shape(row, access) } };
  const slots = await db.select({ weekday: advisingRequestSlots.weekday, onDate: advisingRequestSlots.onDate, hour: advisingRequestSlots.hour })
    .from(advisingRequestSlots).where(eq(advisingRequestSlots.requestId, id))
    .orderBy(asc(advisingRequestSlots.onDate), asc(advisingRequestSlots.weekday), asc(advisingRequestSlots.hour));
  if (access === "open") return { status: 200, body: { request: { ...shape(row, access), slots } } };
  const [[contact], notes] = await db.batch([
    db.select({ fullName: adviseeContacts.fullName, studentNumber: adviseeContacts.studentNumber, programYear: adviseeContacts.programYear, email: adviseeContacts.email, cardinalMail: adviseeContacts.cardinalMail })
      .from(adviseeContacts).where(eq(adviseeContacts.requestId, id)),
    db.select({ id: advisingNotes.id, body: advisingNotes.body, authorUserId: advisingNotes.authorUserId, authorName: users.name, createdAt: advisingNotes.createdAt })
      .from(advisingNotes).leftJoin(users, eq(users.id, advisingNotes.authorUserId))
      .where(eq(advisingNotes.requestId, id)).orderBy(asc(advisingNotes.createdAt), asc(advisingNotes.id)),
  ]);
  return { status: 200, body: { request: { ...shape(row, access), slots, contact: contact ?? null, notes } } };
}

const now = () => Math.floor(Date.now() / 1000);
const requestId = z.string().min(1).max(64);
const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? "Invalid request";

/** A real calendar date as YYYY-MM-DD. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give dates as YYYY-MM-DD").refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}, "That date does not exist");
const hour = z.number().int().min(8, "Slots run from 08:00").max(16, "The last slot starts at 16:00");

/** A weekly slot gives its weekday; a dated slot gives its date, and its weekday comes from the date. Sundays are refused. */
const slotInput = z.union([
  z.object({ weekday: z.number().int().min(1).max(6), hour }).strict().transform((slot) => ({ ...slot, onDate: "" })),
  z.object({ onDate: isoDate, hour }).strict().transform((slot) => ({ weekday: new Date(`${slot.onDate}T00:00:00Z`).getUTCDay(), ...slot })),
]).refine((slot) => slot.weekday !== 0, "Slots run Monday to Saturday");

export const claimInput = z.object({ requestId });
export const noteInput = z.object({ requestId, body: z.string().trim().min(1, "Write a note").max(2000, "Notes are at most 2000 characters") });
export const assignInput = z.object({ requestId, userId: z.string().min(1).max(64) });
export const updateInput = z.object({
  requestId,
  status: z.enum(STATUSES).optional(),
  // null clears the schedule; a start time needs a date (§14.3).
  schedule: z.object({ on: isoDate, start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Give the start as HH:MM").nullable() }).nullable().optional(),
  // Replaces every slot and clears "times unclear" (§14.5).
  slots: z.array(slotInput).min(1, "Pick at least one slot").max(100).optional(),
}).refine((input) => input.status !== undefined || input.schedule !== undefined || input.slots !== undefined, "Change the status, schedule or slots");

const NOT_YOURS = portalFail(403, "Only the Peer Adviser who claimed this request, or an Administrator, can change it");
const CHANGED = portalFail(409, "This request changed while you were editing it. Reload and try again.");
const OK = { status: 200, body: { ok: true } };

async function loadClaimant(db: PortalDb, id: string) {
  const [row] = await db.select({ claimedByUserId: advisingRequests.claimedByUserId }).from(advisingRequests).where(eq(advisingRequests.id, id)).limit(1);
  return row ?? null;
}

/** The request when the actor may change it: its claimant, or any request for an Administrator (§14.2). */
const editable = (actor: PortalActor, id: string) =>
  actor.isAdministrator ? eq(advisingRequests.id, id) : and(eq(advisingRequests.id, id), eq(advisingRequests.claimedByUserId, actor.user.id));
const editableExists = (db: PortalDb, actor: PortalActor, id: string) =>
  exists(db.select({ id: advisingRequests.id }).from(advisingRequests).where(editable(actor, id)));

/** Checks before writing, so the answer can say why; the writes check again, so a racing change can't slip through. */
async function checkEditable(db: PortalDb, actor: PortalActor, id: string) {
  const request = await loadClaimant(db, id);
  if (!request) return REQUEST_NOT_FOUND;
  if (accessTo(actor, request.claimedByUserId) !== "full") return NOT_YOURS;
  return null;
}

/**
 * Claims an unclaimed request as one guarded update (§14.2), so two Peer Advisers claiming at once produce
 * one winner. Claiming a request you already hold succeeds and changes nothing.
 */
export async function claimAdvisingRequest(db: PortalDb, actor: PortalActor, raw: unknown): Promise<PortalResult> {
  if (!actor.isPeerAdviser) return portalFail(403, "Only Peer Advisers claim Advising Requests; an Administrator assigns them");
  const parsed = claimInput.safeParse(raw);
  if (!parsed.success) return portalFail(400, "Choose an Advising Request");
  const id = parsed.data.requestId;
  const at = now();
  const result = await db.update(advisingRequests).set({ claimedByUserId: actor.user.id, claimedAt: at, updatedAt: at }).where(and(
    eq(advisingRequests.id, id),
    isNull(advisingRequests.claimedByUserId),
    exists(db.select({ userId: peerAdvisers.userId }).from(peerAdvisers).where(eq(peerAdvisers.userId, actor.user.id))),
  ));
  if (result.meta.changes) return OK;
  const request = await loadClaimant(db, id);
  if (!request) return REQUEST_NOT_FOUND;
  if (request.claimedByUserId === actor.user.id) return OK;
  return portalFail(409, "Another Peer Adviser already claimed this request");
}

/** Gives a claimed request back, only where the claimant is the Session User (§14.2). */
export async function giveBackAdvisingRequest(db: PortalDb, actor: PortalActor, raw: unknown): Promise<PortalResult> {
  const parsed = claimInput.safeParse(raw);
  if (!parsed.success) return portalFail(400, "Choose an Advising Request");
  const id = parsed.data.requestId;
  const result = await db.update(advisingRequests).set({ claimedByUserId: null, claimedAt: null, updatedAt: now() })
    .where(and(eq(advisingRequests.id, id), eq(advisingRequests.claimedByUserId, actor.user.id)));
  if (result.meta.changes) return OK;
  const request = await loadClaimant(db, id);
  if (!request) return REQUEST_NOT_FOUND;
  return portalFail(403, "Only the Peer Adviser who claimed this request can give it back");
}

/** Sets the status, the schedule, or the slots of a request the actor may change, in one batch. */
export async function updateAdvisingRequest(db: PortalDb, actor: PortalActor, raw: unknown): Promise<PortalResult> {
  const parsed = updateInput.safeParse(raw);
  if (!parsed.success) return portalFail(400, firstIssue(parsed.error));
  const { requestId: id, status, schedule, slots } = parsed.data;
  const refused = await checkEditable(db, actor, id);
  if (refused) return refused;

  const changes: Partial<AdvisingRequest> & { updatedAt: number } = { updatedAt: now() };
  if (status !== undefined) changes.status = status;
  if (schedule !== undefined) Object.assign(changes, { scheduledOn: schedule?.on ?? null, scheduledStart: schedule?.start ?? null });
  if (slots !== undefined) changes.timesUnclear = false;
  const unique = slots && [...new Map(slots.map((slot) => [`${slot.weekday} ${slot.onDate} ${slot.hour}`, slot])).values()];
  const [updated] = await db.batch([
    db.update(advisingRequests).set(changes).where(editable(actor, id)),
    ...(unique ? [
      db.delete(advisingRequestSlots).where(and(eq(advisingRequestSlots.requestId, id), editableExists(db, actor, id))),
      // D1 binds at most 100 parameters per statement: 3 per slot plus the request's conditions.
      ...chunk(unique, 25).map((part) => db.insert(advisingRequestSlots).select(db.select({
        requestId: advisingRequests.id,
        weekday: sql<number>`slot.column1`.as("weekday"),
        onDate: sql<string>`slot.column2`.as("on_date"),
        hour: sql<number>`slot.column3`.as("hour"),
      }).from(advisingRequests)
        .innerJoin(sql`(values ${sql.join(part.map((slot) => sql`(${slot.weekday}, ${slot.onDate}, ${slot.hour})`), sql`, `)}) as slot`, sql`true`)
        .where(editable(actor, id)))),
    ] : []),
  ]);
  return updated.meta.changes ? OK : CHANGED;
}

/** Adds a note to a request the actor may change. Notes are append-only (§14.3). */
export async function addAdvisingNote(db: PortalDb, actor: PortalActor, raw: unknown): Promise<PortalResult> {
  const parsed = noteInput.safeParse(raw);
  if (!parsed.success) return portalFail(400, firstIssue(parsed.error));
  const { requestId: id, body } = parsed.data;
  const refused = await checkEditable(db, actor, id);
  if (refused) return refused;
  const noteId = crypto.randomUUID();
  const result = await db.insert(advisingNotes).select(db.select({
    id: sql<string>`${noteId}`.as("id"),
    requestId: advisingRequests.id,
    authorUserId: sql<string>`${actor.user.id}`.as("author_user_id"),
    body: sql<string>`${body}`.as("body"),
    createdAt: sql<number>`unixepoch()`.as("created_at"),
  }).from(advisingRequests).where(editable(actor, id)));
  return result.meta.changes ? { status: 200, body: { noteId } } : CHANGED;
}

/**
 * Assigns a request to a Peer Adviser, replacing any claimant, with its audit entry in the same batch (§14.2).
 * Both statements require the target's `peer_advisers` row, so a racing revocation writes neither.
 */
export async function assignAdvisingRequest({ db, adminSubs }: PortalAdminDeps, actor: Actor, raw: unknown): Promise<PortalResult> {
  if (!isAdministrator(actor, adminSubs)) return portalFail(401, "Unauthorized");
  const parsed = assignInput.safeParse(raw);
  if (!parsed.success) return portalFail(400, "Choose an Advising Request and a Peer Adviser");
  const { requestId: id, userId } = parsed.data;
  const [[request], [target]] = await db.batch([
    db.select({ courseCode: advisingRequests.courseCode, courseText: advisingRequests.courseText }).from(advisingRequests).where(eq(advisingRequests.id, id)).limit(1),
    db.select({ email: users.email }).from(peerAdvisers).innerJoin(users, eq(users.id, peerAdvisers.userId)).where(eq(peerAdvisers.userId, userId)).limit(1),
  ]);
  if (!request) return REQUEST_NOT_FOUND;
  if (!target) return portalFail(404, "This User is not a Peer Adviser");
  const targetIsPeerAdviser = exists(db.select({ userId: peerAdvisers.userId }).from(peerAdvisers).where(eq(peerAdvisers.userId, userId)));
  const at = now();
  const [audit] = await db.batch([
    db.insert(adminAuditLog).select(db.select(auditColumns({
      actorGoogleSub: actor.googleSub, action: "assign_advising_request", targetType: "advising_request", targetId: id,
      targetLabel: `${request.courseCode ?? request.courseText} · ${target.email}`,
    })).from(advisingRequests).where(and(eq(advisingRequests.id, id), targetIsPeerAdviser))),
    db.update(advisingRequests).set({ claimedByUserId: userId, claimedAt: at, updatedAt: at }).where(and(eq(advisingRequests.id, id), targetIsPeerAdviser)),
  ]);
  return audit.meta.changes ? OK : portalFail(404, "This User is not a Peer Adviser");
}
