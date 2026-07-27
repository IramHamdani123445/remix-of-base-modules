/**
 * A4.1.1 — Simplified Operations page (stabilised).
 *
 * Read-only derivation over existing authorities:
 *   - RuntimeContractContext         (runtime contract report)
 *   - getEventGoLiveStatus RPC       (Stage 6/7/8 authoritative view)
 *   - listRevalidationCycles RPC     (active cycles for the event)
 *
 * Never re-interprets query failures as incomplete stages. Every source has
 * distinct loading / success / error states surfaced as its own row so the
 * screen never says "Loading" indefinitely or "Complete Stage 6" for an event
 * that already passed Stage 6.
 */
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import CommunicationHubWorkspaceShell, {
  CommunicationHubSectionCard,
} from "../components/CommunicationHubWorkspaceShell";
import { CommunicationHubGoLiveTabs } from "../components/CommunicationHubGoLiveTabs";
import ModuleEventSelectors from "./ModuleEventSelectors";
import { useCommunicationHubWorkspace } from "./WorkspaceContext";
import { useRuntimeContract } from "@/platform/communication-hub/RuntimeContractContext";
import {
  getEventGoLiveStatus,
  type EventGoLiveStatus,
} from "@/platform/communication-hub/eventGoLiveStatusService";
import {
  listRevalidationCycles,
  type RevalidationCycle,
} from "@/platform/communication-hub/revalidationService";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CheckCircle2, Circle, ChevronDown, Info, ShieldAlert, ArrowRight,
  RefreshCcw, Inbox, ZapOff, AlertTriangle,
} from "lucide-react";
import { useState, useMemo } from "react";

/* ---------- Types --------------------------------------------------------- */

type SourceState = "loading" | "success" | "error";
type ReadinessBadge = "READY" | "BLOCKED" | "ACTION_REQUIRED" | "PROCESSING" | "UNAVAILABLE";

type StageState = "COMPLETED" | "CURRENT" | "BLOCKED" | "ACTION_REQUIRED" | "FUTURE";
interface StageDescriptor {
  code: string;
  label: string;
  state: StageState;
  detail?: string;
  href?: string;
}

interface DerivedReadiness {
  state: ReadinessBadge;
  blockerCount: number;
  explanation: string;
  errorCode?: string;
}

interface NextAction {
  code: string;
  label: string;
  reason: string;
  href?: string;
}

interface RevalidationSummary {
  cycle: RevalidationCycle | null;
  needsReassessment: boolean;
  providerTouched: boolean;
  nextActionLabel: string;
}

/* ---------- Helpers ------------------------------------------------------- */

function readinessColor(state: ReadinessBadge) {
  switch (state) {
    case "READY": return "border-emerald-300 bg-emerald-50 text-emerald-800";
    case "BLOCKED": return "border-red-300 bg-red-50 text-red-800";
    case "ACTION_REQUIRED": return "border-amber-300 bg-amber-50 text-amber-900";
    case "PROCESSING": return "border-sky-300 bg-sky-50 text-sky-800";
    case "UNAVAILABLE": return "border-slate-300 bg-slate-50 text-slate-700";
  }
}

function stageColor(state: StageState) {
  switch (state) {
    case "COMPLETED": return "text-emerald-700 bg-emerald-50 border-emerald-200";
    case "CURRENT": return "text-primary bg-primary/5 border-primary/30";
    case "BLOCKED": return "text-red-700 bg-red-50 border-red-200";
    case "ACTION_REQUIRED": return "text-amber-900 bg-amber-50 border-amber-200";
    case "FUTURE": return "text-muted-foreground bg-muted/30 border-muted";
  }
}

function stage6Complete(s: EventGoLiveStatus | null | undefined): boolean {
  const s6 = s?.stage6;
  if (!s6) return false;
  if (s6.stage6_ready_for_manual_production) return true;
  return (
    !!s6.eligible_one_real_email_certification_id &&
    s6.manual_verification_status === "CONFIRMED" &&
    !!s6.provider_message_id &&
    !!s6.delivery_attempt_id &&
    !!s6.trace_id &&
    s6.reconciliation_required !== true
  );
}

