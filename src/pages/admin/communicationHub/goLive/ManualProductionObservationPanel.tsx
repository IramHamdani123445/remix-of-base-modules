import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, CheckCircle2, RefreshCcw, AlertTriangle, Inbox, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { EventGoLiveStatus } from "@/platform/communication-hub/eventGoLiveStatusService";
import {
  runManualProductionObservation,
  finalizeManualProductionObservation,
  confirmManualProductionObservation,
  getObservationRecovery,
  getManualProductionEvidence,
  voidManualProductionObservation,
  type ObservationPhase,
  type RunObservationResult,
  type ManualProductionEvidence,
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
  "AWAITING_INBOX_CONFIRMATION",
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
  const [confirming, setConfirming] = useState<null | "CONFIRMED" | "NOT_RECEIVED">(null);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<RunObservationResult | null>(null);
  const [phase, setPhase] = useState<ObservationPhase>("IDLE");
  const [idem, setIdem] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(true);
  const [evidence, setEvidence] = useState<ManualProductionEvidence | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);

  useEffect(() => {
    if (phase !== "CONFIRMED" || !result?.observation_id) return;
    let cancelled = false;
    (async () => {
      const r = await getManualProductionEvidence(result.observation_id!);
      if (cancelled) return;
      if (r.ok && r.evidence) { setEvidence(r.evidence); setEvidenceError(null); }
      else setEvidenceError(r.error ?? "evidence_unavailable");
    })();
    return () => { cancelled = true; };
  }, [phase, result?.observation_id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rec = await getObservationRecovery({ moduleCode, eventCode, channel });
        if (cancelled || !rec.hasPending) return;
        setIdem(rec.idempotencyKey ?? null);
        setRecipient(rec.recipientEmail ?? "");
        setPhase(rec.phase ?? "AWAITING_PROVIDER");
        setResult({
          ok: true,
          phase: rec.phase ?? "AWAITING_PROVIDER",
          observation_id: rec.observationId,
          message_id: rec.messageId,
          request_id: rec.requestId,
          inbox_confirmation_status: rec.inboxConfirmationStatus ?? null,
        });
        toast.info(`Recovered pending observation (${rec.phase}) — no new message will be sent.`);
      } finally {
        if (!cancelled) setRecovering(false);
      }
    })();
    return () => { cancelled = true; };
  }, [moduleCode, eventCode, channel]);


  const stage7 = status?.stage7;
  const canDispatch =
    stage7?.manual_event_status === "live_manual_only" ||
    stage7?.manual_event_status === "live_cron_allowed";

  async function run() {
    if (!canDispatch || !recipient.trim()) return;
    setRunning(true);
    setResult(null);
    setPhase("ENQUEUED");
    // Reuse the existing key if the last attempt's transport is unresolved.
    const key = idem && result?.transport && !result.transport.resolved
      ? idem
      : `mprod-obs-${crypto.randomUUID()}`;
    setIdem(key);
    try {
      const res = await runManualProductionObservation({
        moduleCode, eventCode, channel,
        recipientEmail: recipient.trim(),
        idempotencyKey: key,
      });
      setResult(res);
      setPhase(res.phase);
      if (res.transport && !res.transport.resolved) {
        toast.error(`Transport unresolved (${res.transport.errorClass}) — will retry with same idempotency key.`);
      } else if (res.phase === "AWAITING_INBOX_CONFIRMATION") {
        toast.success(res.recovered ? "Recovered pending observation" : "Provider evidence captured — confirm inbox receipt to proceed");
      } else if (res.phase === "AWAITING_PROVIDER") {
        toast.warning("Awaiting provider evidence — retry finalize shortly");
      } else if (res.phase === "CONFIRMED") {
        toast.success("Observation confirmed");
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

  async function decideInbox(decision: "CONFIRMED" | "NOT_RECEIVED") {
    if (!result?.observation_id) return;
    setConfirming(decision);
    try {
      const res = await confirmManualProductionObservation({
        observationId: result.observation_id, decision, note: note.trim() || undefined,
      });
      setResult((prev) => ({ ...(prev ?? {} as any), ...res }));
      setPhase(res.phase);
      if (res.phase === "CONFIRMED") toast.success("Inbox receipt confirmed");
      else if (res.phase === "NOT_RECEIVED") toast.warning("Recorded as not received");
      else toast.error(res.blockers?.[0]?.code ?? "Confirmation failed");
      onChanged();
    } finally {
      setConfirming(null);
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

      {result?.transport && !result.transport.resolved && (
        <Alert variant="destructive">
          <AlertDescription className="space-y-1 text-xs">
            <div>Checking whether the previous request reached the server…</div>
            <div><span className="text-muted-foreground">Class:</span> {result.transport.errorClass}
              {result.transport.httpStatus ? <> · HTTP {result.transport.httpStatus}</> : null}
              {result.transport.runtimeBuild ? <> · build {result.transport.runtimeBuild}</> : null}
              {result.transport.correlationId ? <> · req {result.transport.correlationId}</> : null}
            </div>
            {result.transport.responseBody && (
              <pre className="max-h-32 overflow-auto rounded bg-muted p-2 font-mono text-[10px]">{result.transport.responseBody}</pre>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={run} disabled={running || recovering || !canDispatch || !recipient.trim() || (result?.transport && !result.transport.resolved) || (phase !== "IDLE" && phase !== "FAILED" && phase !== "NOT_RECEIVED")}>
          {(running || recovering) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {recovering ? "Checking pending…" : (result?.transport && !result.transport.resolved) ? "Checking previous request…" : "Dispatch observation"}
        </Button>
        {phase === "AWAITING_PROVIDER" && result?.message_id && (
          <Button variant="outline" onClick={resumeFinalize} disabled={resuming}>
            {resuming ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCcw className="h-4 w-4 mr-2" />}
            Retry finalize
          </Button>
        )}
      </div>

      {phase === "AWAITING_INBOX_CONFIRMATION" && result?.observation_id && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Inbox className="h-4 w-4" />
            Confirm inbox receipt
          </div>
          <p className="text-xs text-muted-foreground">
            Provider accepted the message. Check the recipient inbox and confirm
            whether the email was received. This is a required separate operator step —
            certification cannot proceed on provider evidence alone.
          </p>
          <Textarea
            placeholder="Optional note (e.g. inbox screenshot ref, spam-folder observation)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => decideInbox("CONFIRMED")}
              disabled={confirming !== null}
            >
              {confirming === "CONFIRMED" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Confirm received
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => decideInbox("NOT_RECEIVED")}
              disabled={confirming !== null}
            >
              {confirming === "NOT_RECEIVED" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <XCircle className="h-4 w-4 mr-2" />
              Not received
            </Button>
          </div>
        </div>
      )}

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

          {phase === "CONFIRMED" && (
            <div className="rounded-md border p-3 bg-background text-xs space-y-1">
              <div className="font-medium text-sm mb-2">Manual Production evidence (server-authoritative)</div>
              {evidenceError && (
                <Alert variant="destructive"><AlertDescription><code>{evidenceError}</code></AlertDescription></Alert>
              )}
              {evidence && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
                  <div><span className="text-muted-foreground">observation_id:</span> <code>{evidence.observation_id}</code></div>
                  <div><span className="text-muted-foreground">request_id:</span> <code>{evidence.request_id ?? "—"}</code></div>
                  <div><span className="text-muted-foreground">message_id:</span> <code>{evidence.message_id ?? "—"}</code></div>
                  <div><span className="text-muted-foreground">delivery_attempt_id:</span> <code>{evidence.delivery_attempt_id ?? "—"}</code></div>
                  <div><span className="text-muted-foreground">trace_id:</span> <code>{evidence.trace_id ?? "—"}</code></div>
                  <div><span className="text-muted-foreground">provider_id:</span> <code>{evidence.provider_id ?? "—"}</code></div>
                  <div><span className="text-muted-foreground">provider_message_id:</span> <code>{evidence.provider_message_id ?? "—"}</code></div>
                  <div><span className="text-muted-foreground">message_status:</span> <code>{evidence.message_status ?? "—"}</code></div>
                  <div><span className="text-muted-foreground">attempt_status:</span> <code>{evidence.attempt_status ?? "—"}</code></div>
                  <div><span className="text-muted-foreground">send_context:</span> <code>{evidence.send_context ?? "—"}</code></div>
                  <div><span className="text-muted-foreground">test_mode:</span> <code>{String(evidence.test_mode)}</code></div>
                  <div><span className="text-muted-foreground">recipient_email:</span> <code>{evidence.recipient_email ?? "—"}</code></div>
                  <div><span className="text-muted-foreground">inbox_confirmation_status:</span> <code>{evidence.inbox_confirmation_status ?? "—"}</code></div>
                  <div><span className="text-muted-foreground">dispatched_at:</span> <code>{evidence.dispatched_at ?? "—"}</code></div>
                  <div className="md:col-span-2"><span className="text-muted-foreground">event_certification_id:</span> <code>{evidence.event_certification_id ?? "—"}</code></div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
