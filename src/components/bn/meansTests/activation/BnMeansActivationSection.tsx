/**
 * MEANS-TEST EPIC 11 — Activation and Eligibility surface.
 *
 * One place where an officer activates an approved assessment, sees the
 * canonical `means.*` facts that will be published, and follows the
 * eligibility rerun through to its determination.
 *
 * Every gate is backend-owned: readiness, blockers, retry availability and
 * award-review handoffs are rendered exactly as the governed reads report
 * them. This component never decides eligibility and never recomputes a
 * fact value.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw, ShieldAlert, TriangleAlert, Zap } from 'lucide-react';
import { meansQueryService } from '@/services/bn/meansTests/meansQueryService';
import { meansCommandService } from '@/services/bn/meansTests/meansCommandService';
import {
  activationReasonLabel,
  eligibilityStatusLabel,
  eligibilityTone,
  type BnMeansActivationCommand,
  type BnMeansActivationContext,
  type BnMeansActivationFactBundle,
} from '@/types/bn/meansTests/meansActivation';

export interface BnMeansActivationSectionProps {
  readonly assessmentId: string;
}

type Failure = { code: string; message: string } | null;

const FAILURE_MESSAGES: Record<string, string> = {
  PERMISSION_DENIED: 'You do not have permission to activate this assessment.',
  STALE_ROW_VERSION: 'This assessment changed while the page was open. Reload and try again.',
  ALREADY_ACTIVE: 'This assessment is already active. Its original references are shown below.',
  INVALID_STATE: 'This assessment is not in a state that can be activated.',
  RETRY_NOT_AVAILABLE: 'A retry is not available for the current publication state.',
  NO_PUBLICATION: 'There is nothing published to retry yet.',
  ELIGIBILITY_BOUNDARY_UNAVAILABLE:
    'The eligibility boundary is unavailable. Activation is recorded; the rerun can be retried later.',
};

function failureMessage(code: string, detail: string): string {
  return FAILURE_MESSAGES[code] ?? activationReasonLabel(code) ?? detail ?? 'The action could not be completed.';
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function formatFactValue(key: string, value: unknown, currency: string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const money = ['means.assessable_income', 'means.assessable_assets', 'means.threshold', 'means.excess_amount'];
  if (money.includes(key)) {
    const n = Number(value);
    return Number.isFinite(n)
      ? `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : String(value);
  }
  return String(value);
}

const FACT_LABELS: Record<string, string> = {
  'means.assessment_id': 'Assessment',
  'means.assessment_status': 'Status',
  'means.policy_version': 'Policy version',
  'means.assessable_income': 'Assessable income',
  'means.assessable_assets': 'Assessable assets',
  'means.household_size': 'Household size',
  'means.threshold': 'Threshold',
  'means.excess_amount': 'Excess',
  'means.passed': 'Passed',
  'means.valid_until': 'Valid until',
  'means.reassessment_due': 'Reassessment due',
};

const FactTable: React.FC<{ bundle: BnMeansActivationFactBundle; currency: string; testId: string }> = ({
  bundle, currency, testId,
}) => (
  <dl className="grid gap-2 sm:grid-cols-2" data-testid={testId}>
    {Object.entries(bundle).map(([key, value]) => (
      <div key={key} className="rounded-md border border-border/60 px-3 py-2">
        <dt className="text-[11px] uppercase text-muted-foreground">{FACT_LABELS[key] ?? key}</dt>
        <dd className="break-words text-sm">{formatFactValue(key, value, currency)}</dd>
      </div>
    ))}
  </dl>
);

export const BnMeansActivationSection: React.FC<BnMeansActivationSectionProps> = ({ assessmentId }) => {
  const queryClient = useQueryClient();
  const [failure, setFailure] = React.useState<Failure>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const contextQuery = useQuery({
    queryKey: ['bn-means-activation', assessmentId],
    queryFn: () => meansQueryService.activationContext(assessmentId),
    enabled: Boolean(assessmentId),
  });

  const mutation = useMutation({
    mutationFn: async (command: BnMeansActivationCommand) => {
      const context = contextQuery.data?.data as BnMeansActivationContext | null;
      return meansCommandService.execute({
        command,
        assessmentId,
        expectedRowVersion: context?.assessment.row_version ?? null,
        payload: { command_surface: 'MEANS_ACTIVATION' },
      });
    },
    onSuccess: (result) => {
      if (result.status === 'FAILED') {
        setNotice(null);
        setFailure({
          code: result.errorCode ?? 'UNKNOWN',
          message: failureMessage(result.errorCode ?? 'UNKNOWN', result.errorDetail ?? ''),
        });
        return;
      }
      setFailure(null);
      setNotice(
        result.status === 'REPLAYED'
          ? 'This action had already been recorded. The original result is shown.'
          : 'Recorded.',
      );
      void queryClient.invalidateQueries({ queryKey: ['bn-means-activation', assessmentId] });
      void queryClient.invalidateQueries({ queryKey: ['bn-means-detail', assessmentId] });
      void queryClient.invalidateQueries({ queryKey: ['bn-means-actions', assessmentId] });
    },
    onError: (error: unknown) => {
      setNotice(null);
      setFailure({ code: 'UNKNOWN', message: (error as Error)?.message ?? 'The action could not be completed.' });
    },
  });

  if (contextQuery.isLoading) {
    return <Skeleton className="h-64" data-testid="means-activation-loading" />;
  }

  const status = contextQuery.data?.status;
  if (contextQuery.isError || (status && status !== 'OK')) {
    return (
      <Alert variant="destructive" data-testid="means-activation-unavailable">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Activation cannot be shown</AlertTitle>
        <AlertDescription>
          {status === 'DENIED'
            ? 'You do not have permission to view the activation record for this assessment.'
            : 'The activation record could not be loaded. Treat activation status as unknown, not as absent.'}
        </AlertDescription>
      </Alert>
    );
  }

  const context = contextQuery.data?.data as BnMeansActivationContext | null;
  if (!context) {
    return (
      <Alert data-testid="means-activation-empty">
        <TriangleAlert className="h-4 w-4" />
        <AlertDescription>No activation record is available for this assessment.</AlertDescription>
      </Alert>
    );
  }

  const { assessment, approval, approved_calculation, readiness, fact_preview, publication, eligibility, award_review, history } =
    context;
  const currency = assessment.currency_code ?? approved_calculation?.currency_code ?? 'XCD';
  const busy = mutation.isPending;

  return (
    <div className="space-y-4" data-testid="means-activation-section">
      {failure && (
        <Alert variant="destructive" data-testid="means-activation-failure">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>{failure.code.replace(/_/g, ' ').toLowerCase()}</AlertTitle>
          <AlertDescription>{failure.message}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert data-testid="means-activation-notice">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-4 w-4" /> Activation
            </CardTitle>
            <CardDescription>
              Activation publishes the canonical means facts and asks the eligibility engine to rerun.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" data-testid="means-activation-status">{assessment.status}</Badge>
            <Badge variant="secondary" data-testid="means-activation-state">{readiness.state}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Reference', assessment.assessment_reference],
              ['Programme', assessment.benefit_programme],
              ['Policy version', assessment.policy_version_label ?? assessment.policy_version_id ?? '—'],
              ['Activated', formatDate(assessment.activated_at)],
              ['Approved by', approval?.decided_by_label ?? '—'],
              ['Approved on', formatDate(approval?.decided_at)],
              ['Valid until', readiness.valid_until ?? approved_calculation?.valid_until ?? '—'],
              ['Reassessment due', readiness.reassessment_due ?? approved_calculation?.reassessment_due ?? '—'],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-[11px] uppercase text-muted-foreground">{label}</dt>
                <dd className="text-sm">{String(value ?? '—')}</dd>
              </div>
            ))}
          </dl>

          {readiness.blockers.length > 0 && (
            <Alert variant="destructive" data-testid="means-activation-blockers">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Activation is blocked</AlertTitle>
              <AlertDescription>
                <ul className="ml-4 list-disc space-y-1 text-sm">
                  {readiness.blockers.map((b) => (
                    <li key={b.code}>{b.message || activationReasonLabel(b.code)}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {readiness.warnings.length > 0 && (
            <Alert data-testid="means-activation-warnings">
              <TriangleAlert className="h-4 w-4" />
              <AlertDescription>
                <ul className="ml-4 list-disc space-y-1 text-sm">
                  {readiness.warnings.map((w) => (
                    <li key={w.code}>{w.message || activationReasonLabel(w.code)}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!readiness.can_activate || busy}
              onClick={() => mutation.mutate('BN_MEANS_ACTIVATE')}
              data-testid="means-activate-button"
            >
              <Zap className="mr-2 h-4 w-4" /> Activate assessment
            </Button>
            {publication?.status === 'FAILED' && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => mutation.mutate('BN_MEANS_RETRY_FACT_PUBLICATION')}
                data-testid="means-retry-publication-button"
              >
                <RefreshCw className="mr-2 h-4 w-4" /> Retry fact publication
              </Button>
            )}
            {eligibility.retry_available && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => mutation.mutate('BN_MEANS_RETRY_ELIGIBILITY_REQUEST')}
                data-testid="means-retry-eligibility-button"
              >
                <RefreshCw className="mr-2 h-4 w-4" /> Retry eligibility rerun
              </Button>
            )}
            {eligibility.request_id && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => mutation.mutate('BN_MEANS_REFRESH_ELIGIBILITY_RESULT')}
                data-testid="means-refresh-eligibility-button"
              >
                <RefreshCw className="mr-2 h-4 w-4" /> Refresh eligibility result
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Canonical means facts</CardTitle>
          <CardDescription>
            These are the only values published to the eligibility engine. Household detail is never published.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {publication?.fact_bundle ? (
            <FactTable bundle={publication.fact_bundle} currency={currency} testId="means-published-facts" />
          ) : fact_preview ? (
            <FactTable bundle={fact_preview} currency={currency} testId="means-fact-preview" />
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="means-facts-unavailable">
              The fact bundle cannot be produced yet.
            </p>
          )}
          {publication && (
            <>
              <Separator />
              <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="means-publication-record">
                {[
                  ['Publication', publication.publication_reference ?? publication.publication_id],
                  ['Version', publication.publication_version ?? '—'],
                  ['Status', publication.status],
                  ['Published', formatDate(publication.published_at)],
                  ['Published by', publication.published_by_label ?? '—'],
                  ['Bundle hash', publication.bundle_hash ? `${publication.bundle_hash.slice(0, 16)}…` : '—'],
                  ['Retries', publication.retry_count ?? 0],
                  ['Failure', publication.failure_code ?? '—'],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt className="text-[11px] uppercase text-muted-foreground">{label}</dt>
                    <dd className="break-words text-sm">{String(value ?? '—')}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm">Eligibility rerun</CardTitle>
          <Badge variant={eligibilityTone(eligibility.status)} data-testid="means-eligibility-status">
            {eligibilityStatusLabel(eligibility.status)}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['Request', eligibility.request_id ?? '—'],
              ['Hand-off status', eligibility.request_status ?? '—'],
              ['Requested', formatDate(eligibility.requested_at)],
              ['Completed', formatDate(eligibility.completed_at)],
              ['Determination', eligibility.determination_status ?? 'Not returned'],
              ['Result reference', eligibility.result_reference ?? '—'],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-[11px] uppercase text-muted-foreground">{label}</dt>
                <dd className="break-words text-sm">{String(value ?? '—')}</dd>
              </div>
            ))}
          </dl>
          {eligibility.failure_code && (
            <Alert variant="destructive" data-testid="means-eligibility-failure">
              <TriangleAlert className="h-4 w-4" />
              <AlertDescription>
                {eligibility.failure_detail || activationReasonLabel(eligibility.failure_code)}
              </AlertDescription>
            </Alert>
          )}
          {award_review && (
            <Alert data-testid="means-award-review">
              <TriangleAlert className="h-4 w-4" />
              <AlertTitle>Award review raised</AlertTitle>
              <AlertDescription>
                The eligibility outcome requires an award review
                {award_review.target_reference ? ` (${award_review.target_reference})` : ''}. Status:{' '}
                {award_review.status ?? 'OPEN'}.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Activation history</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
          ) : (
            <ol className="space-y-2" data-testid="means-activation-history">
              {history.map((entry, index) => (
                <li key={`${entry.event_code}-${entry.occurred_at}-${index}`} className="rounded-md border px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{entry.event_code.replace(/_/g, ' ').toLowerCase()}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(entry.occurred_at)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {entry.actor_label ?? 'System'}
                    {entry.from_status && entry.to_status ? ` · ${entry.from_status} → ${entry.to_status}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default BnMeansActivationSection;