function eventCertified(s: EventGoLiveStatus | null | undefined): boolean {
  const es = s?.stage7?.manual_event_status;
  return es === "live_manual_only" || es === "live_cron_allowed";
}

/* ---------- Page ---------------------------------------------------------- */

export default function SimpleOperationsPage() {
  const { moduleCode, eventCode, channel, hasSelection, setSelection } =
    useCommunicationHubWorkspace();
  const location = useLocation();
  const searchQS = location.search || "";
  const withSearch = (path: string) => (searchQS ? `${path}${searchQS}` : path);

  const {
    report,
    loading: contractLoading,
    error: contractError,
  } = useRuntimeContract();

  const goLiveQ = useQuery({
    queryKey: ["comm-hub-simple-ops-status", moduleCode, eventCode, channel],
    queryFn: () => getEventGoLiveStatus({ moduleCode, eventCode, channel }),
    enabled: hasSelection,
    staleTime: 15_000,
    retry: 1,
  });

  const revalQ = useQuery({
    queryKey: ["comm-hub-simple-ops-reval", moduleCode, eventCode, channel],
    queryFn: () => listRevalidationCycles({
      moduleCode, eventCode, channel, limit: 5,
    }),
    enabled: hasSelection,
    staleTime: 30_000,
    retry: 1,
  });

  const goLive = goLiveQ.data ?? null;
  const goLiveSource: SourceState =
    goLiveQ.isLoading ? "loading" : goLiveQ.isError ? "error" : "success";
  const revalSource: SourceState =
    revalQ.isLoading ? "loading" : revalQ.isError ? "error" : "success";

  const readiness = useMemo(
    () => deriveReadiness({
      contractLoading, contractError, report,
      goLiveSource, goLive,
    }),
    [contractLoading, contractError, report, goLiveSource, goLive],
  );

  const revalidation = useMemo(
    () => deriveRevalidation(revalQ.data ?? [], goLive),
    [revalQ.data, goLive],
  );

  const stages = useMemo(
    () => deriveCanonicalStages(goLive, goLiveSource, revalidation, withSearch),
    [goLive, goLiveSource, revalidation, searchQS],
  );

  const nextAction = useMemo(
    () => deriveNextAction({
      goLive, goLiveSource, contractError, readiness, revalidation, withSearch,
    }),
    [goLive, goLiveSource, contractError, readiness, revalidation, searchQS],
  );

  return (
    <CommunicationHubWorkspaceShell
      title="Operations"
      purpose="Send-decision lifecycle for the selected event. Detailed diagnostics live in Readiness; controlled revalidation lives in Revalidation."
      section="Go-Live"
      risk="action-capable"
    >
      <CommunicationHubGoLiveTabs />

      <CommunicationHubSectionCard title="Event context">
        <ModuleEventSelectors
          moduleCode={moduleCode}
          eventCode={eventCode}
          onModuleChange={(m) => setSelection({ moduleCode: m, eventCode: "" })}
          onSelect={(r) => setSelection({
            moduleCode: r.moduleCode, eventCode: r.eventCode, channel: r.channel,
          })}
        />
      </CommunicationHubSectionCard>

      {!hasSelection && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Select a module and event</AlertTitle>
          <AlertDescription>
            Choose the module and event to load the lifecycle summary for this workspace.
          </AlertDescription>
        </Alert>
      )}

      {hasSelection && (
        <div className="grid gap-4 md:grid-cols-2">
          <CurrentStateCard
            goLive={goLive}
            source={goLiveSource}
            onRetry={() => goLiveQ.refetch()}
          />
          <ReadinessSummaryCard readiness={readiness} to={withSearch("/admin/communication-hub/readiness")} />
        </div>
      )}

      {hasSelection && (
        <NextActionCard action={nextAction} source={goLiveSource} />
      )}

      {hasSelection && (
        <CanonicalJourneyCard
          stages={stages}
          source={goLiveSource}
          onRetry={() => goLiveQ.refetch()}
        />
      )}

      {hasSelection && (
        <SafetyStripCard goLive={goLive} withSearch={withSearch} />
      )}

      {hasSelection && (
        <RevalidationSummaryCard
          summary={revalidation}
          source={revalSource}
          onRetry={() => revalQ.refetch()}
          to={withSearch("/admin/communication-hub/revalidation")}
        />
      )}

      <div className="text-xs text-muted-foreground">
        Need the full nine-stage journey?{" "}
        <Link to={withSearch("/admin/communication-hub/go-live/advanced")} className="underline">
          Open the advanced Go-Live view
        </Link>
        .
      </div>
    </CommunicationHubWorkspaceShell>
  );
}

