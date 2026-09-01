import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Enterprise reader for Compliance → Waiver Requests
 * (`/compliance/enforcement/waivers`).
 *
 * OWNERSHIP BOUNDARY
 * ------------------
 * `ce_waivers` / `ce_waiver_decisions` remain write-protected: every waiver
 * transition goes through the governed commands (`ce_request_waiver_v1`,
 * `ce_approve_waiver_v1`, `ce_reject_waiver_v1`, `ce_cancel_waiver_v1`) which
 * re-check feature toggles, rule caps, approval authority and segregation of
 * duties inside the database.
 *
 * This hook is READ ONLY. Search, filters, sorting, paging, KPIs and the
 * "Requires attention" set are resolved server-side by `ce_waiver_register_v1`
 * over `ce_v_waiver_register` — nothing is recomputed in the browser.
 */

const sb = supabase as any;

export const WAIVER_PAGE_SIZES = [25, 50, 100, 200] as const;

export interface WaiverFilters {
  tab: string;
  search: string;
  statuses: string[];
  components: string[];
  scopes: string[];
  sources: string[];
  employer_id: string;
  requested_by: string;
  rule_id: string;
  case_id: string;
  violation_id: string;
  sla: string;
  date_window: string;
  date_from: string;
  date_to: string;
  amount_band: string;
  amount_min: string;
  amount_max: string;
}

export interface WaiverRegisterRow {
  waiver_id: string;
  waiver_number: string;
  employer_id: string;
  employer_name: string | null;
  regno: string | null;
  case_id: string | null;
  case_number: string | null;
  case_status: string | null;
  violation_id: string | null;
  violation_number: string | null;
  violation_type: string | null;
  violation_status: string | null;
  waiver_type_raw: string | null;
  component_code: string;
  component_label: string | null;
  scope_code: string | null;
  scope_label: string | null;
  status_raw: string | null;
  status_code: string;
  status_label: string | null;
  status_tone: string | null;
  source_code: string;
  source_label: string;
  amount_requested: number;
  amount_approved: number | null;
  amount_difference: number | null;
  approved_pct: number | null;
  reason_code: string | null;
  justification: string | null;
  document_count: number;
  supporting_documents: Array<{ name?: string; url?: string; doc_type?: string }> | null;
  requested_by: string | null;
  requested_by_name: string | null;
  requested_at: string;
  waiting_hours: number;
  waiting_days: number;
  approver_id: string | null;
  approver_name: string | null;
  approver_comments: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  applied_at: string | null;
  decided_at: string | null;
  waiver_rule_id: string | null;
  rule_code: string | null;
  rule_name: string | null;
  rule_max_percentage: number | null;
  rule_amount_threshold: number | null;
  rule_required_role: string | null;
  rule_escalated_role: string | null;
  rule_enabled: boolean | null;
  rule_cap_amount: number | null;
  case_principal: number | null;
  case_penalties: number | null;
  case_interest: number | null;
  case_total: number | null;
  case_paid: number | null;
  case_waived: number | null;
  case_outstanding: number | null;
  violation_principal: number | null;
  violation_penalty: number | null;
  violation_interest: number | null;
  violation_total: number | null;
  prior_count: number;
  prior_amount: number;
  is_open: boolean;
  sla_overdue: boolean;
  sla_due_soon: boolean;
  high_value: boolean;
  exceeds_rule_cap: boolean;
  weak_justification: boolean;
  approved_not_applied: boolean;
  missing_linkage: boolean;
  is_own_request: boolean;
}

export interface WaiverAttentionRow {
  waiver_id: string;
  waiver_number: string;
  employer_name: string | null;
  amount_requested: number;
  waiting_days: number;
  priority: number;
  reason: string;
}

export interface WaiverActor {
  user_code: string | null;
  can_approve: boolean;
  can_approve_high: boolean;
  can_request: boolean;
  can_admin_rules: boolean;
  is_admin: boolean;
}

export interface WaiverThresholds {
  approval_sla_days: number;
  due_soon_days: number;
  high_value_amount: number;
  min_justification_chars: number;
}

export interface WaiverRegisterResult {
  rows: WaiverRegisterRow[];
  total: number;
  page: number;
  page_size: number;
  kpis: Record<string, number>;
  tab_counts: Record<string, number>;
  attention: WaiverAttentionRow[];
  thresholds: WaiverThresholds;
  actor: WaiverActor;
  error?: string;
}

