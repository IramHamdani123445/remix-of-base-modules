/**
 * BN Risk — void a factor (BN_RISK_OP_VOID_FACTOR).
 *
 * Voiding requires the `decide` permission, a governed reason and a
 * justification. The factor is never deleted: it is retained as VOID with
 * the full audit trail.
 */
import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { riskAssessmentService } from '@/services/bn/risk/riskAssessmentService';
import type { BnRiskFactorRow } from '@/types/bn/risk/riskAssessment';
import { referenceItems, useRiskReferenceData } from './useRiskReference';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assessmentId: string;
  rowVersion: number;
  factor: BnRiskFactorRow | null;
  onCompleted: () => void;
}

export const BnRiskVoidFactorDialog: React.FC<Props> = ({
  open, onOpenChange, assessmentId, rowVersion, factor, onCompleted,
}) => {
  const queryClient = useQueryClient();
  const { data: reference } = useRiskReferenceData();
  const [reasonCode, setReasonCode] = React.useState('');
  const [justification, setJustification] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) { setReasonCode(''); setJustification(''); setError(null); }
  }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      const result = await riskAssessmentService.execute({
        command: 'BN_RISK_OP_VOID_FACTOR',
        assessmentId,
        expectedRowVersion: rowVersion,
        reasonCode,
        justification: justification.trim(),
        payload: { factor_id: factor?.factor_id },
      });
      if (result.status === 'FAILED') {
        throw new Error(result.errorMessage ?? 'The factor could not be voided.');
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bn-risk-assessment-detail', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['bn-risk-assessment-actions', assessmentId] });
      onOpenChange(false);
      onCompleted();
    },
    onError: (e: Error) => setError(e.message),
  });

  const canSubmit = !!reasonCode && justification.trim() !== '' && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Void factor {factor?.factor_reference}</DialogTitle>
          <DialogDescription>
            The factor stays on the record as voided so the review history remains complete.
          </DialogDescription>
        </DialogHeader>

        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Reason</Label>
            <Select value={reasonCode} onValueChange={setReasonCode}>
              <SelectTrigger><SelectValue placeholder="Select a reason" /></SelectTrigger>
              <SelectContent>
                {referenceItems(reference, 'FACTOR_VOID_REASON').map((i) => (
                  <SelectItem key={i.code} value={i.code}>{i.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Justification</Label>
            <Textarea
              rows={3}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Voiding…' : 'Void factor'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
