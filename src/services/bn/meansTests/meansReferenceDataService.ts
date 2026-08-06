/**
 * MEANS-TEST EPIC 0 — governed reference-data boundary.
 *
 * ONE service supplies every controlled list used by Means-Test screens.
 * Components must never declare their own option arrays: a duplicated UI
 * array is how a governed list silently drifts from policy.
 *
 * Stable technical enumerations have a single canonical domain definition
 * here. Policy-dependent or remotely governed sets (benefit programmes,
 * effective policy versions) are declared but report NOT_IMPLEMENTED until
 * their backend read is delivered — they are never faked as an empty list.
 */
import type {
  BnMeansOption,
  BnMeansOptionSet,
} from '@/types/bn/meansTests/meansFieldContract';

export type BnMeansReferenceSet =
  | 'BENEFIT_PROGRAMME'
  | 'ASSESSMENT_REASON'
  | 'POLICY_VERSION'
  | 'CURRENCY'
  | 'RELATIONSHIP_TYPE'
  | 'DEPENDENCY_BASIS'
  | 'INCOME_CATEGORY'
  | 'INCOME_FREQUENCY'
  | 'INCOME_BASIS'
  | 'ASSET_CATEGORY'
  | 'OWNERSHIP_TYPE'
  | 'VALUATION_SOURCE'
  | 'DEDUCTION_CATEGORY'
  | 'EVIDENCE_TYPE'
  | 'VERIFICATION_OUTCOME'
  | 'ADJUSTMENT_REASON'
  | 'APPROVAL_REASON'
  | 'REJECTION_REASON'
  | 'REASSESSMENT_REASON'
  | 'CHANGE_OF_CIRCUMSTANCE_TYPE'
  | 'CLOSURE_REASON';

export interface BnMeansReferenceFilters {
  benefitProgramme?: string;
  policyVersionId?: string;
  effectiveDate?: string;
  lifecycleState?: string;
  /** Epic 1 — restrict a list to one initiation entry context. */
  entryContext?: string;
  /** Actions held by the current user; options may be permission-scoped. */
  grants?: readonly string[];
  /** Default true — inactive options are only returned when explicitly asked for. */
  includeInactive?: boolean;
}

interface CanonicalOption extends BnMeansOption {
  /** Restrict the option to specific programmes. */
  programmes?: readonly string[];
  /** Restrict the option to holders of a module action. */
  requiresAction?: string;
  /** Restrict the option to specific initiation entry contexts. */
  entryContexts?: readonly string[];
  /** Restrict the option to specific lifecycle states. */
  lifecycleStates?: readonly string[];
  validFrom?: string;
  validTo?: string;
}

const o = (
  value: string,
  label: string,
  description?: string,
  extra: Partial<CanonicalOption> = {},
): CanonicalOption => ({ value, label, description, isActive: true, ...extra });

/**
 * Canonical domain definitions for stable technical enumerations.
 * Sets that are governed remotely are intentionally absent — see
 * REMOTE_SETS below.
 */
