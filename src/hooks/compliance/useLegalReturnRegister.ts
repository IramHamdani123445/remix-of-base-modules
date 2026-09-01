import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Enterprise reader/writer for Compliance → Returned From Legal
 * (`/compliance/legal/returned`).
 *
 * OWNERSHIP BOUNDARY
 * ------------------
 *   Legal Queue          = approval + submission (pre-handover)
 *   Approved Escalations = post-handover tracking
 *   Returned From Legal  = THIS register — rework control after Legal sends
 *                          a referral back to Compliance.
 *
 * All rows, counts, KPIs, attention scoring and facets come from
 * `ce_legal_return_register_v1`. Writes go through governed RPCs which
 * re-check capability server-side; there is no `SYSTEM` identity fallback.
 */

const sb = supabase as any;

export const RETURN_PAGE_SIZES = [25, 50, 100, 200] as const;

export const RETURN_TABS = [
  { value: 'OPEN', label: 'Open rework' },
  { value: 'MY_REWORK', label: 'My rework' },
  { value: 'UNASSIGNED', label: 'Unassigned' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'NOT_STARTED', label: 'Not started' },
  { value: 'IN_REWORK', label: 'In rework' },
  { value: 'READY', label: 'Ready to resubmit' },
  { value: 'HIGH_VALUE', label: 'High exposure' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'ALL', label: 'All' },
] as const;

export const RETURN_AMOUNT_BANDS: Array<{ value: string; label: string; min?: number; max?: number }> = [
  { value: '0-1k', label: 'Under 1,000', max: 1000 },
  { value: '1k-5k', label: '1,000 – 5,000', min: 1000, max: 5000 },
  { value: '5k-10k', label: '5,001 – 10,000', min: 5000, max: 10000 },
  { value: '10k-50k', label: '10,001 – 50,000', min: 10000, max: 50000 },
  { value: '50k+', label: '50,000 and above', min: 50000 },
  { value: 'CUSTOM', label: 'Custom range…' },
];

export const RETURN_WINDOWS: Array<{ value: string; label: string; days?: number }> = [
  { value: '7D', label: 'Returned last 7 days', days: 7 },
  { value: '30D', label: 'Returned last 30 days', days: 30 },
  { value: '90D', label: 'Returned last 90 days', days: 90 },
  { value: 'YTD', label: 'Returned this year' },
  { value: 'CUSTOM', label: 'Custom range…' },
];

export const READINESS_OPTIONS = [
  { value: 'READY', label: 'Pack ready' },
  { value: 'MISSING_MANDATORY', label: 'Missing mandatory items' },
  { value: 'IN_PROGRESS', label: 'Pack in progress' },
  { value: 'NOT_STARTED', label: 'Pack not started' },
];

export const SLA_OPTIONS = [
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'DUE_SOON', label: 'Due soon' },
  { value: 'WITHIN_SLA', label: 'Within SLA' },
];

export interface LegalReturnFilters {
  tab: string;
  search: string;
  status: string;
  rework_status: string;
  reason_code: string;
  owner: string;
  returned_by: string;
  employer: string;
  ce_case: string;
  sla: string;
  readiness: string;
  amount_band: string;
  amount_min: string;
  amount_max: string;
  returned_window: string;
  returned_from: string;
  returned_to: string;
  sort: string;
  dir: 'asc' | 'desc';
  page: number;
  page_size: number;
}

export const DEFAULT_RETURN_FILTERS: LegalReturnFilters = {
  tab: 'OPEN',
  search: '',
  status: '',
  rework_status: '',
  reason_code: '',
  owner: '',
  returned_by: '',
  employer: '',
  ce_case: '',
  sla: '',
  readiness: '',
  amount_band: '',
  amount_min: '',
  amount_max: '',
  returned_window: '',
  returned_from: '',
  returned_to: '',
  sort: 'attention',
  dir: 'desc',
  page: 1,
  page_size: 25,
};

export interface LegalReturnRow {
  return_id: string;
  referral_id: string;
  return_seq: number;
  total_returns: number;
  referral_number: string | null;
  referral_status: string | null;
  employer_name: string | null;
  employer_reg_no: string | null;
  zone: string | null;
  ce_case_id: string | null;
  ce_case_number: string | null;
  lg_intake_no: string | null;
  lg_case_no: string | null;
  court_case_no: string | null;
  returned_at: string | null;
  returned_by: string | null;
  returned_by_display: string | null;
  reason_code: string | null;
  reason_label: string | null;
  reason_tone: string | null;
  reason_text: string | null;
  comments: string | null;
  required_action: string | null;
  status_code: string;
  status_label: string;
  status_tone: string | null;
  rework_status: string;
  rework_label: string;
  rework_tone: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  assigned_at: string | null;
  due_date: string | null;
  sla_state: 'WITHIN_SLA' | 'DUE_SOON' | 'OVERDUE' | null;
  rework_hours: number | null;
  readiness_code: string;
  pack_required_items: number | null;
  pack_required_complete: number | null;
  pack_missing_required: number | null;
  returned_pack_version: number | null;
  current_pack_version: number | null;
  principal: number | null;
  penalty: number | null;
  interest: number | null;
  total_referred: number | null;
  resolved_at: string | null;
  resubmitted_at: string | null;
  high_value: boolean;
  attention_score: number;
  follow_up_action_id: string | null;
}

