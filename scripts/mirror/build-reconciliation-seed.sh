#!/usr/bin/env bash
# =====================================================================
# Build a bounded reference-data reconciliation seed for external mirror
# recovery. The seed is generated from the source database via the managed
# PG* environment and is applied to the TARGET database only when explicitly
# requested.
#
# Usage:
#   scripts/mirror/build-reconciliation-seed.sh
#   APPLY=1 TARGET_DATABASE_URL='postgresql://...' scripts/mirror/build-reconciliation-seed.sh
#
# Output:
#   /tmp/mirror-recovery/reconciliation_seed.sql
#   /tmp/mirror-recovery/reconciliation_seed_manifest.json
# =====================================================================
set -euo pipefail

OUT_DIR="${OUT_DIR:-/tmp/mirror-recovery}"
OUT_SQL="$OUT_DIR/reconciliation_seed.sql"
OUT_MANIFEST="$OUT_DIR/reconciliation_seed_manifest.json"
APPLY="${APPLY:-0}"
TARGET_DB_URL="${TARGET_DATABASE_URL:-${MIRROR_TARGET_DATABASE_URL:-}}"
MAX_RETRIES="${MAX_RETRIES:-8}"
RETRY_DELAY_SECONDS="${RETRY_DELAY_SECONDS:-5}"
mkdir -p "$OUT_DIR"

retry() {
  local description="$1"
  shift
  local attempt=1 delay="$RETRY_DELAY_SECONDS"
  while true; do
    if "$@"; then return 0; fi
    if (( attempt >= MAX_RETRIES )); then
      printf '::error::%s failed after %d attempt(s)\n' "$description" "$attempt" >&2
      return 1
    fi
    printf '    !! %s failed (attempt %d/%d); retrying in %ss\n' "$description" "$attempt" "$MAX_RETRIES" "$delay" >&2
    sleep "$delay"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
}

psql_source_json() {
  psql -X -q -t -A -c "$1"
}

json_rows() {
  local table="$1" where="$2"
  psql_source_json "select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb)::text from (select * from public.${table} where ${where}) t;"
}

python3 - "$OUT_SQL" "$OUT_MANIFEST" <<'PY'
import json, subprocess, sys
from pathlib import Path

out_sql = Path(sys.argv[1])
out_manifest = Path(sys.argv[2])

tables = [
    ('bn_country', "true"),
    ('core_organization', "true"),
    ('core_department', "true"),
    ('app_modules', "true"),
    ('bn_scheme', "id in (select scheme_id from public.bn_product where benefit_code = 'SKN-EI-MED')"),
    ('bn_branch', "id in (select branch_id from public.bn_product where benefit_code = 'SKN-EI-MED')"),
    ('bn_screen_template', "id in (select screen_template_id from public.bn_product_version pv join public.bn_product p on p.id = pv.product_id where p.benefit_code = 'SKN-EI-MED' and screen_template_id is not null)"),
    ('bn_workflow_template', "id in (select workflow_template_id from public.bn_product_version pv join public.bn_product p on p.id = pv.product_id where p.benefit_code = 'SKN-EI-MED' and workflow_template_id is not null)"),
    ('bn_formula_template', "id in (select formula_template_id from public.bn_product_version pv join public.bn_product p on p.id = pv.product_id where p.benefit_code = 'SKN-EI-MED' and formula_template_id is not null)"),
    ('bn_product', "benefit_code = 'SKN-EI-MED'"),
    ('bn_product_version', "product_id in (select id from public.bn_product where benefit_code = 'SKN-EI-MED')"),
    ('omni_comms_event_definition', "true"),
    ('omni_comms_template_family', "true"),
    ('omni_comms_provider', "true"),
    ('omni_comms_provider_account', "true"),
    ('workflow_definitions', "name = 'CE Status — Trivial Transitions'"),
    ('workflow_steps', "workflow_id in (select id from public.workflow_definitions where name = 'CE Status — Trivial Transitions')"),
    ('workflow_step_actions', "step_id in (select s.id from public.workflow_steps s join public.workflow_definitions w on w.id = s.workflow_id where w.name = 'CE Status — Trivial Transitions')"),
    ('omni_comms_producer_event_binding', "id = '8c0f7e05-11a3-4c0a-a01c-66217c986356'::uuid"),
]

def scalar(sql):
    return subprocess.check_output(['psql', '-X', '-q', '-t', '-A', '-c', sql], text=True).strip()

def rows(table, where):
    return json.loads(scalar(f"select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb)::text from (select * from public.{table} where {where}) t;") or '[]')

def cols(table):
    return json.loads(scalar(f"select jsonb_agg(column_name order by ordinal_position)::text from information_schema.columns where table_schema='public' and table_name='{table}' and is_generated='NEVER';") or '[]')

def pk(table):
    return json.loads(scalar(f"select coalesce(jsonb_agg(a.attname order by x.ord), '[]'::jsonb)::text from pg_constraint c join unnest(c.conkey) with ordinality as x(attnum, ord) on true join pg_attribute a on a.attrelid=c.conrelid and a.attnum=x.attnum where c.conrelid='public.{table}'::regclass and c.contype='p';") or '[]')

def sql_literal(value):
    if value is None:
        return 'NULL'
    return "'" + str(value).replace("'", "''") + "'"

all_rows = {table: rows(table, where) for table, where in tables}
all_cols = {table: cols(table) for table, _ in tables}
all_pk = {table: pk(table) for table, _ in tables}
manifest = [{'table': t, 'rows': len(all_rows[t]), 'pk': all_pk[t]} for t, _ in tables]

