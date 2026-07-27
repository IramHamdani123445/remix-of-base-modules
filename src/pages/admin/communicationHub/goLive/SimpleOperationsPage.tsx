/**
 * CH-SIMPLE-P4 — Simplified Operations page.
 *
 * The default Operations view is intentionally sparse. It renders only:
 *   A. Shared event selector (workspace context)
 *   B. Current state summary (mode / automation / event status / baseline)
 *   C. Readiness summary (READY / BLOCKED / ACTION REQUIRED / PROCESSING)
 *      with a blocker count and a link to Readiness
 *   D. Exactly one primary "Next Action"
 *   E. Compact lifecycle stepper (completed collapsed, current expanded)
 *   F. Safety strip (Emergency Stop, Disarm, Recover, Confirm inbox)
 *   G. Revalidation summary card with a link to Revalidation
 *
 * Everything else — RuntimeContractCard, DiagnosticBundlePanel, full readiness
 * tables, ControlledRevalidationPanel, LegacyBaselineAttestationPanel, raw
 * fingerprints, execution/message/trace IDs, full evidence grids — is
 * intentionally NOT rendered here. Those live in Readiness / Revalidation /
 * Audit. A link to the full nine-stage advanced page remains for operators
 * who need it.
 */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import CommunicationHubWorkspaceShell, {
  CommunicationHubSectionCard,
} from "../components/CommunicationHubWorkspaceShell";
import { CommunicationHubGoLiveTabs } from "../components/CommunicationHubGoLiveTabs";
import ModuleEventSelectors from "./ModuleEventSelectors";
import { useCommunicationHubWorkspace } from "./WorkspaceContext";
import { useRuntimeContract } from "@/platform/communication-hub/RuntimeContractContext";
import { getEventGoLiveStatus } from "@/platform/communication-hub/eventGoLiveStatusService";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Circle, ChevronDown, ChevronRight, Info, ShieldAlert, ArrowRight, RefreshCcw, Inbox, Zap, ZapOff } from "lucide-react";
import { useState } from "react";

type ReadinessBadge = "READY" | "BLOCKED" | "ACTION_REQUIRED" | "PROCESSING";

function readinessColor(state: ReadinessBadge) {
  switch (state) {
    case "READY": return "border-emerald-300 bg-emerald-50 text-emerald-800";
    case "BLOCKED": return "border-red-300 bg-red-50 text-red-800";
    case "ACTION_REQUIRED": return "border-amber-300 bg-amber-50 text-amber-900";
    case "PROCESSING": return "border-sky-300 bg-sky-50 text-sky-800";
  }
}

interface DerivedReadiness {
  state: ReadinessBadge;
  blockerCount: number;
  explanation: string;
}

interface NextAction {
  code: string;
  label: string;
  href?: string;
}

type StageState = "completed" | "current" | "future";

interface StageDescriptor {
  code: string;
  label: string;
  state: StageState;
  detail?: string;
}

export default function SimpleOperationsPage() {
  const { moduleCode, eventCode, channel, hasSelection, setSelection } = useCommunicationHubWorkspace();
  const { report, loading: contractLoading, error: contractError } = useRuntimeContract();

  const { data: goLive, isLoading: goLiveLoading, isError: goLiveError } = useQuery({
    queryKey: ["comm-hub-simple-ops-status", moduleCode, eventCode, channel],
    queryFn: () => getEventGoLiveStatus({ moduleCode, eventCode, channel }),
    enabled: hasSelection,
    staleTime: 15_000,
  });

  const readiness = deriveReadiness({ contractLoading, contractError, report, goLiveLoading, goLive });
  const nextAction = deriveNextAction(goLive);
  const stages = deriveStages(goLive);

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
          onSelect={(r) => setSelection({ moduleCode: r.moduleCode, eventCode: r.eventCode, channel: r.channel })}
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
          <CurrentStateCard goLive={goLive} loading={goLiveLoading} error={goLiveError} />
          <ReadinessSummaryCard readiness={readiness} />
        </div>
      )}

      {hasSelection && (
        <NextActionCard action={nextAction} />
      )}

      {hasSelection && (
        <CompactLifecycleStepper stages={stages} />
      )}

      {hasSelection && (
        <SafetyStripCard goLive={goLive} />
      )}

      {hasSelection && (
        <RevalidationSummaryCard goLive={goLive} />
      )}

      <div className="text-xs text-muted-foreground">
        Need the full nine-stage journey?{" "}
        <Link to="/admin/communication-hub/go-live/advanced" className="underline">
          Open the advanced Go-Live view
        </Link>
        .
      </div>
    </CommunicationHubWorkspaceShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Derivations                                                                 */
