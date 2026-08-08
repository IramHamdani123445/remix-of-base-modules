/**
 * BN Uprating — Reconcile run confirmation (Epic 4, canonical
 * `BN_UPRATING_RECONCILE_RUN`).
 *
 * Read-only evidence: approved package, execution results, schedule results
 * and communication results, exactly as reported by the backend. No figure on
 * this dialog is editable and nothing here is recalculated.
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
import { Separator } from '@/components/ui/separator';
import { Loader2, Scale } from 'lucide-react';
import {
  formatMinor,
  type BnUpratingPostExecutionReadiness,
  type BnUpratingReconciliationView,
} from '@/types/bn/uprating/upratingRun';

export interface BnUpratingReconcileDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly readiness: BnUpratingPostExecutionReadiness | null;
  readonly view: BnUpratingReconciliationView | null;
  readonly isSaving: boolean;
  readonly onConfirm: () => void;
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

export const BnUpratingReconcileDialog: React.FC<BnUpratingReconcileDialogProps> = ({
  open,
  onOpenChange,
  readiness,
  view,
  isSaving,
  onConfirm,
}) => {
  const completion = readiness?.completion ?? null;
  const last = view?.history?.[0] ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reconcile uprating run</DialogTitle>
          <DialogDescription>
            Reconciliation compares the approved package with what was actually applied, scheduled
            and requested. It records the result — it does not close the run.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1 rounded-md border p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">Execution</p>
            <Line
              label="Applied award changes"
              value={String(completion?.applied_item_count ?? 0)}
            />
            <Line
              label="Outstanding failures"
              value={String(completion?.final_failure_count ?? 0)}
            />
          </div>

          <div className="space-y-1 rounded-md border p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Schedule consequences
            </p>
            <Line
              label="Rebuilt"
              value={`${readiness?.schedule_completed_count ?? 0} of ${
                readiness?.schedule_required_count ?? 0
              }`}
            />
            <Line label="Failed" value={String(readiness?.schedule_failed_count ?? 0)} />
          </div>

          <div className="space-y-1 rounded-md border p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">Claimant notices</p>
            <Line
              label="Requested to the Communication Hub"
              value={`${readiness?.communication_requested_count ?? 0} of ${
                readiness?.communication_required_count ?? 0
              }`}
            />
            <Line
              label="Confirmed delivered by the Hub"
              value={String(readiness?.communication_delivered_count ?? 0)}
            />
          </div>

          {last && (
            <>
              <Separator />
              <div className="space-y-1 rounded-md border p-3">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Previous reconciliation
                </p>
                <Line label={`Attempt #${last.reconciliation_no}`} value={last.status} />
                <Line label="Findings" value={String(last.finding_count)} />
              </div>
            </>
          )}

          {view?.current && (
            <div className="space-y-1 rounded-md border p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">Totals</p>
              <Line
                label="Approved change"
                value={formatMinor(view.current.expected_delta_total_minor)}
              />
              <Line
                label="Applied change"
                value={formatMinor(view.current.actual_delta_total_minor)}
              />
            </div>
          )}

          <Alert>
            <Scale className="h-4 w-4" />
            <AlertTitle>Reconciled is not closed</AlertTitle>
            <AlertDescription>
              A clean reconciliation moves this run to RECONCILED. Closure is a separate, later
              governed step.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Reconcile run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
