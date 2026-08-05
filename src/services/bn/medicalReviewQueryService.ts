/**
 * BN Medical Reviews — secured read boundary (frontend).
 *
 * Every read goes through a `SECURITY DEFINER` query RPC. The browser NEVER
 * selects from a `bn_medical_review_*` table directly: no table grants exist
 * for `anon`/`authenticated`, and record-level scoping (caseload, workbasket,
 * office, Board membership, provider identity) lives inside the RPCs.
 *
 * Responsibilities of this module:
 *  - invoke the RPC
 *  - map failures to the typed error model (no raw SQL text ever escapes)
 *  - normalise the jsonb envelope into stable, typed view models
 */
import { supabase } from '@/integrations/supabase/client';
import { mapMedicalReviewError, MedicalReviewError } from '@/features/bn/medical-reviews/model/errors';

/* ------------------------------------------------------------------ */
/* Envelope helpers                                                     */
/* ------------------------------------------------------------------ */

type Json = Record<string, unknown>;

export interface PagedResult<T> {
  rows: T[];
  total: number | null;
  limit: number;
  offset: number;
}

async function callQuery(fn: string, args: Record<string, unknown>): Promise<Json> {
  try {
    const { data, error } = await (supabase.rpc as any)(fn, args);
    if (error) throw mapMedicalReviewError(error.message ?? error.code ?? '');
    if (data == null || typeof data !== 'object') return {};
    return data as Json;
  } catch (err) {
    if (err instanceof MedicalReviewError) throw err;
    throw mapMedicalReviewError(err instanceof Error ? err.message : 'E_TRANSPORT');
  }
}

function rowsOf(envelope: Json): Json[] {
  const rows = envelope.rows;
  return Array.isArray(rows) ? (rows as Json[]) : [];
}

function paged<T>(envelope: Json, map: (row: Json) => T): PagedResult<T> {
  return {
    rows: rowsOf(envelope).map(map),
    total: typeof envelope.total === 'number' ? envelope.total : null,
    limit: typeof envelope.limit === 'number' ? envelope.limit : 25,
    offset: typeof envelope.offset === 'number' ? envelope.offset : 0,
  };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const bool = (v: unknown): boolean => v === true;
const int = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback);

/* ------------------------------------------------------------------ */
/* View models                                                          */
/* ------------------------------------------------------------------ */

export interface MedicalReviewWorklistRow {
  obligationId: string;
  obligationReference: string | null;
  awardId: string | null;
  claimId: string | null;
  awardNumber: string | null;
  claimNumber: string | null;
  maskedSsn: string | null;
  reviewType: string | null;
  reviewReason: string | null;
  status: string | null;
  dueDate: string | null;
  graceEndDate: string | null;
  deferredUntil: string | null;
  riskClassification: string | null;
  communicationStatus: string | null;
  rowVersion: number;
}

export interface MedicalReviewDetail extends Json {
  obligationId: string | null;
  obligationReference: string | null;
  awardId: string | null;
  reviewType: string | null;
  reviewReason: string | null;
  obligationStatus: string | null;
  dueDate: string | null;
  noticeDueDate: string | null;
  graceEndDate: string | null;
  deferredUntil: string | null;
  riskClassification: string | null;
  rowVersion: number;
  raw: Json;
}

export interface MedicalReviewAwardContext {
  awardId: string | null;
  awardNumber: string | null;
  awardStatus: string | null;
  benefitCode: string | null;
  startDate: string | null;
  endDate: string | null;
  nextReviewDate: string | null;
  claimId: string | null;
  claimNumber: string | null;
  maskedSsn: string | null;
  openReviews: number;
  raw: Json;
}

export interface MedicalReviewTimelineEntry {
  id: string | null;
  occurredAt: string | null;
  eventType: string | null;
  actorLabel: string | null;
  summary: string | null;
  raw: Json;
}

export interface ProviderReferralRow {
  referralId: string;
  referralReference: string | null;
  status: string | null;
  purpose: string | null;
  acceptanceDeadline: string | null;
  reportDeadline: string | null;
  rowVersion: number;
  raw: Json;
}

export interface BoardCaseRow {
  boardCaseId: string;
  caseReference: string | null;
  obligationId: string | null;
  boardId: string | null;
  status: string | null;
  requiredQuorum: number | null;
  determinationBinding: boolean;
  requiredCompletionDate: string | null;
  rowVersion: number;
  raw: Json;
}

export interface BoardRequirement {
  boardRequired: boolean;
  boardMode: string | null;
  assessmentModel: string | null;
  reason: string | null;
  boardType: string | null;
  raw: Json;
}

export interface ProviderSearchRow {
  providerId: string;
  displayName: string | null;
  providerType: string | null;
  specialties: string[];
  eligible: boolean;
  ineligibleReason: string | null;
  raw: Json;
}

/* ------------------------------------------------------------------ */
/* Mappers                                                              */
/* ------------------------------------------------------------------ */

