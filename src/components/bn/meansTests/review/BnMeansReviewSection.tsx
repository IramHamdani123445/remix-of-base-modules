/**
 * MEANS-TEST EPIC 7 — Review and submission.
 *
 * A final case review, not another intake form. Every summary line comes
 * from `bn_means_review_summary_v1`; the decision to allow submission comes
 * only from `bn_means_submission_readiness_v1` and is re-decided by the
 * governed submission boundary. Nothing here calculates the means test and
 * nothing here approves the assessment.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertTriangle, CheckCircle2, ClipboardCheck, FileText, Loader2, Lock, ShieldAlert,
} from 'lucide-react';
import { MeansStateNotice } from '@/components/bn/meansTests/controls/MeansControls';
import { meansQueryService } from '@/services/bn/meansTests/meansQueryService';
import { meansCommandService } from '@/services/bn/meansTests/meansCommandService';
import { humaniseMeansCode } from '@/types/bn/meansTests/meansFieldContract';
import { formatWithCurrency } from '@/utils/formatCurrency';
import {
  declarationPayload,
  groupIssuesBySection,
  missingRequiredDeclarations,
  resolveSubmissionUiState,
  reviewSectionLabel,
  sectionTabFor,
  timelineLabel,
  type BnMeansDeclarationDefinition,
  type BnMeansReviewSummary,
  type BnMeansSubmissionReadiness,
} from '@/types/bn/meansTests/meansSubmission';

export interface BnMeansReviewSectionProps {
  assessmentId: string;
  /** Navigates the workspace to the section that owns a blocker. */
  onNavigateSection: (tab: string) => void;
  onReturnToQueue?: () => void;
  onViewClaim?: () => void;
  onViewAward?: () => void;
}

