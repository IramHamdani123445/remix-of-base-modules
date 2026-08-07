/**
 * Slice 1 — Means-Test Assessment lifecycle foundation tests.
 *
 * Proves:
 *  - Command → capability map completeness (all 21 canonical commands mapped)
 *  - Command specs enforce maker-checker + justification where required
 *  - State-machine reachability (canonical path reaches ACTIVE and CLOSED)
 *  - Terminal states have no outbound transitions
 *  - Legacy status mapping
 *  - Fact resolver refuses expired / unapproved / non-PASS assessments
 *  - Calculator handles frequency mix, disregards, rounding, ceiling, close
 */

import { describe, expect, it } from 'vitest';

import {
  BN_MEANS_COMMANDS,
  getMeansCommandSpec,
  type BnMeansCommandName,
} from '@/types/bn/meansTests/meansCommands';
import {
  BN_MEANS_TERMINAL_STATES,
  BN_MEANS_TRANSITIONS,
  canMeansTransition,
  isFactPublishable,
  isMeansTerminal,
  mapLegacyMeansStatus,
  reachableMeansStates,
  type BnMeansAssessmentStatus,
} from '@/types/bn/meansTests/meansStateMachine';
import {
  BN_GAP_COMMAND_CAPABILITY,
  requiredCapabilityFor,
} from '@/services/bn/commands/benefitsCapabilityRegistry';
import {
  BN_MEANS_FACT_KEYS,
  resolveMeansFacts,
} from '@/types/bn/meansTests/meansFactContract';
import {
  annualiseMinor,
  applyDisregardMinor,
  calculateMeansAssessment,
  computeThresholdMinor,
} from '@/services/bn/meansTests/meansAssessableCalculator';

const CANONICAL_COMMANDS: readonly BnMeansCommandName[] = [
  'BN_MEANS_CREATE_ASSESSMENT',
  'BN_MEANS_ADD_HOUSEHOLD_MEMBER',
  'BN_MEANS_UPDATE_HOUSEHOLD_MEMBER',
  'BN_MEANS_REMOVE_HOUSEHOLD_MEMBER',
  'BN_MEANS_CORRECT_CONTEXT',
  'BN_MEANS_ADD_INCOME',
  'BN_MEANS_ADD_ASSET',
  'BN_MEANS_ADD_DEDUCTION',
  'BN_MEANS_ATTACH_EVIDENCE',
  'BN_MEANS_SUBMIT',
  'BN_MEANS_VERIFY_INFORMATION',
  'BN_MEANS_CALCULATE',
  'BN_MEANS_REQUEST_ADJUSTMENT',
  'BN_MEANS_APPROVE_ADJUSTMENT',
  'BN_MEANS_APPROVE',
  'BN_MEANS_REJECT',
  'BN_MEANS_ACTIVATE',
  'BN_MEANS_SCHEDULE_REASSESSMENT',
  'BN_MEANS_RECORD_CHANGE_OF_CIRCUMSTANCE',
  'BN_MEANS_SUPERSEDE',
  'BN_MEANS_CLOSE',
];

