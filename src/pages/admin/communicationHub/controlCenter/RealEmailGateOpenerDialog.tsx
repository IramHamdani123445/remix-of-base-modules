/**
 * Stage 6 — Real-email feature-gate opener dialog.
 *
 * Audited gate opener. Calling `set_comm_hub_real_email_gate` requires a
 * reason of at least 8 characters. The server enforces admin authority and
 * audit; the browser is not the authority.
 */
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  setRealEmailGate,
  type RealEmailGateState,
} from "@/platform/communication-hub/realEmailGateService";

export interface RealEmailGateOpenerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  moduleCode: string;
  eventCode: string;
  channel: string;
  currentlyEnabled: boolean;
  onChanged: (next: RealEmailGateState) => void;
}

export default function RealEmailGateOpenerDialog({
  open,
  onOpenChange,
  moduleCode,
  eventCode,
  channel,
  currentlyEnabled,
  onChanged,
}: RealEmailGateOpenerDialogProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const targetEnabled = !currentlyEnabled;

  async function submit() {
    if (reason.trim().length < 8) {
      toast.error("Reason must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const next = await setRealEmailGate({
        moduleCode,
        eventCode,
        channel,
        enabled: targetEnabled,
        reason,
      });
      onChanged(next);
      toast.success(
        targetEnabled ? "Real-email gate opened." : "Real-email gate closed.",
      );
      onOpenChange(false);
      setReason("");
    } catch (e: any) {
      toast.error(e?.message ?? "Gate change failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {targetEnabled ? "Open" : "Close"} real-email gate
          </DialogTitle>
          <DialogDescription>
            {targetEnabled
              ? "Opening the gate permits one real send for this specific module/event/channel. The action is audited."
              : "Closing the gate prevents any further real send until it is opened again. The action is audited."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Scoped to this lineage only</AlertTitle>
            <AlertDescription className="text-xs">
              <div><code>{moduleCode}</code> / <code>{eventCode}</code> / <code>{channel}</code></div>
            </AlertDescription>
          </Alert>
          <div className="space-y-1">
            <Label className="text-xs">Reason (min 8 characters)</Label>
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={targetEnabled
                ? "Why is a real send authorised now?"
                : "Why is the gate being closed?"}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || reason.trim().length < 8}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            {targetEnabled ? "Open gate" : "Close gate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
