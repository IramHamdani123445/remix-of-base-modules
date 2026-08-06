/**
 * BN Means-Test MT6 — deterministic calculation panel.
 *
 * Readiness and arithmetic are owned by the governed backend. This panel
 * only renders the backend's readiness verdict, offers the CALCULATE
 * command when the canonical availability query allows it, and displays
 * the immutable calculation trace.
 */
import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, Calculator } from 'lucide-react';
import { formatWithCurrency } from '@/utils/formatCurrency';
import type { BnMeansCalculationReadiness } from '@/services/bn/meansTests/meansQueryService';

export interface BnMeansCalculationPanelProps {
  readonly readiness: BnMeansCalculationReadiness | null;
  readonly readinessUnavailable: string | null;
  readonly calculation: Record<string, unknown> | null;
  readonly currency: string;
  readonly canCalculate: boolean;
  readonly calculateReason: string | null;
  readonly busy: boolean;
  readonly onCalculate: () => void;
}

const blockList = (
  title: string,
  items: readonly { fact_kind: string; fact_id: string }[] | undefined,
) =>
  items && items.length > 0 ? (
    <li>
      {title}: {items.map((i) => `${i.fact_kind} ${i.fact_id}`).join(', ')}
    </li>
  ) : null;

export const BnMeansCalculationPanel: React.FC<BnMeansCalculationPanelProps> = ({
  readiness,
  readinessUnavailable,
  calculation,
  currency,
  canCalculate,
  calculateReason,
  busy,
  onCalculate,
}) => {
  const money = (v: unknown) =>
    v === null || v === undefined ? '—' : formatWithCurrency(Number(v), currency);
  const lines = Array.isArray(calculation?.lines)
    ? (calculation?.lines as Record<string, unknown>[])
    : [];

  return (
    <div className="space-y-4" data-testid="means-calculation-panel">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-4 w-4" /> Calculation readiness
          </CardTitle>
          <CardDescription>
            Readiness is decided by the governed backend. Calculation is refused while any blocker stands.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {readinessUnavailable ? (
            <Alert data-testid="means-readiness-unavailable">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Readiness unknown</AlertTitle>
              <AlertDescription className="text-xs">{readinessUnavailable}</AlertDescription>
            </Alert>
          ) : readiness ? (
            <>
              <Badge variant={readiness.ready_for_calculation ? 'default' : 'secondary'}>
                {readiness.ready_for_calculation ? 'Ready for calculation' : 'Blocked'}
              </Badge>
              {!readiness.ready_for_calculation && (
                <ul className="list-disc pl-5 text-sm text-muted-foreground" data-testid="means-readiness-blockers">
                  {blockList('Awaiting verification', readiness.missing_verifications)}
                  {blockList('Rejected facts', readiness.rejected_facts)}
                  {blockList('Clarification outstanding', readiness.clarification_required)}
                  {(readiness.policy_configuration_issues ?? []).length > 0 && (
                    <li>Policy configuration issues: {readiness.policy_configuration_issues.length}</li>
                  )}
                  {(readiness.currency_issues ?? []).length > 0 && (
                    <li>Currency mismatches: {readiness.currency_issues.length}</li>
                  )}
                  {(readiness.reason_codes ?? []).map((code) => (
                    <li key={code}>{code}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Readiness has not been evaluated for this assessment.</p>
          )}
          <div className="flex items-center gap-3">
            <Button size="sm" disabled={!canCalculate || busy} onClick={onCalculate} data-testid="means-calculate">
              Calculate
            </Button>
            {!canCalculate && calculateReason && (
              <span className="text-xs text-muted-foreground">{calculateReason}</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Calculation trace</CardTitle>
          <CardDescription>
            Calculations are immutable. A new calculation supersedes rather than edits the previous one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!calculation ? (
            <p className="text-sm text-muted-foreground">No calculation has been produced yet.</p>
          ) : (
            <div className="space-y-3" data-testid="means-calculation-trace">
              <dl className="grid gap-2 sm:grid-cols-3">
                {[
                  ['Result', String(calculation.result ?? '—')],
                  ['Assessed means', money(calculation.assessed_means_amount)],
                  ['Threshold', money(calculation.threshold_amount)],
                  ['Calculated at', String(calculation.calculated_at ?? '—')],
                  ['Policy version', String(calculation.policy_version_id ?? '—')],
                  ['Input hash', String(calculation.input_hash ?? '—')],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
                    <dd className="text-sm break-all">{value}</dd>
                  </div>
                ))}
              </dl>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sequence</TableHead>
                    <TableHead>Line</TableHead>
                    <TableHead>Rule</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Explanation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line, idx) => (
                    <TableRow key={String(line.line_id ?? idx)}>
                      <TableCell>{String(line.sequence_no ?? idx + 1)}</TableCell>
                      <TableCell>{String(line.line_type ?? line.line_code ?? '—')}</TableCell>
                      <TableCell>{String(line.rule_code ?? '—')}</TableCell>
                      <TableCell>{money(line.amount)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {String(line.explanation ?? '—')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default BnMeansCalculationPanel;
