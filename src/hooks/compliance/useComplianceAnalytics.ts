/**
 * Compliance Intelligence & Trend Analysis workspace analytics.
 *
 * Every figure is aggregated server-side by ce_compliance_analytics_v1 so the
 * browser never pulls the raw violation / filing / ledger datasets. A failed
 * call is surfaced as "unavailable" — never silently rendered as zero.
 *
 * Canonical sources: ce_violations + ce_violation_types, cn_c3_reported /
 * cn_c3_missing, cn_payment, ce_v_employer_arrears_summary +
 * ce_v_ledger_period_balances, ce_risk_profiles + ce_risk_score_history,
 * ce_inspections, ce_payment_arrangements, ce_legal_referrals, er_master.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type AnalyticsRangeKey = '90d' | '6m' | '12m' | '24m';

export const ANALYTICS_RANGES: { key: AnalyticsRangeKey; label: string; days: number }[] = [
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: '6m', label: 'Last 6 months', days: 182 },
  { key: '12m', label: 'Last 12 months', days: 365 },
  { key: '24m', label: 'Last 24 months', days: 730 },
];

export interface AnalyticsFilters {
  zone: string | null;
  riskBand: string | null;
  violationType: string | null;
  sector: string | null;
  sizeTier: string | null;
}

export const EMPTY_FILTERS: AnalyticsFilters = {
  zone: null, riskBand: null, violationType: null, sector: null, sizeTier: null,
};

export type SectionAvailability = 'ok' | 'no_data' | 'insufficient_history' | 'unavailable';

export interface SegmentRow {
  segment: string; employers: number; violations: number; resolved: number;
  amount: number; rate: number | null;
}

export interface ComplianceAnalyticsPayload {
  generated_at: string;
  range: { from: string; to: string; prev_from: string; prev_to: string; days: number };
  filters: Record<string, string | null>;
  kpis: {
    violations_new: number; violations_new_prev: number;
    violations_resolved: number; violations_resolved_prev: number;
    violations_open: number; violations_overdue: number;
    exposure_amount: number; exposure_amount_prev: number;
    avg_resolution_days: number | null; avg_resolution_days_prev: number | null;
    resolution_rate: number | null; resolution_rate_prev: number | null;
    resolution_numerator: number; resolution_denominator: number;
    employers_in_scope: number; employers_with_violations: number;
    employers_in_arrears: number; total_outstanding: number;
    high_risk_employers: number; risk_profiles: number; avg_risk_score: number | null;
  };
  violation_flow: { b: string; opened: number; resolved: number; amount: number }[];
  violation_type_trend: { type_code: string; type_name: string; current: number; previous: number; amount: number }[];
  resolution_time: {
    avg_days: number | null; prev_avg_days: number | null;
    buckets: { bucket: string; ord: number; count: number }[];
    status_mix: { status: string; count: number }[];
  };
  c3_behaviour: { b: string; submitted: number; posted: number; pending: number; nil: number }[];
  c3_missing: { period: string; count: number; estimated: number }[];
  payment_behaviour: { b: string; payments: number; amount: number }[];
  arrears_trend: { period: string; outstanding: number; principal: number; penalty: number; interest: number }[];
  arrears_top: { employer_id: string; employer: string | null; outstanding: number }[];
  risk_bands: { band: string; count: number }[];
  risk_migration: { from_band: string; to_band: string; count: number; direction: string }[];
  risk_drivers: {
    arrears: number | null; violation: number | null; filing: number | null;
    legal_history: number | null; payment_behavior: number | null; n: number;
  };
  inspections: { total: number; completed: number; with_findings: number; series: { b: string; count: number }[] };
  arrangements: { total: number; active: number; breached: number; completed: number; debt: number; paid: number };
  legal_trend: { b: string; referrals: number; amount: number }[];
  zone_comparison: SegmentRow[];
  sector_comparison: SegmentRow[];
  size_comparison: SegmentRow[];
  persistent_employers: {
    employer_id: string; employer: string | null; violations: number; open: number;
    amount: number; zone: string | null;
  }[];
  improving_employers: {
    employer_id: string; employer: string | null; current: number; previous: number; change: number;
  }[];
  options: {
    zones: { code: string; name: string }[];
    violation_types: { code: string; name: string }[];
    sectors: string[];
    size_tiers: string[];
    risk_bands: string[];
  };
  availability: Record<string, SectionAvailability>;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

/** Percentage delta vs the previous comparable window; null when no reliable base. */
export function pctDelta(current: number | null | undefined, prev: number | null | undefined): number | null {
  if (current == null || prev == null) return null;
  if (prev === 0) return null;
  return Math.round(((current - prev) / prev) * 100);
}

/** Percentage-point delta for rate metrics. */
export function ppDelta(current: number | null | undefined, prev: number | null | undefined): number | null {
  if (current == null || prev == null) return null;
  return Math.round((current - prev) * 10) / 10;
}

export function useComplianceAnalytics() {
  const [rangeKey, setRangeKey] = useState<AnalyticsRangeKey>('12m');
  const [filters, setFilters] = useState<AnalyticsFilters>(EMPTY_FILTERS);

  const days = ANALYTICS_RANGES.find(r => r.key === rangeKey)?.days ?? 365;
  const from = isoDaysAgo(days);
  const to = new Date().toISOString().slice(0, 10);

  const filterKey = useMemo(
    () => [filters.zone, filters.riskBand, filters.violationType, filters.sector, filters.sizeTier].join('|'),
    [filters],
  );

  const query = useQuery({
    queryKey: ['compliance', 'analytics-workspace', rangeKey, filterKey],
    staleTime: 120_000,
    retry: 1,
    queryFn: async (): Promise<ComplianceAnalyticsPayload> => {
      const { data, error } = await supabase.rpc('ce_compliance_analytics_v1' as never, {
        p_from: from,
        p_to: to,
        p_zone: filters.zone,
        p_risk_band: filters.riskBand,
        p_violation_type: filters.violationType,
        p_sector: filters.sector,
        p_size_tier: filters.sizeTier,
      } as never);
      if (error) throw error;
      if (!data) throw new Error('No analytics payload returned');
      return data as unknown as ComplianceAnalyticsPayload;
    },
  });

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return {
    ...query,
    rangeKey,
    setRangeKey,
    filters,
    setFilters,
    clearFilters: () => setFilters(EMPTY_FILTERS),
    activeFilterCount,
    range: { from, to },
    /** true when the metric set could not be produced — render "Unavailable", not 0 */
    unavailable: query.isError,
    /** section-level availability from the server payload */
    availability: (query.data?.availability ?? {}) as Record<string, SectionAvailability>,
  };
}

export const COMPLIANCE_ANALYTICS_QUERY_KEY = ['compliance', 'analytics-workspace'];
