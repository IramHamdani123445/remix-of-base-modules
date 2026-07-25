/**
 * CH-SIMPLE-P3E-C — Reusable ControlledLivePanel.
 *
 * The single operator surface for a controlled-live email test. It is
 * intentionally NOT registered as a top-level route — it is embedded in
 * the Pilots page today and will be embedded in the future unified Go
 * Live workflow.
 *
 * The panel:
 *   - Displays server-authoritative prerequisites (recipient policy,
 *     preview approval, dry-run certification, template/sender/provider
 *     readiness, emergency stop). It does NOT recompute readiness.
 *   - Loads the recipient from the canonical Recipient Policy record.
 *     No fixed recipient or domain exists in this component.
 *   - Requires reason + typed confirmation "SEND ONE CONTROLLED LIVE EMAIL"
 *     + explicit acknowledgement checkbox.
 *   - Calls ONE server function: `comm-hub-controlled-live-test`.
 *   - Never invokes the dispatcher, grant, or mode-transition RPCs directly.
 *   - Never displays "Enqueued" as a final success.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ShieldCheck,
  AlertTriangle,
  XCircle,
  Loader2,
  ChevronDown,
  Mail,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { resolveAuthErrorMessage } from "@/platform/communication-hub/authErrorMessages";
import BlockersList from "@/pages/admin/communicationHub/safety/BlockersList";
import {
  runControlledLiveTest,
  CONTROLLED_LIVE_CONFIRMATION_PHRASE,
  type ControlledLiveTestResult,
} from "@/platform/communication-hub/controlledLiveTestService";
import {
  fetchRecipientPolicy,
  type RecipientPolicy,
} from "@/platform/communication-hub/recipientPolicyService";
import {
  getControlledLiveCertification,
  recordControlledLiveManualVerification,
  type ControlledLiveCertification,
} from "@/platform/communication-hub/controlledLiveCertificationService";

export const CONTROLLED_LIVE_PANEL_CONFIRMATION_PHRASE =
  "SEND ONE CONTROLLED LIVE EMAIL";

export interface ControlledLivePanelProps {
  moduleCode: string;
  eventCode: string;
  channel?: "email";
  /** Locked preview snapshot id (issued by preview approval). */
  previewSnapshotId: string | null;
  /** Locked preview approval id (required). */
  previewApprovalId: string | null;
  /** Whether the preview is currently approved. */
  previewApproved: boolean;
  /** Locked dry-run certification id (required). */
  dryRunCertificationId: string | null;
  /** Whether the dry-run certification is currently valid. */
  dryRunCertified: boolean;
  /** Canonical send-decision passed down from the workflow. */
  canonicalDecision: {
    ready: boolean;
    blockers?: Array<{ code: string; stage?: string; severity?: string; message?: string }>;
    warnings?: Array<{ code: string; message?: string }>;
  } | null;
  /** Current operating mode from `communication_hub_control_settings`. */
  operatingMode: string | null;
  /** Optional templateData passed into the render. */
  data?: Record<string, unknown>;
  /** Optional callback invoked once the run reaches a final state. */
  onCompleted?: (result: ControlledLiveTestResult) => void;
}

type Phase = "idle" | "running" | "final";

interface PrereqRow {
  key: string;
  label: string;
  status: "Ready" | "Blocked" | "Loading" | "Unknown";
  fixHref?: string;
  detail?: string;
}

function StatusBadge({ status }: { status: PrereqRow["status"] }) {
  if (status === "Ready") return <Badge variant="default">Ready</Badge>;
  if (status === "Blocked") return <Badge variant="destructive">Blocked</Badge>;
  if (status === "Loading") return <Badge variant="outline">Loading…</Badge>;
  return <Badge variant="outline">Unknown</Badge>;
}

