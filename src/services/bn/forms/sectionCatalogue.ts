/**
 * BN Application Form — Section & Field Catalogue
 *
 * Canonical sections and default field definitions used by the form engine.
 * Acts as the fallback when a product version has no bn_screen_template /
 * bn_field_metadata rows, and as the seed source for the catalogue.
 *
 * Channel visibility is encoded per field via `visibleForChannels`.
 */

export type FormChannel = 'INTERNAL' | 'ASSISTED_OFFLINE' | 'PUBLIC';

export type FieldType =
  | 'TEXT'
  | 'TEXTAREA'
  | 'NUMBER'
  | 'DATE'
  | 'SELECT'
  | 'PHONE'
  | 'EMAIL'
  | 'CHECKBOX'
  | 'FILE';

export interface FormFieldDef {
  field_code: string;
  field_label: string;
  field_type: FieldType;
  section_code: string;
  is_required: boolean;
  visibleForChannels: FormChannel[];
  validation_rules?: Record<string, any>;
  options_source?: string;
  default_value?: string;
  help_text?: string;
  sort_order: number;
}

export interface FormSectionDef {
  section_code: string;
  title: string;
  description?: string;
  visibleForChannels: FormChannel[];
  sort_order: number;
}

const ALL: FormChannel[] = ['INTERNAL', 'ASSISTED_OFFLINE', 'PUBLIC'];
const STAFF: FormChannel[] = ['INTERNAL', 'ASSISTED_OFFLINE'];

// ─── Shared sections (every product) ─────────────────────────────
export const SHARED_SECTIONS: FormSectionDef[] = [
  { section_code: 'claimant_details', title: 'Claimant / Applicant Details', visibleForChannels: ALL, sort_order: 10 },
  { section_code: 'insured_person_details', title: 'Insured Person Details', visibleForChannels: ALL, sort_order: 20 },
  { section_code: 'benefit_selection', title: 'Benefit Selection', visibleForChannels: ALL, sort_order: 30 },
  { section_code: 'claim_event_details', title: 'Claim Event Details', visibleForChannels: ALL, sort_order: 40 },
  { section_code: 'employment_details', title: 'Employment / Employer Details', visibleForChannels: ALL, sort_order: 50 },
  { section_code: 'contribution_context', title: 'Contribution / Wage Context', visibleForChannels: STAFF, sort_order: 60 },
  { section_code: 'banking_payee_details', title: 'Banking / Payee Details', visibleForChannels: ALL, sort_order: 70 },
  { section_code: 'documents', title: 'Required Documents', visibleForChannels: ALL, sort_order: 80 },
  { section_code: 'declaration_consent', title: 'Declaration & Consent', visibleForChannels: ALL, sort_order: 90 },
  { section_code: 'internal_review', title: 'Internal Review / Workflow Routing', visibleForChannels: STAFF, sort_order: 100 },
];

// ─── Benefit-specific sections (one per product type) ────────────
export const BENEFIT_SECTIONS: Record<string, FormSectionDef> = {
  SICKNESS:                 { section_code: 'sickness_details', title: 'Sickness Details', visibleForChannels: ALL, sort_order: 45 },
  MATERNITY:                { section_code: 'maternity_details', title: 'Maternity Details', visibleForChannels: ALL, sort_order: 45 },
  EMPLOYMENT_INJURY:        { section_code: 'employment_injury_details', title: 'Employment Injury Details', visibleForChannels: ALL, sort_order: 45 },
  DISABLEMENT:              { section_code: 'disablement_details', title: 'Disablement Assessment', visibleForChannels: ALL, sort_order: 45 },
  MEDICAL_EXPENSE:          { section_code: 'medical_expense_details', title: 'Medical Expense Details', visibleForChannels: ALL, sort_order: 45 },
  EMPLOYMENT_INJURY_DEATH:  { section_code: 'employment_injury_death_details', title: 'Employment Injury Death Details', visibleForChannels: ALL, sort_order: 45 },
  FUNERAL_GRANT:            { section_code: 'funeral_grant_details', title: 'Funeral Grant Details', visibleForChannels: ALL, sort_order: 45 },
  INVALIDITY:               { section_code: 'invalidity_details', title: 'Invalidity Details', visibleForChannels: ALL, sort_order: 45 },
  AGE_BENEFIT:              { section_code: 'age_benefit_details', title: 'Age Benefit Details', visibleForChannels: ALL, sort_order: 45 },
  SURVIVORS:                { section_code: 'survivor_details', title: 'Survivor Details', visibleForChannels: ALL, sort_order: 45 },
  NON_CONTRIBUTORY_PENSION: { section_code: 'non_contributory_pension_details', title: 'Non-Contributory Pension Details', visibleForChannels: ALL, sort_order: 45 },
};

