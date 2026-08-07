/**
 * MEANS-TEST EPIC 6 — Evidence and information requests.
 *
 * Pure domain contract. No I/O, no React.
 *
 * This section answers four questions and nothing else:
 *   • What evidence is required, for which subject, and why?
 *   • What has been received and what does it support?
 *   • Is the received document usable for later verification?
 *   • What information is still outstanding?
 *
 * It never decides whether a fact is true and never decides the means-test
 * outcome. Truth is decided in verification; the outcome is calculated.
 */

export type BnMeansEvidenceSubjectKind =
  | 'ASSESSMENT'
  | 'HOUSEHOLD_MEMBER'
  | 'INCOME_FACT'
  | 'ASSET_FACT'
  | 'DEDUCTION_FACT';

export type BnMeansEvidenceRequirementCode =
  | 'IDENTITY_EVIDENCE'
  | 'RESIDENCE_EVIDENCE'
  | 'HOUSEHOLD_RELATIONSHIP_EVIDENCE'
  | 'INCOME_EVIDENCE'
  | 'ASSET_EVIDENCE'
  | 'DEDUCTION_EVIDENCE';

export type BnMeansEvidenceObligation = 'MANDATORY' | 'CONDITIONAL' | 'OPTIONAL';

export type BnMeansEvidenceUsabilityStatus =
  | 'RECEIVED'
  | 'USABLE'
  | 'UNREADABLE'
  | 'WRONG_DOCUMENT'
  | 'EXPIRED'
  | 'INCOMPLETE'
  | 'SUPERSEDED';

export type BnMeansEvidenceLinkStatus = 'LINKED' | 'UNLINKED';

export type BnMeansDocumentSource =
  | 'BN_CLAIM_EVIDENCE'
  | 'BN_CLAIM_DOCUMENT'
  | 'GENERATED_DOCUMENT'
  | 'EXTERNAL_REFERENCE';

export type BnMeansInformationRequestType =
  | 'DOCUMENT_REQUEST'
  | 'CLARIFICATION'
  | 'DECLARATION'
  | 'THIRD_PARTY_CONFIRMATION';

export type BnMeansInformationRequestStatus =
  | 'OPEN'
  | 'PARTIALLY_RESPONDED'
  | 'RESPONDED'
  | 'FULFILLED'
  | 'CANCELLED';

export type BnMeansInformationResponseKind =
  | 'FULL_RESPONSE'
  | 'PARTIAL_RESPONSE'
  | 'WRONG_INFORMATION'
  | 'NO_RESPONSE'
  | 'WITHDRAWN';

/** A backend-derived obligation. Requirements are never invented in React. */
export interface BnMeansEvidenceRequirement {
  readonly requirement_id: string;
  readonly requirement_code: BnMeansEvidenceRequirementCode;
  readonly requirement_label: string;
  readonly requirement_group: string;
  readonly obligation: BnMeansEvidenceObligation;
  readonly minimum_count: number;
  readonly subject_kind: BnMeansEvidenceSubjectKind;
  readonly subject_ref_id: string | null;
  readonly subject_label: string | null;
  readonly reason: string | null;
  readonly policy_basis: string | null;
  readonly period_from?: string | null;
  readonly period_to?: string | null;
  /** Present on the readiness projection only. */
  readonly received_count?: number;
  readonly usable_count?: number;
  readonly issue_count?: number;
  readonly satisfied?: boolean;
  readonly outstanding?: boolean;
}

export interface BnMeansEvidenceLink {
  readonly link_id: string;
  readonly assessment_id: string;
  readonly evidence_id: string | null;
  readonly requirement_code: BnMeansEvidenceRequirementCode;
  readonly subject_kind: BnMeansEvidenceSubjectKind;
  readonly subject_ref_id: string | null;
  readonly document_source: BnMeansDocumentSource;
  readonly document_ref: string;
  readonly document_title: string | null;
  readonly document_type_code: string | null;
  readonly evidence_type: string;
  readonly evidence_source: string | null;
  readonly document_date: string | null;
  readonly period_from: string | null;
  readonly period_to: string | null;
  readonly expiry_date: string | null;
  readonly usability_status: BnMeansEvidenceUsabilityStatus;
  readonly usability_reason_code: string | null;
  readonly usability_note: string | null;
  readonly link_status: BnMeansEvidenceLinkStatus;
  readonly information_request_id: string | null;
  readonly officer_notes: string | null;
  readonly linked_at: string;
  readonly unlink_reason_code: string | null;
}

