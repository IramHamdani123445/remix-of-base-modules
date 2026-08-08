/**
 * BN Risk — structured rule feedback section (EPIC 6).
 *
 * Answers one question: may this reviewer record structured feedback on what
 * informed this assessment, and what has already been recorded? Eligibility,
 * the feedback catalogue, the eligible rules, signals and factors, and the
 * feedback history all come from `bn_risk_rule_feedback_readiness_v1`.
 * Nothing is derived here.
 *
 * The section states plainly that feedback changes no scoring configuration.
 * A recorded entry is immutable; a correction appears as a superseding record
 * and the previous entry remains visible with its author.
 */
import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareText } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatAuditDate } from '@/lib/dateFormat';
import { riskFeedbackService } from '@/services/bn/risk/riskFeedbackService';
import {
  feedbackClassificationLabel,
  feedbackTargetLabel,
  type BnRiskFeedbackReadinessV1,
  type BnRiskFeedbackRecord,
} from '@/types/bn/risk/riskFeedback';
import { BnRiskRuleFeedbackDialog } from './BnRiskRuleFeedbackDialog';

interface Props {
  assessmentId: string;
  onChanged: () => void;
}

export const BnRiskRuleFeedbackSection: React.FC<Props> = ({ assessmentId, onChanged }) => {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = React.useState<'RECORD' | 'CORRECT' | null>(null);
  const [target, setTarget] = React.useState<BnRiskFeedbackRecord | null>(null);
  const [confirmation, setConfirmation] = React.useState<string | null>(null);

  const readiness = useQuery({
    queryKey: ['bn-risk-feedback-readiness', assessmentId],
    queryFn: async () => {
      const result = await riskFeedbackService.feedbackReadiness(assessmentId);
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data;
    },
  });

  const refresh = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['bn-risk-feedback-readiness', assessmentId] });
    queryClient.invalidateQueries({ queryKey: ['bn-risk-feedback-metrics'] });
    onChanged();
  }, [assessmentId, onChanged, queryClient]);

  if (readiness.isLoading) return <Skeleton className="h-40 w-full" />;

  /**
   * Fail closed. A readiness query that could not be answered is never shown
   * as "no blockers", and no feedback action is offered.
   */
  if (readiness.isError || !readiness.data) {
    return (
      <Card data-testid="bn-risk-feedback-section" data-state="FAILED_TO_LOAD">
        <CardHeader><CardTitle>Rule feedback</CardTitle></CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTitle>Feedback eligibility is unavailable</AlertTitle>
            <AlertDescription>
              No feedback can be recorded until this can be checked again. Nothing has changed,
              and this does not mean feedback is allowed.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const data: BnRiskFeedbackReadinessV1 = readiness.data;
  const current = data.existing_feedback.filter((f) => f.status === 'CURRENT');
  const superseded = data.existing_feedback.filter((f) => f.status !== 'CURRENT');

  return (
    <Card data-testid="bn-risk-feedback-section" data-state={data.state}>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareText className="h-4 w-4" /> Rule feedback
          </CardTitle>
          <CardDescription>
            What the reviewer observed about the rules, signals and factors that informed this
            assessment. Feedback is evidence for a later policy review; it changes no scoring
            rule, weight, threshold, band or configuration version, and rescores nothing.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.can_record_feedback && (
            <Button
              size="sm"
              data-testid="bn-risk-feedback-record"
              onClick={() => { setTarget(null); setDialog('RECORD'); }}
            >
              Record feedback
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {data.state === 'DENIED' && (
          <Alert data-testid="bn-risk-feedback-denied">
            <AlertTitle>Read only</AlertTitle>
            <AlertDescription>
              You can review this assessment but you cannot record Risk rule feedback.
            </AlertDescription>
          </Alert>
        )}

        {data.state === 'NOT_ELIGIBLE' && (
          <p className="text-sm text-muted-foreground" data-testid="bn-risk-feedback-not-eligible">
            Feedback can be recorded once the assessment has reached a governed outcome and has
            been completed or closed.
          </p>
        )}

        {data.blockers.length > 0 && data.state !== 'NOT_ELIGIBLE' && (
          <Alert data-testid="bn-risk-feedback-blockers">
            <AlertTitle>Outstanding before feedback can be recorded</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-5">
                {data.blockers.map((b) => <li key={b}>{b}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {data.warnings.length > 0 && (
          <Alert data-testid="bn-risk-feedback-warnings">
            <AlertTitle>Worth knowing</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-5">
                {data.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {confirmation && (
          <Alert data-testid="bn-risk-feedback-confirmation">
            <AlertTitle>Feedback recorded</AlertTitle>
            <AlertDescription>{confirmation}</AlertDescription>
          </Alert>
        )}

        {data.scoring_provenance && (
          <div className="rounded-md border p-3 text-sm" data-testid="bn-risk-feedback-scoring-context">
            <p className="font-medium">Scoring context</p>
            <p className="text-muted-foreground">
              Rule set {data.scoring_provenance.rule_set_code ?? 'unknown'} version
              {' '}{data.scoring_provenance.rule_set_version_no ?? '—'}, score version
              {' '}{data.scoring_provenance.score_version_no ?? '—'}
              {data.scoring_provenance.band_label
                ? `, band ${data.scoring_provenance.band_label}` : ''}
              . Feedback is always attached to this version.
            </p>
          </div>
        )}

        {current.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="bn-risk-feedback-empty">
            No feedback has been recorded for this assessment.
          </p>
        ) : (
          <Table data-testid="bn-risk-feedback-table">
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>About</TableHead>
                <TableHead>Feedback</TableHead>
                <TableHead>Classification</TableHead>
                <TableHead>Recorded</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {current.map((f) => (
                <TableRow key={f.feedback_id}>
                  <TableCell className="font-medium">{f.feedback_reference}</TableCell>
                  <TableCell>
                    <div>{feedbackTargetLabel(f.target_kind)}</div>
                    <div className="text-xs text-muted-foreground">
                      {f.rule_name ?? f.target_label ?? '—'}
                      {f.rule_set_version_no != null
                        ? ` (rule set v${f.rule_set_version_no})` : ''}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>{f.feedback_label}</div>
                    {f.reason_label && (
                      <div className="text-xs text-muted-foreground">{f.reason_label}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {feedbackClassificationLabel(f.classification)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {f.recorded_by_name ?? 'System'}<br />
                    {formatAuditDate(f.recorded_at, false)}
                  </TableCell>
                  <TableCell className="text-right">
                    {data.can_correct_feedback && (
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid={`bn-risk-feedback-correct-${f.feedback_id}`}
                        onClick={() => { setTarget(f); setDialog('CORRECT'); }}
                      >
                        Correct
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {superseded.length > 0 && (
          <div className="space-y-2" data-testid="bn-risk-feedback-superseded">
            <p className="text-sm font-medium">Superseded feedback</p>
            {superseded.map((f) => (
              <div key={f.feedback_id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{f.feedback_reference} — {f.feedback_label}</span>
                  <Badge variant="secondary">Superseded</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Recorded by {f.recorded_by_name ?? 'System'} on
                  {' '}{formatAuditDate(f.recorded_at, false)}
                  {f.correction_reason_label ? ` — ${f.correction_reason_label}` : ''}
                </p>
              </div>
            ))}
          </div>
        )}

        <Alert data-testid="bn-risk-feedback-governance">
          <AlertTitle>Feedback does not change scoring</AlertTitle>
          <AlertDescription>
            Recording feedback never alters a rule, weight, threshold, band or configuration,
            and never rescores a case. A scoring change is a separate, versioned and authorised
            act made on the scoring-configuration surface.
          </AlertDescription>
        </Alert>
      </CardContent>

      {dialog && (
        <BnRiskRuleFeedbackDialog
          open
          onOpenChange={(open) => { if (!open) { setDialog(null); setTarget(null); } }}
          assessmentId={assessmentId}
          mode={dialog}
          readiness={data}
          target={target}
          onCompleted={(message) => {
            setDialog(null);
            setTarget(null);
            setConfirmation(message ?? 'Feedback recorded for policy review.');
            refresh();
          }}
        />
      )}
    </Card>
  );
};