// ─── Shared fields used across all products ──────────────────────
export const SHARED_FIELDS: FormFieldDef[] = [
  // claimant
  { field_code: 'claimant_first_name', field_label: 'First Name', field_type: 'TEXT', section_code: 'claimant_details', is_required: true, visibleForChannels: ALL, sort_order: 1 },
  { field_code: 'claimant_last_name',  field_label: 'Last Name',  field_type: 'TEXT', section_code: 'claimant_details', is_required: true, visibleForChannels: ALL, sort_order: 2 },
  { field_code: 'claimant_phone',      field_label: 'Phone',      field_type: 'PHONE', section_code: 'claimant_details', is_required: true, visibleForChannels: ALL, sort_order: 3 },
  { field_code: 'claimant_email',      field_label: 'Email',      field_type: 'EMAIL', section_code: 'claimant_details', is_required: false, visibleForChannels: ALL, sort_order: 4 },

  // insured person
  { field_code: 'ssn', field_label: 'SSN / Insured Person Number', field_type: 'TEXT', section_code: 'insured_person_details', is_required: true, visibleForChannels: ALL, sort_order: 1 },

  // benefit selection (auto-populated, displayed only)
  { field_code: 'product_code', field_label: 'Benefit', field_type: 'TEXT', section_code: 'benefit_selection', is_required: true, visibleForChannels: ALL, sort_order: 1, validation_rules: { readOnly: true } },

  // employment
  { field_code: 'employer_regno', field_label: 'Employer Registration No.', field_type: 'TEXT', section_code: 'employment_details', is_required: false, visibleForChannels: ALL, sort_order: 1 },

  // contribution (staff only)
  { field_code: 'legacy_claim_ref', field_label: 'Legacy Claim Reference', field_type: 'TEXT', section_code: 'contribution_context', is_required: false, visibleForChannels: STAFF, sort_order: 1 },

  // banking — canonical payment-profile fields (rendered by PaymentDetailsSection,
  // not as plain inputs). Kept here so the Product Catalog / Screen Builder can
  // toggle them in the same way as other shared fields.
  { field_code: 'payment_method',              field_label: 'Payment Method',         field_type: 'SELECT', section_code: 'banking_payee_details', is_required: true,  visibleForChannels: ALL, sort_order: 1, validation_rules: { options: ['EFT', 'CHEQUE', 'CASH_PICKUP', 'INTERNAL_TRANSFER'], smart_type: 'PAYMENT_PROFILE' } },
  { field_code: 'payment_currency',            field_label: 'Currency',               field_type: 'TEXT',   section_code: 'banking_payee_details', is_required: true,  visibleForChannels: ALL, sort_order: 2, default_value: 'XCD' },
  { field_code: 'bank_name',                   field_label: 'Bank Name',              field_type: 'TEXT',   section_code: 'banking_payee_details', is_required: false, visibleForChannels: ALL, sort_order: 3 },
  { field_code: 'bank_code',                   field_label: 'Bank Code',              field_type: 'TEXT',   section_code: 'banking_payee_details', is_required: false, visibleForChannels: ALL, sort_order: 4 },
  { field_code: 'branch_name',                 field_label: 'Branch Name',            field_type: 'TEXT',   section_code: 'banking_payee_details', is_required: false, visibleForChannels: ALL, sort_order: 5 },
  { field_code: 'branch_code',                 field_label: 'Branch Code',            field_type: 'TEXT',   section_code: 'banking_payee_details', is_required: false, visibleForChannels: ALL, sort_order: 6 },
  { field_code: 'account_number',              field_label: 'Account Number',         field_type: 'TEXT',   section_code: 'banking_payee_details', is_required: false, visibleForChannels: ALL, sort_order: 7, help_text: 'Stored masked. Raw digits never displayed back.' },
  { field_code: 'account_type',                field_label: 'Account Type',           field_type: 'TEXT',   section_code: 'banking_payee_details', is_required: false, visibleForChannels: ALL, sort_order: 8 },
  { field_code: 'account_holder_name',         field_label: 'Account Holder Name',    field_type: 'TEXT',   section_code: 'banking_payee_details', is_required: false, visibleForChannels: ALL, sort_order: 9 },
  { field_code: 'account_holder_relationship', field_label: 'Holder Relationship',    field_type: 'TEXT',   section_code: 'banking_payee_details', is_required: false, visibleForChannels: ALL, sort_order: 10, help_text: 'Self / Guardian / Third-party payee (subject to product policy).' },
  { field_code: 'postal_address',              field_label: 'Postal Address (cheque)', field_type: 'TEXTAREA', section_code: 'banking_payee_details', is_required: false, visibleForChannels: ALL, sort_order: 11, help_text: 'Required when payment method is Cheque.' },

  // declaration
  { field_code: 'declaration', field_label: 'I declare the information provided is true and complete.', field_type: 'CHECKBOX', section_code: 'declaration_consent', is_required: true, visibleForChannels: ALL, sort_order: 1 },

  // internal review (staff only)
  { field_code: 'priority', field_label: 'Priority', field_type: 'SELECT', section_code: 'internal_review', is_required: false, visibleForChannels: STAFF, sort_order: 1, validation_rules: { options: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] } },
  { field_code: 'assigned_to', field_label: 'Assign To', field_type: 'TEXT', section_code: 'internal_review', is_required: false, visibleForChannels: STAFF, sort_order: 2 },
  { field_code: 'internal_notes', field_label: 'Internal Notes', field_type: 'TEXTAREA', section_code: 'internal_review', is_required: false, visibleForChannels: STAFF, sort_order: 3 },
];

