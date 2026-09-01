/**
 * Presentation panels for the Compliance Intelligence & Trend Analysis
 * workspace (/compliance/workbench/analytics).
 *
 * Every panel is fed by the server-aggregated ce_compliance_analytics_v1
 * payload. Panels never convert an error into a zero — callers pass
 * `unavailable` so the panel says so explicitly.
 */
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  ArrowRight, CircleSlash, Inbox, Loader2, TrendingDown, TrendingUp, X,
} from 'lucide-react';
import type {
  AnalyticsFilters, AnalyticsRangeKey, ComplianceAnalyticsPayload, SectionAvailability, SegmentRow,
} from '@/hooks/compliance/useComplianceAnalytics';
import { ANALYTICS_RANGES } from '@/hooks/compliance/useComplianceAnalytics';

/* ------------------------------------------------------------- formatting */

export const fmtCurrency = (n: number | null | undefined) =>
  n == null
    ? '—'
    : new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'XCD', minimumFractionDigits: 0, maximumFractionDigits: 0,
      }).format(n);

export const fmtCompact = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

export const fmtNum = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());

export const fmtPct = (n: number | null | undefined) => (n == null ? '—' : `${n}%`);

export const prettyCode = (s?: string | null) =>
  !s ? '—' : s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

export const fmtMonth = (b?: string | null) => {
  if (!b) return '—';
  const [y, m] = b.split('-');
  if (!y || !m) return b;
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
};

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

