import "server-only";
import { and, asc, desc, eq, exists, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { isAdministrator, type Actor } from "@/lib/admin";
import { adminAuditLog, courses, kitFiles, kitItems, kitVersions, teachingKits, users } from "@/lib/db/schema";
import { portalFail, type PortalActor, type PortalDb, type PortalResult } from "./access";
import { auditColumns } from "./audit";
import { chunk, constraintFailed } from "./batch";
import { courseCode, normalizeCourseCode } from "./courses";
import { deleteUnusedKitFiles, type KitDeps } from "./kit-files";

/** Drive and YouTube items may link only here (§14.8). Drive's own sharing settings decide who can open a file. */
const ALLOWED_LINK_HOSTS = new Set(["drive.google.com", "docs.google.com", "www.youtube.com", "youtu.be"]);

/** The link as stored, or null when it isn't a plain https URL on an allowed host. */
export function allowedKitLink(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !ALLOWED_LINK_HOSTS.has(url.hostname)) return null;
  return url.href.length <= 500 ? url.href : null;
}

const label = z.string().trim().min(1).max(128);
const link = z.string().max(2000).transform((raw, ctx) => {
  const href = allowedKitLink(raw);
  if (href === null) {
    ctx.addIssue({ code: "custom", message: "Link only to Google Drive, Google Docs or YouTube, with an https:// address of at most 500 characters" });
    return z.NEVER;
  }
  return href;
});
const kitItem = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pdf"), label, fileId: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("drive"), label, url: link }),
  z.object({ kind: z.literal("youtube"), label, url: link }),
]);
export const kitDraftInput = z.object({
  courseCode,
  academicYear: z.number().int().min(2000).max(2100),
  term: z.number().int().min(1).max(4),
  title: z.string().trim().min(1).max(128),
  body: z.string().max(20000),
  items: z.array(kitItem).max(50, "A Teaching Kit holds at most 50 items"),
  /** The approved version the author was editing; null for a new kit. Left out, the kit's current version is used. */
  baseVersionId: z.string().min(1).max(64).nullable().optional(),
});
export type KitItemInput = z.infer<typeof kitItem>;

const versionId = z.string().min(1).max(64);
export const approveKitDraftInput = z.object({ versionId });
export const rejectKitDraftInput = z.object({ versionId, note: z.string().trim().min(1).max(1000) });

const UNAUTHORIZED = portalFail(401, "Unauthorized");
const KIT_NOT_FOUND = portalFail(404, "Teaching Kit not found");
const DRAFT_NOT_FOUND = portalFail(404, "Kit Draft not found");
const ALREADY_REVIEWED = portalFail(409, "This Kit Draft has already been reviewed");
const FILE_GONE = portalFail(400, "Upload the PDF again; it is no longer stored");
const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? "Invalid request";
const now = () => Math.floor(Date.now() / 1000);

const isPending = (id: string) => and(eq(kitVersions.id, id), eq(kitVersions.status, "pending"));
const pendingExists = (db: PortalDb, id: string) => exists(db.select({ id: kitVersions.id }).from(kitVersions).where(isPending(id)));

/**
 * One `kit_items` row as an `insert ... select` that writes only while its
 * version is still pending, so a draft reviewed mid-save gains no items. The
 * fields follow the table's column order.
 */
function insertItem(db: PortalDb, version: string, item: KitItemInput, displayOrder: number) {
  return db.insert(kitItems).select(db.select({
    id: sql<string>`${crypto.randomUUID()}`.as("id"),
    versionId: sql<string>`${version}`.as("version_id"),
    kind: sql<KitItemInput["kind"]>`${item.kind}`.as("kind"),
    label: sql<string>`${item.label}`.as("label"),
    url: sql<string | null>`${item.kind === "pdf" ? null : item.url}`.as("url"),
    fileId: sql<string | null>`${item.kind === "pdf" ? item.fileId : null}`.as("file_id"),
    displayOrder: sql<number>`${displayOrder}`.as("display_order"),
  }).from(kitVersions).where(isPending(version)));
}

