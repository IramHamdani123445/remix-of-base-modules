#!/usr/bin/env bash
# =====================================================================
# Step 8 — Auth users load (source -> mirrored target).
#
# Streams auth.users and auth.identities from the source project into
# the target project. The source side is read through two read-only
# views (public.mirror_auth_users / public.mirror_auth_identities)
# because the managed sandbox role cannot read the auth schema
# directly. Only the columns that exist on BOTH sides and are not
# generated on the target are copied, so GoTrue version drift is safe.
#
# Usage:
#   TARGET_DATABASE_URL="$MIRROR_TARGET_DATABASE_URL" \
#     scripts/mirror/stream-auth-users.sh
# =====================================================================
set -uo pipefail

DB_URL="${TARGET_DATABASE_URL:-}"
STATE_DIR="${STATE_DIR:-/tmp/mirror-auth}"
[[ -n "$DB_URL" ]] || { echo "::error::TARGET_DATABASE_URL must be set" >&2; exit 2; }
case "$DB_URL" in
  *xynceskeiiisiefqlgxo*)
    echo "::error::refusing to run: TARGET_DATABASE_URL points at the source project" >&2
    exit 2;;
esac
mkdir -p "$STATE_DIR"
LOG="$STATE_DIR/auth.log"

cols_for() { # $1 = target auth table, $2 = source view
  local tgt src
  tgt=$(psql "$DB_URL" -X -q -t -A -c "
    select string_agg(quote_ident(attname), ',' order by attnum)
    from pg_attribute
    where attrelid = 'auth.$1'::regclass and attnum > 0 and not attisdropped
      and attgenerated = ''")
  src=$(psql -X -q -t -A -c "
    select string_agg(quote_ident(attname), ',' order by attnum)
    from pg_attribute
    where attrelid = 'public.$2'::regclass and attnum > 0 and not attisdropped")
  python3 - "$tgt" "$src" <<'PY'
import sys
t = [c for c in sys.argv[1].split(',') if c]
s = set(c for c in sys.argv[2].split(',') if c)
print(','.join(c for c in t if c in s))
PY
}

UCOLS=$(cols_for users mirror_auth_users)
ICOLS=$(cols_for identities mirror_auth_identities)
echo "==> users columns:      $UCOLS"      | tee -a "$LOG"
echo "==> identities columns: $ICOLS"      | tee -a "$LOG"
[[ -n "$UCOLS" && -n "$ICOLS" ]] || { echo "::error::could not resolve column sets" >&2; exit 1; }

echo "==> clearing target auth tables" | tee -a "$LOG"
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL' >>"$LOG" 2>&1 || exit 1
set session_replication_role = replica;
truncate auth.identities, auth.sessions, auth.refresh_tokens,
         auth.mfa_amr_claims, auth.mfa_challenges, auth.mfa_factors,
         auth.one_time_tokens, auth.users cascade;
SQL

load() { # $1 = target table, $2 = source view, $3 = columns
  echo "==> loading auth.$1" | tee -a "$LOG"
  psql -X -q -c "\copy (select $3 from public.$2) to stdout with (format csv)" \
    | psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 \
        -c "set session_replication_role = replica;" \
        -c "\copy auth.$1($3) from stdin with (format csv)" >>"$LOG" 2>&1
  return ${PIPESTATUS[1]}
}

load users mirror_auth_users "$UCOLS"      || { echo "::error::users load failed"; tail -20 "$LOG"; exit 1; }
load identities mirror_auth_identities "$ICOLS" || { echo "::error::identities load failed"; tail -20 "$LOG"; exit 1; }

echo "==> verification"
SRC=$(psql -X -q -t -A -c "select (select count(*) from public.mirror_auth_users)||'/'||(select count(*) from public.mirror_auth_identities)")
TGT=$(psql "$DB_URL" -X -q -t -A -c "select (select count(*) from auth.users)||'/'||(select count(*) from auth.identities)")
echo "source users/identities: $SRC"
echo "target users/identities: $TGT"
[[ "$SRC" == "$TGT" ]] && echo "PARITY OK" || { echo "::error::count mismatch"; exit 1; }
