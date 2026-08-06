/**
 * MEANS-TEST EPIC 2 — household composition contract.
 *
 * The browser never decides whether the household section is complete:
 * completeness, blockers and warnings come from
 * `bn_means_household_readiness_v1`. The client-side helpers below only
 * stop obviously invalid input from being sent, and translate backend
 * reason codes into officer-readable wording.
 */

export type BnMeansHouseholdSourceKind = 'KNOWN_PERSON' | 'DECLARED';

export type BnMeansDependencyDecision = 'DEPENDANT' | 'NOT_DEPENDANT' | 'UNDETERMINED';

export type BnMeansHouseholdSectionStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'COMPLETE'
  | 'BLOCKED'
  | 'UNAVAILABLE';

export interface BnMeansHouseholdMember {
  readonly member_id: string;
  readonly person_id: number | null;
  readonly is_self: boolean;
  readonly display_name: string;
  readonly masked_identifier: string | null;
  readonly date_of_birth: string | null;
  readonly source_kind: BnMeansHouseholdSourceKind;
  readonly relationship_code: string;
  readonly relationship_label: string;
  readonly member_from: string;
  readonly member_to: string | null;
  readonly is_current: boolean;
  readonly shares_residence: boolean;
  readonly residence_inclusion_reason: string | null;
  readonly residence_inclusion_reason_label: string | null;
  readonly dependency_decision: BnMeansDependencyDecision;
  readonly dependency_decision_label: string;
  readonly dependency_basis: string | null;
  readonly dependency_basis_label: string | null;
  readonly fact_source: string;
  readonly fact_source_label: string;
  readonly verification_status: string;
  readonly evidence_status: string;
  readonly member_notes: string | null;
  readonly member_version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface BnMeansHouseholdRules {
  readonly self_member_mode?: string;
  readonly require_self_member?: boolean;
  readonly allow_declared_members?: boolean;
  readonly require_dependency_basis?: boolean;
  readonly require_residence_reason?: boolean;
}

export interface BnMeansHouseholdDetail {
  readonly assessment_id: string;
  readonly editable: boolean;
  readonly household_rules: BnMeansHouseholdRules;
  readonly members: readonly BnMeansHouseholdMember[];
}

export interface BnMeansHouseholdIssue {
  readonly code: string;
  readonly message: string;
}

export interface BnMeansHouseholdReadiness {
  readonly assessment_id: string;
  readonly section_complete: boolean;
  readonly section_status: Exclude<BnMeansHouseholdSectionStatus, 'UNAVAILABLE'>;
  readonly household_size: number;
  readonly current_members: number;
  readonly total_members: number;
  readonly current_dependants: number;
  readonly members_requiring_evidence: number;
  readonly missing_requirements: readonly { code: string; label: string }[];
  readonly warnings: readonly BnMeansHouseholdIssue[];
  readonly blockers: readonly BnMeansHouseholdIssue[];
  readonly reason_codes: readonly string[];
}

export interface BnMeansHouseholdCandidate {
  readonly candidate_kind: 'CLAIMANT' | 'KNOWN_DEPENDANT';
  readonly person_id: number | null;
  readonly full_name: string;
  readonly masked_identifier: string | null;
  readonly date_of_birth: string | null;
  readonly suggested_relationship: string;
  readonly suggested_fact_source: string;
  readonly already_present: boolean;
}

/** Officer-readable wording for every backend household reason code. */
export const BN_MEANS_HOUSEHOLD_REASON_LABEL: Record<string, string> = {
  SELF_MEMBER_MISSING: 'The assessed person has not been confirmed as a household member.',
  DUPLICATE_MEMBER: 'This member is already recorded for an overlapping period.',
  DUPLICATE_SELF_MEMBER: 'The assessed person is already recorded as a household member.',
  OVERLAPPING_MEMBERSHIP: 'The same person is recorded twice for overlapping periods.',
  INVALID_MEMBERSHIP_DATES: 'The membership end date cannot be before the start date.',
  MEMBER_OUTSIDE_ASSESSMENT_PERIOD: 'This membership period falls outside the assessment period.',
  DEPENDENCY_BASIS_REQUIRED: 'A dependency basis is required when a member is a dependant.',
  RESIDENCE_REASON_REQUIRED: 'An inclusion reason is required for a member who does not share the residence.',
  PERSON_ALREADY_PRESENT: 'This person is already in the household for an overlapping period.',
  PERSON_IS_OWN_DEPENDANT: 'The assessed person cannot be recorded as their own dependant.',
  DECLARED_PERSON_NAME_REQUIRED: 'A full name is required for a declared household member.',
  DECLARED_PERSON_CONTEXT_INVALID: 'Record either a known person or a declared member — not both.',
  HOUSEHOLD_POLICY_REQUIREMENT_MISSING: 'No means-test policy version is attached to this assessment.',
  INVALID_RELATIONSHIP: 'Select a relationship from the governed list.',
  INVALID_DEPENDENCY_DECISION: 'Record an explicit dependency decision.',
  INVALID_FACT_SOURCE: 'Select where this information came from.',
  NO_MEMBERS: 'At least one household member must be recorded.',
};

export function householdReasonLabel(code: string): string {
  return BN_MEANS_HOUSEHOLD_REASON_LABEL[code] ?? code;
}

/** Draft captured by the add / edit member journey. */
export interface BnMeansHouseholdMemberDraft {
  memberId?: string | null;
  sourceKind: BnMeansHouseholdSourceKind;
  personId: number | null;
  declaredFullName: string;
  declaredDateOfBirth: string;
  relationshipCode: string;
  memberFrom: string;
  memberTo: string;
  sharesResidence: boolean;
  residenceInclusionReason: string;
  dependencyDecision: BnMeansDependencyDecision | '';
  dependencyBasis: string;
  factSource: string;
  notes: string;
}

export function emptyHouseholdDraft(defaultFrom: string): BnMeansHouseholdMemberDraft {
  return {
    memberId: null,
    sourceKind: 'KNOWN_PERSON',
    personId: null,
    declaredFullName: '',
    declaredDateOfBirth: '',
    relationshipCode: '',
    memberFrom: defaultFrom,
    memberTo: '',
    sharesResidence: true,
    residenceInclusionReason: '',
    dependencyDecision: '',
    dependencyBasis: '',
    factSource: '',
    notes: '',
  };
}

export function draftFromMember(member: BnMeansHouseholdMember): BnMeansHouseholdMemberDraft {
  return {
    memberId: member.member_id,
    sourceKind: member.source_kind,
    personId: member.person_id,
    declaredFullName: member.source_kind === 'DECLARED' ? member.display_name : '',
    declaredDateOfBirth: member.source_kind === 'DECLARED' ? member.date_of_birth ?? '' : '',
    relationshipCode: member.relationship_code,
    memberFrom: member.member_from,
    memberTo: member.member_to ?? '',
    sharesResidence: member.shares_residence,
    residenceInclusionReason: member.residence_inclusion_reason ?? '',
    dependencyDecision: member.dependency_decision,
    dependencyBasis: member.dependency_basis ?? '',
    factSource: member.fact_source,
    notes: member.member_notes ?? '',
  };
}

/** Field-level errors, keyed by draft field, evaluated before dispatch. */
export function validateHouseholdDraft(
  draft: BnMeansHouseholdMemberDraft,
  context: { assessedPersonId?: number | null; assessmentFrom?: string | null; assessmentTo?: string | null },
): Record<string, string> {
  const errors: Record<string, string> = {};

  if (draft.sourceKind === 'KNOWN_PERSON') {
    if (!draft.personId) errors.person = 'Select the household member.';
  } else if (!draft.declaredFullName.trim()) {
    errors.declaredFullName = householdReasonLabel('DECLARED_PERSON_NAME_REQUIRED');
  }

  if (!draft.relationshipCode) errors.relationshipCode = 'Select a relationship.';
  if (!draft.memberFrom) errors.memberFrom = 'Enter the date the member joined the household.';
  if (draft.memberTo && draft.memberFrom && draft.memberTo < draft.memberFrom) {
    errors.memberTo = householdReasonLabel('INVALID_MEMBERSHIP_DATES');
  }
  if (
    draft.memberTo &&
    context.assessmentFrom &&
    draft.memberTo < context.assessmentFrom
  ) {
    errors.memberTo = householdReasonLabel('MEMBER_OUTSIDE_ASSESSMENT_PERIOD');
  }
  if (!draft.dependencyDecision) {
    errors.dependencyDecision = householdReasonLabel('INVALID_DEPENDENCY_DECISION');
  }
  if (draft.dependencyDecision === 'DEPENDANT' && !draft.dependencyBasis) {
    errors.dependencyBasis = householdReasonLabel('DEPENDENCY_BASIS_REQUIRED');
  }
  if (!draft.sharesResidence && !draft.residenceInclusionReason) {
    errors.residenceInclusionReason = householdReasonLabel('RESIDENCE_REASON_REQUIRED');
  }
  if (!draft.factSource) errors.factSource = householdReasonLabel('INVALID_FACT_SOURCE');

  if (
    draft.sourceKind === 'KNOWN_PERSON' &&
    draft.personId &&
    context.assessedPersonId &&
    draft.personId === context.assessedPersonId &&
    (draft.relationshipCode !== 'SELF' || draft.dependencyDecision === 'DEPENDANT')
  ) {
    errors.relationshipCode = householdReasonLabel('PERSON_IS_OWN_DEPENDANT');
  }

  return errors;
}

/** Command payload. A declared member never receives a fabricated person id. */
export function householdPayload(draft: BnMeansHouseholdMemberDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    relationship_code: draft.relationshipCode,
    member_from: draft.memberFrom,
    member_to: draft.memberTo || null,
    dependency_decision: draft.dependencyDecision || 'UNDETERMINED',
    dependency_basis: draft.dependencyBasis || null,
    shares_residence: draft.sharesResidence,
    residence_inclusion_reason: draft.residenceInclusionReason || null,
    fact_source: draft.factSource,
    member_notes: draft.notes || null,
  };
  if (draft.memberId) payload.member_id = draft.memberId;
  if (draft.sourceKind === 'KNOWN_PERSON') {
    payload.person_id = draft.personId;
  } else {
    payload.declared_person = {
      full_name: draft.declaredFullName.trim(),
      date_of_birth: draft.declaredDateOfBirth || null,
    };
  }
  return payload;
}