const CANONICAL: Partial<Record<BnMeansReferenceSet, readonly CanonicalOption[]>> = {
  ASSESSMENT_REASON: [
    o('NEW_CLAIM', 'New claim', 'First assessment supporting a benefit claim.'),
    o('ANNUAL_REVIEW', 'Annual review', 'Scheduled periodic reassessment.'),
    o('CHANGE_OF_CIRCUMSTANCE', 'Change of circumstance', 'Household or financial change reported.'),
    o('APPEAL_DIRECTION', 'Appeal direction', 'Reassessment directed by an appeal outcome.'),
    o('DATA_CORRECTION', 'Data correction', 'Correction of previously recorded facts.'),
  ],
  CURRENCY: [
    o('XCD', 'East Caribbean Dollar (XCD)'),
    o('USD', 'United States Dollar (USD)'),
  ],
  RELATIONSHIP_TYPE: [
    o('SPOUSE', 'Spouse'),
    o('PARTNER', 'Partner'),
    o('CHILD', 'Child'),
    o('PARENT', 'Parent'),
    o('SIBLING', 'Sibling'),
    o('OTHER_DEPENDANT', 'Other dependant'),
    o('NON_DEPENDANT', 'Non-dependant household member'),
  ],
  DEPENDENCY_BASIS: [
    o('FINANCIAL', 'Financially dependent'),
    o('EDUCATION', 'In full-time education'),
    o('DISABILITY', 'Dependent through disability'),
    o('NOT_DEPENDENT', 'Not dependent'),
  ],
  INCOME_CATEGORY: [
    o('EMPLOYMENT', 'Employment earnings'),
    o('SELF_EMPLOYMENT', 'Self-employment income'),
    o('PENSION', 'Pension income'),
    o('SOCIAL_SECURITY_BENEFIT', 'Other social security benefit'),
    o('RENTAL', 'Rental income'),
    o('INVESTMENT', 'Investment income'),
    o('MAINTENANCE', 'Maintenance or support payments'),
    o('OTHER_INCOME', 'Other income'),
  ],
  INCOME_FREQUENCY: [
    o('WEEKLY', 'Weekly'),
    o('FORTNIGHTLY', 'Fortnightly'),
    o('MONTHLY', 'Monthly'),
    o('QUARTERLY', 'Quarterly'),
    o('ANNUAL', 'Annual'),
    o('ONE_OFF', 'One-off'),
  ],
  INCOME_BASIS: [
    o('GROSS', 'Gross'),
    o('NET', 'Net of statutory deductions'),
    o('DECLARED', 'Declared by the applicant'),
    o('ASSESSED', 'Assessed by the officer'),
  ],
  ASSET_CATEGORY: [
    o('BANK_ACCOUNT', 'Bank or credit union account'),
    o('PROPERTY', 'Land or property'),
    o('VEHICLE', 'Vehicle'),
    o('BUSINESS_INTEREST', 'Business interest'),
    o('INVESTMENT_HOLDING', 'Investment holding'),
    o('OTHER_ASSET', 'Other asset'),
  ],
  OWNERSHIP_TYPE: [
    o('SOLE', 'Sole ownership'),
    o('JOINT', 'Joint ownership'),
    o('BENEFICIAL', 'Beneficial interest'),
    o('TRUST', 'Held in trust'),
  ],
  VALUATION_SOURCE: [
    o('DECLARED', 'Declared by the applicant'),
    o('STATEMENT', 'Financial statement'),
    o('PROFESSIONAL_VALUATION', 'Professional valuation'),
    o('REGISTRY', 'Official registry record'),
  ],
  DEDUCTION_CATEGORY: [
    o('HOUSING_COST', 'Housing cost'),
    o('CHILDCARE', 'Childcare cost'),
    o('MEDICAL_COST', 'Medical cost'),
    o('DISABILITY_COST', 'Disability-related cost'),
    o('MAINTENANCE_PAID', 'Maintenance paid'),
    o('OTHER_DEDUCTION', 'Other allowable deduction'),
  ],
  EVIDENCE_TYPE: [
    o('PAYSLIP', 'Payslip'),
    o('BANK_STATEMENT', 'Bank statement'),
    o('TAX_RECORD', 'Tax record'),
    o('TENANCY_AGREEMENT', 'Tenancy agreement'),
    o('VALUATION_REPORT', 'Valuation report'),
    o('DECLARATION', 'Signed declaration'),
    o('OTHER_EVIDENCE', 'Other evidence'),
  ],
  VERIFICATION_OUTCOME: [
    o('VERIFIED', 'Verified'),
    o('NOT_VERIFIED', 'Not verified'),
    o('INFORMATION_REQUESTED', 'Further information requested'),
    o('DISPUTED', 'Disputed'),
  ],
  ADJUSTMENT_REASON: [
    o('FACT_CORRECTION', 'Correction of a recorded fact'),
    o('EVIDENCE_RECEIVED', 'New evidence received'),
    o('POLICY_APPLICATION', 'Policy applied incorrectly'),
    o('CALCULATION_ERROR', 'Calculation error'),
  ],
  APPROVAL_REASON: [
    o('MEETS_POLICY', 'Meets policy in full'),
    o('VERIFIED_AND_COMPLETE', 'Facts verified and complete'),
    o('APPEAL_DIRECTION', 'Approved under appeal direction'),
  ],
  REJECTION_REASON: [
    o('FACTS_UNVERIFIED', 'Facts could not be verified'),
    o('EVIDENCE_INSUFFICIENT', 'Evidence insufficient'),
    o('ABOVE_THRESHOLD', 'Assessed means above the applicable threshold'),
    o('POLICY_NOT_MET', 'Policy conditions not met'),
  ],
  REASSESSMENT_REASON: [
    o('SCHEDULED_REVIEW', 'Scheduled review'),
    o('CHANGE_REPORTED', 'Change reported'),
    o('DATA_MATCH', 'Data match or intelligence'),
    o('APPEAL_DIRECTION', 'Appeal direction'),
  ],
  CHANGE_OF_CIRCUMSTANCE_TYPE: [
    o('HOUSEHOLD_CHANGE', 'Household composition change'),
    o('INCOME_CHANGE', 'Income change'),
    o('ASSET_CHANGE', 'Asset change'),
    o('ADDRESS_CHANGE', 'Address change'),
    o('DEATH', 'Death of a household member'),
  ],
  CLOSURE_REASON: [
    o('SUPERSEDED', 'Superseded by a later assessment'),
    o('WITHDRAWN', 'Withdrawn by the applicant'),
    o('CLAIM_CLOSED', 'Underlying claim closed'),
    o('ADMINISTRATIVE_CLOSURE', 'Administrative closure', undefined, { requiresAction: 'config' }),
  ],
};

