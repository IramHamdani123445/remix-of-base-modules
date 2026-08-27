/**
 * BUG-48 — the intake pre-check is advisory. It informs and is recorded; it
 * does not bar registration.
 *
 * Reported from the screen: Sickness 2027 (SICK_11) v4, SSN 200004, step 6 of
 * 11. "Eligibility COULD NOT BE DETERMINED — 1 of 2 rules evaluated." Next was
 * blocked, and the message asked for a supervisor override the wizard offers no
 * control for — an instruction the screen cannot fulfil.
 *
 * Why advisory is the correct behaviour, not a relaxation:
 *
 *   Registration is what brings a claim into existence. A refusal must be a
 *   formal decision the claimant can appeal, and turning someone away at the
 *   counter produces no decision to appeal against and no record that they ever
 *   came. So the counter records what is known; adjudication decides.
 *
 * Nothing is loosened downstream. `checkApprovalPreconditions` still refuses
 * approval on ELIGIBILITY_MISSING, ELIGIBILITY_NOT_PASSED, ELIGIBILITY_STALE,
 * DOCUMENTS_OUTSTANDING, CALCULATION_MISSING and CALCULATION_ZERO. The verdict
 * itself is unchanged — it is still FAILED when the claimant does not qualify,
 * and NOT_DETERMINED is still never a pass (BUG-29, BUG-30).
 *
 * These tests fix the two halves that must not drift apart: the verdict stays
 * honest, and `overall` stays false for anything but a pass — because that is
 * what is persisted as `bn_claim_eligibility.overall_result` and read by the
 * calculation and approval gates.
 */
import { describe, it, expect } from 'vitest';
import {
  summariseEligibility,
  type EligibilityRuleTrace,
} from '../eligibilityEvaluator';

const trace = (
  over: Partial<EligibilityRuleTrace> & Pick<EligibilityRuleTrace, 'rule_code' | 'result_state'>,
): EligibilityRuleTrace => ({
  rule_name: over.rule_code,
  rule_group: null,
  field_key: null,
  operator: '>=',
  expected_value: 26,
  actual_value: 4,
  passed: over.result_state === 'PASS',
  fail_action: 'BLOCK',
  key_source: 'fact_key',
  source: null,
  message: '',
  requirement: '',
  detail: null,
  reference: null,
  alternative_group: null,
  ...over,
} as EligibilityRuleTrace);

/** The two rules on SICK_11 v4, as the screen showed them. */
const AGE_PASS = trace({
  rule_code: 'AGE-16-65',
  field_key: 'person.age_at_claim_date',
  result_state: 'PASS',
});
const CONTRIB_UNEVALUATED = trace({
  rule_code: 'MIN_CONTRIB_26',
  field_key: 'contribution.paid_weeks',
  result_state: 'UNEVALUATED',
  unevaluated_reason: 'Paid contribution weeks is not available for this claimant',
});
const CONTRIB_FAIL = trace({
  rule_code: 'MIN_CONTRIB_26',
  field_key: 'contribution.paid_weeks',
  result_state: 'FAIL',
});

describe('the verdict stays honest — nothing here relaxes it', () => {
  it('the reported case is still NOT_DETERMINED, not a pass', () => {
    const sum = summariseEligibility([AGE_PASS, CONTRIB_UNEVALUATED], { phase: 'INTAKE' });
    expect(sum.verdict).toBe('NOT_DETERMINED');
    expect(sum.overall).toBe(false);
  });

  it('a genuinely short record still FAILS', () => {
    const sum = summariseEligibility([AGE_PASS, CONTRIB_FAIL], { phase: 'INTAKE' });
    expect(sum.verdict).toBe('FAILED');
    expect(sum.overall).toBe(false);
    expect(sum.failed.map((t) => t.rule_code)).toEqual(['MIN_CONTRIB_26']);
  });

  it('only a real pass is a pass', () => {
    const sum = summariseEligibility([
      AGE_PASS,
      trace({ rule_code: 'MIN_CONTRIB_26', field_key: 'contribution.paid_weeks', result_state: 'PASS' }),
    ], { phase: 'INTAKE' });
    expect(sum.verdict).toBe('PASSED');
    expect(sum.overall).toBe(true);
  });

  it('no rules at all is not a pass — BUG-30 stands', () => {
    const sum = summariseEligibility([], { phase: 'INTAKE' });
    expect(sum.verdict).toBe('NOT_DETERMINED');
    expect(sum.overall).toBe(false);
  });
});