/* -------------------------------------------------------------------------- */

function deriveReadiness(input: {
  contractLoading: boolean;
  contractError: string | null;
  report: ReturnType<typeof useRuntimeContract>["report"];
  goLiveLoading: boolean;
  goLive: any;
}): DerivedReadiness {
  const { contractLoading, contractError, report, goLiveLoading, goLive } = input;
  if (contractLoading || goLiveLoading) {
    return { state: "PROCESSING", blockerCount: 0, explanation: "Loading current readiness…" };
  }
  if (contractError) {
    return { state: "BLOCKED", blockerCount: 1, explanation: "Runtime contract audit failed. Open Readiness to view the error." };
  }
  const failing = report?.checks.filter((c) => c.status !== "PASS") ?? [];
  if (failing.length > 0) {
    return {
      state: "BLOCKED",
      blockerCount: failing.length,
      explanation: `${failing.length} readiness requirement${failing.length === 1 ? "" : "s"} need attention before any provider-contacting action can be enabled.`,
    };
  }
  const s6Blockers: any[] = goLive?.stage6?.stage6_manual_production_blockers ?? [];
  if (s6Blockers.length > 0) {
    return {
      state: "ACTION_REQUIRED",
      blockerCount: s6Blockers.length,
      explanation: "Manual Production is not yet eligible for this event. Complete Stage 6 in the advanced view or open Readiness for details.",
    };
  }
  const s8Blockers: any[] = goLive?.stage8?.automated_blockers ?? [];
  if (s8Blockers.length > 0) {
    return {
      state: "ACTION_REQUIRED",
      blockerCount: s8Blockers.length,
      explanation: "Automated Production readiness has remaining items. Open Readiness to review each check.",
    };
  }
  return { state: "READY", blockerCount: 0, explanation: "All server-side readiness checks pass for this event." };
}

function deriveNextAction(goLive: any): NextAction | null {
  if (!goLive) return null;
  const s6 = goLive.stage6 ?? {};
  const s7 = goLive.stage7 ?? {};
  const s8 = goLive.stage8 ?? {};
  if (!s6.one_real_email_certification_id) {
    return { code: "SEND_ONE_REAL_EMAIL", label: "Send one real email", href: "/admin/communication-hub/go-live/advanced" };
  }
  if (s6.reconciliation_required) {
    return { code: "RECOVER_EXECUTION", label: "Recover existing execution", href: "/admin/communication-hub/go-live/advanced" };
  }
  if (s6.manual_verification_status && s6.manual_verification_status !== "VERIFIED") {
    return { code: "CONFIRM_INBOX", label: "Confirm inbox receipt", href: "/admin/communication-hub/go-live/advanced" };
  }
  if (!s7.manual_event_certification_id) {
    return { code: "ACTIVATE_MANUAL_PRODUCTION", label: "Activate Manual Production", href: "/admin/communication-hub/go-live/advanced" };
  }
  if (s7.latest_manual_observation_status && s7.latest_manual_observation_status !== "VERIFIED") {
    return { code: "RUN_MP_OBSERVATION", label: "Run Manual Production observation", href: "/admin/communication-hub/go-live/advanced" };
  }
  if (!s8.automated_eligible) {
    return { code: "PREPARE_AUTOMATED_PRODUCTION", label: "Prepare Automated Production", href: "/admin/communication-hub/go-live/advanced" };
  }
  return { code: "MONITOR", label: "Monitor automated production", href: "/admin/communication-hub/go-live/advanced" };
}

