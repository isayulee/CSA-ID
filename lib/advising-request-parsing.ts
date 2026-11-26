import type { Hour, HourSlot, Weekday } from "@/lib/advising-slots";

// Letters, then digits, then an optional hyphenated number and letters: MATH146, math 146, CHM11-3L.
const COURSE_CODE = /([a-z]+)\s*(\d+(?:-\d+)?[a-z]*)/gi;

/** The first code in the text that is on the Course list, uppercased with spaces removed, or null. */
export function parseCourseCode(courseText: string, knownCourseCodes: ReadonlySet<string>): string | null {
  for (const [, letters, rest] of courseText.matchAll(COURSE_CODE)) {
    const code = `${letters}${rest}`.toUpperCase();
    if (knownCourseCodes.has(code)) return code;
  }
  return null;
}

/** onDate "" means every week; otherwise it is a YYYY-MM-DD date and weekday is that date's. */
export type RequestSlot = HourSlot & { onDate: string };

/** 7 is Sunday: the parser reads it, then drops it. */
type DayOfWeek = Weekday | 7;
type Day = Omit<RequestSlot, "hour">;

const WEEKDAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
// Class-schedule letters: MWF is Monday, Wednesday and Friday; TTh is Tuesday and Thursday.
const COMPACT_DAYS = new Map<string, DayOfWeek>([["m", 1], ["t", 2], ["w", 3], ["th", 4], ["f", 5]]);
const RANGE_WORDS = new Set(["-", "–", "—", "to"]);
const HOURS: readonly Hour[] = [8, 9, 10, 11, 12, 13, 14, 15, 16];

/** 1-based position of the name that the word starts, so "thurs" is 4 in WEEKDAY_NAMES. */
function lookupName(names: readonly string[], word: string): number | null {
  if (word.length < 3) return null;
  const index = names.findIndex((name) => name.startsWith(word));
  return index === -1 ? null : index + 1;
}

/**
 * The days one word names: a weekday name or abbreviation, or compact letters such as MWF.
 * A lone letter is not a day, so the t in "can't" and the m in "a.m." name nothing.
 */
function wordDays(word: string): DayOfWeek[] {
  const named = lookupName(WEEKDAY_NAMES, word);
  if (named !== null) return [named as DayOfWeek];
  if (word.length < 2) return [];
  const days: DayOfWeek[] = [];
  for (let i = 0; i < word.length; ) {
    const letters = word.startsWith("th", i) ? "th" : word[i];
    const day = COMPACT_DAYS.get(letters);
    if (day === undefined) return [];
    days.push(day);
    i += letters.length;
  }
  return days;
}

/** The date's weekday and YYYY-MM-DD, or null when the date does not exist. */
function calendarDay(year: number, month: number, day: number): { weekday: DayOfWeek; onDate: string } | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { weekday: (date.getUTCDay() || 7) as DayOfWeek, onDate: date.toISOString().slice(0, 10) };
}

// Asia/Manila is UTC+8 and has no daylight saving time.
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** A date with no year takes the first year that puts it on or after the submission date in Manila. */
function nextCalendarDay(month: number, day: number, submittedAt: Date) {
  const submittedOn = new Date(submittedAt.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
  const year = Number(submittedOn.slice(0, 4));
  return [year, year + 1]
    .map((candidate) => calendarDay(candidate, month, day))
    .find((date) => date !== null && date.onDate >= submittedOn);
}

// A full date (27-Aug-25), a number with any ordinal ending (27th), a word, or a dash.
const DAY_TOKEN = /(\d{1,2})-([a-z]+)-(\d{4}|\d{2})(?!\d)|\d+[a-z]*|[a-z]+|[-–—]/g;

function readDays(dayText: string, submittedAt: Date): Day[] {
  const days = new Map<string, Day>();
  const add = (day: { weekday: DayOfWeek; onDate: string } | null | undefined) => {
    if (!day || day.weekday === 7) return;
    days.set(`${day.weekday} ${day.onDate}`, { weekday: day.weekday, onDate: day.onDate });
  };

  const tokens = [...dayText.toLowerCase().matchAll(DAY_TOKEN)];
  const word = (i: number) => tokens[i]?.[0] ?? "";
  for (let i = 0; i < tokens.length; i++) {
    const [token, dayOfMonth, monthName, year] = tokens[i];
    if (year !== undefined) {
      const month = lookupName(MONTH_NAMES, monthName);
      if (month !== null) add(calendarDay(Number(year) + (year.length === 2 ? 2000 : 0), month, Number(dayOfMonth)));
      continue;
    }
    const month = lookupName(MONTH_NAMES, token);
    if (month !== null && /^\d/.test(word(i + 1))) {
      add(nextCalendarDay(month, parseInt(word(i + 1)), submittedAt));
      i += 1;
      continue;
    }

    const first = wordDays(token);
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
  return [...days.values()].sort((a, b) => a.weekday - b.weekday || a.onDate.localeCompare(b.onDate));
}

// The first letter of am, pm, nn or noon picks the offset.
const MERIDIEM_OFFSET = new Map([["a", 0], ["p", 12], ["n", 12]]);
const TIME = String.raw`(\d{1,2})(?::(\d{2}))?(?!\d)\s*([ap]\.?\s?m\.?|nn|noon)?`;
const TIME_RANGE = new RegExp(String.raw`(?<![\d:])${TIME}\s*(?:-|–|—|to)\s*${TIME}`, "gi");

/** Minutes after midnight. A bare hour from 1 to 7 is in the afternoon. */
function minutes(hour: string, minute: string | undefined, meridiem: string | undefined): number {
  const h = Number(hour);
  const offset = meridiem === undefined ? undefined : MERIDIEM_OFFSET.get(meridiem[0].toLowerCase());
  const clock = offset !== undefined ? (h % 12) + offset : h >= 1 && h <= 7 ? h + 12 : h;
  return clock * 60 + Number(minute ?? 0);
}

function readHours(timeText: string): Hour[] {
  const ranges = [...timeText.matchAll(TIME_RANGE)].map(([, h1, m1, a1, h2, m2, a2]) => {
    const end = minutes(h2, m2, a2);
    // A bare start takes the end's am or pm when that keeps it first: 1-5pm, 8-10pm, but 11-1pm.
    const shared = a1 === undefined && a2 !== undefined ? minutes(h1, m1, a2) : null;
    return { start: shared !== null && shared <= end ? shared : minutes(h1, m1, a1), end };
  });
  return HOURS.filter((hour) => ranges.some(({ start, end }) => hour * 60 < end && (hour + 1) * 60 > start));
}

/** Slots in weekday, then date, then hour order. No slot at all means the times are unclear. */
export function parseAvailableTimes(input: { dayText: string; timeText: string; submittedAt: Date }): {
  slots: RequestSlot[];
  timesUnclear: boolean;
} {
  const days = readDays(input.dayText, input.submittedAt);
  const hours = readHours(input.timeText);
  const slots = days.flatMap((day) => hours.map((hour) => ({ ...day, hour })));
  return { slots, timesUnclear: slots.length === 0 };
}
