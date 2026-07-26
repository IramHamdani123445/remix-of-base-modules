import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, CheckCircle2, RefreshCcw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { EventGoLiveStatus } from "@/platform/communication-hub/eventGoLiveStatusService";
import {
  runManualProductionObservation,
  finalizeManualProductionObservation,
  type ObservationPhase,
  type RunObservationResult,
} from "@/platform/communication-hub/manualProductionObservationService";

interface Props {
  moduleCode: string;
  eventCode: string;
  channel: string;
  status: EventGoLiveStatus | null;
  onChanged: () => void;
}

const PHASE_ORDER: ObservationPhase[] = [
  "ENQUEUED",
  "DISPATCHED",
  "AWAITING_PROVIDER",
  "CONFIRMED",
];

function phaseBadge(p: ObservationPhase) {
  const variant =
    p === "CONFIRMED" ? "default" :
    p === "FAILED" ? "destructive" :
    "secondary";
  return <Badge variant={variant as any}>{p}</Badge>;
}

export function ManualProductionObservationPanel({
  moduleCode,
  eventCode,
  channel,
  status,
  onChanged,
}: Props) {
  const [recipient, setRecipient] = useState(status?.stage6?.manual_verified_recipient ?? "");
  const [running, setRunning] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [result, setResult] = useState<RunObservationResult | null>(null);
  const [phase, setPhase] = useState<ObservationPhase>("IDLE");
  const [idem, setIdem] = useState<string | null>(null);

  const stage7 = status?.stage7;
  const canDispatch =
    stage7?.manual_event_status === "live_manual_only" ||
    stage7?.manual_event_status === "live_cron_allowed";

  async function run() {
    if (!canDispatch || !recipient.trim()) return;
    setRunning(true);
    setResult(null);
    setPhase("ENQUEUED");
    const key = `mprod-obs-${crypto.randomUUID()}`;
    setIdem(key);
    try {
      const res = await runManualProductionObservation({
        moduleCode, eventCode, channel,
        recipientEmail: recipient.trim(),
        idempotencyKey: key,
      });
      setResult(res);
      setPhase(res.phase);
      if (res.ok) {
        toast.success("Observation confirmed");
      } else if (res.phase === "AWAITING_PROVIDER") {
        toast.warning("Awaiting provider evidence — retry finalize shortly");
      } else {
        toast.error(res.blockers?.[0]?.code ?? "Observation failed");
      }
      onChanged();
    } catch (e: any) {
      setPhase("FAILED");
      toast.error(e?.message ?? "Observation failed");
    } finally {
      setRunning(false);
    }
  }

  async function resumeFinalize() {
    if (!result?.message_id || !idem) return;
    setResuming(true);
    try {
      const res = await finalizeManualProductionObservation({
        messageId: result.message_id, idempotencyKey: idem,
      });
      setResult((prev) => ({ ...(prev ?? {} as any), ...res }));
      setPhase(res.phase);
      if (res.ok) toast.success("Finalized");
      else toast.error(res.blockers?.[0]?.code ?? "Finalize failed");
      onChanged();
    } finally {
      setResuming(false);
    }
  }

  return (
    <div className="rounded-md border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Send className="h-4 w-4" />
        <div className="font-medium">5. Run a Manual Production observation</div>
        <Badge variant="outline" className="ml-auto">
          observations: {stage7?.manual_observation_count ?? 0}
        </Badge>
      </div>

      <Alert>
        <AlertDescription>
          Sends through the standard Manual Production dispatcher via the
          server-coordinated <code>comm-hub-run-manual-production-observation</code>
          {" "}function. Evidence (request, message, delivery attempt, trace,
          provider message id) is derived server-side from durable rows —
          the browser only supplies the approved recipient and idempotency key.
        </AlertDescription>
      </Alert>

      <Input
        value={recipient}
        onChange={(e) => setRecipient(e.target.value)}
        placeholder="approved recipient email (must match recipient policy)"
        disabled={running || !canDispatch}
      />

      <div className="flex items-center gap-2">
        <Button onClick={run} disabled={running || !canDispatch || !recipient.trim()}>
          {running && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Dispatch observation
        </Button>
        {phase === "AWAITING_PROVIDER" && result?.message_id && (
          <Button variant="outline" onClick={resumeFinalize} disabled={resuming}>
            {resuming ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCcw className="h-4 w-4 mr-2" />}
            Retry finalize
          </Button>
        )}
      </div>

      {phase !== "IDLE" && (
        <div className="rounded-md border p-3 bg-muted/30 text-sm space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {PHASE_ORDER.map((p) => {
              const reached = PHASE_ORDER.indexOf(phase) >= PHASE_ORDER.indexOf(p) || phase === "CONFIRMED";
              return (
                <div key={p} className="flex items-center gap-1">
                  {reached && phase !== "FAILED" ? (
                    <CheckCircle2 className="h-3 w-3 text-primary" />
                  ) : phase === "FAILED" ? (
                    <AlertTriangle className="h-3 w-3 text-destructive" />
                  ) : (
                    <div className="h-3 w-3 rounded-full border" />
                  )}
                  <span className={reached ? "" : "text-muted-foreground"}>{p}</span>
                </div>
              );
            })}
            <div className="ml-auto">{phaseBadge(phase)}</div>
          </div>

          {result?.message_id && (
            <div><span className="text-muted-foreground">Message id:</span> <code className="font-mono text-xs">{result.message_id}</code></div>
          )}
          {result?.request_id && (
            <div><span className="text-muted-foreground">Request id:</span> <code className="font-mono text-xs">{result.request_id}</code></div>
          )}
          {result?.trace_id && (
            <div><span className="text-muted-foreground">Trace id:</span> <code className="font-mono text-xs">{result.trace_id}</code></div>
          )}
          {result?.provider_message_id && (
            <div><span className="text-muted-foreground">Provider message id:</span> <code className="font-mono text-xs">{result.provider_message_id}</code></div>
          )}
          {result?.observation_id && (
            <div><span className="text-muted-foreground">Observation id:</span> <code className="font-mono text-xs">{result.observation_id}</code></div>
          )}
          {(result?.blockers ?? []).length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                <ul className="list-disc pl-5">
                  {result!.blockers!.map((b, i) => (
                    <li key={i}><code>{b.code}</code>{b.detail ? <> — {String(b.detail)}</> : null}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}
