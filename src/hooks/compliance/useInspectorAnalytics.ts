/**
 * Inspector Workboard analytics.
 *
 * All aggregation happens server-side in ce_inspector_workboard_analytics so
 * the client never pulls large violation/action datasets. A failed or
 * unauthorised call is surfaced explicitly as "unavailable" — never as zero.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUserCode } from '@/hooks/useUserCode';

export type InspectorRangeKey = '7d' | '30d' | '90d' | '12m';

export const INSPECTOR_RANGES: { key: InspectorRangeKey; label: string; days: number }[] = [
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: '12m', label: 'Last 12 months', days: 365 },
];

export interface InspectorAnalytics {
  scoped: boolean;
  generated_at: string;
  grain: 'day' | 'week';
  range: { from: string; to: string; prev_from: string; prev_to: string };
  kpis: {
    due_today: number;
    overdue: number;
    due_week: number;
    completed_period: number;
    completed_prev: number;
    open_actions: number;
    assigned_period: number;
    assigned_prev: number;
    became_overdue: number;
    became_overdue_prev: number;
    open_violations: number;
  };
  workload: { b: string; assigned: number; completed: number; overdue: number }[];
  timeliness: {
    completed: number;
    on_time: number;
    completed_with_due: number;
    avg_days: number | null;
    prev_completed: number;
    prev_on_time: number;
    prev_completed_with_due: number;
  };
  outcomes: { b: string; resolved: number; raised: number; repeat_after_resolution: number }[];
  caseload: {
    by_status: { status: string; count: number }[];
    by_priority: { priority: string; count: number }[];
    ageing: { bucket: string; ord: number; count: number }[];
    total: number;
  };
  field: {
    planned: number;
    executed: number;
    missed: number;
    inspections_completed: number;
    followups_generated: number;
    violations_identified: number;
  };
  attention: {
    employer_id: string;
    employer_name: string | null;
    open_violations: number;
    oldest_open: string | null;
    risk_band: string | null;
    risk_score: number | null;
    overdue_actions: number;
  }[];
  repeats: {
    employer_id: string;
    employer_name: string | null;
    total_violations: number;
    open_violations: number;
    resolved_violations: number;
    missed_followups: number;
  }[];
  recent: {
    at: string;
    kind: 'VIOLATION' | 'ACTION';
    label: string | null;
    subject: string | null;
    detail: string | null;
    ref_id: string;
  }[];
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

export function useInspectorAnalytics() {
  const { userCode, userId } = useUserCode();
  const [rangeKey, setRangeKey] = useState<InspectorRangeKey>('30d');

  const identities = useMemo(
    () => [userId, userCode].filter(Boolean) as string[],
    [userId, userCode],
  );

  const days = INSPECTOR_RANGES.find(r => r.key === rangeKey)?.days ?? 30;
  const from = isoDaysAgo(days);
  const to = new Date().toISOString().slice(0, 10);

  const query = useQuery({
    queryKey: ['workboard', 'analytics', identities.join('|'), rangeKey],
    enabled: identities.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<InspectorAnalytics> => {
      const { data, error } = await supabase.rpc('ce_inspector_workboard_analytics' as never, {
        p_identities: identities,
        p_from: from,
        p_to: to,
      } as never);
      if (error) throw error;
      return data as unknown as InspectorAnalytics;
    },
  });

  return {
    ...query,
    data: query.data,
    rangeKey,
    setRangeKey,
    rangeLabel: INSPECTOR_RANGES.find(r => r.key === rangeKey)?.label ?? '',
    from,
    to,
    /** true when the metric set could not be loaded — must not render as zero */
    unavailable: query.isError || (!!query.data && query.data.scoped === false),
  };
}

export function pctDelta(current: number, previous: number): number | null {
  if (!previous) return current ? 100 : null;
  return ((current - previous) / previous) * 100;
}
