import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Enterprise reader for Compliance → Legal Proceedings & Enforcement Tracking
 * (`/compliance/enforcement/proceedings`).
 *
 * OWNERSHIP BOUNDARY
 * ------------------
 * Once a Compliance referral is accepted by Legal, the Legal module owns the
 * practitioner workflow (stage, court, hearings, orders, enforcement). This
 * page is a *read/track* projection: search, filters, sorting, paging, KPIs,
 * stage distribution and the "Requires Attention" set are all resolved
 * server-side by `ce_legal_proceeding_register_v1` over the Legal-owned
 * records joined to the originating Compliance referral / case. Compliance
 * users never write court/legal fields from here.
 */

const sb = supabase as any;

export const PROCEEDING_PAGE_SIZES = [25, 50, 100, 200] as const;

export interface ProceedingFilters {
  tab: string;
  search: string;
  employer_id: string;
  court: string;
  officer: string;
  ce_case_id: string;
  stages: string[];
  outcomes: string[];
  recovery: string[];
  filed_from: string;
  filed_to: string;
  amount_min: string;
  amount_max: string;
  hearing_window: string;
}

export interface ProceedingRow {
  source: 'LEGAL' | 'LEGACY';
  row_key: string;
  referral_id: string | null;
  referral_number: string | null;
  referral_status: string | null;
  lg_case_id: string | null;
  lg_case_no: string | null;
  court_case_no: string | null;
  proceeding_no: string | null;
  lg_intake_id: string | null;
  lg_intake_no: string | null;
  ce_case_id: string | null;
  ce_case_number: string | null;
  employer_id: string | null;
  employer_name: string | null;
  stage_code: string;
  stage_label: string | null;
  stage_group: string | null;
  court_code: string | null;
  court_name: string | null;
  filed_date: string | null;
  next_hearing_date: string | null;
  next_hearing_source: string | null;
  last_hearing_date: string | null;
  last_hearing_outcome: string | null;
  hearing_count: number;
  next_action: string | null;
  next_action_due: string | null;
  legal_officer: string | null;
  referred_amount?: number | null;
  judgment_amount?: number | null;
  recovered_amount?: number | null;
  outstanding_amount?: number | null;
  enforcement_count: number;
  recovery_status_code: string;
  recovery_label: string | null;
  outcome_code: string;
  outcome_label: string | null;
  is_closed: boolean;
  last_legal_update: string | null;
  attention_score: number;
  hearing_overdue: boolean;
  hearing_soon: boolean;
  judgment_no_enforcement: boolean;
  no_next_action: boolean;
  legal_stale: boolean;
  awaiting_legal_overdue: boolean;
  is_legacy: boolean;
}

export interface ProceedingAttentionRow {
  row_key: string;
  proceeding_no: string | null;
  employer_name: string | null;
  stage_label: string;
  next_hearing_date: string | null;
  outstanding_amount: number | null;
  priority: number;
  reason: string;
}

export interface ProceedingRegisterResult {
  rows: ProceedingRow[];
  total: number;
  page: number;
  page_size: number;
  kpis: Record<string, number | null>;
  stage_distribution: { code: string; label: string; group: string; count: number }[];
  tab_counts: Record<string, number>;
  attention: ProceedingAttentionRow[];
  actor: {
    can_view_financials: boolean;
    can_open_legal: boolean;
    can_follow_up: boolean;
  };
  thresholds: {
    hearing_soon_days: number;
    stale_days: number;
    high_value_threshold: number;
    handover_days: number;
  };
  error?: string;
}

export interface ProceedingFacets {
  stages: { code: string; label: string; group: string }[];
  outcomes: { code: string; label: string }[];
  recovery: { code: string; label: string }[];
  courts: { code: string; label: string }[];
  employers: { code: string; label: string }[];
  officers: { code: string; label: string }[];
  error?: string;
}

const LIST_KEYS = ['stages', 'outcomes', 'recovery'] as const;

