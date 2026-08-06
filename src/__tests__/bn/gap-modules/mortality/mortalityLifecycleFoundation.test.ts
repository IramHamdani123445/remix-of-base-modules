/**
 * Slice 1 — Mortality lifecycle foundation tests.
 *
 * Proves:
 *  - Canonical 15-command → capability map completeness
 *  - Command specs enforce maker-checker + transactional + justification
 *    where the epic requires it
 *  - State-machine reachability (canonical path reaches CLOSED)
 *  - Terminal states have no outbound transitions
 *  - Legacy status mapping is total
 *  - Impact analyser correctly derives holds, terminations, PAD payments,
 *    recoverable amounts, survivor / funeral / estate opportunities
 */
import { describe, it, expect } from 'vitest';

import {
  BN_MORTALITY_COMMANDS,
  getMortalityCommandSpec,
  type BnMortalityCommandName,
} from '@/types/bn/mortality/mortalityCommands';
import {
  BN_MORTALITY_TERMINAL_STATES,
  BN_MORTALITY_TRANSITIONS,
  canMortalityTransition,
  isMortalityTerminal,
  mapLegacyMortalityStatus,
  reachableMortalityStates,
  type BnMortalityStatus,
} from '@/types/bn/mortality/mortalityStateMachine';
import {
  BN_GAP_COMMAND_CAPABILITY,
  requiredCapabilityFor,
} from '@/services/bn/commands/benefitsCapabilityRegistry';
import {
  analyseMortalityImpact,
  daysBetween,
  type ScheduledPaymentSnapshot,
} from '@/services/bn/mortality/mortalityImpactAnalyzer';

/**
 * Slice-1 legacy subset. These 15 commands were the original mortality
 * catalogue; BN-MORT-2A extended the authoritative catalogue to 26
 * (see docs/bn/mortality/MORTALITY_COMMAND_TRANSITION_MATRIX.md).
 * They must all still be registered — but they are a subset, not the total.
 */
const SLICE1_COMMANDS: readonly BnMortalityCommandName[] = [
  'BN_MORTALITY_REGISTER_REPORT',
  'BN_MORTALITY_ATTACH_EVIDENCE',
  'BN_MORTALITY_SUBMIT_FOR_VERIFICATION',
  'BN_MORTALITY_PLACE_PROVISIONAL_HOLD',
  'BN_MORTALITY_CONFIRM_VERIFICATION',
  'BN_MORTALITY_REJECT_REPORT',
  'BN_MORTALITY_RECORD_CONFLICT',
  'BN_MORTALITY_APPROVE_IMPACT',
  'BN_MORTALITY_TERMINATE_AWARD',
  'BN_MORTALITY_CREATE_PAD_OVERPAYMENT',
  'BN_MORTALITY_INITIATE_SURVIVOR_ASSESSMENT',
  'BN_MORTALITY_INITIATE_FUNERAL_GRANT',
  'BN_MORTALITY_REFER_LEGAL',
  'BN_MORTALITY_REVERSE_CONFIRMATION',
  'BN_MORTALITY_CLOSE_EVENT',
];

describe('BN Mortality — command catalogue', () => {
  it('registers the authoritative 26-command catalogue', () => {
    expect(BN_MORTALITY_COMMANDS).toHaveLength(MORTALITY_COMMAND_COUNT);
    expect(MORTALITY_COMMAND_COUNT).toBe(26);
    expect(BN_MORTALITY_COMMANDS.map((c) => c.command).sort()).toEqual(
      MORTALITY_COMMAND_CATALOG.map((c) => c.command).sort(),
    );
  });

  it('still registers every slice-1 canonical command', () => {
    const names = new Set(BN_MORTALITY_COMMANDS.map((c) => c.command));
    for (const c of SLICE1_COMMANDS) {
      expect(names.has(c), `slice-1 command ${c} is missing`).toBe(true);
    }
  });


  it('maps every command to a capability in the registry', () => {
    for (const c of BN_MORTALITY_COMMANDS) {
      expect(BN_GAP_COMMAND_CAPABILITY[c.command]).toBe(c.capability);
      expect(requiredCapabilityFor(c.command)).toBe(c.capability);
    }
  });

  it('requires maker-checker for verification, approval, termination, PAD, legal, reverse', () => {
    const mc = new Set(
      BN_MORTALITY_COMMANDS.filter((c) => c.requiresMakerChecker).map(
        (c) => c.command,
      ),
    );
    expect(mc.has('BN_MORTALITY_CONFIRM_VERIFICATION')).toBe(true);
    expect(mc.has('BN_MORTALITY_APPROVE_IMPACT')).toBe(true);
    expect(mc.has('BN_MORTALITY_TERMINATE_AWARD')).toBe(true);
    expect(mc.has('BN_MORTALITY_CREATE_PAD_OVERPAYMENT')).toBe(true);
    expect(mc.has('BN_MORTALITY_REFER_LEGAL')).toBe(true);
    expect(mc.has('BN_MORTALITY_REVERSE_CONFIRMATION')).toBe(true);
    expect(mc.has('BN_MORTALITY_REGISTER_REPORT')).toBe(false);
  });

  it('marks transactional commands correctly', () => {
    const tx = new Set(
      BN_MORTALITY_COMMANDS.filter((c) => c.transactional).map((c) => c.command),
    );
    expect(tx.has('BN_MORTALITY_PLACE_PROVISIONAL_HOLD')).toBe(true);
    expect(tx.has('BN_MORTALITY_CONFIRM_VERIFICATION')).toBe(true);
    expect(tx.has('BN_MORTALITY_APPROVE_IMPACT')).toBe(true);
    expect(tx.has('BN_MORTALITY_TERMINATE_AWARD')).toBe(true);
    expect(tx.has('BN_MORTALITY_CREATE_PAD_OVERPAYMENT')).toBe(true);
    expect(tx.has('BN_MORTALITY_REVERSE_CONFIRMATION')).toBe(true);
  });

  it('getMortalityCommandSpec throws for unknown commands', () => {
    expect(() =>
      getMortalityCommandSpec('BN_MORTALITY_NONE' as BnMortalityCommandName),
    ).toThrow();
  });
});

