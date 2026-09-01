/**
 * BN Uprating — Record run as failed (Epic 4 supporting operation
 * `BN_UPRATING_MARK_FAILED`).
 *
 * Marking a run failed does not undo anything. It moves the run onto the
 * controlled failure path so rollback eligibility can be assessed.
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, Loader2 } from 'lucide-react';
import type { BnUpratingPostExecutionReadiness } from '@/types/bn/uprating/upratingRun';
import { BnBusyButton } from '@/components/bn/shared';

export interface BnUpratingMarkFailedDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly readiness: BnUpratingPostExecutionReadiness | null;
  readonly isSaving: boolean;
  readonly onConfirm: (values: { reason_code: string; justification: string }) => void;
}

export const BnUpratingMarkFailedDialog: React.FC<BnUpratingMarkFailedDialogProps> = ({
  open,
  onOpenChange,
  readiness,
  isSaving,
  onConfirm,
}) => {
  const [reason, setReason] = React.useState('');
  const [justification, setJustification] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setReason('');
      setJustification('');
    }
  }, [open]);

  const valid = justification.trim().length >= 10;
  const failures = readiness?.completion?.final_failure_count ?? 0;
  const applied = readiness?.completion?.applied_item_count ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record this uprating run as failed</DialogTitle>
          <DialogDescription>
            The run moves onto the controlled failure path. Award changes that already succeeded
            stay in force until a rollback is assessed and independently authorised.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Applied award changes</p>
              <p className="text-lg font-medium">{applied}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Outstanding failures</p>
              <p className="text-lg font-medium">{failures}</p>
            </div>
          </div>

          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>This does not reverse anything</AlertTitle>
            <AlertDescription>
              Nothing is undone by this step. Reversal requires a separate rollback assessment and
              an independent authorisation.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="uprating-fail-reason">Reason code (optional)</Label>
            <Input
              id="uprating-fail-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. UNRECOVERABLE_EXECUTION_FAILURE"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="uprating-fail-justification">Justification</Label>
            <Textarea
              id="uprating-fail-justification"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Record why this run failed (at least 10 characters)."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!valid || isSaving}
            onClick={() => onConfirm({ reason_code: reason.trim(), justification: justification.trim() })}
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record as failed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
