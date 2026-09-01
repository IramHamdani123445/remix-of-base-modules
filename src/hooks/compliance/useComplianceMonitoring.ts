/**
 * Compliance Operational Monitoring (/compliance/workbench/monitoring).
 *
 * Near-real-time operational surveillance: every signal is aggregated
 * server-side by ce_monitoring_v1, which also enforces the Compliance RBAC
 * scope (enterprise / team / own) and reports per-subsystem state. A failed
 * section is returned as "unavailable" and must never be rendered as zero.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type MonitoringWindow = '24h' | '7d' | '30d';

export const MONITORING_WINDOWS: { key: MonitoringWindow; label: string }[] = [
  { key: '24h', label: 'Last 24 hours' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
];

export const AUTO_REFRESH_OPTIONS: { key: string; label: string; ms: number | false }[] = [
  { key: 'off', label: 'Auto refresh: Off', ms: false },
  { key: '1m', label: 'Every 1 minute', ms: 60_000 },
  { key: '5m', label: 'Every 5 minutes', ms: 300_000 },
  { key: '15m', label: 'Every 15 minutes', ms: 900_000 },
];

export type SubsystemState =
  | 'ok' | 'degraded' | 'failed' | 'disabled' | 'stale'
  | 'no_data' | 'unavailable' | 'restricted';

export type Severity = 'Critical' | 'High' | 'Medium' | 'Informational';

export interface MonitoringException {
  severity: Severity;
  area: string;
  alert_type: string;
  alert: string;
  employer_id: string | null;
  employer_name: string | null;
  record_ref: string | null;
  record_id: string | null;
  zone: string | null;
  owner_id: string | null;
  owner_name: string | null;
  status: string | null;
  detected_at: string | null;
  age_hours: number | null;
  action: string | null;
  route: string | null;
}

export interface MonitoringPayload {
  generated_at: string;
  window: MonitoringWindow;
  scope: 'enterprise' | 'team' | 'own';
  technical_access: boolean;
  thresholds: {
    stall_days: Record<string, number>;
    detection_grace_hours: number;
    legal_handoff_days: number;
    unassigned_critical_hours: number;
    horizon_from: string;
    horizon_to: string;
    source: string;
  };
  health: {
    state: 'Healthy' | 'Attention Required' | 'Degraded' | 'Critical' | 'Unknown';
    reasons: { subsystem: string; state: string }[];
    policy: string;
  };
  subsystems: Record<string, SubsystemState>;
  kpis: {
    critical_alerts: number;
    sla_breaches: number | null;
    due_24h: number | null;
    stalled_items: number;
    failed_jobs: number | null;
    failed_notices: number | null;
    arrangement_breaches_window: number | null;
    unassigned_critical: number;
    total_exceptions: number;
  };
  exceptions: MonitoringException[];
  exceptions_truncated: boolean;
  sla_summary: {
    status: SubsystemState;
    breached: number; due_24h: number; due_1_3: number; due_4_7: number; healthy: number;
    by_area: { area: string; breached: number; due_soon: number }[];
  } | null;
  sla_urgent: {
    area: string; record_ref: string | null; employer_name: string | null;
    stage: string | null; owner_name: string | null; due_date: string;
    days_overdue: number; route: string; deadline_source: string;
  }[];
  sla_trend: { d: string; new_breaches: number; cleared: number }[];
  detection: {
    status: SubsystemState;
    job_code: string | null; enabled: boolean | null; schedule_cron: string | null;
    expected_interval_hours: number | null;
    last_run_at: string | null; last_run_status: string | null; last_success_at: string | null;
    duration_ms: number | null; records_evaluated: number | null;
    violations_detected: number | null; errors: number | null;
    manual_runs_window: number | null;
    event_queue: {
      status: SubsystemState; pending: number; processed_window: number;
      failed_window: number; oldest_pending_at: string | null;
    } | null;
    active_rules: number | null; total_rules: number | null;
  } | null;
  detection_results: { d: string; category: string; count: number }[] | null;
  stalled_by_area: { area: string; count: number }[];
  stalled_oldest: {
    record_ref: string | null; employer_name: string | null; area: string;
    stage: string | null; owner_name: string | null; route: string | null;
    days_in_stage: number; severity: Severity;
  }[];
  arrangements: {
    status: SubsystemState; due_today: number; overdue: number;
    new_breaches_window: number; unresolved_breaches: number;
    health: { state: string; count: number }[]; approaching_default: number;
  } | null;
  financial_exceptions: {
    status: SubsystemState;
    new_outstanding_obligations: number; obligations_past_grace: number;
    open_reconciliation_exceptions: number; new_reconciliation_exceptions: number;
    pending_partial_payment_requests: number;
    top_new_exceptions: { employer_name: string | null; type: string; variance: number; created_at: string }[];
  } | null;
  communications: {
    status: SubsystemState; awaiting_approval: number; queued: number; sent: number;
    delivered: number; failed: number; confirmation_pending: number;
    failed_attempts_window: number; responses_awaiting: number;
  } | null;
  field_ops: {
    status: SubsystemState; visits_overdue: number; visits_not_started: number;
    planned_visits_overdue: number; reports_overdue: number;
    followups_overdue: number; plans_awaiting_approval: number;
  } | null;
  legal_handoff: {
    status: SubsystemState; recommendations_pending: number; approved_not_prepared: number;
    approved_not_handed_off: number; returned_unresolved: number; stale_referrals: number;
  } | null;
  jobs: {
    job_code: string; name: string; job_type: string | null; purpose: string | null;
    schedule: string | null; active_cron: string | null; sync_state: string | null;
    enabled: boolean | null; scheduled: boolean | null;
    last_run_at: string | null; last_run_status: string | null; last_success_at: string | null;
    duration_ms: number | null; next_run_at: string | null;
    status: 'healthy' | 'running' | 'delayed' | 'failed' | 'disabled' | 'never_run';
  }[] | null;
  job_failures: {
    job_code: string; name: string; failed_at: string; error_summary: string;
    records_affected: number | null; errors_count: number | null; retry_status: string;
  }[] | null;
  events: {
    at: string; event: string; record: string | null;
    employer: string | null; severity: Severity; source: string;
  }[] | null;
}

export interface MonitoringFilters {
  severity: string | null;
  area: string | null;
  zone: string | null;
  owner: string | null;
  employer: string | null;
  alert_type: string | null;
  status: string | null;
}

export const EMPTY_MONITORING_FILTERS: MonitoringFilters = {
  severity: null, area: null, zone: null, owner: null,
  employer: null, alert_type: null, status: null,
};

export function useComplianceMonitoring() {
  const [windowKey, setWindowKey] = useState<MonitoringWindow>('24h');
  const [filters, setFilters] = useState<MonitoringFilters>(EMPTY_MONITORING_FILTERS);
  const [autoRefresh, setAutoRefresh] = useState<string>('off');

  const refetchInterval = AUTO_REFRESH_OPTIONS.find(o => o.key === autoRefresh)?.ms ?? false;

  const filterKey = useMemo(() => Object.values(filters).join('|'), [filters]);

  const query = useQuery({
    queryKey: ['compliance', 'monitoring', windowKey, filterKey],
    staleTime: 30_000,
    retry: 1,
    refetchInterval,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<MonitoringPayload> => {
      const { data, error } = await supabase.rpc('ce_monitoring_v1' as never, {
        p_window: windowKey,
        p_filters: Object.fromEntries(
          Object.entries(filters).filter(([, v]) => v != null && v !== ''),
        ),
      } as never);
      if (error) throw error;
      if (!data) throw new Error('No monitoring payload returned');
      return data as unknown as MonitoringPayload;
    },
  });

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return {
    ...query,
    windowKey,
    setWindowKey,
    filters,
    setFilters,
    setFilter: (k: keyof MonitoringFilters, v: string | null) =>
      setFilters(prev => ({ ...prev, [k]: v })),
    clearFilters: () => setFilters(EMPTY_MONITORING_FILTERS),
    activeFilterCount,
    autoRefresh,
    setAutoRefresh,
    /** true when the entire monitoring payload could not be produced */
    unavailable: query.isError,
  };
}
