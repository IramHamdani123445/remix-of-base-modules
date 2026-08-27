#!/usr/bin/env bash
# =====================================================================
# Load a Lovable Cloud "Export data" CSV bundle into the mirrored
# external Supabase project created by bootstrap-external-supabase.sh.
#
# Expects a directory of CSV files named <schema>.<table>.csv or
# <table>.csv (public assumed), each with a header row.
#
# Usage:
#   TARGET_DATABASE_URL='postgresql://...' \
#     scripts/mirror/load-export-csvs.sh /path/to/export-dir
#
# Options:
#   TRUNCATE=1   empty each target table before loading
# =====================================================================
set -euo pipefail

DB_URL="${TARGET_DATABASE_URL:-}"
EXPORT_DIR="${1:-}"
TRUNCATE="${TRUNCATE:-0}"

[[ -n "$DB_URL" ]]     || { echo "::error::TARGET_DATABASE_URL must be set" >&2; exit 2; }
[[ -d "$EXPORT_DIR" ]] || { echo "::error::usage: $0 <export-dir>" >&2; exit 2; }

case "$DB_URL" in
  *xynceskeiiisiefqlgxo*)
    echo "::error::refusing to run: TARGET_DATABASE_URL points at the source project" >&2
    exit 2;;
esac

FAILED=()
LOADED=0

# Constraints are deferred for the whole load so table order does not matter.
echo "==> loading CSVs from $EXPORT_DIR"
for csv in "$EXPORT_DIR"/*.csv; do
  [[ -e "$csv" ]] || { echo "::error::no CSV files found in $EXPORT_DIR" >&2; exit 2; }
  base="$(basename "$csv" .csv)"
  if [[ "$base" == *.* ]]; then
    schema="${base%%.*}"; table="${base#*.}"
  else
    schema="public";      table="$base"
  fi

  exists="$(psql "$DB_URL" -X -q -t -A -c \
    "SELECT 1 FROM information_schema.tables WHERE table_schema='$schema' AND table_name='$table'")"
  if [[ -z "$exists" ]]; then
    echo "    -- skip $schema.$table (not present in target)"
    continue
  fi

  echo "    -> $schema.$table"
  if ! psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 <<SQL 2>/tmp/mirror-load-err.txt
BEGIN;
SET CONSTRAINTS ALL DEFERRED;
SET session_replication_role = replica;
$([[ "$TRUNCATE" == "1" ]] && echo "TRUNCATE \"$schema\".\"$table\" CASCADE;")
\\copy "$schema"."$table" FROM '$csv' WITH (FORMAT csv, HEADER true)
COMMIT;
SQL
  then
    echo "       FAILED: $(tail -n 2 /tmp/mirror-load-err.txt | tr '\n' ' ')"
    FAILED+=("$schema.$table")
    continue
  fi
  LOADED=$((LOADED + 1))
done

echo "==> loaded $LOADED table(s)"
if (( ${#FAILED[@]} )); then
  echo "==> ${#FAILED[@]} table(s) failed:"
  printf '    %s\n' "${FAILED[@]}"
  echo "    Re-run just those after resolving the reported error."
  exit 1
fi

echo "==> resetting identity sequences"
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE r record; maxv bigint;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl, a.attname AS col, pg_get_serial_sequence('public.'||c.relname, a.attname) AS seq
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE c.relkind = 'r' AND pg_get_serial_sequence('public.'||c.relname, a.attname) IS NOT NULL
  LOOP
    EXECUTE format('SELECT coalesce(max(%I),0) FROM public.%I', r.col, r.tbl) INTO maxv;
    EXECUTE format('SELECT setval(%L, GREATEST(%s,1), %s)', r.seq, maxv, maxv > 0);
  END LOOP;
END $$;
SQL

echo "==> data load complete"
