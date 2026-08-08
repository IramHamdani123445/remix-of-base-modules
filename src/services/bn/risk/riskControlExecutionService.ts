/**
 * BN Risk / Fraud — governed control execution service (EPIC 4).
 *
 * The single façade between Risk surfaces and the execution boundary. Reads
 * use SECURITY DEFINER query RPCs; every mutation goes through
 * `bn_risk_control_execution_command_v1`, which raises the governed
 * cross-module handoff into the owning domain.
 *
 * This module never writes a payment, award, claim, person, overpayment,
 * legal or investigation record, and it never decides readiness, retryability
 * or success. Those answers come from the backend only.
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
  BnRiskControlExecutionQueue,
  BnRiskControlExecutionReadiness,
  BnRiskExecutionCommand,
  BnRiskExecutionCommandResult,
  BnRiskExecutionStatus,
  BnRiskOutcomeReadiness,
} from '@/types/bn/risk/riskControlExecution';

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
): BnRiskExecutionCommandResult {
  return {
    status: (result.status as BnRiskExecutionCommandResult['status']) ?? 'EXECUTED',
    data: result,
    executionId: result.execution_id as string | undefined,
    executionStatus: result.execution_status as BnRiskExecutionStatus | undefined,
    targetReference: (result.target_reference as string | null) ?? null,
    targetStatus: (result.target_status as string | null) ?? null,
    attemptNo: result.attempt_no as number | undefined,
    isRetryable: result.is_retryable as boolean | undefined,
    reasonCode: (result.failure_code as string | null) ?? null,
    businessMessage: (result.business_message as string | null) ?? null,
    correlationId,
  };
}

function toFailure(message: string, correlationId: string): BnRiskExecutionCommandResult {
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
  readonly command: BnRiskExecutionCommand;
  readonly assessmentId: string;
  readonly expectedRowVersion?: number | null;
  readonly reasonCode?: string | null;
  readonly justification?: string | null;
  /**
   * Only backend-permitted runtime fields. Approved parameters (control,
   * target, scope, effective period) are carried by the backend from the
   * approved recommendation and are rejected if sent differently.
   */
  readonly payload?: Record<string, unknown>;
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
}

async function execute(request: ExecuteRequest): Promise<BnRiskExecutionCommandResult> {
  const correlationId = request.correlationId ?? newRiskUuid();
  const payload = request.payload ?? {};
  const payloadHash = await computePayloadHash(payload);

  const { data: auth } = await supabase.auth.getUser();
  const actor = auth?.user?.id ?? null;
  if (!actor) return toFailure('E_UNAUTHENTICATED:', correlationId);

  const { data, error } = await supabase.rpc('bn_risk_control_execution_command_v1' as never, {
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

export const riskControlExecutionQueryService = {
  /** Governed answer to "may this approved control be executed, and how?" */
  async executionReadiness(
    assessmentId: string,
  ): Promise<BnRiskQueryResult<BnRiskControlExecutionReadiness>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskControlExecutionReadiness>('bn_risk_control_execution_readiness_v1', {
      p_actor_user_id: actor,
      p_assessment_id: assessmentId,
    });
  },

  /** Governed operational queue for approved controls and referrals. */
  async executionQueue(
    filters: Record<string, unknown> = {},
    page = 1,
    pageSize = 20,
  ): Promise<BnRiskQueryResult<BnRiskControlExecutionQueue>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskControlExecutionQueue>('bn_risk_control_execution_queue_v1', {
      p_actor_user_id: actor,
      p_filters: filters,
      p_page: page,
      p_page_size: pageSize,
    });
  },

  /** Read only. Outcome recording and closure belong to a later epic. */
  async outcomeReadiness(
    assessmentId: string,
  ): Promise<BnRiskQueryResult<BnRiskOutcomeReadiness>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskOutcomeReadiness>('bn_risk_outcome_readiness_v1', {
      p_actor_user_id: actor,
      p_assessment_id: assessmentId,
    });
  },
};

export interface BnRiskExecuteControlRequest {
  readonly assessmentId: string;
  /** Published by readiness — the browser never picks the command itself. */
  readonly command: BnRiskExecutionCommand;
  readonly operationalNote?: string | null;
  /** Only for REQUEST_DOCUMENTS: the existing governed Risk evidence request. */
  readonly informationRequestId?: string | null;
  readonly expectedRowVersion?: number | null;
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
}

export const riskControlExecutionCommandService = {
  /**
   * Executes the approved control through its owning domain. The command must
   * be the one published by `bn_risk_control_execution_readiness_v1`.
   */
  async executeApprovedControl(
    request: BnRiskExecuteControlRequest,
  ): Promise<BnRiskExecutionCommandResult> {
    return execute({
      command: request.command,
      assessmentId: request.assessmentId,
      expectedRowVersion: request.expectedRowVersion ?? null,
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
      payload: {
        operational_note: request.operationalNote ?? null,
        information_request_id: request.informationRequestId ?? null,
      },
    });
  },

  /** Governed retry — allowed only when the backend marked the failure retryable. */
  async retryExecution(request: {
    assessmentId: string;
    operationalNote?: string | null;
    expectedRowVersion?: number | null;
    idempotencyKey?: string;
  }): Promise<BnRiskExecutionCommandResult> {
    return execute({
      command: 'BN_RISK_OP_RETRY_CONTROL_EXECUTION',
      assessmentId: request.assessmentId,
      expectedRowVersion: request.expectedRowVersion ?? null,
      idempotencyKey: request.idempotencyKey,
      payload: { operational_note: request.operationalNote ?? null },
    });
  },

  /** Pulls the owning domain's current status. Never duplicates the request. */
  async refreshExecution(request: {
    assessmentId: string;
    idempotencyKey?: string;
  }): Promise<BnRiskExecutionCommandResult> {
    return execute({
      command: 'BN_RISK_OP_REFRESH_CONTROL_EXECUTION',
      assessmentId: request.assessmentId,
      idempotencyKey: request.idempotencyKey,
      payload: {},
    });
  },
};

export const riskControlExecutionService = {
  ...riskControlExecutionQueryService,
  ...riskControlExecutionCommandService,
};
