/**
 * BN Uprating — Approval decision dialog (Epic 2).
 *
 * Records an independent approve / return-for-rework decision against the
 * immutable package. A reason and a justification are mandatory; both are
 * re-validated by the governed boundary.
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2 } from 'lucide-react';
import { BnBusyButton } from '@/components/bn/shared';
import {
  formatMinor,
  type BnUpratingApprovalDecision,
  type BnUpratingApprovalPackage,
} from '@/types/bn/uprating/upratingRun';

interface Props {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly pkg: BnUpratingApprovalPackage | null;
  readonly isSaving: boolean;
  readonly onSubmit: (values: {
    decision: BnUpratingApprovalDecision;
    decision_reason: string;
    justification: string;
  }) => void;
}

export const BnUpratingApprovalDecisionDialog: React.FC<Props> = ({
  open,
  onOpenChange,
  pkg,
  isSaving,
  onSubmit,
}) => {
  const [decision, setDecision] = React.useState<BnUpratingApprovalDecision>('APPROVE');
  const [reason, setReason] = React.useState('');
  const [justification, setJustification] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setDecision('APPROVE');
      setReason('');
      setJustification('');
    }
  }, [open]);

  const valid = reason.trim().length > 0 && justification.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Record approval decision</DialogTitle>
          <DialogDescription>
            Approving authorises later execution only. No award, entitlement or payment changes now.
          </DialogDescription>
        </DialogHeader>

        {pkg && (
          <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Approval cycle</p>
              <p className="font-medium">#{pkg.cycle_no}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Snapshot / simulation</p>
              <p className="font-medium">
                v{pkg.snapshot_version} / v{pkg.simulation_version}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Effective date</p>
              <p className="font-medium">{pkg.target_effective_date}</p>
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
              <p className="text-xs text-muted-foreground">Submitted by</p>
              <p className="font-medium">{pkg.submitted_by_name ?? '—'}</p>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label>Decision</Label>
          <RadioGroup
            value={decision}
            onValueChange={(v) => setDecision(v as BnUpratingApprovalDecision)}
            className="gap-2"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="APPROVE" id="uprating-decision-approve" />
              <Label htmlFor="uprating-decision-approve" className="font-normal">
                Approve — authorise this package for later execution
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="RETURN_FOR_REWORK" id="uprating-decision-return" />
              <Label htmlFor="uprating-decision-return" className="font-normal">
                Return for rework — send the run back for correction
              </Label>
            </div>
          </RadioGroup>
        </div>

        <div className="space-y-2">
          <Label htmlFor="uprating-decision-reason">Reason</Label>
          <Input
            id="uprating-decision-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Short reason for this decision"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="uprating-decision-justification">Justification</Label>
          <Textarea
            id="uprating-decision-justification"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Explain the basis for this decision. This is retained in the audit record."
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSubmit({
                decision,
                decision_reason: reason.trim(),
                justification: justification.trim(),
              })
            }
            disabled={isSaving || !valid}
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record decision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
