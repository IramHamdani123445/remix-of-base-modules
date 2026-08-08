/**
 * BN Risk — approved control execution section (EPIC 4).
 *
 * Drives entirely from `bn_risk_control_execution_readiness_v1`. Risk decides
 * that an approved control should be executed; the owning domain executes its
 * own business action through the governed handoff; Risk records the returned
 * reference and status. Nothing here writes a payment, award, claim, person,
 * overpayment, legal or investigation record, and a requested execution is
 * never presented as a completed one.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlayCircle, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatAuditDate } from '@/lib/dateFormat';
import { riskControlExecutionService } from '@/services/bn/risk/riskControlExecutionService';
import {
  executionStatusLabel,
  paymentHoldStatusLabel,
  type BnRiskControlExecutionReadiness,
} from '@/types/bn/risk/riskControlExecution';
import { BnRiskControlExecutionDialog } from './BnRiskControlExecutionDialog';

interface Props {
  assessmentId: string;
  onChanged: () => void;
}

export const BnRiskControlExecutionSection: React.FC<Props> = ({ assessmentId, onChanged }) => {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = React.useState<'EXECUTE' | 'RETRY' | null>(null);
  const [refreshError, setRefreshError] = React.useState<string | null>(null);

  const readiness = useQuery({
    queryKey: ['bn-risk-control-execution-readiness', assessmentId],
    queryFn: async () => {
      const result = await riskControlExecutionService.executionReadiness(assessmentId);
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data;
    },
  });

  const refresh = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['bn-risk-control-execution-readiness', assessmentId] });
    queryClient.invalidateQueries({ queryKey: ['bn-risk-control-execution-queue'] });
    onChanged();
  }, [assessmentId, onChanged, queryClient]);

  const refreshStatus = useMutation({
    mutationFn: async () => {
      const result = await riskControlExecutionService.refreshExecution({ assessmentId });
      if (result.status === 'FAILED') {
        throw new Error(result.errorMessage ?? 'The execution status could not be refreshed.');
      }
      return result;
    },
    onSuccess: refresh,
    onError: (e: Error) => setRefreshError(e.message),
  });

  if (readiness.isLoading) return <Skeleton className="h-40 w-full" />;

  if (readiness.isError || !readiness.data) {
    return (
      <Card data-testid="bn-risk-execution-section" data-state="FAILED_TO_LOAD">
        <CardHeader><CardTitle>Control execution</CardTitle></CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTitle>Execution readiness is unavailable</AlertTitle>
            <AlertDescription>
              No control can be executed until this can be checked again. Nothing has changed.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const data: BnRiskControlExecutionReadiness = readiness.data;
  const approval = data.approval;
  const target = data.target;
  const current = data.current_execution;
  const isPaymentHold = approval?.control_code === 'TEMPORARY_PAYMENT_HOLD';
  const statusLabel = isPaymentHold
    ? paymentHoldStatusLabel(data.execution_status)
    : executionStatusLabel(data.execution_status);

  return (
    <Card data-testid="bn-risk-execution-section" data-state={data.state}>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <PlayCircle className="h-4 w-4" /> Control execution
          </CardTitle>
          <CardDescription>
            The owning domain performs the approved business action. Risk records the reference
            and status it returns.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.available_action === 'EXECUTE' && (
            <Button size="sm" onClick={() => setDialog('EXECUTE')}>
              Execute approved control
            </Button>
          )}
          {data.available_action === 'RETRY' && (
            <Button size="sm" onClick={() => setDialog('RETRY')}>Retry execution</Button>
          )}
          {data.available_action === 'REFRESH' && (
            <Button
              size="sm"
              variant="outline"
              disabled={refreshStatus.isPending}
              onClick={() => { setRefreshError(null); refreshStatus.mutate(); }}
            >
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              {refreshStatus.isPending ? 'Refreshing…' : 'Refresh status'}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {data.state === 'NO_APPROVED_CONTROL' && (
          <p className="text-sm text-muted-foreground">
            There is no independently approved control to execute.
          </p>
        )}

        {data.state === 'CONTROL_EXECUTION_BLOCKED' && (
          <Alert variant="destructive" data-testid="bn-risk-execution-blocked">
            <AlertTitle>Control execution blocked</AlertTitle>
            <AlertDescription>
              {target?.missing_capability
                ?? 'No governed execution boundary exists for this control.'}
              {' '}The approval stands; the control cannot be executed until the owning domain
              publishes a governed capability.
            </AlertDescription>
          </Alert>
        )}

        {refreshError && (
          <Alert variant="destructive"><AlertDescription>{refreshError}</AlertDescription></Alert>
        )}

        {data.warnings.map((w) => (
          <Alert key={w}><AlertDescription>{w}</AlertDescription></Alert>
        ))}

        {data.blockers.length > 0 && data.state !== 'CONTROL_EXECUTION_BLOCKED'
          && data.state !== 'NO_APPROVED_CONTROL' && (
          <Alert variant="destructive">
            <AlertTitle>This control cannot be executed right now</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">{data.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            </AlertDescription>
          </Alert>
        )}

        {approval && (
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground">Approved control</p>
              <p data-testid="bn-risk-execution-control">
                {approval.control_label}
                {approval.is_benefit_affecting && (
                  <Badge className="ml-2" variant="destructive">Benefit affecting</Badge>
                )}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Execution owner</p>
              <p data-testid="bn-risk-execution-owner">{target?.execution_owner ?? '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Target</p>
              <p>{approval.target_reference ?? approval.target_type ?? 'Not applicable'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Approval provenance</p>
              <p>
                {approval.recommendation_reference} · approved by{' '}
                {approval.approved_by_name ?? '—'}
                {approval.approved_at ? ` on ${formatAuditDate(approval.approved_at, false)}` : ''}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Execution status</p>
              <p data-testid="bn-risk-execution-status">{statusLabel}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Target reference</p>
              <p data-testid="bn-risk-execution-target-reference">
                {current?.target_business_reference ?? 'Not yet returned'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Last activity</p>
              <p>
                {current
                  ? formatAuditDate(
                    current.completed_at ?? current.failed_at ?? current.accepted_at
                      ?? current.requested_at, false)
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Next action</p>
              <p data-testid="bn-risk-execution-next-action">
                {data.available_action === 'EXECUTE' ? 'Execute the approved control'
                  : data.available_action === 'RETRY' ? 'Retry the failed execution'
                    : data.available_action === 'REFRESH' ? 'Await the owning domain, then refresh'
                      : 'No execution action is available'}
              </p>
            </div>
          </div>
        )}

        {data.attempts.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <Table data-testid="bn-risk-execution-attempts">
              <TableHeader>
                <TableRow>
                  <TableHead>Attempt</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Owning domain</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Target reference</TableHead>
                  <TableHead>Failure</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.attempts.map((a) => (
                  <TableRow key={a.execution_id}>
                    <TableCell>Attempt {a.attempt_no}</TableCell>
                    <TableCell>
                      {formatAuditDate(a.requested_at, false)} · {a.requested_by_name ?? '—'}
                    </TableCell>
                    <TableCell>{a.target_module ?? '—'}</TableCell>
                    <TableCell>{executionStatusLabel(a.status)}</TableCell>
                    <TableCell>{a.target_business_reference ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {a.failure_summary ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {data.history.length > 0 && (
          <div className="space-y-2" data-testid="bn-risk-execution-history">
            {data.history.map((h, i) => (
              <div key={`${h.event_code}-${i}`} className="rounded-md border p-2 text-sm">
                <div className="flex items-center justify-between">
                  <span>{h.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatAuditDate(h.occurred_at, false)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {h.actor_name ?? 'System'}
                  {h.attempt_no ? ` · attempt ${h.attempt_no}` : ''}
                </p>
              </div>
            ))}
          </div>
        )}

        {data.restricted_detail_visible && current && (
          <Collapsible>
            <CollapsibleTrigger className="text-xs text-muted-foreground underline">
              Technical details
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              <p>Execution ID: {current.execution_id}</p>
              <p>Recommendation ID: {current.recommendation_id}</p>
              <p>Approval ID: {current.decision_id ?? '—'}</p>
              <p>Target module: {current.target_module ?? '—'}</p>
              <p>Target internal ID: {current.target_internal_reference ?? '—'}</p>
              <p>Target correlation ID: {current.target_correlation_reference ?? '—'}</p>
              <p>Attempt number: {current.attempt_no}</p>
              <p>Raw failure code: {current.failure_code ?? '—'}</p>
              <p>Idempotency reference: {current.execution_reference}</p>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>

      {dialog && (
        <BnRiskControlExecutionDialog
          open={dialog !== null}
          onOpenChange={(o) => !o && setDialog(null)}
          assessmentId={assessmentId}
          mode={dialog}
          readiness={data}
          onCompleted={refresh}
        />
      )}
    </Card>
  );
};
