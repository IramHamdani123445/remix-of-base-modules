#!/usr/bin/env python3
"""
Generate the canonical, version-controlled CI schema baseline.

Reads the canonical database (via the standard PG* environment variables)
and emits a deterministic, data-free, ownership-free schema script to
supabase/baseline/schema.sql plus supabase/baseline/baseline_manifest.json.

This is NOT pg_dump: it reads the system catalogues and emits DDL in a
fixed dependency order so the output is stable across runs (everything is
ordered by name, never by OID).

Excluded by construction:
  * all table data
  * secrets and vault contents
  * OWNER TO / ALTER ... OWNER statements
  * environment-specific role passwords or settings
  * Supabase-managed schemas (auth, storage, realtime, vault,
    supabase_functions, extensions, cron, pgmq, graphql*) which the shared
    bootstrap provides instead

Usage:
    PGHOST=... PGUSER=... python3 scripts/ci/generate-baseline.py [--cutoff <migration filename>]

The cutoff defaults to the newest file in supabase/migrations, i.e. the
baseline represents the database as of that migration inclusive. CI then
applies only migrations strictly AFTER the cutoff.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASELINE_DIR = ROOT / "supabase" / "baseline"
MIGRATIONS_DIR = ROOT / "supabase" / "migrations"

# Schemas owned by the platform bootstrap, never by the baseline.
PLATFORM_SCHEMAS = {
    "auth", "storage", "realtime", "vault", "supabase_functions",
    "extensions", "graphql", "graphql_public", "cron", "pgmq", "pgbouncer",
    "net", "information_schema", "pg_catalog", "pg_toast", "public_stub",
}
APP_ROLES = ("anon", "authenticated", "service_role", "PUBLIC")


def q(sql: str) -> list[list[str]]:
    """Run a query and return rows of columns split on the RS/US separators."""
    out = subprocess.run(
        ["psql", "-X", "-At", "-F", "\x1f", "-R", "\x1e", "-c", sql],
        capture_output=True, text=True, check=True,
    ).stdout
    rows = []
    for rec in out.split("\x1e"):
        rec = rec.strip("\n")
        if not rec:
            continue
        rows.append(rec.split("\x1f"))
    return rows


def app_schemas() -> list[str]:
    rows = q(
        "SELECT nspname FROM pg_namespace "
        "WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' "
        "ORDER BY nspname"
    )
    return [r[0] for r in rows if r[0] not in PLATFORM_SCHEMAS]


def schema_filter(col: str, schemas: list[str]) -> str:
    lst = ", ".join("'" + s + "'" for s in schemas)
    return f"{col} IN ({lst})"


def section(title: str) -> str:
    return f"\n-- {'=' * 72}\n-- {title}\n-- {'=' * 72}\n"


def gen_schemas(schemas):
    yield section("SCHEMAS")
    for s in schemas:
        if s != "public":
            yield f"CREATE SCHEMA IF NOT EXISTS {s};\n"


def gen_types(schemas):
    yield section("ENUM TYPES")
    rows = q(f"""
      SELECT n.nspname, t.typname,
             string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder)
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE {schema_filter('n.nspname', schemas)}
      GROUP BY 1, 2 ORDER BY 1, 2
    """)
    for ns, name, labels in rows:
        yield (f"DO $do$ BEGIN CREATE TYPE {ns}.{name} AS ENUM ({labels});\n"
               f"EXCEPTION WHEN duplicate_object THEN NULL; END $do$;\n")

    yield section("DOMAINS")
    rows = q(f"""
      SELECT n.nspname, t.typname, format_type(t.typbasetype, t.typtypmod),
             COALESCE(t.typnotnull::text, 'false'),
             COALESCE(pg_get_expr(t.typdefaultbin, 0), ''),
             COALESCE((SELECT string_agg(pg_get_constraintdef(c.oid), ' ' ORDER BY c.conname)
                       FROM pg_constraint c WHERE c.contypid = t.oid), '')
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typtype = 'd' AND {schema_filter('n.nspname', schemas)}
      ORDER BY 1, 2
    """)
    for ns, name, base, notnull, default, checks in rows:
        stmt = f"CREATE DOMAIN {ns}.{name} AS {base}"
        if default:
            stmt += f" DEFAULT {default}"
        if notnull == "true":
            stmt += " NOT NULL"
        if checks:
            stmt += " " + checks
        yield (f"DO $do$ BEGIN {stmt};\n"
               f"EXCEPTION WHEN duplicate_object THEN NULL; END $do$;\n")

    yield section("COMPOSITE TYPES")
    rows = q(f"""
      SELECT n.nspname, t.typname,
             string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod),
                        ', ' ORDER BY a.attnum)
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_class c ON c.oid = t.typrelid AND c.relkind = 'c'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE {schema_filter('n.nspname', schemas)}
      GROUP BY 1, 2 ORDER BY 1, 2
    """)
    for ns, name, cols in rows:
        yield (f"DO $do$ BEGIN CREATE TYPE {ns}.{name} AS ({cols});\n"
               f"EXCEPTION WHEN duplicate_object THEN NULL; END $do$;\n")


def gen_sequences(schemas):
    yield section("SEQUENCES")
    rows = q(f"""
      SELECT s.schemaname, s.sequencename, s.data_type::text,
             s.start_value::text, s.increment_by::text,
             s.min_value::text, s.max_value::text, s.cache_size::text,
             s.cycle::text
      FROM pg_sequences s
      WHERE {schema_filter('s.schemaname', schemas)}
      ORDER BY 1, 2
    """)
    for ns, name, dtype, start, inc, mn, mx, cache, cyc in rows:
        owned = q(f"""
          SELECT 1 FROM pg_depend d
          JOIN pg_class c ON c.oid = d.objid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE d.deptype = 'a' AND c.relname = '{name}' AND n.nspname = '{ns}'
        """)
        if owned:
            continue  # identity / serial sequences come with their table
        yield (f"CREATE SEQUENCE IF NOT EXISTS {ns}.{name} AS {dtype} "
               f"START WITH {start} INCREMENT BY {inc} MINVALUE {mn} "
               f"MAXVALUE {mx} CACHE {cache}"
               f"{' CYCLE' if cyc == 't' else ''};\n")


def gen_tables(schemas):
    yield section("TABLES (columns only; defaults, constraints and indexes follow)")
    tables = q(f"""
      SELECT n.nspname, c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p') AND {schema_filter('n.nspname', schemas)}
      ORDER BY 1, 2
    """)
    for ns, name in tables:
        cols = q(f"""
          SELECT a.attname,
                 format_type(a.atttypid, a.atttypmod),
                 a.attnotnull::text,
                 COALESCE(a.attidentity, ''),
                 COALESCE(a.attgenerated, ''),
                 COALESCE(pg_get_expr(ad.adbin, ad.adrelid), '')
          FROM pg_attribute a
          LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
          WHERE a.attrelid = '{ns}.{quote_ident(name)}'::regclass
            AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY a.attnum
        """)
        parts = []
        for cname, ctype, notnull, identity, generated, default in cols:
            piece = f"  {quote_ident(cname)} {ctype}"
            if identity:
                kind = "ALWAYS" if identity == "a" else "BY DEFAULT"
                piece += f" GENERATED {kind} AS IDENTITY"
            elif generated == "s" and default:
                piece += f" GENERATED ALWAYS AS ({default}) STORED"
            if notnull == "true":
                piece += " NOT NULL"
            parts.append(piece)
        yield (f"CREATE TABLE IF NOT EXISTS {ns}.{quote_ident(name)} (\n"
               + ",\n".join(parts) + "\n);\n")


def quote_ident(name: str) -> str:
    if name.isidentifier() and name.islower() and not name[0].isdigit():
        return name
    return '"' + name.replace('"', '""') + '"'


def gen_functions(schemas):
    yield section("FUNCTIONS AND PROCEDURES")
    rows = q(f"""
      SELECT p.oid::text, n.nspname, p.proname,
             pg_get_function_identity_arguments(p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE {schema_filter('n.nspname', schemas)}
        AND p.prokind IN ('f', 'p', 'a', 'w')
      ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
    """)
    for oid, ns, name, args in rows:
        defn = q(f"SELECT pg_get_functiondef({oid})")
        if not defn:
            continue
        body = defn[0][0]
        yield body.rstrip().rstrip(";") + ";\n"


def gen_defaults(schemas):
    yield section("COLUMN DEFAULTS (after functions so function defaults resolve)")
    rows = q(f"""
      SELECT n.nspname, c.relname, a.attname, pg_get_expr(ad.adbin, ad.adrelid)
      FROM pg_attrdef ad
      JOIN pg_class c ON c.oid = ad.adrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ad.adnum
      WHERE c.relkind IN ('r', 'p') AND a.attgenerated = ''
        AND a.attidentity = ''
        AND {schema_filter('n.nspname', schemas)}
      ORDER BY 1, 2, 3
    """)
    for ns, tbl, col, expr in rows:
        yield (f"ALTER TABLE {ns}.{quote_ident(tbl)} "
               f"ALTER COLUMN {quote_ident(col)} SET DEFAULT {expr};\n")


def gen_constraints(schemas):
    for label, kinds in (("PRIMARY KEY / UNIQUE / EXCLUDE / CHECK CONSTRAINTS", "'p','u','x','c'"),
                         ("FOREIGN KEY CONSTRAINTS", "'f'")):
        yield section(label)
        rows = q(f"""
          SELECT n.nspname, c.relname, con.conname, pg_get_constraintdef(con.oid)
          FROM pg_constraint con
          JOIN pg_class c ON c.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE con.contype IN ({kinds})
            AND {schema_filter('n.nspname', schemas)}
          ORDER BY 1, 2, 3
        """)
        for ns, tbl, con, defn in rows:
            yield (f"DO $do$ BEGIN ALTER TABLE {ns}.{quote_ident(tbl)} "
                   f"ADD CONSTRAINT {quote_ident(con)} {defn};\n"
                   f"EXCEPTION WHEN duplicate_object THEN NULL "
                   f"WHEN duplicate_table THEN NULL; END $do$;\n")


def gen_indexes(schemas):
    yield section("INDEXES (excluding constraint-backed indexes)")
    rows = q(f"""
      SELECT i.schemaname, i.indexname, i.indexdef
      FROM pg_indexes i
      WHERE {schema_filter('i.schemaname', schemas)}
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint con
          JOIN pg_class ic ON ic.oid = con.conindid
          JOIN pg_namespace n ON n.oid = ic.relnamespace
          WHERE ic.relname = i.indexname AND n.nspname = i.schemaname)
      ORDER BY 1, 2
    """)
    for ns, name, defn in rows:
        defn = defn.replace("CREATE INDEX ", "CREATE INDEX IF NOT EXISTS ", 1)
        defn = defn.replace("CREATE UNIQUE INDEX ", "CREATE UNIQUE INDEX IF NOT EXISTS ", 1)
        yield defn.rstrip(";") + ";\n"


def gen_views(schemas):
    yield section("VIEWS AND MATERIALIZED VIEWS (dependency ordered)")
    rows = q(f"""
      SELECT c.oid::text, n.nspname, c.relname, c.relkind
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('v', 'm') AND {schema_filter('n.nspname', schemas)}
      ORDER BY n.nspname, c.relname
    """)
    # Topologically order by view-on-view dependencies, tie-broken by name.
    deps = {}
    for oid, ns, name, kind in rows:
        d = q(f"""
          SELECT DISTINCT dc.oid::text
          FROM pg_depend dep
          JOIN pg_rewrite r ON r.oid = dep.objid
          JOIN pg_class dc ON dc.oid = dep.refobjid
          WHERE r.ev_class = {oid} AND dc.relkind IN ('v', 'm')
            AND dc.oid <> {oid}
        """)
        deps[oid] = {x[0] for x in d}
    emitted, pending = set(), list(rows)
    guard = 0
    while pending and guard < 50:
        guard += 1
        progressed = False
        rest = []
        for oid, ns, name, kind in pending:
            if deps[oid] - emitted - {oid}:
                rest.append((oid, ns, name, kind))
                continue
            defn = q(f"SELECT pg_get_viewdef({oid}, true)")[0][0]
            word = "MATERIALIZED VIEW" if kind == "m" else "VIEW"
            prefix = "CREATE MATERIALIZED VIEW IF NOT EXISTS" if kind == "m" else "CREATE OR REPLACE VIEW"
            yield f"{prefix} {ns}.{quote_ident(name)} AS\n{defn.rstrip().rstrip(';')};\n"
            emitted.add(oid)
            progressed = True
        pending = rest
        if not progressed:
            break
    for oid, ns, name, kind in pending:  # cyclic / unresolved: emit last
        defn = q(f"SELECT pg_get_viewdef({oid}, true)")[0][0]
        prefix = "CREATE MATERIALIZED VIEW IF NOT EXISTS" if kind == "m" else "CREATE OR REPLACE VIEW"
        yield f"{prefix} {ns}.{quote_ident(name)} AS\n{defn.rstrip().rstrip(';')};\n"


def gen_triggers(schemas):
    yield section("TRIGGERS")
    rows = q(f"""
      SELECT n.nspname, c.relname, t.tgname, pg_get_triggerdef(t.oid)
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND {schema_filter('n.nspname', schemas)}
      ORDER BY 1, 2, 3
    """)
    for ns, tbl, name, defn in rows:
        yield (f"DROP TRIGGER IF EXISTS {quote_ident(name)} ON {ns}.{quote_ident(tbl)};\n"
               f"{defn.rstrip(';')};\n")


def gen_rls(schemas):
    yield section("ROW LEVEL SECURITY")
    rows = q(f"""
      SELECT n.nspname, c.relname, c.relrowsecurity::text, c.relforcerowsecurity::text
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p') AND {schema_filter('n.nspname', schemas)}
      ORDER BY 1, 2
    """)
    for ns, tbl, rls, force in rows:
        verb = "ENABLE" if rls == "true" else "DISABLE"
        yield f"ALTER TABLE {ns}.{quote_ident(tbl)} {verb} ROW LEVEL SECURITY;\n"
        if force == "true":
            yield f"ALTER TABLE {ns}.{quote_ident(tbl)} FORCE ROW LEVEL SECURITY;\n"

    yield section("ROW LEVEL SECURITY POLICIES")
    rows = q(f"""
      SELECT schemaname, tablename, policyname, permissive, roles::text,
             cmd, COALESCE(qual, ''), COALESCE(with_check, '')
      FROM pg_policies
      WHERE {schema_filter('schemaname', schemas)}
      ORDER BY schemaname, tablename, policyname
    """)
    for ns, tbl, pol, perm, roles, cmd, qual, check in rows:
        roles_sql = roles.strip("{}").replace(",", ", ") or "public"
        stmt = (f"CREATE POLICY {quote_ident(pol)} ON {ns}.{quote_ident(tbl)} "
                f"AS {perm.upper()} FOR {cmd} TO {roles_sql}")
        if qual:
            stmt += f" USING ({qual})"
        if check:
            stmt += f" WITH CHECK ({check})"
        yield (f"DO $do$ BEGIN {stmt};\n"
               f"EXCEPTION WHEN duplicate_object THEN NULL; END $do$;\n")


def gen_grants(schemas):
    yield section("SCHEMA / TABLE / SEQUENCE / FUNCTION PRIVILEGES")
    for s in schemas:
        yield f"GRANT USAGE ON SCHEMA {s} TO anon, authenticated, service_role;\n"

    role_list = ", ".join("'" + r + "'" for r in APP_ROLES if r != "PUBLIC")
    rows = q(f"""
      SELECT n.nspname, c.relname,
             CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                  ELSE pg_get_userbyid(a.grantee) END AS grantee,
             a.privilege_type
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S')
        AND {schema_filter('n.nspname', schemas)}
        AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ({role_list}))
      ORDER BY 1, 2, 3, 4
    """)
    for ns, rel, grantee, priv in rows:
        yield f"GRANT {priv} ON {ns}.{quote_ident(rel)} TO {grantee};\n"

    rows = q(f"""
      SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
             CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                  ELSE pg_get_userbyid(a.grantee) END AS grantee,
             a.privilege_type
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
      WHERE {schema_filter('n.nspname', schemas)}
        AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ({role_list}))
      ORDER BY 1, 2, 3, 4, 5
    """)
    yield "\n-- Function privileges are reset first so REVOKEd defaults are reproduced.\n"
    fns = q(f"""
      SELECT DISTINCT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE {schema_filter('n.nspname', schemas)} AND p.prokind = 'f'
      ORDER BY 1, 2, 3
    """)
    for ns, name, args in fns:
        yield f"REVOKE ALL ON FUNCTION {ns}.{quote_ident(name)}({args}) FROM PUBLIC, anon, authenticated, service_role;\n"
    for ns, name, args, grantee, priv in rows:
        yield f"GRANT {priv} ON FUNCTION {ns}.{quote_ident(name)}({args}) TO {grantee};\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cutoff", default=None)
    ap.add_argument("--out", default=str(BASELINE_DIR / "schema.sql"))
    args = ap.parse_args()

    migrations = sorted(p.name for p in MIGRATIONS_DIR.glob("*.sql"))
    cutoff = args.cutoff or (migrations[-1] if migrations else "")

    schemas = app_schemas()
    print(f"app schemas: {schemas}", file=sys.stderr)

    chunks: list[str] = [
        "-- CANONICAL CI SCHEMA BASELINE — GENERATED FILE, DO NOT EDIT BY HAND.\n"
        "-- Regenerate with: python3 scripts/ci/generate-baseline.py\n"
        f"-- Migration cutoff (inclusive): {cutoff}\n"
        "-- Contains no data, no secrets and no ownership statements.\n"
        "SET check_function_bodies = off;\n"
        "SET client_min_messages = warning;\n",
    ]
    for gen in (gen_schemas, gen_types, gen_sequences, gen_tables, gen_functions,
                gen_defaults, gen_constraints, gen_indexes, gen_views,
                gen_triggers, gen_rls, gen_grants):
        chunks.extend(gen(schemas))

    body = "".join(chunks)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(body)

    manifest = {
        "generator": "scripts/ci/generate-baseline.py",
        "generated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "migration_cutoff_inclusive": cutoff,
        "migrations_contained": len(migrations),
        "schemas": schemas,
        "schema_sql_sha256": hashlib.sha256(body.encode()).hexdigest(),
        "schema_sql_bytes": len(body.encode()),
        "contains_data": False,
        "contains_secrets": False,
        "contains_ownership": False,
    }
    (out.parent / "baseline_manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
