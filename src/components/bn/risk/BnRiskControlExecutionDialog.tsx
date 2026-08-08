/**
 * BN Risk — approved control execution confirmation (EPIC 4).
 *
 * Read-only confirmation of what was already approved. The executor never
 * re-chooses the control and never edits an approved parameter: only the
 * backend-permitted operational note may be supplied.
 */
import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatAuditDate } from '@/lib/dateFormat';
import { riskControlExecutionService } from '@/services/bn/risk/riskControlExecutionService';
import type {
  BnRiskControlExecutionReadiness,
} from '@/types/bn/risk/riskControlExecution';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assessmentId: string;
  mode: 'EXECUTE' | 'RETRY';
  readiness: BnRiskControlExecutionReadiness;
  onCompleted: () => void;
}

export const BnRiskControlExecutionDialog: React.FC<Props> = ({
  open, onOpenChange, assessmentId, mode, readiness, onCompleted,
}) => {
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) { setNote(''); setError(null); }
  }, [open]);

  const approval = readiness.approval;
  const target = readiness.target;
  const allowsNote = readiness.permitted_runtime_fields.includes('operational_note');

  const mutation = useMutation({
    mutationFn: async () => {
      const result = mode === 'RETRY'
        ? await riskControlExecutionService.retryExecution({
          assessmentId,
          operationalNote: note.trim() || null,
          expectedRowVersion: readiness.assessment_row_version,
        })
        : await riskControlExecutionService.executeApprovedControl({
          assessmentId,
          command: readiness.command_name!,
          operationalNote: note.trim() || null,
          expectedRowVersion: readiness.assessment_row_version,
        });
      if (result.status === 'FAILED') {
        throw new Error(result.errorMessage ?? 'The control could not be executed.');
      }
      return result;
    },
    onSuccess: () => { onOpenChange(false); onCompleted(); },
    onError: (e: Error) => setError(e.message),
  });

  if (!approval || !target) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="bn-risk-execution-dialog">
        <DialogHeader>
          <DialogTitle>
            {mode === 'RETRY' ? 'Retry approved control' : 'Execute approved control'}
          </DialogTitle>
          <DialogDescription>
            {target.execution_owner ?? 'The owning domain'} performs this business action.
            Risk records the reference and status it returns.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground">Control</p>
            <p data-testid="bn-risk-execution-dialog-control">{approval.control_label}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Execution owner</p>
            <p data-testid="bn-risk-execution-dialog-owner">{target.execution_owner ?? '—'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Target</p>
            <p>{approval.target_reference ?? approval.target_type ?? 'Not applicable'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Approved reason</p>
            <p>{approval.approved_reason_label ?? '—'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Approved by</p>
            <p>
              {approval.approved_by_name ?? '—'}
              {approval.approved_at ? ` · ${formatAuditDate(approval.approved_at, false)}` : ''}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Effective period</p>
            <p>
              {approval.requested_effective_from ?? '—'}
              {approval.requested_effective_to ? ` → ${approval.requested_effective_to}` : ''}
            </p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-muted-foreground">Potential business effect</p>
            <p>
              {approval.is_benefit_affecting
                ? `This control affects a benefit. ${target.execution_owner ?? 'The owning domain'} decides whether and how it is applied.`
                : 'This control does not change a benefit directly.'}
            </p>
          </div>
        </div>

        <Alert>
          <AlertTitle>Approved parameters are carried across</AlertTitle>
          <AlertDescription>
            The control, target, scope and effective period cannot be changed here. A material
            change requires a new recommendation and independent approval.
          </AlertDescription>
        </Alert>

        {allowsNote && (
          <div className="space-y-2">
            <Label htmlFor="bn-risk-execution-note">Operational note (optional)</Label>
            <Textarea
              id="bn-risk-execution-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTitle>The control was not executed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={mutation.isPending}
            onClick={() => { setError(null); mutation.mutate(); }}
          >
            {mutation.isPending
              ? 'Submitting…'
              : mode === 'RETRY' ? 'Retry execution' : 'Submit to owning domain'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
