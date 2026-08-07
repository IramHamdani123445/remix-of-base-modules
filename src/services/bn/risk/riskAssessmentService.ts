/**
 * BN Risk / Fraud — governed assessment service (EPIC 1).
 *
 * Reads use the SECURITY DEFINER query RPCs; writes use
 * `bn_risk_assessment_command_v1`. Browser roles hold no write privilege on
 * any `bn_risk_*` table, so this module is the only route from the Risk
 * workspace to an assessment change. Nothing here scores or decides.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  computePayloadHash,
  newRiskUuid,
  parseCommandError,
  riskErrorMessage,
  type BnRiskCommandResult,
  type BnRiskCommandStatus,
} from '@/services/bn/risk/riskCommandService';
import type { BnRiskQueryResult } from '@/services/bn/risk/riskQueryService';
import type {
  BnRiskAssessmentActions,
  BnRiskAssessmentCommand,
  BnRiskAssessmentCreationReadiness,
  BnRiskAssessmentDetail,
  BnRiskAssessmentQueue,
  BnRiskAssessmentQueueFilters,
  BnRiskAssessmentReadiness,
  BnRiskEvidenceCandidate,
  BnRiskFactorCatalogue,
  BnRiskSignalAssessmentLink,
} from '@/types/bn/risk/riskAssessment';

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

export interface BnRiskAssessmentCommandRequest {
  readonly command: BnRiskAssessmentCommand;
  readonly assessmentId?: string | null;
  readonly expectedRowVersion?: number | null;
  readonly reasonCode?: string | null;
  readonly justification?: string | null;
  readonly payload?: Record<string, unknown>;
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
}

export interface BnRiskAssessmentCommandResult extends BnRiskCommandResult {
  readonly assessmentId?: string;
  readonly assessmentReference?: string;
  readonly assessmentStatus?: string;
  readonly factorId?: string;
  readonly requestId?: string;
  readonly requestReference?: string;
  readonly evidenceLinkId?: string;
}

export const riskAssessmentCommandService = {
  async execute(
    request: BnRiskAssessmentCommandRequest,
  ): Promise<BnRiskAssessmentCommandResult> {
    const correlationId = request.correlationId ?? newRiskUuid();
    const payload = request.payload ?? {};
    const payloadHash = await computePayloadHash(payload);

    const { data: auth } = await supabase.auth.getUser();
    const actor = auth?.user?.id ?? null;
    if (!actor) {
      return {
        status: 'FAILED',
        data: null,
        errorCode: 'UNAUTHENTICATED',
        errorDetail: 'No authenticated actor',
        errorMessage: riskErrorMessage('UNAUTHENTICATED'),
        correlationId,
      };
    }

    const { data, error } = await supabase.rpc('bn_risk_assessment_command_v1' as never, {
      p_command_name: request.command,
      p_assessment_id: request.assessmentId ?? null,
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

    if (error) {
      const parsed = parseCommandError(error.message);
      return {
        status: 'FAILED',
        data: null,
        errorCode: parsed.code,
        errorDetail: parsed.detail,
        errorMessage: riskErrorMessage(parsed.code, parsed.detail),
        correlationId,
      };
    }

    const result = (data ?? {}) as Record<string, unknown>;
    return {
      status: (result.status as BnRiskCommandStatus) ?? 'EXECUTED',
      data: result,
      assessmentId: result.assessment_id as string | undefined,
      assessmentReference: result.assessment_reference as string | undefined,
      assessmentStatus: result.assessment_status as string | undefined,
      factorId: result.factor_id as string | undefined,
      requestId: result.request_id as string | undefined,
      requestReference: result.request_reference as string | undefined,
      evidenceLinkId: result.evidence_link_id as string | undefined,
      entityVersion: result.entity_version as number | undefined,
      correlationId,
    };
  },
};

export const riskAssessmentQueryService = {
  async queue(
    filters: BnRiskAssessmentQueueFilters,
    page = 1,
    pageSize = 25,
  ): Promise<BnRiskQueryResult<BnRiskAssessmentQueue>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    const cleaned = Object.fromEntries(
      Object.entries(filters).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    );
    return callQuery<BnRiskAssessmentQueue>('bn_risk_assessment_queue_v1', {
      p_actor_user_id: actor,
      p_filters: cleaned,
      p_page: page,
      p_page_size: pageSize,
    });
  },

  async detail(assessmentId: string): Promise<BnRiskQueryResult<BnRiskAssessmentDetail>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskAssessmentDetail>('bn_risk_assessment_detail_v1', {
      p_actor_user_id: actor,
      p_assessment_id: assessmentId,
    });
  },

  async actions(assessmentId: string): Promise<BnRiskQueryResult<BnRiskAssessmentActions>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskAssessmentActions>('bn_risk_assessment_actions_v1', {
      p_actor_user_id: actor,
      p_assessment_id: assessmentId,
    });
  },

  async readiness(assessmentId: string): Promise<BnRiskQueryResult<BnRiskAssessmentReadiness>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskAssessmentReadiness>('bn_risk_assessment_readiness_v1', {
      p_actor_user_id: actor,
      p_assessment_id: assessmentId,
    });
  },

  /** Governed answer to "may this signal open an assessment?" */
  async creationReadiness(
    signalId: string,
  ): Promise<BnRiskQueryResult<BnRiskAssessmentCreationReadiness>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskAssessmentCreationReadiness>(
      'bn_risk_assessment_creation_readiness_v1',
      { p_actor_user_id: actor, p_signal_id: signalId },
    );
  },

  async factorCatalogue(assessmentId: string): Promise<BnRiskQueryResult<BnRiskFactorCatalogue>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskFactorCatalogue>('bn_risk_factor_catalogue_v1', {
      p_actor_user_id: actor,
      p_assessment_id: assessmentId,
    });
  },

  /** Existing official documents only — the Risk module never stores its own. */
  async evidenceSearch(
    assessmentId: string,
    search?: string,
  ): Promise<BnRiskQueryResult<{ rows: readonly BnRiskEvidenceCandidate[] }>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<{ rows: readonly BnRiskEvidenceCandidate[] }>('bn_risk_evidence_search_v1', {
      p_actor_user_id: actor,
      p_assessment_id: assessmentId,
      p_search: search ?? null,
      p_limit: 25,
    });
  },

  async signalAssessmentLinks(
    signalId: string,
  ): Promise<BnRiskQueryResult<{ rows: readonly BnRiskSignalAssessmentLink[] }>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<{ rows: readonly BnRiskSignalAssessmentLink[] }>(
      'bn_risk_signal_assessment_links_v1',
      { p_actor_user_id: actor, p_signal_id: signalId },
    );
  },
};

export const riskAssessmentService = {
  ...riskAssessmentQueryService,
  execute: riskAssessmentCommandService.execute,
};