async function fileIdsOf(db: PortalDb, where: SQL | undefined) {
  const rows = await db.select({ fileId: kitItems.fileId }).from(kitItems).where(and(where, isNotNull(kitItems.fileId)));
  return rows.map((row) => row.fileId!);
}

async function loadItems(db: PortalDb, versionIds: string[]) {
  const byVersion = new Map<string, ItemView[]>();
  for (const part of chunk(versionIds, 90)) {
    const rows = await db.select({ versionId: kitItems.versionId, kind: kitItems.kind, label: kitItems.label, url: kitItems.url, fileId: kitItems.fileId })
      .from(kitItems).where(inArray(kitItems.versionId, part)).orderBy(asc(kitItems.displayOrder));
    for (const { versionId: id, ...item } of rows) byVersion.set(id, [...(byVersion.get(id) ?? []), item]);
  }
  return byVersion;
}

/**
 * How many of these PDFs the Peer Adviser may put in a draft: the ones they
 * uploaded, and the ones an approved version or their own pending draft already
 * holds. Another Peer Adviser's loose upload is not theirs to attach.
 */
async function countUsableFiles(db: PortalDb, actor: PortalActor, fileIds: string[]) {
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(kitFiles).where(and(inArray(kitFiles.id, fileIds), or(
    eq(kitFiles.uploadedByUserId, actor.user.id),
    sql`exists (select 1 from ${kitItems} inner join ${kitVersions} on ${kitVersions.id} = ${kitItems.versionId}
      where ${kitItems.fileId} = ${kitFiles.id}
      and (${kitVersions.status} = 'approved' or (${kitVersions.status} = 'pending' and ${kitVersions.authorUserId} = ${actor.user.id})))`,
  )));
  return row.count;
}
type ItemView = { kind: KitItemInput["kind"]; label: string; url: string | null; fileId: string | null };

/**
 * Saves a Peer Adviser's Kit Draft (§14.9). The first save for a Course,
 * academic year and term finds or creates the kit row, then inserts a pending
 * version written against the approved one the author was editing. Saving again while that
 * draft is pending replaces its title, body and items in place. PDFs the edit
 * stops using are deleted.
 */
export async function saveKitDraft(deps: KitDeps, actor: PortalActor, raw: unknown): Promise<PortalResult> {
  const { db } = deps;
  const parsed = kitDraftInput.safeParse(raw);
  if (!parsed.success) return portalFail(400, firstIssue(parsed.error));
  const { courseCode: code, academicYear, term, title, body, items, baseVersionId } = parsed.data;

  const [course] = await db.select({ code: courses.code }).from(courses).where(eq(courses.code, code)).limit(1);
  if (!course) return portalFail(400, "Choose a Course from the list");
  const fileIds = [...new Set(items.flatMap((item) => (item.kind === "pdf" ? [item.fileId] : [])))];
  if (fileIds.length && await countUsableFiles(db, actor, fileIds) !== fileIds.length) return FILE_GONE;

  const kitTerm = and(eq(teachingKits.courseCode, code), eq(teachingKits.academicYear, academicYear), eq(teachingKits.term, term));
  await db.insert(teachingKits).values({ id: crypto.randomUUID(), courseCode: code, academicYear, term }).onConflictDoNothing();
  const [kit] = await db.select({ id: teachingKits.id, currentVersionId: teachingKits.currentVersionId }).from(teachingKits).where(kitTerm).limit(1);
  const [existing] = await db.select({ id: kitVersions.id }).from(kitVersions)
    .where(and(eq(kitVersions.kitId, kit.id), eq(kitVersions.authorUserId, actor.user.id), eq(kitVersions.status, "pending"))).limit(1);

  let base = kit.currentVersionId;
  if (!existing && baseVersionId !== undefined) {
    const [approved] = baseVersionId === null ? [{ id: null }] : await db.select({ id: kitVersions.id }).from(kitVersions)
      .where(and(eq(kitVersions.id, baseVersionId), eq(kitVersions.kitId, kit.id), eq(kitVersions.status, "approved"))).limit(1);
    if (!approved) return portalFail(400, "Reload the Teaching Kit; the version you edited is no longer stored");
    base = approved.id;
  }

  const id = existing?.id ?? crypto.randomUUID();
  const itemWrites = items.map((item, order) => insertItem(db, id, item, order));
  const previousFiles = existing ? await fileIdsOf(db, eq(kitItems.versionId, id)) : [];
  try {
    if (existing) {
      const [updated] = await db.batch([
        db.update(kitVersions).set({ title, body, updatedAt: now() }).where(and(isPending(id), eq(kitVersions.authorUserId, actor.user.id))),
        db.delete(kitItems).where(and(eq(kitItems.versionId, id), pendingExists(db, id))),
        ...itemWrites,
      ]);
      if (!updated.meta.changes) return ALREADY_REVIEWED;
    } else {
      await db.batch([
        db.insert(kitVersions).values({ id, kitId: kit.id, baseVersionId: base, title, body, authorUserId: actor.user.id }),
        ...itemWrites,
      ]);
    }
  } catch (error) {
    // A second save racing the first one hits the one-pending-draft-per-author index.
    if (constraintFailed(error, "UNIQUE")) return portalFail(409, "Your Kit Draft was saved from another tab. Reload and try again.");
    if (constraintFailed(error, "FOREIGN KEY")) return FILE_GONE;
    throw error;
  }
  await deleteUnusedKitFiles(deps, previousFiles.filter((file) => !fileIds.includes(file)));
  return { status: 200, body: { ok: true, kitId: kit.id, versionId: id } };
}

