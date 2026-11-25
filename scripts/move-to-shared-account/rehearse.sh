#!/usr/bin/env bash
# Rehearses the move evening's data steps on two LOCAL databases and KV namespaces holding fake data
# shaped like live, by running the same lib.sh functions move.sh runs. Never passes --remote.
#   bash scripts/move-to-shared-account/rehearse.sh
# On Windows keep the checkout path short: past 260 characters wrangler fails with a bare "internal error".
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
R="$HERE/.rehearsal"
WR="${WRANGLER:-$REPO/node_modules/.bin/wrangler}"
WHERE=--local
OLD_CFG="$R/old.jsonc"
NEW_CFG="$R/new.jsonc"
OUT="$R/out"
export CI=true # wrangler skips its "Ok to proceed?" prompts
# shellcheck source=lib.sh
source "$HERE/lib.sh"

failures=0
section() { printf '\n== %s\n' "$1"; }
pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; failures=$((failures + 1)); }
check() { local what="$1"; shift; if "$@"; then pass "$what"; else fail "$what"; fi; }
equals() { [[ "$1" == "$2" ]]; }
schema_objects() { d1_rows "$1" "SELECT type, name FROM sqlite_master WHERE substr(name, 1, 16) <> 'sqlite_autoindex' AND substr(name, 1, 4) <> '_cf_' ORDER BY type, name"; }
# One after the other: both databases share a local state folder, and two wranglers at once can find it locked.
same_schema_objects() {
  local old new
  old=$(schema_objects old) && new=$(schema_objects new) && [[ -n "$old" && "$old" == "$new" ]]
}
slug_is_locked() { ! new_d1 execute csa-id --command "UPDATE profiles SET slug = 'stolen' WHERE id = 'p1'" >/dev/null 2>&1; }
# The triggers only fire on a row, so an empty log gets one first.
audit_log_is_append_only() {
  if [[ "$(d1_rows new 'SELECT count(*) FROM admin_audit_log')" == 0 ]]; then
    new_d1 execute csa-id --command "INSERT INTO admin_audit_log (id, actor_google_sub, action, target_profile_id, reason) VALUES ('a1', '1', 'suspend', 'p4', 'rehearsal')" >/dev/null || return 1
  fi
  ! new_d1 execute csa-id --command "DELETE FROM admin_audit_log" >/dev/null 2>&1 &&
    ! new_d1 execute csa-id --command "UPDATE admin_audit_log SET reason = 'x'" >/dev/null 2>&1
}
# Every insert must hold on its own, as if D1 ignored the pragma. Local D1 enforces foreign keys.
without_defer() { grep -v '^PRAGMA defer_foreign_keys=TRUE;$' "$1"; }
import_without_defer() { new_d1 execute csa-id --file "$1" -y > "$R/import.log" 2>&1; }
export_order_is_rejected() {
  { cat "$OUT/schema.sql"; printf '\n'; cat "$OUT/data.sql"; } > "$R/export-order.sql"
  without_defer "$R/export-order.sql" > "$R/export-order-strict.sql"
  ! import_without_defer "$R/export-order-strict.sql" && grep -q 'FOREIGN KEY constraint failed' "$R/import.log"
}

