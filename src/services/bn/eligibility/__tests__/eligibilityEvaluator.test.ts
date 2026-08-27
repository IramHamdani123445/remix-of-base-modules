/**
 * BUG-29 — a claim could be registered for a person who does not qualify.
 *
 * The rules used here are the live Age Grant (SKN-AGEG) and Maternity Grant
 * definitions, copied verbatim from bn_eligibility_rule, including the three
 * different field-key conventions in use. The reported case is the 43-year-old
 * with 6 contribution weeks who was told "Eligibility PASSED".
 */
import { describe, it, expect, vi } from 'vitest';

const resolveFieldMock = vi.fn();

const resolveFactMock = vi.fn();

vi.mock('../fieldResolver', () => ({
  resolveField: (...args: unknown[]) => resolveFieldMock(...args),
}));

vi.mock('../eligibilityFactResolver', () => ({
  resolveFact: (...args: unknown[]) => resolveFactMock(...args),
}));

import {
  evaluateEligibilityRules,
  summariseEligibility,
  resolveRuleFieldKey,
  isInformationalRule,
  lookupField,
  dedupeByRequirement,
  requirementKey,
  evaluateEligibilityRulesWithDuplicates,
  type EvaluableRule,
} from '../eligibilityEvaluator';

/** Age Grant rules exactly as they exist on the ACTIVE product version. */
const AGE_GRANT_RULES: EvaluableRule[] = [
  {
    rule_code: 'AGEG-AGE', rule_name: 'Claimant is at least 62',
    fail_action: 'REJECT', severity: 'BLOCK', fact_key: null,
    rule_definition: { fact: 'age_years', value: 62, operator: '>=' },
  },
  {
    rule_code: 'AGEG-CONTRIB-MIN', rule_name: 'Between 50 and 499 contributions',
    fail_action: 'REJECT', severity: 'BLOCK', fact_key: null,
    rule_definition: { max: 499, min: 50, fact: 'contribution_weeks_total', operator: 'between' },
  },
  {
    rule_code: 'AGEG-CONTRIB-RANGE', rule_name: 'Fewer than 500 contributions',
    fail_action: 'REJECT', severity: 'BLOCK', fact_key: 'contribution.total_weeks',
    rule_definition: { value: 500, operator: '<' },
  },
];

const ctx = { ssn: '123456789', claimDate: '2026-08-17' };

/**
 * Stubs BOTH resolvers from one map. A field key belongs to either the field
 * registry (resolveField) or the fact registry (resolveFact), and which one it
 * is should not be something each test has to know.
 */
function stubFields(values: Record<string, unknown>) {
  resolveFieldMock.mockReset();
  resolveFactMock.mockReset();
  resolveFieldMock.mockImplementation(async (key: string) => {
    if (!(key in values)) throw new Error(`unstubbed field ${key}`);
    return { fieldKey: key, resolver: key, value: values[key], sourceLabel: 'test' };
  });
  resolveFactMock.mockImplementation(async (key: string) => {
    if (!(key in values)) throw new Error(`unstubbed fact ${key}`);
    return {
      fact_key: key,
      value: values[key],
      source_table: 'test',
      source_column: 'test',
      resolved_at: '',
    };
  });
}

