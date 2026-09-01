import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { recommendLegal, type LegalEntryPath } from '@/services/compliance/legalReferralGovernance';

/**
 * Enterprise reader for Compliance → Legal Referral Launcher
 * (`/compliance/legal-referral/launcher`).
 *
 * PURPOSE
 * -------
 * The Launcher is the *controlled entry point* into the legal escalation
 * pipeline. It is a Legal-eligibility register — not another workflow.
 *
 *   Compliance Case → Recommend Legal → Recommendation approval
 *                   → Legal Pack Preparation → Referral approval
 *                   → Submit to Legal
 *
 * Quick Forward is an expedited *recommendation*, gated by the
 * `compliance.legal.quick_forward` feature flag plus the
 * `compliance.legal.override` capability. It never mints a referral
 * directly — `zz_ce_legal_referral_governance` blocks that.
 *
 * Eligibility is evaluated once, server-side, by
 * `ce_legal_candidate_evaluate` (shared by the register and the preview), so
 * the Launcher, Case Detail and the Recommendation Queue can never disagree.
 */

const sb = supabase as any;

export const CANDIDATE_PAGE_SIZES = [25, 50, 100, 200] as const;

export const CANDIDATE_TABS = [
  { value: 'ELIGIBLE', label: 'Eligible now' },
  { value: 'REC_REQ', label: 'Recommendation required' },
  { value: 'AWAITING', label: 'Awaiting approval' },
  { value: 'READY_PACK', label: 'Ready for pack' },
  { value: 'REFERRED', label: 'Already referred' },
  { value: 'RETURNED', label: 'Returned' },
  { value: 'HIGH_VALUE', label: 'High exposure' },
  { value: 'MINE', label: 'My cases' },
  { value: 'NOT_ELIGIBLE', label: 'Not eligible' },
  { value: 'ALL', label: 'All cases' },
] as const;

export const CANDIDATE_SCOPES = [
  { value: 'ALL', label: 'All eligible cases' },
  { value: 'TEAM', label: 'My team' },
  { value: 'MINE', label: 'My cases' },
] as const;

export const CANDIDATE_AMOUNT_BANDS: Array<{ value: string; label: string; min?: number; max?: number }> = [
  { value: '0-1k', label: 'Under 1,000', max: 1000 },
  { value: '1k-5k', label: '1,000 – 5,000', min: 1000, max: 5000 },
  { value: '5k-50k', label: '5,001 – 50,000', min: 5000, max: 50000 },
  { value: '50k+', label: '50,000 and above', min: 50000 },
  { value: 'CUSTOM', label: 'Custom range…' },
];

export const CANDIDATE_ACTION_WINDOWS: Array<{ value: string; label: string; days?: number }> = [
  { value: '7D', label: 'Last action within 7 days', days: 7 },
  { value: '30D', label: 'Last action within 30 days', days: 30 },
  { value: '90D', label: 'Last action within 90 days', days: 90 },
  { value: 'CUSTOM', label: 'Custom range…' },
];

export const ARRANGEMENT_OPTIONS = [
  { value: 'DEFAULT', label: 'In default / breached' },
  { value: 'ACTIVE', label: 'Active arrangement' },
  { value: 'NONE', label: 'No arrangement' },
];

export const ENFORCEMENT_OPTIONS = [
  { value: 'FINAL_NOTICE', label: 'Final notice served' },
  { value: 'NOTICED', label: 'Notice issued' },
  { value: 'NONE', label: 'No notice issued' },
];

export interface CandidateLabel {
  code: string | null;
  label: string;
  tone: string | null;
  description: string | null;
  detail?: string | null;
}

export interface LegalCandidateRow {
  case_id: string;
  case_number: string | null;
  employer_reg_no: string | null;
  employer_name: string | null;
  zone: string | null;
  case_status: CandidateLabel;
  case_stage: CandidateLabel;
  eligibility: CandidateLabel;
  referral_state: CandidateLabel;
  action: CandidateLabel;
  blocks: CandidateLabel[];
  reasons: CandidateLabel[];
  rule_code: string | null;
  rule_name: string | null;
  outstanding_amount: number;
  total_principal: number;
  total_penalties: number;
  total_interest: number;
  amount_collected: number;
  open_violations: number;
  total_violations: number;
  principal_violation_id: string | null;
  principal_violation_number: string | null;
  notices_sent: number;
  last_notice_at: string | null;
  last_notice_type: string | null;
  final_notice_at: string | null;
  days_since_final_notice: number | null;
  arrangement_id: string | null;
  arrangement_number: string | null;
  arrangement_status: string | null;
  arrangement_breach: boolean;
  arrangement_active: boolean;
  assigned_officer_name: string | null;
  is_mine: boolean;
  case_age_days: number;
  last_action_at: string | null;
  recommendation_id: string | null;
  recommendation_status: string | null;
  recommended_at: string | null;
  referral_id: string | null;
  referral_number: string | null;
  referral_status: string | null;
  lg_intake_no: string | null;
  lg_case_no: string | null;
  court_case_number: string | null;
  open_returns: number;
  return_count: number;
  high_value: boolean;
  readiness_score: number;
  can_initiate: boolean;
  attention_reason: string | null;
}

