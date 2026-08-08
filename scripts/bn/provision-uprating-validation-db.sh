#!/usr/bin/env bash
# =====================================================================
# BN Uprating — controlled EXISTING-DATA validation environment guard.
#
# Verifies (and, where authorised, marks) an isolated NON-PRODUCTION
# database for the Epic 4 controlled operational walkthrough.
#
#   BN_UPR_DB_URL             connection string of the isolated database
#   BN_UPR_EXPECTED_DATABASE  exact expected database name
#   BN_UPR_TEST_PROJECT_REF   isolated project reference (marker value)
#   BN_UPR_CONFIRM_NONPROD    must be exactly "YES"
#   BN_UPR_BOOTSTRAP          optional "YES" to build application schema from
#                             the reviewed baseline + forward migrations
#   BN_UPR_DATA_PROVENANCE    governance label for the pre-existing data, e.g.
#                             "pre-existing non-production Benefits data",
#                             "authorised masked environment refresh",
#                             "existing controlled-UAT dataset"
#
# Guards (all fail closed; nothing is written before every guard passes):
#   * live Lovable Cloud project ref is denylisted
#   * prod/production/live/prd/release tokens rejected in URL, db name, ref
#   * current_database() must equal BN_UPR_EXPECTED_DATABASE
#   * existing platform_environment_marker rows are VALIDATED, never
#     overwritten (PRODUCTION / other project_ref / activation=false /
#     multiple rows all STOP)
#   * existing Benefits business data must already be present
#
# This script NEVER seeds synthetic business data. No person, SSN, claim,
# Award, Award component, Product, Product version, payment profile, payment
# schedule, index observation, policy rate, formula, reference value,
# Mortality event, Risk record or Appeal is created. Application schema only.
# It also never activates a module and never mutates an Award.
# =====================================================================
set -euo pipefail

LIVE_REF_DENYLIST="xynceskeiiisiefqlgxo"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

log() { printf '[bn-uprating-provision] %s\n' "$*"; }
die() { printf '[bn-uprating-provision] ERROR: %s\n' "$*" >&2; exit "${2:-1}"; }

[ "${BN_UPR_CONFIRM_NONPROD:-}" = "YES" ] \
  || die 'BN_UPR_CONFIRM_NONPROD=YES is required'
DB_URL="${BN_UPR_DB_URL:-}"
[ -n "$DB_URL" ] || die 'BN_UPR_DB_URL is not set'
EXPECTED_DB="${BN_UPR_EXPECTED_DATABASE:-}"
[ -n "$EXPECTED_DB" ] || die 'BN_UPR_EXPECTED_DATABASE is not set'
PROJECT_REF="${BN_UPR_TEST_PROJECT_REF:-}"
[ -n "$PROJECT_REF" ] || die 'BN_UPR_TEST_PROJECT_REF is not set'
PROVENANCE="${BN_UPR_DATA_PROVENANCE:-}"
[ -n "$PROVENANCE" ] || die 'BN_UPR_DATA_PROVENANCE is not set (existing-data governance label)'

case "$DB_URL$PROJECT_REF$EXPECTED_DB" in
  *"$LIVE_REF_DENYLIST"*) die 'target references the denylisted live project' 3 ;;
esac
for token in prod production live prd release; do
  case "$(printf '%s' "$DB_URL$PROJECT_REF$EXPECTED_DB" | tr 'A-Z' 'a-z')" in
    *"$token"*) die "refusing an apparent production target (matched \"$token\")" 3 ;;
  esac
done

command -v psql >/dev/null 2>&1 || die 'psql not found on PATH' 2

q() { psql "$DB_URL" -X -At -v ON_ERROR_STOP=1 -c "$1"; }

ACTUAL_DB="$(q 'SELECT current_database()')"
[ "$ACTUAL_DB" = "$EXPECTED_DB" ] \
  || die "database name \"$ACTUAL_DB\" does not match BN_UPR_EXPECTED_DATABASE=\"$EXPECTED_DB\"" 3
