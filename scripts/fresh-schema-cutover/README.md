# Move the live data onto the fresh schema

A one-off for [build(db): move the live data onto the fresh schema with a cutover wizard](https://github.com/isayulee/CSA-ID/issues/104). The plan and its reasons are in [the cutover decision](https://github.com/isayulee/CSA-ID/issues/92). Delete this folder once the cutover is kept and cleaned up.

## Why

[#112](https://github.com/isayulee/CSA-ID/pull/112) squashes the five migrations into one fresh `0000` and moves the code onto its columns. The live D1 database is still at the five old migrations. Merging #112 deploys code that can't read the old schema, so the live rows have to move onto the fresh schema straight after the merge. The move happens in place, in the shared account, with one all-or-nothing `cutover.sql`.

## Who runs it, and when

Someone with access to the shared Cloudflare account and the right to merge #112 runs the wizard. Agents never run it, because every stage reaches the live database. Run it:

- after the move to the shared account ([#95](https://github.com/isayulee/CSA-ID/issues/95)) was kept and its cleanup ran, so there is only one fallback to reason about at a time;
- at a quiet hour, after telling the 5 to 6 Peer Advisers not to edit their Profiles that evening;
- from a clean checkout of this pull request's branch, with `npm install` done.

```bash
bash scripts/fresh-schema-cutover/wizard.sh        # from the start
bash scripts/fresh-schema-cutover/wizard.sh 4      # resume at stage 4
```

It needs bash (Git Bash on Windows), Git, Node and a wrangler login that reaches the shared account. The wizard tries the move's named login first (`npx wrangler auth create csa-shared`), then the plain `npx wrangler login`. On Windows, keep the checkout path short (see [What the rehearsal found](#what-the-rehearsal-found)).

## The evening

The wizard asks before each step that can't be undone. Every stage reads where the live database stands, so a stage you run again does only what is left.

1. **Counts.** Checks that the live database is at the five old migrations and holds exactly the expected tables, then counts the rows. Read only.
2. **Backup.** Records a Time Travel bookmark and the Worker version that serves the site now. Exports the structure, then every table's rows, parents first. Then it restores that export into a throwaway local database and runs tonight's `cutover.sql` and `verify.sql` on it. If anything fails there, stop: nothing has changed anywhere.
3. **Release.** Checks that #112 holds the very `0000` that `cutover.sql` is built from. You mark #112 ready and squash-merge it into `main`. The wizard waits until Workers Builds deploys a new version. From the merge until stage 4 ends, the site runs the new code on the old schema, so Profile pages and saves fail. The 30 minutes to keep or undo start at the merge.
4. **Cutover.** Checks that `main` holds the same `0000`, records a fresh bookmark, then runs `cutover.sql` as one `wrangler d1 execute --remote --file`. If it fails, D1 rolls the whole file back, and the wizard confirms the database is unchanged.
5. **Verify.** Runs `verify.sql`, then opens the NFC Card's `/id/<slug>` and the sign-in page. Everyone signs in again, because Sessions aren't carried.
6. **Keep or undo** within 30 minutes of the merge. The undo restores the stage 4 bookmark with `wrangler d1 time-travel restore`, then rolls the Worker back to the version recorded in stage 2. After an undo, revert #112 on `main` before anything else merges, because every merge into `main` deploys.
7. **Cleanup.** Runs `cleanup.sql` to drop the `old_*` copies, deletes the backup, and prints the counts before and after, the times and the rows written, ready to paste into #104.

If Time Travel is unavailable, the backup is the last resort. Restore `out/before-schema.sql`, then `out/before-data.sql`, into an emptied database. Stage 7 deletes both files.

## How `cutover.sql` works

`build.sh` joins three files into `cutover.sql`. It reads the squash's real `migrations/0000_fresh_schema.sql`, so anyone can rebuild the same file.

1. `pre.sql` refuses any database that isn't at the five old migrations, so the file can't run twice. It copies each old table to `old_<table>` (data only), then drops the old tables children first, so no `ON DELETE CASCADE` ever has a row to act on.
2. The fresh `0000` creates every table, index, trigger and Campus seed row.
3. `post.sql` loads the staged rows parents first with the transforms below, then makes `0000_fresh_schema.sql` the only row in `d1_migrations`.

The transforms, as decided on #85, #86 and #87 and settled in #92:

- **users (#86):** `picture_url` is dropped. A missing or "Student assistant" name becomes the email prefix. `age_confirmed_at` is the sign-up time, because the sign-in page has said "you confirm you are at least 18" since the first commit.
- **reserved_slugs (#86):** `slug` stays, and `created_at` becomes `reserved_at`.
- **profiles (#85):** `role` becomes `role_title` with its text unchanged. The appearance JSON becomes four columns. `http://` evaluation links become `https://`.
- **abuse_reports (#86):** `slug` is filled from the Profile.
- **admin_audit_log (#87):** `target_type` is `'profile'`.
- **sessions:** not carried.

`verify.sql` fails on any row that wasn't carried, any Slug that moved, a missing trigger or Campus, an extra migration row or a broken foreign key. It also lists what the transforms changed, so the owner can tell the Peer Advisers concerned.

## Rehearse it

```bash
bash scripts/fresh-schema-cutover/rehearse.sh
```

It runs the evening's data steps on local databases with fake data shaped like live (`rehearsal/seed.sql`), through the same `lib.sh` functions as the wizard. It never passes `--remote`. It takes about three minutes and checks:

- the backup, and tonight's cutover on a local copy of it (stage 2);
- the cutover: every row carried except Sessions, no Slug moved, all four triggers working, `d1_migrations` holding only the fresh `0000`, nothing pending for wrangler, and the same tables, indexes and triggers as a database built from `migrations/`;
- a second run of `cutover.sql`, which its guard refuses;
- the backup restoring into an empty database, and the cutover running again after that undo;
- a failing cutover, which leaves the database unchanged;
- the cutover with its defer pragma stripped, as if D1 didn't defer foreign keys across the file;
- the rows written, measured with `rehearsal/writes.mjs`.

The Time Travel restore, the Worker rollback, the release and the deploy exist only remotely, so read those stages in `wizard.sh`.

## What the rehearsal found

- **`wrangler d1 export --table` ignores the order of its flags.** It exports in creation order, which puts `sessions`, `abuse_reports` and `draft_social_links` before their parents. The move found on 2026-11-25 that the remote import may not defer foreign keys across a file. So the data backup is exported one table at a time, parents first, and the rehearsal restores it with the defer pragma stripped.
- **An empty table exports as one line with no newline at its end.** Joining the exports adds a newline after each one.
- **A checkout with `core.autocrlf` has CRLF line endings in the `0000`.** `build.sh` drops the carriage returns.
- **Local D1 runs a `--file` all-or-nothing.** A cutover that fails on a row leaves no copies and no change behind.
- **The cutover writes about 134 rows of structure, plus about 4.5 rows per row it carries.** Local D1 counts every index entry, as D1 does, but counts no rows for `DROP TABLE`.
- **Long paths break wrangler on Windows.** Past 260 characters in a local state path, it fails with a bare "internal error". The rehearsal and the stage 2 dry run keep their databases in the system temp folder.

## Files

- `wizard.sh`: the evening. Its library, above the `STAGES` marker, is the `/wizard` skill's template, unedited.
- `lib.sh`: the data steps, shared with the rehearsal.
- `build.sh`: builds `cutover.sql` from `pre.sql`, the fresh `0000` and `post.sql`.
- `counts.sql`, `verify.sql`, `cleanup.sql`: the evening's other SQL. Queries run through `--command`, because a remote `--file` run returns no rows.
- `results.mjs`: prints query results as tables and fails on a check that found a problem.
- `rehearse.sh` and `rehearsal/`: the local rehearsal, its fake data and the write count.
- `cutover.sql`, `out/` and `.cutover.env`: local files that Git ignores. On the evening, `out/` holds the backup, which has personal data. Stage 7 deletes it.
