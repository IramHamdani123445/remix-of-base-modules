/**
 * BN Mortality — governance closure reconciliation.
 *
 * After the `bn_mortality_execute_command_v2` hardening migration
 * (permission + dark-launch gate, replay protection, maker-checker with
 * self-approval prohibition, DMS evidence persistence, governed
 * cross-module handoffs and the closure gate), every command in the
 * authoritative 26-command catalogue has real backend execution.
 *
 * These assertions fail if a command is silently re-flagged as
 * unimplemented, or if the catalogue is shrunk below 26.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MORTALITY_COMMAND_CATALOG,
  MORTALITY_COMMAND_COUNT,
} from '@/types/bn/mortality/mortalityCommandCatalog';

const EDGE = readFileSync(
  resolve(process.cwd(), 'supabase/functions/bn-mortality-command/index.ts'),
  'utf8',
);

describe('BN Mortality — governance closure', () => {
  it('keeps the authoritative 26-command catalogue', () => {
    expect(MORTALITY_COMMAND_COUNT).toBe(26);
    expect(MORTALITY_COMMAND_CATALOG).toHaveLength(26);
  });

  it('every command is implemented with no outstanding blocker', () => {
    const unimplemented = MORTALITY_COMMAND_CATALOG.filter((c) => !c.implemented);
    expect(unimplemented.map((c) => c.command)).toEqual([]);
    for (const c of MORTALITY_COMMAND_CATALOG) {
      expect(c.blocker ?? null).toBeNull();
    }
  });

  it('handoff and evidence commands are still integration-bounded', () => {
    const byName = new Map(MORTALITY_COMMAND_CATALOG.map((c) => [c.command, c]));
    expect(byName.get('BN_MORTALITY_ATTACH_EVIDENCE')?.integrationRequired).toBe('dms');
    expect(byName.get('BN_MORTALITY_CREATE_PAD_OVERPAYMENT')?.integrationRequired).toBe('overpayments');
    expect(byName.get('BN_MORTALITY_INITIATE_SURVIVOR_ASSESSMENT')?.integrationRequired).toBe('survivor');
    expect(byName.get('BN_MORTALITY_INITIATE_FUNERAL_GRANT')?.integrationRequired).toBe('funeral');
    expect(byName.get('BN_MORTALITY_REFER_LEGAL')?.integrationRequired).toBe('legal');
  });

  it('adverse follow-on commands remain maker-checker controlled', () => {
    const requireChecker = [
      'BN_MORTALITY_CONFIRM_VERIFICATION',
      'BN_MORTALITY_REJECT_REPORT',
      'BN_MORTALITY_APPROVE_IMPACT',
      'BN_MORTALITY_TERMINATE_AWARD',
      'BN_MORTALITY_CREATE_PAD_OVERPAYMENT',
      'BN_MORTALITY_REFER_LEGAL',
      'BN_MORTALITY_REVERSE_CONFIRMATION',
    ];
    for (const name of requireChecker) {
      const c = MORTALITY_COMMAND_CATALOG.find((x) => x.command === name);
      expect(c, `${name} missing from catalogue`).toBeTruthy();
      expect(c!.requiresMakerChecker, `${name} must be maker-checker controlled`).toBe(true);
    }
  });

  it('the edge function executes through the governed v2 entry point only', () => {
    expect(EDGE).toContain("admin.rpc('bn_mortality_execute_command_v2'");
    expect(EDGE).not.toContain("admin.rpc('bn_mortality_execute_command',");
    expect(EDGE).toContain('p_idempotency_key: envelope.idempotencyKey');
  });
});
