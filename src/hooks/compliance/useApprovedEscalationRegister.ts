import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Enterprise reader for Compliance → Approved Escalations
 * (`/compliance/legal/approved-escalations`).
 *
 * OWNERSHIP BOUNDARY
 * ------------------
 * This register begins AFTER the Compliance → Legal handover boundary.
 *   Legal Queue          = approval + submission (pre-handover)
 *   Approved Escalations = submitted / accepted / in-proceedings tracking
 *   Returned From Legal  = dedicated rework queue
 *
 * Nothing here writes Legal-owned data. Rows, counts, KPIs, the
 * "requires attention" set and facets are all resolved server-side by
 * `ce_approved_escalation_register_v1`, which re-checks the actor's
 * monitoring capability and masks financial columns when the actor lacks
 * financial visibility. Latest Legal status / last Legal update always come
 * from the Legal-owned case record, never from a Compliance-side copy.
 */

const sb = supabase as any;

export const ESCALATION_PAGE_SIZES = [25, 50, 100, 200] as const;

export interface EscalationFilters {
  tab: string;
  search: string;
  status: string;
  legal_status: string;
  zone: string;
  reason_code: string;
  origin_code: string;
  amount_band: string;
  amount_min: string;
  amount_max: string;
  submitted_window: string;
  submitted_from: string;
  submitted_to: string;
  update_window: string;
  sort: string;
  dir: 'asc' | 'desc';
  page: number;
  page_size: number;
}

export const DEFAULT_ESCALATION_FILTERS: EscalationFilters = {
  tab: 'ALL',
  search: '',
  status: '',
  legal_status: '',
  zone: '',
  reason_code: '',
  origin_code: '',
  amount_band: '',
  amount_min: '',
  amount_max: '',
  submitted_window: '',
  submitted_from: '',
  submitted_to: '',
  update_window: '',
  sort: 'attention',
  dir: 'desc',
  page: 1,
  page_size: 25,
};

export const AMOUNT_BANDS: Array<{ value: string; label: string; min?: number; max?: number }> = [
  { value: '0-1k', label: 'Under 1,000', max: 1000 },
  { value: '1k-5k', label: '1,000 – 5,000', min: 1000, max: 5000 },
  { value: '5k-10k', label: '5,001 – 10,000', min: 5000, max: 10000 },
  { value: '10k-50k', label: '10,001 – 50,000', min: 10000, max: 50000 },
  { value: '50k+', label: '50,000 and above', min: 50000 },
  { value: 'CUSTOM', label: 'Custom range…' },
];

export const SUBMITTED_WINDOWS: Array<{ value: string; label: string; days?: number }> = [
  { value: '7D', label: 'Last 7 days', days: 7 },
  { value: '30D', label: 'Last 30 days', days: 30 },
  { value: '90D', label: 'Last 90 days', days: 90 },
  { value: 'YTD', label: 'This year' },
  { value: 'CUSTOM', label: 'Custom range…' },
];

export const UPDATE_WINDOWS: Array<{ value: string; label: string }> = [
  { value: 'TODAY', label: 'Updated today' },
  { value: '7D', label: 'Updated last 7 days' },
  { value: 'NO_7D', label: 'No update 7+ days' },
  { value: 'NO_30D', label: 'No update 30+ days' },
];

export const ESCALATION_TABS = [
  { value: 'ALL', label: 'All' },
  { value: 'AWAITING', label: 'Awaiting Legal acceptance' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'PROCEEDINGS', label: 'In proceedings' },
  { value: 'STALE', label: 'No recent update' },
  { value: 'HIGH_VALUE', label: 'High exposure' },
  { value: 'RETURNED', label: 'Returned' },
  { value: 'CLOSED', label: 'Closed' },
] as const;