describe('BUG-29 — the reported Age Grant case', () => {
  it('FAILS a 43-year-old with 6 contribution weeks (previously reported as PASSED)', async () => {
    stubFields({
      'person.age_at_claim_date': 43,
      'contribution.total_weeks': 6,
    });

    const traces = await evaluateEligibilityRules(AGE_GRANT_RULES, ctx);
    const sum = summariseEligibility(traces);

    expect(sum.overall).toBe(false);
    expect(traces.find(t => t.rule_code === 'AGEG-AGE')?.result_state).toBe('FAIL');
    expect(traces.find(t => t.rule_code === 'AGEG-CONTRIB-MIN')?.result_state).toBe('FAIL');
    // 6 < 500 is genuinely satisfied — the check ran, it did not merely default.
    expect(traces.find(t => t.rule_code === 'AGEG-CONTRIB-RANGE')?.result_state).toBe('PASS');
    expect(sum.failed.map(t => t.rule_code)).toEqual(['AGEG-AGE', 'AGEG-CONTRIB-MIN']);
  });

  it('PASSES a genuinely qualified claimant', async () => {
    stubFields({
      'person.age_at_claim_date': 65,
      'contribution.total_weeks': 120,
    });
    const sum = summariseEligibility(await evaluateEligibilityRules(AGE_GRANT_RULES, ctx));
    expect(sum.overall).toBe(true);
    expect(sum.passed).toHaveLength(3);
  });

  it('reads every field-key convention, so no rule is skipped', async () => {
    // rule_definition.fact, the fact_key column, and rule_definition.field_key
    expect(resolveRuleFieldKey(AGE_GRANT_RULES[0])).toMatchObject({
      key: 'person.age_at_claim_date', source: 'alias', rawKey: 'age_years',
    });
    expect(resolveRuleFieldKey(AGE_GRANT_RULES[2])).toMatchObject({
      key: 'contribution.total_weeks', source: 'fact_key',
    });
    expect(resolveRuleFieldKey({
      rule_code: 'X', rule_name: 'X', rule_definition: { field_key: 'person.status', value: 'ACTIVE' },
    })).toMatchObject({ key: 'person.status', source: 'field_key' });
  });
});

describe('a check with no input must fail, not pass', () => {
  it('records an unmapped rule as UNEVALUATED and blocks', async () => {
    stubFields({});
    const traces = await evaluateEligibilityRules(
      [{ rule_code: 'LEGACY-1', rule_name: 'Legacy rule', fail_action: 'REJECT', rule_definition: {} }],
      ctx,
    );
    expect(traces[0].passed).toBe(false);
    expect(traces[0].result_state).toBe('UNEVALUATED');
    expect(summariseEligibility(traces).overall).toBe(false);
  });

  it('records an unrecognised field name as UNEVALUATED, naming the field', async () => {
    stubFields({});
    const traces = await evaluateEligibilityRules(
      [{
        rule_code: 'MAT-GENDER', rule_name: 'Claimant is female',
        fail_action: 'REJECT', rule_definition: { fact: 'claimant_gender', value: 'F' },
      }],
      ctx,
    );
    expect(traces[0].result_state).toBe('UNEVALUATED');
    expect(traces[0].unevaluated_reason).toContain('claimant_gender');
  });

  it('records a rule with no comparable value as UNEVALUATED', async () => {
    stubFields({ 'person.status': 'ACTIVE' });
    const traces = await evaluateEligibilityRules(
      [{
        rule_code: 'INTENT-ONLY', rule_name: 'Must be actively employed',
        fail_action: 'REJECT', fact_key: 'person.status',
        rule_definition: { requires_active_employment: true },
      }],
      ctx,
    );
    expect(traces[0].result_state).toBe('UNEVALUATED');
    expect(summariseEligibility(traces).overall).toBe(false);
  });

  it('records an unresolvable claimant value as UNEVALUATED, not PASS', async () => {
    stubFields({ 'person.age_at_claim_date': null });
    const traces = await evaluateEligibilityRules([AGE_GRANT_RULES[0]], ctx);
    expect(traces[0].result_state).toBe('UNEVALUATED');
    expect(traces[0].passed).toBe(false);
  });

  it('records a resolver failure as UNEVALUATED, not PASS', async () => {
    resolveFieldMock.mockReset();
    resolveFieldMock.mockRejectedValue(new Error('contribution RPC timed out'));
    const traces = await evaluateEligibilityRules([AGE_GRANT_RULES[0]], ctx);
    expect(traces[0].result_state).toBe('UNEVALUATED');
    expect(traces[0].unevaluated_reason).toContain('contribution RPC timed out');
  });
});

