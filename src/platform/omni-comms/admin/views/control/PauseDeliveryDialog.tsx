/**
 * Omni-Comms Control Center — the reason prompt for pausing delivery.
 *
 * Pausing is a safety action: it takes effect immediately and never waits for
 * a second person, but a reason is mandatory and is written to the central
 * workflow trail.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';

export interface PauseDeliveryDialogProps {
  open: boolean;
  channelLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

export const PauseDeliveryDialog: React.FC<PauseDeliveryDialogProps> = ({
  open,
  channelLabel,
  busy,
  onCancel,
  onConfirm,
}) => {
  const [reason, setReason] = React.useState('');

  React.useEffect(() => {
    if (open) setReason('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent data-testid="omni-comms-pause-dialog">
        <DialogHeader>
          <DialogTitle>Turn off automatic {channelLabel} delivery</DialogTitle>
          <DialogDescription>
            This takes effect immediately — no second person is needed. Queued
            work stays in the queue and nothing is deleted.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="omni-comms-pause-reason">Why are you turning it off?</Label>
          <Textarea
            id="omni-comms-pause-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="For example: suspected wrong recipients on today's batch."
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Keep it on
          </Button>
          <Button
            variant="destructive"
            disabled={busy || reason.trim().length < 5}
            onClick={() => onConfirm(reason.trim())}
            data-testid="omni-comms-pause-confirm"
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Turn delivery off
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PauseDeliveryDialog;
