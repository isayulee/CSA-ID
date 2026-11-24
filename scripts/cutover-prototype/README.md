# PROTOTYPE: fresh-schema cutover (wipe me)

Throwaway code for "docs(db): decide the cutover that moves live data into the fresh schema" (#92). It lives on the `prototype/cutover` branch and is never merged. It answers one question: **can the live D1 data move from migrations `0000`–`0004` onto the fresh schema in the spec (#94) without losing a row or moving a Slug?**

Answer from the rehearsal: yes, in one all-or-nothing `wrangler d1 execute --file`, on fake data shaped like live (6 Profiles, one Slug on an NFC Card).

## Run it

```bash
bash scripts/cutover-prototype/rehearse.sh
```

Everything is local. The throwaway database is `PROTOTYPE-wipe-me` in `scripts/cutover-prototype/.wrangler/`, and nothing passes `--remote`. On Windows, keep the checkout path short: wrangler fails with a bare "internal error" when its SQLite path passes 260 characters.

## Files

| File | Role |
| --- | --- |
| `new-migrations/0000_fresh_schema.sql` | Stand-in for the drizzle-kit `0000`: the spec's SQL verbatim, plus the hand-written triggers and the Campus seed rows |
| `seed.sql` | Fake live data on the old schema |
| `counts.sql` | Runbook step 1: read-only counts |
| `pre.sql` + `0000` + `post.sql` → `cutover.sql` | Runbook step 3, assembled by `build.sh` |
| `verify.sql` | Runbook step 4: counts before and after, Slugs, changes made, structure |
| `cleanup.sql` | Runbook step 5: drop the staged `old_*` copies |
| `rehearse.sh` | Runs steps 0–6, including an undo rehearsal |

## How the cutover works

1. `pre.sql` copies each old table to `old_<table>` (data only), then drops the old tables child-first, so no `ON DELETE CASCADE` ever has a row to act on.
2. The fresh `0000` creates every table, index, trigger and Campus seed row.
3. `post.sql` loads the staged rows parent-first with the map's transforms, then makes `0000_fresh_schema.sql` the only row in `d1_migrations`.
4. The `old_*` copies stay until `verify.sql` looks right, then `cleanup.sql` drops them.

Transforms applied, as decided on the map:
- **users (#86):** drop `picture_url`; replace a missing or "Student assistant" name with the email prefix; set `age_confirmed_at` to the sign-up time, because the sign-in page has said "you confirm you are at least 18" since the first commit.
- **reserved_slugs (#86):** keep `slug`; `created_at` becomes `reserved_at`.
- **profiles (#85):** `role` becomes `role_title` with its text unchanged (Student Assistant is a real role next to Peer Adviser, decided on #92); appearance JSON becomes four columns; `http://` evaluation links become `https://`.
- **abuse_reports (#86):** `slug` is filled from the Profile.
- **admin_audit_log (#87):** `target_type = 'profile'`.
- **sessions:** not carried.

## Draft runbook for the owner (their machine, their login)

1. Counts: `wrangler d1 execute csa-id --remote --file counts.sql`. Write them down.
2. Backup: `wrangler d1 time-travel info csa-id` (note the bookmark), then `wrangler d1 export csa-id --remote --no-data --output before-schema.sql` and `... --no-schema --output before-data.sql`.
3. Cutover: `wrangler d1 execute csa-id --remote --file cutover.sql`.
4. Verify: `wrangler d1 execute csa-id --remote --file verify.sql`; then open the NFC Card's `/id/<slug>`.
5. Clean up: `wrangler d1 execute csa-id --remote --file cleanup.sql`.

Undo: `wrangler d1 time-travel restore csa-id --bookmark <step 2 bookmark>`, plus a rollback of the Worker to its previous version. If Time Travel is unavailable, restore `before-schema.sql`, then `before-data.sql`, into an emptied database.

## What the rehearsal found

- **D1 rejects `GLOB` and `LIKE` patterns over 50 bytes.** The spec's `#RRGGBB` check failed on every insert, so it now checks length, `#` and hex digits separately (fixed in the spec, commit `3dfaa5b`).
- **D1 rejects a compound `SELECT` with more than 5 terms.** The queries here are chunked.
- **A single full export can't be restored into an empty database**, because `sessions` was created before `users`. Export schema and data as two files, and restore schema first.
- **`wrangler d1 export` has no `--persist-to`.** Local rehearsals use the default `.wrangler/` folder.