describe('informational must be deliberate', () => {
  it('treats a rule as informational only when the rule says so', () => {
    expect(isInformationalRule({ rule_code: 'A', rule_name: 'A', fail_action: 'INFO' })).toBe(true);
    expect(isInformationalRule({
      rule_code: 'B', rule_name: 'B', fail_action: 'REJECT', rule_definition: { informational: true },
    })).toBe(true);
    // A missing field mapping must NOT make a rule informational.
    expect(isInformationalRule({
      rule_code: 'C', rule_name: 'C', fail_action: 'REJECT', rule_definition: {},
    })).toBe(false);
  });

  it('does not itself block, but is not evidence the claimant qualifies', async () => {
    stubFields({ 'person.age_at_claim_date': 65, 'contribution.total_weeks': 120 });
    const traces = await evaluateEligibilityRules(
      [
        ...AGE_GRANT_RULES,
        { rule_code: 'NOTE-1', rule_name: 'Advisory note', fail_action: 'INFO', rule_definition: {} },
      ],
      ctx,
    );
    const note = traces.find(t => t.rule_code === 'NOTE-1')!;
    expect(note.result_state).toBe('INFO');

    const sum = summariseEligibility(traces);
    // The note neither fails nor holds the claim...
    expect(sum.failed).toHaveLength(0);
    expect(sum.unevaluated).toHaveLength(0);
    expect(sum.verdict).toBe('PASSED');
    // ...but it does not count towards coverage either (BUG-30).
    expect(sum.coverageLabel).toBe('3 of 4 rules evaluated');
  });
});

describe('severity does not decide whether a failure counts', () => {
  it.each(['REJECT', 'BLOCK', 'REFER', 'WARN'])(
    'a failed rule with fail_action=%s still blocks',
    async (failAction) => {
      stubFields({ 'person.age_at_claim_date': 43 });
      const traces = await evaluateEligibilityRules(
        [{ ...AGE_GRANT_RULES[0], fail_action: failAction }],
        ctx,
      );
      expect(traces[0].result_state).toBe('FAIL');
      expect(summariseEligibility(traces).overall).toBe(false);
    },
  );
});

describe('rules referencing the fact registry also evaluate', () => {
  it('resolves an EXISTS-style fact through resolveFact and can FAIL on it', async () => {
    // AGEG-NOT-ON-PENSION lives in eligibilityFactRegistry, not fieldRegistry.
    resolveFactMock.mockReset();
    resolveFactMock.mockResolvedValue({
      fact_key: 'existing.contributory_pension_exists',
      value: true,
      source_table: 'bn_award',
      source_column: '*',
      resolved_at: '',
    });

    const traces = await evaluateEligibilityRules([{
      rule_code: 'AGEG-NOT-ON-PENSION', rule_name: 'Not already on a contributory pension',
      fail_action: 'REJECT', fact_key: 'existing.contributory_pension_exists',
      rule_definition: { value: false },
    }], ctx);

    expect(traces[0].field_key).toBe('existing.contributory_pension_exists');
    expect(traces[0].result_state).toBe('FAIL');
    expect(summariseEligibility(traces).overall).toBe(false);
  });

  it('records a fact whose resolver could not run as UNEVALUATED', async () => {
    resolveFactMock.mockReset();
    resolveFactMock.mockResolvedValue({
      fact_key: 'medical.disablement_percentage',
      value: null,
      source_table: 'bn_medical_board',
      source_column: 'percentage',
      resolved_at: '',
      reason: 'no medical board decision recorded for this claim',
    });

    const traces = await evaluateEligibilityRules([{
      rule_code: 'DIS-PCT', rule_name: 'Disablement at least 30%',
      fail_action: 'REJECT', fact_key: 'medical.disablement_percentage',
      rule_definition: { value: 30, operator: '>=' },
    }], ctx);

    expect(traces[0].result_state).toBe('UNEVALUATED');
    expect(traces[0].unevaluated_reason).toContain('no medical board decision');
  });
});

