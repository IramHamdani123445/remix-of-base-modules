#!/usr/bin/env bash
# BN-SUSP-ACT-2 — Award Suspension activation for a NON-PRODUCTION Test
# environment only.
#
# Usage:
#   BN_SUSP_DB_URL=postgresql://...         # Test/Local database only
#   BN_SUSP_CONFIRM_NONPROD=YES
#   BN_SUSP_ENVIRONMENT=TEST|LOCAL
#   BN_SUSP_EXPECTED_DATABASE=<database name>
#   ./scripts/bn/activate-award-suspension-test.sh [enable|disable|status]
#
# Safety model:
#   • credentials are never printed;
#   • production-looking targets are denylisted case-insensitively;
#   • a user-supplied environment string is NEVER accepted as proof — a
#     canonical database environment marker must confirm TEST/LOCAL;
#   • readiness (module row, migrations, RPCs, private helpers, workflow,
#     approval policy, workbasket, reason codes, actions, role grants) is
#     verified from the database before anything is enabled;
#   • enable/disable run inside a transaction and must affect exactly one row.
set -euo pipefail

MODE="${1:-status}"
LIVE_REF_DENYLIST="xynceskeiiisiefqlgxo"

# Canonical environment marker. Set BN_SUSP_ENV_MARKER_TABLE to override.
MARKER_TABLE="${BN_SUSP_ENV_MARKER_TABLE:-public.platform_environment_marker}"
MARKER_COLUMN="${BN_SUSP_ENV_MARKER_COLUMN:-environment_kind}"

if [ -z "${BN_SUSP_DB_URL:-}" ]; then
  echo "BN_SUSP_DB_URL is not set. Refusing to run." >&2
  exit 1
fi

if echo "$BN_SUSP_DB_URL" | grep -q "$LIVE_REF_DENYLIST"; then
  echo "Refusing: the connection string targets the denylisted live project." >&2
  exit 1
fi

# Case-insensitive production denylist.
if echo "$BN_SUSP_DB_URL" | grep -Eqi '(prod|production|live|prd|release)'; then
  echo "Refusing: the connection string looks like a production target." >&2
  exit 1
fi

q() { psql "$BN_SUSP_DB_URL" -At -v ON_ERROR_STOP=1 -c "$1"; }

status() {
  psql "$BN_SUSP_DB_URL" -v ON_ERROR_STOP=1 -c \
    "SELECT name, is_enabled, actions_enabled, rollout_state, show_in_menu
       FROM public.app_modules WHERE name = 'bn_award_suspension';"
  # Posture is DERIVED, never stored: the shared app_modules.rollout_state
  # constraint only permits hidden | internal_pilot | public, so module
  # specific labels (READ_ONLY / TEST_ACTIVE) must not be written to it.
  local enabled
  enabled="$(q "SELECT actions_enabled FROM public.app_modules WHERE name = 'bn_award_suspension';")"
  if [ "$enabled" = "t" ]; then
    echo "effective_posture=TEST_ACTIVE"
  else
    echo "effective_posture=READ_ONLY"
  fi
}

require() {
  # require <description> <sql returning a single boolean/count> <expected>
  local desc="$1" sql="$2" expected="$3" actual
  actual="$(q "$sql")"
  if [ "$actual" != "$expected" ]; then
    echo "AWARD SUSPENSION ACTIVATION BLOCKED — check failed: ${desc} (got '${actual}', expected '${expected}')" >&2
    exit 5
  fi
  echo "  ok: ${desc}"
}

