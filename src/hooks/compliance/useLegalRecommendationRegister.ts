import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Enterprise reader for Compliance → Legal Recommendation Queue
 * (`/compliance/enforcement/recommendation-queue`).
 *
 * PURPOSE BOUNDARY
 * ----------------
 *   Referral Launcher       = eligibility + initiation (before a recommendation)
 *   Recommendation Queue    = management review, approve / reject (THIS screen)
 *   Legal Pack Preparation  = assembly after approval
 *   Legal Queue             = handover approval + submission
 *
 * Nothing here writes. Rows, KPIs, tab counts, the "requires attention" set and
 * facets are resolved server-side by `ce_legal_recommendation_register_v1`,
 * which re-checks the actor's capability and reports whether the actor may
 * decide (`compliance.legal.recommend_approve`) and whether each row was raised
 * by the actor themselves (maker–checker).
 *
 * Decisions go exclusively through the governed RPCs in
 * `services/compliance/legalReferralGovernance` — approval mints the referral,
 * so the screen never creates one separately.
 */

const sb = supabase as any;

export const RECOMMENDATION_PAGE_SIZES = [25, 50, 100, 200] as const;

export const RECOMMENDATION_TABS = [
  { value: 'ALL', label: 'All' },
  { value: 'PENDING', label: 'Pending review' },
  { value: 'OVERDUE', label: 'Review overdue' },
  { value: 'HIGH_RISK', label: 'High / critical risk' },
  { value: 'HIGH_VALUE', label: 'High exposure' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REFERRED', label: 'Referral created' },
  { value: 'REJECTED', label: 'Rejected' },
] as const;

export const RECOMMENDATION_SORTS = [
  { value: 'priority', label: 'Review priority' },
  { value: 'waiting', label: 'Waiting time' },
  { value: 'recommended', label: 'Recommended date' },
  { value: 'risk', label: 'Risk' },
  { value: 'amount', label: 'Exposure' },
  { value: 'cases', label: 'Qualifying cases' },
  { value: 'employer', label: 'Employer' },
  { value: 'zone', label: 'Zone' },
  { value: 'status', label: 'Status' },
] as const;

export const RECOMMENDATION_AMOUNT_BANDS: Array<{ value: string; label: string; min?: number; max?: number }> = [
  { value: '0-5k', label: 'Under 5,000', max: 5000 },
  { value: '5k-25k', label: '5,000 – 25,000', min: 5000, max: 25000 },
  { value: '25k-50k', label: '25,001 – 50,000', min: 25000, max: 50000 },
  { value: '50k+', label: '50,000 and above', min: 50000 },
  { value: 'CUSTOM', label: 'Custom range…' },
];

export const RECOMMENDATION_DATE_WINDOWS: Array<{ value: string; label: string }> = [
  { value: '7D', label: 'Last 7 days' },
  { value: '30D', label: 'Last 30 days' },
  { value: '90D', label: 'Last 90 days' },
  { value: 'YTD', label: 'This year' },
  { value: 'CUSTOM', label: 'Custom range…' },
];

export interface RecommendationFilters {
  tab: string;
  search: string;
  status: string;
  risk: string;
  zone: string;
  source: string;
  legal_state: string;
  rule: string;
  amount_band: string;
  amount_min: string;
  amount_max: string;
  date_window: string;
  date_from: string;
  date_to: string;
  sort: string;
  dir: 'asc' | 'desc';
  page: number;
  page_size: number;
}

export const DEFAULT_RECOMMENDATION_FILTERS: RecommendationFilters = {
  tab: 'PENDING',
  search: '',
  status: '',
  risk: '',
  zone: '',
  source: '',
  legal_state: '',
  rule: '',
  amount_band: '',
  amount_min: '',
  amount_max: '',
  date_window: '',
  date_from: '',
  date_to: '',
  sort: 'priority',
  dir: 'desc',
  page: 1,
  page_size: 25,
};

export interface RecommendationRow {
  recommendation_id: string;
  employer_id: string | null;
  employer_name: string | null;
  zone: string | null;
  risk_code: string;
  risk_label: string;
  risk_tone: string | null;
  risk_score: number | null;
  status_code: string;
  status_label: string;
  status_tone: string | null;
  source_code: string;
  source_label: string;
  legal_state_code: string;
  legal_state_label: string;
  legal_state_tone: string | null;
  recommended_by: string | null;
  recommended_at: string | null;
  recommended_date: string | null;
  recommendation_reason: string | null;
  rule_summary: string | null;
  triggered_rules: any[];
  qualifying_case_count: number;
  source_case_id: string | null;
  source_case_number: string | null;
  assigned_officer_name: string | null;
  total_principal: number;
  total_penalties: number;
  total_interest: number;
  grand_total: number;
  referral_id: string | null;
  referral_number: string | null;
  referral_status: string | null;
  lg_intake_no: string | null;
  lg_case_no: string | null;
  court_case_number: string | null;
  reviewed_by: string | null;
  reviewed_date: string | null;
  review_notes: string | null;
  waiting_hours: number;
  is_pending: boolean;
  review_overdue: boolean;
  review_due_soon: boolean;
  high_value: boolean;
  approved_no_referral: boolean;
  pack_stalled: boolean;
  is_own_recommendation: boolean;
}

export interface RecommendationAttentionRow {
  recommendation_id: string;
  employer_name: string | null;
  amount: number | null;
  status_label: string;
  priority: number;
  reason: string;
}

export interface RecommendationRegisterResult {
  rows: RecommendationRow[];
  total: number;
  page: number;
  page_size: number;
  kpis: {
    pending: number;
    overdue: number;
    high_risk_pending: number;
    approved: number;
    rejected: number;
    referred: number;
    employers: number;
    qualifying_cases: number;
    pending_exposure: number;
    total_exposure: number;
    oldest_pending_hours: number;
  };
  tab_counts: Record<string, number>;
  attention: RecommendationAttentionRow[];
  facets: {
    statuses: Array<{ code: string; label: string }>;
    risks: Array<{ code: string; label: string }>;
    sources: Array<{ code: string; label: string }>;
    legal_states: Array<{ code: string; label: string }>;
    zones: string[];
    rules: string[];
  };
  thresholds: { review_sla_days: number; high_value: number; pack_stall_days: number };
  actor: { user_code: string | null; can_decide: boolean; can_generate: boolean };
}

export const ATTENTION_REASON_LABELS: Record<string, string> = {
  REVIEW_OVERDUE: 'Review overdue',
  CRITICAL_PENDING: 'Critical risk awaiting review',
  APPROVED_NO_REFERRAL: 'Approved but no referral exists',
  PACK_STALLED: 'Legal pack not progressed',
  HIGH_VALUE_PENDING: 'High exposure awaiting review',
  NO_SOURCE_CASE: 'No qualifying case linked',
};

const URL_KEYS: Array<keyof RecommendationFilters> = [
  'tab', 'search', 'status', 'risk', 'zone', 'source', 'legal_state', 'rule',
  'amount_band', 'amount_min', 'amount_max', 'date_window', 'date_from', 'date_to',
  'sort', 'dir', 'page', 'page_size',
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
      return { date_from: iso(start), date_to: iso(today) };
    }
    case 'YTD':
      return { date_from: `${today.getFullYear()}-01-01`, date_to: iso(today) };
    case 'CUSTOM':
      return { date_from: from || null, date_to: to || null };
    default:
      return { date_from: null, date_to: null };
  }
}

