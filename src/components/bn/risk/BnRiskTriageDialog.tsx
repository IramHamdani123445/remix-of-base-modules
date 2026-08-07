/**
 * BN Risk — triage dialog (BN_RISK_TRIAGE_SIGNAL).
 *
 * Triage records priority, classification and route. It never confirms or
 * dismisses a signal and never affects a benefit.
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

export const BnRiskTriageDialog: React.FC<Props> = ({
  open, onOpenChange, signalId, signalReference, rowVersion, onCompleted,
}) => {
  const { data: reference } = useRiskReferenceData();
  const queryClient = useQueryClient();
  const [priority, setPriority] = React.useState('');
  const [classification, setClassification] = React.useState('');
  const [route, setRoute] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setPriority(''); setClassification(''); setRoute(''); setNotes(''); setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      const result = await riskCommandService.execute({
        command: 'BN_RISK_TRIAGE_SIGNAL',
        signalId,
        expectedRowVersion: rowVersion,
        payload: {
          triage_priority_code: priority,
          triage_classification_code: classification,
          triage_route_code: route,
          notes: notes.trim() || null,
        },
      });
      if (result.status === 'FAILED') throw new Error(result.errorMessage ?? 'Triage failed');
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

  const canSubmit = !!priority && !!classification && !!route && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Triage signal {signalReference}</DialogTitle>
          <DialogDescription>
            Record how urgent this observation is, what it looks like, and what should
            happen next. Triage does not change any benefit.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger><SelectValue placeholder="Select priority" /></SelectTrigger>
              <SelectContent>
                {referenceItems(reference, 'TRIAGE_PRIORITY').map((i) => (
                  <SelectItem key={i.code} value={i.code}>{i.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Initial classification</Label>
            <Select value={classification} onValueChange={setClassification}>
              <SelectTrigger><SelectValue placeholder="Select classification" /></SelectTrigger>
              <SelectContent>
                {referenceItems(reference, 'TRIAGE_CLASSIFICATION').map((i) => (
                  <SelectItem key={i.code} value={i.code}>{i.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Next step</Label>
            <Select value={route} onValueChange={setRoute}>
              <SelectTrigger><SelectValue placeholder="Select next step" /></SelectTrigger>
              <SelectContent>
                {referenceItems(reference, 'TRIAGE_ROUTE').map((i) => (
                  <SelectItem key={i.code} value={i.code}>{i.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Triage notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Recording…' : 'Record triage'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