/** EPIC 3 — governed supporting operations; the business catalogue is unchanged. */
const SUPPORTING_OPERATIONS: readonly BnMeansCommandName[] = [
  'BN_MEANS_CORRECT_INCOME',
  'BN_MEANS_VOID_INCOME',
  'BN_MEANS_DECLARE_NO_INCOME',
  'BN_MEANS_WITHDRAW_NO_INCOME',
  'BN_MEANS_MARK_HOUSEHOLD_COMPLETE',
  'BN_MEANS_MARK_INCOME_COMPLETE',
  'BN_MEANS_CORRECT_ASSET',
  'BN_MEANS_VOID_ASSET',
  'BN_MEANS_DECLARE_NO_ASSETS',
  'BN_MEANS_WITHDRAW_NO_ASSETS',
  'BN_MEANS_MARK_ASSETS_COMPLETE',
  'BN_MEANS_CORRECT_DEDUCTION',
  'BN_MEANS_VOID_DEDUCTION',
  'BN_MEANS_DECLARE_NO_DEDUCTIONS',
  'BN_MEANS_WITHDRAW_NO_DEDUCTIONS',
  'BN_MEANS_MARK_DEDUCTIONS_COMPLETE',
  // EPIC 6 — evidence link register and information requests.
  'BN_MEANS_UNLINK_EVIDENCE',
  'BN_MEANS_RECORD_EVIDENCE_USABILITY',
  'BN_MEANS_REQUEST_INFORMATION',
  'BN_MEANS_RECORD_INFORMATION_RESPONSE',
  'BN_MEANS_CLOSE_INFORMATION_REQUEST',
  'BN_MEANS_MARK_EVIDENCE_COMPLETE',
  'BN_MEANS_REOPEN_EVIDENCE',
  // EPIC 8 — verification and clarification against the frozen version.
  'BN_MEANS_CLAIM_VERIFICATION_WORK',
  'BN_MEANS_RELEASE_VERIFICATION_WORK',
  'BN_MEANS_RECORD_VERIFICATION_DECISION',
  'BN_MEANS_RECORD_CLARIFICATION_RESPONSE',
  'BN_MEANS_CANCEL_CLARIFICATION',
  'BN_MEANS_REOPEN_VERIFICATION_FACT',
  'BN_MEANS_COMPLETE_VERIFICATION',
];

describe('Means-Test command catalogue', () => {
  it('registers every canonical command and governed supporting operation', () => {
    // The catalogue grew through Epics 10-13 (adjustments, activation,
    // lifecycle). It must remain a superset of the foundation contract,
    // with no duplicate registrations.
    const names = BN_MEANS_COMMANDS.map((c) => c.command);
    expect(new Set(names).size).toBe(names.length);
    expect(BN_MEANS_COMMANDS.length).toBeGreaterThanOrEqual(
      CANONICAL_COMMANDS.length + SUPPORTING_OPERATIONS.length,
    );
    for (const c of [...CANONICAL_COMMANDS, ...SUPPORTING_OPERATIONS]) {
      expect(getMeansCommandSpec(c)).toBeDefined();
    }
  });


  it('maps every canonical command to a capability in the registry', () => {
    for (const c of CANONICAL_COMMANDS) {
      expect(requiredCapabilityFor(c)).not.toBeNull();
      expect(BN_GAP_COMMAND_CAPABILITY[c]).toMatch(/^bn_means_tests:/);
    }
  });

  it('enforces maker-checker + no self-approval on approval-tier commands', () => {
    const approvals: BnMeansCommandName[] = [
      'BN_MEANS_APPROVE_ADJUSTMENT',
      'BN_MEANS_APPROVE',
      'BN_MEANS_REJECT',
    ];
    for (const c of approvals) {
      const spec = getMeansCommandSpec(c)!;
      expect(spec.requiresMakerChecker).toBe(true);
      expect(spec.forbidsSelfApproval).toBe(true);
    }
  });

  it('requires justification on adjustment, rejection, supersede, close, CoC', () => {
    const withJustification: BnMeansCommandName[] = [
      'BN_MEANS_REQUEST_ADJUSTMENT',
      'BN_MEANS_APPROVE_ADJUSTMENT',
      'BN_MEANS_REJECT',
      'BN_MEANS_SUPERSEDE',
      'BN_MEANS_CLOSE',
      'BN_MEANS_RECORD_CHANGE_OF_CIRCUMSTANCE',
    ];
    for (const c of withJustification) {
      expect(getMeansCommandSpec(c)!.requiresJustification).toBe(true);
    }
  });

  it('marks fact-publishing commands (ACTIVATE, SUPERSEDE) accordingly', () => {
    expect(getMeansCommandSpec('BN_MEANS_ACTIVATE')!.publishesFacts).toBe(true);
    expect(getMeansCommandSpec('BN_MEANS_SUPERSEDE')!.publishesFacts).toBe(true);
    // Non-fact commands must NOT claim to publish facts
    expect(getMeansCommandSpec('BN_MEANS_ADD_INCOME')!.publishesFacts).toBe(false);
  });
});

