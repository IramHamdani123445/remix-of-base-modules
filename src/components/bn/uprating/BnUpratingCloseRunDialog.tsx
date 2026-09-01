/**
 * BN Uprating — Close run confirmation (Epic 5, canonical
 * `BN_UPRATING_CLOSE_RUN`).
 *
 * Closure is a governed lifecycle transition only. Nothing on this dialog
 * recalculates an amount, mutates an award, rebuilds a schedule or issues a
 * communication. Closability is decided entirely by
 * `bn_uprating_close_readiness_v1`; this surface renders the backend's own
 * decision and its blocking reasons, and fails closed when the backend
 * cannot be read.
 */
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Lock, ShieldAlert } from 'lucide-react';
import type { BnUpratingCloseReadiness } from '@/types/bn/uprating/upratingRun';
import { BnBusyButton } from '@/components/bn/shared';

export interface BnUpratingCloseRunDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly readiness: BnUpratingCloseReadiness | null;
  readonly isLoading?: boolean;
  readonly isSaving: boolean;
  readonly onConfirm: (justification: string | null) => void;
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

export const BnUpratingCloseRunDialog: React.FC<BnUpratingCloseRunDialogProps> = ({
  open,
  onOpenChange,
  readiness,
  isLoading = false,
  isSaving,
  onConfirm,
}) => {
  const [justification, setJustification] = React.useState('');

  React.useEffect(() => {
    if (open) setJustification('');
  }, [open]);

  const path = readiness?.completion_path ?? null;
  const blockers = readiness?.blocking_reasons ?? [];
  // Fail closed: without an affirmative backend decision, closure is not offered.
  const canClose = readiness?.can_close === true && !isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {path === 'ROLLED_BACK'
              ? 'Close rolled-back uprating run'
              : 'Close reconciled uprating run'}
          </DialogTitle>
          <DialogDescription>
            Closing records that this uprating run is operationally complete. It changes no award,
            no payment schedule and no claimant notice, and it deletes nothing. A closed run can be
            viewed for audit but cannot be reopened.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking closure readiness…
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1 rounded-md border p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">Completion</p>
              <Line
                label="Current state"
                value={<Badge variant="secondary">{readiness?.run_status ?? 'Unknown'}</Badge>}
              />
              <Line
                label="Completion path"
                value={
                  path === 'ROLLED_BACK'
                    ? 'Rolled back'
                    : path === 'RECONCILED'
                      ? 'Reconciled'
                      : 'Not determined'
                }
              />
              {path === 'RECONCILED' && (
                <Line
                  label="Reconciliation result"
                  value={readiness?.reconciliation_status ?? 'None'}
                />
              )}
              {path === 'ROLLED_BACK' && (
                <Line label="Rollback result" value={readiness?.rollback_status ?? 'None'} />
              )}
              <Line
                label="Open operational items"
                value={String(readiness?.open_operational_items ?? 0)}
              />
            </div>

            {blockers.length > 0 && (
              <Alert variant="destructive">
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>This run cannot be closed yet</AlertTitle>
                <AlertDescription>
                  <ul className="ml-4 list-disc space-y-1">
                    {blockers.map((b) => (
                      <li key={b.code}>{b.message}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {canClose && (
              <Alert>
                <Lock className="h-4 w-4" />
                <AlertTitle>Closure is final</AlertTitle>
                <AlertDescription>
                  Once closed, no further uprating action is offered on this run. Policy,
                  population, simulation, approval, execution, reconciliation, rollback and
                  communication evidence all remain available.
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-1">
              <Label htmlFor="uprating-close-note">Closing note (optional)</Label>
              <Textarea
                id="uprating-close-note"
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Record anything an auditor should know about this closure."
                rows={3}
                disabled={!canClose || isSaving}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(justification.trim() ? justification.trim() : null)}
            disabled={!canClose || isSaving}
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Close run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
