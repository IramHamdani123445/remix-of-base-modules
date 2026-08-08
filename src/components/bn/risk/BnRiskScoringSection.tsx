/**
 * BN Risk — scoring section (EPIC 2).
 *
 * Officer decision-support surface for the governed risk score. Every value
 * shown here — the total, the band, the contributions and the explanations —
 * is read from the backend. This component performs no arithmetic and holds
 * no rule, weight, threshold or band knowledge of its own.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Calculator, ChevronDown, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
import { riskScoringService } from '@/services/bn/risk/riskScoringService';
import {
  groupRiskContribution,
  type BnRiskScoreContribution,
  type BnRiskScoringCommand,
} from '@/types/bn/risk/riskScoring';

interface Props {
  assessmentId: string;
  /** Governed enablement from `bn_risk_assessment_actions_v1`. */
  isActionEnabled: (action: BnRiskScoringCommand) => boolean;
  onChanged: () => void;
}

const GROUP_META = {
  INCREASES: { title: 'Factors increasing concern', icon: TrendingUp },
  REDUCES: { title: 'Factors reducing concern', icon: TrendingDown },
  NEUTRAL: { title: 'Neutral / no contribution', icon: Minus },
} as const;

const ContributionRow: React.FC<{ line: BnRiskScoreContribution }> = ({ line }) => (
  <div className="rounded-md border p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-medium">
        {line.factor_type_label ?? line.rule_name ?? 'Business test'}
      </span>
      <div className="flex items-center gap-2">
        {line.outcome === 'CAPPED' && (
          <Badge variant="outline">Contribution limited by configured maximum</Badge>
        )}
        <Badge variant={line.outcome === 'MATCHED' || line.outcome === 'CAPPED'
          ? 'secondary' : 'outline'}>
          {line.outcome === 'MATCHED' ? 'Condition met'
            : line.outcome === 'CAPPED' ? 'Condition met (limited)'
            : line.outcome === 'SKIPPED' ? 'Not applicable' : 'Condition not met'}
        </Badge>
        <span className="font-mono">{line.contribution > 0 ? '+' : ''}{line.contribution}</span>
      </div>
    </div>
    <dl className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
      <div>
        <dt className="font-medium text-foreground">Business test</dt>
        <dd>{line.rule_name ?? '—'}{line.comparison_display ? ` · ${line.comparison_display}` : ''}</dd>
      </div>
      <div>
        <dt className="font-medium text-foreground">Observed</dt>
        <dd>{line.evaluated_input ?? '—'}</dd>
      </div>
      <div>
        <dt className="font-medium text-foreground">Factor</dt>
        <dd>{line.factor_reference ?? '—'}{line.direction_label ? ` · ${line.direction_label}` : ''}</dd>
      </div>
    </dl>
    {line.explanation && <p className="mt-2">{line.explanation}</p>}
  </div>
);

