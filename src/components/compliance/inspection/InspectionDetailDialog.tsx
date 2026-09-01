import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, FileText, Paperclip } from 'lucide-react';

/**
 * Read-only inspection detail panel used by the Inspection Register.
 * All content comes from `ce_inspection_detail_v1`, which enforces field-ops scope.
 * Lifecycle actions stay in the field execution workspace — this panel does not duplicate them.
 */

interface Summary {
  id: string;
  inspection_number: string;
  lifecycle_status: string;
  raw_status: string | null;
  inspection_type: string | null;
  scheduled_date: string | null;
  visit_date: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  location_address: string | null;
  territory: string | null;
  notes: string | null;
  created_at: string;
  employer_id: string | null;
  employer_name: string | null;
  inspector_id: string | null;
  inspector_name: string | null;
  risk_band: string | null;
  risk_score: number | null;
  case_id: string | null;
  case_number: string | null;
  plan_number: string | null;
}

interface DetailResult {
  summary: Summary;
  findings: {
    id: string; title: string | null; finding_type: string | null; severity: string | null;
    disposition: string; violation_created: boolean | null; created_at: string;
  }[];
  evidence: {
    id: string; file_name: string | null; evidence_type: string | null;
    description: string | null; captured_at: string | null;
  }[];
  report: { id: string; report_number: string | null; status: string | null; report_date: string | null; total_findings: number | null } | null;
}

const fmt = (v?: string | null) =>
  v ? new Date(v.length <= 10 ? `${v}T00:00:00Z` : v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm">{children ?? '—'}</div>
    </div>
  );
}

export default function InspectionDetailDialog({
  inspectionId, onOpenChange,
}: { inspectionId: string | null; onOpenChange: (open: boolean) => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['ce_inspection_detail_v1', inspectionId],
    enabled: !!inspectionId,
    queryFn: async (): Promise<DetailResult> => {
      const { data, error } = await supabase.rpc('ce_inspection_detail_v1' as never, {
        p_inspection_id: inspectionId,
      } as never);
      if (error) throw error;
      return data as unknown as DetailResult;
    },
  });

  const s = data?.summary;

  return (
    <Dialog open={!!inspectionId} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono">{s?.inspection_number ?? 'Inspection'}</span>
            {s ? <Badge variant="outline">{s.lifecycle_status.replace(/_/g, ' ')}</Badge> : null}
          </DialogTitle>
          <DialogDescription>
            Inspection record, findings, evidence and audit report status.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Unable to load this inspection</AlertTitle>
            <AlertDescription>{(error as Error).message}</AlertDescription>
          </Alert>
        ) : isLoading || !s ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Employer">
                {s.employer_id ? (
                  <Link to={`/compliance/field/employer-360/${s.employer_id}`} className="text-primary hover:underline">
                    {s.employer_name ?? s.employer_id}
                  </Link>
                ) : (s.employer_name ?? '—')}
              </Field>
              <Field label="Inspector">{s.inspector_name ?? 'Unassigned'}</Field>
              <Field label="Type">{s.inspection_type ?? '—'}</Field>
              <Field label="Scheduled">{fmt(s.scheduled_date)}</Field>
              <Field label="Visited">{fmt(s.visit_date)}</Field>
              <Field label="Risk band">{s.risk_band ?? 'Unrated'}{s.risk_score != null ? ` (${s.risk_score})` : ''}</Field>
              <Field label="Zone">{s.territory ?? '—'}</Field>
              <Field label="Checked in">{fmt(s.check_in_time)}</Field>
              <Field label="Checked out">{fmt(s.check_out_time)}</Field>
              <Field label="Weekly plan">{s.plan_number ?? '—'}</Field>
              <Field label="Case">
                {s.case_id ? (
                  <Link to={`/compliance/cases/${s.case_id}`} className="text-primary hover:underline">
                    {s.case_number ?? 'View case'}
                  </Link>
                ) : '—'}
              </Field>
              <Field label="Created">{fmt(s.created_at)}</Field>
            </div>

            {s.location_address ? (
              <>
                <Separator />
                <Field label="Location">{s.location_address}</Field>
              </>
            ) : null}

            <Tabs defaultValue="findings">
              <TabsList>
                <TabsTrigger value="findings">Findings ({data?.findings.length ?? 0})</TabsTrigger>
                <TabsTrigger value="evidence">Evidence ({data?.evidence.length ?? 0})</TabsTrigger>
                <TabsTrigger value="report">Report</TabsTrigger>
              </TabsList>

              <TabsContent value="findings" className="space-y-2 pt-3">
                {(data?.findings ?? []).length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No findings recorded for this inspection.</p>
                ) : data!.findings.map((f) => (
                  <div key={f.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{f.title ?? f.finding_type ?? 'Finding'}</p>
                      <p className="text-xs text-muted-foreground">{f.finding_type ?? '—'} · {fmt(f.created_at)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {f.severity ? (
                        <Badge variant={['CRITICAL', 'HIGH'].includes(f.severity.toUpperCase()) ? 'destructive' : 'secondary'} className="text-[10px]">
                          {f.severity}
                        </Badge>
                      ) : null}
                      <Badge variant="outline" className="text-[10px]">
                        {f.violation_created ? 'Converted' : f.disposition}
                      </Badge>
                    </div>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="evidence" className="space-y-2 pt-3">
                {(data?.evidence ?? []).length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No evidence captured for this inspection.</p>
                ) : data!.evidence.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 rounded-md border p-3">
                    <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate text-sm">{e.file_name ?? e.evidence_type ?? 'Evidence'}</p>
                      <p className="text-xs text-muted-foreground">{e.evidence_type ?? '—'} · {fmt(e.captured_at)}</p>
                    </div>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="report" className="pt-3">
                {data?.report?.id ? (
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <FileText className="h-4 w-4" />{data.report.report_number ?? 'Audit report'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {data.report.status ?? '—'} · {fmt(data.report.report_date)} · {data.report.total_findings ?? 0} findings
                      </p>
                    </div>
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/compliance/field/audit-report/${s.id}`}>Open report</Link>
                    </Button>
                  </div>
                ) : (
                  <div className="py-6 text-center">
                    <p className="text-sm text-muted-foreground">No audit report has been started for this inspection.</p>
                    <Button size="sm" variant="outline" className="mt-2" asChild>
                      <Link to={`/compliance/field/audit-report/${s.id}`}>Open audit report workspace</Link>
                    </Button>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