with out_sql.open('w') as f:
    f.write("-- Auto-generated mirror reconciliation seed.\n")
    f.write("-- Seeds only bounded source reference/configuration rows required by historical post-cutoff migrations.\n")
    f.write("\\set ON_ERROR_STOP on\nBEGIN;\nSET LOCAL statement_timeout = '15min';\nSET LOCAL lock_timeout = '30s';\nSET LOCAL session_replication_role = replica;\n\n")

    app_rows = all_rows['app_modules']
    f.write("CREATE TEMP TABLE _seed_app_modules(id uuid, name text) ON COMMIT DROP;\n")
    f.write("INSERT INTO _seed_app_modules(id,name) VALUES\n")
    f.write(',\n'.join(f"  ('{r['id']}'::uuid, {sql_literal(r['name'])})" for r in app_rows if r.get('id') and r.get('name')) + ";\n")
    f.write("UPDATE public.app_modules t SET parent_id = s.id FROM public.app_modules old JOIN _seed_app_modules s ON s.name = old.name WHERE t.parent_id = old.id AND old.id <> s.id;\n")
    f.write("UPDATE public.workflow_definitions t SET secured_module_id = s.id FROM public.app_modules old JOIN _seed_app_modules s ON s.name = old.name WHERE t.secured_module_id = old.id AND old.id <> s.id;\n")
    f.write("UPDATE public.app_modules old SET id = s.id FROM _seed_app_modules s WHERE old.name = s.name AND old.id <> s.id;\n\n")

    provider_rows = all_rows['omni_comms_provider']
    f.write("CREATE TEMP TABLE _seed_providers(id uuid, code text) ON COMMIT DROP;\n")
    f.write("INSERT INTO _seed_providers(id,code) VALUES\n")
    f.write(',\n'.join(f"  ('{r['id']}'::uuid, {sql_literal(r['code'])})" for r in provider_rows if r.get('id') and r.get('code')) + ";\n")
    f.write("UPDATE public.omni_comms_provider_account a SET provider_id = s.id FROM public.omni_comms_provider old JOIN _seed_providers s ON s.code = old.code WHERE a.provider_id = old.id AND old.id <> s.id;\n")
    f.write("UPDATE public.omni_comms_provider old SET id = s.id FROM _seed_providers s WHERE old.code = s.code AND old.id <> s.id;\n\n")

    for table, _ in tables:
        rs = all_rows[table]
        if not rs:
            continue
        usable_cols = [c for c in all_cols[table] if any(c in r for r in rs)]
        data = json.dumps(rs, separators=(',', ':'))
        f.write(f"-- {table}: {len(rs)} row(s)\n")
        f.write(f"WITH src AS (SELECT jsonb_populate_record(NULL::public.{table}, value) AS rec FROM jsonb_array_elements($json${data}$json$::jsonb))\n")
        f.write(f"INSERT INTO public.{table} (" + ', '.join(f'"{c}"' for c in usable_cols) + ") SELECT " + ', '.join(f'(rec)."{c}"' for c in usable_cols) + " FROM src\n")
        keys = all_pk[table]
        if keys:
            set_cols = [c for c in usable_cols if c not in keys]
            conflict = ', '.join(f'"{c}"' for c in keys)
            if set_cols:
                f.write(f"ON CONFLICT ({conflict}) DO UPDATE SET " + ', '.join(f'"{c}" = EXCLUDED."{c}"' for c in set_cols) + ";\n\n")
            else:
                f.write(f"ON CONFLICT ({conflict}) DO NOTHING;\n\n")
        else:
            f.write(";\n\n")

    f.write("-- Historical replay adjustment: 20260810112740 expects exactly one queued binding before switching pilot scope.\n")
    f.write("UPDATE public.omni_comms_producer_event_binding b\n")
    f.write("   SET allowed_modes = ARRAY['dry_run','shadow','queued']::text[], status = 'active',\n")
    f.write("       integration_reference = 'step2_pilot_employer_registration_application_submitted_queued',\n")
    f.write("       lifecycle_reason = 'Historical replay seed: queued state expected before Benefits pilot switch.', updated_at = now()\n")
    f.write("  FROM public.omni_comms_event_definition d\n")
    f.write(" WHERE d.id = b.event_definition_id AND b.id = '8c0f7e05-11a3-4c0a-a01c-66217c986356'::uuid\n")
    f.write("   AND d.code = 'REGISTRATION.EMPLOYER.APPLICATION_SUBMITTED';\n\nCOMMIT;\n")

out_manifest.write_text(json.dumps(manifest, indent=2))
print(out_sql)
print(out_manifest)
PY

echo "==> generated $OUT_SQL"
cat "$OUT_MANIFEST"

if [[ "$APPLY" == "1" ]]; then
  if [[ -z "$TARGET_DB_URL" ]]; then
    echo "::error::TARGET_DATABASE_URL or MIRROR_TARGET_DATABASE_URL must be set when APPLY=1" >&2
    exit 2
  fi
  case "$TARGET_DB_URL" in
    *xynceskeiiisiefqlgxo*) echo "::error::refusing to apply seed to source project" >&2; exit 2;;
  esac
  echo "==> applying reconciliation seed to target"
  retry "target seed apply" env PGCONNECT_TIMEOUT=12 psql "$TARGET_DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$OUT_SQL"
fi