export interface LegalReturnAttentionRow {
  return_id: string;
  referral_id: string;
  referral_number: string | null;
  employer_name: string | null;
  amount: number | null;
  priority: number;
  reason: string;
}

export interface LegalReturnRegisterResult {
  error?: string;
  rows: LegalReturnRow[];
  total: number;
  page: number;
  page_size: number;
  kpis: {
    open: number;
    overdue: number;
    ready: number;
    returned_this_month: number;
    avg_rework_hours: number;
    open_exposure: number;
  };
  tab_counts: Record<string, number>;
  attention: LegalReturnAttentionRow[];
  facets: {
    reasons: Array<{ code: string; label: string; tone: string | null }>;
    statuses: Array<{ code: string; label: string; tone: string | null }>;
    rework_statuses: Array<{ code: string; label: string; tone: string | null }>;
    owners: Array<{ code: string; name: string }>;
    returned_by: Array<{ code: string; name: string }>;
    employers: Array<{ code: string; name: string }>;
  };
  thresholds: { rework_sla_days: number; due_soon_days: number; high_value: number };
  actor: {
    code: string | null;
    can_view: boolean;
    can_assign: boolean;
    can_rework: boolean;
    can_complete: boolean;
  };
}

const URL_KEYS: Array<keyof LegalReturnFilters> = [
  'tab', 'search', 'status', 'rework_status', 'reason_code', 'owner', 'returned_by',
  'employer', 'ce_case', 'sla', 'readiness', 'amount_band', 'amount_min', 'amount_max',
  'returned_window', 'returned_from', 'returned_to', 'sort', 'dir', 'page', 'page_size',
];

function windowToDates(win: string, from: string, to: string) {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  switch (win) {
    case '7D':
    case '30D':
    case '90D': {
      const days = Number(win.replace('D', ''));
      const start = new Date(today);
      start.setDate(start.getDate() - days);
      return { returned_from: iso(start), returned_to: iso(today) };
    }
    case 'YTD':
      return { returned_from: `${today.getFullYear()}-01-01`, returned_to: iso(today) };
    case 'CUSTOM':
      return { returned_from: from || null, returned_to: to || null };
    default:
      return { returned_from: null, returned_to: null };
  }
}

