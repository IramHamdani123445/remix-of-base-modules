import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fieldAuditService, type AccurateWeeklySummary } from '@/services/fieldAuditService';
import { toast } from 'sonner';

export default function WeeklyReportReview() {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any | null>(null);
  const [summary, setSummary] = useState<AccurateWeeklySummary | null>(null);
  const [comments, setComments] = useState('');
  const [acting, setActing] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    try {
      setLoading(true);
      const data = await fieldAuditService.getSubmittedWeeklyReports();
      setReports(data);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async (r: any) => {
    setSelected(r);
    setComments('');
    try {
      const s = await fieldAuditService.getAccurateWeeklySummary(r.id);
      setSummary(s);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load summary');
    }
  };

  const handleAction = async (approve: boolean) => {
    if (!selected) return;
    try {
      setActing(true);
      await fieldAuditService.reviewWeeklyReport(selected.id, approve, comments);
      toast.success(approve ? 'Report approved' : 'Report sent back for changes');
      setSelected(null);
      setSummary(null);
      load();
    } catch (e: any) {
      toast.error(e.message ?? 'Action failed');
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Weekly Report Review"
        subtitle="Review and approve weekly inspection reports submitted by inspectors"
        breadcrumbs={[
          { label: 'Compliance', href: '/compliance/dashboard' },
          { label: 'Field' },
          { label: 'Weekly Report Review' },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle>Submitted Reports ({reports.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading…</div>
          ) : reports.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No reports awaiting review.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan #</TableHead>
                  <TableHead>Week</TableHead>
                  <TableHead>Inspector</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.plan_number}</TableCell>
                    <TableCell>
                      {r.week_start_date} → {r.week_end_date}
                    </TableCell>
                    <TableCell>{r.inspector_name ?? '—'}</TableCell>
                    <TableCell>
                      {/* Older plans were submitted through the plan workflow,
                          which stamps submitted_date rather than
                          outcome_submitted_at — fall back so the column is
                          never blank for a report that is awaiting review. */}
                      {r.outcome_submitted_at ?? r.submitted_date
                        ? new Date(r.outcome_submitted_at ?? r.submitted_date).toLocaleString()
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{r.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button size="sm" onClick={() => openDetail(r)}>
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Review — {selected?.plan_number} ({selected?.week_start_date} → {selected?.week_end_date})
            </DialogTitle>
          </DialogHeader>

          {summary ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <Box label="Planned" v={summary.plannedVisits} />
                <Box label="Completed" v={summary.completedVisits} />
                <Box label="Rescheduled" v={summary.rescheduledVisits} />
                <Box label="Not Done" v={summary.notDoneVisits} />
                <Box label="Hours" v={summary.totalHoursSpent} />
                <Box label="Evidence" v={summary.evidenceCollected} />
                <Box label="Findings" v={summary.totalFindings} />
                <Box label="Reports" v={summary.reportsGenerated} />
                <Box label="Violations Opened" v={summary.violationsOpened} />
                <Box label="Violations Updated" v={summary.violationsUpdated} />
                <Box label="Follow-ups" v={summary.followUpsCreated} />
              </div>

              <div>
                <Label className="text-xs">Findings by Severity</Label>
                <div className="flex gap-2 mt-1">
                  <Badge variant="outline">Low: {summary.findingsByseverity.Low}</Badge>
                  <Badge variant="secondary">Medium: {summary.findingsByseverity.Medium}</Badge>
                  <Badge className="bg-warning/20 text-warning">High: {summary.findingsByseverity.High}</Badge>
                  <Badge variant="destructive">Critical: {summary.findingsByseverity.Critical}</Badge>
                </div>
              </div>

              <div>
                <Label>Inspector Narrative</Label>
                <div className="text-sm whitespace-pre-wrap p-3 bg-muted rounded-md mt-1 max-h-40 overflow-y-auto">
                  {summary.inspectorNarrative || <span className="text-muted-foreground">— no narrative —</span>}
                </div>
              </div>

              <div>
                <Label>Reviewer Comments</Label>
                <Textarea
                  rows={3}
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder="Comments to the inspector (required for changes)…"
                />
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground py-8 text-center">Loading summary…</div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              disabled={acting || !comments.trim()}
              onClick={() => handleAction(false)}
            >
              Request Changes
            </Button>
            <Button disabled={acting} onClick={() => handleAction(true)}>
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Box({ label, v }: { label: string; v: number | string }) {
  return (
    <div className="p-2 border rounded-md">
      <div className="text-lg font-bold">{v}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
