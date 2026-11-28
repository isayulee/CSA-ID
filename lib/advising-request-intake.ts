import { z } from "zod";
import type { advisingRequests } from "@/lib/db/schema";

/**
 * A Sheet answer as text. The Apps Script sends cells as they are, so a Student Number may arrive as
 * a number. Text past its column's limit is cut, never rejected, so a row is never lost (§14.4).
 */
const answer = (max: number) =>
  z.union([z.string(), z.number()]).nullish().transform((value) => String(value ?? "").trim().slice(0, max));

/**
 * One intake Sheet row as the Apps Script sends it. Unknown keys, the Student's Signature among them,
 * are dropped here and never reach the database.
 */
export const intakeRow = z.object({
  timestamp: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "timestamp is not a date"),
  email: answer(320).refine((value) => value.length > 0, "email is empty"),
  fullName: answer(200).refine((value) => value.length > 0, "fullName is empty"),
  studentNumber: answer(32),
  programYear: answer(64),
  cardinalMail: answer(320),
  campus: answer(100),
  course: answer(200),
  topic: answer(2000),
  attendees: answer(100),
  availableDays: answer(500),
  availableTimes: answer(500),
  // The three columns the CSA team edits by hand; present on rows sent by the launch import.
  peerAdviser: answer(200),
  scheduledDate: answer(100),
  remarks: answer(2000),
});
export type IntakeRow = z.infer<typeof intakeRow>;

/** The first whole number in the answer, kept within 1 to 50; 1 when there is none. */
export function parseAttendeeCount(text: string) {
  const match = /\d+/.exec(text);
  if (!match) return 1;
  return Math.min(50, Math.max(1, Number(match[0])));
}

type AdvisingRequestStatus = (typeof advisingRequests.$inferSelect)["status"];

// The phrases the CSA team writes in the Remarks column for each of the six statuses.
const STATUS_PHRASES: readonly (readonly [RegExp, AdvisingRequestStatus])[] = [
  [/\bpending\b/i, "pending"],
  [/\bre-?scheduled\b/i, "rescheduled"],
  [/(?<!\bnot )\bdone\b/i, "done"],
  [/\bcancell?ed\b/i, "cancelled"],
  [/\bno (?:available )?peer advis[eo]rs? (?:is )?available\b|\bno available peer advis[eo]r\b/i, "no_peer_adviser_available"],
  [/\bno response from (?:the )?advisee\b/i, "no_response_from_advisee"],
];

/** The status whose phrase comes first in the Remarks text, ignoring case; `pending` when none does (§14.4). */
export function statusFromRemarks(remarks: string): AdvisingRequestStatus {
  let first: { at: number; status: AdvisingRequestStatus } | null = null;
  for (const [phrase, status] of STATUS_PHRASES) {
    const at = remarks.search(phrase);
    if (at !== -1 && (first === null || at < first.at)) first = { at, status };
  }
  return first?.status ?? "pending";
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** The Sheet's Scheduled Date (`27-Aug-25`, or `2025-08-27` from a date cell) as YYYY-MM-DD, or null when it doesn't parse. */
export function parseScheduledDate(text: string): string | null {
  const value = text.trim().toLowerCase();
  let year: number, month: number, day: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const sheet = /^(\d{1,2})-([a-z]{3})-(\d{2}|\d{4})$/.exec(value);
  if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (sheet && MONTHS.includes(sheet[2])) {
    day = Number(sheet[1]);
    month = MONTHS.indexOf(sheet[2]) + 1;
    year = sheet[3].length === 2 ? 2000 + Number(sheet[3]) : Number(sheet[3]);
  } else return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}