describe('BUG-30 — a verdict of PASSED must mean something was checked', () => {
  it('does NOT report PASSED when no rule was evaluated', async () => {
    stubFields({});
    const traces = await evaluateEligibilityRules(
      [
        { rule_code: 'L1', rule_name: 'Legacy 1', fail_action: 'INFO', rule_definition: {} },
        { rule_code: 'L2', rule_name: 'Legacy 2', fail_action: 'INFO', rule_definition: {} },
      ],
      ctx,
    );
    const sum = summariseEligibility(traces);
    // Nothing failed — but nothing was compared either.
    expect(sum.failed).toHaveLength(0);
    expect(sum.evaluatedCount).toBe(0);
    expect(sum.verdict).toBe('NOT_DETERMINED');
    expect(sum.overall).toBe(false);
    expect(sum.coverageLabel).toBe('0 of 2 rules evaluated');
  });

  it('does NOT report PASSED when the product version has no rules at all', () => {
    const sum = summariseEligibility([]);
    expect(sum.verdict).toBe('NOT_DETERMINED');
    expect(sum.overall).toBe(false);
    expect(sum.coverageLabel).toBe('0 of 0 rules evaluated');
  });

  it('reports NOT_DETERMINED, not PASSED, when only some rules were evaluated', async () => {
    stubFields({ 'person.age_at_claim_date': 65 });
    const traces = await evaluateEligibilityRules(
      [
        AGE_GRANT_RULES[0],
        { rule_code: 'UNMAPPED', rule_name: 'Unmapped rule', fail_action: 'REJECT', rule_definition: {} },
      ],
      ctx,
    );
    const sum = summariseEligibility(traces);
    expect(sum.passed).toHaveLength(1);
    expect(sum.failed).toHaveLength(0);
    expect(sum.verdict).toBe('NOT_DETERMINED');
    expect(sum.coverageLabel).toBe('1 of 2 rules evaluated');
  });

  it('a genuine failure still reports FAILED, distinct from undetermined', async () => {
    stubFields({ 'person.age_at_claim_date': 43, 'contribution.total_weeks': 6 });
    const sum = summariseEligibility(await evaluateEligibilityRules(AGE_GRANT_RULES, ctx));
    expect(sum.verdict).toBe('FAILED');
    expect(sum.coverageLabel).toBe('3 of 3 rules evaluated');
  });

  it('reports PASSED only when every rule was compared and satisfied', async () => {
    stubFields({ 'person.age_at_claim_date': 65, 'contribution.total_weeks': 120 });
    const sum = summariseEligibility(await evaluateEligibilityRules(AGE_GRANT_RULES, ctx));
    expect(sum.verdict).toBe('PASSED');
    expect(sum.overall).toBe(true);
    expect(sum.coverageLabel).toBe('3 of 3 rules evaluated');
  });
});

