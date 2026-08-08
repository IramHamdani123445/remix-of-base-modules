/**
 * BN Risk / Fraud — governed scoring service (EPIC 2).
 *
 * Reads use the SECURITY DEFINER query RPCs; every scoring mutation goes
 * through `bn_risk_scoring_command_v1`, and every configuration mutation
 * through `bn_risk_scoring_config_command_v1`. Browser roles hold no write
 * privilege on `bn_risk_score`, `bn_risk_score_contribution` or any scoring
 * configuration table.
 *
 * This module sends only references (assessment id, rule set id, expected
 * row version, correlation id, idempotency key) plus officer-entered text.
 * It NEVER sends a score, band, contribution, threshold or weight, and it
 * never derives one.
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
  BnRiskReviewReadiness,
  BnRiskScoreDetail,
  BnRiskScoringCommand,
  BnRiskScoringCommandResult,
  BnRiskScoringConfigCommand,
  BnRiskScoringConfiguration,
  BnRiskScoringReadiness,
} from '@/types/bn/risk/riskScoring';

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

export interface BnRiskScoringCommandRequest {
  readonly command: BnRiskScoringCommand;
  readonly assessmentId: string;
  readonly expectedRowVersion?: number | null;
  readonly reasonCode?: string | null;
  readonly justification?: string | null;
  /** Officer-entered context only (e.g. a recalculation reason). */
  readonly payload?: Record<string, unknown>;
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
}

export interface BnRiskScoringConfigCommandRequest {
  readonly command: BnRiskScoringConfigCommand;
  readonly ruleSetId?: string | null;
  readonly expectedRowVersion?: number | null;
  readonly justification?: string | null;
  readonly payload?: Record<string, unknown>;
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
}

function toResult(
  result: Record<string, unknown>,
  correlationId: string,
): BnRiskScoringCommandResult {
  return {
    status: (result.status as BnRiskScoringCommandResult['status']) ?? 'EXECUTED',
    data: result,
    assessmentId: result.assessment_id as string | undefined,
    assessmentStatus: result.assessment_status as string | undefined,
    ruleSetId: result.rule_set_id as string | undefined,
    scoreId: result.score_id as string | undefined,
    versionNo: result.version_no as number | undefined,
    entityVersion: result.entity_version as number | undefined,
    correlationId,
  };
}

function toFailure(message: string, correlationId: string): BnRiskScoringCommandResult {
  const parsed = parseCommandError(message);
  return {
    status: 'FAILED',
    data: null,
    errorCode: parsed.code,
    errorMessage: riskErrorMessage(parsed.code, parsed.detail),
    correlationId,
  };
}

export const riskScoringQueryService = {
  /** Governed answer to "may this assessment be scored, and is a score current?" */
  async scoringReadiness(
    assessmentId: string,
  ): Promise<BnRiskQueryResult<BnRiskScoringReadiness>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskScoringReadiness>('bn_risk_scoring_readiness_v1', {
      p_actor_user_id: actor,
      p_assessment_id: assessmentId,
    });
  },

  /** Immutable score record, its explanation lines and the full score history. */
  async scoreDetail(assessmentId: string): Promise<BnRiskQueryResult<BnRiskScoreDetail>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskScoreDetail>('bn_risk_score_detail_v1', {
      p_actor_user_id: actor,
      p_assessment_id: assessmentId,
    });
  },

  /** Governed answer to "may the scoring review be completed?" */
  async reviewReadiness(
    assessmentId: string,
  ): Promise<BnRiskQueryResult<BnRiskReviewReadiness>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskReviewReadiness>('bn_risk_review_readiness_v1', {
      p_actor_user_id: actor,
      p_assessment_id: assessmentId,
    });
  },

  /** Scoring configuration versions; detail is returned only to administrators. */
  async scoringConfiguration(
    ruleSetId?: string | null,
  ): Promise<BnRiskQueryResult<BnRiskScoringConfiguration>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskScoringConfiguration>('bn_risk_scoring_configuration_v1', {
      p_actor_user_id: actor,
      p_rule_set_id: ruleSetId ?? null,
    });
  },
};

export const riskScoringCommandService = {
  async execute(
    request: BnRiskScoringCommandRequest,
  ): Promise<BnRiskScoringCommandResult> {
    const correlationId = request.correlationId ?? newRiskUuid();
    const payload = request.payload ?? {};
    const payloadHash = await computePayloadHash(payload);

    const { data: auth } = await supabase.auth.getUser();
    const actor = auth?.user?.id ?? null;
    if (!actor) return toFailure('E_UNAUTHENTICATED:', correlationId);

    const { data, error } = await supabase.rpc('bn_risk_scoring_command_v1' as never, {
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
  },

  async executeConfig(
    request: BnRiskScoringConfigCommandRequest,
  ): Promise<BnRiskScoringCommandResult> {
    const correlationId = request.correlationId ?? newRiskUuid();
    const payload = request.payload ?? {};
    const payloadHash = await computePayloadHash(payload);

    const { data: auth } = await supabase.auth.getUser();
    const actor = auth?.user?.id ?? null;
    if (!actor) return toFailure('E_UNAUTHENTICATED:', correlationId);

    const { data, error } = await supabase.rpc('bn_risk_scoring_config_command_v1' as never, {
      p_command_name: request.command,
      p_rule_set_id: request.ruleSetId ?? null,
      p_actor_user_id: actor,
      p_actor_user_code: auth?.user?.email ?? actor,
      p_correlation_id: correlationId,
      p_expected_row_version: request.expectedRowVersion ?? null,
      p_justification: request.justification ?? null,
      p_payload: payload as never,
      p_payload_hash: payloadHash,
      p_idempotency_key: request.idempotencyKey ?? newRiskUuid(),
    } as never);

    if (error) return toFailure(error.message, correlationId);
    return toResult((data ?? {}) as Record<string, unknown>, correlationId);
  },
};

export const riskScoringService = {
  ...riskScoringQueryService,
  execute: riskScoringCommandService.execute,
  executeConfig: riskScoringCommandService.executeConfig,
};
