/**
 * BN Risk — assessment workspace (EPIC 1 + EPIC 2 + EPIC 3).
 *
 * The single operational surface for a risk assessment: context, linked
 * signals, factors, evidence, information requests, governed scoring, the
 * officer review of that score, the control recommendation and the
 * independent approval decision. The workspace stops at "approved — awaiting
 * governed execution": no control is executed here.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatAuditDate } from '@/lib/dateFormat';
import { riskAssessmentService } from '@/services/bn/risk/riskAssessmentService';
import type { BnRiskAssessmentActionCode } from '@/types/bn/risk/riskAssessment';
import type { BnRiskScoringCommand } from '@/types/bn/risk/riskScoring';
import { BnRiskEvidenceSection } from './BnRiskEvidenceSection';
import { BnRiskFactorsSection } from './BnRiskFactorsSection';
import { BnRiskInformationSection } from './BnRiskInformationSection';
import { BnRiskScoringSection } from './BnRiskScoringSection';
import { BnRiskAssessmentReviewSection } from './BnRiskAssessmentReviewSection';
import { BnRiskRecommendationSection } from './BnRiskRecommendationSection';
import { BnRiskControlApprovalSection } from './BnRiskControlApprovalSection';
import { BnRiskControlExecutionSection } from './BnRiskControlExecutionSection';


/** Journey stages, driven by the backend assessment status. */
const JOURNEY = ['Signals', 'Factors', 'Evidence', 'Scoring', 'Recommendation',
  'Approval', 'Control execution', 'Outcome'] as const;

type JourneyState = 'COMPLETE' | 'CURRENT' | 'NEXT' | 'NOT_STARTED';

function journeyStates(status: string): Record<string, JourneyState> {
  const infoStage = ['DRAFT', 'OPEN', 'INFORMATION_PENDING'].includes(status);
  const scoring = status === 'REVIEW';
  const recommending = status === 'RECOMMENDATION';
  const approving = status === 'APPROVAL_PENDING';
  const decided = ['REFERRED', 'CONTROL_ACTION', 'COMPLETED', 'CLOSED'].includes(status);
  return {
    Signals: 'COMPLETE',
    Factors: infoStage ? 'CURRENT' : 'COMPLETE',
    Evidence: infoStage ? 'CURRENT' : 'COMPLETE',
    Scoring: scoring ? 'CURRENT' : infoStage ? 'NEXT' : 'COMPLETE',
    Recommendation: recommending ? 'CURRENT'
      : approving || decided ? 'COMPLETE' : scoring ? 'NEXT' : 'NOT_STARTED',
    Approval: approving ? 'CURRENT' : decided ? 'COMPLETE'
      : recommending ? 'NEXT' : 'NOT_STARTED',
    'Control execution': status === 'CONTROL_ACTION' || status === 'REFERRED' ? 'CURRENT'
      : decided ? 'COMPLETE' : approving ? 'NEXT' : 'NOT_STARTED',
    Outcome: ['COMPLETED', 'CLOSED'].includes(status) ? 'CURRENT' : 'NOT_STARTED',

  };
}

interface Props {
  assessmentId: string;
  onBack: () => void;
  /** Deep link from an operational queue — scroll straight to that section. */
  focusSection?: 'approval' | 'execution' | null;
}