describe('BUG-31 — a rule must not block a claim just because its field is unregistered', () => {
  it('recognises any document.<code>.status field by pattern', () => {
    // Registered explicitly.
    expect(lookupField('document.medical_certificate.status')).toMatchObject({ registry: 'fact' });
    // Not in the registry, but resolvable from the key itself.
    for (const key of [
      'document.preauth.status',
      'document.medical_referral.status',
      'document.education_certificate.status',
      'document.dependency_affidavit.status',
    ]) {
      expect(lookupField(key), key).toMatchObject({ registry: 'fact', valueType: 'string' });
    }
    // Still refuses anything that is not a document status.
    expect(lookupField('document.preauth')).toBeUndefined();
    expect(lookupField('beneficiary.is_orphan')).toBeUndefined();
  });

  it('evaluates an unregistered document-status rule instead of blocking on it', async () => {
    resolveFactMock.mockReset();
    resolveFactMock.mockResolvedValue({
      fact_key: 'document.preauth.status',
      value: 'PENDING',
      source_table: 'bn_claim_document',
      source_column: 'verification_status',
      resolved_at: '',
    });

    const traces = await evaluateEligibilityRules([{
      rule_code: 'MED-PREAUTH', rule_name: 'Pre-authorisation verified',
      fail_action: 'REJECT', fact_key: 'document.preauth.status',
      rule_definition: { value: 'VERIFIED', operator: '=' },
    }], ctx);

    // A real comparison — PENDING is not VERIFIED, so it fails rather than
    // being waved through as unevaluable.
    expect(traces[0].result_state).toBe('FAIL');
    expect(traces[0].actual_value).toBe('PENDING');
  });

  it('maps the legacy names found on live ACTIVE versions', () => {
    const cases: [string, string][] = [
      ['total_weeks', 'contribution.total_weeks'],
      ['has_active_age_pension', 'existing.contributory_pension_exists'],
      ['loss_of_faculty_pct', 'medical.disablement_percentage'],
    ];
    for (const [legacy, canonical] of cases) {
      expect(
        resolveRuleFieldKey({ rule_code: 'X', rule_name: 'X', rule_definition: { fact: legacy, value: 1 } }),
        legacy,
      ).toMatchObject({ key: canonical, source: 'alias' });
    }
  });

  it('does NOT invent a mapping for a name whose meaning is only similar', () => {
    // Equating these to a registry fact would repeat BUG-31's mismatched-rule
    // defect, so they stay unmapped and block until the rule is corrected.
    for (const name of ['beneficiary.is_orphan', 'claim.is_emergency', 'refund_trigger_event']) {
      expect(
        resolveRuleFieldKey({ rule_code: 'X', rule_name: 'X', rule_definition: { fact: name, value: 1 } }),
        name,
      ).toMatchObject({ key: null, rawKey: name });
    }
  });
});

describe('configured wording reaches the evaluated trace', () => {
  it('renders requirement, detail and citation from the rule row', async () => {
    stubFields({ 'person.age_at_claim_date': 43 });
    const traces = await evaluateEligibilityRules([{
      rule_code: 'AGEG-AGE',
      rule_name: 'Claimant at pensionable age (62+)',
      fail_action: 'REJECT',
      fact_key: 'person.age_at_claim_date',
      fail_message: 'Claimant is under pensionable age',
      message_template: 'Claimant must be at least {{expected}} at the claim date',
      legislative_reference: 'Social Security Act, St. Kitts & Nevis',
      rule_definition: { value: 62, operator: '>=' },
    } as any], ctx);

    const t = traces[0];
    expect(t.result_state).toBe('FAIL');
    // FAIL takes the configured fail_message, not a string from the evaluator.
    expect(t.requirement).toBe('Claimant is under pensionable age');
    expect(t.detail).toBe('Age at claim date: 43');
    expect(t.reference).toBe('Social Security Act, St. Kitts & Nevis');
  });

  it('applies the rule’s unit to the reported value', async () => {
    stubFields({ 'contribution.total_weeks': 6 });
    const traces = await evaluateEligibilityRules([{
      rule_code: 'AGEG-CONTRIB-MIN',
      rule_name: 'Contribution band',
      fail_action: 'REJECT',
      fact_key: 'contribution.total_weeks',
      unit: 'WEEKS',
      message_template: 'Requires between {{min}} and {{max}}',
      rule_definition: { min: 50, max: 499, operator: 'between' },
    } as any], ctx);

    expect(traces[0].result_state).toBe('FAIL');
    expect(traces[0].requirement).toBe('Requires between 50 weeks and 499 weeks');
    expect(traces[0].detail).toBe('Total contribution weeks: 6 weeks');
  });

  it('an unmapped rule still states the requirement it could not check', async () => {
    stubFields({});
    const traces = await evaluateEligibilityRules([{
      rule_code: 'SUR-ORPHAN-RULE',
      rule_name: 'Orphan uplift applies',
      fail_action: 'REJECT',
      fail_message: 'Child is not recorded as an orphan',
      rule_definition: { fact: 'beneficiary.is_orphan', value: true },
    } as any], ctx);

    expect(traces[0].result_state).toBe('UNEVALUATED');
    expect(traces[0].requirement).toBe('Child is not recorded as an orphan');
    expect(traces[0].detail).toContain('Not checked');
    expect(traces[0].detail).toContain('beneficiary.is_orphan');
  });
});

