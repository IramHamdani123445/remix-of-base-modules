import { useEffect, useRef, useState } from "react";
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

import {
  deriveObservation,
  type ObservationDerived,
  type PendingObservationState,
} from "./goLiveStateResolver";

interface Props {
  moduleCode: string;
  eventCode: string;
  channel: string;
  status: EventGoLiveStatus | null;
  /** Shared server-authoritative pending-observation state (from GoLivePage). */
  pendingObservation: PendingObservationState;
  reloadNonce?: number;
  /**
   * Report the latest dispatch/finalize/confirm result (and its idempotency
   * key) back to the parent so both banner and panel stay in sync.
   */
  onLastResult: (result: RunObservationResult | null, idempotencyKey?: string | null) => void;
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
  pendingObservation,
  reloadNonce,
  onLastResult,
  onChanged,
}: Props) {
  const [recipient, setRecipient] = useState(
    pendingObservation.recipient_email ?? status?.stage6?.manual_verified_recipient ?? "",
  );
  const [running, setRunning] = useState(false);
  const [checkingRecovery, setCheckingRecovery] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [confirming, setConfirming] = useState<null | "CONFIRMED" | "NOT_RECEIVED">(null);
  const [note, setNote] = useState("");
  const [evidence, setEvidence] = useState<ManualProductionEvidence | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const confirmSectionRef = useRef<HTMLDivElement>(null);

  const derived: ObservationDerived = deriveObservation(status, pendingObservation);
  const phase: ObservationPhase =
    (pendingObservation.phase as ObservationPhase | null) ??
    (derived.state === "COMPLETED" ? "CONFIRMED" : "IDLE");

  useEffect(() => {
    // Reset recipient default when pending state carries one.
    if (pendingObservation.recipient_email && !recipient) {
      setRecipient(pendingObservation.recipient_email);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingObservation.recipient_email]);

  useEffect(() => {
    if (phase !== "CONFIRMED" || !pendingObservation.observation_id) return;
    let cancelled = false;
    (async () => {
      const r = await getManualProductionEvidence(pendingObservation.observation_id!);
      if (cancelled) return;
      if (r.ok && r.evidence) { setEvidence(r.evidence); setEvidenceError(null); }
      else setEvidenceError(r.error ?? "evidence_unavailable");
    })();
    return () => { cancelled = true; };
  }, [phase, pendingObservation.observation_id]);

  // ---------------------------------------------------------------------------
  // Action handlers — invoked by the single primary button based on derived.action.
  // ---------------------------------------------------------------------------

  async function doDispatch() {
    if (!recipient.trim()) return;
    setRunning(true);
    const key = `mprod-obs-${crypto.randomUUID()}`;
    // Reserve the key locally so a transport-unresolved retry can reuse it.
    onLastResult(null, key);
    try {
      const res = await runManualProductionObservation({
        moduleCode, eventCode, channel,
        recipientEmail: recipient.trim(),
        idempotencyKey: key,
      });
      onLastResult(res, key);
      if (res.transport && !res.transport.resolved) {
        toast.error(`Transport unresolved (${res.transport.errorClass}) — running recovery.`);
      } else if (res.phase === "AWAITING_INBOX_CONFIRMATION") {
        toast.success(res.recovered ? "Recovered pending observation" : "Provider evidence captured — confirm inbox receipt to proceed");
      } else if (res.phase === "AWAITING_PROVIDER") {
        toast.warning("Awaiting provider evidence — finalize once ready");
      } else if (res.phase === "CONFIRMED") {
        toast.success("Observation confirmed");
      } else if (!res.ok) {
        toast.error(res.blockers?.[0]?.code ?? "Observation failed");
      }
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Observation failed");
    } finally {
      setRunning(false);
    }
  }

  /**
   * TRANSPORT_UNRESOLVED / PROCESSING — never invoke dispatch again. Only ask
   * the server whether the original operation reached it (same idempotency key).
   */
  async function doCheckRecovery() {
    setCheckingRecovery(true);
    try {
      const rec = await getObservationRecovery({ moduleCode, eventCode, channel });
      if (rec.hasPending) {
        toast.success(`Recovered pending intent · phase ${rec.phase ?? "AWAITING_PROVIDER"}`);
      } else {
        toast.info("Server has no pending intent — safe to dispatch again");
        // Clear the unresolved-transport marker so the DISPATCH state re-appears.
        onLastResult(null, null);
      }
      onChanged();
    } finally {
      setCheckingRecovery(false);
    }
  }

  async function doFinalize() {
    const key = pendingObservation.idempotency_key;
    const messageId = pendingObservation.message_id;
    if (!key || !messageId) {
      toast.error("Missing idempotency key or message id for finalize");
      return;
    }
    setResuming(true);
    try {
      const res = await finalizeManualProductionObservation({ messageId, idempotencyKey: key });
      onLastResult(res, key);
      if (res.ok) toast.success("Finalized");
      else toast.error(res.blockers?.[0]?.code ?? "Finalize failed");
      onChanged();
    } finally {
      setResuming(false);
    }
  }

  function doConfirmInbox() {
    confirmSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function decideInbox(decision: "CONFIRMED" | "NOT_RECEIVED") {
    const observationId = pendingObservation.observation_id;
    if (!observationId) return;
    setConfirming(decision);
    try {
      const res = await confirmManualProductionObservation({
        observationId, decision, note: note.trim() || undefined,
      });
      onLastResult(res, pendingObservation.idempotency_key ?? undefined);
      if (res.phase === "CONFIRMED") toast.success("Inbox receipt confirmed");
      else if (res.phase === "NOT_RECEIVED") toast.warning("Recorded as not received");
      else toast.error(res.blockers?.[0]?.code ?? "Confirmation failed");
      onChanged();
    } finally {
      setConfirming(null);
    }
  }

  // Single dispatcher — the primary button always runs the derived action.
  async function runPrimaryAction() {
    switch (derived.action) {
      case "DISPATCH": return doDispatch();
      case "CHECK_RECOVERY": return doCheckRecovery();
      case "FINALIZE": return doFinalize();
      case "CONFIRM_INBOX": return doConfirmInbox();
      case "NONE":
      default:
        return;
    }
  }

  const busy = running || checkingRecovery || resuming;
  const primaryLoading = (derived.action === "DISPATCH" && running)
    || (derived.action === "CHECK_RECOVERY" && checkingRecovery)
    || (derived.action === "FINALIZE" && resuming);
  const stage7 = status?.stage7;
  const showRecipientInput = derived.action === "DISPATCH";
  const primaryDisabled =
    !derived.primaryEnabled ||
    busy ||
    (derived.action === "DISPATCH" && !recipient.trim());

  return (
    <div className="rounded-md border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Send className="h-4 w-4" />
        <div className="font-medium">5. Run a Manual Production observation</div>
        <Badge variant="outline" className="ml-auto">
          observations: {stage7?.manual_observation_count ?? 0}
        </Badge>
      </div>

      {/* Server-authoritative state banner */}
      <Alert>
        <AlertDescription className="text-xs space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Observation state:</span>
            <Badge variant={derived.state === "COMPLETED" ? "default" : "secondary"} className="font-mono">
              {derived.state}
            </Badge>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">Action:</span>
            <Badge variant="outline" className="font-mono">{derived.action}</Badge>
            {derived.blocker && (
              <>
                <span className="text-muted-foreground">Blocker:</span>
                <code className="font-mono">{derived.blocker}</code>
              </>
            )}
          </div>
        </AlertDescription>
      </Alert>

      <details className="rounded-md border border-dashed p-3 text-xs">
        <summary className="cursor-pointer font-medium">Void an empty observation (Checkpoint 0 remediation)</summary>
        <VoidObservationForm onDone={onChanged} />
      </details>

      {derived.state === "COMPLETED" ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <AlertDescription className="text-xs">
            Manual Production observation confirmed. See the evidence block below for
            request, message, delivery-attempt, trace and provider identifiers.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {showRecipientInput && (
            <Input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="approved recipient email (must match recipient policy)"
              disabled={busy}
            />
          )}

          {pendingObservation.transport_unresolved && (
            <Alert variant="destructive">
              <AlertDescription className="space-y-1 text-xs">
                <div>Previous request's outcome is unresolved — a retry would not send another email.</div>
                <div>
                  <span className="text-muted-foreground">Error class:</span>{" "}
                  {pendingObservation.last_transport_error_class ?? "unknown"} · idempotency key{" "}
                  <code className="font-mono">{pendingObservation.idempotency_key ?? "—"}</code>
                </div>
                <div>Use <strong>Check recovery status</strong> to ask the server whether the operation reached it.</div>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-center gap-2">
            <Button
              onClick={runPrimaryAction}
              disabled={primaryDisabled}
              title={derived.blocker ?? undefined}
              data-testid="observation-primary-action"
              data-action={derived.action}
              data-state={derived.state}
            >
              {(primaryLoading || pendingObservation.recovering) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {derived.action === "FINALIZE" && !primaryLoading && <RefreshCcw className="h-4 w-4 mr-2" />}
              {derived.action === "CHECK_RECOVERY" && !primaryLoading && <RefreshCcw className="h-4 w-4 mr-2" />}
              {derived.action === "DISPATCH" && !primaryLoading && <Send className="h-4 w-4 mr-2" />}
              {derived.action === "CONFIRM_INBOX" && <Inbox className="h-4 w-4 mr-2" />}
              {derived.primaryLabel}
            </Button>
            {!derived.primaryEnabled && derived.blocker && (
              <span className="text-xs text-muted-foreground">
                Blocked by <code className="font-mono">{derived.blocker}</code>
              </span>
            )}
          </div>
        </>
      )}

      {phase === "AWAITING_INBOX_CONFIRMATION" && pendingObservation.observation_id && (
        <div ref={confirmSectionRef} className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
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

          {pendingObservation.message_id && (
            <div><span className="text-muted-foreground">Message id:</span> <code className="font-mono text-xs">{pendingObservation.message_id}</code></div>
          )}
          {pendingObservation.request_id && (
            <div><span className="text-muted-foreground">Request id:</span> <code className="font-mono text-xs">{pendingObservation.request_id}</code></div>
          )}
          {pendingObservation.observation_id && (
            <div><span className="text-muted-foreground">Observation id:</span> <code className="font-mono text-xs">{pendingObservation.observation_id}</code></div>
          )}
          {pendingObservation.idempotency_key && (
            <div><span className="text-muted-foreground">Idempotency key:</span> <code className="font-mono text-xs">{pendingObservation.idempotency_key}</code></div>
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

function VoidObservationForm({ onDone }: { onDone: () => void }) {
  const [observationId, setObservationId] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    setErr(null); setBusy(true);
    try {
      const r = await voidManualProductionObservation({ observationId: observationId.trim(), reason: reason.trim(), confirmation });
      if (!r.ok) { setErr(r.error ?? "void_failed"); toast.error(r.error ?? "Void failed"); return; }
      toast.success(r.idempotent ? "Already voided" : "Observation voided");
      setObservationId(""); setReason(""); setConfirmation("");
      onDone();
    } finally { setBusy(false); }
  }
  return (
    <div className="mt-2 space-y-2">
      <div className="text-muted-foreground">
        Refuses to void observations with any provider linkage. Server-enforced.
        Requires the exact phrase: <code>VOID EMPTY OBSERVATION</code>.
      </div>
      <Input value={observationId} onChange={(e) => setObservationId(e.target.value)} placeholder="observation_id (uuid)" disabled={busy} />
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="reason (immutable audit)" disabled={busy} />
      <Input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="type: VOID EMPTY OBSERVATION" disabled={busy} />
      <Button variant="destructive" size="sm" onClick={submit} disabled={busy || !observationId.trim() || !reason.trim() || confirmation !== "VOID EMPTY OBSERVATION"}>
        {busy && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
        Void observation
      </Button>
      {err && <Alert variant="destructive"><AlertDescription><code>{err}</code></AlertDescription></Alert>}
    </div>
  );
}
