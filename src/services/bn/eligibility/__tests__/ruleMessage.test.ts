/**
 * Validation messages must come from the rule's configuration, not from
 * strings baked into the evaluator.
 *
 * The rules below are real rows from bn_eligibility_rule, including their
 * configured message_template, fail_message, unit and legislative_reference.
 */
import { describe, it, expect } from 'vitest';
import {
  renderRuleMessage,
  formatRuleValue,
  ruleReference,
  summariseBlockingRules,
  type MessageRule,
} from '../ruleMessage';

const AGE_MIN_62: MessageRule = {
  rule_code: 'AGE-MIN-62',
  rule_name: 'Age at claim date ≥ 62',
  message_template: 'Claimant must be at least 62 years old at claim date',
  fail_message: 'Claimant is under retirement age',
  legislative_reference: 'Social Security Act, St. Kitts & Nevis',
  source_section: 's.34(1)',
};

const SICK_LATE: MessageRule = {
  rule_code: 'SICK-LATE-CLAIM-14D',
  rule_name: 'Claim submitted within 14 days',
  message_template: 'Submission must be within 14 days of sickness start date',
  fail_message: 'Claim submitted more than 14 days after sickness start',
  unit: 'DAYS',
};

describe('the configured wording is what reaches the screen', () => {
  it('uses message_template on a pass and fail_message on a failure', () => {
    const pass = renderRuleMessage(AGE_MIN_62, 'PASS', {
      fieldLabel: 'Age at claim date', operator: '>=', expected: 62, actual: 65,
    });
    expect(pass.requirement).toBe('Claimant must be at least 62 years old at claim date');

    const fail = renderRuleMessage(AGE_MIN_62, 'FAIL', {
      fieldLabel: 'Age at claim date', operator: '>=', expected: 62, actual: 43,
    });
    expect(fail.requirement).toBe('Claimant is under retirement age');
  });

  it('reports the claimant value separately from the requirement', () => {
    const fail = renderRuleMessage(AGE_MIN_62, 'FAIL', {
      fieldLabel: 'Age at claim date', operator: '>=', expected: 62, actual: 43,
    });
    expect(fail.detail).toBe('Age at claim date: 43');
    expect(fail.text).toBe('Claimant is under retirement age — Age at claim date: 43');
  });

  it('carries the configured statutory citation', () => {
    expect(ruleReference(AGE_MIN_62)).toBe('Social Security Act, St. Kitts & Nevis, s.34(1)');
    expect(renderRuleMessage(AGE_MIN_62, 'FAIL', {}).reference)
      .toBe('Social Security Act, St. Kitts & Nevis, s.34(1)');
    // A rule with no citation configured invents none.
    expect(ruleReference({ rule_code: 'X', rule_name: 'X' })).toBeNull();
  });

  it('applies the rule\'s configured unit to both values', () => {
    const fail = renderRuleMessage(SICK_LATE, 'FAIL', {
      fieldLabel: 'Days since sickness start', operator: '<=', expected: 14, actual: 21,
    });
    expect(fail.detail).toBe('Days since sickness start: 21 days');
    expect(formatRuleValue(1, 'DAYS')).toBe('1 day');
    expect(formatRuleValue(6, 'WEEKS')).toBe('6 weeks');
    expect(formatRuleValue(2.567, 'YEARS')).toBe('2.57 years');
    expect(formatRuleValue(true)).toBe('yes');
    expect(formatRuleValue(null)).toBe('—');
  });
});