# rehearse LEVEL: the whole evening with the old database at that migration.
rehearse() {
LEVEL="$1"
section "Old database at $LEVEL. Setup: two throwaway local 'accounts'"
rm -rf "$R"
mkdir -p "$R/migrations-old" "$R/images" "$OUT"
# The new database applies the repo's migrations on top of the old one's.
local m
for m in "$REPO"/migrations/*.sql; do
  [[ "$(basename "$m")" > "${LEVEL}_~" ]] || cp "$m" "$R/migrations-old/"
done
cat > "$OLD_CFG" <<'EOF'
// Rehearsal only, never --remote: stands in for ymsrubio's account.
{
  "name": "rehearsal-old",
  "compatibility_date": "2026-11-01",
  "d1_databases": [{ "binding": "DB", "database_name": "csa-id", "database_id": "00000000-0000-4000-8000-0000000001d0", "migrations_dir": "migrations-old" }],
  "kv_namespaces": [{ "binding": "KV", "id": "000000000000000000000000000001d0" }]
}
EOF
cat > "$NEW_CFG" <<'EOF'
// Rehearsal only, never --remote: stands in for the shared team account.
{
  "name": "rehearsal-new",
  "compatibility_date": "2026-11-01",
  "d1_databases": [{ "binding": "DB", "database_name": "csa-id", "database_id": "00000000-0000-4000-8000-0000000004e0", "migrations_dir": "../../../migrations" }],
  "kv_namespaces": [{ "binding": "KV", "id": "000000000000000000000000000004e0" }]
}
EOF
old_d1 migrations apply csa-id >/dev/null
old_d1 execute csa-id --file "$HERE/rehearsal/seed-0002.sql" >/dev/null
if [[ "$LEVEL" == 0004 ]]; then old_d1 execute csa-id --file "$HERE/rehearsal/seed-0004.sql" >/dev/null; fi
# Fake WebP files holding the bytes that break text handling: NUL, LF, CR, 0xFF and 0x1A.
node -e '
  const fs = require("fs");
  const make = (n, seed) => { const b = Buffer.alloc(n); b.write("RIFF", 0); b.writeUInt32LE(n - 8, 4); b.write("WEBP", 8);
    for (let i = 12; i < n; i++) b[i] = (i * seed + 7) % 256; b.set([0, 10, 13, 255, 26], 20); return b; };
  fs.writeFileSync(process.argv[1] + "/a.webp", make(5000, 31));
  fs.writeFileSync(process.argv[1] + "/b.webp", make(70000, 17));
  fs.writeFileSync(process.argv[1] + "/c.webp", make(300, 3));' "$R/images"
put_image() { old_kv key put "$1" --path "$R/images/$2" --metadata '{"contentType":"image/webp"}' >/dev/null; }
put_image "img/p1/avatar/11111111-1111-4111-8111-111111111111.webp" a.webp
put_image "img/p1/background/22222222-2222-4222-8222-222222222222.webp" b.webp
put_image "img/p2/avatar/33333333-3333-4333-8333-333333333333.webp" c.webp
old_kv key put "report-rate/203.0.113.7" 1 --ttl 3600 >/dev/null
echo "  old database: $(app_tables old | wc -l | tr -d ' ') tables, last migration $(migration_level old | tail -n 1)"

section "Stage 2: count the old database (read only)"
counts old > "$OUT/counts-old.txt"
sed 's/^/  /' "$OUT/counts-old.txt"

section "Stage 3: export the old database"
export_db >/dev/null
check "the data export leaves Session rows behind" equals "$(grep -c '^INSERT INTO "sessions"' "$OUT/data.sql" || true)" 0
local triggers=2 indexes=10
if [[ "$LEVEL" == 0004 ]]; then triggers=4 indexes=11; fi
check "the structure export keeps all $triggers triggers" equals "$(grep -c '^CREATE TRIGGER' "$OUT/schema.sql")" "$triggers"
check "the structure export keeps all $indexes named indexes" equals "$(grep -c -E '^CREATE (UNIQUE )?INDEX' "$OUT/schema.sql")" "$indexes"
check "the import file leaves Session rows behind" equals "$(grep -c '^INSERT INTO "sessions"' "$OUT/import.sql" || true)" 0

section "Stage 4: export the images"
export_kv >/dev/null
check "3 img/ keys exported; the rate-limit key stays behind" equals "$(kv_count)" 3

section "Import order: foreign keys enforced, defer pragmas stripped"
check "the order as exported is rejected, like on the evening" export_order_is_rejected
empty_new_db
without_defer "$OUT/import.sql" > "$R/import-strict.sql"
check "no defer pragma is left in the stripped file" equals "$(grep -c '^PRAGMA' "$R/import-strict.sql" || true)" 0
check "import.sql's order is accepted" import_without_defer "$R/import-strict.sql"
check "and it holds exactly the exported rows, byte for byte" same_data_as_export new
empty_new_db

section "Stage 5: import into the shared database, then its pending migrations"
import_db >/dev/null
check "it holds exactly the exported rows, byte for byte" same_data_as_export new
check "same tables, indexes and triggers as the old database" same_schema_objects
check "no Session rows moved" equals "$(d1_rows new 'SELECT count(*) FROM sessions')" 0
migrate_new >/dev/null
check "the new database ends at 0004, with any pending migrations applied on top" equals "$(migration_level new | tr '\n' ' ')" \
  "0000_init_users_sessions.sql 0001_initial.sql 0002_reserved_slugs_survive_deletion.sql 0003_admin_audit_log.sql 0004_profile_evaluation_appearance.sql "
check "a Slug still can't change" slug_is_locked
check "the audit log from 0003 is append-only" audit_log_is_append_only

section "Stage 6: import the images"
import_kv >/dev/null
check "same keys, content types and bytes" verify_kv
check "the rate-limit key didn't move" equals "$(new_kv key list --prefix report-rate/)" "[]"

section "Stage 8: the counts match"
counts new > "$OUT/counts-new.txt"
check "every moved table kept its rows" compare_counts "$OUT/counts-old.txt" "$OUT/counts-new.txt"

section "Stage 10: late writes on the old site"
check "nothing changed since the export: none reported" same_data_as_export old
old_d1 execute csa-id --command "UPDATE profiles SET bio = 'edited after the export' WHERE id = 'p2'" >/dev/null
if same_data_as_export old; then fail "a late edit went unnoticed"; else pass "a late edit is caught:"; changed_tables old | sed 's/^/        /'; fi

section "Starting over: empty the shared database and import again"
empty_new_db
check "the shared database is empty" equals "$(app_tables new)" ""
import_db >/dev/null
check "the second import matches the export too" same_data_as_export new

}

failure_checks() {
section "Failures: every step that can't finish says so, called the way move.sh's must calls it"
# The fake Wrangler passes calls on, except that one holding FAIL_ON writes part of its output and fails.
REAL_WR="$WR"
export REAL_WR FAIL_ON=""
cat > "$R/fake-wrangler" <<'EOF'
#!/usr/bin/env bash
if [[ -n "$FAIL_ON" && " $* " == *"$FAIL_ON"* ]]; then
  out=""
  for a in "$@"; do
    if [[ "$out" == next ]]; then out="$a"; break; fi
    if [[ "$a" == --output ]]; then out=next; fi
  done
  if [[ -n "$out" ]]; then printf 'PRAGMA defer_foreign_keys=TRUE;\n' > "$out"; else printf '[]'; fi
  exit 1
fi
exec "$REAL_WR" "$@"
EOF
chmod +x "$R/fake-wrangler"
WR="$R/fake-wrangler"
fails() { FAIL_ON="$1"; shift; local rc=0; if "$@" >/dev/null 2>&1; then rc=1; fi; FAIL_ON=""; return "$rc"; }
works() { if "$@" >/dev/null 2>&1; then return 0; else return 1; fi; }
leaves_none() { [[ ! -e "$1" ]]; }

check "export_db works when nothing fails" works export_db
check "export_kv works when nothing fails" works export_kv
check "verify_kv works when nothing fails" works verify_kv
check "counts: the table list fails" fails "execute" counts old
check "import_db fails" fails "--file" import_db
check "same_data_as_export: the fresh export fails" fails "--no-schema" same_data_as_export old
local rc=0
cp "$OUT/data.sql" "$OUT/data-old-now.sql"
FAIL_ON="--no-schema"; same_data_as_export old >/dev/null 2>&1 || rc=$?; FAIL_ON=""
check "  with 2, so it isn't mistaken for a difference, even next to an older copy" equals "$rc" 2
check "  and changed_tables doesn't report that nothing changed" fails "" changed_tables old
mv "$OUT/data-tables.txt" "$R/kept.txt"
check "same_data_as_export: without the table list it fails" fails "" same_data_as_export old
mv "$R/kept.txt" "$OUT/data-tables.txt"
check "empty_new_db: the table list fails" fails "execute" empty_new_db
check "migrate_new fails" fails "migrations apply" migrate_new
check "import_kv fails" fails "bulk put" import_kv
check "verify_kv: the key list fails" fails "key list" verify_kv
check "verify_kv: one image download fails" fails "key get img/p1/background" verify_kv
printf 'x' >> "$OUT/kv/0001.bin"
check "verify_kv: a byte differs" fails "" verify_kv
check "export_db: the table list fails" fails "execute" export_db
check "  and no older import.sql is left to import" leaves_none "$OUT/import.sql"
check "export_db: the structure export fails" fails "--no-data" export_db
check "  and there is no import.sql" leaves_none "$OUT/import.sql"
check "export_db: the data export fails" fails "--no-schema" export_db
check "  and there is no import.sql" leaves_none "$OUT/import.sql"
check "export_kv: the key list fails" fails "key list" export_kv
check "  and no older bulk.json is left to import" leaves_none "$OUT/kv/bulk.json"
check "  so import_kv refuses instead of importing nothing" fails "" import_kv
check "export_kv: one image download fails" fails "key get img/p1/background" export_kv
check "  and there is no bulk.json" leaves_none "$OUT/kv/bulk.json"
WR="$REAL_WR"
}

section "The import file"
check "import file checks" node --disable-warning=ExperimentalWarning "$HERE/rehearsal/import-file-test.mjs"
rehearse 0002
rehearse 0004
failure_checks

section "The redirect Worker"
check "redirect Worker checks" node "$HERE/redirect-worker/test.mjs"

if ((failures)); then
  printf '\n%s check(s) FAILED. Throwaway state: %s\n' "$failures" "$R"
  exit 1
fi
rm -rf "$R"
printf '\nAll checks passed. The throwaway state is deleted.\n'
