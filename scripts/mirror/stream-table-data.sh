#!/usr/bin/env bash
# =====================================================================
# Step 7 — Table data load (direct source -> target streaming).
#
# Streams every non-empty public table from the source database
# (managed PG* env vars, read-only) into the mirrored external target
# with per-table `COPY ... TO STDOUT` / `COPY ... FROM STDIN`.
#
# No dump files are produced: each table is a single CSV stream.
# Triggers and FK checks are disabled for the duration of each table
# load (session_replication_role = replica), so table order is
# irrelevant. Each target table is truncated before loading so the run
# is fully resumable / idempotent.
#
# Usage:
#   TARGET_DATABASE_URL="$MIRROR_TARGET_DATABASE_URL" \
#     scripts/mirror/stream-table-data.sh [tablelist-file]
#
# Env:
#   RESUME=1   skip tables already recorded as done in the state file
#   STATE_DIR  where progress/logs live (default /tmp/mirror-data)
# =====================================================================
set -uo pipefail

DB_URL="${TARGET_DATABASE_URL:-}"
STATE_DIR="${STATE_DIR:-/tmp/mirror-data}"
RESUME="${RESUME:-1}"

[[ -n "$DB_URL" ]] || { echo "::error::TARGET_DATABASE_URL must be set" >&2; exit 2; }
case "$DB_URL" in
  *xynceskeiiisiefqlgxo*)
    echo "::error::refusing to run: TARGET_DATABASE_URL points at the source project" >&2
    exit 2;;
esac

mkdir -p "$STATE_DIR"
DONE="$STATE_DIR/done.txt";   touch "$DONE"
FAILED="$STATE_DIR/failed.txt"; : > "$FAILED"
LOG="$STATE_DIR/stream.log"

LIST="${1:-$STATE_DIR/tables.txt}"
if [[ ! -s "$LIST" ]]; then
  echo "==> building source table list" | tee -a "$LOG"
  psql -X -q -t -A -F' ' -c "
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relkind = 'r'
    ORDER BY c.reltuples DESC, c.relname" > "$LIST"
fi

# One global truncate makes per-table truncation unnecessary (and avoids
# FK "referenced by" errors). Runs once per state dir.
if [[ ! -f "$STATE_DIR/truncated.ok" ]]; then
  echo "==> truncating all public tables in target (one statement)" | tee -a "$LOG"
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL' >>"$LOG" 2>&1 && touch "$STATE_DIR/truncated.ok"
DO $$
DECLARE stmt text;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
  INTO stmt FROM pg_tables WHERE schemaname = 'public';
  IF stmt IS NOT NULL THEN
    EXECUTE 'TRUNCATE ' || stmt || ' CASCADE';
  END IF;
END $$;
SQL
  [[ -f "$STATE_DIR/truncated.ok" ]] || { echo "::error::global truncate failed" | tee -a "$LOG"; exit 1; }
fi

TOTAL=$(wc -l < "$LIST")
echo "==> $TOTAL source tables to consider" | tee -a "$LOG"

i=0
loaded=0
skipped=0
failed=0
while read -r tbl; do
  [[ -n "$tbl" ]] || continue
  i=$((i+1))
  if [[ "$RESUME" == "1" ]] && grep -qxF "$tbl" "$DONE"; then
    skipped=$((skipped+1)); continue
  fi

  present=$(psql "$DB_URL" -X -q -t -A -c \
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$tbl'" 2>/dev/null)
  if [[ -z "$present" ]]; then
    echo "[$i/$TOTAL] skip $tbl (absent in target)" >> "$LOG"
    echo "$tbl" >> "$DONE"; skipped=$((skipped+1)); continue
  fi

  n=$(psql -X -q -t -A -c "SELECT count(*) FROM public.\"$tbl\"" 2>>"$LOG")
  if [[ -z "$n" ]]; then
    echo "[$i/$TOTAL] FAIL $tbl (source unreadable)" | tee -a "$LOG"
    echo "$tbl unreadable" >> "$FAILED"; failed=$((failed+1)); continue
  fi
  if [[ "$n" == "0" ]]; then
    echo "[$i/$TOTAL] empty $tbl" >> "$LOG"
    echo "$tbl" >> "$DONE"; skipped=$((skipped+1)); continue
  fi

  cols=$(psql -X -q -t -A -c "
    SELECT string_agg(format('%I', column_name), ',' ORDER BY ordinal_position)
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='$tbl'
      AND is_generated='NEVER' AND is_identity <> 'ALWAYS'")
  tcols=$(psql "$DB_URL" -X -q -t -A -c "
    SELECT string_agg(format('%I', column_name), ',' ORDER BY ordinal_position)
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='$tbl'")
  # only stream columns that exist on both sides
  common=$(psql -X -q -t -A -c "
    SELECT string_agg(c, ',')
    FROM (SELECT unnest(string_to_array('$cols', ',')) AS c) s
    WHERE replace(c, '\"', '') IN (
      SELECT replace(unnest(string_to_array('$tcols', ',')), '\"', ''))" 2>/dev/null)
  [[ -n "$common" ]] || common="$cols"

  err="$STATE_DIR/err-$tbl.txt"
  if psql -X -q -v ON_ERROR_STOP=1 \
        -c "\\copy (SELECT $common FROM public.\"$tbl\") TO STDOUT WITH (FORMAT csv)" 2>"$err" \
     | psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 \
        -c "SET session_replication_role = replica;" \
        -c "\\copy public.\"$tbl\" ($common) FROM STDIN WITH (FORMAT csv)" 2>>"$err"
  then
    echo "[$i/$TOTAL] ok $tbl ($n rows)" >> "$LOG"
    echo "$tbl" >> "$DONE"; loaded=$((loaded+1)); rm -f "$err"
  else
    echo "[$i/$TOTAL] FAIL $tbl ($n rows): $(tail -n 2 "$err" | tr '\n' ' ')" >> "$LOG"
    echo "$tbl" >> "$FAILED"; failed=$((failed+1))
  fi
done < "$LIST"

echo "==> loaded=$loaded skipped=$skipped failed=$failed" | tee -a "$LOG"
exit 0
