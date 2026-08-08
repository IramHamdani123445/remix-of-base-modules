/**
 * BN Uprating — Run approval section (Epic 2).
 *
 * Shows the backend-computed approval readiness, the immutable submitted
 * package, and the full approval-cycle history. All availability comes from
 * `bn_uprating_run_actions_v1`; this component decides nothing locally.
 */
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import {
  formatMinor,
  type BnUpratingRunAction,
  type BnUpratingRunApprovalView,
} from '@/types/bn/uprating/upratingRun';

interface Props {
  readonly view: BnUpratingRunApprovalView | null;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly onRetry: () => void;
  readonly submitAction?: BnUpratingRunAction;
  readonly decideAction?: BnUpratingRunAction;
  readonly onSubmitForApproval: () => void;
  readonly onRecordDecision: () => void;
}

export const BnUpratingRunApprovalSection: React.FC<Props> = ({
  view,
  isLoading,
  isError,
  onRetry,
  submitAction,
  decideAction,
  onSubmitForApproval,
  onRecordDecision,
}) => {
  if (isError) {
    return (
      <Alert variant="destructive">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Approval information could not be loaded</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>This section could not be loaded. The rest of the run is unaffected.</p>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (isLoading || !view) {
    return <p className="text-sm text-muted-foreground">Loading approval…</p>;
  }

  const readiness = view.approval_readiness;
  const pkg = view.current_package;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Approval</CardTitle>
            <CardDescription>
              A run is submitted as an immutable package and decided by an independent officer.
              Approval authorises later execution only — no award or payment changes.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {submitAction && (
              <Button
                size="sm"
                disabled={!submitAction.available}
                title={submitAction.reason ?? undefined}
                onClick={onSubmitForApproval}
              >
                {submitAction.label}
              </Button>
            )}
            {decideAction && (
              <Button
                size="sm"
                variant="default"
                disabled={!decideAction.available}
                title={decideAction.reason ?? undefined}
                onClick={onRecordDecision}
              >
                {decideAction.label}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {readiness.blockers.length > 0 && view.status !== 'APPROVED' && (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Not ready for approval</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5">
                  {readiness.blockers.map((b) => (
                    <li key={b.code}>{b.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          {readiness.warnings.length > 0 && (
            <Alert>
              <AlertTitle>Please note</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5">
                  {readiness.warnings.map((w) => (
                    <li key={w.code}>{w.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          {readiness.can_submit && (
            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertTitle>Ready for approval</AlertTitle>
              <AlertDescription>
                Snapshot v{readiness.current_snapshot_version} and simulation v
                {readiness.current_simulation_version} will be frozen into the approval package.
              </AlertDescription>
            </Alert>
          )}

          {pkg && (
            <>
              <Separator />
              <div>
                <p className="mb-2 text-sm font-medium">
                  Submitted package — cycle #{pkg.cycle_no}{' '}
                  <Badge variant={pkg.status === 'APPROVED' ? 'secondary' : 'outline'}>{pkg.status}</Badge>
                </p>
                <div className="grid gap-3 sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Snapshot / simulation</p>
                    <p className="font-medium">
                      v{pkg.snapshot_version} / v{pkg.simulation_version}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Awards included / excluded</p>
                    <p className="font-medium">
                      {pkg.included_count} / {pkg.excluded_count}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Simulated change</p>
                    <p className="font-medium">{formatMinor(pkg.delta_total_minor)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Fingerprint</p>
                    <p className="font-mono text-xs">{pkg.input_fingerprint.slice(0, 16)}…</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Submitted by</p>
                    <p className="font-medium">{pkg.submitted_by_name ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Submitted at</p>
                    <p className="font-medium">{new Date(pkg.submitted_at).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Policy version</p>
                    <p className="font-medium">{pkg.policy_version_reference ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Effective date</p>
                    <p className="font-medium">{pkg.target_effective_date}</p>
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Approval history</CardTitle>
          <CardDescription>Every approval cycle, decision, reason and justification.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {view.cycles.length === 0 && (
            <p className="text-sm text-muted-foreground">This run has not been submitted for approval yet.</p>
          )}
          {view.cycles.map((c) => (
            <div key={c.approval_id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Cycle #{c.cycle_no}</span>
                <Badge
                  variant={
                    c.status === 'APPROVED' ? 'secondary' : c.status === 'RETURNED' ? 'destructive' : 'outline'
                  }
                >
                  {c.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Submitted {new Date(c.submitted_at).toLocaleString()} by {c.submitted_by_name ?? '—'}
                </span>
              </div>
              {c.submission_note && <p className="text-sm text-muted-foreground">{c.submission_note}</p>}
              {c.decided_at && (
                <p className="mt-1 text-sm">
                  <span className="font-medium">
                    {c.decision === 'APPROVE' ? 'Approved' : 'Returned for rework'}
                  </span>{' '}
                  by {c.decided_by_name ?? '—'} on {new Date(c.decided_at).toLocaleString()} — {c.decision_reason}
                </p>
              )}
              {c.justification && (
                <p className="text-sm text-muted-foreground">Justification: {c.justification}</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};
