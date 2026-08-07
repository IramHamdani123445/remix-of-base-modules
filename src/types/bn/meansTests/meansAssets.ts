/**
 * MEANS-TEST EPIC 4 — asset assessment contract.
 *
 * The browser never decides whether the assets section is complete, never
 * decides a disregard, and never derives an attributable value:
 * `bn_means_asset_readiness_v1` owns completeness and
 * `bn_means_execute_command_v1` owns everything that is stored. The helpers
 * below only stop obviously invalid input from being dispatched and
 * translate backend reason codes into officer-readable wording.
 */

import type { BnMeansOption, BnMeansOptionSet } from '@/types/bn/meansTests/meansFieldContract';

export type BnMeansAssetSectionStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'COMPLETE'
  | 'BLOCKED'
  | 'UNAVAILABLE';

/** Category metadata is policy-governed and arrives from the backend. */
export interface BnMeansAssetCategoryOption extends BnMeansOption {
  readonly requires_institution?: boolean;
  readonly requires_property_address?: boolean;
  readonly requires_registration?: boolean;
  readonly requires_business_name?: boolean;
  readonly requires_description?: boolean;
  readonly valuation_basis_choice?: boolean;
  readonly fixed_valuation_basis?: string;
  readonly disregard_candidate_default?: boolean;
  readonly evidence_normally_required?: boolean;
}

export interface BnMeansAssetReference {
  readonly ASSET_CATEGORY: readonly (BnMeansAssetCategoryOption & { value: string; label: string })[];
  readonly ASSET_OWNERSHIP_TYPE: readonly BnMeansOption[];
  readonly ASSET_VALUATION_BASIS: readonly BnMeansOption[];
  readonly ASSET_FACT_SOURCE: readonly BnMeansOption[];
  readonly ASSET_DISREGARD_REASON: readonly BnMeansOption[];
  readonly NO_ASSET_REASON: readonly BnMeansOption[];
}