/* ---------- Derivations --------------------------------------------------- */

function deriveReadiness(input: {
  contractLoading: boolean;
  contractError: string | null;
  report: ReturnType<typeof useRuntimeContract>["report"];
  goLiveSource: SourceState;
  goLive: EventGoLiveStatus | null;
}): DerivedReadiness {
  const { contractLoading, contractError, report, goLiveSource, goLive } = input;

  if (contractLoading || goLiveSource === "loading") {
    return { state: "PROCESSING", blockerCount: 0, explanation: "Loading current readiness…" };
  }
  if (contractError) {
    return {
      state: "UNAVAILABLE",
      blockerCount: 0,
      explanation: "Runtime contract failed to load. Open Readiness for the raw audit error.",
      errorCode: "RUNTIME_CONTRACT_FAILED",
    };
  }
  if (goLiveSource === "error") {
    return {
      state: "UNAVAILABLE",
      blockerCount: 0,
      explanation: "Could not load event status. This is a query failure — not an incomplete stage.",
      errorCode: "EVENT_STATUS_LOAD_FAILED",
    };
  }
  const failing = report?.checks.filter((c) => c.status !== "PASS") ?? [];
  if (failing.length > 0) {
    return {
      state: "BLOCKED",
      blockerCount: failing.length,
      explanation: `${failing.length} runtime-contract requirement${failing.length === 1 ? "" : "s"} not passing.`,
    };
  }
  const s6Blockers: any[] = goLive?.stage6?.stage6_manual_production_blockers ?? [];
  if (s6Blockers.length > 0 && !stage6Complete(goLive)) {
    return {
      state: "ACTION_REQUIRED",
      blockerCount: s6Blockers.length,
      explanation: "Manual Production not yet eligible for this event.",
    };
  }
  const s8Blockers: any[] = goLive?.stage8?.automated_blockers ?? [];
  if (s8Blockers.length > 0) {
    return {
      state: "ACTION_REQUIRED",
      blockerCount: s8Blockers.length,
      explanation: "Automated Production readiness has remaining items.",
    };
  }
  return { state: "READY", blockerCount: 0, explanation: "All server-side readiness checks pass." };
}

function deriveRevalidation(cycles: RevalidationCycle[], goLive: EventGoLiveStatus | null): RevalidationSummary {
  const active = cycles.find((c) =>
    c.status !== "PROMOTED" && c.status !== "VOIDED" && c.status !== "SUPERSEDED"
  ) ?? null;

  if (!active) {
    return {
      cycle: null,
      needsReassessment: false,
      providerTouched: false,
      nextActionLabel: goLive?.stage6?.one_real_email_certification_id
        ? "Assess when a change is declared"
        : "Establish baseline first",
    };
  }
  const needsReassessment = active.status === "DRAFT" || active.status === "ASSESSING";
  const nextActionLabel = needsReassessment
    ? "Reassess after baseline convergence"
    : active.status === "READY_FOR_CONTROLLED_EMAIL"
      ? "Issue send authorisation"
      : active.status === "EMAIL_AUTHORISED"
        ? "Prepare controlled delivery"
        : active.status === "AWAITING_INBOX_CONFIRMATION"
          ? "Confirm inbox receipt"
          : active.status === "READY_FOR_PROMOTION"
            ? "Promote revalidation baseline"
            : `Continue: ${active.status}`;
  return {
    cycle: active,
    needsReassessment,
    providerTouched: !!active.provider_call_attempted,
    nextActionLabel,
  };
}