export interface LegalCandidateRegisterResult {
  error?: string;
  rows: LegalCandidateRow[];
  total: number;
  page: number;
  page_size: number;
  kpis: {
    eligible: number;
    recommendation_required: number;
    awaiting_approval: number;
    ready_for_pack: number;
    with_legal: number;
    returned: number;
    not_eligible: number;
    eligible_exposure: number;
    total_exposure: number;
    employers: number;
  };
  tab_counts: Record<string, number>;
  attention: Array<{
    case_id: string;
    case_number: string | null;
    employer_name: string | null;
    amount: number | null;
    reason: string;
    eligibility_label: string;
    action_code: string;
  }>;
  facets: {
    case_statuses: Array<{ code: string; label: string }>;
    case_stages: Array<{ code: string; label: string }>;
    eligibilities: Array<{ code: string; label: string }>;
    referral_states: Array<{ code: string; label: string }>;
    zones: string[];
    officers: string[];
    case_types: string[];
    employers: Array<{ code: string; label: string }>;
  };
  thresholds: { high_value: number; stall_days: number };
  actor: {
    user_code: string | null;
    can_view_all: boolean;
    can_recommend: boolean;
    can_approve: boolean;
    can_quick_forward: boolean;
    scope: string;
  };
}

export interface CandidateFilters {
  tab: string;
  scope: string;
  search: string;
  employer: string;
  case_status: string;
  case_stage: string;
  eligibility: string;
  referral_state: string;
  violation_type: string;
  enforcement: string;
  arrangement: string;
  zone: string;
  officer: string;
  amount_band: string;
  amount_min: string;
  amount_max: string;
  action_window: string;
  action_from: string;
  action_to: string;
  sort: string;
  dir: 'asc' | 'desc';
  page: number;
  page_size: number;
}

export const DEFAULT_CANDIDATE_FILTERS: CandidateFilters = {
  tab: 'ELIGIBLE',
  scope: 'ALL',
  search: '',
  employer: '',
  case_status: '',
  case_stage: '',
  eligibility: '',
  referral_state: '',
  violation_type: '',
  enforcement: '',
  arrangement: '',
  zone: '',
  officer: '',
  amount_band: '',
  amount_min: '',
  amount_max: '',
  action_window: '',
  action_from: '',
  action_to: '',
  sort: 'readiness',
  dir: 'desc',
  page: 1,
  page_size: 25,
};

const URL_KEYS: Array<keyof CandidateFilters> = [
  'tab', 'scope', 'search', 'employer', 'case_status', 'case_stage', 'eligibility',
  'referral_state', 'violation_type', 'enforcement', 'arrangement', 'zone', 'officer',
  'amount_band', 'amount_min', 'amount_max', 'action_window', 'action_from', 'action_to',
  'sort', 'dir', 'page', 'page_size',
];

function windowToDates(win: string, from: string, to: string) {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (win === 'CUSTOM') return { action_from: from || null, action_to: to || null };
  const days = Number(String(win).replace('D', ''));
  if (!days) return { action_from: null, action_to: null };
  const start = new Date(today);
  start.setDate(start.getDate() - days);
  return { action_from: iso(start), action_to: iso(today) };
}

