/**
 * Compliance Operational Surveillance & Exception Control
 * (/compliance/workbench/monitoring).
 *
 * Near-real-time operational control: health, exceptions, deadline breaches,
 * detection and automation health, stalled work and recent events. It routes
 * users to the canonical workspace for resolution and never performs business
 * workflow actions itself. Long-term trend analysis stays in Analytics.
 *
 * Every figure comes from ce_monitoring_v1 (server-aggregated, RBAC-scoped).
 * A section that could not be read renders "Status unavailable", never zero.
 */
import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import {
  useComplianceMonitoring, MONITORING_WINDOWS, AUTO_REFRESH_OPTIONS,
  type MonitoringWindow,
} from '@/hooks/compliance/useComplianceMonitoring';
import {
  ArrangementExceptionPanel, AutomationHealthPanel, DetectionHealthPanel,
  DetectionResultsPanel, EventFeedPanel, ExceptionsQueue, HealthStrip,
  JobFailuresPanel, MetricList, MonitorPanel, SlaMonitorPanel, SlaTrendPanel,
  StalledPanel, StateBadge, fmtCurrency, prettyCode, type HealthKpi,
} from '@/components/compliance/monitoring/MonitoringPanels';

const HEALTH_TONE: Record<string, string> = {
  Healthy: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  'Attention Required': 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
  Degraded: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
  Critical: 'bg-destructive/10 text-destructive border-destructive/30',
  Unknown: 'bg-muted text-muted-foreground border-dashed border-border',
};

const QUICK_CHIPS: { label: string; patch: Record<string, string | null> }[] = [
  { label: 'Critical', patch: { severity: 'Critical' } },
  { label: 'SLA Breach', patch: { alert_type: 'sla_breach' } },
  { label: 'Automation', patch: { area: 'Automation' } },
  { label: 'Payment', patch: { area: 'Arrangement' } },
  { label: 'Legal', patch: { area: 'Legal' } },
  { label: 'Inspection', patch: { area: 'Inspection' } },
  { label: 'Communication', patch: { area: 'Communication' } },
  { label: 'Unassigned', patch: { owner: 'unassigned' } },
];