export interface BnMeansInformationRequest {
  readonly request_id: string;
  readonly assessment_id: string;
  readonly request_reference: string | null;
  readonly request_type: BnMeansInformationRequestType;
  readonly requirement_code: string | null;
  readonly subject_kind: BnMeansEvidenceSubjectKind | null;
  readonly subject_ref_id: string | null;
  readonly recipient_kind: string | null;
  readonly recipient_label: string | null;
  readonly reason_code: string | null;
  readonly information_required: string | null;
  readonly details: string | null;
  readonly status: BnMeansInformationRequestStatus;
  readonly due_date: string | null;
  readonly is_blocking: boolean;
  readonly requested_at: string;
  readonly responded_at: string | null;
  readonly response_summary: string | null;
  readonly closed_at: string | null;
  readonly close_reason_code: string | null;
}

export interface BnMeansInformationResponse {
  readonly response_id: string;
  readonly request_id: string;
  readonly response_kind: BnMeansInformationResponseKind;
  readonly note: string | null;
  readonly evidence_link_id: string | null;
  readonly recorded_at: string;
}

export interface BnMeansEvidenceReadiness {
  readonly assessment_id: string;
  readonly section_complete: boolean;
  readonly section_status: 'NOT_STARTED' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETE';
  readonly section_marked_complete: boolean;
  readonly completion_invalidated: boolean;
  readonly requirement_total: number;
  readonly mandatory_total: number;
  readonly mandatory_satisfied: number;
  readonly mandatory_outstanding: number;
  readonly optional_outstanding: number;
  readonly linked_document_count: number;
  readonly unusable_document_count: number;
  readonly open_information_requests: number;
  readonly blocking_information_requests: number;
  readonly overdue_information_requests: number;
  readonly requirements: readonly BnMeansEvidenceRequirement[];
  readonly rules: Record<string, unknown>;
  readonly warnings: readonly { code: string; message: string }[];
  readonly blockers: readonly { code: string; message: string }[];
  readonly reason_codes: readonly string[];
}

export interface BnMeansEvidenceDetail {
  readonly assessment_id: string;
  readonly assessment_reference: string | null;
  readonly status: string;
  readonly editable: boolean;
  readonly row_version: number;
  readonly requirements: readonly BnMeansEvidenceRequirement[];
  readonly links: readonly BnMeansEvidenceLink[];
  readonly readiness: BnMeansEvidenceReadiness | null;
  readonly information_requests: readonly BnMeansInformationRequest[];
  readonly information_responses: readonly BnMeansInformationResponse[];
}

export interface BnMeansEvidenceReferenceOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly applies_to?: readonly string[];
  readonly counts_as_usable?: boolean;
  readonly is_issue?: boolean;
}

export type BnMeansEvidenceReference = Readonly<
  Record<string, readonly BnMeansEvidenceReferenceOption[]>
>;

/** Governed document candidate returned by the claim document search. */
export interface BnMeansDocumentCandidate {
  readonly document_source: BnMeansDocumentSource;
  readonly document_ref: string;
  readonly document_title: string | null;
  readonly document_type_code: string | null;
  readonly status: string | null;
  readonly received_at: string | null;
}

/* ------------------------------------------------------------------ */
/* Pure helpers — presentation and pre-submit guards only.            */
/* The backend remains the sole authority for readiness and validity. */
/* ------------------------------------------------------------------ */

/** Usability values that still count towards a requirement's minimum. */
export const BN_MEANS_USABLE_STATUSES: readonly BnMeansEvidenceUsabilityStatus[] = [
  'RECEIVED',
  'USABLE',
];

