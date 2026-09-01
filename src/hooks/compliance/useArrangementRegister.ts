import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Enterprise reader for Compliance → Payment Arrangements
 * (`/compliance/enforcement/arrangements`).
 *
 * OWNERSHIP BOUNDARY
 * ------------------
 * `ce_payment_arrangements` remains the Compliance record of the agreement and
 * `core_payment_arrangement` / `core_payment_schedule_installment` remain the
 * canonical money spine. This hook NEVER recomputes financial values: search,
 * filters, sorting, paging, KPIs and the "Requires attention" set are resolved
 * server-side by `ce_arrangement_register_v1` over
 * `ce_v_arrangement_register_ext`.
 */

const sb = supabase as any;

export const ARRANGEMENT_PAGE_SIZES = [25, 50, 100, 200] as const;

export interface ArrangementFilters {
  tab: string;
  search: string;
  employer_id: string;
  case_id: string;
  statuses: string[];
  health: string[];
  frequencies: string[];
  due_window: string;
  created_window: string;
  created_from: string;
  created_to: string;
  min_outstanding: string;
}

export interface ArrangementRegisterRowExt {
  arrangement_id: string;
  arrangement_number: string | null;
  employer_id: string | null;
  employer_name: string | null;
  regno: string | null;
  case_id: string | null;
  case_number: string | null;
  status: string;
  status_label: string | null;
  health_status: string | null;
  health_label: string | null;
  frequency: string | null;
  total_arranged: number | null;
  total_paid: number | null;
  outstanding: number | null;
  past_due_amount: number | null;
  unattributed_amount: number | null;
  installment_amount: number | null;
  number_of_installments: number | null;
  installments_total: number;
  installments_paid: number;
  installments_partial: number;
  overdue_count: number;
  next_installment_number: number | null;
  next_due_date: string | null;
  next_installment_amount: number | null;
  days_to_next_due: number | null;
  paid_percent: number | null;
  breach_count: number;
  unresolved_breach_count: number;
  last_breach_at: string | null;
  breach_date: string | null;
  breach_reason: string | null;
  max_missed_before_breach: number | null;
  start_date: string | null;
  end_date: string | null;
  agreement_signed: boolean | null;
  submitted_at: string | null;
  submitted_by_user: string | null;
  approved_at: string | null;
  approved_by_user: string | null;
  rejection_reason: string | null;
  superseded_by_arrangement_id: string | null;
  superseded_from_arrangement_id: string | null;
  arrangement_default_violation_id: string | null;
  arrangement_default_violation_number: string | null;
  created_at: string | null;
  updated_at: string | null;
  attention_score: number;
  is_breached: boolean;
  breach_imminent: boolean;
  has_overdue: boolean;
  approval_stale: boolean;
  draft_stale: boolean;
  has_unallocated: boolean;
  schedule_gap: boolean;
  due_soon: boolean;
}

export interface ArrangementAttentionRow {
  arrangement_id: string;
  arrangement_number: string | null;
  employer_name: string | null;
  status_label: string | null;
  health_status: string | null;
  outstanding: number | null;
  next_due_date: string | null;
  priority: number;
  reason: string;
}

export interface ArrangementRegisterResult {
  rows: ArrangementRegisterRowExt[];
  total: number;
  page: number;
  page_size: number;
  kpis: Record<string, number>;
  tab_counts: Record<string, number>;
  attention: ArrangementAttentionRow[];
  thresholds: {
    approval_ageing_days: number;
    draft_stale_days: number;
    due_soon_days: number;
  };
  actor: {
    can_manage: boolean;
    can_approve: boolean;
    can_refer_legal: boolean;
  };
  error?: string;
}

export interface ArrangementFacets {
  statuses: { code: string; label: string; tone: string | null }[];
  health: { code: string; label: string; tone: string | null }[];
  frequencies: { code: string; label: string }[];
  employers: { code: string; label: string }[];
  error?: string;
}

const LIST_KEYS = ['statuses', 'health', 'frequencies'] as const;

