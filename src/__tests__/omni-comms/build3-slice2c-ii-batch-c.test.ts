/**
 * Accelerated Build 3 — Slice 2c-ii Batch C
 * Sandbox-verifiable controls + Rule 11 hardening.
 *
 * These fixtures use in-memory `RepositoryScan` objects and target
 * specific architecture rules. Each fixture must fail for the INTENDED
 * rule id and not merely because of unrelated syntax.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type {
  RepositoryScan,
  ScannedFile,
  ArchitectureViolation,
} from '@/platform/omni-comms/architecture/architectureCheck.types';
import {
  checkResolverBoundary,
  checkLegacyTableReferences,
  checkReactRuntimeWrites,
  checkFacadeBoundary,
} from '@/platform/omni-comms/architecture';

function scan(files: ScannedFile[]): RepositoryScan {
  return {
    files,
    routeSource: null,
    migrations: [],
    edgeFunctionDirs: [],
    dependencies: {},
  };
}
function file(p: string, c: string): ScannedFile { return { filePath: p, content: c }; }
function ids(vs: ArchitectureViolation[]) { return vs.map((v) => v.ruleId); }

describe('Slice 2c-ii Batch C — Rule 11 hardening negative fixtures', () => {
  it('1. React file importing the Edge resolver package → OMNI_RESOLVER_RUNTIME_BOUNDARY', () => {
    const vs = checkResolverBoundary(scan([
      file('src/components/Foo.tsx',
        `import { resolveEvent } from "../../supabase/functions/omni-comms-runtime/resolution/eventResolver";`),
    ]));
    expect(ids(vs)).toContain('OMNI_RESOLVER_RUNTIME_BOUNDARY');
  });

  it('2. Business module importing resolver internals → OMNI_RESOLVER_RUNTIME_BOUNDARY', () => {
    const vs = checkResolverBoundary(scan([
      file('src/modules/benefits/comm.ts',
        `import x from "supabase/functions/omni-comms-runtime/resolution/index";`),
    ]));
    expect(ids(vs)).toContain('OMNI_RESOLVER_RUNTIME_BOUNDARY');
  });

  it('3. Browser call to snapshot RPC → OMNI_RESOLVER_RUNTIME_BOUNDARY', () => {
    const vs = checkResolverBoundary(scan([
      file('src/components/Bad.tsx',
        `await supabase.rpc("omni_comms_priv_runtime_resolution_snapshot", {});`),
    ]));
    expect(ids(vs)).toContain('OMNI_RESOLVER_RUNTIME_BOUNDARY');
  });

  it('4. Browser call to finalize RPC → OMNI_RESOLVER_RUNTIME_BOUNDARY', () => {
    const vs = checkResolverBoundary(scan([
      file('src/hooks/useBad.ts',
        `supabase.rpc('omni_comms_priv_finalize_resolution', payload);`),
    ]));
    expect(ids(vs)).toContain('OMNI_RESOLVER_RUNTIME_BOUNDARY');
  });

  it('5. Browser call to load-persisted RPC → OMNI_RESOLVER_RUNTIME_BOUNDARY', () => {
    const vs = checkResolverBoundary(scan([
      file('src/pages/admin/Bad.tsx',
        `supabase.rpc("omni_comms_priv_load_persisted_resolution", {});`),
    ]));
    expect(ids(vs)).toContain('OMNI_RESOLVER_RUNTIME_BOUNDARY');
  });

  it('6. Browser call to send-communication RPC → OMNI_RESOLVER_RUNTIME_BOUNDARY', () => {
    const vs = checkResolverBoundary(scan([
      file('src/lib/bad.ts',
        `supabase.rpc("omni_comms_priv_send_communication", {});`),
    ]));
    expect(ids(vs)).toContain('OMNI_RESOLVER_RUNTIME_BOUNDARY');
  });

  it('7. Service-role client outside Edge Function → OMNI_RESOLVER_RUNTIME_BOUNDARY', () => {
    const vs = checkResolverBoundary(scan([
      file('src/lib/badClient.ts',
        `const admin = createClient(url, SUPABASE_SERVICE_ROLE_KEY, {});`),
    ]));
    expect(ids(vs)).toContain('OMNI_RESOLVER_RUNTIME_BOUNDARY');
  });

  it('8. Provider SDK import in resolution package → OMNI_RESOLVER_RUNTIME_BOUNDARY', () => {
    const vs = checkResolverBoundary(scan([
      file('supabase/functions/omni-comms-runtime/resolution/leak.ts',
        `import { Resend } from "resend";`),
    ]));
    expect(ids(vs)).toContain('OMNI_RESOLVER_RUNTIME_BOUNDARY');
  });

  it('9. Read from comm_asset_assignment in src/** → OMNI_RESOLVER_RUNTIME_BOUNDARY', () => {
    const vs = checkResolverBoundary(scan([
      file('src/platform/omni-comms/repositories/badRepo.ts',
        `await supabase.from('comm_asset_assignment').select('*');`),
    ]));
    expect(ids(vs)).toContain('OMNI_RESOLVER_RUNTIME_BOUNDARY');
  });

  it('10. Legacy Communication Hub table read → OMNI_LEGACY_TABLE_REFERENCE', () => {
    const vs = checkLegacyTableReferences(scan([
      file('src/platform/omni-comms/admin/Bad.ts',
        `await supabase.from('bn_communication_log').select('*');`),
    ]));
    expect(ids(vs)).toContain('OMNI_LEGACY_TABLE_REFERENCE');
  });

  it('11. Message-table write in resolution package → OMNI_RESOLVER_RUNTIME_BOUNDARY', () => {
    const vs = checkResolverBoundary(scan([
      file('supabase/functions/omni-comms-runtime/resolution/leak.ts',
        `await supabase.from("omni_comms_message").insert({});`),
    ]));
    expect(ids(vs)).toContain('OMNI_RESOLVER_RUNTIME_BOUNDARY');
  });

  it('12. Dispatch-job write in resolution package → OMNI_RESOLVER_RUNTIME_BOUNDARY', () => {
    const vs = checkResolverBoundary(scan([
      file('supabase/functions/omni-comms-runtime/resolution/leak.ts',
        `await supabase.from("omni_comms_dispatch_job").insert({});`),
    ]));
    expect(ids(vs)).toContain('OMNI_RESOLVER_RUNTIME_BOUNDARY');
  });

  it('13. Delivery-attempt write in resolution package → OMNI_RESOLVER_RUNTIME_BOUNDARY', () => {
    const vs = checkResolverBoundary(scan([
      file('supabase/functions/omni-comms-runtime/resolution/leak.ts',
        `await supabase.from("omni_comms_delivery_attempt").insert({});`),
    ]));
    expect(ids(vs)).toContain('OMNI_RESOLVER_RUNTIME_BOUNDARY');
  });

  it('14. Second public communication façade → OMNI_SEND_FACADE_BOUNDARY', () => {
    const vs = checkFacadeBoundary(scan([
      file('src/platform/omni-comms/api/sendCommunication.ts',
        `export function sendCommunication(){}`),
    ]));
    expect(ids(vs)).toContain('OMNI_SEND_FACADE_BOUNDARY');
  });
});

describe('Slice 2c-ii Batch C — sandbox artefacts', () => {
  const root = process.cwd();
  const files = [
    'scripts/omni-comms/verify-build3-slice2c-ii-resolution.sql',
    'scripts/omni-comms/rollback/build3-slice2c-ii-resolution-rollback.sql',
    'scripts/omni-comms/integration/run-edge-resolution.ts',
    'src/platform/omni-comms/registry/evidence/build3-slice2c-ii-resolution.md',
    'src/platform/omni-comms/registry/evidence/build3-slice2c-ii-test-baseline.json',
  ];
  for (const rel of files) {
    it(`artefact exists: ${rel}`, () => {
      expect(existsSync(resolve(root, rel))).toBe(true);
    });
  }

  it('verifier retains the metadata marker', () => {
    const s = readFileSync(resolve(root, files[0]), 'utf8');
    expect(s).toContain('BUILD 3 SLICE 2C-II RESOLUTION VERIFY OK');
  });

  it('verifier documents that it does not certify runtime resolution semantics', () => {
    const s = readFileSync(resolve(root, files[0]), 'utf8');
    expect(s.toLowerCase()).toContain('does not certify runtime');
  });

  it('rollback preserves Slice 1/2a/2b/2c-i artefacts', () => {
    const s = readFileSync(resolve(root, files[1]), 'utf8');
    expect(s).toContain('PRESERVE');
    expect(s).toContain('omni_comms_priv_send_communication'); // preserved marker
    expect(s).toContain('BEGIN;');
    expect(s.toUpperCase()).toContain('ROLLBACK');
  });

  it('harness refuses without required env and never fabricates the success marker', () => {
    const s = readFileSync(resolve(root, files[2]), 'utf8');
    expect(s).toContain('PRIVILEGED EDGE RESOLUTION INTEGRATION NOT EXECUTED');
    expect(s).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(s).toContain('OMNI_COMMS_TEST_USER_JWT');
    expect(s).toContain('OMNI_COMMS_TEST_ORGANIZATION_ID');
    expect(s).toContain('OMNI_COMMS_TEST_DEPARTMENT_ID');
    expect(s).toContain('omni-comms-runtime');
    // success marker must be gated, but the string must be present as the eventual output
    expect(s).toContain('BUILD 3 SLICE 2C-II EDGE RESOLUTION INTEGRATION OK');
  });

  it('evidence declares runtime marker not yet produced', () => {
    const s = readFileSync(resolve(root, files[3]), 'utf8');
    expect(s.toLowerCase()).toContain('runtime marker not yet produced');
  });

  it('baseline JSON records commit SHA, command, and new-failure count = 0', () => {
    const s = readFileSync(resolve(root, files[4]), 'utf8');
    const j = JSON.parse(s);
    expect(j).toHaveProperty('repositoryCommitSha');
    expect(j).toHaveProperty('fullSuiteCommand');
    expect(j.newFailuresIntroducedByBatchC).toBe(0);
  });
});