describe('overall stays false for anything but a pass', () => {
  /**
   * `overall` is persisted as bn_claim_eligibility.overall_result and read by
   * the calculation precondition and the approval gate. If advisory intake ever
   * leaked into this flag, a claim would be registered AND become payable
   * without qualifying. It must not move.
   */
  it('false on FAILED', () => {
    expect(summariseEligibility([CONTRIB_FAIL], { phase: 'INTAKE' }).overall).toBe(false);
  });

  it('false on NOT_DETERMINED', () => {
    expect(summariseEligibility([CONTRIB_UNEVALUATED], { phase: 'INTAKE' }).overall).toBe(false);
  });

  it('false when every rule was held back for evidence', () => {
    const doc = trace({
      rule_code: 'MEDICAL_CERT_REQUIRED',
      field_key: 'document.medical_certificate_received',
      result_state: 'FAIL',
    });
    const sum = summariseEligibility([doc], { phase: 'INTAKE' });
    // Deferred, so not failed — but nothing was proven either.
    expect(sum.failed).toHaveLength(0);
    expect(sum.overall).toBe(false);
  });
});

describe('the finding an officer is shown, and what is recorded with the claim', () => {
  it('names the rules that failed, so the record is specific', () => {
    const sum = summariseEligibility([AGE_PASS, CONTRIB_FAIL], { phase: 'INTAKE' });
    expect(sum.failed.map((t) => t.rule_code)).toEqual(['MIN_CONTRIB_26']);
    expect(sum.passed.map((t) => t.rule_code)).toEqual(['AGE-16-65']);
  });

  it('names the rules that could not be checked, and why', () => {
    const sum = summariseEligibility([AGE_PASS, CONTRIB_UNEVALUATED], { phase: 'INTAKE' });
    expect(sum.unevaluated.map((t) => t.rule_code)).toEqual(['MIN_CONTRIB_26']);
    expect(sum.unevaluated[0].unevaluated_reason).toContain('not available');
  });

  it('reports coverage that matches what was judged', () => {
    const sum = summariseEligibility([AGE_PASS, CONTRIB_UNEVALUATED], { phase: 'INTAKE' });
    expect(sum.evaluatedCount).toBe(1);
    expect(sum.totalCount).toBe(2);
    expect(sum.coverageLabel).toBe('1 of 2 rules evaluated');
  });

  it('keeps the three findings in separate buckets', () => {
    const doc = trace({
      rule_code: 'MED_DOC',
      field_key: 'document.medical_certificate_received',
      result_state: 'FAIL',
    });
    const sum = summariseEligibility([AGE_PASS, CONTRIB_FAIL, CONTRIB_UNEVALUATED, doc], {
      phase: 'INTAKE',
    });
    // failed / unevaluated / deferred are distinct records of distinct facts.
    expect(sum.passed.map((t) => t.rule_code)).toEqual(['AGE-16-65']);
    expect(sum.deferred.map((t) => t.rule_code)).toEqual(['MED_DOC']);
    expect(sum.failed.length + sum.unevaluated.length).toBe(2);
  });
});

describe('adjudication is judged differently from the counter', () => {
  it('a document rule blocks at adjudication and not at intake', () => {
    const doc = trace({
      rule_code: 'MEDICAL_CERT_REQUIRED',
      field_key: 'document.medical_certificate_received',
      result_state: 'FAIL',
    });
    expect(summariseEligibility([doc], { phase: 'INTAKE' }).verdict).not.toBe('FAILED');
    expect(summariseEligibility([doc], { phase: 'ADJUDICATION' }).verdict).toBe('FAILED');
  });

  it('a contribution rule is judged the same in both — it is not evidence', () => {
    // Only evidence is deferred. A short contribution record is a finding about
    // the claimant, available at the counter and unchanged by time.
    expect(summariseEligibility([CONTRIB_FAIL], { phase: 'INTAKE' }).verdict).toBe('FAILED');
    expect(summariseEligibility([CONTRIB_FAIL], { phase: 'ADJUDICATION' }).verdict).toBe('FAILED');
  });

  it('adjudication is the default when no phase is stated', () => {
    const doc = trace({
      rule_code: 'MED',
      field_key: 'document.medical_certificate.status',
      result_state: 'FAIL',
    });
    expect(summariseEligibility([doc]).verdict).toBe('FAILED');
    expect(summariseEligibility([doc]).deferred).toHaveLength(0);
  });
});
