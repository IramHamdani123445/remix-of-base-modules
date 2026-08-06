/**
 * BN Overpayments — catalogue and boundary parity (Phases B4, B5, B11).
 *
 * Guards the contract between:
 *   - the canonical 29-command catalogue,
 *   - the typed command service (one wrapper per command RPC),
 *   - the typed query service (14 query RPCs),
 *   - the effective-grant verifier and the integration harness.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BN_OVERPAYMENT_COMMANDS,
  BN_OVERPAYMENT_CANONICAL_COMMAND_COUNT,
  BN_OVERPAYMENT_ACTIONS,
  BN_OVERPAYMENT_LEGACY_ALIASES,
  getOverpaymentCommandSpec,
} from '@/types/bn/overpayments/overpaymentCommands';
import { overpaymentCommandService } from '@/services/bn/overpayments/overpaymentCommandService';
import {
  overpaymentQueryService,
  BN_OVERPAYMENT_QUERY_RPCS,
} from '@/services/bn/overpayments/overpaymentQueryService';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const COMMAND_SERVICE_SRC = read('src/services/bn/overpayments/overpaymentCommandService.ts');
const VERIFIER_SRC = read('supabase/verify/bn_overpayment_effective_grants.sql');
const HARNESS_SRC = read('supabase/tests/bn/overpayment_integration.sql');
const WORKFLOW_SRC = read('.github/workflows/bn-overpayment-integration.yml');

describe('BN Overpayments — command catalogue (B4)', () => {
  it('exposes exactly 29 canonical commands', () => {
    expect(BN_OVERPAYMENT_COMMANDS).toHaveLength(BN_OVERPAYMENT_CANONICAL_COMMAND_COUNT);
    expect(BN_OVERPAYMENT_CANONICAL_COMMAND_COUNT).toBe(29);
  });

  it('includes the four Phase B4 additions', () => {
    for (const name of [
      'BN_OVP_PLACE_APPEAL_HOLD',
      'BN_OVP_RELEASE_APPEAL_HOLD',
      'BN_OVP_SUSPEND_RECOVERY',
      'BN_OVP_RESUME_RECOVERY',
    ] as const) {
      expect(getOverpaymentCommandSpec(name), name).toBeDefined();
    }
  });

  it('command names are unique and every RPC is unique per command', () => {
    const names = BN_OVERPAYMENT_COMMANDS.map((c) => c.command);
    expect(new Set(names).size).toBe(names.length);
    const rpcs = BN_OVERPAYMENT_COMMANDS.map((c) => c.rpc);
    expect(new Set(rpcs).size).toBe(rpcs.length);
  });

  it('every command targets a versioned bn_overpayment_*_v1 RPC', () => {
    for (const c of BN_OVERPAYMENT_COMMANDS) {
      expect(c.rpc, c.command).toMatch(/^bn_overpayment_[a-z0-9_]+_v1$/);
      expect(c.rpc.endsWith('_svc_v1'), `${c.command} must not target a service adapter`).toBe(false);
    }
  });

  it('every command carries a granular action, never a broad capability alone', () => {
    for (const c of BN_OVERPAYMENT_COMMANDS) {
      expect(BN_OVERPAYMENT_ACTIONS, c.command).toContain(c.action);
      expect(c.capability.startsWith('bn_overpayments:'), c.command).toBe(true);
    }
  });

  it('every command requires an idempotency key', () => {
    for (const c of BN_OVERPAYMENT_COMMANDS) {
      expect(c.requiresIdempotencyKey, c.command).toBe(true);
    }
  });

  it('every command emits an audit event', () => {
    for (const c of BN_OVERPAYMENT_COMMANDS) {
      expect(c.auditEvent, c.command).toBeTruthy();
    }
  });

  it('maker-checker commands forbid self approval where a decision is taken', () => {
    const decisions = BN_OVERPAYMENT_COMMANDS.filter((c) => /APPROVE|REJECT|VERIFY|CONFIRM/.test(c.command));
    for (const c of decisions) {
      expect(c.requiresMakerChecker, c.command).toBe(true);
      expect(c.forbidsSelfApproval, c.command).toBe(true);
    }
  });

  it('ledger-writing commands raise a finance posting intent (outbox boundary)', () => {
    for (const c of BN_OVERPAYMENT_COMMANDS.filter((c) => c.writesLedger)) {
      expect(c.emitsFinanceIntent, c.command).toBe(true);
    }
  });

  it('legacy aliases resolve to canonical specs', () => {
    for (const [legacy, canonical] of Object.entries(BN_OVERPAYMENT_LEGACY_ALIASES)) {
      const spec = getOverpaymentCommandSpec(legacy as never);
      expect(spec, legacy).toBeDefined();
      expect(spec?.command).toBe(canonical);
    }
  });

  it('all 29 commands are marked implemented', () => {
    for (const c of BN_OVERPAYMENT_COMMANDS) {
      expect(c.implemented, c.command).toBe(true);
    }
  });
});

describe('BN Overpayments — typed service parity (B5 / B11)', () => {
  it('the command service exposes one wrapper per canonical command', () => {
    expect(Object.keys(overpaymentCommandService)).toHaveLength(29);
  });

  it('every catalogued RPC is referenced by the command service', () => {
    for (const c of BN_OVERPAYMENT_COMMANDS) {
      expect(COMMAND_SERVICE_SRC.includes(`'${c.rpc}'`), `${c.command} -> ${c.rpc}`).toBe(true);
    }
  });

  it('the query service exposes 14 secured query RPCs', () => {
    expect(BN_OVERPAYMENT_QUERY_RPCS).toHaveLength(14);
    expect(Object.keys(overpaymentQueryService)).toHaveLength(14);
  });
});

describe('BN Overpayments — certification assets (B7 / B12 / B13 / B14)', () => {
  it('the grant verifier asserts no browser table privileges and emits a PASS marker', () => {
    expect(VERIFIER_SRC).toContain("grantee IN ('anon', 'authenticated')");
    expect(VERIFIER_SRC).toContain('BN_OP_GRANTS_RESULT: PASS');
    expect(VERIFIER_SRC).toContain('BN_OP_SVC_EXPOSED_FAIL');
  });

  it('the harness rolls back while CI independently asserts zero residue', () => {
    expect(HARNESS_SRC).toContain('ROLLBACK;');
    expect(HARNESS_SRC).toContain('the only cleanup');
    expect(HARNESS_SRC).toContain('BN_OP_HARNESS_RESULT: PASS');
    expect(WORKFLOW_SRC).toContain('Fixture residue gate');
  });

  it('the harness covers the negative security matrix', () => {
    for (const code of [
      'E_ACTIONS_DISABLED',
      'E_PERMISSION_DENIED',
      'E_STALE_ROW_VERSION',
      'E_SELF_APPROVAL',
      'E_INVALID_STATE',
    ]) {
      expect(HARNESS_SRC, code).toContain(code);
    }
  });

  it('the harness proves the Model A signed-contra invariant', () => {
    expect(HARNESS_SRC).toContain('Model A signed contra invariant verified');
    expect(HARNESS_SRC).toContain('expected 1200.00');
  });

  it('the CI workflow runs on postgres:15 and enforces both PASS markers', () => {
    expect(WORKFLOW_SRC).toContain('image: postgres:15');
    expect(WORKFLOW_SRC).toContain('BN_OP_GRANTS_RESULT: PASS');
    expect(WORKFLOW_SRC).toContain('BN_OP_HARNESS_RESULT: PASS');
  });

  it('the CI workflow asserts the module stays internal pilot with actions disabled', () => {
    expect(WORKFLOW_SRC).toContain('internal_pilot:false');
  });

  it('the CI workflow refuses to run against a production-marked database', () => {
    expect(WORKFLOW_SRC).toContain('platform_environment_marker');
  });
});

describe('BN Overpayments — legacy direct mutation retired (B11)', () => {
  it('awardServicingService no longer exports setOverpaymentRecoveryPlan', () => {
    const src = read('src/services/bn/awardServicingService.ts');
    expect(src).not.toContain('export async function setOverpaymentRecoveryPlan');
    expect(src).toContain('RETIRED (Phase B5)');
  });

  it('the Overpayment surface performs no direct table access', () => {
    const src = read('src/pages/bn/servicing/OverpaymentRecovery.tsx');
    expect(src).not.toMatch(/\.from\s*\(/);
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\s*\(/);
    expect(src).toContain('overpaymentCommandService');
    expect(src).toContain('overpaymentQueryService');
  });
});
