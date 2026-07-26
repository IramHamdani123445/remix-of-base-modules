/**
 * Stage 6 — Send One Real Email panel (Slice 2).
 *
 * Actionable Stage 6 surface. Replaces the Slice C locked placeholder.
 *
 * Contract:
 *   - Every authoritative condition is loaded fresh; sessionStorage is never
 *     used to unlock the button.
 *   - The button may be enabled only when every check passes; failed checks
 *     are ALWAYS listed below the button — never silently disabled.
 *   - HTTP 200 is not success. Business outcome is derived from the returned
 *     `one-real-email.v1` envelope only.
 *   - Pre-provider failure with `cleanupProven=true` permits a new run with a
 *     fresh idempotency key; post-provider ambiguity locks resend.
 *   - Manual verification renders only when the strict 7-condition combo is
 *     true after a real provider acceptance.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Loader2,
  Lock,
  MailWarning,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  fetchRealEmailGate,
  type RealEmailGateState,
} from "@/platform/communication-hub/realEmailGateService";
import { checkCommHubReadiness } from "@/platform/communication-hub/readinessService";
import {
  generateOneRealEmailIdempotencyKey,
  invokeSendOneRealEmail,
  ONE_REAL_EMAIL_CONFIRMATION_PHRASE,
  type OneRealEmailEnvelope,
} from "@/platform/communication-hub/oneRealEmailService";
import { resumeOneRealEmailFinalization } from "@/platform/communication-hub/resumeOneRealEmailFinalizationService";
import {
  runStage6ContractProbe,
  type ContractProbeResult,
} from "@/platform/communication-hub/stage6ContractProbe";
import ManualInboxVerificationPanel from "./ManualInboxVerificationPanel";
import RealEmailGateOpenerDialog from "./RealEmailGateOpenerDialog";

export interface OneRealEmailLineage {
  moduleCode: string;
  eventCode: string;
  channel: string;
  previewSnapshotId: string | null;
  previewApprovalId: string;
  dryRunCertificationId: string;
  controlledStubCertificationId: string;
  recipientSetHash: string;
  configurationVersion: number | null;
  recipientPolicyVersion: number | null;
  recipient: string;
  senderName?: string | null;
  senderAddress?: string | null;
  providerName?: string | null;
}

export interface OneRealEmailPanelProps {
  /** True when the Controlled Stub stage has been certified for this event. */
  controlledStubCertified: boolean;
  /** Server-side stage lock reason from `useStageReadiness`, if any. */
  lockReason?: string | null;
  /** Full Stage-6-ready lineage — null when Stage 5 has not completed. */
  lineage: OneRealEmailLineage | null;
  /** Fired every time an execution completes so GoLivePage can persist state. */
  onEnvelope?: (envelope: OneRealEmailEnvelope) => void;
  /** Fired after manual verification succeeds so the parent can mark Stage 6 done. */
  onVerified?: (certificationId: string) => void;
  /** Optional: request the parent re-load the authoritative Stage 6 context. */
  onReloadContext?: () => void;
}

