/**
 * BN Risk / Fraud — governed control recommendation and approval service
 * (EPIC 3).
 *
 * Reads use the SECURITY DEFINER query RPCs; every mutation goes through
 * `bn_risk_control_command_v1`. Browser roles hold no privilege on
 * `bn_risk_recommendation`, `bn_risk_recommendation_decision` or the control
 * catalogue, so this module is the only route to a recommendation or a
 * decision. Nothing here executes a control, and nothing here decides which
 * control to recommend.
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
  BnRiskControlApprovalQueue,
  BnRiskControlApprovalReadiness,
  BnRiskControlCommand,
  BnRiskControlCommandResult,
  BnRiskControlDecision,
  BnRiskRecommendationHistory,
  BnRiskRecommendationReadiness,
} from '@/types/bn/risk/riskControl';

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

export interface BnRiskRecommendControlRequest {
  readonly assessmentId: string;
  readonly controlCode: string;
  readonly reasonCode: string;
  readonly justification?: string | null;
  readonly targetType?: string | null;
  readonly targetId?: string | null;
  readonly targetReference?: string | null;
  readonly requestedEffectiveFrom?: string | null;
  readonly requestedEffectiveTo?: string | null;
  readonly scopeNote?: string | null;
  readonly supportingFactorIds?: readonly string[];
  readonly supportingEvidenceIds?: readonly string[];
  readonly expectedRowVersion?: number | null;
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
}

export interface BnRiskControlDecisionRequest {
  readonly assessmentId: string;
  readonly decision: BnRiskControlDecision;
  readonly reasonCode: string;
  readonly notes?: string | null;
  readonly expectedRowVersion?: number | null;
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
}

function toResult(
  result: Record<string, unknown>,
  correlationId: string,
): BnRiskControlCommandResult {
  return {
    status: (result.status as BnRiskControlCommandResult['status']) ?? 'EXECUTED',
    data: result,
    assessmentId: result.assessment_id as string | undefined,
    assessmentStatus: result.assessment_status as string | undefined,
    recommendationId: result.recommendation_id as string | undefined,
    decision: result.decision as BnRiskControlDecision | undefined,
    executionState: result.execution_state as BnRiskControlCommandResult['executionState'],
    entityVersion: result.entity_version as number | undefined,
    correlationId,
  };
}

function toFailure(message: string, correlationId: string): BnRiskControlCommandResult {
  const parsed = parseCommandError(message);
  return {
    status: 'FAILED',
    data: null,
    errorCode: parsed.code,
    errorMessage: riskErrorMessage(parsed.code, parsed.detail),
    correlationId,
  };
}

async function execute(request: {
  command: BnRiskControlCommand;
  assessmentId: string;
  expectedRowVersion?: number | null;
  reasonCode?: string | null;
  justification?: string | null;
  payload?: Record<string, unknown>;
  correlationId?: string;
  idempotencyKey?: string;
}): Promise<BnRiskControlCommandResult> {
  const correlationId = request.correlationId ?? newRiskUuid();
  const payload = request.payload ?? {};
  const payloadHash = await computePayloadHash(payload);

  const { data: auth } = await supabase.auth.getUser();
  const actor = auth?.user?.id ?? null;
  if (!actor) return toFailure('E_UNAUTHENTICATED:', correlationId);

  const { data, error } = await supabase.rpc('bn_risk_control_command_v1' as never, {
    p_command_name: request.command,
    p_assessment_id: request.assessmentId,
    p_actor_user_id: actor,
    p_actor_user_code: auth?.user?.email ?? actor,
    p_correlation_id: correlationId,
    p_expected_row_version: request.expectedRowVersion ?? null,
    p_reason_code: request.reasonCode ?? null,
    p_justification: request.justification ?? null,
    p_payload: payload as never,
    p_payload_hash: payloadHash,
    p_idempotency_key: request.idempotencyKey ?? newRiskUuid(),
  } as never);

  if (error) return toFailure(error.message, correlationId);
  return toResult((data ?? {}) as Record<string, unknown>, correlationId);
}

export const riskControlQueryService = {
  /** Governed answer to "may a control be recommended, and with what options?" */
  async recommendationReadiness(
    assessmentId: string,
  ): Promise<BnRiskQueryResult<BnRiskRecommendationReadiness>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskRecommendationReadiness>('bn_risk_recommendation_readiness_v1', {
      p_actor_user_id: actor,
      p_assessment_id: assessmentId,
    });
  },

  /** Governed answer to "may this recommendation be decided, and by me?" */
  async approvalReadiness(
    assessmentId: string,
  ): Promise<BnRiskQueryResult<BnRiskControlApprovalReadiness>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskControlApprovalReadiness>('bn_risk_control_approval_readiness_v1', {
      p_actor_user_id: actor,
      p_assessment_id: assessmentId,
    });
  },

  /** Immutable recommendation cycles and their decisions. */
  async recommendationHistory(
    assessmentId: string,
  ): Promise<BnRiskQueryResult<BnRiskRecommendationHistory>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskRecommendationHistory>('bn_risk_recommendation_history_v1', {
      p_actor_user_id: actor,
      p_assessment_id: assessmentId,
    });
  },

  /** Governed approval work queue. */
  async approvalQueue(
    filters: Record<string, unknown> = {},
    page = 1,
    pageSize = 20,
  ): Promise<BnRiskQueryResult<BnRiskControlApprovalQueue>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskControlApprovalQueue>('bn_risk_control_approval_queue_v1', {
      p_actor_user_id: actor,
      p_filters: filters,
      p_page: page,
      p_page_size: pageSize,
    });
  },
};

