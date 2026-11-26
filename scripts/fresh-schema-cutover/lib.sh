# shellcheck shell=bash
# The cutover's data steps, shared by wizard.sh (the live database, on the evening) and rehearse.sh (a local
# database holding fake data), so the rehearsal runs the code the evening runs. Source it after setting:
#   WR    the wrangler executable
#   HERE  this folder
#   OUT   where the backup and counts go. On the evening they hold Peer Advisers' personal data.
#   LIVE  an array of the flags that reach the evening's database: (--remote --config wrangler.jsonc) on the
#         evening, (--local --config <a throwaway config>) in the rehearsal.
#
# wizard.sh calls these inside conditions, where bash ignores `set -e` all the way down, so every function
# returns its own failure. Written for bash 3.2 too (macOS): no mapfile.

DB_NAME=csa-id
FRESH_MIGRATION=0000_fresh_schema.sql
# The live database's migrations, in order. pre.sql's guard lists the same five.
OLD_MIGRATIONS="0000_init_users_sessions.sql 0001_initial.sql 0002_reserved_slugs_survive_deletion.sql 0003_admin_audit_log.sql 0004_profile_evaluation_appearance.sql"
# The live database's tables at those migrations, parents before children. The data backup is exported in this
# order, one table at a time, because wrangler exports in creation order (children first here), and the remote
# import may not defer foreign keys across a file (the move's finding on 2026-11-25).
OLD_TABLES="d1_migrations users sessions profiles reserved_slugs draft_social_links published_profiles published_social_links abuse_reports admin_audit_log"

# d1 WHERE ARGS...: a wrangler d1 command on WHERE: "live", or the path of a local database's config.
d1() {
  local where="$1"
  shift
  if [[ "$where" == live ]]; then "$WR" d1 "$@" "${LIVE[@]}"; else "$WR" d1 "$@" --local --config "$where"; fi
}

# sql_text FILE: a .sql file as one line for --command. Queries use --command because a remote --file run goes
# through D1's import and returns no rows. The .sql files keep every comment on a line of its own.
sql_text() { grep -v -E '^[[:space:]]*(--|$)' "$1" | tr '\n' ' '; }

# query WHERE SQL MODE: run SQL and pass its results through results.mjs in MODE (tsv or report).
query() {
  local out rc=0
  out=$(mktemp) || return 2
  if ! d1 "$1" execute "$DB_NAME" --json --command "$2" > "$out" 2> "$out.err"; then
    cat "$out.err" "$out" >&2
    rm -f "$out" "$out.err"
    return 2
  fi
  node "$HERE/results.mjs" "$3" < "$out" || rc=$?
  rm -f "$out" "$out.err"
  return "$rc"
}

# rows WHERE SQL: every result row as tab-separated values.
rows() { query "$1" "$2" tsv; }

# report WHERE FILE: a .sql file's results as tables. Fails with 1 when a check found a problem, 2 when the
# queries didn't run.
report() { query "$1" "$(sql_text "$2")" report; }

# counts WHERE: counts.sql's "what<TAB>rows" lines. It reads only what both schemas have.
counts() { rows "$1" "$(sql_text "$HERE/counts.sql")"; }

# db_state WHERE: where the evening stands, read from the database itself, so a rerun picks up wherever the
# last run stopped:
#   old      the five live migrations, no old_* copies: the cutover hasn't run
#   cutover  the fresh 0000 alone, with the old_* copies: cut over, cleanup not yet run
#   clean    the fresh 0000 alone, no copies: done
#   unknown  anything else: stop and look
db_state() {
  local names copies
  names=$(rows "$1" "SELECT name FROM d1_migrations ORDER BY id") || return 1
  copies=$(rows "$1" "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 4) = 'old_'") || return 1
  names=$(printf '%s' "$names" | tr '\n' ' ')
  if [[ "$names" == "$OLD_MIGRATIONS" && "$copies" == 0 ]]; then echo old
  elif [[ "$names" == "$FRESH_MIGRATION" && "$copies" != 0 ]]; then echo cutover
  elif [[ "$names" == "$FRESH_MIGRATION" ]]; then echo clean
  else echo unknown; fi
}

