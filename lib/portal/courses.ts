import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { isAdministrator, type Actor } from "@/lib/admin";
import { adminAuditLog, advisingRequests, campuses, courses, peerAdviserCourses, teachingKits } from "@/lib/db/schema";
import { portalFail, type PortalActor, type PortalAdminDeps, type PortalDb, type PortalResult } from "./access";
import { auditColumns } from "./audit";
import { constraintFailed } from "./batch";

/** Uppercased with spaces removed: "math 146" is MATH146. Suffixes such as -0 or L stay, because CHM11-3 and CHM11-3L differ. */
export function normalizeCourseCode(raw: string) {
  return raw.replace(/\s+/g, "").toUpperCase();
}

// The same rule as the `courses_code_check` constraint.
const COURSE_CODE = /^[A-Z][A-Z0-9-]{1,15}$/;
export const courseCode = z.string().max(64).transform(normalizeCourseCode)
  .refine((code) => COURSE_CODE.test(code) && !code.endsWith("-"), "Use 2 to 16 letters, digits and hyphens, starting with a letter, like MATH146 or CHM11-3L");
const courseTitle = z.string().trim().min(1).max(128);
const reason = z.string().trim().min(1).max(1000);

const addCourseInput = z.object({ code: courseCode, title: courseTitle });
const updateCourseInput = z.object({ code: courseCode, newCode: courseCode, title: courseTitle });
const mergeCourseInput = z.object({ code: courseCode, into: courseCode, reason });
const deleteCourseInput = z.object({ code: courseCode, reason });
const addCampusInput = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,32}$/, "Use 2 to 32 lowercase letters, digits and hyphens"),
  name: z.string().trim().min(1).max(64),
});

const UNAUTHORIZED = portalFail(401, "Unauthorized");
const COURSE_NOT_FOUND = portalFail(404, "Course not found");
const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? "Invalid request";

/** The shared Course list, every Campus included. */
export async function listCourses(db: PortalDb): Promise<PortalResult> {
  const rows = await db.select({ code: courses.code, title: courses.title }).from(courses).orderBy(asc(courses.code));
  return { status: 200, body: { courses: rows } };
}

export async function listCampuses(db: PortalDb): Promise<PortalResult> {
  const rows = await db.select({ id: campuses.id, name: campuses.name }).from(campuses).orderBy(asc(campuses.name));
  return { status: 200, body: { campuses: rows } };
}

/** A Peer Adviser or Administrator adds a Course. Not audited: it is a Peer Adviser's own action. */
export async function addCourse(db: PortalDb, actor: PortalActor, raw: unknown): Promise<PortalResult> {
  const parsed = addCourseInput.safeParse(raw);
  if (!parsed.success) return portalFail(400, firstIssue(parsed.error));
  const { code, title } = parsed.data;
  const result = await db.insert(courses).values({ code, title, createdByUserId: actor.user.id }).onConflictDoNothing();
  if (!result.meta.changes) return portalFail(409, `${code} is already on the Course list`);
  return { status: 200, body: { ok: true, course: { code, title } } };
}

const courseRow = (code: string) => eq(courses.code, code);

/**
 * Fixes a Course's code or title. Every reference uses `on update cascade`, so
 * a new code reaches the courses taught, Teaching Kits and Advising Requests in
 * the same statement.
 */
export async function updateCourse({ db, adminSubs }: PortalAdminDeps, actor: Actor, raw: unknown): Promise<PortalResult> {
  if (!isAdministrator(actor, adminSubs)) return UNAUTHORIZED;
  const parsed = updateCourseInput.safeParse(raw);
  if (!parsed.success) return portalFail(400, firstIssue(parsed.error));
  const { code, newCode, title } = parsed.data;
  const label = code === newCode ? `${code}: ${title}` : `${code} → ${newCode}`;
  try {
    const [entry] = await db.batch([
      db.insert(adminAuditLog).select(db.select(auditColumns({ actorGoogleSub: actor.googleSub, action: "update_course", targetType: "course", targetId: newCode, targetLabel: label }))
        .from(courses).where(courseRow(code))),
      db.update(courses).set({ code: newCode, title }).where(courseRow(code)),
    ]);
    if (!entry.meta.changes) return COURSE_NOT_FOUND;
  } catch (error) {
    if (constraintFailed(error, "UNIQUE")) return portalFail(409, `${newCode} is already on the Course list; merge the two instead`);
    throw error;
  }
  return { status: 200, body: { ok: true } };
}

/**
 * Merges a duplicate Course into another (§14.3): re-points every reference,
 * then deletes the duplicate, in one batch with the audit entry.
 */