export const BnRiskScoringSection: React.FC<Props> = ({
  assessmentId, isActionEnabled, onChanged,
}) => {
  const queryClient = useQueryClient();
  const [recalcOpen, setRecalcOpen] = React.useState(false);
  const [recalcReason, setRecalcReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [showAllRules, setShowAllRules] = React.useState(false);

  const readiness = useQuery({
    queryKey: ['bn-risk-scoring-readiness', assessmentId],
    queryFn: async () => {
      const result = await riskScoringService.scoringReadiness(assessmentId);
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data;
    },
  });

  const detail = useQuery({
    queryKey: ['bn-risk-score-detail', assessmentId],
    queryFn: async () => {
      const result = await riskScoringService.scoreDetail(assessmentId);
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data;
    },
  });

  const refresh = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['bn-risk-scoring-readiness', assessmentId] });
    queryClient.invalidateQueries({ queryKey: ['bn-risk-score-detail', assessmentId] });
    queryClient.invalidateQueries({ queryKey: ['bn-risk-review-readiness', assessmentId] });
    queryClient.invalidateQueries({ queryKey: ['bn-risk-assessment-queue'] });
    onChanged();
  }, [assessmentId, onChanged, queryClient]);

  const scoreMutation = useMutation({
    mutationFn: async (command: 'CALCULATE_SCORE' | 'RECALCULATE_SCORE') => {
      const result = await riskScoringService.execute({
        command,
        assessmentId,
        expectedRowVersion: readiness.data?.assessment_row_version ?? null,
        payload: command === 'RECALCULATE_SCORE' && recalcReason.trim()
          ? { recalculation_reason: recalcReason.trim() }
          : {},
      });
      if (result.status === 'FAILED') {
        throw new Error(result.errorMessage ?? 'The risk score could not be calculated.');
      }
      return result;
    },
    onSuccess: () => {
      setRecalcOpen(false);
      setRecalcReason('');
      setError(null);
      refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  if (readiness.isLoading || detail.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  const readFailed = readiness.isError || !readiness.data || detail.isError || !detail.data;
  if (readFailed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Risk scoring</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTitle>Scoring information is unavailable</AlertTitle>
            <AlertDescription>
              Scoring cannot be checked at the moment, so no scoring action is offered.
              Nothing has been changed.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const ready = readiness.data;
  const score = detail.data.current_score;
  const contributions = detail.data.contributions;
  const material = contributions.filter((c) => groupRiskContribution(c) !== 'NEUTRAL');
  const neutral = contributions.filter((c) => groupRiskContribution(c) === 'NEUTRAL');
  const canCalculate = ready.can_score && !ready.has_score && isActionEnabled('CALCULATE_SCORE');
  const canRecalculate = ready.can_score && ready.has_score && isActionEnabled('RECALCULATE_SCORE');

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-4 w-4" /> Risk scoring
          </CardTitle>
          <CardDescription>
            A deterministic, explainable score produced by the scoring configuration in force.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          {!ready.has_score && (
            <Button
              size="sm"
              disabled={!canCalculate || scoreMutation.isPending}
              onClick={() => { setError(null); scoreMutation.mutate('CALCULATE_SCORE'); }}
            >
              {scoreMutation.isPending ? 'Calculating…' : 'Calculate risk score'}
            </Button>
          )}
          {ready.has_score && (
            <Button
              size="sm"
              variant={ready.is_stale ? 'default' : 'outline'}
              disabled={!canRecalculate || scoreMutation.isPending}
              onClick={() => { setError(null); setRecalcOpen(true); }}
            >
              Recalculate risk score
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

        {ready.blockers.length > 0 && (
          <Alert variant="destructive">
            <AlertTitle>Scoring is not available yet</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {ready.blockers.map((b) => <li key={b}>{b}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {ready.warnings.length > 0 && (
          <Alert>
            <AlertTitle>Scoring warnings</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {ready.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {!score && (
          <p className="text-sm text-muted-foreground">Risk scoring has not yet been run.</p>
        )}

        {score && (
          <>
            {score.is_stale && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Risk score is out of date</AlertTitle>
                <AlertDescription>
                  Assessment information changed after this score was calculated. It is no longer
                  the authoritative result — recalculate before completing the review.
                </AlertDescription>
              </Alert>
            )}

            <div
              className={`rounded-md border p-4 ${score.is_stale ? 'opacity-60' : ''}`}
              data-testid="bn-risk-current-score"
            >
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="text-3xl font-semibold">{score.score}</span>
                <span className="text-sm text-muted-foreground">
                  of {score.score_scale_max} ({score.score_scale_min}–{score.score_scale_max})
                </span>
                <Badge variant={score.is_stale ? 'outline' : 'secondary'}>
                  Risk band: {score.band_label ?? 'Not banded'}
                </Badge>
                <Badge variant="outline">{score.is_stale ? 'Out of date' : 'Current'}</Badge>
              </div>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">Calculated</dt>
                  <dd>{formatAuditDate(score.calculated_at, false)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Calculated by</dt>
                  <dd>{score.calculated_by_name ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Scoring configuration</dt>
                  <dd>{score.rule_set_name ?? score.rule_set_code} · version {score.rule_set_version_no}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Score version</dt>
                  <dd>{score.version_no}</dd>
                </div>
              </dl>
              {score.recalculation_reason && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Reason for recalculation: {score.recalculation_reason}
                </p>
              )}
            </div>

            <Alert>
              <AlertDescription>
                This score supports Risk Assessment review. It does not itself approve or execute
                any benefit control, and it does not establish that fraud has occurred.
              </AlertDescription>
            </Alert>

            <div className="space-y-4">
              {(['INCREASES', 'REDUCES'] as const).map((group) => {
                const lines = material.filter((c) => groupRiskContribution(c) === group);
                if (lines.length === 0) return null;
                const Meta = GROUP_META[group];
                const Icon = Meta.icon;
                return (
                  <div key={group} className="space-y-2">
                    <h4 className="flex items-center gap-2 text-sm font-semibold">
                      <Icon className="h-4 w-4" /> {Meta.title}
                    </h4>
                    {lines.map((line) => (
                      <ContributionRow key={line.contribution_id} line={line} />
                    ))}
                  </div>
                );
              })}
              {material.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No business test contributed to this score.
                </p>
              )}
            </div>

            {neutral.length > 0 && (
              <Collapsible open={showAllRules} onOpenChange={setShowAllRules}>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="sm">
                    <ChevronDown className="mr-1 h-4 w-4" />
                    {showAllRules ? 'Hide other evaluated rules' : 'Show all evaluated rules'}
                    {` (${neutral.length})`}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-2">
                  <h4 className="flex items-center gap-2 text-sm font-semibold">
                    <Minus className="h-4 w-4" /> {GROUP_META.NEUTRAL.title}
                  </h4>
                  {neutral.map((line) => (
                    <ContributionRow key={line.contribution_id} line={line} />
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        )}

        {detail.data.history.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Score history</h4>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Version</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Band</TableHead>
                    <TableHead>Configuration</TableHead>
                    <TableHead>Calculated</TableHead>
                    <TableHead>State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.data.history.map((h) => (
                    <TableRow key={h.score_id}>
                      <TableCell>{h.version_no}</TableCell>
                      <TableCell>{h.score}</TableCell>
                      <TableCell>{h.band_label ?? '—'}</TableCell>
                      <TableCell>{h.rule_set_code} v{h.rule_set_version_no}</TableCell>
                      <TableCell>{formatAuditDate(h.calculated_at, false)}</TableCell>
                      <TableCell>
                        {h.status === 'CURRENT'
                          ? (score?.is_stale ? 'Current (out of date)' : 'Current')
                          : 'Superseded'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              A superseded score stays tied to the configuration version it was produced under.
              A new configuration never reinterprets an existing score.
            </p>
          </div>
        )}

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm">Technical details</Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 space-y-1 rounded-md border p-3 font-mono text-xs text-muted-foreground">
              <p>Assessment row version: {ready.assessment_row_version}</p>
              <p>Input fingerprint: {ready.input_fingerprint ?? '—'}</p>
              <p>Scoring state: {ready.score_state}</p>
              {ready.configuration && (
                <p>
                  Configuration ID: {ready.configuration.rule_set_id} ·{' '}
                  {ready.configuration.rule_set_code} v{ready.configuration.version_no} ·{' '}
                  status {ready.configuration.status}
                </p>
              )}
              {score && (
                <>
                  <p>Score ID: {score.score_id}</p>
                  <p>Score fingerprint: {score.input_fingerprint ?? '—'}</p>
                  <p>Correlation ID: {score.correlation_id ?? '—'}</p>
                  <p>Contribution IDs: {contributions.length}</p>
                </>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>

      <Dialog open={recalcOpen} onOpenChange={setRecalcOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Recalculate risk score</DialogTitle>
            <DialogDescription>
              A new score is calculated from the current assessment information. The existing
              score is kept in history and marked superseded.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason (optional)</Label>
            <Textarea
              rows={3}
              value={recalcReason}
              onChange={(e) => setRecalcReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecalcOpen(false)}>Cancel</Button>
            <Button
              disabled={scoreMutation.isPending}
              onClick={() => scoreMutation.mutate('RECALCULATE_SCORE')}
            >
              {scoreMutation.isPending ? 'Recalculating…' : 'Recalculate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