# has_old_tables WHERE: the database holds exactly the tables the backup exports, nothing more or less.
has_old_tables() {
  local found
  found=$(rows "$1" "SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 4) <> '_cf_' AND substr(name, 1, 7) <> 'sqlite_'") || return 1
  # shellcheck disable=SC2086 # OLD_TABLES is a list of words
  [[ "$(printf '%s\n' "$found" | LC_ALL=C sort | tr '\n' ' ')" == "$(printf '%s\n' $OLD_TABLES | LC_ALL=C sort | tr '\n' ' ')" ]]
}

# export_backup: the live database as $OUT/before-schema.sql, all of its structure (tables, indexes, triggers),
# and $OUT/before-data.sql, every row of every table, Sessions included, parents first. Read only.
# The structure export isn't filtered with --table: wrangler then drops every index and trigger.
export_backup() {
  mkdir -p "$OUT" || return 1
  # A failed export must not leave an older backup behind, posing as tonight's.
  rm -f "$OUT/before-schema.sql" "$OUT/before-data.sql" "$OUT/table.sql" || return 1
  d1 live export "$DB_NAME" --no-data --output "$OUT/before-schema.sql.tmp" -y > /dev/null || return 1
  : > "$OUT/before-data.sql.tmp" || return 1
  local t
  for t in $OLD_TABLES; do
    d1 live export "$DB_NAME" --no-schema --table "$t" --output "$OUT/table.sql" -y > /dev/null || return 1
    # An empty table's export is one line with no newline at its end.
    { cat "$OUT/table.sql"; printf '\n'; } >> "$OUT/before-data.sql.tmp" || return 1
  done
  rm -f "$OUT/table.sql"
  mv "$OUT/before-schema.sql.tmp" "$OUT/before-schema.sql" && mv "$OUT/before-data.sql.tmp" "$OUT/before-data.sql"
}

# write_config PATH DATABASE_ID [MIGRATIONS_DIR]: the wrangler config of a throwaway local database.
write_config() {
  local dir=""
  [[ -z "${3:-}" ]] || dir=", \"migrations_dir\": \"$3\""
  cat > "$1" << EOF
// A throwaway local database for the fresh-schema cutover. Never use it with --remote.
{
  "name": "fresh-schema-cutover-local",
  "compatibility_date": "2026-11-01",
  "d1_databases": [{ "binding": "DB", "database_name": "$DB_NAME", "database_id": "$2"$dir }]
}
EOF
}

# restore_backup CONFIG: load the backup into that empty local database: the structure, then the rows with
# foreign keys enforced and the defer pragma stripped, so the parents-first order has to hold on its own.
restore_backup() {
  d1 "$1" execute "$DB_NAME" --file "$OUT/before-schema.sql" > /dev/null || return 1
  grep -v '^PRAGMA defer_foreign_keys' "$OUT/before-data.sql" > "$OUT/before-data-strict.sql" || return 1
  d1 "$1" execute "$DB_NAME" --file "$OUT/before-data-strict.sql" > /dev/null || return 1
  rm -f "$OUT/before-data-strict.sql"
}

# build_cutover: cutover.sql from pre.sql, the squash's 0000 and post.sql.
build_cutover() { bash "$HERE/build.sh" > /dev/null; }

# run_cutover WHERE, run_cleanup WHERE: one file each, which D1 runs all-or-nothing.
run_cutover() { d1 "$1" execute "$DB_NAME" --file "$HERE/cutover.sql" -y; }
run_cleanup() { d1 "$1" execute "$DB_NAME" --file "$HERE/cleanup.sql" -y; }

# dry_run DIR: tonight's cutover on a local copy of tonight's backup, in the empty folder DIR. Restores the
# backup there, checks that it holds what the live database held at the export ($OUT/counts-export.txt), then
# runs cutover.sql and verify.sql on it. Touches nothing remote. The copy holds personal data: delete DIR after.
dry_run() {
  local cfg="$1/dry-run.jsonc"
  write_config "$cfg" 00000000-0000-4000-8000-0000000000d1 || return 1
  restore_backup "$cfg" || { echo "The backup didn't restore into an empty database." >&2; return 1; }
  counts "$cfg" > "$OUT/counts-restored.txt" || return 1
  if ! cmp -s "$OUT/counts-export.txt" "$OUT/counts-restored.txt"; then
    echo "The restored backup doesn't hold what the live database held at the export:" >&2
    diff "$OUT/counts-export.txt" "$OUT/counts-restored.txt" >&2
    return 1
  fi
  build_cutover || return 1
  run_cutover "$cfg" > /dev/null || { echo "cutover.sql failed on the copy." >&2; return 1; }
  report "$cfg" "$HERE/verify.sql"
}
