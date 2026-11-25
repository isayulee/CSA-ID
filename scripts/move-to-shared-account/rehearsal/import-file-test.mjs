// Checks import-file.mjs on exports wrangler's local dump doesn't produce: raw newlines, loops, orphans.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../import-file.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "import-file-"));
const at = (name) => join(dir, name);
let failed = 0;
let passed = 0;
function check(what, ok) {
  if (ok) passed++;
  else { failed++; console.log(`  FAIL  ${what}`); }
}

const SCHEMA = `PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE "kid" (id TEXT PRIMARY KEY, p TEXT REFERENCES Parent(id));
CREATE TABLE "sessions" (id TEXT PRIMARY KEY, p TEXT REFERENCES parent(id));
CREATE TABLE "parent" (id TEXT PRIMARY KEY, v TEXT);
CREATE TRIGGER t AFTER UPDATE ON parent BEGIN SELECT 1; END;
`;
function build(schema, data, tables = "kid\nparent\n") {
  writeFileSync(at("schema.sql"), schema);
  writeFileSync(at("data.sql"), data);
  writeFileSync(at("tables.txt"), tables);
  writeFileSync(at("import.sql"), "stale");
  const run = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", script,
    at("schema.sql"), at("data.sql"), at("tables.txt"), at("import.sql")], { encoding: "utf8" });
  return { ok: run.status === 0, err: run.stderr, sql: existsSync(at("import.sql")) ? readFileSync(at("import.sql"), "utf8") : null };
}
function rejects(what, result, message) {
  check(`${what}: rejected`, !result.ok && result.sql === null);
  check(`${what}: says why (${result.err.trim()})`, result.err.includes(message));
  check(`${what}: never prints a value`, !result.err.includes("secret"));
}

const value = `a;\r\nINSERT INTO "kid" VALUES('x');\nPRAGMA defer_foreign_keys=TRUE;\n-- "\` /* it's 🙂 */`;
const DATA = `PRAGMA defer_foreign_keys=TRUE;
INSERT INTO "kid" ("id","p") VALUES('k1','p1');
INSERT INTO "parent" ("id","v") VALUES('p1','${value.replaceAll("'", "''")}');
INSERT INTO "parent" ("id","v") VALUES('p2','');
`;
const good = build(SCHEMA, DATA);
check("raw newlines, quotes and SQL-looking text: accepted", good.ok);
const db = new DatabaseSync(":memory:");
db.exec((good.sql ?? "").replace(/PRAGMA defer_foreign_keys=TRUE;\n(?=CREATE)/, "").replace(/PRAGMA defer_foreign_keys=TRUE;\n(?=INSERT)/, ""));
check("parents first with the pragmas stripped", db.prepare("SELECT count(*) AS n FROM kid").get().n === 1);
check("the value is untouched", db.prepare("SELECT v FROM parent WHERE id = 'p1'").get().v === value);
check("rows keep their order within a table", db.prepare("SELECT group_concat(id) AS ids FROM (SELECT id FROM parent ORDER BY rowid)").get().ids === "p1,p2");
check("no Session rows", db.prepare("SELECT count(*) AS n FROM sessions").get().n === 0);

rejects("a table the structure lacks", build(SCHEMA, DATA, "kid\nparent\nghost\n"), "unknown table ghost");
rejects("rows of an unlisted table", build(SCHEMA, `INSERT INTO "ghost" VALUES('secret');`), "unknown table ghost");
rejects("Session rows", build(SCHEMA, `INSERT INTO "sessions" VALUES('secret','p1');`), "unknown table sessions");
rejects("a missing parent table", build(`CREATE TABLE "kid" (id TEXT, p TEXT REFERENCES ghost(id));`, "", "kid\n"), "references ghost");
rejects("a loop", build(`CREATE TABLE "kid" (id TEXT PRIMARY KEY, p TEXT REFERENCES parent(id));
CREATE TABLE "parent" (id TEXT PRIMARY KEY, v TEXT REFERENCES kid(id));`, ""), "loop");
rejects("a row whose parent row is gone", build(SCHEMA, `INSERT INTO "kid" VALUES('secret','gone');`), "a row of kid can't be imported");
rejects("a statement that isn't an INSERT", build(SCHEMA, `DELETE FROM "kid" WHERE id = 'secret';`), "isn't an INSERT");
rejects("a cut-off export", build(SCHEMA, `INSERT INTO "kid" VALUES('secret`), "middle of a statement");
rejects("a cut-off structure", build(`CREATE TABLE "kid" (id`, ""), "doesn't load");
rejects("a defer pragma that ends the structure", build(`${SCHEMA}PRAGMA defer_foreign_keys=TRUE;\n`, `INSERT INTO "kid" VALUES('secret','gone');`), "a row of kid");

rmSync(dir, { recursive: true, force: true });
console.log(`import file: ${passed} checks pass${failed ? `, ${failed} FAIL` : ""}`);
process.exit(failed ? 1 : 0);