assert_nonprod() {
  if [ "${BN_SUSP_CONFIRM_NONPROD:-}" != "YES" ]; then
    echo "Refusing: set BN_SUSP_CONFIRM_NONPROD=YES to confirm a non-production target." >&2
    exit 1
  fi

  case "${BN_SUSP_ENVIRONMENT:-}" in
    TEST|LOCAL) ;;
    *)
      echo "Refusing: set BN_SUSP_ENVIRONMENT to TEST or LOCAL (got '${BN_SUSP_ENVIRONMENT:-<unset>}')." >&2
      exit 1
      ;;
  esac

  if [ -z "${BN_SUSP_EXPECTED_DATABASE:-}" ]; then
    echo "Refusing: set BN_SUSP_EXPECTED_DATABASE to the expected database name." >&2
    exit 1
  fi

  actual_db="$(q 'SELECT current_database();')"
  if [ "$actual_db" != "$BN_SUSP_EXPECTED_DATABASE" ]; then
    echo "Refusing: connected database does not match BN_SUSP_EXPECTED_DATABASE." >&2
    exit 1
  fi

  # Canonical environment marker — a user-supplied string is not proof.
  marker_present="$(q "SELECT to_regclass('${MARKER_TABLE}') IS NOT NULL;")"
  if [ "$marker_present" != "t" ]; then
    echo "AWARD SUSPENSION ACTIVATION BLOCKED — CANONICAL ENVIRONMENT MARKER MISSING" >&2
    exit 6
  fi
  marker_rows="$(q "SELECT count(*) FROM ${MARKER_TABLE};")"
  if [ "$marker_rows" != "1" ]; then
    echo "AWARD SUSPENSION ACTIVATION BLOCKED — the environment marker must hold exactly one row (found ${marker_rows})" >&2
    exit 6
  fi
  marker_value="$(q "SELECT upper(${MARKER_COLUMN}::text) FROM ${MARKER_TABLE} LIMIT 1;")"
  marker_allows="$(q "SELECT allows_controlled_test_activation FROM ${MARKER_TABLE} LIMIT 1;")"
  if [ "$marker_allows" != "t" ]; then
    echo "AWARD SUSPENSION ACTIVATION BLOCKED — this environment does not allow controlled test activation" >&2
    exit 6
  fi
  marker_ref="$(q "SELECT coalesce(project_ref,'') FROM ${MARKER_TABLE} LIMIT 1;")"
  if [ "$marker_ref" = "$LIVE_REF_DENYLIST" ]; then
    echo "AWARD SUSPENSION ACTIVATION BLOCKED — the marker identifies the denylisted live project" >&2
    exit 6
  fi
  case "$marker_value" in
    TEST|LOCAL) ;;
    *)
      echo "AWARD SUSPENSION ACTIVATION BLOCKED — environment marker is '${marker_value:-<empty>}', not TEST or LOCAL" >&2
      exit 6
      ;;
  esac
  echo "Target confirmed: marker=${marker_value} database=${actual_db}"
}

