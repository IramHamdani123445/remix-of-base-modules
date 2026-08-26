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
