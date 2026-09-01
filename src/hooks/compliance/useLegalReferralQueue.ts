import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Enterprise reader for the Compliance → Legal Review / Handover Queue
 * (`/compliance/enforcement/legal-queue`).
 *
 * Search, filters, sorting, paging, KPIs, stage counts and the
 * "Requires Attention" set are resolved server-side by
 * `ce_legal_referral_queue_v1`, so they cover the whole authorised referral
 * population instead of a fetched page. Writes continue to go through the
 * governed lifecycle services (approve / reject RPCs and the two-phase
 * hand-off in complianceForwardingService).
 */

const sb = supabase as any;

export interface LegalQueueFilters {
  tab?: string;
  search?: string;
  statuses?: string[];
  employer_id?: string;
  zone?: string;
  requested_by?: string;
  approved_by?: string;
  reason_code?: string;
  source_case_id?: string;
  amount_min?: string;
  amount_max?: string;
  created_from?: string;
  created_to?: string;
  submitted_from?: string;
  submitted_to?: string;
  overdue_only?: boolean;
  high_value_only?: boolean;
  pack_incomplete_only?: boolean;
  mine_only?: boolean;
}

export interface LegalQueueRow {
  id: string;
  referral_number: string | null;
  status: string;
  stage_group: string;
  employer_id: string | null;
  employer_name: string | null;
  employer_zone: string | null;
  grand_total: number | null;
  total_principal: number | null;
  total_interest: number | null;
  total_penalties: number | null;
  periods_count: number | null;
  items_count: number | null;
  documents_count: number | null;
  notices_sent: number | null;
  period_from: string | null;
  period_to: string | null;
  referral_reason_code: string | null;
  referral_reason_text: string | null;
  source_case_id: string | null;
  source_reference_no: string | null;
  lg_intake_id: string | null;
  lg_intake_no: string | null;
  lg_case_no: string | null;
  legal_case_id: string | null;
  court_case_number: string | null;
  legal_officer_assigned: string | null;
  created_at: string;
  created_by: string | null;
  created_via: string | null;
  approval_requested_at: string | null;
  approval_requested_by: string | null;
  approval_requested_by_name: string | null;
  approved_at: string | null;
  approved_by: string | null;
  approved_by_name: string | null;
  approval_notes: string | null;
  submitted_date: string | null;
  accepted_date: string | null;
  accepted_by: string | null;
  returned_at: string | null;
  returned_by: string | null;
  return_reason: string | null;
  rejected_date: string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  stage_since: string | null;
  days_in_stage: number | null;
  sla_days: number | null;
  is_overdue: boolean;
  is_due_soon: boolean;
  pack_incomplete: boolean;
  is_high_value: boolean;
  updated_at: string | null;
}

export interface LegalQueueAttentionRow {
  id: string;
  referral_number: string | null;
  employer_name: string | null;
  status: string;
  grand_total: number | null;
  days_in_stage: number | null;
  sla_days: number | null;
  attention_reason: string;
  priority: number;
}

export interface LegalQueueResult {
  rows: LegalQueueRow[];
  total: number;
  page: number;
  page_size: number;
  tab_counts: Record<string, number>;
  kpis: Record<string, number>;
  attention: LegalQueueAttentionRow[];
  actor: {
    user_code: string | null;
    role: string | null;
    scope: string;
    can_approve: boolean;
    can_submit: boolean;
  };
  sla: {
    approval_days: number;
    handover_days: number;
    legal_response_days: number;
    rework_days: number;
    high_value_threshold: number;
  };
  error?: string;
}

export const LEGAL_QUEUE_PAGE_SIZE = 25;

const BOOL_KEYS = ['overdue_only', 'high_value_only', 'pack_incomplete_only', 'mine_only'] as const;