const kitSummary = {
  id: teachingKits.id,
  courseCode: teachingKits.courseCode,
  academicYear: teachingKits.academicYear,
  term: teachingKits.term,
};

/**
 * The approved Teaching Kits, filtered by `course`, `year` and `term`, plus the
 * reader's own pending and rejected Kit Drafts. A kit with no approved version
 * is not listed.
 */
export async function listKits(db: PortalDb, actor: PortalActor, url: URL): Promise<PortalResult> {
  const filters: SQL[] = [];
  const course = url.searchParams.get("course");
  if (course) filters.push(eq(teachingKits.courseCode, normalizeCourseCode(course)));
  const year = Number(url.searchParams.get("year"));
  if (Number.isInteger(year) && year > 0) filters.push(eq(teachingKits.academicYear, year));
  const term = Number(url.searchParams.get("term"));
  if (Number.isInteger(term) && term > 0) filters.push(eq(teachingKits.term, term));

  const [kits, myDrafts] = await Promise.all([
    db.select({ ...kitSummary, versionId: kitVersions.id, title: kitVersions.title }).from(teachingKits)
      .innerJoin(kitVersions, eq(kitVersions.id, teachingKits.currentVersionId)).where(and(...filters))
      .orderBy(asc(teachingKits.courseCode), desc(teachingKits.academicYear), desc(teachingKits.term)),
    db.select({ kitId: teachingKits.id, courseCode: teachingKits.courseCode, academicYear: teachingKits.academicYear, term: teachingKits.term,
      versionId: kitVersions.id, status: kitVersions.status, title: kitVersions.title, reviewNote: kitVersions.reviewNote, updatedAt: kitVersions.updatedAt })
      .from(kitVersions).innerJoin(teachingKits, eq(teachingKits.id, kitVersions.kitId))
      .where(and(eq(kitVersions.authorUserId, actor.user.id), inArray(kitVersions.status, ["pending", "rejected"])))
      .orderBy(desc(kitVersions.updatedAt)).limit(50),
  ]);
  return { status: 200, body: { kits, myDrafts } };
}

/**
 * One Teaching Kit: its current approved version with items, and the reader's
 * own latest Kit Draft of it (pending first, else the last rejected one). A kit
 * with no approved version is hidden from everyone but its draft authors and
 * Administrators (§14.9).
 */
