#!/usr/bin/env bash
# =====================================================================
# BN-SUSP-PROV-1 — guard and behaviour tests for
# scripts/bn/provision-award-suspension-test-db.sh
#
# Pure-guard cases run without any database. Database cases run against a
# disposable local PostgreSQL cluster (PostgreSQL 15 by preference) built
# once from the reviewed baseline + forward migrations and then cloned per
# case with CREATE DATABASE ... TEMPLATE.
#
# No credential is ever printed: the harness uses a trust-auth local
# cluster with no password at all.
# =====================================================================
set -uo pipefail

# PostgreSQL refuses to run as root. When invoked as root (sandboxes,
# containers) re-exec the whole suite unprivileged. CI runners are already
# unprivileged and skip this block entirely.
if [ "$(id -u)" = "0" ]; then
  SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  WORK="$(mktemp -d)"; chmod 777 "$WORK"
  UID_UNPRIV="${BN_SUSP_TEST_UID:-4242}"
  # initdb resolves the effective uid, so the account must exist in passwd.
  if ! getent passwd "$UID_UNPRIV" >/dev/null 2>&1; then
    getent group "$UID_UNPRIV" >/dev/null 2>&1 \
      || echo "bnsusptest:x:${UID_UNPRIV}:" >> /etc/group
    echo "bnsusptest:x:${UID_UNPRIV}:${UID_UNPRIV}::${WORK}:/bin/bash" >> /etc/passwd
  fi
  if command -v setpriv >/dev/null 2>&1 && getent passwd "$UID_UNPRIV" >/dev/null 2>&1; then
    exec setpriv --reuid="$UID_UNPRIV" --regid="$UID_UNPRIV" --clear-groups \
      env HOME="$WORK" TMPDIR="$WORK" BN_SUSP_TEST_PGBIN="${BN_SUSP_TEST_PGBIN:-}" \
      bash "$SELF"
  fi
  echo "SKIP — running as root and privileges could not be dropped" >&2
  exit 1
fi



ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/scripts/bn/provision-award-suspension-test-db.sh"
REF="uatref01"


