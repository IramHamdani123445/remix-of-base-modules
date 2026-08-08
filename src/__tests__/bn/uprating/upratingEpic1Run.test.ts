/**
 * BN Uprating — Epic 1 certification suite.
 *
 * Proves run creation, immutable population snapshots, exception governance
 * and deterministic simulation are delivered inside a single governed
 * boundary, and that Epic 1 remains strictly pre-execution.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  BN_UPRATING_CANONICAL_COMMANDS,
  getUpratingCanonicalCommandSpec,
} from '@/types/bn/uprating/upratingCanonicalCommands';
import {
  BN_UPRATING_EPIC1_CANONICAL_COMMANDS,
  BN_UPRATING_RUN_BOUNDARY_RPC,
  BN_UPRATING_RUN_READ_SERVICES,
  BN_UPRATING_RUN_SUPPORTING_OPERATIONS,
  canUpratingEpic1Transition,
  formatMinor,
  isUpratingPolicyTypeSimulatable,
} from '@/types/bn/uprating/upratingRun';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const runService = read('src/services/bn/uprating/upratingRunService.ts');
const workspace = read('src/components/bn/uprating/BnUpratingRunWorkspace.tsx');
const resolveDialog = read('src/components/bn/uprating/BnUpratingResolveExceptionDialog.tsx');
const page = read('src/pages/bn/uprating/BnUpratingPage.tsx');

describe('Uprating Epic 1 — canonical alignment', () => {
  it('keeps the canonical catalogue at 17 commands', () => {
    expect(BN_UPRATING_CANONICAL_COMMANDS).toHaveLength(17);
  });

  it('marks the four Epic 1 commands as implemented alongside Epic 0, 2 and 3', () => {
    for (const command of BN_UPRATING_EPIC1_CANONICAL_COMMANDS) {
      expect(getUpratingCanonicalCommandSpec(command).implemented).toBe(true);
    }
    const implemented = BN_UPRATING_CANONICAL_COMMANDS.filter((c) => c.implemented);
    expect(implemented).toHaveLength(14);
  });

  it('keeps every post-execution command unimplemented', () => {
    for (const command of [
      'BN_UPRATING_RECONCILE_RUN',
      'BN_UPRATING_ROLLBACK_ELIGIBLE',
      'BN_UPRATING_CLOSE_RUN',
    ] as const) {
      expect(getUpratingCanonicalCommandSpec(command).implemented).toBe(false);
    }
  });

  it('requires a justification only where governance demands one', () => {
    expect(getUpratingCanonicalCommandSpec('BN_UPRATING_RESOLVE_EXCEPTION').requiresJustification).toBe(true);
    expect(getUpratingCanonicalCommandSpec('BN_UPRATING_SIMULATE').requiresJustification).toBe(false);
  });
});

describe('Uprating Epic 1 — single governed boundary', () => {
  it('routes every mutation through the run command RPC', () => {
    expect(BN_UPRATING_RUN_BOUNDARY_RPC).toBe('bn_uprating_run_command_v1');
    expect(runService).toContain("supabase.rpc('bn_uprating_run_command_v1'");
    const rpcCalls = runService.match(/supabase\.rpc\(/g) ?? [];
    expect(rpcCalls.length).toBeGreaterThan(0);
  });

  it('never reads or writes uprating run tables from the browser', () => {
    for (const source of [runService, workspace, resolveDialog]) {
      expect(source).not.toMatch(/supabase\s*\.\s*from\(/);
    }
  });

  it('exposes only governed _v1 read services', () => {
    for (const service of BN_UPRATING_RUN_READ_SERVICES) {
      expect(service.endsWith('_v1')).toBe(true);
      expect(runService).toContain(service);
    }
  });

  it('sends an idempotency key and correlation id on every command', () => {
    expect(runService).toContain('p_idempotency_key');
    expect(runService).toContain('p_correlation_id');
    expect(runService).toContain('newUpratingUuid()');
  });

  it('passes an expected row version for optimistic concurrency', () => {
    expect(runService).toContain('p_expected_row_version');
    expect(workspace).toContain('expectedRowVersion');
  });
});

describe('Uprating Epic 1 — pre-execution containment', () => {
  it('keeps the Epic 1 preparation surfaces free of execution and communication concepts', () => {
    for (const source of [runService, resolveDialog]) {
      expect(source).not.toMatch(/ROLLBACK_ELIGIBLE|sendCommunication/);
    }
    expect(resolveDialog).not.toMatch(/EXECUTE_BATCH/);
  });

  it('never touches award, entitlement or payment tables', () => {
    for (const source of [runService, workspace]) {
      expect(source).not.toMatch(/from\('bn_award|from\('bn_entitlement|from\('bn_payment/);
    }
  });

  it('states on the page that execution applies only what was approved', () => {
    expect(page).toMatch(/no amount is\s+recalculated at execution time/i);
  });
});

describe('Uprating Epic 1 — run lifecycle', () => {
  it('requires parameterisation before a population snapshot', () => {
    expect(canUpratingEpic1Transition('DRAFT', 'PARAMETERISED')).toBe(true);
    expect(canUpratingEpic1Transition('DRAFT', 'ELIGIBILITY_SNAPSHOT')).toBe(false);
    expect(canUpratingEpic1Transition('DRAFT', 'DRY_RUN')).toBe(false);
  });

  it('allows a snapshot to be rebuilt at any post-parameterisation stage', () => {
    expect(canUpratingEpic1Transition('DRY_RUN', 'ELIGIBILITY_SNAPSHOT')).toBe(true);
    expect(canUpratingEpic1Transition('EXCLUSIONS_APPLIED', 'ELIGIBILITY_SNAPSHOT')).toBe(true);
  });

  it('only reaches a dry run from a snapshotted population', () => {
    expect(canUpratingEpic1Transition('PARAMETERISED', 'DRY_RUN')).toBe(false);
    expect(canUpratingEpic1Transition('ELIGIBILITY_SNAPSHOT', 'DRY_RUN')).toBe(true);
  });

  it('delivers parameterisation as a supporting operation, not a new canonical command', () => {
    expect(BN_UPRATING_RUN_SUPPORTING_OPERATIONS).toEqual([
      'BN_UPRATING_UPDATE_RUN',
      'BN_UPRATING_PARAMETERISE_RUN',
      'BN_UPRATING_RESCHEDULE_EXECUTION',
      'BN_UPRATING_CANCEL_EXECUTION_SCHEDULE',
    ]);
    const canonical = BN_UPRATING_CANONICAL_COMMANDS.map((c) => c.command as string);
    for (const op of BN_UPRATING_RUN_SUPPORTING_OPERATIONS) {
      expect(canonical).not.toContain(op);
    }
  });
});

describe('Uprating Epic 1 — exception governance', () => {
  it('never offers a universal override in the resolution dialog', () => {
    expect(resolveDialog).toContain('allowed_resolutions');
    expect(resolveDialog).toMatch(/Only resolutions permitted for this exception type are listed/);
    expect(resolveDialog).not.toMatch(/OVERRIDE_ALL|FORCE_INCLUDE/);
  });

  it('always requires a justification before a resolution can be recorded', () => {
    expect(resolveDialog).toMatch(/justification\.trim\(\)\.length\s*>=\s*5/);
  });

  it('explains that source-owned exceptions must be corrected in the owning area', () => {
    expect(resolveDialog).toContain('requires_source_correction');
  });
});

describe('Uprating Epic 1 — deterministic simulation', () => {
  it('refuses to simulate policy methods that are not deterministic here', () => {
    expect(isUpratingPolicyTypeSimulatable('PERCENTAGE')).toBe(true);
    expect(isUpratingPolicyTypeSimulatable('TIERED')).toBe(true);
    expect(isUpratingPolicyTypeSimulatable('INDEX_FACTOR')).toBe(true);
    expect(isUpratingPolicyTypeSimulatable('FORMULA_DRIVEN')).toBe(false);
    expect(isUpratingPolicyTypeSimulatable('MANUAL_IMPORT')).toBe(false);
    expect(isUpratingPolicyTypeSimulatable(null)).toBe(false);
  });

  it('surfaces a stale simulation instead of silently reusing it', () => {
    expect(workspace).toContain("simulation_state === 'STALE'");
    expect(workspace).toMatch(/Simulation is out of date/);
  });

  it('reports an input fingerprint so simulations are reproducible', () => {
    expect(workspace).toContain('input_fingerprint');
  });

  it('formats money from minor units without floating point drift', () => {
    expect(formatMinor(123456)).toBe('XCD 1,234.56');
    expect(formatMinor(0)).toBe('XCD 0.00');
    expect(formatMinor(null)).toBe('XCD 0.00');
  });
});

describe('Uprating Epic 1 — backend-driven action availability', () => {
  it('renders actions from the governed actions service only', () => {
    expect(workspace).toContain('fetchUpratingRunActions');
    expect(workspace).toContain('actionsQuery.data?.data?.actions');
    expect(workspace).not.toMatch(/status === 'DRAFT' \? true/);
  });

  it('shows the backend reason when an action is unavailable', () => {
    expect(workspace).toContain('title={a.reason ?? undefined}');
    expect(workspace).toContain('disabled={!a.available');
  });
});

describe('Uprating Epic 1 — navigation closure', () => {
  it('exposes runs and simulation on the governed uprating route', () => {
    expect(page).toContain('BnUpratingRunWorkspace');
    expect(page).toContain('moduleCode="bn_uprating"');
    expect(page).toContain('requiredAction="view"');
  });
});
