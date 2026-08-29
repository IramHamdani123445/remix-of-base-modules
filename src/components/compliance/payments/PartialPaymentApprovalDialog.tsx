import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertCircle, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  approvePartialPayment,
  getActivePartialPaymentPolicy,
  getPartialPaymentEvents,
  rejectPartialPayment,
  type PartialPaymentRequest,
} from '@/services/partialPaymentService';
import {
  round2,
  validateAllocation,
  type CePartialPaymentAllocationLine,
} from '@/lib/compliance/partialPaymentAllocation';
import { formatCurrency } from '@/utils/formatCurrency';
import { format } from 'date-fns';

interface Props {
  request: PartialPaymentRequest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PartialPaymentApprovalDialog({ request, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [approvedAmount, setApprovedAmount] = useState('');
  const [comments, setComments] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [lines, setLines] = useState<CePartialPaymentAllocationLine[]>([]);

  const policyQ = useQuery({ queryKey: ['ce-pp-policy'], queryFn: () => getActivePartialPaymentPolicy() });
  const eventsQ = useQuery({
    queryKey: ['ce-pp-events', request?.id],
    queryFn: () => getPartialPaymentEvents(request!.id),
    enabled: open && !!request?.id,
  });

  useEffect(() => {
    if (!request) return;
    setApprovedAmount(String(request.requested_amount));
    setComments('');
    setRejectReason('');
    setLines(
      (request.ce_partial_payment_allocations ?? [])
        .slice()
        .sort((a, b) => a.allocation_sequence - b.allocation_sequence)
        .map((a) => ({
          payment_code: a.payment_code,
          fund_code: a.fund_code,
          bucket_label: a.bucket_label,
          outstanding_amount: Number(a.outstanding_amount),
          amount: Number(a.approved_amount ?? a.requested_amount),
        })),
    );
  }, [request]);

  const numericApproved = Number(approvedAmount) || 0;
  const liabilityView = useMemo(
    () => ({
      total_outstanding: Number(request?.total_liability ?? 0),
      buckets: lines.map((l) => ({
        payment_code: l.payment_code,
        fund_code: l.fund_code,
        bucket_label: l.bucket_label,
        outstanding_amount: l.outstanding_amount,
      })),
    }),
    [lines, request],
  );
  const validation = useMemo(
    () => validateAllocation(lines, numericApproved, liabilityView),
    [lines, numericApproved, liabilityView],
  );

  const policy = policyQ.data;
  const escalated =
    !!policy?.escalation_threshold_amount && numericApproved >= Number(policy.escalation_threshold_amount);

  const approve = useMutation({
    mutationFn: () =>
      approvePartialPayment({
        requestId: request!.id,
        approvedAmount: numericApproved,
        allocations: lines,
        comments,
        expectedVersion: request!.row_version,
      }),
    onSuccess: (res) => {
      toast.success(`Approved — payment authority ${res.authority_number} issued`);
      qc.invalidateQueries({ queryKey: ['ce-pp-requests'] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || 'Approval failed'),
  });

  const reject = useMutation({
    mutationFn: () =>
      rejectPartialPayment({
        requestId: request!.id,
        reason: rejectReason,
        comments,
        expectedVersion: request!.row_version,
      }),
    onSuccess: () => {
      toast.success('Request rejected — the full liability remains due');
      qc.invalidateQueries({ queryKey: ['ce-pp-requests'] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || 'Rejection failed'),
  });

  if (!request) return null;
  const decidable = request.status === 'PENDING_APPROVAL';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> {request.request_number}
          </DialogTitle>
          <DialogDescription>
            {request.employer_name ?? request.employer_id} — wage period{' '}
            {format(new Date(request.wage_period), 'MMMM yyyy')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-4 text-sm">
          <Metric label="Total liability" value={formatCurrency(request.total_liability)} />
          <Metric label="Offered" value={formatCurrency(request.requested_amount)} />
          <Metric
            label="Shortfall if approved"
            value={formatCurrency(round2(Number(request.total_liability) - numericApproved))}
          />
          <Metric label="Raised by" value={`${request.source} · ${request.requested_by ?? '—'}`} />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Employer's reason</Label>
          <p className="text-sm text-muted-foreground">{request.justification}</p>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payment category</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="text-right">Requested</TableHead>
                <TableHead className="text-right w-40">Approved allocation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, idx) => (
                <TableRow key={line.payment_code}>
                  <TableCell>
                    <span className="font-medium">{line.payment_code}</span>
                    <span className="text-muted-foreground"> — {line.bucket_label}</span>
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(line.outstanding_amount)}</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(
                      Number(
                        (request.ce_partial_payment_allocations ?? []).find(
                          (a) => a.payment_code === line.payment_code,
                        )?.requested_amount ?? 0,
                      ),
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="text-right"
                      disabled={!decidable || policy?.allow_allocation_override === false}
                      value={line.amount}
                      onChange={(e) => {
                        const next = [...lines];
                        next[idx] = { ...line, amount: Number(e.target.value) || 0 };
                        setLines(next);
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {decidable && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Approved amount (XCD)</Label>
              <Input type="number" min="0" step="0.01" value={approvedAmount} onChange={(e) => setApprovedAmount(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Authority validity</Label>
              <p className="text-sm text-muted-foreground pt-2">
                {policy?.authority_validity_days ?? 14} days from approval. The statutory payment
                deadline and any penalties are unaffected by this approval.
              </p>
            </div>
          </div>
        )}

        {escalated && decidable && (
          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertDescription>
              This amount is at or above the escalation threshold of{' '}
              {formatCurrency(Number(policy?.escalation_threshold_amount))} — it requires{' '}
              {policy?.escalated_approval_role} authority.
            </AlertDescription>
          </Alert>
        )}

        {!validation.ok && decidable && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{validation.errors.join('; ')}</AlertDescription>
          </Alert>
        )}

        {decidable && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Decision comments</Label>
              <Textarea rows={2} value={comments} onChange={(e) => setComments(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Rejection reason (required to reject)</Label>
              <Textarea rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            </div>
          </div>
        )}

        <div>
          <Label className="text-xs">History</Label>
          <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
            {(eventsQ.data ?? []).map((ev) => (
              <div key={ev.id} className="flex items-center gap-2 text-xs">
                <Badge variant="outline">{ev.action}</Badge>
                <span className="text-muted-foreground">
                  {format(new Date(ev.acted_at), 'dd MMM yyyy HH:mm')} · {ev.acted_by ?? '—'}
                  {ev.amount != null ? ` · ${formatCurrency(Number(ev.amount))}` : ''}
                  {ev.reason ? ` · ${ev.reason}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {decidable && (
            <>
              <Button
                variant="destructive"
                disabled={!rejectReason.trim() || reject.isPending}
                onClick={() => reject.mutate()}
              >
                Reject
              </Button>
              <Button disabled={!validation.ok || numericApproved <= 0 || approve.isPending} onClick={() => approve.mutate()}>
                Approve & issue payment authority
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
