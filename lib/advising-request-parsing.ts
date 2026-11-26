import { HOURS, type Hour, type HourSlot, type Weekday } from "@/lib/advising-slots";

// Letters, digits, an optional hyphenated number, then an optional single letter: MATH146, math 146, CHM11-3L, COE60-L.
const COURSE_CODE = /\b([a-z]+)\s*(\d+(?:-\d+)?(?:-?[a-z]\b)?)/gi;
const LAB = /\blab(?:oratory)?\b/i;

/**
 * The first code in the text that is on the Course list, uppercased with spaces removed, or null.
 * "CHM11-3 Lab" reads as CHM11-3L when that Course exists.
 */
export function parseCourseCode(courseText: string, knownCourseCodes: ReadonlySet<string>): string | null {
  const mentionsLab = LAB.test(courseText);
  for (const [, letters, rest] of courseText.matchAll(COURSE_CODE)) {
    const code = `${letters}${rest}`.toUpperCase();
    if (mentionsLab && knownCourseCodes.has(`${code}L`)) return `${code}L`;
    if (knownCourseCodes.has(code)) return code;
  }
  return null;
}

/** onDate "" means every week. Otherwise it is a YYYY-MM-DD date, and weekday is that date's. */
export type AdvisingRequestSlot = HourSlot & { onDate: string };

/** 7 is Sunday. The parser reads it, then drops it. */
type DayOfWeek = Weekday | 7;
type ReadDay = { weekday: DayOfWeek; onDate: string };
type Day = Omit<AdvisingRequestSlot, "hour">;

const WEEKDAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
// Meeting-day letters, two-letter ones first: MWF is Monday, Wednesday and Friday; TTh and Tu-Th are Tuesday and Thursday.
const DAY_LETTERS: readonly (readonly [string, DayOfWeek])[] = [
  ["th", 4], ["tu", 2], ["m", 1], ["t", 2], ["w", 3], ["f", 5],
];
const DASHES = ["-", "–", "—"];
const RANGE_WORDS = new Set([...DASHES, "to"]);
const FILLER_WORDS = new Set(["and", "or", "only", "every", "on", "the"]);

/** 1-based position of the name that the word starts, so "thurs" is 4 in WEEKDAY_NAMES. */
function lookupName(names: readonly string[], word: string): number | null {
  if (word.length < 3) return null;
  const index = names.findIndex((name) => name.startsWith(word));
  return index === -1 ? null : index + 1;
}

/** The days one word names: a weekday name or abbreviation, or meeting-day letters such as MWF. */
function wordDays(word: string): DayOfWeek[] {
  const named = lookupName(WEEKDAY_NAMES, word);
  if (named !== null) return [named as DayOfWeek];
  const days: DayOfWeek[] = [];
  for (let i = 0; i < word.length; ) {
    const entry = DAY_LETTERS.find(([letters]) => word.startsWith(letters, i));
    if (entry === undefined) return [];
    days.push(entry[1]);
    i += entry[0].length;
  }
  return days;
}

/** The date's weekday and YYYY-MM-DD, or null when the date does not exist. */
function calendarDay(year: number, month: number, day: number): ReadDay | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { weekday: (date.getUTCDay() || 7) as DayOfWeek, onDate: date.toISOString().slice(0, 10) };
}

// Asia/Manila is UTC+8 and has no daylight saving time.
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const HALF_YEAR_MS = 183 * 24 * 60 * 60 * 1000;

/** A date with no year is the one within half a year on or after the submission date in Manila, or null. */
function upcomingCalendarDay(month: number, day: number, submittedAt: Date): ReadDay | null {
  const manila = submittedAt.getTime() + MANILA_OFFSET_MS;
  const submittedOn = new Date(manila).toISOString().slice(0, 10);
  const latest = new Date(manila + HALF_YEAR_MS).toISOString().slice(0, 10);
  const year = Number(submittedOn.slice(0, 4));
  return (
    [year, year + 1]
      .map((candidate) => calendarDay(candidate, month, day))
      .find((date) => date !== null && date.onDate >= submittedOn && date.onDate <= latest) ?? null
  );
}

// A full date (27-Aug-25), a number with any ending (27th, 2025), a word, or a dash.
const DAY_TOKEN = new RegExp(String.raw`(\d{1,2})-([a-z]+)-(\d{4}|\d{2})(?!\d)|\d+[a-z]*|[a-z]+|[${DASHES.join("")}]`, "g");