export async function mergeCourse({ db, adminSubs }: PortalAdminDeps, actor: Actor, raw: unknown): Promise<PortalResult> {
  if (!isAdministrator(actor, adminSubs)) return UNAUTHORIZED;
  const parsed = mergeCourseInput.safeParse(raw);
  if (!parsed.success) return portalFail(400, firstIssue(parsed.error));
  const { code, into, reason } = parsed.data;
  if (code === into) return portalFail(400, "Choose two different Courses");
  const found = await db.select({ code: courses.code }).from(courses).where(inArray(courses.code, [code, into]));
  if (found.length !== 2) return COURSE_NOT_FOUND;
  // A Teaching Kit is unique per Course, academic year and term, so two kits for the same term can't be merged here.
  const other = alias(teachingKits, "other");
  const [clash] = await db.select({ academicYear: teachingKits.academicYear, term: teachingKits.term }).from(teachingKits)
    .innerJoin(other, and(eq(other.courseCode, into), eq(other.academicYear, teachingKits.academicYear), eq(other.term, teachingKits.term)))
    .where(eq(teachingKits.courseCode, code)).limit(1);
  const KIT_CLASH = portalFail(409, "Both Courses have a Teaching Kit for the same term");
  if (clash) return KIT_CLASH;
  const bothTaught = db.select({ userId: peerAdviserCourses.userId }).from(peerAdviserCourses).where(eq(peerAdviserCourses.courseCode, into));
  try {
    const [entry] = await db.batch([
      db.insert(adminAuditLog).select(db.select(auditColumns({ actorGoogleSub: actor.googleSub, action: "merge_course", targetType: "course", targetId: code, targetLabel: `${code} → ${into}`, reason }))
        .from(courses).where(courseRow(code))),
      db.delete(peerAdviserCourses).where(and(eq(peerAdviserCourses.courseCode, code), inArray(peerAdviserCourses.userId, bothTaught))),
      db.update(peerAdviserCourses).set({ courseCode: into }).where(eq(peerAdviserCourses.courseCode, code)),
      db.update(teachingKits).set({ courseCode: into }).where(eq(teachingKits.courseCode, code)),
      db.update(advisingRequests).set({ courseCode: into }).where(eq(advisingRequests.courseCode, code)),
      db.delete(courses).where(courseRow(code)),
    ]);
    if (!entry.meta.changes) return COURSE_NOT_FOUND;
  } catch (error) {
    if (constraintFailed(error, "UNIQUE")) return KIT_CLASH;
    if (constraintFailed(error, "FOREIGN KEY")) return COURSE_NOT_FOUND;
    throw error;
  }
  return { status: 200, body: { ok: true } };
}

/** Deletes a Course nothing uses. `on delete restrict` refuses one that is taught, has a Teaching Kit, or is on an Advising Request. */
export async function deleteCourse({ db, adminSubs }: PortalAdminDeps, actor: Actor, raw: unknown): Promise<PortalResult> {
  if (!isAdministrator(actor, adminSubs)) return UNAUTHORIZED;
  const parsed = deleteCourseInput.safeParse(raw);
  if (!parsed.success) return portalFail(400, firstIssue(parsed.error));
  const { code, reason } = parsed.data;
  try {
    const [entry] = await db.batch([
      db.insert(adminAuditLog).select(db.select(auditColumns({ actorGoogleSub: actor.googleSub, action: "delete_course", targetType: "course", targetId: code, targetLabel: code, reason }))
        .from(courses).where(courseRow(code))),
      db.delete(courses).where(courseRow(code)),
    ]);
    if (!entry.meta.changes) return COURSE_NOT_FOUND;
  } catch (error) {
    if (constraintFailed(error, "FOREIGN KEY")) return portalFail(409, `${code} is in use; merge it into another Course instead`);
    throw error;
  }
  return { status: 200, body: { ok: true } };
}

export async function addCampus({ db, adminSubs }: PortalAdminDeps, actor: Actor, raw: unknown): Promise<PortalResult> {
  if (!isAdministrator(actor, adminSubs)) return UNAUTHORIZED;
  const parsed = addCampusInput.safeParse(raw);
  if (!parsed.success) return portalFail(400, firstIssue(parsed.error));
  const { id, name } = parsed.data;
  try {
    await db.batch([
      db.insert(campuses).values({ id, name }),
      db.insert(adminAuditLog).values({ id: crypto.randomUUID(), actorGoogleSub: actor.googleSub, action: "add_campus", targetType: "campus", targetId: id, targetLabel: name }),
    ]);
  } catch (error) {
    if (constraintFailed(error, "UNIQUE")) return portalFail(409, "That Campus already exists");
    throw error;
  }
  return { status: 200, body: { ok: true, campus: { id, name } } };
}