function mapWorklistRow(r: Json): MedicalReviewWorklistRow {
  return {
    obligationId: String(r.obligation_id ?? ''),
    obligationReference: str(r.obligation_reference),
    awardId: str(r.bn_award_id),
    claimId: str(r.bn_claim_id),
    awardNumber: str(r.award_number),
    claimNumber: str(r.claim_number),
    maskedSsn: str(r.masked_ssn),
    reviewType: str(r.review_type),
    reviewReason: str(r.review_reason),
    status: str(r.status),
    dueDate: str(r.due_date),
    graceEndDate: str(r.grace_end_date),
    deferredUntil: str(r.deferred_until),
    riskClassification: str(r.risk_classification),
    communicationStatus: str(r.communication_status),
    rowVersion: int(r.row_version),
  };
}

function mapTimelineEntry(r: Json): MedicalReviewTimelineEntry {
  return {
    id: str(r.id) ?? str(r.event_id),
    occurredAt: str(r.occurred_at) ?? str(r.created_at),
    eventType: str(r.event_type) ?? str(r.action_code),
    actorLabel: str(r.actor_label) ?? str(r.actor_user_code),
    summary: str(r.summary) ?? str(r.detail),
    raw: r,
  };
}

function mapProviderReferralRow(r: Json): ProviderReferralRow {
  return {
    referralId: String(r.referral_id ?? r.id ?? ''),
    referralReference: str(r.referral_reference),
    status: str(r.referral_status) ?? str(r.status),
    purpose: str(r.referral_purpose),
    acceptanceDeadline: str(r.acceptance_deadline),
    reportDeadline: str(r.report_deadline),
    rowVersion: int(r.row_version),
    raw: r,
  };
}

function mapBoardCaseRow(r: Json): BoardCaseRow {
  return {
    boardCaseId: String(r.board_case_id ?? r.id ?? ''),
    caseReference: str(r.case_reference),
    obligationId: str(r.obligation_id),
    boardId: str(r.board_id),
    status: str(r.board_case_status) ?? str(r.status),
    requiredQuorum: num(r.required_quorum),
    determinationBinding: bool(r.determination_binding),
    requiredCompletionDate: str(r.required_completion_date),
    rowVersion: int(r.row_version),
    raw: r,
  };
}