export interface EscalationRow {
  referral_id: string;
  referral_number: string;
  referral_status: string;
  status_label: string;
  status_tone: string | null;
  employer_reg_no: string | null;
  employer_name: string | null;
  zone: string | null;
  ce_case_id: string | null;
  ce_case_number: string | null;
  reason_code: string | null;
  referral_reason_text: string | null;
  origin_code: string | null;
  origin_label: string | null;
  principal_amount?: number | null;
  penalty_amount?: number | null;
  interest_amount?: number | null;
  total_referred?: number | null;
  outstanding_amount?: number | null;
  recovered_amount?: number | null;
  recovery_status_code: string;
  recovery_label: string | null;
  approved_at: string | null;
  approved_by: string | null;
  submitted_by: string | null;
  submitted_date: string | null;
  accepted_date: string | null;
  accepted_by: string | null;
  lg_intake_id: string | null;
  lg_intake_no: string | null;
  lg_case_no: string | null;
  legal_case_id: string | null;
  court_case_no: string | null;
  court_name: string | null;
  legal_officer: string | null;
  next_hearing_date: string | null;
  returned_at: string | null;
  return_reason: string | null;
  return_resolution_status: string | null;
  legal_status_code: string;
  legal_status_label: string;
  last_legal_update: string | null;
  waiting_hours: number | null;
  acceptance_sla: 'WITHIN_SLA' | 'DUE_SOON' | 'OVERDUE' | null;
  awaiting_acceptance: boolean;
  acceptance_overdue: boolean;
  acceptance_due_soon: boolean;
  legal_stale: boolean;
  accepted_no_case: boolean;
  is_returned: boolean;
  high_value: boolean;
  is_closed: boolean;
  attention_score: number;
}

export interface EscalationAttentionRow {
  referral_id: string;
  referral_number: string;
  employer_name: string | null;
  status_label: string;
  legal_status_label: string;
  amount: number | null;
  priority: number;
  reason: string;
}

export interface EscalationRegisterResult {
  error?: 'NOT_AUTHENTICATED' | 'NOT_AUTHORISED';
  rows: EscalationRow[];
  total: number;
  page: number;
  page_size: number;
  kpis: {
    awaiting: number;
    acceptance_overdue: number;
    accepted: number;
    proceedings: number;
    returned: number;
    closed: number;
    stale: number;
    high_value: number;
    total_exposure: number | null;
    outstanding_exposure: number | null;
  };
  tab_counts: Record<string, number>;
  attention: EscalationAttentionRow[];
  facets: {
    statuses: Array<{ code: string; label: string; tone: string | null }>;
    legal_statuses: Array<{ code: string; label: string }>;
    zones: string[];
    reasons: string[];
    origins: Array<{ code: string; label: string }>;
  };
  thresholds: {
    acceptance_sla_days: number;
    acceptance_due_soon_days: number;
    stale_days: number;
    high_value: number;
  };
  actor: { can_view_financials: boolean; can_open_legal: boolean; can_view_legal_status: boolean };
}

const URL_KEYS: Array<keyof EscalationFilters> = [
  'tab', 'search', 'status', 'legal_status', 'zone', 'reason_code', 'origin_code',
  'amount_band', 'amount_min', 'amount_max', 'submitted_window', 'submitted_from',
  'submitted_to', 'update_window', 'sort', 'dir', 'page', 'page_size',
];

function windowToDates(window: string, from: string, to: string) {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  switch (window) {
    case '7D':
    case '30D':
    case '90D': {
      const days = Number(window.replace('D', ''));
      const start = new Date(today);
      start.setDate(start.getDate() - days);
      return { submitted_from: iso(start), submitted_to: iso(today) };
    }
    case 'YTD':
      return { submitted_from: `${today.getFullYear()}-01-01`, submitted_to: iso(today) };
    case 'CUSTOM':
      return { submitted_from: from || null, submitted_to: to || null };
    default:
      return { submitted_from: null, submitted_to: null };
  }
}

