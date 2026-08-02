/**
 * Gate 3 — protected runtime-certification record.
 *
 * The singleton `omni_comms_runtime_certification` table is the single
 * authoritative source of certification state and certified commit. There is
 * no GUC fallback. These assertions are static over the source-controlled
 * migration plus deterministic derivations over the browser posture helper.
 * They execute no SQL and mutate nothing.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  OMNI_COMMS_OBJECT_REGISTRY,
  OMNI_COMMS_OBJECT_COUNT,
} from '@/platform/omni-comms/registry/objectRegistry';
import { validateOmniCommsRegistries } from '@/platform/omni-comms/registry/validateRegistries';
import { deriveCertificationPosture } from '@/platform/omni-comms/admin/posture/omniCommsPosture';

const root = process.cwd();
const migrationsDir = path.join(root, 'supabase/migrations');

const migrationFile = fs
  .readdirSync(migrationsDir)
  .sort()
  .reverse()
  .find((f) =>
    fs
      .readFileSync(path.join(migrationsDir, f), 'utf8')
      .includes('CREATE TABLE IF NOT EXISTS public.omni_comms_runtime_certification'),
  );

const sql = migrationFile ? fs.readFileSync(path.join(migrationsDir, migrationFile), 'utf8') : '';

const readerFn = sql.slice(
  sql.indexOf('FUNCTION public.omni_comms_priv_runtime_certification()'),
  sql.indexOf('FUNCTION public.omni_comms_priv_record_runtime_certification'),
);
const setterFn = sql.slice(
  sql.indexOf('FUNCTION public.omni_comms_priv_record_runtime_certification'),
  sql.indexOf('FUNCTION public.omni_comms_priv_certification_posture'),
);
const postureFn = sql.slice(sql.indexOf('FUNCTION public.omni_comms_priv_certification_posture'));

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

describe('omni_comms_runtime_certification protected record', () => {
  it('is created as a singleton table by a source-controlled migration', () => {
    expect(migrationFile).toBeTruthy();
    expect(sql).toContain('singleton boolean PRIMARY KEY');
    expect(sql).toContain('CHECK (singleton)');
  });

  it('permits exactly the three enumerated certification states', () => {
    expect(sql).toContain(
      "CHECK (certification_state IN ('pending', 'certified', 'failed'))",
    );
  });

  it('constrains the certified commit to a full 40-character sha', () => {
    expect(sql).toContain("certified_commit ~ '^[0-9a-f]{40}$'");
  });

  it('bounds the workflow run id', () => {
    expect(sql).toContain('length(workflow_run_id) <= 200');
  });

  it('seeds the initial state as pending and uncertified', () => {
    expect(sql).toContain("certification_state text NOT NULL DEFAULT 'pending'");
    expect(sql).toContain('certified_commit text NULL');
    expect(sql).toContain('certified_at timestamptz NULL');
    expect(sql).toMatch(/VALUES \(true, 'pending'\)/);
    expect(sql).not.toMatch(/DEFAULT 'certified'/);
  });

  it('records updated_at on every change', () => {
    expect(sql).toContain('updated_at timestamptz NOT NULL DEFAULT now()');
    expect(sql).toMatch(/updated_at = now\(\)/);
  });

  it('enables and forces row level security and creates no policy', () => {
    expect(sql).toContain(
      'ALTER TABLE public.omni_comms_runtime_certification ENABLE ROW LEVEL SECURITY',
    );
    expect(sql).toContain(
      'ALTER TABLE public.omni_comms_runtime_certification FORCE ROW LEVEL SECURITY',
    );
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]*omni_comms_runtime_certification/);
  });

  it('revokes all table access from PUBLIC, anon and authenticated', () => {
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      expect(sql).toContain(
        `REVOKE ALL ON public.omni_comms_runtime_certification FROM ${role}`,
      );
    }
    expect(sql).toContain(
      'GRANT SELECT, INSERT, UPDATE ON public.omni_comms_runtime_certification TO service_role',
    );
    expect(sql).not.toMatch(
      /GRANT[^;]*ON public\.omni_comms_runtime_certification TO (anon|authenticated)/,
    );
  });
});

describe('fail-closed certification reader', () => {
  it('treats missing or duplicate rows as pending and uncertified', () => {
    expect(readerFn).toContain('v_count <> 1');
    expect(readerFn).toMatch(/'certification_state', 'pending'/);
  });

  it('treats a read error as pending and uncertified', () => {
    expect(readerFn).toContain('EXCEPTION WHEN OTHERS THEN');
  });

  it('normalises a malformed state to pending', () => {
    expect(readerFn).toContain(
      "v_state NOT IN ('pending', 'certified', 'failed')",
    );
  });

  it('nulls a malformed certified commit and cannot be effectively certified', () => {
    expect(readerFn).toContain("v_commit ~ '^[0-9a-f]{40}$'");
    expect(readerFn).toContain('v_commit := NULL');
    expect(readerFn).toContain(
      "'effective_certified', (v_state = 'certified' AND v_commit_valid AND v_run IS NOT NULL AND v_at IS NOT NULL)",
    );
  });

  it('is service-role only', () => {
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      expect(sql).toContain(
        `REVOKE ALL ON FUNCTION public.omni_comms_priv_runtime_certification() FROM ${role}`,
      );
    }
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.omni_comms_priv_runtime_certification() TO service_role',
    );
  });
});

describe('protected certification state-change operation', () => {
  it('is SECURITY DEFINER with a pinned search path', () => {
    expect(setterFn).toContain('SECURITY DEFINER');
    expect(setterFn).toContain("SET search_path TO 'pg_catalog', 'public'");
  });

  it('is executable only by service_role', () => {
    const sig = 'public.omni_comms_priv_record_runtime_certification(text, text, text, timestamptz, text)';
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM ${role}`);
    }
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO service_role`);
  });

  it('rejects malformed or incomplete records with SQLSTATE 22023', () => {
    const raises = setterFn.match(/RAISE EXCEPTION/g) ?? [];
    const codes = setterFn.match(/ERRCODE = '22023'/g) ?? [];
    expect(raises.length).toBeGreaterThanOrEqual(7);
    expect(codes.length).toBe(raises.length);
  });

  it('forbids a commit or timestamp on a pending record', () => {
    expect(setterFn).toContain(
      'pending certification must not carry a commit or timestamp',
    );
  });

  it('permits a failed record to carry an attempted sha and run id', () => {
    expect(setterFn).toContain('attempted commit must be a full 40-character sha');
    expect(setterFn).toMatch(/v_state = 'failed'/);
  });

  it('permits certified only with a full sha, run id, timestamp, revision equality and non_production', () => {
    expect(setterFn).toContain('certified commit must be a full 40-character sha');
    expect(setterFn).toContain('certified record requires a workflow run id');
    expect(setterFn).toContain('certified record requires a certification timestamp');
    expect(setterFn).toContain('v_deployed <> v_commit');
    expect(setterFn).toContain(
      "v_env IS DISTINCT FROM 'non_production'",
    );
  });

  it('never writes environment, delivery, provider, feature or legacy state', () => {
    expect(setterFn).not.toMatch(
      /(INSERT INTO|UPDATE|DELETE FROM)\s+public\.omni_comms_runtime_environment/,
    );
    expect(setterFn).not.toMatch(/dispatch_job|delivery_attempt|omni_comms_provider|omni_comms_message/);
    expect(setterFn).not.toMatch(/feature_gate|comm_hub|notification_queue|notification_logs/);
  });
});

describe('certification posture has no GUC dependency', () => {
  it('never reads the certification-state or certified-commit settings', () => {
    expect(postureFn).not.toContain('omni_comms.certification_state');
    expect(postureFn).not.toContain('omni_comms.certified_commit');
    expect(sql).not.toContain('current_setting(');
  });

  it('derives certification exclusively from the protected record', () => {
    expect(postureFn).toContain('public.omni_comms_priv_runtime_certification()');
  });

  it('leaves the environment record protections unchanged', () => {
    expect(postureFn).toContain('public.omni_comms_priv_runtime_environment()');
    expect(sql).not.toMatch(/DROP (TABLE|FUNCTION)[\s\S]*omni_comms_runtime_environment/);
    expect(sql).not.toContain('omni_comms_priv_set_runtime_environment');
  });

  it('keeps live delivery untouched', () => {
    expect(sql).not.toMatch(/omni_comms_dispatch_job|omni_comms_delivery_attempt/);
  });
});

describe('Safe Test gating over the certification record', () => {
  const base = {
    deployedRevision: SHA,
    edgeAvailable: true as boolean | null,
    environment: 'non_production' as const,
  };

  it('blocks Safe Test while certification is pending', () => {
    const p = deriveCertificationPosture({
      ...base,
      certifiedCommit: null,
      edgeCertificationState: 'pending',
    });
    expect(p.safeTestPermitted).toBe(false);
  });

  it('blocks Safe Test when certification failed', () => {
    const p = deriveCertificationPosture({
      ...base,
      certifiedCommit: SHA,
      edgeCertificationState: 'failed',
    });
    expect(p.state).toBe('failed');
    expect(p.safeTestPermitted).toBe(false);
  });

  it('blocks Safe Test when the certified sha is missing or malformed', () => {
    for (const commit of [null, '', 'abc123', SHA.slice(0, 39)]) {
      const p = deriveCertificationPosture({
        ...base,
        certifiedCommit: commit,
        edgeCertificationState: 'certified',
      });
      expect(p.safeTestPermitted).toBe(false);
    }
  });

  it('blocks Safe Test when the certified sha does not match the deployed revision', () => {
    const p = deriveCertificationPosture({
      ...base,
      certifiedCommit: OTHER_SHA,
      edgeCertificationState: 'certified',
    });
    expect(p.revision).toBe('mismatch');
    expect(p.safeTestPermitted).toBe(false);
  });

  it('blocks Safe Test outside a non-production environment', () => {
    for (const environment of ['production', 'unknown'] as const) {
      const p = deriveCertificationPosture({
        ...base,
        environment,
        certifiedCommit: SHA,
        edgeCertificationState: 'certified',
      });
      expect(p.safeTestPermitted).toBe(false);
    }
  });

  it('permits Safe Test only with certified state, exact full-sha match and non_production', () => {
    const p = deriveCertificationPosture({
      ...base,
      certifiedCommit: SHA,
      edgeCertificationState: 'certified',
    });
    expect(p.state).toBe('certified');
    expect(p.safeTestPermitted).toBe(true);
  });
});

describe('object registry', () => {
  it('registers the protected certification record as a service-role-only object', () => {
    const entry = OMNI_COMMS_OBJECT_REGISTRY.find(
      (o) => o.name === 'omni_comms_runtime_certification',
    );
    expect(entry).toBeDefined();
    expect(entry?.writeAuthority).toBe('service_role_only');
    expect(entry?.status).toBe('AVAILABLE');
  });

  it('keeps the registry valid at the new ceiling', () => {
    expect(OMNI_COMMS_OBJECT_COUNT).toBe(27);
    expect(validateOmniCommsRegistries().ok).toBe(true);
  });
});

describe('SQL verifier', () => {
  const verifier = fs.readFileSync(
    path.join(root, 'scripts/omni-comms/verify-runtime-certification.sql'),
    'utf8',
  );

  it('asserts structure, grants, fail-closed behaviour and zero delivery', () => {
    expect(verifier).toContain('OMNI COMMS RUNTIME CERTIFICATION VERIFY OK');
    expect(verifier).toContain('relrowsecurity AND relforcerowsecurity');
    expect(verifier).toContain('has_table_privilege');
    expect(verifier).toContain('has_function_privilege');
    expect(verifier).toContain('omni_comms.certification_state');
    expect(verifier).toContain('dispatch jobs and % delivery attempts exist');
  });
});
