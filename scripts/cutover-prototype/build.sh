#!/usr/bin/env bash
# PROTOTYPE, wipe me. Builds cutover.sql = pre.sql + the fresh 0000 + post.sql, as one file for one
# all-or-nothing `wrangler d1 execute --file`. In the real cutover, the 0000 is the drizzle-kit output.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
{
  cat "$HERE/pre.sql"
  echo
  echo "-- Cutover part 2 of 3: the fresh schema (new-migrations/0000_fresh_schema.sql)."
  grep -v -e '^--> statement-breakpoint$' "$HERE/new-migrations/0000_fresh_schema.sql" | sed 's/--> statement-breakpoint$//'
  echo
  cat "$HERE/post.sql"
} > "$HERE/cutover.sql"
echo "Built $HERE/cutover.sql ($(wc -l < "$HERE/cutover.sql") lines)"
