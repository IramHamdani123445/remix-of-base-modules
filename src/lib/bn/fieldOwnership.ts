/**
 * BN Claim Workbench — Field Ownership Registry
 *
 * Classifies each benefit-detail field by who owns it and decides whether
 * it is editable in the workbench given (a) current claim status and
 * (b) the operating user's roles.
 *
 * Ownership classes:
 *   - CITIZEN_SUBMITTED   → captured on the citizen-facing application.
 *                           Read-only after submission. Never overwritten.
 *   - STAFF_REVIEW        → captured by staff during INTAKE / EVIDENCE /
 *                           ELIGIBILITY / CALCULATION. Editable by Claims
 *                           Officer or Supervisor in those statuses.
 *   - SUPERVISOR_DECISION → captured during DECISION by Supervisor/Manager.
 *   - SYSTEM_DERIVED      → computed by engines, never manually editable.
 */

export type FieldOwnership =
  | 'CITIZEN_SUBMITTED'
  | 'STAFF_REVIEW'
  | 'SUPERVISOR_DECISION'
  | 'SYSTEM_DERIVED';

export interface FieldOwnershipDef {
  ownership: FieldOwnership;
  /** Optional citizen-side keys that should map onto this canonical field. */
  aliases?: string[];
}

const STAFF_REVIEW_STATUSES = new Set([
  'INTAKE_REVIEW',
  'EVIDENCE_REVIEW',
  'ELIGIBILITY_CHECK',
  'CALCULATION',
]);

const SUPERVISOR_DECISION_STATUSES = new Set(['DECISION']);

const STAFF_REVIEW_ROLES = new Set([
  'admin',
  'claims_officer',
  'claims officer',
  'supervisor',
  'manager',
]);

const SUPERVISOR_ROLES = new Set(['admin', 'supervisor', 'manager']);

/**
 * Canonical field registry per benefit category.
 * Add new categories incrementally; unknown fields default to STAFF_REVIEW.
 */