export function useLegalProceedingRegister() {
  const [params, setParams] = useSearchParams();

  const filters: ProceedingFilters = useMemo(
    () => ({
      tab: params.get('tab') || 'ACTIVE',
      search: params.get('q') || '',
      employer_id: params.get('employer') || '',
      court: params.get('court') || '',
      officer: params.get('officer') || '',
      ce_case_id: params.get('case') || '',
      stages: (params.get('stages') || '').split(',').filter(Boolean),
      outcomes: (params.get('outcomes') || '').split(',').filter(Boolean),
      recovery: (params.get('recovery') || '').split(',').filter(Boolean),
      filed_from: params.get('filed_from') || '',
      filed_to: params.get('filed_to') || '',
      amount_min: params.get('amount_min') || '',
      amount_max: params.get('amount_max') || '',
      hearing_window: params.get('hearing') || '',
    }),
    [params],
  );

  const sort = params.get('sort') || 'attention';
  const dir = (params.get('dir') || 'desc') as 'asc' | 'desc';
  const page = Math.max(Number(params.get('page') || 1), 1);
  const pageSize = PROCEEDING_PAGE_SIZES.includes(Number(params.get('size')) as any)
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
      const next = current.includes(code)
        ? current.filter((c) => c !== code)
        : [...current, code];
      patchParams({ [key]: next });
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

  const setPage = useCallback(
    (p: number) => patchParams({ page: String(Math.max(p, 1)) }, false),
    [patchParams],
  );

  const setPageSize = useCallback(
    (s: number) => patchParams({ size: String(s) }),
    [patchParams],
  );

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
          filters.employer_id ||
          filters.court ||
          filters.officer ||
          filters.ce_case_id ||
          filters.stages.length ||
          filters.outcomes.length ||
          filters.recovery.length ||
          filters.filed_from ||
          filters.filed_to ||
          filters.amount_min ||
          filters.amount_max ||
          filters.hearing_window,
      ),
    [filters],
  );

  const rpcFilters = useMemo(
    () => ({
      tab: filters.tab,
      search: filters.search,
      employer_id: filters.employer_id,
      court: filters.court,
      officer: filters.officer,
      ce_case_id: filters.ce_case_id,
      stages: filters.stages,
      outcomes: filters.outcomes,
      recovery: filters.recovery,
      filed_from: filters.filed_from,
      filed_to: filters.filed_to,
      amount_min: filters.amount_min,
      amount_max: filters.amount_max,
      hearing_window: filters.hearing_window,
    }),
    [filters],
  );

  const query = useQuery({
    queryKey: ['ce-legal-proceeding-register', rpcFilters, sort, dir, page, pageSize],
    queryFn: async (): Promise<ProceedingRegisterResult> => {
      const { data, error } = await sb.rpc('ce_legal_proceeding_register_v1', {
        p_filters: rpcFilters,
        p_sort: sort,
        p_dir: dir,
        p_page: page,
        p_page_size: pageSize,
      });
      if (error) throw new Error(error.message);
      const result = data as ProceedingRegisterResult;
      if (result?.error) throw new Error(result.error);
      return result;
    },
  });

  const facets = useQuery({
    queryKey: ['ce-legal-proceeding-facets'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ProceedingFacets> => {
      const { data, error } = await sb.rpc('ce_legal_proceeding_facets_v1');
      if (error) throw new Error(error.message);
      return (data ?? {}) as ProceedingFacets;
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
    /** Current query string, so drill-downs can round-trip back to this view. */
    returnTo: `/compliance/enforcement/proceedings${params.toString() ? `?${params.toString()}` : ''}`,
  };
}

export function useLegalProceedingDetail(rowKey: string | null) {
  return useQuery({
    queryKey: ['ce-legal-proceeding-detail', rowKey],
    enabled: Boolean(rowKey),
    queryFn: async () => {
      const { data, error } = await sb.rpc('ce_legal_proceeding_detail_v1', {
        p_row_key: rowKey,
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as {
        proceeding: ProceedingRow & Record<string, unknown>;
        can_view_financials: boolean;
        hearings: any[];
        orders: any[];
        enforcement: any[];
        liabilities: any[];
        history: { at: string; type: string; label: string; actor: string | null; notes: string | null; source: string }[];
      };
    },
  });
}