function deriveStages(goLive: any): StageDescriptor[] {
  const s6 = goLive?.stage6 ?? {};
  const s7 = goLive?.stage7 ?? {};
  const s8 = goLive?.stage8 ?? {};
  const s6Done = !!s6.one_real_email_certification_id && s6.manual_verification_status === "VERIFIED";
  const s7Done = !!s7.manual_event_certification_id;
  const s8Done = !!s8.automated_eligible;

  const list: StageDescriptor[] = [
    { code: "SETUP", label: "Preview & Dry Run", state: "completed", detail: "Approved before certification" },
    { code: "ONE_REAL_EMAIL", label: "Send One Real Email", state: s6Done ? "completed" : "current", detail: s6.one_real_email_certification_status ?? undefined },
    { code: "MANUAL_PRODUCTION", label: "Manual Production", state: s7Done ? "completed" : s6Done ? "current" : "future", detail: s7.manual_event_status ?? undefined },
    { code: "AUTOMATED_PRODUCTION", label: "Automated Production", state: s8Done ? "completed" : s7Done ? "current" : "future", detail: s8.automation_event_certification_status ?? undefined },
  ];
  // Ensure exactly one "current" (the first non-completed).
  let currentAssigned = false;
  for (const s of list) {
    if (s.state === "current") {
      if (currentAssigned) s.state = "future";
      currentAssigned = true;
    }
  }
  return list;
}

/* -------------------------------------------------------------------------- */
/* Cards                                                                       */
/* -------------------------------------------------------------------------- */