export interface WaiverFacets {
  statuses: { code: string; label: string; tone: string | null; description: string | null }[];
  components: { code: string; label: string }[];
  scopes: { code: string; label: string }[];
  sources: { code: string; label: string }[];
  employers: { code: string; label: string }[];
  requesters: { code: string; label: string }[];
  rules: {
    code: string;
    label: string;
    max_percentage: number | null;
    amount_threshold: number | null;
    required_role: string | null;
    escalated_role: string | null;
    enabled: boolean;
  }[];
  error?: string;
}

const LIST_KEYS = ['statuses', 'components', 'scopes', 'sources'] as const;

export function useWaiverRegister() {
  const [params, setParams] = useSearchParams();

  const filters: WaiverFilters = useMemo(
    () => ({
      tab: params.get('tab') || 'ACTION',
      search: params.get('q') || '',
      statuses: (params.get('statuses') || '').split(',').filter(Boolean),
      components: (params.get('components') || '').split(',').filter(Boolean),
      scopes: (params.get('scopes') || '').split(',').filter(Boolean),
      sources: (params.get('sources') || '').split(',').filter(Boolean),
      employer_id: params.get('employer') || '',
      requested_by: params.get('requester') || '',
      rule_id: params.get('rule') || '',
      case_id: params.get('case') || '',
      violation_id: params.get('violation') || '',
      sla: params.get('sla') || '',
      date_window: params.get('window') || '',
      date_from: params.get('from') || '',
      date_to: params.get('to') || '',
      amount_band: params.get('amount') || '',
      amount_min: params.get('min') || '',
      amount_max: params.get('max') || '',
    }),
    [params],
  );

  const sort = params.get('sort') || 'default';
  const dir = (params.get('dir') || 'desc') as 'asc' | 'desc';
  const page = Math.max(Number(params.get('page') || 1), 1);
  const pageSize = WAIVER_PAGE_SIZES.includes(Number(params.get('size')) as any)
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

  const setPage = useCallback(
    (p: number) => patchParams({ page: String(Math.max(p, 1)) }, false),
    [patchParams],
  );
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
          filters.statuses.length ||
          filters.components.length ||
          filters.scopes.length ||
          filters.sources.length ||
          filters.employer_id ||
          filters.requested_by ||
          filters.rule_id ||
          filters.case_id ||
          filters.violation_id ||
          filters.sla ||
          filters.date_window ||
          filters.amount_band,
      ),
    [filters],
  );

  const rpcParams = useMemo(
    () => ({ ...filters, sort, dir, page, page_size: pageSize }),
    [filters, sort, dir, page, pageSize],
  );

  const query = useQuery({
    queryKey: ['ce-waiver-register', rpcParams],
    queryFn: async (): Promise<WaiverRegisterResult> => {
      const { data, error } = await sb.rpc('ce_waiver_register_v1', { p_params: rpcParams });
      if (error) throw new Error(error.message);
      const result = data as WaiverRegisterResult;
      if (result?.error) throw new Error(result.error);
      return result;
    },
  });

  const facets = useQuery({
    queryKey: ['ce-waiver-facets'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<WaiverFacets> => {
      const { data, error } = await sb.rpc('ce_waiver_facets_v1');
      if (error) throw new Error(error.message);
      return (data ?? {}) as WaiverFacets;
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

export interface WaiverDetailResult {
  waiver: WaiverRegisterRow;
  timeline: Array<{
    id: string;
    action: string;
    from_status: string | null;
    to_status: string | null;
    from_label: string | null;
    to_label: string | null;
    amount: number | null;
    reason: string | null;
    comments: string | null;
    acted_by: string | null;
    acted_by_name: string | null;
    acted_at: string;
  }>;
  previous_waivers: Array<{
    waiver_id: string;
    waiver_number: string;
    status_label: string | null;
    component_label: string | null;
    amount_requested: number;
    amount_approved: number | null;
    requested_at: string;
  }>;
  actor: WaiverActor & { is_own_request: boolean };
  thresholds: { approval_sla_days: number; high_value_amount: number };
  error?: string;
}

export function useWaiverDetail(waiverId: string | null) {
  return useQuery({
    queryKey: ['ce-waiver-detail', waiverId],
    enabled: !!waiverId,
    queryFn: async (): Promise<WaiverDetailResult> => {
      const { data, error } = await sb.rpc('ce_waiver_detail_v1', { p_waiver_id: waiverId });
      if (error) throw new Error(error.message);
      const result = data as WaiverDetailResult;
      if (result?.error) throw new Error(result.error);
      return result;
    },
  });
}
