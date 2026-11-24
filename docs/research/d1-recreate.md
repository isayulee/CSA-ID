# D1: recreating the live database

**Summary.** On the Workers Free plan you can do either option without paying. Going over a Free limit makes queries fail. It never starts billing. A Free account can hold 10 D1 databases, 500 MB each and 5 GB in total, and it can write 100,000 rows a day. Time Travel is always on. On Free it can restore the database to any minute in the last 7 days, but only in place: the restore overwrites the database it came from. `wrangler d1 export` copies the `d1_migrations` table along with the app tables. `wrangler d1 migrations apply` checks only whether each file name is already in `d1_migrations`. On D1, `PRAGMA foreign_keys=OFF` does nothing, so `DROP TABLE` on a parent table still runs its `ON DELETE CASCADE`. **Recommendation: (a) in place.** Do it as one `wrangler d1 execute --remote --file` run. That file drops the old tables (child tables first), creates the new schema, reloads the rows parent-first and records the new migration name. Before you start, save a full local export and note the Time Travel bookmark. Wrangler says a failed file run puts the database back as it was. If the run succeeds but the data is wrong, Time Travel can undo it within 7 days. The live site and every preview switch at the same moment, and nothing needs a deploy. Option (b) keeps the old database untouched as a fallback. But it needs a deploy, a new database name and changes to the scripts. And in this repo's dev → main flow, `dev`'s preview and the live site would run on different databases until the release merges. Pick (b) only if the owner wants a fallback that does not depend on Time Travel and can merge the release right after the import.

Sources read on 2026-11-24. Docs come from developers.cloudflare.com as Markdown. Wrangler source comes from the tag `wrangler@4.159.0`, the version this repo installs. Some claims were also checked by local experiments: Miniflare on wrangler 4.159.0, in a scratch folder, with no remote calls. Those are marked **[local test]**. A local result shows what Miniflare does. It is not proof of what hosted D1 does.

## 1. Free plan limits