export function useApprovedEscalationRegister() {
  const [searchParams, setSearchParams] = useSearchParams();

  // URL-state persistence: filters survive drill-downs to Employer 360,
  // Compliance Case, Legal matter or Proceedings and the browser Back button.
  const [filters, setFiltersState] = useState<EscalationFilters>(() => {
    const next: EscalationFilters = { ...DEFAULT_ESCALATION_FILTERS };
    URL_KEYS.forEach((key) => {
      const raw = searchParams.get(String(key));
      if (raw === null) return;
      if (key === 'page' || key === 'page_size') (next as any)[key] = Number(raw) || next[key];
      else (next as any)[key] = raw;
    });
    return next;
  });

  const syncUrl = useCallback(
    (value: EscalationFilters) => {
      const next = new URLSearchParams(searchParams);
      URL_KEYS.forEach((key) => {
        const v = String(value[key] ?? '');
        if (!v || v === String(DEFAULT_ESCALATION_FILTERS[key] ?? '')) next.delete(String(key));
        else next.set(String(key), v);
      });
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setFilters = useCallback(
    (patch: Partial<EscalationFilters>) => {
      setFiltersState((prev) => {
        const next: EscalationFilters = {
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
    setFiltersState(DEFAULT_ESCALATION_FILTERS);
    syncUrl(DEFAULT_ESCALATION_FILTERS);
  }, [syncUrl]);

  const rpcFilters = useMemo(() => {
    const band = AMOUNT_BANDS.find((b) => b.value === filters.amount_band);
    const custom = filters.amount_band === 'CUSTOM';
    const dates = windowToDates(filters.submitted_window, filters.submitted_from, filters.submitted_to);
    return {
      tab: filters.tab,
      search: filters.search || null,
      status: filters.status || null,
      legal_status: filters.legal_status || null,
      zone: filters.zone || null,
      reason_code: filters.reason_code || null,
      origin_code: filters.origin_code || null,
      amount_min: custom ? filters.amount_min || null : band?.min ?? null,
      amount_max: custom ? filters.amount_max || null : band?.max ?? null,
      submitted_from: dates.submitted_from,
      submitted_to: dates.submitted_to,
      update_window: filters.update_window || null,
    };
  }, [filters]);

  const query = useQuery<EscalationRegisterResult>({
    queryKey: ['ce-approved-escalations', rpcFilters, filters.sort, filters.dir, filters.page, filters.page_size],
    queryFn: async () => {
      const { data, error } = await sb.rpc('ce_approved_escalation_register_v1', {
        p_filters: rpcFilters,
        p_sort: filters.sort,
        p_dir: filters.dir,
        p_page: filters.page,
        p_page_size: filters.page_size,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error === 'NOT_AUTHORISED'
        ? 'You are not authorised to view Legal handover tracking.'
        : 'Your session has expired. Please sign in again.');
      return data as EscalationRegisterResult;
    },
    staleTime: 15_000,
  });

  const selectedId = searchParams.get('referral');
  const setSelectedId = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (id) next.set('referral', id);
      else next.delete('referral');
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
          String(filters[k] ?? '') !== String(DEFAULT_ESCALATION_FILTERS[k] ?? ''),
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

export interface EscalationTimelineEvent {
  at: string;
  code: string;
  label: string;
  actor: string | null;
  source: 'COMPLIANCE' | 'LEGAL';
}

export interface EscalationDetailResult {
  referral: EscalationRow & Record<string, any>;
  timeline: EscalationTimelineEvent[];
  items: Array<Record<string, any>>;
  versions: Array<Record<string, any>>;
  documents: Array<Record<string, any>>;
  actor: { can_view_financials: boolean };
}

export function useApprovedEscalationDetail(referralId: string | null) {
  return useQuery<EscalationDetailResult>({
    queryKey: ['ce-approved-escalation-detail', referralId],
    enabled: !!referralId,
    queryFn: async () => {
      const { data, error } = await sb.rpc('ce_approved_escalation_detail_v1', {
        p_referral_id: referralId,
      });
      if (error) throw error;
      if (data?.error) throw new Error('Referral tracking record could not be retrieved.');
      return data as EscalationDetailResult;
    },
    staleTime: 10_000,
  });
}

/** "4h" / "3d" / "12d" — acceptance waiting age for the register. */
export function formatWaiting(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return '—';
  if (hours < 1) return '<1h';
  if (hours < 48) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
}
