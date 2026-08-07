/**
 * BN Risk — create a risk assessment from a confirmed signal
 * (BN_RISK_CREATE_ASSESSMENT).
 *
 * Eligibility is never inferred in the browser: the governed
 * `bn_risk_assessment_creation_readiness_v1` query decides whether the
 * signal may open an assessment and supplies the business wording for any
 * blocker.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { riskAssessmentService } from '@/services/bn/risk/riskAssessmentService';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signalId: string;
  signalReference: string;
  defaultSummary?: string;
  onCreated: (assessmentId: string, reference?: string) => void;
}

export const BnRiskCreateAssessmentDialog: React.FC<Props> = ({
  open, onOpenChange, signalId, signalReference, defaultSummary, onCreated,
}) => {
  const queryClient = useQueryClient();
  const [summary, setSummary] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) { setSummary(defaultSummary ?? ''); setError(null); }
  }, [open, defaultSummary]);

  const readiness = useQuery({
    queryKey: ['bn-risk-assessment-creation-readiness', signalId],
    queryFn: async () => {
      const result = await riskAssessmentService.creationReadiness(signalId);
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data;
    },
    enabled: open && !!signalId,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const result = await riskAssessmentService.execute({
        command: 'BN_RISK_CREATE_ASSESSMENT',
        payload: {
          primary_signal_id: signalId,
          summary: summary.trim() || null,
        },
      });
      if (result.status === 'FAILED') {
        throw new Error(result.errorMessage ?? 'The assessment could not be created.');
      }
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['bn-risk-assessment-queue'] });
      queryClient.invalidateQueries({ queryKey: ['bn-risk-signal-detail', signalId] });
      queryClient.invalidateQueries({ queryKey: ['bn-risk-signal-assessment-links', signalId] });
      onOpenChange(false);
      if (result.assessmentId) onCreated(result.assessmentId, result.assessmentReference);
    },
    onError: (e: Error) => setError(e.message),
  });

  const r = readiness.data;
  const canSubmit = !!r?.can_create && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Start a risk assessment</DialogTitle>
          <DialogDescription>
            Opens a governed review for signal {signalReference}. Opening an assessment
            does not change any benefit or payment.
          </DialogDescription>
        </DialogHeader>

        {readiness.isLoading && <Skeleton className="h-20 w-full" />}

        {readiness.isError && (
          <Alert variant="destructive">
            <AlertTitle>Eligibility could not be checked</AlertTitle>
            <AlertDescription>
              This is not a confirmation that an assessment can be opened. Please retry.
            </AlertDescription>
          </Alert>
        )}

        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

        {r && !r.can_create && (
          <Alert variant="destructive">
            <AlertTitle>An assessment cannot be started</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {r.blockers.map((b) => <li key={b}>{b}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {r && r.warnings.length > 0 && (
          <Alert>
            <AlertTitle>Before you continue</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {r.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {r?.existing_assessment_reference && (
          <p className="text-sm text-muted-foreground">
            Existing assessment: {r.existing_assessment_reference}
          </p>
        )}

        <div className="space-y-2">
          <Label>What is being reviewed</Label>
          <Textarea
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="A short business description of the review. The signal summary is used if left blank."
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Opening…' : 'Open assessment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
