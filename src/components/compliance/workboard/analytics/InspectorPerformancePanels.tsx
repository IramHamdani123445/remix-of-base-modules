/**
 * Inspector Workboard — performance and trend intelligence panels.
 *
 * Presentation only: every figure comes from the server-side
 * ce_inspector_workboard_analytics aggregation, scoped to the signed-in
 * inspector. Missing data renders as an explicit "Unavailable" state.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Minus, HelpCircle, Timer, Target, Layers,
  MapPin, Building2, Repeat, Activity, AlertTriangle,
} from 'lucide-react';
import { formatDisplayDate } from '@/lib/dateFormat';
import {
  INSPECTOR_RANGES, pctDelta,
  type InspectorAnalytics, type InspectorRangeKey,
} from '@/hooks/compliance/useInspectorAnalytics';

const CHART_COLORS = {
  assigned: 'hsl(var(--primary))',
  completed: 'hsl(142 71% 45%)',
  overdue: 'hsl(var(--destructive))',
  resolved: 'hsl(142 71% 45%)',
  raised: 'hsl(var(--primary))',
  repeat: 'hsl(38 92% 50%)',
};

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'hsl(var(--primary))',
  IN_PROGRESS: 'hsl(199 89% 48%)',
  UNDER_REVIEW: 'hsl(38 92% 50%)',
  ESCALATED: 'hsl(var(--destructive))',
};

const PRIORITY_COLORS: Record<string, string> = {
  Critical: 'hsl(var(--destructive))',
  High: 'hsl(24 95% 53%)',
  Medium: 'hsl(38 92% 50%)',
  Low: 'hsl(199 89% 48%)',
};

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  UNDER_REVIEW: 'Under Review',
  ESCALATED: 'Escalated',
};

export function Unavailable({ hint }: { hint?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground">
          Unavailable <HelpCircle className="h-3.5 w-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {hint ?? 'This metric could not be loaded. It is not a zero — check your access or refresh.'}
      </TooltipContent>
    </Tooltip>
  );
}

function Delta({ value, invert }: { value: number | null; invert?: boolean }) {
  if (value === null) return <span className="text-xs text-muted-foreground">No prior period</span>;
  const rounded = Math.round(value * 10) / 10;
  const good = invert ? rounded <= 0 : rounded >= 0;
  const Icon = rounded === 0 ? Minus : rounded > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${good ? 'text-emerald-600' : 'text-destructive'}`}>
      <Icon className="h-3 w-3" />
      {rounded > 0 ? '+' : ''}{rounded}% vs previous
    </span>
  );
}

function bucketLabel(iso: string, grain: 'day' | 'week') {
  const d = new Date(`${iso}T00:00:00Z`);
  return grain === 'day'
    ? d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
    : `w/c ${d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}`;
}

interface PanelProps {
  data?: InspectorAnalytics;
  isLoading: boolean;
  unavailable: boolean;
}

export function InspectorRangeSelector({
  value, onChange, generatedAt,
}: { value: InspectorRangeKey; onChange: (v: InspectorRangeKey) => void; generatedAt?: string }) {
  return (
    <div className="flex items-center gap-3">
      {generatedAt && (
        <span className="hidden md:inline text-xs text-muted-foreground">
          As at {formatDisplayDate(new Date(generatedAt))}
        </span>
      )}
      <Select value={value} onValueChange={v => onChange(v as InspectorRangeKey)}>
        <SelectTrigger className="w-[170px] h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {INSPECTOR_RANGES.map(r => (
            <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Workload trend — assigned vs completed vs overdue over the period. */
