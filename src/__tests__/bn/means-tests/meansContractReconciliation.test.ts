/**
 * BN Means-Test — MT0 contract reconciliation guards.
 *
 * Proves exactly one authoritative Means-Test contract exists and that
 * every legacy `BN_MT_*` command has an explicit disposition.
 */
import { describe, it, expect } from 'vitest';
import { BN_MEANS_COMMANDS, type BnMeansCommandName } from '@/types/bn/meansTests/meansCommands';
import { BN_MEANS_TEST_COMMANDS } from '@/types/bn/meansTests/meansTestCommands';
import {
  BN_MEANS_LEGACY_RECONCILIATION,
  BN_MEANS_PROHIBITED_LEGACY_COMMANDS,
  getLegacyDisposition,
} from '@/types/bn/meansTests/meansLegacyReconciliation';
import { BN_GAP_COMMAND_CAPABILITY } from '@/services/bn/commands/benefitsCapabilityRegistry';
import {
  BN_MEANS_TRANSITIONS,
  canMeansTransition,
  isFactPublishable,
} from '@/types/bn/meansTests/meansStateMachine';

describe('MT0 — authoritative Means-Test contract', () => {
  it('registers the canonical 21-command catalogue plus 33 governed supporting operations', () => {
    expect(BN_MEANS_COMMANDS).toHaveLength(54);
  });


  it('maps every canonical command to a bn_means_tests capability', () => {
    for (const spec of BN_MEANS_COMMANDS) {
      const capability = BN_GAP_COMMAND_CAPABILITY[spec.command];
      expect(capability, `${spec.command} unmapped`).toBeDefined();
      expect(capability.startsWith('bn_means_tests:')).toBe(true);
      expect(capability).toBe(spec.capability);
    }
  });

  it('classifies every legacy BN_MT_* command exactly once', () => {
    const legacy = BN_MEANS_TEST_COMMANDS.map((c) => c.command).sort();
    const classified = BN_MEANS_LEGACY_RECONCILIATION.map((e) => e.legacyCommand).sort();
    expect(classified).toEqual(legacy);
    expect(new Set(classified).size).toBe(classified.length);
  });

  it('points every alias at a real canonical command', () => {
    const canonical = new Set<BnMeansCommandName>(BN_MEANS_COMMANDS.map((c) => c.command));
    for (const entry of BN_MEANS_LEGACY_RECONCILIATION) {
      if (entry.disposition === 'ALIASED_TO_CANONICAL_COMMAND') {
        expect(entry.canonicalCommand).toBeDefined();
        expect(canonical.has(entry.canonicalCommand!)).toBe(true);
      }
      if (entry.disposition === 'REPLACED_BY_GOVERNED_HANDOFF') {
        expect(entry.handoffTargetModule).toBeTruthy();
      }
      expect(entry.rationale.length).toBeGreaterThan(10);
    }
  });

  it('never implements award creation from a Means-Test rerun', () => {
    expect(BN_MEANS_PROHIBITED_LEGACY_COMMANDS).toContain('BN_MT_CREATE_AWARD_FROM_RERUN');
    const entry = getLegacyDisposition('BN_MT_CREATE_AWARD_FROM_RERUN');
    expect(entry?.disposition).toBe('REPLACED_BY_GOVERNED_HANDOFF');
    expect(entry?.handoffTargetModule).toBe('bn_awards');
    expect(BN_MEANS_COMMANDS.some((c) => /AWARD/.test(c.command))).toBe(false);
  });
});

describe('MT0 — canonical lifecycle', () => {
  it('permits the intake path and refuses editing after submission', () => {
    expect(canMeansTransition('DRAFT', 'SUBMITTED')).toBe(true);
    expect(canMeansTransition('SUBMITTED', 'DRAFT')).toBe(false);
    expect(canMeansTransition('APPROVED', 'ACTIVE')).toBe(true);
    expect(canMeansTransition('CLOSED', 'ACTIVE')).toBe(false);
  });

  it('publishes facts only from ACTIVE or REASSESSMENT_DUE', () => {
    expect(isFactPublishable('ACTIVE')).toBe(true);
    expect(isFactPublishable('REASSESSMENT_DUE')).toBe(true);
    expect(isFactPublishable('APPROVED')).toBe(false);
    expect(isFactPublishable('SUBMITTED')).toBe(false);
  });

  it('has no orphan target states', () => {
    const known = new Set(Object.keys(BN_MEANS_TRANSITIONS));
    for (const targets of Object.values(BN_MEANS_TRANSITIONS)) {
      for (const t of targets) expect(known.has(t)).toBe(true);
    }
  });
});
