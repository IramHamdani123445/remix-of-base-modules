import { useState, useMemo } from 'react';
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/shared/MetricCard";
import { QueryByFilter } from "@/components/shared/QueryByFilter";
import { ExportActions } from '@/components/reports/ExportActions';
import { ExportColumn } from '@/utils/exportUtils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from 'recharts';
import { CalendarClock, TrendingDown, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { formatDateForDisplay } from '@/lib/format-config';
import { differenceInDays, parseISO } from 'date-fns';

const exportColumns: ExportColumn[] = [
  { header: 'Engagement', key: 'engagement_code', width: 16 },
  { header: 'Title', key: 'title', width: 30 },
  { header: 'Status', key: 'status', width: 15 },
  { header: 'Planned Start', key: 'planned_start', width: 18 },
  { header: 'Actual Start', key: 'actual_start', width: 18 },
  { header: 'Planned End', key: 'planned_end', width: 18 },
  { header: 'Actual End', key: 'actual_end', width: 18 },
  { header: 'Start Slippage (days)', key: 'start_slippage', width: 20 },
  { header: 'End Slippage (days)', key: 'end_slippage', width: 20 },
];

export default function PlanSlippageReport() {
  const [filters, setFilters] = useState<Record<string, any>>({});

  const { data: engagements = [], isLoading } = useQuery({
    queryKey: ['ia_plan_slippage_report', filters],
    queryFn: async () => {
      let query = supabase
        .from('ia_audit_engagements' as any)
        .select('id, engagement_code, engagement_name, status, execution_status, planned_start_date, planned_end_date, actual_start_date, actual_end_date, department_id, annual_plan_id')
        .order('planned_start_date', { ascending: false });

      if (filters.status && filters.status !== 'all') {
        query = query.eq('execution_status', filters.status);
      }
      const { data, error } = await query.limit(500);
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const enriched = useMemo(() => engagements.map((e: any) => {
    const startSlippage = e.planned_start_date && e.actual_start_date
      ? differenceInDays(parseISO(e.actual_start_date), parseISO(e.planned_start_date))
      : null;
    const endSlippage = e.planned_end_date && e.actual_end_date
      ? differenceInDays(parseISO(e.actual_end_date), parseISO(e.planned_end_date))
      : null;
    return {
      ...e,
      title: e.engagement_name,
      status: e.execution_status || e.status,
      planned_start: e.planned_start_date,
      actual_start: e.actual_start_date,
      planned_end: e.planned_end_date,
      actual_end: e.actual_end_date,
      start_slippage: startSlippage,
      end_slippage: endSlippage,
    };
  }), [engagements]);

  // Summary
  const withStartSlippage = enriched.filter(e => e.start_slippage !== null && e.start_slippage > 0);
  const withEndSlippage = enriched.filter(e => e.end_slippage !== null && e.end_slippage > 0);
  const avgStartSlippage = withStartSlippage.length > 0
    ? Math.round(withStartSlippage.reduce((s, e) => s + e.start_slippage, 0) / withStartSlippage.length)
    : 0;
  const onTrack = enriched.filter(e => (e.start_slippage === null || e.start_slippage <= 0) && (e.end_slippage === null || e.end_slippage <= 0)).length;

  // Chart data: bucket by slippage range
  const chartData = useMemo(() => {
    const buckets = { 'On Time': 0, '1-7 days': 0, '8-14 days': 0, '15-30 days': 0, '30+ days': 0 };
    enriched.forEach(e => {
      const slip = Math.max(e.start_slippage || 0, e.end_slippage || 0);
      if (slip <= 0) buckets['On Time']++;
      else if (slip <= 7) buckets['1-7 days']++;
      else if (slip <= 14) buckets['8-14 days']++;
      else if (slip <= 30) buckets['15-30 days']++;
      else buckets['30+ days']++;
    });
    return Object.entries(buckets).map(([name, count]) => ({ name, count }));
  }, [enriched]);

  const CHART_COLORS = [
    'hsl(var(--success))',
    'hsl(var(--info, 210 100% 50%))',
    'hsl(var(--warning))',
    'hsl(var(--destructive) / 0.7)',
    'hsl(var(--destructive))',
  ];

  const filterFields = [
    { name: 'status', label: 'Engagement Status', type: 'select' as const, options: [
      { label: 'All', value: 'all' },
      { label: 'Planned', value: 'Planned' },
      { label: 'Fieldwork In Progress', value: 'Fieldwork In Progress' },
      { label: 'Final Report Issued', value: 'Final Report Issued' },
      { label: 'Closed', value: 'Closed' },
    ]},
  ];

  return (
    <div className="container mx-auto p-6 space-y-6" id="plan-slippage-report">
      <div className="flex justify-between items-start">
        <PageHeader
          title="Plan Slippage Analysis"
          subtitle="Monitor planned vs actual engagement timelines"
          breadcrumbs={[
            { label: "Internal Audit", href: "/audit/dashboard" },
            { label: "Reports" },
            { label: "Plan Slippage" },
          ]}
        />
        <ExportActions
          reportTitle="Plan Slippage Report"
          fileName="plan-slippage"
          data={enriched}
          columns={exportColumns}
          additionalInfo={[
            { label: 'Report Date', value: new Date().toLocaleDateString() },
            { label: 'Total Engagements', value: String(enriched.length) },
          ]}
        />
      </div>

      <div className="no-print">
        <QueryByFilter fields={filterFields} onFilter={setFilters} defaultExpanded />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="Total Engagements" value={String(enriched.length)} icon={CalendarClock} variant="info" />
        <MetricCard title="On Track" value={String(onTrack)} icon={CheckCircle2} variant="success" />
        <MetricCard title="Start Delayed" value={String(withStartSlippage.length)} icon={TrendingDown} variant="warning" />
        <MetricCard title="Avg Start Slippage" value={`${avgStartSlippage} days`} icon={AlertTriangle} variant={avgStartSlippage > 7 ? 'warning' : 'default'} />
      </div>

      <Card>
        <CardHeader><CardTitle>Slippage Distribution</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" name="Engagements">
                {chartData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Engagement Timeline Details</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-6">Loading...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Engagement</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Planned Start</TableHead>
                  <TableHead>Actual Start</TableHead>
                  <TableHead>Start Slip</TableHead>
                  <TableHead>Planned End</TableHead>
                  <TableHead>Actual End</TableHead>
                  <TableHead>End Slip</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enriched.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No engagements found</TableCell></TableRow>
                ) : enriched.map((row: any) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium text-sm max-w-[200px] truncate">{row.title}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{row.status}</Badge></TableCell>
                    <TableCell className="text-xs">{row.planned_start ? formatDateForDisplay(row.planned_start) : '—'}</TableCell>
                    <TableCell className="text-xs">{row.actual_start ? formatDateForDisplay(row.actual_start) : '—'}</TableCell>
                    <TableCell>
                      {row.start_slippage !== null ? (
                        <Badge className={`text-[10px] ${row.start_slippage > 0 ? 'bg-red-100 text-red-800 border-red-300' : 'bg-green-100 text-green-800 border-green-300'}`}>
                          {row.start_slippage > 0 ? `+${row.start_slippage}d` : row.start_slippage === 0 ? 'On time' : `${row.start_slippage}d early`}
                        </Badge>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-xs">{row.planned_end ? formatDateForDisplay(row.planned_end) : '—'}</TableCell>
                    <TableCell className="text-xs">{row.actual_end ? formatDateForDisplay(row.actual_end) : '—'}</TableCell>
                    <TableCell>
                      {row.end_slippage !== null ? (
                        <Badge className={`text-[10px] ${row.end_slippage > 0 ? 'bg-red-100 text-red-800 border-red-300' : 'bg-green-100 text-green-800 border-green-300'}`}>
                          {row.end_slippage > 0 ? `+${row.end_slippage}d` : row.end_slippage === 0 ? 'On time' : `${row.end_slippage}d early`}
                        </Badge>
                      ) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
