/**
 * Gate 3 — Path 2: the protected runtime-environment configuration record is
 * the single authoritative environment source for the certification posture.
 *
 * These are static, read-only assertions over the source-controlled migration
 * and registry. They execute no SQL and mutate nothing.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  OMNI_COMMS_OBJECT_REGISTRY,
  OMNI_COMMS_OBJECT_COUNT,
} from '@/platform/omni-comms/registry/objectRegistry';
import { validateOmniCommsRegistries } from '@/platform/omni-comms/registry/validateRegistries';

const root = process.cwd();
const migrationsDir = path.join(root, 'supabase/migrations');

const migrationFile = fs
  .readdirSync(migrationsDir)
  .sort()
  .reverse()
  .find((f) =>
    fs
      .readFileSync(path.join(migrationsDir, f), 'utf8')
      .includes('CREATE TABLE IF NOT EXISTS public.omni_comms_runtime_environment'),
  );

const sql = migrationFile
  ? fs.readFileSync(path.join(migrationsDir, migrationFile), 'utf8')
  : '';

// Only the posture function body introduced by this migration matters for the
// "no GUC environment source" assertions.
const postureFn = sql.slice(sql.indexOf('omni_comms_priv_certification_posture'));

describe('omni_comms_runtime_environment configuration record', () => {
  it('is created as a singleton table by a source-controlled migration', () => {
    expect(migrationFile).toBeTruthy();
    expect(sql).toContain('singleton boolean PRIMARY KEY');
    expect(sql).toContain('CHECK (singleton)');
  });

  it('permits exactly the three enumerated environment values', () => {
    expect(sql).toContain(
      "CHECK (environment IN ('unknown', 'non_production', 'production'))",
    );
  });

  it('seeds the record as unknown and never as non_production', () => {
    expect(sql).toContain("environment text NOT NULL DEFAULT 'unknown'");
    expect(sql).toMatch(/VALUES \(true, 'unknown'\)/);
    expect(sql).not.toMatch(/DEFAULT 'non_production'/);
  });

  it('records updated_at on every change', () => {
    expect(sql).toContain('updated_at timestamptz NOT NULL DEFAULT now()');
    expect(sql).toMatch(/updated_at = now\(\)/);
  });

  it('denies anonymous and authenticated roles any direct table access', () => {
    expect(sql).toContain('REVOKE ALL ON public.omni_comms_runtime_environment FROM anon;');
    expect(sql).toContain(
      'REVOKE ALL ON public.omni_comms_runtime_environment FROM authenticated;',
    );
    expect(sql).toContain('ALTER TABLE public.omni_comms_runtime_environment ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).not.toMatch(/CREATE POLICY[^;]*omni_comms_runtime_environment/);
    expect(sql).not.toMatch(/GRANT[^;]*omni_comms_runtime_environment TO (anon|authenticated)/);
  });

  it('grants direct table access to the service role only', () => {
    expect(sql).toContain(
      'GRANT SELECT, INSERT, UPDATE ON public.omni_comms_runtime_environment TO service_role;',
    );
  });
});

describe('omni_comms_priv_set_runtime_environment', () => {
  it('is a SECURITY DEFINER function with a pinned search path', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.omni_comms_priv_set_runtime_environment(p_environment text)');
    expect(sql).toMatch(/omni_comms_priv_set_runtime_environment[\s\S]*SECURITY DEFINER/);
    expect(sql).toMatch(/omni_comms_priv_set_runtime_environment[\s\S]*SET search_path TO 'pg_catalog', 'public'/);
  });

  it('rejects every value outside the permitted enumeration', () => {
    expect(sql).toContain(
      "IF v_env NOT IN ('unknown', 'non_production', 'production') THEN",
    );
    expect(sql).toContain('omni_comms: invalid runtime environment value');
  });

  it('updates exactly the singleton record', () => {
    expect(sql).toContain('ON CONFLICT (singleton) DO UPDATE');
    expect(sql).toContain(
      'DELETE FROM public.omni_comms_runtime_environment WHERE singleton IS DISTINCT FROM true;',
    );
  });

  it('is executable by the service role only', () => {
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.omni_comms_priv_set_runtime_environment(text) FROM anon;',
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.omni_comms_priv_set_runtime_environment(text) FROM authenticated;',
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.omni_comms_priv_set_runtime_environment(text) FROM PUBLIC;',
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.omni_comms_priv_set_runtime_environment(text) TO service_role;',
    );
  });

  it('creates no certification, delivery or provider state', () => {
    const setter = sql.slice(
      sql.indexOf('FUNCTION public.omni_comms_priv_set_runtime_environment'),
      sql.indexOf('ALTER FUNCTION public.omni_comms_priv_set_runtime_environment'),
    );
    for (const forbidden of [
      'certification_state',
      'certified_commit',
      'omni_comms_dispatch_job',
      'omni_comms_delivery_attempt',
      'omni_comms_provider',
      'omni_comms_message',
    ]) {
      expect(setter).not.toContain(forbidden);
    }
  });
});

describe('certification posture environment source', () => {
  it('reads the environment exclusively from the configuration record', () => {
    expect(postureFn).toContain('v_env := public.omni_comms_priv_runtime_environment();');
  });

  it('retains no GUC environment source or fallback', () => {
    expect(postureFn).not.toContain("current_setting('omni_comms.environment'");
    expect(sql).not.toContain("current_setting('omni_comms.environment'");
  });

  it('fails closed on a missing, duplicated or unreadable record', () => {
    const reader = sql.slice(
      sql.indexOf('FUNCTION public.omni_comms_priv_runtime_environment()'),
      sql.indexOf('ALTER FUNCTION public.omni_comms_priv_runtime_environment()'),
    );
    expect(reader).toContain('IF v_count <> 1 THEN');
    expect(reader).toContain("RETURN 'unknown';");
    expect(reader).toContain('EXCEPTION WHEN OTHERS THEN');
    expect(reader).toContain("v_env NOT IN ('non_production', 'production')");
  });

  it('never classifies an unrecognised environment as non_production', () => {
    expect(postureFn).toContain("IF v_env NOT IN ('production', 'non_production') THEN");
    expect(postureFn).toContain("v_env := 'unknown';");
  });

  it('keeps every other fail-closed certification condition intact', () => {
    // certification state must be exactly certified
    expect(postureFn).toContain("IF v_state NOT IN ('certified', 'pending', 'failed') THEN");
    expect(postureFn).toContain("v_state := 'pending';");
    // certified commit must be a full 40-character SHA
    expect(postureFn).toContain("v_commit ~ '^[0-9a-f]{40}$'");
    expect(postureFn).toContain("(v_state = 'certified' AND v_commit_valid)");
  });

  it('only exact non_production can satisfy the environment gate', () => {
    // the health posture RPC (unchanged) requires an exact match; assert the
    // enumeration cannot be widened from this migration.
    expect(sql).not.toMatch(/non-production|nonproduction|NON_PRODUCTION/);
  });
});

describe('registry catalogue', () => {
  it('registers the runtime-environment record as an approved object', () => {
    const entry = OMNI_COMMS_OBJECT_REGISTRY.find(
      (o) => o.name === 'omni_comms_runtime_environment',
    );
    expect(entry).toBeDefined();
    expect(entry?.writeAuthority).toBe('service_role_only');
    expect(entry?.status).toBe('AVAILABLE');
  });

  it('keeps the registry ceiling consistent and valid', () => {
    expect(OMNI_COMMS_OBJECT_COUNT).toBe(25);
    expect(validateOmniCommsRegistries().errors).toEqual([]);
  });
});
