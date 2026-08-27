import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, HandshakeIcon, AlertCircle } from 'lucide-react';
import { centralPaymentArrangementService } from '@/services/centralPaymentArrangementService';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchBlockingArrangement,
  isConcurrentArrangementError,
  translateArrangementCreationError,
  type BlockingArrangement,
} from '@/services/compliance/arrangementConcurrencyService';

interface CasePaymentArrangementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  caseNumber: string;
  employerId: string;
  employerName: string;
  totalAmount: number;
  amountCollected: number;
  assignedOfficerId?: string | null;
  assignedOfficerName?: string | null;
}

export function CasePaymentArrangementDialog({
  open,
  onOpenChange,
  caseId,
  caseNumber,
  employerId,
  employerName,
  totalAmount,
  amountCollected,
  assignedOfficerId,
  assignedOfficerName,
}: CasePaymentArrangementDialogProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const outstandingAmount = totalAmount - amountCollected;

  const [form, setForm] = useState({
    arrangedAmount: outstandingAmount.toFixed(2),
    downPayment: '0',
    numberOfInstallments: '12',
    frequency: 'MONTHLY',
    startDate: new Date().toISOString().split('T')[0],
    terms: '',
    notes: '',
  });
  const [creating, setCreating] = useState(false);
  const [serverBlocking, setServerBlocking] = useState<BlockingArrangement | null>(null);

  // Concurrent-arrangement protection: pre-flight lookup (the database trigger is authoritative).
  const { data: preflightBlocking } = useQuery({
    queryKey: ['ce_arrangement_blocking', employerId],
    queryFn: () => fetchBlockingArrangement(employerId),
    enabled: open && !!employerId,
  });
  const blocking = serverBlocking ?? preflightBlocking ?? null;

  const goToBlockingArrangement = () => {
    onOpenChange(false);
    navigate(`/compliance/enforcement/arrangements?arr=${encodeURIComponent(blocking?.id ?? '')}`);
  };

  const arrangedNum = Number(form.arrangedAmount) || 0;
  const downPaymentNum = Number(form.downPayment) || 0;
  const numInstallments = Number(form.numberOfInstallments) || 1;
  const financeableAmount = arrangedNum - downPaymentNum;
  const installmentAmount = numInstallments > 0 ? financeableAmount / numInstallments : 0;
  const remainingCaseBalance = outstandingAmount - arrangedNum;

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'XCD', minimumFractionDigits: 2 }).format(amount);

  const officerAssigned = !!assignedOfficerId;

  const handleCreate = async () => {
    if (!officerAssigned) {
      toast.error('Assign an officer to this case before creating an arrangement', {
        description: 'Payment arrangements must be negotiated by the assigned compliance officer.',
      });
      return;
    }
    if (arrangedNum <= 0) {
      toast.error('Arranged amount must be greater than zero');
      return;
    }
    if (arrangedNum > outstandingAmount) {
      toast.error('Arranged amount cannot exceed case outstanding balance');
      return;
    }
    if (numInstallments < 1 || numInstallments > 120) {
      toast.error('Number of installments must be between 1 and 120');
      return;
    }
    if (!form.startDate) {
      toast.error('Start date is required');
      return;
    }
    if (downPaymentNum < 0 || downPaymentNum >= arrangedNum) {
      toast.error('Down payment must be between 0 and the arranged amount');
      return;
    }

    if (blocking) {
      toast.error('An open payment arrangement already exists', {
        description: `${blocking.arrangement_number} (${blocking.status}) must be completed, cancelled or superseded first.`,
      });
      return;
    }

    setCreating(true);
    try {
      await centralPaymentArrangementService.createArrangementFromCase({
        caseId,
        caseNumber,
        employerId,
        employerName,
        totalDebtFromCase: arrangedNum,
        downPayment: downPaymentNum,
        numberOfInstallments: numInstallments,
        frequency: form.frequency,
        startDate: form.startDate,
        terms: form.terms || undefined,
        notes: form.notes || undefined,
      });

      toast.success('Payment arrangement created and linked to case');
      queryClient.invalidateQueries({ queryKey: ['ce_case_detail', caseId] });
      queryClient.invalidateQueries({ queryKey: ['ce_case_history', caseId] });
      queryClient.invalidateQueries({ queryKey: ['ce_payment_arrangements'] });
      onOpenChange(false);
    } catch (rawErr: any) {
      const err = await translateArrangementCreationError(rawErr, employerId);
      if (isConcurrentArrangementError(err)) {
        setServerBlocking((err as any).blocking ?? null);
        toast.error('An open payment arrangement already exists', { description: err.message });
      } else {
        toast.error('Failed to create arrangement', { description: err.message });
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HandshakeIcon className="h-5 w-5" />
            Create Payment Arrangement
          </DialogTitle>
          <DialogDescription>
            Create a payment arrangement linked to case {caseNumber}
          </DialogDescription>
        </DialogHeader>

        {blocking && (
          <div className="flex gap-2 items-start rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
            <div className="space-y-1">
              <p className="font-medium text-destructive">An open payment arrangement already exists</p>
              <p className="text-muted-foreground">
                {employerName || employerId} already has arrangement{' '}
                <span className="font-medium">{blocking.arrangement_number}</span> in status{' '}
                <span className="font-medium">{blocking.status}</span>. Only one non-completed arrangement is
                allowed per employer — complete, cancel or supersede it before creating another.
              </p>
              <Button variant="link" className="h-auto p-0 text-sm" onClick={goToBlockingArrangement}>
                Open existing arrangement
              </Button>
            </div>
          </div>
        )}
        {!officerAssigned && (
          <div className="flex gap-2 items-start rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
            <div>
              <p className="font-medium text-destructive">Officer not assigned</p>
              <p className="text-muted-foreground">
                Assign a compliance officer to this case before creating a payment arrangement.
                Arrangements must be negotiated by the assigned officer.
              </p>
            </div>
          </div>
        )}
        {officerAssigned && assignedOfficerName && (
          <p className="text-xs text-muted-foreground">
            Negotiating officer: <span className="font-medium">{assignedOfficerName}</span>
          </p>
        )}

        {/* Case context - read-only */}
        <Card className="bg-muted/50">
          <CardContent className="pt-4 space-y-2">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Case:</span>{' '}
                <span className="font-medium">{caseNumber}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Employer:</span>{' '}
                <span className="font-medium">{employerName}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Total Case Amount:</span>{' '}
                <span className="font-semibold">{formatCurrency(totalAmount)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Amount Collected:</span>{' '}
                <span className="font-medium text-success">{formatCurrency(amountCollected)}</span>
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-sm font-medium">Outstanding Balance:</span>
              <Badge variant="destructive" className="text-base px-3 py-1">
                {formatCurrency(outstandingAmount)}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {outstandingAmount <= 0 ? (
          <div className="flex items-center gap-2 p-4 bg-warning/10 rounded-lg text-warning">
            <AlertCircle className="h-5 w-5" />
            <span className="text-sm">This case has no outstanding balance to arrange.</span>
          </div>
        ) : (
          <>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Arranged Amount (EC$) *</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max={outstandingAmount}
                    value={form.arrangedAmount}
                    onChange={(e) => setForm(prev => ({ ...prev, arrangedAmount: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Max: {formatCurrency(outstandingAmount)}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Down Payment (EC$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.downPayment}
                    onChange={(e) => setForm(prev => ({ ...prev, downPayment: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Number of Installments *</Label>
                  <Input
                    type="number"
                    min="1"
                    max="120"
                    value={form.numberOfInstallments}
                    onChange={(e) => setForm(prev => ({ ...prev, numberOfInstallments: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Payment Frequency *</Label>
                  <Select value={form.frequency} onValueChange={(v) => setForm(prev => ({ ...prev, frequency: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="WEEKLY">Weekly</SelectItem>
                      <SelectItem value="BIWEEKLY">Bi-Weekly</SelectItem>
                      <SelectItem value="MONTHLY">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Start Date *</Label>
                  <Input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm(prev => ({ ...prev, startDate: e.target.value }))}
                  />
                </div>
              </div>

              {/* Financial summary */}
              <Card className="bg-primary/5 border-primary/20">
                <CardContent className="pt-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Arranged Amount:</span>
                      <span className="font-semibold">{formatCurrency(arrangedNum)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Down Payment:</span>
                      <span className="font-semibold">{formatCurrency(downPaymentNum)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Financeable Amount:</span>
                      <span className="font-semibold">{formatCurrency(financeableAmount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Installment Amount:</span>
                      <span className="font-bold text-primary">{formatCurrency(installmentAmount)}</span>
                    </div>
                    <div className="flex justify-between col-span-2 pt-2 border-t">
                      <span className="text-muted-foreground">Remaining Case Balance (unarranged):</span>
                      <span className="font-semibold">{formatCurrency(Math.max(0, remainingCaseBalance))}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-2">
                <Label>Terms & Conditions</Label>
                <Textarea
                  value={form.terms}
                  onChange={(e) => setForm(prev => ({ ...prev, terms: e.target.value }))}
                  placeholder="Enter payment arrangement terms..."
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Internal Notes</Label>
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Internal notes (not visible to employer)..."
                  rows={2}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={creating || !officerAssigned || !!blocking}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <HandshakeIcon className="h-4 w-4 mr-2" />}
                Create Arrangement
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