function mapProviderSearchRow(r: Json): ProviderSearchRow {
  const specialties = Array.isArray(r.specialties) ? (r.specialties as unknown[]).map(String) : [];
  return {
    providerId: String(r.provider_id ?? r.id ?? ''),
    displayName: str(r.display_name) ?? str(r.provider_name),
    providerType: str(r.provider_type),
    specialties,
    eligible: r.eligible !== false,
    ineligibleReason: str(r.ineligible_reason),
    raw: r,
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                           */
/* ------------------------------------------------------------------ */

export const medicalReviewQueryService = {
  /** Benefits Medical Review Centre worklist. `awardId` drives deep links. */
  async worklist(params: {
    awardId?: string | null;
    status?: string | null;
    search?: string | null;
    limit?: number;
    offset?: number;
  } = {}): Promise<PagedResult<MedicalReviewWorklistRow>> {
    const envelope = await callQuery('bn_medical_review_worklist_v1', {
      p_award_id: params.awardId ?? null,
      p_status: params.status ?? null,
      p_search: params.search ?? null,
      p_limit: params.limit ?? 25,
      p_offset: params.offset ?? 0,
    });
    return paged(envelope, mapWorklistRow);
  },

  async detail(obligationId: string): Promise<MedicalReviewDetail> {
    const e = await callQuery('bn_medical_review_detail_v1', { p_obligation_id: obligationId });
    return {
      obligationId: str(e.obligation_id),
      obligationReference: str(e.obligation_reference),
      awardId: str(e.bn_award_id),
      reviewType: str(e.review_type),
      reviewReason: str(e.review_reason),
      obligationStatus: str(e.obligation_status),
      dueDate: str(e.due_date),
      noticeDueDate: str(e.notice_due_date),
      graceEndDate: str(e.grace_end_date),
      deferredUntil: str(e.deferred_until),
      riskClassification: str(e.risk_classification),
      rowVersion: int(e.row_version),
      raw: e,
    };
  },

  async awardContext(awardId: string): Promise<MedicalReviewAwardContext> {
    const e = await callQuery('bn_medical_review_award_context_v1', { p_award_id: awardId });
    return {
      awardId: str(e.bn_award_id),
      awardNumber: str(e.award_number),
      awardStatus: str(e.award_status),
      benefitCode: str(e.benefit_code),
      startDate: str(e.start_date),
      endDate: str(e.end_date),
      nextReviewDate: str(e.next_review_date),
      claimId: str(e.bn_claim_id),
      claimNumber: str(e.claim_number),
      maskedSsn: str(e.masked_ssn),
      openReviews: int(e.open_reviews),
      raw: e,
    };
  },

  async auditTimeline(obligationId: string, limit = 50, offset = 0) {
    const e = await callQuery('bn_medical_review_audit_timeline_v1', {
      p_obligation_id: obligationId,
      p_limit: limit,
      p_offset: offset,
    });
    return paged(e, mapTimelineEntry);
  },

  async communicationHistory(obligationId: string, limit = 25, offset = 0) {
    const e = await callQuery('bn_medical_review_communication_history_v1', {
      p_obligation_id: obligationId,
      p_limit: limit,
      p_offset: offset,
    });
    return paged(e, (r) => r);
  },

  async appointmentHistory(obligationId: string, limit = 25, offset = 0) {
    const e = await callQuery('bn_medical_review_appointment_history_v1', {
      p_obligation_id: obligationId,
      p_limit: limit,
      p_offset: offset,
    });
    return paged(e, (r) => r);
  },

  /** Non-clinical assessment summary. Clinical fields require the confidential RPC. */
  async assessmentSummary(obligationId: string) {
    const e = await callQuery('bn_medical_review_assessment_summary_v1', {
      p_obligation_id: obligationId,
    });
    return { rows: rowsOf(e), confidentialIncluded: bool(e.confidential_included) };
  },

  /** Explicitly separated: requires `view_confidential_medical_evidence`. */
  async confidentialEvidence(obligationId: string, limit = 25, offset = 0) {
    const e = await callQuery('bn_medical_review_confidential_evidence_v1', {
      p_obligation_id: obligationId,
      p_limit: limit,
      p_offset: offset,
    });
    return paged(e, (r) => r);
  },

  async decisionDetail(obligationId: string) {
    const e = await callQuery('bn_medical_review_decision_detail_v1', {
      p_obligation_id: obligationId,
    });
    return rowsOf(e);
  },

  async proposalLinks(obligationId: string) {
    const e = await callQuery('bn_medical_review_proposal_links_v1', {
      p_obligation_id: obligationId,
    });
    return rowsOf(e);
  },

  async boardRequirement(obligationId: string): Promise<BoardRequirement> {
    const e = await callQuery('bn_medical_review_board_requirement_v1', {
      p_obligation_id: obligationId,
    });
    return {
      boardRequired: bool(e.board_required),
      boardMode: str(e.board_mode),
      assessmentModel: str(e.assessment_model),
      reason: str(e.reason),
      boardType: str(e.board_type),
      raw: e,
    };
  },

  async referralDetail(referralId: string) {
    return callQuery('bn_medical_review_referral_detail_v1', { p_referral_id: referralId });
  },

  async providerSearch(term: string, opts: { productId?: string | null; reviewType?: string | null } = {}) {
    const e = await callQuery('bn_medical_review_provider_search_v1', {
      p_term: term,
      p_product_id: opts.productId ?? null,
      p_review_type: opts.reviewType ?? null,
      p_limit: 25,
      p_offset: 0,
    });
    return paged(e, mapProviderSearchRow);
  },

  async policyConfig(productId?: string | null) {
    const e = await callQuery('bn_medical_review_policy_config_v1', {
      p_product_id: productId ?? null,
      p_limit: 50,
      p_offset: 0,
    });
    return paged(e, (r) => r);
  },

  /* ---------------- Provider portal (restricted) ---------------- */

  /** Scoped by the signed-in provider identity inside the RPC. */
  async providerWorklist(limit = 25, offset = 0) {
    const e = await callQuery('bn_medical_review_provider_worklist_v1', {
      p_limit: limit,
      p_offset: offset,
    });
    return {
      ...paged(e, mapProviderReferralRow),
      providerId: str(e.provider_id),
    };
  },

  /** Provider-facing referral detail — clinical scope limited by release rules. */
  async providerReferralDetail(referralId: string) {
    return callQuery('bn_medical_review_provider_referral_detail_v1', { p_referral_id: referralId });
  },

  /* ---------------- Medical Board workspace ---------------- */

  async boardWorklist(limit = 25, offset = 0) {
    const e = await callQuery('bn_medical_review_board_worklist_v1', {
      p_limit: limit,
      p_offset: offset,
    });
    return paged(e, mapBoardCaseRow);
  },

  async boardCaseDetail(boardCaseId: string) {
    return callQuery('bn_medical_review_board_case_detail_v1', { p_board_case_id: boardCaseId });
  },

  async boardSession(sessionId: string) {
    return callQuery('bn_medical_review_board_session_v1', { p_session_id: sessionId });
  },

  async boardDetermination(boardCaseId: string) {
    const e = await callQuery('bn_medical_review_board_determination_v1', {
      p_board_case_id: boardCaseId,
    });
    return rowsOf(e);
  },

  async boardSearch(term?: string | null) {
    const e = await callQuery('bn_medical_review_board_search_v1', {
      p_term: term ?? null,
      p_limit: 25,
      p_offset: 0,
    });
    return paged(e, (r) => r);
  },
};

export type MedicalReviewQueryService = typeof medicalReviewQueryService;
