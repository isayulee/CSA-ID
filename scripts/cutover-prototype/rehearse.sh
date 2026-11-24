#!/usr/bin/env bash
# PROTOTYPE, wipe me. Rehearses the whole cutover on a throwaway LOCAL D1 ("PROTOTYPE-wipe-me"),
# kept in ./.wrangler next to this script. Never passes --remote.
# Run from anywhere:  bash scripts/cutover-prototype/rehearse.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
W="${WRANGLER:-npx wrangler}"
DB="PROTOTYPE-wipe-me"
export CI=true   # no interactive "Ok to proceed?" prompts
# Wrangler keeps local state in <config dir>/.wrangler. Keep the checkout path short on Windows:
# past the 260-character path limit wrangler fails with a bare "internal error".
old() { $W d1 "$@" --local --config "$HERE/wrangler.old.jsonc"; }
new() { $W d1 "$@" --local --config "$HERE/wrangler.new.jsonc"; }
restore() { $W d1 "$@" --local --config "$HERE/wrangler.restore.jsonc"; }
banner() { printf '\n==================== %s ====================\n' "$1"; }

rm -rf "$HERE/.wrangler"
mkdir -p "$HERE/.wrangler"
bash "$HERE/build.sh"

banner "0. Old schema: the five live migrations"
old migrations apply "$DB"

banner "0. Fake data shaped like live (6 Profiles, one Slug on an NFC Card)"
old execute "$DB" --file "$HERE/seed.sql"

banner "1. Runbook step 1: read-only counts"
old execute "$DB" --file "$HERE/counts.sql"

banner "2. Runbook step 2: backup export, schema and data as two files"
# A single full export can't be restored into an empty database: sessions was created before users,
# so its rows come before the users table exists. Schema first, then data, restores cleanly.
old export "$DB" --no-data --output "$HERE/.wrangler/before-schema.sql"
old export "$DB" --no-schema --output "$HERE/.wrangler/before-data.sql"
echo "Backup: before-schema.sql ($(wc -l < "$HERE/.wrangler/before-schema.sql") lines), before-data.sql ($(wc -l < "$HERE/.wrangler/before-data.sql") lines)"

banner "3. Runbook step 3: the cutover (one file, all-or-nothing)"
old execute "$DB" --file "$HERE/cutover.sql"

banner "4. Runbook step 4: verify"
new execute "$DB" --file "$HERE/verify.sql"

banner "4b. The Slug trigger still holds (this UPDATE must FAIL)"
if new execute "$DB" --command "UPDATE profiles SET slug = 'stolen' WHERE id = 'p1'" >/dev/null 2>&1; then
  echo "FAIL: the Slug changed"; exit 1
else
  echo "OK: changing a Slug is refused"
fi

banner "4c. The audit log is still append-only (this DELETE must FAIL)"
if new execute "$DB" --command "DELETE FROM admin_audit_log" >/dev/null 2>&1; then
  echo "FAIL: the audit log lost a row"; exit 1
else
  echo "OK: deleting from the audit log is refused"
fi

banner "4d. Wrangler sees the fresh 0000 as already applied"
new migrations list "$DB"

banner "5. Runbook step 5: drop the staged copies"
new execute "$DB" --file "$HERE/cleanup.sql"
new execute "$DB" --command "SELECT count(*) AS old_tables_left FROM sqlite_master WHERE type = 'table' AND name GLOB 'old_*'"

banner "6. Undo rehearsal: the backup restores the old schema into an empty database"
restore execute "${DB}-restore" --file "$HERE/.wrangler/before-schema.sql" >/dev/null
restore execute "${DB}-restore" --file "$HERE/.wrangler/before-data.sql" >/dev/null
restore execute "${DB}-restore" --file "$HERE/counts.sql"

banner "Done"
echo "Throwaway state is in $HERE/.wrangler (delete it freely)."
