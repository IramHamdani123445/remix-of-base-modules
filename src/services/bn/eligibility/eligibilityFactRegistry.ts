/**
 * Eligibility Fact Registry — the single source of truth for facts the rule
 * engine and rule builder UI can reference.
 *
 * Every fact maps to:
 *   • A real source table/column in the BN platform (audit trail / explainability)
 *   • A resolver function name (registered in `eligibilityFactResolver.ts`)
 *   • The data type + allowed operators (drives the UI dropdowns)
 *   • The products it applies to (`['*']` = all products)
 *
 * Free-text facts are not permitted. The product activation validator rejects
 * any rule whose `fact_key` is not in this registry.
 */

import type {
  EligibilityDataType,
  EligibilityOperator,
} from './operators';

export type EligibilityCategory =
  | 'PERSON'
  | 'CONTRIBUTION'
  | 'EMPLOYER'
  | 'CLAIM_EVENT'
  | 'MEDICAL'
  | 'DOCUMENTS'
  | 'EXISTING_BENEFITS'
  | 'PAYMENT_AWARD'
  | 'SPECIAL';

export interface EligibilityFact {
  fact_key: string;
  label: string;
  category: EligibilityCategory;
  description: string;
  /** Primary source table for traceability (shown in rule preview). */
  source_table: string;
  /** Primary source column. Use `*` when the value is derived. */
  source_column: string;
  /** Name of the resolver function in `eligibilityFactResolver.ts`. */
  resolver_function: string;
  data_type: EligibilityDataType;
  allowed_operators: EligibilityOperator[];
  /** For enum/bool facts — list of legal expected values. */
  allowed_values?: Array<string | number | boolean>;
  /** Benefit codes this fact applies to. `['*']` = all. */
  applicable_products: string[];
  /** Example used in rule preview. */
  example_value: string | number | boolean;
}

export const CATEGORY_LABELS: Record<EligibilityCategory, string> = {
  PERSON: 'Person',
  CONTRIBUTION: 'Contribution',
  EMPLOYER: 'Employer',
  CLAIM_EVENT: 'Claim Event',
  MEDICAL: 'Medical',
  DOCUMENTS: 'Documents',
  EXISTING_BENEFITS: 'Existing Benefits',
  PAYMENT_AWARD: 'Payment / Award',
  SPECIAL: 'Special',
};

const ALL: string[] = ['*'];