interface ReadinessCheck {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export function OneRealEmailPanel({
  controlledStubCertified,
  lockReason,
  lineage,
  onEnvelope,
  onVerified,
  onReloadContext,
}: OneRealEmailPanelProps) {
  const [gate, setGate] = useState<RealEmailGateState | null>(null);
  const [gateLoading, setGateLoading] = useState(false);
  const [gateOpenerOpen, setGateOpenerOpen] = useState(false);
  const [readinessBlockers, setReadinessBlockers] = useState<string[]>([]);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [probe, setProbe] = useState<ContractProbeResult | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [phrase, setPhrase] = useState("");
  const [ack, setAck] = useState(false);
  const [sending, setSending] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>("");
  const [envelope, setEnvelope] = useState<OneRealEmailEnvelope | null>(null);
  const [resumeBusy, setResumeBusy] = useState(false);

  const showResumeFinalization = !!envelope
    && envelope.providerCallAttempted === true
    && envelope.reconciliationRequired === true
    && envelope.failureStage === "finalization"
    && !envelope.certificationId;

  const handleResumeFinalization = useCallback(async () => {
    if (!envelope?.executionId) {
      toast.error("Execution id missing — cannot resume finalization.");
      return;
    }
    setResumeBusy(true);
    try {
      const res = await resumeOneRealEmailFinalization(envelope.executionId);
      if (!res.ok || !res.certificationId) {
        toast.error(
          res.detail ?? res.error ?? "Resume finalization refused by server.",
        );
        return;
      }
      setEnvelope((prev) => prev ? ({
        ...prev,
        certificationId: res.certificationId,
        certificationKind: "ONE_REAL_EMAIL",
        certificationStatus: res.certificationStatus,
        providerStatus: res.providerStatus ?? prev.providerStatus,
        reconciliationRequired: false,
        failureStage: null,
        status: "PROVIDER_ACCEPTED",
        passed: true,
        message: res.idempotent
          ? "Certification already existed — no changes made."
          : "Finalization resumed successfully. No email was sent.",
      }) : prev);
      toast.success(
        res.idempotent
          ? "Certification already recorded."
          : "Finalization resumed — certification recorded.",
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Resume finalization failed.");
    } finally {
      setResumeBusy(false);
    }
  }, [envelope?.executionId]);

  // (Re)initialise an idempotency key whenever the lineage changes.
  useEffect(() => {
    if (!lineage) {
      setIdempotencyKey("");
      setEnvelope(null);
      return;
    }
    setIdempotencyKey(
      generateOneRealEmailIdempotencyKey(
        lineage.moduleCode,
        lineage.eventCode,
        lineage.channel,
      ),
    );
    setEnvelope(null);
  }, [
    lineage?.moduleCode,
    lineage?.eventCode,
    lineage?.channel,
    lineage?.recipient,
    lineage?.previewApprovalId,
    lineage?.dryRunCertificationId,
    lineage?.controlledStubCertificationId,
  ]);

  const reloadGate = useCallback(async () => {
    if (!lineage) return null;
    setGateLoading(true);
    try {
      const g = await fetchRealEmailGate({
        moduleCode: lineage.moduleCode,
        eventCode: lineage.eventCode,
        channel: lineage.channel,
      });
      setGate(g);
      return g;
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load real-email gate");
      setGate(null);
      return null;
    } finally {
      setGateLoading(false);
    }
  }, [lineage?.moduleCode, lineage?.eventCode, lineage?.channel]);

  useEffect(() => {
    void reloadGate();
  }, [reloadGate]);

  const reloadReadiness = useCallback(async () => {
    if (!lineage) return;
    setReadinessLoading(true);
    try {
      const env = await checkCommHubReadiness({
        moduleCode: lineage.moduleCode,
        eventCode: lineage.eventCode,
        channel: lineage.channel,
        targetStage: "ONE_REAL_EMAIL",
        controlledStubCertificationId: lineage.controlledStubCertificationId ?? null,
      });
      setReadinessBlockers(
        env.ready ? [] : env.blockers.map((b) => b.title || b.message || b.code),
      );
    } catch (e: any) {
      setReadinessBlockers([e?.message ?? "readiness lookup failed"]);
    } finally {
      setReadinessLoading(false);
    }
  }, [
    lineage?.moduleCode,
    lineage?.eventCode,
    lineage?.channel,
    lineage?.controlledStubCertificationId,
  ]);

  useEffect(() => {
    void reloadReadiness();
  }, [reloadReadiness]);

  // Re-evaluate readiness whenever the real-email gate flips or the
  // Stage 6 authoritative context refreshes (probe / gate / context changes).
  useEffect(() => {
    void reloadReadiness();
  }, [gate?.enabled, gate?.openedAt, reloadReadiness]);

  const authoritativeChecks: ReadinessCheck[] = useMemo(() => {
    const checks: ReadinessCheck[] = [
      {
        id: "stage5",
        label: "Controlled Stub (Stage 5) certified for this lineage",
        ok: controlledStubCertified && !!lineage?.controlledStubCertificationId,
        detail: lineage?.controlledStubCertificationId ?? "no active certification",
      },
      {
        id: "gate",
        label: "Real-email feature gate is OPEN for this module/event/channel",
        ok: !!gate?.enabled,
        detail: gate?.enabled
          ? `opened ${gate.openedAt}`
          : "gate is closed",
      },
      {
        id: "recipient",
        label: "Exactly one approved recipient · no CC · no BCC",
        ok: !!lineage?.recipient && lineage.recipient.trim().length > 0,
        detail: lineage?.recipient ?? "unresolved",
      },
      {
        id: "provider",
        label: "Active real provider bound (never provider_stub)",
        ok: !!lineage?.providerName && lineage.providerName !== "provider_stub",
        detail: lineage?.providerName ?? "not resolved",
      },
      {
        id: "sender",
        label: "Active sender profile bound",
        ok: !!lineage?.senderAddress,
        detail: lineage?.senderAddress ?? "not resolved",
      },
      {
        id: "canonical_readiness",
        label: "Canonical ONE_REAL_EMAIL readiness is clean",
        ok: readinessBlockers.length === 0 && !readinessLoading,
        detail:
          readinessBlockers.length === 0
            ? "no blockers"
            : readinessBlockers.slice(0, 3).join(" · "),
      },
      {
        id: "contract_probe",
        label: "Contract probe passed (no execution/grant created)",
        ok: probe?.ok === true,
        detail: probeBusy
          ? "probe running…"
          : probe
            ? probe.ok
              ? "all backend contracts verified"
              : `${probe.checks.filter((c) => !c.ok).length} contract failures`
            : "probe has not run yet",
      },
    ];
    return checks;
  }, [controlledStubCertified, lineage, gate, readinessBlockers, readinessLoading, probe, probeBusy]);

  const inputChecks: ReadinessCheck[] = useMemo(
    () => [
      { id: "reason", label: "Reason (min 8 characters)", ok: reason.trim().length >= 8 },
      {
        id: "phrase",
        label: `Confirmation phrase matches "${ONE_REAL_EMAIL_CONFIRMATION_PHRASE}"`,
        ok: phrase === ONE_REAL_EMAIL_CONFIRMATION_PHRASE,
      },
      { id: "ack", label: "Explicit acknowledgement checked", ok: ack },
    ],
    [reason, phrase, ack],
  );

  const allAuthoritativeOk = authoritativeChecks.every((c) => c.ok);
  const allInputsOk = inputChecks.every((c) => c.ok);

  // Post-execution state: pre-provider cleanup allows a new run; post-provider
  // ambiguity locks resend permanently for the same idempotency key.
  const postProviderAmbiguous =
    envelope !== null &&
    envelope.passed === false &&
    envelope.providerCallAttempted === true &&
    (envelope.reconciliationRequired || envelope.retrySafe === false);
  const preProviderRetryable =
    envelope !== null &&
    envelope.passed === false &&
    envelope.providerCallAttempted === false &&
    envelope.cleanupProven === true;

  const buttonDisabled =
    !controlledStubCertified ||
    !allAuthoritativeOk ||
    !allInputsOk ||
    !lineage ||
    sending ||
    postProviderAmbiguous ||
    (envelope !== null && envelope.passed === true);

  const runProbe = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!lineage) return;
      setProbeBusy(true);
      try {
        const r = await runStage6ContractProbe({
          moduleCode: lineage.moduleCode,
          eventCode: lineage.eventCode,
          channel: lineage.channel,
        });
        setProbe(r);
        if (!opts?.silent) {
          if (!r.ok) toast.error("Contract probe reported failures — see checklist below.");
          else toast.success("Contract probe passed.");
        }
      } catch (e: any) {
        if (!opts?.silent) toast.error(e?.message ?? "Contract probe failed to run");
      } finally {
        setProbeBusy(false);
      }
    },
    [lineage?.moduleCode, lineage?.eventCode, lineage?.channel],
  );

  // Auto-run the read-only contract probe once whenever the authoritative
  // Stage 6 lineage becomes available or changes. It creates no runtime or
  // provider rows. Users can still trigger a manual retry via the button.
  useEffect(() => {
    if (!lineage) {
      setProbe(null);
      return;
    }
    setProbe(null);
    void runProbe({ silent: true });
  }, [
    lineage?.moduleCode,
    lineage?.eventCode,
    lineage?.channel,
    lineage?.controlledStubCertificationId,
    runProbe,
  ]);

  const newRun = useCallback(() => {
    if (!lineage) return;
    setIdempotencyKey(
      generateOneRealEmailIdempotencyKey(
        lineage.moduleCode,
        lineage.eventCode,
        lineage.channel,
      ),
    );
    setEnvelope(null);
    setReason("");
    setPhrase("");
    setAck(false);
  }, [lineage]);

  const send = useCallback(async () => {
    if (!lineage || buttonDisabled) return;
    setSending(true);
    try {
      const env = await invokeSendOneRealEmail({
        moduleCode: lineage.moduleCode,
        eventCode: lineage.eventCode,
        channel: lineage.channel,
        recipient: lineage.recipient,
        previewSnapshotId: lineage.previewSnapshotId,
        previewApprovalId: lineage.previewApprovalId,
        dryRunCertificationId: lineage.dryRunCertificationId,
        controlledStubCertificationId: lineage.controlledStubCertificationId,
        recipientSetHash: lineage.recipientSetHash,
        configurationVersion: lineage.configurationVersion,
        recipientPolicyVersion: lineage.recipientPolicyVersion,
        idempotencyKey,
        reason: reason.trim(),
      });
      setEnvelope(env);
      onEnvelope?.(env);
      if (env.passed) toast.success("Provider accepted the send. Verify inbox receipt.");
      else toast.error(env.blockers[0]?.message ?? env.message ?? "Send was blocked.");
    } catch (e: any) {
      toast.error(e?.message ?? "Send failed");
    } finally {
      setSending(false);
    }
  }, [lineage, buttonDisabled, idempotencyKey, reason, onEnvelope]);

  // -------------- rendering --------------

  if (!controlledStubCertified) {
    return (
      <Alert>
        <Lock className="h-4 w-4" />
        <AlertTitle className="flex items-center gap-2">
          Locked
          <Badge variant="outline">SEND_ONE_REAL_EMAIL</Badge>
        </AlertTitle>
        <AlertDescription>
          {lockReason ??
            "Complete the Controlled Stub certification first. The real-provider gate is not opened from this page."}
        </AlertDescription>
      </Alert>
    );
  }

  if (!lineage) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Lineage not resolved</AlertTitle>
        <AlertDescription>
          Stage 5 certification is present but the panel could not receive the
          full lineage (module/event/channel/recipient/preview/dry-run/stub ids).
          Refresh the page.
        </AlertDescription>
      </Alert>
    );
  }

  const showManualVerification =
    envelope !== null &&
    envelope.action === "SEND_ONE_REAL_EMAIL" &&
    envelope.providerMode === "real" &&
    envelope.sendContext === "REAL_EMAIL" &&
    envelope.realEmailAuthorised === true &&
    envelope.providerCallAttempted === true &&
    envelope.certificationKind === "ONE_REAL_EMAIL" &&
    (envelope.status === "PROVIDER_ACCEPTED" || envelope.status === "DELIVERY_PENDING") &&
    !!envelope.certificationId;

  return (
    <div className="space-y-4">
      {/* Context (read-only) */}
      <div className="grid gap-2 rounded-md border border-border/60 p-3 text-xs md:grid-cols-2">
        <div><span className="text-muted-foreground">Module / Event:</span> <code>{lineage.moduleCode}</code> / <code>{lineage.eventCode}</code></div>
        <div><span className="text-muted-foreground">Channel:</span> <code>{lineage.channel}</code></div>
        <div><span className="text-muted-foreground">Recipient:</span> <code>{lineage.recipient}</code></div>
        <div><span className="text-muted-foreground">CC / BCC:</span> none · none</div>
        <div><span className="text-muted-foreground">Sender:</span> {lineage.senderName ?? "—"} &lt;{lineage.senderAddress ?? "—"}&gt;</div>
        <div><span className="text-muted-foreground">Provider:</span> {lineage.providerName ?? "—"}</div>
        <div><span className="text-muted-foreground">Controlled Stub cert:</span> <code className="font-mono text-[10px]">{lineage.controlledStubCertificationId}</code></div>
        <div><span className="text-muted-foreground">Preview approval:</span> <code className="font-mono text-[10px]">{lineage.previewApprovalId}</code></div>
        <div><span className="text-muted-foreground">Dry Run cert:</span> <code className="font-mono text-[10px]">{lineage.dryRunCertificationId}</code></div>
        <div><span className="text-muted-foreground">Idempotency key:</span> <code className="font-mono text-[10px]">…{idempotencyKey.slice(-16)}</code></div>
      </div>

      {/* Gate state */}
      <div className="flex items-center gap-2">
        <Badge variant={gate?.enabled ? "default" : "outline"}>
          {gate?.enabled ? "Real-email gate OPEN" : "Real-email gate CLOSED"}
        </Badge>
        <Button size="sm" variant="ghost" onClick={reloadGate} disabled={gateLoading}>
          {gateLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
        <Button
          size="sm"
          variant={gate?.enabled ? "outline" : "default"}
          onClick={() => setGateOpenerOpen(true)}
        >
          <KeyRound className="h-4 w-4 mr-1" />
          {gate?.enabled ? "Close gate" : "Open real-email gate"}
        </Button>
      </div>

      {/* Contract probe */}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => runProbe()} disabled={probeBusy}>
          {probeBusy && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
          {!probeBusy && <ShieldCheck className="h-4 w-4 mr-1" />}
          Run contract probe
        </Button>
        {probe && (
          <Badge variant={probe.ok ? "default" : "destructive"}>
            {probe.ok ? "Contract OK" : `${probe.checks.filter((c) => !c.ok).length} failures`}
          </Badge>
        )}
      </div>
      {probe && !probe.ok && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Contract probe failures</AlertTitle>
          <AlertDescription>
            <ul className="text-xs list-disc pl-4 space-y-1">
              {probe.checks
                .filter((c) => !c.ok)
                .map((c) => (
                  <li key={c.id}>
                    <strong>{c.label}</strong>: {c.detail}
                  </li>
                ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Separator />

      {/* Operator inputs */}
      <div className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Reason for the real send (min 8 characters)</Label>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            Type <code>{ONE_REAL_EMAIL_CONFIRMATION_PHRASE}</code> to confirm
          </Label>
          <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder={ONE_REAL_EMAIL_CONFIRMATION_PHRASE} />
        </div>
        <label className="flex items-start gap-2 text-xs">
          <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} />
          <span>
            I understand that this action will invoke the configured real email
            provider once for the displayed recipient.
          </span>
        </label>
      </div>

      <Button onClick={send} disabled={buttonDisabled}>
        {sending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
        Send One Real Email
      </Button>

      {/* Stage 6 readiness checklist — always visible; only failed checks
          render in red. Inline actions appear beside actionable blockers. */}
      <div className="rounded-md border border-border/60 p-3">
        <div className="text-xs font-semibold mb-2">Stage 6 readiness checklist</div>
        <ul className="text-xs space-y-1">
          {[...authoritativeChecks, ...inputChecks].map((c) => {
            const inlineAction =
              !c.ok && c.id === "gate" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-2 h-6 px-2 text-[11px]"
                  onClick={() => setGateOpenerOpen(true)}
                >
                  <KeyRound className="h-3 w-3 mr-1" /> Open real-email gate
                </Button>
              ) : !c.ok && c.id === "contract_probe" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-2 h-6 px-2 text-[11px]"
                  onClick={() => runProbe()}
                  disabled={probeBusy}
                >
                  {probeBusy ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <ShieldCheck className="h-3 w-3 mr-1" />
                  )}
                  Run contract probe
                </Button>
              ) : null;
            return (
              <li key={c.id} className="flex items-start gap-2">
                {c.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 mt-0.5" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5" />
                )}
                <span className={c.ok ? "" : "text-destructive"}>
                  <strong>{c.label}</strong>
                  {c.detail && (
                    <span className={c.ok ? "text-muted-foreground" : "text-destructive/80"}>
                      {" "}
                      — {c.detail}
                    </span>
                  )}
                  {inlineAction}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Result / retry UX */}
      {envelope && (
        <div className="space-y-3">
          <Separator />
          <div className="text-sm font-semibold">Execution result</div>
          <div className="grid gap-1 text-xs md:grid-cols-2">
            <div>Status: <Badge variant={envelope.passed ? "default" : "destructive"}>{envelope.status}</Badge></div>
            <div>Runtime build: <code className="font-mono text-[10px] break-all">{envelope.runtimeBuild}</code></div>
            <div>Failure stage: <code>{envelope.failureStage ?? "—"}</code></div>
            <div>Provider called: <code>{String(envelope.providerCallAttempted)}</code></div>
            <div>Retry safe: <code>{String(envelope.retrySafe)}</code></div>
            <div>Automatic retry allowed: <code>{String(envelope.automaticRetryAllowed)}</code></div>
            <div>Cleanup proven: <code>{String(envelope.cleanupProven)}</code></div>
            <div>Reconciliation required: <code>{String(envelope.reconciliationRequired)}</code></div>
            <div>Provider status: <code>{envelope.providerStatus ?? "—"}</code></div>
            <div>Provider msg id: <code className="font-mono">{envelope.providerMessageId ?? "—"}</code></div>
            <div>Grant status: <code>{envelope.grantStatus ?? "—"}</code></div>
            <div>Execution id: <code className="font-mono text-[10px]">{envelope.executionId ?? "—"}</code></div>
            <div>Delivery attempt id: <code className="font-mono text-[10px]">{envelope.deliveryAttemptId ?? "—"}</code></div>
            <div>Trace id: <code className="font-mono text-[10px]">{envelope.traceId ?? "—"}</code></div>
            <div>Certification: <code className="font-mono text-[10px]">{envelope.certificationId ?? "—"}</code> ({envelope.certificationStatus ?? "—"})</div>
          </div>

          {envelope.blockers.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Execution blockers</AlertTitle>
              <AlertDescription>
                <ul className="mt-2 space-y-2 text-xs">
                  {envelope.blockers.map((blocker, index) => (
                    <li key={`${blocker.code}-${blocker.stage}-${index}`} className="space-y-1">
                      <div>
                        <code>{blocker.code}</code> · <code>{blocker.stage}</code>
                        {blocker.message ? ` — ${blocker.message}` : ""}
                      </div>
                      {blocker.detail !== undefined && (
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-muted p-2 text-[10px] text-muted-foreground">
                          {typeof blocker.detail === "string"
                            ? blocker.detail
                            : JSON.stringify(blocker.detail, null, 2)}
                        </pre>
                      )}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {preProviderRetryable && (
            <Alert>
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Pre-provider failure — cleanup proven</AlertTitle>
              <AlertDescription>
                No provider call occurred and the grant was safely revoked. You
                may start a new Stage 6 run with a fresh idempotency key. The
                failed execution is preserved as audit evidence.
                <div className="mt-2">
                  <Button size="sm" onClick={newRun}>Start New Stage 6 Run</Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {postProviderAmbiguous && (
            <Alert variant="destructive">
              <MailWarning className="h-4 w-4" />
              <AlertTitle>Provider operation may have occurred</AlertTitle>
              <AlertDescription>
                Reconciliation is required (<code>reconciliation_required=true</code>).
                Automatic retry is disabled. Do not click New Run. Preserve the
                execution, message, attempt, and trace ids for reconciliation.
              </AlertDescription>
            </Alert>
          )}

          {envelope.status === "DELIVERY_PENDING" && (
            <Alert variant="destructive">
              <MailWarning className="h-4 w-4" />
              <AlertTitle>Delivery pending — no retry action offered</AlertTitle>
              <AlertDescription>
                The provider accepted the message but final delivery is still
                pending. Automatic retry is disabled and no New Run action is
                available. Wait for the asynchronous delivery evidence to arrive
                and preserve the execution, message, attempt and trace ids.
              </AlertDescription>
            </Alert>
          )}

          {envelope.status === "PROVIDER_REJECTED" && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertTitle>Provider rejected the send</AlertTitle>
              <AlertDescription>
                The provider was invoked but rejected the message. The grant
                remains consumed. Do not attempt a second automatic send.
              </AlertDescription>
            </Alert>
          )}

          {showManualVerification && envelope.certificationId && (
            <ManualInboxVerificationPanel
              certificationId={envelope.certificationId}
              expectedRecipient={lineage.recipient}
              onVerified={(row) => {
                if (row.manualVerificationStatus === "DELIVERY_CONFIRMED_MANUALLY") {
                  onVerified?.(row.id);
                }
              }}
            />
          )}
        </div>
      )}

      <RealEmailGateOpenerDialog
        open={gateOpenerOpen}
        onOpenChange={setGateOpenerOpen}
        moduleCode={lineage.moduleCode}
        eventCode={lineage.eventCode}
        channel={lineage.channel}
        currentlyEnabled={!!gate?.enabled}
        onChanged={async (next) => {
          setGate(next);
          const confirmed = await reloadGate();
          if (!confirmed?.enabled && next.enabled) {
            toast.error(
              "Gate update succeeded but authoritative read-back did not confirm it.",
            );
            return;
          }
          await reloadReadiness();
          await onReloadContext?.();
        }}
      />
    </div>
  );
}

export default OneRealEmailPanel;
