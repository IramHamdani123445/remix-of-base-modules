import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import type { EventGoLiveStatus } from "@/platform/communication-hub/eventGoLiveStatusService";
import {
  dispatchAndRecordObservation,
  confirmManualProductionObservation,
} from "@/platform/communication-hub/manualProductionObservationService";

interface Props {
  moduleCode: string;
  eventCode: string;
  channel: string;
  status: EventGoLiveStatus | null;
  onChanged: () => void;
}

/**
 * Manual Production observation — uses the standard sendCommunication()
 * façade (the same dispatcher as any real business event), records the
 * observation server-side, and offers an explicit inbox confirmation.
 *
 * This is deliberately NOT the Stage 6 One Real Email edge function.
 */
export function ManualProductionObservationPanel({
  moduleCode,
  eventCode,
  channel,
  status,
  onChanged,
}: Props) {
  const [recipient, setRecipient] = useState(
    status?.stage6?.manual_verified_recipient ?? "",
  );
  const [dispatching, setDispatching] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [lastObservationId, setLastObservationId] = useState<string | null>(null);

  const stage7 = status?.stage7;
  const canDispatch =
    stage7?.manual_event_status === "live_manual_only" ||
    stage7?.manual_event_status === "live_cron_allowed";

  const latest = stage7
    ? {
        id: stage7.latest_manual_observation_id,
        messageId: stage7.latest_manual_observation_message_id,
        traceId: stage7.latest_manual_observation_trace_id,
        status: stage7.latest_manual_observation_status,
        inbox: stage7.latest_manual_observation_inbox,
      }
    : null;

  async function handleDispatch() {
    if (!canDispatch || !recipient.trim()) return;
    setDispatching(true);
    try {
      const idem = `mprod-obs-${crypto.randomUUID()}`;
      const res = await dispatchAndRecordObservation({
        moduleCode,
        eventCode,
        channel,
        recipientEmail: recipient.trim(),
        idempotencyKey: idem,
      });
      setLastObservationId(res.observation_id);
      toast.success("Observation dispatched");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Observation dispatch failed");
    } finally {
      setDispatching(false);
    }
  }

  async function handleConfirm(status: "CONFIRMED" | "NOT_RECEIVED") {
    const id = lastObservationId ?? latest?.id;
    if (!id) return;
    setConfirming(true);
    try {
      await confirmManualProductionObservation({
        observationId: id,
        status,
      });
      toast.success(`Observation marked ${status}`);
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Confirmation failed");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="rounded-md border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Send className="h-4 w-4" />
        <div className="font-medium">5. Run a Manual Production observation</div>
        <Badge variant="outline" className="ml-auto">observations: {stage7?.manual_observation_count ?? 0}</Badge>
      </div>
      <Alert>
        <AlertDescription>
          Sends through the standard Manual Production dispatcher
          (not the Stage 6 One Real Email path), records evidence, and
          requires an explicit inbox confirmation. Only observations with
          <strong> send_context = manual_production</strong>, dispatched
          after Manual Production certification, with inbox status
          <strong> CONFIRMED</strong> count towards automated certification.
        </AlertDescription>
      </Alert>

      <Input
        value={recipient}
        onChange={(e) => setRecipient(e.target.value)}
        placeholder="approved internal recipient email"
        disabled={dispatching || !canDispatch}
      />
      <Button onClick={handleDispatch} disabled={dispatching || !canDispatch || !recipient.trim()}>
        {dispatching && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Dispatch observation
      </Button>

      {latest?.id && (
        <div className="rounded-md border p-3 bg-muted/30 text-sm space-y-1">
          <div><span className="text-muted-foreground">Latest observation:</span> <code className="font-mono text-xs">{latest.id}</code></div>
          <div><span className="text-muted-foreground">Message id:</span> <code className="font-mono text-xs">{latest.messageId ?? "—"}</code></div>
          <div><span className="text-muted-foreground">Trace id:</span> <code className="font-mono text-xs">{latest.traceId ?? "—"}</code></div>
          <div><span className="text-muted-foreground">Status:</span> <Badge>{latest.status}</Badge>{" "}
            <span className="text-muted-foreground ml-2">Inbox:</span>{" "}
            <Badge variant={latest.inbox === "CONFIRMED" ? "default" : "secondary"}>{latest.inbox ?? "pending"}</Badge>
          </div>
          {latest.inbox !== "CONFIRMED" && (
            <div className="flex gap-2 pt-2">
              <Button size="sm" variant="default" onClick={() => handleConfirm("CONFIRMED")} disabled={confirming}>
                {confirming && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <CheckCircle2 className="h-4 w-4 mr-1" />
                Confirm inbox receipt
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleConfirm("NOT_RECEIVED")} disabled={confirming}>
                Not received
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