export async function readKit(db: PortalDb, actor: PortalActor, id: string): Promise<PortalResult> {
  const [kit] = await db.select({ ...kitSummary, currentVersionId: teachingKits.currentVersionId }).from(teachingKits).where(eq(teachingKits.id, id)).limit(1);
  if (!kit) return KIT_NOT_FOUND;
  const [[current], [mine]] = await Promise.all([
    kit.currentVersionId
      ? db.select({ versionId: kitVersions.id, title: kitVersions.title, body: kitVersions.body, reviewedAt: kitVersions.reviewedAt }).from(kitVersions).where(eq(kitVersions.id, kit.currentVersionId))
      : Promise.resolve([]),
    db.select({ versionId: kitVersions.id, status: kitVersions.status, title: kitVersions.title, body: kitVersions.body, baseVersionId: kitVersions.baseVersionId, reviewNote: kitVersions.reviewNote, updatedAt: kitVersions.updatedAt })
      .from(kitVersions).where(and(eq(kitVersions.kitId, id), eq(kitVersions.authorUserId, actor.user.id), inArray(kitVersions.status, ["pending", "rejected"])))
      .orderBy(sql`${kitVersions.status} = 'pending' desc`, desc(kitVersions.updatedAt)).limit(1),
  ]);
  if (!current && !mine && !actor.isAdministrator) return KIT_NOT_FOUND;
  const items = await loadItems(db, [current?.versionId, mine?.versionId].filter((v): v is string => Boolean(v)));
  return { status: 200, body: {
    kit: { id: kit.id, courseCode: kit.courseCode, academicYear: kit.academicYear, term: kit.term },
    current: current ? { ...current, items: items.get(current.versionId) ?? [] } : null,
    myDraft: mine ? { ...mine, items: items.get(mine.versionId) ?? [] } : null,
  } };
}

/**
 * The review queue for Administrators: every pending Kit Draft, oldest first,
 * with its items. `stale` flags a draft written against a version that is no
 * longer current, because approving it replaces the newer content.
 */
export async function listPendingKitDrafts(db: PortalDb, actor: PortalActor): Promise<PortalResult> {
  if (!actor.isAdministrator) return portalFail(403, "Forbidden");
  const rows = await db.select({
    versionId: kitVersions.id, kitId: teachingKits.id, courseCode: teachingKits.courseCode, academicYear: teachingKits.academicYear, term: teachingKits.term,
    title: kitVersions.title, body: kitVersions.body, authorName: users.name, baseVersionId: kitVersions.baseVersionId, currentVersionId: teachingKits.currentVersionId,
    createdAt: kitVersions.createdAt, updatedAt: kitVersions.updatedAt,
  }).from(kitVersions).innerJoin(teachingKits, eq(teachingKits.id, kitVersions.kitId)).leftJoin(users, eq(users.id, kitVersions.authorUserId))
    .where(eq(kitVersions.status, "pending")).orderBy(asc(kitVersions.createdAt), asc(kitVersions.id)).limit(200);
  const items = await loadItems(db, rows.map((row) => row.versionId));
  const drafts = rows.map(({ currentVersionId, ...row }) => ({ ...row, stale: row.baseVersionId !== currentVersionId, items: items.get(row.versionId) ?? [] }));
  return { status: 200, body: { drafts } };
}

async function loadDraft(db: PortalDb, id: string) {
  const [row] = await db.select({ id: kitVersions.id, status: kitVersions.status, title: kitVersions.title, kitId: teachingKits.id,
    courseCode: teachingKits.courseCode, academicYear: teachingKits.academicYear, term: teachingKits.term })
    .from(kitVersions).innerJoin(teachingKits, eq(teachingKits.id, kitVersions.kitId)).where(eq(kitVersions.id, id)).limit(1);
  return row ?? null;
}
const draftLabel = (draft: NonNullable<Awaited<ReturnType<typeof loadDraft>>>) =>
  `${draft.courseCode} AY ${draft.academicYear}-${draft.academicYear + 1} T${draft.term} · ${draft.title}`;

