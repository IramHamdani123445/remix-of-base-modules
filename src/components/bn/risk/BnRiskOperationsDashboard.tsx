/**
 * BN Risk — operational management dashboard (EPIC 6).
 *
 * One place to see where Risk work actually is. Every card, funnel stage and
 * ageing figure comes from `bn_risk_operational_metrics_v1`; nothing is
 * counted, aggregated or aged in the browser, and a failed read is shown as a
 * failure rather than as a queue of zero.
 *
 * Every card is a deep link into the queue that owns the work, so an operator
 * never has to guess where to act.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
  type BnRiskOperationsQueueKey,
  type BnRiskReportPeriodCode,
} from '@/types/bn/risk/riskReporting';

interface Props {
  /** Deep link into the queue that owns the outstanding work. */
  onOpenQueue: (queue: BnRiskOperationsQueueKey) => void;
}

export const BnRiskOperationsDashboard: React.FC<Props> = ({ onOpenQueue }) => {
  const [period, setPeriod] = React.useState<BnRiskReportPeriodCode>('LAST_30_DAYS');

  const metrics = useQuery({
    queryKey: ['bn-risk-operational-metrics', period],
    queryFn: async () => {
      const result = await riskReportingService.operationalMetrics({ period });
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data;
    },
  });

  if (metrics.isLoading) return <Skeleton className="h-72 w-full" />;

  if (metrics.isError || !metrics.data) {
    return (
      <Alert variant="destructive" data-testid="bn-risk-operations-error">
        <AlertTitle>The operational position is unavailable</AlertTitle>
        <AlertDescription>
          These figures could not be read, so no queue count is shown. An empty dashboard here
          would not mean there is no work outstanding.
        </AlertDescription>
      </Alert>
    );
  }

  const data = metrics.data;

  return (
    <div className="space-y-6" data-testid="bn-risk-operations-dashboard">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Operational position</h2>
            <p className="text-sm text-muted-foreground">
              Where Risk work is right now, and what is waiting on a decision.
            </p>
          </div>
        </div>
        <Select value={period} onValueChange={(v) => setPeriod(v as BnRiskReportPeriodCode)}>
          <SelectTrigger className="w-48" data-testid="bn-risk-operations-period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BN_RISK_REPORT_PERIODS.map((p) => (
              <SelectItem key={p.code} value={p.code}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.cards.map((card) => (
          <Card key={card.key} data-testid={`bn-risk-ops-card-${card.key}`}>
            <CardHeader className="pb-2">
              <CardDescription>{card.label}</CardDescription>
              <CardTitle className="text-2xl">{card.value}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Button
                size="sm"
                variant="link"
                className="h-auto p-0"
                data-testid={`bn-risk-ops-open-${card.key}`}
                onClick={() => onOpenQueue(card.queue_key)}
              >
                Open the queue
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lifecycle funnel</CardTitle>
          <CardDescription>
            Signals through to closure for {data.period.label.toLowerCase()}. A stage count is a
            volume, not a performance judgement.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table data-testid="bn-risk-ops-funnel">
            <TableHeader>
              <TableRow><TableHead>Stage</TableHead><TableHead className="text-right">Cases</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {data.funnel.map((s) => (
                <TableRow key={s.stage}>
                  <TableCell>{s.label}</TableCell>
                  <TableCell className="text-right">{s.value}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Signal mix</CardTitle>
            <CardDescription>
              {data.signals.generated} generated, {data.signals.manual} recorded by an officer,
              {' '}{data.signals.triaged} triaged, {data.signals.dismissed} dismissed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div data-testid="bn-risk-ops-signal-source">
              <p className="font-medium">By source</p>
              {data.signals.by_source.length === 0
                ? <p className="text-muted-foreground">No signals in this period.</p>
                : data.signals.by_source.map((s) => (
                  <div key={s.key} className="flex justify-between">
                    <span className="text-muted-foreground">{s.label}</span><span>{s.value}</span>
                  </div>
                ))}
            </div>
            <div data-testid="bn-risk-ops-signal-category">
              <p className="font-medium">By category</p>
              {data.signals.by_category.length === 0
                ? <p className="text-muted-foreground">No signals in this period.</p>
                : data.signals.by_category.map((s) => (
                  <div key={s.key} className="flex justify-between">
                    <span className="text-muted-foreground">{s.label}</span><span>{s.value}</span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ageing</CardTitle>
            <CardDescription>{data.ageing.definition}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm" data-testid="bn-risk-ops-ageing">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Signals awaiting triage</span>
              <span>{data.ageing.signal_age_days} days</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Open assessments</span>
              <span>{data.ageing.assessment_age_days} days</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Awaiting information</span>
              <span>{data.ageing.awaiting_information_days} days</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Awaiting independent approval</span>
              <span>{data.ageing.awaiting_approval_days} days</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Control execution in progress</span>
              <span>{data.ageing.execution_age_days} days</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Completed, awaiting closure</span>
              <span>{data.ageing.closure_age_days} days</span>
            </div>
            {!data.ageing.sla_configured && (
              <Alert data-testid="bn-risk-ops-sla-note">
                <AlertTitle>No service-level policy is configured</AlertTitle>
                <AlertDescription>{data.ageing.sla_note}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>

      <Alert data-testid="bn-risk-ops-privacy">
        <AlertTitle>Aggregate figures only</AlertTitle>
        <AlertDescription>{data.privacy_note}</AlertDescription>
      </Alert>
    </div>
  );
};