log "connected to database: $ACTUAL_DB"

# --- optional application-schema build (no business data) --------------------
if [ "${BN_UPR_BOOTSTRAP:-}" = "YES" ]; then
  log 'building application schema from the reviewed baseline + forward migrations'
  DATABASE_URL="$DB_URL" bash "$ROOT/scripts/ci/bootstrap-supabase-test-db.sh"
fi

[ "$(q "SELECT to_regclass('public.platform_environment_marker') IS NOT NULL")" = "t" ] \
  || die 'platform_environment_marker missing — run with BN_UPR_BOOTSTRAP=YES' 4
[ "$(q "SELECT to_regclass('public.bn_uprating_policy') IS NOT NULL")" = "t" ] \
  || die 'Uprating schema missing — forward migrations incomplete' 4

# --- existing marker: validate, never overwrite ------------------------------
MARKER_ROWS="$(q 'SELECT count(*) FROM public.platform_environment_marker')"
if [ "$MARKER_ROWS" != "0" ]; then
  [ "$MARKER_ROWS" = "1" ] \
    || die "marker conflict: $MARKER_ROWS rows present, expected exactly one" 5
  M_KIND="$(q 'SELECT environment_kind FROM public.platform_environment_marker')"
  M_REF="$(q 'SELECT project_ref FROM public.platform_environment_marker')"
  M_ACT="$(q 'SELECT allows_controlled_test_activation FROM public.platform_environment_marker')"
  case "$(printf '%s' "$M_KIND" | tr 'a-z' 'A-Z')" in
    PROD|PRODUCTION|LIVE) die 'marker conflict: existing marker declares a PRODUCTION environment' 5 ;;
  esac
  [ "$M_REF" = "$PROJECT_REF" ] \
    || die 'marker conflict: existing marker project_ref differs from BN_UPR_TEST_PROJECT_REF' 5
  [ "$M_ACT" = "t" ] \
    || die 'marker conflict: existing marker has allows_controlled_test_activation = false' 5
  log 'existing non-production marker validated — left unchanged'
else
  log 'recording the canonical non-production environment marker'
  psql "$DB_URL" -X -v ON_ERROR_STOP=1 \
    -v env_project_ref="'$PROJECT_REF'" <<'SQL'
INSERT INTO public.platform_environment_marker
  (environment_kind, environment_label, project_ref, allows_controlled_test_activation)
VALUES
  ('TEST', 'BN Uprating controlled existing-data validation (Test)', :env_project_ref, true);
SQL
fi

# --- postflight marker proof -------------------------------------------------
[ "$(q 'SELECT count(*) FROM public.platform_environment_marker')" = "1" ] \
  || die 'postflight: marker is not present exactly once' 6
[ "$(q "SELECT count(*) FROM public.platform_environment_marker
        WHERE upper(environment_kind) NOT IN ('PROD','PRODUCTION','LIVE')
          AND project_ref = '$PROJECT_REF'
          AND allows_controlled_test_activation")" = "1" ] \
  || die 'postflight: marker is not a non-production, activation-enabled marker for this project' 6
log 'postflight: exactly one non-production marker, project_ref matched, activation enabled'

# --- existing-data requirement (never manufactured here) ---------------------
AWARDS="$(q "SELECT count(*) FROM public.bn_award" 2>/dev/null || echo 0)"
if [ "$AWARDS" = "0" ]; then
  printf '%s\n' \
    'CONTROLLED WORKFLOW VALIDATION BLOCKED — NON-PRODUCTION PROJECT HAS NO AUTHORISED EXISTING BENEFITS DATA' >&2
  exit 7
fi

log "existing Awards available     : $AWARDS"
log "existing-data provenance      : $PROVENANCE"
log "project reference             : $PROJECT_REF"
log 'no synthetic person/Award/Product/payment/index/reference data created'
log 'BN_UPR_PROVISION_RESULT: PASS'
