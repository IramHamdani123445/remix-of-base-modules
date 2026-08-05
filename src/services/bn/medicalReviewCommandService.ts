/**
 * BN Medical Reviews — command boundary (frontend).
 *
 * Rules enforced here:
 *  - the browser NEVER inserts/updates/deletes a `bn_medical_review_*` table;
 *    every state change is a `SECURITY DEFINER` command RPC
 *  - every command carries a client-generated idempotency key
 *  - every version-checked command carries `p_expected_row_version`
 *  - failures are mapped to the typed error model; raw SQL text never leaks
 *
 * Authorisation, dark-launch (`app_modules.actions_enabled`), maker-checker
 * and state-transition rules are all re-enforced server-side. The frontend
 * gating is presentation only.
 */
import { supabase } from '@/integrations/supabase/client';
import { mapMedicalReviewError, MedicalReviewError } from '@/features/bn/medical-reviews/model/errors';
import {
  toAddendumDto,
  toAssessmentFieldsDto,
  toBoardDeterminationDto,
  toBoardParticipationDto,
  toBoardVoteDto,
  toDecisionDto,
  toNonAttendanceDto,
  toReasonableCauseDto,
  type AssessmentFormValues,
} from '@/features/bn/medical-reviews/model/backendContract';


export type CommandStatus = 'OK' | 'REPLAYED' | 'NO_OP' | 'UNKNOWN';

export interface CommandResult<T = Record<string, unknown>> {
  status: CommandStatus;
  /** True when the server recognised a previously-processed idempotency key. */
  replayed: boolean;
  /** True when the command was a safe terminal no-op. */
  noOp: boolean;
  data: T;
}

/** RFC4122 v4 key; falls back when `crypto.randomUUID` is unavailable. */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function callCommand<T = Record<string, unknown>>(
  fn: string,
  args: Record<string, unknown>,
): Promise<CommandResult<T>> {
  try {
    const { data, error } = await (supabase.rpc as any)(fn, args);
    if (error) throw mapMedicalReviewError(error.message ?? error.code ?? '');
    const envelope = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const raw = typeof envelope.status === 'string' ? envelope.status.toUpperCase() : 'UNKNOWN';
    const status: CommandStatus =
      raw === 'OK' || raw === 'REPLAYED' || raw === 'NO_OP' ? (raw as CommandStatus) : 'UNKNOWN';
    return {
      status,
      replayed: status === 'REPLAYED',
      noOp: status === 'NO_OP',
      data: envelope as T,
    };
  } catch (err) {
    if (err instanceof MedicalReviewError) throw err;
    throw mapMedicalReviewError(err instanceof Error ? err.message : 'E_TRANSPORT');
  }
}

/** Shared shape for the version-checked commands. */
interface Versioned {
  expectedRowVersion: number;
  idempotencyKey?: string;
  reason?: string | null;
}

const key = (v?: string) => v ?? newIdempotencyKey();

