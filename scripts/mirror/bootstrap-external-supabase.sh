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
DB_URL="${TARGET_DATABASE_URL:-${MIRROR_TARGET_DATABASE_URL:-}}"
DRY_RUN="${DRY_RUN:-0}"
SKIP_BASELINE="${SKIP_BASELINE:-0}"
MAX_RETRIES="${MAX_RETRIES:-4}"
RETRY_DELAY_SECONDS="${RETRY_DELAY_SECONDS:-3}"

if [[ -z "$DB_URL" ]]; then
  echo "::error::TARGET_DATABASE_URL or MIRROR_TARGET_DATABASE_URL must be set to the destination project" >&2
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

retry() {
  local description="$1"
  shift
  local attempt=1
  local delay="$RETRY_DELAY_SECONDS"
  while true; do
    if "$@"; then
      return 0
    fi
    if (( attempt >= MAX_RETRIES )); then
      printf '    !! %s failed after %d attempt(s)\n' "$description" "$attempt" >&2
      return 1
    fi
    printf '    !! %s failed (attempt %d/%d); retrying in %ds\n' \
      "$description" "$attempt" "$MAX_RETRIES" "$delay" >&2
    sleep "$delay"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
}

psql_sql() { psql "$DB_URL" -v ON_ERROR_STOP=1 -X -q "$@"; }
run_sql() { psql_sql -f "$1"; }

# --- 0. connectivity -------------------------------------------------------
echo "==> checking connectivity to the target project"
retry "target connectivity check" psql_sql -c 'SELECT current_database(), current_user' >/dev/null

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
TOTAL=${#PENDING[@]}
IDX=0
FAILURES_THIS_RUN=0
FAILED_NAMES=()
RUN_FAILURE_LOG="$LOG_DIR/failures-$(date -u +%Y%m%dT%H%M%SZ).log"
touch "$RUN_FAILURE_LOG"

# Read the ledger once. The old per-file lookup made every resume rescan issue
# hundreds of network round trips before it reached the genuinely pending work.
declare -A RECORDED=()
while IFS= read -r version; do
  [[ -n "$version" ]] && RECORDED["$version"]=1
done < <(retry "migration ledger read" psql_sql -t -A \
  -c 'SELECT version FROM supabase_migrations.schema_migrations' 2>/dev/null)

progress() {
  local n=$1 t=$2 label=$3
  local pct=$(( t > 0 ? n * 100 / t : 0 ))
  local filled=$(( pct * 40 / 100 ))
  local bar
  bar="$(printf '#%.0s' $(seq 1 $filled 2>/dev/null))$(printf '.%.0s' $(seq 1 $((40-filled)) 2>/dev/null))"
  printf '    [%s] %3d%%  %d/%d  %s\n' "$bar" "$pct" "$n" "$t" "$label"
}
for path in "${PENDING[@]}"; do
  name="$(basename "$path")"
  version="${name%%_*}"
  IDX=$((IDX + 1))
  [[ -z "${RECORDED[$version]:-}" ]] || { progress "$IDX" "$TOTAL" "$name (already recorded)"; continue; }
  progress "$IDX" "$TOTAL" "$name"
  if retry "migration $name" run_sql "$path" >>"$LOG_DIR/migrations.log" 2>&1; then
    retry "ledger write for $name" psql_sql \
      -c "INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('$version') ON CONFLICT DO NOTHING"
    RECORDED["$version"]=1
    APPLIED=$((APPLIED + 1))
  else
    echo "$name" >>"$RUN_FAILURE_LOG"
    FAILED_NAMES+=("$name")
    FAILURES_THIS_RUN=$((FAILURES_THIS_RUN + 1))
    printf '    !! failed: %s (continuing)\n' "$name"
  fi
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
if (( FAILURES_THIS_RUN > 0 )); then
  printf '::error::%d migration(s) still failed after retries:\n' "$FAILURES_THIS_RUN" >&2
  printf '  - %s\n' "${FAILED_NAMES[@]}" >&2
  exit 1
fi
echo "    Next: load exported data with scripts/mirror/load-export-csvs.sh"