// ─── Benefit-specific fields ─────────────────────────────────────
export const BENEFIT_FIELDS: Record<string, FormFieldDef[]> = {
  SICKNESS: [
    { field_code: 'illness_start_date',  field_label: 'Illness Start Date',  field_type: 'DATE', section_code: 'sickness_details', is_required: true, visibleForChannels: ALL, sort_order: 1 },
    { field_code: 'expected_return_date',field_label: 'Expected Return Date',field_type: 'DATE', section_code: 'sickness_details', is_required: false, visibleForChannels: ALL, sort_order: 2 },
    { field_code: 'last_worked_date',    field_label: 'Last Worked Date',    field_type: 'DATE', section_code: 'sickness_details', is_required: true, visibleForChannels: ALL, sort_order: 3 },
    { field_code: 'incapacity_period_days', field_label: 'Incapacity Period (days)', field_type: 'NUMBER', section_code: 'sickness_details', is_required: false, visibleForChannels: ALL, sort_order: 4 },
  ],
  MATERNITY: [
    { field_code: 'expected_confinement_date', field_label: 'Expected Confinement Date', field_type: 'DATE', section_code: 'maternity_details', is_required: true, visibleForChannels: ALL, sort_order: 1 },
    { field_code: 'actual_confinement_date',   field_label: 'Actual Confinement Date',   field_type: 'DATE', section_code: 'maternity_details', is_required: false, visibleForChannels: ALL, sort_order: 2 },
    { field_code: 'maternity_leave_start', field_label: 'Maternity Leave Start', field_type: 'DATE', section_code: 'maternity_details', is_required: true, visibleForChannels: ALL, sort_order: 3 },
    { field_code: 'maternity_leave_end',   field_label: 'Maternity Leave End',   field_type: 'DATE', section_code: 'maternity_details', is_required: false, visibleForChannels: ALL, sort_order: 4 },
  ],
  EMPLOYMENT_INJURY: [
    { field_code: 'accident_datetime', field_label: 'Date/Time of Accident', field_type: 'DATE', section_code: 'employment_injury_details', is_required: true, visibleForChannels: ALL, sort_order: 1 },
    { field_code: 'accident_place',    field_label: 'Place of Accident',     field_type: 'TEXT', section_code: 'employment_injury_details', is_required: true, visibleForChannels: ALL, sort_order: 2 },
    { field_code: 'witnesses',         field_label: 'Witnesses',             field_type: 'TEXTAREA', section_code: 'employment_injury_details', is_required: false, visibleForChannels: ALL, sort_order: 3 },
    { field_code: 'work_related_confirmed', field_label: 'Work-Related Confirmed', field_type: 'CHECKBOX', section_code: 'employment_injury_details', is_required: false, visibleForChannels: STAFF, sort_order: 4 },
  ],
  DISABLEMENT: [
    { field_code: 'prior_injury_claim_ref', field_label: 'Prior Injury Claim Reference', field_type: 'TEXT', section_code: 'disablement_details', is_required: false, visibleForChannels: ALL, sort_order: 1 },
    { field_code: 'disablement_percentage', field_label: 'Disablement %', field_type: 'NUMBER', section_code: 'disablement_details', is_required: true, visibleForChannels: STAFF, sort_order: 2 },
    { field_code: 'disablement_type',       field_label: 'Type', field_type: 'SELECT', section_code: 'disablement_details', is_required: true, visibleForChannels: ALL, sort_order: 3, validation_rules: { options: ['TEMPORARY', 'PERMANENT'] } },
    { field_code: 'review_schedule_months', field_label: 'Review Interval (months)', field_type: 'NUMBER', section_code: 'disablement_details', is_required: false, visibleForChannels: STAFF, sort_order: 4 },
  ],
  MEDICAL_EXPENSE: [
    { field_code: 'treatment_provider', field_label: 'Treatment Provider', field_type: 'TEXT', section_code: 'medical_expense_details', is_required: true, visibleForChannels: ALL, sort_order: 1 },
    { field_code: 'treatment_start',    field_label: 'Treatment Start',    field_type: 'DATE', section_code: 'medical_expense_details', is_required: true, visibleForChannels: ALL, sort_order: 2 },
    { field_code: 'treatment_end',      field_label: 'Treatment End',      field_type: 'DATE', section_code: 'medical_expense_details', is_required: false, visibleForChannels: ALL, sort_order: 3 },
    { field_code: 'expense_category',   field_label: 'Expense Category',   field_type: 'TEXT', section_code: 'medical_expense_details', is_required: true, visibleForChannels: ALL, sort_order: 4 },
    { field_code: 'reimbursement_amount', field_label: 'Reimbursement Amount', field_type: 'NUMBER', section_code: 'medical_expense_details', is_required: true, visibleForChannels: ALL, sort_order: 5 },
  ],
  EMPLOYMENT_INJURY_DEATH: [
    { field_code: 'deceased_ssn',  field_label: 'Deceased Insured Person SSN', field_type: 'TEXT', section_code: 'employment_injury_death_details', is_required: true, visibleForChannels: ALL, sort_order: 1 },
    { field_code: 'cause_of_death', field_label: 'Cause of Death', field_type: 'TEXT', section_code: 'employment_injury_death_details', is_required: true, visibleForChannels: ALL, sort_order: 2 },
    { field_code: 'work_related_death_confirmed', field_label: 'Work-Related Death Confirmed', field_type: 'CHECKBOX', section_code: 'employment_injury_death_details', is_required: false, visibleForChannels: STAFF, sort_order: 3 },
  ],
  FUNERAL_GRANT: [
    { field_code: 'deceased_ssn',   field_label: 'Deceased Person SSN', field_type: 'TEXT', section_code: 'funeral_grant_details', is_required: true, visibleForChannels: ALL, sort_order: 1 },
    { field_code: 'date_of_death',  field_label: 'Date of Death',       field_type: 'DATE', section_code: 'funeral_grant_details', is_required: true, visibleForChannels: ALL, sort_order: 2 },
    { field_code: 'relationship_to_deceased', field_label: 'Relationship to Deceased', field_type: 'TEXT', section_code: 'funeral_grant_details', is_required: true, visibleForChannels: ALL, sort_order: 3 },
    { field_code: 'funeral_expense_amount',   field_label: 'Funeral Expense Amount',   field_type: 'NUMBER', section_code: 'funeral_grant_details', is_required: false, visibleForChannels: ALL, sort_order: 4 },
  ],
  INVALIDITY: [
    { field_code: 'incapacity_start_date', field_label: 'Incapacity Start Date', field_type: 'DATE', section_code: 'invalidity_details', is_required: true, visibleForChannels: ALL, sort_order: 1 },
    { field_code: 'employment_cessation_date', field_label: 'Employment Cessation Date', field_type: 'DATE', section_code: 'invalidity_details', is_required: false, visibleForChannels: ALL, sort_order: 2 },
    { field_code: 'permanent_incapacity', field_label: 'Permanent Incapacity', field_type: 'CHECKBOX', section_code: 'invalidity_details', is_required: false, visibleForChannels: STAFF, sort_order: 3 },
    { field_code: 'review_interval_months', field_label: 'Review Interval (months)', field_type: 'NUMBER', section_code: 'invalidity_details', is_required: false, visibleForChannels: STAFF, sort_order: 4 },
  ],
  AGE_BENEFIT: [
    { field_code: 'retirement_date', field_label: 'Retirement Date', field_type: 'DATE', section_code: 'age_benefit_details', is_required: true, visibleForChannels: ALL, sort_order: 1 },
    { field_code: 'pension_path',    field_label: 'Pension Path', field_type: 'SELECT', section_code: 'age_benefit_details', is_required: true, visibleForChannels: ALL, sort_order: 2, validation_rules: { options: ['AGE_PENSION', 'AGE_GRANT'] } },
    { field_code: 'still_employed',  field_label: 'Still Employed', field_type: 'CHECKBOX', section_code: 'age_benefit_details', is_required: false, visibleForChannels: ALL, sort_order: 3 },
  ],
  SURVIVORS: [
    { field_code: 'deceased_ssn',  field_label: 'Deceased Insured Person SSN', field_type: 'TEXT', section_code: 'survivor_details', is_required: true, visibleForChannels: ALL, sort_order: 1 },
    { field_code: 'survivor_category', field_label: 'Survivor Category', field_type: 'SELECT', section_code: 'survivor_details', is_required: true, visibleForChannels: ALL, sort_order: 2, validation_rules: { options: ['SPOUSE', 'CHILD', 'DEPENDANT_PARENT', 'OTHER'] } },
    { field_code: 'relationship_proof_provided', field_label: 'Relationship Proof Provided', field_type: 'CHECKBOX', section_code: 'survivor_details', is_required: false, visibleForChannels: ALL, sort_order: 3 },
    { field_code: 'guardian_name', field_label: 'Guardian / Payee Name', field_type: 'TEXT', section_code: 'survivor_details', is_required: false, visibleForChannels: ALL, sort_order: 4 },
  ],
  NON_CONTRIBUTORY_PENSION: [
    { field_code: 'household_income',     field_label: 'Household Income', field_type: 'NUMBER', section_code: 'non_contributory_pension_details', is_required: true, visibleForChannels: ALL, sort_order: 1 },
    { field_code: 'residency_years',      field_label: 'Years of Residency', field_type: 'NUMBER', section_code: 'non_contributory_pension_details', is_required: true, visibleForChannels: ALL, sort_order: 2 },
    { field_code: 'other_pension_declared', field_label: 'Receiving Other Pension', field_type: 'CHECKBOX', section_code: 'non_contributory_pension_details', is_required: false, visibleForChannels: ALL, sort_order: 3 },
    { field_code: 'inspector_assessment', field_label: 'Inspector Assessment', field_type: 'TEXTAREA', section_code: 'non_contributory_pension_details', is_required: false, visibleForChannels: STAFF, sort_order: 4 },
  ],
};

