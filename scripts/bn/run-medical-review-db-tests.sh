#!/usr/bin/env bash
# ---------------------------------------------------------------------
# BN Medical Reviews — seeded database integration harness runner.
#
# Requires an explicit, approved connection URL for an isolated Test
# database owned by a database-owner-capable role. There is deliberately
# no local default and no production fallback.
#
#   BN_TEST_DATABASE_URL=postgres://... scripts/bn/run-medical-review-db-tests.sh
#
# The harness itself runs inside one transaction and always rolls back.
# Credentials are never echoed: only file paths and psql output print.
# ---------------------------------------------------------------------
set -euo pipefail

HARNESS="supabase/tests/bn/medical_review_integration.sql"
GRANTS="supabase/verify/bn_medical_review_effective_grants.sql"

if [[ -z "${BN_TEST_DATABASE_URL:-}" ]]; then
  echo "ERROR: BN_TEST_DATABASE_URL is not set." >&2
  echo "       Set it to the approved isolated Test database URL before running." >&2
  exit 2
fi

for f in "$HARNESS" "$GRANTS"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: required file $f not found." >&2
    exit 2
  fi
done

# ---------------------------------------------------------------------
# Safety: refuse to run against anything that looks like production.
# ---------------------------------------------------------------------
URL_LOWER="$(printf '%s' "$BN_TEST_DATABASE_URL" | tr '[:upper:]' '[:lower:]')"
DENY_PATTERNS=(prod production live prd release "www." "app.")
for pattern in "${DENY_PATTERNS[@]}"; do
  if [[ "$URL_LOWER" == *"$pattern"* ]]; then
    echo "ERROR: connection target matches the production denylist token '${pattern}'." >&2
    echo "       This harness must never run against production." >&2
    exit 3
  fi
done

if [[ "${BN_TEST_DB_CONFIRM:-}" != "I_UNDERSTAND_THIS_IS_A_TEST_DATABASE" ]]; then
  echo "ERROR: set BN_TEST_DB_CONFIRM=I_UNDERSTAND_THIS_IS_A_TEST_DATABASE to proceed." >&2
  exit 3
fi

LOG="$(mktemp -t bn-mr-harness.XXXXXX.log)"
trap 'echo "Log retained at: $LOG"' EXIT

echo "Running Medical Review effective-grant verifier…"
psql "$BN_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$GRANTS" 2>&1 | tee -a "$LOG"

echo "Asserting the module is dark-launched before the run…"
DARK="$(psql "$BN_TEST_DATABASE_URL" -At -c \
  "SELECT COALESCE(actions_enabled,false) FROM public.app_modules WHERE name='bn_medical_review'")"
if [[ "$DARK" != "f" ]]; then
  echo "ERROR: bn_medical_review actions_enabled is not false (got '${DARK:-<missing>}')." >&2
  exit 4
fi

echo "Running seeded Medical Review database harness…"
psql "$BN_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$HARNESS" 2>&1 | tee -a "$LOG"

if grep -qiE '\bSKIP\b' "$LOG"; then
  echo "FAIL: the harness skipped a scenario — seeding is incomplete." >&2
  exit 1
fi

if grep -q 'BN_MR_HARNESS_RESULT: FAIL' "$LOG"; then
  echo "FAIL: the harness reported failing assertions." >&2
  exit 1
fi

if ! grep -q 'BN_MR_HARNESS_RESULT: PASS' "$LOG"; then
  echo "FAIL: the harness did not report a completed run." >&2
  exit 1
fi

echo "Asserting the module is still dark-launched after the run…"
DARK_AFTER="$(psql "$BN_TEST_DATABASE_URL" -At -c \
  "SELECT COALESCE(actions_enabled,false) FROM public.app_modules WHERE name='bn_medical_review'")"
if [[ "$DARK_AFTER" != "f" ]]; then
  echo "ERROR: actions_enabled is TRUE after the run — rollback did not restore state." >&2
  exit 4
fi

echo "Asserting the harness left no fixture residue…"
RESIDUE="$(psql "$BN_TEST_DATABASE_URL" -At -c \
  "SELECT count(*) FROM public.profiles WHERE user_code LIKE 'HX\_%'")"
if [[ "$RESIDUE" != "0" ]]; then
  echo "ERROR: $RESIDUE harness fixture rows survived the transaction." >&2
  exit 4
fi

echo "Medical Review database harness passed."
