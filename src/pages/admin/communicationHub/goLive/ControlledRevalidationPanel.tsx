/**
 * Controlled Revalidation Panel.
 *
 * Rendered under the Go-Live page once initial Stage 6 (Send One Real
 * Email) is COMPLETED. It never shows an unrestricted "Resend" button.
 * All state is server-authoritative — the wizard advances only when the
 * backing RPCs succeed.
 *
 * Spec: see docs/communication-hub/PRODUCTION_GO_LIVE_EPIC.md and the
 * Controlled Revalidation & Re-Send master epic.
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, Link } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ShieldCheck, RefreshCw, AlertTriangle, MailCheck, MailX } from "lucide-react";
import { toast } from "sonner";
import { RuntimeContractActionGate } from "./RuntimeContractActionGate";
import {
  assessRevalidationRequirement,
  startRevalidationCycle,
  issueRevalidationSendAuthorisation,
  prepareControlledRevalidation,
  recordRevalidationInboxConfirmation,
  markRevalidationCycleSupplemental,
  promoteRevalidationBaseline,
  voidRevalidationCycle,
  listRevalidationCycles,
  REVALIDATION_SEND_TYPED_PHRASE,
  REVALIDATION_PROMOTE_TYPED_PHRASE,
  type AssessmentEnvelope,
  type ChangeCategory,
  type RevalidationCycle,
  type RevalidationPurpose,
} from "@/platform/communication-hub/revalidationService";
import {
  getActiveRevalidationAuthorisation,
  getActiveRevalidationPreparation,
  type HydratedAuthorisation,
  type HydratedPreparationExecution,
} from "@/platform/communication-hub/operationsSummaryService";
import { maskEmail } from "../utils/mask";

const CHANGE_CATEGORIES: { code: ChangeCategory; label: string }[] = [
  { code: "UI_ONLY", label: "UI / reporting only" },
  { code: "MONITORING_ONLY", label: "Monitoring / alerting only" },
  { code: "SCHEDULER_ARM_ONLY", label: "Scheduler / lease / Arm only" },
  { code: "PROVIDER_CHANGE", label: "Provider credential or selection" },
  { code: "SENDER_DISPLAY_ONLY", label: "Sender display-name" },
  { code: "SENDER_DOMAIN", label: "Sender address / domain / verification" },
  { code: "TEMPLATE_CHANGE", label: "Template / layout / token" },
  { code: "PAYLOAD_SCHEMA", label: "Payload schema" },
  { code: "RECIPIENT_POLICY", label: "Recipient policy" },
  { code: "SEND_REVIEW_POLICY", label: "Send / review policy" },
  { code: "DISPATCHER_TRANSPORT", label: "Enqueue / dispatcher / transport" },
  { code: "SECURITY", label: "Security-sensitive" },
];

const PURPOSES: { code: RevalidationPurpose; label: string }[] = [
  { code: "OPERATOR_ASSURANCE", label: "Operator assurance" },
  { code: "CONFIGURATION_CHANGE", label: "Configuration change" },
  { code: "PROVIDER_CHANGE", label: "Provider change" },
  { code: "SENDER_CHANGE", label: "Sender change" },
  { code: "TEMPLATE_CHANGE", label: "Template change" },
  { code: "RUNTIME_CHANGE", label: "Runtime change" },
  { code: "SECURITY_CHANGE", label: "Security change" },
  { code: "INCIDENT_RECOVERY", label: "Incident recovery" },
];

interface Props {
  moduleCode: string;
  eventCode: string;
  channel: string;
  productionAnchor: {
    oreCertificationId: string | null;
    verifiedRecipient: string | null;
    verifiedAt: string | null;
    productionLineageId: string | null;
    baselineFingerprint: string | null;
  };
}

export function ControlledRevalidationPanel({
  moduleCode, eventCode, channel, productionAnchor,
}: Props) {
  const qc = useQueryClient();
  const location = useLocation();
  const searchQS = location.search || "";
  const withSearch = (path: string) => (searchQS ? `${path}${searchQS}` : path);

  const [assessment, setAssessment] = useState<AssessmentEnvelope | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [purpose, setPurpose] = useState<RevalidationPurpose>("OPERATOR_ASSURANCE");
  const [reason, setReason] = useState("");
  const [ticket, setTicket] = useState("");
  const [categories, setCategories] = useState<Set<ChangeCategory>>(new Set());
  const [starting, setStarting] = useState(false);
  const [cycles, setCycles] = useState<RevalidationCycle[]>([]);
  const [activeCycle, setActiveCycle] = useState<RevalidationCycle | null>(null);
  const [recipient, setRecipient] = useState("");
  const [phrase, setPhrase] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [inboxNotes, setInboxNotes] = useState("");
  const [promotePhrase, setPromotePhrase] = useState("");
  const [promoteReason, setPromoteReason] = useState("");
  const [promoting, setPromoting] = useState(false);
  // A4.1.2C — Server-hydrated authority. React state is NOT the source of
  // truth for authorisation or preparation execution; both survive refresh,
  // tab switch, deep link, and a second operator session.
  const [hydratedAuth, setHydratedAuth] = useState<HydratedAuthorisation | null>(null);
  const [authUnusableReason, setAuthUnusableReason] = useState<string | null>(null);
  const [hydratedPrep, setHydratedPrep] = useState<HydratedPreparationExecution | null>(null);
  const [prepUnavailableReason, setPrepUnavailableReason] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareResult, setPrepareResult] = useState<Awaited<ReturnType<typeof prepareControlledRevalidation>> | null>(null);

  // A4.1.2C — after any mutation invalidate the Operations summary AND the
  // hydrated authorisation/preparation caches so the displayed state comes
  // from the subsequent server read, never from transient React state.
  async function invalidateAuthorities() {
    await qc.invalidateQueries({ queryKey: ["comm-hub-operations-summary", moduleCode, eventCode, channel] });
    await qc.invalidateQueries({ queryKey: ["comm-hub-golive-status", moduleCode, eventCode, channel] });
    await qc.invalidateQueries({ queryKey: ["comm-hub-active-revalidation"] });
  }

  async function refresh() {
    try {
      const list = await listRevalidationCycles({ moduleCode, eventCode, channel });
      setCycles(list);
      const unresolved = list.find(
        (c) => !["CONFIRMED","NOT_RECEIVED","FAILED","VOIDED","PROMOTED","SUPERSEDED","VERIFIED_SUPPLEMENTAL"].includes(c.status),
      );
      const active = unresolved ?? list[0] ?? null;
      setActiveCycle(active);

      // Hydrate authorisation from the server (authoritative).
      try {
        const authRes = await getActiveRevalidationAuthorisation({ moduleCode, eventCode, channel });
        setHydratedAuth(authRes.authorisation);
        setAuthUnusableReason(
          authRes.authorisation && authRes.authorisation.usable
            ? null
            : (authRes.authorisation?.unusable_reason ?? authRes.unusable_reason ?? null),
        );
      } catch (e: any) {
        setHydratedAuth(null);
        setAuthUnusableReason("authorisation_unavailable");
      }

      // Hydrate active preparation execution from the server (authoritative).
      if (active) {
        try {
          const prepRes = await getActiveRevalidationPreparation(active.id);
          setHydratedPrep(prepRes.execution);
          setPrepUnavailableReason(prepRes.unavailable_reason ?? null);
        } catch {
          setHydratedPrep(null);
          setPrepUnavailableReason("execution_unavailable");
        }
      } else {
        setHydratedPrep(null);
        setPrepUnavailableReason("no_cycle");
      }
      await invalidateAuthorities();
    } catch (e: any) {
      console.error(e);
    }
  }

  useEffect(() => { refresh(); }, [moduleCode, eventCode, channel]);

  // Cycle-authorisation consistency: only display/use hydratedAuth when it
  // is bound to the currently-active cycle. The Edge/server resolver
  // remains the final authority — but we do NOT silently prefer one side.
  const cycleAuthMismatch = useMemo(
    () => !!(hydratedAuth && activeCycle && hydratedAuth.cycle_id !== activeCycle.id),
    [hydratedAuth, activeCycle],
  );
  const effectiveAuth: HydratedAuthorisation | null =
    hydratedAuth && !cycleAuthMismatch ? hydratedAuth : null;

  // Preparation-state action matrix (§3). Derived from server state only.
  type PrepAction =
    | { kind: "PREPARE" }
    | { kind: "RESUME"; reason: string }
    | { kind: "COMPLETE" }
    | { kind: "RETRY"; reason: string }
    | { kind: "RECOVER"; reason: string }
    | { kind: "PROVIDER_PENDING" }
    | { kind: "NONE" };
  const prepAction: PrepAction = useMemo(() => {
    if (!activeCycle || !effectiveAuth?.usable) return { kind: "NONE" };
    if (!hydratedPrep) return { kind: "PREPARE" };
    switch (hydratedPrep.classified_state) {
      case "PREPARING":
        return { kind: "RESUME", reason: "Preparation started but not finalised." };
      case "READY_FOR_PROVIDER":
        return { kind: "COMPLETE" };
      case "FAILED_PRE_PROVIDER":
        // Retry only when server confirms authorisation remains usable AND
        // preparation is still classified as re-runnable pre-provider.
        return effectiveAuth.usable
          ? { kind: "RETRY", reason: hydratedPrep.failure_code ?? "pre_provider_failure" }
          : { kind: "NONE" };
      case "RECOVERY_REQUIRED":
        return { kind: "RECOVER", reason: hydratedPrep.failure_code ?? "recovery_required" };
      case "PROVIDER_RESULT_PENDING":
      case "COMPLETE":
        return { kind: "PROVIDER_PENDING" };
      default:
        return { kind: "NONE" };
    }
  }, [activeCycle, effectiveAuth, hydratedPrep]);


  async function runAssessment() {
    setAssessing(true);
    try {
      const a = await assessRevalidationRequirement({
        moduleCode, eventCode, channel,
        declaredChangeCategories: Array.from(categories),
      });
      setAssessment(a);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setAssessing(false);
    }
  }

  async function handleStart() {
    if (reason.trim().length < 6) { toast.error("Reason must be at least 6 characters."); return; }
    setStarting(true);
    try {
      const r = await startRevalidationCycle({
        moduleCode, eventCode, channel, purpose, reason,
        changeTicketReference: ticket || null,
        declaredChangeCategories: Array.from(categories),
      });
      toast.success(`Revalidation cycle ${r.cycle_id.slice(0,8)} started`);
      setReason(""); setTicket("");
      await refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setStarting(false); }
  }

  async function handleAuthoriseSend() {
    if (!activeCycle) return;
    setIssuing(true);
    try {
      const res: any = await issueRevalidationSendAuthorisation({
        cycleId: activeCycle.id,
        recipientEmail: recipient,
        currentFingerprint: activeCycle.current_evidence_fingerprint_v2 ?? "",
        typedPhrase: phrase,
      });
      // Authorisation ID is intentionally NOT retained in React state — we
      // refresh() to reload the server-authoritative authorisation.
      setPrepareResult(null);
      toast.success("Authorisation issued. You may now prepare the controlled delivery.");
      setPhrase("");
      await refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setIssuing(false); }
  }

  async function handlePrepare() {
    // Cycle-authorisation consistency is enforced through effectiveAuth.
    if (!activeCycle || !effectiveAuth?.id || !effectiveAuth.usable) return;
    setPreparing(true);
    try {
      const res = await prepareControlledRevalidation({
        cycleId: activeCycle.id,
        authorisationId: effectiveAuth.id,
      });
      // Do NOT let this transient response act as authority — the displayed
      // final state comes from the subsequent server refetch.
      setPrepareResult(res);
      if (res.status === "READY_FOR_PROVIDER") {
        toast.success(res.reused_existing_execution
          ? "Existing preparation reused. No email sent."
          : "Preparation complete. No email sent. Provider delivery remains disabled.");
      } else if (res.status === "BLOCKED") {
        toast.error(`Preparation blocked (${res.blockers[0]?.code ?? "unknown"}). No email sent.`);
      } else if (res.status === "FAILED_PRE_PROVIDER") {
        toast.error("Preparation failed before any provider call. Authorisation preserved.");
      }
      await refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setPreparing(false); }
  }

  async function handleInbox(status: "CONFIRMED" | "NOT_RECEIVED") {
    if (!activeCycle) return;
    try {
      await recordRevalidationInboxConfirmation({ cycleId: activeCycle.id, status, notes: inboxNotes });
      toast.success(`Inbox ${status}`);
      setInboxNotes("");
      await refresh();
    } catch (e: any) { toast.error(e.message); }
  }

  async function handleSupplemental() {
    if (!activeCycle) return;
    try {
      await markRevalidationCycleSupplemental(activeCycle.id);
      toast.success("Cycle recorded as supplemental verification. Production anchor unchanged.");
      await refresh();
    } catch (e: any) { toast.error(e.message); }
  }

  async function handlePromote() {
    if (!activeCycle) return;
    setPromoting(true);
    try {
      await promoteRevalidationBaseline({
        cycleId: activeCycle.id, typedPhrase: promotePhrase, reason: promoteReason,
      });
      toast.success("Promotion recorded.");
      setPromotePhrase(""); setPromoteReason("");
      await refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setPromoting(false); }
  }

  async function handleVoid() {
    if (!activeCycle) return;
    const r = window.prompt("Reason for voiding this cycle (min 6 chars):");
    if (!r || r.trim().length < 6) return;
    try {
      await voidRevalidationCycle({ cycleId: activeCycle.id, reason: r });
      toast.success("Cycle voided.");
      await refresh();
    } catch (e: any) { toast.error(e.message); }
  }

  const drift = !!assessment?.drift_detected;
  const canAuthorise = activeCycle?.status === "READY_FOR_CONTROLLED_EMAIL";
  const canConfirmInbox = activeCycle?.status === "AWAITING_INBOX_CONFIRMATION";
  const canPromote = activeCycle?.status === "CONFIRMED";

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Controlled revalidation
          <Badge variant="outline" className="ml-2">no unrestricted resend</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {/* Production-certified email panel */}
        <div className="rounded-md border p-3 space-y-1 bg-emerald-50/30 dark:bg-emerald-950/10">
          <div className="font-medium text-emerald-800 dark:text-emerald-200">
            Production-certified email (immutable)
          </div>
          <div className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
            <div><span className="text-muted-foreground">ORE certification:</span>{" "}
              <code className="font-mono">{productionAnchor.oreCertificationId ?? "—"}</code></div>
            <div><span className="text-muted-foreground">Verified recipient:</span>{" "}
              <code className="font-mono">{productionAnchor.verifiedRecipient ?? "—"}</code></div>
            <div><span className="text-muted-foreground">Verified at:</span>{" "}
              {productionAnchor.verifiedAt ?? "—"}</div>
            <div><span className="text-muted-foreground">Production lineage:</span>{" "}
              <code className="font-mono">{productionAnchor.productionLineageId ?? "—"}</code></div>
            <div className="sm:col-span-2"><span className="text-muted-foreground">Baseline fingerprint:</span>{" "}
              <code className="font-mono break-all">{productionAnchor.baselineFingerprint ?? "—"}</code></div>
          </div>
        </div>

        {/* Step 1 — reason + categories */}
        {!activeCycle || ["CONFIRMED","NOT_RECEIVED","FAILED","VOIDED","VERIFIED_SUPPLEMENTAL","PROMOTED","SUPERSEDED"].includes(activeCycle.status) ? (
          <div className="rounded-md border p-3 space-y-3">
            <div className="font-medium">1. Start a controlled revalidation cycle</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label>Purpose</Label>
                <select
                  className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value as RevalidationPurpose)}
                >
                  {PURPOSES.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <Label>Change ticket / reference (optional)</Label>
                <Input value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="JIRA-123, PR#..." />
              </div>
            </div>
            <div>
              <Label>Reason (min 6 chars)</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
            </div>
            <div>
              <Label className="text-xs">Declared change categories</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {CHANGE_CATEGORIES.map((c) => (
                  <label key={c.code} className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={categories.has(c.code)}
                      onCheckedChange={(v) => {
                        const s = new Set(categories);
                        if (v) s.add(c.code); else s.delete(c.code);
                        setCategories(s);
                      }}
                    />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={runAssessment} disabled={assessing} variant="secondary" size="sm">
                {assessing && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                <RefreshCw className="h-3 w-3 mr-1" /> Assess drift
              </Button>
              <Button onClick={handleStart} disabled={starting || reason.trim().length < 6}>
                {starting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Start cycle
              </Button>
            </div>
            {assessment && (
              <Alert variant={drift ? "destructive" : "default"}>
                <AlertTitle className="flex items-center gap-2">
                  {drift ? <AlertTriangle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                  {drift ? "Drift detected" : "No configuration drift"}
                  <Badge variant="outline">{assessment.required_validation_level}</Badge>
                </AlertTitle>
                <AlertDescription className="text-xs space-y-1">
                  <div>{drift
                    ? "Current production evidence does not cover the changed components. Production for this event remains blocked until required revalidation is completed."
                    : "No configuration drift was detected. This email will provide supplemental delivery assurance and will not replace the production baseline."}</div>
                  {assessment.changed_components.length > 0 && (
                    <div><span className="text-muted-foreground">Changed:</span>{" "}
                      {assessment.changed_components.join(", ")}</div>
                  )}
                  <div><span className="text-muted-foreground">Required stages:</span>{" "}
                    {assessment.required_stages.length
                      ? assessment.required_stages.join(" → ")
                      : "none"}</div>
                  {assessment.event_must_be_suspended && (
                    <div className="text-destructive">Event must be suspended.</div>
                  )}
                  {assessment.automation_must_be_disarmed && (
                    <div className="text-destructive">Automation must be disarmed.</div>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
        ) : null}

        {/* Active cycle */}
        {activeCycle && (
          <div className="rounded-md border p-3 space-y-3">
            <div className="flex items-center gap-2">
              <div className="font-medium">Active cycle {activeCycle.id.slice(0,8)}</div>
              <Badge>{activeCycle.status}</Badge>
              <Badge variant="outline">{activeCycle.required_validation_level}</Badge>
              <div className="ml-auto text-xs text-muted-foreground">
                started {new Date(activeCycle.started_at).toLocaleString()}
              </div>
            </div>
            <div className="text-xs grid gap-x-4 gap-y-1 sm:grid-cols-2">
              <div><span className="text-muted-foreground">Purpose:</span> {activeCycle.purpose}</div>
              <div><span className="text-muted-foreground">Change ref:</span> {activeCycle.change_ticket_reference ?? "—"}</div>
              <div className="sm:col-span-2"><span className="text-muted-foreground">Reason:</span> {activeCycle.reason}</div>
              <div className="sm:col-span-2"><span className="text-muted-foreground">Required stages:</span>{" "}
                {activeCycle.required_stages.length ? activeCycle.required_stages.join(" → ") : "none"}</div>
            </div>

            {/* Server-hydrated authorisation card */}
            {hydratedAuth && (
              <div className="rounded border p-2 space-y-1 bg-muted/20" data-testid="hydrated-authorisation">
                <div className="text-xs font-medium flex items-center gap-2">
                  Authorisation <Badge variant={hydratedAuth.usable ? "default" : "destructive"}>{hydratedAuth.status}</Badge>
                  {hydratedAuth.usable && <Badge variant="outline">usable</Badge>}
                </div>
                <div className="text-[11px] grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                  <div><span className="text-muted-foreground">Recipient:</span> <code className="font-mono">{maskEmail(hydratedAuth.recipient)}</code></div>
                  <div><span className="text-muted-foreground">Expires:</span> {hydratedAuth.expires_at ? new Date(hydratedAuth.expires_at).toLocaleString() : "—"}</div>
                  <div className="sm:col-span-2"><span className="text-muted-foreground">Authorisation ID:</span> <code className="font-mono">{hydratedAuth.id}</code></div>
                  {!hydratedAuth.usable && (
                    <div className="sm:col-span-2 text-destructive">
                      Not usable: {hydratedAuth.unusable_reason ?? "unknown"}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Authorise send — only when there is no usable authorisation */}
            {canAuthorise && !hydratedAuth?.usable && (
              <div className="rounded border p-2 space-y-2">
                <div className="text-xs font-medium">Controlled revalidation email authorisation</div>
                <Input placeholder="Recipient email"
                  value={recipient} onChange={(e) => setRecipient(e.target.value)} />
                <Input placeholder={`Type: ${REVALIDATION_SEND_TYPED_PHRASE}`}
                  value={phrase} onChange={(e) => setPhrase(e.target.value)} />
                <RuntimeContractActionGate
                  action="CONTROLLED_REVALIDATION_AUTHORISATION"
                  actionLabel="Controlled revalidation authorisation"
                >
                  <Button
                    onClick={handleAuthoriseSend}
                    disabled={
                      issuing || !recipient.includes("@") ||
                      phrase !== REVALIDATION_SEND_TYPED_PHRASE
                    }
                    size="sm"
                  >
                    {issuing && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                    Issue one-use authorisation
                  </Button>
                </RuntimeContractActionGate>
                <div className="text-[11px] text-muted-foreground">
                  The email is dispatched by the existing One Real Email transport
                  under an explicit CONTROLLED_REVALIDATION context; no second
                  dispatcher is created.
                </div>
              </div>
            )}

            {/* Server-hydrated active preparation execution */}
            {hydratedPrep && (
              <div className="rounded border p-2 space-y-1 text-[11px]" data-testid="hydrated-preparation">
                <div className="font-medium text-xs flex items-center gap-2">
                  Preparation execution
                  <Badge variant={hydratedPrep.classified_state === "READY_FOR_PROVIDER" ? "default" : "destructive"}>
                    {hydratedPrep.classified_state}
                  </Badge>
                  <Badge variant="outline">v{hydratedPrep.preparation_version}</Badge>
                </div>
                {hydratedPrep.classified_state === "PREPARING" && (
                  <div className="text-destructive">Preparation incomplete — retry to finalise (no email will be sent).</div>
                )}
                {hydratedPrep.classified_state === "READY_FOR_PROVIDER" && (
                  <div className="text-emerald-700 dark:text-emerald-300">Preparation complete. No email sent. Provider delivery remains disabled until A4.2.</div>
                )}
                {hydratedPrep.classified_state === "FAILED_PRE_PROVIDER" && (
                  <div className="text-destructive">Failed before any provider call ({hydratedPrep.failure_code ?? "unknown"}). Authorisation preserved.</div>
                )}
                <div><span className="text-muted-foreground">Execution:</span> <code className="font-mono">{hydratedPrep.execution_id}</code></div>
                <div><span className="text-muted-foreground">Idempotency key:</span> <code className="font-mono break-all">{hydratedPrep.canonical_idempotency_key ?? "—"}</code></div>
                <div><span className="text-muted-foreground">Provider call attempted:</span> {String(hydratedPrep.provider_call_attempted)}</div>
              </div>
            )}

            {/* A4.1 — Prepare controlled delivery (no provider call) */}
            {activeCycle && hydratedAuth?.usable && (
              <div className="rounded border p-2 space-y-2 bg-muted/30">
                <div className="text-xs font-medium">
                  Prepare controlled delivery <Badge variant="outline">no email sent</Badge>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Reserves canonical template, sender, recipient and provider
                  bindings and creates durable evidence. The email provider is
                  NOT contacted — that step remains disabled until the
                  provider-boundary runtime is approved.
                </div>
                <RuntimeContractActionGate
                  action="CONTROLLED_REVALIDATION_PREPARE"
                  actionLabel="Controlled revalidation preparation"
                >
                  <Button
                    size="sm"
                    onClick={handlePrepare}
                    disabled={preparing}
                    data-testid="controlled-revalidation-prepare-button"
                  >
                    {preparing && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                    Prepare controlled delivery
                  </Button>
                </RuntimeContractActionGate>
                {prepareResult && (
                  <div className="text-[11px] space-y-1" data-testid="controlled-revalidation-prepare-result">
                    <div>
                      <span className="text-muted-foreground">Status:</span>{" "}
                      <Badge variant={prepareResult.status === "READY_FOR_PROVIDER" ? "default" : "destructive"}>
                        {prepareResult.status}
                      </Badge>
                      {prepareResult.reused_existing_execution && (
                        <Badge variant="outline" className="ml-1">reused</Badge>
                      )}
                    </div>
                    {prepareResult.execution_id && (
                      <div>
                        <span className="text-muted-foreground">Execution:</span>{" "}
                        <code className="font-mono">{prepareResult.execution_id}</code>
                      </div>
                    )}
                    <div>
                      <span className="text-muted-foreground">Provider call attempted:</span>{" "}
                      {String(prepareResult.provider_call_attempted)}
                    </div>
                    {prepareResult.blockers.length > 0 && (
                      <ul className="list-disc pl-4 text-destructive">
                        {prepareResult.blockers.map((b, i) => (
                          <li key={i}>{b.code} ({b.stage}){b.message ? `: ${b.message}` : ""}</li>
                        ))}
                      </ul>
                    )}
                    <a
                      href="/admin/communication-hub/audit"
                      className="underline text-primary text-[11px]"
                    >
                      View evidence in Audit workspace →
                    </a>
                  </div>
                )}
              </div>
            )}



            {/* Inbox confirmation */}
            {canConfirmInbox && (
              <div className="rounded border p-2 space-y-2">
                <div className="text-xs font-medium">Inbox confirmation</div>
                <Textarea rows={2} placeholder="Optional notes"
                  value={inboxNotes} onChange={(e) => setInboxNotes(e.target.value)} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleInbox("CONFIRMED")}>
                    <MailCheck className="h-3 w-3 mr-1" /> Confirmed
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => handleInbox("NOT_RECEIVED")}>
                    <MailX className="h-3 w-3 mr-1" /> Not received
                  </Button>
                </div>
              </div>
            )}

            {/* Promotion / supplemental */}
            {canPromote && (
              <div className="rounded border p-2 space-y-2">
                <div className="text-xs font-medium">Outcome</div>
                <div className="text-xs text-muted-foreground">
                  Choose whether this confirmed email supplements the existing
                  baseline or promotes a new production baseline.
                </div>
                <Button size="sm" variant="secondary" onClick={handleSupplemental}>
                  Record as supplemental verification (anchor unchanged)
                </Button>
                <div className="mt-2 space-y-2">
                  <Textarea rows={2} placeholder="Promotion reason (min 6 chars)"
                    value={promoteReason} onChange={(e) => setPromoteReason(e.target.value)} />
                  <Input placeholder={`Type: ${REVALIDATION_PROMOTE_TYPED_PHRASE}`}
                    value={promotePhrase} onChange={(e) => setPromotePhrase(e.target.value)} />
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handlePromote}
                    disabled={
                      promoting || promoteReason.trim().length < 6 ||
                      promotePhrase !== REVALIDATION_PROMOTE_TYPED_PHRASE
                    }
                  >
                    {promoting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                    Promote new production baseline
                  </Button>
                </div>
              </div>
            )}

            {/* Void (only if no provider call) */}
            {!activeCycle.provider_call_attempted &&
              !["CONFIRMED","NOT_RECEIVED","PROMOTED","VOIDED","SUPERSEDED","VERIFIED_SUPPLEMENTAL"].includes(activeCycle.status) && (
              <Button size="sm" variant="ghost" onClick={handleVoid}>Void cycle</Button>
            )}
          </div>
        )}

        {/* History */}
        <div className="rounded-md border p-3">
          <div className="font-medium mb-2 text-sm">Revalidation history</div>
          {cycles.length === 0 && <div className="text-xs text-muted-foreground">No cycles recorded.</div>}
          <div className="space-y-1">
            {cycles.map((c) => (
              <div key={c.id} className="text-xs flex items-center gap-2 border-b pb-1">
                <code className="font-mono">{c.id.slice(0,8)}</code>
                <Badge variant="outline">{c.purpose}</Badge>
                <Badge>{c.status}</Badge>
                {c.promotion_status === "PROMOTED" && <Badge className="bg-emerald-600">promoted</Badge>}
                {c.promotion_status === "SUPPLEMENTAL" && <Badge variant="secondary">supplemental</Badge>}
                <span className="text-muted-foreground truncate">{c.reason}</span>
                <span className="ml-auto text-muted-foreground">
                  {new Date(c.started_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            A later confirmed email remains visibly distinct from the current
            production anchor until explicitly promoted.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