/**
 * Whole-key aliases — legacy product codes that must keep resolving exactly
 * as they always have. Checked before token analysis.
 */
const BENEFIT_KEY_ALIASES: Record<string, string> = {
  SB: 'SICKNESS', SICK: 'SICKNESS', SKN_SICK: 'SICKNESS',
  MB: 'MATERNITY', SKN_MAT: 'MATERNITY',
  EI: 'EMPLOYMENT_INJURY', INJURY: 'EMPLOYMENT_INJURY', SKN_EI_INJ: 'EMPLOYMENT_INJURY',
  SKN_EI_DIS: 'DISABLEMENT', DIS: 'DISABLEMENT',
  SKN_EI_MED: 'MEDICAL_EXPENSE', MED: 'MEDICAL_EXPENSE',
  SKN_EI_DTH: 'EMPLOYMENT_INJURY_DEATH', EID: 'EMPLOYMENT_INJURY_DEATH',
  FG: 'FUNERAL_GRANT', SKN_FUN: 'FUNERAL_GRANT',
  AB: 'AGE_BENEFIT', AGE: 'AGE_BENEFIT', SKN_AGE: 'AGE_BENEFIT',
  INV: 'INVALIDITY', SKN_INV: 'INVALIDITY',
  SURV: 'SURVIVORS', SKN_SUR: 'SURVIVORS',
  NCP: 'NON_CONTRIBUTORY_PENSION', SKN_NCP: 'NON_CONTRIBUTORY_PENSION',
};