export interface BnMeansAssetFact {
  readonly asset_fact_id: string;
  readonly member_id: string | null;
  readonly member_name: string | null;
  readonly member_relationship: string | null;
  readonly member_is_current: boolean | null;
  readonly category_code: string;
  readonly category_label: string;
  readonly description: string | null;
  readonly asset_details: Record<string, unknown>;
  readonly ownership_type: string;
  readonly ownership_type_label: string;
  readonly ownership_share: number;
  readonly co_owner_note: string | null;
  readonly valuation_amount: number;
  readonly attributable_amount: number;
  readonly currency_code: string;
  readonly valuation_basis: string;
  readonly valuation_basis_label: string;
  readonly valuation_date: string;
  readonly valuation_source: string | null;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly fact_source: string;
  readonly fact_source_label: string;
  readonly evidence_status: string;
  readonly verification_status: string;
  readonly disregard_candidate: boolean;
  readonly disregard_reason_code: string | null;
  readonly disregard_reason_label: string | null;
  readonly asset_notes: string | null;
  readonly fact_version: number;
  readonly supersedes_fact_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface BnMeansNoAssetDeclaration {
  readonly declaration_id: string;
  readonly member_id: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly declaration_source: string;
  readonly declaration_source_label: string;
  readonly reason_code: string | null;
  readonly reason_label: string | null;
  readonly confirmation_note: string | null;
  readonly declared_at: string;
}

export interface BnMeansAssetRules {
  readonly require_ownership_context?: boolean;
  readonly require_declaration_for_every_member?: boolean;
  readonly allow_household_level_asset?: boolean;
  readonly allow_negative_valuation?: boolean;
  readonly allow_foreign_currency?: boolean;
  readonly duplicate_treatment?: 'WARN' | 'BLOCK';
  readonly disregard_decided_at_calculation?: boolean;
}

export interface BnMeansAssetMemberRef {
  readonly member_id: string;
  readonly display_name: string;
  readonly relationship_label: string;
  readonly is_current: boolean;
  readonly member_from: string;
  readonly member_to: string | null;
  readonly dependency_decision_label: string;
}

export interface BnMeansAssetDetail {
  readonly assessment_id: string;
  readonly editable: boolean;
  readonly currency_code: string;
  readonly assessment_from: string;
  readonly assessment_to: string | null;
  readonly asset_rules: BnMeansAssetRules;
  readonly household_members: readonly BnMeansAssetMemberRef[];
  readonly facts: readonly BnMeansAssetFact[];
  readonly no_asset_declarations: readonly BnMeansNoAssetDeclaration[];
}

export interface BnMeansAssetIssue {
  readonly code: string;
  readonly message: string;
}

export interface BnMeansAssetReadiness {
  readonly assessment_id: string;
  readonly section_complete: boolean;
  readonly section_status: Exclude<BnMeansAssetSectionStatus, 'UNAVAILABLE'>;
  readonly section_marked_complete: boolean;
  readonly current_asset_count: number;
  readonly household_members_total: number;
  readonly members_with_assets: number;
  readonly members_with_no_asset_declaration: number;
  readonly members_without_declaration: number;
  readonly declared_attributable_total: number;
  readonly disregard_flagged_count: number;
  readonly currency_code: string;
  readonly missing_requirements: readonly { code: string; label: string }[];
  readonly warnings: readonly BnMeansAssetIssue[];
  readonly blockers: readonly BnMeansAssetIssue[];
  readonly reason_codes: readonly string[];
}

/** Officer-readable wording for every backend asset reason code. */
export const BN_MEANS_ASSET_REASON_LABEL: Record<string, string> = {
  ASSET_CATEGORY_REQUIRED: 'Select an asset category from the governed list.',
  ASSET_OWNER_REQUIRED: 'Select the household member who owns this asset.',
  ASSET_OWNERSHIP_TYPE_REQUIRED: 'Record how this asset is owned.',
  ASSET_OWNERSHIP_SHARE_REQUIRED: 'Record the share of the asset held by this member.',
  INVALID_OWNERSHIP_SHARE: 'The ownership share must be greater than 0% and no more than 100%.',
  ASSET_VALUATION_REQUIRED: 'Enter the value of this asset.',
  NEGATIVE_VALUATION_NOT_PERMITTED: 'A negative valuation is not permitted by the policy.',
  ASSET_VALUATION_BASIS_REQUIRED: 'Record how the value was arrived at.',
  ASSET_VALUATION_BASIS_NOT_PERMITTED: 'That valuation basis is not permitted for this category.',
  ASSET_VALUATION_DATE_REQUIRED: 'Enter the date the asset was valued.',
  ASSET_VALUATION_DATE_IN_FUTURE: 'The valuation date cannot be in the future.',
  ASSET_HELD_FROM_REQUIRED: 'Enter the date the asset started being held.',
  INVALID_ASSET_PERIOD: 'The end date cannot be before the start date.',
  ASSET_FACT_SOURCE_REQUIRED: 'Record where this information came from.',
  ASSET_INSTITUTION_REQUIRED: 'Name the bank, credit union or institution holding this asset.',
  ASSET_PROPERTY_ADDRESS_REQUIRED: 'Enter the address or location of the property.',
  ASSET_REGISTRATION_REQUIRED: 'Enter the registration number of the vehicle.',
  ASSET_BUSINESS_NAME_REQUIRED: 'Enter the name of the business.',
  ASSET_DESCRIPTION_REQUIRED: 'Describe the asset so it can be identified later.',
  ASSET_DISREGARD_REASON_REQUIRED:
    'Select why this asset may be disregarded. The disregard itself is decided at calculation.',
  ASSET_OUTSIDE_ASSESSMENT_PERIOD: 'This asset period falls outside the assessment period.',
  ASSET_OUTSIDE_HOUSEHOLD_MEMBERSHIP:
    'This asset period falls outside the member’s household membership.',
  CURRENCY_MISMATCH: 'The valuation must be recorded in the assessment currency.',
  FOREIGN_CURRENCY_NOT_SUPPORTED:
    'Foreign-currency assets cannot be recorded — no exchange-rate policy is configured.',
  DUPLICATE_ASSET: 'A matching asset already exists for this owner and category.',
  CONFLICTING_ASSET_FACT: 'This record conflicts with a no-assets declaration held for the member.',
  DUPLICATE_NO_ASSET_DECLARATION: 'A no-assets declaration already exists for this member.',
  INVALID_NO_ASSET_REASON: 'Select a reason from the governed list.',
  MEMBER_NOT_FOUND: 'That person is not a household member on this assessment.',
  MEMBER_ASSET_DECLARATION_MISSING:
    'Every household member needs either an asset record or an explicit no-assets declaration.',
  INCOME_SECTION_INCOMPLETE: 'Complete the income assessment before completing assets.',
  NO_HOUSEHOLD_MEMBERS: 'No household members are recorded for this assessment.',
  ASSET_FACT_NOT_FOUND: 'That asset record no longer exists.',
  ASSET_VALIDATION_FAILED: 'The asset record could not be validated.',
  SECTION_NOT_READY: 'The backend does not yet report this section as complete.',
};

export function assetReasonLabel(code: string): string {
  return BN_MEANS_ASSET_REASON_LABEL[code] ?? code;
}

/* ------------------------------------------------------------------ */
/* draft                                                               */
/* ------------------------------------------------------------------ */

export interface BnMeansAssetDraft {
  assetFactId?: string | null;
  memberId: string;
  categoryCode: string;
  description: string;
  institutionName: string;
  accountReference: string;
  propertyAddress: string;
  registrationNumber: string;
  businessName: string;
  ownershipType: string;
  ownershipSharePercent: string;
  coOwnerNote: string;
  valuationAmount: string;
  valuationBasis: string;
  valuationDate: string;
  valuationSource: string;
  effectiveFrom: string;
  effectiveTo: string;
  factSource: string;
  disregardCandidate: boolean;
  disregardReasonCode: string;
  notes: string;
}

export function emptyAssetDraft(defaultFrom: string): BnMeansAssetDraft {
  return {
    assetFactId: null,
    memberId: '',
    categoryCode: '',
    description: '',
    institutionName: '',
    accountReference: '',
    propertyAddress: '',
    registrationNumber: '',
    businessName: '',
    ownershipType: 'SOLE',
    ownershipSharePercent: '100',
    coOwnerNote: '',
    valuationAmount: '',
    valuationBasis: '',
    valuationDate: '',
    valuationSource: '',
    effectiveFrom: defaultFrom,
    effectiveTo: '',
    factSource: '',
    disregardCandidate: false,
    disregardReasonCode: '',
    notes: '',
  };
}

function detailString(details: Record<string, unknown> | null | undefined, key: string): string {
  const value = details?.[key];
  return typeof value === 'string' ? value : '';
}

export function draftFromAssetFact(fact: BnMeansAssetFact): BnMeansAssetDraft {
  const details = fact.asset_details ?? {};
  return {
    assetFactId: fact.asset_fact_id,
    memberId: fact.member_id ?? '',
    categoryCode: fact.category_code,
    description: fact.description ?? '',
    institutionName: detailString(details, 'institution_name'),
    accountReference: detailString(details, 'account_reference'),
    propertyAddress: detailString(details, 'property_address'),
    registrationNumber: detailString(details, 'registration_number'),
    businessName: detailString(details, 'business_name'),
    ownershipType: fact.ownership_type ?? 'SOLE',
    ownershipSharePercent: String(Math.round((fact.ownership_share ?? 1) * 10000) / 100),
    coOwnerNote: fact.co_owner_note ?? '',
    valuationAmount: fact.valuation_amount === null ? '' : String(fact.valuation_amount),
    valuationBasis: fact.valuation_basis ?? '',
    valuationDate: fact.valuation_date,
    valuationSource: fact.valuation_source ?? '',
    effectiveFrom: fact.effective_from,
    effectiveTo: fact.effective_to ?? '',
    factSource: fact.fact_source,
    disregardCandidate: fact.disregard_candidate === true,
    disregardReasonCode: fact.disregard_reason_code ?? '',
    notes: fact.asset_notes ?? '',
  };
}

export function findAssetCategory(
  reference: BnMeansAssetReference | null,
  code: string,
): BnMeansAssetCategoryOption | null {
  if (!reference || !code) return null;
  return reference.ASSET_CATEGORY.find((c) => c.value === code) ?? null;
}

/** Valuation basis is derived from policy when the category does not offer a choice. */
export function resolveValuationBasis(
  category: BnMeansAssetCategoryOption | null,
  chosen: string,
): { value: string; readOnly: boolean } {
  if (category && category.valuation_basis_choice !== true) {
    return { value: category.fixed_valuation_basis ?? 'MARKET_VALUE', readOnly: true };
  }
  return { value: chosen, readOnly: false };
}

export function optionSetFrom(
  options: readonly BnMeansOption[] | undefined,
  state: BnMeansOptionSet['state'],
  reason?: string,
): BnMeansOptionSet {
  return { state, options: options ?? [], reason };
}

/** Officer-facing preview only. The stored attributable value is backend-owned. */
export function previewAttributableAmount(draft: BnMeansAssetDraft): number | null {
  const amount = Number(draft.valuationAmount);
  const share = Number(draft.ownershipSharePercent);
  if (!draft.valuationAmount.trim() || Number.isNaN(amount)) return null;
  if (Number.isNaN(share)) return null;
  return Math.round(amount * (share / 100) * 100) / 100;
}

/** Field-level errors evaluated before dispatch. Never a substitute for the backend. */
export function validateAssetDraft(
  draft: BnMeansAssetDraft,
  context: {
    category: BnMeansAssetCategoryOption | null;
    rules?: BnMeansAssetRules;
    assessmentFrom?: string | null;
    assessmentTo?: string | null;
    member?: BnMeansAssetMemberRef | null;
    today?: string;
  },
): Record<string, string> {
  const errors: Record<string, string> = {};
  const rules = context.rules ?? {};
  const today = context.today ?? new Date().toISOString().slice(0, 10);

  if (!draft.memberId && rules.allow_household_level_asset !== true) {
    errors.memberId = assetReasonLabel('ASSET_OWNER_REQUIRED');
  }
  if (!draft.categoryCode) {
    errors.categoryCode = assetReasonLabel('ASSET_CATEGORY_REQUIRED');
  }
  if (!draft.ownershipType) {
    errors.ownershipType = assetReasonLabel('ASSET_OWNERSHIP_TYPE_REQUIRED');
  }

  const share = Number(draft.ownershipSharePercent);
  if (!draft.ownershipSharePercent.trim()) {
    errors.ownershipShare = assetReasonLabel('ASSET_OWNERSHIP_SHARE_REQUIRED');
  } else if (Number.isNaN(share) || share <= 0 || share > 100) {
    errors.ownershipShare = assetReasonLabel('INVALID_OWNERSHIP_SHARE');
  }

  const category = context.category;
  if (category?.requires_institution && !draft.institutionName.trim()) {
    errors.institutionName = assetReasonLabel('ASSET_INSTITUTION_REQUIRED');
  }
  if (category?.requires_property_address && !draft.propertyAddress.trim()) {
    errors.propertyAddress = assetReasonLabel('ASSET_PROPERTY_ADDRESS_REQUIRED');
  }
  if (category?.requires_registration && !draft.registrationNumber.trim()) {
    errors.registrationNumber = assetReasonLabel('ASSET_REGISTRATION_REQUIRED');
  }
  if (category?.requires_business_name && !draft.businessName.trim()) {
    errors.businessName = assetReasonLabel('ASSET_BUSINESS_NAME_REQUIRED');
  }
  if (category?.requires_description && !draft.description.trim()) {
    errors.description = assetReasonLabel('ASSET_DESCRIPTION_REQUIRED');
  }

  if (!draft.valuationAmount.trim()) {
    errors.valuationAmount = assetReasonLabel('ASSET_VALUATION_REQUIRED');
  } else if (
    draft.valuationAmount.trim().startsWith('-') &&
    rules.allow_negative_valuation !== true
  ) {
    errors.valuationAmount = assetReasonLabel('NEGATIVE_VALUATION_NOT_PERMITTED');
  }

  const basis = resolveValuationBasis(category, draft.valuationBasis);
  if (!basis.value) {
    errors.valuationBasis = assetReasonLabel('ASSET_VALUATION_BASIS_REQUIRED');
  }

  if (!draft.valuationDate) {
    errors.valuationDate = assetReasonLabel('ASSET_VALUATION_DATE_REQUIRED');
  } else if (draft.valuationDate > today) {
    errors.valuationDate = assetReasonLabel('ASSET_VALUATION_DATE_IN_FUTURE');
  }

  if (!draft.factSource) {
    errors.factSource = assetReasonLabel('ASSET_FACT_SOURCE_REQUIRED');
  }

  if (!draft.effectiveFrom) {
    errors.effectiveFrom = assetReasonLabel('ASSET_HELD_FROM_REQUIRED');
  }
  if (draft.effectiveTo && draft.effectiveFrom && draft.effectiveTo < draft.effectiveFrom) {
    errors.effectiveTo = assetReasonLabel('INVALID_ASSET_PERIOD');
  }
  if (draft.effectiveFrom && context.assessmentTo && draft.effectiveFrom > context.assessmentTo) {
    errors.effectiveFrom = assetReasonLabel('ASSET_OUTSIDE_ASSESSMENT_PERIOD');
  }
  if (draft.effectiveTo && context.assessmentFrom && draft.effectiveTo < context.assessmentFrom) {
    errors.effectiveTo = assetReasonLabel('ASSET_OUTSIDE_ASSESSMENT_PERIOD');
  }

  const member = context.member;
  if (member && draft.effectiveFrom) {
    if (
      draft.effectiveFrom < member.member_from ||
      (member.member_to && draft.effectiveFrom > member.member_to) ||
      (member.member_to && draft.effectiveTo && draft.effectiveTo > member.member_to)
    ) {
      errors.effectiveFrom = assetReasonLabel('ASSET_OUTSIDE_HOUSEHOLD_MEMBERSHIP');
    }
  }

  if (draft.disregardCandidate && !draft.disregardReasonCode) {
    errors.disregardReasonCode = assetReasonLabel('ASSET_DISREGARD_REASON_REQUIRED');
  }

  return errors;
}

/** Command payload. Derived values (attributable amount) are never posted. */
export function assetPayload(
  draft: BnMeansAssetDraft,
  context: { category: BnMeansAssetCategoryOption | null; currency: string },
): Record<string, unknown> {
  const basis = resolveValuationBasis(context.category, draft.valuationBasis);
  const details: Record<string, string> = {};
  if (draft.institutionName.trim()) details.institution_name = draft.institutionName.trim();
  if (draft.accountReference.trim()) details.account_reference = draft.accountReference.trim();
  if (draft.propertyAddress.trim()) details.property_address = draft.propertyAddress.trim();
  if (draft.registrationNumber.trim()) details.registration_number = draft.registrationNumber.trim();
  if (draft.businessName.trim()) details.business_name = draft.businessName.trim();

  const payload: Record<string, unknown> = {
    member_id: draft.memberId || null,
    category_code: draft.categoryCode,
    description: draft.description.trim() || null,
    asset_details: details,
    ownership_type: draft.ownershipType,
    ownership_share: Number(draft.ownershipSharePercent) / 100,
    co_owner_note: draft.coOwnerNote.trim() || null,
    valuation_amount: draft.valuationAmount.trim(),
    currency_code: context.currency,
    valuation_basis: basis.value,
    valuation_date: draft.valuationDate,
    valuation_source: draft.valuationSource.trim() || null,
    effective_from: draft.effectiveFrom,
    effective_to: draft.effectiveTo || null,
    fact_source: draft.factSource,
    disregard_candidate: draft.disregardCandidate,
    disregard_reason_code: draft.disregardCandidate ? draft.disregardReasonCode : null,
    asset_notes: draft.notes.trim() || null,
  };
  if (draft.assetFactId) payload.asset_fact_id = draft.assetFactId;
  return payload;
}