export const medicalReviewCommandService = {
  newIdempotencyKey,

  /* ---------------- Policy ---------------- */

  publishPolicy(policyId: string, opts: { idempotencyKey?: string; reason?: string | null } = {}) {
    return callCommand('bn_medical_review_publish_policy_v1', {
      p_policy_id: policyId,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  supersedePolicy(
    policyId: string,
    successorPolicyId: string,
    opts: { idempotencyKey?: string; reason?: string | null } = {},
  ) {
    return callCommand('bn_medical_review_supersede_policy_v1', {
      p_policy_id: policyId,
      p_successor_policy_id: successorPolicyId,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  /* ---------------- Obligation ---------------- */

  previewObligation(input: {
    awardId: string;
    policyId: string;
    reviewType: string;
    reviewReason: string;
    periodStart?: string | null;
  }) {
    return callCommand('bn_medical_review_preview_obligation_v1', {
      p_award_id: input.awardId,
      p_policy_id: input.policyId,
      p_review_type: input.reviewType,
      p_review_reason: input.reviewReason,
      p_period_start: input.periodStart ?? null,
    });
  },

  generateObligation(input: {
    awardId: string;
    policyId: string;
    reviewType: string;
    reviewReason: string;
    periodStart: string;
    periodEnd: string;
    riskClassification: string;
    idempotencyKey?: string;
    reason?: string | null;
  }) {
    return callCommand('bn_medical_review_generate_obligation_v1', {
      p_award_id: input.awardId,
      p_policy_id: input.policyId,
      p_review_type: input.reviewType,
      p_review_reason: input.reviewReason,
      p_period_start: input.periodStart,
      p_period_end: input.periodEnd,
      p_risk_classification: input.riskClassification,
      p_idempotency_key: key(input.idempotencyKey),
      p_reason: input.reason ?? null,
    });
  },

  deferReview(
    obligationId: string,
    deferredUntil: string,
    reason: string,
    opts: Versioned,
  ) {
    return callCommand('bn_medical_review_defer_review_v1', {
      p_obligation_id: obligationId,
      p_deferred_until: deferredUntil,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: reason,
    });
  },

  closeReview(obligationId: string, reason: string, opts: Versioned) {
    return callCommand('bn_medical_review_close_review_v1', {
      p_obligation_id: obligationId,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: reason,
    });
  },

  /* ---------------- Referral / provider ---------------- */

  assignProvider(
    obligationId: string,
    providerId: string,
    opts: { idempotencyKey?: string; reason?: string | null } = {},
  ) {
    return callCommand('bn_medical_review_assign_provider_v1', {
      p_obligation_id: obligationId,
      p_provider_id: providerId,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  nominateTreatingDoctor(
    obligationId: string,
    providerId: string,
    opts: { idempotencyKey?: string; reason?: string | null } = {},
  ) {
    return callCommand('bn_medical_review_nominate_treating_doctor_v1', {
      p_obligation_id: obligationId,
      p_provider_id: providerId,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  verifyNominatedProvider(referralId: string, opts: Versioned) {
    return callCommand('bn_medical_review_verify_nominated_provider_v1', {
      p_referral_id: referralId,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  issueReferral(referralId: string, opts: Versioned) {
    return callCommand('bn_medical_review_issue_referral_v1', {
      p_referral_id: referralId,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  acceptReferral(referralId: string, opts: Versioned) {
    return callCommand('bn_medical_review_accept_referral_v1', {
      p_referral_id: referralId,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  declineReferral(referralId: string, declineReason: string, opts: Versioned) {
    return callCommand('bn_medical_review_decline_referral_v1', {
      p_referral_id: referralId,
      p_decline_reason: declineReason,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  expireReferral(referralId: string, opts: Versioned) {
    return callCommand('bn_medical_review_expire_referral_v1', {
      p_referral_id: referralId,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  reassignProvider(referralId: string, providerId: string, reason: string, opts: Versioned) {
    return callCommand('bn_medical_review_reassign_provider_v1', {
      p_referral_id: referralId,
      p_provider_id: providerId,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: reason,
    });
  },

  requestSecondOpinion(input: {
    obligationId: string;
    parentReferralId: string;
    providerId: string;
    reason: string;
    idempotencyKey?: string;
  }) {
    return callCommand('bn_medical_review_request_second_opinion_v1', {
      p_obligation_id: input.obligationId,
      p_parent_referral_id: input.parentReferralId,
      p_provider_id: input.providerId,
      p_idempotency_key: key(input.idempotencyKey),
      p_reason: input.reason,
    });
  },

  /* ---------------- Appointment ---------------- */

  scheduleAppointment(input: {
    referralId: string;
    scheduledAt: string;
    locationReference?: string | null;
    idempotencyKey?: string;
    reason?: string | null;
  }) {
    return callCommand('bn_medical_review_schedule_appointment_v1', {
      p_referral_id: input.referralId,
      p_scheduled_at: input.scheduledAt,
      p_location_reference: input.locationReference ?? null,
      p_idempotency_key: key(input.idempotencyKey),
      p_reason: input.reason ?? null,
    });
  },

  rescheduleAppointment(appointmentId: string, scheduledAt: string, reason: string, opts: Versioned) {
    return callCommand('bn_medical_review_reschedule_appointment_v1', {
      p_appointment_id: appointmentId,
      p_scheduled_at: scheduledAt,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: reason,
    });
  },

  recordAttendance(appointmentId: string, opts: Versioned) {
    return callCommand('bn_medical_review_record_attendance_v1', {
      p_appointment_id: appointmentId,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  /** `category` must be a canonical `non_attendance_category` value. */
  recordNonAttendance(
    appointmentId: string,
    category: string,
    notes: string,
    reason: string,
    opts: Versioned,
  ) {
    const dto = toNonAttendanceDto({ category, notes });
    return callCommand('bn_medical_review_record_non_attendance_v1', {
      p_appointment_id: appointmentId,
      p_category: dto.category,
      p_notes: dto.notes,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: reason,
    });
  },

  recordProviderCancellation(appointmentId: string, notes: string, reason: string, opts: Versioned) {
    return callCommand('bn_medical_review_record_provider_cancellation_v1', {
      p_appointment_id: appointmentId,
      p_notes: notes,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: reason,
    });
  },

  /** Appointment workflow only — never the obligation defer command. */
  recordReasonableCause(appointmentId: string, outcome: string, reason: string, opts: Versioned) {
    const dto = toReasonableCauseDto({ outcome });
    return callCommand('bn_medical_review_record_reasonable_cause_v1', {
      p_appointment_id: appointmentId,
      p_outcome: dto.outcome,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: reason,
    });
  },


  /* ---------------- Assessment ---------------- */

  startAssessment(referralId: string, opts: Versioned) {
    return callCommand('bn_medical_review_start_assessment_v1', {
      p_referral_id: referralId,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  /**
   * Accepts UI form values and maps them through the authoritative adapter,
   * so no unmapped or wrongly-typed key can ever reach `p_fields`.
   */
  saveAssessmentDraft(assessmentId: string, fields: AssessmentFormValues, opts: Versioned) {
    return callCommand('bn_medical_review_save_assessment_draft_v1', {
      p_assessment_id: assessmentId,
      p_fields: toAssessmentFieldsDto(fields),

      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  submitAssessment(assessmentId: string, opts: Versioned) {
    return callCommand('bn_medical_review_submit_assessment_v1', {
      p_assessment_id: assessmentId,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  lockAssessment(assessmentId: string, opts: Versioned) {
    return callCommand('bn_medical_review_lock_assessment_v1', {
      p_assessment_id: assessmentId,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  validateReport(assessmentId: string, opts: Versioned) {
    return callCommand('bn_medical_review_validate_report_v1', {
      p_assessment_id: assessmentId,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  rejectReport(assessmentId: string, rejectionReason: string, opts: Versioned) {
    return callCommand('bn_medical_review_reject_report_v1', {
      p_assessment_id: assessmentId,
      p_rejection_reason: rejectionReason,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  requestClarification(assessmentId: string, requestReason: string, opts: Versioned) {
    return callCommand('bn_medical_review_request_clarification_v1', {
      p_assessment_id: assessmentId,
      p_request_reason: requestReason,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  submitClarification(
    assessmentId: string,
    addendum: { narrative?: unknown; addressesRequest?: unknown },
    opts: Versioned,
  ) {
    return callCommand('bn_medical_review_submit_clarification_v1', {
      p_assessment_id: assessmentId,
      p_addendum_content: toAddendumDto(addendum),

      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  /** Offline/manual receipt path — records provenance, never bypasses validation. */
  recordStaffReceipt(input: {
    assessmentId: string;
    submissionMethod: string;
    providerVerificationMethod: string;
    signedReportDocumentId: string;
    portalNotUsedReason: string;
    idempotencyKey?: string;
    reason?: string | null;
  }) {
    return callCommand('bn_medical_review_record_staff_receipt_v1', {
      p_assessment_id: input.assessmentId,
      p_submission_method: input.submissionMethod,
      p_provider_verification_method: input.providerVerificationMethod,
      p_signed_report_document_id: input.signedReportDocumentId,
      p_portal_not_used_reason: input.portalNotUsedReason,
      p_idempotency_key: key(input.idempotencyKey),
      p_reason: input.reason ?? null,
    });
  },

  /* ---------------- Medical Board ---------------- */

  referToBoard(obligationId: string, assessmentId: string, reason: string, idempotencyKey?: string) {
    return callCommand('bn_medical_review_refer_to_board_v1', {
      p_obligation_id: obligationId,
      p_assessment_id: assessmentId,
      p_idempotency_key: key(idempotencyKey),
      p_reason: reason,
    });
  },

  selectBoard(boardCaseId: string, boardId: string, opts: Versioned) {
    return callCommand('bn_medical_review_select_board_v1', {
      p_board_case_id: boardCaseId,
      p_board_id: boardId,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  assignBoardMembers(boardCaseId: string, memberIds: string[], opts: Versioned) {
    return callCommand('bn_medical_review_assign_board_members_v1', {
      p_board_case_id: boardCaseId,
      p_member_ids: memberIds,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  requestBoardEvidence(boardCaseId: string, evidenceTypes: string[], reason: string, opts: Versioned) {
    return callCommand('bn_medical_review_request_board_evidence_v1', {
      p_board_case_id: boardCaseId,
      p_evidence_types: evidenceTypes,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: reason,
    });
  },

  scheduleBoardSession(input: {
    boardCaseId: string;
    scheduledAt: string;
    locationReference?: string | null;
    meetingMode: string;
    expectedRowVersion: number;
    idempotencyKey?: string;
    reason?: string | null;
  }) {
    return callCommand('bn_medical_review_schedule_board_session_v1', {
      p_board_case_id: input.boardCaseId,
      p_scheduled_at: input.scheduledAt,
      p_location_reference: input.locationReference ?? null,
      p_meeting_mode: input.meetingMode,
      p_expected_row_version: input.expectedRowVersion,
      p_idempotency_key: key(input.idempotencyKey),
      p_reason: input.reason ?? null,
    });
  },

  recordBoardParticipation(
    sessionId: string,
    memberId: string,
    attendanceStatus: string,
    opts: { idempotencyKey?: string; reason?: string | null } = {},
  ) {
    return callCommand('bn_medical_review_record_board_participation_v1', {
      p_session_id: sessionId,
      p_member_id: memberId,
      p_attendance_status: attendanceStatus,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  declareBoardConflict(
    sessionId: string,
    memberId: string,
    conflictDetails: string,
    opts: { idempotencyKey?: string; reason?: string | null } = {},
  ) {
    return callCommand('bn_medical_review_declare_board_conflict_v1', {
      p_session_id: sessionId,
      p_member_id: memberId,
      p_conflict_details: conflictDetails,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  recordRecusal(sessionId: string, memberId: string, reason: string, idempotencyKey?: string) {
    return callCommand('bn_medical_review_record_recusal_v1', {
      p_session_id: sessionId,
      p_member_id: memberId,
      p_idempotency_key: key(idempotencyKey),
      p_reason: reason,
    });
  },

  recordBoardVote(input: {
    sessionId: string;
    memberId: string;
    vote: string;
    voteOutcomeCode: string;
    voteReason: string;
    idempotencyKey?: string;
  }) {
    return callCommand('bn_medical_review_record_board_vote_v1', {
      p_session_id: input.sessionId,
      p_member_id: input.memberId,
      p_vote: input.vote,
      p_vote_outcome_code: input.voteOutcomeCode,
      p_vote_reason: input.voteReason,
      p_idempotency_key: key(input.idempotencyKey),
    });
  },

  finaliseBoardDetermination(input: {
    boardCaseId: string;
    sessionId: string;
    outcomeCode: string;
    determinationSummary: string;
    impairmentPercentage: number | null;
    expectedRowVersion: number;
    idempotencyKey?: string;
    reason?: string | null;
  }) {
    return callCommand('bn_medical_review_finalise_board_determination_v1', {
      p_board_case_id: input.boardCaseId,
      p_session_id: input.sessionId,
      p_outcome_code: input.outcomeCode,
      p_determination_summary: input.determinationSummary,
      p_impairment_percentage: input.impairmentPercentage,
      p_expected_row_version: input.expectedRowVersion,
      p_idempotency_key: key(input.idempotencyKey),
      p_reason: input.reason ?? null,
    });
  },

  deferBoardCase(boardCaseId: string, deferredUntil: string, reason: string, opts: Versioned) {
    return callCommand('bn_medical_review_defer_board_case_v1', {
      p_board_case_id: boardCaseId,
      p_deferred_until: deferredUntil,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: reason,
    });
  },

  reconveneBoardCase(input: {
    boardCaseId: string;
    scheduledAt: string;
    locationReference?: string | null;
    expectedRowVersion: number;
    idempotencyKey?: string;
    reason?: string | null;
  }) {
    return callCommand('bn_medical_review_reconvene_board_case_v1', {
      p_board_case_id: input.boardCaseId,
      p_scheduled_at: input.scheduledAt,
      p_location_reference: input.locationReference ?? null,
      p_expected_row_version: input.expectedRowVersion,
      p_idempotency_key: key(input.idempotencyKey),
      p_reason: input.reason ?? null,
    });
  },

  /* ---------------- Administrative decision ---------------- */

  prepareDecision(input: {
    obligationId: string;
    assessmentId: string | null;
    boardCaseId: string | null;
    outcomeCode: string;
    medicalRecommendationAccepted: boolean;
    departureReason: string | null;
    effectiveDate: string;
    nextReviewDate: string | null;
    reasonCode: string;
    reasonNarrative: string;
    idempotencyKey?: string;
  }) {
    return callCommand('bn_medical_review_prepare_decision_v1', {
      p_obligation_id: input.obligationId,
      p_assessment_id: input.assessmentId,
      p_board_case_id: input.boardCaseId,
      p_outcome_code: input.outcomeCode,
      p_medical_recommendation_accepted: input.medicalRecommendationAccepted,
      p_departure_reason: input.departureReason,
      p_effective_date: input.effectiveDate,
      p_next_review_date: input.nextReviewDate,
      p_reason_code: input.reasonCode,
      p_reason_narrative: input.reasonNarrative,
      p_idempotency_key: key(input.idempotencyKey),
    });
  },

  submitDecision(decisionId: string, opts: Versioned) {
    return callCommand('bn_medical_review_submit_decision_v1', {
      p_decision_id: decisionId,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  /** Maker-checker: the server rejects self-approval with E_SELF_APPROVAL_FORBIDDEN. */
  approveDecision(decisionId: string, opts: Versioned) {
    return callCommand('bn_medical_review_approve_decision_v1', {
      p_decision_id: decisionId,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  returnDecision(decisionId: string, returnedReason: string, opts: Versioned) {
    return callCommand('bn_medical_review_return_decision_v1', {
      p_decision_id: decisionId,
      p_returned_reason: returnedReason,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
    });
  },

  completeDecision(decisionId: string, opts: Versioned) {
    return callCommand('bn_medical_review_complete_decision_v1', {
      p_decision_id: decisionId,
      p_expected_row_version: opts.expectedRowVersion,
      p_idempotency_key: key(opts.idempotencyKey),
      p_reason: opts.reason ?? null,
    });
  },

  /* ---------------- Award Suspension boundary ----------------
   * These create a PROPOSAL only. Medical Review never mutates an award,
   * a payment or a suspension record — execution stays with the Award
   * Suspension command boundary and its own approvals.
   */

  proposeSuspension(decisionId: string, reason: string, idempotencyKey?: string) {
    return callCommand('bn_medical_review_propose_suspension_v1', {
      p_decision_id: decisionId,
      p_idempotency_key: key(idempotencyKey),
      p_reason: reason,
    });
  },

  proposeReinstatement(decisionId: string, reason: string, idempotencyKey?: string) {
    return callCommand('bn_medical_review_propose_reinstatement_v1', {
      p_decision_id: decisionId,
      p_idempotency_key: key(idempotencyKey),
      p_reason: reason,
    });
  },
};

export type MedicalReviewCommandService = typeof medicalReviewCommandService;
