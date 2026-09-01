import React, { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { StatusBadge } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, CalendarClock, CheckCircle2, History, RotateCcw, ShieldCheck, XCircle } from 'lucide-react';
import { formatDateForDisplay } from '@/lib/format-config';
import {
  useIaActionCapabilities,
  useIaActionHistory,
  useIaActionAssign,
  useIaActionUpdateProgress,
  useIaActionRequestExtension,
  useIaActionDecideExtension,
  useIaActionSubmitCompletion,
  useIaActionStartVerification,
  useIaActionVerify,
  useIaActionRejectVerification,
  useIaActionReopen,
  useIaActionCancel,
  useIaActionClose,
  useIaFollowUpSchedule,
} from '@/hooks/useAuditActionCentre';

interface ActionLifecycleDialogProps {
  action: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Operation =
  | 'progress'
  | 'extension'
  | 'completion'
  | 'verify'
  | 'reject'
  | 'reopen'
  | 'cancel'
  | 'close'
  | 'followup'
  | 'retarget';

const TERMINAL = ['Closed', 'Cancelled'];

export function ActionLifecycleDialog({ action, open, onOpenChange }: ActionLifecycleDialogProps) {
  const actionId = action?.action_id ?? action?.id ?? null;
  const { data: caps } = useIaActionCapabilities(open ? actionId : null);
  const { data: history } = useIaActionHistory(open ? actionId : null);

  const [operation, setOperation] = useState<Operation | null>(null);
  const [progressPct, setProgressPct] = useState<number>(action?.progress_pct ?? 0);
  const [note, setNote] = useState('');
  const [proposedDate, setProposedDate] = useState('');
  const [requestMoreEvidence, setRequestMoreEvidence] = useState(false);

  const assign = useIaActionAssign();
  const updateProgress = useIaActionUpdateProgress();
  const requestExtension = useIaActionRequestExtension();
  const decideExtension = useIaActionDecideExtension();
  const submitCompletion = useIaActionSubmitCompletion();
  const startVerification = useIaActionStartVerification();
  const verify = useIaActionVerify();
  const rejectVerification = useIaActionRejectVerification();
  const reopen = useIaActionReopen();
  const cancel = useIaActionCancel();
  const close = useIaActionClose();
  const scheduleFollowUp = useIaFollowUpSchedule();

  const status: string = action?.lifecycle_status || 'Open';
  const isTerminal = TERMINAL.includes(status);
  const canManage = !!caps?.canManage;
  const canVerify = !!caps?.canVerify;

  const pendingExtension = useMemo(
    () => (history?.extensions ?? []).find((x: any) => x.status === 'Requested'),
    [history],
  );

  const reset = () => {
    setOperation(null);
    setNote('');
    setProposedDate('');
    setRequestMoreEvidence(false);
  };

  const done = () => { reset(); onOpenChange(false); };

  const run = async (fn: Promise<any>) => {
    try { await fn; reset(); } catch { /* toast already surfaced by the hook */ }
  };

  if (!action) return null;

  const overdue = Number(action.overdue_days || 0) > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm">{action.action_ref || 'Corrective Action'}</span>
            <StatusBadge status={status} />
            {overdue && (
              <span className="text-xs font-semibold text-destructive inline-flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" /> {action.overdue_days} day(s) overdue
              </span>
            )}
          </DialogTitle>
          <DialogDescription>{action.action_description || '—'}</DialogDescription>
        </DialogHeader>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <Field label="Audit" value={action.engagement_code || action.engagement_name} />
          <Field label="Department" value={action.department_name} />
          <Field label="Business function" value={action.function_name} />
          <Field label="Finding" value={action.finding_title} />
          <Field label="Owner" value={action.action_owner} />
          <Field label="Original target" value={formatDateForDisplay(action.original_target_date)} />
          <Field label="Current target" value={formatDateForDisplay(action.current_target_date)} />
          <Field label="Extensions" value={String(action.extension_count ?? 0)} />
          <Field label="Evidence" value={action.evidence_state} />
          <Field label="Verification" value={action.verification_status} />
          <Field label="Reopened" value={String(action.reopen_count ?? 0)} />
          <Field label="Follow-up" value={action.follow_up_state} />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Implementation progress</span>
            <span>{action.progress_pct ?? 0}%</span>
          </div>
          <Progress value={Number(action.progress_pct ?? 0)} className="h-2" />
        </div>

        <Separator />

        {/* Governed operations */}
        {isTerminal ? (
          <p className="text-xs text-muted-foreground">
            This action is {status.toLowerCase()}. {action.closure_notes || action.cancelled_reason || ''}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {canManage && <Op label="Record progress" onClick={() => setOperation('progress')} />}
            {canManage && <Op label="Request extension" icon={<CalendarClock className="h-3.5 w-3.5" />} onClick={() => setOperation('extension')} />}
            {canManage && <Op label="Submit as complete" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => setOperation('completion')} />}
            {canVerify && status === 'Verification Required' && (
              <Op label="Start verification" icon={<ShieldCheck className="h-3.5 w-3.5" />} onClick={() => run(startVerification.mutateAsync({ actionId }))} />
            )}
            {canVerify && <Op label="Verify" icon={<ShieldCheck className="h-3.5 w-3.5" />} onClick={() => setOperation('verify')} />}
            {canVerify && <Op label="Return to management" icon={<XCircle className="h-3.5 w-3.5" />} onClick={() => setOperation('reject')} />}
            {canVerify && <Op label="Reopen" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setOperation('reopen')} />}
            {canVerify && <Op label="Schedule follow-up" onClick={() => setOperation('followup')} />}
            {canVerify && <Op label="Close action" onClick={() => setOperation('close')} />}
            {canVerify && <Op label="Cancel action" variant="destructive" onClick={() => setOperation('cancel')} />}
            {!canManage && !canVerify && (
              <p className="text-xs text-muted-foreground">You have read-only access to this action.</p>
            )}
          </div>
        )}

        {/* Extension decision */}
        {pendingExtension && canVerify && (
          <Card className="border-amber-300 dark:border-amber-800/40">
            <CardContent className="p-3 space-y-2">
              <p className="text-xs font-semibold">Extension requested</p>
              <p className="text-xs text-muted-foreground">
                New target {formatDateForDisplay(pendingExtension.proposed_date)} — {pendingExtension.reason}
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => run(decideExtension.mutateAsync({ extensionId: pendingExtension.id, decision: 'Approved', comments: note }))}>
                  Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => run(decideExtension.mutateAsync({ extensionId: pendingExtension.id, decision: 'Rejected', comments: note }))}>
                  Reject
                </Button>
              </div>
              <Textarea rows={2} placeholder="Decision comments" value={note} onChange={e => setNote(e.target.value)} />
            </CardContent>
          </Card>
        )}

        {/* Operation forms */}
        {operation === 'progress' && (
          <Form title="Record progress" onCancel={reset} onSubmit={() => run(updateProgress.mutateAsync({ actionId, progressPct, note }))} disabled={!note.trim()}>
            <div>
              <Label className="text-xs">Progress %</Label>
              <Input type="number" min={0} max={100} value={progressPct} onChange={e => setProgressPct(Number(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs">Update note (required)</Label>
              <Textarea rows={3} value={note} onChange={e => setNote(e.target.value)} />
            </div>
          </Form>
        )}

        {operation === 'extension' && (
          <Form title="Request target date extension" onCancel={reset} onSubmit={() => run(requestExtension.mutateAsync({ actionId, proposedDate, reason: note }))} disabled={!proposedDate || !note.trim()}>
            <div>
              <Label className="text-xs">Proposed new target date</Label>
              <Input type="date" value={proposedDate} onChange={e => setProposedDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Justification (required)</Label>
              <Textarea rows={3} value={note} onChange={e => setNote(e.target.value)} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              The original target date of {formatDateForDisplay(action.original_target_date)} is retained for reporting.
            </p>
          </Form>
        )}

        {operation === 'completion' && (
          <Form title="Submit as implemented" onCancel={reset} onSubmit={() => run(submitCompletion.mutateAsync({ actionId, note }))} disabled={!note.trim()}>
            <div>
              <Label className="text-xs">Completion statement (required)</Label>
              <Textarea rows={3} value={note} onChange={e => setNote(e.target.value)} />
            </div>
          </Form>
        )}

        {operation === 'verify' && (
          <Form title="Verify implementation" onCancel={reset} onSubmit={() => run(verify.mutateAsync({ actionId, notes: note }))} disabled={!note.trim()}>
            <div>
              <Label className="text-xs">Verification conclusion (required)</Label>
              <Textarea rows={3} value={note} onChange={e => setNote(e.target.value)} />
            </div>
          </Form>
        )}

        {operation === 'reject' && (
          <Form title="Return to management" onCancel={reset} onSubmit={() => run(rejectVerification.mutateAsync({ actionId, reason: note, requestMoreEvidence }))} disabled={!note.trim()}>
            <div>
              <Label className="text-xs">Reason (required)</Label>
              <Textarea rows={3} value={note} onChange={e => setNote(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={requestMoreEvidence} onCheckedChange={v => setRequestMoreEvidence(!!v)} />
              Request additional evidence
            </label>
          </Form>
        )}

        {operation === 'reopen' && (
          <Form title="Reopen action" onCancel={reset} onSubmit={() => run(reopen.mutateAsync({ actionId, reason: note, newTargetDate: proposedDate || null }))} disabled={!note.trim()}>
            <div>
              <Label className="text-xs">Reason (required)</Label>
              <Textarea rows={3} value={note} onChange={e => setNote(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">New target date (optional)</Label>
              <Input type="date" value={proposedDate} onChange={e => setProposedDate(e.target.value)} />
            </div>
          </Form>
        )}

        {operation === 'followup' && (
          <Form title="Schedule follow-up" onCancel={reset} onSubmit={() => run(scheduleFollowUp.mutateAsync({ actionId, scheduledDate: proposedDate, notes: note }))} disabled={!proposedDate}>
            <div>
              <Label className="text-xs">Follow-up date</Label>
              <Input type="date" value={proposedDate} onChange={e => setProposedDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} />
            </div>
          </Form>
        )}

        {operation === 'close' && (
          <Form title="Close action" onCancel={reset} onSubmit={() => run(close.mutateAsync({ actionId, closureNotes: note }))} disabled={!note.trim()}>
            <div>
              <Label className="text-xs">Closure notes (required)</Label>
              <Textarea rows={3} value={note} onChange={e => setNote(e.target.value)} />
            </div>
          </Form>
        )}

        {operation === 'cancel' && (
          <Form title="Cancel action" onCancel={reset} onSubmit={() => run(cancel.mutateAsync({ actionId, reason: note }))} disabled={!note.trim()}>
            <div>
              <Label className="text-xs">Cancellation reason (required)</Label>
              <Textarea rows={3} value={note} onChange={e => setNote(e.target.value)} />
            </div>
          </Form>
        )}

        <Separator />

        {/* History */}
        <div className="space-y-2">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <History className="h-3.5 w-3.5" /> Action history
          </p>
          {(history?.progress ?? []).length === 0 && (history?.extensions ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No recorded updates yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {(history?.progress ?? []).map((p: any) => (
                <div key={p.id} className="text-xs border-l-2 border-border pl-2 py-0.5">
                  <span className="font-medium">{p.entry_type || 'Update'}</span>
                  {p.progress_pct != null && <span className="text-muted-foreground"> · {p.progress_pct}%</span>}
                  <span className="text-muted-foreground"> · {formatDateForDisplay(p.created_at)}</span>
                  <div className="text-muted-foreground">{p.note}</div>
                </div>
              ))}
              {(history?.extensions ?? []).map((x: any) => (
                <div key={x.id} className="text-xs border-l-2 border-amber-400 pl-2 py-0.5">
                  <span className="font-medium">Extension {x.status}</span>
                  <span className="text-muted-foreground"> · to {formatDateForDisplay(x.proposed_date || x.new_target_date)}</span>
                  <div className="text-muted-foreground">{x.reason}{x.decision_comments ? ` — ${x.decision_comments}` : ''}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={done}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium break-words">{value || '—'}</p>
    </div>
  );
}

function Op({ label, onClick, icon, variant = 'outline' }: { label: string; onClick: () => void; icon?: React.ReactNode; variant?: 'outline' | 'destructive' }) {
  return (
    <Button size="sm" variant={variant} onClick={onClick} className="gap-1.5">
      {icon}{label}
    </Button>
  );
}

function Form({ title, children, onSubmit, onCancel, disabled }: {
  title: string; children: React.ReactNode; onSubmit: () => void; onCancel: () => void; disabled?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        <p className="text-xs font-semibold">{title}</p>
        {children}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={onSubmit} disabled={disabled}>Submit</Button>
        </div>
      </CardContent>
    </Card>
  );
}
