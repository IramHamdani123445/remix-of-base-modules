/**
 * BN Uprating — Execute batch confirmation dialog (Epic 3).
 *
 * Execution applies exactly what was approved. This dialog never recalculates
 * an amount and never decides availability locally: every figure comes from
 * `bn_uprating_execution_readiness_v1` / `bn_uprating_run_execution_v1`, and the
 * confirm button is disabled unless the backend says the run may be executed.
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
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, ShieldAlert } from 'lucide-react';
import { BnBusyButton } from '@/components/bn/shared';
import {
  formatMinor,
  type BnUpratingExecutionReadiness,
  type BnUpratingRunExecutionView,
} from '@/types/bn/uprating/upratingRun';

interface Props {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly readiness: BnUpratingExecutionReadiness | null;
  readonly execution: BnUpratingRunExecutionView | null;
  readonly isSaving: boolean;
  readonly onConfirm: () => void;
}

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-medium text-right">{value}</span>
  </div>
);

export const BnUpratingExecuteBatchDialog: React.FC<Props> = ({
  open,
  onOpenChange,
  readiness,
  execution,
  isSaving,
  onConfirm,
}) => {
  const [acknowledged, setAcknowledged] = React.useState(false);

  React.useEffect(() => {
    if (!open) setAcknowledged(false);
  }, [open]);

  const session = execution?.session ?? null;
  const isFirstBatch = !readiness?.has_session;
  const blockers = readiness?.blockers ?? [];
  const canExecute = !!readiness?.can_execute;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isFirstBatch ? 'Start approved execution' : 'Execute the next batch'}
          </DialogTitle>
          <DialogDescription>
            The approved package is applied verbatim. No amount is recalculated and only awards in
            the approved population are changed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border p-3">
            <Row
              label="Run"
              value={
                <span className="inline-flex items-center gap-2">
                  {readiness?.run_reference ?? '—'}
                  {readiness?.status && <Badge variant="outline">{readiness.status}</Badge>}
                </span>
              }
            />
            <Row label="Effective date" value={session?.target_effective_date ?? '—'} />
            <Row
              label="Approved award changes"
              value={readiness?.planned_item_count ?? 0}
            />
            <Row
              label="Batches"
              value={
                isFirstBatch
                  ? `${readiness?.planned_batch_count ?? '—'} planned (batch size ${readiness?.batch_size ?? '—'})`
                  : `${readiness?.pending_batches ?? 0} pending of ${session?.planned_batch_count ?? 0}`
              }
            />
            <Row
              label="Approved financial change"
              value={formatMinor(readiness?.approved_delta_total_minor ?? 0)}
            />
            {session && (
              <Row
                label="Applied so far"
                value={`${session.applied_item_count} applied · ${session.failed_item_count} failed`}
              />
            )}
          </div>

          {blockers.length > 0 && (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Execution is blocked</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {blockers.map((b) => (
                    <li key={b.code}>{b.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-start gap-2">
            <Checkbox
              id="uprating-execute-ack"
              checked={acknowledged}
              onCheckedChange={(v) => setAcknowledged(v === true)}
              disabled={!canExecute || isSaving}
            />
            <Label
              htmlFor="uprating-execute-ack"
              className="text-sm font-normal leading-snug text-muted-foreground"
            >
              I confirm this run is approved and understand that award amounts will change from the
              effective date shown above.
            </Label>
          </div>
        </div>

        <DialogFooter>
          <BnBusyButton loading={isSaving} variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </BnBusyButton>
          <Button onClick={onConfirm} disabled={!canExecute || !acknowledged || isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isFirstBatch ? 'Execute approved run' : 'Execute next batch'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
