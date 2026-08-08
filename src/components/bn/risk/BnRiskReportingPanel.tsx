/**
 * BN Risk — reporting panel (EPIC 6).
 *
 * Outcome, control, governance-turnaround and version-aware rule-effectiveness
 * reporting. Every figure is produced by `bn_risk_outcome_metrics_v1` and
 * `bn_risk_rule_feedback_metrics_v1`; nothing is aggregated here.
 *
 * Reporting is deliberately careful with language. A referral is not a finding
 * of fraud, error and data-quality outcomes are reported in their own right,
 * and no rule is described as effective or ineffective by a single figure —
 * the numbers are evidence for a human policy review.
 *
 * Reports are aggregate only: no claimant identity, narrative or individual
 * score explanation appears here.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { riskReportingService } from '@/services/bn/risk/riskReportingService';
import {
  BN_RISK_REPORT_PERIODS,
  type BnRiskReportPeriodCode,
} from '@/types/bn/risk/riskReporting';

export const BnRiskReportingPanel: React.FC = () => {
  const [period, setPeriod] = React.useState<BnRiskReportPeriodCode>('LAST_30_DAYS');

  const outcomes = useQuery({
    queryKey: ['bn-risk-outcome-metrics', period],
    queryFn: async () => {
      const result = await riskReportingService.outcomeMetrics({ period });
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data;
    },
  });

  const feedback = useQuery({
    queryKey: ['bn-risk-feedback-metrics', period],
    queryFn: async () => {
      const result = await riskReportingService.feedbackMetrics({ period });
      if (result.status === 'DENIED') return null;
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data;
    },
  });

  return (
    <div className="space-y-6" data-testid="bn-risk-reporting-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Risk reporting</h2>
            <p className="text-sm text-muted-foreground">
              Outcomes, controls, governance turnaround and rule effectiveness.
            </p>
          </div>
        </div>
        <Select value={period} onValueChange={(v) => setPeriod(v as BnRiskReportPeriodCode)}>
          <SelectTrigger className="w-48" data-testid="bn-risk-reporting-period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BN_RISK_REPORT_PERIODS.map((p) => (
              <SelectItem key={p.code} value={p.code}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {outcomes.isLoading && <Skeleton className="h-64 w-full" />}

      {(outcomes.isError || (!outcomes.isLoading && !outcomes.data)) && (
        <Alert variant="destructive" data-testid="bn-risk-reporting-error">
          <AlertTitle>Outcome reporting is unavailable</AlertTitle>
          <AlertDescription>
            These figures could not be read. Nothing is shown rather than showing a zero that
            would be read as "no outcomes".
          </AlertDescription>
        </Alert>
      )}

      {outcomes.data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card data-testid="bn-risk-report-outcomes">
              <CardHeader className="pb-2">
                <CardDescription>Outcomes recorded</CardDescription>
                <CardTitle className="text-2xl">{outcomes.data.totals.outcomes_recorded}</CardTitle>
              </CardHeader>
            </Card>
            <Card data-testid="bn-risk-report-closed">
              <CardHeader className="pb-2">
                <CardDescription>Assessments closed</CardDescription>
                <CardTitle className="text-2xl">{outcomes.data.totals.assessments_closed}</CardTitle>
              </CardHeader>
            </Card>
            <Card data-testid="bn-risk-report-reopened">
              <CardHeader className="pb-2">
                <CardDescription>Reopened</CardDescription>
                <CardTitle className="text-2xl">{outcomes.data.totals.assessments_reopened}</CardTitle>
              </CardHeader>
            </Card>
            <Card data-testid="bn-risk-report-referred">
              <CardHeader className="pb-2">
                <CardDescription>Referred for further action</CardDescription>
                <CardTitle className="text-2xl">{outcomes.data.totals.fraud_related}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground">
                A referral is not a finding of fraud.
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Findings</CardTitle>
                <CardDescription>
                  Error, staff error and data outcomes are reported in their own right, not as
                  fraud.
                </CardDescription>
              </CardHeader>
              <CardContent data-testid="bn-risk-report-findings">
                {outcomes.data.by_finding.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No outcomes were recorded in this period.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Finding</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Cases</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {outcomes.data.by_finding.map((f) => (
                        <TableRow key={f.key}>
                          <TableCell>{f.label}</TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {f.is_referral ? 'Referral' : f.is_error ? 'Error'
                                : f.is_data_issue ? 'Data quality' : 'Other'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{f.value}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Controls and execution</CardTitle>
                <CardDescription>
                  What was recommended, what was independently approved, and what the owning
                  domains actually applied.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm" data-testid="bn-risk-report-controls">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Recommended</span>
                  <span>{outcomes.data.controls.recommended}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Approved</span>
                  <span>{outcomes.data.controls.approved}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Rejected or returned</span>
                  <span>{outcomes.data.controls.rejected + outcomes.data.controls.returned}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Executed by the owning domain</span>
                  <span>{outcomes.data.executions.executed}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Failed or awaiting retry</span>
                  <span>{outcomes.data.executions.failed}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Average approval turnaround</span>
                  <span>{outcomes.data.maker_checker.turnaround_days} days</span>
                </div>
                <p className="pt-2 text-xs text-muted-foreground">
                  {outcomes.data.maker_checker.note}
                </p>
              </CardContent>
            </Card>
          </div>

          <Alert data-testid="bn-risk-report-interpretation">
            <AlertTitle>How to read these figures</AlertTitle>
            <AlertDescription>{outcomes.data.interpretation_note}</AlertDescription>
          </Alert>
        </>
      )}

      {feedback.isLoading && <Skeleton className="h-48 w-full" />}

      {!feedback.isLoading && !feedback.isError && feedback.data === null && (
        <Alert data-testid="bn-risk-report-feedback-denied">
          <AlertTitle>Rule effectiveness is restricted</AlertTitle>
          <AlertDescription>
            Rule effectiveness and feedback evidence are available to rule administrators only.
          </AlertDescription>
        </Alert>
      )}

      {feedback.isError && (
        <Alert variant="destructive" data-testid="bn-risk-report-feedback-error">
          <AlertTitle>Rule effectiveness is unavailable</AlertTitle>
          <AlertDescription>
            These figures could not be read, so no rule is shown. This does not mean no feedback
            has been recorded.
          </AlertDescription>
        </Alert>
      )}

      {feedback.data && (
        <Card>
          <CardHeader>
            <CardTitle>Rule effectiveness and feedback</CardTitle>
            <CardDescription>
              Version aware: each rule-set version is reported separately, so a rule that was
              changed is never averaged across its versions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Feedback recorded</p>
                <p className="text-xl font-semibold">{feedback.data.totals.feedback_recorded}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Cases reviewed</p>
                <p className="text-xl font-semibold">{feedback.data.totals.cases_reviewed}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Corrections recorded</p>
                <p className="text-xl font-semibold">{feedback.data.totals.feedback_corrected}</p>
              </div>
            </div>

            {feedback.data.rules.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="bn-risk-report-rules-empty">
                No rule was evaluated in this period.
              </p>
            ) : (
              <Table data-testid="bn-risk-report-rules">
                <TableHeader>
                  <TableRow>
                    <TableHead>Rule</TableHead>
                    <TableHead>Rule set version</TableHead>
                    <TableHead className="text-right">Matches</TableHead>
                    <TableHead className="text-right">Match rate</TableHead>
                    <TableHead className="text-right">Feedback</TableHead>
                    <TableHead className="text-right">Reported false positive</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {feedback.data.rules.map((r) => (
                    <TableRow key={`${r.rule_set_code}-${r.rule_set_version_no}-${r.rule_code}`}>
                      <TableCell>
                        <div>{r.rule_name ?? r.rule_code}</div>
                        <div className="text-xs text-muted-foreground">{r.rule_code}</div>
                      </TableCell>
                      <TableCell>
                        {r.rule_set_code} v{r.rule_set_version_no}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.matches} of {r.evaluations}
                      </TableCell>
                      <TableCell className="text-right">{r.match_rate}%</TableCell>
                      <TableCell className="text-right">{r.feedback_total}</TableCell>
                      <TableCell className="text-right">
                        {r.false_positive_feedback_rate == null
                          ? 'Not enough feedback'
                          : `${r.false_positive_feedback_rate}%`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <Alert data-testid="bn-risk-report-governance">
              <AlertTitle>Feedback does not change scoring</AlertTitle>
              <AlertDescription>{feedback.data.governance_note}</AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
