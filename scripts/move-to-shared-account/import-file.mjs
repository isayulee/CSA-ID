// Builds the one import file from the two exports, for lib.sh, with every parent table's rows before its
// children's. D1's remote import was seen rejecting a child first, despite PRAGMA defer_foreign_keys.
//   node import-file.mjs <schema.sql> <data.sql> <data-tables.txt> <import.sql>
// The order comes from the foreign keys in schema.sql, which is loaded into an in-memory SQLite. The result
// is then replayed there with every foreign key checked at once; nothing is written unless that passes.
// Messages name tables only, never values: the data is personal.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DEFER = /^PRAGMA\s+defer_foreign_keys\s*=\s*TRUE$/i;
const INSERT = /^INSERT INTO "((?:[^"]|"")+)"/;
const quoted = (name) => `"${name.replaceAll('"', '""')}"`;

class ImportError extends Error {}

function readText(path) {
  const bytes = readFileSync(path);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) throw new ImportError("an export isn't valid UTF-8");
  if (text.includes("\0")) throw new ImportError("an export holds a NUL character");
  return text;
}

// Splits on the semicolons outside quotes. A doubled quote inside a string reads as two adjacent strings.
// The dump has no comments; one would reach the allowlist below and stop the build.
function statements(sql) {
  const found = [];
  let start = 0;
  let quote = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === ";") {
      found.push(sql.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (quote || sql.slice(start).trim()) throw new ImportError("the data export ends in the middle of a statement");
  return found;
}

function openSchema(schema) {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  try {
    db.exec(schema);
    db.exec("PRAGMA defer_foreign_keys=FALSE");
  } catch {
    throw new ImportError("the structure export doesn't load");
  }
  return db;
}

function parentsByTable(db) {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'")
    .all().map((row) => row.name);
  // SQLite table names ignore case, so a foreign key may spell its parent differently.
  const byLower = new Map(names.map((name) => [name.toLowerCase(), name]));
  return new Map(names.map((name) => {
    const parents = new Set();
    for (const key of db.prepare(`PRAGMA foreign_key_list(${quoted(name)})`).all()) {
      const parent = byLower.get(key.table.toLowerCase());
      if (!parent) throw new ImportError(`${name} references ${key.table}, which the structure export doesn't have`);
      if (parent !== name) parents.add(parent);
    }
    return [name, parents];
  }));
}

function parentsFirst(parents) {
  const order = [];
  const visiting = new Set();
  const visit = (table) => {
    if (order.includes(table)) return;
    if (visiting.has(table)) throw new ImportError(`the foreign keys form a loop through ${table}`);
    visiting.add(table);
    parents.get(table).forEach(visit);
    order.push(table);
  };
  [...parents.keys()].forEach(visit);
  return order;
}

function groupRows(data, tables, parents) {
  for (const table of tables) {
    if (!parents.has(table)) throw new ImportError(`unknown table ${table}: the structure export doesn't have it`);
  }
  const rows = new Map(tables.map((table) => [table, []]));
  for (const statement of statements(data)) {
    if (DEFER.test(statement)) continue;
    const name = INSERT.exec(statement)?.[1].replaceAll('""', '"');
    if (name === undefined) throw new ImportError("the data export holds a statement that isn't an INSERT");
    if (!rows.has(name)) throw new ImportError(`unknown table ${name}: not one of the tables to move`);
    rows.get(name).push(statement);
  }
  return rows;
}

function replay(db, order, rows) {
  for (const table of order) {
    for (const statement of rows.get(table) ?? []) {
      try {
        db.exec(statement);
      } catch (error) {
        throw new ImportError(`a row of ${table} can't be imported (SQLite code ${error.errcode ?? "unknown"})`);
      }
    }
    const held = db.prepare(`SELECT count(*) AS n FROM ${quoted(table)}`).get().n;
    if (held !== (rows.get(table)?.length ?? 0)) throw new ImportError(`the rows of ${table} don't add up`);
  }
}

const [schemaPath, dataPath, tablesPath, outPath] = process.argv.slice(2);
try {
  const schema = readText(schemaPath);
  const tables = readText(tablesPath).split("\n").filter(Boolean);
  const db = openSchema(schema);
  const parents = parentsByTable(db);
  const rows = groupRows(readText(dataPath), tables, parents);
  const order = parentsFirst(parents);
  replay(db, order, rows);
  const inserts = order.flatMap((table) => rows.get(table) ?? []).map((statement) => `${statement};\n`).join("");
  writeFileSync(outPath, `${schema}\nPRAGMA defer_foreign_keys=TRUE;\n${inserts}`);
} catch (error) {
  if (outPath) rmSync(outPath, { force: true });
  // Anything else (a missing file, a full disk) may carry a path but no row values.
  console.error(`import file: ${error instanceof ImportError ? error.message : error.code ?? error.name}`);
  process.exitCode = 1;
}
