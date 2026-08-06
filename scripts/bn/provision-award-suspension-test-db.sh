#!/usr/bin/env bash
# =====================================================================
# BN Award Suspension — isolated Test database provisioning.
#
# Builds (or verifies) an isolated NON-PRODUCTION Test database for Wave 1
# controlled UAT and stamps the canonical environment marker.
#
#   BN_SUSP_DB_URL            connection string of the isolated Test database
#   BN_SUSP_EXPECTED_DATABASE exact expected database name
#   BN_SUSP_TEST_PROJECT_REF  isolated Test project reference (marker value)
#   BN_SUSP_CONFIRM_NONPROD   must be exactly "YES"
#   BN_SUSP_BOOTSTRAP         optional "YES" to build schema from the reviewed
#                             baseline + forward migrations (empty databases)
#
# Guards (all fail closed, nothing is written before they pass):
#   * live Lovable Cloud project ref is denylisted
#   * prod/production/live/prd/release tokens rejected in URL, db name, ref
#   * database name must equal BN_SUSP_EXPECTED_DATABASE
#   * the module must still be dark-launched
#
# This script NEVER activates the module. Activation remains the separate,
# separately-guarded scripts/bn/activate-award-suspension-test.sh.
# =====================================================================
set -euo pipefail

LIVE_REF_DENYLIST="xynceskeiiisiefqlgxo"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SEED_SQL="$ROOT/supabase/test-support/award_suspension_test_environment_seed.sql"

log() { printf '[bn-susp-provision] %s\n' "$*"; }
die() { printf '[bn-susp-provision] ERROR: %s\n' "$*" >&2; exit "${2:-1}"; }

[ "${BN_SUSP_CONFIRM_NONPROD:-}" = "YES" ] \
  || die 'BN_SUSP_CONFIRM_NONPROD=YES is required'
DB_URL="${BN_SUSP_DB_URL:-}"
[ -n "$DB_URL" ] || die 'BN_SUSP_DB_URL is not set'
EXPECTED_DB="${BN_SUSP_EXPECTED_DATABASE:-}"
[ -n "$EXPECTED_DB" ] || die 'BN_SUSP_EXPECTED_DATABASE is not set'
PROJECT_REF="${BN_SUSP_TEST_PROJECT_REF:-}"
[ -n "$PROJECT_REF" ] || die 'BN_SUSP_TEST_PROJECT_REF is not set'

case "$DB_URL$PROJECT_REF$EXPECTED_DB" in
  *"$LIVE_REF_DENYLIST"*) die 'target references the denylisted live project' 3 ;;
esac
for token in prod production live prd release; do
  case "$(printf '%s' "$DB_URL$PROJECT_REF$EXPECTED_DB" | tr 'A-Z' 'a-z')" in
    *"$token"*) die "refusing an apparent production target (matched \"$token\")" 3 ;;
  esac
done

command -v psql >/dev/null 2>&1 || die 'psql not found on PATH' 2
[ -f "$SEED_SQL" ] || die "missing seed file: $SEED_SQL" 2

q() { psql "$DB_URL" -X -At -v ON_ERROR_STOP=1 -c "$1"; }

ACTUAL_DB="$(q 'SELECT current_database()')"
[ "$ACTUAL_DB" = "$EXPECTED_DB" ] \
  || die "database name \"$ACTUAL_DB\" does not match BN_SUSP_EXPECTED_DATABASE=\"$EXPECTED_DB\"" 3
log "connected to database: $ACTUAL_DB"

# --- optional schema build ---------------------------------------------------
if [ "${BN_SUSP_BOOTSTRAP:-}" = "YES" ]; then
  log 'building schema from the reviewed baseline + forward migrations'
  DATABASE_URL="$DB_URL" bash "$ROOT/scripts/ci/bootstrap-supabase-test-db.sh"
fi

# --- baseline / migration presence ------------------------------------------
[ "$(q "SELECT to_regclass('public.platform_environment_marker') IS NOT NULL")" = "t" ] \
  || die 'platform_environment_marker missing — run with BN_SUSP_BOOTSTRAP=YES' 4
[ "$(q "SELECT count(*) FROM public.app_modules WHERE name = 'bn_award_suspension'")" = "1" ] \
  || die 'bn_award_suspension module not registered — migrations incomplete' 4
MIGRATIONS_APPLIED="$(q "SELECT count(*) FROM supabase_migrations.schema_migrations" 2>/dev/null || echo 0)"
log "forward migrations recorded: $MIGRATIONS_APPLIED"

# --- dark-launch precondition ------------------------------------------------
[ "$(q "SELECT actions_enabled FROM public.app_modules WHERE name = 'bn_award_suspension'")" = "f" ] \
  || die 'bn_award_suspension is already activated on this database' 5

# --- seed --------------------------------------------------------------------
log 'seeding environment marker, UAT actors and synthetic fixtures'
psql "$DB_URL" -X -v ON_ERROR_STOP=1 \
  -v env_project_ref="'$PROJECT_REF'" \
  -v env_label="'BN Award Suspension controlled UAT (Test)'" \
  -f "$SEED_SQL"

# --- postflight --------------------------------------------------------------
[ "$(q "SELECT count(*) FROM public.platform_environment_marker WHERE environment_kind = 'TEST' AND allows_controlled_test_activation")" = "1" ] \
  || die 'postflight: canonical TEST marker not present exactly once' 6
[ "$(q "SELECT actions_enabled FROM public.app_modules WHERE name = 'bn_award_suspension'")" = "f" ] \
  || die 'postflight: module was activated by provisioning' 6
ROLLOUT_STATE="$(q "SELECT rollout_state FROM public.app_modules WHERE name = 'bn_award_suspension'")"
# rollout_state must stay inside the shared enterprise constraint
# (hidden | internal_pilot | public). READ_ONLY / TEST_ACTIVE are DERIVED
# posture labels and are never stored.
[ "$ROLLOUT_STATE" = "internal_pilot" ] \
  || die "postflight: rollout_state is \"$ROLLOUT_STATE\", expected internal_pilot" 6

log "database name          : $ACTUAL_DB"
log "test project reference : $PROJECT_REF"
log "module status          : actions_enabled=false rollout_state=internal_pilot effective_posture=READ_ONLY"
log 'BN_SUSP_PROVISION_RESULT: PASS'

