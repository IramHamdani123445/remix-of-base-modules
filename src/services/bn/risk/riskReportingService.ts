/**
 * BN Risk / Fraud — operational and reporting read service (EPIC 6).
 *
 * A thin façade over the governed reporting RPCs. Every count, rate, funnel
 * stage and ageing figure is produced by the backend; nothing is aggregated,
 * derived or estimated here, and a failed read is never converted into a zero.
 */
import { supabase } from '@/integrations/supabase/client';
import type { BnRiskQueryResult } from '@/services/bn/risk/riskQueryService';
import type {
  BnRiskFeedbackMetrics,
  BnRiskOperationalMetrics,
  BnRiskOutcomeMetrics,
  BnRiskReportPeriodCode,
} from '@/types/bn/risk/riskReporting';

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

export interface BnRiskReportFilters {
  readonly period?: BnRiskReportPeriodCode;
  readonly from?: string;
  readonly to?: string;
}

export const riskReportingService = {
  /** Operational position: queue cards, lifecycle funnel, signal mix, ageing. */
  async operationalMetrics(
    filters: BnRiskReportFilters = {},
  ): Promise<BnRiskQueryResult<BnRiskOperationalMetrics>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskOperationalMetrics>('bn_risk_operational_metrics_v1', {
      p_actor_user_id: actor,
      p_filters: filters,
    });
  },

  /** Outcome, control, execution and governance turnaround reporting. */
  async outcomeMetrics(
    filters: BnRiskReportFilters = {},
  ): Promise<BnRiskQueryResult<BnRiskOutcomeMetrics>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskOutcomeMetrics>('bn_risk_outcome_metrics_v1', {
      p_actor_user_id: actor,
      p_filters: filters,
    });
  },

  /**
   * Version-aware rule effectiveness and feedback evidence. Restricted to rule
   * administrators by the backend.
   */
  async feedbackMetrics(
    filters: BnRiskReportFilters = {},
  ): Promise<BnRiskQueryResult<BnRiskFeedbackMetrics>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskFeedbackMetrics>('bn_risk_rule_feedback_metrics_v1', {
      p_actor_user_id: actor,
      p_filters: filters,
    });
  },
};
