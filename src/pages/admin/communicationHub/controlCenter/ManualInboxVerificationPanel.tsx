/**
 * Stage 6 — Manual inbox verification panel.
 *
 * Renders ONLY when the caller has confirmed the seven envelope conditions
 * (see `renderable` prop). Independent server RPC re-verifies that the
 * certification is truly ONE_REAL_EMAIL — the browser is not the authority.
 */
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Loader2, MailCheck, MailX, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  recordManualInboxVerification,
  type ManualInboxVerificationDecision,
} from "@/platform/communication-hub/manualInboxVerificationService";
import {
  fetchOneRealEmailCertification,
  type OneRealEmailCertificationRow,
} from "@/platform/communication-hub/oneRealEmailService";

export interface ManualInboxVerificationPanelProps {
  certificationId: string;
  expectedRecipient: string;
  onVerified: (row: OneRealEmailCertificationRow) => void;
}

export default function ManualInboxVerificationPanel({
  certificationId,
  expectedRecipient,
  onVerified,
}: ManualInboxVerificationPanelProps) {
  const [recipient, setRecipient] = useState(expectedRecipient);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<ManualInboxVerificationDecision | null>(null);
  const [current, setCurrent] = useState<OneRealEmailCertificationRow | null>(null);

  async function submit(decision: ManualInboxVerificationDecision) {
    if (decision === "CONFIRMED" && !recipient.trim()) {
      toast.error("Enter the recipient email exactly as it appeared in the inbox.");
      return;
    }
    setBusy(decision);
    try {
      const res = await recordManualInboxVerification({
        certificationId,
        decision,
        verifiedRecipient: recipient.trim(),
        note: note.trim(),
      });
      if (!res.ok) {
        toast.error(`Manual verification refused: ${res.status}`);
        return;
      }
      // Server response is authoritative. Only treat CONFIRMED as success.
      if (
        decision === "CONFIRMED" &&
        !(res.status === "DELIVERY_CONFIRMED_MANUALLY" &&
          res.manualVerificationStatus === "CONFIRMED")
      ) {
        toast.error(
          `Server did not confirm verification (status=${res.status}, verification=${res.manualVerificationStatus ?? "null"}).`,
        );
        return;
      }
      const reloaded = await fetchOneRealEmailCertification(certificationId);
      if (!reloaded) {
        toast.error("Certification could not be re-read after verification.");
        return;
      }
      setCurrent(reloaded);
      onVerified(reloaded);
      toast.success(
        decision === "CONFIRMED"
          ? "Inbox receipt confirmed."
          : "Recorded as not received.",
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Manual verification failed");
    } finally {
      setBusy(null);
    }
  }

  if (
    current?.status === "DELIVERY_CONFIRMED_MANUALLY" ||
    current?.manualVerificationStatus === "CONFIRMED"
  ) {
    return (
      <Alert>
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        <AlertTitle className="flex items-center gap-2">
          Delivery confirmed manually
          <Badge variant="outline">ONE_REAL_EMAIL</Badge>
        </AlertTitle>
        <AlertDescription className="space-y-1 text-xs">
          <div>Verified recipient: <code>{current.manualVerifiedRecipient}</code></div>
          <div>Verified by: <code>{current.manualVerifiedBy}</code></div>
          <div>Verified at: {current.manualVerifiedAt}</div>
          {current.manualVerificationNote && <div>Note: {current.manualVerificationNote}</div>}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-border/60 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <MailCheck className="h-4 w-4" /> Manual inbox verification
      </div>
      <p className="text-xs text-muted-foreground">
        Provider accepted the message. Confirm the recipient actually received
        the email in their inbox (or Spam/Junk) before Stage 6 is complete.
        "Not received" does not automatically permit another send.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Verified recipient</Label>
          <Input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="e.g. rohit@mishainfotech.com"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Note</Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Optional context: subject line seen, timestamp, folder…"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => submit("CONFIRMED")}
          disabled={busy !== null}
        >
          {busy === "CONFIRMED" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
          Confirm Email Received
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => submit("NOT_RECEIVED")}
          disabled={busy !== null}
        >
          {busy === "NOT_RECEIVED" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <MailX className="h-4 w-4 mr-1" />}
          Mark Not Received
        </Button>
      </div>
    </div>
  );
}
