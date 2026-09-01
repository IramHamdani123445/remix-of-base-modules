import { useState, useMemo } from 'react';
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/shared/MetricCard";
import { QueryByFilter } from "@/components/shared/QueryByFilter";
import { ExportActions } from '@/components/reports/ExportActions';
import { ExportColumn } from '@/utils/exportUtils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from 'recharts';
import { Mail, CheckCircle2, AlertTriangle, Clock, ShieldAlert } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { formatDateForDisplay } from '@/lib/format-config';

const STAGE_LABELS: Record<string, string> = {
  PLAN_INTIMATION: 'Plan Intimation',
  TEAM_AND_SCOPE_NOTICE: 'Team & Scope Notice',
  DOC_REQUEST: 'Document Request',
  ENTRANCE_MEETING: 'Entrance Meeting',
  QUERY_CYCLE: 'Query Cycle',
  DRAFT_FINDING_DISCUSSION: 'Draft Finding Discussion',
  EXIT_MEETING: 'Exit Meeting',
  FINAL_REPORT_ISSUE: 'Final Report Issuance',
  ACTION_PLAN_REMINDER: 'Action Plan Reminder',
};

const STATUS_COLORS: Record<string, string> = {
  Sent: 'bg-green-100 text-green-800 border-green-300',
  Delivered: 'bg-green-100 text-green-800 border-green-300',
  Acknowledged: 'bg-blue-100 text-blue-800 border-blue-300',
  Pending: 'bg-amber-100 text-amber-800 border-amber-300',
  Failed: 'bg-red-100 text-red-800 border-red-300',
};

const exportColumns: ExportColumn[] = [
  { header: 'Engagement', key: 'engagement_title', width: 30 },
  { header: 'Stage', key: 'stage_label', width: 25 },
  { header: 'Status', key: 'delivery_status', width: 15 },
  { header: 'Sent Date', key: 'sent_at', width: 18 },
  { header: 'Recipient', key: 'recipient_name', width: 20 },
  { header: 'Template', key: 'template_name', width: 20 },
  { header: 'Acknowledged', key: 'acknowledged_at', width: 18 },
];