describe('a duplicated requirement is evaluated once, without a data migration', () => {
  // The pair BUG-31 reported on SKN-AGE: same field, same operator, same value,
  // different rule_code and different rule_name.
  const AGE_MIN_62: EvaluableRule = {
    rule_code: 'AGE-MIN-62', rule_name: 'Age at claim date ≥ 62',
    fail_action: 'REJECT', fact_key: 'person.age_at_claim_date',
    rule_definition: { value: 62, operator: '>=' },
  };
  const AGE_62: EvaluableRule = {
    rule_code: 'AGE-62', rule_name: 'Age ≥ 62',
    fail_action: 'REJECT', fact_key: 'person.age_at_claim_date',
    rule_definition: { value: 62, operator: '>=' },
  };

  it('treats them as the same requirement regardless of code or name', () => {
    expect(requirementKey(AGE_MIN_62)).toBe(requirementKey(AGE_62));
    // A different threshold is a different requirement.
    expect(requirementKey({ ...AGE_62, rule_definition: { value: 65, operator: '>=' } }))
      .not.toBe(requirementKey(AGE_62));
  });

  it('keeps the first and reports the second as redundant', () => {
    const { rules, duplicates } = dedupeByRequirement([AGE_MIN_62, AGE_62]);
    expect(rules.map(r => r.rule_code)).toEqual(['AGE-MIN-62']);
    expect(duplicates).toEqual([{ rule: AGE_62, duplicateOf: 'AGE-MIN-62' }]);
  });

  it('evaluates the requirement once, and the verdict is unchanged', async () => {
    stubFields({ 'person.age_at_claim_date': 43 });
    const { traces, duplicates } = await evaluateEligibilityRulesWithDuplicates(
      [AGE_MIN_62, AGE_62], ctx,
    );
    expect(traces).toHaveLength(1);
    expect(traces[0].result_state).toBe('FAIL');
    expect(duplicates).toEqual([{ rule_code: 'AGE-62', duplicateOf: 'AGE-MIN-62' }]);
    // Dropping an identical requirement cannot change the outcome.
    expect(summariseEligibility(traces).verdict).toBe('FAILED');
  });

  it('never collapses two rules that could not be mapped', () => {
    // Both unmappable — they are different requirements that happen to be
    // unreadable, so each must be reported on its own.
    const a: EvaluableRule = { rule_code: 'A', rule_name: 'A', rule_definition: { fact: 'claim.is_emergency', value: true } };
    const b: EvaluableRule = { rule_code: 'B', rule_name: 'B', rule_definition: { fact: 'beneficiary.is_orphan', value: true } };
    const { rules, duplicates } = dedupeByRequirement([a, b]);
    expect(rules).toHaveLength(2);
    expect(duplicates).toHaveLength(0);
  });
});

/**
 * BUG-32, as corrected against the official SSB guidance.
 *
 * The original report said "only a female member may claim Maternity Benefit or
 * Maternity Grant". That is right for the Benefit/Allowance and wrong for the
 * Grant: SSB states the Grant may be paid on the contributions of the insured
 * husband where the mother does not qualify on her own record, and its claim
 * form asks the claimant "Are you the wife of an insured man?".
 *
 * So the claimant is the woman in BOTH products — only the contribution BASIS
 * differs. A single "must be female" rule is therefore correct on both; what
 * the engine was missing was any way to express "her record OR his".
 */
