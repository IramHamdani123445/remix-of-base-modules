#!/usr/bin/env bash
# Stage 11 — parity verification against the TARGET project.
# Read-only. Prints a machine-comparable report; compare against the same
# queries run on the source (see docs/mirror-step11-cutover.md).
set -uo pipefail

: "${MIRROR_TARGET_DATABASE_URL:?MIRROR_TARGET_DATABASE_URL must be set}"
if [[ "$MIRROR_TARGET_DATABASE_URL" == *"xynceskeiiisiefqlgxo"* ]]; then
  echo "refusing to run against the source project" >&2
  exit 1
fi

Q() { psql "$MIRROR_TARGET_DATABASE_URL" -X -q -t -A -F'|' -c "$1" 2>&1; }

echo "=== object counts ==="
Q "SELECT 'tables', count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'
   UNION ALL SELECT 'views', count(*) FROM information_schema.views WHERE table_schema='public'
   UNION ALL SELECT 'functions', count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
   UNION ALL SELECT 'indexes', count(*) FROM pg_indexes WHERE schemaname='public'
   UNION ALL SELECT 'triggers', count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
   UNION ALL SELECT 'enums', count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e'
   UNION ALL SELECT 'rls_policies', count(*) FROM pg_policies WHERE schemaname='public'
   UNION ALL SELECT 'migrations', count(*) FROM supabase_migrations.schema_migrations
   UNION ALL SELECT 'auth_users', count(*) FROM auth.users
   UNION ALL SELECT 'auth_identities', count(*) FROM auth.identities
   UNION ALL SELECT 'storage_buckets', count(*) FROM storage.buckets
   UNION ALL SELECT 'storage_objects', count(*) FROM storage.objects
   ORDER BY 1"

echo
echo "=== top 40 tables by live rows ==="
Q "SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname='public' ORDER BY n_live_tup DESC LIMIT 40"

echo
echo "=== empty tables in target (expect: same set as source) ==="
Q "SELECT count(*) FROM pg_stat_user_tables WHERE schemaname='public' AND n_live_tup=0"

echo
echo "=== health ==="
Q "SELECT 'db_size', pg_size_pretty(pg_database_size(current_database()))
   UNION ALL SELECT 'connections', count(*)::text FROM pg_stat_activity
   UNION ALL SELECT 'invalid_indexes', count(*)::text FROM pg_index WHERE NOT indisvalid
   UNION ALL SELECT 'not_valid_constraints', count(*)::text FROM pg_constraint WHERE NOT convalidated"
