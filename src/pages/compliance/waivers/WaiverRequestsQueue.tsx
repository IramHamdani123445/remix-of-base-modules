import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { PermissionButton } from '@/components/ui/permission-button';
import { useUserCode } from '@/hooks/useUserCode';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { BadgePercent, AlertCircle, CheckCircle2, XCircle, Clock } from 'lucide-react';
import {
  listWaiverRequests,
  approveWaiver,
  rejectWaiver,
  getWaiverDecisions,
  type WaiverRequest,
  type WaiverStatus,
} from '@/services/waiverService';
import { isComplianceFeatureEnabled } from '@/lib/compliance/featureToggles';

const PERMISSION = 'manage_compliance';

const STATUS_TABS: Array<{ key: WaiverStatus | 'ALL'; label: string }> = [
  { key: 'PENDING_APPROVAL', label: 'Pending Approval' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'APPLIED', label: 'Applied' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'ALL', label: 'All' },
];

function statusBadge(s: WaiverStatus) {
  const map: Record<WaiverStatus, { v: any; icon: any }> = {
    PENDING: { v: 'secondary', icon: Clock },
    PENDING_APPROVAL: { v: 'default', icon: Clock },
    APPROVED: { v: 'default', icon: CheckCircle2 },
    APPLIED: { v: 'outline', icon: CheckCircle2 },
    REJECTED: { v: 'destructive', icon: XCircle },
    CANCELLED: { v: 'outline', icon: XCircle },
  };
  const { v, icon: Icon } = map[s];
  return (
    <Badge variant={v} className="gap-1"><Icon className="h-3 w-3" />{s}</Badge>
  );
}

export default function WaiverRequestsQueue() {
  if (!isComplianceFeatureEnabled('admin.waiverRules')) {
    return (
      <div className="container mx-auto p-6">
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <AlertCircle className="mx-auto h-8 w-8 mb-2" />
          Waiver feature is disabled.
        </CardContent></Card>
      </div>
    );
  }
  return (
    <PermissionWrapper moduleName={PERMISSION}>
      <Inner />
    </PermissionWrapper>
  );
}