function deriveCanonicalStages(
  goLive: EventGoLiveStatus | null,
  source: SourceState,
  revalidation: RevalidationSummary,
  withSearch: (p: string) => string,
): StageDescriptor[] {
  const advanced = withSearch("/admin/communication-hub/go-live/advanced");
  const reval = withSearch("/admin/communication-hub/revalidation");

  if (source !== "success" || !goLive) {
    // Preserve the canonical shape even when data is missing — but do not
    // guess "completed" or "action required" from a query failure.
    const state: StageState = source === "loading" ? "FUTURE" : "FUTURE";
    return CANONICAL_STAGE_CODES.map((c) => ({
      code: c.code,
      label: c.label,
      state,
      detail: source === "error" ? "Status unavailable" : source === "loading" ? "Loading…" : undefined,
      href: c.href ? withSearch(c.href) : undefined,
    }));
  }

  const s6 = goLive.stage6 ?? ({} as EventGoLiveStatus["stage6"]);
  const s7 = goLive.stage7 ?? ({} as EventGoLiveStatus["stage7"]);
  const s8 = goLive.stage8 ?? ({} as EventGoLiveStatus["stage8"]);
  const platform = goLive.platform ?? ({} as EventGoLiveStatus["platform"]);

  const s6Done = stage6Complete(goLive);
  const s7Cert = eventCertified(goLive);
  const manualMode = platform.current_operating_mode === "MANUAL_PRODUCTION" ||
                     platform.current_operating_mode === "AUTOMATED_PRODUCTION";
  const s7Done = s7Cert && manualMode;
  const s8Cert = s8.automation_event_certification_status === "live_cron_allowed";
  const s8Standby = platform.automation_state === "STANDBY";
  const s8Armed = platform.automation_state === "ARMED";
  const s8Done = s8Cert && s8Armed;

  // Preview / Dry Run / Controlled Stub — pre-production certifications.
  // We treat them as completed once Stage 6 (One Real Email) has been
  // certified, because Stage 6 gates on all three. If Stage 6 is not
  // complete they show as FUTURE (evidence lives in Readiness).
  const preProdState: StageState = s6Done ? "COMPLETED" : "FUTURE";

  const stages: StageDescriptor[] = [
    {
      code: "READINESS",
      label: "Readiness",
      state: s6Done ? "COMPLETED" : "CURRENT",
      detail: s6Done ? "Runtime contract passing" : "Runtime-contract & pre-flight checks",
      href: withSearch("/admin/communication-hub/readiness"),
    },
    {
      code: "PREVIEW_APPROVAL",
      label: "Preview Approval",
      state: preProdState,
      detail: preProdState === "COMPLETED" ? "Approved before certification" : "Pending",
      href: advanced,
    },
    {
      code: "DRY_RUN",
      label: "Dry Run",
      state: preProdState,
      detail: preProdState === "COMPLETED" ? "Certified" : "Pending",
      href: advanced,
    },
    {
      code: "CONTROLLED_STUB",
      label: "Controlled Stub",
      state: preProdState,
      detail: preProdState === "COMPLETED" ? "Certified" : "Pending",
      href: advanced,
    },
    {
      code: "ONE_REAL_EMAIL",
      label: "One Real Email",
      state: s6Done ? "COMPLETED" : "CURRENT",
      detail: s6Done
        ? `Verified · cert ${(s6.eligible_one_real_email_certification_id ?? s6.one_real_email_certification_id ?? "").slice(0, 8)}`
        : (s6.one_real_email_certification_status ?? "Not yet sent"),
      href: advanced,
    },
    {
      code: "MANUAL_PRODUCTION",
      label: "Manual Production",
      state: s7Done ? "COMPLETED" : s6Done ? "CURRENT" : "FUTURE",
      detail: s7.manual_event_status
        ? `${s7.manual_event_status} · ${platform.current_operating_mode ?? "—"}`
        : "Awaiting event certification & mode switch",
      href: advanced,
    },
    {
      code: "CONTROLLED_REVALIDATION",
      label: "Controlled Revalidation",
      state: revalidation.cycle
        ? (revalidation.cycle.status === "PROMOTED" ? "COMPLETED"
          : revalidation.needsReassessment ? "ACTION_REQUIRED" : "CURRENT")
        : (s7Done ? "FUTURE" : "FUTURE"),
      detail: revalidation.cycle
        ? `Cycle ${revalidation.cycle.id.slice(0, 8)} · ${revalidation.cycle.status}`
        : "No active cycle",
      href: reval,
    },
    {
      code: "AUTOMATED_PRODUCTION",
      label: "Automated Production",
      state: s8Done
        ? "COMPLETED"
        : (s8Cert && s8Standby) ? "ACTION_REQUIRED"
        : s7Done ? "CURRENT" : "FUTURE",
      detail: s8.automation_event_certification_status
        ? `${s8.automation_event_certification_status} · ${platform.automation_state ?? "—"}`
        : "Not yet certified",
      href: advanced,
    },
  ];

  // Ensure exactly one CURRENT (first non-completed non-future).
  let currentAssigned = false;
  for (const s of stages) {
    if (s.state === "CURRENT") {
      if (currentAssigned) s.state = "ACTION_REQUIRED";
      currentAssigned = true;
    }
  }
  return stages;
}

