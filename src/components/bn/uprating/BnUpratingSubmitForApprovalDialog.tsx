/**
 * BN Uprating — Submit run for approval (Epic 2).
 *
 * Shows exactly what will be frozen into the immutable approval package and
 * the backend-supplied blockers. The dialog never decides readiness itself.
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, ShieldAlert } from 'lucide-react';
import { formatMinor, type BnUpratingApprovalReadiness } from '@/types/bn/uprating/upratingRun';

interface Props {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly readiness: BnUpratingApprovalReadiness | null;
  readonly isSaving: boolean;
  readonly onSubmit: (values: { submission_note: string }) => void;
}

export const BnUpratingSubmitForApprovalDialog: React.FC<Props> = ({
  open,
  onOpenChange,
  readiness,
  isSaving,
  onSubmit,
}) => {
  const [note, setNote] = React.useState('');

  React.useEffect(() => {
    if (open) setNote('');
  }, [open]);

  const blockers = readiness?.blockers ?? [];
  const warnings = readiness?.warnings ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Submit run for approval</DialogTitle>
          <DialogDescription>
            The population snapshot, simulation and policy provenance are frozen into an immutable
            approval package. Nothing is executed and no award or payment changes.
          </DialogDescription>
        </DialogHeader>

        {blockers.length > 0 && (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>This run cannot be submitted yet</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-5">
                {blockers.map((b) => (
                  <li key={b.code}>{b.message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {warnings.length > 0 && (
          <Alert>
            <AlertTitle>Please note</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-5">
                {warnings.map((w) => (
                  <li key={w.code}>{w.message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {readiness && (
          <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Snapshot / simulation</p>
              <p className="font-medium">
                v{readiness.current_snapshot_version ?? '—'} / v
                {readiness.current_simulation_version ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Awards included / excluded</p>
              <p className="font-medium">
                {readiness.population_summary.included_count} / {readiness.population_summary.excluded_count}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Open exceptions (blocking)</p>
              <p className="font-medium">
                {readiness.exception_summary.open_exceptions} ({readiness.exception_summary.unresolved_blocking})
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Simulated current total</p>
              <p className="font-medium">
                {formatMinor(readiness.financial_summary.simulated_current_total_minor)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Simulated proposed total</p>
              <p className="font-medium">
                {formatMinor(readiness.financial_summary.simulated_proposed_total_minor)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Simulated change</p>
              <p className="font-medium">
                {formatMinor(readiness.financial_summary.simulated_change_minor)}
              </p>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="uprating-submission-note">Note for the approver (optional)</Label>
          <Textarea
            id="uprating-submission-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything the approver should be aware of."
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            onClick={() => onSubmit({ submission_note: note.trim() })}
            disabled={isSaving || !readiness?.can_submit}
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit for approval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