export function useLegalReferralCandidateRegister() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [filters, setFiltersState] = useState<CandidateFilters>(() => {
    const next: CandidateFilters = { ...DEFAULT_CANDIDATE_FILTERS };
    URL_KEYS.forEach((key) => {
      const raw = searchParams.get(String(key));
      if (raw === null) return;
      if (key === 'page' || key === 'page_size') (next as any)[key] = Number(raw) || next[key];
      else (next as any)[key] = raw;
    });
    return next;
  });

  const syncUrl = useCallback(
    (value: CandidateFilters) => {
      const next = new URLSearchParams(searchParams);
      URL_KEYS.forEach((key) => {
        const v = String(value[key] ?? '');
        if (!v || v === String(DEFAULT_CANDIDATE_FILTERS[key] ?? '')) next.delete(String(key));
        else next.set(String(key), v);
      });
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setFilters = useCallback(
    (patch: Partial<CandidateFilters>) => {
      setFiltersState((prev) => {
        const next: CandidateFilters = {
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
    setFiltersState(DEFAULT_CANDIDATE_FILTERS);
    syncUrl(DEFAULT_CANDIDATE_FILTERS);
  }, [syncUrl]);

  const rpcFilters = useMemo(() => {
    const band = CANDIDATE_AMOUNT_BANDS.find((b) => b.value === filters.amount_band);
    const custom = filters.amount_band === 'CUSTOM';
    const dates = windowToDates(filters.action_window, filters.action_from, filters.action_to);
    return {
      tab: filters.tab,
      scope: filters.scope,
      search: filters.search || null,
      employer: filters.employer || null,
      case_status: filters.case_status || null,
      case_stage: filters.case_stage || null,
      eligibility: filters.eligibility || null,
      referral_state: filters.referral_state || null,
      violation_type: filters.violation_type || null,
      enforcement: filters.enforcement || null,
      arrangement: filters.arrangement || null,
      zone: filters.zone || null,
      officer: filters.officer || null,
      amount_min: custom ? filters.amount_min || null : band?.min ?? null,
      amount_max: custom ? filters.amount_max || null : band?.max ?? null,
      action_from: dates.action_from,
      action_to: dates.action_to,
    };
  }, [filters]);

  const query = useQuery<LegalCandidateRegisterResult>({
    queryKey: ['ce-legal-candidates', rpcFilters, filters.sort, filters.dir, filters.page, filters.page_size],
    queryFn: async () => {
      const { data, error } = await sb.rpc('ce_legal_candidate_register_v1', {
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
            ? 'You are not authorised to view legal referral candidates.'
            : 'Your session has expired. Please sign in again.',
        );
      }
      return data as LegalCandidateRegisterResult;
    },
    staleTime: 15_000,
  });

  const selectedCaseId = searchParams.get('case');
  const setSelectedCaseId = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (id) next.set('case', id);
      else next.delete('case');
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
          !['tab', 'sort', 'dir', 'page', 'page_size'].includes(String(k)) &&
          String(filters[k] ?? '') !== String(DEFAULT_CANDIDATE_FILTERS[k] ?? ''),
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
    selectedCaseId,
    setSelectedCaseId,
  };
}

export interface LegalCandidatePreview {
  error?: string;
  case: Record<string, any>;
  exposure: {
    principal: number; penalty: number; interest: number;
    collected: number; waived: number; total: number;
  };
  rule: Record<string, any>;
  eligibility: CandidateLabel;
  referral_state: CandidateLabel;
  action: CandidateLabel;
  blocks: CandidateLabel[];
  reasons: CandidateLabel[];
  existing: Record<string, any>;
  route: {
    action_code: string;
    can_initiate: boolean;
    has_active_referral: boolean;
    requires_recommendation: boolean;
    maker_checker: boolean;
    self_approval_blocked: boolean;
  };
  escalation_reason_code: string;
  referral_source: string;
  capabilities: { can_recommend: boolean; can_approve: boolean; can_quick_forward: boolean };
  evaluated_at: string;
}

/** Server-side revalidation — the list may be minutes stale. */
export function useLegalCandidatePreview(caseId: string | null, audit = true) {
  return useQuery<LegalCandidatePreview>({
    queryKey: ['ce-legal-candidate-preview', caseId],
    enabled: !!caseId,
    queryFn: async () => {
      const { data, error } = await sb.rpc('ce_legal_candidate_preview_v1', {
        p_case_id: caseId,
        p_audit: audit,
      });
      if (error) throw error;
      if (data?.error) {
        throw new Error(
          data.error === 'CASE_NOT_FOUND'
            ? 'This compliance case is no longer available.'
            : 'You are not authorised to evaluate this case for legal escalation.',
        );
      }
      return data as LegalCandidatePreview;
    },
    staleTime: 0,
    gcTime: 0,
  });
}

/**
 * Initiates the *recommendation* — never a referral. Approval remains with
 * management (maker-checker is enforced by `ce_approve_legal_referral_v1`).
 */
export function useInitiateLegalEscalation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      employerId: string;
      caseId: string;
      reason: string;
      violationId?: string | null;
      entryPath?: LegalEntryPath;
      earlyRuleCode?: string | null;
    }) =>
      recommendLegal({
        employerId: input.employerId,
        caseId: input.caseId,
        reason: input.reason,
        violationId: input.violationId ?? null,
        entryPath: input.entryPath ?? 'RECOMMEND_LEGAL',
        earlyRuleCode: input.earlyRuleCode ?? null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ce-legal-candidates'] });
      qc.invalidateQueries({ queryKey: ['ce-legal-candidate-preview'] });
      toast.success('Legal recommendation raised', {
        description: 'It now awaits management approval before a referral can be created.',
      });
    },
    onError: (e: any) => {
      toast.error('Unable to raise the legal recommendation', { description: e?.message });
    },
  });
}