export const ELIGIBILITY_FACTS: EligibilityFact[] = [
  // ───────────────────── Person ─────────────────────
  {
    fact_key: 'person.age_at_claim_date',
    label: 'Age at claim date',
    category: 'PERSON',
    description: 'Claimant age in completed years on the claim date.',
    source_table: 'ip_master',
    source_column: 'date_of_birth',
    resolver_function: 'resolvePersonAge',
    data_type: 'number',
    allowed_operators: ['>=', '<=', '>', '<', '=', '!=', 'between'],
    applicable_products: ALL,
    example_value: 62,
  },
  {
    fact_key: 'person.gender',
    label: 'Gender',
    category: 'PERSON',
    description: 'Stored gender of the claimant (M / F / N).',
    source_table: 'ip_master',
    // ip_master stores this as `sex`; the resolver already reads that column.
    source_column: 'sex',
    resolver_function: 'resolvePersonGender',
    data_type: 'enum',
    allowed_operators: ['=', '!=', 'in'],
    allowed_values: ['M', 'F', 'N'],
    applicable_products: ALL,
    example_value: 'F',
  },
  {
    fact_key: 'person.alive_status',
    label: 'Alive / deceased status',
    category: 'PERSON',
    description: 'Whether the contributor is alive or deceased.',
    source_table: 'ip_master',
    source_column: 'status',
    resolver_function: 'resolvePersonAlive',
    data_type: 'enum',
    allowed_operators: ['=', '!=', 'in'],
    allowed_values: ['ALIVE', 'DECEASED'],
    applicable_products: ALL,
    example_value: 'DECEASED',
  },

  // ───────────────── Contribution ─────────────────
  {
    fact_key: 'contribution.total_weeks',
    label: 'Total contribution weeks',
    category: 'CONTRIBUTION',
    description: 'Paid + credited weeks across the claimant history.',
    source_table: 'bn_claim_contribution_snapshot / ip_wages',
    source_column: 'total_weeks',
    resolver_function: 'resolveContribTotalWeeks',
    data_type: 'number',
    allowed_operators: ['>=', '<=', '>', '<', '=', '!=', 'between'],
    applicable_products: ALL,
    example_value: 500,
  },
  {
    fact_key: 'contribution.paid_weeks',
    label: 'Paid contribution weeks',
    category: 'CONTRIBUTION',
    description: 'Weeks with actually paid contributions.',
    source_table: 'bn_claim_contribution_snapshot / ip_wages',
    source_column: 'paid_weeks',
    resolver_function: 'resolveContribPaidWeeks',
    data_type: 'number',
    allowed_operators: ['>=', '<=', '>', '<', '=', '!=', 'between'],
    applicable_products: ALL,
    example_value: 150,
  },
  {
    fact_key: 'contribution.recent_weeks',
    label: 'Recent contribution weeks',
    category: 'CONTRIBUTION',
    description: 'Weeks in the most recent qualifying window (e.g. last 13 weeks).',
    source_table: 'bn_claim_contribution_snapshot / ip_wages',
    source_column: 'recent_weeks',
    resolver_function: 'resolveContribRecentWeeks',
    data_type: 'number',
    allowed_operators: ['>=', '<=', '>', '<', '=', '!=', 'between'],
    applicable_products: ALL,
    example_value: 8,
  },
  {
    fact_key: 'contribution.average_weekly_wage',
    label: 'Average weekly wage',
    category: 'CONTRIBUTION',
    description: 'Average weekly insurable wage used for benefit calculation.',
    source_table: 'bn_claim_contribution_snapshot',
    source_column: 'average_weekly_wage',
    resolver_function: 'resolveContribAvgWage',
    data_type: 'number',
    allowed_operators: ['>=', '<=', '>', '<', '=', '!=', 'between'],
    applicable_products: ALL,
    example_value: 500,
  },
  {
    fact_key: 'contribution.last_contribution_date',
    label: 'Last contribution date',
    category: 'CONTRIBUTION',
    description: 'Most recent week for which a contribution exists.',
    source_table: 'ip_wages',
    source_column: 'week_end_date',
    resolver_function: 'resolveContribLastDate',
    data_type: 'date',
    allowed_operators: ['>=', '<=', '=', '!=', 'exists', 'between'],
    applicable_products: ALL,
    example_value: '2026-01-01',
  },

  // ───────────────────── Employer ─────────────────
  {
    fact_key: 'employer.exists',
    label: 'Employer on record',
    category: 'EMPLOYER',
    description: 'Whether the claimant has an employer registered.',
    source_table: 'er_master',
    source_column: '*',
    resolver_function: 'resolveEmployerExists',
    data_type: 'bool',
    allowed_operators: ['=', 'exists'],
    allowed_values: [true, false],
    applicable_products: ALL,
    example_value: true,
  },
  {
    fact_key: 'employer.status',
    label: 'Employer status',
    category: 'EMPLOYER',
    description: 'Current employer status (Active / Ceased / Pending).',
    source_table: 'er_master',
    source_column: 'status',
    resolver_function: 'resolveEmployerStatus',
    data_type: 'enum',
    allowed_operators: ['=', '!=', 'in'],
    allowed_values: ['ACTIVE', 'CEASED', 'PENDING'],
    applicable_products: ALL,
    example_value: 'ACTIVE',
  },
  {
    fact_key: 'employer.active_on_injury_date',
    label: 'Employer active on injury date',
    category: 'EMPLOYER',
    description: 'Whether the employer was active on the claim injury date.',
    source_table: 'er_master + bn_claim',
    source_column: '*',
    resolver_function: 'resolveEmployerActiveOnInjuryDate',
    data_type: 'bool',
    allowed_operators: ['=', 'exists'],
    allowed_values: [true, false],
    applicable_products: ['SKN-EI', 'SKN-EI-DIS', 'SKN-EI-MED'],
    example_value: true,
  },

  // ─────────────────── Claim Event ────────────────
  {
    fact_key: 'claim.injury_date',
    label: 'Injury date',
    category: 'CLAIM_EVENT',
    description: 'Date of the workplace injury.',
    source_table: 'bn_claim',
    source_column: 'event_date',
    resolver_function: 'resolveClaimInjuryDate',
    data_type: 'date',
    allowed_operators: ['exists', '>=', '<=', 'between'],
    applicable_products: ['SKN-EI', 'SKN-EI-DIS', 'SKN-EI-MED'],
    example_value: '2026-01-15',
  },
  {
    fact_key: 'claim.submission_date',
    label: 'Submission date',
    category: 'CLAIM_EVENT',
    description: 'When the application was submitted.',
    source_table: 'bn_claim',
    source_column: 'created_at',
    resolver_function: 'resolveClaimSubmissionDate',
    data_type: 'date',
    allowed_operators: ['exists', '>=', '<=', 'between'],
    applicable_products: ALL,
    example_value: '2026-02-01',
  },
  {
    fact_key: 'claim.days_since_event',
    label: 'Days since event',
    category: 'CLAIM_EVENT',
    description: 'Days between the claim event date and submission date.',
    source_table: 'bn_claim (derived)',
    source_column: '*',
    resolver_function: 'resolveClaimDaysSinceEvent',
    data_type: 'number',
    allowed_operators: ['>=', '<=', '=', 'between'],
    applicable_products: ALL,
    example_value: 90,
  },
  {
    fact_key: 'claim.application_channel',
    label: 'Application channel',
    category: 'CLAIM_EVENT',
    description: 'Channel the application was received through.',
    source_table: 'bn_claim_application',
    source_column: 'application_channel',
    resolver_function: 'resolveClaimChannel',
    data_type: 'enum',
    allowed_operators: ['=', '!=', 'in'],
    allowed_values: ['PUBLIC_ONLINE', 'STAFF_OFFLINE', 'ASSISTED_COUNTER', 'CLAIMANT_PORTAL'],
    applicable_products: ALL,
    example_value: 'STAFF_OFFLINE',
  },

  // ─────────────────── Documents ──────────────────
  {
    fact_key: 'document.medical_certificate_received',
    label: 'Medical certificate received',
    category: 'DOCUMENTS',
    description: 'Whether a medical certificate document is attached to the claim.',
    source_table: 'bn_claim_evidence',
    source_column: 'document_type_code',
    resolver_function: 'resolveDocMedicalCert',
    data_type: 'bool',
    allowed_operators: ['=', 'exists'],
    allowed_values: [true, false],
    applicable_products: ALL,
    example_value: true,
  },
  {
    fact_key: 'document.death_certificate_received',
    label: 'Death certificate received',
    category: 'DOCUMENTS',
    description: 'Whether a death certificate is attached.',
    source_table: 'bn_claim_evidence',
    source_column: 'document_type_code',
    resolver_function: 'resolveDocDeathCert',
    data_type: 'bool',
    allowed_operators: ['=', 'exists'],
    allowed_values: [true, false],
    applicable_products: ['SKN-FUN', 'SKN-SURV'],
    example_value: true,
  },
  {
    fact_key: 'document.birth_certificate_received',
    label: 'Birth certificate received',
    category: 'DOCUMENTS',
    description: 'Whether a birth certificate is attached.',
    source_table: 'bn_claim_evidence',
    source_column: 'document_type_code',
    resolver_function: 'resolveDocBirthCert',
    data_type: 'bool',
    allowed_operators: ['=', 'exists'],
    allowed_values: [true, false],
    applicable_products: ALL,
    example_value: true,
  },
  {
    fact_key: 'document.employer_report_received',
    label: 'Employer report received',
    category: 'DOCUMENTS',
    description: 'Whether the employer accident report is attached.',
    source_table: 'bn_claim_evidence',
    source_column: 'document_type_code',
    resolver_function: 'resolveDocEmployerReport',
    data_type: 'bool',
    allowed_operators: ['=', 'exists'],
    allowed_values: [true, false],
    applicable_products: ['SKN-EI', 'SKN-EI-DIS', 'SKN-EI-MED'],
    example_value: true,
  },

  // ─────────────── Existing Benefits ─────────────
  {
    fact_key: 'existing.active_award',
    label: 'Active award exists',
    category: 'EXISTING_BENEFITS',
    description: 'Whether the claimant has an active award (for life cert / school cert / EFT update flows).',
    source_table: 'bn_award',
    source_column: 'status',
    resolver_function: 'resolveActiveAward',
    data_type: 'bool',
    allowed_operators: ['=', 'exists'],
    allowed_values: [true, false],
    applicable_products: ALL,
    example_value: true,
  },
  {
    fact_key: 'existing.duplicate_claim_same_period',
    label: 'Duplicate claim in same period',
    category: 'EXISTING_BENEFITS',
    description: 'Whether an overlapping claim exists for the same product/period.',
    source_table: 'bn_claim',
    source_column: '*',
    resolver_function: 'resolveDuplicateClaim',
    data_type: 'bool',
    allowed_operators: ['=', 'not_exists'],
    allowed_values: [true, false],
    applicable_products: ALL,
    example_value: false,
  },
  {
    fact_key: 'existing.previous_maternity_claim',
    label: 'Previous maternity claim exists',
    category: 'EXISTING_BENEFITS',
    description: 'Whether a previous maternity claim exists in the look-back window.',
    source_table: 'bn_claim',
    source_column: '*',
    resolver_function: 'resolvePreviousMaternity',
    data_type: 'bool',
    allowed_operators: ['=', 'exists', 'not_exists'],
    allowed_values: [true, false],
    applicable_products: ['SKN-MAT', 'SKN-MAT-GRANT'],
    example_value: false,
  },

  // ───────── Phase 3 additions: claim event date facts ─────────
  {
    fact_key: 'claim.reported_date',
    label: 'Reported date',
    category: 'CLAIM_EVENT',
    description: 'Date the employer/claimant reported the event.',
    source_table: 'bn_claim',
    source_column: 'reported_date',
    resolver_function: 'resolveClaimReportedDate',
    data_type: 'date',
    allowed_operators: ['exists', '>=', '<=', 'between'],
    applicable_products: ['SKN-EI', 'SKN-EI-DIS', 'SKN-EI-MED'],
    example_value: '2026-01-17',
  },
  {
    fact_key: 'claim.sickness_start_date',
    label: 'Sickness start date',
    category: 'CLAIM_EVENT',
    description: 'First day of incapacity.',
    source_table: 'bn_claim',
    source_column: 'sickness_start_date',
    resolver_function: 'resolveClaimSicknessStartDate',
    data_type: 'date',
    allowed_operators: ['exists', '>=', '<=', 'between'],
    applicable_products: ['SKN-SICK', 'SKN-INV'],
    example_value: '2026-01-10',
  },
  {
    fact_key: 'claim.maternity_expected_date',
    label: 'Expected confinement date',
    category: 'CLAIM_EVENT',
    description: 'Expected date of confinement.',
    source_table: 'bn_claim',
    source_column: 'expected_confinement_date',
    resolver_function: 'resolveClaimMaternityExpectedDate',
    data_type: 'date',
    allowed_operators: ['exists', '>=', '<=', 'between'],
    applicable_products: ['SKN-MAT', 'SKN-MAT-GRANT'],
    example_value: '2026-04-20',
  },
  {
    fact_key: 'claim.death_date',
    label: 'Date of death',
    category: 'CLAIM_EVENT',
    description: 'Date of death of the contributor.',
    source_table: 'bn_claim',
    source_column: 'death_date',
    resolver_function: 'resolveClaimDeathDate',
    data_type: 'date',
    allowed_operators: ['exists', '>=', '<=', 'between'],
    applicable_products: ['SKN-FUN', 'SKN-SURV'],
    example_value: '2026-01-01',
  },
  {
    fact_key: 'claim.last_worked_date',
    label: 'Last worked date',
    category: 'CLAIM_EVENT',
    description: 'Last day worked before incapacity.',
    source_table: 'bn_claim',
    source_column: 'last_worked_date',
    resolver_function: 'resolveClaimLastWorkedDate',
    data_type: 'date',
    allowed_operators: ['exists', '>=', '<=', 'between'],
    applicable_products: ['SKN-SICK', 'SKN-INV', 'SKN-EI'],
    example_value: '2026-01-09',
  },

  // ───── Document status facts (status, not just existence) ─────
  {
    fact_key: 'document.medical_certificate.status',
    label: 'Medical certificate status',
    category: 'DOCUMENTS',
    description: 'Verification status of the medical certificate document.',
    source_table: 'bn_claim_evidence',
    source_column: 'status',
    resolver_function: 'resolveDocStatusMedicalCert',
    data_type: 'enum',
    allowed_operators: ['=', '!=', 'in'],
    allowed_values: ['PENDING', 'RECEIVED', 'VERIFIED', 'REJECTED'],
    applicable_products: ALL,
    example_value: 'VERIFIED',
  },
  {
    fact_key: 'document.death_certificate.status',
    label: 'Death certificate status',
    category: 'DOCUMENTS',
    description: 'Verification status of the death certificate.',
    source_table: 'bn_claim_evidence',
    source_column: 'status',
    resolver_function: 'resolveDocStatusDeathCert',
    data_type: 'enum',
    allowed_operators: ['=', '!=', 'in'],
    allowed_values: ['PENDING', 'RECEIVED', 'VERIFIED', 'REJECTED'],
    applicable_products: ['SKN-FUN', 'SKN-SURV'],
    example_value: 'VERIFIED',
  },
  {
    fact_key: 'document.employer_report.status',
    label: 'Employer report status',
    category: 'DOCUMENTS',
    description: 'Verification status of the employer accident report.',
    source_table: 'bn_claim_evidence',
    source_column: 'status',
    resolver_function: 'resolveDocStatusEmployerReport',
    data_type: 'enum',
    allowed_operators: ['=', '!=', 'in'],
    allowed_values: ['PENDING', 'RECEIVED', 'VERIFIED', 'REJECTED'],
    applicable_products: ['SKN-EI', 'SKN-EI-DIS', 'SKN-EI-MED'],
    example_value: 'VERIFIED',
  },
  {
    fact_key: 'document.funeral_invoice.status',
    label: 'Funeral invoice status',
    category: 'DOCUMENTS',
    description: 'Verification status of the funeral invoice.',
    source_table: 'bn_claim_evidence',
    source_column: 'status',
    resolver_function: 'resolveDocStatusFuneralInvoice',
    data_type: 'enum',
    allowed_operators: ['=', '!=', 'in'],
    allowed_values: ['PENDING', 'RECEIVED', 'VERIFIED', 'REJECTED'],
    applicable_products: ['SKN-FUN'],
    example_value: 'VERIFIED',
  },
  {
    fact_key: 'document.school_certificate.status',
    label: 'School certificate status',
    category: 'DOCUMENTS',
    description: 'Verification status of the school attendance certificate.',
    source_table: 'bn_claim_evidence',
    source_column: 'status',
    resolver_function: 'resolveDocStatusSchoolCert',
    data_type: 'enum',
    allowed_operators: ['=', '!=', 'in'],
    allowed_values: ['PENDING', 'RECEIVED', 'VERIFIED', 'REJECTED'],
    applicable_products: ['SKN-SCH-CERT'],
    example_value: 'VERIFIED',
  },
  {
    fact_key: 'document.life_certificate.status',
    label: 'Life certificate status',
    category: 'DOCUMENTS',
    description: 'Verification status of the life certificate.',
    source_table: 'bn_claim_evidence',
    source_column: 'status',
    resolver_function: 'resolveDocStatusLifeCert',
    data_type: 'enum',
    allowed_operators: ['=', '!=', 'in'],
    allowed_values: ['PENDING', 'RECEIVED', 'VERIFIED', 'REJECTED'],
    applicable_products: ['SKN-LIFE-CERT'],
    example_value: 'VERIFIED',
  },
  {
    fact_key: 'document.birth_certificate.status',
    label: 'Birth certificate status',
    category: 'DOCUMENTS',
    description: 'Verification status of the birth certificate.',
    source_table: 'bn_claim_evidence',
    source_column: 'status',
    resolver_function: 'resolveDocStatusBirthCert',
    data_type: 'enum',
    allowed_operators: ['=', '!=', 'in'],
    allowed_values: ['PENDING', 'RECEIVED', 'VERIFIED', 'REJECTED'],
    applicable_products: ALL,
    example_value: 'VERIFIED',
  },

  // ───────── Existing benefits — extended ─────────
  {
    fact_key: 'existing.prior_employment_injury_claim',
    label: 'Prior Employment Injury claim exists',
    category: 'EXISTING_BENEFITS',
    description: 'A prior EI claim exists for this contributor (precondition for Disablement).',
    source_table: 'bn_claim',
    source_column: '*',
    resolver_function: 'resolvePriorEmploymentInjury',
    data_type: 'bool',
    allowed_operators: ['=', 'exists'],
    allowed_values: [true, false],
    applicable_products: ['SKN-EI-DIS'],
    example_value: true,
  },
  {
    fact_key: 'existing.contributory_pension_exists',
    label: 'Existing contributory pension',
    category: 'EXISTING_BENEFITS',
    description: 'Whether a contributory pension is already in payment for this person (blocks NCP).',
    source_table: 'bn_award',
    source_column: 'status',
    resolver_function: 'resolveContributoryPensionExists',
    data_type: 'bool',
    allowed_operators: ['=', 'exists'],
    allowed_values: [true, false],
    applicable_products: ['SKN-NCP'],
    example_value: false,
  },
  {
    fact_key: 'existing.active_survivor_child_award',
    label: 'Active survivor (child) award',
    category: 'EXISTING_BENEFITS',
    description: 'Active survivor award for a child beneficiary (precondition for school certificate).',
    source_table: 'bn_award_beneficiary',
    source_column: '*',
    resolver_function: 'resolveActiveSurvivorChildAward',
    data_type: 'bool',
    allowed_operators: ['=', 'exists'],
    allowed_values: [true, false],
    applicable_products: ['SKN-SCH-CERT'],
    example_value: true,
  },

  // ───────── Medical / Medical Board (stub resolvers until source tables exist) ─────────
  {
    fact_key: 'medical.disablement_percentage',
    label: 'Disablement percentage',
    category: 'MEDICAL',
    description: 'Percentage degree of disablement assessed by the medical board.',
    source_table: 'bn_medical_recommendation',
    source_column: 'disablement_pct',
    resolver_function: 'resolveMedicalDisablementPct',
    data_type: 'number',
    allowed_operators: ['>=', '<=', '=', 'between', 'exists'],
    applicable_products: ['SKN-EI-DIS'],
    example_value: 35,
  },
  {
    fact_key: 'medical_board.decision',
    label: 'Medical board decision',
    category: 'MEDICAL',
    description: 'Outcome of the medical board review.',
    source_table: 'bn_medical_recommendation',
    source_column: 'board_decision',
    resolver_function: 'resolveMedicalBoardDecision',
    data_type: 'enum',
    allowed_operators: ['=', '!=', 'in'],
    allowed_values: ['PENDING', 'APPROVED', 'REJECTED', 'DEFERRED'],
    applicable_products: ['SKN-EI-DIS', 'SKN-INV'],
    example_value: 'APPROVED',
  },
  {
    fact_key: 'medical_board.invalidity_confirmed',
    label: 'Invalidity confirmed by medical board',
    category: 'MEDICAL',
    description: 'Whether the medical board confirmed permanent invalidity.',
    source_table: 'bn_medical_recommendation',
    source_column: 'board_decision',
    resolver_function: 'resolveMedicalInvalidityConfirmed',
    data_type: 'bool',
    allowed_operators: ['=', 'exists'],
    allowed_values: [true, false],
    applicable_products: ['SKN-INV', 'SKN-NCP'],
    example_value: true,
  },

  // ───────── Spouse contribution basis (BUG-32) ─────────
  // The Maternity Grant may be established on the insured husband's
  // contributions. The claimant remains the woman — only the contribution
  // basis moves — so these sit alongside, not instead of, the claimant facts.
  {
    fact_key: 'spouse.contribution.total_weeks',
    label: 'Spouse total contribution weeks',
    category: 'CONTRIBUTION',
    description: 'Total contribution weeks on the record of the claimant’s recorded spouse.',
    source_table: 'ip_wages',
    source_column: 'total_weeks',
    resolver_function: 'resolveSpouseContributionTotalWeeks',
    data_type: 'number',
    allowed_operators: ['>=', '>', '<=', '<', '=', 'between'],
    applicable_products: ['SKN-MAT-GRANT', 'SKN-MAT'],
    example_value: 39,
  },
  {
    fact_key: 'spouse.contribution.paid_weeks',
    label: 'Spouse paid contribution weeks',
    category: 'CONTRIBUTION',
    description: 'Paid contribution weeks on the record of the claimant’s recorded spouse.',
    source_table: 'ip_wages',
    source_column: 'paid_weeks',
    resolver_function: 'resolveSpouseContributionPaidWeeks',
    data_type: 'number',
    allowed_operators: ['>=', '>', '<=', '<', '=', 'between'],
    applicable_products: ['SKN-MAT-GRANT', 'SKN-MAT'],
    example_value: 20,
  },
  {
    fact_key: 'spouse.is_insured',
    label: 'Spouse is an insured person',
    category: 'PERSON',
    description: 'Whether the claimant’s recorded spouse is an active insured person.',
    source_table: 'ip_master',
    source_column: 'status',
    resolver_function: 'resolveSpouseIsInsured',
    data_type: 'bool',
    allowed_operators: ['=', 'exists'],
    allowed_values: [true, false],
    applicable_products: ['SKN-MAT-GRANT'],
    example_value: true,
  },

  // ───────── Facts whose rules were already configured (BUG-31) ─────────
  // Products had these criteria set but no fact existed to evaluate them, so
  // every claim on those products was held for manual review. Each entry maps
  // to a column that already exists.
  {
    fact_key: 'medical_board.decision_present',
    label: 'Medical board decision recorded',
    category: 'MEDICAL',
    description: 'Whether a medical board decision has been recorded for the claim.',
    source_table: 'bn_medical_recommendation',
    source_column: 'board_decision',
    resolver_function: 'resolveMedicalBoardDecisionPresent',
    data_type: 'bool',
    allowed_operators: ['=', 'exists'],
    allowed_values: [true, false],
    applicable_products: ALL,
    example_value: true,
  },
  {
    fact_key: 'person.age_at_first_registration',
    label: 'Age at first registration',
    category: 'PERSON',
    description: 'Age of the insured person on the date they were first registered.',
    source_table: 'ip_master',
    source_column: 'registration_date',
    resolver_function: 'resolvePersonAgeAtFirstRegistration',
    data_type: 'number',
    allowed_operators: ['>=', '>', '<=', '<', '=', '!=', 'between'],
    applicable_products: ALL,
    example_value: 45,
  },
  {
    fact_key: 'person.death_confirmed',
    label: 'Death confirmed',
    category: 'PERSON',
    description: 'Whether a date of death is recorded on the claim or the person record.',
    source_table: 'bn_claim',
    source_column: 'death_date',
    resolver_function: 'resolveDeathConfirmed',
    data_type: 'bool',
    allowed_operators: ['=', 'exists'],
    allowed_values: [true, false],
    applicable_products: ALL,
    example_value: true,
  },
  {
    fact_key: 'claim.weeks_to_expected_confinement',
    label: 'Weeks to expected confinement',
    category: 'CLAIM_EVENT',
    description: 'Weeks between the claim date and the expected confinement date.',
    source_table: 'bn_claim',
    source_column: 'expected_confinement_date',
    resolver_function: 'resolveWeeksToExpectedConfinement',
    data_type: 'number',
    allowed_operators: ['>=', '>', '<=', '<', '=', 'between'],
    applicable_products: ALL,
    example_value: 6,
  },
  {
    fact_key: 'claim.continuous_illness_days',
    label: 'Continuous illness days',
    category: 'CLAIM_EVENT',
    description: 'Days between the recorded sickness start date and the claim date.',
    source_table: 'bn_claim',
    source_column: 'sickness_start_date',
    resolver_function: 'resolveContinuousIllnessDays',
    data_type: 'number',
    allowed_operators: ['>=', '>', '<=', '<', '=', 'between'],
    applicable_products: ALL,
    example_value: 14,
  },
  {
    fact_key: 'claim.weeks_since_prior_sickness',
    label: 'Weeks since prior sickness claim',
    category: 'CLAIM_EVENT',
    description: 'Weeks between this claim and the claimant’s previous sickness claim.',
    source_table: 'bn_claim',
    source_column: 'claim_date',
    resolver_function: 'resolveWeeksSincePriorSickness',
    data_type: 'number',
    allowed_operators: ['>=', '>', '<=', '<', '=', 'between'],
    applicable_products: ALL,
    example_value: 8,
  },
  {
    fact_key: 'claim.approved_expense_amount',
    label: 'Approved expense amount',
    category: 'CLAIM_EVENT',
    description: 'Total approved medical expense amount recorded against the claim.',
    source_table: 'bn_medical_claim_expense',
    source_column: 'approved_amount',
    resolver_function: 'resolveApprovedExpenseAmount',
    data_type: 'number',
    allowed_operators: ['>=', '>', '<=', '<', '=', 'between'],
    applicable_products: ALL,
    example_value: 1200,
  },
  {
    fact_key: 'beneficiary.is_qualifying_survivor',
    label: 'Applicant is a qualifying survivor',
    category: 'SPECIAL',
    description: 'Whether any claim participant has a relationship that qualifies as a survivor.',
    source_table: 'bn_claim_participant',
    source_column: 'relationship_to_insured',
    resolver_function: 'resolveQualifyingSurvivor',
    data_type: 'bool',
    allowed_operators: ['=', 'exists'],
    allowed_values: [true, false],
    applicable_products: ALL,
    example_value: true,
  },
  {
    fact_key: 'beneficiary.spouse_relationship_valid',
    label: 'Spouse relationship valid',
    category: 'SPECIAL',
    description: 'Whether a participant is recorded as the spouse, widow or widower.',
    source_table: 'bn_claim_participant',
    source_column: 'relationship_to_insured',
    resolver_function: 'resolveSpouseRelationshipValid',
    data_type: 'bool',
    allowed_operators: ['=', 'exists'],
    allowed_values: [true, false],
    applicable_products: ALL,
    example_value: true,
  },
  {
    fact_key: 'beneficiary.child_age',
    label: 'Youngest child beneficiary age',
    category: 'SPECIAL',
    description: 'Age at claim date of the youngest child participant, from their person record.',
    source_table: 'bn_claim_participant',
    source_column: 'ssn',
    resolver_function: 'resolveBeneficiaryChildAge',
    data_type: 'number',
    allowed_operators: ['>=', '>', '<=', '<', '=', 'between'],
    applicable_products: ALL,
    example_value: 14,
  },

  // ───────── Beneficiary / Applicant / Payment profile / Means test (stubs) ─────────
  {
    fact_key: 'beneficiary.relationship_valid',
    label: 'Beneficiary relationship valid',
    category: 'SPECIAL',
    description: 'Survivor beneficiary has a valid relationship to the deceased.',
    source_table: 'bn_award_beneficiary',
    source_column: 'relationship',
    resolver_function: 'resolveBeneficiaryRelationshipValid',
    data_type: 'bool',
    allowed_operators: ['=', 'exists'],
    allowed_values: [true, false],
    applicable_products: ['SKN-SURV'],
    example_value: true,
  },
  {
    fact_key: 'beneficiary.student_status',
    label: 'Beneficiary student status verified',
    category: 'SPECIAL',
    description: 'Student status verified for school-age survivor beneficiary.',
    source_table: 'bn_award_beneficiary',
    source_column: 'is_student',
    resolver_function: 'resolveBeneficiaryStudentStatus',
    data_type: 'enum',
    allowed_operators: ['=', '!=', 'in'],
    allowed_values: ['PENDING', 'VERIFIED', 'REJECTED'],
    applicable_products: ['SKN-SCH-CERT'],
    example_value: 'VERIFIED',
  },
  {
    fact_key: 'applicant.funeral_responsibility_confirmed',
    label: 'Funeral responsibility confirmed',
    category: 'SPECIAL',
    description: 'Applicant has confirmed financial responsibility for the funeral.',
    source_table: 'bn_claim',
    source_column: 'applicant_attestation',
    resolver_function: 'resolveFuneralResponsibilityConfirmed',
    data_type: 'bool',
    allowed_operators: ['=', 'exists'],
    allowed_values: [true, false],
    applicable_products: ['SKN-FUN'],
    example_value: true,
  },
  {
    fact_key: 'payment_profile.bank_details_valid',
    label: 'Bank details valid',
    category: 'PAYMENT_AWARD',
    description: 'Active payment profile with verified bank details.',
    source_table: 'bn_payment_profile',
    source_column: 'is_verified',
    resolver_function: 'resolvePaymentBankDetailsValid',
    data_type: 'bool',
    allowed_operators: ['=', 'exists'],
    allowed_values: [true, false],
    applicable_products: ['SKN-EFT-UPD'],
    example_value: true,
  },
  {
    fact_key: 'means_test.result',
    label: 'Means test result',
    category: 'SPECIAL',
    description: 'Outcome of the means test (NCP). NOT_IMPLEMENTED until source table exists.',
    source_table: '(pending source table)',
    source_column: '(pending)',
    resolver_function: 'resolveMeansTestResult',
    data_type: 'enum',
    allowed_operators: ['=', '!=', 'in'],
    allowed_values: ['PENDING', 'PASSED', 'FAILED'],
    applicable_products: ['SKN-NCP'],
    example_value: 'PASSED',
  },
];

