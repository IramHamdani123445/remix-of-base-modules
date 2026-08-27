import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2, XCircle, Lock, Loader2, AlertTriangle } from 'lucide-react';
import { useEngagementClosureGate, useCloseEngagement } from '@/hooks/useAuditClosureCommands';
import { useInternalAuditPermissions } from '@/hooks/useInternalAuditPermissions';

const RATINGS = ['Satisfactory', 'Needs Improvement', 'Unsatisfactory'];

interface Props {
  auditId: string;
  audit: any;
}

export function AuditClosureTab({ auditId, audit }: Props) {
  const { data: gate, isLoading } = useEngagementClosureGate(auditId);
  const closeAudit = useCloseEngagement();
  const { can } = useInternalAuditPermissions();
  const canClose = can('close_department_audit');

  const [disposition, setDisposition] = React.useState<'Closed' | 'Closed – Actions Pending'>('Closed');
  const [rating, setRating] = React.useState('');
  const [notes, setNotes] = React.useState('');

  React.useEffect(() => {
    if (gate?.suggested_disposition) setDisposition(gate.suggested_disposition);
  }, [gate?.suggested_disposition]);

  const isClosed = ['Closed', 'Closed – Actions Pending'].includes(audit?.execution_status || '');

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Checking closure readiness...
        </CardContent>
      </Card>
    );
  }

  const blockers = gate?.blockers || [];
  const requirements = [
    { code: 'activities_open', label: 'All audit activities completed' },
    { code: 'findings_draft', label: 'No findings left in Draft or Under Review' },
    { code: 'findings_without_response', label: 'Every finding has a management response' },
    { code: 'report_not_issued', label: 'Audit report issued' },
    { code: 'quality_review_pending', label: 'Quality review signed off' },
  ];

  return (
    <div className="space-y-4">
      {isClosed && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-primary/10 border border-primary/20">
          <Lock className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">
            This audit is closed ({audit?.execution_status}).
          </span>
          {audit?.closed_by && <Badge variant="outline">Closed by {audit.closed_by}</Badge>}
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" /> Closure Requirements
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {requirements.map((req) => {
            const blocker = blockers.find((b) => b.code === req.code);
            const passed = !blocker;
            return (
              <div
                key={req.code}
                className={`flex items-center gap-3 rounded-md border px-3 py-2 ${passed ? 'border-primary/20 bg-primary/5' : 'border-destructive/30 bg-destructive/5'}`}
              >
                {passed ? (
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive shrink-0" />
                )}
                <span className="text-sm flex-1">{req.label}</span>
                {blocker && <span className="text-xs text-destructive">{blocker.message}</span>}
              </div>
            );
          })}

          <div className="flex items-center gap-4 pt-2 text-xs text-muted-foreground">
            <span>Open corrective actions: {gate?.open_actions ?? 0}</span>
            <span>Open follow-ups: {gate?.open_follow_ups ?? 0}</span>
            <span className="italic">Actions and follow-ups do not block closure.</span>
          </div>
        </CardContent>
      </Card>

      {!isClosed && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Close Audit</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Closure disposition</label>
                <Select value={disposition} onValueChange={(v) => setDisposition(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Closed">Closed</SelectItem>
                    <SelectItem value="Closed – Actions Pending">Closed – Actions Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Final audit rating</label>
                <Select value={rating} onValueChange={setRating}>
                  <SelectTrigger><SelectValue placeholder="Select rating" /></SelectTrigger>
                  <SelectContent>
                    {RATINGS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Textarea
              rows={3}
              placeholder="Closure notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />

            {!canClose && (
              <div className="flex items-center gap-2 text-xs text-amber-600">
                <AlertTriangle className="h-3 w-3" />
                You do not hold the audit closure permission.
              </div>
            )}

            <Button
              disabled={!canClose || !gate?.can_close || closeAudit.isPending}
              onClick={() =>
                closeAudit.mutate({
                  engagementId: auditId,
                  disposition,
                  finalRating: rating || null,
                  notes: notes || null,
                })
              }
            >
              {closeAudit.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Close Audit
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
