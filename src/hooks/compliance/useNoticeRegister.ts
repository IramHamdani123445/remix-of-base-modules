import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Enterprise reader for Compliance → Notice Register (`/compliance/notices/register`).
 *
 * All search, filtering, sorting, paging, KPI counts, tab counts and the
 * "Requires Attention" set are resolved server-side by `ce_notice_register_v1`
 * over `ce_v_notice_register` (notice + case + violation + latest delivery
 * attempt + response state). No client-side filtering, no N+1 delivery-log
 * fetches. Labels come from `ce_notice_ref` configuration.
 */

const sb = supabase as any;

export const NOTICE_PAGE_SIZES = [25, 50, 100, 200] as const;

export interface NoticeFilters {
  tab: string;
  search: string;
  employer_id: string;
  case_id: string;
  violation_id: string;
  types: string[];
  statuses: string[];
  delivery: string[];
  response: string[];
  methods: string[];
  due_window: string;
  created_window: string;
  sent_window: string;
  delivered_window: string;
  created_from: string;
  created_to: string;
}

export interface NoticeRow {
  id: string;
  notice_number: string;
  employer_id: string | null;
  employer_name: string | null;
  case_id: string | null;
  case_number: string | null;
  violation_id: string | null;
  violation_number: string | null;
  notice_type: string | null;
  notice_type_label: string | null;
  notice_type_group: string | null;
  status: string;
  status_label: string | null;
  status_group: string | null;
  subject: string | null;
  delivery_method: string | null;
  delivery_method_label: string | null;
  created_at: string;
  created_by: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  acknowledged_at: string | null;
  due_response_date: string | null;
  response_received: boolean | null;
  response_date: string | null;
  template_id: string | null;
  template_code: string | null;
  template_name: string | null;
  dms_document_ref: string | null;
  delivery_status: 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED';
  delivery_attempts: number | null;
  last_attempt_at: string | null;
  last_delivered_at: string | null;
  delivery_failure_reason: string | null;
  response_state: 'NOT_REQUIRED' | 'AWAITING' | 'OVERDUE' | 'RECEIVED';
  response_count: number | null;
  last_response_date: string | null;
  attention_score: number;
  approval_stale: boolean;
  approved_not_sent: boolean;
  delivery_failed: boolean;
  response_overdue: boolean;
  response_due_soon: boolean;
  final_awaiting_action: boolean;
  response_needs_review: boolean;
}

export interface NoticeAttentionRow {
  id: string;
  notice_number: string;
  employer_name: string | null;
  status_label: string;
  due_response_date: string | null;
  priority: number;
  reason: string;
}

export interface NoticeRegisterResult {
  rows: NoticeRow[];
  total: number;
  page: number;
  page_size: number;
  kpis: Record<string, number>;
  tab_counts: Record<string, number>;
  attention: NoticeAttentionRow[];
  thresholds: Record<string, number>;
  actor: {
    can_generate: boolean;
    can_approve: boolean;
    can_send: boolean;
    can_cancel: boolean;
    can_record_response: boolean;
  };
  error?: string;
}

export interface NoticeFacets {
  types: { code: string; label: string; group: string | null }[];
  statuses: { code: string; label: string; group: string | null }[];
  delivery: { code: string; label: string }[];
  response: { code: string; label: string }[];
  methods: { code: string; label: string }[];
  employers: { code: string; label: string }[];
  cases: { code: string; label: string }[];
  violations: { code: string; label: string }[];
  error?: string;
}

const LIST_KEYS = ['types', 'statuses', 'delivery', 'response', 'methods'] as const;

const DEFAULTS: NoticeFilters = {
  tab: 'ALL',
  search: '',
  employer_id: '',
  case_id: '',
  violation_id: '',
  types: [],
  statuses: [],
  delivery: [],
  response: [],
  methods: [],
  due_window: '',
  created_window: '',
  sent_window: '',
  delivered_window: '',
  created_from: '',
  created_to: '',
};

/** Business label resolution — never surface a raw code when a label exists. */
export function labelFor(
  code: string | null | undefined,
  label: string | null | undefined,
  kind: string,
): string {
  if (!code) return '—';
  if (label) return label;
  // eslint-disable-next-line no-console
  console.warn(`[NoticeRegister] Unmapped ${kind} code:`, code);
  return `Unmapped ${kind}`;
}