export function WorkloadTrendPanel({ data, isLoading, unavailable }: PanelProps) {
  const series = (data?.workload ?? []).map(w => ({
    label: bucketLabel(w.b, data?.grain ?? 'day'),
    Assigned: w.assigned,
    Completed: w.completed,
    Overdue: w.overdue,
  }));
  const k = data?.kpis;

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Workload Trend
          </CardTitle>
          {k && !unavailable && (
            <div className="text-right">
              <div className="text-sm font-semibold">{k.assigned_period} assigned</div>
              <Delta value={pctDelta(k.assigned_period, k.assigned_prev)} />
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-[240px] w-full" />
          : unavailable ? <div className="h-[240px] flex items-center justify-center"><Unavailable /></div>
          : series.length === 0 ? <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">No activity in this period</div>
          : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <RTooltip contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="Assigned" stroke={CHART_COLORS.assigned} fill={CHART_COLORS.assigned} fillOpacity={0.15} strokeWidth={2} />
                <Area type="monotone" dataKey="Completed" stroke={CHART_COLORS.completed} fill={CHART_COLORS.completed} fillOpacity={0.15} strokeWidth={2} />
                <Area type="monotone" dataKey="Overdue" stroke={CHART_COLORS.overdue} fill={CHART_COLORS.overdue} fillOpacity={0.12} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
      </CardContent>
    </Card>
  );
}

/** Completion timeliness — on-time rate, throughput and average turnaround. */
export function TimelinessPanel({ data, isLoading, unavailable }: PanelProps) {
  const t = data?.timeliness;
  const onTimeRate = t && t.completed_with_due > 0 ? (t.on_time / t.completed_with_due) * 100 : null;
  const prevRate = t && t.prev_completed_with_due > 0 ? (t.prev_on_time / t.prev_completed_with_due) * 100 : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Timer className="h-4 w-4 text-primary" /> Completion Timeliness
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <Skeleton className="h-[200px] w-full" />
          : unavailable || !t ? <div className="h-[200px] flex items-center justify-center"><Unavailable /></div>
          : (
            <>
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">On-time completion</span>
                  <span className="text-2xl font-bold tabular-nums">
                    {onTimeRate === null ? '—' : `${onTimeRate.toFixed(1)}%`}
                  </span>
                </div>
                <Progress value={onTimeRate ?? 0} className="h-2 mt-2" />
                <div className="mt-1">
                  <Delta value={onTimeRate !== null && prevRate !== null ? onTimeRate - prevRate : null} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 pt-1">
                <div>
                  <p className="text-xs text-muted-foreground">Completed</p>
                  <p className="text-lg font-semibold tabular-nums">{t.completed}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">On time</p>
                  <p className="text-lg font-semibold tabular-nums text-emerald-600">{t.on_time}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Late</p>
                  <p className="text-lg font-semibold tabular-nums text-destructive">
                    {Math.max(t.completed_with_due - t.on_time, 0)}
                  </p>
                </div>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Average turnaround</p>
                <p className="text-lg font-semibold tabular-nums">
                  {t.avg_days === null ? '—' : `${Number(t.avg_days).toFixed(1)} days`}
                </p>
              </div>
            </>
          )}
      </CardContent>
    </Card>
  );
}

/** Compliance outcomes — raised vs resolved vs repeat non-compliance. */
export function OutcomesPanel({ data, isLoading, unavailable }: PanelProps) {
  const series = (data?.outcomes ?? []).map(o => ({
    label: bucketLabel(o.b, data?.grain ?? 'day'),
    Raised: o.raised,
    Resolved: o.resolved,
    Repeat: o.repeat_after_resolution,
  }));

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" /> Compliance Outcomes
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-[220px] w-full" />
          : unavailable ? <div className="h-[220px] flex items-center justify-center"><Unavailable /></div>
          : series.length === 0 ? <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">No violation outcomes in this period</div>
          : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <RTooltip contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="Raised" stroke={CHART_COLORS.raised} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Resolved" stroke={CHART_COLORS.resolved} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Repeat" stroke={CHART_COLORS.repeat} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
      </CardContent>
    </Card>
  );
}

