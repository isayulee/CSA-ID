# shellcheck shell=bash
# The move's data steps, shared by move.sh (remote, on the evening) and rehearse.sh (local, fake data),
# so the rehearsal runs exactly the code the evening runs. Source it after setting:
#   WR       the wrangler executable
#   WHERE    --remote or --local
#   OLD_CFG  wrangler config for the old account's database and namespace
#   NEW_CFG  wrangler config for the shared account's (the repo's wrangler.jsonc on the evening)
#   OUT      where exports go. On the evening they hold Peer Advisers' personal data: delete them after.
#   HERE     this folder

old_d1() { "$WR" d1 "$@" "$WHERE" --config "$OLD_CFG"; }
new_d1() { "$WR" d1 "$@" "$WHERE" --config "$NEW_CFG"; }
old_kv() { "$WR" kv "$@" "$WHERE" --config "$OLD_CFG" --binding KV; }
new_kv() { "$WR" kv "$@" "$WHERE" --config "$NEW_CFG" --binding KV; }

# Written for bash 3.2 too (macOS): no mapfile, no tac.

# d1_rows old|new SQL: print each result row as tab-separated values. SQL may hold several statements.
# Uses --command, because a remote --file run goes through D1's import and returns no rows.
d1_rows() {
  local side="$1" sql="$2" json err
  json=$(mktemp); err=$(mktemp)
  if ! "${side}_d1" execute csa-id --json --command "$sql" > "$json" 2> "$err"; then
    cat "$err" >&2; rm -f "$json" "$err"; return 1
  fi
  node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");for(const r of JSON.parse(s))for(const row of r.results||[])console.log(Object.values(row).join("\t"))' "$json"
  rm -f "$json" "$err"
}

# table_args: the saved data table list as repeated --table flags, into the array TABLE_ARGS.
table_args() {
  TABLE_ARGS=()
  local t
  while IFS= read -r t; do [[ -n "$t" ]] && TABLE_ARGS+=(--table "$t"); done < "$OUT/data-tables.txt"
}

# app_tables old|new: the database's tables in creation order, without D1's and SQLite's own.
app_tables() {
  d1_rows "$1" "SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 4) <> '_cf_' AND substr(name, 1, 7) <> 'sqlite_' ORDER BY rowid"
}

# counts old|new: one "table<TAB>rows" line per table.
counts() {
  local t sql=""
  for t in $(app_tables "$1"); do sql+="SELECT '$t' AS t, count(*) AS n FROM \"$t\";"; done
  [[ -n "$sql" ]] && d1_rows "$1" "$sql"
}

# migration_level old|new: the applied migration file names, in order.
migration_level() { d1_rows "$1" "SELECT name FROM d1_migrations ORDER BY id"; }

# export_db: the old database as $OUT/import.sql, the structure followed by the data.
# Rows of every table move except sessions: tokens stay behind, and everyone signs in again.
# The table list is saved, so later steps (even in a re-run) compare exactly the same tables.
# The structure export is NOT filtered with --table: wrangler then drops every index and trigger.
# The data export starts with PRAGMA defer_foreign_keys, so its table order doesn't matter.
export_db() {
  mkdir -p "$OUT"
  app_tables old | grep -v -x sessions > "$OUT/data-tables.txt"
  table_args
  old_d1 export csa-id --no-data --output "$OUT/schema.sql" -y
  old_d1 export csa-id --no-schema "${TABLE_ARGS[@]}" --output "$OUT/data.sql" -y
  { cat "$OUT/schema.sql"; printf '\n'; cat "$OUT/data.sql"; } > "$OUT/import.sql"
}

# import_db: one file, so D1 runs it all-or-nothing.
import_db() { new_d1 execute csa-id --file "$OUT/import.sql" -y; }

# same_data_as_export old|new: does the database still hold exactly the exported rows? Byte-for-byte.
same_data_as_export() {
  local side="$1"
  table_args
  "${side}_d1" export csa-id --no-schema "${TABLE_ARGS[@]}" --output "$OUT/data-$side-now.sql" -y >/dev/null
  if cmp -s "$OUT/data.sql" "$OUT/data-$side-now.sql"; then rm -f "$OUT/data-$side-now.sql"; return 0; fi
  return 1
}