function mintIdempotencyKey(): string {
  // browsers with crypto.randomUUID
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `clive-${(crypto as any).randomUUID()}`;
  }
  return `clive-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ControlledLivePanel(props: ControlledLivePanelProps) {
  const {
    moduleCode,
    eventCode,
    channel = "email",
    previewSnapshotId,
    previewApprovalId,
    previewApproved,
    dryRunCertificationId,
    dryRunCertified,
    canonicalDecision,
    operatingMode,
    data,
    onCompleted,
  } = props;

  const idempotencyRef = useRef<string | null>(null);
  if (!idempotencyRef.current) idempotencyRef.current = mintIdempotencyKey();

  const [policy, setPolicy] = useState<RecipientPolicy | null>(null);
  const [policyErr, setPolicyErr] = useState<string | null>(null);
  const [selectedRecipient, setSelectedRecipient] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [confirmationPhrase, setConfirmationPhrase] = useState<string>("");
  const [acknowledged, setAcknowledged] = useState<boolean>(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<ControlledLiveTestResult | null>(null);
  const [technicalOpen, setTechnicalOpen] = useState(false);

  const [certification, setCertification] =
    useState<ControlledLiveCertification | null>(null);
  const [certLoading, setCertLoading] = useState(false);
  const [certError, setCertError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyNote, setVerifyNote] = useState("");

  async function loadCertification(certId: string) {
    setCertLoading(true);
    setCertError(null);
    try {
      const cert = await getControlledLiveCertification(certId);
      setCertification(cert);
      if (!cert) {
        setCertError(
          `Certification ${certId} was created by the server but could not be read back. Verify your role has access.`,
        );
      }
    } catch (e: any) {
      setCertError(e?.message ?? "Failed to load certification record.");
    } finally {
      setCertLoading(false);
    }
  }


  useEffect(() => {
    let mounted = true;
    fetchRecipientPolicy()
      .then((p) => {
        if (!mounted) return;
        setPolicy(p);
        if (p.activeMode === "SINGLE_CONFIGURED_RECIPIENT" && p.singleConfiguredAddress) {
          setSelectedRecipient(p.singleConfiguredAddress);
        }
      })
      .catch((e) => mounted && setPolicyErr(e?.message ?? "failed to load recipient policy"));
    return () => {
      mounted = false;
    };
  }, []);

  // --- Prerequisites -----------------------------------------------------
  const emergencyStopActive = operatingMode === "EMERGENCY_STOP";
  const modeSupportsControlledLive =
    operatingMode === "DRY_RUN" || operatingMode === "CONTROLLED_LIVE";

  const decisionBlockersByStage = useMemo(() => {
    const map: Record<string, string[]> = {};
    (canonicalDecision?.blockers ?? []).forEach((b) => {
      const s = b.stage ?? "other";
      map[s] = map[s] ?? [];
      map[s].push(b.code);
    });
    return map;
  }, [canonicalDecision]);

  const prereqRows: PrereqRow[] = useMemo(() => {
    const policyReady =
      !!policy &&
      (policy.activeMode === "SINGLE_CONFIGURED_RECIPIENT" ||
        policy.activeMode === "APPROVED_NAMED_RECIPIENTS");
    const provBlocked = (decisionBlockersByStage["provider"] ?? []).length > 0;
    const senderBlocked = (decisionBlockersByStage["sender"] ?? []).length > 0;
    const templateBlocked = (decisionBlockersByStage["template"] ?? []).length > 0;

    return [
      {
        key: "recipient_policy",
        label: "Recipient Policy",
        status: policy === null && !policyErr ? "Loading" : policyReady ? "Ready" : "Blocked",
        fixHref: "/admin/communication-hub/recipient-policy",
        detail: policy ? `Active mode: ${policy.activeMode}` : policyErr ?? undefined,
      },
      {
        key: "preview_approval",
        label: "Preview Approval",
        status: previewApproved && previewApprovalId ? "Ready" : "Blocked",
        fixHref: "/admin/communication-hub/pilots",
        detail: previewApprovalId ? `id: ${previewApprovalId.slice(0, 8)}…` : "not approved",
      },
      {
        key: "dry_run_certification",
        label: "Dry-Run Certification",
        status: dryRunCertified && dryRunCertificationId ? "Ready" : "Blocked",
        fixHref: "/admin/communication-hub/pilots",
        detail: dryRunCertificationId
          ? `id: ${dryRunCertificationId.slice(0, 8)}…`
          : "no valid certification",
      },
      {
        key: "template",
        label: "Template",
        status: templateBlocked ? "Blocked" : "Ready",
        fixHref: "/admin/communication-hub/design",
      },
      {
        key: "sender",
        label: "Sender",
        status: senderBlocked ? "Blocked" : "Ready",
        fixHref: "/admin/communication-hub/senders",
      },
      {
        key: "provider",
        label: "Provider",
        status: provBlocked ? "Blocked" : "Ready",
        fixHref: "/admin/communication-hub/providers",
      },
      {
        key: "emergency_stop",
        label: "Emergency Stop",
        status: emergencyStopActive ? "Blocked" : "Ready",
        fixHref: "/admin/communication-hub/governance",
        detail: emergencyStopActive ? "Active — clear before running" : "Clear",
      },
      {
        key: "operating_mode",
        label: "Operating Mode",
        status: modeSupportsControlledLive ? "Ready" : "Blocked",
        detail: operatingMode ?? "unknown",
      },
    ];
  }, [
    policy,
    policyErr,
    previewApproved,
    previewApprovalId,
    dryRunCertified,
    dryRunCertificationId,
    decisionBlockersByStage,
    emergencyStopActive,
    modeSupportsControlledLive,
    operatingMode,
  ]);

  const allPrereqsReady = prereqRows.every((r) => r.status === "Ready");

  // --- Recipient selection ----------------------------------------------
  const namedOptions = useMemo(
    () =>
      (policy?.approvedNamedAddresses ?? []).filter((a) => a.active).map((a) => a.address),
    [policy],
  );

  const recipientLocked =
    policy?.activeMode === "SINGLE_CONFIGURED_RECIPIENT" &&
    !!policy.singleConfiguredAddress;

  // --- Send readiness ---------------------------------------------------
  const canSend =
    phase === "idle" &&
    allPrereqsReady &&
    !!previewApprovalId &&
    !!dryRunCertificationId &&
    !!canonicalDecision?.ready &&
    !!selectedRecipient &&
    confirmationPhrase.trim() === CONTROLLED_LIVE_PANEL_CONFIRMATION_PHRASE &&
    reason.trim().length >= 8 &&
    acknowledged;

  async function handleSend() {
    if (!canSend) return;
    setPhase("running");
    setResult(null);
    setCertification(null);

    try {
      const r = await runControlledLiveTest({
        action: "RUN_CONTROLLED_STUB",
        moduleCode,
        eventCode,
        channel,
        recipient: selectedRecipient,
        previewApprovalId: previewApprovalId!,
        previewSnapshotId: previewSnapshotId ?? undefined,
        dryRunCertificationId: dryRunCertificationId!,
        idempotencyKey: idempotencyRef.current!,
        reason: reason.trim(),
        confirmation: CONTROLLED_LIVE_CONFIRMATION_PHRASE,
        data,
      });
      setResult(r);
      setPhase("final");
      onCompleted?.(r);

      // Surface auth-stage envelope failures with a friendly message.
      const authMsg = resolveAuthErrorMessage(r as any);
      if (authMsg) toast.error(authMsg);

      // If the orchestrator recorded a certification, load it (surface errors).
      const certId = (r as any).certification_id ?? (r as any).certificationId ?? null;
      if (certId) {
        await loadCertification(certId);
      }
    } catch (e: any) {
      const authMsg = resolveAuthErrorMessage(e);
      toast.error(authMsg ?? e?.message ?? "controlled-live request failed");
      setPhase("idle");
    }
  }

  function handleReset() {
    if (phase !== "final") return;
    // Ambiguous outcomes and server-marked unsafe outcomes must NOT be
    // freshly re-run without deliberate remediation.
    if (result && result.retrySafe === false && !result.passed) return;
    idempotencyRef.current = mintIdempotencyKey();
    setResult(null);
    setCertification(null);
    setCertError(null);
    setConfirmationPhrase("");
    setAcknowledged(false);
    setReason("");
    setPhase("idle");
  }


  const ambiguous = result?.status === "DELIVERY_PENDING";
  const resetBlocked =
    phase === "final" && !!result && result.retrySafe === false && !result.passed;

  return (
    <div className="space-y-4">
      {/* A. Prerequisites */}
      <section className="rounded-md border p-3 space-y-2">
        <div className="text-sm font-medium">Prerequisites</div>
        <div className="text-xs text-muted-foreground">
          Readiness is server-authoritative. The panel does not recompute
          eligibility.
        </div>
        <div className="text-xs text-muted-foreground">
          Transport mode is confirmed by the server result. A provider stub is
          a simulation and does not deliver a real email.
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
          {prereqRows.map((row) => (
            <div
              key={row.key}
              className="flex items-center justify-between rounded border p-2 text-sm"
            >
              <div className="flex flex-col">
                <span className="font-medium">{row.label}</span>
                {row.detail && (
                  <span className="text-xs text-muted-foreground">{row.detail}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={row.status} />
                {row.status === "Blocked" && row.fixHref && (
                  <a
                    href={row.fixHref}
                    className="text-xs underline text-primary"
                  >
                    Fix now
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
        {canonicalDecision && !canonicalDecision.ready && (
          <BlockersList
            codes={(canonicalDecision.blockers ?? []).map((b) => b.code)}
            title="Blockers reported by the canonical send-decision"
            compact
          />
        )}
      </section>

      {/* B. Recipient */}
      <section className="rounded-md border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Recipient</div>
          {policy && <Badge variant="outline">{policy.activeMode}</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">
          Loaded from the Communication Hub Recipient Policy — nothing is
          hardcoded in this panel. Exactly one To recipient. No CC. No BCC.
        </div>
        {policyErr && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Recipient policy unavailable</AlertTitle>
            <AlertDescription>{policyErr}</AlertDescription>
          </Alert>
        )}
        {policy && recipientLocked && (
          <div className="rounded border bg-muted/40 px-3 py-2 font-mono text-sm">
            To: {policy.singleConfiguredAddress}
          </div>
        )}
        {policy && !recipientLocked && policy.activeMode === "APPROVED_NAMED_RECIPIENTS" && (
          <div className="space-y-1">
            <Label htmlFor="clive-recipient">Approved recipient</Label>
            <select
              id="clive-recipient"
              className="w-full border rounded px-2 py-1 text-sm bg-background"
              value={selectedRecipient}
              onChange={(e) => setSelectedRecipient(e.target.value)}
              disabled={phase !== "idle"}
            >
              <option value="">— select —</option>
              {namedOptions.map((addr) => (
                <option key={addr} value={addr}>
                  {addr}
                </option>
              ))}
            </select>
          </div>
        )}
        {policy &&
          !recipientLocked &&
          policy.activeMode !== "APPROVED_NAMED_RECIPIENTS" && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>
                Policy mode not permitted for controlled-live testing
              </AlertTitle>
              <AlertDescription>
                Controlled-live testing requires
                SINGLE_CONFIGURED_RECIPIENT or APPROVED_NAMED_RECIPIENTS.
                Update the recipient policy before proceeding.
              </AlertDescription>
            </Alert>
          )}
      </section>

      {/* C. Confirmation */}
      <section className="rounded-md border p-3 space-y-3">
        <div className="text-sm font-medium">Confirmation</div>
        <div className="space-y-1">
          <Label htmlFor="clive-reason">
            Reason (required, min 8 chars)
          </Label>
          <Textarea
            id="clive-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Initial certified controlled-live send for pension award notice"
            disabled={phase !== "idle"}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="clive-phrase">
            Type{" "}
            <code className="font-mono">
              {CONTROLLED_LIVE_PANEL_CONFIRMATION_PHRASE}
            </code>{" "}
            to confirm
          </Label>
          <Input
            id="clive-phrase"
            value={confirmationPhrase}
            onChange={(e) => setConfirmationPhrase(e.target.value)}
            placeholder={CONTROLLED_LIVE_PANEL_CONFIRMATION_PHRASE}
            disabled={phase !== "idle"}
          />
        </div>
        <div className="flex items-start gap-2">
          <Checkbox
            id="clive-ack"
            checked={acknowledged}
            onCheckedChange={(v) => setAcknowledged(v === true)}
            disabled={phase !== "idle"}
          />
          <Label htmlFor="clive-ack" className="text-sm font-normal">
            I acknowledge that clicking Send will attempt ONE controlled-live
            provider operation for <span className="font-mono">{selectedRecipient || "—"}</span>.
            The server-reported provider mode determines whether this is a stub
            simulation or a real email, and the action is audited.
          </Label>
        </div>
      </section>

      {/* D. Send */}
      <section className="rounded-md border p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Button
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send One Controlled Live Test"
          >
            {phase === "running" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Mail className="mr-2 h-4 w-4" />
                Send One Controlled Live Test
              </>
            )}
          </Button>
          {phase === "final" && !ambiguous && (
            <Button variant="outline" onClick={handleReset} disabled={resetBlocked}>
              New Run
            </Button>
          )}
          <div className="text-xs text-muted-foreground ml-auto font-mono">
            key: {idempotencyRef.current?.slice(0, 12)}…
          </div>
        </div>
        {!canSend && phase === "idle" && (
          <div className="text-xs text-muted-foreground">
            Send is disabled until every prerequisite is Ready, a recipient is
            selected, the confirmation phrase is typed exactly, a reason is
            entered, and the acknowledgement is checked.
          </div>
        )}
        {ambiguous && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Delivery pending — do not send again</AlertTitle>
            <AlertDescription>
              Provider outcome is unconfirmed. No automatic retry has been
              performed. Verify the provider dashboard and recipient inbox
              before any further action.
            </AlertDescription>
          </Alert>
        )}
        {resetBlocked && !ambiguous && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Outcome not retry-safe</AlertTitle>
            <AlertDescription>
              The server marked this attempt as unsafe to re-run automatically.
              Investigate the blockers, correct the underlying configuration,
              then reload this page to start a new attempt.
            </AlertDescription>
          </Alert>
        )}
      </section>

      {/* E. Result */}
      {phase === "final" && result && <FinalResult result={result} />}

      {/* E.1 Stub-run notice — a stub is a simulator, no real email is sent. */}
      {phase === "final" &&
        result &&
        result.providerMode === "stub" &&
        (result.status === "PROVIDER_ACCEPTED" ||
          result.status === "DELIVERED" ||
          result.status === "DELIVERY_PENDING") && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Controlled Stub completed successfully</AlertTitle>
            <AlertDescription>
              This was a simulation; no real email was sent and inbox
              verification is not required.
            </AlertDescription>
          </Alert>
        )}

      {/* F. Evidence + Manual verification */}
      {phase === "final" && result && (
        <EvidenceCard
          result={result}
          certification={certification}
          certLoading={certLoading}
          certError={certError}
          onRetryCertLoad={() => {
            const certId =
              (result as any).certification_id ??
              (result as any).certificationId ??
              null;
            if (certId) loadCertification(certId);
          }}
          technicalOpen={technicalOpen}
          setTechnicalOpen={setTechnicalOpen}
        />
      )}

      {/* Manual inbox verification — ONLY for real-provider sends that were
          authorised and accepted. Stub simulations must never show this. */}
      {phase === "final" &&
        result &&
        result.action === "SEND_ONE_REAL_EMAIL" &&
        result.providerMode === "real" &&
        result.realEmailAuthorised === true &&
        (result.status === "PROVIDER_ACCEPTED" ||
          result.status === "DELIVERY_PENDING") && (
          <ManualVerificationCard
            certification={certification}
            verifying={verifying}
            verifyNote={verifyNote}
            setVerifyNote={setVerifyNote}
            onSubmit={async (received) => {
              if (!certification) {
                toast.error(
                  "No certification recorded yet — cannot record manual verification.",
                );
                return;
              }
              setVerifying(true);
              try {
                const r = await recordControlledLiveManualVerification({
                  certificationId: certification.id,
                  received,
                  verifiedRecipient: received ? selectedRecipient : undefined,
                  note: verifyNote || undefined,
                });
                toast.success(
                  received
                    ? "Manual delivery confirmation recorded."
                    : "Recorded as not received.",
                );
                const fresh = await getControlledLiveCertification(
                  r.certificationId,
                );
                if (fresh) setCertification(fresh);
              } catch (e: any) {
                toast.error(e?.message ?? "manual verification failed");
              } finally {
                setVerifying(false);
              }
            }}
          />
        )}
    </div>
  );
}


function FinalResult({ result }: { result: ControlledLiveTestResult }) {
  const s = result.status;
  const positive =
    s === "PROVIDER_ACCEPTED" || s === "DELIVERY_PENDING" || s === "DELIVERED";
  return (
    <section className="space-y-2">
      {s === "DELIVERED" && (
        <Alert>
          <ShieldCheck className="h-4 w-4 text-green-600" />
          <AlertTitle className="text-green-700">
            Delivered — authoritative provider evidence received.
          </AlertTitle>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}
      {s === "PROVIDER_ACCEPTED" && (
        <Alert>
          <ShieldCheck className="h-4 w-4 text-green-600" />
          <AlertTitle className="text-green-700">
            Provider accepted the message.
          </AlertTitle>
          <AlertDescription>
            The provider has accepted the message. Provider acceptance is
            NOT the same as delivery — verify the inbox below to complete
            certification.
          </AlertDescription>
        </Alert>
      )}
      {s === "DELIVERY_PENDING" && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Delivery pending — outcome unconfirmed</AlertTitle>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}
      {s === "PROVIDER_REJECTED" && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Provider rejected the message</AlertTitle>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}
      {s === "BLOCKED" && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Blocked before provider call</AlertTitle>
          <AlertDescription>
            No provider call was attempted. Correct the blockers listed
            below and start a new run.
          </AlertDescription>
        </Alert>
      )}
      {(s === "FAILED" || s === "DISPATCH_FAILED" || s === "ENQUEUE_FAILED") && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Failed — {result.failureStage ?? "unknown stage"}</AlertTitle>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}
      {result.blockers.length > 0 && (
        <BlockersList codes={result.blockers.map((b) => b.code)} />
      )}
      {!positive && result.cleanupSucceeded === false && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Cleanup did NOT succeed</AlertTitle>
          <AlertDescription>
            Operating-mode restoration failed. Do not attempt another run
            until an administrator engages Emergency Stop or confirms live
            sending is disabled.
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}

function EvidenceCard({
  result,
  certification,
  technicalOpen,
  setTechnicalOpen,
}: {
  result: ControlledLiveTestResult;
  certification: ControlledLiveCertification | null;
  technicalOpen: boolean;
  setTechnicalOpen: (v: boolean) => void;
}) {
  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="text-sm font-medium">Operator evidence</div>
      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <Row label="Execution number" value={result.executionNo?.toString()} />
        <Row label="Request number" value={result.requestNumber} />
        <Row label="Message ID" value={result.messageId} mono />
        <Row label="Delivery attempt ID" value={result.deliveryAttemptId} mono />
        <Row label="Trace ID" value={result.traceId} mono />
        <Row label="Provider" value={result.providerName} />
        <Row label="Provider mode" value={result.providerMode} />
        <Row label="Provider message ID" value={result.providerMessageId} mono />
        <Row
          label="Provider call attempted"
          value={result.providerCallAttempted ? "Yes" : "No"}
        />
        <Row label="Provider status" value={result.providerStatus} />
        <Row label="Grant status" value={result.grantStatus} />
        <Row label="Preview approval ID" value={result.previewApprovalId} mono />
        <Row
          label="Dry-run certification ID"
          value={result.dryRunCertificationId}
          mono
        />
        <Row label="Prior operating mode" value={result.priorOperatingMode} />
        <Row label="Final operating mode" value={result.finalOperatingMode} />
        <Row
          label="Cleanup result"
          value={
            result.cleanupSucceeded === null
              ? null
              : result.cleanupSucceeded
                ? "Restored"
                : "FAILED — investigate"
          }
        />
        <Row label="Started at" value={result.startedAt} />
        <Row label="Completed at" value={result.completedAt} />
        <Row label="Retry-safe" value={result.retrySafe ? "Yes" : "No"} />
        {certification && (
          <>
            <Row
              label="Certification ID"
              value={certification.id}
              mono
            />
            <Row label="Certification status" value={certification.status} />
            <Row
              label="Manual verification"
              value={certification.manualVerificationStatus ?? "not verified"}
            />
          </>
        )}
      </dl>
      <Collapsible open={technicalOpen} onOpenChange={setTechnicalOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="mt-2">
            <ChevronDown className="h-4 w-4 mr-1" /> Technical details
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="text-xs bg-muted rounded p-2 overflow-x-auto max-h-64 whitespace-pre-wrap break-all">
            {JSON.stringify({ result, certification }, null, 2)}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function ManualVerificationCard({
  certification,
  verifying,
  verifyNote,
  setVerifyNote,
  onSubmit,
}: {
  certification: ControlledLiveCertification | null;
  verifying: boolean;
  verifyNote: string;
  setVerifyNote: (v: string) => void;
  onSubmit: (received: boolean) => void;
}) {
  const alreadyVerified =
    certification?.manualVerificationStatus === "CONFIRMED" ||
    certification?.status === "DELIVERY_CONFIRMED_MANUALLY";

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="text-sm font-medium">Manual inbox verification</div>
      <div className="text-xs text-muted-foreground">
        Available only after PROVIDER_ACCEPTED or DELIVERY_PENDING.
        Administrator-only. Recorded in the audit log and against the
        certification record — does not modify provider evidence.
      </div>
      {alreadyVerified ? (
        <Alert>
          <ShieldCheck className="h-4 w-4 text-green-600" />
          <AlertTitle>Manually confirmed</AlertTitle>
          <AlertDescription>
            Received at{" "}
            {certification?.manualVerificationReceivedAt ?? "unknown"}
            {certification?.manualVerificationRecipient
              ? ` — ${certification.manualVerificationRecipient}`
              : ""}
            .
          </AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="verify-note">Verification note (optional)</Label>
            <Textarea
              id="verify-note"
              rows={2}
              value={verifyNote}
              onChange={(e) => setVerifyNote(e.target.value)}
              placeholder="e.g. Confirmed inbox at 10:14 — sender/subject/content matched approved preview."
              disabled={verifying}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => onSubmit(true)}
              disabled={verifying || !certification}
            >
              Confirm Email Received
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onSubmit(false)}
              disabled={verifying || !certification}
            >
              Not received
            </Button>
          </div>
          {!certification && (
            <div className="text-xs text-muted-foreground">
              Certification record is not yet available; manual verification
              cannot be recorded.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-xs text-muted-foreground min-w-[160px]">{label}</dt>
      <dd className={`text-sm ${mono ? "font-mono break-all" : ""}`}>
        {value ?? "—"}
      </dd>
    </div>
  );
}

export default ControlledLivePanel;
