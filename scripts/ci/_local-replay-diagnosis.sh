#!/usr/bin/env bash
# Local diagnosis replay: apply every migration from zero, CONTINUE on error,
# and record the first error of each failing migration.
# Not a CI script — see scripts/ci/bootstrap-supabase-test-db.sh for that.
set -uo pipefail

export PGHOST=/tmp/pgbase/run PGPORT=55432 PGUSER=postgres PGDATABASE=replay
DB=replay
OUT=${1:-/tmp/replay}
mkdir -p "$OUT"
: > "$OUT/failures.tsv"
: > "$OUT/replay.log"

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null
psql -X -q -d postgres -c "CREATE DATABASE $DB" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -f scripts/ci/supabase-bootstrap.sql >/dev/null || { echo "bootstrap failed"; exit 1; }

ok=0; fail=0
for f in $(ls supabase/migrations/*.sql | sort); do
  if err=$(psql -X -q -1 -v ON_ERROR_STOP=1 -f "$f" 2>&1 >/dev/null); then
    ok=$((ok+1))
  else
    fail=$((fail+1))
    first=$(printf '%s\n' "$err" | grep -m1 -E '^psql:.*(ERROR|FATAL)' | sed 's/^psql:[^ ]* //')
    printf '%s\t%s\n' "$(basename "$f")" "$first" >> "$OUT/failures.tsv"
    printf '==> FAIL %s\n%s\n' "$f" "$err" >> "$OUT/replay.log"
  fi
done
echo "applied=$ok failed=$fail"
