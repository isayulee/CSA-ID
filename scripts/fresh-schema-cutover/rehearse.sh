#!/usr/bin/env bash
# Rehearses the cutover evening's data steps on LOCAL databases holding fake data shaped like live, by running
# the same lib.sh functions wizard.sh runs. Never passes --remote.
#   bash scripts/fresh-schema-cutover/rehearse.sh
# The throwaway databases live in a temporary folder, deleted when every check passes. Wrangler fails with a
# bare "internal error" past 260 characters in a local path on Windows, and the system temp folder is short.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
WR="${WRANGLER:-$REPO/node_modules/.bin/wrangler}"
# main's last commit before the squash: the five migrations the live database is at.
OLD_SCHEMA_COMMIT=36faa938bbec6ebb223db6b2548857e20fb30f6f
T=$(mktemp -d)
if command -v cygpath > /dev/null 2>&1; then T=$(cygpath -m "$T"); fi
OUT="$T/out"
LIVE=(--local --config "$T/live.jsonc")
export CI=true # wrangler skips its "Ok to proceed?" prompts
# shellcheck source=lib.sh
source "$HERE/lib.sh"

failures=0
section() { printf '\n== %s\n' "$1"; }
pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; failures=$((failures + 1)); }
check() { local what="$1"; shift; if "$@"; then pass "$what"; else fail "$what"; fi; }
equals() { [[ "$1" == "$2" ]]; }
indent() { sed '/./s/^/    /'; }
# Every table but the ones the cutover changes on purpose: Sessions aren't carried, d1_migrations is replaced.
carried_counts() { grep -v -E '^(sessions|d1_migrations)	' "$1"; }
same_carried_counts() { [[ "$(carried_counts "$1")" == "$(carried_counts "$2")" ]]; }
schema_objects() {
  rows "$1" "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE substr(name, 1, 4) NOT IN ('_cf_', 'old_') AND substr(name, 1, 7) <> 'sqlite_' AND name <> 'd1_migrations' ORDER BY type, name"
}
same_schema_as_fresh() {
  local a b
  a=$(schema_objects live) && b=$(schema_objects "$T/fresh.jsonc") && [[ -n "$a" && "$a" == "$b" ]]
}
# refused MESSAGE COMMAND...: COMMAND fails, and for that reason, not some other.
refused() {
  local message="$1" output
  shift
  if output=$("$@" 2>&1); then return 1; fi
  grep -q -F "$message" <<< "$output" || { indent <<< "$output" | tail -n 5; return 1; }
}
sql() { d1 "$1" execute "$DB_NAME" --command "$2"; }
updated_at_moves() {
  sql live "UPDATE profiles SET bio = 'Edited after the cutover.' WHERE id = 'p4'" > /dev/null &&
    [[ "$(rows live "SELECT updated_at > 1762830100 FROM profiles WHERE id = 'p4'")" == 1 ]]
}
nothing_pending() { d1 "$T/live-fresh.jsonc" migrations list "$DB_NAME" 2>&1 | grep -q 'No migrations to apply'; }
# A fresh copy of the backup in its own local database, for the checks that change it.
copy_of_backup() { write_config "$T/$1.jsonc" "$2" && restore_backup "$T/$1.jsonc"; }
quiet() { "$@" > /dev/null 2>&1; }
# report_fails WHERE: verify.sql reports a problem there (exit 1), rather than passing or not running.
report_fails() { local rc=0; report "$1" "$HERE/verify.sql" > /dev/null 2>&1 || rc=$?; [[ "$rc" == 1 ]]; }

