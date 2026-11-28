import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { HOURS } from "@/lib/advising-slots";
import { courses, peerAdviserAvailability, peerAdviserCourses, peerAdvisers } from "@/lib/db/schema";
import { portalFail, type PortalActor, type PortalDb, type PortalResult } from "./access";
import { chunk, constraintFailed } from "./batch";
import { courseCode } from "./courses";
import { loadCampus } from "./peer-advisers";

// A Peer Adviser's own Campus, courses taught and Availability (§14.2, /portal/me).
// Every function reads and writes only the Session User's rows: none takes a User ID from the request.

export const campusInput = z.object({ campusId: z.string().min(2).max(32) });
const coursesInput = z.object({ courseCodes: z.array(courseCode).max(50) });
const availabilityInput = z.object({
  slots: z.array(z.object({ weekday: z.number().int().min(1).max(6), hour: z.number().int().min(HOURS[0]).max(HOURS[HOURS.length - 1]) })).max(6 * HOURS.length),
});

const ONLY_PEER_ADVISERS = portalFail(403, "Only Peer Advisers have a Campus, courses taught and Availability");
const OK = { status: 200, body: { ok: true } };
const own = (actor: PortalActor) => eq(peerAdvisers.userId, actor.user.id);

/** The Session User's Campus, courses taught and Availability; null for an Administrator who isn't a Peer Adviser. */
export async function getMySettings(db: PortalDb, actor: PortalActor): Promise<PortalResult> {
  const userId = actor.user.id;
  const [[row], taught, slots] = await Promise.all([
    db.select({ campusId: peerAdvisers.campusId }).from(peerAdvisers).where(own(actor)).limit(1),
    db.select({ code: peerAdviserCourses.courseCode }).from(peerAdviserCourses).where(eq(peerAdviserCourses.userId, userId)).orderBy(asc(peerAdviserCourses.courseCode)),
    db.select({ weekday: peerAdviserAvailability.weekday, hour: peerAdviserAvailability.hour }).from(peerAdviserAvailability)
      .where(eq(peerAdviserAvailability.userId, userId)).orderBy(asc(peerAdviserAvailability.weekday), asc(peerAdviserAvailability.hour)),
  ]);
  if (!row) return { status: 200, body: { peerAdviser: null } };
  return { status: 200, body: { peerAdviser: { campusId: row.campusId, courseCodes: taught.map((c) => c.code), availability: slots } } };
}

export async function saveMyCampus(db: PortalDb, actor: PortalActor, raw: unknown): Promise<PortalResult> {
  const parsed = campusInput.safeParse(raw);
  if (!parsed.success || !(await loadCampus(db, parsed.data.campusId))) return portalFail(400, "Choose a Campus from the list");
  try {
    const result = await db.update(peerAdvisers).set({ campusId: parsed.data.campusId }).where(own(actor));
    return result.meta.changes ? OK : ONLY_PEER_ADVISERS;
  } catch (error) {
    // The Campus was removed after the check above.
    if (constraintFailed(error, "FOREIGN KEY")) return portalFail(400, "Choose a Campus from the list");
    throw error;
  }
}

/**
 * Replaces some of the Session User's rows in one batch. The inserts reference the
 * `peer_advisers` row, so a User revoked meanwhile fails on the foreign key. A Course
 * merged or deleted meanwhile fails on it too; the User is still a Peer Adviser then.
 */
async function replaceOwnRows(db: PortalDb, actor: PortalActor, statements: (userId: string) => Parameters<PortalDb["batch"]>[0]) {
  const [row] = await db.select({ userId: peerAdvisers.userId }).from(peerAdvisers).where(own(actor)).limit(1);
  if (!row) return ONLY_PEER_ADVISERS;
  try {
    await db.batch(statements(row.userId));
  } catch (error) {
    if (!constraintFailed(error, "FOREIGN KEY")) throw error;
    const [still] = await db.select({ userId: peerAdvisers.userId }).from(peerAdvisers).where(own(actor)).limit(1);
    return still ? portalFail(409, "The Course list changed while you were saving; reload and try again") : ONLY_PEER_ADVISERS;
  }
  return OK;
}

export async function saveMyCourses(db: PortalDb, actor: PortalActor, raw: unknown): Promise<PortalResult> {
  const parsed = coursesInput.safeParse(raw);
  if (!parsed.success) return portalFail(400, "Choose up to 50 Courses from the list");
  const codes = [...new Set(parsed.data.courseCodes)];
  const known = codes.length ? await db.select({ code: courses.code }).from(courses).where(inArray(courses.code, codes)) : [];
  const unknown = codes.filter((code) => !known.some((k) => k.code === code));
  if (unknown.length) return portalFail(400, `Not on the Course list: ${unknown.join(", ")}`);
  return replaceOwnRows(db, actor, (userId) => [
    db.delete(peerAdviserCourses).where(eq(peerAdviserCourses.userId, userId)),
    ...chunk(codes, 40).map((part) => db.insert(peerAdviserCourses).values(part.map((courseCode) => ({ userId, courseCode })))),
  ]);
}

/** Saves the weekly Availability grid: 1-hour slots, Monday to Saturday, 08:00 to 17:00. */
export async function saveMyAvailability(db: PortalDb, actor: PortalActor, raw: unknown): Promise<PortalResult> {
  const parsed = availabilityInput.safeParse(raw);
  if (!parsed.success) return portalFail(400, "Choose 1-hour slots from Monday to Saturday, 08:00 to 17:00");
  const slots = [...new Map(parsed.data.slots.map((s) => [`${s.weekday}-${s.hour}`, s])).values()];
  return replaceOwnRows(db, actor, (userId) => [
    db.delete(peerAdviserAvailability).where(eq(peerAdviserAvailability.userId, userId)),
    ...chunk(slots, 30).map((part) => db.insert(peerAdviserAvailability).values(part.map((slot) => ({ userId, ...slot })))),
  ]);
}
