/**
 * Presentation panels for the Compliance Legal Workbench
 * (/compliance/workbench/legal).
 *
 * Every panel is fed by the server-aggregated ce_legal_workbench_analytics
 * payload. Panels never convert an error into a zero — callers pass
 * `unavailable` so the panel can say so explicitly.
 */
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  AlertTriangle, ArrowRight, CalendarClock, CircleSlash, Clock, Gavel, Inbox,
  Loader2, TrendingDown, TrendingUp,
} from 'lucide-react';
import type { LegalAnalytics, LegalRangeKey } from '@/hooks/compliance/useLegalWorkbenchAnalytics';
import { LEGAL_RANGES } from '@/hooks/compliance/useLegalWorkbenchAnalytics';

export const fmtCurrency = (n: number | null | undefined) =>
  n == null
    ? '—'
    : new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'XCD', minimumFractionDigits: 0, maximumFractionDigits: 0,
      }).format(n);

export const fmtNum = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());

export const prettyCode = (s?: string | null) =>
  !s ? '—' : s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

export const fmtDate = (d?: string | null) =>
  !d ? '—' : new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', yyyy: undefined as never, year: 'numeric' });

const CHART_COLORS = [
  'hsl(var(--primary))',
  'hsl(210, 70%, 55%)',
  'hsl(160, 55%, 42%)',
  'hsl(35, 90%, 55%)',
  'hsl(280, 55%, 55%)',
  'hsl(var(--destructive))',
  'hsl(200, 30%, 55%)',
  'hsl(330, 55%, 55%)',
];

const tooltipStyle = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '8px',
  color: 'hsl(var(--popover-foreground))',
  fontSize: '12px',
};

/* ------------------------------------------------------------------ shell */

interface PanelProps {
  title: string;
  subtitle?: string;
  isLoading?: boolean;
  unavailable?: boolean;
  empty?: boolean;
  emptyMessage?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export const AnalyticsPanel: React.FC<PanelProps> = ({
  title, subtitle, isLoading, unavailable, empty, emptyMessage = 'No data for the selected period',
  action, className, children,
}) => (
  <Card className={className}>
    <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
      <div className="space-y-0.5">
        <CardTitle className="text-base">{title}</CardTitle>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </CardHeader>
    <CardContent>
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : unavailable ? (
        <div className="flex flex-col items-center py-10 text-center text-sm text-muted-foreground">
          <CircleSlash className="h-8 w-8 mb-2 opacity-50" />
          Metric unavailable — the analytics service did not return data.
        </div>
      ) : empty ? (
        <div className="flex flex-col items-center py-10 text-center text-sm text-muted-foreground">
          <Inbox className="h-8 w-8 mb-2 opacity-50" />
          {emptyMessage}
        </div>
      ) : (
        children
      )}
    </CardContent>
  </Card>
);

/* ---------------------------------------------------------------- range UI */

export const LegalRangeSelector: React.FC<{
  value: LegalRangeKey; onChange: (v: LegalRangeKey) => void;
}> = ({ value, onChange }) => (
  <div className="inline-flex rounded-md border border-border overflow-hidden">
    {LEGAL_RANGES.map(r => (
      <button
        key={r.key}
        type="button"
        onClick={() => onChange(r.key)}
        className={`px-3 py-1.5 text-xs transition-colors ${
          value === r.key ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'
        }`}
      >
        {r.label}
      </button>
    ))}
  </div>
);

/* ---------------------------------------------------------------- KPI card */

export interface KpiSpec {
  label: string;
  value: string;
  hint?: string;
  icon: React.ElementType;
  tone: 'primary' | 'warning' | 'destructive' | 'success' | 'muted';
  delta?: number | null;
  invertDelta?: boolean;
  onClick?: () => void;
}

const TONES: Record<KpiSpec['tone'], string> = {
  primary: 'text-primary',
  warning: 'text-amber-600',
  destructive: 'text-destructive',
  success: 'text-emerald-600',
  muted: 'text-muted-foreground',
};

