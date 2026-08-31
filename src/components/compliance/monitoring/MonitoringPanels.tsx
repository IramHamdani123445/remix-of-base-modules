/**
 * Presentation panels for the Compliance Operational Monitoring workspace
 * (/compliance/workbench/monitoring).
 *
 * All figures come from ce_monitoring_v1. Panels never convert a failed
 * section into a zero: when a section reports an unavailable/restricted state
 * the panel says so explicitly instead of implying health.
 */
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  AlertTriangle, ArrowRight, CircleSlash, Inbox, Loader2, ShieldQuestion,
} from 'lucide-react';
import type {
  MonitoringException, MonitoringPayload, Severity, SubsystemState,
} from '@/hooks/compliance/useComplianceMonitoring';

/* ---------------------------------------------------------------- helpers */

export const fmtNum = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());

export const fmtCurrency = (n: number | null | undefined) =>
  n == null
    ? '—'
    : new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'XCD', minimumFractionDigits: 0, maximumFractionDigits: 0,
      }).format(n);

export const prettyCode = (s?: string | null) =>
  !s ? '—' : s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

export const fmtTime = (iso?: string | null) =>
  !iso ? '—' : new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

export const fmtAge = (hours?: number | null) => {
  if (hours == null) return '—';
  if (hours < 1) return '<1h';
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
};

const tooltipStyle = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '8px',
  color: 'hsl(var(--popover-foreground))',
  fontSize: '12px',
};

const SEV_ORDER: Severity[] = ['Critical', 'High', 'Medium', 'Informational'];

const SEV_CLASS: Record<Severity, string> = {
  Critical: 'bg-destructive/10 text-destructive border-destructive/30',
  High: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
  Medium: 'bg-muted text-muted-foreground border-border',
  Informational: 'bg-muted text-muted-foreground border-border',
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <Badge variant="outline" className={`text-[11px] ${SEV_CLASS[severity] ?? SEV_CLASS.Medium}`}>
      {severity}
    </Badge>
  );
}

const STATE_LABEL: Record<SubsystemState, string> = {
  ok: 'Healthy',
  degraded: 'Degraded',
  failed: 'Failed',
  disabled: 'Disabled',
  stale: 'Stale',
  no_data: 'No data',
  unavailable: 'Status unavailable',
  restricted: 'Restricted',
};

const STATE_CLASS: Record<SubsystemState, string> = {
  ok: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  degraded: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
  failed: 'bg-destructive/10 text-destructive border-destructive/30',
  disabled: 'bg-muted text-muted-foreground border-border',
  stale: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
  no_data: 'bg-muted text-muted-foreground border-border',
  unavailable: 'bg-muted text-muted-foreground border-dashed border-border',
  restricted: 'bg-muted text-muted-foreground border-dashed border-border',
};

export function StateBadge({ state }: { state?: SubsystemState | null }) {
  const s = (state ?? 'unavailable') as SubsystemState;
  return (
    <Badge variant="outline" className={`text-[11px] ${STATE_CLASS[s] ?? STATE_CLASS.unavailable}`}>
      {STATE_LABEL[s] ?? 'Status unavailable'}
    </Badge>
  );
}

const JOB_STATE_CLASS: Record<string, string> = {
  healthy: STATE_CLASS.ok,
  running: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/30',
  delayed: STATE_CLASS.degraded,
  failed: STATE_CLASS.failed,
  disabled: STATE_CLASS.disabled,
  never_run: STATE_CLASS.no_data,
};

/* ------------------------------------------------------------------ shell */

interface PanelProps {
  title: string;
  subtitle?: string;
  state?: SubsystemState | null;
  loading?: boolean;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  /** True when there is genuinely nothing to show (distinct from unavailable) */
  empty?: boolean;
  emptyLabel?: string;
}

