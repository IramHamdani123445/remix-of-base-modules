/**
 * Compliance → Reports → Trend Analysis.
 *
 * Time-series only: workload & resolution, violations & compliance, financial
 * & enforcement, and risk. Every series is aggregated server-side by
 * ce_trend_analytics_v1 over a continuous period spine, so gaps mean "no
 * history", not zero.
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Download, RotateCcw, AlertTriangle } from 'lucide-react';
import { exportReportToExcel } from '@/utils/reportExcelExport';
import { useZones } from '@/hooks/useZones';
import { TrendChartCard } from './shared/TrendChartCard';
import {
  useTrendAnalytics, useTrendFilters, useTrendCaseTypes, useTrendViolationTypes,
  TREND_PERIODS, TREND_GRAINS, TREND_COMPARISONS, formatPeriodLabel,
  type TrendGrain, type TrendPeriodKey, type TrendCompare,
} from '@/hooks/compliance/useTrendAnalytics';

const ALL = '__all__';
const SERIES = [
  'hsl(var(--primary))', 'hsl(var(--success))', 'hsl(var(--warning))',
  'hsl(var(--destructive))', 'hsl(var(--accent))', 'hsl(var(--muted-foreground))',
  '#8b5cf6', '#0ea5e9',
];
const BAND_COLOURS: Record<string, string> = {
  CRITICAL: 'hsl(var(--destructive))',
  HIGH: 'hsl(var(--warning))',
  MEDIUM: 'hsl(var(--primary))',
  LOW: 'hsl(var(--success))',
};

const money = (v: unknown) =>
  typeof v === 'number' ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—';
const pct = (v: unknown) => (typeof v === 'number' ? `${v}%` : '—');
const days = (v: unknown) => (typeof v === 'number' ? `${v} days` : '—');

export default function TrendReports() {
  const navigate = useNavigate();
  const { filters, update, reset } = useTrendFilters();
  const { data, isLoading, isError, error } = useTrendAnalytics(filters);
  const { data: zones = [] } = useZones();
  const { data: caseTypes = [] } = useTrendCaseTypes();
  const { data: violationTypes = [] } = useTrendViolationTypes();

  const grain = filters.grain;
  const label = (iso: string) => formatPeriodLabel(iso, grain);
  const comparing = filters.compare !== 'none';
  const compareLabel = filters.compare === 'previous_year' ? 'Previous year' : 'Previous period';

  const caseRows = useMemo(
    () => (data?.cases.points ?? []).map(p => ({ ...p, period: label(p.period_start) })),
    [data, grain]
  );
  const violationRows = useMemo(
    () => (data?.violations.points ?? []).map(p => ({ ...p, period: label(p.period_start) })),
    [data, grain]
  );
  const c3Rows = useMemo(
    () => (data?.c3.points ?? []).map(p => ({ ...p, period: label(p.period_start) })),
    [data, grain]
  );
  const exposureRows = useMemo(
    () => (data?.exposure.points ?? []).map(p => ({ ...p, period: label(p.period_start) })),
    [data, grain]
  );
  const recoveryRows = useMemo(
    () => (data?.recovery.points ?? []).map(p => ({ ...p, period: label(p.period_start) })),
    [data, grain]
  );
  const enforcementRows = useMemo(
    () => (data?.enforcement.points ?? []).map(p => ({ ...p, period: label(p.period_start) })),
    [data, grain]
  );

  // Violation detection by type — pivot to one row per period.
  const violationTypeSeries = useMemo(() => {
    const pts = data?.violation_types.points ?? [];
    const names = Array.from(new Map(pts.map(p => [p.type_code, p.type_name])).entries());
    const byPeriod = new Map<string, Record<string, number | string>>();
    pts.forEach(p => {
      const row = byPeriod.get(p.period_start) ?? { period_start: p.period_start, period: label(p.period_start) };
      row[p.type_name] = p.count;
      byPeriod.set(p.period_start, row);
    });
    const rows = Array.from(byPeriod.values())
      .sort((a, b) => String(a.period_start).localeCompare(String(b.period_start)));
    return { rows, keys: names.map(([, name]) => name) };
  }, [data, grain]);

  // Risk bands per period.
  const riskSeries = useMemo(() => {
    const pts = data?.risk.points ?? [];
    const bands = Array.from(new Set(pts.map(p => p.band)));
    const byPeriod = new Map<string, Record<string, number | string>>();
    pts.forEach(p => {
      const row = byPeriod.get(p.period_start) ?? { period_start: p.period_start, period: label(p.period_start) };
      row[p.band] = p.count;
      byPeriod.set(p.period_start, row);
    });
    const rows = Array.from(byPeriod.values())
      .sort((a, b) => String(a.period_start).localeCompare(String(b.period_start)));
    return { rows, bands };
  }, [data, grain]);

  // Case-type comparison — volume per case type per period.
  const caseTypeSeries = useMemo(() => {
    const pts = data?.case_types.points ?? [];
    const labels = Array.from(new Set(pts.map(p => p.label)));
    const byPeriod = new Map<string, Record<string, number | string>>();
    pts.forEach(p => {
      const row = byPeriod.get(p.period_start) ?? { period_start: p.period_start, period: label(p.period_start) };
      row[p.label] = p.volume;
      byPeriod.set(p.period_start, row);
    });
    const rows = Array.from(byPeriod.values())
      .sort((a, b) => String(a.period_start).localeCompare(String(b.period_start)));
    return { rows, labels };
  }, [data, grain]);

  const handleExport = async () => {
    if (!data) return;
    const rows = (data.cases.points ?? []).map(p => {
      const v = data.violations.points.find(x => x.period_start === p.period_start);
      const e = data.exposure.points.find(x => x.period_start === p.period_start);
      const r = data.recovery.points.find(x => x.period_start === p.period_start);
      const f = data.enforcement.points.find(x => x.period_start === p.period_start);
      const c = data.c3.points.find(x => x.period_start === p.period_start);
      return {
        period: label(p.period_start),
        created: p.created,
        closed: p.closed,
        backlog: p.backlog,
        ratio: p.ratio ?? '',
        median_days: p.median_days ?? '',
        violations_opened: v?.opened ?? '',
        violations_resolved: v?.resolved ?? '',
        filing_rate: c?.filing_rate ?? '',
        outstanding: e?.outstanding ?? '',
        recovered: r?.amount ?? '',
        notices: f ? f.warning_notices + f.demand_notices + f.other_notices : '',
        arrangements: f?.arrangements ?? '',
        breaches: f?.breaches ?? '',
      };
    });
    await exportReportToExcel(
      rows,
      [
        { header: 'Period', key: 'period', width: 14 },
        { header: 'Cases Created', key: 'created', width: 15 },
        { header: 'Cases Closed', key: 'closed', width: 14 },
        { header: 'Open Backlog', key: 'backlog', width: 14 },
        { header: 'Closure-to-Intake Ratio (%)', key: 'ratio', width: 26 },
        { header: 'Median Resolution (days)', key: 'median_days', width: 24 },
        { header: 'Violations Detected', key: 'violations_opened', width: 20 },
        { header: 'Violations Resolved', key: 'violations_resolved', width: 20 },
        { header: 'C3 Filing Rate (%)', key: 'filing_rate', width: 18 },
        { header: 'Outstanding Exposure', key: 'outstanding', width: 22 },
        { header: 'Amount Recovered', key: 'recovered', width: 20 },
        { header: 'Notices Issued', key: 'notices', width: 16 },
        { header: 'Arrangements Created', key: 'arrangements', width: 22 },
        { header: 'Arrangement Breaches', key: 'breaches', width: 22 },
      ],
      'compliance_trend_analysis',
      'Trends'
    );
  };

  const axis = { tick: { fontSize: 11 }, stroke: 'hsl(var(--muted-foreground))' };
  const grid = <CartesianGrid strokeDasharray="3 3" className="stroke-border" />;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <PageHeader
        title="Trend Analysis"
        subtitle="How compliance workload, violations, exposure and enforcement have moved over time"
        breadcrumbs={[
          { label: 'Compliance', href: '/compliance' },
          { label: 'Reports', href: '/compliance/reports' },
          { label: 'Trend Analysis' },
        ]}
      />

      {/* Controls */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Period</Label>
            <Select value={filters.period} onValueChange={v => update('period', v as TrendPeriodKey)}>
              <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TREND_PERIODS.map(p => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Granularity</Label>
            <Select value={filters.grain} onValueChange={v => update('grain', v as TrendGrain)}>
              <SelectTrigger className="h-9 w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TREND_GRAINS.map(g => <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Compare with</Label>
            <Select value={filters.compare} onValueChange={v => update('compare', v as TrendCompare)}>
              <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TREND_COMPARISONS.map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Zone</Label>
            <Select value={filters.zone ?? ALL} onValueChange={v => update('zone', v === ALL ? null : v)}>
              <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All zones</SelectItem>
                {zones.map(z => <SelectItem key={z.id} value={z.zone_code}>{z.zone_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Case type</Label>
            <Select value={filters.caseType ?? ALL} onValueChange={v => update('caseType', v === ALL ? null : v)}>
              <SelectTrigger className="h-9 w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All case types</SelectItem>
                {caseTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Violation type</Label>
            <Select value={filters.violationType ?? ALL} onValueChange={v => update('violationType', v === ALL ? null : v)}>
              <SelectTrigger className="h-9 w-[210px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All violation types</SelectItem>
                {violationTypes.map(t => <SelectItem key={t.code} value={t.code}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" size="sm" onClick={reset}>
              <RotateCcw className="mr-2 h-4 w-4" />Reset
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={!data}>
              <Download className="mr-2 h-4 w-4" />Export Trend Data
            </Button>
          </div>
        </CardContent>
      </Card>

      {isError && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-3 py-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
            <div>
              <p className="font-medium">Trend data could not be loaded</p>
              <p className="text-muted-foreground">{(error as Error)?.message ?? 'Please try again.'}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 1. Workload & Resolution */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Workload &amp; Resolution</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <TrendChartCard
            title="Case Volume Trend"
            description="Cases opened against cases closed in each period."
            status={data?.cases.status ?? 'ok'}
            historyFrom={data?.cases.history_from}
            isLoading={isLoading}
          >
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={caseRows} onClick={() => navigate('/compliance/reports/cases')}>
                {grid}
                <XAxis dataKey="period" {...axis} />
                <YAxis {...axis} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="created" name="Cases Opened" stroke={SERIES[0]} strokeWidth={2} connectNulls={false} />
                <Line type="monotone" dataKey="closed" name="Cases Closed" stroke={SERIES[1]} strokeWidth={2} connectNulls={false} />
                {comparing && <Line type="monotone" dataKey="prev_created" name={`Opened (${compareLabel})`} stroke={SERIES[0]} strokeDasharray="4 4" strokeWidth={1.5} dot={false} />}
                {comparing && <Line type="monotone" dataKey="prev_closed" name={`Closed (${compareLabel})`} stroke={SERIES[1]} strokeDasharray="4 4" strokeWidth={1.5} dot={false} />}
              </LineChart>
            </ResponsiveContainer>
          </TrendChartCard>

          <TrendChartCard
            title="Open Case Backlog Trend"
            description="Cases still open at the end of each period (point-in-time)."
            status={data?.cases.status ?? 'ok'}
            historyFrom={data?.cases.history_from}
            isLoading={isLoading}
          >
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={caseRows}>
                {grid}
                <XAxis dataKey="period" {...axis} />
                <YAxis {...axis} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="backlog" name="Open at Period End" stroke={SERIES[3]} fill={SERIES[3]} fillOpacity={0.15} />
                {comparing && <Area type="monotone" dataKey="prev_backlog" name={`Open (${compareLabel})`} stroke={SERIES[5]} fill="transparent" strokeDasharray="4 4" />}
              </AreaChart>
            </ResponsiveContainer>
          </TrendChartCard>

          <TrendChartCard
            title="Closure-to-Intake Ratio"
            description="Cases closed as a percentage of cases opened in the same period. Above 100% means the backlog is being reduced."
            status={data?.cases.status ?? 'ok'}
            historyFrom={data?.cases.history_from}
            isLoading={isLoading}
            footnote="Periods with no cases opened are shown as a gap, not zero."
          >
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={caseRows}>
                {grid}
                <XAxis dataKey="period" {...axis} />
                <YAxis {...axis} unit="%" />
                <Tooltip formatter={(v) => pct(v)} />
                <Legend />
                <Line type="monotone" dataKey="ratio" name="Closure-to-Intake Ratio" stroke={SERIES[1]} strokeWidth={2} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </TrendChartCard>

          <TrendChartCard
            title="Resolution Time Trend"
            description="Median and average days from case opening to closure, for cases closed in each period."
            status={data?.cases.status ?? 'ok'}
            historyFrom={data?.cases.history_from}
            isLoading={isLoading}
            footnote="Only closed cases contribute; periods with no closures are shown as a gap."
          >
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={caseRows}>
                {grid}
                <XAxis dataKey="period" {...axis} />
                <YAxis {...axis} />
                <Tooltip formatter={(v) => days(v)} />
                <Legend />
                <Line type="monotone" dataKey="median_days" name="Median Days" stroke={SERIES[0]} strokeWidth={2} connectNulls={false} />
                <Line type="monotone" dataKey="avg_days" name="Average Days" stroke={SERIES[2]} strokeWidth={2} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </TrendChartCard>
        </div>
      </section>

      {/* 2. Violations & Compliance */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Violations &amp; Compliance</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <TrendChartCard
            title="Violation Detection Trend"
            description="Violations discovered in each period, with the value at stake."
            status={data?.violations.status ?? 'ok'}
            historyFrom={data?.violations.history_from}
            isLoading={isLoading}
          >
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={violationRows} onClick={() => navigate('/compliance/reports/violations')}>
                {grid}
                <XAxis dataKey="period" {...axis} />
                <YAxis yAxisId="l" {...axis} allowDecimals={false} />
                <YAxis yAxisId="r" orientation="right" {...axis} tickFormatter={(v) => money(v)} />
                <Tooltip formatter={(v, n) => (n === 'Value at Stake' ? money(v) : v)} />
                <Legend />
                <Bar yAxisId="l" dataKey="opened" name="Violations Detected" fill={SERIES[0]} />
                <Line yAxisId="r" type="monotone" dataKey="amount" name="Value at Stake" stroke={SERIES[2]} strokeWidth={2} dot={false} />
                {comparing && <Line yAxisId="l" type="monotone" dataKey="prev_opened" name={`Detected (${compareLabel})`} stroke={SERIES[5]} strokeDasharray="4 4" dot={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          </TrendChartCard>

          <TrendChartCard
            title="Violations Opened vs Resolved"
            description="Whether violation resolution is keeping pace with detection."
            status={data?.violations.status ?? 'ok'}
            historyFrom={data?.violations.history_from}
            isLoading={isLoading}
          >
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={violationRows}>
                {grid}
                <XAxis dataKey="period" {...axis} />
                <YAxis {...axis} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="opened" name="Opened" stroke={SERIES[3]} strokeWidth={2} />
                <Line type="monotone" dataKey="resolved" name="Resolved" stroke={SERIES[1]} strokeWidth={2} />
                {comparing && <Line type="monotone" dataKey="prev_resolved" name={`Resolved (${compareLabel})`} stroke={SERIES[1]} strokeDasharray="4 4" strokeWidth={1.5} dot={false} />}
              </LineChart>
            </ResponsiveContainer>
          </TrendChartCard>

          <TrendChartCard
            title="C3 Filing Compliance Rate Trend"
            description="Percentage of expected C3 returns actually filed in each contribution period, and the percentage of filings posted."
            status={data?.c3.status ?? 'ok'}
            historyFrom={data?.c3.history_from}
            isLoading={isLoading}
            footnote={data?.c3.zone_filtered === false ? 'C3 filing is reported nationally and is not affected by the zone filter.' : undefined}
          >
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={c3Rows} onClick={() => navigate('/compliance/reports/c3')}>
                {grid}
                <XAxis dataKey="period" {...axis} />
                <YAxis yAxisId="l" {...axis} unit="%" domain={[0, 100]} />
                <YAxis yAxisId="r" orientation="right" {...axis} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar yAxisId="r" dataKey="missing" name="Returns Not Filed" fill={SERIES[3]} fillOpacity={0.5} />
                <Line yAxisId="l" type="monotone" dataKey="filing_rate" name="Filing Rate (%)" stroke={SERIES[1]} strokeWidth={2} connectNulls={false} />
                <Line yAxisId="l" type="monotone" dataKey="posted_rate" name="Posted Rate (%)" stroke={SERIES[0]} strokeWidth={2} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </TrendChartCard>

          <TrendChartCard
            title="Detection Trend by Violation Type"
            description="The most frequently detected violation types over time (top 8)."
            status={data?.violation_types.status ?? 'ok'}
            isLoading={isLoading}
          >
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={violationTypeSeries.rows}>
                {grid}
                <XAxis dataKey="period" {...axis} />
                <YAxis {...axis} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {violationTypeSeries.keys.map((k, i) => (
                  <Bar key={k} dataKey={k} name={k} stackId="vt" fill={SERIES[i % SERIES.length]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </TrendChartCard>
        </div>
      </section>

      {/* 3. Financial & Enforcement */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Financial &amp; Enforcement</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <TrendChartCard
            title="Outstanding Exposure Trend"
            description="Total employer balance outstanding at the end of each period, reconstructed from the compliance ledger."
            status={data?.exposure.status ?? 'ok'}
            historyFrom={data?.exposure.history_from}
            isLoading={isLoading}
            footnote="Periods before the ledger was established are shown as a gap, not as zero exposure."
          >
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={exposureRows} onClick={() => navigate('/compliance/reports/arrears')}>
                {grid}
                <XAxis dataKey="period" {...axis} />
                <YAxis {...axis} tickFormatter={(v) => money(v)} width={90} />
                <Tooltip formatter={(v) => money(v)} />
                <Legend />
                <Area type="monotone" dataKey="outstanding" name="Outstanding Balance" stroke={SERIES[3]} fill={SERIES[3]} fillOpacity={0.15} connectNulls={false} />
                {comparing && <Area type="monotone" dataKey="prev_outstanding" name={`Outstanding (${compareLabel})`} stroke={SERIES[5]} fill="transparent" strokeDasharray="4 4" connectNulls={false} />}
              </AreaChart>
            </ResponsiveContainer>
          </TrendChartCard>

          <TrendChartCard
            title="Recovery &amp; Collection Trend"
            description="Contribution payments received in each period."
            status={data?.recovery.status ?? 'ok'}
            historyFrom={data?.recovery.history_from}
            isLoading={isLoading}
            footnote="Payments are recorded nationally and are not affected by the zone filter."
          >
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={recoveryRows}>
                {grid}
                <XAxis dataKey="period" {...axis} />
                <YAxis yAxisId="l" {...axis} tickFormatter={(v) => money(v)} width={90} />
                <YAxis yAxisId="r" orientation="right" {...axis} allowDecimals={false} />
                <Tooltip formatter={(v, n) => (n === 'Payments Received' ? v : money(v))} />
                <Legend />
                <Bar yAxisId="l" dataKey="amount" name="Amount Collected" fill={SERIES[1]} />
                <Line yAxisId="r" type="monotone" dataKey="payments" name="Payments Received" stroke={SERIES[0]} strokeWidth={2} dot={false} connectNulls={false} />
                {comparing && <Line yAxisId="l" type="monotone" dataKey="prev_amount" name={`Collected (${compareLabel})`} stroke={SERIES[5]} strokeDasharray="4 4" dot={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          </TrendChartCard>

          <TrendChartCard
            title="Enforcement Escalation Trend"
            description="Notices issued, payment arrangements created, arrangement breaches detected and legal referrals raised."
            status={data?.enforcement.status ?? 'ok'}
            historyFrom={data?.enforcement.history_from}
            isLoading={isLoading}
            className="lg:col-span-2"
          >
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={enforcementRows}>
                {grid}
                <XAxis dataKey="period" {...axis} />
                <YAxis {...axis} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="warning_notices" name="Warning Notices" stackId="n" fill={SERIES[2]} />
                <Bar dataKey="demand_notices" name="Demand Notices" stackId="n" fill={SERIES[3]} />
                <Bar dataKey="other_notices" name="Other Notices" stackId="n" fill={SERIES[5]} />
                <Line type="monotone" dataKey="arrangements" name="Arrangements Created" stroke={SERIES[1]} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="breaches" name="Arrangement Breaches" stroke={SERIES[0]} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="referrals" name="Legal Referrals" stroke={SERIES[6]} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </TrendChartCard>
        </div>
      </section>

      {/* 4. Risk */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Risk</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <TrendChartCard
            title="Employer Risk Band Trend"
            description="Employers in each risk band at the end of every period, based on recorded risk-band history."
            status={data?.risk.status ?? 'ok'}
            historyFrom={data?.risk.history_from}
            reason={data?.risk.reason}
            isLoading={isLoading}
            footnote="Only employers with a recorded risk assessment are counted."
          >
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={riskSeries.rows} onClick={() => navigate('/compliance/risk')}>
                {grid}
                <XAxis dataKey="period" {...axis} />
                <YAxis {...axis} allowDecimals={false} />
                <Tooltip />
                <Legend />
                {riskSeries.bands.map((b, i) => (
                  <Area key={b} type="monotone" dataKey={b} name={b.charAt(0) + b.slice(1).toLowerCase()} stackId="r"
                        stroke={BAND_COLOURS[b] ?? SERIES[i % SERIES.length]}
                        fill={BAND_COLOURS[b] ?? SERIES[i % SERIES.length]} fillOpacity={0.2} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </TrendChartCard>

          <TrendChartCard
            title="Case Type Comparison"
            description="How case volumes by business case type have moved relative to one another (top 6 types)."
            status={data?.case_types.status ?? 'ok'}
            isLoading={isLoading}
          >
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={caseTypeSeries.rows}>
                {grid}
                <XAxis dataKey="period" {...axis} />
                <YAxis {...axis} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {caseTypeSeries.labels.map((l, i) => (
                  <Line key={l} type="monotone" dataKey={l} name={l} stroke={SERIES[i % SERIES.length]} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </TrendChartCard>
        </div>
      </section>

      {data?.generated_at && (
        <p className="text-right text-[11px] text-muted-foreground">
          Aggregated server-side · generated {new Date(data.generated_at).toLocaleString('en-GB')}
        </p>
      )}
    </div>
  );
}