# changed_tables old|new: after same_data_as_export failed, how many row lines differ per table.
# The exact rows stay in $OUT/changes-<side>.diff ("<" as exported, ">" as now) for a person to copy.
changed_tables() {
  diff "$OUT/data.sql" "$OUT/data-$1-now.sql" > "$OUT/changes-$1.diff" || true
  grep -o -E '^[<>] INSERT INTO "[a-z_0-9]+"' "$OUT/changes-$1.diff" |
    sed -E 's/^[<>] INSERT INTO "([a-z_0-9]+)"/\1/' | sort | uniq -c || true
  rm -f "$OUT/data-$1-now.sql"
}

# migrate_new: apply the checked-out code's migrations the shared database doesn't have yet.
migrate_new() { new_d1 migrations apply csa-id; }

# empty_new_db: drop every table in the shared account's database, so a failed or undone move can run
# again. Never point NEW_CFG at the old database: move.sh checks the account and database id first.
empty_new_db() {
  local t sql="PRAGMA defer_foreign_keys = TRUE;"
  for t in $(app_tables new | awk '{ l[NR] = $0 } END { for (i = NR; i > 0; i--) print l[i] }'); do
    sql+=" DROP TABLE IF EXISTS \"$t\";"
  done
  new_d1 execute csa-id --command "$sql" -y >/dev/null
}

# export_kv: every img/ key with its metadata, as files plus a bulk-put bundle. Other keys (report rate
# limits) expire within a minute and stay behind.
export_kv() {
  mkdir -p "$OUT/kv"
  old_kv key list --prefix img/ > "$OUT/kv/list.json"
  local idx key
  while IFS=$'\t' read -r idx key; do
    old_kv key get "$key" > "$OUT/kv/$idx.bin"
  done < <(node "$HERE/kv-files.mjs" names "$OUT/kv/list.json")
  node "$HERE/kv-files.mjs" bundle "$OUT/kv/list.json" "$OUT/kv" "$OUT/kv/bulk.json"
}

kv_count() { node "$HERE/kv-files.mjs" count "$OUT/kv/list.json"; }

import_kv() {
  [[ "$(kv_count)" -gt 0 ]] || return 0
  new_kv bulk put "$OUT/kv/bulk.json"
}

# verify_kv: the shared namespace has the same img/ keys and metadata, and every value byte for byte.
verify_kv() {
  new_kv key list --prefix img/ > "$OUT/kv/list-new.json"
  node "$HERE/kv-files.mjs" same "$OUT/kv/list.json" "$OUT/kv/list-new.json" || return 1
  local idx key
  while IFS=$'\t' read -r idx key; do
    new_kv key get "$key" > "$OUT/kv/check.bin"
    if ! cmp -s "$OUT/kv/$idx.bin" "$OUT/kv/check.bin"; then echo "differs: $key" >&2; return 1; fi
  done < <(node "$HERE/kv-files.mjs" names "$OUT/kv/list.json")
  rm -f "$OUT/kv/check.bin"
}

# compare_counts before after: every table of "before" except sessions has the same rows in "after".
# d1_migrations may grow by the migrations applied tonight; tables only in "after" came from them.
compare_counts() {
  node -e '
    const fs = require("fs");
    const read = f => new Map(fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(l => l.split("\t")));
    const [a, b] = [read(process.argv[1]), read(process.argv[2])];
    let ok = true;
    const line = (t, n, m, note) => console.log(`  ${t.padEnd(24)} ${n.padStart(6)} → ${m.padStart(6)}  ${note}`);
    for (const [t, n] of a) {
      const m = b.get(t) ?? "missing";
      if (t === "sessions") { line(t, n, m, "(not moved)"); continue; }
      if (t === "d1_migrations") {
        const grew = Number(m) - Number(n); ok &&= grew >= 0;
        line(t, n, m, grew > 0 ? `ok (+${grew} applied tonight)` : grew === 0 ? "ok" : "FEWER");
        continue;
      }
      const same = m === n; ok &&= same;
      line(t, n, m, same ? "ok" : "DIFFERENT");
    }
    for (const [t, m] of b) if (!a.has(t)) line(t, "-", m, "(new tonight)");
    process.exit(ok ? 0 : 1);
  ' "$1" "$2"
}