export function formatWaiting(hours?: number | null): string {
  if (hours === null || hours === undefined) return '—';
  if (hours < 1) return 'Under an hour';
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.floor(hours / 24)} d`;
}

export function useLegalRecommendationRegister() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [filters, setFiltersState] = useState<RecommendationFilters>(() => {
    const next: RecommendationFilters = { ...DEFAULT_RECOMMENDATION_FILTERS };
    URL_KEYS.forEach((key) => {
      const raw = searchParams.get(String(key));
      if (raw === null) return;
      if (key === 'page' || key === 'page_size') (next as any)[key] = Number(raw) || next[key];
      else (next as any)[key] = raw;
    });
    return next;
  });

  const syncUrl = useCallback(
    (value: RecommendationFilters) => {
      const next = new URLSearchParams(searchParams);
      URL_KEYS.forEach((key) => {
        const v = String(value[key] ?? '');
        if (!v || v === String(DEFAULT_RECOMMENDATION_FILTERS[key] ?? '')) next.delete(String(key));
        else next.set(String(key), v);
      });
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setFilters = useCallback(
    (patch: Partial<RecommendationFilters>) => {
      setFiltersState((prev) => {
        const next: RecommendationFilters = {
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
    setFiltersState(DEFAULT_RECOMMENDATION_FILTERS);
    syncUrl(DEFAULT_RECOMMENDATION_FILTERS);
  }, [syncUrl]);

  const rpcFilters = useMemo(() => {
    const band = RECOMMENDATION_AMOUNT_BANDS.find((b) => b.value === filters.amount_band);
    const custom = filters.amount_band === 'CUSTOM';
    const dates = windowToDates(filters.date_window, filters.date_from, filters.date_to);
    return {
      tab: filters.tab,
      search: filters.search || null,
      status: filters.status || null,
      risk: filters.risk || null,
      zone: filters.zone || null,
      source: filters.source || null,
      legal_state: filters.legal_state || null,
      rule: filters.rule || null,
      amount_min: custom ? filters.amount_min || null : band?.min ?? null,
      amount_max: custom ? filters.amount_max || null : band?.max ?? null,
      date_from: dates.date_from,
      date_to: dates.date_to,
    };
  }, [filters]);

  const query = useQuery<RecommendationRegisterResult>({
    queryKey: ['ce-legal-recommendations', rpcFilters, filters.sort, filters.dir, filters.page, filters.page_size],
    queryFn: async () => {
      const { data, error } = await sb.rpc('ce_legal_recommendation_register_v1', {
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
            ? 'You are not authorised to review legal escalation recommendations.'
            : 'Your session has expired. Please sign in again.',
        );
      }
      return data as RecommendationRegisterResult;
    },
    staleTime: 15_000,
  });

  return { filters, setFilters, resetFilters, ...query };
}

export interface RecommendationDetailResult {
  recommendation: any;
  timeline: Array<{ at: string; code: string; label: string; actor?: string | null; note?: string | null }>;
  actor: { user_code: string | null; can_decide: boolean };
}

export function useLegalRecommendationDetail(recommendationId: string | null) {
  return useQuery<RecommendationDetailResult>({
    queryKey: ['ce-legal-recommendation-detail', recommendationId],
    enabled: Boolean(recommendationId),
    queryFn: async () => {
      const { data, error } = await sb.rpc('ce_legal_recommendation_detail_v1', {
        p_recommendation_id: recommendationId,
      });
      if (error) throw error;
      if (data?.error) throw new Error('This recommendation is not available to you.');
      return data as RecommendationDetailResult;
    },
  });
}