export const riskControlCommandService = {
  /** BN_RISK_RECOMMEND_CONTROL — records a recommendation only. */
  async recommendControl(
    request: BnRiskRecommendControlRequest,
  ): Promise<BnRiskControlCommandResult> {
    return execute({
      command: 'BN_RISK_RECOMMEND_CONTROL',
      assessmentId: request.assessmentId,
      expectedRowVersion: request.expectedRowVersion ?? null,
      reasonCode: request.reasonCode,
      justification: request.justification ?? null,
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
      payload: {
        control_code: request.controlCode,
        target_type: request.targetType ?? null,
        target_id: request.targetId ?? null,
        target_reference: request.targetReference ?? null,
        requested_effective_from: request.requestedEffectiveFrom ?? null,
        requested_effective_to: request.requestedEffectiveTo ?? null,
        scope_note: request.scopeNote ?? null,
        supporting_factor_ids: [...(request.supportingFactorIds ?? [])],
        supporting_evidence_ids: [...(request.supportingEvidenceIds ?? [])],
      },
    });
  },

  /** BN_RISK_APPROVE_CONTROL — approve, reject or return for review. */
  async decideControl(
    request: BnRiskControlDecisionRequest,
  ): Promise<BnRiskControlCommandResult> {
    return execute({
      command: 'BN_RISK_APPROVE_CONTROL',
      assessmentId: request.assessmentId,
      expectedRowVersion: request.expectedRowVersion ?? null,
      reasonCode: request.reasonCode,
      justification: request.notes ?? null,
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
      payload: { decision: request.decision },
    });
  },

  /** Supporting operation — the recommending officer withdraws a pending cycle. */
  async withdrawRecommendation(request: {
    assessmentId: string;
    justification?: string | null;
    expectedRowVersion?: number | null;
    idempotencyKey?: string;
  }): Promise<BnRiskControlCommandResult> {
    return execute({
      command: 'BN_RISK_OP_WITHDRAW_RECOMMENDATION',
      assessmentId: request.assessmentId,
      expectedRowVersion: request.expectedRowVersion ?? null,
      justification: request.justification ?? null,
      idempotencyKey: request.idempotencyKey,
      payload: {},
    });
  },
};

export const riskControlService = {
  ...riskControlQueryService,
  ...riskControlCommandService,
};