function Inner() {
  const qc = useQueryClient();
  const { userCode } = useUserCode();
  const [statusFilter, setStatusFilter] = useState<WaiverStatus | 'ALL'>('PENDING_APPROVAL');
  const [decision, setDecision] = useState<{ open: boolean; mode: 'approve' | 'reject'; wv: WaiverRequest | null }>({
    open: false, mode: 'approve', wv: null,
  });
  const [timeline, setTimeline] = useState<{ open: boolean; wv: WaiverRequest | null }>({ open: false, wv: null });

  const q = useQuery({
    queryKey: ['waiver-requests', statusFilter],
    queryFn: () => listWaiverRequests({ status: statusFilter }),
  });

  // Approved/rejected waivers change the derived case & violation balances, so
  // the compliance detail caches must be dropped too.
  const invalidateAffectedRecords = (wv?: WaiverRequest | null) => {
    qc.invalidateQueries({ queryKey: ['waiver-requests'] });
    qc.invalidateQueries({ queryKey: ['ce_case_detail'] });
    qc.invalidateQueries({ queryKey: ['ce_case_waived_amounts'] });
    qc.invalidateQueries({ queryKey: ['ce_case_violations'] });
    qc.invalidateQueries({ queryKey: ['ce_violation'] });
    qc.invalidateQueries({ queryKey: ['ce_violation_waived'] });
    qc.invalidateQueries({ queryKey: ['ce_cases'] });
    if (wv?.case_id) qc.invalidateQueries({ queryKey: ['ce_case_detail', wv.case_id] });
    if (wv?.violation_id) qc.invalidateQueries({ queryKey: ['ce_violation', wv.violation_id] });
  };

  const approve = useMutation({
    mutationFn: (args: { waiverId: string; approvedAmount: number; comments?: string }) =>
      approveWaiver({ ...args, userCode: userCode || 'SYSTEM' }),
    onSuccess: (_r, args) => {
      toast.success('Waiver approved & applied');
      invalidateAffectedRecords((q.data ?? []).find((r) => r.id === args.waiverId));
      setDecision({ open: false, mode: 'approve', wv: null });
    },
    onError: (e: any) => toast.error(e.message || 'Approve failed'),
  });
  const reject = useMutation({
    mutationFn: (args: { waiverId: string; reason: string; comments?: string }) =>
      rejectWaiver({ ...args, userCode: userCode || 'SYSTEM' }),
    onSuccess: (_r, args) => {
      toast.success('Waiver rejected — case returned to normal recovery');
      invalidateAffectedRecords((q.data ?? []).find((r) => r.id === args.waiverId));
      setDecision({ open: false, mode: 'reject', wv: null });
    },
    onError: (e: any) => toast.error(e.message || 'Reject failed'),
  });


  const rows = q.data ?? [];

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <BadgePercent className="h-6 w-6" /> Waiver Requests
        </h1>
        <p className="text-muted-foreground text-sm">
          Review, approve or reject waiver requests. Approved waivers update the case waived bucket
          without deleting the original amount; rejected requests return the case to normal recovery.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Label className="text-xs">Status:</Label>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_TABS.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Requests</CardTitle>
          <CardDescription>{rows.length} record(s)</CardDescription>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No waiver requests.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Employer</TableHead>
                  <TableHead>Case / Violation</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Approved</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Requested By</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-mono text-xs">{w.waiver_number}</TableCell>
                    <TableCell>{w.employer_id}</TableCell>
                    <TableCell className="text-xs">
                      {w.case_id && <div>Case: {w.case_id.slice(0, 8)}…</div>}
                      {w.violation_id && <div>Viol: {w.violation_id.slice(0, 8)}…</div>}
                    </TableCell>
                    <TableCell><Badge variant="outline">{w.waiver_type}</Badge></TableCell>
                    <TableCell>{Number(w.amount_requested ?? 0).toFixed(2)}</TableCell>
                    <TableCell>{w.amount_approved != null ? Number(w.amount_approved).toFixed(2) : '—'}</TableCell>
                    <TableCell>{statusBadge(w.status)}</TableCell>
                    <TableCell className="text-xs">{w.source ?? '—'}</TableCell>
                    <TableCell className="text-xs">{w.requested_by ?? '—'}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="ghost" size="sm"
                        onClick={() => setTimeline({ open: true, wv: w })}>
                        Timeline
                      </Button>
                      {(w.status === 'PENDING' || w.status === 'PENDING_APPROVAL') && (
                        <>
                          <PermissionButton moduleName={PERMISSION} actionName="approve"
                            size="sm"
                            onClick={() => setDecision({ open: true, mode: 'approve', wv: w })}>
                            Approve
                          </PermissionButton>
                          <PermissionButton moduleName={PERMISSION} actionName="reject"
                            variant="destructive" size="sm"
                            onClick={() => setDecision({ open: true, mode: 'reject', wv: w })}>
                            Reject
                          </PermissionButton>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {decision.open && decision.wv && (
        <DecisionDialog
          mode={decision.mode}
          wv={decision.wv}
          onClose={() => setDecision({ open: false, mode: 'approve', wv: null })}
          onApprove={(amount, comments) => approve.mutate({ waiverId: decision.wv!.id, approvedAmount: amount, comments })}
          onReject={(reason, comments) => reject.mutate({ waiverId: decision.wv!.id, reason, comments })}
          busy={approve.isPending || reject.isPending}
        />
      )}

      {timeline.open && timeline.wv && (
        <TimelineDialog wv={timeline.wv} onClose={() => setTimeline({ open: false, wv: null })} />
      )}
    </div>
  );
}

function DecisionDialog({
  mode, wv, onClose, onApprove, onReject, busy,
}: {
  mode: 'approve' | 'reject';
  wv: WaiverRequest;
  onClose: () => void;
  onApprove: (amount: number, comments?: string) => void;
  onReject: (reason: string, comments?: string) => void;
  busy: boolean;
}) {
  const [amount, setAmount] = useState<number>(Number(wv.amount_requested ?? 0));
  const [reason, setReason] = useState('');
  const [comments, setComments] = useState('');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'approve' ? 'Approve Waiver' : 'Reject Waiver'}</DialogTitle>
          <DialogDescription>
            {wv.waiver_number} · Requested {Number(wv.amount_requested ?? 0).toFixed(2)}
          </DialogDescription>
        </DialogHeader>
        {mode === 'approve' ? (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Approved Amount</Label>
              <Input type="number" min={0} max={Number(wv.amount_requested ?? 0)}
                value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs">Comments (optional)</Label>
              <Textarea rows={3} value={comments} onChange={(e) => setComments(e.target.value)} />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Rejection Reason (required)</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Insufficient hardship evidence" />
            </div>
            <div>
              <Label className="text-xs">Comments (optional)</Label>
              <Textarea rows={3} value={comments} onChange={(e) => setComments(e.target.value)} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {mode === 'approve' ? (
            <Button disabled={busy || amount < 0} onClick={() => onApprove(amount, comments)}>
              {busy ? 'Approving…' : 'Approve & Apply'}
            </Button>
          ) : (
            <Button variant="destructive" disabled={busy || !reason.trim()} onClick={() => onReject(reason, comments)}>
              {busy ? 'Rejecting…' : 'Reject'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TimelineDialog({ wv, onClose }: { wv: WaiverRequest; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['waiver-decisions', wv.id],
    queryFn: () => getWaiverDecisions(wv.id),
  });
  const items = q.data ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Waiver Timeline · {wv.waiver_number}</DialogTitle>
          <DialogDescription>Auditable record of every decision step.</DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground text-sm">No decisions recorded.</p>
        ) : (
          <ol className="space-y-3">
            {items.map((d: any) => (
              <li key={d.id} className="border-l-2 pl-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{d.action}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(d.acted_at), 'dd MMM yyyy HH:mm')} · {d.acted_by ?? '—'}
                  </span>
                </div>
                {d.amount != null && <div className="text-xs">Amount: {Number(d.amount).toFixed(2)}</div>}
                {d.reason && <div className="text-xs">Reason: {d.reason}</div>}
                {d.comments && <div className="text-xs text-muted-foreground">{d.comments}</div>}
                {d.from_status && (
                  <div className="text-[10px] text-muted-foreground">
                    {d.from_status} → {d.to_status}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