/** Map for O(1) lookup. */
export const FACT_INDEX: Map<string, EligibilityFact> = new Map(
  ELIGIBILITY_FACTS.map((f) => [f.fact_key, f]),
);

export function getFact(factKey: string): EligibilityFact | undefined {
  return FACT_INDEX.get(factKey);
}

export function factsForCategory(cat: EligibilityCategory): EligibilityFact[] {
  return ELIGIBILITY_FACTS.filter((f) => f.category === cat);
}

export function factsForProduct(productCode: string | null): EligibilityFact[] {
  if (!productCode) return ELIGIBILITY_FACTS;
  return ELIGIBILITY_FACTS.filter(
    (f) => f.applicable_products.includes('*') || f.applicable_products.includes(productCode),
  );
}

/** Rule grouping (separate from category — drives the UI sectioning). */
export type RuleGroupCode =
  | 'CORE_IDENTITY'
  | 'CONTRIBUTION'
  | 'EMPLOYMENT'
  | 'EVENT'
  | 'EVIDENCE'
  | 'EXISTING_BENEFIT'
  | 'SPECIAL';

export const RULE_GROUPS: Array<{ code: RuleGroupCode; label: string; description: string }> = [
  { code: 'CORE_IDENTITY', label: 'Core Identity', description: 'Contributor existence, age, gender, alive/deceased.' },
  { code: 'CONTRIBUTION', label: 'Contribution Conditions', description: 'Paid weeks, credited weeks, recent weeks, average wage.' },
  { code: 'EMPLOYMENT', label: 'Employment Conditions', description: 'Employer existence and active status.' },
  { code: 'EVENT', label: 'Event Conditions', description: 'Injury / sickness / death date and reporting window.' },
  { code: 'EVIDENCE', label: 'Evidence Conditions', description: 'Required documents on the claim.' },
  { code: 'EXISTING_BENEFIT', label: 'Existing Benefit Conditions', description: 'Duplicate prevention, prior-award requirements.' },
  { code: 'SPECIAL', label: 'Special Conditions', description: 'Means tests, student status, guardian/payee, etc.' },
];

