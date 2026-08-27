import React, { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { Loader2 } from 'lucide-react';
import type { ExecuteBatchActionParams, BatchPaymentMethod } from '@/services/bn/batchOperationsService';
import { useActorUserCode } from '@/hooks/bn/useActorUserCode';

interface Props {
  open: boolean;
  onClose: () => void;
  onAction: (params: ExecuteBatchActionParams) => Promise<void>;
  isActing: boolean;
}

export const BatchCreateDialog: React.FC<Props> = ({ open, onClose, onAction, isActing }) => {
  // Writes must name a person, never the 'CURRENT_USER' placeholder.
  const { actor } = useActorUserCode();

  const [batchDate, setBatchDate] = useState<Date | undefined>(new Date());
  const [officeCode, setOfficeCode] = useState('HQ');
  const [paymentMethod, setPaymentMethod] = useState<BatchPaymentMethod>('MIXED');
  const [notes, setNotes] = useState('');

  const handleCreate = async () => {
    if (!batchDate) return;
    await onAction({
      action: 'CREATE',
      userCode: actor(),
      batchDate: batchDate.toISOString().slice(0, 10),
      officeCode,
      paymentMethod,
      notes: notes.trim() || undefined,
    });
    onClose();
    setNotes('');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Payment Batch</DialogTitle>
          <DialogDescription>
            Create a new batch to group payable instructions for controlled issuance.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Batch Date</Label>
            <DatePicker date={batchDate} onDateChange={setBatchDate} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Office Code</Label>
            <Input
              value={officeCode}
              onChange={(e) => setOfficeCode(e.target.value.toUpperCase())}
              maxLength={3}
              placeholder="e.g. HQ"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Payment Method</Label>
            <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as BatchPaymentMethod)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CHEQUE">Cheque</SelectItem>
                <SelectItem value="DIRECT_DEPOSIT">Direct Deposit</SelectItem>
                <SelectItem value="MIXED">Mixed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Batch description or notes..."
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isActing}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!batchDate || !officeCode || isActing}>
            {isActing && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Create Batch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
