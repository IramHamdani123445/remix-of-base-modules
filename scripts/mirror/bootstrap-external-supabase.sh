#!/usr/bin/env bash
# =====================================================================
# Mirror the platform schema into an EXTERNAL Supabase project.
#
# Read-only with respect to the Lovable Cloud database: this script
# never connects to it. It only builds structure in the TARGET project
# from artefacts committed in this repository:
#
#   1. supabase/baseline/schema.sql   — canonical public schema at the
#                                        baseline cutoff (schema only)
#   2. supabase/migrations/*.sql      — every migration AFTER the cutoff
#
# Data, auth users and storage objects are NOT copied here. Use
# Lovable Cloud -> Advanced settings -> Export data for those, then load
# the CSVs with scripts/mirror/load-export-csvs.sh.
#
# Usage:
#   TARGET_DATABASE_URL='postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres' \
#     scripts/mirror/bootstrap-external-supabase.sh
#
# Options:
#   DRY_RUN=1     print the plan, apply nothing
#   SKIP_BASELINE=1  only apply post-cutoff migrations
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB_URL="${TARGET_DATABASE_URL:-}"
DRY_RUN="${DRY_RUN:-0}"
SKIP_BASELINE="${SKIP_BASELINE:-0}"

if [[ -z "$DB_URL" ]]; then
  echo "::error::TARGET_DATABASE_URL must be set to the DESTINATION Supabase project" >&2
  exit 2
fi

case "$DB_URL" in
  *xynceskeiiisiefqlgxo*)
    echo "::error::refusing to run: TARGET_DATABASE_URL points at the source (Lovable Cloud) project" >&2
    exit 2;;
esac

BASELINE_SQL="$ROOT/supabase/baseline/schema.sql"
MANIFEST="$ROOT/supabase/baseline/baseline_manifest.json"
MIGRATIONS_DIR="$ROOT/supabase/migrations"
LOG_DIR="${LOG_DIR:-/tmp/mirror-bootstrap}"
mkdir -p "$LOG_DIR"

for f in "$BASELINE_SQL" "$MANIFEST"; do
  [[ -f "$f" ]] || { echo "::error::missing required file: $f" >&2; exit 2; }
done

run_sql() { psql "$DB_URL" -v ON_ERROR_STOP=1 -X -q -f "$1"; }

# --- 0. connectivity -------------------------------------------------------
echo "==> checking connectivity to the target project"
psql "$DB_URL" -X -q -c 'SELECT current_database(), current_user' >/dev/null

# --- 1. baseline integrity -------------------------------------------------
echo "==> verifying baseline integrity"
EXPECTED_SHA="$(python3 -c "import json;print(json.load(open('$MANIFEST'))['schema_sql_sha256'])")"
ACTUAL_SHA="$(sha256sum "$BASELINE_SQL" | cut -d' ' -f1)"
if [[ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]]; then
  echo "::error::baseline schema.sql does not match baseline_manifest.json" >&2
  exit 1
fi
CUTOFF="$(python3 -c "import json;print(json.load(open('$MANIFEST'))['migration_cutoff_inclusive'])")"

# --- 2. plan ---------------------------------------------------------------
PENDING=()
for path in "$MIGRATIONS_DIR"/*.sql; do
  name="$(basename "$path")"
  [[ "$name" > "$CUTOFF" ]] || continue
  PENDING+=("$path")
done

echo "==> plan"
echo "    baseline cutoff : $CUTOFF"
echo "    baseline        : $([[ "$SKIP_BASELINE" == "1" ]] && echo 'SKIPPED' || echo 'apply')"
echo "    migrations after: ${#PENDING[@]}"
if [[ "$DRY_RUN" == "1" ]]; then
  printf '    -> %s\n' "${PENDING[@]##*/}"
  echo "==> dry run, nothing applied"
  exit 0
fi

# --- 3. extensions the schema assumes --------------------------------------
echo "==> ensuring extensions"
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto"   WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pg_trgm"    WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "btree_gist" WITH SCHEMA extensions;
SQL

# --- 4. baseline schema ----------------------------------------------------
if [[ "$SKIP_BASELINE" != "1" ]]; then
  echo "==> applying baseline schema (this takes several minutes)"
  run_sql "$BASELINE_SQL" 2>&1 | tee "$LOG_DIR/baseline.log" | tail -n 5
fi

# --- 5. migration ledger ---------------------------------------------------
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  inserted_at timestamptz NOT NULL DEFAULT now()
);
SQL

# --- 6. forward-only migrations --------------------------------------------
echo "==> applying ${#PENDING[@]} migration(s) after the cutoff"
APPLIED=0
for path in "${PENDING[@]}"; do
  name="$(basename "$path")"
  version="${name%%_*}"
  already="$(psql "$DB_URL" -X -q -t -A \
    -c "SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '$version'")"
  [[ -z "$already" ]] || { echo "    -- $name (already recorded)"; continue; }
  echo "    -> $name"
  run_sql "$path" >>"$LOG_DIR/migrations.log" 2>&1
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 \
    -c "INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('$version') ON CONFLICT DO NOTHING"
  APPLIED=$((APPLIED + 1))
done

# --- 7. parity report ------------------------------------------------------
echo "==> structure in the target project"
psql "$DB_URL" -X -q -c "
  SELECT
    (SELECT count(*) FROM information_schema.tables    WHERE table_schema='public' AND table_type='BASE TABLE') AS tables,
    (SELECT count(*) FROM information_schema.views     WHERE table_schema='public') AS views,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') AS functions,
    (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e') AS enums"

echo "==> done (${APPLIED} migration(s) applied). Logs in $LOG_DIR"
echo "    Next: load exported data with scripts/mirror/load-export-csvs.sh"
