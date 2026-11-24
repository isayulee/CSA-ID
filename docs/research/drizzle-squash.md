# Drizzle: squashing to one fresh migration

Research for [#83](https://github.com/ymsrubio/CSA-ID/issues/83) (map [#81](https://github.com/ymsrubio/CSA-ID/issues/81)). Versions checked: drizzle-kit **0.31.11** and drizzle-orm **0.45.4**. These are the versions installed in the repo's `node_modules` (`package.json` asks for `^0.31.11` and `^0.45.4`). Every claim cites the drizzle-kit 0.31.11 source, the drizzle docs, a GitHub issue, this repo, or a lab run described in [Lab runs](#lab-runs).

## Summary

drizzle-kit 0.31.11 has no squash command. The feature request is still open: [drizzle-orm#4897](https://github.com/drizzle-team/drizzle-orm/issues/4897). A squash is a reset. You delete the migration history, then generate once against an empty baseline. drizzle-kit emits tables, columns, check constraints, partial indexes, composite primary keys, foreign keys with `onDelete`, multi-column unique constraints, generated columns and views. It has no trigger concept at all, so triggers stay hand-written. In the lab, a reset run against today's `lib/db/schema.ts` produced one `0000` whose snapshot matches the repo's `0004_snapshot.json` exactly.

Recommended procedure:

1. On a branch, delete everything under `migrations/`. That means every `.sql` file and the whole `meta/` folder, `_journal.json` included. If the old journal stays, the next file is numbered `0005_…`, not `0000_…`.
2. Rewrite `lib/db/schema.ts`. Then run `npx drizzle-kit generate --name=<name>`. The output is one `migrations/0000_<name>.sql`, `meta/0000_snapshot.json`, and a new `meta/_journal.json`.
3. Add the DDL drizzle-kit can't express (the triggers) by hand at the end of `0000_<name>.sql`. Put `--> statement-breakpoint` between statements, but not after the last one. The documented alternative is `npx drizzle-kit generate --custom --name=triggers`, which creates a second file, `0001_triggers.sql`.
4. Run `npx drizzle-kit generate` again. It must print `No schema changes, nothing to migrate`. Then run `npx drizzle-kit check`, which must print `Everything's fine`.
5. Run `npm test`, which applies the new file to the in-memory D1. Add a test for every trigger: today only the audit-log triggers are tested.
6. Leave the live cutover to the plan: the live `d1_migrations` table still lists the five old file names (see [#82](https://github.com/ymsrubio/CSA-ID/issues/82)).

## 1. What drizzle-kit generates for the sqlite dialect

The repo uses `dialect: "sqlite"` with no driver (`drizzle.config.ts`). `generate` does not need a driver. Results for 0.31.11 follow. "Lab" means I generated the feature with 0.31.11 and applied it to Miniflare's D1 ([Lab runs](#lab-runs)).

| Feature | Generated? | What it emits | Evidence |
|---|---|---|---|
| Check constraint `check(name, sql)` | Yes | Inline `CONSTRAINT "name" CHECK(...)` in `CREATE TABLE`, with columns table-qualified (`"profiles"."status"`) | Lab; `sqliteSerializer.ts` [L310](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.11/drizzle-kit/src/serializer/sqliteSerializer.ts#L310); docs [indexes-constraints (v0) L463-L483](https://github.com/drizzle-team/drizzle-orm-docs/blob/11695b74b84979f2ba9641009608d38fe0efbbe8/src/content/docs/indexes-constraints.mdx#L463-L483); repo `migrations/0001_initial.sql` |
| Partial index `index().on().where()` | Yes | `CREATE INDEX … WHERE "t"."col" IS NULL`. `uniqueIndex().where()` works too. The where clause is kept in the snapshot | Lab; `sqliteSerializer.ts` [L208](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.11/drizzle-kit/src/serializer/sqliteSerializer.ts#L208); docs [indexes-constraints (v0) L1100-L1117](https://github.com/drizzle-team/drizzle-orm-docs/blob/11695b74b84979f2ba9641009608d38fe0efbbe8/src/content/docs/indexes-constraints.mdx#L1100-L1117) |
| Composite primary key `primaryKey({ columns })` | Yes | Inline `PRIMARY KEY(\`a\`, \`b\`)`. The snapshot names it `<table>_<cols>_pk` | Lab; `sqlgenerator.ts` [L699](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.11/drizzle-kit/src/sqlgenerator.ts#L699); docs [indexes-constraints (v0) L692-L720](https://github.com/drizzle-team/drizzle-orm-docs/blob/11695b74b84979f2ba9641009608d38fe0efbbe8/src/content/docs/indexes-constraints.mdx#L692-L720) |
| Foreign key with `onDelete` (`.references()` or `foreignKey()`, single or multi-column) | Yes, in `CREATE TABLE` | `FOREIGN KEY (…) REFERENCES … ON UPDATE no action ON DELETE cascade`. An unset action becomes `no action` | Lab; `sqliteSerializer.ts` [L139](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.11/drizzle-kit/src/serializer/sqliteSerializer.ts#L139). The `ALTER TABLE ADD COLUMN` case has a bug (below) |
| Multi-column unique `unique().on(a, b)` or `uniqueIndex().on(a, b)` | Yes, but always as an index | `CREATE UNIQUE INDEX`, never an inline `UNIQUE(...)`. In the snapshot, `uniqueConstraints` stays `{}` and the constraint is stored under `indexes`. An unnamed one is called `<table>_<cols>_unique` | Lab; `sqliteSerializer.ts` [L223-L256](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.11/drizzle-kit/src/serializer/sqliteSerializer.ts#L223-L256); docs [indexes-constraints (v0) L304-L340](https://github.com/drizzle-team/drizzle-orm-docs/blob/11695b74b84979f2ba9641009608d38fe0efbbe8/src/content/docs/indexes-constraints.mdx#L304-L340) |
| JSON `text({ mode: 'json' })` | Yes, as plain `text` | Just `` `col` text ``. The mode affects only JS mapping: no `json_valid` check is emitted. `text({ enum })` likewise emits no CHECK | Lab; docs [column-types/sqlite (v0) L89 and L102-L110](https://github.com/drizzle-team/drizzle-orm-docs/blob/11695b74b84979f2ba9641009608d38fe0efbbe8/src/content/docs/column-types/sqlite.mdx#L89-L110) ("it **won't** check runtime values"). This is why the repo writes its own `*_status_check` constraints |
| Generated columns `.generatedAlwaysAs(sql, { mode })` | Yes, when the table is new | `GENERATED ALWAYS AS (…) VIRTUAL` or `STORED`. Default mode is `virtual` | Lab; `sqliteSerializer.ts` (generated mode default) and `sqlgenerator.ts` [L687](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.11/drizzle-kit/src/sqlgenerator.ts#L687); docs [generated-columns (v0) L250-L268](https://github.com/drizzle-team/drizzle-orm-docs/blob/11695b74b84979f2ba9641009608d38fe0efbbe8/src/content/docs/generated-columns.mdx#L250-L268). Adding a STORED one later is skipped (below) |
| Views `sqliteView()` | Yes | `CREATE VIEW \`v\` AS select …`. `.existing()` views get no SQL | Lab; `sqlgenerator.ts` [L815-L823](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.11/drizzle-kit/src/sqlgenerator.ts#L815-L823); docs [views (v0) L215-L217](https://github.com/drizzle-team/drizzle-orm-docs/blob/11695b74b84979f2ba9641009608d38fe0efbbe8/src/content/docs/views.mdx#L215-L217) |
| Triggers | **No. Hand-write them** | No schema API exists, and the snapshot has no place for triggers: its top-level keys are `tables, views, enums, _meta, internal` | Lab (snapshot keys); feature request [#843](https://github.com/drizzle-team/drizzle-orm/issues/843), still open; issue [#6693](https://github.com/drizzle-team/drizzle-orm/issues/6693) ("Drizzle has no schema API for triggers") |

Known bugs in these versions, all on the sqlite dialect:

- **Adding a column with an FK drops `ON DELETE`.** `generate` writes `ALTER TABLE … ADD \`user_id\` text REFERENCES users(id);` with no `ON DELETE`, even though the snapshot records `onDelete: "set null"`. The database and the snapshot then disagree without any warning. Source: `sqlgenerator.ts` [L1881](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.11/drizzle-kit/src/sqlgenerator.ts#L1881) builds the clause with no actions. Issue [#5619](https://github.com/drizzle-team/drizzle-orm/issues/5619), labelled `bug/fixed-in-beta`. Reproduced in the lab.
- **Adding a column with a non-constant default fails on a non-empty table.** `generate` writes `ALTER TABLE … ADD \`seen_at\` integer DEFAULT (unixepoch()) NOT NULL`. The lab shows it passes on an empty table and fails with rows (`Cannot add a column with non-constant default`). Every table here uses `DEFAULT (unixepoch())`. Issue [#6408](https://github.com/drizzle-team/drizzle-orm/issues/6408), filed against 1.0.0-rc.4; the lab shows 0.31.11 does the same.
- **Adding a `NOT NULL` column without a default** gives `ALTER TABLE … ADD \`note\` text NOT NULL`. It passes on an empty table and fails with rows (`Cannot add a NOT NULL column with default value NULL`). Reproduced in the lab. Feature request [#4168](https://github.com/drizzle-team/drizzle-orm/issues/4168).
- **Adding a STORED generated column to an existing table is skipped.** `generate` prints a warning, writes no SQL and no snapshot, and says `No schema changes`. Source: `jsonStatements.ts` [L1332-L1345](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.11/drizzle-kit/src/jsonStatements.ts#L1332-L1345). Reproduced in the lab.
- **Rebuilding a table that has a generated column fails.** The `INSERT INTO __new_t(...) SELECT ...` lists the generated column, and SQLite rejects it: `cannot INSERT into generated column "full"`. Issue [#5241](https://github.com/drizzle-team/drizzle-orm/issues/5241), labelled `bug/fixed-in-beta`. Reproduced in the lab.
- **Expression indexes whose expression contains a comma** (for example `json_extract(x, '$.a')`) generate invalid SQL. Issue [#6062](https://github.com/drizzle-team/drizzle-orm/issues/6062), reported on 0.31.10 and labelled `bug/fixed-in-beta`. Not tested in the lab.
- **Check constraints:** the lab found no bug in `generate`. Rerunning it with checks present gives `No schema changes`. During a rebuild drizzle-kit renames `"profiles".` to `"__new_profiles".` inside each check (`sqlgenerator.ts` [L3764](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.11/drizzle-kit/src/sqlgenerator.ts#L3764)), and SQLite renames it back on `ALTER TABLE … RENAME`. The lab confirmed this from `sqlite_master`. The open check-constraint bug [#4574](https://github.com/drizzle-team/drizzle-orm/issues/4574) is about `push` only, which this repo doesn't use.
- Table rebuilds drop triggers and can wipe child rows. See [section 4](#4-the-next-change-after-the-squash).

## 2. Resetting `migrations/` and `meta/`; `--custom`; hand edits

How `generate` chooses its baseline in 0.31.11:

- It lists every file in `meta/` that doesn't start with `_`, sorts them, and diffs against the **last snapshot by file name**. With no snapshots, it diffs against an empty schema and emits the whole schema. Source: `utils.ts` `prepareOutFolder` [L96-L111](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.11/drizzle-kit/src/utils.ts#L96-L111), and `migrationPreparator.ts` `preparePrevSnapshot` [L198-L204](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.11/drizzle-kit/src/migrationPreparator.ts#L198-L204).
- It reads `_journal.json` only to number the next file (last `idx` + 1). If `meta/` is missing, it creates a fresh journal. Source: `utils.ts` [L100](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.11/drizzle-kit/src/utils.ts#L100) and `cli/commands/migrate.ts` `writeResult` [L1399-L1400](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.11/drizzle-kit/src/cli/commands/migrate.ts#L1399-L1400).
- If two snapshots share a `prevId`, it reports a collision and stops. Source: `utils.ts` [L220-L239](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.11/drizzle-kit/src/utils.ts#L220-L239). A half-done reset that leaves old snapshots behind can trigger this.
- It never reads `.sql` files. The docs describe the same flow: read the schema, build a JSON snapshot, "compare current json snapshot to the most recent one" ([drizzle-kit-generate (v0) L26-L31](https://github.com/drizzle-team/drizzle-orm-docs/blob/11695b74b84979f2ba9641009608d38fe0efbbe8/src/content/docs/drizzle-kit-generate.mdx#L26-L31)).

**A clean reset** means deleting all of `migrations/*.sql` **and** `migrations/meta/` (journal and snapshots), then running `generate --name=…`. The lab confirmed both sides:

- With everything deleted, `generate --name=init` wrote `0000_init.sql`. Its snapshot's `tables`, `views` and `enums` are identical to the repo's `migrations/meta/0004_snapshot.json`.
- With the old journal kept and the snapshots deleted, the same command wrote **`0005_init.sql`** containing the full schema.

`drizzle-kit drop` exists in 0.31.11, but it removes one migration interactively, so it doesn't help here. The v1 docs say it is gone in v1 ([upgrade-v1 L55](https://github.com/drizzle-team/drizzle-orm-docs/blob/fb09abd412ab296189df546a1c434456d07f7c20/src/content/docs/sqlite/upgrade-v1.mdx#L55)).

**`generate --custom` is the documented way** to add DDL that drizzle-kit can't express. The docs say custom migrations are for "DDL alternations currently not supported by Drizzle Kit or data seeding" ([kit-custom-migrations (v0) L23-L24](https://github.com/drizzle-team/drizzle-orm-docs/blob/11695b74b84979f2ba9641009608d38fe0efbbe8/src/content/docs/kit-custom-migrations.mdx#L23-L24); live page: <https://orm.drizzle.team/docs/kit-custom-migrations>). In 0.31.11 it does three things:

- It writes a file containing only `-- Custom SQL migration file, put your code below! --`.
- It adds a journal entry.
- It writes a snapshot that **copies the previous snapshot** with a new `id`/`prevId`.

Source: `migrationPreparator.ts` [L137](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.11/drizzle-kit/src/migrationPreparator.ts#L137) and `migrate.ts` [L1426](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.11/drizzle-kit/src/cli/commands/migrate.ts#L1426). The lab confirmed the copied snapshot equals `0000`'s, ignoring key order. Nothing you write into the file reaches a snapshot.

**Hand edits survive later `generate` runs, and drizzle-kit never sees them.** `generate` only writes a new `<tag>.sql` and a new snapshot; it never rewrites an existing SQL file (`writeResult`, [L1356-L1430](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.11/drizzle-kit/src/cli/commands/migrate.ts#L1356-L1430)). Lab: after the four triggers were pasted into `0001_triggers.sql`, `generate` printed `No schema changes` and left the file alone. A later additive change produced only that delta: no trigger was dropped or re-emitted. So triggers appended to the generated `0000` (today's practice in `0001_initial.sql` and `0003_admin_audit_log.sql`) are just as safe as triggers in a `--custom` file. The catch is that drizzle-kit doesn't know they exist ([section 4](#4-the-next-change-after-the-squash)).

## 3. How `npm test` applies migrations

- `npm test` runs `vitest run` (`package.json`). `vitest.config.ts` only sets aliases and `include: ["tests/**/*.test.ts"]`. There is no global setup and no `@cloudflare/vitest-pool-workers`; it isn't installed either (`node_modules/@cloudflare` holds `kv-asset-handler`, `unenv-preset` and `workerd-windows-64`).
- Each test calls `createTestDb()` from `tests/helpers.ts` (25 call sites). It starts a Miniflare worker with an in-memory D1 binding, then works through the migrations as shown at `tests/helpers.ts` L18-L22:
  - it lists `migrations/*.sql` (top level only) and sorts by file name;
  - it splits each file on `--> statement-breakpoint`;
  - it runs each chunk with `d1.prepare(chunk).run()`.
- It never reads `meta/` or `_journal.json`, and it keeps no applied-migrations table.
- For contrast, `readD1Migrations()` in `@cloudflare/vitest-pool-workers` "reads all D1 migrations stored at `migrationsPath` … ordered by migration number". `applyD1Migrations()` applies the un-applied ones and tracks them in `d1_migrations` ([configuration](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/), [test APIs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/)). The repo doesn't use either.

What a squash changes for tests:

- Tests run one file (or `0000` plus a custom file) instead of five. Because the helper ignores `meta/`, the journal reset doesn't matter to tests.
- Lab: the squashed `0000` plus the triggers applied cleanly to Miniflare's D1, giving 9 tables, 11 indexes and 4 triggers.
- **An empty `--custom` file breaks every test.** A chunk that is only the placeholder comment fails with `D1_ERROR: SQL code did not contain a statement` (lab).
- **A trailing `--> statement-breakpoint`** leaves an empty chunk, which fails with `D1_ERROR: No SQL statements detected` (lab).
- A chunk holding two statements and no marker still ran both in the lab. Still, keep one statement per chunk, as drizzle-kit does.
- Tables come out in alphabetical order, so a foreign key can name a table created later in the file (for example, `abuse_reports` before `profiles`). The lab applied this without error.
- Only the audit-log triggers have a test (`tests/admin.test.ts` L116). The `profiles_updated_at` and `profiles_slug_immutable` triggers are untested. A squash that forgot them would still pass `npm test`.
- The test database is always empty. ALTERs that fail only when a table has rows (see the bugs in section 1) pass `npm test` and then fail against the live D1.

## 4. The next change after the squash

**Yes, it emits only the delta.** `generate` diffs `schema.ts` against the newest `meta/*_snapshot.json`, which after the squash is `0000_snapshot.json` (or the custom file's copy of it). Source: `preparePrevSnapshot`, as cited in [section 2](#2-resetting-migrations-and-meta---custom-hand-edits). Lab, after the squash plus the custom triggers file:

- Adding a nullable column and a new table gave exactly `CREATE TABLE \`courses\` …` and `ALTER TABLE \`profiles\` ADD \`pronouns\` text;`.
- New indexes, partial indexes and unique constraints gave only `CREATE [UNIQUE] INDEX`.
- Dropping a plain column gave `ALTER TABLE … DROP COLUMN`.
- Adding a VIRTUAL generated column gave `ALTER TABLE … ADD … GENERATED ALWAYS AS (…) VIRTUAL`.

**When it rebuilds a table.** `sqliteCombineStatements` swaps the table's statements for one `recreate_table` when any of these change:

- a column's type, default, `NOT NULL`, primary key or autoincrement;
- an FK is altered or deleted;
- an FK is created, unless it is a single-column FK on a column added in the same migration;
- a composite primary key is created, altered or deleted;
- a unique constraint is created or deleted (in practice these are indexes, so they arrive as `CREATE INDEX`);
- a check constraint is created or deleted, including when its expression changes;
- a primary-key column is added.

Source: `statementCombiner.ts` [L305-L420](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.11/drizzle-kit/src/statementCombiner.ts#L305-L420) and `prepareSQLiteRecreateTable` [L43](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.11/drizzle-kit/src/statementCombiner.ts#L43). A default change alone causes a full rebuild.

The emitted pattern (`SQLiteRecreateTableConvertor`, `sqlgenerator.ts` [L3764](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.11/drizzle-kit/src/sqlgenerator.ts#L3764)), as seen in the lab and in the repo's `migrations/0002_reserved_slugs_survive_deletion.sql`:

```sql
PRAGMA foreign_keys=OFF;
CREATE TABLE `__new_profiles` (... CHECK("__new_profiles"."status" IN (...)) );
INSERT INTO `__new_profiles`(...) SELECT ... FROM `profiles`;
DROP TABLE `profiles`;
ALTER TABLE `__new_profiles` RENAME TO `profiles`;
PRAGMA foreign_keys=ON;
CREATE UNIQUE INDEX ... -- every index in the snapshot is recreated
```

It recreates indexes only. It does not recreate triggers and does not touch views.

**Flag: is this safe on D1?** That belongs to [#82](https://github.com/ymsrubio/CSA-ID/issues/82). Here is what the lab saw on **local** Miniflare D1, which is the same harness `npm test` uses:

- `PRAGMA foreign_keys=OFF` was a no-op: `PRAGMA foreign_keys` still returned `1` afterwards.
- A rebuild of `profiles` (adding one check constraint) cascaded through the child tables. Before the rebuild: 1 draft link, 1 published profile, and 1 reserved slug with a `profile_id`. After it: 0, 0 and 0 (`reserved_slugs.profile_id` was set to `NULL`).
- The same rebuild deleted `profiles_updated_at` and `profiles_slug_immutable`. After it, `UPDATE profiles SET slug='bob'` succeeded.
- A rebuild of `admin_audit_log` deleted both append-only triggers.

Drizzle issues about this:

- [#3065](https://github.com/drizzle-team/drizzle-orm/issues/3065): feature request for `PRAGMA defer_foreign_keys`, because "Cloudflare D1 … does not support `PRAGMA foreign_keys = OFF`". Labels: `driver/d1`, `priority`. Open.
- [#4089](https://github.com/drizzle-team/drizzle-orm/issues/4089): D1 rebuild fails with `FOREIGN KEY constraint failed`. Labels: `priority`. Open.
- [#4938](https://github.com/drizzle-team/drizzle-orm/issues/4938): D1 cascade data loss during a rebuild. Open.
- [#5782](https://github.com/drizzle-team/drizzle-orm/issues/5782): a rebuild silently wipes child tables with `ON DELETE CASCADE`; reported on 0.31.7. Open.
- [#4640](https://github.com/drizzle-team/drizzle-orm/issues/4640): wrong PRAGMA placement cascades rows. Open.
- [#6693](https://github.com/drizzle-team/drizzle-orm/issues/6693): a rebuild drops the table's triggers with no warning. Open.

Cloudflare's migrations page tells you to "call `PRAGMA defer_foreign_keys = true` before making changes that would violate foreign keys" ([D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)). drizzle-kit 0.31.11 has no option to emit that.

**A view on a rebuilt table breaks the rebuild.** Lab: with `sqliteView("live_parents")` reading `parents`, a rebuild of `parents` failed at the `RENAME` with `error in view live_parents: no such table: main.parents`. By then `DROP TABLE parents` had already run. I found no drizzle issue for this.

## Gotchas

- Delete `meta/_journal.json` along with the snapshots. Otherwise the "fresh" file is `0005_…` (lab).
- `npm run db:generate` runs `drizzle-kit generate` with no `--name`, which gives a random tag. Pass `--name` for the squash: `npm run db:generate -- --name=<name>`.
- Triggers live only in SQL. Keep the trigger list in the spec, and add a test for each one; today only the audit-log pair is tested.
- Any future migration that rebuilds a table with triggers must re-create those triggers by hand, at the end of the same file. drizzle-kit drops them silently (lab; [#6693](https://github.com/drizzle-team/drizzle-orm/issues/6693)).
- Read every generated migration for `__new_` before merging. A rebuild of a parent table cascaded child rows on local D1, and a default change alone triggers one ([section 4](#4-the-next-change-after-the-squash)).
- `ALTER TABLE ADD` for a column with `DEFAULT (unixepoch())` or with `NOT NULL` and no default passes `npm test` (empty database) but fails on a table with rows. Edit the SQL by hand, or rebuild the table deliberately.
- An FK added on a new column loses its `ON DELETE` ([#5619](https://github.com/drizzle-team/drizzle-orm/issues/5619)). Add the action by hand, or the database won't match the snapshot.
- Don't add a STORED generated column to an existing table through `generate`: it is skipped. Don't rebuild a table that has a generated column ([#5241](https://github.com/drizzle-team/drizzle-orm/issues/5241)).
- `text({ mode: 'json' })` and `text({ enum })` add no database checks. Keep explicit `check()` constraints for enums.
- Multi-column `unique()` becomes a `CREATE UNIQUE INDEX`, not a table constraint. Changing one later is an index drop and create, not a rebuild.
- `--custom` leaves a placeholder-only file. If it is committed empty, every test fails (`SQL code did not contain a statement`).
- Don't end a hand-written file with `--> statement-breakpoint`; the test helper then runs an empty chunk and fails.
- The live docs at orm.drizzle.team now describe drizzle-kit **v1**: one folder per migration (`<timestamp>_<name>/migration.sql`), no `_journal.json`, `drizzle-kit up` converts old folders, and `drop` is removed ([upgrade-v1 L35-L59](https://github.com/drizzle-team/drizzle-orm-docs/blob/fb09abd412ab296189df546a1c434456d07f7c20/src/content/docs/sqlite/upgrade-v1.mdx#L35-L59)). 0.31.11 writes flat `NNNN_name.sql` files plus `meta/` (source and lab). For 0.31 behaviour, read the docs as of commit [`11695b7`](https://github.com/drizzle-team/drizzle-orm-docs/tree/11695b74b84979f2ba9641009608d38fe0efbbe8/src/content/docs). Moving to v1 later would also change what `wrangler d1 migrations apply` must match: Cloudflare documents `migrations_pattern` for nested Drizzle folders ([D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)).
- The live database tracks applied files by name in `d1_migrations` ([D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)). A new `0000_<name>.sql` will look un-applied to the live database. That's a cutover question for [#82](https://github.com/ymsrubio/CSA-ID/issues/82) and the map; no agent runs `--remote`.

## Lab runs

Lab folder: `C:\Users\Pocoyo\AppData\Local\Temp\claude\ae343a8b55b46442\c2458b87-eb6f-4eb3-baa3-2af9dd15f312\scratchpad\drizzle-lab`. I installed `npm install drizzle-kit@0.31.11 drizzle-orm@0.45.4` there; `npx drizzle-kit --version` printed `drizzle-kit: v0.31.11, drizzle-orm: v0.45.4`. The repo was not changed.

- `apply.mjs` loads the repo's own `miniflare` by absolute path. It applies a folder of `.sql` files exactly as `tests/helpers.ts` does (sorted, split on the breakpoint, `prepare().run()`), runs an optional query file, and lists `sqlite_master`.
- `variant.sh` starts each variant from the squashed `0000` plus the triggers file, applies one edit to `schema.ts`, and runs `drizzle-kit generate --name=<variant>`.
- `squash/`: a copy of `drizzle.config.ts`, `lib/db/schema.ts` and `lib/profile-appearance.ts`. `npx drizzle-kit generate --name=init` printed `9 tables … [✓] Your SQL migration file ➜ migrations\0000_init.sql`. The snapshot's tables, views and enums equal the repo's `0004_snapshot.json`.
- `npx drizzle-kit generate --custom --name=triggers` printed `Prepared empty file for your custom SQL migration!` and wrote `0001_triggers.sql` containing only the placeholder comment. I pasted the four triggers from `0001_initial.sql` and `0003_admin_audit_log.sql` into it. `npx drizzle-kit generate` then printed `No schema changes, nothing to migrate 😴`.
- `features/`: a schema with every item in the section 1 table. It applied cleanly to Miniflare's D1.
- Variants `add_check`, `set_notnull`, `fk_ondelete`, `change_check` and `drop_checked_col` each emitted the `__new_` rebuild.
- Variants `add_fk_col`, `add_unique_and_partial`, `drop_col`, `add_virtual_gen`, `add_notnull_col_nodefault` and `add_nonconst_default` emitted only `ALTER TABLE` or `CREATE INDEX` statements, with no rebuild.
- Variant `add_stored_gen` emitted nothing.
- Data checks ran by seeding a User, a Profile, a draft Social Link, a Published Profile and a reserved Slug before the rebuild. Baseline (no rebuild): counts 1/1/1/1 and the slug update is refused (`profile slug is permanent`). After the `add_check` rebuild: counts 0/0/0 (Profile still 1), only the two audit triggers remain, and the slug update succeeds.
- `npx drizzle-kit check` on a squashed folder printed `Everything's fine 🐶🔥`.
