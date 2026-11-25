# shellcheck shell=bash
# The move's data steps, shared by move.sh (remote, on the evening) and rehearse.sh (local, fake data),
# so the rehearsal runs exactly the code the evening runs. Source it after setting:
#   WR       the wrangler executable
#   WHERE    --remote or --local
#   OLD_CFG  wrangler config for the old account's database and namespace
#   NEW_CFG  wrangler config for the shared account's (the repo's wrangler.jsonc on the evening)
#   OUT      where exports go. On the evening they hold Peer Advisers' personal data: delete them after.
#   HERE     this folder

# The old and the shared account may be reached by two different Cloudflare logins. Wrangler picks a login
# per process from CLOUDFLARE_AUTH_PROFILE ("default" is the plain `wrangler login`), and child processes
# such as `npm run deploy` inherit it, which a --profile flag could not do. So every remote command runs
# through as_old or as_new. The rehearsal (--local) never sets them: "default" is harmless there.
#   OLD_PROFILE / NEW_PROFILE  the login for each account; move.sh finds them in its preflight (find_logins).
as_old() { CLOUDFLARE_AUTH_PROFILE="${OLD_PROFILE:-default}" "$@"; }
as_new() { CLOUDFLARE_AUTH_PROFILE="${NEW_PROFILE:-default}" "$@"; }

old_d1() { as_old "$WR" d1 "$@" "$WHERE" --config "$OLD_CFG"; }
new_d1() { as_new "$WR" d1 "$@" "$WHERE" --config "$NEW_CFG"; }
old_kv() { as_old "$WR" kv "$@" "$WHERE" --config "$OLD_CFG" --binding KV; }
new_kv() { as_new "$WR" kv "$@" "$WHERE" --config "$NEW_CFG" --binding KV; }

# login_reaches PROFILE ACCOUNT_ID: read only. Does that login's account list hold the account?
login_reaches() {
  CLOUDFLARE_AUTH_PROFILE="$1" "$WR" whoami --json 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      try { process.exit(JSON.parse(s).accounts.some(a => a.id === process.argv[1]) ? 0 : 1); } catch { process.exit(1); }
    })' "$2"
}

# find_login VAR ACCOUNT_ID NAMED_PROFILE: set VAR to the first login that reaches the account: the named
# profile (wrangler auth create NAMED_PROFILE), else the default one. Fails when neither does.
find_login() {
  local var="$1" account="$2" p
  for p in "$3" default; do
    if login_reaches "$p" "$account"; then printf -v "$var" '%s' "$p"; return 0; fi
  done
  return 1
}

# Written for bash 3.2 too (macOS): no mapfile, no tac.
#
# move.sh calls these through `must` and in conditions, where bash ignores `set -e` all the way down. So every
# step returns its own failure, and nothing reads from a process substitution, whose status bash drops.

# d1_rows old|new SQL: print each result row as tab-separated values. SQL may hold several statements.
# Uses --command, because a remote --file run goes through D1's import and returns no rows.
d1_rows() {
  local side="$1" sql="$2" json err
  json=$(mktemp); err=$(mktemp)
  if ! "${side}_d1" execute csa-id --json --command "$sql" > "$json" 2> "$err"; then
    cat "$err" >&2; rm -f "$json" "$err"; return 1
  fi
  node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");for(const r of JSON.parse(s))for(const row of r.results||[])console.log(Object.values(row).join("\t"))' "$json" ||
    { rm -f "$json" "$err"; echo "unreadable query result" >&2; return 1; }
  rm -f "$json" "$err"
}

# table_args: the saved data table list as repeated --table flags, into the array TABLE_ARGS.
# An empty list is a failure: without --table, wrangler exports every table, Sessions included.
table_args() {
  TABLE_ARGS=()
  [[ -s "$OUT/data-tables.txt" ]] || { echo "$OUT/data-tables.txt is missing or empty" >&2; return 1; }
  local t
  while IFS= read -r t; do [[ -n "$t" ]] && TABLE_ARGS+=(--table "$t"); done < "$OUT/data-tables.txt"
}

# app_tables old|new: the database's tables in creation order, without D1's and SQLite's own.
app_tables() {
  d1_rows "$1" "SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 4) <> '_cf_' AND substr(name, 1, 7) <> 'sqlite_' ORDER BY rowid"
}

# counts old|new: one "table<TAB>rows" line per table.
counts() {
  local t tables sql=""
  tables=$(app_tables "$1") || return 1
  for t in $tables; do sql+="SELECT '$t' AS t, count(*) AS n FROM \"$t\";"; done
  [[ -n "$sql" ]] && d1_rows "$1" "$sql"
}

# migration_level old|new: the applied migration file names, in order.
migration_level() { d1_rows "$1" "SELECT name FROM d1_migrations ORDER BY id"; }