describe('Means-Test state machine', () => {
  it('reaches ACTIVE and CLOSED from DRAFT via the canonical happy path', () => {
    const reachable = reachableMeansStates('DRAFT');
    expect(reachable.has('ACTIVE')).toBe(true);
    expect(reachable.has('CLOSED')).toBe(true);
  });

  it('permits the canonical happy-path transitions end to end', () => {
    const path: BnMeansAssessmentStatus[] = [
      'DRAFT',
      'SUBMITTED',
      'VERIFICATION_PENDING',
      'CALCULATED',
      'APPROVAL_PENDING',
      'APPROVED',
      'ACTIVE',
      'REASSESSMENT_DUE',
      'EXPIRED',
      'SUPERSEDED',
      'CLOSED',
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canMeansTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it('marks CLOSED and CANCELLED as terminal with no outbound transitions', () => {
    for (const t of BN_MEANS_TERMINAL_STATES) {
      expect(isMeansTerminal(t)).toBe(true);
      expect(BN_MEANS_TRANSITIONS[t]).toEqual([]);
    }
  });

  it('only ACTIVE and REASSESSMENT_DUE are fact-publishable', () => {
    expect(isFactPublishable('ACTIVE')).toBe(true);
    expect(isFactPublishable('REASSESSMENT_DUE')).toBe(true);
    expect(isFactPublishable('APPROVED')).toBe(false);
    expect(isFactPublishable('EXPIRED')).toBe(false);
    expect(isFactPublishable('REJECTED')).toBe(false);
  });

  it('normalises legacy status codes', () => {
    expect(mapLegacyMeansStatus('PENDING')).toBe('SUBMITTED');
    expect(mapLegacyMeansStatus('PASSED')).toBe('ACTIVE');
    expect(mapLegacyMeansStatus('FAILED')).toBe('REJECTED');
    // Canonical passes through
    expect(mapLegacyMeansStatus('ACTIVE')).toBe('ACTIVE');
  });
});

describe('Means-Test fact resolver', () => {
  const base = {
    assessmentId: 'a1',
    policyVersion: 'v1',
    assessableIncome: 12_000_00,
    assessableAssets: 5_000_00,
    householdSize: 3,
    threshold: 15_000_00,
    excessAmount: -3_000_00,
    validFrom: '2026-01-01',
    validUntil: '2027-01-01',
    reassessmentDue: '2026-07-01',
    asOf: '2026-07-19',
  } as const;

  it('publishes a full bundle when ACTIVE + PASS + unexpired', () => {
    const r = resolveMeansFacts({ ...base, status: 'ACTIVE', result: 'PASS' });
    expect(r.published).toBe(true);
    expect(r.bundle).toBeDefined();
    for (const key of BN_MEANS_FACT_KEYS) {
      expect(r.bundle).toHaveProperty(key);
    }
    expect(r.bundle!['means.passed']).toBe(true);
  });

  it('refuses non-publishable statuses', () => {
    const r = resolveMeansFacts({ ...base, status: 'APPROVED', result: 'PASS' });
    expect(r.published).toBe(false);
    expect(r.refusalReason).toBe('ASSESSMENT_STATUS_INVALID');
  });

  it('refuses expired assessments even when ACTIVE + PASS', () => {
    const r = resolveMeansFacts({
      ...base,
      status: 'ACTIVE',
      result: 'PASS',
      validUntil: '2026-01-01', // before asOf
    });
    expect(r.published).toBe(false);
    expect(r.refusalReason).toBe('ASSESSMENT_EXPIRED');
  });

  it('refuses non-PASS results', () => {
    const r = resolveMeansFacts({ ...base, status: 'ACTIVE', result: 'FAIL' });
    expect(r.published).toBe(false);
    expect(r.refusalReason).toBe('RESULT_NOT_PASS');
  });

  it('refuses retired policy versions', () => {
    const r = resolveMeansFacts({
      ...base,
      status: 'ACTIVE',
      result: 'PASS',
      policyVersionRetired: true,
    });
    expect(r.published).toBe(false);
    expect(r.refusalReason).toBe('POLICY_VERSION_RETIRED');
  });
});

describe('Means-Test calculator', () => {
  it('annualises income by ISO-standard frequency factors', () => {
    expect(annualiseMinor(100_00, 'WEEKLY')).toBe(52_00_00);
    expect(annualiseMinor(100_00, 'BIWEEKLY')).toBe(26_00_00);
    expect(annualiseMinor(100_00, 'MONTHLY')).toBe(12_00_00);
    expect(annualiseMinor(100_00, 'QUARTERLY')).toBe(4_00_00);
    expect(annualiseMinor(100_00, 'ANNUALLY')).toBe(100_00);
    expect(annualiseMinor(500_00, 'ONE_OFF')).toBe(500_00);
  });

  it('clamps disregard so assessable never goes negative', () => {
    const r = applyDisregardMinor(1_000_00, 5_000_00, 0);
    expect(r.assessableMinor).toBe(0);
    expect(r.disregardedMinor).toBe(1_000_00);
  });

  it('applies fixed + percentage disregard together', () => {
    const r = applyDisregardMinor(10_000_00, 1_000_00, 10); // 10% of 10k = 1k, +1k fixed = 2k
    expect(r.disregardedMinor).toBe(2_000_00);
    expect(r.assessableMinor).toBe(8_000_00);
  });

  it('computes household threshold with per-person adjustment', () => {
    expect(computeThresholdMinor(1, { baseMinor: 10_000_00, perPersonAdjustmentMinor: 2_000_00 })).toBe(10_000_00);
    expect(computeThresholdMinor(3, { baseMinor: 10_000_00, perPersonAdjustmentMinor: 2_000_00 })).toBe(14_000_00);
  });

  it('produces PASS when income + assets below threshold', () => {
    const out = calculateMeansAssessment({
      householdSize: 2,
      incomes: [{ memberId: 'm1', category: 'WAGES', grossMinor: 200_00, frequency: 'WEEKLY' }],
      assets: [{ memberId: 'm1', category: 'CASH', grossMinor: 1_000_00 }],
      deductions: [{ category: 'CHILDCARE', amountMinor: 500_00 }],
      threshold: { baseMinor: 20_000_00, perPersonAdjustmentMinor: 5_000_00 },
      policy: { currency: 'XCD', roundingMinor: 1 },
    });
    expect(out.result).toBe('PASS');
    expect(out.grossHouseholdIncomeMinor).toBe(200_00 * 52);
    expect(out.thresholdMinor).toBe(25_000_00);
    expect(out.excessMinor).toBeLessThanOrEqual(0);
  });

  it('produces FAIL when assets exceed the ceiling regardless of income', () => {
    const out = calculateMeansAssessment({
      householdSize: 1,
      incomes: [],
      assets: [{ memberId: 'm1', category: 'PROPERTY', grossMinor: 500_000_00 }],
      deductions: [],
      threshold: { baseMinor: 20_000_00, perPersonAdjustmentMinor: 0, maxAssetsMinor: 100_000_00 },
      policy: { currency: 'XCD', roundingMinor: 1 },
    });
    expect(out.result).toBe('FAIL');
  });

  it('produces REFER when result is within the review closeness window', () => {
    const out = calculateMeansAssessment({
      householdSize: 1,
      incomes: [{ memberId: 'm1', category: 'WAGES', grossMinor: 10_000_00, frequency: 'ANNUALLY' }],
      assets: [],
      deductions: [],
      threshold: { baseMinor: 10_050_00, perPersonAdjustmentMinor: 0 },
      policy: { currency: 'XCD', roundingMinor: 1, requiresReviewOnCloseness: 100_00 },
    });
    expect(out.result).toBe('REFER');
  });

  it('records a calculation trace with income, asset, deduction, threshold and result steps', () => {
    const out = calculateMeansAssessment({
      householdSize: 1,
      incomes: [{ memberId: 'm1', category: 'WAGES', grossMinor: 100_00, frequency: 'MONTHLY' }],
      assets: [{ memberId: 'm1', category: 'CASH', grossMinor: 500_00 }],
      deductions: [{ category: 'TAX', amountMinor: 50_00 }],
      threshold: { baseMinor: 5_000_00, perPersonAdjustmentMinor: 0 },
      policy: { currency: 'XCD', roundingMinor: 1 },
    });
    const steps = out.trace.map((t) => t.step);
    expect(steps).toContain('INCOME');
    expect(steps).toContain('ASSET');
    expect(steps).toContain('DEDUCTIONS');
    expect(steps).toContain('THRESHOLD');
    expect(steps).toContain('RESULT');
  });
});