export const BN_FIELD_OWNERSHIP: Record<string, Record<string, FieldOwnershipDef>> = {
  // Sickness / Maternity Benefit (short-term cash benefits)
  SHORT_TERM: {
    illness_start_date: { ownership: 'CITIZEN_SUBMITTED', aliases: ['incapacity_date', 'onset_date'] },
    incapacity_date: { ownership: 'CITIZEN_SUBMITTED', aliases: ['illness_start_date'] },
    last_worked_date: { ownership: 'CITIZEN_SUBMITTED' },
    expected_return_date: { ownership: 'CITIZEN_SUBMITTED', aliases: ['return_date'] },
    incapacity_period_days: { ownership: 'SYSTEM_DERIVED' },

    diagnosis_code: { ownership: 'STAFF_REVIEW' },
    doctor_name: { ownership: 'STAFF_REVIEW' },
    doctor_registration: { ownership: 'STAFF_REVIEW', aliases: ['doctor_reg_no'] },
    doctor_reg_no: { ownership: 'STAFF_REVIEW', aliases: ['doctor_registration'] },
    hospital_name: { ownership: 'STAFF_REVIEW', aliases: ['hospital_clinic'] },
    hospital_clinic: { ownership: 'STAFF_REVIEW', aliases: ['hospital_name'] },
    medical_cert_verified: { ownership: 'STAFF_REVIEW' },
    is_work_related: { ownership: 'STAFF_REVIEW', aliases: ['work_related', 'work_related_confirmed'] },
    work_related: { ownership: 'STAFF_REVIEW', aliases: ['is_work_related', 'work_related_confirmed'] },
    employer_notified: { ownership: 'STAFF_REVIEW' },

    // Maternity
    expected_confinement_date: { ownership: 'CITIZEN_SUBMITTED' },
    actual_confinement_date: { ownership: 'STAFF_REVIEW' },
    maternity_leave_start: { ownership: 'CITIZEN_SUBMITTED' },
    maternity_leave_end: { ownership: 'CITIZEN_SUBMITTED' },
  },

  // Age Pension / Long-term
  LONG_TERM: {
    retirement_date: { ownership: 'CITIZEN_SUBMITTED', aliases: ['last_worked_date'] },
    pension_type: { ownership: 'STAFF_REVIEW' },
    pension_path: { ownership: 'STAFF_REVIEW' },
    still_employed: { ownership: 'CITIZEN_SUBMITTED' },
    best_years_start: { ownership: 'SYSTEM_DERIVED' },
    best_years_end: { ownership: 'SYSTEM_DERIVED' },
    total_contribution_weeks: { ownership: 'SYSTEM_DERIVED' },

    // Invalidity
    incapacity_start_date: { ownership: 'CITIZEN_SUBMITTED' },
    employment_cessation_date: { ownership: 'CITIZEN_SUBMITTED' },
    permanent_incapacity: { ownership: 'STAFF_REVIEW' },
    review_interval_months: { ownership: 'STAFF_REVIEW' },
  },
  PENSION: {
    retirement_date: { ownership: 'CITIZEN_SUBMITTED' },
    pension_type: { ownership: 'STAFF_REVIEW' },
    pension_path: { ownership: 'STAFF_REVIEW' },
    still_employed: { ownership: 'CITIZEN_SUBMITTED' },
    tier_applied: { ownership: 'SYSTEM_DERIVED' },
    total_contribution_weeks: { ownership: 'SYSTEM_DERIVED' },
    incapacity_start_date: { ownership: 'CITIZEN_SUBMITTED' },
    employment_cessation_date: { ownership: 'CITIZEN_SUBMITTED' },
    permanent_incapacity: { ownership: 'STAFF_REVIEW' },
    review_interval_months: { ownership: 'STAFF_REVIEW' },
  },

  // Employment Injury / Disablement / Medical Expense
  INJURY: {
    injury_date: { ownership: 'CITIZEN_SUBMITTED', aliases: ['incapacity_date', 'accident_datetime'] },
    accident_datetime: { ownership: 'CITIZEN_SUBMITTED', aliases: ['injury_date'] },
    injury_description: { ownership: 'CITIZEN_SUBMITTED' },
    injury_location: { ownership: 'CITIZEN_SUBMITTED', aliases: ['accident_place'] },
    accident_place: { ownership: 'CITIZEN_SUBMITTED', aliases: ['injury_location'] },
    witnesses: { ownership: 'CITIZEN_SUBMITTED' },
    body_part_affected: { ownership: 'STAFF_REVIEW' },
    disablement_percentage: { ownership: 'STAFF_REVIEW' },
    disablement_type: { ownership: 'STAFF_REVIEW' },
    prior_injury_claim_ref: { ownership: 'CITIZEN_SUBMITTED' },
    review_schedule_months: { ownership: 'STAFF_REVIEW' },
    is_temporary: { ownership: 'STAFF_REVIEW' },
    employer_report_date: { ownership: 'STAFF_REVIEW' },
    work_related: { ownership: 'STAFF_REVIEW', aliases: ['is_work_related', 'work_related_confirmed'] },
    is_work_related: { ownership: 'STAFF_REVIEW', aliases: ['work_related', 'work_related_confirmed'] },
    work_related_confirmed: { ownership: 'STAFF_REVIEW', aliases: ['work_related', 'is_work_related'] },

    // Employment-injury death products filed under the INJURY category
    deceased_ssn: { ownership: 'CITIZEN_SUBMITTED' },
    cause_of_death: { ownership: 'CITIZEN_SUBMITTED' },
    work_related_death_confirmed: { ownership: 'STAFF_REVIEW' },

    // Medical expense
    treatment_provider: { ownership: 'CITIZEN_SUBMITTED' },
    treatment_start: { ownership: 'CITIZEN_SUBMITTED' },
    treatment_end: { ownership: 'CITIZEN_SUBMITTED' },
    expense_category: { ownership: 'STAFF_REVIEW' },
    reimbursement_amount: { ownership: 'STAFF_REVIEW' },
  },

  // Funeral Grant / Maternity Grant / Employment-Injury Death
  GRANT: {
    deceased_ssn: { ownership: 'CITIZEN_SUBMITTED' },
    deceased_name: { ownership: 'CITIZEN_SUBMITTED' },
    date_of_death: { ownership: 'CITIZEN_SUBMITTED' },
    cause_of_death: { ownership: 'CITIZEN_SUBMITTED' },
    relationship_to_claimant: { ownership: 'CITIZEN_SUBMITTED', aliases: ['relationship_to_deceased'] },
    relationship_to_deceased: { ownership: 'CITIZEN_SUBMITTED', aliases: ['relationship_to_claimant'] },
    funeral_date: { ownership: 'CITIZEN_SUBMITTED' },
    funeral_expense_amount: { ownership: 'CITIZEN_SUBMITTED' },
    funeral_home: { ownership: 'STAFF_REVIEW' },
    is_employment_injury_death: { ownership: 'STAFF_REVIEW', aliases: ['work_related_death_confirmed'] },
    work_related_death_confirmed: { ownership: 'STAFF_REVIEW', aliases: ['is_employment_injury_death'] },

    // Maternity grant
    expected_confinement_date: { ownership: 'CITIZEN_SUBMITTED' },
    actual_confinement_date: { ownership: 'STAFF_REVIEW' },
    maternity_leave_start: { ownership: 'CITIZEN_SUBMITTED' },
    maternity_leave_end: { ownership: 'CITIZEN_SUBMITTED' },
  },

  // Survivor Benefit
  SURVIVOR: {
    deceased_ssn: { ownership: 'CITIZEN_SUBMITTED' },
    deceased_name: { ownership: 'CITIZEN_SUBMITTED' },
    date_of_death: { ownership: 'CITIZEN_SUBMITTED' },
    relationship: { ownership: 'CITIZEN_SUBMITTED' },
    survivor_category: { ownership: 'CITIZEN_SUBMITTED', aliases: ['relationship'] },
    survivor_dob: { ownership: 'CITIZEN_SUBMITTED' },
    guardian_name: { ownership: 'CITIZEN_SUBMITTED' },
    relationship_proof_provided: { ownership: 'STAFF_REVIEW' },
    is_dependent_child: { ownership: 'STAFF_REVIEW' },
    school_name: { ownership: 'STAFF_REVIEW' },
  },

  // Non-contributory / Assistance
  NON_CONTRIBUTORY: {
    means_test_date: { ownership: 'STAFF_REVIEW' },
    monthly_income: { ownership: 'CITIZEN_SUBMITTED' },
    household_income: { ownership: 'CITIZEN_SUBMITTED' },
    residency_years: { ownership: 'CITIZEN_SUBMITTED' },
    other_pension_declared: { ownership: 'CITIZEN_SUBMITTED' },
    inspector_assessment: { ownership: 'STAFF_REVIEW' },
    income_threshold: { ownership: 'SYSTEM_DERIVED' },
    means_test_passed: { ownership: 'SUPERVISOR_DECISION' },
    living_arrangement: { ownership: 'CITIZEN_SUBMITTED' },
    other_pension_amount: { ownership: 'CITIZEN_SUBMITTED' },
  },
  ASSISTANCE: {
    means_test_date: { ownership: 'STAFF_REVIEW' },
    monthly_income: { ownership: 'CITIZEN_SUBMITTED' },
    household_income: { ownership: 'CITIZEN_SUBMITTED' },
    residency_years: { ownership: 'CITIZEN_SUBMITTED' },
    other_pension_declared: { ownership: 'CITIZEN_SUBMITTED' },
    inspector_assessment: { ownership: 'STAFF_REVIEW' },
    means_test_passed: { ownership: 'SUPERVISOR_DECISION' },
  },
};


