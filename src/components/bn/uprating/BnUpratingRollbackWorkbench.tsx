/**
 * BN Uprating — Rollback workbench (Epic 4).
 *
 * Controlled, compensating reversal of a FAILED run. Eligibility is decided
 * entirely by `bn_uprating_rollback_readiness_v1`; this surface offers no
 * force, override or "ignore blocker" control of any kind, and never edits an
 * award amount.
 */
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, RotateCcw, SearchCheck } from 'lucide-react';
import {
  formatMinor,
  type BnUpratingRollbackReadiness,
} from '@/types/bn/uprating/upratingRun';

export interface BnUpratingRollbackWorkbenchProps {
  readonly readiness: BnUpratingRollbackReadiness | null;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly isBusy: boolean;
  readonly onRetryLoad: () => void;
  readonly onAssessRollback: () => void;
  readonly onAuthoriseRollback: () => void;
}

const opVariant = (
  status: string | null | undefined,
): 'default' | 'secondary' | 'outline' | 'destructive' => {
  if (status === 'COMPLETED') return 'secondary';
  if (status === 'BLOCKED' || status === 'PARTIAL') return 'destructive';
  if (status === 'ASSESSED') return 'default';
  return 'outline';
};

function assessReason(r: BnUpratingRollbackReadiness | null): string {
  if (!r) return 'Rollback readiness is still loading.';
  if (r.run_status !== 'FAILED') {
    return `Rollback can only be assessed for a run that has been recorded as failed. This run is ${r.run_status}.`;
  }
  if (r.awaiting_authorisation) {
    return 'A rollback assessment is already awaiting authorisation for this run.';
  }
  return 'You do not have permission to assess rollback for this run.';
}

function authoriseReason(r: BnUpratingRollbackReadiness | null): string {
  if (!r) return 'Rollback readiness is still loading.';
  if (r.run_status !== 'FAILED') return 'Only a failed run may be rolled back.';
  if (!r.current) return 'Assess rollback eligibility before authorising a rollback.';
  if (r.current.status === 'BLOCKED') {
    return 'No applied award change is eligible to be reversed. Resolve the owning-domain blockers, then assess again.';
  }
  if (r.current.status !== 'ASSESSED') {
    return `This rollback is ${r.current.status} and no longer awaiting authorisation.`;
  }
  if (r.assessed_by_actor) {
    return 'You assessed this rollback, so an independent administrator must authorise it.';
  }
  return 'Authorising a rollback requires uprating administrator authority.';
}

export const BnUpratingRollbackWorkbench: React.FC<BnUpratingRollbackWorkbenchProps> = ({
  readiness,
  isLoading,
  isError,
  isBusy,
  onRetryLoad,
  onAssessRollback,
  onAuthoriseRollback,
}) => {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading rollback status…</p>;
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Rollback status is unavailable</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>Rollback information could not be loaded. Nothing has been assessed or reversed.</p>
          <Button size="sm" variant="outline" onClick={onRetryLoad}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const op = readiness?.current ?? null;
  const items = readiness?.items ?? [];
  const canAssess = !!readiness?.can_assess_rollback && !isBusy;
  const canAuthorise = !!readiness?.can_authorise_rollback && !isBusy;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Rollback
              {op && <Badge variant={opVariant(op.status)}>{op.status}</Badge>}
            </CardTitle>
            <CardDescription>
              Rollback reverses applied award changes by recording a compensating change. It never
              deletes history, never reverses an instalment that has already been paid, and never
              touches an award that has moved since execution.
            </CardDescription>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex flex-col gap-1">
              <Button
                size="sm"
                variant="outline"
                disabled={!canAssess}
                title={canAssess ? undefined : assessReason(readiness)}
                onClick={onAssessRollback}
              >
                <SearchCheck className="mr-2 h-4 w-4" />
                Assess rollback eligibility
              </Button>
              {!canAssess && (
                <span className="max-w-xs text-xs text-muted-foreground">
                  {assessReason(readiness)}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Button
                size="sm"
                variant="destructive"
                disabled={!canAuthorise}
                title={canAuthorise ? undefined : authoriseReason(readiness)}
                onClick={onAuthoriseRollback}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Roll back eligible changes
              </Button>
              {!canAuthorise && (
                <span className="max-w-xs text-xs text-muted-foreground">
                  {authoriseReason(readiness)}
                </span>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!op && (
            <p className="text-sm text-muted-foreground">
              No rollback has been assessed for this run.
            </p>
          )}

          {op && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">Applied changes assessed</p>
                  <p className="font-medium">{op.applied_item_count}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Eligible / not eligible</p>
                  <p className="font-medium">
                    {op.eligible_count} / {op.ineligible_count}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Reversed / could not reverse</p>
                  <p className="font-medium">
                    {op.compensated_count} / {op.failed_count}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Compensating change</p>
                  <p className="font-medium">{formatMinor(op.compensated_delta_minor)}</p>
                </div>
              </div>

              <div className="rounded-md border p-3 text-xs text-muted-foreground">
                Assessed by {op.assessed_by_name ?? '—'}
                {op.assessed_at ? ` on ${new Date(op.assessed_at).toLocaleString()}` : ''}.{' '}
                {op.authorised_by_name
                  ? `Authorised by ${op.authorised_by_name}${
                      op.authorised_at ? ` on ${new Date(op.authorised_at).toLocaleString()}` : ''
                    }.`
                  : 'Not yet authorised.'}
                {op.justification ? ` Justification: ${op.justification}` : ''}
              </div>

              {op.status === 'PARTIAL' && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Some changes could not be reversed</AlertTitle>
                  <AlertDescription>
                    The remaining awards must be corrected in the owning domain. There is no force
                    or override path here.
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rollback items</CardTitle>
          <CardDescription>
            Amounts are read-only. Ineligible items show the owning-domain blocker that must be
            resolved before eligibility can be reassessed.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Award</TableHead>
                <TableHead className="text-right">Applied amount</TableHead>
                <TableHead className="text-right">Restore to</TableHead>
                <TableHead>Eligibility</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No rollback items have been assessed.
                  </TableCell>
                </TableRow>
              )}
              {items.map((i) => (
                <TableRow key={i.rollback_item_id}>
                  <TableCell className="font-medium">{i.award_reference}</TableCell>
                  <TableCell className="text-right">{formatMinor(i.applied_amount_minor)}</TableCell>
                  <TableCell className="text-right">{formatMinor(i.restore_amount_minor)}</TableCell>
                  <TableCell>
                    <Badge variant={i.eligibility_status === 'ELIGIBLE' ? 'secondary' : 'destructive'}>
                      {i.eligibility_status}
                    </Badge>
                    {i.blocker_code && (
                      <div className="text-xs text-muted-foreground">
                        {i.blocker_label ?? i.blocker_code}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={opVariant(i.status)}>{i.status}</Badge>
                    {i.failure_code && (
                      <div className="text-xs text-muted-foreground">
                        {i.failure_reason ?? i.failure_code}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};