export function MonitorPanel({
  title, subtitle, state, loading, actions, className, children, empty, emptyLabel,
}: PanelProps) {
  const unavailable = state === 'unavailable' || state === 'restricted';
  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-semibold tracking-tight">{title}</CardTitle>
            {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2">
            {state && <StateBadge state={state} />}
            {actions}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="flex items-center gap-2 py-8 justify-center text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : unavailable ? (
          <div className="flex items-center gap-2 py-8 justify-center text-xs text-muted-foreground">
            <ShieldQuestion className="h-4 w-4" />
            {state === 'restricted'
              ? 'Restricted — additional permissions required'
              : 'Status unavailable — this signal could not be read'}
          </div>
        ) : empty ? (
          <div className="flex items-center gap-2 py-8 justify-center text-xs text-muted-foreground">
            <Inbox className="h-4 w-4" /> {emptyLabel ?? 'No exceptions'}
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------- health KPIs */

export interface HealthKpi {
  label: string;
  value: number | null;
  context: string;
  state: SubsystemState;
  onClick?: () => void;
}

export function HealthStrip({ kpis, loading }: { kpis: HealthKpi[]; loading?: boolean }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      {kpis.map(k => (
        <Card
          key={k.label}
          className={`transition-colors ${k.onClick ? 'cursor-pointer hover:border-primary/40' : ''}`}
          onClick={k.onClick}
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                {k.label}
              </p>
              <StateBadge state={k.state} />
            </div>
            <p className="text-2xl font-semibold mt-2 tabular-nums">
              {loading ? '…' : k.value == null ? 'N/A' : k.value.toLocaleString()}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{k.context}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------- exceptions queue */

export function ExceptionsQueue({
  exceptions, truncated, total, loading, onOpen,
}: {
  exceptions: MonitoringException[];
  truncated?: boolean;
  total?: number;
  loading?: boolean;
  onOpen: (route: string | null) => void;
}) {
  return (
    <MonitorPanel
      title="Critical Alerts / Requires Attention"
      subtitle={
        total != null
          ? `${total.toLocaleString()} open exception${total === 1 ? '' : 's'}${truncated ? ' · showing the most urgent 400' : ''}`
          : undefined
      }
      loading={loading}
      empty={!loading && exceptions.length === 0}
      emptyLabel="No operational exceptions match the current filters"
    >
      <div className="max-h-[520px] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10">
            <TableRow>
              <TableHead className="w-[92px]">Severity</TableHead>
              <TableHead>Alert</TableHead>
              <TableHead>Employer / Record</TableHead>
              <TableHead className="w-[110px]">Area</TableHead>
              <TableHead className="w-[130px]">Detected</TableHead>
              <TableHead className="w-[64px]">Age</TableHead>
              <TableHead className="w-[150px]">Owner</TableHead>
              <TableHead className="w-[170px]">Required action</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {exceptions.map((e, i) => (
              <TableRow key={`${e.record_id}-${e.alert_type}-${i}`} className="text-xs">
                <TableCell><SeverityBadge severity={e.severity} /></TableCell>
                <TableCell className="font-medium">{e.alert}</TableCell>
                <TableCell>
                  <div className="truncate max-w-[220px]">{e.employer_name ?? '—'}</div>
                  <div className="text-[11px] text-muted-foreground">{e.record_ref ?? '—'}</div>
                </TableCell>
                <TableCell>{e.area}</TableCell>
                <TableCell className="tabular-nums">{fmtTime(e.detected_at)}</TableCell>
                <TableCell className="tabular-nums">{fmtAge(e.age_hours)}</TableCell>
                <TableCell>
                  {e.owner_name ?? (
                    <Badge variant="outline" className="text-[10px] border-destructive/30 text-destructive">
                      Unassigned
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{e.action ?? '—'}</TableCell>
                <TableCell>
                  {e.route && (
                    <Button size="sm" variant="ghost" className="h-7 px-2"
                      onClick={() => onOpen(e.route)}>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </MonitorPanel>
  );
}

/* --------------------------------------------------------------- SLA panel */

export function SlaMonitorPanel({
  sla, urgent, loading, onOpen, state,
}: {
  sla: MonitoringPayload['sla_summary'];
  urgent: MonitoringPayload['sla_urgent'];
  loading?: boolean;
  onOpen: (route: string | null) => void;
  /** Severity state from the subsystem roll-up; falls back to read status. */
  state?: SubsystemState;
}) {
  const total = sla
    ? sla.breached + sla.due_24h + sla.due_1_3 + sla.due_4_7 + sla.healthy
    : 0;
  const seg = [
    { label: 'Breached', value: sla?.breached ?? 0, color: 'hsl(var(--destructive))' },
    { label: 'Due < 24h', value: sla?.due_24h ?? 0, color: 'hsl(20, 85%, 55%)' },
    { label: 'Due 1–3 days', value: sla?.due_1_3 ?? 0, color: 'hsl(35, 90%, 55%)' },
    { label: 'Due 4–7 days', value: sla?.due_4_7 ?? 0, color: 'hsl(210, 70%, 55%)' },
    { label: 'Healthy', value: sla?.healthy ?? 0, color: 'hsl(160, 55%, 42%)' },
  ];

  return (
    <MonitorPanel
      title="SLA & Deadline Monitor"
      subtitle="Configured deadlines across violations, cases, notices, installments, follow-ups and inspections"
      state={state ?? sla?.status ?? 'unavailable'}
      loading={loading}
      empty={!loading && total === 0}
      emptyLabel="No monitored deadlines in the operational horizon"
    >
      <div className="space-y-4">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
          {seg.map(s => s.value > 0 && (
            <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {seg.map(s => (
            <div key={s.label} className="flex items-center gap-1.5 text-[11px]">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              <span className="text-muted-foreground">{s.label}</span>
              <span className="font-semibold tabular-nums">{s.value.toLocaleString()}</span>
            </div>
          ))}
        </div>

        <div className="max-h-[260px] overflow-auto border-t pt-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Record</TableHead>
                <TableHead>Employer</TableHead>
                <TableHead className="w-[110px]">Area</TableHead>
                <TableHead className="w-[110px]">Due</TableHead>
                <TableHead className="w-[90px]">Overdue</TableHead>
                <TableHead className="w-[140px]">Owner</TableHead>
                <TableHead className="w-[52px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {urgent.map((u, i) => (
                <TableRow key={`${u.record_ref}-${i}`} className="text-xs">
                  <TableCell className="font-medium">{u.record_ref ?? '—'}</TableCell>
                  <TableCell className="truncate max-w-[200px]">{u.employer_name ?? '—'}</TableCell>
                  <TableCell>{u.area}</TableCell>
                  <TableCell className="tabular-nums">{u.due_date}</TableCell>
                  <TableCell className="tabular-nums">
                    {u.days_overdue > 0
                      ? <span className="text-destructive font-medium">{u.days_overdue}d</span>
                      : '—'}
                  </TableCell>
                  <TableCell>{u.owner_name ?? 'Unassigned'}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onOpen(u.route)}>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </MonitorPanel>
  );
}

export function SlaTrendPanel({ trend, loading }: { trend: MonitoringPayload['sla_trend']; loading?: boolean }) {
  return (
    <MonitorPanel
      title="SLA Pressure — Last 7 Days"
      subtitle="Deadlines falling due and still breached, against items cleared late"
      loading={loading}
      empty={!loading && trend.length === 0}
      emptyLabel="No deadline activity"
    >
      <ResponsiveContainer width="100%" height={170}>
        <LineChart data={trend} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="d" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="new_breaches" name="New breaches"
            stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="cleared" name="Cleared late"
            stroke="hsl(160, 55%, 42%)" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </MonitorPanel>
  );
}

/* --------------------------------------------------------- detection panel */

export function DetectionHealthPanel({
  detection, loading,
}: { detection: MonitoringPayload['detection']; loading?: boolean }) {
  const d = detection;
  const rows: [string, React.ReactNode][] = [
    ['Scheduled detection', d?.schedule_cron ? `${d.schedule_cron} (every ${d.expected_interval_hours ?? '—'}h)` : '—'],
    ['Last run', `${fmtTime(d?.last_run_at)} · ${prettyCode(d?.last_run_status)}`],
    ['Last successful run', fmtTime(d?.last_success_at)],
    ['Duration', d?.duration_ms != null ? `${d.duration_ms} ms` : '—'],
    ['Records evaluated', fmtNum(d?.records_evaluated)],
    ['Violations detected', fmtNum(d?.violations_detected)],
    ['Errors', fmtNum(d?.errors)],
    ['Active rules', d ? `${fmtNum(d.active_rules)} of ${fmtNum(d.total_rules)} enabled` : '—'],
    ['Event-triggered queue', d?.event_queue
      ? `${fmtNum(d.event_queue.pending)} pending · ${fmtNum(d.event_queue.processed_window)} processed · ${fmtNum(d.event_queue.failed_window)} failed`
      : '—'],
    ['Manual runs (window)', fmtNum(d?.manual_runs_window)],
  ];
  return (
    <MonitorPanel
      title="Compliance Detection Engine"
      subtitle="Scheduled, event-triggered and manual violation detection"
      state={d?.status ?? 'unavailable'}
      loading={loading}
    >
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 border-b border-dashed border-border/60 py-1">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-medium text-right tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {d?.status === 'degraded' && (
        <p className="mt-3 flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
          Detection has not completed successfully within its configured interval plus grace period.
        </p>
      )}
    </MonitorPanel>
  );
}

export function DetectionResultsPanel({
  results, loading, onOpen,
}: {
  results: MonitoringPayload['detection_results'];
  loading?: boolean;
  onOpen: (route: string | null) => void;
}) {
  const unavailable = results == null;
  const categories = React.useMemo(
    () => Array.from(new Set((results ?? []).filter(r => r.count > 0).map(r => r.category))),
    [results],
  );
  const data = React.useMemo(() => {
    const byDay = new Map<string, Record<string, number | string>>();
    (results ?? []).forEach(r => {
      const row = byDay.get(r.d) ?? { d: r.d.slice(5) };
      row[r.category] = ((row[r.category] as number) ?? 0) + r.count;
      byDay.set(r.d, row);
    });
    return Array.from(byDay.values());
  }, [results]);
  const colors = ['hsl(var(--primary))', 'hsl(35, 90%, 55%)', 'hsl(160, 55%, 42%)', 'hsl(280, 55%, 55%)', 'hsl(210, 70%, 55%)'];

  return (
    <MonitorPanel
      title="Violations Detected — Last 7 Days"
      subtitle="Operational detection output by violation category"
      state={unavailable ? 'unavailable' : undefined}
      loading={loading}
      empty={!loading && !unavailable && categories.length === 0}
      emptyLabel="No violations detected in the last 7 days"
      actions={
        <Button size="sm" variant="ghost" className="h-7 text-[11px]"
          onClick={() => onOpen('/compliance/violations/rule-detected')}>
          Rule detected
        </Button>
      }
    >
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="d" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {categories.map((c, i) => (
            <Bar key={c} dataKey={c} stackId="a" fill={colors[i % colors.length]} radius={[2, 2, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </MonitorPanel>
  );
}

/* ----------------------------------------------------------- stagnation */

export function StalledPanel({
  byArea, oldest, loading, onArea, onOpen, stallDays,
}: {
  byArea: MonitoringPayload['stalled_by_area'];
  oldest: MonitoringPayload['stalled_oldest'];
  loading?: boolean;
  onArea: (area: string) => void;
  onOpen: (route: string | null) => void;
  stallDays?: Record<string, number>;
}) {
  const thresholdText = stallDays
    ? Object.entries(stallDays).map(([k, v]) => `${prettyCode(k)} ${v}d`).join(' · ')
    : undefined;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <MonitorPanel
        title="Stalled Items by Area"
        subtitle={thresholdText && `No progress beyond configured threshold — ${thresholdText}`}
        loading={loading}
        empty={!loading && byArea.length === 0}
        emptyLabel="Nothing stalled beyond the configured thresholds"
      >
        <ResponsiveContainer width="100%" height={Math.max(140, byArea.length * 34)}>
          <BarChart data={byArea} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="area" width={90} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="count" radius={[0, 3, 3, 0]} onClick={(d: { area?: string }) => d?.area && onArea(d.area)}>
              {byArea.map((_, i) => <Cell key={i} fill="hsl(35, 90%, 55%)" cursor="pointer" />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </MonitorPanel>

      <MonitorPanel
        title="Longest Waiting Items"
        subtitle="Oldest work with no recorded progress"
        loading={loading}
        empty={!loading && oldest.length === 0}
        emptyLabel="No stalled work"
      >
        <div className="max-h-[300px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Record</TableHead>
                <TableHead>Employer</TableHead>
                <TableHead className="w-[110px]">Stage</TableHead>
                <TableHead className="w-[130px]">Owner</TableHead>
                <TableHead className="w-[80px]">In stage</TableHead>
                <TableHead className="w-[52px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {oldest.map((o, i) => (
                <TableRow key={`${o.record_ref}-${i}`} className="text-xs">
                  <TableCell className="font-medium">{o.record_ref ?? '—'}</TableCell>
                  <TableCell className="truncate max-w-[180px]">{o.employer_name ?? '—'}</TableCell>
                  <TableCell>{prettyCode(o.stage)}</TableCell>
                  <TableCell>{o.owner_name ?? 'Unassigned'}</TableCell>
                  <TableCell className="tabular-nums">{o.days_in_stage}d</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onOpen(o.route)}>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </MonitorPanel>
    </div>
  );
}

/* --------------------------------------------------------- metric listing */

export function MetricList({
  items,
}: { items: { label: string; value: number | null; tone?: 'default' | 'warn' | 'bad'; onClick?: () => void }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
      {items.map(i => (
        <div
          key={i.label}
          className={`flex items-baseline justify-between gap-3 border-b border-dashed border-border/60 py-1 ${i.onClick ? 'cursor-pointer hover:text-primary' : ''}`}
          onClick={i.onClick}
        >
          <dt className="text-muted-foreground">{i.label}</dt>
          <dd className={`font-semibold tabular-nums ${
            i.value && i.tone === 'bad' ? 'text-destructive'
              : i.value && i.tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : ''
          }`}>
            {i.value == null ? 'N/A' : i.value.toLocaleString()}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------ arrangements */

export function ArrangementExceptionPanel({
  arrangements, loading, onOpen,
}: {
  arrangements: MonitoringPayload['arrangements'];
  loading?: boolean;
  onOpen: (route: string | null) => void;
}) {
  const a = arrangements;
  const health = a?.health ?? [];
  const totalHealth = health.reduce((s, h) => s + h.count, 0);
  const colorFor = (state: string) =>
    /BREACH|DEFAULT/i.test(state) ? 'hsl(var(--destructive))'
      : /RISK|OVERDUE|DUE/i.test(state) ? 'hsl(35, 90%, 55%)'
        : 'hsl(160, 55%, 42%)';

  return (
    <MonitorPanel
      title="Payment Arrangement Exceptions"
      subtitle="Installment and breach exceptions only — manage arrangements in the Arrangements workspace"
      state={a?.status ?? 'unavailable'}
      loading={loading}
      actions={
        <Button size="sm" variant="ghost" className="h-7 text-[11px]"
          onClick={() => onOpen('/compliance/enforcement/arrangements')}>Open</Button>
      }
    >
      <div className="space-y-4">
        <MetricList items={[
          { label: 'Installments due today', value: a?.due_today ?? null, tone: 'warn',
            onClick: () => onOpen('/compliance/arrangements/installments-due') },
          { label: 'Installments overdue', value: a?.overdue ?? null, tone: 'bad',
            onClick: () => onOpen('/compliance/arrangements/installments-due') },
          { label: 'New breaches in window', value: a?.new_breaches_window ?? null, tone: 'bad',
            onClick: () => onOpen('/compliance/arrangements/breaches') },
          { label: 'Unprocessed breaches', value: a?.unresolved_breaches ?? null, tone: 'bad',
            onClick: () => onOpen('/compliance/enforcement/breaches') },
          { label: 'Approaching default', value: a?.approaching_default ?? null, tone: 'warn' },
        ]} />
        {totalHealth > 0 && (
          <div className="space-y-2">
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
              {health.map(h => (
                <div key={h.state}
                  style={{ width: `${(h.count / totalHealth) * 100}%`, background: colorFor(h.state) }} />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
              {health.map(h => (
                <span key={h.state} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: colorFor(h.state) }} />
                  <span className="text-muted-foreground">{prettyCode(h.state)}</span>
                  <span className="font-semibold tabular-nums">
                    {h.count} ({Math.round((h.count / totalHealth) * 100)}%)
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </MonitorPanel>
  );
}

/* -------------------------------------------------------------- automation */

export function AutomationHealthPanel({
  jobs, technical, loading, onOpen,
}: {
  jobs: MonitoringPayload['jobs'];
  technical: boolean;
  loading?: boolean;
  onOpen: (route: string | null) => void;
}) {
  const state: SubsystemState = !technical ? 'restricted' : jobs == null ? 'unavailable' : 'ok';
  return (
    <MonitorPanel
      title="Automation Health"
      subtitle="Scheduled Compliance jobs reconciled against the live scheduler"
      state={state === 'ok' ? undefined : state}
      loading={loading}
      empty={technical && jobs != null && jobs.length === 0}
      emptyLabel="No Compliance automation jobs are registered"
      actions={
        <Button size="sm" variant="ghost" className="h-7 text-[11px]"
          onClick={() => onOpen('/compliance/automation/jobs')}>Jobs</Button>
      }
    >
      <div className="max-h-[380px] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10">
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead className="w-[120px]">Schedule</TableHead>
              <TableHead className="w-[130px]">Last run</TableHead>
              <TableHead className="w-[130px]">Last success</TableHead>
              <TableHead className="w-[90px]">Duration</TableHead>
              <TableHead className="w-[110px]">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(jobs ?? []).map(j => (
              <TableRow key={j.job_code} className="text-xs">
                <TableCell>
                  <div className="font-medium">{j.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate max-w-[280px]">
                    {j.purpose ?? j.job_code}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-[11px]">{j.schedule ?? '—'}</TableCell>
                <TableCell className="tabular-nums">{fmtTime(j.last_run_at)}</TableCell>
                <TableCell className="tabular-nums">{fmtTime(j.last_success_at)}</TableCell>
                <TableCell className="tabular-nums">
                  {j.duration_ms != null ? `${j.duration_ms} ms` : '—'}
                </TableCell>
                <TableCell>
                  <Badge variant="outline"
                    className={`text-[11px] ${JOB_STATE_CLASS[j.status] ?? STATE_CLASS.unavailable}`}>
                    {prettyCode(j.status)}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </MonitorPanel>
  );
}

export function JobFailuresPanel({
  failures, technical, loading, onOpen,
}: {
  failures: MonitoringPayload['job_failures'];
  technical: boolean;
  loading?: boolean;
  onOpen: (route: string | null) => void;
}) {
  const state: SubsystemState = !technical ? 'restricted' : failures == null ? 'unavailable' : 'ok';
  return (
    <MonitorPanel
      title="Recent Automation Failures"
      subtitle="Last 30 days"
      state={state === 'ok' ? undefined : state}
      loading={loading}
      empty={technical && failures != null && failures.length === 0}
      emptyLabel="No automation failures recorded"
      actions={
        <Button size="sm" variant="ghost" className="h-7 text-[11px]"
          onClick={() => onOpen('/compliance/automation/history')}>History</Button>
      }
    >
      <div className="max-h-[240px] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead className="w-[130px]">Failed at</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead className="w-[110px]">Records</TableHead>
              <TableHead className="w-[160px]">Retry status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(failures ?? []).map((f, i) => (
              <TableRow key={`${f.job_code}-${i}`} className="text-xs">
                <TableCell className="font-medium">{f.name}</TableCell>
                <TableCell className="tabular-nums">{fmtTime(f.failed_at)}</TableCell>
                <TableCell className="text-muted-foreground">{f.error_summary}</TableCell>
                <TableCell className="tabular-nums">{fmtNum(f.records_affected)}</TableCell>
                <TableCell>{f.retry_status}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </MonitorPanel>
  );
}

/* ------------------------------------------------------------ event feed */

export function EventFeedPanel({
  events, loading,
}: { events: MonitoringPayload['events']; loading?: boolean }) {
  return (
    <MonitorPanel
      title="Recent Operational Events"
      subtitle="Chronological activity recorded in the selected window"
      state={events == null ? 'unavailable' : undefined}
      loading={loading}
      empty={events != null && events.length === 0}
      emptyLabel="No events recorded in this window"
    >
      <div className="max-h-[320px] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10">
            <TableRow>
              <TableHead className="w-[130px]">Time</TableHead>
              <TableHead>Event</TableHead>
              <TableHead className="w-[200px]">Employer / Record</TableHead>
              <TableHead className="w-[110px]">Severity</TableHead>
              <TableHead className="w-[190px]">Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(events ?? []).map((e, i) => (
              <TableRow key={i} className="text-xs">
                <TableCell className="tabular-nums">{fmtTime(e.at)}</TableCell>
                <TableCell className="font-medium">{e.event}</TableCell>
                <TableCell className="truncate max-w-[200px]">
                  {e.employer ?? e.record ?? '—'}
                </TableCell>
                <TableCell><SeverityBadge severity={e.severity} /></TableCell>
                <TableCell className="font-mono text-[10px] text-muted-foreground">{e.source}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </MonitorPanel>
  );
}

export const MONITORING_EMPTY_ICON = CircleSlash;
