import { useState, useMemo } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { MetricCard } from '@/components/shared/MetricCard';
import { QueryByFilter } from '@/components/shared/QueryByFilter';
import { ExportActions } from '@/components/reports/ExportActions';
import { ExportColumn } from '@/utils/exportUtils';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { AlertTriangle, Clock, CheckCircle2, ShieldAlert } from 'lucide-react';
import { formatDateForDisplay } from '@/lib/format-config';
import { useIaActionRegister, useIaActionCentreCounts, type IaFilters } from '@/hooks/useAuditActionCentre';

const exportColumns: ExportColumn[] = [
  { header: 'Action Ref', key: 'action_ref', width: 16 },
  { header: 'Action', key: 'action_description', width: 35 },
  { header: 'Engagement', key: 'engagement_code', width: 16 },
  { header: 'Owner', key: 'action_owner', width: 22 },
  { header: 'Status', key: 'lifecycle_status', width: 18 },
  { header: 'Severity', key: 'finding_severity', width: 12 },
  { header: 'Target Date', key: 'current_target_date', width: 16 },
  { header: 'Days Overdue', key: 'overdue_days', width: 14 },
  { header: 'Finding', key: 'finding_title', width: 28 },
];

const SEVERITY_CLASS: Record<string, string> = {
  Critical: 'bg-destructive/15 text-destructive border-destructive/40',
  High: 'bg-warning/20 text-warning-foreground border-warning/40',
  Medium: 'bg-muted text-muted-foreground',
  Low: 'bg-muted text-muted-foreground',
};

export default function OverdueActionsReport() {
  const [filters, setFilters] = useState<Record<string, any>>({});

  const registerFilters: IaFilters = {
    severity: filters.severity && filters.severity !== 'all' ? filters.severity : null,
    status: filters.status && filters.status !== 'all' ? filters.status : null,
    overdue: filters.scope === 'overdue',
    due_soon: filters.scope === 'due_soon',
    open_only: filters.scope === 'open',
  };

  const register = useIaActionRegister(registerFilters);
  const counts = useIaActionCentreCounts(registerFilters);

  const rows = useMemo(() => ((register.data as any[]) || []), [register.data]);

  const overdueItems = rows.filter((a: any) => a.is_overdue);
  const openItems = rows.filter((a: any) => a.is_open);
  const criticalOverdue = overdueItems.filter(
    (a: any) => a.finding_severity === 'Critical' || a.finding_severity === 'High',
  );

  const agingData = useMemo(() => {
    const buckets = [
      { name: '1-7 days', value: 0, color: 'hsl(var(--warning))' },
      { name: '8-30 days', value: 0, color: 'hsl(var(--destructive) / 0.6)' },
      { name: '31-90 days', value: 0, color: 'hsl(var(--destructive) / 0.8)' },
      { name: '90+ days', value: 0, color: 'hsl(var(--destructive))' },
    ];
    overdueItems.forEach((a: any) => {
      const d = Number(a.overdue_days) || 0;
      if (d <= 7) buckets[0].value++;
      else if (d <= 30) buckets[1].value++;
      else if (d <= 90) buckets[2].value++;
      else buckets[3].value++;
    });
    return buckets.filter(b => b.value > 0);
  }, [overdueItems]);

  const filterFields = [
    {
      name: 'scope',
      label: 'Scope',
      type: 'select' as const,
      options: [
        { label: 'All actions', value: 'all' },
        { label: 'Overdue only', value: 'overdue' },
        { label: 'Due soon (14 days)', value: 'due_soon' },
        { label: 'Open only', value: 'open' },
      ],
    },
    {
      name: 'severity',
      label: 'Finding Severity',
      type: 'select' as const,
      options: [
        { label: 'All', value: 'all' },
        { label: 'Critical', value: 'Critical' },
        { label: 'High', value: 'High' },
        { label: 'Medium', value: 'Medium' },
        { label: 'Low', value: 'Low' },
      ],
    },
    {
      name: 'status',
      label: 'Action Status',
      type: 'select' as const,
      options: [
        { label: 'All', value: 'all' },
        { label: 'Open', value: 'Open' },
        { label: 'In Progress', value: 'In Progress' },
        { label: 'Verification Required', value: 'Verification Required' },
        { label: 'Closed', value: 'Closed' },
      ],
    },
  ];

  const centreOverdue = (counts.data as any)?.overdue_actions;

  return (
    <div className="container mx-auto p-6 space-y-6" id="overdue-actions-report">
      <div className="flex justify-between items-start">
        <PageHeader
          title="Overdue Actions & Aging"
          subtitle="Reads the same governed action register as the Action Centre"
          breadcrumbs={[
            { label: 'Internal Audit', href: '/audit/dashboard' },
            { label: 'Reports' },
            { label: 'Overdue Actions' },
          ]}
        />
        <ExportActions
          reportTitle="Overdue Actions Report"
          fileName="overdue-actions"
          data={rows}
          columns={exportColumns}
          additionalInfo={[
            { label: 'Report Date', value: new Date().toLocaleDateString() },
            { label: 'Records Exported', value: String(rows.length) },
            { label: 'Overdue', value: String(overdueItems.length) },
          ]}
        />
      </div>

      <div className="no-print">
        <QueryByFilter fields={filterFields} onFilter={setFilters} defaultExpanded />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="Actions in scope" value={String(rows.length)} icon={Clock} variant="info" />
        <MetricCard title="Overdue" value={String(overdueItems.length)} icon={AlertTriangle} variant="warning" />
        <MetricCard
          title="Critical/High Overdue"
          value={String(criticalOverdue.length)}
          icon={ShieldAlert}
          variant="error"
        />
        <MetricCard title="Open" value={String(openItems.length)} icon={CheckCircle2} variant="success" />
      </div>

      {centreOverdue !== undefined && Number(centreOverdue) !== overdueItems.length && (
        <p className="text-xs text-muted-foreground">
          Action Centre reports {String(centreOverdue)} overdue actions for the current scope.
        </p>
      )}

      {agingData.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Overdue Aging Distribution</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={agingData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={100}
                  dataKey="value"
                >
                  {agingData.map((entry, index) => (
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
        <CardHeader><CardTitle>Action Details ({rows.length})</CardTitle></CardHeader>
        <CardContent>
          {register.isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Engagement</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Target Date</TableHead>
                  <TableHead>Overdue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">No actions found</TableCell>
                  </TableRow>
                ) : (
                  rows.map((row: any) => (
                    <TableRow key={row.action_id} className={row.is_overdue ? 'bg-destructive/5' : ''}>
                      <TableCell className="text-xs font-medium">{row.action_ref || '—'}</TableCell>
                      <TableCell className="text-sm max-w-[240px] truncate">{row.action_description}</TableCell>
                      <TableCell className="text-xs">{row.engagement_code || '—'}</TableCell>
                      <TableCell className="text-xs">{row.action_owner || '—'}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{row.lifecycle_status}</Badge></TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${SEVERITY_CLASS[row.finding_severity] || 'bg-muted text-muted-foreground'}`}>
                          {row.finding_severity || '—'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.current_target_date ? formatDateForDisplay(row.current_target_date) : '—'}
                      </TableCell>
                      <TableCell>
                        {row.is_overdue ? (
                          <Badge variant="destructive" className="text-[10px]">{row.overdue_days}d overdue</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
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
