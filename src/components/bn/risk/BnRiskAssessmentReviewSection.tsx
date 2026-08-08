/**
 * BN Risk — assessment review section (EPIC 2, final step).
 *
 * Drives entirely from `bn_risk_review_readiness_v1`. The officer confirms
 * the review of the score and rationale; the backend then moves the
 * assessment to RECOMMENDATION. No recommendation, control or referral is
 * created here.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { riskScoringService } from '@/services/bn/risk/riskScoringService';
import type { BnRiskScoringCommand } from '@/types/bn/risk/riskScoring';

interface Props {
  assessmentId: string;
  isActionEnabled: (action: BnRiskScoringCommand) => boolean;
  onChanged: () => void;
}

export const BnRiskAssessmentReviewSection: React.FC<Props> = ({
  assessmentId, isActionEnabled, onChanged,
}) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const readiness = useQuery({
    queryKey: ['bn-risk-review-readiness', assessmentId],
    queryFn: async () => {
      const result = await riskScoringService.reviewReadiness(assessmentId);
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data;
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      const result = await riskScoringService.execute({
        command: 'COMPLETE_SCORING_REVIEW',
        assessmentId,
        expectedRowVersion: readiness.data?.assessment_row_version ?? null,
        justification: note.trim() || null,
        payload: {},
      });
      if (result.status === 'FAILED') {
        throw new Error(result.errorMessage ?? 'The scoring review could not be completed.');
      }
      return result;
    },
    onSuccess: () => {
      setOpen(false);
      setNote('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['bn-risk-review-readiness', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['bn-risk-scoring-readiness', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['bn-risk-score-detail', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['bn-risk-assessment-queue'] });
      onChanged();
    },
    onError: (e: Error) => setError(e.message),
  });

  if (readiness.isLoading) return <Skeleton className="h-48 w-full" />;

  if (readiness.isError || !readiness.data) {
    return (
      <Card>
        <CardHeader><CardTitle>Assessment review</CardTitle></CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTitle>Review readiness is unavailable</AlertTitle>
            <AlertDescription>
              Review completion is not offered until this can be checked again.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const data = readiness.data;
  const s = data.summary;
  const canComplete = data.can_complete_review && isActionEnabled('COMPLETE_SCORING_REVIEW');

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" /> Assessment review
          </CardTitle>
          <CardDescription>
            The officer's confirmation that the score and its rationale have been reviewed.
          </CardDescription>
        </div>
        {!data.review_completed && (
          <Button size="sm" disabled={!canComplete} onClick={() => { setError(null); setOpen(true); }}>
            Complete scoring review
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

        {data.review_completed && (
          <Alert>
            <AlertTitle>Scoring and review complete</AlertTitle>
            <AlertDescription>
              Ready for recommendation. Nothing has been recommended or applied.
            </AlertDescription>
          </Alert>
        )}

        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Linked signals</dt>
            <dd>{s.linked_signal_count}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Active factors</dt>
            <dd>{s.active_factor_count}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Usable evidence</dt>
            <dd>{s.usable_evidence_count}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Increasing concern</dt>
            <dd>{s.increasing_factor_count}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Mitigating</dt>
            <dd>{s.reducing_factor_count}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Open information requests</dt>
            <dd>{s.open_request_count}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Current score</span>
          <Badge variant="secondary">{s.score ?? 'Not scored'}</Badge>
          <span className="text-muted-foreground">Risk band</span>
          <Badge variant="outline">{s.band_label ?? '—'}</Badge>
          {s.is_stale && <Badge variant="destructive">Out of date</Badge>}
        </div>

        {data.blockers.length > 0 && (
          <Alert variant="destructive">
            <AlertTitle>Review cannot be completed yet</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {data.blockers.map((b) => <li key={b}>{b}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {data.warnings.length > 0 && (
          <Alert>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {data.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <Alert>
          <AlertTitle>Recommendation</AlertTitle>
          <AlertDescription>
            Next stage. Control recommendation and independent approval are delivered in a
            later release; nothing is recommended automatically from a score or band.
          </AlertDescription>
        </Alert>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Complete scoring review</DialogTitle>
            <DialogDescription>
              This records that the score and its rationale have been reviewed and moves the
              assessment to the recommendation stage. No control is proposed or applied.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Review note (optional)</Label>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={completeMutation.isPending} onClick={() => completeMutation.mutate()}>
              {completeMutation.isPending ? 'Completing…' : 'Complete review'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
