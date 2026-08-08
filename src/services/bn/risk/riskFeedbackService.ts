/**
 * BN Risk / Fraud — rule feedback service (EPIC 6).
 *
 * The single façade between Risk surfaces and the rule-feedback boundary.
 * Reads use `bn_risk_rule_feedback_readiness_v1`; every mutation goes through
 * `bn_risk_rule_feedback_command_v1`.
 *
 * This module never decides eligibility, never edits recorded feedback, never
 * changes a scoring rule, weight, threshold, band or configuration version,
 * and never triggers a rescore. Feedback is evidence for a later, separately
 * authorised policy decision.
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
  BnRiskFeedbackCommand,
  BnRiskFeedbackCommandResult,
  BnRiskFeedbackReadinessV1,
} from '@/types/bn/risk/riskFeedback';

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
): BnRiskFeedbackCommandResult {
  return {
    status: (result.status as BnRiskFeedbackCommandResult['status']) ?? 'EXECUTED',
    data: result,
    feedbackId: result.feedback_id as string | undefined,
    scoringEffect: (result.scoring_effect as string | undefined) ?? 'NONE',
    businessMessage: (result.business_message as string | null) ?? null,
    correlationId,
  };
}

function toFailure(message: string, correlationId: string): BnRiskFeedbackCommandResult {
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
  readonly command: BnRiskFeedbackCommand;
  readonly assessmentId: string;
  readonly payload: Record<string, unknown>;
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
}

async function execute(request: ExecuteRequest): Promise<BnRiskFeedbackCommandResult> {
  const correlationId = request.correlationId ?? newRiskUuid();
  const payloadHash = await computePayloadHash(request.payload);

  const actor = await actorId();
  if (!actor) return toFailure('E_UNAUTHENTICATED:', correlationId);

  const { data, error } = await supabase.rpc('bn_risk_rule_feedback_command_v1' as never, {
    p_command_name: request.command,
    p_actor_user_id: actor,
    p_assessment_id: request.assessmentId,
    p_payload: request.payload as never,
    p_idempotency_key: request.idempotencyKey ?? newRiskUuid(),
    p_payload_hash: payloadHash,
    p_correlation_id: correlationId,
  } as never);

  if (error) return toFailure(error.message, correlationId);
  return toResult((data ?? {}) as Record<string, unknown>, correlationId);
}

export interface BnRiskRecordFeedbackRequest {
  readonly assessmentId: string;
  /** Governed catalogue code, published by readiness. */
  readonly feedbackCode: string;
  readonly ruleId?: string | null;
  readonly contributionId?: string | null;
  readonly signalId?: string | null;
  readonly factorId?: string | null;
  readonly reasonCode?: string | null;
  readonly notes?: string | null;
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
}

export interface BnRiskCorrectFeedbackRequest extends BnRiskRecordFeedbackRequest {
  readonly feedbackId: string;
  readonly correctionReasonCode: string;
  readonly correctionJustification?: string | null;
}

function feedbackPayload(request: BnRiskRecordFeedbackRequest): Record<string, unknown> {
  return {
    feedback_code: request.feedbackCode,
    rule_id: request.ruleId ?? null,
    contribution_id: request.contributionId ?? null,
    signal_id: request.signalId ?? null,
    factor_id: request.factorId ?? null,
    reason_code: request.reasonCode ?? null,
    notes: request.notes ?? null,
  };
}

export const riskFeedbackQueryService = {
  /**
   * Governed answer to "may feedback be recorded on this assessment, on what,
   * and what is outstanding?".
   */
  async feedbackReadiness(
    assessmentId: string,
  ): Promise<BnRiskQueryResult<BnRiskFeedbackReadinessV1>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskFeedbackReadinessV1>('bn_risk_rule_feedback_readiness_v1', {
      p_actor_user_id: actor,
      p_assessment_id: assessmentId,
    });
  },
};

export const riskFeedbackCommandService = {
  /**
   * Records structured feedback against the rule version, signal or factor that
   * actually informed the review. No scoring configuration changes.
   */
  async recordFeedback(
    request: BnRiskRecordFeedbackRequest,
  ): Promise<BnRiskFeedbackCommandResult> {
    return execute({
      command: 'BN_RISK_UPDATE_RULE_FEEDBACK',
      assessmentId: request.assessmentId,
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
      payload: feedbackPayload(request),
    });
  },

  /**
   * Records superseding feedback. The previous record is retained in full —
   * nothing is edited or deleted.
   */
  async correctFeedback(
    request: BnRiskCorrectFeedbackRequest,
  ): Promise<BnRiskFeedbackCommandResult> {
    return execute({
      command: 'BN_RISK_OP_CORRECT_RULE_FEEDBACK',
      assessmentId: request.assessmentId,
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
      payload: {
        ...feedbackPayload(request),
        feedback_id: request.feedbackId,
        correction_reason_code: request.correctionReasonCode,
        correction_justification: request.correctionJustification ?? null,
      },
    });
  },
};

export const riskFeedbackService = {
  ...riskFeedbackQueryService,
  ...riskFeedbackCommandService,
};
