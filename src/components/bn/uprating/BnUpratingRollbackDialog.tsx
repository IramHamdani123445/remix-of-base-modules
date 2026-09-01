/**
 * BN Uprating — Rollback authorisation confirmation (Epic 4, canonical
 * `BN_UPRATING_ROLLBACK_ELIGIBLE`).
 *
 * Captures a reason and justification and shows read-only consequences. There
 * is deliberately no force, override or "ignore blocker" control: ineligible
 * items stay ineligible until the owning domain is corrected and eligibility
 * is reassessed.
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
import { formatMinor, type BnUpratingRollbackReadiness } from '@/types/bn/uprating/upratingRun';

export interface BnUpratingRollbackDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly readiness: BnUpratingRollbackReadiness | null;
  readonly isSaving: boolean;
  readonly onConfirm: (values: { reason_code: string; justification: string }) => void;
}

export const BnUpratingRollbackDialog: React.FC<BnUpratingRollbackDialogProps> = ({
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
      setReason(readiness?.current?.reason_code ?? '');
      setJustification('');
    }
  }, [open, readiness?.current?.reason_code]);

  const op = readiness?.current ?? null;
  const eligible = readiness?.items.filter((i) => i.eligibility_status === 'ELIGIBLE') ?? [];
  const ineligible = readiness?.items.filter((i) => i.eligibility_status === 'INELIGIBLE') ?? [];
  const valid = justification.trim().length >= 10;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Authorise rollback of eligible award changes</DialogTitle>
          <DialogDescription>
            Each eligible award change is reversed by recording a compensating change. Nothing is
            deleted and no amount can be edited here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Eligible to reverse</p>
              <p className="text-lg font-medium">{op?.eligible_count ?? eligible.length}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Not eligible</p>
              <p className="text-lg font-medium">{op?.ineligible_count ?? ineligible.length}</p>
            </div>
          </div>

          {eligible.length > 0 && (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-3 text-sm">
              {eligible.map((i) => (
                <div key={i.rollback_item_id} className="flex justify-between gap-3">
                  <span className="font-medium">{i.award_reference}</span>
                  <span className="text-muted-foreground">
                    {formatMinor(i.applied_amount_minor)} → {formatMinor(i.restore_amount_minor)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {ineligible.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{ineligible.length} award change(s) will not be reversed</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5">
                  {ineligible.slice(0, 5).map((i) => (
                    <li key={i.rollback_item_id}>
                      {i.award_reference} — {i.blocker_label ?? i.blocker_code ?? 'Not eligible'}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <Alert>
            <AlertTitle>Known consequences</AlertTitle>
            <AlertDescription className="text-sm">
              For every reversed award the paying domain rebuilds future unpaid instalments, and a
              reversal notice is requested from the Communication Hub. Instalments that were already
              paid are never reversed here.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="uprating-rollback-reason">Reason code (optional)</Label>
            <Input
              id="uprating-rollback-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. EXECUTION_DEFECT"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="uprating-rollback-justification">Justification</Label>
            <Textarea
              id="uprating-rollback-justification"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Record why these award changes are being reversed (at least 10 characters)."
            />
            {!valid && (
              <p className="text-xs text-muted-foreground">
                A justification of at least 10 characters is required.
              </p>
            )}
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
            Authorise rollback
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