/** The days in the answer, or null when any word in it can't be read. */
function readDays(dayText: string, submittedAt: Date): Day[] | null {
  const days = new Map<string, ReadDay>();
  const add = (day: ReadDay) => days.set(`${day.weekday} ${day.onDate}`, day);

  const tokens = [...dayText.toLowerCase().matchAll(DAY_TOKEN)];
  const word = (i: number) => tokens[i]?.[0] ?? "";
  for (let i = 0; i < tokens.length; i++) {
    const [token, dayOfMonth, monthName, year] = tokens[i];
    if (year !== undefined) {
      const month = lookupName(MONTH_NAMES, monthName);
      const date = month === null ? null : calendarDay(Number(year) + (year.length === 2 ? 2000 : 0), month, Number(dayOfMonth));
      if (date === null) return null;
      add(date);
      continue;
    }

    const month = lookupName(MONTH_NAMES, token);
    if (month !== null && /^\d+(?:st|nd|rd|th)?$/.test(word(i + 1))) {
      const day = parseInt(word(i + 1));
      const statedYear = /^\d{4}$/.test(word(i + 2)) ? Number(word(i + 2)) : null;
      const date = statedYear === null ? upcomingCalendarDay(month, day, submittedAt) : calendarDay(statedYear, month, day);
      if (date === null) return null;
      add(date);
      i += statedYear === null ? 1 : 2;
      continue;
    }

    if (FILLER_WORDS.has(token)) continue;
    const first = wordDays(token);
    if (first.length === 0) return null;
    const last = wordDays(word(i + 2));
    if (first.length === 1 && RANGE_WORDS.has(word(i + 1)) && last.length === 1) {
      for (let weekday = first[0]; ; weekday = ((weekday % 7) + 1) as DayOfWeek) {
        add({ weekday, onDate: "" });
        if (weekday === last[0]) break;
      }
      i += 2;
    } else {
      first.forEach((weekday) => add({ weekday, onDate: "" }));
    }
  }

  const read = [...days.values()].filter((day): day is Day => day.weekday !== 7);
  // "Wed, 27-Aug-25" names one date, not every Wednesday as well.
  const datedWeekdays = new Set(read.filter((day) => day.onDate !== "").map((day) => day.weekday));
  return read
    .filter((day) => day.onDate !== "" || !datedWeekdays.has(day.weekday))
    .sort((a, b) => a.weekday - b.weekday || a.onDate.localeCompare(b.onDate));
}

// The first letter of am, pm, nn or noon picks the offset.
const MERIDIEM_OFFSET = new Map([["a", 0], ["p", 12], ["n", 12]]);
const TIME = String.raw`(\d{1,2})(?::(\d{2}))?(?!\d)\s*([ap]\.?\s?m\.?|nn|noon)?`;
const TIME_RANGE = new RegExp(String.raw`(?<![\d:])${TIME}\s*(?:${DASHES.join("|")}|to)\s*${TIME}`, "gi");
const BETWEEN_RANGES = /^(?:[\s,/&.]|\band\b|\bor\b|\bonly\b)*$/i;

/** Minutes after midnight. A bare hour from 1 to 7 is in the afternoon. */
function minutes(hour: string, minute: string | undefined, meridiem: string | undefined): number {
  const h = Number(hour);
  const offset = meridiem === undefined ? undefined : MERIDIEM_OFFSET.get(meridiem[0].toLowerCase());
  const clock = offset !== undefined ? (h % 12) + offset : h >= 1 && h <= 7 ? h + 12 : h;
  return clock * 60 + Number(minute ?? 0);
}

/** The hours the ranges cover, or null when anything besides ranges and separators is in the answer. */
function readHours(timeText: string): Hour[] | null {
  if (!BETWEEN_RANGES.test(timeText.replace(TIME_RANGE, " "))) return null;
  const ranges = [...timeText.matchAll(TIME_RANGE)].map(([, h1, m1, a1, h2, m2, a2]) => {
    const end = minutes(h2, m2, a2);
    // A bare start takes the end's am or pm when that keeps it first: 1-5pm, 8-10pm, but 11-1pm.
    const shared = a1 === undefined && a2 !== undefined ? minutes(h1, m1, a2) : null;
    return { start: shared !== null && shared <= end ? shared : minutes(h1, m1, a1), end };
  });
  return HOURS.filter((hour) => ranges.some(({ start, end }) => hour * 60 < end && (hour + 1) * 60 > start));
}

/**
 * Slots in weekday, then date, then hour order. The times are unclear when either answer has a word
 * the parser can't read, because skipping it could turn "except Friday" into Friday, or when no slot results.
 */
export function parseAvailableTimes(input: { dayText: string; timeText: string; submittedAt: Date }): {
  slots: AdvisingRequestSlot[];
  timesUnclear: boolean;
} {
  const days = readDays(input.dayText, input.submittedAt);
  const hours = readHours(input.timeText);
  const slots = days && hours ? days.flatMap((day) => hours.map((hour) => ({ ...day, hour }))) : [];
  return { slots, timesUnclear: slots.length === 0 };
}