section "Setup: a local 'live' database at the five old migrations, holding fake data"
mkdir -p "$OUT" "$T/old-migrations" "$T/fresh-migrations"
for m in $OLD_MIGRATIONS; do git -C "$REPO" show "$OLD_SCHEMA_COMMIT:migrations/$m" > "$T/old-migrations/$m"; done
tr -d '\r' < "$REPO/migrations/$FRESH_MIGRATION" > "$T/fresh-migrations/$FRESH_MIGRATION"
write_config "$T/live.jsonc" 00000000-0000-4000-8000-00000000011e old-migrations
# The same database, seen through the fresh migrations, to ask wrangler what it thinks is pending.
write_config "$T/live-fresh.jsonc" 00000000-0000-4000-8000-00000000011e fresh-migrations
write_config "$T/fresh.jsonc" 00000000-0000-4000-8000-0000000f8e54 fresh-migrations
d1 live migrations apply "$DB_NAME" > /dev/null
d1 live execute "$DB_NAME" --file "$HERE/rehearsal/seed.sql" > /dev/null
d1 "$T/fresh.jsonc" migrations apply "$DB_NAME" > /dev/null
echo "  state: $T"

section "Step 1: counts"
check "the database is at the five old migrations" equals "$(db_state live)" old
check "it holds exactly the tables the backup exports" has_old_tables live
counts live > "$OUT/counts-before.txt"
indent < "$OUT/counts-before.txt"

section "Step 2: backup, then tonight's cutover on a local copy of it"
counts live > "$OUT/counts-export.txt"
export_backup
check "the data backup lists every table's rows parents first" equals \
  "$(grep -o '^INSERT INTO "[a-z_0-9]*"' "$OUT/before-data.sql" | uniq | tr -d '"' | sed 's/INSERT INTO //' | tr '\n' ' ')" \
  "$OLD_TABLES "
check "the structure backup keeps all 4 triggers and 11 named indexes" equals \
  "$(grep -c '^CREATE TRIGGER' "$OUT/before-schema.sql") $(grep -c -E '^CREATE (UNIQUE )?INDEX' "$OUT/before-schema.sql")" "4 11"
mkdir -p "$T/dry"
if dry_run "$T/dry" > "$T/dry-run.log" 2>&1; then
  pass "the backup restores into an empty database (foreign keys enforced, no defer pragma) with every row"
  pass "and cutover.sql and verify.sql pass on that copy"
else
  fail "the dry run on the backup"; indent < "$T/dry-run.log"
fi

section "Step 4: the cutover"
build_cutover
check "cutover.sql runs" quiet run_cutover live
check "the database is cut over, with the old rows still staged" equals "$(db_state live)" cutover
counts live > "$OUT/counts-after.txt"
check "running cutover.sql a second time is refused by its guard" refused "CHECK constraint failed: at_live_0004 = 1" run_cutover live
check "  and changes nothing" equals "$(db_state live) $(counts live | tr '\n' ' ')" "cutover $(tr '\n' ' ' < "$OUT/counts-after.txt")"

section "Step 5: verify"
report live "$HERE/verify.sql" > "$T/verify.log" 2>&1 && verified=0 || verified=$?
indent < "$T/verify.log"
check "verify.sql finds no problem: every row carried, no Slug moved, triggers and Campuses there, foreign keys hold" equals "$verified" 0
check "every carried table has the rows it had before" same_carried_counts "$OUT/counts-before.txt" "$OUT/counts-after.txt"
check "no Session was carried" equals "$(rows live 'SELECT count(*) FROM sessions')" 0
check "the NFC Card's Slug still opens the same Published Profile" equals "$(rows live "SELECT profile_id FROM published_profiles WHERE slug = 'proto-card'")" p1
check "trigger profiles_slug_immutable: a Slug can't change" \
  refused "profile slug is permanent" sql live "UPDATE profiles SET slug = 'stolen' WHERE id = 'p1'"
check "trigger admin_audit_log_no_delete: the audit log loses no row" \
  refused "admin audit log is append-only" sql live "DELETE FROM admin_audit_log"
check "trigger admin_audit_log_no_update: the audit log can't be edited" \
  refused "admin audit log is append-only" sql live "UPDATE admin_audit_log SET reason = 'x'"