describe('BN Mortality — state machine', () => {
  it('canonical happy path reaches CLOSED', () => {
    const path: BnMortalityStatus[] = [
      'DRAFT',
      'REPORTED',
      'MATCHED',
      'VERIFICATION_PENDING',
      'PROVISIONALLY_HELD',
      'VERIFIED',
      'IMPACT_REVIEW',
      'APPROVAL_PENDING',
      'CONFIRMED',
      'FOLLOW_ON_PROCESSING',
      'COMPLETED',
      'CLOSED',
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canMortalityTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it('every canonical primary state is reachable from DRAFT', () => {
    const reachable = new Set(reachableMortalityStates('DRAFT'));
    for (const s of [
      'REPORTED',
      'MATCHED',
      'VERIFICATION_PENDING',
      'PROVISIONALLY_HELD',
      'VERIFIED',
      'IMPACT_REVIEW',
      'APPROVAL_PENDING',
      'CONFIRMED',
      'FOLLOW_ON_PROCESSING',
      'COMPLETED',
      'CLOSED',
      'DUPLICATE',
      'REJECTED',
      'CONFLICT',
      'CANCELLED',
      'REVERSED',
    ] as BnMortalityStatus[]) {
      expect(reachable.has(s), `${s} unreachable`).toBe(true);
    }
  });

  it('terminal states have no outbound transitions', () => {
    for (const s of BN_MORTALITY_TERMINAL_STATES) {
      expect(BN_MORTALITY_TRANSITIONS[s]).toEqual([]);
      expect(isMortalityTerminal(s)).toBe(true);
    }
  });

  it('forbidden shortcuts are rejected', () => {
    expect(canMortalityTransition('REPORTED', 'CONFIRMED')).toBe(false);
    expect(canMortalityTransition('DRAFT', 'CLOSED')).toBe(false);
    expect(canMortalityTransition('VERIFIED', 'CLOSED')).toBe(false);
  });

  it('legacy status mapping is total', () => {
    expect(mapLegacyMortalityStatus('PENDING_VERIFICATION')).toBe(
      'VERIFICATION_PENDING',
    );
    expect(mapLegacyMortalityStatus('AWARDS_HELD')).toBe('PROVISIONALLY_HELD');
    expect(mapLegacyMortalityStatus('AWARDS_TERMINATED')).toBe(
      'FOLLOW_ON_PROCESSING',
    );
    expect(mapLegacyMortalityStatus('DISPUTED')).toBe('CONFLICT');
    expect(mapLegacyMortalityStatus('CLOSED')).toBe('CLOSED');
  });
});

describe('BN Mortality — impact analyser', () => {
  const dod = '2026-06-15';

  const activeAward = {
    awardId: 'AW-1',
    productCode: 'OAP',
    status: 'ACTIVE' as const,
    effectiveTo: null,
    survivorEligible: true,
    jointlyPayable: false,
  };
  const jointAward = {
    awardId: 'AW-2',
    productCode: 'SPOUSE',
    status: 'ACTIVE' as const,
    effectiveTo: null,
    survivorEligible: false,
    jointlyPayable: true,
  };
  const suspendedAward = {
    awardId: 'AW-3',
    productCode: 'INV',
    status: 'SUSPENDED' as const,
    effectiveTo: null,
    survivorEligible: false,
    jointlyPayable: false,
  };

  const pmt = (
    id: string,
    scheduledOn: string,
    periodEnd: string,
    amountMinor: number,
    issued: boolean,
    awardId = 'AW-1',
  ): ScheduledPaymentSnapshot => ({
    instructionId: id,
    awardId,
    periodStart: '2026-06-01',
    periodEnd,
    scheduledOn,
    amountMinor,
    currency: 'XCD',
    issued,
  });

  it('classifies active and suspended awards', () => {
    const r = analyseMortalityImpact({
      personRef: 'P-1',
      dateOfDeath: dod,
      awards: [activeAward, suspendedAward],
      payments: [],
    });
    expect(r.activeAwardIds).toEqual(['AW-1']);
    expect(r.suspendedAwardIds).toEqual(['AW-3']);
    expect(r.awardsToHold).toEqual(['AW-1']);
    expect(r.awardsToTerminate).toEqual(['AW-1']);
  });

  it('defers termination for jointly payable awards', () => {
    const r = analyseMortalityImpact({
      personRef: 'P-1',
      dateOfDeath: dod,
      awards: [activeAward, jointAward],
      payments: [],
    });
    expect(r.awardsToHold).toEqual(['AW-1', 'AW-2']);
    expect(r.awardsToTerminate).toEqual(['AW-1']);
  });

  it('splits payments into stop / issued-after-death / covers-after-death buckets', () => {
    const r = analyseMortalityImpact({
      personRef: 'P-1',
      dateOfDeath: dod,
      gracePeriodDays: 0,
      awards: [activeAward],
      payments: [
        pmt('P-A', '2026-06-01', '2026-06-14', 50000, true),      // pre-death, issued
        pmt('P-B', '2026-06-20', '2026-06-30', 50000, true),      // issued after death
        pmt('P-C', '2026-07-01', '2026-07-31', 50000, false),     // scheduled unpaid, stop
        pmt('P-D', '2026-06-10', '2026-06-30', 50000, true),      // covers after death
      ],
    });
    expect(r.issuedAfterDeath).toContain('P-B');
    expect(r.scheduledUnpaidToStop).toEqual(['P-C']);
    expect(r.paymentsCoveringAfterDeath).toEqual(
      expect.arrayContaining(['P-B', 'P-D']),
    );
  });

  it('applies low-value write-off to PAD amounts', () => {
    const r = analyseMortalityImpact({
      personRef: 'P-1',
      dateOfDeath: dod,
      lowValueWriteOffMinor: 10000,
      awards: [activeAward],
      payments: [
        pmt('P-A', '2026-06-20', '2026-06-30', 5000, true),   // < threshold → non-recoverable
        pmt('P-B', '2026-06-20', '2026-06-30', 40000, true),  // > threshold → recoverable
      ],
    });
    expect(r.nonRecoverableAmountMinor).toBe(5000);
    expect(r.recoverableAmountMinor).toBe(40000);
  });

  it('flags estate referral when recoverable ≥ threshold', () => {
    const r = analyseMortalityImpact({
      personRef: 'P-1',
      dateOfDeath: dod,
      estateRecoveryThresholdMinor: 30000,
      awards: [activeAward],
      payments: [pmt('P-A', '2026-06-20', '2026-06-30', 40000, true)],
    });
    expect(r.requiresEstateReferral).toBe(true);
  });

  it('opens survivor / funeral opportunities only when no existing claim', () => {
    const withoutExisting = analyseMortalityImpact({
      personRef: 'P-1',
      dateOfDeath: dod,
      awards: [activeAward],
      payments: [],
    });
    expect(withoutExisting.openSurvivorOpportunity).toBe(true);
    expect(withoutExisting.openFuneralOpportunity).toBe(true);
    expect(withoutExisting.duplicateFollowOnRisk).toBe(false);

    const withExisting = analyseMortalityImpact({
      personRef: 'P-1',
      dateOfDeath: dod,
      awards: [activeAward],
      payments: [],
      hasExistingFuneralClaim: true,
      hasExistingSurvivorClaim: true,
    });
    expect(withExisting.openSurvivorOpportunity).toBe(false);
    expect(withExisting.openFuneralOpportunity).toBe(false);
    expect(withExisting.duplicateFollowOnRisk).toBe(true);
  });

  it('respects grace-period days for scheduled-unpaid stop set', () => {
    const r = analyseMortalityImpact({
      personRef: 'P-1',
      dateOfDeath: dod,
      gracePeriodDays: 15,
      awards: [activeAward],
      payments: [
        pmt('P-C', '2026-06-25', '2026-06-30', 50000, false), // within grace
        pmt('P-D', '2026-07-05', '2026-07-31', 50000, false), // after grace → stop
      ],
    });
    expect(r.scheduledUnpaidToStop).toEqual(['P-D']);
  });

  it('daysBetween is inclusive-difference in whole days', () => {
    expect(daysBetween('2026-06-01', '2026-06-16')).toBe(15);
  });
});