export function useNoticeRegister() {
  const [params, setParams] = useSearchParams();

  const filters: NoticeFilters = useMemo(() => ({
    tab: params.get('tab') || DEFAULTS.tab,
    search: params.get('q') || '',
    employer_id: params.get('employer') || params.get('regno') || '',
    case_id: params.get('case') || '',
    violation_id: params.get('violation') || '',
    types: params.get('types')?.split(',').filter(Boolean) || [],
    statuses: params.get('statuses')?.split(',').filter(Boolean) || [],
    delivery: params.get('delivery')?.split(',').filter(Boolean) || [],
    response: params.get('response')?.split(',').filter(Boolean) || [],
    methods: params.get('methods')?.split(',').filter(Boolean) || [],
    due_window: params.get('due') || '',
    created_window: params.get('created') || '',
    sent_window: params.get('sent') || '',
    delivered_window: params.get('delivered') || '',
    created_from: params.get('from') || '',
    created_to: params.get('to') || '',
  }), [params]);

  const sort = params.get('sort') || 'attention';
  const dir = params.get('dir') || 'desc';
  const page = Math.max(1, Number(params.get('page') || 1));
  const pageSize = Number(params.get('size') || 25);

  const patch = useCallback((next: Record<string, string | string[] | number | undefined>, resetPage = true) => {
    const p = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => {
      const val = Array.isArray(v) ? v.join(',') : v === undefined ? '' : String(v);
      if (!val || val === 'ALL' && k === 'tab') {
        if (k === 'tab' && val === 'ALL') p.delete(k); else p.delete(k);
      } else p.set(k, val);
    });
    if (resetPage) p.delete('page');
    setParams(p, { replace: true });
  }, [params, setParams]);

  const setFilter = useCallback((key: keyof NoticeFilters, value: string | string[]) => {
    const map: Record<string, string> = {
      search: 'q', employer_id: 'employer', case_id: 'case', violation_id: 'violation',
      due_window: 'due', created_window: 'created', sent_window: 'sent',
      delivered_window: 'delivered', created_from: 'from', created_to: 'to',
    };
    patch({ [map[key] ?? key]: value });
  }, [patch]);

  const toggleListFilter = useCallback((key: typeof LIST_KEYS[number], code: string) => {
    const current = filters[key];
    const next = current.includes(code) ? current.filter(c => c !== code) : [...current, code];
    patch({ [key]: next });
  }, [filters, patch]);

  const setSort = useCallback((nextSort: string) => {
    if (sort === nextSort) patch({ sort: nextSort, dir: dir === 'asc' ? 'desc' : 'asc' }, false);
    else patch({ sort: nextSort, dir: nextSort === 'notice_number' ? 'desc' : 'desc' }, false);
  }, [sort, dir, patch]);

  const setPage = useCallback((p: number) => patch({ page: p }, false), [patch]);
  const setPageSize = useCallback((s: number) => patch({ size: s }), [patch]);
  const setTab = useCallback((t: string) => patch({ tab: t }), [patch]);

  const clearFilters = useCallback(() => {
    const p = new URLSearchParams();
    setParams(p, { replace: true });
  }, [setParams]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.search) n++;
    if (filters.employer_id) n++;
    if (filters.case_id) n++;
    if (filters.violation_id) n++;
    n += filters.types.length + filters.statuses.length + filters.delivery.length
       + filters.response.length + filters.methods.length;
    ['due_window', 'created_window', 'sent_window', 'delivered_window'].forEach(k => {
      if ((filters as any)[k]) n++;
    });
    return n;
  }, [filters]);

  const registerQuery = useQuery<NoticeRegisterResult>({
    queryKey: ['ce_notice_register_v1', filters, sort, dir, page, pageSize],
    queryFn: async () => {
      const { data, error } = await sb.rpc('ce_notice_register_v1', {
        p_params: {
          ...filters,
          sort, dir, page, page_size: pageSize,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as NoticeRegisterResult;
    },
    placeholderData: prev => prev,
  });

  const facetsQuery = useQuery<NoticeFacets>({
    queryKey: ['ce_notice_facets_v1'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await sb.rpc('ce_notice_facets_v1');
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as NoticeFacets;
    },
  });

  return {
    filters, sort, dir, page, pageSize, activeFilterCount,
    setFilter, toggleListFilter, setSort, setPage, setPageSize, setTab, clearFilters,
    register: registerQuery,
    facets: facetsQuery,
  };
}