/**
 * Token → benefit key. Applied to individual `_`-separated tokens so that
 * arbitrary product codes (SICK_11, MATERNITY_GRANT_TEST, SKN_STB_SICK…)
 * resolve on their own merit without an entry per product.
 */
const BENEFIT_TOKENS: Record<string, string> = {
  MAT: 'MATERNITY', MATERNITY: 'MATERNITY', MB: 'MATERNITY',
  SICK: 'SICKNESS', SICKNESS: 'SICKNESS', STB: 'SICKNESS', SB: 'SICKNESS',
  EI: 'EMPLOYMENT_INJURY', INJ: 'EMPLOYMENT_INJURY', INJURY: 'EMPLOYMENT_INJURY',
  DIS: 'DISABLEMENT', DISABLEMENT: 'DISABLEMENT',
  MED: 'MEDICAL_EXPENSE', MEDICAL: 'MEDICAL_EXPENSE',
  DTH: 'EMPLOYMENT_INJURY_DEATH', DEATH: 'EMPLOYMENT_INJURY_DEATH', EID: 'EMPLOYMENT_INJURY_DEATH',
  FUN: 'FUNERAL_GRANT', FUNERAL: 'FUNERAL_GRANT', FG: 'FUNERAL_GRANT',
  AGE: 'AGE_BENEFIT', AGEG: 'AGE_BENEFIT', AB: 'AGE_BENEFIT',
  INV: 'INVALIDITY', INVALIDITY: 'INVALIDITY',
  SUR: 'SURVIVORS', SURV: 'SURVIVORS', SURVIVOR: 'SURVIVORS', SURVIVORS: 'SURVIVORS',
  NCP: 'NON_CONTRIBUTORY_PENSION',
};

