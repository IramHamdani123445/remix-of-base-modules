import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { formatXCD } from '@/components/compliance/arrangements/arrangementFormat';
import { formatDateForDisplay } from '@/lib/format-config';
import { useWaiverDetail } from '@/hooks/compliance/useWaiverRegister';
import { approveWaiver, rejectWaiver, cancelWaiver } from '@/services/waiverService';

interface Props {
  waiverId: string | null;
  onClose: () => void;
}

function toneClass(tone?: string | null) {
  switch (tone) {
    case 'success':
      return 'bg-success/10 text-success border-success/30';
    case 'warning':
      return 'bg-warning/10 text-warning border-warning/30';
    case 'destructive':
      return 'bg-destructive/10 text-destructive border-destructive/30';
    case 'primary':
      return 'bg-primary/10 text-primary border-primary/30';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm font-medium break-words">{value ?? '—'}</div>
    </div>
  );
}

export function WaiverDetailDialog({ waiverId, onClose }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useWaiverDetail(waiverId);

  const [decisionAmount, setDecisionAmount] = useState('');
  const [comments, setComments] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  const waiver = data?.waiver;
  const actor = data?.actor;
  const thresholds = data?.thresholds;

  useEffect(() => {
    if (waiver) {
      setDecisionAmount(String(waiver.amount_requested ?? ''));
      setComments('');
      setRejectReason('');
      setCancelReason('');
    }
  }, [waiver?.waiver_id]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ce-waiver-register'] });
    qc.invalidateQueries({ queryKey: ['ce-waiver-detail'] });
    qc.invalidateQueries({ queryKey: ['ce_waivers'] });
  };

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!waiver) return;
      const amount = Number(decisionAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid approved amount');
      await approveWaiver({
        waiverId: waiver.waiver_id,
        approvedAmount: amount,
        comments: comments.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast.success('Waiver approved and applied to the case balance');
      invalidate();
      onClose();
    },
    onError: (e: any) => toast.error(e?.message || 'Approval failed'),
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      if (!waiver) return;
      if (rejectReason.trim().length < 10) throw new Error('Provide a rejection reason (minimum 10 characters)');
      await rejectWaiver({ waiverId: waiver.waiver_id, reason: rejectReason.trim() });
    },
    onSuccess: () => {
      toast.success('Waiver request rejected');
      invalidate();
      onClose();
    },
    onError: (e: any) => toast.error(e?.message || 'Rejection failed'),
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!waiver) return;
      if (cancelReason.trim().length < 5) throw new Error('Provide a withdrawal reason');
      await cancelWaiver({ waiverId: waiver.waiver_id, reason: cancelReason.trim() });
    },
    onSuccess: () => {
      toast.success('Waiver request withdrawn');
      invalidate();
      onClose();
    },
    onError: (e: any) => toast.error(e?.message || 'Withdrawal failed'),
  });

  const capBreach = useMemo(() => {
    if (!waiver?.rule_cap_amount) return false;
    return Number(decisionAmount || 0) > Number(waiver.rule_cap_amount);
  }, [decisionAmount, waiver?.rule_cap_amount]);

  const busy = approveMutation.isPending || rejectMutation.isPending || cancelMutation.isPending;
  const decisionAllowed = waiver?.is_open && actor?.can_approve && !actor?.is_own_request;
  const needsHighValue =
    waiver?.high_value && !actor?.can_approve_high && !actor?.is_admin;

  return (
    <Dialog open={!!waiverId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}

        {isError && (
          <div className="p-4 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {error?.message === 'NOT_AUTHORISED'
              ? 'You do not have access to this waiver request.'
              : (error?.message ?? 'Unable to load this waiver request.')}
          </div>
        )}

        {waiver && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span>{waiver.waiver_number}</span>
                <Badge variant="outline" className={toneClass(waiver.status_tone)}>
                  {waiver.status_label ?? waiver.status_code}
                </Badge>
                <Badge variant="outline">{waiver.component_label}</Badge>
                {waiver.scope_label && <Badge variant="outline">{waiver.scope_label}</Badge>}
                {waiver.high_value && (
                  <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">
                    High value
                  </Badge>
                )}
              </DialogTitle>
              <DialogDescription>
                Requested by {waiver.requested_by_name ?? 'Unrecorded requester'} on{' '}
                {formatDateForDisplay(waiver.requested_at)} · {waiver.waiting_days} day(s) in the queue ·
                Source: {waiver.source_label}
              </DialogDescription>
            </DialogHeader>

            {/* Traceability */}
            <Card>
              <CardContent className="p-3 grid gap-3 md:grid-cols-4">
                <Field
                  label="Employer"
                  value={
                    <button
                      type="button"
                      className="text-primary hover:underline inline-flex items-center gap-1 text-left"
                      onClick={() => navigate(`/compliance/employers/${waiver.employer_id}`)}
                    >
                      {waiver.employer_name ?? 'Employer'}
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  }
                />
                <Field label="Registration number" value={waiver.regno ?? '—'} />
                <Field
                  label="Compliance case"
                  value={
                    waiver.case_id ? (
                      <button
                        type="button"
                        className="text-primary hover:underline inline-flex items-center gap-1"
                        onClick={() => navigate(`/compliance/cases/${waiver.case_id}`)}
                      >
                        {waiver.case_number ?? 'Case'}
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    ) : (
                      <span className="text-warning">Not linked to a case</span>
                    )
                  }
                />
                <Field
                  label="Violation"
                  value={
                    waiver.violation_id ? (
                      <button
                        type="button"
                        className="text-primary hover:underline inline-flex items-center gap-1"
                        onClick={() => navigate(`/compliance/violations/${waiver.violation_id}`)}
                      >
                        {waiver.violation_number ?? 'Violation'}
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    ) : (
                      '—'
                    )
                  }
                />
              </CardContent>
            </Card>

            {/* Financial transparency */}
            <div className="grid gap-3 md:grid-cols-2">
              <Card>
                <CardContent className="p-3 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Waiver amounts
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Requested" value={formatXCD(waiver.amount_requested)} />
                    <Field
                      label="Approved"
                      value={waiver.amount_approved != null ? formatXCD(waiver.amount_approved) : 'Not decided'}
                    />
                    <Field
                      label="Difference"
                      value={waiver.amount_difference != null ? formatXCD(waiver.amount_difference) : '—'}
                    />
                    <Field
                      label="Approved share"
                      value={waiver.approved_pct != null ? `${waiver.approved_pct}%` : '—'}
                    />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Case financial position
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Case total" value={waiver.case_total != null ? formatXCD(waiver.case_total) : '—'} />
                    <Field label="Paid" value={waiver.case_paid != null ? formatXCD(waiver.case_paid) : '—'} />
                    <Field label="Already waived" value={waiver.case_waived != null ? formatXCD(waiver.case_waived) : '—'} />
                    <Field
                      label="Outstanding"
                      value={waiver.case_outstanding != null ? formatXCD(waiver.case_outstanding) : '—'}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Approval reduces the outstanding balance only. The original assessed debt is never deleted.
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Rule context */}
            <Card>
              <CardContent className="p-3 grid gap-3 md:grid-cols-4">
                <Field label="Applied rule" value={waiver.rule_name ?? 'No rule referenced'} />
                <Field
                  label="Maximum share"
                  value={waiver.rule_max_percentage != null ? `${waiver.rule_max_percentage}%` : '—'}
                />
                <Field
                  label="Permitted ceiling"
                  value={waiver.rule_cap_amount != null ? formatXCD(waiver.rule_cap_amount) : '—'}
                />
                <Field
                  label="Approval authority"
                  value={
                    waiver.rule_required_role
                      ? `${waiver.rule_required_role}${waiver.rule_escalated_role ? ` → ${waiver.rule_escalated_role}` : ''}`
                      : '—'
                  }
                />
              </CardContent>
            </Card>

            {/* Justification and evidence */}
            <Card>
              <CardContent className="p-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Justification
                </p>
                <p className="text-sm whitespace-pre-wrap">
                  {waiver.justification || <span className="text-warning">No justification recorded</span>}
                </p>
                {waiver.weak_justification && (
                  <p className="text-xs text-warning flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Justification is shorter than the required standard.
                  </p>
                )}
                <Separator />
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Supporting evidence ({waiver.document_count})
                </p>
                {waiver.document_count === 0 ? (
                  <p className="text-xs text-muted-foreground">No supporting documents attached.</p>
                ) : (
                  <ul className="space-y-1">
                    {(waiver.supporting_documents ?? []).map((d, i) => (
                      <li key={i} className="text-sm flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                        {d?.url ? (
                          <a href={d.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                            {d?.name ?? `Document ${i + 1}`}
                          </a>
                        ) : (
                          (d?.name ?? `Document ${i + 1}`)
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Employer waiver history */}
            {(data?.previous_waivers?.length ?? 0) > 0 && (
              <Card>
                <CardContent className="p-3 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Previous waivers for this employer
                  </p>
                  <div className="space-y-1">
                    {data!.previous_waivers.map((p) => (
                      <div key={p.waiver_id} className="flex items-center justify-between text-xs border-b pb-1">
                        <span className="font-medium">{p.waiver_number}</span>
                        <span className="text-muted-foreground">{p.component_label}</span>
                        <span>{p.status_label}</span>
                        <span>{formatXCD(p.amount_approved ?? p.amount_requested)}</span>
                        <span className="text-muted-foreground">{formatDateForDisplay(p.requested_at)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Decision timeline */}
            <Card>
              <CardContent className="p-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Decision history
                </p>
                {(data?.timeline?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground">No decisions recorded yet.</p>
                ) : (
                  <ol className="space-y-2">
                    {data!.timeline.map((t) => (
                      <li key={t.id} className="text-sm border-l-2 border-border pl-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{t.action}</span>
                          <span className="text-muted-foreground text-xs">
                            {t.from_label ? `${t.from_label} → ` : ''}
                            {t.to_label ?? t.to_status}
                          </span>
                          {t.amount != null && <Badge variant="outline">{formatXCD(t.amount)}</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t.acted_by_name ?? 'System'} · {formatDateForDisplay(t.acted_at)}
                        </p>
                        {(t.reason || t.comments) && (
                          <p className="text-xs mt-0.5 whitespace-pre-wrap">{t.reason || t.comments}</p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>

            {/* Action centre */}
            <Card className="border-primary/30">
              <CardContent className="p-3 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Decision
                </p>

                {!waiver.is_open && (
                  <p className="text-sm text-muted-foreground">
                    This request is closed ({waiver.status_label}). No further decision is possible.
                  </p>
                )}

                {waiver.is_open && actor?.is_own_request && (
                  <p className="text-sm text-warning flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4" />
                    You raised this request, so you cannot decide it. A second officer must review it.
                  </p>
                )}

                {waiver.is_open && !actor?.can_approve && !actor?.is_own_request && (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4" />
                    You do not hold waiver approval authority. This request is read-only for you.
                  </p>
                )}

                {decisionAllowed && (
                  <>
                    {needsHighValue && (
                      <p className="text-xs text-warning flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        This is a high-value request (above {formatXCD(thresholds?.high_value_amount ?? 0)}) and may be
                        refused by the server unless you hold senior authority.
                      </p>
                    )}
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="waiver-approved-amount">Approved amount</Label>
                        <Input
                          id="waiver-approved-amount"
                          type="number"
                          min={0}
                          step="0.01"
                          value={decisionAmount}
                          onChange={(e) => setDecisionAmount(e.target.value)}
                        />
                        {capBreach && (
                          <p className="text-xs text-destructive flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Above the rule ceiling of {formatXCD(waiver.rule_cap_amount!)} — the server will refuse this
                            amount.
                          </p>
                        )}
                        <Label htmlFor="waiver-comments">Approval comments</Label>
                        <Textarea
                          id="waiver-comments"
                          rows={2}
                          value={comments}
                          onChange={(e) => setComments(e.target.value)}
                          placeholder="Basis for the decision"
                        />
                        <Button
                          className="w-full"
                          disabled={busy || capBreach}
                          onClick={() => approveMutation.mutate()}
                        >
                          {approveMutation.isPending ? (
                            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4 mr-1.5" />
                          )}
                          Approve and apply
                        </Button>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="waiver-reject-reason">Rejection reason</Label>
                        <Textarea
                          id="waiver-reject-reason"
                          rows={4}
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="Explain why the request is refused"
                        />
                        <Button
                          variant="destructive"
                          className="w-full"
                          disabled={busy}
                          onClick={() => rejectMutation.mutate()}
                        >
                          {rejectMutation.isPending ? (
                            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                          ) : (
                            <XCircle className="h-4 w-4 mr-1.5" />
                          )}
                          Reject request
                        </Button>
                      </div>
                    </div>
                  </>
                )}

                {waiver.is_open && (actor?.is_own_request || actor?.is_admin) && (
                  <>
                    <Separator />
                    <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
                      <div className="space-y-1">
                        <Label htmlFor="waiver-cancel-reason">Withdraw request</Label>
                        <Input
                          id="waiver-cancel-reason"
                          value={cancelReason}
                          onChange={(e) => setCancelReason(e.target.value)}
                          placeholder="Reason for withdrawal"
                        />
                      </div>
                      <Button variant="outline" disabled={busy} onClick={() => cancelMutation.mutate()}>
                        {cancelMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        ) : (
                          <Ban className="h-4 w-4 mr-1.5" />
                        )}
                        Withdraw
                      </Button>
                    </div>
                  </>
                )}

                {waiver.case_id && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => navigate(`/compliance/cases/${waiver.case_id}`)}
                  >
                    Open the compliance case
                    <ArrowUpRight className="h-3 w-3 ml-1" />
                  </Button>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default WaiverDetailDialog;