export default function CommunicationComplianceReport() {
  const [filters, setFilters] = useState<Record<string, any>>({});

  // DEF-A-02 — ia_audit_engagements has no `title` column; the canonical
  // display field is `engagement_name`.
  const { data: stages = [], isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['ia_communication_compliance_report', filters],
    retry: false,
    queryFn: async () => {
      let query = supabase
        .from('ia_communication_stages' as any)
        .select('*, engagement:engagement_id(engagement_name, status)')
        .order('created_at', { ascending: false });

      if (filters.status && filters.status !== 'all') {
        query = query.eq('delivery_status', filters.status);
      }
      const { data, error } = await query.limit(500);
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const enriched = useMemo(() => stages.map((s: any) => ({
    ...s,
    stage_label: STAGE_LABELS[s.stage_code] || s.stage_code,
    engagement_title: s.engagement?.engagement_name || s.engagement_id?.substring(0, 8),
  })), [stages]);


  // Chart: stages completed per stage_code
  const chartData = useMemo(() => {
    const counts: Record<string, { sent: number; pending: number; failed: number }> = {};
    Object.keys(STAGE_LABELS).forEach(code => { counts[code] = { sent: 0, pending: 0, failed: 0 }; });
    stages.forEach((s: any) => {
      if (!counts[s.stage_code]) counts[s.stage_code] = { sent: 0, pending: 0, failed: 0 };
      if (['Sent', 'Delivered', 'Acknowledged'].includes(s.delivery_status)) counts[s.stage_code].sent++;
      else if (s.delivery_status === 'Failed') counts[s.stage_code].failed++;
      else counts[s.stage_code].pending++;
    });
    return Object.entries(counts).map(([code, v]) => ({
      name: STAGE_LABELS[code] || code,
      Completed: v.sent,
      Pending: v.pending,
      Failed: v.failed,
    }));
  }, [stages]);

  const totalSent = stages.filter((s: any) => ['Sent', 'Delivered', 'Acknowledged'].includes(s.delivery_status)).length;
  const totalPending = stages.filter((s: any) => s.delivery_status === 'Pending').length;
  const totalFailed = stages.filter((s: any) => s.delivery_status === 'Failed').length;
  const complianceRate = stages.length > 0 ? Math.round((totalSent / stages.length) * 100) : 0;

  const filterFields = [
    { name: 'status', label: 'Delivery Status', type: 'select' as const, options: [
      { label: 'All', value: 'all' },
      { label: 'Sent', value: 'Sent' },
      { label: 'Pending', value: 'Pending' },
      { label: 'Failed', value: 'Failed' },
      { label: 'Acknowledged', value: 'Acknowledged' },
    ]},
  ];

  return (
    <div className="container mx-auto p-6 space-y-6" id="communication-compliance-report">
      <div className="flex justify-between items-start">
        <PageHeader
          title="Communication Compliance"
          subtitle="Auditee communication lifecycle tracking and compliance"
          breadcrumbs={[
            { label: "Internal Audit", href: "/audit/dashboard" },
            { label: "Reports" },
            { label: "Communication Compliance" },
          ]}
        />
        {/* §10 — export must be blocked while the source query is in error. */}
        {!isError && (
          <ExportActions
            reportTitle="Communication Compliance Report"
            fileName="communication-compliance"
            data={enriched}
            columns={exportColumns}
            additionalInfo={[
              { label: 'Report Date', value: new Date().toLocaleDateString() },
              { label: 'Total Records', value: String(stages.length) },
              { label: 'Compliance Rate', value: `${complianceRate}%` },
            ]}
          />
        )}
      </div>

      <div className="no-print">
        <QueryByFilter fields={filterFields} onFilter={setFilters} defaultExpanded />
      </div>

      {/* DEF-A-02 / §10 — a failed query must never masquerade as an
          authoritative 0 records / 0% compliance business result. */}
      {isError ? (
        <Card className="border-destructive/50" data-testid="comm-compliance-error">
          <CardContent className="py-8 flex flex-col items-center gap-3 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <p className="font-medium">Communication compliance data could not be loaded.</p>
            <p className="text-sm text-muted-foreground max-w-lg">
              Compliance metrics are unavailable because the underlying query failed. No
              counts or percentages are shown, as they would not be authoritative.
            </p>
            <p className="text-xs text-muted-foreground font-mono max-w-lg break-words">
              {(error as any)?.message || 'Unknown error'}
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? 'Retrying…' : 'Retry'}
            </Button>
          </CardContent>
        </Card>
      ) : (
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="Total Communications" value={String(stages.length)} icon={Mail} variant="info" />
        <MetricCard title="Completed" value={String(totalSent)} icon={CheckCircle2} variant="success" />
        <MetricCard title="Pending" value={String(totalPending)} icon={Clock} variant="default" />
        <MetricCard title="Compliance Rate" value={`${complianceRate}%`} icon={ShieldAlert} variant={complianceRate >= 80 ? 'success' : 'warning'} />
      </div>
      )}


      <Card>
        <CardHeader><CardTitle>Stage Completion Overview</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 140 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="Completed" stackId="a" fill="hsl(var(--success))" />
              <Bar dataKey="Pending" stackId="a" fill="hsl(var(--warning))" />
              <Bar dataKey="Failed" stackId="a" fill="hsl(var(--destructive))" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Communication Log</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-6">Loading...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Engagement</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Acknowledged</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enriched.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No communication records found</TableCell></TableRow>
                ) : enriched.map((row: any) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium text-sm max-w-[200px] truncate">{row.engagement_title}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{row.stage_label}</Badge></TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] ${STATUS_COLORS[row.delivery_status] || 'bg-muted text-muted-foreground'}`}>
                        {row.delivery_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{row.sent_at ? formatDateForDisplay(row.sent_at) : '—'}</TableCell>
                    <TableCell className="text-xs">{row.recipient_name || '—'}</TableCell>
                    <TableCell className="text-xs max-w-[150px] truncate">{row.template_name || '—'}</TableCell>
                    <TableCell className="text-xs">{row.acknowledged_at ? formatDateForDisplay(row.acknowledged_at) : '—'}</TableCell>
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
