/**
 * BN Risk / Fraud — governed outcome, closure and reopening service (EPIC 5).
 *
 * The single façade between Risk surfaces and the outcome boundary. Reads use
 * SECURITY DEFINER query RPCs; every mutation goes through
 * `bn_risk_outcome_command_v1`.
 *
 * This module never edits a recorded outcome, never decides readiness, never
 * derives closure eligibility, and never reverses a payment hold, referral,
 * overpayment or recalculation in an owning domain. Those answers and effects
 * belong to the backend and to the owning domain only.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  computePayloadHash,
  newRiskUuid,
  parseCommandError,
  riskErrorMessage,
} from '@/services/bn/risk/riskCommandService';
import type { BnRiskQueryResult } from '@/services/bn/risk/riskQueryService';
import type {
  BnRiskClosureReadiness,
  BnRiskOutcomeCommand,
  BnRiskOutcomeCommandResult,
  BnRiskOutcomeQueue,
  BnRiskOutcomeReadinessV1,
} from '@/types/bn/risk/riskOutcome';

async function actorId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

async function callQuery<T>(
  rpc: string,
  args: Record<string, unknown>,
): Promise<BnRiskQueryResult<T>> {
  const { data, error } = await supabase.rpc(rpc as never, args as never);
  if (error) return { status: 'ERROR', code: error.message, data: null };
  const envelope = (data ?? {}) as { status?: string; code?: string; data?: unknown };
  const status = (envelope.status as BnRiskQueryResult<T>['status']) ?? 'ERROR';
  return {
    status,
    code: envelope.code ?? undefined,
    data: status === 'OK' ? ((envelope.data ?? null) as T) : null,
  };
}

function toResult(
  result: Record<string, unknown>,
  correlationId: string,
): BnRiskOutcomeCommandResult {
  return {
    status: (result.status as BnRiskOutcomeCommandResult['status']) ?? 'EXECUTED',
    data: result,
    outcomeId: result.outcome_id as string | undefined,
    closureId: result.closure_id as string | undefined,
    assessmentStatus: result.assessment_status as string | undefined,
    entityVersion: result.entity_version as number | undefined,
    businessMessage: (result.business_message as string | null) ?? null,
    correlationId,
  };
}

function toFailure(message: string, correlationId: string): BnRiskOutcomeCommandResult {
  const parsed = parseCommandError(message);
  return {
    status: 'FAILED',
    data: null,
    errorCode: parsed.code,
    errorMessage: riskErrorMessage(parsed.code, parsed.detail),
    correlationId,
  };
}

interface ExecuteRequest {
  readonly command: BnRiskOutcomeCommand;
  readonly assessmentId: string;
  readonly expectedRowVersion?: number | null;
  readonly payload?: Record<string, unknown>;
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
}

async function execute(request: ExecuteRequest): Promise<BnRiskOutcomeCommandResult> {
  const correlationId = request.correlationId ?? newRiskUuid();
  const payload = request.payload ?? {};
  const payloadHash = await computePayloadHash(payload);

  const actor = await actorId();
  if (!actor) return toFailure('E_UNAUTHENTICATED:', correlationId);

  const { data, error } = await supabase.rpc('bn_risk_outcome_command_v1' as never, {
    p_command_name: request.command,
    p_actor_user_id: actor,
    p_assessment_id: request.assessmentId,
    p_expected_row_version: request.expectedRowVersion ?? null,
    p_payload: payload as never,
    p_idempotency_key: request.idempotencyKey ?? newRiskUuid(),
    p_payload_hash: payloadHash,
    p_correlation_id: correlationId,
  } as never);

  if (error) return toFailure(error.message, correlationId);
  return toResult((data ?? {}) as Record<string, unknown>, correlationId);
}

export const riskOutcomeQueryService = {
  /** Governed answer to "may an outcome be recorded, and what is outstanding?" */
  async outcomeReadiness(
    assessmentId: string,
  ): Promise<BnRiskQueryResult<BnRiskOutcomeReadinessV1>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskOutcomeReadinessV1>('bn_risk_outcome_readiness_v1', {
      p_actor_user_id: actor,
      p_assessment_id: assessmentId,
    });
  },

  /** Governed answer to "may this assessment be closed, or reopened?" */
  async closureReadiness(
    assessmentId: string,
  ): Promise<BnRiskQueryResult<BnRiskClosureReadiness>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskClosureReadiness>('bn_risk_closure_readiness_v1', {
      p_actor_user_id: actor,
      p_assessment_id: assessmentId,
    });
  },

  /** Operational queue across outcome, completion, closure and reopening. */
  async outcomeQueue(
    filters: Record<string, unknown> = {},
    page = 1,
    pageSize = 20,
  ): Promise<BnRiskQueryResult<BnRiskOutcomeQueue>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskOutcomeQueue>('bn_risk_outcome_queue_v1', {
      p_actor_user_id: actor,
      p_filters: filters,
      p_page: page,
      p_page_size: pageSize,
    });
  },
};