describe('BUG-32 — the claimant is the woman in both maternity products', () => {
  const MUST_BE_FEMALE: EvaluableRule = {
    rule_code: 'MAT-FEMALE', rule_name: 'Claimant must be female',
    fail_action: 'REJECT', fact_key: 'person.gender',
    fail_message: 'Only a female member may claim a maternity benefit',
    rule_definition: { value: 'F', operator: '=' },
  };

  it('rejects a male claimant', async () => {
    stubFields({ 'person.gender': 'M' });
    const traces = await evaluateEligibilityRules([MUST_BE_FEMALE], ctx);
    expect(traces[0].result_state).toBe('FAIL');
    expect(traces[0].requirement).toBe('Only a female member may claim a maternity benefit');
    expect(summariseEligibility(traces).verdict).toBe('FAILED');
  });

  it('accepts a female claimant', async () => {
    stubFields({ 'person.gender': 'F' });
    const sum = summariseEligibility(await evaluateEligibilityRules([MUST_BE_FEMALE], ctx));
    expect(sum.verdict).toBe('PASSED');
  });

  it('does not silently pass when gender is not recorded', async () => {
    stubFields({ 'person.gender': null });
    const traces = await evaluateEligibilityRules([MUST_BE_FEMALE], ctx);
    expect(traces[0].result_state).toBe('UNEVALUATED');
    expect(summariseEligibility(traces).verdict).toBe('NOT_DETERMINED');
  });
});

describe('BUG-32 — the Maternity Grant contribution basis: hers OR her husband’s', () => {
  // Two lawful routes to ONE requirement, declared as a shared group.
  const HER_RECORD: EvaluableRule = {
    rule_code: 'MATG-CONTRIB-OWN', rule_name: 'Own contributions',
    fail_action: 'REJECT', fact_key: 'contribution.total_weeks',
    fail_message: 'Claimant has fewer than 39 contribution weeks',
    rule_definition: { value: 39, operator: '>=', alternative_group: 'MATG_CONTRIB_BASIS' },
  };
  const HIS_RECORD: EvaluableRule = {
    rule_code: 'MATG-CONTRIB-SPOUSE', rule_name: 'Insured husband’s contributions',
    fail_action: 'REJECT', fact_key: 'spouse.contribution.total_weeks',
    fail_message: 'Insured husband has fewer than 39 contribution weeks',
    rule_definition: { value: 39, operator: '>=', alternative_group: 'MATG_CONTRIB_BASIS' },
  };

  it('qualifies on her own record', async () => {
    stubFields({ 'contribution.total_weeks': 45, 'spouse.contribution.total_weeks': 0 });
    const sum = summariseEligibility(await evaluateEligibilityRules([HER_RECORD, HIS_RECORD], ctx));
    expect(sum.verdict).toBe('PASSED');
    expect(sum.satisfiedGroups).toEqual(['MATG_CONTRIB_BASIS']);
    // One requirement, not two — the route not taken is not a failure.
    expect(sum.coverageLabel).toBe('1 of 1 requirement evaluated');
    expect(sum.failed).toHaveLength(0);
  });

  it('qualifies on the insured husband’s record when she does not', async () => {
    stubFields({ 'contribution.total_weeks': 6, 'spouse.contribution.total_weeks': 120 });
    const sum = summariseEligibility(await evaluateEligibilityRules([HER_RECORD, HIS_RECORD], ctx));
    expect(sum.verdict).toBe('PASSED');
    expect(sum.satisfiedGroups).toEqual(['MATG_CONTRIB_BASIS']);
  });

  it('fails only when neither record qualifies', async () => {
    stubFields({ 'contribution.total_weeks': 6, 'spouse.contribution.total_weeks': 10 });
    const sum = summariseEligibility(await evaluateEligibilityRules([HER_RECORD, HIS_RECORD], ctx));
    expect(sum.verdict).toBe('FAILED');
    expect(sum.failed.map(t => t.rule_code).sort())
      .toEqual(['MATG-CONTRIB-OWN', 'MATG-CONTRIB-SPOUSE']);
    expect(sum.unsatisfiedGroups).toEqual(['MATG_CONTRIB_BASIS']);
  });

  it('is undetermined, not failed, when a route could not be checked', async () => {
    // No spouse recorded — we cannot say she does not qualify when one of the
    // ways she might have qualified was never checked.
    stubFields({ 'contribution.total_weeks': 6, 'spouse.contribution.total_weeks': null });
    const sum = summariseEligibility(await evaluateEligibilityRules([HER_RECORD, HIS_RECORD], ctx));
    expect(sum.verdict).toBe('NOT_DETERMINED');
    expect(sum.unevaluated.map(t => t.rule_code)).toEqual(['MATG-CONTRIB-SPOUSE']);
  });

  it('without a group the engine still requires BOTH — the old behaviour', async () => {
    stubFields({ 'contribution.total_weeks': 6, 'spouse.contribution.total_weeks': 120 });
    const plain = [
      { ...HER_RECORD, rule_definition: { value: 39, operator: '>=' } },
      { ...HIS_RECORD, rule_definition: { value: 39, operator: '>=' } },
    ];
    const sum = summariseEligibility(await evaluateEligibilityRules(plain, ctx));
    // This is why the group is needed: expressed as two plain rules, a woman
    // who qualifies on her husband's record is refused.
    expect(sum.verdict).toBe('FAILED');
  });
});

