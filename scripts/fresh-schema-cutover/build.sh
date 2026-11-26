#!/usr/bin/env bash
# Builds cutover.sql from pre.sql, the squash's real migrations/0000_fresh_schema.sql and post.sql, as one file
# for one all-or-nothing `wrangler d1 execute --file`. The output depends only on those three files, so anyone
# can rerun it and get the same cutover.sql.
#   bash scripts/fresh-schema-cutover/build.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
FRESH="$REPO/migrations/0000_fresh_schema.sql"

# post.sql and verify.sql record this exact file name in d1_migrations.
found=$(cd "$REPO/migrations" && ls -- *.sql | tr '\n' ' ')
if [[ "$found" != "0000_fresh_schema.sql " ]]; then
  echo "migrations/ must hold exactly 0000_fresh_schema.sql, the squash's fresh schema. It holds: $found" >&2
  exit 1
fi

{
  cat "$HERE/pre.sql"
  printf '\n-- Cutover part 2 of 3: the fresh schema, migrations/0000_fresh_schema.sql as it is.\n'
  # Drop drizzle-kit's breakpoint markers. A checkout with core.autocrlf has CRLF line endings: drop the CRs.
  tr -d '\r' < "$FRESH" | sed -e '/^--> statement-breakpoint$/d' -e 's/--> statement-breakpoint$//'
  printf '\n\n'
  cat "$HERE/post.sql"
} > "$HERE/cutover.sql.tmp"
mv "$HERE/cutover.sql.tmp" "$HERE/cutover.sql"
echo "Built $HERE/cutover.sql ($(wc -l < "$HERE/cutover.sql" | tr -d ' ') lines)"
