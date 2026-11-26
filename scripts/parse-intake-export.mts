// Runs the Advising Request parsers on a CSV export of the intake Sheet and prints how every answer parses.
// It reads only the timestamp, Course, available day and available time columns, prints only those answers,
// and writes nothing. Keep the export outside the repository.
//
//   node scripts/parse-intake-export.mts <export.csv> [--courses MATH146,CS101 | --courses-file codes.txt]
//        [--timestamp <header>] [--course <header>] [--day <header>] [--time <header>]
//
// Without a Course list, the Course column reports the first code-shaped text, unchecked.

import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");

// Node runs this file's TypeScript directly but does not know the "@/" path alias from tsconfig.json.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    return nextResolve(pathToFileURL(path.join(repoRoot, `${specifier.slice(2)}.ts`)).href, context);
  },
});

const { parseAvailableTimes, parseCourseCode } = await import("@/lib/advising-request-parsing");

const WEEKDAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readOptions(argv: string[]) {
  const options: Record<string, string> = {};
  let file: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      file = arg;
      continue;
    }
    const value = argv[++i];
    if (value === undefined) fail(`${arg} needs a value.`);
    options[arg.slice(2)] = value;
  }
  if (!file) fail("Usage: node scripts/parse-intake-export.mts <export.csv> [--courses A,B | --courses-file codes.txt]");
  return { file, options };
}

// RFC 4180 CSV, as Google Sheets exports it: quoted fields may hold commas, quotes ("") and line breaks.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

function findColumn(headers: string[], override: string | undefined, words: string[], label: string): number {
  const lower = headers.map((header) => header.trim().toLowerCase());
  const index = override
    ? lower.indexOf(override.trim().toLowerCase())
    : lower.findIndex((header) => words.every((word) => header.includes(word)));
  if (index === -1) {
    fail(`No ${label} column found. Pass --${label} "<header>". Headers: ${headers.map((h) => JSON.stringify(h)).join(", ")}`);
  }
  return index;
}

function readCourseCodes(options: Record<string, string>): ReadonlySet<string> | null {
  const list = options["courses-file"] ? readFileSync(options["courses-file"], "utf8") : options.courses;
  if (!list) return null;
  return new Set(list.split(/[\s,]+/).filter(Boolean).map((code) => code.toUpperCase()));
}

// Accepts every code, so parseCourseCode returns the first code-shaped text.
const anyCode: ReadonlySet<string> = { has: () => true } as unknown as ReadonlySet<string>;

function countDistinct(values: string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function describeSlots(slots: { weekday: number; hour: number; onDate: string }[]): string {
  const byDay = new Map<string, number[]>();
  for (const slot of slots) {
    const day = slot.onDate ? `${slot.onDate} (${WEEKDAYS[slot.weekday]})` : `every ${WEEKDAYS[slot.weekday]}`;
    byDay.set(day, [...(byDay.get(day) ?? []), slot.hour]);
  }
  return [...byDay]
    .map(([day, hours]) => `${day} ${Math.min(...hours)}:00-${Math.max(...hours) + 1}:00 (${hours.length}h)`)
    .join("; ");
}

const { file, options } = readOptions(process.argv.slice(2));
const [headers, ...rows] = parseCsv(readFileSync(file, "utf8").replace(/^﻿/, ""));
if (!headers) fail("The file is empty.");

const columns = {
  timestamp: findColumn(headers, options.timestamp, ["timestamp"], "timestamp"),
  course: findColumn(headers, options.course, ["course"], "course"),
  day: findColumn(headers, options.day, ["day"], "day"),
  time: findColumn(headers, options.time, ["time"], "time"),
};
if (!options.time && columns.time === columns.timestamp) {
  columns.time = headers.findIndex((h, i) => i !== columns.timestamp && h.toLowerCase().includes("time"));
  if (columns.time === -1) fail('No available time column found. Pass --time "<header>".');
}
const courseCodes = readCourseCodes(options);

const unclear: string[] = [];
const readable: string[] = [];
const unmatchedCourses: string[] = [];
let badTimestamps = 0;

for (const cells of rows) {
  const cell = (index: number) => (cells[index] ?? "").trim();
  const submittedAt = new Date(cell(columns.timestamp));
  if (Number.isNaN(submittedAt.getTime())) {
    badTimestamps++;
    continue;
  }
  const dayText = cell(columns.day);
  const timeText = cell(columns.time);
  const answer = `day: ${JSON.stringify(dayText)}  time: ${JSON.stringify(timeText)}`;
  const { slots, timesUnclear } = parseAvailableTimes({ dayText, timeText, submittedAt });
  if (timesUnclear) unclear.push(answer);
  else readable.push(`${answer}\n      -> ${describeSlots(slots)}`);

  const courseText = cell(columns.course);
  if (!parseCourseCode(courseText, courseCodes ?? anyCode)) unmatchedCourses.push(JSON.stringify(courseText));
}

const parsed = rows.length - badTimestamps;
const percent = (n: number) => (parsed === 0 ? "0%" : `${Math.round((n / parsed) * 100)}%`);

console.log(`Columns: ${Object.entries(columns).map(([name, i]) => `${name} = ${JSON.stringify(headers[i])}`).join(", ")}`);
console.log(`Rows: ${rows.length}${badTimestamps ? ` (${badTimestamps} skipped: timestamp not readable)` : ""}`);
console.log(`Times read as slots: ${readable.length} (${percent(readable.length)})`);
console.log(`Times unclear:       ${unclear.length} (${percent(unclear.length)})`);
console.log(
  `Course ${courseCodes ? "not on the Course list" : "with no code-shaped text"}: ${unmatchedCourses.length} (${percent(unmatchedCourses.length)})`,
);

for (const [title, values] of [
  ["Times unclear, distinct answers", unclear],
  ["Times read as slots, distinct answers (check each reading)", readable],
  [courseCodes ? "Course not on the Course list" : "Course with no code-shaped text", unmatchedCourses],
] as const) {
  console.log(`\n== ${title} ==`);
  for (const [value, count] of countDistinct([...values])) console.log(`${String(count).padStart(4)}x  ${value}`);
}