export default function ComplianceMonitoring() {
  const navigate = useNavigate();
  const {
    data, isLoading, isFetching, error, unavailable, refetch,
    windowKey, setWindowKey, filters, setFilters, setFilter, clearFilters,
    activeFilterCount, autoRefresh, setAutoRefresh,
  } = useComplianceMonitoring();

  const open = (route: string | null) => { if (route) navigate(route); };
  const k = data?.kpis;
  const sub = data?.subsystems ?? {};

  const kpis: HealthKpi[] = useMemo(() => [
    {
      label: 'Critical Alerts',
      value: k?.critical_alerts ?? null,
      context: `${k?.total_exceptions?.toLocaleString() ?? '—'} open exceptions in total`,
      state: (k?.critical_alerts ?? 0) > 0 ? 'failed' : 'ok',
      onClick: () => setFilter('severity', 'Critical'),
    },
    {
      label: 'SLA Breaches',
      value: k?.sla_breaches ?? null,
      context: data?.sla_summary
        ? `${data.sla_summary.due_1_3.toLocaleString()} due in 1–3 days`
        : 'Deadline monitor unavailable',
      state: sub.sla ?? 'unavailable',
      onClick: () => setFilter('alert_type', 'sla_breach'),
    },
    {
      label: 'Due Within 24h',
      value: k?.due_24h ?? null,
      context: 'Configured deadlines falling due today',
      state: (k?.due_24h ?? 0) > 0 ? 'degraded' : 'ok',
      onClick: () => setFilter('alert_type', 'sla_due'),
    },
    {
      label: 'Stalled Items',
      value: k?.stalled_items ?? null,
      context: 'No progress beyond the configured inactivity threshold',
      state: (k?.stalled_items ?? 0) > 0 ? 'degraded' : 'ok',
      onClick: () => setFilter('alert_type', 'stalled'),
    },
    {
      label: 'Failed Jobs',
      value: k?.failed_jobs ?? null,
      context: data?.technical_access
        ? 'Scheduled automation reporting a failed last run'
        : 'Requires configuration permissions',
      state: sub.automation ?? 'unavailable',
      onClick: () => setFilter('area', 'Automation'),
    },
    {
      label: 'Failed Notices',
      value: k?.failed_notices ?? null,
      context: 'Delivery attempts that failed in the selected window',
      state: sub.communications ?? 'unavailable',
      onClick: () => setFilter('alert_type', 'delivered_failed'),
    },
  ], [k, data, sub, setFilter]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <PageHeader
          title="Compliance Operational Monitoring"
          subtitle="Near-real-time operational health, exceptions, deadline breaches and automation surveillance"
          breadcrumbs={[
            { label: 'Compliance', href: '/compliance' },
            { label: 'Monitoring' },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={windowKey} onValueChange={v => setWindowKey(v as MonitoringWindow)}>
            <SelectTrigger className="h-9 w-[170px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONITORING_WINDOWS.map(w => (
                <SelectItem key={w.key} value={w.key} className="text-xs">{w.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={autoRefresh} onValueChange={setAutoRefresh}>
            <SelectTrigger className="h-9 w-[180px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {AUTO_REFRESH_OPTIONS.map(o => (
                <SelectItem key={o.key} value={o.key} className="text-xs">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} />Refresh
          </Button>
        </div>
      </div>

      {/* Overall health + freshness */}
      <Card>
        <CardContent className="p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Compliance Operational Health
            </span>
            <Badge variant="outline"
              className={`text-xs ${HEALTH_TONE[data?.health?.state ?? 'Unknown']}`}>
              {isLoading ? 'Evaluating…' : (data?.health?.state ?? 'Unknown')}
            </Badge>
            {data?.scope && (
              <Badge variant="outline" className="text-[11px]">
                Scope: {prettyCode(data.scope)}
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {data?.generated_at
              ? `Last refreshed: ${new Date(data.generated_at).toLocaleTimeString()} · window ${data.window}`
              : 'Not yet refreshed'}
          </p>
        </CardContent>
      </Card>

      {unavailable && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Monitoring data could not be loaded{error instanceof Error ? `: ${error.message}` : ''}.
            No conclusion about operational health can be drawn from this screen right now.
          </AlertDescription>
        </Alert>
      )}

      {/* Subsystem states */}
      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(sub).map(([name, state]) => (
          <span key={name} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {prettyCode(name)} <StateBadge state={state} />
          </span>
        ))}
      </div>

      <HealthStrip kpis={kpis} loading={isLoading} />

      {/* Filters */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <Select value={filters.severity ?? 'all'}
            onValueChange={v => setFilter('severity', v === 'all' ? null : v)}>
            <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All severities</SelectItem>
              {['Critical', 'High', 'Medium', 'Informational'].map(s => (
                <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.area ?? 'all'}
            onValueChange={v => setFilter('area', v === 'all' ? null : v)}>
            <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="Area" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All areas</SelectItem>
              {['Violation', 'Case', 'Communication', 'Arrangement', 'Inspection', 'Follow-up', 'Legal', 'Automation']
                .map(a => <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.alert_type ?? 'all'}
            onValueChange={v => setFilter('alert_type', v === 'all' ? null : v)}>
            <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue placeholder="Alert type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All alert types</SelectItem>
              {[
                ['sla_breach', 'SLA breach'], ['sla_due', 'Approaching deadline'],
                ['stalled', 'Stalled'], ['unassigned', 'Unassigned'],
                ['arrangement_breach', 'Arrangement breach'], ['delivery_failed', 'Delivery failed'],
                ['legal_handoff', 'Legal handoff'], ['legal_returned', 'Returned from Legal'],
                ['job_failed', 'Automation failure'],
              ].map(([v, l]) => <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            className="h-8 w-[190px] text-xs"
            placeholder="Employer"
            value={filters.employer ?? ''}
            onChange={e => setFilter('employer', e.target.value || null)}
          />
          <Input
            className="h-8 w-[150px] text-xs"
            placeholder="Owner"
            value={filters.owner ?? ''}
            onChange={e => setFilter('owner', e.target.value || null)}
          />
          <Input
            className="h-8 w-[120px] text-xs"
            placeholder="Zone"
            value={filters.zone ?? ''}
            onChange={e => setFilter('zone', e.target.value || null)}
          />
          {activeFilterCount > 0 && (
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={clearFilters}>
              <X className="h-3.5 w-3.5 mr-1" />Reset filters ({activeFilterCount})
            </Button>
          )}
          <div className="w-full flex flex-wrap gap-1.5 pt-1">
            {QUICK_CHIPS.map(c => {
              const active = Object.entries(c.patch)
                .every(([kk, vv]) => (filters as unknown as Record<string, string | null>)[kk] === vv);
              return (
                <Badge
                  key={c.label}
                  variant={active ? 'default' : 'outline'}
                  className="cursor-pointer text-[11px]"
                  onClick={() => setFilters(prev => ({
                    ...prev,
                    ...Object.fromEntries(Object.entries(c.patch).map(([kk, vv]) =>
                      [kk, (prev as unknown as Record<string, string | null>)[kk] === vv ? null : vv])),
                  }))}
                >
                  {c.label}
                </Badge>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Exceptions */}
      <ExceptionsQueue
        exceptions={data?.exceptions ?? []}
        truncated={data?.exceptions_truncated}
        total={k?.total_exceptions}
        loading={isLoading}
        onOpen={open}
      />

      {/* SLA */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <SlaMonitorPanel
            sla={data?.sla_summary ?? null}
            urgent={data?.sla_urgent ?? []}
            loading={isLoading}
            onOpen={open}
          />
        </div>
        <SlaTrendPanel trend={data?.sla_trend ?? []} loading={isLoading} />
      </div>

      {/* Detection */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DetectionHealthPanel detection={data?.detection ?? null} loading={isLoading} />
        <DetectionResultsPanel results={data?.detection_results ?? null} loading={isLoading} onOpen={open} />
      </div>

      {/* Stagnation */}
      <StalledPanel
        byArea={data?.stalled_by_area ?? []}
        oldest={data?.stalled_oldest ?? []}
        loading={isLoading}
        stallDays={data?.thresholds?.stall_days}
        onArea={area => setFilters(prev => ({ ...prev, area, alert_type: 'stalled' }))}
        onOpen={open}
      />

      {/* Financial + arrangements */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ArrangementExceptionPanel
          arrangements={data?.arrangements ?? null}
          loading={isLoading}
          onOpen={open}
        />
        <MonitorPanel
          title="New Financial Exceptions"
          subtitle="Newly non-compliant obligations and unresolved allocation variances"
          state={data?.financial_exceptions?.status ?? 'unavailable'}
          loading={isLoading}
        >
          <div className="space-y-4">
            <MetricList items={[
              { label: 'Newly outstanding obligations', value: data?.financial_exceptions?.new_outstanding_obligations ?? null, tone: 'warn' },
              { label: 'Obligations past grace', value: data?.financial_exceptions?.obligations_past_grace ?? null, tone: 'bad' },
              { label: 'New reconciliation exceptions', value: data?.financial_exceptions?.new_reconciliation_exceptions ?? null, tone: 'warn' },
              { label: 'Open reconciliation exceptions', value: data?.financial_exceptions?.open_reconciliation_exceptions ?? null, tone: 'bad' },
              { label: 'Partial payment requests pending', value: data?.financial_exceptions?.pending_partial_payment_requests ?? null,
                onClick: () => open('/compliance/enforcement/partial-payments') },
            ]} />
            {(data?.financial_exceptions?.top_new_exceptions?.length ?? 0) > 0 && (
              <ul className="space-y-1 border-t pt-2">
                {data!.financial_exceptions!.top_new_exceptions.map((t, i) => (
                  <li key={i} className="flex items-center justify-between text-[11px]">
                    <span className="truncate max-w-[220px]">{t.employer_name ?? '—'}</span>
                    <span className="text-muted-foreground">{prettyCode(t.type)}</span>
                    <span className="font-semibold tabular-nums">{fmtCurrency(t.variance)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </MonitorPanel>
      </div>

      {/* Communications + field + legal */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <MonitorPanel
          title="Communication Health"
          subtitle="Notice approval, despatch and delivery confirmation"
          state={data?.communications?.status ?? 'unavailable'}
          loading={isLoading}
          actions={
            <Button size="sm" variant="ghost" className="h-7 text-[11px]"
              onClick={() => open('/compliance/enforcement/notices')}>Notices</Button>
          }
        >
          <MetricList items={[
            { label: 'Awaiting approval', value: data?.communications?.awaiting_approval ?? null, tone: 'warn' },
            { label: 'Queued for despatch', value: data?.communications?.queued ?? null },
            { label: 'Sent', value: data?.communications?.sent ?? null },
            { label: 'Delivered', value: data?.communications?.delivered ?? null },
            { label: 'Delivery failed', value: data?.communications?.failed ?? null, tone: 'bad' },
            { label: 'Confirmation pending', value: data?.communications?.confirmation_pending ?? null, tone: 'warn' },
            { label: 'Failed attempts (window)', value: data?.communications?.failed_attempts_window ?? null, tone: 'bad' },
            { label: 'Responses to process', value: data?.communications?.responses_awaiting ?? null, tone: 'warn' },
          ]} />
        </MonitorPanel>

        <MonitorPanel
          title="Field Operations Exceptions"
          subtitle="Visits, reports, follow-ups and plan approvals"
          state={data?.field_ops?.status ?? 'unavailable'}
          loading={isLoading}
          actions={
            <Button size="sm" variant="ghost" className="h-7 text-[11px]"
              onClick={() => open('/compliance/field/inspections')}>Inspections</Button>
          }
        >
          <MetricList items={[
            { label: 'Visits overdue', value: data?.field_ops?.visits_overdue ?? null, tone: 'bad' },
            { label: 'Visits not started', value: data?.field_ops?.visits_not_started ?? null, tone: 'warn' },
            { label: 'Planned visits overdue', value: data?.field_ops?.planned_visits_overdue ?? null, tone: 'warn' },
            { label: 'Reports overdue', value: data?.field_ops?.reports_overdue ?? null, tone: 'warn' },
            { label: 'Follow-ups overdue', value: data?.field_ops?.followups_overdue ?? null, tone: 'bad' },
            { label: 'Plans awaiting approval', value: data?.field_ops?.plans_awaiting_approval ?? null,
              onClick: () => open('/compliance/audit-planning/pending-review') },
          ]} />
        </MonitorPanel>

        <MonitorPanel
          title="Legal Handoff Health"
          subtitle="Breakdowns in the Compliance → Legal progression"
          state={data?.legal_handoff?.status ?? 'unavailable'}
          loading={isLoading}
          actions={
            <Button size="sm" variant="ghost" className="h-7 text-[11px]"
              onClick={() => open('/compliance/enforcement/legal-queue')}>Legal queue</Button>
          }
        >
          <MetricList items={[
            { label: 'Recommendations awaiting decision', value: data?.legal_handoff?.recommendations_pending ?? null, tone: 'warn',
              onClick: () => open('/compliance/enforcement/recommendation-queue') },
            { label: 'Approved, pack not complete', value: data?.legal_handoff?.approved_not_prepared ?? null, tone: 'warn' },
            { label: 'Approved, not handed off', value: data?.legal_handoff?.approved_not_handed_off ?? null, tone: 'bad' },
            { label: 'Returned, unresolved', value: data?.legal_handoff?.returned_unresolved ?? null, tone: 'bad' },
            { label: 'No Legal status update', value: data?.legal_handoff?.stale_referrals ?? null, tone: 'warn' },
          ]} />
        </MonitorPanel>
      </div>

      {/* Automation */}
      <AutomationHealthPanel
        jobs={data?.jobs ?? null}
        technical={data?.technical_access ?? false}
        loading={isLoading}
        onOpen={open}
      />
      <JobFailuresPanel
        failures={data?.job_failures ?? null}
        technical={data?.technical_access ?? false}
        loading={isLoading}
        onOpen={open}
      />

      {/* Events */}
      <EventFeedPanel events={data?.events ?? null} loading={isLoading} />

      {data?.thresholds && (
        <p className="text-[11px] text-muted-foreground">
          Thresholds resolved from {data.thresholds.source} · deadline horizon{' '}
          {data.thresholds.horizon_from} → {data.thresholds.horizon_to} ·{' '}
          Health policy: {data.health.policy}
        </p>
      )}
    </div>
  );
}