// ───────── Extended contribution window facts ─────────
const WINDOW_FACTS: EligibilityFact[] = [
  {
    fact_key: 'contribution.credited_weeks',
    label: 'Credited contribution weeks',
    category: 'CONTRIBUTION',
    description: 'Credited (non-paid) weeks from snapshot.',
    source_table: 'bn_claim_contribution_snapshot',
    source_column: 'credited_weeks',
    resolver_function: 'resolveContribCreditedWeeks',
    data_type: 'number',
    allowed_operators: ['>=', '<=', '>', '<', '=', '!=', 'between'],
    applicable_products: ['*'],
    example_value: 20,
  },
  ...([13, 26, 39, 52].map((n) => ({
    fact_key: `contribution.weeks_last_${n}`,
    label: `Contribution weeks in last ${n}`,
    category: 'CONTRIBUTION' as EligibilityCategory,
    description: `Paid weeks in the ${n} weeks preceding the claim date.`,
    source_table: 'bn_claim_contribution_snapshot / ip_wages',
    source_column: `window_${n}`,
    resolver_function: `resolveContribWeeksLast${n}`,
    data_type: 'number' as EligibilityDataType,
    allowed_operators: ['>=', '<=', '>', '<', '=', '!=', 'between'] as EligibilityOperator[],
    applicable_products: ['*'],
    example_value: Math.round(n * 0.7),
  })) as EligibilityFact[]),
  {
    fact_key: 'contribution.weeks_last_12_months',
    label: 'Contribution weeks in last 12 months',
    category: 'CONTRIBUTION',
    description: 'Paid weeks in the 12 months preceding the claim date.',
    source_table: 'bn_claim_contribution_snapshot / ip_wages',
    source_column: 'window_12m',
    resolver_function: 'resolveContribWeeksLast12Months',
    data_type: 'number',
    allowed_operators: ['>=', '<=', '>', '<', '=', '!=', 'between'],
    applicable_products: ['*'],
    example_value: 40,
  },
];