export const BnRiskAssessmentWorkspace: React.FC<Props> = ({
  assessmentId, onBack, focusSection = null,
}) => {
  const queryClient = useQueryClient();
  const [completeOpen, setCompleteOpen] = React.useState(false);
  const [completeNote, setCompleteNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const approvalRef = React.useRef<HTMLDivElement | null>(null);
  const executionRef = React.useRef<HTMLDivElement | null>(null);


  const detail = useQuery({
    queryKey: ['bn-risk-assessment-detail', assessmentId],
    queryFn: async () => {
      const result = await riskAssessmentService.detail(assessmentId);
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data;
    },
  });

  const actions = useQuery({
    queryKey: ['bn-risk-assessment-actions', assessmentId],
    queryFn: async () => {
      const result = await riskAssessmentService.actions(assessmentId);
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data;
    },
  });

  const isActionEnabled = React.useCallback(
    (action: BnRiskAssessmentActionCode) =>
      actions.data?.actions.find((a) => a.action === action)?.enabled === true,
    [actions.data],
  );

  /**
   * Scoring commands are governed by the scoring/review readiness contracts.
   * Where the action catalogue also publishes the command we honour it; if the
   * catalogue could not be read at all we fail closed.
   */
  const isScoringActionEnabled = React.useCallback(
    (command: BnRiskScoringCommand) => {
      if (actions.isError || !actions.data) return false;
      const published = actions.data.actions.find(
        (a) => (a.action as string) === (command as string),
      );
      return published ? published.enabled === true : true;

    },
    [actions.data, actions.isError],
  );


  const refresh = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['bn-risk-assessment-detail', assessmentId] });
    queryClient.invalidateQueries({ queryKey: ['bn-risk-assessment-actions', assessmentId] });
  }, [assessmentId, queryClient]);

  /** Operational queue deep links — put the required work in front of the user. */
  React.useEffect(() => {
    if (focusSection === 'approval' && approvalRef.current) {
      approvalRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (focusSection === 'execution' && executionRef.current) {
      executionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [focusSection, detail.data]);


  const completeMutation = useMutation({
    mutationFn: async () => {
      const result = await riskAssessmentService.execute({
        command: 'BN_RISK_OP_COMPLETE_INFORMATION_GATHERING',
        assessmentId,
        expectedRowVersion: detail.data?.technical.row_version ?? null,
        justification: completeNote.trim() || null,
        payload: {},
      });
      if (result.status === 'FAILED') {
        throw new Error(result.errorMessage ?? 'Information gathering could not be completed.');
      }
      return result;
    },
    onSuccess: () => {
      setCompleteOpen(false);
      setCompleteNote('');
      queryClient.invalidateQueries({ queryKey: ['bn-risk-assessment-queue'] });
      refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  if (detail.isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (detail.isError || !detail.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>The assessment could not be opened</AlertTitle>
        <AlertDescription>
          Nothing has been changed. Please retry, or return to the assessment list.
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={onBack}>Back to assessments</Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  const { header, context, signals, factors, evidence, requests, history, readiness, technical } =
    detail.data;

  /**
   * Known records this assessment is already attached to. Officers pick a
   * record, never a raw UUID, and the backend still validates control/target
   * compatibility at command time.
   */
  const targetOptions = [
    technical.claim_id
      ? { type: 'CLAIM', id: technical.claim_id, reference: header.claim_reference,
        label: `Claim ${header.claim_reference ?? technical.claim_id}` }
      : null,
    technical.award_id
      ? { type: 'AWARD', id: technical.award_id, reference: header.award_reference,
        label: `Award ${header.award_reference ?? technical.award_id}` }
      : null,
    technical.payment_id
      ? { type: 'PAYMENT', id: technical.payment_id, reference: null, label: 'Scheduled payment' }
      : null,
    header.person_id !== null
      ? { type: 'PERSON', id: String(header.person_id), reference: header.person_masked_identifier,
        label: `Person ${header.person_name ?? header.person_masked_identifier ?? ''}`.trim() }
      : null,
    { type: 'ASSESSMENT', id: assessmentId, reference: header.assessment_reference,
      label: `Assessment ${header.assessment_reference}` },
  ].filter((t): t is NonNullable<typeof t> => t !== null);


  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Button size="sm" variant="ghost" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Assessments
          </Button>
          <div>
            <h2 className="text-xl font-semibold">{header.assessment_reference}</h2>
            <p className="text-sm text-muted-foreground">
              {header.person_name ?? 'Person not identified'}
              {header.person_masked_identifier ? ` · ${header.person_masked_identifier}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{header.status_label}</Badge>
          <Button
            size="sm"
            disabled={!isActionEnabled('COMPLETE_INFORMATION_GATHERING')}
            onClick={() => { setError(null); setCompleteOpen(true); }}
          >
            Complete information gathering
          </Button>
        </div>
      </div>

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      {actions.isError && (
        <Alert variant="destructive">
          <AlertTitle>Available actions could not be confirmed</AlertTitle>
          <AlertDescription>
            Actions are hidden until this can be checked again. This does not mean the
            assessment is closed.
          </AlertDescription>
        </Alert>
      )}

      {actions.data?.notice && (
        <Alert><AlertDescription>{actions.data.notice}</AlertDescription></Alert>
      )}

      <div
        className="flex flex-wrap gap-2"
        aria-label="Assessment journey"
        data-testid="bn-risk-journey"
      >
        {JOURNEY.map((stage) => {
          const state = journeyStates(header.status)[stage];
          return (
            <Badge
              key={stage}
              variant={state === 'CURRENT' ? 'default' : state === 'COMPLETE' ? 'secondary' : 'outline'}
              className={state === 'NOT_STARTED' ? 'opacity-60' : undefined}
            >
              {stage}
            </Badge>
          );
        })}
      </div>



      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Review context</CardTitle>
            <CardDescription>{header.summary ?? 'No description recorded.'}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground">Category</p>
              <p>{header.primary_category_label}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Opened</p>
              <p>{formatAuditDate(header.opened_at, false)} by {header.opened_by_name ?? '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Owner</p>
              <p>{header.assigned_owner_name ?? 'Unassigned'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Originating source</p>
              <p>{context.source_module ?? '—'} {context.signal_reference ?? ''}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Claim</p>
              <p>{header.claim_reference ?? '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Award</p>
              <p>{header.award_reference ?? '—'}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Readiness</CardTitle>
            <CardDescription>{readiness.stage_note}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              {readiness.active_factor_count} factor(s) ·{' '}
              {readiness.outstanding_evidence_count} evidence item(s) outstanding ·{' '}
              {readiness.open_blocking_request_count} blocking request(s)
            </p>
            {readiness.blockers.length > 0 && (
              <Alert variant="destructive">
                <AlertTitle>Not ready for review</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {readiness.blockers.map((b) => <li key={b}>{b}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {readiness.warnings.length > 0 && (
              <Alert>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {readiness.warnings.map((w) => <li key={w}>{w}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {readiness.can_review && (
              <Alert>
                <AlertTitle>Ready for review</AlertTitle>
                <AlertDescription>
                  Scoring is available below. A score is decision support only — it does not
                  stop payment, suspend a benefit or refer anyone to investigation.
                </AlertDescription>
              </Alert>
            )}

          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Linked signals</CardTitle>
          <CardDescription>
            Every signal this review is built on, with its role in the assessment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Signal</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Detected</TableHead>
                  <TableHead>Summary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signals.map((s) => (
                  <TableRow key={s.signal_id}>
                    <TableCell className="font-medium">{s.signal_reference}</TableCell>
                    <TableCell>{s.role_code === 'PRIMARY' ? 'Primary' : 'Related'}</TableCell>
                    <TableCell>{s.category_label}</TableCell>
                    <TableCell>{formatAuditDate(s.detected_at, false)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.summary}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <BnRiskFactorsSection
        assessmentId={assessmentId}
        rowVersion={technical.row_version}
        factors={factors}
        signals={signals}
        isActionEnabled={isActionEnabled}
        onChanged={refresh}
      />

      <BnRiskEvidenceSection
        assessmentId={assessmentId}
        rowVersion={technical.row_version}
        evidence={evidence}
        factors={factors}
        isActionEnabled={isActionEnabled}
        onChanged={refresh}
      />

      <BnRiskInformationSection
        assessmentId={assessmentId}
        rowVersion={technical.row_version}
        requests={requests}
        factors={factors}
        isActionEnabled={isActionEnabled}
        onChanged={refresh}
      />

      <BnRiskScoringSection
        assessmentId={assessmentId}
        isActionEnabled={isScoringActionEnabled}
        onChanged={refresh}
      />

      <BnRiskAssessmentReviewSection
        assessmentId={assessmentId}
        isActionEnabled={isScoringActionEnabled}
        onChanged={refresh}
      />

      <BnRiskRecommendationSection
        assessmentId={assessmentId}
        isActionEnabled={isActionEnabled}
        targetOptions={targetOptions}
        onChanged={refresh}
      />

      <div ref={approvalRef}>
        <BnRiskControlApprovalSection
          assessmentId={assessmentId}
          assessmentReference={header.assessment_reference}
          personName={header.person_name}
          isActionEnabled={isActionEnabled}
          onChanged={refresh}
        />
      </div>

      <div ref={executionRef}>
        <BnRiskControlExecutionSection assessmentId={assessmentId} onChanged={refresh} />
      </div>






      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
          <CardDescription>Every governed change made to this assessment.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {history.length === 0 && (
            <p className="text-sm text-muted-foreground">No history recorded.</p>
          )}
          {history.map((h, index) => (
            <div key={`${h.created_at}-${index}`} className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{h.event_code}</span>
                <span className="text-xs text-muted-foreground">
                  {formatAuditDate(h.created_at, false)}
                </span>
              </div>
              <p className="text-muted-foreground">
                {h.actor_name ?? h.actor_source ?? 'System'}
                {h.justification ? ` — ${h.justification}` : ''}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Complete information gathering</DialogTitle>
            <DialogDescription>
              This confirms the facts are collected and moves the assessment to review.
              No score or decision is produced.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Note (optional)</Label>
            <Textarea
              rows={3}
              value={completeNote}
              onChange={(e) => setCompleteNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteOpen(false)}>Cancel</Button>
            <Button
              disabled={completeMutation.isPending}
              onClick={() => completeMutation.mutate()}
            >
              {completeMutation.isPending ? 'Completing…' : 'Complete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
