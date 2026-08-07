/**
 * BN Risk — dismissal dialog (BN_RISK_DISMISS_SIGNAL).
 *
 * Dismissal is a decision: it requires the `decide` permission, a reason
 * from the governed list and a written justification. Dismissed signals are
 * never deleted — they stay fully auditable.
 */
import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { riskCommandService } from '@/services/bn/risk/riskCommandService';
import { referenceItems, useRiskReferenceData } from './useRiskReference';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signalId: string;
  signalReference: string;
  rowVersion: number;
  onCompleted: () => void;
}

export const BnRiskDismissDialog: React.FC<Props> = ({
  open, onOpenChange, signalId, signalReference, rowVersion, onCompleted,
}) => {
  const { data: reference } = useRiskReferenceData();
  const queryClient = useQueryClient();
  const [reasonCode, setReasonCode] = React.useState('');
  const [justification, setJustification] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) { setReasonCode(''); setJustification(''); setError(null); }
  }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      const result = await riskCommandService.execute({
        command: 'BN_RISK_DISMISS_SIGNAL',
        signalId,
        expectedRowVersion: rowVersion,
        reasonCode,
        justification: justification.trim(),
      });
      if (result.status === 'FAILED') throw new Error(result.errorMessage ?? 'Dismissal failed');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bn-risk-signal-queue'] });
      queryClient.invalidateQueries({ queryKey: ['bn-risk-signal-detail', signalId] });
      queryClient.invalidateQueries({ queryKey: ['bn-risk-signal-actions', signalId] });
      onOpenChange(false);
      onCompleted();
    },
    onError: (e: Error) => setError(e.message),
  });

  const canSubmit = !!reasonCode && justification.trim().length >= 10 && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Dismiss signal {signalReference}</DialogTitle>
          <DialogDescription>
            Dismissal closes the observation without further risk work. The signal and
            your reasoning stay on the record.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Reason</Label>
            <Select value={reasonCode} onValueChange={setReasonCode}>
              <SelectTrigger><SelectValue placeholder="Select a reason" /></SelectTrigger>
              <SelectContent>
                {referenceItems(reference, 'DISMISSAL_REASON').map((i) => (
                  <SelectItem key={i.code} value={i.code}>{i.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Justification</Label>
            <Textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={4}
              placeholder="Explain why no further risk work is required (at least 10 characters)."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Dismissing…' : 'Dismiss signal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
