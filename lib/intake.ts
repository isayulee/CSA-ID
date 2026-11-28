import "server-only";
import { eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { z } from "zod";
import { parseAvailableTimes, parseCourseCode } from "@/lib/advising-request-parsing";
import { intakeRow, parseAttendeeCount, parseScheduledDate, statusFromRemarks, type IntakeRow } from "@/lib/advising-request-intake";
import { adviseeContacts, advisingRequests, advisingRequestSlots, campuses, courses } from "@/lib/db/schema";
import type * as schema from "@/lib/db/schema";
import { readCapped } from "@/lib/http/mutation-guard";
import { chunk } from "@/lib/portal/batch";

type Db = DrizzleD1Database<typeof schema>;
type BatchItem = Parameters<Db["batch"]>[0][number];

const MAX_INTAKE_BODY_BYTES = 256 * 1024;
const MAX_INTAKE_ROWS = 100;
// D1 on the Workers Free plan allows 50 queries per invocation and counts a batch as one, so rows go 25 to a
// batch. When a batch fails, its rows are retried one at a time, so one bad row can't hold back the others,
// until the queries left run out; rows not written then are reported as failed for the next resend.
const ROWS_PER_BATCH = 25;
const QUERY_BUDGET = 45;
// D1 binds at most 100 parameters per statement: 3 per slot plus the request id.
const SLOTS_PER_STATEMENT = 30;

const json = (body: object, status: number) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function sha256(text: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** Compares digests of both values, so the time taken says nothing about the secret, not even its length. */
async function bearerMatches(header: string | null, secret: string | undefined) {
  if (!secret || header === null || !header.startsWith("Bearer ")) return false;
  const [given, expected] = await Promise.all([sha256(header.slice("Bearer ".length)), sha256(secret)]);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= given[i] ^ expected[i];
  return difference === 0;
}

/**
 * `POST /api/intake/advising-requests` (§14.4). The caller is the intake Sheet's Apps Script, not a
 * browser Session, so instead of `guardMutation` it checks the body size, then the INTAKE_SECRET bearer.
 */
export async function handleIntake(request: Request, deps: { db: Db; secret: string | undefined }) {
  // The declared size is checked before the bearer too, so an oversized request is refused unread.
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_INTAKE_BODY_BYTES) return json({ error: "Request is too large" }, 413);
  if (!(await bearerMatches(request.headers.get("authorization"), deps.secret))) return json({ error: "Unauthorized" }, 401);
  const text = await readCapped(request, MAX_INTAKE_BODY_BYTES);
  if (text === null) return json({ error: "Request is too large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "Request body must be valid JSON" }, 400);
  }
  const rows = z.array(z.unknown()).max(MAX_INTAKE_ROWS).safeParse(body);
  if (!rows.success) return json({ error: `Send a JSON array of at most ${MAX_INTAKE_ROWS} rows` }, 400);
  return json(await importAdvisingRequests(deps.db, rows.data), 200);
}

type Outcome = { received: number; imported: number; duplicates: number; rejected: { row: number; error: string }[]; failed: number[] };

/** SHA-256 hex of the form's Timestamp and Email Address, so resending a row finds the request it already made. */
async function intakeKey(submittedAtMs: number, email: string) {
  const digest = await sha256(`${new Date(submittedAtMs).toISOString()}
${email.toLowerCase()}`);
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * One row's statements. Only the first can write when the row is new: the contact and slots are
 * `insert ... select` from the new request row, so a resent row writes nothing and fails nothing.
 */
function rowStatements(db: Db, id: string, key: string, row: IntakeRow, refs: { campusIds: Map<string, string>; courseCodes: Set<string> }): BatchItem[] {
  const submittedAtMs = Date.parse(row.timestamp);
  const times = parseAvailableTimes({ dayText: row.availableDays, timeText: row.availableTimes, submittedAt: new Date(submittedAtMs) });
  return [
    db.insert(advisingRequests).values({
      id,
      intakeKey: key,
      submittedAt: Math.floor(submittedAtMs / 1000),
      campusText: row.campus,
      campusId: refs.campusIds.get(row.campus.toLowerCase()) ?? null,
      courseText: row.course,
      courseCode: parseCourseCode(row.course, refs.courseCodes),
      topic: row.topic,
      attendeeCount: parseAttendeeCount(row.attendees),
      availableDayText: row.availableDays,
      availableTimeText: row.availableTimes,
      timesUnclear: times.timesUnclear,
      status: statusFromRemarks(row.remarks),
      scheduledOn: parseScheduledDate(row.scheduledDate),
      // Kept as text; a claimant is never guessed from a name.
      sheetPeerAdviser: row.peerAdviser || null,
      sheetRemarks: row.remarks || null,
    }).onConflictDoNothing({ target: advisingRequests.intakeKey }),
    // The columns follow the table's order, because an INSERT ... SELECT lists every column.
    db.insert(adviseeContacts).select(db.select({
      requestId: advisingRequests.id,
      fullName: sql<string>`${row.fullName}`.as("full_name"),
      studentNumber: sql<string>`${row.studentNumber}`.as("student_number"),
      programYear: sql<string>`${row.programYear}`.as("program_year"),
      email: sql<string>`${row.email}`.as("email"),
      cardinalMail: sql<string>`${row.cardinalMail}`.as("cardinal_mail"),
    }).from(advisingRequests).where(eq(advisingRequests.id, id))),
    // Joins the slots onto the new request row, so they too are written only when the request is.
    ...chunk(times.slots, SLOTS_PER_STATEMENT).map((slots) => db.insert(advisingRequestSlots).select(db.select({
      requestId: advisingRequests.id,
      weekday: sql<number>`slot.column1`.as("weekday"),
      onDate: sql<string>`slot.column2`.as("on_date"),
      hour: sql<number>`slot.column3`.as("hour"),
    }).from(advisingRequests)
      .innerJoin(sql`(values ${sql.join(slots.map((slot) => sql`(${slot.weekday}, ${slot.onDate}, ${slot.hour})`), sql`, `)}) as slot`, sql`true`)
      .where(eq(advisingRequests.id, id)))),
  ];
}

/**
 * Validates each row and writes the valid ones. A row that fails validation is reported and skipped; a row
 * that D1 refuses is reported as failed, and the Apps Script's next resend retries it.
 */
async function importAdvisingRequests(db: Db, rows: unknown[]): Promise<Outcome> {
  const outcome: Outcome = { received: rows.length, imported: 0, duplicates: 0, rejected: [], failed: [] };
  const valid: { index: number; row: IntakeRow }[] = [];
  rows.forEach((raw, index) => {
    const parsed = intakeRow.safeParse(raw);
    if (parsed.success) valid.push({ index, row: parsed.data });
    else outcome.rejected.push({ row: index, error: parsed.error.issues.map((issue) => issue.message).join("; ") });
  });
  if (valid.length === 0) return outcome;

  const [campusRows, courseRows] = await db.batch([
    db.select({ id: campuses.id, name: campuses.name }).from(campuses),
    db.select({ code: courses.code }).from(courses),
  ]);
  const refs = {
    campusIds: new Map(campusRows.map((campus) => [campus.name.toLowerCase(), campus.id])),
    courseCodes: new Set(courseRows.map((course) => course.code)),
  };

  type Pending = { index: number; statements: BatchItem[] };
  const pending: Pending[] = [];
  for (const { index, row } of valid) {
    pending.push({ index, statements: rowStatements(db, crypto.randomUUID(), await intakeKey(Date.parse(row.timestamp), row.email), row, refs) });
  }
  let queries = 1; // the Campus and Course lookup
  /** Writes the rows in one batch and counts each as imported or duplicate; false when D1 refuses the batch. */
  const write = async (group: Pending[]) => {
    queries++;
    const statements = group.flatMap((entry) => entry.statements);
    try {
      const results = await db.batch(statements as [BatchItem, ...BatchItem[]]);
      let at = 0;
      for (const entry of group) {
        if ((results[at] as D1Result).meta.changes) outcome.imported++;
        else outcome.duplicates++;
        at += entry.statements.length;
      }
      return true;
    } catch (error) {
      console.error("Advising Request intake batch failed", error);
      return false;
    }
  };
  const groups = chunk(pending, ROWS_PER_BATCH);
  for (const [i, group] of groups.entries()) {
    if (await write(group)) continue;
    // Keep one query for each group still to come.
    for (const entry of group) {
      if (queries >= QUERY_BUDGET - (groups.length - i - 1) || !(await write([entry]))) outcome.failed.push(entry.index);
    }
  }
  return outcome;
}