/**
 * Approves a Kit Draft in one batch (§14.9): the audit entry, deleting the
 * items of every older approved version of the kit (their title and body stay
 * as history), pointing the kit at this version, and marking it approved.
 * Every statement is conditional on the draft still being pending, so a racing
 * second review writes nothing.
 */
export async function approveKitDraft(deps: KitDeps & { adminSubs: string | undefined }, actor: Actor, raw: unknown): Promise<PortalResult> {
  const { db } = deps;
  if (!isAdministrator(actor, deps.adminSubs)) return UNAUTHORIZED;
  const parsed = approveKitDraftInput.safeParse(raw);
  if (!parsed.success) return portalFail(400, "Choose a Kit Draft");
  const draft = await loadDraft(db, parsed.data.versionId);
  if (!draft) return DRAFT_NOT_FOUND;
  if (draft.status !== "pending") return ALREADY_REVIEWED;

  const olderApproved = db.select({ id: kitVersions.id }).from(kitVersions).where(and(eq(kitVersions.kitId, draft.kitId), eq(kitVersions.status, "approved")));
  const replacedFiles = await fileIdsOf(db, inArray(kitItems.versionId, olderApproved));
  const thisDraft = and(isPending(draft.id), eq(kitVersions.kitId, draft.kitId));
  const [entry] = await db.batch([
    db.insert(adminAuditLog).select(db.select(auditColumns({ actorGoogleSub: actor.googleSub, action: "approve_kit_draft", targetType: "kit_version", targetId: draft.id, targetLabel: draftLabel(draft) }))
      .from(kitVersions).where(thisDraft)),
    db.delete(kitItems).where(and(inArray(kitItems.versionId, olderApproved), pendingExists(db, draft.id))),
    db.update(teachingKits).set({ currentVersionId: draft.id })
      .where(and(eq(teachingKits.id, draft.kitId), exists(db.select({ id: kitVersions.id }).from(kitVersions).where(thisDraft)))),
    db.update(kitVersions).set({ status: "approved", reviewedAt: now(), updatedAt: now() }).where(thisDraft),
  ]);
  if (!entry.meta.changes) return ALREADY_REVIEWED;
  await deleteUnusedKitFiles(deps, replacedFiles);
  return { status: 200, body: { ok: true } };
}

/**
 * Rejects a Kit Draft with a required note (§14.9): the audit entry with the
 * note as its reason, deleting the draft's items, and marking it rejected, in
 * one batch. The row stays so its author can read the note.
 */
export async function rejectKitDraft(deps: KitDeps & { adminSubs: string | undefined }, actor: Actor, raw: unknown): Promise<PortalResult> {
  const { db } = deps;
  if (!isAdministrator(actor, deps.adminSubs)) return UNAUTHORIZED;
  const parsed = rejectKitDraftInput.safeParse(raw);
  if (!parsed.success) return portalFail(400, "Give the author a note of 1 to 1000 characters");
  const draft = await loadDraft(db, parsed.data.versionId);
  if (!draft) return DRAFT_NOT_FOUND;
  if (draft.status !== "pending") return ALREADY_REVIEWED;

  const droppedFiles = await fileIdsOf(db, eq(kitItems.versionId, draft.id));
  const [entry] = await db.batch([
    db.insert(adminAuditLog).select(db.select(auditColumns({ actorGoogleSub: actor.googleSub, action: "reject_kit_draft", targetType: "kit_version", targetId: draft.id, targetLabel: draftLabel(draft), reason: parsed.data.note }))
      .from(kitVersions).where(isPending(draft.id))),
    db.delete(kitItems).where(and(eq(kitItems.versionId, draft.id), pendingExists(db, draft.id))),
    db.update(kitVersions).set({ status: "rejected", reviewNote: parsed.data.note, reviewedAt: now(), updatedAt: now() }).where(isPending(draft.id)),
  ]);
  if (!entry.meta.changes) return ALREADY_REVIEWED;
  await deleteUnusedKitFiles(deps, droppedFiles);
  return { status: 200, body: { ok: true } };
}
