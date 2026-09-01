import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StandardModal } from '@/components/common';
import { History, CheckCircle2, Link2, Unlink, ShieldAlert } from 'lucide-react';
import {
  usePriorActionDetail,
  usePriorAuditHistory,
  usePriorAuditHistoryMutations,
  type PriorRelationshipType,
} from '@/hooks/audit/usePriorAuditHistory';
import { formatDateForDisplay } from '@/utils/dateFormat';

interface PriorAuditHistoryPanelProps {
  engagementId: string;
}

const RELATIONSHIPS: Array<{ value: PriorRelationshipType; label: string }> = [
  { value: 'PRIOR_ACTION_REVIEW', label: 'Prior action review' },
  { value: 'REPEAT_FINDING', label: 'Repeat finding' },
  { value: 'FOLLOWUP_RETEST', label: 'Follow-up re-test' },
];

/**
 * Auditor-private Prior Audit History.
 *
 * Prior corrective actions stay owned by their original audit and finding.
 * "Review in Current Audit" only creates a reference — it never re-parents,
 * clones, or auto-creates a finding in the current audit.
 */
export function PriorAuditHistoryPanel({ engagementId }: PriorAuditHistoryPanelProps) {
  const [sameFunctionOnly, setSameFunctionOnly] = useState(false);
  const [linkTarget, setLinkTarget] = useState<any | null>(null);
  const [relationship, setRelationship] = useState<PriorRelationshipType>('PRIOR_ACTION_REVIEW');
  const [reason, setReason] = useState('');
  const [ackNote, setAckNote] = useState('');

  const { data: history, isLoading } = usePriorAuditHistory(engagementId, sameFunctionOnly);
  const { data: detail, isLoading: detailLoading } = usePriorActionDetail(engagementId, sameFunctionOnly);
  const { linkPriorAction, unlinkPriorAction, acknowledgeHistory } = usePriorAuditHistoryMutations(engagementId);

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  if (!history?.success) {
    return (
      <Alert variant="destructive">
        <ShieldAlert className="h-4 w-4" />
        <AlertDescription>
          {history?.error || 'Prior Audit History is not available to your role.'}
        </AlertDescription>
      </Alert>
    );
  }

  const priorAudits = history.prior_audits || [];
  const actions = detail?.actions || [];
  const acknowledged = !!history.acknowledged_at;

  const submitLink = () => {
    if (!linkTarget) return;
    linkPriorAction.mutate(
      { priorActionId: linkTarget.action_id, relationshipType: relationship, relevanceReason: reason },
      {
        onSuccess: () => {
          setLinkTarget(null);
          setReason('');
          setRelationship('PRIOR_ACTION_REVIEW');
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Prior Audit History</span>
          <Badge variant="secondary">{priorAudits.length} prior audit(s)</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="same-function" checked={sameFunctionOnly} onCheckedChange={setSameFunctionOnly} />
          <Label htmlFor="same-function" className="text-xs">Same function only</Label>
        </div>
      </div>

      {priorAudits.length === 0 ? (
        <Alert>
          <AlertDescription className="text-sm">
            No previous audits exist for this department, so no prior-history review is required.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Previous audits</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left p-2 font-medium">Reference</th>
                    <th className="text-left p-2 font-medium">Audit</th>
                    <th className="text-left p-2 font-medium">Period</th>
                    <th className="text-left p-2 font-medium">Final Report</th>
                    <th className="text-left p-2 font-medium">Closure</th>
                    <th className="text-left p-2 font-medium">Findings</th>
                    <th className="text-left p-2 font-medium">Actions</th>
                    <th className="text-left p-2 font-medium">Follow-Ups</th>
                  </tr>
                </thead>
                <tbody>
                  {priorAudits.map((a: any) => (
                    <tr key={a.engagement_id} className="border-b last:border-0 align-top">
                      <td className="p-2 font-mono text-xs">{a.reference}</td>
                      <td className="p-2 font-medium">{a.title}</td>
                      <td className="p-2 text-xs">{a.period}</td>
                      <td className="p-2 text-xs">{a.final_report_date ? formatDateForDisplay(a.final_report_date) : '—'}</td>
                      <td className="p-2"><Badge variant="outline">{a.closure_status || '—'}</Badge></td>
                      <td className="p-2 text-xs">
                        {a.findings?.total || 0} total · {a.findings?.critical || 0}C / {a.findings?.high || 0}H /{' '}
                        {a.findings?.medium || 0}M / {a.findings?.low || 0}L · {a.findings?.open || 0} open
                      </td>
                      <td className="p-2 text-xs">
                        {a.actions?.open || 0} open · {a.actions?.in_progress || 0} in progress ·{' '}
                        <span className={a.actions?.overdue ? 'text-destructive font-semibold' : ''}>
                          {a.actions?.overdue || 0} overdue
                        </span>{' '}
                        · {a.actions?.verified || 0} verified · {a.actions?.closed || 0} closed
                      </td>
                      <td className="p-2 text-xs">
                        {a.follow_ups?.scheduled || 0} scheduled · {a.follow_ups?.overdue || 0} overdue ·{' '}
                        {a.follow_ups?.implemented || 0} implemented · {a.follow_ups?.not_implemented || 0} not implemented ·{' '}
                        {a.follow_ups?.reopened || 0} reopened
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Prior corrective actions</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {detailLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : actions.length === 0 ? (
                <p className="text-sm text-muted-foreground p-2">No corrective actions were raised in previous audits.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="text-left p-2 font-medium">Action</th>
                      <th className="text-left p-2 font-medium">Source Audit</th>
                      <th className="text-left p-2 font-medium">Finding</th>
                      <th className="text-left p-2 font-medium">Severity</th>
                      <th className="text-left p-2 font-medium">Responsible</th>
                      <th className="text-left p-2 font-medium">Original Due</th>
                      <th className="text-left p-2 font-medium">Target</th>
                      <th className="text-center p-2 font-medium">Progress</th>
                      <th className="text-left p-2 font-medium">Status</th>
                      <th className="text-left p-2 font-medium">Verification</th>
                      <th className="text-left p-2 font-medium">Follow-Up</th>
                      <th className="text-right p-2 font-medium">Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actions.map((a: any) => (
                      <tr key={a.action_id} className="border-b last:border-0">
                        <td className="p-2 font-mono text-xs">{a.action_ref}</td>
                        <td className="p-2 text-xs">{a.source_audit}</td>
                        <td className="p-2 text-xs">{a.finding_title || '—'}</td>
                        <td className="p-2">
                          {a.severity ? (
                            <Badge variant={['Critical', 'High'].includes(a.severity) ? 'destructive' : 'secondary'}>
                              {a.severity}
                            </Badge>
                          ) : '—'}
                        </td>
                        <td className="p-2 text-xs">{a.responsible_person || '—'}</td>
                        <td className="p-2 text-xs">{a.original_due_date ? formatDateForDisplay(a.original_due_date) : '—'}</td>
                        <td className="p-2 text-xs">{a.current_target_date ? formatDateForDisplay(a.current_target_date) : '—'}</td>
                        <td className="p-2 text-center tabular-nums text-xs">{a.progress_pct ?? 0}%</td>
                        <td className="p-2 text-xs">{a.lifecycle_status || '—'}</td>
                        <td className="p-2 text-xs">{a.verification_status || '—'}</td>
                        <td className="p-2 text-xs">{a.follow_up_status || '—'}</td>
                        <td className="p-2 text-right">
                          {a.linked_to_current ? (
                            <div className="flex items-center justify-end gap-1">
                              <Badge variant="default" className="text-[10px]">
                                {a.link?.relationship_type?.replace(/_/g, ' ').toLowerCase()}
                              </Badge>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => unlinkPriorAction.mutate(a.link.id)}
                                disabled={unlinkPriorAction.isPending}
                              >
                                <Unlink className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => setLinkTarget(a)}>
                              <Link2 className="h-3.5 w-3.5 mr-1" />Review in Current Audit
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <CheckCircle2 className={`h-4 w-4 ${acknowledged ? 'text-emerald-600' : 'text-muted-foreground'}`} />
                Prior Audit History Reviewed
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {acknowledged ? (
                <p className="text-sm text-muted-foreground">
                  Acknowledged by {history.acknowledged_by || 'the audit team'} on{' '}
                  {formatDateForDisplay(history.acknowledged_at!)}.
                  {history.acknowledgement_note && <> Note: “{history.acknowledgement_note}”.</>}
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Preparation cannot be completed until the audit team confirms prior history was reviewed.
                    Open prior actions are context — they do not block launch.
                  </p>
                  <Textarea
                    rows={2}
                    placeholder="Optional note on what prior history was considered..."
                    value={ackNote}
                    onChange={(e) => setAckNote(e.target.value)}
                  />
                  <Button
                    size="sm"
                    onClick={() => acknowledgeHistory.mutate(ackNote)}
                    disabled={acknowledgeHistory.isPending}
                  >
                    Confirm Prior Audit History Reviewed
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <StandardModal
        open={!!linkTarget}
        onOpenChange={(open) => !open && setLinkTarget(null)}
        title="Review prior corrective action in this audit"
        description="This creates a reference only. The action remains owned by its original audit and finding."
      >
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Relationship</Label>
            <Select value={relationship} onValueChange={(v) => setRelationship(v as PriorRelationshipType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RELATIONSHIPS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Relevance to this audit</Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this prior action relevant to the current scope or testing?" />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={submitLink} disabled={linkPriorAction.isPending}>Add reference</Button>
            <Button size="sm" variant="outline" onClick={() => setLinkTarget(null)}>Cancel</Button>
          </div>
        </div>
      </StandardModal>
    </div>
  );
}

export default PriorAuditHistoryPanel;
