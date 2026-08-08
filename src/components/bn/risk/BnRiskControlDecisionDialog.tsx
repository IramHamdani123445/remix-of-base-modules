/**
 * BN Risk — control decision dialog (EPIC 3).
 *
 * The independent approver records APPROVE, REJECT or RETURN_FOR_REVIEW using
 * only the decisions and reasons the backend published. Approval authorises
 * the control for later governed execution; it does not execute anything.
 */
import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { riskControlService } from '@/services/bn/risk/riskControlService';
import type {
  BnRiskControlApprovalReadiness,
  BnRiskControlDecision,
  BnRiskRecommendation,
} from '@/types/bn/risk/riskControl';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assessmentId: string;
  decision: BnRiskControlDecision | null;
  readiness: BnRiskControlApprovalReadiness;
  recommendation: BnRiskRecommendation | null;
  onCompleted: () => void;
}

const TITLES: Record<BnRiskControlDecision, string> = {
  APPROVE: 'Approve control',
  REJECT: 'Reject control',
  RETURN_FOR_REVIEW: 'Return for review',
};

export const BnRiskControlDecisionDialog: React.FC<Props> = ({
  open, onOpenChange, assessmentId, decision, readiness, recommendation, onCompleted,
}) => {
  const [reasonCode, setReasonCode] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const idempotencyKey = React.useRef<string>(crypto.randomUUID());

  React.useEffect(() => {
    if (open) {
      idempotencyKey.current = crypto.randomUUID();
      setReasonCode('');
      setNotes('');
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!decision) throw new Error('No decision selected.');
      const result = await riskControlService.decideControl({
        assessmentId,
        decision,
        reasonCode,
        notes: notes.trim() || null,
        expectedRowVersion: readiness.assessment_row_version,
        idempotencyKey: idempotencyKey.current,
      });
      if (result.status === 'FAILED') {
        throw new Error(result.errorMessage ?? 'The decision could not be recorded.');
      }
      return result;
    },
    onSuccess: () => { onOpenChange(false); onCompleted(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{decision ? TITLES[decision] : 'Control decision'}</DialogTitle>
          <DialogDescription>
            {decision === 'APPROVE'
              ? 'Approval authorises the control for later governed execution. This screen does not execute the benefit action.'
              : decision === 'REJECT'
                ? 'The control will not be authorised. The recommendation and this decision are retained.'
                : 'The recommendation is retained and the officer may submit a new one after review.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

          {recommendation && (
            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium">{recommendation.control_label}</p>
              <p className="text-muted-foreground">
                Recommended by {recommendation.recommended_by_name ?? '—'} ·{' '}
                {recommendation.reason_label ?? '—'}
              </p>
            </div>
          )}

          {decision === 'APPROVE' && recommendation?.is_benefit_affecting && (
            <Alert>
              <AlertTitle>Benefit-affecting control</AlertTitle>
              <AlertDescription>
                Approval authorises the control for later governed execution. No payment,
                award, claim or referral changes as a result of this decision.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label>Decision reason</Label>
            <Select value={reasonCode} onValueChange={setReasonCode}>
              <SelectTrigger aria-label="Decision reason">
                <SelectValue placeholder="Choose a reason" />
              </SelectTrigger>
              <SelectContent>
                {readiness.reason_options.map((r) => (
                  <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cd-notes">Decision notes</Label>
            <Textarea id="cd-notes" rows={3} value={notes}
              onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={reasonCode === '' || mutation.isPending || !decision}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Recording…' : 'Record decision'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
