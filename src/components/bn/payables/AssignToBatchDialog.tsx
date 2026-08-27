/**
 * Assign Payables to Batch Dialog
 * Allows selecting an open batch or creating a new one to assign selected payables.
 */
import React, { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Loader2, Package, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useExecuteBatchAction } from '@/hooks/bn/useBnBatchOperations';
import type { BatchPaymentMethod } from '@/services/bn/batchOperationsService';
import { useActorUserCode } from '@/hooks/bn/useActorUserCode';

const db = supabase as any;

interface Props {
  open: boolean;
  onClose: () => void;
  payableIds: string[];
  onAssigned: () => void;
}

export const AssignToBatchDialog: React.FC<Props> = ({ open, onClose, payableIds, onAssigned }) => {
  // Writes must name a person, never the 'CURRENT_USER' placeholder.
  const { actor } = useActorUserCode();

  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [newBatchMethod, setNewBatchMethod] = useState<BatchPaymentMethod>('MIXED');
  const [newBatchOffice, setNewBatchOffice] = useState('HQ');
  const executeMutation = useExecuteBatchAction();

  // Fetch open batches
  const { data: openBatches = [] } = useQuery({
    queryKey: ['bn', 'open-batches'],
    queryFn: async () => {
      const { data } = await db
        .from('bn_payment_batch')
        .select('id, batch_number, batch_date, status, payment_method, office_code, total_items, total_amount')
        .in('status', ['OPEN', 'REOPENED'])
        .order('created_at', { ascending: false });
      return data ?? [];
    },
    enabled: open,
  });

  const handleAssign = async () => {
    try {
      if (mode === 'new') {
        // Create batch first, then add payables
        const result = await executeMutation.mutateAsync({
          action: 'CREATE',
          userCode: actor(),
          batchDate: new Date().toISOString().slice(0, 10),
          paymentMethod: newBatchMethod,
          officeCode: newBatchOffice,
          notes: `Auto-created for ${payableIds.length} payable(s)`,
        });
        // Now add payables to the new batch
        await executeMutation.mutateAsync({
          batchId: result.id,
          action: 'ADD_PAYABLES',
          userCode: actor(),
          payableIds,
        });
      } else {
        if (!selectedBatchId) {
          toast.error('Please select a batch');
          return;
        }
        await executeMutation.mutateAsync({
          batchId: selectedBatchId,
          action: 'ADD_PAYABLES',
          userCode: actor(),
          payableIds,
        });
      }

      toast.success(`${payableIds.length} payable(s) assigned to batch`);
      onAssigned();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to assign to batch');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign to Payment Batch</DialogTitle>
          <DialogDescription>
            Assign {payableIds.length} ready payable(s) to a payment batch for controlled issuance.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'existing' | 'new')} className="space-y-3">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="existing" id="existing" />
              <Label htmlFor="existing" className="text-sm font-medium">Add to Existing Batch</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="new" id="new" />
              <Label htmlFor="new" className="text-sm font-medium">Create New Batch</Label>
            </div>
          </RadioGroup>

          <Separator />

          {mode === 'existing' && (
            <div className="space-y-3">
              {openBatches.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No open batches available. Switch to "Create New Batch".
                </p>
              ) : (
                <div className="space-y-2 max-h-[250px] overflow-y-auto">
                  {openBatches.map((b: any) => (
                    <div
                      key={b.id}
                      className={`rounded-lg border p-3 cursor-pointer transition-colors ${
                        selectedBatchId === b.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                      }`}
                      onClick={() => setSelectedBatchId(b.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Package className="h-4 w-4 text-muted-foreground" />
                          <span className="font-mono text-sm font-medium">{b.batch_number}</span>
                        </div>
                        <Badge variant="outline" className="text-xs">{b.status}</Badge>
                      </div>
                      <div className="mt-1 flex gap-4 text-xs text-muted-foreground">
                        <span>{b.payment_method}</span>
                        <span>{b.total_items} items</span>
                        <span>XCD {b.total_amount?.toFixed(2)}</span>
                        <span>{b.office_code}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {mode === 'new' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Payment Method</Label>
                <Select value={newBatchMethod} onValueChange={(v) => setNewBatchMethod(v as BatchPaymentMethod)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CHEQUE">Cheque</SelectItem>
                    <SelectItem value="DIRECT_DEPOSIT">Direct Deposit</SelectItem>
                    <SelectItem value="MIXED">Mixed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Office Code</Label>
                <Input
                  value={newBatchOffice}
                  onChange={(e) => setNewBatchOffice(e.target.value.toUpperCase())}
                  maxLength={3}
                  placeholder="HQ"
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={executeMutation.isPending}>Cancel</Button>
          <Button
            onClick={handleAssign}
            disabled={executeMutation.isPending || (mode === 'existing' && !selectedBatchId)}
          >
            {executeMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            <Plus className="h-4 w-4 mr-1" />
            Assign to Batch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
