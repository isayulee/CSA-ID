// Reads `wrangler d1 execute --json` output on stdin.
//   node results.mjs tsv     prints every row of every result as tab-separated values
//   node results.mjs report  prints each result that has rows as a table, then fails when a check found a
//                            problem: a result whose first column is "problem", or rows from PRAGMA foreign_key_check
// Exits 2 when the input isn't a query result.
import { readFileSync } from "node:fs";

let sets;
try {
  sets = JSON.parse(readFileSync(0, "utf8"));
} catch {
  sets = null;
}
if (!Array.isArray(sets)) {
  console.error("unreadable query result");
  process.exit(2);
}

if (process.argv[2] === "tsv") {
  for (const set of sets) for (const row of set.results ?? []) console.log(Object.values(row).join("\t"));
  process.exit(0);
}

const cell = (value) => {
  const text = value === null ? "NULL" : String(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
};
let problems = 0;
for (const set of sets) {
  const rows = set.results ?? [];
  if (rows.length === 0) continue;
  const columns = Object.keys(rows[0]);
  if (columns[0] === "problem" || columns.join() === "table,rowid,parent,fkid") problems += rows.length;
  const lines = [columns, ...rows.map((row) => columns.map((column) => cell(row[column])))];
  const widths = columns.map((_, i) => Math.max(...lines.map((line) => line[i].length)));
  console.log("");
  lines.forEach((line, i) => {
    console.log(`    ${line.map((text, j) => text.padEnd(widths[j])).join("  ")}`.trimEnd());
    if (i === 0) console.log(`    ${widths.map((w) => "-".repeat(w)).join("  ")}`);
  });
}
console.log(problems ? `\n  ${problems} problem row(s) found.` : "\n  No problem found.");
process.exit(problems ? 1 : 0);