const BAND_COLORS: Record<string, string> = {
  LOW: 'hsl(160, 55%, 42%)',
  MEDIUM: 'hsl(35, 90%, 55%)',
  HIGH: 'hsl(20, 85%, 55%)',
  CRITICAL: 'hsl(var(--destructive))',
  UNSCORED: 'hsl(210, 12%, 60%)',
};

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
  availability?: SectionAvailability;
  empty?: boolean;
  emptyMessage?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export const AnalyticsPanel: React.FC<PanelProps> = ({
  title, subtitle, isLoading, unavailable, availability, empty,
  emptyMessage = 'No data for the selected period and filters', action, className, children,
}) => {
  const insufficient = availability === 'insufficient_history';
  const noData = empty || availability === 'no_data';
  return (
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
        ) : unavailable || availability === 'unavailable' ? (
          <div className="flex flex-col items-center py-10 text-center text-sm text-muted-foreground">
            <CircleSlash className="h-8 w-8 mb-2 opacity-50" />
            Metric unavailable — the analytics service did not return data.
          </div>
        ) : insufficient ? (
          <div className="flex flex-col items-center py-10 text-center text-sm text-muted-foreground">
            <Inbox className="h-8 w-8 mb-2 opacity-50" />
            Insufficient history to compute this trend for the selected window.
          </div>
        ) : noData ? (
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
};

/* ------------------------------------------------------------- filter bar */

export const AnalyticsFilterBar: React.FC<{
  rangeKey: AnalyticsRangeKey;
  onRangeChange: (v: AnalyticsRangeKey) => void;
  filters: AnalyticsFilters;
  onFiltersChange: (f: AnalyticsFilters) => void;
  onClear: () => void;
  options?: ComplianceAnalyticsPayload['options'];
  activeFilterCount: number;
}> = ({ rangeKey, onRangeChange, filters, onFiltersChange, onClear, options, activeFilterCount }) => {
  const set = (patch: Partial<AnalyticsFilters>) => onFiltersChange({ ...filters, ...patch });
  const ALL = '__all__';

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-2 p-4">
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          {ANALYTICS_RANGES.map(r => (
            <button
              key={r.key}
              type="button"
              onClick={() => onRangeChange(r.key)}
              className={`px-3 py-1.5 text-xs transition-colors ${
                rangeKey === r.key ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <Select value={filters.zone ?? ALL} onValueChange={v => set({ zone: v === ALL ? null : v })}>
          <SelectTrigger className="w-[160px] h-9 text-xs"><SelectValue placeholder="Zone" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All zones</SelectItem>
            {Array.from(new Map((options?.zones ?? []).map(z => [z.code, z])).values()).map(z => (
              <SelectItem key={z.code} value={z.code}>{z.name || z.code}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.riskBand ?? ALL} onValueChange={v => set({ riskBand: v === ALL ? null : v })}>
          <SelectTrigger className="w-[150px] h-9 text-xs"><SelectValue placeholder="Risk band" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All risk bands</SelectItem>
            {(options?.risk_bands ?? []).map(b => (
              <SelectItem key={b} value={b}>{prettyCode(b)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.violationType ?? ALL} onValueChange={v => set({ violationType: v === ALL ? null : v })}>
          <SelectTrigger className="w-[190px] h-9 text-xs"><SelectValue placeholder="Violation type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All violation types</SelectItem>
            {Array.from(new Map((options?.violation_types ?? []).map(t => [t.code, t])).values()).map(t => (
              <SelectItem key={t.code} value={t.code}>{t.name || t.code}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.sector ?? ALL} onValueChange={v => set({ sector: v === ALL ? null : v })}>
          <SelectTrigger className="w-[150px] h-9 text-xs"><SelectValue placeholder="Sector" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All sectors</SelectItem>
            {(options?.sectors ?? []).slice(0, 60).map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.sizeTier ?? ALL} onValueChange={v => set({ sizeTier: v === ALL ? null : v })}>
          <SelectTrigger className="w-[150px] h-9 text-xs"><SelectValue placeholder="Employer size" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All employer sizes</SelectItem>
            {(options?.size_tiers ?? ['MICRO', 'SMALL', 'MEDIUM', 'LARGE']).map(s => (
              <SelectItem key={s} value={s}>{prettyCode(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {activeFilterCount > 0 && (
          <Button variant="ghost" size="sm" onClick={onClear} className="gap-1.5 text-muted-foreground">
            <X className="h-3.5 w-3.5" />Clear {activeFilterCount}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

/* ---------------------------------------------------------------- KPI card */

export interface AnalyticsKpi {
  label: string;
  value: string;
  hint?: string;
  definition?: string;
  icon: React.ElementType;
  tone: 'primary' | 'warning' | 'destructive' | 'success' | 'muted';
  delta?: number | null;
  deltaSuffix?: string;
  invertDelta?: boolean;
  onClick?: () => void;
}

const TONES: Record<AnalyticsKpi['tone'], string> = {
  primary: 'text-primary',
  warning: 'text-amber-600',
  destructive: 'text-destructive',
  success: 'text-emerald-600',
  muted: 'text-muted-foreground',
};

export const AnalyticsKpiCard: React.FC<{ kpi: AnalyticsKpi; isLoading?: boolean; unavailable?: boolean }> = ({
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
      title={kpi.definition}
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
              {Math.abs(kpi.delta)}{kpi.deltaSuffix ?? '%'} vs prev
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

/* ------------------------------------------------------------ trend panels */

export const ViolationFlowPanel: React.FC<{
  data: ComplianceAnalyticsPayload['violation_flow'];
  isLoading?: boolean; unavailable?: boolean; onDrill?: () => void; className?: string;
}> = ({ data, isLoading, unavailable, onDrill, className }) => (
  <AnalyticsPanel
    className={className}
    title="Violations Raised vs Resolved"
    subtitle="Monthly inflow against closure — the workload balance of the enforcement pipeline"
    isLoading={isLoading}
    unavailable={unavailable}
    empty={!data.length}
    action={onDrill && (
      <Button variant="ghost" size="sm" onClick={onDrill} className="text-xs">
        Violations<ArrowRight className="h-3.5 w-3.5 ml-1" />
      </Button>
    )}
  >
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="ca-opened" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="b" tickFormatter={fmtMonth} tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={v => fmtCompact(v as number)} />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={l => fmtMonth(String(l))} formatter={(v: number) => fmtNum(v)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area type="monotone" dataKey="opened" name="Raised" stroke="hsl(var(--primary))" fill="url(#ca-opened)" strokeWidth={2} />
        <Line type="monotone" dataKey="resolved" name="Resolved" stroke="hsl(160, 55%, 42%)" strokeWidth={2} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  </AnalyticsPanel>
);

export const ViolationTypeTrendPanel: React.FC<{
  data: ComplianceAnalyticsPayload['violation_type_trend'];
  isLoading?: boolean; unavailable?: boolean; onSelect?: (code: string) => void;
}> = ({ data, isLoading, unavailable, onSelect }) => (
  <AnalyticsPanel
    title="Violation Mix — Period vs Previous"
    subtitle="Which non-compliance behaviours are growing or receding"
    isLoading={isLoading}
    unavailable={unavailable}
    empty={!data.length}
  >
    <div className="space-y-2">
      {data.slice(0, 8).map(t => {
        const delta = t.previous > 0 ? Math.round(((t.current - t.previous) / t.previous) * 100) : null;
        return (
          <button
            key={t.type_code}
            type="button"
            onClick={() => onSelect?.(t.type_code)}
            className="w-full rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-muted"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium truncate">{t.type_name}</span>
              <span className="text-sm font-semibold tabular-nums">{fmtNum(t.current)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{fmtCurrency(t.amount)} exposure · {fmtNum(t.previous)} previous</span>
              {delta != null && (
                <span className={delta > 0 ? 'text-destructive' : 'text-emerald-600'}>
                  {delta > 0 ? '+' : ''}{delta}%
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  </AnalyticsPanel>
);

export const C3BehaviourPanel: React.FC<{
  data: ComplianceAnalyticsPayload['c3_behaviour'];
  missing: ComplianceAnalyticsPayload['c3_missing'];
  isLoading?: boolean; unavailable?: boolean; availability?: SectionAvailability;
}> = ({ data, missing, isLoading, unavailable, availability }) => (
  <AnalyticsPanel
    title="Contribution Filing Behaviour (C3)"
    subtitle="Returns received per month by posting state, from cn_c3_reported"
    isLoading={isLoading}
    unavailable={unavailable}
    availability={availability}
    empty={!data.length}
  >
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="b" tickFormatter={fmtMonth} tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={v => fmtCompact(v as number)} />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={l => fmtMonth(String(l))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="posted" name="Posted" stackId="c3" fill="hsl(160, 55%, 42%)" />
        <Bar dataKey="pending" name="Draft / pending" stackId="c3" fill="hsl(35, 90%, 55%)" />
        <Bar dataKey="nil" name="Nil returns" stackId="c3" fill="hsl(210, 12%, 60%)" />
      </BarChart>
    </ResponsiveContainer>
    {missing.length > 0 && (
      <p className="mt-3 text-[11px] text-muted-foreground">
        Latest missing-return periods: {missing.slice(0, 4).map(m => `${m.period} (${fmtNum(m.count)})`).join(' · ')}
      </p>
    )}
  </AnalyticsPanel>
);

export const PaymentBehaviourPanel: React.FC<{
  data: ComplianceAnalyticsPayload['payment_behaviour'];
  isLoading?: boolean; unavailable?: boolean; availability?: SectionAvailability;
}> = ({ data, isLoading, unavailable, availability }) => (
  <AnalyticsPanel
    title="Payment Behaviour"
    subtitle="Receipts recorded per month and value collected"
    isLoading={isLoading}
    unavailable={unavailable}
    availability={availability}
    empty={!data.length}
  >
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="b" tickFormatter={fmtMonth} tick={{ fontSize: 11 }} />
        <YAxis yAxisId="l" tick={{ fontSize: 11 }} tickFormatter={v => fmtCompact(v as number)} />
        <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} tickFormatter={v => fmtCompact(v as number)} />
        <Tooltip
          contentStyle={tooltipStyle}
          labelFormatter={l => fmtMonth(String(l))}
          formatter={(v: number, n: string) => (n === 'Value' ? fmtCurrency(v) : fmtNum(v))}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar yAxisId="l" dataKey="payments" name="Receipts" fill="hsl(210, 70%, 55%)" />
        <Line yAxisId="r" type="monotone" dataKey="amount" name="Value" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
      </BarChart>
    </ResponsiveContainer>
  </AnalyticsPanel>
);

export const ArrearsPanel: React.FC<{
  trend: ComplianceAnalyticsPayload['arrears_trend'];
  top: ComplianceAnalyticsPayload['arrears_top'];
  isLoading?: boolean; unavailable?: boolean; availability?: SectionAvailability;
  onOpenEmployer?: (id: string) => void;
}> = ({ trend, top, isLoading, unavailable, availability, onOpenEmployer }) => (
  <AnalyticsPanel
    title="Outstanding Balances by Period"
    subtitle="Principal, penalty and interest still outstanding on the compliance ledger"
    isLoading={isLoading}
    unavailable={unavailable}
    availability={availability}
    empty={!trend.length}
  >
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={[...trend].reverse()}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="period" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={v => fmtCompact(v as number)} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmtCurrency(v)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="principal" name="Principal" stackId="a" fill="hsl(var(--primary))" />
        <Bar dataKey="penalty" name="Penalty" stackId="a" fill="hsl(35, 90%, 55%)" />
        <Bar dataKey="interest" name="Interest" stackId="a" fill="hsl(280, 55%, 55%)" />
      </BarChart>
    </ResponsiveContainer>
    {top.length > 0 && (
      <div className="mt-4 space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Largest outstanding balances</p>
        {top.slice(0, 5).map(e => (
          <button
            key={e.employer_id}
            type="button"
            onClick={() => onOpenEmployer?.(e.employer_id)}
            className="flex w-full items-center justify-between rounded-md border border-border px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted"
          >
            <span className="truncate">{e.employer || e.employer_id}</span>
            <span className="font-semibold tabular-nums">{fmtCurrency(e.outstanding)}</span>
          </button>
        ))}
      </div>
    )}
  </AnalyticsPanel>
);

export const RiskPanel: React.FC<{
  bands: ComplianceAnalyticsPayload['risk_bands'];
  migration: ComplianceAnalyticsPayload['risk_migration'];
  drivers: ComplianceAnalyticsPayload['risk_drivers'];
  isLoading?: boolean; unavailable?: boolean; migrationAvailability?: SectionAvailability;
}> = ({ bands, migration, drivers, isLoading, unavailable, migrationAvailability }) => {
  const improved = migration.filter(m => m.direction === 'IMPROVED').reduce((s, m) => s + m.count, 0);
  const worsened = migration.filter(m => m.direction === 'DETERIORATED').reduce((s, m) => s + m.count, 0);
  const driverRows = [
    { label: 'Arrears', value: drivers?.arrears },
    { label: 'Violations', value: drivers?.violation },
    { label: 'Filing', value: drivers?.filing },
    { label: 'Legal history', value: drivers?.legal_history },
    { label: 'Payment behaviour', value: drivers?.payment_behavior },
  ];
  const maxDriver = Math.max(1, ...driverRows.map(d => Number(d.value ?? 0)));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <AnalyticsPanel
        title="Risk Band Distribution"
        subtitle="Current scored population within the filtered employer set"
        isLoading={isLoading}
        unavailable={unavailable}
        empty={!bands.length}
      >
        <ResponsiveContainer width="100%" height={230}>
          <PieChart>
            <Pie data={bands} dataKey="count" nameKey="band" innerRadius={55} outerRadius={90} paddingAngle={2}>
              {bands.map(b => <Cell key={b.band} fill={BAND_COLORS[b.band] ?? 'hsl(210, 12%, 60%)'} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [fmtNum(v), prettyCode(n)]} />
            <Legend wrapperStyle={{ fontSize: 12 }} formatter={v => prettyCode(String(v))} />
          </PieChart>
        </ResponsiveContainer>
        <div className="mt-3 space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Average factor contribution</p>
          {driverRows.map(d => (
            <div key={d.label} className="flex items-center gap-2">
              <span className="w-36 shrink-0 text-xs text-muted-foreground">{d.label}</span>
              <Progress value={(Number(d.value ?? 0) / maxDriver) * 100} className="h-1.5" />
              <span className="w-10 text-right text-xs tabular-nums">{d.value ?? '—'}</span>
            </div>
          ))}
        </div>
      </AnalyticsPanel>

      <AnalyticsPanel
        title="Risk Migration"
        subtitle="Band changes recorded in the period (ce_risk_score_history)"
        isLoading={isLoading}
        unavailable={unavailable}
        availability={migrationAvailability}
        empty={!migration.length}
      >
        <div className="mb-3 flex gap-3">
          <div className="flex-1 rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Improved</p>
            <p className="text-xl font-bold text-emerald-600">{fmtNum(improved)}</p>
          </div>
          <div className="flex-1 rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Deteriorated</p>
            <p className="text-xl font-bold text-destructive">{fmtNum(worsened)}</p>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">From</TableHead>
              <TableHead className="text-xs">To</TableHead>
              <TableHead className="text-xs text-right">Employers</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {migration.slice(0, 8).map((m, i) => (
              <TableRow key={`${m.from_band}-${m.to_band}-${i}`}>
                <TableCell className="text-xs">{prettyCode(m.from_band)}</TableCell>
                <TableCell className="text-xs">
                  <Badge variant={m.direction === 'DETERIORATED' ? 'destructive' : 'outline'} className="text-[10px]">
                    {prettyCode(m.to_band)}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-right tabular-nums">{fmtNum(m.count)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AnalyticsPanel>
    </div>
  );
};

export const ResolutionEffectivenessPanel: React.FC<{
  resolution: ComplianceAnalyticsPayload['resolution_time'];
  isLoading?: boolean; unavailable?: boolean;
}> = ({ resolution, isLoading, unavailable }) => (
  <AnalyticsPanel
    title="Resolution Effectiveness"
    subtitle="Time from discovery to resolution, and the status profile of the period's violations"
    isLoading={isLoading}
    unavailable={unavailable}
    empty={!resolution?.buckets?.length && !resolution?.status_mix?.length}
  >
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Days to resolution · average {resolution?.avg_days ?? '—'}
          {resolution?.prev_avg_days != null && ` (prev ${resolution.prev_avg_days})`}
        </p>
        <ResponsiveContainer width="100%" height={210}>
          <BarChart data={resolution?.buckets ?? []}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => fmtCompact(v as number)} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmtNum(v)} />
            <Bar dataKey="count" name="Violations" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Status of violations raised in the period</p>
        <div className="space-y-1.5">
          {(resolution?.status_mix ?? []).map((s, i) => {
            const total = (resolution?.status_mix ?? []).reduce((a, b) => a + b.count, 0) || 1;
            return (
              <div key={s.status} className="flex items-center gap-2">
                <span className="w-32 shrink-0 text-xs text-muted-foreground">{prettyCode(s.status)}</span>
                <Progress value={(s.count / total) * 100} className="h-1.5" />
                <span className="w-16 text-right text-xs tabular-nums">{fmtNum(s.count)}</span>
                <span className="w-12 text-right text-[11px] text-muted-foreground">
                  {Math.round((s.count / total) * 100)}%
                </span>
                <span className="sr-only">{CHART_COLORS[i % CHART_COLORS.length]}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  </AnalyticsPanel>
);

export const EnforcementActivityPanel: React.FC<{
  inspections: ComplianceAnalyticsPayload['inspections'];
  arrangements: ComplianceAnalyticsPayload['arrangements'];
  legal: ComplianceAnalyticsPayload['legal_trend'];
  availability: Record<string, SectionAvailability>;
  isLoading?: boolean; unavailable?: boolean;
  onDrill?: (path: string) => void;
}> = ({ inspections, arrangements, legal, availability, isLoading, unavailable, onDrill }) => (
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <AnalyticsPanel
      title="Inspection Effectiveness"
      subtitle="Field inspections scheduled in the period"
      isLoading={isLoading}
      unavailable={unavailable}
      availability={availability.inspections}
      action={onDrill && (
        <Button variant="ghost" size="sm" className="text-xs" onClick={() => onDrill('/compliance/field/inspections')}>
          Open<ArrowRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      )}
    >
      <div className="grid grid-cols-3 gap-2 text-center">
        <div><p className="text-xl font-bold">{fmtNum(inspections?.total)}</p><p className="text-[11px] text-muted-foreground">Scheduled</p></div>
        <div><p className="text-xl font-bold text-emerald-600">{fmtNum(inspections?.completed)}</p><p className="text-[11px] text-muted-foreground">Completed</p></div>
        <div><p className="text-xl font-bold text-amber-600">{fmtNum(inspections?.with_findings)}</p><p className="text-[11px] text-muted-foreground">With findings</p></div>
      </div>
      {(inspections?.series?.length ?? 0) > 0 && (
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={inspections.series}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="b" tickFormatter={fmtMonth} tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={l => fmtMonth(String(l))} />
            <Line type="monotone" dataKey="count" name="Inspections" stroke="hsl(210, 70%, 55%)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">Low-volume dataset — read directionally.</p>
    </AnalyticsPanel>

    <AnalyticsPanel
      title="Arrangement Performance"
      subtitle="Payment arrangements and breach exposure"
      isLoading={isLoading}
      unavailable={unavailable}
      availability={availability.arrangements}
      action={onDrill && (
        <Button variant="ghost" size="sm" className="text-xs" onClick={() => onDrill('/compliance/enforcement/arrangements')}>
          Open<ArrowRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      )}
    >
      <div className="grid grid-cols-2 gap-3">
        <div><p className="text-xl font-bold">{fmtNum(arrangements?.active)}</p><p className="text-[11px] text-muted-foreground">Active</p></div>
        <div><p className="text-xl font-bold text-destructive">{fmtNum(arrangements?.breached)}</p><p className="text-[11px] text-muted-foreground">Breached</p></div>
        <div><p className="text-sm font-semibold">{fmtCurrency(arrangements?.debt)}</p><p className="text-[11px] text-muted-foreground">Debt under arrangement</p></div>
        <div><p className="text-sm font-semibold text-emerald-600">{fmtCurrency(arrangements?.paid)}</p><p className="text-[11px] text-muted-foreground">Paid to date</p></div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Low-volume dataset — read directionally.</p>
    </AnalyticsPanel>

    <AnalyticsPanel
      title="Legal Escalation Trend"
      subtitle="Referrals raised to Legal in the period"
      isLoading={isLoading}
      unavailable={unavailable}
      availability={availability.legal}
      empty={!legal?.length}
      action={onDrill && (
        <Button variant="ghost" size="sm" className="text-xs" onClick={() => onDrill('/compliance/enforcement/proceedings')}>
          Open<ArrowRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      )}
    >
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={legal}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="b" tickFormatter={fmtMonth} tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={l => fmtMonth(String(l))} />
          <Bar dataKey="referrals" name="Referrals" fill="hsl(280, 55%, 55%)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </AnalyticsPanel>
  </div>
);

/* ------------------------------------------------------------ segmentation */

const SegmentTable: React.FC<{ rows: SegmentRow[]; label: string; onSelect?: (seg: string) => void }> = ({
  rows, label, onSelect,
}) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead className="text-xs">{label}</TableHead>
        <TableHead className="text-xs text-right">Employers</TableHead>
        <TableHead className="text-xs text-right">Violations</TableHead>
        <TableHead className="text-xs text-right">Resolved</TableHead>
        <TableHead className="text-xs text-right">Exposure</TableHead>
        <TableHead className="text-xs text-right">Resolution</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {rows.slice(0, 12).map(r => (
        <TableRow
          key={r.segment}
          className={onSelect ? 'cursor-pointer' : undefined}
          onClick={() => onSelect?.(r.segment)}
        >
          <TableCell className="text-xs font-medium">{prettyCode(r.segment)}</TableCell>
          <TableCell className="text-xs text-right tabular-nums">{fmtNum(r.employers)}</TableCell>
          <TableCell className="text-xs text-right tabular-nums">{fmtNum(r.violations)}</TableCell>
          <TableCell className="text-xs text-right tabular-nums">{fmtNum(r.resolved)}</TableCell>
          <TableCell className="text-xs text-right tabular-nums">{fmtCurrency(r.amount)}</TableCell>
          <TableCell className="text-xs text-right tabular-nums">{fmtPct(r.rate)}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const SegmentComparisonPanel: React.FC<{
  zones: SegmentRow[]; sectors: SegmentRow[]; sizes: SegmentRow[];
  isLoading?: boolean; unavailable?: boolean;
  onSelectZone?: (seg: string) => void;
  onSelectSector?: (seg: string) => void;
  onSelectSize?: (seg: string) => void;
}> = ({ zones, sectors, sizes, isLoading, unavailable, onSelectZone, onSelectSector, onSelectSize }) => (
  <AnalyticsPanel
    title="Segment Comparison"
    subtitle="Where non-compliance concentrates — by zone, economic sector and employer size"
    isLoading={isLoading}
    unavailable={unavailable}
    empty={!zones.length && !sectors.length && !sizes.length}
  >
    <Tabs defaultValue="zone">
      <TabsList>
        <TabsTrigger value="zone" className="text-xs">Zone</TabsTrigger>
        <TabsTrigger value="sector" className="text-xs">Sector</TabsTrigger>
        <TabsTrigger value="size" className="text-xs">Employer size</TabsTrigger>
      </TabsList>
      <TabsContent value="zone" className="mt-4">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={zones.slice(0, 10)}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="segment" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => fmtCompact(v as number)} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmtNum(v)} />
            <Bar dataKey="violations" name="Violations" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <SegmentTable rows={zones} label="Zone" onSelect={onSelectZone} />
      </TabsContent>
      <TabsContent value="sector" className="mt-4">
        <SegmentTable rows={sectors} label="Sector" onSelect={onSelectSector} />
      </TabsContent>
      <TabsContent value="size" className="mt-4">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={sizes}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="segment" tick={{ fontSize: 11 }} tickFormatter={v => prettyCode(String(v))} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => fmtCompact(v as number)} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmtNum(v)} />
            <Bar dataKey="violations" name="Violations" fill="hsl(210, 70%, 55%)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <SegmentTable rows={sizes} label="Employer size" onSelect={onSelectSize} />
      </TabsContent>
    </Tabs>
  </AnalyticsPanel>
);

/* --------------------------------------------------------------- watchlists */

export const PersistentEmployersPanel: React.FC<{
  items: ComplianceAnalyticsPayload['persistent_employers'];
  isLoading?: boolean; unavailable?: boolean; onOpenEmployer?: (id: string) => void;
}> = ({ items, isLoading, unavailable, onOpenEmployer }) => (
  <AnalyticsPanel
    title="Persistent Non-Compliance Watchlist"
    subtitle="Employers with repeated violations in the period"
    isLoading={isLoading}
    unavailable={unavailable}
    empty={!items.length}
    emptyMessage="No employer recorded more than one violation in this window"
  >
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-xs">Employer</TableHead>
          <TableHead className="text-xs">Zone</TableHead>
          <TableHead className="text-xs text-right">Violations</TableHead>
          <TableHead className="text-xs text-right">Still open</TableHead>
          <TableHead className="text-xs text-right">Exposure</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map(e => (
          <TableRow key={e.employer_id} className="cursor-pointer" onClick={() => onOpenEmployer?.(e.employer_id)}>
            <TableCell className="text-xs font-medium">{e.employer || e.employer_id}</TableCell>
            <TableCell className="text-xs">{e.zone ?? '—'}</TableCell>
            <TableCell className="text-xs text-right tabular-nums">{fmtNum(e.violations)}</TableCell>
            <TableCell className="text-xs text-right tabular-nums">{fmtNum(e.open)}</TableCell>
            <TableCell className="text-xs text-right tabular-nums">{fmtCurrency(e.amount)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </AnalyticsPanel>
);

export const ImprovingEmployersPanel: React.FC<{
  items: ComplianceAnalyticsPayload['improving_employers'];
  isLoading?: boolean; unavailable?: boolean; onOpenEmployer?: (id: string) => void;
}> = ({ items, isLoading, unavailable, onOpenEmployer }) => (
  <AnalyticsPanel
    title="Most Improved Employers"
    subtitle="Largest reduction in violations against the previous comparable window"
    isLoading={isLoading}
    unavailable={unavailable}
    empty={!items.length}
    emptyMessage="No employer reduced its violation count against the previous window"
  >
    <div className="space-y-1.5">
      {items.map(e => (
        <button
          key={e.employer_id}
          type="button"
          onClick={() => onOpenEmployer?.(e.employer_id)}
          className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-muted"
        >
          <span className="truncate text-xs font-medium">{e.employer || e.employer_id}</span>
          <span className="flex items-center gap-3 text-xs">
            <span className="text-muted-foreground tabular-nums">{fmtNum(e.previous)} → {fmtNum(e.current)}</span>
            <span className="inline-flex items-center gap-0.5 text-emerald-600 tabular-nums">
              <TrendingDown className="h-3 w-3" />{e.change}
            </span>
          </span>
        </button>
      ))}
    </div>
  </AnalyticsPanel>
);

export const KeyObservations: React.FC<{
  data?: ComplianceAnalyticsPayload; isLoading?: boolean; unavailable?: boolean;
}> = ({ data, isLoading, unavailable }) => {
  const notes = React.useMemo(() => {
    if (!data) return [];
    const out: string[] = [];
    const k = data.kpis;
    if (k.violations_new_prev > 0) {
      const d = Math.round(((k.violations_new - k.violations_new_prev) / k.violations_new_prev) * 100);
      out.push(`Violations raised ${d >= 0 ? 'rose' : 'fell'} ${Math.abs(d)}% against the previous comparable window (${fmtNum(k.violations_new)} vs ${fmtNum(k.violations_new_prev)}).`);
    }
    if (k.resolution_rate != null) {
      out.push(`Resolution rate is ${k.resolution_rate}% — ${fmtNum(k.resolution_numerator)} resolved against ${fmtNum(k.resolution_denominator)} raised in the window.`);
    }
    if (k.employers_in_arrears > 0) {
      out.push(`${fmtNum(k.employers_in_arrears)} employers carry outstanding balances totalling ${fmtCurrency(k.total_outstanding)}.`);
    }
    const topType = data.violation_type_trend?.[0];
    if (topType) {
      out.push(`${topType.type_name} dominates the mix with ${fmtNum(topType.current)} violations and ${fmtCurrency(topType.amount)} exposure.`);
    }
    const topZone = data.zone_comparison?.[0];
    if (topZone) {
      out.push(`Zone ${prettyCode(topZone.segment)} carries the highest volume (${fmtNum(topZone.violations)} violations across ${fmtNum(topZone.employers)} employers).`);
    }
    if (k.high_risk_employers > 0) {
      out.push(`${fmtNum(k.high_risk_employers)} employers currently sit in the High or Critical risk bands.`);
    }
    return out;
  }, [data]);

  return (
    <AnalyticsPanel
      title="Key Observations"
      subtitle="Derived directly from the figures above — no modelled assumptions"
      isLoading={isLoading}
      unavailable={unavailable}
      empty={!notes.length}
    >
      <ul className="space-y-2">
        {notes.map((n, i) => (
          <li key={i} className="flex gap-2 text-sm text-foreground">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            <span>{n}</span>
          </li>
        ))}
      </ul>
    </AnalyticsPanel>
  );
};
