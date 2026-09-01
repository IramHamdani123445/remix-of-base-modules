/**
 * Compliance → Reports → Trend Analysis.
 *
 * Every series is aggregated server-side by ce_trend_analytics_v1 over a
 * continuous period spine, so the browser never pulls raw case / violation /
 * ledger history. Sections report their own availability: a period with no
 * underlying history returns null (rendered as a gap), never a false zero.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type TrendGrain = 'month' | 'quarter' | 'year';
export type TrendCompare = 'none' | 'previous_period' | 'previous_year';
export type TrendPeriodKey = '12m' | '24m' | '36m' | '60m';
export type SectionAvailability = 'ok' | 'no_data' | 'insufficient_history' | 'unavailable';

export const TREND_PERIODS: { key: TrendPeriodKey; label: string; months: number }[] = [
  { key: '12m', label: 'Last 12 months', months: 12 },
  { key: '24m', label: 'Last 2 years', months: 24 },
  { key: '36m', label: 'Last 3 years', months: 36 },
  { key: '60m', label: 'Last 5 years', months: 60 },
];

export const TREND_GRAINS: { key: TrendGrain; label: string }[] = [
  { key: 'month', label: 'Monthly' },
  { key: 'quarter', label: 'Quarterly' },
  { key: 'year', label: 'Yearly' },
];

export const TREND_COMPARISONS: { key: TrendCompare; label: string }[] = [
  { key: 'none', label: 'No comparison' },
  { key: 'previous_period', label: 'Previous period' },
  { key: 'previous_year', label: 'Previous year' },
];

export interface TrendFilters {
  period: TrendPeriodKey;
  grain: TrendGrain;
  compare: TrendCompare;
  zone: string | null;
  caseType: string | null;
  violationType: string | null;
}

export const DEFAULT_TREND_FILTERS: TrendFilters = {
  period: '12m',
  grain: 'month',
  compare: 'none',
  zone: null,
  caseType: null,
  violationType: null,
};

interface Section<T> {
  status: SectionAvailability;
  history_from?: string | null;
  reason?: string | null;
  zone_filtered?: boolean;
  points: T[];
}

export interface CasePoint {
  period_start: string;
  created: number; closed: number; backlog: number;
  ratio: number | null; median_days: number | null; avg_days: number | null;
  prev_created: number | null; prev_closed: number | null; prev_backlog: number | null;
}
export interface ViolationPoint {
  period_start: string; opened: number; resolved: number; amount: number;
  prev_opened: number | null; prev_resolved: number | null;
}
export interface ViolationTypePoint {
  period_start: string; type_code: string; type_name: string; count: number;
}
export interface C3Point {
  period_start: string; reported: number; posted: number; missing: number;
  expected: number; filing_rate: number | null; posted_rate: number | null;
}
export interface ExposurePoint {
  period_start: string; outstanding: number | null; prev_outstanding: number | null;
}
export interface RecoveryPoint {
  period_start: string; amount: number | null; payments: number | null; prev_amount: number | null;
}
export interface EnforcementPoint {
  period_start: string; warning_notices: number; demand_notices: number; other_notices: number;
  arrangements: number; breaches: number; referrals: number;
}
export interface RiskPoint { period_start: string; band: string; count: number }
export interface CaseTypePoint {
  period_start: string; label: string; volume: number; resolved: number; median_days: number | null;
}

export interface TrendAnalyticsPayload {
  generated_at: string;
  range: { from: string; to: string; grain: TrendGrain; periods: number; compare: TrendCompare };
  filters: Record<string, unknown>;
  cases: Section<CasePoint>;
  violations: Section<ViolationPoint>;
  violation_types: Section<ViolationTypePoint>;
  c3: Section<C3Point>;
  exposure: Section<ExposurePoint>;
  recovery: Section<RecoveryPoint>;
  enforcement: Section<EnforcementPoint>;
  risk: Section<RiskPoint>;
  case_types: Section<CaseTypePoint>;
}

function rangeFor(period: TrendPeriodKey) {
  const months = TREND_PERIODS.find(p => p.key === period)?.months ?? 12;
  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth() - (months - 1), 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

export function useTrendFilters() {
  const [filters, setFilters] = useState<TrendFilters>(DEFAULT_TREND_FILTERS);
  const update = <K extends keyof TrendFilters>(key: K, value: TrendFilters[K]) =>
    setFilters(prev => ({ ...prev, [key]: value }));
  const reset = () => setFilters(DEFAULT_TREND_FILTERS);
  return { filters, update, reset, setFilters };
}

export function useTrendAnalytics(filters: TrendFilters) {
  const range = useMemo(() => rangeFor(filters.period), [filters.period]);

  return useQuery<TrendAnalyticsPayload>({
    queryKey: ['ce-trend-analytics', range.from, range.to, filters.grain, filters.compare,
      filters.zone, filters.caseType, filters.violationType],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('ce_trend_analytics_v1', {
        p_from: range.from,
        p_to: range.to,
        p_grain: filters.grain,
        p_compare: filters.compare,
        p_zone: filters.zone ? [filters.zone] : null,
        p_case_type: filters.caseType ? [filters.caseType] : null,
        p_violation_type: filters.violationType ? [filters.violationType] : null,
      } as never);
      if (error) throw error;
      return data as unknown as TrendAnalyticsPayload;
    },
    staleTime: 2 * 60 * 1000,
  });
}

/** Distinct business case-type labels, for the Case Type filter. */
export function useTrendCaseTypes() {
  return useQuery<string[]>({
    queryKey: ['ce-trend-case-types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ce_cases')
        .select('case_type')
        .eq('is_deleted', false)
        .limit(5000);
      if (error) throw error;
      const labels = new Set<string>();
      (data ?? []).forEach((r: { case_type: string | null }) => {
        const raw = (r.case_type ?? '').trim();
        if (!raw) return;
        labels.add(
          raw.replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase()
            .replace(/\b\w/g, c => c.toUpperCase())
        );
      });
      return Array.from(labels).sort();
    },
    staleTime: 10 * 60 * 1000,
  });
}

export function useTrendViolationTypes() {
  return useQuery<{ code: string; name: string }[]>({
    queryKey: ['ce-trend-violation-types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ce_violation_types')
        .select('code, name')
        .order('name');
      if (error) throw error;
      return (data ?? []) as { code: string; name: string }[];
    },
    staleTime: 10 * 60 * 1000,
  });
}

/** Formats a period start into a business axis label for the selected grain. */
export function formatPeriodLabel(iso: string, grain: TrendGrain): string {
  const d = new Date(`${iso}T00:00:00`);
  if (grain === 'year') return String(d.getFullYear());
  if (grain === 'quarter') return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}
