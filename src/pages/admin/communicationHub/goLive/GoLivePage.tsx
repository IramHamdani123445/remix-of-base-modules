/**
 * CH-SIMPLE-P3F — Unified Go Live Journey.
 *
 * Single guided page that walks an administrator through the five
 * authoritative safety gates before any live email is sent. It reuses
 * existing panels — PreviewApprovalPanel, DryRunPanel, ControlledLivePanel
 * — and NEVER reproduces server rules in the browser.
 *
 * Step lock invariants:
 *   1. Select Event             -> 2 unlocks when module+event are chosen
 *   2. Check Readiness          -> 3 unlocks when the canonical send-decision
 *                                  for context=preview returns allowed=true
 *   3. Preview & Approve        -> 4 unlocks when the server returns an
 *                                  ACTIVE approval id
 *   4. Run Dry Test             -> 5 unlocks when the server returns a valid
 *                                  DRY_RUN_PASSED certification
 *   5. Controlled Live Test     -> 6 unlocks when the orchestrator returns a
 *                                  final controlled-live result
 *   6. Review & Complete        -> read-only evidence
 *
 * Session state is stored in sessionStorage under commHub.goLive.v1 —
 * it only holds ids, never authorisation flags. Every downstream step
 * verifies authoritative server state on load.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import CommunicationHubWorkspaceShell, {
  CommunicationHubSectionCard,
} from "../components/CommunicationHubWorkspaceShell";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, Circle, Lock, ShieldAlert, ExternalLink } from "lucide-react";
import PreviewApprovalPanel, {
  type PreviewLockedContext,
  type PreviewRecipientSource,
} from "../controlCenter/PreviewApprovalPanel";
import EventTestContextSummary from "./EventTestContextSummary";
import DryRunPanel from "../controlCenter/DryRunPanel";
import ControlledStubPanel from "../controlCenter/ControlledStubPanel";
import OneRealEmailPanel from "../controlCenter/OneRealEmailPanel";
import ReadinessSummary from "./ReadinessSummary";
import GoLiveGateMonitor from "./GoLiveGateMonitor";
import {
  evaluateCanonicalSendDecision,
  type SendDecisionEnvelope,
} from "@/platform/communication-hub/sendDecisionService";
import {
  CommHubAuthError,
  type ActionReadySessionEvidence,
} from "@/platform/communication-hub/authSession";
import { refreshAndProbeOperator } from "@/platform/communication-hub/operatorAuthDiagnostics";
import {
  getAuthErrorDetails,
  type AuthErrorDetails,
} from "@/platform/communication-hub/authErrorMessages";
import { KeyRound, Loader2 } from "lucide-react";
import {
  fetchGlobalSettings,
  type CommunicationGlobalSettings,
} from "@/platform/communication-hub/globalSettingsService";
import {
  fetchRecipientPolicy,
  type RecipientPolicy,
} from "@/platform/communication-hub/recipientPolicyService";
import { toast } from "sonner";
import ModuleEventSelectors from "./ModuleEventSelectors";
import {
  fetchModuleEventDirectory,
  resolveEvent,
  resolveModule,
} from "./moduleEventDirectoryService";
import {
  buildRecipientContext,
  resolveGoLiveRecipient,
  type GoLiveRecipientResolution,
  type RecipientMatchContext,
} from "./resolveTestRecipient";
import RecipientResolutionPanel from "./RecipientResolutionPanel";
import {
  fetchEventTestContext,
  formatSenderForDisplay,
  formatTemplateForDisplay,
  formatTemplateVersionForDisplay,
  type EventTestContext,
} from "./eventTestContextService";
import ReleaseModeCards from "./ReleaseModeCards";
import AutomationStandbyPanel from "./AutomationStandbyPanel";
import { useStageReadiness } from "@/platform/communication-hub/useStageReadiness";

const SESSION_KEY = "commHub.goLive.v1";

interface GoLiveSession {
  moduleCode: string;
  eventCode: string;
  channel: string;
  previewSnapshotId: string | null;
  previewApprovalId: string | null;
  dryRunExecutionId: string | null;
  dryRunCertificationId: string | null;
  // Controlled-live evidence — Step 6 requires the full set, not just the ID.
  controlledLiveExecutionId: string | null;
  controlledLiveCertificationId: string | null;
  controlledLivePassed: boolean;
  controlledLiveStatus: string | null;
  controlledLiveDeliveryAttemptId: string | null;
  controlledLiveDispatcherRevalidationDecisionId: string | null;
  controlledLiveProviderCallAttempted: boolean;
  controlledLiveCleanupSucceeded: boolean | null;
  controlledLiveFinalOperatingMode: string | null;
}

const EMPTY_SESSION: GoLiveSession = {
  moduleCode: "",
  eventCode: "",
  channel: "email",
  previewSnapshotId: null,
  previewApprovalId: null,
  dryRunExecutionId: null,
  dryRunCertificationId: null,
  controlledLiveExecutionId: null,
  controlledLiveCertificationId: null,
  controlledLivePassed: false,
  controlledLiveStatus: null,
  controlledLiveDeliveryAttemptId: null,
  controlledLiveDispatcherRevalidationDecisionId: null,
  controlledLiveProviderCallAttempted: false,
  controlledLiveCleanupSucceeded: null,
  controlledLiveFinalOperatingMode: null,
};

/** Map server-side fix hints to concrete admin routes (kept explicit; no
 *  broad regex, so unknown codes fall back to a generic diagnostics page). */
