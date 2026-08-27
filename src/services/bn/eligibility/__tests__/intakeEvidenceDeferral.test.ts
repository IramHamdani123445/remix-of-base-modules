/**
 * BUG-46 — the intake wizard blocked registration on documents that cannot
 * exist yet.
 *
 * Reported from the screen: Register / Assist Application, step 6 of 11,
 * MATERNITY_GRANT_TEST v1. "Claimant does NOT QUALIFY — 1 of 1 rule evaluated.
 * 1 rule(s) failed. Registration is blocked until a supervisor override is
 * recorded." The failing rule was "Medical certificate not provided".
 *
 * Documents are attached at step 7, and may be supplied after submission
 * altogether. At step 6 the claim has no id, so no document can be attached to
 * it — the rule was not failed, it was unanswerable. Forty-three of 262 active
 * rules read a `document.*` fact, so this blocked registration for most
 * products.
 *
 * The requirement is deferred, never waived: checkApprovalPreconditions
 * refuses approval on DOCUMENTS_OUTSTANDING.
 */
import { describe, it, expect } from 'vitest';
import {
  isDeferredAtIntake,
  isDocumentEvidenceFact,
  summariseEligibility,
  type EligibilityRuleTrace,
} from '../eligibilityEvaluator';

/** A trace as the evaluator emits one, carrying what the summary reads. */
const trace = (
  over: Partial<EligibilityRuleTrace> & Pick<EligibilityRuleTrace, 'rule_code' | 'result_state'>,
): EligibilityRuleTrace => ({
  rule_name: over.rule_code,
  rule_group: null,
  field_key: null,
  operator: '=',
  expected_value: true,
  actual_value: false,
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

describe('which facts are documentary', () => {
  it('recognises every fact bn_eligibility_fact marks DOCUMENT_CHECK', () => {
    // The ten active facts carrying source_type = 'DOCUMENT_CHECK'.
    const documentChecks = [
      'document.funeral_invoice_received',
      'document.medical_certificate_received',
      'document.medical_certificate.status',
      'document.death_certificate_received',
      'document.death_certificate.status',
      'document.birth_certificate_received',
      'document.birth_certificate.status',
      'document.employer_report_received',
      'document.employer_report.status',
      'document.funeral_invoice.status',
    ];
    for (const key of documentChecks) {
      expect(isDocumentEvidenceFact(key), key).toBe(true);
    }
  });

  it('does not defer a fact that is knowable at the counter', () => {
    // Each of these carries requires_claim_context = true in live data, which
    // is why that column cannot be the signal — deferring them would hand the
    // claimant a free pass on age and contributions.
    const knowable = [
      'person.age_at_claim_date',
      'contribution.total_weeks',
      'contribution.weeks_last_52',
      'contribution.average_weekly_wage',
      'existing.active_award',
    ];
    for (const key of knowable) {
      expect(isDocumentEvidenceFact(key), key).toBe(false);
    }
  });

  it('ignores empty and unknown keys rather than guessing', () => {
    expect(isDocumentEvidenceFact(null)).toBe(false);
    expect(isDocumentEvidenceFact(undefined)).toBe(false);
    expect(isDocumentEvidenceFact('')).toBe(false);
    expect(isDocumentEvidenceFact('   ')).toBe(false);
    expect(isDocumentEvidenceFact('no_such_fact_at_all')).toBe(false);
  });
});

describe('which rules are held back at intake', () => {
  it('defers the rule from the screenshot', () => {
    expect(isDeferredAtIntake({
      rule_code: 'MEDICAL_CERT_REQUIRED',
      rule_name: 'Medical certificate required',
      rule_group: 'MEDICAL',
      fact_key: 'document.medical_certificate_received',
      fail_action: 'BLOCK',
    })).toBe(true);
  });

  it('defers every EVIDENCE rule shipped against a document status', () => {
    const evidenceRules = [
      ['MAT-CONFINEMENT-CERT', 'document.medical_certificate.status'],
      ['FUN-DEATH-CERT-VERIFIED', 'document.death_certificate.status'],
      ['AGE-LIFE-CERT-VERIFIED', 'document.life_certificate.status'],
      ['SCH-CERT-VERIFIED', 'document.school_certificate.status'],
    ];
    for (const [code, fact] of evidenceRules) {
      expect(isDeferredAtIntake({
        rule_code: code,
        rule_name: code,
        rule_group: 'EVIDENCE',
        fact_key: fact,
        fail_action: 'BLOCK',
      }), code).toBe(true);
    }
  });

  it('defers a rule that names a document but resolves through another field', () => {
    // SICK-MED asserts evidence.document_verified and carries requires_document.
    expect(isDeferredAtIntake({
      rule_code: 'SICK-MED',
      rule_name: 'Medical certificate required',
      rule_group: 'MEDICAL',
      fact_key: null,
      fail_action: 'REFER',
      rule_definition: {
        field_key: 'evidence.document_verified',
        requires_document: 'MEDICAL_CERT',
      },
    })).toBe(true);
  });

  it('defers a rule carrying document_type_code', () => {
    expect(isDeferredAtIntake({
      rule_code: 'X',
      rule_name: 'X',
      fact_key: null,
      fail_action: 'BLOCK',
      document_type_code: 'DEATH_CERT',
    })).toBe(true);
  });

  it('does NOT defer a substantive requirement', () => {
    const substantive = [
      'person.age_at_claim_date',
      'contribution.total_weeks',
      'contribution.weeks_last_52',
    ];
    for (const fact of substantive) {
      expect(isDeferredAtIntake({
        rule_code: fact,
        rule_name: fact,
        rule_group: 'AGE',
        fact_key: fact,
        fail_action: 'BLOCK',
      }), fact).toBe(false);
    }
  });

  it('leaves an informational rule alone — it already never blocks', () => {
    expect(isDeferredAtIntake({
      rule_code: 'NOTE',
      rule_name: 'NOTE',
      fact_key: 'document.medical_certificate.status',
      fail_action: 'INFO',
    })).toBe(false);
  });
});

const DOC_FAIL = trace({
  rule_code: 'MEDICAL_CERT_REQUIRED',
  field_key: 'document.medical_certificate_received',
  result_state: 'FAIL',
});

describe('the verdict at intake', () => {
  it('the screenshot case: a lone document rule no longer fails the claimant', () => {
    const sum = summariseEligibility([DOC_FAIL], { phase: 'INTAKE' });
    expect(sum.verdict).not.toBe('FAILED');
    expect(sum.failed).toHaveLength(0);
    expect(sum.deferred.map((t) => t.rule_code)).toEqual(['MEDICAL_CERT_REQUIRED']);
  });

  it('a real failure still fails, alongside a deferred document', () => {
    const sum = summariseEligibility([
      DOC_FAIL,
      trace({ rule_code: 'AGE-MIN', field_key: 'person.age_at_claim_date', result_state: 'FAIL' }),
    ], { phase: 'INTAKE' });
    expect(sum.verdict).toBe('FAILED');
    expect(sum.failed.map((t) => t.rule_code)).toEqual(['AGE-MIN']);
    expect(sum.deferred).toHaveLength(1);
  });

  it('an unevaluable substantive rule is still undetermined — BUG-30 stands', () => {
    const sum = summariseEligibility([
      DOC_FAIL,
      trace({ rule_code: 'MYSTERY', field_key: null, result_state: 'UNEVALUATED' }),
    ], { phase: 'INTAKE' });
    expect(sum.verdict).toBe('NOT_DETERMINED');
    expect(sum.overall).toBe(false);
  });

  it('a passing substantive rule passes with the document held back', () => {
    const sum = summariseEligibility([
      DOC_FAIL,
      trace({ rule_code: 'AGE-MIN', field_key: 'person.age_at_claim_date', result_state: 'PASS' }),
    ], { phase: 'INTAKE' });
    expect(sum.verdict).toBe('PASSED');
    expect(sum.deferred).toHaveLength(1);
  });

  it('coverage counts only what was actually judged', () => {
    const sum = summariseEligibility([
      DOC_FAIL,
      trace({ rule_code: 'AGE-MIN', field_key: 'person.age_at_claim_date', result_state: 'PASS' }),
    ], { phase: 'INTAKE' });
    // One rule judged, not two — claiming "2 of 2" would overstate the check.
    expect(sum.evaluatedCount).toBe(1);
    expect(sum.totalCount).toBe(1);
  });
});

describe('adjudication is unchanged — the document still blocks', () => {
  it('fails by default, with no phase given', () => {
    const sum = summariseEligibility([DOC_FAIL]);
    expect(sum.verdict).toBe('FAILED');
    expect(sum.overall).toBe(false);
    expect(sum.deferred).toHaveLength(0);
  });

  it('fails when the phase is stated explicitly', () => {
    const sum = summariseEligibility([DOC_FAIL], { phase: 'ADJUDICATION' });
    expect(sum.verdict).toBe('FAILED');
    expect(sum.failed.map((t) => t.rule_code)).toEqual(['MEDICAL_CERT_REQUIRED']);
  });

  it('the deferral is a deferral, not a waiver', () => {
    // The same rule, the same claimant: allowed past the counter, refused at
    // adjudication. That is the whole design.
    expect(summariseEligibility([DOC_FAIL], { phase: 'INTAKE' }).verdict).not.toBe('FAILED');
    expect(summariseEligibility([DOC_FAIL], { phase: 'ADJUDICATION' }).verdict).toBe('FAILED');
  });
});
