/**
 * Accelerated Build 3 — Slice 2c-ii Batch B tests.
 *
 * Batch B introduces the Edge-Function-only resolver package under
 * `supabase/functions/omni-comms-runtime/resolution/` and wires the
 * trusted Edge Function to:
 *   1. Persist the request via omni_comms_priv_send_communication.
 *   2. Load persisted resolution on replay.
 *   3. Fetch aggregate snapshot, orchestrate the pipeline, and
 *      finalize via omni_comms_priv_finalize_resolution on fresh runs.
 *
 * These tests are file-shape / boundary invariants (matching prior
 * omni-comms slices). Full end-to-end DB coverage is provided by the
 * SQL verifier scripts/omni-comms/verify-build3-slice2c-ii-resolution.sql.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const RESOLUTION_DIR = resolve(
  process.cwd(),
  'supabase/functions/omni-comms-runtime/resolution',
);
const EDGE_INDEX = resolve(
  process.cwd(),
  'supabase/functions/omni-comms-runtime/index.ts',
);
const ARCH_RULE = resolve(
  process.cwd(),
  'src/platform/omni-comms/architecture/checks/checkResolverBoundary.ts',
);

const REQUIRED_MODULES = [
  'runtimeResolutionErrors.ts',
  'resolutionTypes.ts',
  'eventResolver.ts',
  'contractValidator.ts',
  'routeResolver.ts',
  'destinationNormalization.ts',
  'recipientResolver.ts',
  'templateResolver.ts',
  'layoutResolver.ts',
  'assetResolver.ts',
  'senderResolver.ts',
  'channelEligibility.ts',
  'snapshotOrchestrator.ts',
];

describe('Slice 2c-ii Batch B — resolver package layout', () => {
  it('resolution directory exists', () => {
    expect(existsSync(RESOLUTION_DIR)).toBe(true);
  });

  it.each(REQUIRED_MODULES)('module %s is present', (name) => {
    expect(existsSync(resolve(RESOLUTION_DIR, name))).toBe(true);
  });

  it('resolution package contains only the authorised modules', () => {
    const found = readdirSync(RESOLUTION_DIR).filter((f) => f.endsWith('.ts'));
    for (const f of found) {
      expect(REQUIRED_MODULES).toContain(f);
    }
  });

  it('runtime error codes enumerate at least the required blockers', () => {
    const src = readFileSync(
      resolve(RESOLUTION_DIR, 'runtimeResolutionErrors.ts'),
      'utf8',
    );
    for (const code of [
      'resolution_snapshot_invalid',
      'event_not_found',
      'payload_schema_violation',
      'event_route_missing',
      'recipient_destination_invalid',
      'template_family_unresolved',
      'layout_unresolved',
      'asset_slot_unresolved',
      'sender_provider_binding_unresolved',
    ]) {
      expect(src).toContain(code);
    }
  });
});

describe('Slice 2c-ii Batch B — Edge Function wiring', () => {
  const src = readFileSync(EDGE_INDEX, 'utf8');

  it('imports the snapshot orchestrator', () => {
    expect(src).toMatch(/from\s+["']\.\/resolution\/snapshotOrchestrator\.ts["']/);
  });

  it('invokes the aggregate snapshot RPC', () => {
    expect(src).toContain('omni_comms_priv_runtime_resolution_snapshot');
  });

  it('invokes the finalize RPC', () => {
    expect(src).toContain('omni_comms_priv_finalize_resolution');
  });

  it('invokes the replay load RPC', () => {
    expect(src).toContain('omni_comms_priv_load_persisted_resolution');
  });

  it('still routes persistence through the SECURITY DEFINER send RPC', () => {
    expect(src).toContain('omni_comms_priv_send_communication');
  });

  it('never imports a provider SDK', () => {
    expect(src).not.toMatch(/["']resend["']|["']@resend/);
    expect(src).not.toMatch(/["']twilio["']/);
    expect(src).not.toMatch(/["']nodemailer["']/);
  });

  it('never writes provider send calls', () => {
    expect(src).not.toMatch(/\bfetch\s*\(\s*["']https?:\/\/api\.resend/);
  });
});

describe('Slice 2c-ii Batch B — architecture boundary rule', () => {
  it('OMNI_RESOLVER_RUNTIME_BOUNDARY rule file exists', () => {
    expect(existsSync(ARCH_RULE)).toBe(true);
  });

  it('rule enumerates the service_role-only RPCs it blocks', () => {
    const src = readFileSync(ARCH_RULE, 'utf8');
    expect(src).toContain('omni_comms_priv_runtime_resolution_snapshot');
    expect(src).toContain('omni_comms_priv_finalize_resolution');
    expect(src).toContain('omni_comms_priv_load_persisted_resolution');
  });

  it('no file under src/** imports the resolver package', () => {
    // Guarded by the architecture rule; also asserted structurally: the
    // path should not appear as an import target anywhere in src/.
    const grepRoot = resolve(process.cwd(), 'src');
    const stack: string[] = [grepRoot];
    let offenders: string[] = [];
    const { readdirSync: rd, statSync } = require('node:fs') as typeof import('node:fs');
    while (stack.length) {
      const dir = stack.pop()!;
      for (const entry of rd(dir)) {
        const full = `${dir}/${entry}`;
        const st = statSync(full);
        if (st.isDirectory()) stack.push(full);
        else if (/\.(ts|tsx)$/.test(entry)) {
          const c = readFileSync(full, 'utf8');
          if (/omni-comms-runtime\/resolution/.test(c) && !full.includes('__tests__') && !full.includes('architecture/checks/')) {
            offenders.push(full);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