function CurrentStateCard({ goLive, loading, error }: { goLive: any; loading: boolean; error: boolean }) {
  return (
    <Card data-testid="ops-current-state-card">
      <CardHeader><CardTitle className="text-sm">Current state</CardTitle></CardHeader>
      <CardContent className="text-sm space-y-1.5">
        {loading && <div className="text-muted-foreground">Loading…</div>}
        {error && <div className="text-destructive">Could not load event status.</div>}
        {!loading && !error && goLive && (
          <>
            <Row label="Mode" value={goLive.platform?.current_operating_mode ?? "—"} />
            <Row label="Automation state" value={goLive.platform?.automation_state ?? "—"} />
            <Row label="Event status" value={goLive.stage7?.manual_event_status ?? goLive.stage6?.one_real_email_certification_status ?? "PENDING"} />
            <Row label="Production baseline" value={goLive.stage6?.one_real_email_certification_id ? "Established" : "Not established"} />
            <Row label="Last delivery" value={goLive.stage7?.latest_manual_observation_status ?? goLive.stage6?.one_real_email_certification_status ?? "—"} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function ReadinessSummaryCard({ readiness }: { readiness: DerivedReadiness }) {
  return (
    <Card data-testid="ops-readiness-summary-card">
      <CardHeader><CardTitle className="text-sm">Readiness</CardTitle></CardHeader>
      <CardContent className="text-sm space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={readinessColor(readiness.state)}>{readiness.state.replace("_", " ")}</Badge>
          <span className="text-xs text-muted-foreground">{readiness.blockerCount} blocker{readiness.blockerCount === 1 ? "" : "s"}</span>
        </div>
        <p className="text-muted-foreground">{readiness.explanation}</p>
        <Button asChild size="sm" variant="outline">
          <Link to="/admin/communication-hub/readiness">
            Open Readiness <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function NextActionCard({ action }: { action: NextAction | null }) {
  return (
    <Card data-testid="ops-next-action-card">
      <CardHeader><CardTitle className="text-sm">Next action</CardTitle></CardHeader>
      <CardContent className="text-sm space-y-2">
        {!action && <div className="text-muted-foreground">No action derivable yet.</div>}
        {action && (
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium" data-testid="ops-next-action-label">{action.label}</div>
              <div className="text-xs text-muted-foreground">Server-authoritative. Performed in the advanced Go-Live view.</div>
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

function CompactLifecycleStepper({ stages }: { stages: StageDescriptor[] }) {
  return (
    <Card data-testid="ops-lifecycle-stepper">
      <CardHeader><CardTitle className="text-sm">Lifecycle</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {stages.map((s) => (
          <StageRow key={s.code} stage={s} />
        ))}
      </CardContent>
    </Card>
  );
}

function StageRow({ stage }: { stage: StageDescriptor }) {
  const [open, setOpen] = useState(stage.state === "current");
  const expanded = stage.state === "current" || open;
  const Icon = stage.state === "completed" ? CheckCircle2 : stage.state === "current" ? ChevronDown : Circle;
  return (
    <div
      className="rounded border p-2"
      data-testid={`ops-lifecycle-stage-${stage.code}`}
      data-state={stage.state}
      data-expanded={expanded ? "true" : "false"}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left text-sm"
      >
        <Icon className={"h-4 w-4 " + (stage.state === "completed" ? "text-emerald-600" : stage.state === "current" ? "text-primary" : "text-muted-foreground")} />
        <span className="font-medium">{stage.label}</span>
        <Badge variant="outline" className="ml-auto text-[10px]">{stage.state}</Badge>
      </button>
      {expanded && stage.detail && (
        <div className="mt-1 pl-6 text-xs text-muted-foreground">{stage.detail}</div>
      )}
    </div>
  );
}

function SafetyStripCard({ goLive }: { goLive: any }) {
  const showConfirmInbox = !!goLive?.stage6?.one_real_email_certification_id && goLive?.stage6?.manual_verification_status !== "VERIFIED";
  return (
    <Card data-testid="ops-safety-strip">
      <CardHeader><CardTitle className="text-sm">Safety controls</CardTitle></CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="destructive" data-testid="ops-emergency-stop">
          <Link to="/admin/communication-hub/safety"><ShieldAlert className="h-4 w-4 mr-1" />Emergency Stop</Link>
        </Button>
        <Button asChild size="sm" variant="outline" data-testid="ops-disarm">
          <Link to="/admin/communication-hub/safety"><ZapOff className="h-4 w-4 mr-1" />Disarm automation</Link>
        </Button>
        <Button asChild size="sm" variant="outline" data-testid="ops-recover">
          <Link to="/admin/communication-hub/go-live/advanced"><RefreshCcw className="h-4 w-4 mr-1" />Recover execution</Link>
        </Button>
        {showConfirmInbox && (
          <Button asChild size="sm" variant="outline" data-testid="ops-confirm-inbox">
            <Link to="/admin/communication-hub/go-live/advanced"><Inbox className="h-4 w-4 mr-1" />Confirm inbox receipt</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function RevalidationSummaryCard({ goLive }: { goLive: any }) {
  const baseline = !!goLive?.stage6?.one_real_email_certification_id;
  return (
    <Card data-testid="ops-revalidation-summary">
      <CardHeader><CardTitle className="text-sm">Revalidation summary</CardTitle></CardHeader>
      <CardContent className="text-sm space-y-1.5">
        <Row label="Cycle status" value={baseline ? "No active cycle" : "Baseline required first"} />
        <Row label="Required level" value="—" />
        <Row label="Next action" value={baseline ? "Assess when needed" : "Complete Stage 6 first"} />
        <Row label="Provider touched" value="No" />
        <Row label="Inbox status" value="—" />
        <Button asChild size="sm" variant="outline" className="mt-2">
          <Link to="/admin/communication-hub/revalidation">
            Open Revalidation <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