describe('placeholders in a configured template', () => {
  const templated: MessageRule = {
    rule_code: 'AGEG-CONTRIB-MIN',
    rule_name: 'Contribution band',
    message_template: 'Requires between {{min}} and {{max}} contribution weeks; record shows {{actual}}',
    unit: 'WEEKS',
  };

  it('substitutes the values the rule was evaluated with', () => {
    const msg = renderRuleMessage(templated, 'FAIL', {
      fieldLabel: 'Total contribution weeks', operator: 'BETWEEN', min: 50, max: 499, actual: 6,
    });
    expect(msg.requirement)
      .toBe('Requires between 50 weeks and 499 weeks contribution weeks; record shows 6 weeks');
  });

  it('substitutes field, operator, rule and claim placeholders', () => {
    const msg = renderRuleMessage(
      { rule_code: 'R1', rule_name: 'Rule one', message_template: '{{rule_code}}/{{rule_name}}: {{field}} {{operator}} {{expected}} on {{claim_date}}' },
      'PASS',
      { fieldLabel: 'Age at claim date', operator: '>=', expected: 62, claimDate: '2026-08-17' },
    );
    expect(msg.requirement).toBe('R1/Rule one: Age at claim date >= 62 on 2026-08-17');
  });

  it('leaves an unknown placeholder untouched rather than blanking it', () => {
    const msg = renderRuleMessage(
      { rule_code: 'R', rule_name: 'R', message_template: 'keep {{not_a_field}} as-is' },
      'PASS',
    );
    expect(msg.requirement).toBe('keep {{not_a_field}} as-is');
  });

  it('renders a template that has no placeholders unchanged', () => {
    // Most live templates are plain statements — they must not be mangled.
    expect(renderRuleMessage(SICK_LATE, 'PASS', { actual: 3 }).requirement)
      .toBe('Submission must be within 14 days of sickness start date');
  });
});

describe('a rule that configures no wording still reads sensibly', () => {
  it('builds the requirement from the field, operator and value', () => {
    const msg = renderRuleMessage(
      { rule_code: 'BARE', rule_name: 'Bare rule' },
      'FAIL',
      { fieldLabel: 'Total contribution weeks', operator: '>=', expected: 26, actual: 6 },
    );
    expect(msg.requirement).toBe('Total contribution weeks must be at least 26');
    expect(msg.detail).toBe('Total contribution weeks: 6');
  });

  it('describes a range requirement', () => {
    const msg = renderRuleMessage(
      { rule_code: 'BARE2', rule_name: 'Bare range', unit: 'WEEKS' },
      'FAIL',
      { fieldLabel: 'Total contribution weeks', operator: 'BETWEEN', min: 50, max: 499, actual: 6 },
    );
    expect(msg.requirement).toBe('Total contribution weeks must be between 50 weeks and 499 weeks');
  });
});

describe('an unevaluated rule still states what was not checked', () => {
  it('keeps the configured requirement and names the cause', () => {
    const msg = renderRuleMessage(AGE_MIN_62, 'UNEVALUATED', {
      fieldLabel: 'Age at claim date',
      unevaluatedReason: 'date of birth is not recorded for this claimant',
    });
    // The officer sees WHAT was not checked, not merely that something wasn't.
    expect(msg.requirement).toBe('Claimant must be at least 62 years old at claim date');
    expect(msg.detail).toBe('Not checked — date of birth is not recorded for this claimant.');
  });
});

describe('blocking summary quotes the rules, not their codes', () => {
  it('lists the configured requirement and the recorded value', () => {
    const text = summariseBlockingRules([
      { rule_code: 'AGEG-AGE', requirement: 'Claimant must be at least 62', detail: 'Age at claim date: 43' },
      { rule_code: 'AGEG-CONTRIB-MIN', requirement: 'Requires 50 to 499 weeks', detail: 'Total contribution weeks: 6' },
    ]);
    expect(text).toBe(
      'Claimant must be at least 62 (Age at claim date: 43); ' +
      'Requires 50 to 499 weeks (Total contribution weeks: 6)',
    );
    expect(text).not.toContain('AGEG-AGE');
  });

  it('caps the list and says how many more there are', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      rule_code: `R${i}`, requirement: `Requirement ${i}`, detail: null,
    }));
    expect(summariseBlockingRules(many)).toBe(
      'Requirement 0; Requirement 1; Requirement 2; and 2 more',
    );
  });
});