// ───────── Deceased contributor facts (Funeral / Survivors) ─────────
const DECEASED_FACTS: EligibilityFact[] = [
  {
    fact_key: 'deceased.contribution.total_weeks',
    label: 'Deceased: total contribution weeks',
    category: 'CONTRIBUTION',
    description: 'Total contribution weeks for the deceased contributor.',
    source_table: 'bn_claim_contribution_snapshot / ip_wages',
    source_column: 'total_weeks',
    resolver_function: 'resolveDeceasedContribTotalWeeks',
    data_type: 'number',
    allowed_operators: ['>=', '<=', '>', '<', '=', '!=', 'between'],
    applicable_products: ['SKN-FUN', 'SKN-SURV'],
    example_value: 150,
  },
  {
    fact_key: 'deceased.contribution.paid_weeks',
    label: 'Deceased: paid contribution weeks',
    category: 'CONTRIBUTION',
    description: 'Paid contribution weeks for the deceased.',
    source_table: 'bn_claim_contribution_snapshot / ip_wages',
    source_column: 'paid_weeks',
    resolver_function: 'resolveDeceasedContribPaidWeeks',
    data_type: 'number',
    allowed_operators: ['>=', '<=', '>', '<', '=', '!=', 'between'],
    applicable_products: ['SKN-FUN', 'SKN-SURV'],
    example_value: 120,
  },
  {
    fact_key: 'deceased.contribution.recent_weeks',
    label: 'Deceased: recent contribution weeks',
    category: 'CONTRIBUTION',
    description: 'Recent paid weeks for the deceased.',
    source_table: 'bn_claim_contribution_snapshot / ip_wages',
    source_column: 'recent_weeks',
    resolver_function: 'resolveDeceasedContribRecentWeeks',
    data_type: 'number',
    allowed_operators: ['>=', '<=', '>', '<', '=', '!=', 'between'],
    applicable_products: ['SKN-FUN', 'SKN-SURV'],
    example_value: 8,
  },
  {
    fact_key: 'deceased.contribution.weeks_last_12_months',
    label: 'Deceased: contribution weeks in last 12 months',
    category: 'CONTRIBUTION',
    description: 'Paid weeks in the 12 months preceding death.',
    source_table: 'bn_claim_contribution_snapshot / ip_wages',
    source_column: 'window_12m',
    resolver_function: 'resolveDeceasedContribWeeksLast12Months',
    data_type: 'number',
    allowed_operators: ['>=', '<=', '>', '<', '=', '!=', 'between'],
    applicable_products: ['SKN-FUN', 'SKN-SURV'],
    example_value: 40,
  },
];

ELIGIBILITY_FACTS.push(...WINDOW_FACTS, ...DECEASED_FACTS);
for (const f of [...WINDOW_FACTS, ...DECEASED_FACTS]) FACT_INDEX.set(f.fact_key, f);

/** Default group suggestion for a fact (used by the rule builder). */
export function defaultGroupForFact(factKey: string): RuleGroupCode {
  const fact = getFact(factKey);
  if (!fact) return 'SPECIAL';
  switch (fact.category) {
    case 'PERSON': return 'CORE_IDENTITY';
    case 'CONTRIBUTION': return 'CONTRIBUTION';
    case 'EMPLOYER': return 'EMPLOYMENT';
    case 'CLAIM_EVENT': return 'EVENT';
    case 'MEDICAL':
    case 'DOCUMENTS': return 'EVIDENCE';
    case 'EXISTING_BENEFITS':
    case 'PAYMENT_AWARD': return 'EXISTING_BENEFIT';
    case 'SPECIAL': return 'SPECIAL';
  }
}
