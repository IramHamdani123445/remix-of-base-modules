/**
 * Eligibility Rule Templates — "Quick Add" presets surfaced in the rule builder.
 *
 * Each template pre-fills a rule row with a fact, operator, default value and
 * group. The business user can adjust the value before saving.
 *
 * Templates only reference facts that exist in the registry — the validator
 * catches drift.
 */

import type { EligibilityOperator } from './operators';
import type { RuleGroupCode } from './eligibilityFactRegistry';

export interface RuleTemplate {
  template_code: string;
  label: string;
  description: string;
  fact_key: string;
  operator: EligibilityOperator;
  default_value: unknown;
  group_code: RuleGroupCode;
  severity?: 'BLOCK' | 'WARN';
  overrideable?: boolean;
}

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    template_code: 'MIN_AGE',
    label: 'Minimum Age',
    description: 'Claimant must be at least N years old on the claim date.',
    fact_key: 'person.age_at_claim_date',
    operator: '>=',
    default_value: 16,
    group_code: 'CORE_IDENTITY',
  },
  {
    template_code: 'MAX_AGE',
    label: 'Maximum Age',
    description: 'Claimant must be no older than N years on the claim date.',
    fact_key: 'person.age_at_claim_date',
    operator: '<=',
    default_value: 62,
    group_code: 'CORE_IDENTITY',
  },
  {
    template_code: 'MIN_PAID_CONTRIBUTIONS',
    label: 'Minimum Paid Contributions',
    description: 'Paid contribution weeks must reach the configured minimum.',
    fact_key: 'contribution.paid_weeks',
    operator: '>=',
    default_value: 150,
    group_code: 'CONTRIBUTION',
  },
  {
    template_code: 'MIN_RECENT_CONTRIBUTIONS',
    label: 'Minimum Recent Contributions',
    description: 'Recent-window contribution weeks must reach the minimum.',
    fact_key: 'contribution.recent_weeks',
    operator: '>=',
    default_value: 8,
    group_code: 'CONTRIBUTION',
  },
  {
    template_code: 'EMPLOYER_ACTIVE',
    label: 'Employer Must Be Active',
    description: 'Claimant must have an active employer on file.',
    fact_key: 'employer.status',
    operator: '=',
    default_value: 'ACTIVE',
    group_code: 'EMPLOYMENT',
  },
  {
    template_code: 'MEDICAL_CERT_REQUIRED',
    label: 'Medical Certificate Required',
    description: 'A medical certificate must be attached to the claim.',
    fact_key: 'document.medical_certificate_received',
    operator: '=',
    default_value: true,
    group_code: 'EVIDENCE',
  },
  {
    template_code: 'DEATH_CERT_REQUIRED',
    label: 'Death Certificate Required',
    description: 'A death certificate must be attached to the claim.',
    fact_key: 'document.death_certificate_received',
    operator: '=',
    default_value: true,
    group_code: 'EVIDENCE',
  },
  {
    template_code: 'NO_DUPLICATE_CLAIM',
    label: 'No Duplicate Claim',
    description: 'No overlapping claim for the same product/period.',
    fact_key: 'existing.duplicate_claim_same_period',
    operator: '=',
    default_value: false,
    group_code: 'EXISTING_BENEFIT',
  },
  {
    template_code: 'EXISTING_AWARD_REQUIRED',
    label: 'Existing Award Required',
    description: 'An active award must already exist for this claimant.',
    fact_key: 'existing.active_award',
    operator: '=',
    default_value: true,
    group_code: 'EXISTING_BENEFIT',
  },
  {
    template_code: 'ACTIVE_AWARD_REQUIRED',
    label: 'Active Award Required',
    description: 'Same as Existing Award Required — gated explicitly for LC/SC flows.',
    fact_key: 'existing.active_award',
    operator: '=',
    default_value: true,
    group_code: 'EXISTING_BENEFIT',
  },
  {
    template_code: 'INJURY_REPORTED_WITHIN',
    label: 'Injury Reported Within X Days',
    description: 'Days between event and submission must be within the limit.',
    fact_key: 'claim.days_since_event',
    operator: '<=',
    default_value: 90,
    group_code: 'EVENT',
  },
  {
    template_code: 'MUST_BE_FEMALE',
    label: 'Claimant Must Be Female',
    // BUG-32 — the claimant is the woman for BOTH maternity products. SSB pays
    // the Maternity Grant on the insured husband's CONTRIBUTIONS, but the woman
    // is still the claimant, so this rule belongs on the Grant as well as the
    // Allowance. The husband's record is expressed by the contribution rules,
    // not by relaxing this one.
    description: 'Only a female member may claim a maternity benefit or grant.',
    fact_key: 'person.gender',
    operator: '=',
    default_value: 'F',
    group_code: 'CORE_IDENTITY',
  },
  {
    template_code: 'MUST_BE_DECEASED_CONTRIBUTOR',
    label: 'Must Be Deceased Contributor',
    description: 'Used by survivors and funeral grants.',
    fact_key: 'person.alive_status',
    operator: '=',
    default_value: 'DECEASED',
    group_code: 'CORE_IDENTITY',
  },
  {
    template_code: 'SCHOOL_CERT_REQUIRED',
    label: 'School Certificate Required',
    description: 'Survivor child benefit beyond the basic age limit.',
    fact_key: 'document.birth_certificate_received',
    operator: '=',
    default_value: true,
    group_code: 'EVIDENCE',
  },
  {
    template_code: 'MEANS_TEST_PASSED',
    label: 'Means Test Passed',
    description: 'Placeholder for assistance pensions — wire to means resolver.',
    fact_key: 'existing.active_award',
    operator: '=',
    default_value: false,
    group_code: 'SPECIAL',
    severity: 'WARN',
    overrideable: true,
  },
];

export function getTemplate(code: string): RuleTemplate | undefined {
  return RULE_TEMPLATES.find((t) => t.template_code === code);
}