/**
 * Sets governed outside the client. They are declared so screens can bind
 * to them today, but they report NOT_IMPLEMENTED rather than pretending to
 * be an empty (and therefore "valid") list.
 */
const REMOTE_SETS: Partial<Record<BnMeansReferenceSet, string>> = {
  BENEFIT_PROGRAMME:
    'Benefit programmes are governed by the Benefits product catalogue. The Means-Test read is delivered in Epic 1.',
  POLICY_VERSION:
    'Effective policy versions are resolved by the calculation policy service. The Means-Test read is delivered in Epic 1.',
};

function applyFilters(
  options: readonly CanonicalOption[],
  filters: BnMeansReferenceFilters,
): readonly BnMeansOption[] {
  const grants = new Set(filters.grants ?? []);
  return options
    .filter((opt) => {
      if (!filters.includeInactive && opt.isActive === false) return false;
      if (opt.programmes && filters.benefitProgramme && !opt.programmes.includes(filters.benefitProgramme)) {
        return false;
      }
      if (opt.lifecycleStates && filters.lifecycleState && !opt.lifecycleStates.includes(filters.lifecycleState)) {
        return false;
      }
      if (opt.requiresAction && !grants.has(opt.requiresAction)) return false;
      if (filters.effectiveDate) {
        if (opt.validFrom && filters.effectiveDate < opt.validFrom) return false;
        if (opt.validTo && filters.effectiveDate > opt.validTo) return false;
      }
      return true;
    })
    .map(({ value, label, description, isActive }) => ({ value, label, description, isActive }));
}

export const meansReferenceDataService = {
  /** Every set this boundary knows about, implemented or not. */
  listSets(): readonly BnMeansReferenceSet[] {
    return [
      ...(Object.keys(CANONICAL) as BnMeansReferenceSet[]),
      ...(Object.keys(REMOTE_SETS) as BnMeansReferenceSet[]),
    ].sort();
  },

  /** Resolve one governed option set under the supplied filters. */
  async options(
    set: BnMeansReferenceSet,
    filters: BnMeansReferenceFilters = {},
  ): Promise<BnMeansOptionSet> {
    const notImplemented = REMOTE_SETS[set];
    if (notImplemented) {
      return { state: 'NOT_IMPLEMENTED', options: [], reason: notImplemented };
    }
    const canonical = CANONICAL[set];
    if (!canonical) {
      return {
        state: 'FAILED',
        options: [],
        reason: `Unknown Means-Test reference set '${set}'.`,
      };
    }
    const options = applyFilters(canonical, filters);
    return {
      state: options.length === 0 ? 'EMPTY' : 'SUCCESS',
      options,
      reason:
        options.length === 0
          ? 'No options are applicable to the current programme, policy version or permissions.'
          : undefined,
    };
  },

  /** Synchronous label lookup for presentation of a stored code. */
  label(set: BnMeansReferenceSet, value: string | null | undefined): string | undefined {
    if (!value) return undefined;
    return CANONICAL[set]?.find((opt) => opt.value === value)?.label;
  },
};

export type MeansReferenceDataService = typeof meansReferenceDataService;
