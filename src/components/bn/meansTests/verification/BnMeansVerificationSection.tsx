/**
 * MEANS-TEST EPIC 8 — verification and clarification surface.
 *
 * Shows the frozen submitted version, one card per fact with its supporting
 * evidence, and only those actions the backend says are available. Nothing
 * on this surface edits a declared value.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/hooks/use-toast';
import {
  AlertTriangle, CheckCircle2, Clock, FileText, Lock, MessageSquareWarning, ShieldAlert,
} from 'lucide-react';
import { meansQueryService } from '@/services/bn/meansTests/meansQueryService';
import { meansCommandService } from '@/services/bn/meansTests/meansCommandService';
import { humaniseMeansCode } from '@/types/bn/meansTests/meansFieldContract';
import {
  BN_MEANS_FACT_KIND_LABEL,
  BN_MEANS_OUTCOME_LABEL,
  BN_MEANS_WORK_STATUS_LABEL,
  describeDeclaredFact,
  resolveProcessingJourney,
  type BnMeansVerificationCommand,
  type BnMeansVerificationFactCard,
} from '@/types/bn/meansTests/meansVerification';
import { BnMeansVerificationDecisionDialog } from './BnMeansVerificationDecisionDialog';
import { BnMeansClarificationResponseDialog } from './BnMeansClarificationResponseDialog';

export interface BnMeansVerificationSectionProps {
  readonly assessmentId: string;
  readonly assessmentStatus: string;
}

const ACTION_LABEL: Record<BnMeansVerificationCommand, string> = {
  BN_MEANS_CLAIM_VERIFICATION_WORK: 'Start review',
  BN_MEANS_RELEASE_VERIFICATION_WORK: 'Release',
  BN_MEANS_RECORD_VERIFICATION_DECISION: 'Record decision',
  BN_MEANS_RECORD_CLARIFICATION_RESPONSE: 'Record response',
  BN_MEANS_CANCEL_CLARIFICATION: 'Cancel request',
  BN_MEANS_REOPEN_VERIFICATION_FACT: 'Reopen',
  BN_MEANS_COMPLETE_VERIFICATION: 'Complete verification',
};

export const BnMeansVerificationSection: React.FC<BnMeansVerificationSectionProps> = ({
  assessmentId, assessmentStatus,
}) => {
  const qc = useQueryClient();
  const [decisionFact, setDecisionFact] = React.useState<BnMeansVerificationFactCard | null>(null);
  const [responseFact, setResponseFact] = React.useState<BnMeansVerificationFactCard | null>(null);

  const workspace = useQuery({
    queryKey: ['bn-means-verification-workspace', assessmentId],
    queryFn: () => meansQueryService.verificationWorkspace(assessmentId),
  });

  const data = workspace.data?.status === 'OK' ? workspace.data.data : null;
  const readinessUnavailable = !workspace.isLoading && !data;

  const run = useMutation({
    mutationFn: async (input: {
      command: BnMeansVerificationCommand;
      payload: Record<string, unknown>;
      rowVersion?: number | null;
    }) =>
      meansCommandService.execute({
        command: input.command,
        assessmentId,
        expectedRowVersion: input.rowVersion ?? data?.assessment.row_version ?? null,
        payload: input.payload,
      }),
    onSuccess: (result, input) => {
      if (result.status === 'FAILED') {
        toast({
          variant: 'destructive',
          title: ACTION_LABEL[input.command] + ' could not be completed',
          description: result.errorDetail ?? result.errorCode ?? 'Unknown error',
        });
        return;
      }
      toast({ title: result.status === 'REPLAYED' ? 'Already recorded' : 'Recorded' });
      setDecisionFact(null);
      setResponseFact(null);
      qc.invalidateQueries({ queryKey: ['bn-means-verification-workspace', assessmentId] });
      qc.invalidateQueries({ queryKey: ['bn-means-verification-queue'] });
      qc.invalidateQueries({ queryKey: ['bn-means-assessment', assessmentId] });
    },
    onError: (e: unknown) =>
      toast({ variant: 'destructive', title: 'Action failed', description: String(e) }),
  });

  if (workspace.isLoading) return <Skeleton className="h-64 w-full" />;

  if (workspace.data && workspace.data.status === 'DENIED') {
    return (
      <Alert variant="destructive" data-testid="means-verification-denied">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Access denied</AlertTitle>
        <AlertDescription>You do not hold permission to verify this assessment.</AlertDescription>
      </Alert>
    );
  }

  if (!data) {
    return (
      <Alert variant="destructive" data-testid="means-verification-failed">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Verification could not be loaded</AlertTitle>
        <AlertDescription>
          {workspace.data?.detail ?? 'This section is unavailable — no verification state is shown.'}
        </AlertDescription>
      </Alert>
    );
  }

  const { readiness, reference, frozen_version: frozen, actor } = data;
  const journey = resolveProcessingJourney(readiness, readinessUnavailable, assessmentStatus);
  const canAct = (fact: BnMeansVerificationFactCard, cmd: BnMeansVerificationCommand) =>
    fact.allowed_actions.includes(cmd);

  return (
    <div className="space-y-4" data-testid="means-verification-section">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4" />
            Verification against the frozen submitted version
          </CardTitle>
          <CardDescription>
            {frozen
              ? `Version ${frozen.version_no}, frozen ${String(frozen.frozen_at).slice(0, 10)}. Declared values cannot be changed here.`
              : 'No frozen version is available for this assessment.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2" data-testid="means-processing-journey">
            {journey.map((stage) => (
              <Badge
                key={stage.key}
                variant={
                  stage.state === 'COMPLETE' ? 'default'
                    : stage.state === 'CURRENT' ? 'secondary'
                    : stage.state === 'BLOCKED' ? 'destructive'
                    : 'outline'
                }
                title={stage.hint}
              >
                {stage.label}
              </Badge>
            ))}
          </div>

          {frozen && !frozen.snapshot_hash_valid && (
            <Alert variant="destructive" data-testid="means-snapshot-tampered">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Frozen snapshot integrity check failed</AlertTitle>
              <AlertDescription>Verification cannot be completed until this is resolved.</AlertDescription>
            </Alert>
          )}

          {!actor.can_verify && (
            <Alert data-testid="means-verification-readonly">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Read only</AlertTitle>
              <AlertDescription>
                {actor.is_submitter
                  ? 'You submitted this assessment, so you cannot verify it.'
                  : actor.denied_reason ?? 'You may view verification but not act on it.'}
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-2 text-sm sm:grid-cols-4">
            <span>To decide: <strong>{readiness.pending_work + readiness.in_progress_work}</strong></span>
            <span>Awaiting clarification: <strong>{readiness.clarification_pending_work}</strong></span>
            <span>Verified: <strong>{readiness.verified_facts}</strong></span>
            <span>Rejected: <strong>{readiness.rejected_facts}</strong></span>
          </div>

          {readiness.blockers.length > 0 && (
            <Alert data-testid="means-verification-blockers">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Outstanding before verification can be completed</AlertTitle>
              <AlertDescription>
                <ul className="ml-4 list-disc">
                  {readiness.blockers.map((b) => <li key={b.code}>{b.message}</li>)}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end">
            <Button
              disabled={
                run.isPending ||
                !actor.can_verify ||
                readiness.verification_marked_complete ||
                readiness.blockers.length > 0
              }
              data-testid="means-complete-verification"
              onClick={() => run.mutate({ command: 'BN_MEANS_COMPLETE_VERIFICATION', payload: {} })}
            >
              {readiness.verification_marked_complete ? 'Verification complete' : 'Complete verification'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {data.facts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No verification work exists for this version.</p>
      ) : (
        data.facts.map((fact) => (
          <Card key={fact.work_id} data-testid={`means-verification-fact-${fact.work_id}`}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-sm">
                    {BN_MEANS_FACT_KIND_LABEL[fact.fact_kind]}
                    {fact.fact_summary ? ` — ${fact.fact_summary}` : ''}
                  </CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-2 pt-1">
                    <Badge variant="outline">{BN_MEANS_WORK_STATUS_LABEL[fact.status]}</Badge>
                    {fact.outcome && (
                      <Badge variant={fact.outcome === 'VERIFIED' ? 'default' : 'secondary'}>
                        {BN_MEANS_OUTCOME_LABEL[fact.outcome]}
                      </Badge>
                    )}
                    {fact.review_round > 1 && <Badge variant="outline">Round {fact.review_round}</Badge>}
                    {fact.claimed_by_me && <Badge variant="secondary">Claimed by you</Badge>}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {describeDeclaredFact(fact.fact_kind, fact.declared).map((row) => (
                  <div key={row.label} className="flex justify-between gap-2 border-b py-1">
                    <dt className="text-muted-foreground">{row.label}</dt>
                    <dd className="font-medium">{humaniseMeansCode(row.value)}</dd>
                  </div>
                ))}
              </dl>

              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Supporting evidence</p>
                {fact.evidence.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No evidence is linked to this fact.</p>
                ) : (
                  <ul className="space-y-1">
                    {fact.evidence.map((e) => (
                      <li key={e.link_id} className="flex items-center gap-2 text-sm">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{e.document_title}</span>
                        <Badge variant={e.usable ? 'outline' : 'destructive'} className="text-[10px]">
                          {humaniseMeansCode(e.usability_status)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {fact.clarification && (
                <Alert data-testid={`means-clarification-${fact.work_id}`}>
                  <MessageSquareWarning className="h-4 w-4" />
                  <AlertTitle className="flex items-center gap-2">
                    Clarification {humaniseMeansCode(fact.clarification.status)}
                    {fact.clarification.overdue && <Badge variant="destructive">Overdue</Badge>}
                  </AlertTitle>
                  <AlertDescription className="space-y-1">
                    <p>{fact.clarification.information_required}</p>
                    {fact.clarification.due_date && (
                      <p className="flex items-center gap-1 text-xs">
                        <Clock className="h-3 w-3" /> Due {fact.clarification.due_date}
                      </p>
                    )}
                    {fact.clarification.responses.map((r) => (
                      <p key={r.response_id} className="flex items-center gap-1 text-xs">
                        <CheckCircle2 className="h-3 w-3" /> {humaniseMeansCode(r.response_kind)}
                        {r.note ? ` — ${r.note}` : ''}
                      </p>
                    ))}
                  </AlertDescription>
                </Alert>
              )}

              <Separator />

              <div className="flex flex-wrap justify-end gap-2">
                {canAct(fact, 'BN_MEANS_CLAIM_VERIFICATION_WORK') && (
                  <Button
                    size="sm" variant="outline" disabled={run.isPending}
                    onClick={() => run.mutate({ command: 'BN_MEANS_CLAIM_VERIFICATION_WORK', payload: { work_id: fact.work_id } })}
                  >
                    {ACTION_LABEL.BN_MEANS_CLAIM_VERIFICATION_WORK}
                  </Button>
                )}
                {canAct(fact, 'BN_MEANS_RELEASE_VERIFICATION_WORK') && (
                  <Button
                    size="sm" variant="ghost" disabled={run.isPending}
                    onClick={() => run.mutate({ command: 'BN_MEANS_RELEASE_VERIFICATION_WORK', payload: { work_id: fact.work_id } })}
                  >
                    {ACTION_LABEL.BN_MEANS_RELEASE_VERIFICATION_WORK}
                  </Button>
                )}
                {canAct(fact, 'BN_MEANS_CANCEL_CLARIFICATION') && (
                  <Button
                    size="sm" variant="ghost" disabled={run.isPending}
                    onClick={() => run.mutate({ command: 'BN_MEANS_CANCEL_CLARIFICATION', payload: { work_id: fact.work_id, request_id: fact.clarification?.request_id ?? null } })}
                  >
                    {ACTION_LABEL.BN_MEANS_CANCEL_CLARIFICATION}
                  </Button>
                )}
                {canAct(fact, 'BN_MEANS_REOPEN_VERIFICATION_FACT') && (
                  <Button
                    size="sm" variant="outline" disabled={run.isPending}
                    onClick={() => run.mutate({ command: 'BN_MEANS_REOPEN_VERIFICATION_FACT', payload: { work_id: fact.work_id } })}
                  >
                    {ACTION_LABEL.BN_MEANS_REOPEN_VERIFICATION_FACT}
                  </Button>
                )}
                {canAct(fact, 'BN_MEANS_RECORD_CLARIFICATION_RESPONSE') && (
                  <Button
                    size="sm" variant="outline" disabled={run.isPending}
                    onClick={() => setResponseFact(fact)}
                    data-testid={`means-open-response-${fact.work_id}`}
                  >
                    {ACTION_LABEL.BN_MEANS_RECORD_CLARIFICATION_RESPONSE}
                  </Button>
                )}
                {canAct(fact, 'BN_MEANS_RECORD_VERIFICATION_DECISION') && (
                  <Button
                    size="sm" disabled={run.isPending}
                    onClick={() => setDecisionFact(fact)}
                    data-testid={`means-open-decision-${fact.work_id}`}
                  >
                    {ACTION_LABEL.BN_MEANS_RECORD_VERIFICATION_DECISION}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <BnMeansVerificationDecisionDialog
        open={decisionFact !== null}
        onOpenChange={(o) => !o && setDecisionFact(null)}
        fact={decisionFact}
        reference={reference}
        busy={run.isPending}
        onSubmit={(payload) => run.mutate({ command: 'BN_MEANS_RECORD_VERIFICATION_DECISION', payload })}
      />
      <BnMeansClarificationResponseDialog
        open={responseFact !== null}
        onOpenChange={(o) => !o && setResponseFact(null)}
        fact={responseFact}
        reference={reference}
        busy={run.isPending}
        onSubmit={(payload) => run.mutate({ command: 'BN_MEANS_RECORD_CLARIFICATION_RESPONSE', payload })}
      />
    </div>
  );
};

export default BnMeansVerificationSection;