export interface BnRiskRecordOutcomeRequest {
  readonly assessmentId: string;
  /** Governed catalogue code, published by readiness. */
  readonly outcomeCode: string;
  readonly reasonCode?: string | null;
  readonly dispositionCode?: string | null;
  readonly justification?: string | null;
  readonly supportingFactorIds?: readonly string[];
  readonly supportingEvidenceIds?: readonly string[];
  readonly externalOutcomeReference?: string | null;
  readonly externalOutcomeSummary?: string | null;
  readonly financialImpactModule?: string | null;
  readonly financialImpactReference?: string | null;
  /** Required by the backend when a control execution failed. */
  readonly unresolvedControlDisposition?: string | null;
  readonly expectedRowVersion?: number | null;
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
}

export interface BnRiskCorrectOutcomeRequest extends BnRiskRecordOutcomeRequest {
  readonly correctionReasonCode: string;
  readonly correctionJustification?: string | null;
}

function outcomePayload(
  request: BnRiskRecordOutcomeRequest,
): Record<string, unknown> {
  return {
    outcome_code: request.outcomeCode,
    reason_code: request.reasonCode ?? null,
    disposition_code: request.dispositionCode ?? null,
    justification: request.justification ?? null,
    supporting_factor_ids: request.supportingFactorIds ?? [],
    supporting_evidence_ids: request.supportingEvidenceIds ?? [],
    external_outcome_reference: request.externalOutcomeReference ?? null,
    external_outcome_summary: request.externalOutcomeSummary ?? null,
    financial_impact_module: request.financialImpactModule ?? null,
    financial_impact_reference: request.financialImpactReference ?? null,
    unresolved_control_disposition: request.unresolvedControlDisposition ?? null,
  };
}

export const riskOutcomeCommandService = {
  /**
   * Records the governed outcome and completes the assessment. The outcome is
   * immutable once recorded.
   */
  async recordOutcome(
    request: BnRiskRecordOutcomeRequest,
  ): Promise<BnRiskOutcomeCommandResult> {
    return execute({
      command: 'BN_RISK_RECORD_OUTCOME',
      assessmentId: request.assessmentId,
      expectedRowVersion: request.expectedRowVersion ?? null,
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
      payload: outcomePayload(request),
    });
  },

  /**
   * Records a superseding outcome. The previous outcome is retained in full —
   * nothing is edited or deleted.
   */
  async correctOutcome(
    request: BnRiskCorrectOutcomeRequest,
  ): Promise<BnRiskOutcomeCommandResult> {
    return execute({
      command: 'BN_RISK_OP_CORRECT_OUTCOME',
      assessmentId: request.assessmentId,
      expectedRowVersion: request.expectedRowVersion ?? null,
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
      payload: {
        ...outcomePayload(request),
        correction_reason_code: request.correctionReasonCode,
        correction_justification: request.correctionJustification ?? null,
      },
    });
  },

  /** Closes the completed assessment. The case history is retained in full. */
  async closeAssessment(request: {
    assessmentId: string;
    closureReasonCode: string;
    closureNote?: string | null;
    expectedRowVersion?: number | null;
    correlationId?: string;
    idempotencyKey?: string;
  }): Promise<BnRiskOutcomeCommandResult> {
    return execute({
      command: 'BN_RISK_CLOSE_ASSESSMENT',
      assessmentId: request.assessmentId,
      expectedRowVersion: request.expectedRowVersion ?? null,
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
      payload: {
        closure_reason_code: request.closureReasonCode,
        closure_note: request.closureNote ?? null,
      },
    });
  },

  /**
   * Exceptional, audited reopening. The backend decides which stage the new
   * review phase starts at; no control, referral or owning-domain effect is
   * reversed, and no previous approval becomes current again.
   */
  async reopenAssessment(request: {
    assessmentId: string;
    reopenReasonCode: string;
    justification: string;
    expectedRowVersion?: number | null;
    correlationId?: string;
    idempotencyKey?: string;
  }): Promise<BnRiskOutcomeCommandResult> {
    return execute({
      command: 'BN_RISK_REOPEN_ASSESSMENT',
      assessmentId: request.assessmentId,
      expectedRowVersion: request.expectedRowVersion ?? null,
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
      payload: {
        reopen_reason_code: request.reopenReasonCode,
        justification: request.justification,
      },
    });
  },
};

export const riskOutcomeService = {
  ...riskOutcomeQueryService,
  ...riskOutcomeCommandService,
};
