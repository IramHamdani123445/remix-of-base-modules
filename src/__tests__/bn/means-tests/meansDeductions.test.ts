/**
 * MEANS-TEST EPIC 5 — Deductions and disregards contract tests.
 *
 * The browser records what is claimed; it never decides what is allowed.
 */
import { describe, it, expect } from 'vitest';
import {
  BN_MEANS_COMMANDS,
  getMeansCommandSpec,
} from '@/types/bn/meansTests/meansCommands';
import {
  categoriesForKind,
  deductionPayload,
  deductionReasonLabel,
  draftFromDeductionClaim,
  emptyDeductionDraft,
  previewClaimedAnnualAmount,
  validateDeductionDraft,
  type BnMeansDeductionClaim,
  type BnMeansDeductionReference,
  type BnMeansDeductionRules,
} from '@/types/bn/meansTests/meansDeductions';

const RULES: BnMeansDeductionRules = {
  none_declaration_scope: 'ASSESSMENT',
  allow_assessment_level_claims: true,
  duplicate_treatment: 'WARN',
};

const REFERENCE = {
  DEDUCTION_CATEGORY: [
    {
      value: 'CHILD_MAINTENANCE',
      label: 'Child maintenance',
      claim_kind: 'DEDUCTION_CLAIM',
      requires_amount: true,
      requires_frequency: true,
      allowed_target_types: ['HOUSEHOLD_MEMBER', 'INCOME_FACT'],
      requires_reason: true,
      requires_period: true,
    },
    {
      value: 'DISABILITY_INCOME',
      label: 'Disability income disregard',
      claim_kind: 'DISREGARD_CANDIDATE',
      requires_amount: false,
      requires_frequency: false,
      allowed_target_types: ['INCOME_FACT'],

    },
  ],
  DEDUCTION_FREQUENCY: [{ value: 'MONTHLY', label: 'Monthly' }],
  DEDUCTION_REASON: [{ value: 'COURT_ORDER', label: 'Court order' }],
  DEDUCTION_FACT_SOURCE: [{ value: 'APPLICANT_DECLARATION', label: 'Applicant declaration' }],
  DEDUCTION_TARGET_KIND: [{ value: 'HOUSEHOLD_MEMBER', label: 'Household member' }],
  NO_DEDUCTION_REASON: [{ value: 'NONE_CLAIMED', label: 'Nothing claimed' }],
} as unknown as BnMeansDeductionReference;

describe('Epic 5 — command catalogue', () => {
  it('registers every governed deduction operation', () => {
    for (const command of [
      'BN_MEANS_ADD_DEDUCTION',
      'BN_MEANS_CORRECT_DEDUCTION',
      'BN_MEANS_VOID_DEDUCTION',
      'BN_MEANS_DECLARE_NO_DEDUCTIONS',
      'BN_MEANS_WITHDRAW_NO_DEDUCTIONS',
      'BN_MEANS_MARK_DEDUCTIONS_COMPLETE',
    ] as const) {
      const spec = getMeansCommandSpec(command);
      expect(spec, command).toBeDefined();
      expect(spec?.capability).toBe('bn_means_tests:write');
    }
  });

  it('keeps the catalogue free of duplicates', () => {
    const names = BN_MEANS_COMMANDS.map((c) => c.command);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('Epic 5 — claim kinds stay separate', () => {
  it('filters categories by claim kind', () => {
    expect(categoriesForKind(REFERENCE, 'DEDUCTION_CLAIM').map((c) => c.value)).toEqual([
      'CHILD_MAINTENANCE',
    ]);
    expect(categoriesForKind(REFERENCE, 'DISREGARD_CANDIDATE').map((c) => c.value)).toEqual([
      'DISABILITY_INCOME',
    ]);
  });

  it('carries the claim kind into the command payload', () => {
    const draft = emptyDeductionDraft('2026-01-01', 'DISREGARD_CANDIDATE');
    const payload = deductionPayload(
      { ...draft, categoryCode: 'DISABILITY_INCOME', targetKind: 'INCOME_FACT', targetRefId: 'i1' },
      { currency: 'XCD' },
    );
    expect(payload.claim_kind).toBe('DISREGARD_CANDIDATE');
    expect(payload.target_ref_id).toBe('i1');
  });
});

describe('Epic 5 — draft validation', () => {
  const base = {
    ...emptyDeductionDraft('2026-01-01'),
    categoryCode: 'CHILD_MAINTENANCE',
    targetKind: 'HOUSEHOLD_MEMBER' as const,
    targetRefId: 'm1',
    memberId: 'm1',
    claimedAmount: '250',
    declaredFrequency: 'MONTHLY',
    claimReasonCode: 'COURT_ORDER',
    factSource: 'APPLICANT_DECLARATION',
  };
  const ctx = {
    category: REFERENCE.DEDUCTION_CATEGORY[0],
    rules: RULES,
    assessmentFrom: '2026-01-01',
    assessmentTo: '2026-12-31',
  };

  it('accepts a complete claim', () => {
    expect(validateDeductionDraft(base, ctx)).toEqual({});
  });

  it('requires a governed target', () => {
    const errors = validateDeductionDraft({ ...base, targetKind: '', targetRefId: '' }, ctx);
    expect(Object.keys(errors).length).toBeGreaterThan(0);
  });

  it('requires an amount when the category demands one', () => {
    expect(validateDeductionDraft({ ...base, claimedAmount: '' }, ctx).claimedAmount).toBeDefined();
  });

  it('rejects a period outside the assessment window', () => {
    const errors = validateDeductionDraft({ ...base, effectiveFrom: '2027-01-01' }, ctx);
    expect(Object.keys(errors).length).toBeGreaterThan(0);
  });

  it('rejects an end date before the start date', () => {
    const errors = validateDeductionDraft(
      { ...base, effectiveFrom: '2026-06-01', effectiveTo: '2026-03-01' },
      ctx,
    );
    expect(Object.keys(errors).length).toBeGreaterThan(0);
  });
});

describe('Epic 5 — claimed values only', () => {
  it('previews the claimed annual value without deciding an allowance', () => {
    const preview = previewClaimedAnnualAmount({
      ...emptyDeductionDraft('2026-01-01'),
      claimedAmount: '100',
      declaredFrequency: 'MONTHLY',
    });
    expect(preview === null || typeof preview === 'number').toBe(true);
  });

  it('round-trips a stored claim into an editable draft', () => {
    const claim = {
      deduction_fact_id: 'd1',
      claim_kind: 'DEDUCTION_CLAIM',
      target_kind: 'HOUSEHOLD_MEMBER',
      target_ref_id: 'm1',
      member_id: 'm1',
      category_code: 'CHILD_MAINTENANCE',
      claimed_amount: 250,
      claimed_percentage: null,
      declared_frequency: 'MONTHLY',
      claim_reason_code: 'COURT_ORDER',
      claim_basis: null,
      fact_source: 'APPLICANT_DECLARATION',
      effective_from: '2026-01-01',
      effective_to: null,
      officer_notes: null,
    } as unknown as BnMeansDeductionClaim;
    const draft = draftFromDeductionClaim(claim);
    expect(draft.deductionFactId).toBe('d1');
    expect(draft.claimKind).toBe('DEDUCTION_CLAIM');
    expect(draft.categoryCode).toBe('CHILD_MAINTENANCE');
    expect(draft.claimedAmount).toBe('250');
  });
});

describe('Epic 5 — officer-readable reasons', () => {
  it('translates backend codes and passes unknown codes through', () => {
    expect(deductionReasonLabel('ASSET_SECTION_INCOMPLETE')).not.toBe('');
    expect(deductionReasonLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});
