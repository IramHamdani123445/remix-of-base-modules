/**
 * BN Risk / Fraud — secured query service (EPIC 0).
 *
 * Reads go through SECURITY DEFINER query RPCs that re-derive the caller's
 * permission server-side. A failed query is NEVER represented as an empty
 * successful result: callers receive an explicit status.
 */
import { supabase } from '@/integrations/supabase/client';
import type {
  BnRiskAvailableActions,
  BnRiskPersonOption,
  BnRiskPersonSafeSummary,
  BnRiskReferenceData,
  BnRiskSignalDetail,
  BnRiskSignalQueue,
  BnRiskSignalQueueFilters,
  BnRiskSignalRow,
} from '@/types/bn/risk/riskSignals';

export type BnRiskQueryStatus = 'OK' | 'DENIED' | 'NOT_FOUND' | 'ERROR';

export interface BnRiskQueryResult<T> {
  readonly status: BnRiskQueryStatus;
  readonly code?: string;
  readonly data: T | null;
}

async function callQuery<T>(
  rpc: string,
  args: Record<string, unknown>,
): Promise<BnRiskQueryResult<T>> {
  const { data, error } = await supabase.rpc(rpc as never, args as never);
  if (error) {
    return { status: 'ERROR', code: error.message, data: null };
  }
  const envelope = (data ?? {}) as { status?: string; code?: string; data?: unknown };
  const status = (envelope.status as BnRiskQueryStatus) ?? 'ERROR';
  return {
    status,
    code: envelope.code ?? undefined,
    data: status === 'OK' ? ((envelope.data ?? null) as T) : null,
  };
}

async function actorId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

export const riskQueryService = {
  async referenceData(): Promise<BnRiskQueryResult<BnRiskReferenceData>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskReferenceData>('bn_risk_reference_data_v1', {
      p_actor_user_id: actor,
    });
  },

  async signalQueue(
    filters: BnRiskSignalQueueFilters,
    page = 1,
    pageSize = 25,
  ): Promise<BnRiskQueryResult<BnRiskSignalQueue>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    const cleaned = Object.fromEntries(
      Object.entries(filters).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    );
    return callQuery<BnRiskSignalQueue>('bn_risk_signal_queue_v1', {
      p_actor_user_id: actor,
      p_filters: cleaned,
      p_page: page,
      p_page_size: pageSize,
    });
  },

  async signalDetail(signalId: string): Promise<BnRiskQueryResult<BnRiskSignalDetail>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskSignalDetail>('bn_risk_signal_detail_v1', {
      p_actor_user_id: actor,
      p_signal_id: signalId,
    });
  },

  async availableActions(signalId: string): Promise<BnRiskQueryResult<BnRiskAvailableActions>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskAvailableActions>('bn_risk_available_actions_v1', {
      p_actor_user_id: actor,
      p_signal_id: signalId,
    });
  },

  async relatedSignalSearch(
    signalId: string,
    search?: string,
  ): Promise<BnRiskQueryResult<{ rows: readonly BnRiskSignalRow[] }>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<{ rows: readonly BnRiskSignalRow[] }>('bn_risk_related_signal_search_v1', {
      p_actor_user_id: actor,
      p_signal_id: signalId,
      p_search: search ?? null,
      p_limit: 20,
    });
  },

  async personSearch(
    search: string,
  ): Promise<BnRiskQueryResult<{ rows: readonly BnRiskPersonOption[] }>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<{ rows: readonly BnRiskPersonOption[] }>('bn_risk_person_search_v1', {
      p_actor_user_id: actor,
      p_search: search,
      p_limit: 20,
    });
  },

  /** Benefit 360 projection — status only, never risk detail. */
  async personSafeSummary(
    personId: number,
  ): Promise<BnRiskQueryResult<BnRiskPersonSafeSummary>> {
    const actor = await actorId();
    if (!actor) return { status: 'DENIED', code: 'UNAUTHENTICATED', data: null };
    return callQuery<BnRiskPersonSafeSummary>('bn_risk_person_safe_summary_v1', {
      p_actor_user_id: actor,
      p_person_id: personId,
    });
  },
};