/** More specific benefit keys win when a code carries competing tokens. */
const BENEFIT_SPECIFICITY: string[] = [
  'EMPLOYMENT_INJURY_DEATH',
  'DISABLEMENT',
  'MEDICAL_EXPENSE',
  'FUNERAL_GRANT',
  'SURVIVORS',
  'NON_CONTRIBUTORY_PENSION',
  'MATERNITY',
  'SICKNESS',
  'INVALIDITY',
  'AGE_BENEFIT',
  'EMPLOYMENT_INJURY',
];

/**
 * Normalize benefit type / product code to a catalogue key.
 */
export function normalizeBenefitKey(key?: string | null): string | null {
  if (!key) return null;
  const u = key.toUpperCase().replace(/[-\s.]/g, '_');
  if (BENEFIT_FIELDS[u]) return u;
  if (BENEFIT_KEY_ALIASES[u]) return BENEFIT_KEY_ALIASES[u];

  const matches = new Set<string>();
  for (const token of u.split('_')) {
    if (!token || /^\d+$/.test(token)) continue;
    const hit = BENEFIT_TOKENS[token];
    if (hit) matches.add(hit);
  }
  if (matches.size === 0) return null;
  for (const candidate of BENEFIT_SPECIFICITY) {
    if (matches.has(candidate)) return candidate;
  }
  return null;
}


export function getDefaultSectionsForBenefit(benefitKey: string): FormSectionDef[] {
  const specific = BENEFIT_SECTIONS[benefitKey];
  const merged = [...SHARED_SECTIONS];
  if (specific) merged.push(specific);
  return merged.sort((a, b) => a.sort_order - b.sort_order);
}

export function getDefaultFieldsForBenefit(benefitKey: string): FormFieldDef[] {
  return [...SHARED_FIELDS, ...(BENEFIT_FIELDS[benefitKey] ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order,
  );
}