export function useLegalReturnRegister() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [filters, setFiltersState] = useState<LegalReturnFilters>(() => {
    const next: LegalReturnFilters = { ...DEFAULT_RETURN_FILTERS };
    URL_KEYS.forEach((key) => {
      const raw = searchParams.get(String(key));
      if (raw === null) return;
      if (key === 'page' || key === 'page_size') (next as any)[key] = Number(raw) || next[key];
      else (next as any)[key] = raw;
    });
    return next;
  });

  const syncUrl = useCallback(
    (value: LegalReturnFilters) => {
      const next = new URLSearchParams(searchParams);
      URL_KEYS.forEach((key) => {
        const v = String(value[key] ?? '');
        if (!v || v === String(DEFAULT_RETURN_FILTERS[key] ?? '')) next.delete(String(key));
        else next.set(String(key), v);
      });
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setFilters = useCallback(
    (patch: Partial<LegalReturnFilters>) => {
      setFiltersState((prev) => {
        const next: LegalReturnFilters = {
          ...prev,
          ...patch,
          page: patch.page ?? ('page' in patch ? prev.page : 1),
        };
        syncUrl(next);
        return next;
      });
    },
    [syncUrl],
  );

  const resetFilters = useCallback(() => {
    setFiltersState(DEFAULT_RETURN_FILTERS);
    syncUrl(DEFAULT_RETURN_FILTERS);
  }, [syncUrl]);

  const rpcFilters = useMemo(() => {
    const band = RETURN_AMOUNT_BANDS.find((b) => b.value === filters.amount_band);
    const custom = filters.amount_band === 'CUSTOM';
    const dates = windowToDates(filters.returned_window, filters.returned_from, filters.returned_to);
    return {
      tab: filters.tab,
      search: filters.search || null,
      status: filters.status || null,
      rework_status: filters.rework_status || null,
      reason_code: filters.reason_code || null,
      owner: filters.owner || null,
      returned_by: filters.returned_by || null,
      employer: filters.employer || null,
      ce_case: filters.ce_case || null,
      sla: filters.sla || null,
      readiness: filters.readiness || null,
      amount_min: custom ? filters.amount_min || null : band?.min ?? null,
      amount_max: custom ? filters.amount_max || null : band?.max ?? null,
      returned_from: dates.returned_from,
      returned_to: dates.returned_to,
    };
  }, [filters]);

  const query = useQuery<LegalReturnRegisterResult>({
    queryKey: ['ce-legal-returns', rpcFilters, filters.sort, filters.dir, filters.page, filters.page_size],
    queryFn: async () => {
      const { data, error } = await sb.rpc('ce_legal_return_register_v1', {
        p_filters: rpcFilters,
        p_sort: filters.sort,
        p_dir: filters.dir,
        p_page: filters.page,
        p_page_size: filters.page_size,
      });
      if (error) throw error;
      if (data?.error) {
        throw new Error(
          data.error === 'NOT_AUTHORISED'
            ? 'You are not authorised to view the Legal return and rework queue.'
            : 'Your session has expired. Please sign in again.',
        );
      }
      return data as LegalReturnRegisterResult;
    },
    staleTime: 15_000,
  });

  const selectedId = searchParams.get('return');
  const setSelectedId = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (id) next.set('return', id);
      else next.delete('return');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const toggleSort = useCallback(
    (key: string) => {
      setFilters({
        sort: key,
        dir: filters.sort === key && filters.dir === 'desc' ? 'asc' : 'desc',
        page: 1,
      });
    },
    [filters.sort, filters.dir, setFilters],
  );

  const hasActiveFilters = useMemo(
    () =>
      URL_KEYS.some(
        (k) =>
          !['sort', 'dir', 'page', 'page_size'].includes(String(k)) &&
          String(filters[k] ?? '') !== String(DEFAULT_RETURN_FILTERS[k] ?? ''),
      ),
    [filters],
  );

  return {
    filters,
    setFilters,
    resetFilters,
    toggleSort,
    hasActiveFilters,
    rows: query.data?.rows ?? [],
    total: query.data?.total ?? 0,
    kpis: query.data?.kpis,
    tabCounts: query.data?.tab_counts ?? {},
    attention: query.data?.attention ?? [],
    facets: query.data?.facets,
    thresholds: query.data?.thresholds,
    actor: query.data?.actor,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
    selectedId,
    setSelectedId,
  };
}

export interface LegalReturnDetailResult {
  return: Record<string, any>;
  pack: any;
  corrections: Array<Record<string, any>>;
  documents: Array<Record<string, any>>;
  versions: Array<Record<string, any>>;
  history: Array<Record<string, any>>;
  timeline: Array<Record<string, any>>;
  tasks: Array<Record<string, any>>;
  thresholds: { rework_sla_days: number };
  actor: { code: string | null; can_complete: boolean; can_assign: boolean };
}

export function useLegalReturnDetail(returnId: string | null) {
  return useQuery<LegalReturnDetailResult>({
    queryKey: ['ce-legal-return-detail', returnId],
    enabled: !!returnId,
    queryFn: async () => {
      const { data, error } = await sb.rpc('ce_legal_return_detail_v1', { p_return_id: returnId });
      if (error) throw error;
      if (data?.error) throw new Error('This return record could not be retrieved.');
      return data as LegalReturnDetailResult;
    },
    staleTime: 10_000,
  });
}

/** Governed rework mutations — identity and capability are enforced server-side. */
export function useLegalReturnActions(returnId: string | null) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ce-legal-returns'] });
    qc.invalidateQueries({ queryKey: ['ce-legal-return-detail', returnId] });
  };

  const assign = useMutation({
    mutationFn: async (input: {
      assignee_code: string;
      assignee_name?: string | null;
      due_date?: string | null;
      create_task?: boolean;
    }) => {
      const { data, error } = await sb.rpc('ce_legal_return_assign_v1', {
        p_return_id: returnId,
        p_assignee_code: input.assignee_code,
        p_assignee_name: input.assignee_name ?? null,
        p_due_date: input.due_date ?? null,
        p_create_task: input.create_task ?? true,
      });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.message ?? data.error));
      return data;
    },
    onSuccess: () => { toast.success('Rework owner assigned'); invalidate(); },
    onError: (e: any) => toast.error(e.message ?? 'Assignment failed'),
  });

  const setStatus = useMutation({
    mutationFn: async (input: { rework_status: string; note?: string | null }) => {
      const { data, error } = await sb.rpc('ce_legal_return_set_rework_status_v1', {
        p_return_id: returnId,
        p_rework_status: input.rework_status,
        p_note: input.note ?? null,
      });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.message ?? data.error));
      return data;
    },
    onSuccess: () => { toast.success('Rework status updated'); invalidate(); },
    onError: (e: any) => toast.error(e.message ?? 'Update failed'),
  });

  const complete = useMutation({
    mutationFn: async (input: { summary: string; resubmit: boolean; idempotencyKey: string }) => {
      const { data, error } = await sb.rpc('ce_legal_return_complete_rework_v1', {
        p_return_id: returnId,
        p_summary: input.summary,
        p_resubmit: input.resubmit,
        p_idempotency_key: input.idempotencyKey,
      });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.message ?? data.error));
      return data;
    },
    onSuccess: (data: any) => {
      toast.success(data?.resubmitted ? 'Rework completed and pack resubmitted to Legal' : 'Rework completed');
      invalidate();
    },
    onError: (e: any) => toast.error(e.message ?? 'Completion failed'),
  });

  return { assign, setStatus, complete };
}

/** "6h" / "3d" — rework age for the register. */
export function formatReworkAge(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return '—';
  if (hours < 1) return '<1h';
  if (hours < 48) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
}
