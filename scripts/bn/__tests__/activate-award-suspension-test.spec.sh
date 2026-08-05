#!/usr/bin/env bash
# BN-SUSP-ACT-2 — guard tests for activate-award-suspension-test.sh.
#
# A stub `psql` is placed on PATH so the guards can be exercised without any
# real database. No credentials are used or printed.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/scripts/bn/activate-award-suspension-test.sh"
STUB_DIR="$(mktemp -d)"
trap 'rm -rf "$STUB_DIR"' EXIT

cat > "$STUB_DIR/psql" <<'STUB'
#!/usr/bin/env bash
# Minimal psql stub. Answers the queries the activation script issues.
sql=""
while [ $# -gt 0 ]; do
  case "$1" in
    -c) sql="$2"; shift 2 ;;
    *) shift ;;
  esac
done
case "$sql" in
  *current_database*)          echo "${STUB_DB:-skn_test}" ;;
  *to_regclass*marker*|*platform_environment_marker\'*) echo "${STUB_MARKER_PRESENT:-t}" ;;
  *environment_code*)          echo "${STUB_MARKER:-TEST}" ;;
  *bn_approval_policy*)        echo "${STUB_POLICY:-t}" ;;
  *count\(\*\)\ FROM\ public.app_modules*) echo "1" ;;
  *UPDATE\ public.app_modules*) echo "${STUB_UPDATED:-1}" ;;
  *SELECT\ name,\ is_enabled*) echo "bn_award_suspension|t|t|TEST_ACTIVE|f" ;;
  *)                           echo "t" ;;
esac
STUB
chmod +x "$STUB_DIR/psql"
export PATH="$STUB_DIR:$PATH"

pass=0; fail=0
expect() { # expect <name> <expected-exit> <expected-substring-or-->
  local name="$1" want="$2" needle="$3"; shift 3
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  if [ "$rc" = "$want" ] && { [ "$needle" = "-" ] || echo "$out" | grep -qF "$needle"; }; then
    echo "ok   — $name"; pass=$((pass+1))
  else
    echo "FAIL — $name (exit=$rc)"; echo "$out" | sed 's/^/       /'; fail=$((fail+1))
  fi
}

base_env() {
  env BN_SUSP_DB_URL="postgresql://u:p@127.0.0.1:5432/skn_test" "$@"
}

# --- confirmation / environment guards -------------------------------------
expect "missing confirmation" 1 "BN_SUSP_CONFIRM_NONPROD=YES" \
  base_env BN_SUSP_ENVIRONMENT=TEST BN_SUSP_EXPECTED_DATABASE=skn_test "$SCRIPT" enable
expect "missing environment" 1 "BN_SUSP_ENVIRONMENT" \
  base_env BN_SUSP_CONFIRM_NONPROD=YES BN_SUSP_EXPECTED_DATABASE=skn_test "$SCRIPT" enable
expect "invalid environment" 1 "BN_SUSP_ENVIRONMENT" \
  base_env BN_SUSP_CONFIRM_NONPROD=YES BN_SUSP_ENVIRONMENT=STAGING BN_SUSP_EXPECTED_DATABASE=skn_test "$SCRIPT" enable
expect "database name mismatch" 1 "does not match" \
  base_env BN_SUSP_CONFIRM_NONPROD=YES BN_SUSP_ENVIRONMENT=TEST BN_SUSP_EXPECTED_DATABASE=other_db "$SCRIPT" enable

# --- production denylist ----------------------------------------------------
for token in prod production live prd release; do
  expect "denylist: $token" 1 "production target" \
    env BN_SUSP_DB_URL="postgresql://u:p@127.0.0.1:5432/skn_${token}" \
        BN_SUSP_CONFIRM_NONPROD=YES BN_SUSP_ENVIRONMENT=TEST \
        BN_SUSP_EXPECTED_DATABASE=skn_test "$SCRIPT" enable
done

# --- canonical marker -------------------------------------------------------
expect "missing environment marker" 6 "CANONICAL ENVIRONMENT MARKER MISSING" \
  base_env STUB_MARKER_PRESENT=f BN_SUSP_CONFIRM_NONPROD=YES BN_SUSP_ENVIRONMENT=TEST \
    BN_SUSP_EXPECTED_DATABASE=skn_test "$SCRIPT" enable
expect "production marker rejected" 6 "not TEST or LOCAL" \
  base_env STUB_MARKER=PRODUCTION BN_SUSP_CONFIRM_NONPROD=YES BN_SUSP_ENVIRONMENT=TEST \
    BN_SUSP_EXPECTED_DATABASE=skn_test "$SCRIPT" enable

# --- readiness --------------------------------------------------------------
expect "missing workflow approval policy" 5 "ACTIVATION BLOCKED" \
  base_env STUB_POLICY=f BN_SUSP_CONFIRM_NONPROD=YES BN_SUSP_ENVIRONMENT=TEST \
    BN_SUSP_EXPECTED_DATABASE=skn_test "$SCRIPT" enable

# --- happy paths ------------------------------------------------------------
expect "successful Test enable" 0 "actions ENABLED" \
  base_env BN_SUSP_CONFIRM_NONPROD=YES BN_SUSP_ENVIRONMENT=TEST \
    BN_SUSP_EXPECTED_DATABASE=skn_test "$SCRIPT" enable
expect "successful Test disable" 0 "actions DISABLED" \
  base_env BN_SUSP_CONFIRM_NONPROD=YES BN_SUSP_ENVIRONMENT=TEST \
    BN_SUSP_EXPECTED_DATABASE=skn_test "$SCRIPT" disable

echo
echo "passed=$pass failed=$fail"
[ "$fail" = "0" ]
