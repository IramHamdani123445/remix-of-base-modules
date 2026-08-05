#!/usr/bin/env bash
# =====================================================================
# Shared clean-database bootstrap for CI.
#
# Builds a Supabase-compatible test database from:
#   1. scripts/ci/supabase-bootstrap.sql  — extensions, schemas, roles,
#      auth.uid()/auth.jwt() and the auth.users table CI needs.
#   2. supabase/baseline/schema.sql       — the canonical public schema as
#      of the manifest cutoff migration (schema only, no data).
#   3. supabase/migrations/*.sql          — every migration AFTER the
#      cutoff, applied in filename order.
#
# Replaying all 1298 historical migrations from zero is not possible:
# many of them pre-date this repository and reference legacy tables that
# were never created by a migration. The baseline is the forward-only
# replacement for that lost history.
#
# Usage:
#   DATABASE_URL=postgres://... scripts/ci/bootstrap-supabase-test-db.sh
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB_URL="${DATABASE_URL:-${BN_TEST_DATABASE_URL:-}}"

if [[ -z "$DB_URL" ]]; then
  echo "::error::DATABASE_URL (or BN_TEST_DATABASE_URL) must be set" >&2
  exit 2
fi

BOOTSTRAP_SQL="$ROOT/scripts/ci/supabase-bootstrap.sql"
BASELINE_SQL="$ROOT/supabase/baseline/schema.sql"
MANIFEST="$ROOT/supabase/baseline/baseline_manifest.json"
MIGRATIONS_DIR="$ROOT/supabase/migrations"

for f in "$BOOTSTRAP_SQL" "$BASELINE_SQL" "$MANIFEST"; do
  [[ -f "$f" ]] || { echo "::error::missing required file: $f" >&2; exit 2; }
done

run_sql() { psql "$DB_URL" -v ON_ERROR_STOP=1 -X -q -f "$1"; }

# --- 0. wait for the server ------------------------------------------------
echo "==> waiting for database"
for _ in $(seq 1 60); do
  if psql "$DB_URL" -X -q -c 'SELECT 1' >/dev/null 2>&1; then break; fi
  sleep 1
done
psql "$DB_URL" -X -q -c 'SELECT 1' >/dev/null

# --- 1. baseline integrity -------------------------------------------------
echo "==> verifying baseline integrity"
EXPECTED_SHA="$(python3 -c "import json,sys;print(json.load(open('$MANIFEST'))['schema_sql_sha256'])")"
ACTUAL_SHA="$(sha256sum "$BASELINE_SQL" | cut -d' ' -f1)"
if [[ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]]; then
  echo "::error::baseline schema.sql does not match baseline_manifest.json" >&2
  echo "  expected $EXPECTED_SHA" >&2
  echo "  actual   $ACTUAL_SHA" >&2
  echo "  regenerate with scripts/ci/generate-baseline.py" >&2
  exit 1
fi

CUTOFF="$(python3 -c "import json;print(json.load(open('$MANIFEST'))['migration_cutoff_inclusive'])")"

# --- 2. Supabase-compatible substrate --------------------------------------
echo "==> applying Supabase bootstrap"
run_sql "$BOOTSTRAP_SQL"

# --- 3. canonical baseline schema ------------------------------------------
echo "==> applying baseline schema (cutoff: $CUTOFF)"
run_sql "$BASELINE_SQL"

# --- 4. forward-only migrations --------------------------------------------
echo "==> applying migrations after the cutoff"
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  inserted_at timestamptz NOT NULL DEFAULT now()
);
SQL

APPLIED=0
for path in "$MIGRATIONS_DIR"/*.sql; do
  name="$(basename "$path")"
  # Filenames are timestamp-prefixed, so a lexical comparison is a
  # chronological comparison. The cutoff migration itself is already
  # contained in the baseline.
  [[ "$name" > "$CUTOFF" ]] || continue
  echo "    -> $name"
  run_sql "$path"
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 \
    -c "INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('${name%%_*}') ON CONFLICT DO NOTHING"
  APPLIED=$((APPLIED + 1))
done

# --- 5. environment marker (CI databases are disposable) --------------------
# Seeded here, never by a migration: a migration would also stamp the shared
# Test and Live databases, and activation guards must never be able to read
# "CI" from a persistent environment.
echo "==> stamping the environment marker as CI"
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO public.platform_environment_marker
  (id, environment_kind, environment_label, allows_controlled_test_activation, notes)
VALUES (true, 'CI', 'Disposable CI database', false,
        'Seeded by scripts/ci/bootstrap-supabase-test-db.sh')
ON CONFLICT (id) DO UPDATE
  SET environment_kind = excluded.environment_kind,
      environment_label = excluded.environment_label,
      allows_controlled_test_activation = false,
      notes = excluded.notes;
SQL

echo "==> bootstrap complete (${APPLIED} migration(s) applied on top of the baseline)"