const CANONICAL_STAGE_CODES: Array<{ code: string; label: string; href?: string }> = [
  { code: "READINESS", label: "Readiness", href: "/admin/communication-hub/readiness" },
  { code: "PREVIEW_APPROVAL", label: "Preview Approval", href: "/admin/communication-hub/go-live/advanced" },
  { code: "DRY_RUN", label: "Dry Run", href: "/admin/communication-hub/go-live/advanced" },
  { code: "CONTROLLED_STUB", label: "Controlled Stub", href: "/admin/communication-hub/go-live/advanced" },
  { code: "ONE_REAL_EMAIL", label: "One Real Email", href: "/admin/communication-hub/go-live/advanced" },
  { code: "MANUAL_PRODUCTION", label: "Manual Production", href: "/admin/communication-hub/go-live/advanced" },
  { code: "CONTROLLED_REVALIDATION", label: "Controlled Revalidation", href: "/admin/communication-hub/revalidation" },
  { code: "AUTOMATED_PRODUCTION", label: "Automated Production", href: "/admin/communication-hub/go-live/advanced" },
];

function deriveNextAction(input: {
  goLive: EventGoLiveStatus | null;
  goLiveSource: SourceState;
  contractError: string | null;
  readiness: DerivedReadiness;
  revalidation: RevalidationSummary;
  withSearch: (p: string) => string;
}): NextAction | null {
  const { goLive, goLiveSource, contractError, readiness, revalidation, withSearch } = input;
  const advanced = withSearch("/admin/communication-hub/go-live/advanced");
  const reval = withSearch("/admin/communication-hub/revalidation");
  const readinessLink = withSearch("/admin/communication-hub/readiness");

  if (goLiveSource === "loading") {
    return { code: "LOADING", label: "Loading current state…", reason: "Waiting for authoritative status.", href: undefined };
  }
  if (goLiveSource === "error") {
    return {
      code: "EVENT_STATUS_LOAD_FAILED",
      label: "Retry loading event status",
      reason: "Query failure — this is not an incomplete stage.",
    };
  }
  if (contractError) {
    return {
      code: "RUNTIME_CONTRACT_FAILED",
      label: "Open Readiness to view runtime-contract error",
      reason: "Runtime contract audit failed; readiness cannot be derived.",
      href: readinessLink,
    };
  }
  if (!goLive) return null;

  const s6Done = stage6Complete(goLive);
  const s7Cert = eventCertified(goLive);
  const platform = goLive.platform;
  const manualMode = platform?.current_operating_mode === "MANUAL_PRODUCTION" ||
                     platform?.current_operating_mode === "AUTOMATED_PRODUCTION";

  if (!s6Done) {
    return {
      code: "COMPLETE_STAGE_6",
      label: "Send & verify one real email",
      reason: "One Real Email has not been server-verified.",
      href: advanced,
    };
  }
  if (!s7Cert) {
    return {
      code: "CERTIFY_MANUAL_PRODUCTION",
      label: "Certify event for Manual Production",
      reason: "Manual event certification is missing.",
      href: advanced,
    };
  }
  if (!manualMode) {
    return {
      code: "SWITCH_OPERATING_MODE",
      label: "Switch platform mode to MANUAL_PRODUCTION",
      reason: "Operating mode is not MANUAL_PRODUCTION.",
      href: advanced,
    };
  }
  if (revalidation.cycle && revalidation.needsReassessment) {
    return {
      code: "REASSESS_REVALIDATION",
      label: "Reassess controlled-revalidation cycle",
      reason: `Cycle ${revalidation.cycle.id.slice(0, 8)} needs reassessment before further action.`,
      href: reval,
    };
  }
  if (revalidation.cycle) {
    return {
      code: "CONTINUE_REVALIDATION",
      label: revalidation.nextActionLabel,
      reason: `Active cycle status: ${revalidation.cycle.status}.`,
      href: reval,
    };
  }
  if (readiness.state === "ACTION_REQUIRED") {
    return {
      code: "RESOLVE_READINESS",
      label: "Resolve outstanding readiness items",
      reason: readiness.explanation,
      href: readinessLink,
    };
  }
  const s8 = goLive.stage8;
  if (s8?.automated_eligible && platform?.automation_state === "STANDBY") {
    return {
      code: "ARM_AUTOMATION",
      label: "Arm automation",
      reason: "Automated certification passed; automation is on STANDBY.",
      href: advanced,
    };
  }
  return {
    code: "MONITOR",
    label: "Monitor automated production",
    reason: "Event is live; no operator action required.",
    href: advanced,
  };
}

