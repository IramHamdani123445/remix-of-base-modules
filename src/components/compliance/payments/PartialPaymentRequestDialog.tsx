import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  getActivePartialPaymentPolicy,
  getOutstandingLiability,
  requestPartialPayment,
  type PartialPaymentSource,
} from '@/services/partialPaymentService';
import {
  buildDefaultAllocation,
  round2,
  validateAllocation,
  type CePartialPaymentAllocationLine,
} from '@/lib/compliance/partialPaymentAllocation';
import { formatCurrency } from '@/utils/formatCurrency';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultEmployerId?: string;
  defaultWagePeriod?: string;
}

export function PartialPaymentRequestDialog({ open, onOpenChange, defaultEmployerId, defaultWagePeriod }: Props) {
  const qc = useQueryClient();
  const [employerId, setEmployerId] = useState(defaultEmployerId ?? '');
  const [wagePeriod, setWagePeriod] = useState(defaultWagePeriod ?? '');
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState<PartialPaymentSource>('EMPLOYER');
  const [justification, setJustification] = useState('');
  const [lines, setLines] = useState<CePartialPaymentAllocationLine[]>([]);

  const policyQ = useQuery({ queryKey: ['ce-pp-policy'], queryFn: () => getActivePartialPaymentPolicy() });

  const liabilityQ = useQuery({
    queryKey: ['ce-pp-liability', employerId, wagePeriod],
    queryFn: () => getOutstandingLiability(employerId, `${wagePeriod}-01`),
    enabled: open && !!employerId && /^\d{4}-\d{2}$/.test(wagePeriod),
  });

  const liability = liabilityQ.data;
  const numericAmount = Number(amount) || 0;

  useEffect(() => {
    if (!liability || !policyQ.data || numericAmount <= 0) {
      setLines([]);
      return;
    }
    try {
      setLines(buildDefaultAllocation(liability, numericAmount, policyQ.data.allocation_order));
    } catch {
      setLines([]);
    }
  }, [liability, policyQ.data, numericAmount]);

  const validation = useMemo(
    () => validateAllocation(lines, numericAmount, liability),
    [lines, numericAmount, liability],
  );

  const create = useMutation({
    mutationFn: () =>
      requestPartialPayment({
        employerId,
        wagePeriod: `${wagePeriod}-01`,
        requestedAmount: numericAmount,
        justification,
        allocations: lines,
        source,
      }),
    onSuccess: () => {
      toast.success('Partial payment request submitted for approval');
      qc.invalidateQueries({ queryKey: ['ce-pp-requests'] });
      onOpenChange(false);
      setAmount('');
      setJustification('');
    },
    onError: (e: Error) => toast.error(e.message || 'Could not submit the request'),
  });

  const canSubmit =
    !!employerId && /^\d{4}-\d{2}$/.test(wagePeriod) && numericAmount > 0 &&
    justification.trim().length > 0 && validation.ok && !create.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Request a partial payment</DialogTitle>
          <DialogDescription>
            Record what the employer can pay now against one wage period. Nothing may be posted until
            compliance approves the request and a payment authority is issued.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label>Employer registration number</Label>
            <Input value={employerId} onChange={(e) => setEmployerId(e.target.value.trim())} placeholder="e.g. 100234" />
          </div>
          <div className="space-y-1">
            <Label>Wage period</Label>
            <Input type="month" value={wagePeriod} onChange={(e) => setWagePeriod(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Raised by</Label>
            <Select value={source} onValueChange={(v) => setSource(v as PartialPaymentSource)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="EMPLOYER">Employer request</SelectItem>
                <SelectItem value="CASHIER">Cashier-assisted (employer at the counter)</SelectItem>
                <SelectItem value="COMPLIANCE">Compliance officer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Amount offered (XCD)</Label>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            {liability && (
              <p className="text-xs text-muted-foreground">
                Outstanding liability: {formatCurrency(liability.total_outstanding)}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-1">
          <Label>Reason for paying only part of the liability</Label>
          <Textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={3} />
        </div>

        {lines.length > 0 && (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payment category</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="text-right">Proposed allocation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.payment_code}>
                    <TableCell>
                      <span className="font-medium">{line.payment_code}</span>
                      <span className="text-muted-foreground"> — {line.bucket_label}</span>
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(line.outstanding_amount)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(round2(line.amount))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {!validation.ok && numericAmount > 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{validation.errors.join('; ')}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canSubmit} onClick={() => create.mutate()}>Submit for approval</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