describe('rules attached from the Rule Catalogue are readable', () => {
  // AddRulesByCategoryDialog writes { parameter, operator, value_from, value_to,
  // values } — not { field_key, operator, value }. Reading only the latter made
  // every catalogue-attached rule unevaluable, blocking the claim.
  it('reads value_from as a lower bound', async () => {
    stubFields({ 'contribution.paid_weeks': 30 });
    const traces = await evaluateEligibilityRules([{
      rule_code: 'CAT-MIN-26', rule_name: 'At least 26 paid weeks',
      fail_action: 'REJECT', fact_key: 'contribution.paid_weeks',
      rule_definition: { parameter: 'CAT-MIN-26', operator: '>=', value_from: 26 },
    } as any], ctx);
    expect(traces[0].result_state).toBe('PASS');
    expect(traces[0].expected_value).toBe(26);
  });

  it('reads value_from + value_to as a range', async () => {
    stubFields({ 'person.age_at_claim_date': 40 });
    const traces = await evaluateEligibilityRules([{
      rule_code: 'CAT-AGE-BAND', rule_name: 'Age 16 to 62',
      fail_action: 'REJECT', fact_key: 'person.age_at_claim_date',
      rule_definition: { parameter: 'CAT-AGE-BAND', operator: 'between', value_from: 16, value_to: 62 },
    } as any], ctx);
    expect(traces[0].result_state).toBe('PASS');
    expect(traces[0].operator).toBe('BETWEEN');
  });

  it('fails a claimant outside a catalogue range', async () => {
    stubFields({ 'person.age_at_claim_date': 70 });
    const traces = await evaluateEligibilityRules([{
      rule_code: 'CAT-AGE-BAND', rule_name: 'Age 16 to 62',
      fail_action: 'REJECT', fact_key: 'person.age_at_claim_date',
      rule_definition: { parameter: 'CAT-AGE-BAND', operator: 'between', value_from: 16, value_to: 62 },
    } as any], ctx);
    expect(traces[0].result_state).toBe('FAIL');
  });

  it('reads a values list as IN', async () => {
    stubFields({ 'person.status': 'ACTIVE' });
    const traces = await evaluateEligibilityRules([{
      rule_code: 'CAT-STATUS', rule_name: 'Person status allowed',
      fail_action: 'REJECT', fact_key: 'person.status',
      rule_definition: { parameter: 'CAT-STATUS', operator: 'in', values: ['ACTIVE', 'PENDING'] },
    } as any], ctx);
    expect(traces[0].result_state).toBe('PASS');
    expect(traces[0].operator).toBe('IN');
  });
});