# export_db: the old database as $OUT/import.sql, the structure followed by the data.
# Rows of every table move except sessions: tokens stay behind, and everyone signs in again.
# The table list is saved, so later steps (even in a re-run) compare exactly the same tables.
# The structure export is NOT filtered with --table: wrangler then drops every index and trigger.
# data.sql stays exactly as exported, because same_data_as_export compares it with a fresh export.
# import-file.mjs writes import.sql with parents before children; see there for why.
export_db() {
  mkdir -p "$OUT" || return 1
  # A failed re-export must not leave an older import.sql for stage 5 to pick up.
  rm -f "$OUT/schema.sql" "$OUT/data.sql" "$OUT/import.sql" "$OUT/data-tables.txt" || return 1
  local tables
  tables=$(app_tables old) || return 1
  printf '%s\n' "$tables" | awk 'NF && $0 != "sessions"' > "$OUT/data-tables.txt" || return 1
  table_args || return 1
  old_d1 export csa-id --no-data --output "$OUT/schema.sql" -y || return 1
  old_d1 export csa-id --no-schema "${TABLE_ARGS[@]}" --output "$OUT/data.sql" -y || return 1
  node --disable-warning=ExperimentalWarning "$HERE/import-file.mjs" \
    "$OUT/schema.sql" "$OUT/data.sql" "$OUT/data-tables.txt" "$OUT/import.sql"
}

# import_db: one file, so D1 runs it all-or-nothing.
import_db() { new_d1 execute csa-id --file "$OUT/import.sql" -y; }

# same_data_as_export old|new: does the database still hold exactly the exported rows? Byte-for-byte.
# Fails with 2, not 1, when it couldn't compare.
same_data_as_export() {
  local side="$1"
  rm -f "$OUT/data-$side-now.sql"
  table_args || return 2
  [[ -s "$OUT/data.sql" ]] || { echo "$OUT/data.sql is missing or empty" >&2; return 2; }
  "${side}_d1" export csa-id --no-schema "${TABLE_ARGS[@]}" --output "$OUT/data-$side-now.sql" -y >/dev/null ||
    { rm -f "$OUT/data-$side-now.sql"; echo "Couldn't export the $side database to compare it." >&2; return 2; }
  if cmp -s "$OUT/data.sql" "$OUT/data-$side-now.sql"; then rm -f "$OUT/data-$side-now.sql"; return 0; fi
  return 1
}

# changed_tables old|new: after same_data_as_export failed, how many row lines differ per table.
# The exact rows stay in $OUT/changes-<side>.diff ("<" as exported, ">" as now) for a person to copy.
# Fails when there's nothing to compare, so a failed export is never taken for "no table changed".
changed_tables() {
  [[ -f "$OUT/data-$1-now.sql" ]] || { echo "The $1 database couldn't be read, so its changes are unknown." >&2; return 1; }
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
  local t tables sql="PRAGMA defer_foreign_keys = TRUE;"
  tables=$(app_tables new) || return 1
  for t in $(awk '{ l[NR] = $0 } END { for (i = NR; i > 0; i--) print l[i] }' <<< "$tables"); do
    sql+=" DROP TABLE IF EXISTS \"$t\";"
  done
  new_d1 execute csa-id --command "$sql" -y >/dev/null
}

# export_kv: every img/ key with its metadata, as files plus a bulk-put bundle. Other keys (report rate
# limits) expire within a minute and stay behind.
export_kv() {
  mkdir -p "$OUT/kv" || return 1
  # A failed re-export must not leave an older export for stage 6 to import or compare with.
  rm -f "$OUT"/kv/* || return 1
  old_kv key list --prefix img/ > "$OUT/kv/list.json" || return 1
  node "$HERE/kv-files.mjs" names "$OUT/kv/list.json" > "$OUT/kv/names.txt" || return 1
  local idx key
  while IFS=$'\t' read -r idx key; do
    old_kv key get "$key" > "$OUT/kv/$idx.bin" < /dev/null ||
      { rm -f "$OUT/kv/$idx.bin"; echo "couldn't download: $key" >&2; return 1; }
  done < "$OUT/kv/names.txt"
  node "$HERE/kv-files.mjs" bundle "$OUT/kv/list.json" "$OUT/kv" "$OUT/kv/bulk.json"
}

kv_count() { node "$HERE/kv-files.mjs" count "$OUT/kv/list.json"; }

# import_kv: bulk.json is the last thing export_kv writes, so without it the export never finished.
import_kv() {
  [[ -s "$OUT/kv/bulk.json" ]] || { echo "the image export is missing or unfinished: run stage 4 again" >&2; return 1; }
  local n
  n=$(kv_count) || return 1
  [[ "$n" -gt 0 ]] || return 0
  new_kv bulk put "$OUT/kv/bulk.json"
}

# verify_kv: the shared namespace has the same img/ keys and metadata, and every value byte for byte.
verify_kv() {
  new_kv key list --prefix img/ > "$OUT/kv/list-new.json" || return 1
  node "$HERE/kv-files.mjs" same "$OUT/kv/list.json" "$OUT/kv/list-new.json" || return 1
  node "$HERE/kv-files.mjs" names "$OUT/kv/list.json" > "$OUT/kv/names.txt" || return 1
  local idx key
  while IFS=$'\t' read -r idx key; do
    new_kv key get "$key" > "$OUT/kv/check.bin" < /dev/null || { echo "couldn't download: $key" >&2; return 1; }
    if ! cmp -s "$OUT/kv/$idx.bin" "$OUT/kv/check.bin"; then echo "differs: $key" >&2; return 1; fi
  done < "$OUT/kv/names.txt"
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
