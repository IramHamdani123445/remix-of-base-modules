#!/usr/bin/env bash
# =====================================================================
# Step 9 — Deploy edge functions into the mirrored target project.
#
# Requires two things this sandbox does not hold:
#   SUPABASE_ACCESS_TOKEN  personal access token for the account that
#                          owns the TARGET project
#   TARGET_PROJECT_REF     the target project's ref
#
# Usage:
#   SUPABASE_ACCESS_TOKEN=sbp_... TARGET_PROJECT_REF=abcd... \
#     scripts/mirror/deploy-edge-functions.sh [function-name ...]
#
# With no arguments every function under supabase/functions is
# deployed (directories starting with "_" are shared code and skipped).
# verify_jwt settings are read from supabase/config.toml by the CLI.
# =====================================================================
set -uo pipefail

REF="${TARGET_PROJECT_REF:-}"
[[ -n "${SUPABASE_ACCESS_TOKEN:-}" ]] || { echo "::error::SUPABASE_ACCESS_TOKEN must be set" >&2; exit 2; }
[[ -n "$REF" ]] || { echo "::error::TARGET_PROJECT_REF must be set" >&2; exit 2; }
[[ "$REF" == "xynceskeiiisiefqlgxo" ]] && { echo "::error::refusing to deploy to the source project" >&2; exit 2; }

CLI=(supabase)
command -v supabase >/dev/null 2>&1 || CLI=(nix run nixpkgs#supabase-cli --)

LOG="${STATE_DIR:-/tmp/mirror-functions}"; mkdir -p "$LOG"
FAILED="$LOG/failed.txt"; : > "$FAILED"

mapfile -t FNS < <(
  if (($#)); then printf '%s\n' "$@"
  else ls supabase/functions | grep -v '^_'
  fi
)
echo "==> deploying ${#FNS[@]} functions to $REF"

for fn in "${FNS[@]}"; do
  [[ -f "supabase/functions/$fn/index.ts" ]] || { echo "skip $fn (no index.ts)"; continue; }
  if "${CLI[@]}" functions deploy "$fn" --project-ref "$REF" >>"$LOG/$fn.log" 2>&1; then
    echo "ok   $fn"
  else
    echo "FAIL $fn (see $LOG/$fn.log)"; echo "$fn" >> "$FAILED"
  fi
done

if [[ -s "$FAILED" ]]; then
  echo "==> failures:"; cat "$FAILED"; exit 1
fi
echo "==> all functions deployed"
