// Measures the rows the cutover writes, as D1 meters them: workerd's SQLite counts every table row and every
// index entry an INSERT writes. It reports 0 for DROP TABLE, so the upper bound also counts each dropped row and
// index entry as written.
//   node writes.mjs OLD_MIGRATIONS_DIR SEED_SQL CUTOVER_SQL CLEANUP_SQL
// Applies the old migrations and the seed to an in-memory local D1 (Miniflare, as the tests use), then runs
// cutover.sql and cleanup.sql one statement at a time and adds up meta.rows_written.
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const [oldDir, seedFile, cutoverFile, cleanupFile] = process.argv.slice(2);
const { Miniflare } = createRequire(import.meta.url)("miniflare");

// Our own files only: a statement ends with ";" at the end of a line, except inside CREATE TRIGGER ... END;
function statements(sql) {
  const out = [];
  let current = [];
  let trigger = false;
  for (const raw of sql.replace(/\r/g, "").split("\n")) {
    const line = raw.replace(/--> statement-breakpoint$/, "");
    if (current.length === 0 && (/^\s*--/.test(line) || line.trim() === "")) continue;
    if (current.length === 0) trigger = /^CREATE TRIGGER/i.test(line);
    current.push(line);
    if (trigger ? /^END;\s*$/.test(line.trim()) : /;\s*$/.test(line)) {
      out.push(current.join("\n"));
      current = [];
    }
  }
  if (current.join("").trim()) out.push(current.join("\n"));
  return out;
}

const mf = new Miniflare({
  cf: false, // no request.cf to fetch from Cloudflare, and no .wrangler/cache left in the working directory
  workers: [{ modules: true, script: "export default { fetch() { return new Response('ok') } }", d1Databases: { DB: "writes" } }],
});
try {
  const db = await mf.getD1Database("DB");
  const run = async (file) => {
    let written = 0;
    for (const statement of statements(readFileSync(file, "utf8"))) written += (await db.prepare(statement).run()).meta.rows_written ?? 0;
    return written;
  };
  // wrangler keeps its migration log in d1_migrations; write it the way `wrangler d1 migrations apply` does.
  await db.prepare("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)").run();
  for (const file of readdirSync(oldDir).filter((f) => f.endsWith(".sql")).sort()) {
    await run(join(oldDir, file));
    await db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").bind(file).run();
  }
  await run(seedFile);

  // What the drops would write if D1 metered them: every row and index entry of each table the cutover drops.
  const carried = ["users", "profiles", "reserved_slugs", "draft_social_links", "published_profiles", "published_social_links", "abuse_reports", "admin_audit_log"];
  let carriedRows = 0;
  let dropBound = 0;
  for (const table of [...carried, "sessions"]) {
    const rows = (await db.prepare(`SELECT count(*) AS n FROM "${table}"`).first()).n;
    const indexes = (await db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'index' AND tbl_name = ?").bind(table).first()).n;
    if (table !== "sessions") carriedRows += rows;
    dropBound += rows * (1 + indexes);
  }

  const cutover = await run(cutoverFile);
  const cleanup = await run(cleanupFile);
  const bound = cutover + cleanup + dropBound + carriedRows + 1; // + the old_* copies cleanup drops, and old_session_count
  console.log(`rows carried            ${carriedRows}`);
  console.log(`cutover.sql wrote       ${cutover} rows (${(cutover / carriedRows).toFixed(1)} per row carried)`);
  console.log(`cleanup.sql wrote       ${cleanup} rows`);
  console.log(`upper bound with drops  ${bound} rows (${(bound / carriedRows).toFixed(1)} per row carried), ${((100 * bound) / 100000).toFixed(2)}% of D1 Free's 100,000 a day`);
} finally {
  await mf.dispose();
}