| Limit | Workers Free | Source |
| --- | --- | --- |
| Max database size | 500 MB | [limits](https://developers.cloudflare.com/d1/platform/limits/) |
| Max storage per account | 5 GB | [limits](https://developers.cloudflare.com/d1/platform/limits/) |
| Databases per account | 10 | [limits](https://developers.cloudflare.com/d1/platform/limits/), [pricing](https://developers.cloudflare.com/d1/platform/pricing/) |
| Rows read | 5 million per day | [pricing](https://developers.cloudflare.com/d1/platform/pricing/) |
| Rows written | 100,000 per day | [pricing](https://developers.cloudflare.com/d1/platform/pricing/) |
| Queries per Worker invocation | 50 | [limits](https://developers.cloudflare.com/d1/platform/limits/) |
| Bound parameters per query | 100 | [limits](https://developers.cloudflare.com/d1/platform/limits/) |
| Max SQL statement length | 100,000 bytes (100 KB) | [limits](https://developers.cloudflare.com/d1/platform/limits/) |
| Max string, BLOB or row size | 2,000,000 bytes (2 MB) | [limits](https://developers.cloudflare.com/d1/platform/limits/) |
| Max query duration | 30 seconds (also caps a whole batch call) | [limits](https://developers.cloudflare.com/d1/platform/limits/) |
| Max query result size | 50 MB, from 2026-11-04. REST import and export are exempt. | [limits](https://developers.cloudflare.com/d1/platform/limits/) |
| Max import file (`d1 execute`) | 5 GB | [limits](https://developers.cloudflare.com/d1/platform/limits/) |
| Time Travel window | 7 days | [limits](https://developers.cloudflare.com/d1/platform/limits/) |
| Columns per table | 100 | [limits](https://developers.cloudflare.com/d1/platform/limits/) |

- **Statements per `batch()`:** the docs give no maximum. Each statement in a batch must meet the per-query limits. The whole batch counts as one query toward the 50-per-invocation limit. The docs give the example of a batch of 2,000 statements that runs in one invocation. ([limits](https://developers.cloudflare.com/d1/platform/limits/))
- A batch is one SQL transaction. If one statement fails, the whole batch is rolled back. ([D1 Database API](https://developers.cloudflare.com/d1/worker-api/d1-database/))
- **Hitting a daily limit:** "you will not be able to run queries against D1. D1 API will return errors." ([pricing FAQ](https://developers.cloudflare.com/d1/platform/pricing/)) The error text says the account "has exceeded D1's free tier daily row write limit… wait until tomorrow (midnight UTC)". ([debug D1](https://developers.cloudflare.com/d1/observability/debug-d1/)) Free daily limits reset at 00:00 UTC. ([pricing](https://developers.cloudflare.com/d1/platform/pricing/)) Nothing is billed. Lifting the limits means upgrading by choice.
- **Storage full:** once the 5 GB is used, you must delete data or databases before you can insert rows or create tables, indexes or triggers. ([pricing FAQ](https://developers.cloudflare.com/d1/platform/pricing/))
- **Limits are per account.** Wrangler and dashboard queries count too, "including inserting existing data into a new database". Each index adds a written row to every write that touches its column. ([pricing](https://developers.cloudflare.com/d1/platform/pricing/)) An import therefore writes about (rows) × (1 + indexes on the table) rows. Those writes share the day's 100,000 with the live site.
- DDL such as `CREATE` or `DROP` "may contribute to a mix of read rows and write rows". The docs give no exact count. ([pricing](https://developers.cloudflare.com/d1/platform/pricing/))
- A D1 database processes queries one at a time. ([limits](https://developers.cloudflare.com/d1/platform/limits/))

## 2. Export and import

**What `wrangler d1 export` writes.** The remote export is built on D1's servers. Its generator, `dumpSql.ts`, is "duplicated between miniflare and d1-workers" and kept in sync by hand. So the local code shows what the remote export produces. ([dumpSql.ts](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.159.0/packages/miniflare/src/workers/d1/dumpSql.ts))

- The first line is always `PRAGMA defer_foreign_keys=TRUE;`, even with `--no-schema`.
- Tables come in `sqlite_schema` row order, which is roughly creation order, not foreign-key order. `sqlite_sequence` comes last. Each table's `CREATE TABLE` is followed by one `INSERT … (columns) VALUES(…)` per row.
- Tables named `_cf_*` or `sqlite_*` are skipped. **`d1_migrations` is an ordinary table, so its schema and rows are included.** `sqlite_sequence` rows are included as data.
- Indexes, triggers and views come after all the table data. A plain import of a full export therefore runs no triggers while it loads rows.
- **[local test]** All of the above. A full export held the `d1_migrations` rows, the `sqlite_sequence` rows and the triggers. A `--no-schema` export still held the `d1_migrations` and `sqlite_sequence` rows.
- `--no-schema` gives data only. `--no-data` gives schema only. They cannot be used together. `--table` can be repeated. ([wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/), [export.ts](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.159.0/packages/wrangler/src/d1/export.ts))
- **Caveat with `--table`:** indexes, triggers and views are filtered by *their own* name, not by the table's name. A `--table profiles` export with schema therefore leaves out that table's indexes and triggers. ([dumpSql.ts](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.159.0/packages/miniflare/src/workers/d1/dumpSql.ts)) **[local test]** Confirmed: `--table sessions` dropped a trigger on `sessions`.
- Export fails on virtual tables (FTS5). ([import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)) This repo has none.

**Export while the database is in use.** "A running export will block other database requests." ([import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)) Wrangler warns that the database "will be unavailable to serve queries" during a remote export. ([export.ts](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.159.0/packages/wrangler/src/d1/export.ts)) It runs, but the live site stalls or errors while it does.

**What `wrangler d1 execute --remote --file` does.**

- Wrangler uploads the file to a URL that the D1 import API hands out, then polls until the import finishes. ([execute.ts](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.159.0/packages/wrangler/src/d1/execute.ts)) The docs say the file goes to R2 and is held to R2's upload limit. ([limits](https://developers.cloudflare.com/d1/platform/limits/)) Nothing in the flow uses or creates an R2 bucket of your own. The docs do not say outright that none is needed.
- The size limit is 5 GiB per file. Split bigger imports. ([import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)) Each statement is still capped at 100 KB. An over-long statement fails with `Statement too long`. ([import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/))
- **Atomicity:** wrangler prints "if the execution fails to complete, your DB will return to its original state and you can safely retry." ([execute.ts](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.159.0/packages/wrangler/src/d1/execute.ts)) The docs pages do not say this. **[local test]** A file that broke a foreign key left zero rows behind.
- The database is "unavailable to serve queries" while the import runs. ([execute.ts](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.159.0/packages/wrangler/src/d1/execute.ts))
- Remove `BEGIN TRANSACTION` / `COMMIT` from the file, or the import fails with "cannot start a transaction within a transaction". ([import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/))

**Foreign key order.** The docs say to import tables "in the right order". To defer the checks, put `PRAGMA defer_foreign_keys = true` before the rows that would break them. ([import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)) Deferred violations still fail the transaction if they remain unresolved when it ends. ([foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)) This matters here because 0000 created `sessions` before `users`. An export therefore lists session rows before user rows. **[local test]** A data-only export loaded child rows before parent rows without error, because of the export's opening defer pragma. With that pragma removed, the same file failed with `FOREIGN KEY constraint failed`. Whether the hosted import treats the whole file as one transaction, so that the deferral covers every row, is not documented. Write the rows parent-first anyway.

## 3. Time Travel

- It is always on and costs nothing. On Free you can restore "to any minute within the last 7 days". ([Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/))
- It needs a database on the production storage backend. `wrangler d1 info csa-id` must show `version: production`. ([Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)) I did not run it, because it calls the live API. The owner should check it.
- **Restore is in place only.** "Restoring a database to a specific point-in-time is a *destructive* operation, and overwrites the database in place." Time Travel "does not yet allow you to clone or fork an existing database to a new copy". ([Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/))
- In-flight queries are cancelled and return errors. ([Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/))
- Bookmarks: the same timestamp always maps to the same bookmark. A restore keeps the newer bookmarks, so you can undo a restore. A restore prints the bookmark to return to. Bookmarks can advance without any writes, because of internal maintenance. ([Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/))
- At most 10 restores per 10 minutes per database. ([limits](https://developers.cloudflare.com/d1/platform/limits/)) The CLI help says "within the last 30 days". That is the Paid window. Free is 7 days. ([wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/), [limits](https://developers.cloudflare.com/d1/platform/limits/))
- **Undoing a bad cutover.** With (a), yes: restore `csa-id` to a timestamp just before the cutover. The docs name "a failed migration or schema change" as a use case. ([Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)) Every write made after that point is lost, and `d1_migrations` goes back to the old names. With (b), Time Travel on the new database can only rewind the new database. The fallback is pointing the Worker back at the old one.
- The docs do not say whether a **deleted** database can be recovered. Do not delete the old database while you might still need it.
- The docs still say "After applying, a backup will be captured" for `migrations apply`. The 4.159.0 apply code makes no backup call. Rely on Time Travel instead. ([wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/), [apply.ts](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.159.0/packages/wrangler/src/d1/migrations/apply.ts))

## 4. Migration tracking

- **Table:** `d1_migrations` by default, in the database itself. Its folder is `./migrations` by default. ([migrations](https://developers.cloudflare.com/d1/reference/migrations/), [constants.ts](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.159.0/packages/wrangler/src/d1/constants.ts))
- **Columns:** `id INTEGER PRIMARY KEY AUTOINCREMENT`, `name TEXT UNIQUE`, `applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL`. Wrangler creates the table with `CREATE TABLE IF NOT EXISTS` on every apply. ([helpers.ts](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.159.0/packages/wrangler/src/d1/migrations/helpers.ts))
- **Config:** `migrations_table`, `migrations_dir` and the optional `migrations_pattern` go on each `d1_databases` entry in `wrangler.jsonc`. ([migrations](https://developers.cloudflare.com/d1/reference/migrations/)) The recorded name is the file path relative to `migrations_dir`, for example `0000_init_users_sessions.sql`. ([migrations](https://developers.cloudflare.com/d1/reference/migrations/))
- With the default pattern `migrations/*.sql`, only top-level `.sql` files count. Drizzle's `meta/` folder is ignored. ([helpers.ts](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.159.0/packages/wrangler/src/d1/migrations/helpers.ts))
- **Which migrations are pending:** wrangler reads every `name` from the table. A file on disk is pending if its exact name is not in that list. Pending files run in numeric order. ([helpers.ts](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.159.0/packages/wrangler/src/d1/migrations/helpers.ts), [apply.ts](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.159.0/packages/wrangler/src/d1/migrations/apply.ts))
- Each migration is sent as one request, with `INSERT INTO d1_migrations (name) values (…)` added to the end of the file. If the migration fails, it is rolled back. ([helpers.ts](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.159.0/packages/wrangler/src/d1/migrations/helpers.ts), [wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/))
- Wrangler picks the database by `database_name` or `binding` from the **top-level** `d1_databases` and uses that entry's `database_id`. ([utils.ts](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.159.0/packages/wrangler/src/d1/utils.ts))
- **What happens if `migrations/` holds only a new `0000_*.sql` and the table still lists the old names:**
  - Old names with no file are ignored. Nothing errors and nothing is removed.
  - If the new file has a **new name**, it is pending, and `apply` runs it against the live tables. Drizzle writes plain `CREATE TABLE`, so it fails with "table … already exists" and is rolled back. Every later `apply` fails the same way. **[local test]** Confirmed: `list` showed `0000_squashed.sql` as pending, `apply` failed, and `d1_migrations` kept the old two rows.
  - If the new file **reuses an old name**, for example `0000_init_users_sessions.sql`, it counts as applied and is skipped without any message.
  - So whichever option you pick, `d1_migrations` must end up holding exactly the new file's name.
- **Lighter path, if the new schema is byte-for-byte the current live schema:** no data needs to move. Replace the tracking rows (`DELETE FROM d1_migrations; INSERT INTO d1_migrations (name) VALUES ('0000_<new>.sql');`). This follows from the name-only check above. Cloudflare does not document it as a procedure.

## 5. Foreign keys

- **`PRAGMA foreign_keys = OFF` does not work in D1 migrations or imports.** "D1's foreign key enforcement is equivalent to SQLite's `PRAGMA foreign_keys = on`… Because D1 runs every query inside an implicit transaction, user queries cannot change this." ([foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)) SQLite itself says this pragma "is a no-op within a transaction". ([sqlite.org pragma](https://www.sqlite.org/pragma.html#pragma_foreign_keys))
- The D1 [SQL statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/) page still lists `PRAGMA foreign_keys = (on|off)` and uses it in an example. It also warns that "D1 PRAGMA statements only apply to the current transaction." The pages disagree. The foreign keys page and SQLite agree with each other, and the local test agrees with them.
- **What works:** `PRAGMA defer_foreign_keys = on`. It holds until the current transaction ends. Unresolved violations then fail the transaction. Setting it back to `off` *discards* violations, so do not use that as a check. Use `PRAGMA foreign_key_check` instead. ([foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/), [SQL statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/))
- **`DROP TABLE` on a parent table deletes or changes child rows.** SQLite: with foreign keys enabled, `DROP TABLE` "performs an implicit DELETE… may invoke foreign key actions". That implicit DELETE "does not cause any SQL triggers to fire". ([sqlite.org foreign keys §5](https://www.sqlite.org/foreignkeys.html)) D1: "Deferring checks does not disable `ON DELETE CASCADE`. Dropping a parent table can still delete child rows." ([foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/))
- **[local test]** A migration ran `PRAGMA foreign_keys=OFF`, then the Drizzle rebuild of a parent `users` table. It deleted every `sessions` row. A `BEFORE DELETE` trigger on `users` did not block the drop. `PRAGMA defer_foreign_keys = on` followed by `DROP TABLE users` also emptied `sessions`.
- **Was 0002 safe?** Yes, but only because `reserved_slugs` is a leaf table. It references `profiles`, but no table references it. Dropping it deleted only its own rows, which had already been copied. Its `PRAGMA foreign_keys=OFF` lines did nothing. The same pattern on `users`, `profiles` or `published_profiles` would cascade. `sessions`, `profiles`, `draft_social_links`, `published_profiles` and `published_social_links` would be emptied. The `profile_id` column in `abuse_reports` and `reserved_slugs` would be set to null.
- **Cloudflare's advice for rebuilds:** call `PRAGMA defer_foreign_keys = true` before changes that would break foreign keys. ([migrations](https://developers.cloudflare.com/d1/reference/migrations/)) "Test table rebuilds on a copy of your data and check child row counts." ([foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)) The docs give no recipe for rebuilding a parent table without the cascade.
- `admin_audit_log` blocks `DELETE` with a trigger. `DROP TABLE` still removes it, because the implicit DELETE fires no triggers. ([sqlite.org foreign keys §5](https://www.sqlite.org/foreignkeys.html))

## 6. In place vs side by side

**(a) Drop everything in `csa-id` and load the new schema**

- Commands (the owner runs these):
  1. `wrangler d1 info csa-id` to confirm `version: production`.
  2. `wrangler d1 time-travel info csa-id` to note the bookmark.
  3. `wrangler d1 export csa-id --remote --output full.sql` as the backup.
  4. `wrangler d1 export csa-id --remote --no-schema --table … --output data.sql`, one `--table` per app table. This leaves out `d1_migrations` and `sqlite_sequence`.
  5. Build `cutover.sql`. It sets `PRAGMA defer_foreign_keys = on`, drops child tables before parents, drops `d1_migrations`, runs the new `0000` SQL, recreates `d1_migrations` and inserts the new file name, then loads the rows parent-first.
  6. Rehearse on a local copy: `wrangler d1 execute csa-id --local --file full.sql`, then `--file cutover.sql`. Compare row counts.
  7. `wrangler d1 execute csa-id --remote --file cutover.sql`.
- One file run is all-or-nothing according to wrangler. ([execute.ts](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.159.0/packages/wrangler/src/d1/execute.ts))
- **No deploy is needed.** The `database_id` does not change.
- The database is blocked during the export and during the import. ([import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/), [execute.ts](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.159.0/packages/wrangler/src/d1/execute.ts))
- **Live site and previews:** all of them bind the same `database_id`, so all of them see the new schema at the same moment. ([previews resources](https://developers.cloudflare.com/workers/previews/resources/)) Old preview builds whose code expects a different schema would break. If the new schema equals the current one, nothing breaks.
- Writes made between the export and the import are lost. Keep the gap to minutes.
- Undo: Time Travel restore. See section 3.

**(b) New database, import, switch `database_id`**

- A free account can hold 10 databases. A second one fits. It counts toward the shared 5 GB. ([limits](https://developers.cloudflare.com/d1/platform/limits/))
- Commands:
  1. `wrangler d1 create <new-name>`. A database name cannot be changed later. ([migrations](https://developers.cloudflare.com/d1/reference/migrations/))
  2. Apply the new schema with a separate config file that points at the new database: `wrangler d1 migrations apply <new-name> --remote --config wrangler.cutover.jsonc`. Cloudflare documents the same pattern for preview databases. ([previews resources](https://developers.cloudflare.com/workers/previews/resources/))
  3. `wrangler d1 export csa-id --remote --no-schema --table … --output data.sql`.
  4. `wrangler d1 execute <new-name> --remote --config wrangler.cutover.jsonc --file data.sql`.
  5. Check row counts.
  6. Change `database_name` and `database_id` in **both** the top-level `d1_databases` and `previews.d1_databases` in `wrangler.jsonc`.
- **A deploy is needed.** A Worker version captures its bindings. ([versions & deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)) In this repo, the live site switches only when the release pull request merges to `main` and Workers Builds deploys it.
- **Previews:** each preview takes its bindings from its own branch's `previews` block when `wrangler preview` runs. ([previews](https://developers.cloudflare.com/workers/previews/), [previews configuration](https://developers.cloudflare.com/workers/previews/configuration/)) `dev`'s preview switches when the change merges to `dev`. Open pull request previews keep the old database until their branch is rebuilt with the change. Between the `dev` merge and the `main` release, the previews and the live site write to different databases.
- **Fallback:** the old database stays untouched. `wrangler rollback` to the previous Worker version points the Worker back at it. A rollback does not change the data in bound resources. ([rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)) The rollbacks page says you cannot roll back if bound resources "such as KV and D1" were "deleted or modified" in between. Its detailed list names only R2, KV and queues. Whether a changed D1 database blocks a rollback is unclear.
- **Repo knock-on:** the `db:migrate:local` and `db:migrate:remote` scripts name `csa-id`. The new database needs a new name, or the scripts can use the binding `DB` instead. Local state is stored by `database_id`, so everyone's local database starts empty after the switch. ([execute.ts](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.159.0/packages/wrangler/src/d1/execute.ts))

## Risks for the cutover

- **Cascade data loss.** Any `DROP TABLE` on `users`, `profiles` or `published_profiles` while the dependent tables still hold rows you plan to keep deletes those rows. `PRAGMA foreign_keys=OFF` does not stop it, and neither does `defer_foreign_keys`. Drop child tables first, or reload every table from the export.
- **Tracking mismatch.** If `d1_migrations` does not end up holding exactly the new file name, the next `migrations apply` fails on "table already exists", or a migration is skipped without any message. Older code still on `main` will see `0000`–`0004` as pending once the table holds only the new name.
- **Export brings old tracking rows.** A `--no-schema` export still contains the `d1_migrations` and `sqlite_sequence` rows. Name every app table with `--table` so the import does not collide with the new tracking rows.
- **`--table` drops indexes and triggers.** A schema export with `--table` leaves out the table's indexes and triggers. Take the schema from the new migration, never from a filtered export.
- **Daily write cap.** The import uses the same 100,000 rows a day as the live site, counting index writes. If the cap is hit partway, the import fails until 00:00 UTC.
- **Lost writes.** Anything written between the export and the switch is lost. With (b), the gap runs until the release deploy finishes.
- **Split databases with (b).** After the `dev` merge, `dev`'s preview and any rebuilt pull request previews use the new database while the live site still uses the old one.
- **Time Travel limits.** You have 7 days. The restore overwrites in place, and it also rewinds `d1_migrations`, so the repo's `migrations/` folder must be reverted too. Confirm `version: production` first.
- **Blocked requests.** The database is blocked during the export and the import. Run them at a quiet hour.
- **Tables outside the plan.** The plan names Users, Profiles, Published Profiles, Social Links and reserved Slugs. Decide on purpose what happens to `sessions` (dropping them signs everyone out), `abuse_reports` and the append-only `admin_audit_log`.
- **Hosted vs local behaviour.** Two things rest on wrangler's console note and local tests, not on Cloudflare docs: that a hosted import is atomic, and that the defer pragma covers a whole file. Rehearse locally and load rows parent-first.
- **Deleting the old database.** The docs say nothing about recovering a deleted D1 database. With (b), keep the old database at least until the 7-day Time Travel window of the new one has passed.
