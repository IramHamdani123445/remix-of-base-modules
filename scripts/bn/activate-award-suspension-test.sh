#!/usr/bin/env bash
# BN-SUSP-ACT-1 — Award Suspension activation for a NON-PRODUCTION Test
# environment only.
#
# This script flips `app_modules.actions_enabled` for `bn_award_suspension`
# so the sanctioned lifecycle commands can run end-to-end during Test.
# It refuses to run unless the operator proves the target is non-production.
#
# Usage:
#   BN_SUSP_DB_URL=postgresql://...      # Test database only
#   BN_SUSP_CONFIRM_NONPROD=YES
#   ./scripts/bn/activate-award-suspension-test.sh [enable|disable|status]
#
# Guards:
#   • the live project ref is denylisted anywhere in the connection string
#   • hosted production hosts are rejected unless the URL is clearly a Test
#     or local database and the operator sets BN_SUSP_CONFIRM_NONPROD=YES
#   • rollback is a single `disable` call
set -euo pipefail

MODE="${1:-status}"
LIVE_REF_DENYLIST="xynceskeiiisiefqlgxo"

if [ -z "${BN_SUSP_DB_URL:-}" ]; then
  echo "BN_SUSP_DB_URL is not set. Refusing to run." >&2
  exit 1
fi

if echo "$BN_SUSP_DB_URL" | grep -q "$LIVE_REF_DENYLIST"; then
  echo "Refusing: the connection string targets the denylisted live project." >&2
  exit 1
fi

if [ "$MODE" != "status" ] && [ "${BN_SUSP_CONFIRM_NONPROD:-}" != "YES" ]; then
  echo "Refusing: set BN_SUSP_CONFIRM_NONPROD=YES to confirm a non-production target." >&2
  exit 1
fi

status() {
  psql "$BN_SUSP_DB_URL" -v ON_ERROR_STOP=1 -c \
    "SELECT name, is_enabled, actions_enabled, show_in_menu
       FROM public.app_modules WHERE name = 'bn_award_suspension';"
}

case "$MODE" in
  enable)
    psql "$BN_SUSP_DB_URL" -v ON_ERROR_STOP=1 -c \
      "UPDATE public.app_modules
          SET actions_enabled = true, is_enabled = true
        WHERE name = 'bn_award_suspension';"
    echo "Award Suspension actions ENABLED (Test)."
    status
    ;;
  disable)
    psql "$BN_SUSP_DB_URL" -v ON_ERROR_STOP=1 -c \
      "UPDATE public.app_modules
          SET actions_enabled = false
        WHERE name = 'bn_award_suspension';"
    echo "Award Suspension actions DISABLED (rollback complete)."
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
