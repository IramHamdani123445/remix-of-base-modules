#!/usr/bin/env bash
# ---------------------------------------------------------------------
# BN Life Certificates — seeded database integration harness runner.
#
# Requires an explicit, approved connection URL. There is deliberately no
# local default: the harness must never run against an arbitrary database.
#
#   BN_TEST_DATABASE_URL=postgres://... scripts/bn/run-life-certificate-db-tests.sh
# ---------------------------------------------------------------------
set -euo pipefail

HARNESS="supabase/tests/bn/life_certificate_integration.sql"
GRANTS="supabase/verify/bn_life_certificate_effective_grants.sql"

if [[ -z "${BN_TEST_DATABASE_URL:-}" ]]; then
  echo "ERROR: BN_TEST_DATABASE_URL is not set." >&2
  echo "       Set it to the approved isolated Test database URL before running." >&2
  exit 2
fi

if [[ ! -f "$HARNESS" ]]; then
  echo "ERROR: harness file $HARNESS not found." >&2
  exit 2
fi

LOG="$(mktemp -t bn-lc-harness.XXXXXX.log)"
echo "Running effective-grant verifier…"
psql "$BN_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$GRANTS" 2>&1 | tee -a "$LOG"

echo "Running seeded Life Certificate database harness…"
# Credentials are never echoed: only the file path and psql output are printed.
psql "$BN_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$HARNESS" 2>&1 | tee -a "$LOG"

if grep -qi 'SKIP' "$LOG"; then
  echo "FAIL: the harness skipped a scenario — seeding is incomplete." >&2
  exit 1
fi

if ! grep -q 'BN_LC_HARNESS_RESULT: PASS' "$LOG"; then
  echo "FAIL: the harness did not report a completed run." >&2
  exit 1
fi

echo "Life Certificate database harness passed."