export function useLegalReferralQueue() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();

  const filters: LegalQueueFilters = useMemo(() => {
    const f: LegalQueueFilters = {
      tab: params.get('tab') || 'ACTION',
      search: params.get('q') || '',
      statuses: params.get('statuses') ? params.get('statuses')!.split(',').filter(Boolean) : [],
      employer_id: params.get('employer') || '',
      zone: params.get('zone') || '',
      requested_by: params.get('requested_by') || '',
      approved_by: params.get('approved_by') || '',
      reason_code: params.get('reason') || '',
      source_case_id: params.get('case') || '',
      amount_min: params.get('amount_min') || '',
      amount_max: params.get('amount_max') || '',
      created_from: params.get('created_from') || '',
      created_to: params.get('created_to') || '',
      submitted_from: params.get('submitted_from') || '',
      submitted_to: params.get('submitted_to') || '',
    };
    BOOL_KEYS.forEach((k) => {
      (f as Record<string, unknown>)[k] = params.get(k) === 'true';
    });
    return f;
  }, [params]);

  const sort = params.get('sort') || 'waiting';
  const dir = (params.get('dir') || 'desc') as 'asc' | 'desc';
  const page = Math.max(Number(params.get('page') || 1), 1);

  const patchParams = useCallback(
    (patch: Record<string, string | boolean | string[] | undefined>, resetPage = true) => {
      const next = new URLSearchParams(params);
      Object.entries(patch).forEach(([k, v]) => {
        const value = Array.isArray(v) ? v.join(',') : v === true ? 'true' : v === false ? '' : (v ?? '');
        if (!value) next.delete(k);
        else next.set(k, String(value));
      });
      if (resetPage) next.delete('page');
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const setFilter = useCallback(
    (key: string, value: string | boolean | string[] | undefined) => patchParams({ [key]: value }),
    [patchParams],
  );

  const setSort = useCallback(
    (key: string) => {
      const nextDir = sort === key && dir === 'desc' ? 'asc' : 'desc';
      patchParams({ sort: key, dir: nextDir });
    },
    [sort, dir, patchParams],
  );

  const setPage = useCallback(
    (p: number) => patchParams({ page: String(Math.max(p, 1)) }, false),
    [patchParams],
  );

  const clearFilters = useCallback(() => {
    const next = new URLSearchParams();
    const tab = params.get('tab');
    if (tab) next.set('tab', tab);
    setParams(next, { replace: true });
  }, [params, setParams]);

  const rpcFilters = useMemo(() => {
    const f: Record<string, unknown> = {
      tab: filters.tab,
      search: filters.search,
      statuses: filters.statuses ?? [],
      employer_id: filters.employer_id,
      zone: filters.zone,
      requested_by: filters.requested_by,
      approved_by: filters.approved_by,
      reason_code: filters.reason_code,
      source_case_id: filters.source_case_id,
      amount_min: filters.amount_min,
      amount_max: filters.amount_max,
      created_from: filters.created_from,
      created_to: filters.created_to,
      submitted_from: filters.submitted_from,
      submitted_to: filters.submitted_to,
    };
    BOOL_KEYS.forEach((k) => {
      if (filters[k]) f[k] = 'true';
    });
    return f;
  }, [filters]);

  const query = useQuery({
    queryKey: ['ce-legal-referral-queue', rpcFilters, sort, dir, page],
    queryFn: async (): Promise<LegalQueueResult> => {
      const { data, error } = await sb.rpc('ce_legal_referral_queue_v1', {
        p_filters: rpcFilters,
        p_sort: sort,
        p_dir: dir,
        p_page: page,
        p_page_size: LEGAL_QUEUE_PAGE_SIZE,
      });
      if (error) throw new Error(error.message);
      return data as LegalQueueResult;
    },
  });

  const facets = useQuery({
    queryKey: ['ce-legal-referral-facets'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await sb.rpc('ce_legal_referral_facets_v1');
      if (error) throw new Error(error.message);
      return (data ?? {}) as {
        employers?: { code: string; label: string }[];
        zones?: string[];
        requesters?: { code: string; label: string }[];
        approvers?: { code: string; label: string }[];
        reason_codes?: string[];
      };
    },
  });

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['ce-legal-referral-queue'] });
    qc.invalidateQueries({ queryKey: ['ce-legal-referral-facets'] });
    qc.invalidateQueries({ queryKey: ['legal-referrals-draft'] });
    qc.invalidateQueries({ queryKey: ['ce_case_legal_status'] });
  }, [qc]);

  const activeFilterCount = useMemo(
    () =>
      Object.entries(filters).filter(([k, v]) => {
        if (k === 'tab') return false;
        if (Array.isArray(v)) return v.length > 0;
        return Boolean(v);
      }).length,
    [filters],
  );

  return {
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    facets: facets.data,
    filters,
    sort,
    dir,
    page,
    pageSize: LEGAL_QUEUE_PAGE_SIZE,
    activeFilterCount,
    setFilter,
    setSort,
    setPage,
    clearFilters,
    refresh,
  };
}
