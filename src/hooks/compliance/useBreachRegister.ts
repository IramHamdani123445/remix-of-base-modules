import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Enterprise reader for Compliance → Breach Monitoring
 * (`/compliance/enforcement/breaches`).
 *
 * OWNERSHIP BOUNDARY
 * ------------------
 * `ce_arrangement_breaches` is the canonical breach record; `ce_installments`
 * remains the money spine and `ce_legal_referrals` remains the escalation
 * spine. This hook NEVER recomputes financial values or breach state: search,
 * filters, sorting, paging, KPIs and the "Requires attention" set are resolved
 * server-side by `ce_breach_register_v1` over `ce_v_breach_register`.
 */

const sb = supabase as any;

export const BREACH_PAGE_SIZES = [25, 50, 100, 200] as const;

export interface BreachFilters {
  tab: string;
  search: string;
  employer_id: string;
  arrangement_id: string;
  officer: string;
  types: string[];
  statuses: string[];
  escalations: string[];
  health: string[];
  detection: string;
  breach_window: string;
  breach_from: string;
  breach_to: string;
  amount_band: string;
  min_shortfall: string;
}

export interface BreachRegisterRow {
  breach_id: string;
  breach_reference: string;
  arrangement_id: string;
  arrangement_number: string | null;
  employer_id: string | null;
  employer_name: string | null;
  regno: string | null;
  arrangement_status: string | null;
  arrangement_status_label: string | null;
  arrangement_health: string | null;
  arrangement_health_label: string | null;
  arrangement_outstanding: number | null;
  arrangement_past_due: number | null;
  total_arranged: number | null;
  total_paid: number | null;
  max_missed_before_breach: number | null;
  breach_type: string;
  breach_type_label: string | null;
  severity: string | null;
  severity_label: string | null;
  breach_status: string;
  breach_status_label: string | null;
  escalation_status: string | null;
  escalation_status_label: string | null;
  detection_method: string | null;
  detection_method_label: string | null;
  detection_rule: string | null;
  detected_at: string;
  breach_date: string;
  age_days: number;
  description: string | null;
  installment_id: string | null;
  installment_number: number | null;
  installment_due_date: string | null;
  installment_amount: number | null;
  installment_paid: number | null;
  shortfall: number | null;
  installment_status: string | null;
  installment_payment_reference: string | null;
  grace_days_at_breach: number | null;
  consecutive_misses: number;
  case_id: string | null;
  case_number: string | null;
  case_status: string | null;
  violation_id: string | null;
  violation_number: string | null;
  legal_referral_id: string | null;
  legal_referral_number: string | null;
  legal_referral_status: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  assigned_at: string | null;
  resolution: string | null;
  resolution_type: string | null;
  resolution_type_label: string | null;
  resolution_reason: string | null;
  resolution_notes: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  payment_reference: string | null;
  last_action_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_notice_number: string | null;
  last_notice_status: string | null;
  last_notice_sent_at: string | null;
  attention_score: number;
  next_action: string;
  is_open: boolean;
  sla_overdue: boolean;
  high_value: boolean;
  is_default: boolean;
  unassigned: boolean;
  is_new: boolean;
  repeated: boolean;
}

export interface BreachAttentionRow {
  breach_id: string;
  breach_reference: string;
  arrangement_id: string;
  arrangement_number: string | null;
  employer_name: string | null;
  shortfall: number | null;
  age_days: number;
  priority: number;
  next_action: string;
  reason: string;
}

export interface BreachRegisterResult {
  rows: BreachRegisterRow[];
  total: number;
  page: number;
  page_size: number;
  kpis: Record<string, number>;
  tab_counts: Record<string, number>;
  attention: BreachAttentionRow[];
  thresholds: {
    response_sla_days: number;
    high_value_shortfall: number;
    new_breach_days: number;
  };
  actor: {
    user_id: string;
    can_manage: boolean;
    can_resolve: boolean;
    can_override: boolean;
    can_assign: boolean;
    can_refer_legal: boolean;
  };
  error?: string;
}

export interface BreachFacets {
  types: { code: string; label: string; tone: string | null }[];
  statuses: { code: string; label: string; tone: string | null }[];
  escalations: { code: string; label: string; tone: string | null }[];
  resolution_types: { code: string; label: string }[];
  detection_methods: { code: string; label: string }[];
  health: { code: string; label: string }[];
  employers: { code: string; label: string }[];
  arrangements: { code: string; label: string }[];
  officers: { code: string; label: string }[];
  error?: string;
}

const LIST_KEYS = ['types', 'statuses', 'escalations', 'health'] as const;

export function useBreachRegister(forcedEmployerId?: string | null) {
  const [params, setParams] = useSearchParams();

  const filters: BreachFilters = useMemo(
    () => ({
      tab: params.get('tab') || 'OPEN',
      search: params.get('q') || '',
      employer_id: forcedEmployerId || params.get('employer') || '',
      arrangement_id: params.get('arr') || '',
      officer: params.get('officer') || '',
      types: (params.get('types') || '').split(',').filter(Boolean),
      statuses: (params.get('statuses') || '').split(',').filter(Boolean),
      escalations: (params.get('escalations') || '').split(',').filter(Boolean),
      health: (params.get('health') || '').split(',').filter(Boolean),
      detection: params.get('detection') || '',
      breach_window: params.get('window') || '',
      breach_from: params.get('from') || '',
      breach_to: params.get('to') || '',
      amount_band: params.get('amount') || '',
      min_shortfall: params.get('min') || '',
    }),
    [params, forcedEmployerId],
  );

  const sort = params.get('sort') || 'urgency';
  const dir = (params.get('dir') || 'desc') as 'asc' | 'desc';
  const page = Math.max(Number(params.get('page') || 1), 1);
  const pageSize = BREACH_PAGE_SIZES.includes(Number(params.get('size')) as any)
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
          filters.arrangement_id ||
          filters.officer ||
          filters.types.length ||
          filters.statuses.length ||
          filters.escalations.length ||
          filters.health.length ||
          filters.detection ||
          filters.breach_window ||
          filters.amount_band ||
          filters.min_shortfall,
      ),
    [filters, forcedEmployerId],
  );

  const rpcParams = useMemo(
    () => ({ ...filters, sort, dir, page, page_size: pageSize }),
    [filters, sort, dir, page, pageSize],
  );

  const query = useQuery({
    queryKey: ['ce-breach-register', rpcParams],
    queryFn: async (): Promise<BreachRegisterResult> => {
      const { data, error } = await sb.rpc('ce_breach_register_v1', { p_params: rpcParams });
      if (error) throw new Error(error.message);
      const result = data as BreachRegisterResult;
      if (result?.error) throw new Error(result.error);
      return result;
    },
  });

  const facets = useQuery({
    queryKey: ['ce-breach-facets'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<BreachFacets> => {
      const { data, error } = await sb.rpc('ce_breach_facets_v1');
      if (error) throw new Error(error.message);
      return (data ?? {}) as BreachFacets;
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
    queryString: params.toString(),
  };
}