/* ---------- Cards --------------------------------------------------------- */

function CurrentStateCard({
  goLive, source, onRetry,
}: {
  goLive: EventGoLiveStatus | null;
  source: SourceState;
  onRetry: () => void;
}) {
  const platform = goLive?.platform;
  const s6 = goLive?.stage6;
  const s7 = goLive?.stage7;
  const baseline = deriveBaselineDisplay(goLive);

  return (
    <Card data-testid="ops-current-state-card">
      <CardHeader><CardTitle className="text-sm">Current state</CardTitle></CardHeader>
      <CardContent className="text-sm space-y-1.5">
        {source === "loading" && <div className="text-muted-foreground">Loading event status…</div>}
        {source === "error" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Failed to load event status
              <Badge variant="outline" className="font-mono text-[10px]">EVENT_STATUS_LOAD_FAILED</Badge>
            </div>
            <Button size="sm" variant="outline" onClick={onRetry} data-testid="ops-current-state-retry">
              <RefreshCcw className="h-3.5 w-3.5 mr-1" />Retry
            </Button>
          </div>
        )}
        {source === "success" && goLive && (
          <>
            <Row label="Operating mode" value={<span data-testid="ops-mode">{platform?.current_operating_mode ?? "—"}</span>} />
            <Row label="Automation state" value={<span data-testid="ops-automation">{platform?.automation_state ?? "—"}</span>} />
            <Row label="Event status" value={<span data-testid="ops-event-status">{s7?.manual_event_status ?? s6?.one_real_email_certification_status ?? "not_certified"}</span>} />
            <Row label="Baseline" value={
              <span data-testid="ops-baseline" className="inline-flex items-center gap-2">
                <Badge variant="outline">{baseline.label}</Badge>
                {baseline.detail && <span className="text-xs text-muted-foreground">{baseline.detail}</span>}
              </span>
            } />
            <Row label="Last delivery" value={s7?.latest_manual_observation_status ?? s6?.one_real_email_certification_status ?? "—"} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function deriveBaselineDisplay(goLive: EventGoLiveStatus | null): { label: string; detail?: string } {
  if (!goLive) return { label: "UNAVAILABLE" };
  const s6 = goLive.stage6;
  const s7 = goLive.stage7;
  if (!s6?.eligible_one_real_email_certification_id && !s6?.one_real_email_certification_id) {
    return { label: "NOT ESTABLISHED" };
  }
  if (s7?.drift_detected) {
    return { label: "DIVERGENT", detail: s7.drift_reason ?? "drift detected" };
  }
  // Legacy attestation heuristic: if certification exists but ORE lineage
  // is not converged, surface diagnosis-required.
  if (s6.eligible_one_real_email_certification_id && !s6.stage6_ready_for_manual_production) {
    return { label: "LEGACY BASELINE — DIAGNOSIS REQUIRED", detail: "Legacy attestation not yet converged" };
  }
  return { label: "CONVERGED", detail: `cert ${(s6.eligible_one_real_email_certification_id ?? "").slice(0, 8)}` };
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function ReadinessSummaryCard({ readiness, to }: { readiness: DerivedReadiness; to: string }) {
  return (
    <Card data-testid="ops-readiness-summary-card">
      <CardHeader><CardTitle className="text-sm">Readiness</CardTitle></CardHeader>
      <CardContent className="text-sm space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={readinessColor(readiness.state)}>
            {readiness.state.replace("_", " ")}
          </Badge>
          {readiness.errorCode && (
            <Badge variant="outline" className="font-mono text-[10px]">{readiness.errorCode}</Badge>
          )}
          {readiness.blockerCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {readiness.blockerCount} blocker{readiness.blockerCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <p className="text-muted-foreground">{readiness.explanation}</p>
        <Button asChild size="sm" variant="outline">
          <Link to={to}>Open Readiness <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function NextActionCard({ action, source }: { action: NextAction | null; source: SourceState }) {
  return (
    <Card data-testid="ops-next-action-card">
      <CardHeader><CardTitle className="text-sm">Next action</CardTitle></CardHeader>
      <CardContent className="text-sm space-y-2">
        {source === "loading" && <div className="text-muted-foreground">Loading…</div>}
        {source !== "loading" && !action && <div className="text-muted-foreground">No action derivable yet.</div>}
        {action && (
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium" data-testid="ops-next-action-label">{action.label}</div>
              <div className="text-xs text-muted-foreground" data-testid="ops-next-action-reason">
                {action.reason}
              </div>
            </div>
            {action.href && (
              <Button asChild size="sm" data-testid="ops-next-action-btn">
                <Link to={action.href}>Open <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CanonicalJourneyCard({
  stages, source, onRetry,
}: {
  stages: StageDescriptor[];
  source: SourceState;
  onRetry: () => void;
}) {
  return (
    <Card data-testid="ops-lifecycle-stepper">
      <CardHeader>
        <CardTitle className="text-sm">Canonical Go-Live journey</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {source === "error" && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertTriangle className="h-4 w-4" />
            Journey unavailable — event status failed to load.
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RefreshCcw className="h-3.5 w-3.5 mr-1" />Retry
            </Button>
          </div>
        )}
        {stages.map((s) => (
          <StageRow key={s.code} stage={s} />
        ))}
      </CardContent>
    </Card>
  );
}

function StageRow({ stage }: { stage: StageDescriptor }) {
  const [open, setOpen] = useState(stage.state === "CURRENT" || stage.state === "ACTION_REQUIRED" || stage.state === "BLOCKED");
  const expanded = open;
  const Icon = stage.state === "COMPLETED" ? CheckCircle2
             : stage.state === "CURRENT" ? ChevronDown
             : stage.state === "BLOCKED" || stage.state === "ACTION_REQUIRED" ? AlertTriangle
             : Circle;
  return (
    <div
      className={`rounded border p-2 ${stageColor(stage.state)}`}
      data-testid={`ops-lifecycle-stage-${stage.code}`}
      data-state={stage.state.toLowerCase()}
      data-expanded={expanded ? "true" : "false"}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left text-sm"
      >
        <Icon className="h-4 w-4" />
        <span className="font-medium">{stage.label}</span>
        <Badge variant="outline" className="ml-auto text-[10px]">{stage.state}</Badge>
      </button>
      {expanded && (stage.detail || stage.href) && (
        <div className="mt-1 pl-6 text-xs space-y-1">
          {stage.detail && <div className="text-muted-foreground">{stage.detail}</div>}
          {stage.href && stage.state !== "COMPLETED" && (
            <Link to={stage.href} className="underline text-xs">Open</Link>
          )}
          {stage.href && stage.state === "COMPLETED" && (
            <Link to={stage.href} className="underline text-xs">View evidence</Link>
          )}
        </div>
      )}
    </div>
  );
}

function SafetyStripCard({
  goLive, withSearch,
}: { goLive: EventGoLiveStatus | null; withSearch: (p: string) => string }) {
  const platform = goLive?.platform;
  const armed = platform?.automation_state === "ARMED" || platform?.automation_state === "ARMING";
  const s6 = goLive?.stage6;
  const hasRecoverable = !!s6?.reconciliation_required;
  const providerAccepted = !!s6?.provider_message_id;
  const inboxConfirmed = s6?.manual_verification_status === "CONFIRMED";
  const showConfirmInbox = providerAccepted && !inboxConfirmed;

  return (
    <Card data-testid="ops-safety-strip">
      <CardHeader><CardTitle className="text-sm">Safety controls</CardTitle></CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="destructive" data-testid="ops-emergency-stop">
          <Link to={withSearch("/admin/communication-hub/safety")}>
            <ShieldAlert className="h-4 w-4 mr-1" />Emergency Stop
          </Link>
        </Button>
        {armed && (
          <Button asChild size="sm" variant="outline" data-testid="ops-disarm">
            <Link to={withSearch("/admin/communication-hub/safety")}>
              <ZapOff className="h-4 w-4 mr-1" />Disarm automation
            </Link>
          </Button>
        )}
        {hasRecoverable && (
          <Button asChild size="sm" variant="outline" data-testid="ops-recover">
            <Link to={withSearch("/admin/communication-hub/go-live/advanced")}>
              <RefreshCcw className="h-4 w-4 mr-1" />Recover execution
            </Link>
          </Button>
        )}
        {showConfirmInbox && (
          <Button asChild size="sm" variant="outline" data-testid="ops-confirm-inbox">
            <Link to={withSearch("/admin/communication-hub/go-live/advanced")}>
              <Inbox className="h-4 w-4 mr-1" />Confirm inbox receipt
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function RevalidationSummaryCard({
  summary, source, onRetry, to,
}: {
  summary: RevalidationSummary;
  source: SourceState;
  onRetry: () => void;
  to: string;
}) {
  return (
    <Card data-testid="ops-revalidation-summary">
      <CardHeader><CardTitle className="text-sm">Revalidation summary</CardTitle></CardHeader>
      <CardContent className="text-sm space-y-1.5">
        {source === "loading" && <div className="text-muted-foreground">Loading revalidation cycles…</div>}
        {source === "error" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Failed to load revalidation cycles
              <Badge variant="outline" className="font-mono text-[10px]">REVALIDATION_LOAD_FAILED</Badge>
            </div>
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RefreshCcw className="h-3.5 w-3.5 mr-1" />Retry
            </Button>
          </div>
        )}
        {source === "success" && !summary.cycle && (
          <>
            <Row label="Cycle" value={<span data-testid="ops-reval-cycle">No active cycle</span>} />
            <Row label="Next action" value={summary.nextActionLabel} />
            <Row label="Provider touched" value="No" />
          </>
        )}
        {source === "success" && summary.cycle && (
          <>
            <Row label="Cycle" value={
              <span data-testid="ops-reval-cycle" className="font-mono text-xs">
                {summary.cycle.id.slice(0, 8)}…
              </span>
            } />
            <Row label="Status" value={<Badge variant="outline">{summary.cycle.status}</Badge>} />
            <Row label="Needs reassessment" value={summary.needsReassessment ? "Yes" : "No"} />
            <Row label="Required level" value={summary.cycle.required_validation_level ?? "—"} />
            <Row label="Required stages" value={
              summary.cycle.required_stages?.length
                ? summary.cycle.required_stages.join(", ")
                : "—"
            } />
            <Row label="Provider touched" value={summary.providerTouched ? "Yes" : "No"} />
            <Row label="Inbox status" value={summary.cycle.inbox_confirmation_status ?? "—"} />
            <Row label="Next action" value={<span data-testid="ops-reval-next-action">{summary.nextActionLabel}</span>} />
          </>
        )}
        <Button asChild size="sm" variant="outline" className="mt-2">
          <Link to={to}>Open Revalidation <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
        </Button>
      </CardContent>
    </Card>
  );
}