/** Usability values that represent an unresolved evidence problem. */
export const BN_MEANS_USABILITY_ISSUE_STATUSES: readonly BnMeansEvidenceUsabilityStatus[] = [
  'UNREADABLE',
  'WRONG_DOCUMENT',
  'EXPIRED',
  'INCOMPLETE',
];

export function isUsabilityIssue(status: BnMeansEvidenceUsabilityStatus): boolean {
  return BN_MEANS_USABILITY_ISSUE_STATUSES.includes(status);
}

export function countsTowardsRequirement(status: BnMeansEvidenceUsabilityStatus): boolean {
  return BN_MEANS_USABLE_STATUSES.includes(status);
}

export function isRequestOpen(status: BnMeansInformationRequestStatus): boolean {
  return status !== 'FULFILLED' && status !== 'CANCELLED';
}

export function isRequestOverdue(
  request: Pick<BnMeansInformationRequest, 'status' | 'due_date'>,
  today: string,
): boolean {
  if (!isRequestOpen(request.status)) return false;
  if (!request.due_date) return false;
  return request.due_date < today;
}

/** Active links supporting one requirement instance. */
export function linksForRequirement(
  links: readonly BnMeansEvidenceLink[],
  requirement: Pick<
    BnMeansEvidenceRequirement,
    'requirement_code' | 'subject_kind' | 'subject_ref_id'
  >,
): readonly BnMeansEvidenceLink[] {
  return links.filter(
    (l) =>
      l.link_status === 'LINKED' &&
      l.requirement_code === requirement.requirement_code &&
      l.subject_kind === requirement.subject_kind &&
      (l.subject_ref_id ?? null) === (requirement.subject_ref_id ?? null),
  );
}

/** Evidence types the policy allows for a requirement code. */
export function evidenceTypesFor(
  reference: BnMeansEvidenceReference | null,
  requirementCode: string | null,
): readonly BnMeansEvidenceReferenceOption[] {
  const all = reference?.EVIDENCE_TYPE ?? [];
  if (!requirementCode) return all;
  const filtered = all.filter((o) => (o.applies_to ?? []).includes(requirementCode));
  return filtered.length > 0 ? filtered : all;
}

export interface BnMeansEvidenceLinkDraft {
  readonly requirement_code?: string | null;
  readonly subject_kind?: BnMeansEvidenceSubjectKind | null;
  readonly subject_ref_id?: string | null;
  readonly document_source?: BnMeansDocumentSource | null;
  readonly document_ref?: string | null;
  readonly evidence_type?: string | null;
  readonly document_date?: string | null;
  readonly period_from?: string | null;
  readonly period_to?: string | null;
  readonly expiry_date?: string | null;
}

export interface BnMeansEvidenceValidation {
  readonly ok: boolean;
  readonly errors: readonly { field: string; message: string }[];
  readonly warnings: readonly { field: string; message: string }[];
}

/**
 * Pre-submit guard for a link draft. This mirrors — never replaces — the
 * backend rules; the command boundary re-validates everything.
 */