export function useArrangementRegister(forcedEmployerId?: string | null) {
  const [params, setParams] = useSearchParams();

  const filters: ArrangementFilters = useMemo(
    () => ({
      tab: params.get('tab') || 'ALL',
      search: params.get('q') || '',
      employer_id: forcedEmployerId || params.get('employer') || '',
      case_id: params.get('case') || '',
      statuses: (params.get('statuses') || '').split(',').filter(Boolean),
      health: (params.get('health') || '').split(',').filter(Boolean),
      frequencies: (params.get('frequencies') || '').split(',').filter(Boolean),
      due_window: params.get('due') || '',
      created_window: params.get('created') || '',
      created_from: params.get('created_from') || '',
      created_to: params.get('created_to') || '',
      min_outstanding: params.get('min_out') || '',
    }),
    [params, forcedEmployerId],
  );

  const sort = params.get('sort') || 'attention';
  const dir = (params.get('dir') || 'desc') as 'asc' | 'desc';
  const page = Math.max(Number(params.get('page') || 1), 1);
  const pageSize = ARRANGEMENT_PAGE_SIZES.includes(Number(params.get('size')) as any)
    ? Number(params.get('size'))
    : 25;

  const patchParams = useCallback(
    (patch: Record<string, string | string[] | undefined>, resetPage = true) => {
      const next = new URLSearchParams(params);
      Object.entries(patch).forEach(([k, v]) => {
        const value = Array.isArray(v) ? v.join(',') : (v ?? '');
        if (!value) next.delete(k);
        else next.set(k, String(value));
      });
      if (resetPage) next.delete('page');
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const setFilter = useCallback(
    (key: string, value: string | string[] | undefined) => patchParams({ [key]: value }),
    [patchParams],
  );

  const toggleListFilter = useCallback(
    (key: (typeof LIST_KEYS)[number], code: string) => {
      const current = filters[key];
      const next = current.includes(code) ? current.filter((c) => c !== code) : [...current, code];
      const urlKey = key;
      patchParams({ [urlKey]: next });
    },
    [filters, patchParams],
  );

  const setSort = useCallback(
    (key: string) => {
      const nextDir = sort === key && dir === 'desc' ? 'asc' : 'desc';
      patchParams({ sort: key, dir: nextDir });
    },
    [sort, dir, patchParams],
  );

  const setPage = useCallback((p: number) => patchParams({ page: String(Math.max(p, 1)) }, false), [patchParams]);
  const setPageSize = useCallback((s: number) => patchParams({ size: String(s) }), [patchParams]);
  const setTab = useCallback((tab: string) => patchParams({ tab }), [patchParams]);

  const clearFilters = useCallback(() => {
    const next = new URLSearchParams();
    const tab = params.get('tab');
    if (tab) next.set('tab', tab);
    setParams(next, { replace: true });
  }, [params, setParams]);

  const hasActiveFilters = useMemo(
    () =>
      Boolean(
        filters.search ||
          (!forcedEmployerId && filters.employer_id) ||
          filters.case_id ||
          filters.statuses.length ||
          filters.health.length ||
          filters.frequencies.length ||
          filters.due_window ||
          filters.created_window ||
          filters.created_from ||
          filters.created_to ||
          filters.min_outstanding,
      ),
    [filters, forcedEmployerId],
  );

  const rpcParams = useMemo(
    () => ({
      ...filters,
      sort,
      dir,
      page,
      page_size: pageSize,
    }),
    [filters, sort, dir, page, pageSize],
  );

  const query = useQuery({
    queryKey: ['ce-arrangement-register', rpcParams],
    queryFn: async (): Promise<ArrangementRegisterResult> => {
      const { data, error } = await sb.rpc('ce_arrangement_register_v1', { p_params: rpcParams });
      if (error) throw new Error(error.message);
      const result = data as ArrangementRegisterResult;
      if (result?.error) throw new Error(result.error);
      return result;
    },
  });

  const facets = useQuery({
    queryKey: ['ce-arrangement-facets'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ArrangementFacets> => {
      const { data, error } = await sb.rpc('ce_arrangement_facets_v1');
      if (error) throw new Error(error.message);
      return (data ?? {}) as ArrangementFacets;
    },
  });

  return {
    filters,
    sort,
    dir,
    page,
    pageSize,
    hasActiveFilters,
    setFilter,
    toggleListFilter,
    setSort,
    setPage,
    setPageSize,
    setTab,
    clearFilters,
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error as Error | undefined,
    refetch: query.refetch,
    facets: facets.data,
    returnTo: `/compliance/enforcement/arrangements${params.toString() ? `?${params.toString()}` : ''}`,
  };
}
