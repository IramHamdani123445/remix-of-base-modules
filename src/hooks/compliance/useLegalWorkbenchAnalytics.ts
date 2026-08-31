/**
 * Compliance Legal Workbench analytics.
 *
 * Every figure is aggregated server-side by ce_legal_workbench_analytics so the
 * client never pulls raw legal case / referral datasets. A failed or
 * unauthorised call is surfaced explicitly as "unavailable" — never as zero.
 *
 * Canonical sources (see docs/compliance/legal-workbench-data-map.md):
 *  - Compliance escalation stages : ce_escalation_stage_config
 *  - Recommendation / referral    : ce_legal_recommendations, ce_legal_referrals
 *  - Legal intake / case / stage  : lg_case_intake, lg_case, lg_case_stage_history
 *  - Hearings                     : lg_hearing
 *  - Money                        : lg_recoverable_liability, lg_payment_allocation
 *  - Arrangements                 : ce_payment_arrangements (+ lg_payment_arrangement_link)
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUserCode } from '@/hooks/useUserCode';

export type LegalRangeKey = '30d' | '90d' | '6m' | '12m';

export const LEGAL_RANGES: { key: LegalRangeKey; label: string; days: number }[] = [
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: '6m', label: 'Last 6 months', days: 182 },
  { key: '12m', label: 'Last 12 months', days: 365 },
];

export interface LegalWorkflowStage {
  stage_code: string;
  stage_name: string | null;
  stage_order: number;
  delay_days: number | null;
  requires_approval: boolean | null;
  enabled: boolean;
  retired_at: string | null;
}

export interface LegalAnalytics {
  generated_at: string;
  grain: 'day' | 'week' | 'month';
  scope: { mine: boolean; identities: string[] };
  range: { from: string; to: string; prev_from: string; prev_to: string };
  workflow: LegalWorkflowStage[];
  kpis: {
    pending_recommendations: number;
    pending_referral_approval: number;
    awaiting_legal_acceptance: number;
    pending_legal_intake: number;
    active_cases: number;
    overdue_next_actions: number;
    overdue_tasks: number;
    hearings_30d: number;
    hearings_7d: number;
    hearings_today: number;
    hearings_overdue: number;
    amount_under_legal: number;
    claim_amount_under_legal: number;
    amount_pending_referral: number;
    recovered_period: number;
    recovered_prev: number;
    awaiting_enforcement: number;
    referrals_period: number;
    referrals_prev: number;
    cases_opened_period: number;
    cases_opened_prev: number;
    cases_closed_period: number;
    cases_closed_prev: number;
  };
  trend: { b: string; referrals: number; opened: number; closed: number }[];
  pipeline: {
    ord: number; lane: 'COMPLIANCE' | 'LEGAL'; stage_code: string; stage_name: string;
    count: number; avg_age_days: number; overdue: number;
  }[];
  ageing: {
    buckets: { bucket: string; ord: number; count: number }[];
    avg_days: number | null;
    median_days: number | null;
    oldest: { case_no: string; id: string; employer: string | null; days: number } | null;
  };
  timeliness: {
    referral_to_acceptance_days: number | null; referral_to_acceptance_n: number;
    intake_to_case_days: number | null; intake_to_case_n: number;
    referral_to_filing_days: number | null; referral_to_filing_n: number;
    past_next_action: number; no_next_action: number; stale_60d: number;
    sla_rules_configured: number;
  };
  hearings: {
    forecast: { w: string; count: number }[];
    upcoming: {
      id: string; case_id: string | null; case_no: string | null; employer: string | null;
      court: string | null; date: string; type: string | null; officer: string | null;
      documents_ready: boolean | null; evidence_status: string | null; prep_completed: boolean | null;
    }[];
    past_due: { id: string; case_id: string | null; case_no: string | null; employer: string | null; date: string; court: string | null }[];
    courts: { court: string; count: number }[];
  };
  outcomes: {
    case_outcomes: { outcome: string; count: number }[];
    hearing_outcomes: { outcome: string; count: number }[];
    referral_quality: { accepted: number; returned: number; rejected: number; in_flight: number };
    return_reasons: { reason: string; count: number }[];
  };
  recovery: {
    assessed: number; paid: number; outstanding: number;
    allocations_period: number; dated_allocations: number;
    series: { b: string; recovered: number; new_exposure: number }[];
  };
  arrangements: {
    health: { bucket: string; count: number }[];
    active: number; defaulted: number; outstanding: number; linked_via_registry: number;
    items: { id: string; number: string; employer: string | null; status: string; debt: number; paid: number; missed: number | null; next_due: string | null }[];
  };
  priority_matters: {
    case_id: string; case_no: string; employer: string | null; employer_id: string | null;
    priority: string | null; stage: string | null; outstanding: number; age_days: number;
    next_action: string | null; next_action_due: string | null; overdue: boolean; officer: string | null;
  }[];
  repeats: {
    employer_id: string; employer: string | null; referrals: number; accepted: number;
    returned: number; first_at: string; last_at: string;
  }[];
  attention: {
    kind: string; ref: string | null; ref_id: string; employer: string | null; action: string;
    priority: string; due: string | null; age_days: number | null; assigned: string | null; link: string;
  }[];
  officers: {
    officer: string; active: number; overdue: number; hearings_30d: number;
    closed_period: number; outstanding: number;
  }[];
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

/** Percentage delta vs previous comparable period; null when no reliable base. */
export function pctDelta(current: number | undefined, prev: number | undefined): number | null {
  if (current == null || prev == null) return null;
  if (prev === 0) return null;
  return Math.round(((current - prev) / prev) * 100);
}

export interface UseLegalAnalyticsOptions {
  /** true = restrict every metric to cases assigned to the signed-in officer */
  scopeMine: boolean;
}

export function useLegalWorkbenchAnalytics({ scopeMine }: UseLegalAnalyticsOptions) {
  const { userCode, userId, isLoading: idLoading } = useUserCode();
  const [rangeKey, setRangeKey] = useState<LegalRangeKey>('90d');

  const identities = useMemo(
    () => [userId, userCode].filter(Boolean) as string[],
    [userId, userCode],
  );

  const days = LEGAL_RANGES.find(r => r.key === rangeKey)?.days ?? 90;
  const from = isoDaysAgo(days);
  const to = new Date().toISOString().slice(0, 10);

  const query = useQuery({
    queryKey: ['compliance', 'legal-workbench', 'analytics', rangeKey, scopeMine, identities.join('|')],
    enabled: !idLoading,
    staleTime: 60_000,
    retry: 1,
    queryFn: async (): Promise<LegalAnalytics> => {
      const { data, error } = await supabase.rpc('ce_legal_workbench_analytics' as never, {
        p_from: from,
        p_to: to,
        p_identities: identities,
        p_scope_mine: scopeMine,
      } as never);
      if (error) throw error;
      if (!data) throw new Error('No analytics payload returned');
      return data as unknown as LegalAnalytics;
    },
  });

  return {
    ...query,
    rangeKey,
    setRangeKey,
    range: { from, to },
    /** true when the metric set could not be produced — render "Unavailable", not 0 */
    unavailable: query.isError,
  };
}

/** Query key prefix so legal actions elsewhere can invalidate this analytics set. */
export const LEGAL_ANALYTICS_QUERY_KEY = ['compliance', 'legal-workbench', 'analytics'];