pass=0; fail=0
ok()   { echo "ok   — $1"; pass=$((pass+1)); }
bad()  { echo "FAIL — $1"; shift; [ $# -gt 0 ] && echo "$*" | sed 's/^/       /'; fail=$((fail+1)); }

expect_fail() { # expect_fail <name> <needle> -- <env assignments...>
  local name="$1" needle="$2"; shift 3
  local out rc
  out="$(env "$@" "$SCRIPT" 2>&1)"; rc=$?
  if [ "$rc" != "0" ] && { [ "$needle" = "-" ] || echo "$out" | grep -qiF "$needle"; }; then
    ok "$name"
  else
    bad "$name (exit=$rc)" "$out"
  fi
}

# =====================================================================
# 1. Pure-guard cases (no database required)
# =====================================================================
FAKE_URL="postgresql://u@127.0.0.1:1/skn_uat"

expect_fail "missing confirmation" "BN_SUSP_CONFIRM_NONPROD=YES is required" -- \
  BN_SUSP_DB_URL="$FAKE_URL" BN_SUSP_EXPECTED_DATABASE=skn_uat BN_SUSP_TEST_PROJECT_REF="$REF"
expect_fail "missing URL" "BN_SUSP_DB_URL is not set" -- \
  BN_SUSP_CONFIRM_NONPROD=YES BN_SUSP_EXPECTED_DATABASE=skn_uat BN_SUSP_TEST_PROJECT_REF="$REF"
expect_fail "missing expected database" "BN_SUSP_EXPECTED_DATABASE is not set" -- \
  BN_SUSP_CONFIRM_NONPROD=YES BN_SUSP_DB_URL="$FAKE_URL" BN_SUSP_TEST_PROJECT_REF="$REF"
expect_fail "missing project ref" "BN_SUSP_TEST_PROJECT_REF is not set" -- \
  BN_SUSP_CONFIRM_NONPROD=YES BN_SUSP_DB_URL="$FAKE_URL" BN_SUSP_EXPECTED_DATABASE=skn_uat
expect_fail "denylisted live project ref" "denylisted live project" -- \
  BN_SUSP_CONFIRM_NONPROD=YES BN_SUSP_DB_URL="$FAKE_URL" BN_SUSP_EXPECTED_DATABASE=skn_uat \
  BN_SUSP_TEST_PROJECT_REF=xynceskeiiisiefqlgxo
expect_fail "production-like URL" "apparent production target" -- \
  BN_SUSP_CONFIRM_NONPROD=YES BN_SUSP_DB_URL="postgresql://u@prod-host:1/skn_uat" \
  BN_SUSP_EXPECTED_DATABASE=skn_uat BN_SUSP_TEST_PROJECT_REF="$REF"
expect_fail "production-like database name" "apparent production target" -- \
  BN_SUSP_CONFIRM_NONPROD=YES BN_SUSP_DB_URL="$FAKE_URL" \
  BN_SUSP_EXPECTED_DATABASE=skn_live BN_SUSP_TEST_PROJECT_REF="$REF"
expect_fail "production-like project ref" "apparent production target" -- \
  BN_SUSP_CONFIRM_NONPROD=YES BN_SUSP_DB_URL="$FAKE_URL" \
  BN_SUSP_EXPECTED_DATABASE=skn_uat BN_SUSP_TEST_PROJECT_REF="release01"

# =====================================================================
# 2. Disposable PostgreSQL server
#
# Either an external disposable server (BN_SUSP_TEST_ADMIN_URL — used by CI
# with a postgres:15 service container) or a locally started throwaway
# cluster. Never a shared or persistent database.
# =====================================================================
PGDIR="$(mktemp -d)"
ADMIN_URL="${BN_SUSP_TEST_ADMIN_URL:-}"

if [ -n "$ADMIN_URL" ]; then
  BASE="${ADMIN_URL%/*}"
  url_for() { echo "$BASE/$1"; }
  cleanup() { rm -rf "$PGDIR"; }
  trap cleanup EXIT
  echo "using external disposable PostgreSQL: $(psql "$ADMIN_URL" -X -At -c 'SHOW server_version')"
else
  PGBIN="${BN_SUSP_TEST_PGBIN:-}"
  if [ -z "$PGBIN" ]; then
    for c in /usr/lib/postgresql/15/bin /usr/lib/postgresql/*/bin /usr/bin /bin; do
      [ -x "$c/initdb" ] && PGBIN="$c" && break
    done
  fi
  if [ -z "$PGBIN" ] || [ ! -x "$PGBIN/initdb" ]; then
    echo "SKIP — no local PostgreSQL binaries; database cases not run" >&2
    echo "passed=$pass failed=$fail (database cases skipped)"
    exit 1
  fi
  export PATH="$PGBIN:$PATH"
  echo "using PostgreSQL: $("$PGBIN/initdb" --version)"

  PGSOCK="$PGDIR/sock"; mkdir -p "$PGSOCK"
  cleanup() { "$PGBIN/pg_ctl" -D "$PGDIR/data" -m immediate stop >/dev/null 2>&1; rm -rf "$PGDIR"; }
  trap cleanup EXIT

  "$PGBIN/initdb" -D "$PGDIR/data" -U postgres -A trust > "$PGDIR/initdb.log" 2>&1 \
    || { echo "FAIL — initdb"; tail -20 "$PGDIR/initdb.log"; exit 1; }
  "$PGBIN/pg_ctl" -D "$PGDIR/data" -o "-k $PGSOCK -h '' -c fsync=off" -l "$PGDIR/pg.log" -w start >/dev/null 2>&1 \
    || { echo "FAIL — pg_ctl start"; tail -30 "$PGDIR/pg.log"; exit 1; }

  # Trust auth over a unix socket: no password exists anywhere in this run.
  url_for() { echo "postgresql://postgres@/$1?host=$PGSOCK"; }
fi

psql_q()  { psql "$(url_for "$1")" -X -At -v ON_ERROR_STOP=1 -c "$2"; }
adm()     { psql "$(url_for postgres)" -X -q -v ON_ERROR_STOP=1 -c "$1"; }


echo "==> building the template database (baseline + forward migrations)"
adm "CREATE DATABASE skn_uat_tmpl"
if ! DATABASE_URL="$(url_for skn_uat_tmpl)" bash "$ROOT/scripts/ci/bootstrap-supabase-test-db.sh" > "$PGDIR/bootstrap.log" 2>&1; then
  echo "FAIL — bootstrap"; tail -40 "$PGDIR/bootstrap.log"; exit 1
fi
ok "template database built from the reviewed baseline + forward migrations"

clone() { # clone <dbname>
  adm "DROP DATABASE IF EXISTS $1"
  adm "CREATE DATABASE $1 TEMPLATE skn_uat_tmpl"
}

run_prov() { # run_prov <dbname> [extra env...]
  local db="$1"; shift
  env BN_SUSP_CONFIRM_NONPROD=YES \
      BN_SUSP_DB_URL="$(url_for "$db")" \
      BN_SUSP_EXPECTED_DATABASE="$db" \
      BN_SUSP_TEST_PROJECT_REF="$REF" \
      "$@" "$SCRIPT" 2>&1
}

# --- wrong current database --------------------------------------------------
clone skn_uat_a
out="$(env BN_SUSP_CONFIRM_NONPROD=YES BN_SUSP_DB_URL="$(url_for skn_uat_a)" \
        BN_SUSP_EXPECTED_DATABASE=skn_uat_other BN_SUSP_TEST_PROJECT_REF="$REF" "$SCRIPT" 2>&1)"
echo "$out" | grep -q "does not match" && ok "wrong current database rejected" \
  || bad "wrong current database rejected" "$out"

# --- missing marker table ----------------------------------------------------
adm "DROP DATABASE IF EXISTS skn_uat_bare"; adm "CREATE DATABASE skn_uat_bare"
out="$(run_prov skn_uat_bare)"
echo "$out" | grep -q "platform_environment_marker missing" && ok "missing marker table rejected" \
  || bad "missing marker table rejected" "$out"

# --- existing mismatched marker (CI marker left by bootstrap) ----------------
clone skn_uat_b
out="$(run_prov skn_uat_b)"
echo "$out" | grep -qi "existing environment marker is" && ok "mismatched (CI) marker fails closed" \
  || bad "mismatched (CI) marker fails closed" "$out"

# --- existing PRODUCTION marker ---------------------------------------------
clone skn_uat_c
psql_q skn_uat_c "UPDATE public.platform_environment_marker SET environment_kind='PRODUCTION', allows_controlled_test_activation=false" >/dev/null
out="$(run_prov skn_uat_c)"
echo "$out" | grep -qi "PRODUCTION environment marker" && ok "PRODUCTION marker fails closed" \
  || bad "PRODUCTION marker fails closed" "$out"

# --- duplicate marker rows ---------------------------------------------------
clone skn_uat_d
dup_rc=0
psql_q skn_uat_d "INSERT INTO public.platform_environment_marker (id, environment_kind, environment_label, allows_controlled_test_activation) VALUES (false,'TEST','dup',true)" >/dev/null 2>&1 || dup_rc=$?
if [ "$dup_rc" != "0" ]; then
  ok "duplicate marker rows impossible (singleton constraint enforced)"
else
  out="$(run_prov skn_uat_d)"
  echo "$out" | grep -qi "ambiguous environment identity" && ok "duplicate marker rows fail closed" \
    || bad "duplicate marker rows fail closed" "$out"
fi

# --- already activated module ------------------------------------------------
clone skn_uat_e
psql_q skn_uat_e "DELETE FROM public.platform_environment_marker" >/dev/null
psql_q skn_uat_e "UPDATE public.app_modules SET actions_enabled=true WHERE name='bn_award_suspension'" >/dev/null
out="$(run_prov skn_uat_e)"
echo "$out" | grep -qi "already activated" && ok "already-activated module rejected" \
  || bad "already-activated module rejected" "$out"

# =====================================================================
# 3. Full provisioning happy path (operator removed the CI marker)
# =====================================================================
clone skn_uat_ok
psql_q skn_uat_ok "DELETE FROM public.platform_environment_marker" >/dev/null
# Plant an unexpected positive grant that the seed must revoke.
psql_q skn_uat_ok "INSERT INTO public.roles (id, role_name, description, is_active, is_system_role, mfa_required)
  SELECT gen_random_uuid(),'BN_AUDITOR','pre-existing',true,false,false
   WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE role_name='BN_AUDITOR')" >/dev/null
psql_q skn_uat_ok "INSERT INTO public.role_permissions (role_id, module_id, action_id, is_granted)
  SELECT r.id, ma.module_id, ma.id, true
    FROM public.roles r
    JOIN public.module_actions ma ON true
    JOIN public.app_modules m ON m.id = ma.module_id AND m.name='bn_award_suspension'
   WHERE r.role_name='BN_AUDITOR' AND ma.action_name='execute'
     AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id=r.id AND rp.action_id=ma.id)" >/dev/null

out="$(run_prov skn_uat_ok)"
if echo "$out" | grep -q "BN_SUSP_PROVISION_RESULT: PASS"; then
  ok "full provisioning path passes"
else
  bad "full provisioning path passes" "$out"
fi

check_sql() { # check_sql <name> <sql> <expected>
  local got; got="$(psql_q skn_uat_ok "$2")"
  [ "$got" = "$3" ] && ok "$1" || bad "$1 (got '$got', expected '$3')"
}

check_sql "postflight actions_enabled=false" \
  "SELECT actions_enabled FROM public.app_modules WHERE name='bn_award_suspension'" "f"
check_sql "rollout_state stays inside the shared constraint" \
  "SELECT rollout_state FROM public.app_modules WHERE name='bn_award_suspension'" "internal_pilot"
check_sql "exactly one TEST marker allowing controlled activation" \
  "SELECT count(*) FROM public.platform_environment_marker WHERE environment_kind='TEST' AND allows_controlled_test_activation" "1"
check_sql "marker carries the requested project ref" \
  "SELECT project_ref FROM public.platform_environment_marker" "$REF"

# --- exact permission matrix -------------------------------------------------
MATRIX="BN_AUDITOR:audit,BN_AUDITOR:view,BN_AUDITOR:view_payment_impact,BN_CLAIMS_OFFICER:propose,BN_CLAIMS_OFFICER:resume_propose,BN_CLAIMS_OFFICER:view,BN_CLAIMS_OFFICER:withdraw,BN_MANAGER:execute,BN_MANAGER:resolve_payment_exception,BN_MANAGER:resume_execute,BN_MANAGER:view,BN_MANAGER:view_payment_impact,BN_SUPERVISOR:approve,BN_SUPERVISOR:resume_approve,BN_SUPERVISOR:view"
check_sql "exact granted permission matrix" \
  "SELECT string_agg(r.role_name||':'||ma.action_name, ',' ORDER BY r.role_name, ma.action_name)
     FROM public.role_permissions rp
     JOIN public.roles r ON r.id=rp.role_id
     JOIN public.module_actions ma ON ma.id=rp.action_id
     JOIN public.app_modules m ON m.id=ma.module_id AND m.name='bn_award_suspension'
    WHERE rp.is_granted AND r.role_name IN ('BN_CLAIMS_OFFICER','BN_SUPERVISOR','BN_MANAGER','BN_AUDITOR')" \
  "$MATRIX"
check_sql "unexpected pre-existing grant revoked (BN_AUDITOR:execute)" \
  "SELECT is_granted FROM public.role_permissions rp
     JOIN public.roles r ON r.id=rp.role_id AND r.role_name='BN_AUDITOR'
     JOIN public.module_actions ma ON ma.id=rp.action_id AND ma.action_name='execute'
     JOIN public.app_modules m ON m.id=ma.module_id AND m.name='bn_award_suspension'" "f"

# --- fixture ownership -------------------------------------------------------
check_sql "each synthetic award owns a distinct synthetic claim" \
  "SELECT count(DISTINCT bn_claim_id) FROM public.bn_award WHERE award_number LIKE 'UAT-AWD-%'" "3"
check_sql "award SSN always matches its claim SSN" \
  "SELECT count(*) FROM public.bn_award a JOIN public.bn_claim c ON c.id=a.bn_claim_id
    WHERE a.award_number LIKE 'UAT-AWD-%' AND c.ssn IS DISTINCT FROM a.ssn" "0"
check_sql "only reserved synthetic claimant identifiers are used" \
  "SELECT count(*) FROM public.bn_claim WHERE claim_number LIKE 'UAT-CLM-%'
     AND ssn NOT IN ('900000001','900000002','900000003')" "0"
check_sql "payment schedules provisioned" \
  "SELECT count(*) FROM public.bn_payment_schedule s JOIN public.bn_award a ON a.id=s.bn_award_id
    WHERE a.award_number LIKE 'UAT-AWD-%'" "18"

# --- idempotent second run ---------------------------------------------------
out2="$(run_prov skn_uat_ok)"
if echo "$out2" | grep -q "BN_SUSP_PROVISION_RESULT: PASS"; then
  ok "second run is idempotent"
else
  bad "second run is idempotent" "$out2"
fi
check_sql "no fixture duplication after the second run" \
  "SELECT count(*) FROM public.bn_payment_schedule s JOIN public.bn_award a ON a.id=s.bn_award_id
    WHERE a.award_number LIKE 'UAT-AWD-%'" "18"

# --- no credentials printed --------------------------------------------------
if echo "$out$out2" | grep -Eqi 'password|encrypted_password|secret|token|PGPASSWORD'; then
  bad "no credentials printed"
else
  ok "no credentials printed"
fi

echo
echo "passed=$pass failed=$fail"
[ "$fail" = "0" ]