export const LegalKpiCard: React.FC<{ kpi: KpiSpec; isLoading?: boolean; unavailable?: boolean }> = ({
  kpi, isLoading, unavailable,
}) => {
  const good = kpi.delta != null && (kpi.invertDelta ? kpi.delta < 0 : kpi.delta > 0);
  return (
    <Card
      role={kpi.onClick ? 'button' : undefined}
      tabIndex={kpi.onClick ? 0 : undefined}
      onClick={kpi.onClick}
      onKeyDown={e => { if (kpi.onClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); kpi.onClick(); } }}
      className={kpi.onClick ? 'cursor-pointer transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ring' : undefined}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{kpi.label}</CardTitle>
        <kpi.icon className={`h-4 w-4 ${TONES[kpi.tone]}`} />
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="text-2xl font-bold text-foreground">
          {isLoading ? '—' : unavailable ? 'Unavailable' : kpi.value}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {kpi.hint && <span>{kpi.hint}</span>}
          {!isLoading && !unavailable && kpi.delta != null && (
            <span className={`inline-flex items-center gap-0.5 ${good ? 'text-emerald-600' : 'text-destructive'}`}>
              {kpi.delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {Math.abs(kpi.delta)}% vs prev
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

/* ------------------------------------------------------------- attention */

export const LegalAttentionQueue: React.FC<{
  items: LegalAnalytics['attention']; isLoading?: boolean; unavailable?: boolean;
  onOpen: (link: string) => void;
}> = ({ items, isLoading, unavailable, onOpen }) => (
  <AnalyticsPanel
    title="Requires Legal Attention"
    subtitle="Referrals, actions, hearings, defaults and enforcement items that need a decision now"
    isLoading={isLoading}
    unavailable={unavailable}
    empty={!items?.length}
    emptyMessage="Nothing awaiting legal attention"
    action={items?.length ? <Badge variant="destructive">{items.length} open</Badge> : undefined}
  >
    <div className="max-h-[420px] overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Case / Referral</TableHead>
            <TableHead>Employer</TableHead>
            <TableHead>Required Action</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Due</TableHead>
            <TableHead className="text-right">Age (d)</TableHead>
            <TableHead>Assigned To</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((it, i) => (
            <TableRow key={`${it.kind}-${it.ref_id}-${i}`}>
              <TableCell className="font-mono text-xs">{it.ref || '—'}</TableCell>
              <TableCell className="text-xs">{it.employer || '—'}</TableCell>
              <TableCell className="text-xs">{it.action}</TableCell>
              <TableCell>
                <Badge variant={it.priority === 'Critical' ? 'destructive' : 'secondary'} className="text-[10px]">
                  {it.priority}
                </Badge>
              </TableCell>
              <TableCell className="text-xs">{it.due ? fmtDate(it.due) : '—'}</TableCell>
              <TableCell className="text-right text-xs">{it.age_days ?? '—'}</TableCell>
              <TableCell className="text-xs truncate max-w-[140px]">{it.assigned || 'Unassigned'}</TableCell>
              <TableCell className="text-right">
                <Button variant="ghost" size="sm" onClick={() => onOpen(it.link)}>
                  Open <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  </AnalyticsPanel>
);

/* ----------------------------------------------------------------- trend */

export const LegalTrendChart: React.FC<{
  data: LegalAnalytics['trend']; grain: string; isLoading?: boolean; unavailable?: boolean;
}> = ({ data, grain, isLoading, unavailable }) => (
  <AnalyticsPanel
    title="Legal Intake & Closure Trend"
    subtitle={`New referrals, cases opened and cases closed (${grain}ly)`}
    isLoading={isLoading}
    unavailable={unavailable}
    empty={!data?.length}
  >
    <ResponsiveContainer width="100%" height={270}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="b" stroke="hsl(var(--muted-foreground))" fontSize={11} />
        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="referrals" name="Referrals received" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="opened" name="Legal cases opened" stroke={CHART_COLORS[2]} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="closed" name="Cases closed" stroke={CHART_COLORS[5]} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  </AnalyticsPanel>
);

/* -------------------------------------------------------------- pipeline */

export const LegalPipelinePanel: React.FC<{
  data: LegalAnalytics['pipeline']; isLoading?: boolean; unavailable?: boolean;
  onDrill: (stage: LegalAnalytics['pipeline'][number]) => void;
}> = ({ data, isLoading, unavailable, onDrill }) => {
  const total = data?.reduce((s, d) => s + d.count, 0) || 0;
  return (
    <AnalyticsPanel
      title="Legal Process Pipeline"
      subtitle="Compliance handoff stages and canonical legal case stages — count, share, age in stage, overdue"
      isLoading={isLoading}
      unavailable={unavailable}
      empty={!data?.length}
    >
      <div className="space-y-2 max-h-[300px] overflow-auto pr-1">
        {data.map(stage => {
          const pct = total ? Math.round((stage.count / total) * 100) : 0;
          return (
            <button
              key={`${stage.lane}-${stage.stage_code}`}
              type="button"
              onClick={() => onDrill(stage)}
              className="w-full text-left rounded-md border border-border p-2.5 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant={stage.lane === 'LEGAL' ? 'default' : 'outline'} className="text-[10px]">
                    {stage.lane === 'LEGAL' ? 'Legal' : 'Compliance'}
                  </Badge>
                  <span className="text-sm font-medium truncate">{stage.stage_name}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                  <span>avg {stage.avg_age_days}d</span>
                  {stage.overdue > 0 && (
                    <Badge variant="destructive" className="text-[10px]">{stage.overdue} overdue</Badge>
                  )}
                  <span className="text-sm font-semibold text-foreground">{stage.count}</span>
                  <span>({pct}%)</span>
                </div>
              </div>
              <Progress value={pct} className="h-1.5 mt-2" />
            </button>
          );
        })}
      </div>
    </AnalyticsPanel>
  );
};

/* ---------------------------------------------------------------- ageing */

export const LegalAgeingPanel: React.FC<{
  ageing: LegalAnalytics['ageing']; isLoading?: boolean; unavailable?: boolean;
  onDrill: (bucket: string) => void;
}> = ({ ageing, isLoading, unavailable, onDrill }) => (
  <AnalyticsPanel
    title="Active Case Ageing"
    subtitle="Days since the legal case was opened"
    isLoading={isLoading}
    unavailable={unavailable}
    empty={!ageing?.buckets?.length}
  >
    <ResponsiveContainer width="100%" height={190}>
      <BarChart data={ageing?.buckets ?? []} layout="vertical" margin={{ left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
        <YAxis type="category" dataKey="bucket" stroke="hsl(var(--muted-foreground))" fontSize={11} width={62} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} cases`, 'Active']} />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} onClick={(d: never) => onDrill((d as { bucket: string }).bucket)} cursor="pointer">
          {(ageing?.buckets ?? []).map((b, i) => (
            <Cell key={b.bucket} fill={CHART_COLORS[Math.min(i, CHART_COLORS.length - 1)]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    <div className="grid grid-cols-3 gap-2 mt-3 text-center">
      <div className="rounded-md bg-muted/50 p-2">
        <p className="text-[11px] text-muted-foreground">Average age</p>
        <p className="text-sm font-semibold">{ageing?.avg_days != null ? `${ageing.avg_days} d` : '—'}</p>
      </div>
      <div className="rounded-md bg-muted/50 p-2">
        <p className="text-[11px] text-muted-foreground">Median age</p>
        <p className="text-sm font-semibold">{ageing?.median_days != null ? `${ageing.median_days} d` : '—'}</p>
      </div>
      <div className="rounded-md bg-muted/50 p-2">
        <p className="text-[11px] text-muted-foreground">Oldest active</p>
        <p className="text-sm font-semibold">{ageing?.oldest ? `${ageing.oldest.days} d` : '—'}</p>
        <p className="text-[10px] text-muted-foreground truncate">{ageing?.oldest?.case_no}</p>
      </div>
    </div>
  </AnalyticsPanel>
);

/* ------------------------------------------------------------ timeliness */

export const LegalTimelinessPanel: React.FC<{
  t: LegalAnalytics['timeliness']; isLoading?: boolean; unavailable?: boolean;
}> = ({ t, isLoading, unavailable }) => {
  const row = (label: string, value: number | null, n: number, unit = 'days') => (
    <div className="flex items-center justify-between border-b border-border/60 py-2 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">
        {value == null ? <span className="text-muted-foreground">No completed cycles</span> : `${value} ${unit}`}
        <span className="ml-2 text-[11px] text-muted-foreground">n={n}</span>
      </span>
    </div>
  );
  return (
    <AnalyticsPanel
      title="Process Timeliness & SLA"
      subtitle="Elapsed time between canonical lifecycle timestamps"
      isLoading={isLoading}
      unavailable={unavailable}
    >
      {row('Referral submitted → accepted by Legal', t?.referral_to_acceptance_days ?? null, t?.referral_to_acceptance_n ?? 0)}
      {row('Legal intake submitted → case opened', t?.intake_to_case_days ?? null, t?.intake_to_case_n ?? 0)}
      {row('Case opened → court filing / hearing listed', t?.referral_to_filing_days ?? null, t?.referral_to_filing_n ?? 0)}
      <div className="grid grid-cols-3 gap-2 mt-3">
        <div className="rounded-md bg-destructive/10 p-2 text-center">
          <p className="text-[11px] text-muted-foreground">Past next-action date</p>
          <p className="text-lg font-semibold text-destructive">{fmtNum(t?.past_next_action)}</p>
        </div>
        <div className="rounded-md bg-amber-500/10 p-2 text-center">
          <p className="text-[11px] text-muted-foreground">No next action set</p>
          <p className="text-lg font-semibold text-amber-600">{fmtNum(t?.no_next_action)}</p>
        </div>
        <div className="rounded-md bg-muted/50 p-2 text-center">
          <p className="text-[11px] text-muted-foreground">No activity 60+ days</p>
          <p className="text-lg font-semibold">{fmtNum(t?.stale_60d)}</p>
        </div>
      </div>
      {t && t.sla_rules_configured === 0 && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-amber-600">
          <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
          No Legal SLA rules are configured, so overdue is measured against each case's recorded
          next-action due date rather than a configured SLA target.
        </p>
      )}
    </AnalyticsPanel>
  );
};

/* ---------------------------------------------------------- court workload */

export const LegalCourtForecast: React.FC<{
  hearings: LegalAnalytics['hearings']; kpis: LegalAnalytics['kpis'];
  isLoading?: boolean; unavailable?: boolean; onDrill: () => void;
}> = ({ hearings, kpis, isLoading, unavailable, onDrill }) => (
  <AnalyticsPanel
    title="Court Workload Forecast"
    subtitle="Scheduled hearings for the next 12 weeks"
    isLoading={isLoading}
    unavailable={unavailable}
    empty={!hearings?.forecast?.length}
  >
    <div className="grid grid-cols-4 gap-2 mb-3">
      {[
        { l: 'Today', v: kpis?.hearings_today },
        { l: 'Next 7 days', v: kpis?.hearings_7d },
        { l: 'Next 30 days', v: kpis?.hearings_30d },
        { l: 'Past due', v: kpis?.hearings_overdue },
      ].map(x => (
        <button key={x.l} type="button" onClick={onDrill}
          className="rounded-md bg-muted/50 p-2 text-center hover:bg-muted transition-colors">
          <p className="text-[11px] text-muted-foreground">{x.l}</p>
          <p className="text-lg font-semibold">{fmtNum(x.v)}</p>
        </button>
      ))}
    </div>
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={hearings?.forecast ?? []}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="w" stroke="hsl(var(--muted-foreground))" fontSize={10} />
        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} hearings`, 'Week of']} />
        <Bar dataKey="count" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
    {hearings?.courts?.length > 0 && (
      <div className="flex flex-wrap gap-1.5 mt-3">
        {hearings.courts.map(c => (
          <Badge key={c.court} variant="outline" className="text-[10px]">{c.court}: {c.count}</Badge>
        ))}
      </div>
    )}
  </AnalyticsPanel>
);

const readiness = (h: LegalAnalytics['hearings']['upcoming'][number]) => {
  if (h.documents_ready === false || h.evidence_status === 'MISSING') return { label: 'Missing documents', variant: 'destructive' as const };
  if (h.prep_completed === false) return { label: 'Action required', variant: 'secondary' as const };
  if (h.documents_ready || h.prep_completed) return { label: 'Ready', variant: 'default' as const };
  return { label: 'Not recorded', variant: 'outline' as const };
};

export const LegalUpcomingHearings: React.FC<{
  hearings: LegalAnalytics['hearings']; isLoading?: boolean; unavailable?: boolean;
  onOpen: () => void;
}> = ({ hearings, isLoading, unavailable, onOpen }) => (
  <AnalyticsPanel
    title="Upcoming Court Hearings"
    subtitle="Next listed hearings with preparation readiness"
    isLoading={isLoading}
    unavailable={unavailable}
    empty={!hearings?.upcoming?.length}
    emptyMessage="No future hearings are currently listed"
    action={<Button variant="ghost" size="sm" onClick={onOpen}>Proceedings <ArrowRight className="h-3 w-3 ml-1" /></Button>}
  >
    <div className="max-h-[330px] overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Case</TableHead>
            <TableHead>Employer</TableHead>
            <TableHead>Court</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Officer</TableHead>
            <TableHead>Readiness</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(hearings?.upcoming ?? []).map(h => {
            const r = readiness(h);
            return (
              <TableRow key={h.id}>
                <TableCell className="font-mono text-xs">{h.case_no || '—'}</TableCell>
                <TableCell className="text-xs">{h.employer || '—'}</TableCell>
                <TableCell className="text-xs">{h.court || '—'}</TableCell>
                <TableCell className="text-xs">{fmtDate(h.date)}</TableCell>
                <TableCell className="text-xs">{prettyCode(h.type)}</TableCell>
                <TableCell className="text-xs truncate max-w-[120px]">{h.officer || 'Unassigned'}</TableCell>
                <TableCell><Badge variant={r.variant} className="text-[10px]">{r.label}</Badge></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
    {hearings?.past_due?.length > 0 && (
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-destructive">
        <CalendarClock className="h-3.5 w-3.5" />
        {hearings.past_due.length} listed hearing date(s) have passed without an outcome recorded.
      </p>
    )}
  </AnalyticsPanel>
);

/* -------------------------------------------------------------- outcomes */

export const LegalOutcomesPanel: React.FC<{
  outcomes: LegalAnalytics['outcomes']; isLoading?: boolean; unavailable?: boolean;
}> = ({ outcomes, isLoading, unavailable }) => {
  const data = outcomes?.case_outcomes ?? [];
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <AnalyticsPanel
      title="Legal Outcomes"
      subtitle="Closure reasons for cases closed in the selected period, plus hearing outcomes"
      isLoading={isLoading}
      unavailable={unavailable}
      empty={!data.length && !(outcomes?.hearing_outcomes?.length)}
    >
      {data.length > 0 && (
        <ResponsiveContainer width="100%" height={190}>
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="outcome" innerRadius={45} outerRadius={72} paddingAngle={2}>
              {data.map((d, i) => <Cell key={d.outcome} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: number, n: string) => [`${v} (${total ? Math.round((v / total) * 100) : 0}%)`, prettyCode(n)]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v: string) => prettyCode(v)} />
          </PieChart>
        </ResponsiveContainer>
      )}
      <div className="mt-3 space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Hearing outcomes in period</p>
        {(outcomes?.hearing_outcomes ?? []).map(h => (
          <div key={h.outcome} className="flex items-center justify-between text-xs">
            <span>{prettyCode(h.outcome)}</span><span className="font-medium">{h.count}</span>
          </div>
        ))}
        {!(outcomes?.hearing_outcomes ?? []).length && (
          <p className="text-xs text-muted-foreground">No hearings recorded in the selected period</p>
        )}
      </div>
    </AnalyticsPanel>
  );
};

export const LegalReferralQualityPanel: React.FC<{
  outcomes: LegalAnalytics['outcomes']; isLoading?: boolean; unavailable?: boolean;
}> = ({ outcomes, isLoading, unavailable }) => {
  const q = outcomes?.referral_quality;
  const data = q ? [
    { k: 'Accepted', v: q.accepted },
    { k: 'Returned', v: q.returned },
    { k: 'Rejected', v: q.rejected },
    { k: 'In flight', v: q.in_flight },
  ] : [];
  return (
    <AnalyticsPanel
      title="Referral Quality"
      subtitle="Accepted vs returned vs rejected legal referrals (all time)"
      isLoading={isLoading}
      unavailable={unavailable}
      empty={!data.length}
    >
      <ResponsiveContainer width="100%" height={170}>
        <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
          <YAxis type="category" dataKey="k" stroke="hsl(var(--muted-foreground))" fontSize={11} width={70} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} referrals`, 'Count']} />
          <Bar dataKey="v" radius={[0, 4, 4, 0]}>
            {data.map((d, i) => <Cell key={d.k} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-3">
        <p className="text-xs font-medium text-muted-foreground mb-1">Top return / rejection reasons</p>
        {(outcomes?.return_reasons ?? []).length ? (
          (outcomes.return_reasons).map(r => (
            <div key={r.reason} className="flex items-center justify-between text-xs py-0.5">
              <span className="truncate max-w-[75%]">{r.reason}</span><span className="font-medium">{r.count}</span>
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">No referrals have been returned or rejected</p>
        )}
      </div>
    </AnalyticsPanel>
  );
};

/* -------------------------------------------------------------- recovery */

export const LegalRecoveryPanel: React.FC<{
  recovery: LegalAnalytics['recovery']; isLoading?: boolean; unavailable?: boolean;
}> = ({ recovery, isLoading, unavailable }) => {
  const rate = recovery && recovery.assessed > 0 ? Math.round((recovery.paid / recovery.assessed) * 100) : null;
  return (
    <AnalyticsPanel
      title="Legal Recovery Performance"
      subtitle="Amounts assessed against legal cases, recovered through legal allocations, and outstanding"
      isLoading={isLoading}
      unavailable={unavailable}
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <div className="rounded-md bg-muted/50 p-2">
          <p className="text-[11px] text-muted-foreground">Placed under legal recovery</p>
          <p className="text-base font-semibold">{fmtCurrency(recovery?.assessed)}</p>
        </div>
        <div className="rounded-md bg-emerald-500/10 p-2">
          <p className="text-[11px] text-muted-foreground">Recovered (allocated)</p>
          <p className="text-base font-semibold text-emerald-600">{fmtCurrency(recovery?.paid)}</p>
        </div>
        <div className="rounded-md bg-destructive/10 p-2">
          <p className="text-[11px] text-muted-foreground">Outstanding</p>
          <p className="text-base font-semibold text-destructive">{fmtCurrency(recovery?.outstanding)}</p>
        </div>
        <div className="rounded-md bg-muted/50 p-2">
          <p className="text-[11px] text-muted-foreground">Recovery rate</p>
          <p className="text-base font-semibold">{rate == null ? 'Not calculable' : `${rate}%`}</p>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={190} className="mt-3">
        <AreaChart data={recovery?.series ?? []}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="b" stroke="hsl(var(--muted-foreground))" fontSize={10} />
          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [fmtCurrency(v), n === 'recovered' ? 'Recovered' : 'New exposure']} />
          <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v: string) => (v === 'recovered' ? 'Recovered' : 'New legal exposure')} />
          <Area type="monotone" dataKey="new_exposure" stroke={CHART_COLORS[5]} fill={CHART_COLORS[5]} fillOpacity={0.15} strokeWidth={2} />
          <Area type="monotone" dataKey="recovered" stroke={CHART_COLORS[2]} fill={CHART_COLORS[2]} fillOpacity={0.2} strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
      {recovery && recovery.dated_allocations === 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-600">
          <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
          Payment allocations carry no payment date, so the time series is plotted on the allocation
          record date. Treat period-level recovery timing as indicative until payment dates are captured.
        </p>
      )}
    </AnalyticsPanel>
  );
};

/* ---------------------------------------------------------- arrangements */

export const LegalArrangementHealth: React.FC<{
  arr: LegalAnalytics['arrangements']; isLoading?: boolean; unavailable?: boolean;
  onDrill: () => void;
}> = ({ arr, isLoading, unavailable, onDrill }) => (
  <AnalyticsPanel
    title="Settlement & Arrangement Health"
    subtitle="Payment arrangements attached to matters that reached Legal"
    isLoading={isLoading}
    unavailable={unavailable}
    empty={!arr?.health?.length}
    emptyMessage="No payment arrangements are linked to legal matters"
    action={<Button variant="ghost" size="sm" onClick={onDrill}>Breaches <ArrowRight className="h-3 w-3 ml-1" /></Button>}
  >
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
      <ResponsiveContainer width="100%" height={170}>
        <PieChart>
          <Pie data={arr?.health ?? []} dataKey="count" nameKey="bucket" innerRadius={40} outerRadius={68} paddingAngle={2}>
            {(arr?.health ?? []).map((d, i) => <Cell key={d.bucket} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [`${v} arrangements`, n]} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-2">
        <div className="flex justify-between text-xs"><span className="text-muted-foreground">Active</span><span className="font-medium">{fmtNum(arr?.active)}</span></div>
        <div className="flex justify-between text-xs"><span className="text-muted-foreground">Defaulted / breached</span><span className="font-medium text-destructive">{fmtNum(arr?.defaulted)}</span></div>
        <div className="flex justify-between text-xs"><span className="text-muted-foreground">Amount outstanding</span><span className="font-medium">{fmtCurrency(arr?.outstanding)}</span></div>
        {(arr?.items ?? []).slice(0, 4).map(it => (
          <div key={it.id} className="rounded-md border border-border p-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px]">{it.number}</span>
              <Badge variant="destructive" className="text-[10px]">{prettyCode(it.status)}</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground truncate">{it.employer}</p>
            <p className="text-[11px]">Outstanding {fmtCurrency((it.debt || 0) - (it.paid || 0))}</p>
          </div>
        ))}
      </div>
    </div>
    {arr && arr.linked_via_registry === 0 && (
      <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-600">
        <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
        No rows exist in the legal arrangement link registry, so arrangements are attributed to Legal
        through the compliance case that was referred.
      </p>
    )}
  </AnalyticsPanel>
);

/* ------------------------------------------------------- priority matters */

export const LegalPriorityMatters: React.FC<{
  items: LegalAnalytics['priority_matters']; isLoading?: boolean; unavailable?: boolean;
  onOpenCase: (caseId: string) => void; onOpenEmployer: (employerId: string | null) => void;
}> = ({ items, isLoading, unavailable, onOpenCase, onOpenEmployer }) => (
  <AnalyticsPanel
    title="Priority Legal Matters"
    subtitle="Highest outstanding exposure among active legal cases"
    isLoading={isLoading}
    unavailable={unavailable}
    empty={!items?.length}
  >
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Employer</TableHead>
          <TableHead>Case</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead className="text-right">Outstanding</TableHead>
          <TableHead>Legal Stage</TableHead>
          <TableHead className="text-right">Age (d)</TableHead>
          <TableHead>Next Action</TableHead>
          <TableHead>Officer</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map(m => (
          <TableRow key={m.case_id}>
            <TableCell className="text-xs">
              <button type="button" className="text-primary hover:underline text-left"
                onClick={() => onOpenEmployer(m.employer_id)}>
                {m.employer || m.employer_id || '—'}
              </button>
            </TableCell>
            <TableCell className="text-xs">
              <button type="button" className="font-mono text-primary hover:underline"
                onClick={() => onOpenCase(m.case_id)}>
                {m.case_no}
              </button>
            </TableCell>
            <TableCell><Badge variant="outline" className="text-[10px]">{prettyCode(m.priority) }</Badge></TableCell>
            <TableCell className="text-right text-xs font-medium">{fmtCurrency(m.outstanding)}</TableCell>
            <TableCell className="text-xs">{prettyCode(m.stage)}</TableCell>
            <TableCell className="text-right text-xs">{m.age_days}</TableCell>
            <TableCell className="text-xs">
              {m.next_action ? prettyCode(m.next_action) : <span className="text-muted-foreground">Not set</span>}
              {m.overdue && <Badge variant="destructive" className="ml-1 text-[10px]">Overdue</Badge>}
            </TableCell>
            <TableCell className="text-xs truncate max-w-[120px]">{m.officer || 'Unassigned'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </AnalyticsPanel>
);

/* ---------------------------------------------------------------- repeats */

export const LegalRepeatEscalations: React.FC<{
  items: LegalAnalytics['repeats']; isLoading?: boolean; unavailable?: boolean;
  onOpenEmployer: (employerId: string) => void;
}> = ({ items, isLoading, unavailable, onOpenEmployer }) => (
  <AnalyticsPanel
    title="Repeat Legal Escalations"
    subtitle="Employers referred to Legal more than once"
    isLoading={isLoading}
    unavailable={unavailable}
    empty={!items?.length}
    emptyMessage="No employer has been referred to Legal more than once"
  >
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Employer</TableHead>
          <TableHead className="text-right">Referrals</TableHead>
          <TableHead className="text-right">Accepted</TableHead>
          <TableHead className="text-right">Returned / Rejected</TableHead>
          <TableHead>First</TableHead>
          <TableHead>Latest</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map(r => (
          <TableRow key={r.employer_id}>
            <TableCell className="text-xs">
              <button type="button" className="text-primary hover:underline text-left" onClick={() => onOpenEmployer(r.employer_id)}>
                {r.employer || r.employer_id}
              </button>
            </TableCell>
            <TableCell className="text-right text-xs font-medium">{r.referrals}</TableCell>
            <TableCell className="text-right text-xs">{r.accepted}</TableCell>
            <TableCell className="text-right text-xs">{r.returned}</TableCell>
            <TableCell className="text-xs">{fmtDate(r.first_at)}</TableCell>
            <TableCell className="text-xs">{fmtDate(r.last_at)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </AnalyticsPanel>
);

/* --------------------------------------------------------------- officers */

export const LegalOfficerWorkload: React.FC<{
  items: LegalAnalytics['officers']; isLoading?: boolean; unavailable?: boolean;
}> = ({ items, isLoading, unavailable }) => (
  <AnalyticsPanel
    title="Legal Officer Workload"
    subtitle="Case distribution for workload balancing — not a performance ranking"
    isLoading={isLoading}
    unavailable={unavailable}
    empty={!items?.length}
  >
    <ResponsiveContainer width="100%" height={Math.max(160, (items?.length || 1) * 42)}>
      <BarChart data={items} layout="vertical" margin={{ left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
        <YAxis type="category" dataKey="officer" stroke="hsl(var(--muted-foreground))" fontSize={10} width={150}
          tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 16)}…` : v)} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="active" name="Active cases" stackId="a" fill={CHART_COLORS[0]} radius={[0, 0, 0, 0]} />
        <Bar dataKey="overdue" name="Overdue actions" stackId="a" fill={CHART_COLORS[5]} />
        <Bar dataKey="closed_period" name="Closed in period" stackId="a" fill={CHART_COLORS[2]} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
    <div className="mt-2 space-y-1">
      {items.map(o => (
        <div key={o.officer} className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="truncate max-w-[45%]">{o.officer}</span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1"><Gavel className="h-3 w-3" />{o.active}</span>
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{o.hearings_30d} hearings/30d</span>
            <span>{fmtCurrency(o.outstanding)}</span>
          </span>
        </div>
      ))}
    </div>
  </AnalyticsPanel>
);

/* -------------------------------------------------------- workflow notice */

export const ComplianceEscalationWorkflowStrip: React.FC<{
  workflow: LegalAnalytics['workflow']; isLoading?: boolean;
}> = ({ workflow, isLoading }) => {
  const active = (workflow ?? []).filter(w => w.enabled && !w.retired_at).sort((a, b) => a.stage_order - b.stage_order);
  const retired = (workflow ?? []).filter(w => !w.enabled || w.retired_at);
  if (isLoading || !active.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
      <span className="text-[11px] font-medium text-muted-foreground">Configured escalation workflow:</span>
      {active.map((s, i) => (
        <React.Fragment key={s.stage_code}>
          <Badge variant="secondary" className="text-[10px]">
            {s.stage_name || prettyCode(s.stage_code)}
            {s.delay_days ? ` · +${s.delay_days}d` : ''}
            {s.requires_approval ? ' · approval' : ''}
          </Badge>
          {i < active.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
        </React.Fragment>
      ))}
      {retired.length > 0 && (
        <span className="text-[10px] text-muted-foreground">
          (retired: {retired.map(r => prettyCode(r.stage_code)).join(', ')})
        </span>
      )}
    </div>
  );
};