export function getFieldOwnership(
  category: string,
  fieldKey: string,
): FieldOwnership {
  const cat = BN_FIELD_OWNERSHIP[category];
  return cat?.[fieldKey]?.ownership ?? 'STAFF_REVIEW';
}

/**
 * Build the inverse alias map for a category: aliasKey -> canonicalKey.
 * Used by the workbench to fold citizen-form keys (e.g. illness_start_date)
 * onto canonical detail keys (incapacity_date) without losing intent.
 */
export function getAliasMap(category: string): Record<string, string> {
  const cat = BN_FIELD_OWNERSHIP[category] || {};
  const map: Record<string, string> = {};
  for (const [canonical, def] of Object.entries(cat)) {
    for (const alias of def.aliases ?? []) {
      if (!map[alias]) map[alias] = canonical;
    }
  }
  return map;
}

export interface EditableContext {
  category: string;
  fieldKey: string;
  claimStatus: string;
  roles: string[];
}

/**
 * Decide whether a single field is editable in the current context.
 */
export function isFieldEditable({
  category,
  fieldKey,
  claimStatus,
  roles,
}: EditableContext): { editable: boolean; reason: string; ownership: FieldOwnership } {
  const ownership = getFieldOwnership(category, fieldKey);
  const lowerRoles = (roles || []).map((r) => String(r || '').toLowerCase());

  switch (ownership) {
    case 'SYSTEM_DERIVED':
      return { editable: false, reason: 'System-derived — never manually editable.', ownership };

    case 'CITIZEN_SUBMITTED':
      return {
        editable: false,
        reason: 'Submitted by the citizen — read-only on the workbench.',
        ownership,
      };

    case 'STAFF_REVIEW': {
      const inWindow = STAFF_REVIEW_STATUSES.has(claimStatus);
      const hasRole = lowerRoles.some((r) => STAFF_REVIEW_ROLES.has(r));
      if (!inWindow) {
        return {
          editable: false,
          reason: `Staff-review field — only editable in INTAKE_REVIEW, EVIDENCE_REVIEW, ELIGIBILITY_CHECK or CALCULATION (current: ${claimStatus}).`,
          ownership,
        };
      }
      if (!hasRole) {
        return {
          editable: false,
          reason: 'Requires Claims Officer or Supervisor role.',
          ownership,
        };
      }
      return { editable: true, reason: 'Staff-review window open.', ownership };
    }

    case 'SUPERVISOR_DECISION': {
      const inWindow = SUPERVISOR_DECISION_STATUSES.has(claimStatus);
      const hasRole = lowerRoles.some((r) => SUPERVISOR_ROLES.has(r));
      if (!inWindow) {
        return {
          editable: false,
          reason: `Supervisor decision field — only editable in DECISION (current: ${claimStatus}).`,
          ownership,
        };
      }
      if (!hasRole) {
        return { editable: false, reason: 'Requires Supervisor or Manager role.', ownership };
      }
      return { editable: true, reason: 'Supervisor decision window open.', ownership };
    }

    default:
      return { editable: false, reason: 'Unknown ownership class.', ownership };
  }
}

/**
 * Filter a payload of edits so only STAFF_REVIEW / SUPERVISOR_DECISION
 * fields the caller is allowed to write reach the database. Citizen
 * payload is never overwritten.
 */
export function filterEditablePayload(
  category: string,
  edits: Record<string, any>,
  claimStatus: string,
  roles: string[],
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, val] of Object.entries(edits || {})) {
    const { editable } = isFieldEditable({ category, fieldKey: key, claimStatus, roles });
    if (editable) out[key] = val;
  }
  return out;
}
