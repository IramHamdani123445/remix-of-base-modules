/**
 * BN Means-Test — EPIC 9 calculation and explanation surface.
 *
 * Everything shown here is produced by the governed backend engine:
 * readiness, the arithmetic, the treatment of each declared fact and the
 * outcome. React never recomputes means, thresholds or eligibility, and a
 * failed read is never presented as "nothing to do".
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AlertTriangle, Calculator, History, RefreshCw, ShieldAlert } from 'lucide-react';
import { formatWithCurrency } from '@/utils/formatCurrency';
import { meansQueryService } from '@/services/bn/meansTests/meansQueryService';
import {
  meansCommandService,
  type BnMeansCommandResult,
} from '@/services/bn/meansTests/meansCommandService';
import type { BnMeansAvailableAction } from '@/services/bn/meansTests/meansQueryService';
import {
  BN_MEANS_TREATMENT_LABEL,
  calculationOutcomeLabel,
  calculationStalenessNotice,
  groupCalculationLines,
  meansCalcBlockerText,
  toAmount,
  type BnMeansCalculationLine,
  type BnMeansCalculationWorkspace,
} from '@/types/bn/meansTests/meansCalculation';
import { BN_MEANS_REASON_LABEL } from '@/types/bn/meansTests/meansAdjustments';

export interface BnMeansCalculationSectionProps {
  readonly assessmentId: string;
  readonly currency: string;
  readonly rowVersion: number;
  readonly calculateAction: BnMeansAvailableAction | undefined;
}

const money = (value: unknown, currency: string) => {
  const amount = toAmount(value as number | string | null);
  return amount === null ? '—' : formatWithCurrency(amount, currency);
};

const treatmentVariant = (code: string | null | undefined) =>
  code === 'EXCLUDED_REJECTED' || code === 'NOT_ALLOWED' || code === 'FAIL'
    ? ('destructive' as const)
    : code === 'DISREGARD_APPLIED' || code === 'EXCLUDED_NOT_APPLICABLE'
      ? ('secondary' as const)
      : ('outline' as const);

export const BnMeansCalculationSection: React.FC<BnMeansCalculationSectionProps> = ({
  assessmentId,
  currency,
  rowVersion,
  calculateAction,
}) => {
  const queryClient = useQueryClient();
  const [commandError, setCommandError] = React.useState<BnMeansCommandResult | null>(null);

  const workspace = useQuery({
    queryKey: ['bn-means-calculation-workspace', assessmentId],
    queryFn: () => meansQueryService.calculationWorkspace(assessmentId),
  });

  const run = useMutation({
    mutationFn: (reasonCode: string) =>
      meansCommandService.execute({
        command: 'BN_MEANS_CALCULATE',
        assessmentId,
        expectedRowVersion: rowVersion,
        reasonCode,
      }),
    onSuccess: (result) => {
      setCommandError(result.status === 'FAILED' ? result : null);
      if (result.status !== 'FAILED') {
        queryClient.invalidateQueries({ queryKey: ['bn-means-calculation-workspace', assessmentId] });
        queryClient.invalidateQueries({ queryKey: ['bn-means-detail', assessmentId] });
        queryClient.invalidateQueries({ queryKey: ['bn-means-actions', assessmentId] });
        queryClient.invalidateQueries({ queryKey: ['bn-means-readiness', assessmentId] });
      }
    },
  });

  if (workspace.isLoading) {
    return <Skeleton className="h-64 w-full" data-testid="means-calculation-loading" />;
  }

  const envelope = workspace.data;
  const loadFailure = workspace.isError
    ? 'The calculation could not be loaded. Treat it as unknown, not as unavailable work.'
    : envelope && envelope.status !== 'OK'
      ? envelope.status === 'DENIED'
        ? 'You do not have permission to view the calculation for this assessment.'
        : `The calculation could not be loaded (${envelope.detail ?? envelope.code ?? 'unknown error'}).`
      : null;

  if (loadFailure) {
    return (
      <Alert variant="destructive" data-testid="means-calculation-unavailable">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Calculation unavailable</AlertTitle>
        <AlertDescription>{loadFailure}</AlertDescription>
      </Alert>
    );
  }

  const data = (envelope?.data ?? null) as BnMeansCalculationWorkspace | null;
  const readiness = data?.readiness ?? null;
  const calculation = data?.calculation ?? null;
  const lines = (data?.lines ?? []) as readonly BnMeansCalculationLine[];
  const history = data?.history ?? [];
  const groups = groupCalculationLines(lines);
  const stale = calculationStalenessNotice(readiness);
  const warnings = (calculation?.warnings ?? []) as readonly Record<string, unknown>[];

  const denialReason = calculateAction?.allowed
    ? null
    : BN_MEANS_REASON_LABEL[calculateAction?.reason ?? ''] ??
      calculateAction?.reason ??
      'Calculation is not currently available.';
  const canCalculate =
    Boolean(calculateAction?.allowed) &&
    Boolean(readiness?.ready_for_calculation) &&
    !run.isPending;

  return (
    <div className="space-y-4" data-testid="means-calculation-section">
      {commandError && (
        <Alert variant="destructive" data-testid="means-calculation-error">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Calculation was refused</AlertTitle>
          <AlertDescription className="text-sm">
            {commandError.errorDetail || commandError.errorCode}
          </AlertDescription>
        </Alert>
      )}

      {stale && (
        <Alert data-testid="means-calculation-stale">
          <RefreshCw className="h-4 w-4" />
          <AlertTitle>This calculation is out of date</AlertTitle>
          <AlertDescription>{stale}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-4 w-4" /> Calculation
          </CardTitle>
          <CardDescription>
            Verification must be complete before the assessed means can be calculated. The
            calculation records an outcome only; the decision remains with the independent approver.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={readiness?.ready_for_calculation ? 'default' : 'secondary'}>
              {readiness?.ready_for_calculation ? 'Ready to calculate' : 'Not ready'}
            </Badge>
            {calculation && (
              <Badge variant={calculation.result === 'FAIL' ? 'destructive' : 'outline'}>
                {calculationOutcomeLabel(calculation.result)}
              </Badge>
            )}
            {calculation && (
              <span className="text-xs text-muted-foreground">
                Calculation {calculation.sequence_no} of {history.length}
              </span>
            )}
          </div>

          {!readiness?.ready_for_calculation && (
            <ul
              className="list-disc space-y-1 pl-5 text-sm text-muted-foreground"
              data-testid="means-calculation-blockers"
            >
              {(readiness?.blockers ?? []).map((b, i) => (
                <li key={`${b.code}-${i}`}>{meansCalcBlockerText(b)}</li>
              ))}
              {(readiness?.blockers ?? []).length === 0 && (
                <li>Calculation readiness has not been established for this assessment.</li>
              )}
            </ul>
          )}

          {(readiness?.currency_issues ?? []).length > 0 && (
            <p className="text-sm text-destructive" data-testid="means-calculation-currency">
              {(readiness?.currency_issues ?? []).length} item(s) are recorded in a different
              currency to the assessment and must be corrected before calculation.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              disabled={!canCalculate}
              onClick={() => run.mutate(calculation ? 'RECALCULATION' : 'INITIAL')}
              data-testid="means-calculate"
            >
              {calculation ? 'Recalculate' : 'Calculate'}
            </Button>
            {!canCalculate && (
              <span className="text-xs text-muted-foreground" data-testid="means-calculate-reason">
                {denialReason ?? 'Calculation is blocked until the items above are resolved.'}
              </span>
            )}
            {calculation && (
              <span className="text-xs text-muted-foreground">
                Recalculating supersedes this calculation; the earlier one is retained.
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {calculation && (
        <Card>
          <CardHeader>
            <CardTitle>Assessed means</CardTitle>
            <CardDescription>
              Figures are annual, in {calculation.currency_code ?? currency}, produced by engine{' '}
              {calculation.engine_version ?? '—'}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-3 sm:grid-cols-3" data-testid="means-calculation-summary">
              {[
                ['Gross income', money(calculation.gross_income, currency)],
                ['Income disregard', money(calculation.income_disregard_total, currency)],
                ['Allowed deductions', money(calculation.approved_deductions, currency)],
                ['Assessed means', money(calculation.assessable_income, currency)],
                ['Applicable threshold', money(calculation.threshold_amount, currency)],
                [
                  calculation.result === 'FAIL' ? 'Amount above threshold' : 'Amount below threshold',
                  money(
                    calculation.result === 'FAIL'
                      ? calculation.excess_amount
                      : calculation.shortfall_amount,
                    currency,
                  ),
                ],
                ['Assessed assets', money(calculation.assessable_assets, currency)],
                ['Asset limit', money(calculation.asset_threshold_amount, currency)],
                ['Household counted', String(calculation.household_size ?? '—')],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
                  <dd className="text-sm font-medium">{value}</dd>
                </div>
              ))}
            </dl>

            {warnings.length > 0 && (
              <Alert data-testid="means-calculation-warnings">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Points to note</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-5 text-sm">
                    {warnings.map((w, i) => (
                      <li key={i}>{String(w.message ?? w.code ?? '')}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <p className="text-xs text-muted-foreground break-all">
              Calculated {calculation.calculated_at ?? '—'} · input fingerprint{' '}
              {calculation.input_hash ?? '—'}
            </p>
          </CardContent>
        </Card>
      )}

      {calculation && (
        <Card>
          <CardHeader>
            <CardTitle>How this was worked out</CardTitle>
            <CardDescription>
              Every declared item and how policy treated it. This explanation is the record shown to
              the approver and, where required, to the claimant.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6" data-testid="means-calculation-explanation">
            {groups.map((group) => (
              <div key={group.code} className="space-y-2">
                <h3 className="text-sm font-semibold">{group.label}</h3>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead>Treatment</TableHead>
                        <TableHead className="text-right">Claimed</TableHead>
                        <TableHead className="text-right">Disregarded</TableHead>
                        <TableHead className="text-right">Counted</TableHead>
                        <TableHead>Why</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.lines.map((line) => (
                        <TableRow key={line.line_id ?? `${group.code}-${line.line_no}`}>
                          <TableCell className="text-sm">
                            {line.business_label ?? line.category_code ?? line.narrative ?? '—'}
                            {line.member_label && (
                              <span className="block text-xs text-muted-foreground">
                                {line.member_label}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={treatmentVariant(line.treatment_code)}>
                              {BN_MEANS_TREATMENT_LABEL[String(line.treatment_code ?? '')] ??
                                line.treatment_code ??
                                '—'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {money(line.claimed_amount, currency)}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {money(line.disregard_amount, currency)}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {money(line.applied_amount, currency)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {line.explanation ?? line.exclusion_reason ?? '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-4 w-4" /> Calculation history
            </CardTitle>
            <CardDescription>
              Calculations are never edited. Each recalculation supersedes the previous one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table data-testid="means-calculation-history">
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead className="text-right">Assessed means</TableHead>
                  <TableHead className="text-right">Threshold</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Produced</TableHead>
                  <TableHead>State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((h) => (
                  <TableRow key={h.calculation_id}>
                    <TableCell>{h.sequence_no}</TableCell>
                    <TableCell>{h.result ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      {money(h.assessable_income, currency)}
                    </TableCell>
                    <TableCell className="text-right">
                      {money(h.threshold_amount, currency)}
                    </TableCell>
                    <TableCell className="text-xs">{h.trigger_reason ?? '—'}</TableCell>
                    <TableCell className="text-xs">{h.calculated_at ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={h.is_current ? 'default' : 'secondary'}>
                        {h.is_current ? 'Current' : 'Superseded'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default BnMeansCalculationSection;
