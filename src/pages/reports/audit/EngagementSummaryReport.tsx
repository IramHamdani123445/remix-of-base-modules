import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { BarChart3, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { MetricCard } from '@/components/shared/MetricCard';
import { QueryByFilter } from '@/components/shared/QueryByFilter';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { ExportActions } from '@/components/reports/ExportActions';
import { ExportColumn } from '@/utils/exportUtils';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { formatDateForDisplay } from '@/lib/format-config';
import { useIaFindingRegister } from '@/hooks/useAuditActionCentre';

const exportColumns: ExportColumn[] = [
  { header: 'Engagement', key: 'engagement_code', width: 18 },
  { header: 'Title', key: 'engagement_name', width: 34 },
  { header: 'Plan Year', key: 'plan_fiscal_year', width: 12 },
  { header: 'Status', key: 'status_label', width: 22 },
  { header: 'Planned Start', key: 'planned_start_date', width: 16 },
  { header: 'Planned End', key: 'planned_end_date', width: 16 },
  { header: 'Actual End', key: 'actual_end_date', width: 16 },
  { header: 'Findings', key: 'finding_count', width: 12 },
  { header: 'Open Findings', key: 'open_finding_count', width: 15 },
  { header: 'High/Critical', key: 'high_finding_count', width: 15 },
];

const CLOSED_STATES = ['Closed', 'Closed – Actions Pending', 'Closed - Actions Pending', 'Cancelled'];

export default function EngagementSummaryReport() {
  const [filters, setFilters] = useState<Record<string, any>>({});

  const { data: engagements = [], isLoading } = useQuery({
    queryKey: ['ia_engagement_summary_report'],
    queryFn: async () => {
      // NOTE: `ia_audit_engagements.annual_plan_id` has no declared foreign key, so a
      // PostgREST embed (`plan:annual_plan_id(...)`) fails the whole request and the
      // report renders as empty. Fiscal year is therefore resolved with a second read.
      const { data, error } = await supabase
        .from('ia_audit_engagements' as any)
        .select('id, engagement_code, engagement_name, status, execution_status, planned_start_date, planned_end_date, actual_start_date, actual_end_date, annual_plan_id, engagement_risk_rating')
        .order('engagement_code', { ascending: true })
        .limit(500);
      if (error) throw error;
      const engagementRows = (data as any[]) || [];

      const planIds = Array.from(
        new Set(engagementRows.map((e: any) => e.annual_plan_id).filter(Boolean)),
      );
      const planYearById = new Map<string, any>();
      if (planIds.length > 0) {
        const { data: plans, error: planError } = await supabase
          .from('ia_annual_plans' as any)
          .select('id, fiscal_year')
          .in('id', planIds);
        if (planError) throw planError;
        ((plans as any[]) || []).forEach((p: any) => planYearById.set(p.id, p.fiscal_year));
      }

      return engagementRows.map((e: any) => ({
        ...e,
        plan: e.annual_plan_id ? { fiscal_year: planYearById.get(e.annual_plan_id) } : null,
      }));
    },
  });


  const findings = useIaFindingRegister();

  const rows = useMemo(() => {
    const byEngagement = new Map<string, any[]>();
    ((findings.data as any[]) || []).forEach((f: any) => {
      if (!f.engagement_id) return;
      const list = byEngagement.get(f.engagement_id) || [];
      list.push(f);
      byEngagement.set(f.engagement_id, list);
    });

    return engagements
      .map((e: any) => {
        const list = byEngagement.get(e.id) || [];
        const statusLabel = e.execution_status || e.status || 'Planned';
        return {
          ...e,
          plan_fiscal_year: e.plan?.fiscal_year ?? '—',
          status_label: statusLabel,
          is_closed: CLOSED_STATES.includes(statusLabel),
          finding_count: list.length,
          open_finding_count: list.filter((f: any) => !f.is_closed).length,
          high_finding_count: list.filter(
            (f: any) => f.severity === 'High' || f.severity === 'Critical',
          ).length,
        };
      })
      .filter((e: any) => {
        if (filters.status && filters.status !== 'all') {
          if (filters.status === 'closed' && !e.is_closed) return false;
          if (filters.status === 'open' && e.is_closed) return false;
        }
        if (filters.fiscalYear && filters.fiscalYear !== 'all') {
          if (String(e.plan_fiscal_year) !== String(filters.fiscalYear)) return false;
        }
        return true;
      });
  }, [engagements, findings.data, filters]);

  const closed = rows.filter((r: any) => r.is_closed);
  const inFlight = rows.filter((r: any) => !r.is_closed);
  const withHigh = rows.filter((r: any) => r.high_finding_count > 0);

  const chartData = useMemo(
    () =>
      [
        { name: 'Closed', value: closed.length, color: 'hsl(var(--success))' },
        { name: 'In flight', value: inFlight.length, color: 'hsl(var(--warning))' },
      ].filter(d => d.value > 0),
    [closed.length, inFlight.length],
  );

  const fiscalYears = useMemo(
    () =>
      Array.from(
        new Set(engagements.map((e: any) => e.plan?.fiscal_year).filter(Boolean)),
      ).map(y => ({ label: String(y), value: String(y) })),
    [engagements],
  );

  const filterFields = [
    {
      name: 'fiscalYear',
      label: 'Plan Year',
      type: 'select' as const,
      options: [{ label: 'All', value: 'all' }, ...fiscalYears],
    },
    {
      name: 'status',
      label: 'Status',
      type: 'select' as const,
      options: [
        { label: 'All', value: 'all' },
        { label: 'Closed', value: 'closed' },
        { label: 'In flight', value: 'open' },
      ],
    },
  ];

  const loading = isLoading || findings.isLoading;

  return (
    <div className="container mx-auto p-6 space-y-6" id="engagement-summary-report">
      <div className="flex justify-between items-start">
        <PageHeader
          title="Audit Engagement Summary"
          subtitle="Governed engagement register with finding counts from the Action Centre read models"
          breadcrumbs={[
            { label: 'Internal Audit', href: '/audit/dashboard' },
            { label: 'Reports' },
            { label: 'Engagement Summary' },
          ]}
        />
        <ExportActions
          reportTitle="Audit Engagement Summary"
          fileName="audit-engagement-summary"
          data={rows}
          columns={exportColumns}
          additionalInfo={[
            { label: 'Report Date', value: new Date().toLocaleDateString() },
            { label: 'Engagements', value: String(rows.length) },
          ]}
        />
      </div>

      <div className="no-print">
        <QueryByFilter fields={filterFields} onFilter={setFilters} defaultExpanded />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="Engagements" value={String(rows.length)} icon={BarChart3} variant="info" />
        <MetricCard title="Closed" value={String(closed.length)} icon={CheckCircle2} variant="success" />
        <MetricCard title="In flight" value={String(inFlight.length)} icon={Clock} variant="default" />
        <MetricCard
          title="With High/Critical findings"
          value={String(withHigh.length)}
          icon={AlertTriangle}
          variant="warning"
        />
      </div>

      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Engagement Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={100}
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Audit Engagements ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Engagement</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Plan Year</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Planned Start</TableHead>
                  <TableHead>Planned End</TableHead>
                  <TableHead>Actual End</TableHead>
                  <TableHead>Findings</TableHead>
                  <TableHead>Open</TableHead>
                  <TableHead>High/Critical</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground">
                      No engagements found
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row: any) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium text-sm">{row.engagement_code}</TableCell>
                      <TableCell className="text-sm max-w-[240px] truncate">{row.engagement_name}</TableCell>
                      <TableCell className="text-xs">{row.plan_fiscal_year}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{row.status_label}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.planned_start_date ? formatDateForDisplay(row.planned_start_date) : '—'}
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.planned_end_date ? formatDateForDisplay(row.planned_end_date) : '—'}
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.actual_end_date ? formatDateForDisplay(row.actual_end_date) : '—'}
                      </TableCell>
                      <TableCell className="text-xs">{row.finding_count}</TableCell>
                      <TableCell className="text-xs">{row.open_finding_count}</TableCell>
                      <TableCell className="text-xs">{row.high_finding_count}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