/** Caseload health — open violations by status, priority and age. */
export function CaseloadHealthPanel({ data, isLoading, unavailable }: PanelProps) {
  const navigate = useNavigate();
  const caseload = data?.caseload;
  const ageing = (caseload?.ageing ?? []).map(a => ({ label: a.bucket, Violations: a.count }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" /> Caseload Health
          </CardTitle>
          {caseload && !unavailable && (
            <Badge variant="secondary">{caseload.total} open</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <Skeleton className="h-[260px] w-full" />
          : unavailable || !caseload ? <div className="h-[260px] flex items-center justify-center"><Unavailable /></div>
          : (
            <>
              <div className="space-y-1.5">
                {caseload.by_status.map(s => {
                  const pct = caseload.total ? (s.count / caseload.total) * 100 : 0;
                  return (
                    <button
                      key={s.status}
                      type="button"
                      onClick={() => navigate(`/compliance/violations?status=${s.status}`)}
                      className="w-full flex items-center gap-2 text-left hover:bg-muted/50 rounded px-1 py-0.5 transition-colors"
                    >
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: STATUS_COLORS[s.status] }} />
                      <span className="text-sm flex-1 truncate">{STATUS_LABEL[s.status] ?? s.status}</span>
                      <span className="text-sm font-semibold tabular-nums">{s.count}</span>
                      <span className="text-xs text-muted-foreground tabular-nums w-14 text-right">({pct.toFixed(1)}%)</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2 pt-1 border-t">
                {caseload.by_priority.map(p => (
                  <Badge key={p.priority} variant="outline" className="gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: PRIORITY_COLORS[p.priority] }} />
                    {p.priority}: <span className="tabular-nums font-semibold">{p.count}</span>
                  </Badge>
                ))}
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-1">Ageing of open violations</p>
                <ResponsiveContainer width="100%" height={130}>
                  <BarChart data={ageing} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <RTooltip contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Violations" radius={[4, 4, 0, 0]}>
                      {ageing.map((_, i) => (
                        <Cell key={i} fill={i >= 3 ? 'hsl(var(--destructive))' : 'hsl(var(--primary))'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
      </CardContent>
    </Card>
  );
}

/** Field activity — plan execution, inspections and what they produced. */
export function FieldActivityPanel({ data, isLoading, unavailable }: PanelProps) {
  const f = data?.field;
  const executionRate = f && f.planned > 0 ? (f.executed / f.planned) * 100 : null;

  const tiles = f ? [
    { label: 'Visits planned', value: f.planned },
    { label: 'Visits executed', value: f.executed },
    { label: 'Missed visits', value: f.missed, danger: true },
    { label: 'Inspections completed', value: f.inspections_completed },
    { label: 'Follow-ups generated', value: f.followups_generated },
    { label: 'Violations identified', value: f.violations_identified },
  ] : [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" /> Field Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <Skeleton className="h-[200px] w-full" />
          : unavailable || !f ? <div className="h-[200px] flex items-center justify-center"><Unavailable /></div>
          : (
            <>
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">Plan execution rate</span>
                  <span className="text-xl font-bold tabular-nums">
                    {executionRate === null ? '—' : `${executionRate.toFixed(1)}%`}
                  </span>
                </div>
                <Progress value={executionRate ?? 0} className="h-2 mt-2" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {tiles.map(t => (
                  <div key={t.label} className="rounded-md border p-2.5">
                    <p className="text-xs text-muted-foreground leading-tight">{t.label}</p>
                    <p className={`text-lg font-semibold tabular-nums ${t.danger && t.value > 0 ? 'text-destructive' : ''}`}>
                      {t.value}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
      </CardContent>
    </Card>
  );
}

/** Employers requiring attention within this inspector's own caseload. */
export function AttentionPanel({ data, isLoading, unavailable }: PanelProps) {
  const navigate = useNavigate();
  const rows = data?.attention ?? [];

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" /> Employers Requiring Attention
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => navigate('/compliance/violations')}>
            View all
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-[220px] w-full" />
          : unavailable ? <div className="h-[220px] flex items-center justify-center"><Unavailable /></div>
          : rows.length === 0 ? <div className="h-[160px] flex items-center justify-center text-sm text-muted-foreground">No employers in your caseload need attention</div>
          : (
            <div className="divide-y">
              {rows.map(r => (
                <button
                  key={r.employer_id}
                  type="button"
                  onClick={() => navigate(`/compliance/field/employer-360?employerId=${encodeURIComponent(r.employer_id)}`)}
                  className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-muted/50 transition-colors px-1 rounded"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{r.employer_name || r.employer_id}</p>
                    <p className="text-xs text-muted-foreground">
                      Oldest open: {r.oldest_open ? formatDisplayDate(new Date(`${r.oldest_open}T00:00:00`)) : '—'}
                      {r.overdue_actions > 0 && <> · <span className="text-destructive">{r.overdue_actions} overdue action(s)</span></>}
                    </p>
                  </div>
                  {r.risk_band && (
                    <Badge variant={/high|critical/i.test(r.risk_band) ? 'destructive' : 'secondary'} className="shrink-0">
                      {r.risk_band}
                    </Badge>
                  )}
                  <Badge variant="outline" className="shrink-0 tabular-nums">{r.open_violations} open</Badge>
                </button>
              ))}
            </div>
          )}
      </CardContent>
    </Card>
  );
}

/** Repeat non-compliance within the inspector's caseload. */
export function RepeatOffendersPanel({ data, isLoading, unavailable }: PanelProps) {
  const navigate = useNavigate();
  const rows = data?.repeats ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Repeat className="h-4 w-4 text-primary" /> Repeat Non-Compliance
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-[200px] w-full" />
          : unavailable ? <div className="h-[200px] flex items-center justify-center"><Unavailable /></div>
          : rows.length === 0 ? <div className="h-[140px] flex items-center justify-center text-sm text-muted-foreground">No repeat offenders in your caseload</div>
          : (
            <div className="space-y-2">
              {rows.map(r => (
                <button
                  key={r.employer_id}
                  type="button"
                  onClick={() => navigate(`/compliance/field/employer-360?employerId=${encodeURIComponent(r.employer_id)}`)}
                  className="w-full rounded-md border p-2.5 text-left hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium truncate">{r.employer_name || r.employer_id}</p>
                    <Badge variant="outline" className="tabular-nums shrink-0">{r.total_violations} total</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {r.open_violations} open · {r.resolved_violations} resolved
                    {r.missed_followups > 0 && <> · <span className="text-destructive">{r.missed_followups} missed follow-up(s)</span></>}
                  </p>
                </button>
              ))}
            </div>
          )}
      </CardContent>
    </Card>
  );
}

/** Recent activity feed across this inspector's violations and actions. */
export function RecentActivityPanel({ data, isLoading, unavailable }: PanelProps) {
  const rows = data?.recent ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-primary" /> Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-[200px] w-full" />
          : unavailable ? <div className="h-[200px] flex items-center justify-center"><Unavailable /></div>
          : rows.length === 0 ? <div className="h-[140px] flex items-center justify-center text-sm text-muted-foreground">No recent activity</div>
          : (
            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
              {rows.map((r, i) => (
                <div key={`${r.ref_id}-${i}`} className="flex items-start gap-2 border-b pb-2 last:border-0">
                  <Badge variant={r.kind === 'VIOLATION' ? 'secondary' : 'outline'} className="text-[10px] shrink-0">
                    {r.kind === 'VIOLATION' ? 'Violation' : 'Action'}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{r.subject || '—'}</p>
                    <p className="text-xs text-muted-foreground truncate">{r.label}{r.detail ? ` · ${r.detail}` : ''}</p>
                  </div>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {formatDisplayDate(new Date(r.at))}
                  </span>
                </div>
              ))}
            </div>
          )}
      </CardContent>
    </Card>
  );
}

export function InspectorPerformanceSection(props: PanelProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <WorkloadTrendPanel {...props} />
        <TimelinessPanel {...props} />
        <OutcomesPanel {...props} />
        <CaseloadHealthPanel {...props} />
        <AttentionPanel {...props} />
        <FieldActivityPanel {...props} />
        <RepeatOffendersPanel {...props} />
        <RecentActivityPanel {...props} />
      </div>
    </div>
  );
}
