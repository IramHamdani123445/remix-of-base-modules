/**
 * BN Uprating — Closure section (Epic 5).
 *
 * Read-only closure surface. It renders the backend's own closure decision
 * (`bn_uprating_close_readiness_v1`) and, once a run is closed, the retained
 * closure evidence. Nothing here recalculates, mutates or deletes anything,
 * and the section fails closed when the readiness source cannot be read.
 */
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, CheckCircle2, Lock, RefreshCw, ShieldAlert } from 'lucide-react';
import type { BnUpratingCloseReadiness } from '@/types/bn/uprating/upratingRun';
import { BnBusyButton } from '@/components/bn/shared';

export interface BnUpratingClosureSectionProps {
  readonly readiness: BnUpratingCloseReadiness | null;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly isBusy: boolean;
  readonly onRetryLoad: () => void;
  readonly onCloseRun: () => void;
}

const Line: React.FC<{ readonly label: string; readonly value: React.ReactNode }> = ({
  label,
  value,
}) => (
  <div className="flex items-center justify-between gap-4 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-medium">{value}</span>
  </div>
);

export const BnUpratingClosureSection: React.FC<BnUpratingClosureSectionProps> = ({
  readiness,
  isLoading,
  isError,
  isBusy,
  onRetryLoad,
  onCloseRun,
}) => {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Closure</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-9 w-40" />
        </CardContent>
      </Card>
    );
  }

  // Fail closed — an unreadable source never yields a closable run.
  if (isError || !readiness) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Closure</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Closure readiness is unavailable</AlertTitle>
            <AlertDescription>
              Closure is not offered while this information cannot be read. Try again, and contact
              support if the problem continues.
            </AlertDescription>
          </Alert>
          <Button variant="outline" onClick={onRetryLoad}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const isClosed = readiness.run_status === 'CLOSED';
  const blockers = readiness.blocking_reasons ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Closure
          {isClosed && (
            <Badge variant="secondary" className="gap-1">
              <Lock className="h-3 w-3" />
              Closed
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Closing records that this uprating run is operationally complete. It changes no award, no
          payment schedule and no claimant notice, and it removes nothing from the record. A closed
          run stays fully viewable for audit and cannot be reopened.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1 rounded-md border p-3">
          <Line
            label="Current state"
            value={<Badge variant="outline">{readiness.run_status ?? 'Unknown'}</Badge>}
          />
          <Line
            label="Completion path"
            value={
              readiness.completion_path === 'ROLLED_BACK'
                ? 'Rolled back'
                : readiness.completion_path === 'RECONCILED'
                  ? 'Reconciled'
                  : 'Not determined'
            }
          />
          <Line
            label="Open operational items"
            value={String(readiness.open_operational_items ?? 0)}
          />
          {isClosed && (
            <>
              <Line
                label="Closed on"
                value={
                  readiness.closed_at ? new Date(readiness.closed_at).toLocaleString() : 'Recorded'
                }
              />
              <Line label="Closed by" value={readiness.closed_by_name ?? 'Recorded'} />
            </>
          )}
        </div>

        {isClosed ? (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>This run is closed</AlertTitle>
            <AlertDescription>
              No further uprating action is available. Policy, population, simulation, approval,
              execution, reconciliation, rollback and communication evidence are all retained.
            </AlertDescription>
          </Alert>
        ) : blockers.length > 0 ? (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Outstanding before closure</AlertTitle>
            <AlertDescription>
              <ul className="ml-4 list-disc space-y-1">
                {blockers.map((b) => (
                  <li key={b.code}>{b.message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <Lock className="h-4 w-4" />
            <AlertTitle>Ready to close</AlertTitle>
            <AlertDescription>
              Every operational consequence of this run is accounted for. Closure is final.
            </AlertDescription>
          </Alert>
        )}

        {!isClosed && (
          <BnBusyButton loading={isBusy} onClick={onCloseRun} disabled={!readiness.can_close || isBusy}>
            <Lock className="mr-2 h-4 w-4" />
            {readiness.completion_path === 'ROLLED_BACK'
              ? 'Close rolled-back run'
              : 'Close reconciled run'}
          </BnBusyButton>
        )}
      </CardContent>
    </Card>
  );
};