export function validateEvidenceLinkDraft(
  draft: BnMeansEvidenceLinkDraft,
  existing: readonly BnMeansEvidenceLink[] = [],
  today?: string,
): BnMeansEvidenceValidation {
  const errors: { field: string; message: string }[] = [];
  const warnings: { field: string; message: string }[] = [];

  if (!draft.requirement_code) {
    errors.push({ field: 'requirement_code', message: 'Choose the requirement this document supports.' });
  }
  if (!draft.document_ref) {
    errors.push({ field: 'document_ref', message: 'Select or reference a document.' });
  }
  if (!draft.evidence_type) {
    errors.push({ field: 'evidence_type', message: 'Choose the kind of document.' });
  }
  if (!draft.subject_kind) {
    errors.push({ field: 'subject_kind', message: 'Choose what this document relates to.' });
  } else if (draft.subject_kind !== 'ASSESSMENT' && !draft.subject_ref_id) {
    errors.push({ field: 'subject_ref_id', message: 'Choose the specific record this document supports.' });
  }
  if (draft.period_from && draft.period_to && draft.period_to < draft.period_from) {
    errors.push({ field: 'period_to', message: 'The period end cannot be before the period start.' });
  }

  const duplicate = existing.some(
    (l) =>
      l.link_status === 'LINKED' &&
      l.document_ref === draft.document_ref &&
      l.requirement_code === draft.requirement_code &&
      l.subject_kind === draft.subject_kind &&
      (l.subject_ref_id ?? null) === (draft.subject_ref_id ?? null),
  );
  if (duplicate) {
    errors.push({
      field: 'document_ref',
      message: 'This document is already linked to the same requirement and subject.',
    });
  }

  if (today && draft.expiry_date && draft.expiry_date < today) {
    warnings.push({
      field: 'expiry_date',
      message: 'The document is already out of date. Record a usability check after linking.',
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}

export interface BnMeansInformationRequestDraft {
  readonly request_type?: BnMeansInformationRequestType | null;
  readonly recipient_kind?: string | null;
  readonly reason_code?: string | null;
  readonly information_required?: string | null;
  readonly due_date?: string | null;
  readonly subject_kind?: BnMeansEvidenceSubjectKind | null;
  readonly subject_ref_id?: string | null;
}

export function validateInformationRequestDraft(
  draft: BnMeansInformationRequestDraft,
  today?: string,
): BnMeansEvidenceValidation {
  const errors: { field: string; message: string }[] = [];
  const warnings: { field: string; message: string }[] = [];

  if (!draft.request_type) {
    errors.push({ field: 'request_type', message: 'Choose the kind of request.' });
  }
  if (!draft.recipient_kind) {
    errors.push({ field: 'recipient_kind', message: 'Choose who is being asked.' });
  }
  if (!draft.reason_code) {
    errors.push({ field: 'reason_code', message: 'Record why the information is needed.' });
  }
  if (!draft.information_required || draft.information_required.trim().length < 5) {
    errors.push({
      field: 'information_required',
      message: 'Describe exactly what is being asked for.',
    });
  }
  if (draft.subject_kind && draft.subject_kind !== 'ASSESSMENT' && !draft.subject_ref_id) {
    errors.push({ field: 'subject_ref_id', message: 'Choose the record this request relates to.' });
  }
  if (today && draft.due_date && draft.due_date < today) {
    warnings.push({ field: 'due_date', message: 'The due date is already in the past.' });
  }

  return { ok: errors.length === 0, errors, warnings };
}

export interface BnMeansUsabilityDraft {
  readonly usability_status?: BnMeansEvidenceUsabilityStatus | null;
  readonly usability_reason_code?: string | null;
}

export function validateUsabilityDraft(
  draft: BnMeansUsabilityDraft,
): BnMeansEvidenceValidation {
  const errors: { field: string; message: string }[] = [];
  if (!draft.usability_status) {
    errors.push({ field: 'usability_status', message: 'Record the outcome of the check.' });
  } else if (isUsabilityIssue(draft.usability_status) && !draft.usability_reason_code) {
    errors.push({
      field: 'usability_reason_code',
      message: 'A document that cannot be used needs a reason.',
    });
  }
  return { ok: errors.length === 0, errors, warnings: [] };
}

/** Officer-facing grouping order for the requirement checklist. */
export const BN_MEANS_EVIDENCE_GROUP_ORDER: readonly string[] = [
  'ASSESSMENT',
  'HOUSEHOLD',
  'INCOME',
  'ASSETS',
  'DEDUCTIONS',
];

export function groupRequirements(
  requirements: readonly BnMeansEvidenceRequirement[],
): readonly { group: string; items: readonly BnMeansEvidenceRequirement[] }[] {
  const map = new Map<string, BnMeansEvidenceRequirement[]>();
  for (const r of requirements) {
    const key = r.requirement_group || 'ASSESSMENT';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return [...map.entries()]
    .sort(
      (a, b) =>
        (BN_MEANS_EVIDENCE_GROUP_ORDER.indexOf(a[0]) + 1 || 99) -
        (BN_MEANS_EVIDENCE_GROUP_ORDER.indexOf(b[0]) + 1 || 99),
    )
    .map(([group, items]) => ({ group, items }));
}