assert_ready() {
  echo "Verifying Award Suspension readiness…"

  require "exactly one bn_award_suspension module row" \
    "SELECT count(*) FROM public.app_modules WHERE name = 'bn_award_suspension';" "1"

  require "award suspension migrations applied (event table present)" \
    "SELECT to_regclass('public.bn_award_suspension_event') IS NOT NULL;" "t"
  require "payment impact table present" \
    "SELECT to_regclass('public.bn_award_suspension_payment_impact') IS NOT NULL;" "t"

  require "public versioned suspension RPCs present" \
    "SELECT count(*) >= 4 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'bn_award_suspension_%_v1';" "t"
  require "public versioned reinstatement RPCs present" \
    "SELECT count(*) >= 4 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'bn_award_reinstatement_%_v1';" "t"

  require "private _bn_susp_* helpers not executable by authenticated" \
    "SELECT count(*) = 0 FROM pg_proc p, aclexplode(p.proacl) a, pg_roles r
      WHERE p.proname LIKE '\_bn\_susp\_%' AND a.grantee = r.oid
        AND a.privilege_type = 'EXECUTE' AND r.rolname IN ('anon','authenticated');" "t"

  require "active workflow definition exists" \
    "SELECT count(*) = 1 FROM public.core_workflow_definition
      WHERE workflow_code = 'BN_AWARD_SUSPENSION' AND is_active;" "t"

  require "enabled approval policy exists" \
    "SELECT count(*) >= 1 FROM public.bn_approval_policy
      WHERE is_active AND policy_code ILIKE '%SUSPENSION%';" "t"

  require "approval workbasket exists" \
    "SELECT count(*) >= 1 FROM public.core_workflow_step s
      JOIN public.core_workflow_definition d ON d.id = s.workflow_definition_id
      WHERE d.workflow_code = 'BN_AWARD_SUSPENSION' AND s.step_type = 'APPROVAL';" "t"

  require "reason-code groups present" \
    "SELECT count(*) >= 2 FROM public.bn_reason_code_group
      WHERE group_code IN ('BN_AWARD_SUSPENSION_REASON','BN_AWARD_SUSPENSION_REJECTION');" "t"

  require "module actions registered" \
    "SELECT count(*) >= 4 FROM public.module_actions ma
      JOIN public.app_modules m ON m.id = ma.module_id
      WHERE m.name = 'bn_award_suspension';" "t"

  require "role-permission verifier passes" \
    "SELECT count(*) >= 1 FROM public.role_permissions rp
      JOIN public.permissions p ON p.id = rp.permission_id
      WHERE p.name LIKE 'bn_award_suspension%';" "t"

  require "environment marker still permits controlled activation" \
    "SELECT allows_controlled_test_activation FROM ${MARKER_TABLE} LIMIT 1;" "t"

  echo "  running effective-grant verifier…"
  if ! psql "$BN_SUSP_DB_URL" -v ON_ERROR_STOP=1 -q \
        -f supabase/verify/bn_award_suspension_effective_grants.sql >/dev/null 2>&1; then
    echo "AWARD SUSPENSION ACTIVATION BLOCKED — effective-grant verifier failed" >&2
    exit 5
  fi
  echo "  ok: effective-grant verifier passed"

  require "no unauthorized anon grants on suspension RPCs" \
    "SELECT count(*) = 0 FROM pg_proc p, aclexplode(p.proacl) a, pg_roles r
      WHERE (p.proname LIKE 'bn_award_suspension\_%\_v1' OR p.proname LIKE 'bn_award_reinstatement\_%\_v1')
        AND a.grantee = r.oid AND a.privilege_type = 'EXECUTE' AND r.rolname = 'anon';" "t"
}

case "$MODE" in
  enable)
    assert_nonprod
    assert_ready
    updated="$(q "BEGIN;
      WITH upd AS (
        UPDATE public.app_modules
           SET actions_enabled = true, is_enabled = true, rollout_state = 'internal_pilot'
         WHERE name = 'bn_award_suspension'
        RETURNING 1
      ) SELECT count(*) FROM upd;
      COMMIT;")"
    if [ "$updated" != "1" ]; then
      echo "Refusing: expected exactly one updated module row, got '${updated}'." >&2
      exit 7
    fi
    echo "Award Suspension actions ENABLED (Test, rollout_state=internal_pilot, effective_posture=TEST_ACTIVE)."
    status
    ;;
  disable)
    assert_nonprod
    updated="$(q "BEGIN;
      WITH upd AS (
        UPDATE public.app_modules
           SET actions_enabled = false, rollout_state = 'internal_pilot'
         WHERE name = 'bn_award_suspension'
        RETURNING 1
      ) SELECT count(*) FROM upd;
      COMMIT;")"
    if [ "$updated" != "1" ]; then
      echo "Refusing: expected exactly one updated module row, got '${updated}'." >&2
      exit 7
    fi
    echo "Award Suspension actions DISABLED (rollback complete, rollout_state=internal_pilot, effective_posture=READ_ONLY)."
    status
    ;;
  status)
    status
    ;;
  *)
    echo "Unknown mode '$MODE'. Use enable | disable | status." >&2
    exit 1
    ;;
esac