check "trigger profiles_updated_at: an edit moves updated_at" updated_at_moves
check "d1_migrations holds only $FRESH_MIGRATION" equals "$(rows live 'SELECT name FROM d1_migrations')" "$FRESH_MIGRATION"
check "wrangler sees no migration pending" nothing_pending
check "same tables, columns, indexes and triggers as a database built from migrations/" same_schema_as_fresh

section "Step 7: cleanup"
check "cleanup.sql runs" quiet run_cleanup live
check "the old copies are gone" equals "$(db_state live)" clean
check "cleanup.sql is safe to run again" quiet run_cleanup live

section "Undo: the backup is the last resort after Time Travel"
check "the backup restores into an empty database" copy_of_backup undo 00000000-0000-4000-8000-0000000000dd
check "  at the five old migrations, with no copies left over" equals "$(db_state "$T/undo.jsonc")" old
check "  holding every row the live database held, Sessions included" equals "$(counts "$T/undo.jsonc")" "$(cat "$OUT/counts-before.txt")"
check "  with the old schema's 4 triggers" equals "$(rows "$T/undo.jsonc" "SELECT count(*) FROM sqlite_master WHERE type = 'trigger'")" 4
check "after an undo, the cutover can run again another evening" quiet run_cutover "$T/undo.jsonc"
check "  and verify.sql passes there too" quiet report "$T/undo.jsonc" "$HERE/verify.sql"
# verify.sql has to be able to fail: lose a row, then move a Published Profile off its Slug.
sql "$T/undo.jsonc" "DELETE FROM draft_social_links WHERE id = 'd5'" > /dev/null
check "verify.sql reports a row that wasn't carried" report_fails "$T/undo.jsonc"
copy_of_backup moved 00000000-0000-4000-8000-0000000000ae
run_cutover "$T/moved.jsonc" > /dev/null
sql "$T/moved.jsonc" "UPDATE published_profiles SET slug = 'proto-four' WHERE profile_id = 'p2'" > /dev/null
check "verify.sql reports a Published Profile that left its Slug" report_fails "$T/moved.jsonc"

section "All or nothing: a cutover that fails changes nothing"
copy_of_backup broken 00000000-0000-4000-8000-0000000000bb
# The old schema accepts any accent colour; the fresh schema's check rejects this one.
sql "$T/broken.jsonc" "UPDATE profiles SET accent_color = 'red' WHERE id = 'p4'" > /dev/null
check "cutover.sql fails on a row the fresh schema rejects" refused "profiles_accent_color_check" run_cutover "$T/broken.jsonc"
check "  and the database is still at the old schema, with no copies" equals "$(db_state "$T/broken.jsonc")" old
check "  holding every row it held" equals "$(counts "$T/broken.jsonc")" "$(cat "$OUT/counts-before.txt")"

section "Order: the cutover holds even where D1 doesn't defer foreign keys across the file"
copy_of_backup strict 00000000-0000-4000-8000-00000000005d
grep -v '^PRAGMA defer_foreign_keys' "$HERE/cutover.sql" > "$T/cutover-strict.sql"
check "cutover.sql without its defer pragma runs" quiet d1 "$T/strict.jsonc" execute "$DB_NAME" --file "$T/cutover-strict.sql"
check "  and verify.sql passes" quiet report "$T/strict.jsonc" "$HERE/verify.sql"

section "Write budget, measured on the same data"
node "$HERE/rehearsal/writes.mjs" "$T/old-migrations" "$HERE/rehearsal/seed.sql" "$HERE/cutover.sql" "$HERE/cleanup.sql" | indent

if ((failures)); then
  printf '\n%s check(s) FAILED. Throwaway state: %s\n' "$failures" "$T"
  exit 1
fi
rm -rf "$T"
printf '\nAll checks passed. The throwaway state is deleted.\n'
