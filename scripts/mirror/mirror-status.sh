#!/usr/bin/env bash
# Progress readout for the mirror build: schema, migrations and storage.
set -uo pipefail

echo "=== schema (target project) ==="
psql "$MIRROR_TARGET_DATABASE_URL" -X -q -c "
  SELECT
    (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') AS tables,
    (SELECT count(*) FROM information_schema.views  WHERE table_schema='public') AS views,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') AS functions,
    (SELECT count(*) FROM pg_indexes WHERE schemaname='public') AS indexes,
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='supabase_migrations' AND c.relname='schema_migrations') AS ledger_present" 2>&1

echo
echo "=== baseline apply ==="
if [[ -f /tmp/mirror-bootstrap/baseline.progress ]]; then
  applied=$(wc -l < /tmp/mirror-bootstrap/baseline.progress)
  echo "  statements streamed: $applied / 167261 lines"
else
  echo "  no baseline log in this sandbox (job not running here)"
fi
pgrep -f 'psql.*schema.sql' >/dev/null && echo "  status: RUNNING" || echo "  status: not running"

echo
echo "=== post-cutoff migrations ==="
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="$ROOT/supabase/baseline/baseline_manifest.json"
if [[ -f "$MANIFEST" ]]; then
  CUTOFF="$(python3 -c "import json;print(json.load(open('$MANIFEST'))['migration_cutoff_inclusive'])")"
  TOTAL=0; VERSIONS=""
  for path in "$ROOT"/supabase/migrations/*.sql; do
    name="$(basename "$path")"
    [[ "$name" > "$CUTOFF" ]] || continue
    TOTAL=$((TOTAL + 1))
    VERSIONS+="${name%%_*}"$'\n'
  done
  DONE="$(psql "$MIRROR_TARGET_DATABASE_URL" -X -q -t -A -c \
    "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version > '${CUTOFF%%_*}'" 2>/dev/null)"
  DONE="${DONE:-0}"
  LAST="$(psql "$MIRROR_TARGET_DATABASE_URL" -X -q -t -A -c \
    "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 1" 2>/dev/null)"
  python3 - "$TOTAL" "$DONE" "${LAST:-none}" <<'PY'
import sys
total, done = int(sys.argv[1]), int(sys.argv[2])
last = sys.argv[3]
pct = (done / total * 100) if total else 0
filled = int(pct / 2.5)
bar = '#' * filled + '.' * (40 - filled)
print(f"  [{bar}] {pct:5.1f}%  {done}/{total}  remaining={max(total-done,0)}")
print(f"  last applied version: {last}")
PY
else
  echo "  baseline manifest missing"
fi
pgrep -f 'bootstrap-external-supabase.sh' >/dev/null && echo "  status: RUNNING" || echo "  status: not running"

echo

echo "=== storage copy ==="
if [[ -f /tmp/mirror-storage/progress.json ]]; then
  python3 - <<'PY'
import json, time
s = json.load(open('/tmp/mirror-storage/progress.json'))
t, d, k, f = s['total'], s['done'], s['skipped'], s['failed']
n = d + k
pct = (n / t * 100) if t else 0
bar = '#' * int(pct / 2.5) + '.' * (40 - int(pct / 2.5))
print(f"  [{bar}] {pct:5.1f}%  {n}/{t}  copied={d} already-present={k} failed={f}")
print("  state:", "FINISHED" if s.get('finished') else "running")
for b, v in sorted(s.get('buckets', {}).items()):
    print(f"    {b:22s} {v['done']}/{v['total']}")
PY
else
  echo "  no storage progress file in this sandbox"
fi
pgrep -f copy-storage-objects.py >/dev/null && echo "  status: RUNNING" || echo "  status: not running"