const SummaryTile: React.FC<{ label: string; value: React.ReactNode; hint?: string }> = ({
  label, value, hint,
}) => (
  <div className="rounded-md border border-border p-3">
    <p className="text-xs uppercase text-muted-foreground">{label}</p>
    <p className="text-lg font-semibold">{value}</p>
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

const ReviewBlock: React.FC<{
  title: string;
  description?: string;
  tab: string;
  complete?: boolean;
  onNavigate: (tab: string) => void;
  testId: string;
  children: React.ReactNode;
}> = ({ title, description, tab, complete, onNavigate, testId, children }) => (
  <Card data-testid={testId}>
    <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
      <div>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </div>
      <div className="flex items-center gap-2">
        {complete !== undefined && (
          <Badge variant={complete ? 'secondary' : 'destructive'}>
            {complete ? 'Complete' : 'Needs attention'}
          </Badge>
        )}
        <Button variant="outline" size="sm" onClick={() => onNavigate(tab)}>
          Return to section
        </Button>
      </div>
    </CardHeader>
    <CardContent className="space-y-3">{children}</CardContent>
  </Card>
);

export const BnMeansReviewSection: React.FC<BnMeansReviewSectionProps> = ({
  assessmentId,
  onNavigateSection,
  onReturnToQueue,
  onViewClaim,
  onViewAward,
}) => {
  const qc = useQueryClient();
  const [confirmed, setConfirmed] = React.useState<Record<string, boolean>>({});
  const [reviewConfirmed, setReviewConfirmed] = React.useState(false);
  const [commandError, setCommandError] = React.useState<{ code: string; detail: string } | null>(null);
  const [stale, setStale] = React.useState(false);
  const [result, setResult] = React.useState<Record<string, unknown> | null>(null);

  const readinessQuery = useQuery({
    queryKey: ['bn-means-submission-readiness', assessmentId],
    queryFn: () => meansQueryService.submissionReadiness(assessmentId),
  });
  const summaryQuery = useQuery({
    queryKey: ['bn-means-review-summary', assessmentId],
    queryFn: () => meansQueryService.reviewSummary(assessmentId),
  });

  const readiness =
    readinessQuery.data?.status === 'OK'
      ? ((readinessQuery.data.data ?? null) as BnMeansSubmissionReadiness | null)
      : null;
  const summary =
    summaryQuery.data?.status === 'OK'
      ? ((summaryQuery.data.data ?? null) as BnMeansReviewSummary | null)
      : null;

  const uiState = resolveSubmissionUiState({
    loading: readinessQuery.isLoading,
    queryStatus: readinessQuery.isError ? 'FAILED' : readinessQuery.data?.status,
    readiness,
    stale,
  });

  const declarations = (readiness?.required_declarations ?? []) as readonly BnMeansDeclarationDefinition[];
  const missingDeclarations = missingRequiredDeclarations(declarations, confirmed);
  const currency = String((summary?.context?.currency_code as string) ?? 'XCD');

  const submit = useMutation({
    mutationFn: () =>
      meansCommandService.execute({
        command: 'BN_MEANS_SUBMIT',
        assessmentId,
        expectedRowVersion: readiness?.expected_row_version ?? null,
        payload: {
          expected_policy_version: readiness?.policy_version_id ?? null,
          declarations: declarationPayload(declarations, confirmed),
        },
      }),
    onSuccess: (res) => {
      if (res.status === 'FAILED') {
        setCommandError({ code: res.errorCode ?? 'UNKNOWN', detail: res.errorDetail ?? '' });
        if (res.errorCode === 'STALE_ROW_VERSION') {
          setStale(true);
          setReviewConfirmed(false);
          readinessQuery.refetch();
          summaryQuery.refetch();
        }
        return;
      }
      setCommandError(null);
      setStale(false);
      setResult(res.data ?? {});
      qc.invalidateQueries({ queryKey: ['bn-means-detail', assessmentId] });
      qc.invalidateQueries({ queryKey: ['bn-means-actions', assessmentId] });
      qc.invalidateQueries({ queryKey: ['bn-means-submission-readiness', assessmentId] });
      qc.invalidateQueries({ queryKey: ['bn-means-review-summary', assessmentId] });
      // Draft/intake work queues must stop treating this as editable work.
      qc.invalidateQueries({ queryKey: ['bn-means-queue'] });
    },
  });

  if (readinessQuery.isLoading || summaryQuery.isLoading) {
    return <Skeleton className="h-64 w-full" data-testid="means-review-loading" />;
  }

  if (uiState === 'DENIED') {
    return (
      <MeansStateNotice
        state="DENIED"
        reason="You do not have permission to review or submit this assessment."
        testId="means-review-denied"
      />
    );
  }

  if (uiState === 'FAILED') {
    return (
      <MeansStateNotice
        state="FAILED"
        reason="Submission readiness could not be evaluated. Submission is unavailable until it can be checked."
        testId="means-review-failed"
      />
    );
  }

  const submitted = uiState === 'ALREADY_SUBMITTED' || result !== null;
  const blockerGroups = groupIssuesBySection(readiness?.blockers ?? []);
  const warnings = readiness?.warnings ?? [];
  const sectionComplete = (code: string) =>
    Boolean(readiness?.section_statuses?.find((s) => s.section === code)?.complete);

  /* ---------------- submitted result ---------------- */
  if (submitted) {
    const frozen = (summary?.submission?.frozen_version ?? null) as Record<string, unknown> | null;
    const ack = (summary?.submission?.acknowledgement ?? null) as Record<string, unknown> | null;
    return (
      <div className="space-y-4" data-testid="means-review-submitted">
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Assessment submitted</AlertTitle>
          <AlertDescription>
            Submitted — awaiting verification. This version is frozen; ordinary intake editing has
            stopped.
          </AlertDescription>
        </Alert>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryTile
            label="Assessment reference"
            value={String(readiness?.assessment_reference ?? summary?.context?.assessment_reference ?? '—')}
          />
          <SummaryTile
            label="Submitted at"
            value={String(summary?.submission?.submitted_at ?? result?.submitted_at ?? '—')}
          />
          <SummaryTile
            label="Frozen version"
            value={`v${String(frozen?.version_no ?? result?.frozen_version_no ?? '—')}`}
            hint="Snapshot fingerprint calculated by the backend"
          />
          <SummaryTile label="Current status" value="Submitted — awaiting verification" />
          <SummaryTile
            label="Verification work"
            value={String(summary?.submission?.verification_work_count ?? result?.verification_work_count ?? 0)}
            hint="Created from the frozen version"
          />
          <SummaryTile
            label="Acknowledgement"
            value={String(ack?.status ?? 'Pending')}
            hint="Delivery is owned by the Communication Hub"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {onReturnToQueue && (
            <Button variant="outline" size="sm" onClick={onReturnToQueue}>
              Return to Means-Test queue
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => onNavigateSection('context')}>
            View submitted assessment
          </Button>
          {onViewClaim && summary?.context?.claim_id ? (
            <Button variant="outline" size="sm" onClick={onViewClaim}>
              View Claim
            </Button>
          ) : null}
          {onViewAward && summary?.context?.award_id ? (
            <Button variant="outline" size="sm" onClick={onViewAward}>
              View Award
            </Button>
          ) : null}
        </div>
        <ReviewBlock
          title="Assessment timeline"
          tab="context"
          onNavigate={onNavigateSection}
          testId="means-review-timeline"
        >
          <ul className="space-y-2 text-sm">
            {(summary?.timeline ?? []).map((event, index) => (
              <li key={index} className="border-l-2 border-border pl-3">
                <p className="font-medium">{timelineLabel(String(event.event_code ?? ''))}</p>
                <p className="text-xs text-muted-foreground">{String(event.created_at ?? '')}</p>
              </li>
            ))}
            {(summary?.timeline ?? []).length === 0 && (
              <li className="text-muted-foreground">No milestones recorded.</li>
            )}
          </ul>
        </ReviewBlock>
      </div>
    );
  }

  /* ---------------- review surface ---------------- */
  return (
    <div className="space-y-4" data-testid="means-review-section">
      {uiState === 'STALE' && (
        <Alert variant="destructive" data-testid="means-review-stale">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>The assessment changed while you were reviewing it</AlertTitle>
          <AlertDescription>
            Nothing was submitted. The review has been refreshed — please review the changed
            information again before submitting.
          </AlertDescription>
        </Alert>
      )}

      {uiState === 'READY' ? (
        <Alert data-testid="means-review-ready">
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Ready to submit</AlertTitle>
          <AlertDescription>
            Every intake section is complete. Confirm the declarations below to submit.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive" data-testid="means-review-blocked">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Submission blocked</AlertTitle>
          <AlertDescription>
            Resolve the issues below before this assessment can be submitted.
          </AlertDescription>
        </Alert>
      )}

      {blockerGroups.length > 0 && (
        <Card data-testid="means-review-blockers">
          <CardHeader>
            <CardTitle className="text-base">Submission checks</CardTitle>
            <CardDescription>Issues are grouped by the section that can resolve them.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {blockerGroups.map((group) => (
              <div
                key={group.section}
                className="rounded-md border border-destructive/40 bg-destructive/5 p-3"
                data-testid={`means-review-blocker-${group.section}`}
              >
                <p className="text-sm font-medium">{group.label}</p>
                <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                  {group.issues.map((issue, index) => (
                    <li key={`${issue.code}-${index}`}>{issue.message}</li>
                  ))}
                </ul>
                <Button
                  className="mt-2"
                  variant="outline"
                  size="sm"
                  onClick={() => onNavigateSection(group.tab)}
                >
                  Resolve in {group.label}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {warnings.length > 0 && (
        <Alert data-testid="means-review-warnings">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {warnings.length} warning{warnings.length === 1 ? '' : 's'} reviewed
          </AlertTitle>
          <AlertDescription>
            <ul className="space-y-1">
              {warnings.map((warning, index) => (
                <li key={`${warning.code}-${index}`}>
                  {reviewSectionLabel(warning.section)}: {warning.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {commandError && (
        <Alert variant="destructive" data-testid="means-review-command-error">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Assessment not submitted</AlertTitle>
          <AlertDescription>
            {commandError.code === 'MISSING_REQUIRED_DECLARATION'
              ? 'A required declaration was not confirmed.'
              : commandError.code === 'POLICY_NOT_EFFECTIVE'
                ? 'The policy version attached to this assessment changed or is no longer effective.'
                : commandError.code === 'PERMISSION_DENIED'
                  ? 'You do not have permission to submit this assessment.'
                  : commandError.code === 'STALE_ROW_VERSION'
                    ? 'The assessment changed since you opened the review.'
                    : 'The submission could not be completed.'}
          </AlertDescription>
        </Alert>
      )}

      {/* -------- Assessment context -------- */}
      <ReviewBlock
        title="Assessment context"
        description="Who and what this assessment covers."
        tab="context"
        complete={sectionComplete('CONTEXT')}
        onNavigate={onNavigateSection}
        testId="means-review-context"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryTile label="Assessment reference" value={String(summary?.context?.assessment_reference ?? '—')} />
          <SummaryTile label="Person" value={String(summary?.context?.person_name ?? 'Assessed person')} />
          <SummaryTile
            label="Claim / Award context"
            value={
              summary?.context?.claim_id
                ? 'Linked to a claim'
                : summary?.context?.award_id
                  ? 'Linked to an award'
                  : 'No claim or award linked'
            }
          />
          <SummaryTile
            label="Benefit programme"
            value={humaniseMeansCode(String(summary?.context?.benefit_programme ?? ''))}
          />
          <SummaryTile
            label="Assessment reason"
            value={humaniseMeansCode(String(summary?.context?.assessment_reason ?? ''))}
          />
          <SummaryTile label="Effective date" value={String(summary?.context?.effective_from ?? '—')} />
          <SummaryTile
            label="Policy"
            value={String(summary?.context?.policy_version_label ?? 'No policy version attached')}
            hint={`Policy status: ${humaniseMeansCode(String(summary?.context?.policy_status ?? readiness?.policy_status ?? ''))}`}
          />
          <SummaryTile label="Currency" value={currency} />
          <SummaryTile label="Assessment owner" value={String(summary?.context?.assigned_to ?? 'Unassigned')} />
        </div>
      </ReviewBlock>

      {/* -------- Household -------- */}
      <ReviewBlock
        title="Household"
        tab="household"
        complete={sectionComplete('HOUSEHOLD')}
        onNavigate={onNavigateSection}
        testId="means-review-household"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryTile label="Current household size" value={summary?.household?.current_members ?? 0} />
          <SummaryTile label="Total members recorded" value={summary?.household?.total_members ?? 0} />
          <SummaryTile label="Dependants" value={summary?.household?.dependants ?? 0} />
          <SummaryTile label="Historical / ended members" value={summary?.household?.ended_members ?? 0} />
        </div>
        <ul className="space-y-1 text-sm">
          {(summary?.household?.members ?? []).map((member, index) => (
            <li key={index} className="rounded-md border border-border px-3 py-2">
              <span className="font-medium">{member.display_name}</span>{' '}
              <span className="text-muted-foreground">
                · {humaniseMeansCode(member.relationship_code)} · {member.member_from} →{' '}
                {member.member_to ?? 'current'} ·{' '}
                {member.is_dependant ? 'Dependant' : 'Not a dependant'}
              </span>
            </li>
          ))}
          {(summary?.household?.members ?? []).length === 0 && (
            <li className="text-muted-foreground">No household members recorded.</li>
          )}
        </ul>
      </ReviewBlock>

      {/* -------- Income -------- */}
      <ReviewBlock
        title="Income"
        tab="income"
        complete={sectionComplete('INCOME')}
        onNavigate={onNavigateSection}
        testId="means-review-income"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryTile label="Income facts" value={summary?.income?.fact_count ?? 0} />
          <SummaryTile label="Members with income" value={summary?.income?.members_with_income ?? 0} />
          <SummaryTile label="No income declared" value={summary?.income?.no_income_declarations ?? 0} />
          <SummaryTile
            label="Declared annualised income"
            value={formatWithCurrency(Number(summary?.income?.declared_annualised_income ?? 0), currency)}
            hint="Declared — the means test has not been calculated"
          />
        </div>
      </ReviewBlock>

      {/* -------- Assets -------- */}
      <ReviewBlock
        title="Assets"
        tab="assets"
        complete={sectionComplete('ASSETS')}
        onNavigate={onNavigateSection}
        testId="means-review-assets"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryTile label="Assets recorded" value={summary?.assets?.asset_count ?? 0} />
          <SummaryTile label="No assets declared" value={summary?.assets?.no_asset_declarations ?? 0} />
          <SummaryTile label="Potential disregards" value={summary?.assets?.possible_disregards ?? 0} />
          <SummaryTile
            label="Gross declared valuation"
            value={formatWithCurrency(Number(summary?.assets?.declared_valuation ?? 0), currency)}
            hint="Declared valuation — not an assessable amount"
          />
        </div>
      </ReviewBlock>

      {/* -------- Deductions -------- */}
      <ReviewBlock
        title="Deductions and disregards"
        description="Claimed — not yet allowed. Potential disregard — not yet applied."
        tab="deductions"
        complete={sectionComplete('DEDUCTIONS')}
        onNavigate={onNavigateSection}
        testId="means-review-deductions"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryTile label="Deduction claims" value={summary?.deductions?.claim_count ?? 0} />
          <SummaryTile
            label="Potential disregard claims"
            value={summary?.deductions?.possible_disregard_count ?? 0}
          />
          <SummaryTile
            label="Gross claimed amount"
            value={formatWithCurrency(Number(summary?.deductions?.claimed_total ?? 0), currency)}
            hint="Claimed — not yet allowed"
          />
          <SummaryTile
            label="Claims requiring evidence"
            value={summary?.deductions?.evidence_required_count ?? 0}
          />
        </div>
      </ReviewBlock>

      {/* -------- Evidence -------- */}
      <ReviewBlock
        title="Evidence and information requests"
        tab="evidence"
        complete={sectionComplete('EVIDENCE')}
        onNavigate={onNavigateSection}
        testId="means-review-evidence"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryTile label="Mandatory requirements" value={summary?.evidence?.mandatory_total ?? 0} />
          <SummaryTile label="Mandatory satisfied" value={summary?.evidence?.mandatory_satisfied ?? 0} />
          <SummaryTile label="Outstanding evidence" value={summary?.evidence?.mandatory_outstanding ?? 0} />
          <SummaryTile label="Usability issues" value={summary?.evidence?.unusable_document_count ?? 0} />
          <SummaryTile label="Open information requests" value={summary?.evidence?.open_information_requests ?? 0} />
          <SummaryTile label="Overdue requests" value={summary?.evidence?.overdue_information_requests ?? 0} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onNavigateSection('evidence')}>
            View Evidence
          </Button>
          <Button variant="outline" size="sm" onClick={() => onNavigateSection('evidence')}>
            View Information Requests
          </Button>
        </div>
      </ReviewBlock>

      {/* -------- Declarations -------- */}
      <Card data-testid="means-review-declarations">
        <CardHeader>
          <CardTitle className="text-base">Declarations</CardTitle>
          <CardDescription>
            Declarations are resolved from policy configuration and recorded with their wording and
            version.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {declarations.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="means-review-no-declarations">
              No declarations are configured for this assessment.
            </p>
          ) : (
            declarations.map((declaration) => (
              <label
                key={declaration.declaration_code}
                className="flex items-start gap-3 rounded-md border border-border p-3"
                data-testid={`means-declaration-${declaration.declaration_code}`}
              >
                <Checkbox
                  checked={Boolean(confirmed[declaration.declaration_code])}
                  aria-label={declaration.label}
                  onCheckedChange={(value) =>
                    setConfirmed((prev) => ({
                      ...prev,
                      [declaration.declaration_code]: value === true,
                    }))
                  }
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">
                    {declaration.label}
                    {declaration.required ? (
                      <Badge variant="outline" className="ml-2">Required</Badge>
                    ) : (
                      <Badge variant="secondary" className="ml-2">Optional</Badge>
                    )}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {declaration.statement_text}
                  </span>
                </span>
              </label>
            ))
          )}
        </CardContent>
      </Card>

      {/* -------- Final confirmation and submit -------- */}
      <Card data-testid="means-review-submit">
        <CardHeader>
          <CardTitle className="text-base">Submit assessment</CardTitle>
          <CardDescription>
            You are submitting assessment {String(readiness?.assessment_reference ?? '')}. After
            submission, the current version will be frozen and ordinary intake editing will stop.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-start gap-3 text-sm" data-testid="means-review-final-confirm">
            <Checkbox
              checked={reviewConfirmed}
              aria-label="I have reviewed this assessment"
              onCheckedChange={(value) => setReviewConfirmed(value === true)}
            />
            <span>I have reviewed this assessment and confirm it is ready for verification.</span>
          </label>
          <Separator />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              data-testid="means-submit-button"
              disabled={
                uiState !== 'READY' ||
                !reviewConfirmed ||
                missingDeclarations.length > 0 ||
                submit.isPending
              }
              onClick={() => submit.mutate()}
            >
              {submit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Lock className="mr-2 h-4 w-4" />
              Submit assessment
            </Button>
            {uiState !== 'READY' && (
              <span className="text-xs text-muted-foreground">
                Submission is unavailable until the outstanding issues are resolved.
              </span>
            )}
            {uiState === 'READY' && missingDeclarations.length > 0 && (
              <span className="text-xs text-muted-foreground" data-testid="means-review-missing-declarations">
                {missingDeclarations.length} required declaration
                {missingDeclarations.length === 1 ? '' : 's'} still to confirm.
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* -------- Timeline -------- */}
      <ReviewBlock
        title="Assessment timeline"
        tab="context"
        onNavigate={onNavigateSection}
        testId="means-review-timeline"
      >
        <ul className="space-y-2 text-sm">
          {(summary?.timeline ?? []).map((event, index) => (
            <li key={index} className="border-l-2 border-border pl-3">
              <p className="font-medium">{timelineLabel(String(event.event_code ?? ''))}</p>
              <p className="text-xs text-muted-foreground">{String(event.created_at ?? '')}</p>
            </li>
          ))}
          {(summary?.timeline ?? []).length === 0 && (
            <li className="text-muted-foreground">No milestones recorded.</li>
          )}
        </ul>
      </ReviewBlock>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <ClipboardCheck className="h-3 w-3" />
        Submission does not calculate the means test and does not approve the assessment.
        <FileText className="h-3 w-3" />
        Technical identifiers remain in Technical details.
      </p>
    </div>
  );
};

export default BnMeansReviewSection;