const FIX_ROUTE_MAP: Record<string, string> = {
  recipient_policy: "/admin/communication-hub/recipient-policy",
  template_mapping: "/admin/communication-hub/design",
  template_version: "/admin/communication-hub/design",
  sender_profile: "/admin/communication-hub/design/sender-profiles",
  sender_verification: "/admin/communication-hub/design/sender-verification",
  email_provider: "/admin/notifications/providers",
  send_policy: "/admin/communication-hub/governance/send-policies",
  review_policy: "/admin/communication-hub/governance",
  event_configuration: "/admin/communication-hub/onboarding/event-template-wizard",
  emergency_stop: "/admin/communication-hub/control-center",
  operating_mode: "/admin/communication-hub/control-center",
};

function loadSession(): GoLiveSession {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return { ...EMPTY_SESSION };
    const parsed = JSON.parse(raw);
    return { ...EMPTY_SESSION, ...parsed };
  } catch {
    return { ...EMPTY_SESSION };
  }
}
function saveSession(s: GoLiveSession) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* private mode — ignore */
  }
}

interface StepHeaderProps {
  index: number;
  title: string;
  status: "locked" | "current" | "done" | "attention";
  hint?: string;
}
function StepHeader({ index, title, status, hint }: StepHeaderProps) {
  const Icon = status === "done" ? CheckCircle2 : status === "locked" ? Lock : Circle;
  const tone =
    status === "done" ? "text-emerald-600" :
    status === "locked" ? "text-muted-foreground" :
    status === "attention" ? "text-amber-600" : "text-primary";
  return (
    <div className="flex items-center gap-3">
      <Icon className={`h-5 w-5 ${tone}`} />
      <div>
        <div className="text-sm font-semibold">
          Step {index}. {title}
        </div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}

export default function GoLivePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [session, setSession] = useState<GoLiveSession>(() => loadSession());
  const [invalidUrlNotice, setInvalidUrlNotice] = useState<string | null>(null);
  const [decision, setDecision] = useState<SendDecisionEnvelope | null>(null);
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [settings, setSettings] = useState<CommunicationGlobalSettings | null>(null);
  const [recipientPolicy, setRecipientPolicy] = useState<RecipientPolicy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Phase 4B3 — auth state is tracked independently of business readiness.
  // A `not_authenticated` failure MUST NOT be stored as a send-policy blocker.
  const [authError, setAuthError] = useState<AuthErrorDetails | null>(null);
  const [refreshingAuth, setRefreshingAuth] = useState(false);
  const [authEvidence, setAuthEvidence] = useState<ActionReadySessionEvidence | null>(null);
  const [postgrestConfirmed, setPostgrestConfirmed] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => { saveSession(session); }, [session]);

  useEffect(() => {
    Promise.all([fetchGlobalSettings(), fetchRecipientPolicy()])
      .then(([s, p]) => {
        if (!mountedRef.current) return;
        setSettings(s);
        setRecipientPolicy(p);
      })
      .catch((e) => setLoadError(e?.message ?? "Failed to load hub settings"));
  }, []);

  const eventChosen = !!session.moduleCode && !!session.eventCode;

  const [recipientCtx, setRecipientCtx] = useState<RecipientMatchContext | null>(null);
  const [recipientResolution, setRecipientResolution] =
    useState<GoLiveRecipientResolution | null>(null);
  const [selectedRecipient, setSelectedRecipient] = useState<string | null>(null);
  const [eventContext, setEventContext] = useState<EventTestContext | null>(null);

  // CH-GL-02 Slice B — fan out readiness across every downstream stage so the
  // mode cards can lock Manual/Automated Production with the exact server
  // reason, without the old preview-only shortcut.
  const stageReadiness = useStageReadiness({
    moduleCode: session.moduleCode || null,
    eventCode: session.eventCode || null,
    channel: session.channel,
  });

  useEffect(() => {
    let cancelled = false;
    if (!session.moduleCode || !session.eventCode) {
      setEventContext(null);
      return;
    }
    fetchEventTestContext(session.moduleCode, session.eventCode, session.channel)
      .then((ctx) => { if (!cancelled) setEventContext(ctx); })
      .catch(() => { if (!cancelled) setEventContext(null); });
    return () => { cancelled = true; };
  }, [session.moduleCode, session.eventCode, session.channel]);

  async function refreshDecision(overrideRecipient?: string | null) {
    if (!eventChosen) return false;
    setDecisionLoading(true);
    // Clear any stale authentication alert while we re-evaluate.
    setAuthError(null);
    try {
      // Reload authoritative recipient policy first — never trust cached state.
      const policy = await fetchRecipientPolicy();
      setRecipientPolicy(policy);

      const pick = overrideRecipient ?? selectedRecipient;
      const resolution = resolveGoLiveRecipient(policy, pick);
      setRecipientResolution(resolution);

      if (!resolution.resolved) {
        setDecision(null);
        setRecipientCtx(buildRecipientContext(policy, null));
        return false;
      }

      const env = await evaluateCanonicalSendDecision({
        moduleCode: session.moduleCode,
        eventCode: session.eventCode,
        channel: session.channel,
        sendContext: "preview",
        toRecipients: [resolution.recipient],
      });
      setDecision(env);
      setRecipientCtx(buildRecipientContext(policy, resolution.recipient));
      return env.allowed;
    } catch (e: any) {
      // Auth failure: track as a dedicated state; DO NOT populate canonical
      // readiness with a fake `not_authenticated` business blocker.
      if (e instanceof CommHubAuthError || getAuthErrorDetails(e)) {
        const d = getAuthErrorDetails(e) ?? {
          code: "authentication_required",
          title: "Your session has expired",
          message: "Your authenticated session is no longer available. No Dry Run was started.",
          fix: "Refresh your session or sign in again, then retry.",
          severity: "medium" as const,
          retrySafe: true,
        };
        setAuthError(d);
        setDecision(null);
        return false;
      }
      toast.error(e?.message ?? "Readiness check failed");
      return false;
    } finally {
      setDecisionLoading(false);
    }
  }

  async function handleRefreshSession() {
    setRefreshingAuth(true);
    try {
      const diagnostic = await refreshAndProbeOperator();
      setAuthEvidence(diagnostic.session);
      setPostgrestConfirmed(diagnostic.actorMatch);
      const ready = eventChosen ? await refreshDecision() : false;
      if (!ready) {
        toast.error("Session restored, but readiness or Preview approval is no longer valid.");
        return;
      }
      setAuthError(null);
      toast.success(`Session refreshed · valid for ${Math.floor(diagnostic.session.tokenRemainingSeconds / 60)} minutes.`);
    } catch (err) {
      const d = getAuthErrorDetails(err) ?? {
        code: "session_lookup_failed",
        title: "Session could not be restored",
        message: "Your session could not be restored. Please sign in again.",
        fix: "Sign out and sign in again.",
        severity: "medium" as const,
        retrySafe: true,
      };
      setAuthError(d);
      toast.error(d.message);
    } finally {
      setRefreshingAuth(false);
    }
  }

  function handleSelectRecipient(address: string) {
    setSelectedRecipient(address);
    // Immediately re-run readiness with the operator-selected address.
    refreshDecision(address);
  }

  useEffect(() => {
    if (eventChosen) refreshDecision();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.moduleCode, session.eventCode, session.channel]);

  // CH-SIMPLE-P3F-UX.2 — when the operator returns from a Fix now route
  // (window regains focus / tab becomes visible), re-fetch authoritative
  // hub settings and readiness so resolved blockers disappear. Selected
  // module/event context is preserved. Nothing is trusted from browser
  // memory alone.
  useEffect(() => {
    const onRefocus = () => {
      if (!mountedRef.current) return;
      if (document.visibilityState !== "visible") return;
      Promise.all([fetchGlobalSettings(), fetchRecipientPolicy()])
        .then(([s, p]) => {
          if (!mountedRef.current) return;
          setSettings(s);
          setRecipientPolicy(p);
        })
        .catch(() => { /* toast on initial load only */ });
      if (eventChosen) refreshDecision();
    };
    window.addEventListener("focus", onRefocus);
    document.addEventListener("visibilitychange", onRefocus);
    return () => {
      window.removeEventListener("focus", onRefocus);
      document.removeEventListener("visibilitychange", onRefocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventChosen, session.moduleCode, session.eventCode, session.channel]);

  const readinessOk = !!decision && decision.allowed === true;

  // CH-SIMPLE-P3F-UX.6B — the exact resolved recipient must flow into Preview.
  // Any change resets every downstream authorisation.
  const resolvedRecipient =
    recipientResolution && recipientResolution.resolved === true
      ? recipientResolution.recipient
      : null;
  const resolvedRecipientSource: PreviewRecipientSource | null =
    recipientResolution && recipientResolution.resolved === true
      ? recipientResolution.source
      : null;

  useEffect(() => {
    setSession((s) => {
      if (
        !s.previewSnapshotId &&
        !s.previewApprovalId &&
        !s.dryRunExecutionId &&
        !s.dryRunCertificationId &&
        !s.controlledLiveExecutionId &&
        !s.controlledLiveCertificationId
      ) {
        return s;
      }
      return {
        ...s,
        previewSnapshotId: null,
        previewApprovalId: null,
        dryRunExecutionId: null,
        dryRunCertificationId: null,
        controlledLiveExecutionId: null,
        controlledLiveCertificationId: null,
      };
    });
    // Reset when the resolved recipient (or its source) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedRecipient, resolvedRecipientSource]);

  const previewLockedContext: PreviewLockedContext | null = useMemo(() => {
    if (!session.moduleCode || !session.eventCode || !resolvedRecipient || !resolvedRecipientSource) {
      return null;
    }
    return {
      moduleCode: session.moduleCode,
      eventCode: session.eventCode,
      channel: session.channel,
      resolvedRecipient,
      recipientSource: resolvedRecipientSource,
      testDataSource: "server default test context",
    };
  }, [session.moduleCode, session.eventCode, session.channel, resolvedRecipient, resolvedRecipientSource]);

  const previewApproved =
    !!session.previewApprovalId && !!session.previewSnapshotId;
  const dryRunCertified = !!session.dryRunCertificationId;
  // Step 6 unlock — requires the FULL controlled-live evidence contract, not
  // merely the presence of an execution ID. A BLOCKED / FAILED / *_FAILED /
  // PROVIDER_REJECTED execution must not be treated as a completed test.
  const CONTROLLED_LIVE_POSITIVE_STATUSES = ["PROVIDER_ACCEPTED", "DELIVERY_PENDING", "DELIVERED"];
  const controlledLiveDone =
    session.controlledLivePassed === true &&
    !!session.controlledLiveStatus &&
    CONTROLLED_LIVE_POSITIVE_STATUSES.includes(session.controlledLiveStatus) &&
    !!session.controlledLiveExecutionId &&
    !!session.controlledLiveDeliveryAttemptId &&
    !!session.controlledLiveDispatcherRevalidationDecisionId &&
    session.controlledLiveProviderCallAttempted === true &&
    session.controlledLiveCleanupSucceeded === true &&
    !!session.controlledLiveFinalOperatingMode &&
    !!session.controlledLiveCertificationId;

  const recipientBlocked =
    !!recipientResolution && recipientResolution.resolved === false;
  const stepStatus = useMemo(() => ({
    s1: eventChosen ? "done" as const : "current" as const,
    s2: !eventChosen ? "locked" as const
        : readinessOk ? "done" as const
        : (decision || recipientBlocked) ? "attention" as const : "current" as const,
    s3: !readinessOk ? "locked" as const
        : previewApproved ? "done" as const : "current" as const,
    s4: !previewApproved ? "locked" as const
        : dryRunCertified ? "done" as const : "current" as const,
    s5: !dryRunCertified ? "locked" as const
        : controlledLiveDone ? "done" as const : "current" as const,
    s6: !controlledLiveDone ? "locked" as const : "current" as const,
  }), [eventChosen, readinessOk, previewApproved, dryRunCertified, controlledLiveDone, decision, recipientBlocked]);

  /** Reset every downstream authorisation whenever the event context changes. */
  function applyModuleEventSelection(
    moduleCode: string,
    eventCode: string,
    channel: string,
  ) {
    setSession({
      ...EMPTY_SESSION,
      moduleCode,
      eventCode,
      channel: (channel || "email").toLowerCase(),
    });
    setDecision(null);
    setRecipientResolution(null);
    setSelectedRecipient(null);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (moduleCode) next.set("module", moduleCode); else next.delete("module");
        if (eventCode) next.set("event", eventCode); else next.delete("event");
        return next;
      },
      { replace: true },
    );
  }

  function handleModuleOnly(moduleCode: string) {
    setSession({
      ...EMPTY_SESSION,
      moduleCode,
      eventCode: "",
      channel: "email",
    });
    setDecision(null);
    setRecipientResolution(null);
    setSelectedRecipient(null);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (moduleCode) next.set("module", moduleCode); else next.delete("module");
        next.delete("event");
        return next;
      },
      { replace: true },
    );
  }

  function handleReset() {
    sessionStorage.removeItem(SESSION_KEY);
    setSession({ ...EMPTY_SESSION });
    setDecision(null);
    setRecipientResolution(null);
    setSelectedRecipient(null);
    setInvalidUrlNotice(null);
    setSearchParams(new URLSearchParams(), { replace: true });
  }

  // Resolve URL parameters against master data on mount / when URL changes.
  useEffect(() => {
    const urlModule = searchParams.get("module");
    const urlEvent = searchParams.get("event");
    if (!urlModule && !urlEvent) return;
    let cancelled = false;
    (async () => {
      try {
        const events = await fetchModuleEventDirectory();
        if (cancelled) return;
        const resolvedModule = resolveModule(events, urlModule);
        if (!resolvedModule) {
          setInvalidUrlNotice(
            `The module "${urlModule}" from the link is not available. Pick one below.`,
          );
          return;
        }
        if (!urlEvent) {
          if (session.moduleCode !== resolvedModule.moduleCode) {
            handleModuleOnly(resolvedModule.moduleCode);
          }
          setInvalidUrlNotice(null);
          return;
        }
        const resolvedEvent = resolveEvent(events, resolvedModule.moduleCode, urlEvent);
        if (!resolvedEvent) {
          setInvalidUrlNotice(
            `The event "${urlEvent}" is not registered for module "${resolvedModule.moduleCode}". Pick a valid event below.`,
          );
          if (session.moduleCode !== resolvedModule.moduleCode) {
            handleModuleOnly(resolvedModule.moduleCode);
          }
          return;
        }
        setInvalidUrlNotice(null);
        if (
          session.moduleCode !== resolvedEvent.moduleCode ||
          session.eventCode !== resolvedEvent.eventCode
        ) {
          applyModuleEventSelection(
            resolvedEvent.moduleCode,
            resolvedEvent.eventCode,
            (resolvedEvent.channel || "email").toLowerCase(),
          );
        }
      } catch (err: any) {
        if (!cancelled) {
          toast.error(err?.message ?? "Could not validate the linked module/event");
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const recipientSummary = useMemo(() => {
    if (!recipientPolicy) return "Loading…";
    switch (recipientPolicy.activeMode) {
      case "SINGLE_CONFIGURED_RECIPIENT":
        return recipientPolicy.singleConfiguredAddress
          ? `Single configured recipient: ${recipientPolicy.singleConfiguredAddress}`
          : "Single-configured mode selected but no address is set — fix in Recipient Policy.";
      case "APPROVED_NAMED_RECIPIENTS":
        return `Approved named list (${recipientPolicy.approvedNamedAddresses.length} entries)`;
      case "APPROVED_DOMAINS":
        return `Approved domain list (${recipientPolicy.approvedDomains.length} domains)`;
      default:
        return `Mode: ${recipientPolicy.activeMode}`;
    }
  }, [recipientPolicy]);

  return (
    <CommunicationHubWorkspaceShell
      title="Go Live"
      purpose="Guided journey that verifies readiness, preview approval, dry-run certification and a controlled-live test before any real email is sent."
      risk="action-capable"
      quickLinks={[
        { label: "Control Center", href: "/admin/communication-hub/control-center" },
        { label: "Recipient Policy", href: "/admin/communication-hub/recipient-policy" },
        { label: "Design & Templates", href: "/admin/communication-hub/design" },
        { label: "Testing & Pilots (advanced)", href: "/admin/communication-hub/pilots" },
      ]}
    >
      {loadError && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Hub settings unavailable</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {authError && (
        <Alert>
          <KeyRound className="h-4 w-4" />
          <AlertTitle>Authentication required</AlertTitle>
          <AlertDescription className="space-y-2">
            <div>
              Your session expired before the Dry Run started. No runtime
              records or provider calls were created.
            </div>
            <div className="text-xs text-muted-foreground">{authError.fix}</div>
            <dl className="grid gap-1 text-xs sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Authentication stage</dt><dd>Refresh / operator probe</dd></div>
              <div><dt className="text-muted-foreground">Access token</dt><dd>{authEvidence ? `Valid for ${Math.floor(authEvidence.tokenRemainingSeconds / 60)} minutes` : "Not action-ready"}</dd></div>
              <div><dt className="text-muted-foreground">Auth server user</dt><dd>{authEvidence?.authServerUserConfirmed ? "Confirmed" : "Not confirmed"}</dd></div>
              <div><dt className="text-muted-foreground">PostgREST operator identity</dt><dd>{postgrestConfirmed ? "Confirmed" : "Not confirmed"}</dd></div>
              <div><dt className="text-muted-foreground">Selected Preview</dt><dd>{session.previewSnapshotId ? "Selected — revalidation required" : "Not selected"}</dd></div>
              <div><dt className="text-muted-foreground">Selected approval</dt><dd>{previewApproved ? "Selected — revalidation required" : "Not active"}</dd></div>
            </dl>
            <div className="text-xs">No runtime rows · Provider calls: 0 · Simulator calls: 0 · Delivery attempts: 0</div>
            <div className="pt-1">
              <Button size="sm" onClick={handleRefreshSession} disabled={refreshingAuth}>
                {refreshingAuth ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Refreshing…
                  </>
                ) : (
                  "Refresh Session"
                )}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* CH-GL — Mode-driven entry point. Five named modes + Emergency Stop.
          Individual technical switches are managed by the server-side mode
          profile and are never surfaced as editable controls here. */}
      <ReleaseModeCards
        moduleCode={session.moduleCode || null}
        eventCode={session.eventCode || null}
        channel={session.channel || null}
        modeLockReason={stageReadiness.modeLockReason}
        onModeChanged={() => {
          fetchGlobalSettings().then(setSettings).catch(() => {});
          stageReadiness.refresh();
          if (eventChosen) refreshDecision();
        }}
      />

      {settings && settings.operatingMode === "AUTOMATED_PRODUCTION" && (
        <AutomationStandbyPanel
          settings={settings}
          onChanged={() => {
            fetchGlobalSettings().then(setSettings).catch(() => {});
          }}
        />
      )}

      <Separator />

      {settings && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Operating mode:</span>
          <Badge variant={settings.operatingMode === "EMERGENCY_STOP" ? "destructive" : "secondary"}>
            {settings.operatingMode}
          </Badge>
          <span className="text-muted-foreground">•</span>
          <span className="text-muted-foreground">Recipient policy:</span>
          <span>{recipientSummary}</span>
        </div>
      )}

      {/* Phase 4B3 — Compact whole-journey Gate Monitor. Server-authoritative,
          read-only. Creates zero runtime rows. */}
      <GoLiveGateMonitor
        moduleCode={session.moduleCode || null}
        eventCode={session.eventCode || null}
        channel={session.channel || null}
        previewSnapshotId={session.previewSnapshotId}
        previewApprovalId={session.previewApprovalId}
        dryRunExecutionId={session.dryRunExecutionId}
      />

      {/* STEP 1 — SELECT EVENT */}
      <CommunicationHubSectionCard
        title={<StepHeader index={1} title="Select Event" status={stepStatus.s1} /> as any}
        description="Choose the module and event you want to bring live. Selecting a new event resets every downstream approval."
      >
        <ModuleEventSelectors
          moduleCode={session.moduleCode}
          eventCode={session.eventCode}
          invalidNotice={invalidUrlNotice}
          onModuleChange={handleModuleOnly}
          onSelect={({ moduleCode, eventCode, channel }) =>
            applyModuleEventSelection(moduleCode, eventCode, channel)
          }
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={handleReset}>
            Reset journey
          </Button>
          {eventChosen && (
            <div className="text-sm">
              Journey scoped to <code className="font-mono">{session.moduleCode}</code> ·{" "}
              <code className="font-mono">{session.eventCode}</code> · channel <code>{session.channel}</code>.
            </div>
          )}
        </div>
        {eventChosen && (
          <div className="mt-4">
            <EventTestContextSummary
              moduleCode={session.moduleCode}
              eventCode={session.eventCode}
              channel={session.channel}
              resolution={recipientResolution}
              templateName={formatTemplateForDisplay(eventContext)}
              templateVersion={formatTemplateVersionForDisplay(eventContext)}
              senderMasked={formatSenderForDisplay(eventContext)}
              testDataSource="server default test context"
            />
          </div>
        )}
      </CommunicationHubSectionCard>

      <Separator />

      {/* STEP 2 — READINESS */}
      <CommunicationHubSectionCard
        title={<StepHeader index={2} title="Check Readiness" status={stepStatus.s2} /> as any}
        description="One readiness summary — hidden gates, passed checks and raw codes stay under Advanced diagnostics."
      >
        {!eventChosen ? (
          <div className="text-sm text-muted-foreground">Select an event to run the readiness check.</div>
        ) : (
          <div className="space-y-3">
            <RecipientResolutionPanel
              resolution={recipientResolution}
              loading={decisionLoading}
              onSelectRecipient={handleSelectRecipient}
              onRecheck={() => refreshDecision()}
              selectedRecipient={selectedRecipient}
            />
            <ReadinessSummary
              decision={decision}
              loading={decisionLoading}
              onRecheck={() => refreshDecision()}
              recipientContext={recipientCtx}
            />
          </div>
        )}
      </CommunicationHubSectionCard>

      <Separator />

      {/* STEP 3 — PREVIEW & APPROVE */}
      <span id="go-live-step-preview" aria-hidden />
      <CommunicationHubSectionCard
        title={<StepHeader index={3} title="Preview & Approve" status={stepStatus.s3} /> as any}
        description="Server renders a locked preview snapshot. Approving it produces the authorisation record required for the dry run."
      >
        {!readinessOk ? (
          <div className="text-sm text-muted-foreground">
            Locked. Readiness must pass before you can prepare a preview.
          </div>
        ) : (
          <PreviewApprovalPanel
            defaultModuleCode={session.moduleCode}
            defaultEventCode={session.eventCode}
            defaultChannel={session.channel}
            lockedContext={previewLockedContext}
            onApproved={(approval, snapshot) =>
              setSession((s) => ({
                ...s,
                previewSnapshotId: snapshot.snapshot_id,
                previewApprovalId: approval.approval_id,
                dryRunExecutionId: null,
                dryRunCertificationId: null,
                controlledLiveExecutionId: null,
                controlledLiveCertificationId: null,
              }))
            }
            onRevoked={() =>
              setSession((s) => ({
                ...s,
                previewApprovalId: null,
                dryRunExecutionId: null,
                dryRunCertificationId: null,
                controlledLiveExecutionId: null,
                controlledLiveCertificationId: null,
              }))
            }
          />
        )}
      </CommunicationHubSectionCard>

      <Separator />

      {/* STEP 4 — DRY RUN */}
      <span id="go-live-step-dry-run" aria-hidden />
      <CommunicationHubSectionCard
        title={<StepHeader index={4} title="Run Dry Test" status={stepStatus.s4} /> as any}
        description="One end-to-end simulation through the dispatcher — no provider call is ever made. A DRY_RUN_PASSED certification is required to enable the controlled-live test."
      >
        {!previewApproved ? (
          <div className="text-sm text-muted-foreground">
            Locked. Approve the preview first.
          </div>
        ) : (
          <DryRunPanel
            moduleCode={session.moduleCode}
            eventCode={session.eventCode}
            channel={session.channel}
            previewSnapshotId={session.previewSnapshotId}
            previewApprovalId={session.previewApprovalId}
            previewApproved={previewApproved}
            recipients={resolvedRecipient ? [resolvedRecipient] : []}
            canonicalDecision={
              decision
                ? {
                    ready: decision.allowed,
                    blockers: decision.blockers,
                    warnings: decision.warnings,
                  }
                : null
            }
            onSessionRestored={() => refreshDecision()}
            onFinal={(env, _v) =>
              setSession((s) => {
                const passed =
                  env.status === "DRY_RUN_PASSED" &&
                  env.passed === true &&
                  env.provider_call_attempted === false &&
                  !!env.dry_run_certification_id;
                return {
                  ...s,
                  dryRunExecutionId: env.dry_run_execution_id ?? null,
                  dryRunCertificationId: passed ? env.dry_run_certification_id ?? null : null,
                  controlledLiveExecutionId: null,
                  controlledLiveCertificationId: null,
                  controlledLivePassed: false,
                  controlledLiveStatus: null,
                  controlledLiveDeliveryAttemptId: null,
                  controlledLiveDispatcherRevalidationDecisionId: null,
                  controlledLiveProviderCallAttempted: false,
                  controlledLiveCleanupSucceeded: null,
                  controlledLiveFinalOperatingMode: null,
                };
              })
            }
          />
        )}
      </CommunicationHubSectionCard>

      <Separator />

      {/* STEP 5 — CONTROLLED LIVE */}
      <span id="go-live-step-controlled-live" aria-hidden />
      <CommunicationHubSectionCard
        title={<StepHeader index={5} title="Run Controlled Stub" status={stepStatus.s5} /> as any}
        description="Runs exactly one certified send against the deterministic provider stub. No real email leaves the platform at this stage."
      >
        {!dryRunCertified ? (
          <div className="text-sm text-muted-foreground">
            Locked. A DRY_RUN_PASSED certification is required.
          </div>
        ) : (
          <ControlledStubPanel
            moduleCode={session.moduleCode}
            eventCode={session.eventCode}
            channel="email"
            previewSnapshotId={session.previewSnapshotId}
            previewApprovalId={session.previewApprovalId}
            previewApproved={previewApproved}
            dryRunCertificationId={session.dryRunCertificationId}
            dryRunCertified={dryRunCertified}
            canonicalDecision={
              decision
                ? {
                    ready: decision.allowed,
                    blockers: decision.blockers,
                    warnings: decision.warnings,
                  }
                : null
            }
            operatingMode={settings?.operatingMode ?? null}
            onCompleted={(r) =>
              setSession((s) => ({
                ...s,
                controlledLiveExecutionId: r.executionId ?? null,
                controlledLiveCertificationId: r.certificationId ?? null,
                controlledLivePassed: r.passed === true,
                controlledLiveStatus: r.status ?? null,
                controlledLiveDeliveryAttemptId: r.deliveryAttemptId ?? null,
                controlledLiveDispatcherRevalidationDecisionId:
                  r.dispatcherRevalidationDecisionId ?? null,
                controlledLiveProviderCallAttempted: r.providerCallAttempted === true,
                controlledLiveCleanupSucceeded: r.cleanupSucceeded,
                controlledLiveFinalOperatingMode: r.finalOperatingMode ?? null,
              }))
            }
          />
        )}
      </CommunicationHubSectionCard>

      <Separator />

      {/* STEP 6 — SEND ONE REAL EMAIL (locked) */}
      <CommunicationHubSectionCard
        title={
          <StepHeader
            index={6}
            title="Send One Real Email"
            status={controlledLiveDone ? "attention" : "locked"}
            hint={
              controlledLiveDone
                ? stageReadiness.stageLockReason.ONE_REAL_EMAIL ?? undefined
                : "Locked. Requires a passing Controlled Stub certification and platform-approved real-provider gate."
            }
          /> as any
        }
        description="Reserved single real send with a one-use server grant. Enabled only when platform administrators explicitly unlock the real-provider gate."
      >
        <OneRealEmailPanel
          controlledStubCertified={controlledLiveDone}
          lockReason={stageReadiness.stageLockReason.ONE_REAL_EMAIL ?? null}
        />
      </CommunicationHubSectionCard>

      <Separator />

      {/* STEP 7 — ACTIVATE MANUAL PRODUCTION (locked) */}
      <CommunicationHubSectionCard
        title={
          <StepHeader
            index={7}
            title="Activate Manual Production"
            status={stageReadiness.stageLockReason.MANUAL_PRODUCTION ? "locked" : "attention"}
            hint={stageReadiness.stageLockReason.MANUAL_PRODUCTION ?? "Ready to activate from the mode cards above."}
          /> as any
        }
        description="Certified events send by explicit operator action only. Activated via the Manual Production mode card once the event is certified."
      >
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertTitle>{stageReadiness.stageLockReason.MANUAL_PRODUCTION ? "Locked" : "Ready to activate"}</AlertTitle>
          <AlertDescription>
            {stageReadiness.stageLockReason.MANUAL_PRODUCTION ??
              "Use the Manual Production mode card at the top of the page to activate."}
          </AlertDescription>
        </Alert>
      </CommunicationHubSectionCard>

      <Separator />

      {/* STEP 8 — ACTIVATE AUTOMATED PRODUCTION (locked) */}
      <CommunicationHubSectionCard
        title={
          <StepHeader
            index={8}
            title="Activate Automated Production"
            status={stageReadiness.stageLockReason.AUTOMATED_PRODUCTION ? "locked" : "attention"}
            hint={stageReadiness.stageLockReason.AUTOMATED_PRODUCTION ?? "Ready to activate from the mode cards above."}
          /> as any
        }
        description="Certified events run automatically under policy. Activated via the Automated Production mode card once the event is certified for cron."
      >
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertTitle>{stageReadiness.stageLockReason.AUTOMATED_PRODUCTION ? "Locked" : "Ready to activate"}</AlertTitle>
          <AlertDescription>
            {stageReadiness.stageLockReason.AUTOMATED_PRODUCTION ??
              "Use the Automated Production mode card at the top of the page to activate."}
          </AlertDescription>
        </Alert>
      </CommunicationHubSectionCard>

      <Separator />

      {/* STEP 9 — REVIEW */}
      <CommunicationHubSectionCard
        title={<StepHeader index={9} title="Review & Complete" status={stepStatus.s6} /> as any}
        description="Full evidence trail for this event. All ids below are server-issued — nothing here is authoritative in the browser."
      >
        {!controlledLiveDone ? (
          <div className="text-sm text-muted-foreground">
            Locked. Complete the Controlled Stub certification to view the evidence summary.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div><span className="text-muted-foreground">Module / Event:</span> {session.moduleCode} / {session.eventCode}</div>
            <div><span className="text-muted-foreground">Channel:</span> {session.channel}</div>
            <div><span className="text-muted-foreground">Preview snapshot id:</span> <code className="font-mono text-xs">{session.previewSnapshotId ?? "—"}</code></div>
            <div><span className="text-muted-foreground">Preview approval id:</span> <code className="font-mono text-xs">{session.previewApprovalId ?? "—"}</code></div>
            <div><span className="text-muted-foreground">Dry-run execution id:</span> <code className="font-mono text-xs">{session.dryRunExecutionId ?? "—"}</code></div>
            <div><span className="text-muted-foreground">Dry-run certification id:</span> <code className="font-mono text-xs">{session.dryRunCertificationId ?? "—"}</code></div>
            <div><span className="text-muted-foreground">Controlled-stub execution id:</span> <code className="font-mono text-xs">{session.controlledLiveExecutionId ?? "—"}</code></div>
            <div><span className="text-muted-foreground">Controlled-stub certification id:</span> <code className="font-mono text-xs">{session.controlledLiveCertificationId ?? "—"}</code></div>
            <div className="md:col-span-2">
              <Alert>
                <AlertTitle>Recommendation</AlertTitle>
                <AlertDescription>
                  This event is <strong>P3E_STUB_CERTIFIED</strong> once the controlled-stub test passes.
                  Send One Real Email, Manual Production and Automated Production remain locked until
                  platform administrators unlock the real-provider gate and certify the event for
                  live_manual_only / live_cron_allowed.
                </AlertDescription>
              </Alert>
            </div>
          </div>
        )}
      </CommunicationHubSectionCard>
    </CommunicationHubWorkspaceShell>
  );
}
