/**
 * A4.1.2C — Simplified Operations page.
 *
 * Server-authoritative. The Operations page derives every stage state, next
 * action, safety flag and revalidation summary from a single read-only RPC:
 *
 *   getOperationsSummary  →  public.get_comm_hub_operations_summary
 *
 * It does NOT independently combine getEventGoLiveStatus + listRevalidationCycles
 * + local stage inference. Runtime-contract status is kept as ancillary
 * context (loaded once by the workspace-level provider) and is not used to
 * override server-derived readiness.
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
  getOperationsSummary,
  type OperationsSummary,
} from "@/platform/communication-hub/operationsSummaryService";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CheckCircle2, Circle, ChevronDown, Info, ShieldAlert, ArrowRight,
  RefreshCcw, Inbox, ZapOff, AlertTriangle,
} from "lucide-react";
import { useState } from "react";

/* ---------- Canonical stage labels --------------------------------------- */

const CANONICAL_STAGES: Array<{ code: string; label: string; hrefBase?: string }> = [
  { code: "READINESS",              label: "Readiness",              hrefBase: "/admin/communication-hub/readiness" },
  { code: "PREVIEW_APPROVAL",       label: "Preview Approval",       hrefBase: "/admin/communication-hub/go-live/advanced" },
  { code: "DRY_RUN",                label: "Dry Run",                hrefBase: "/admin/communication-hub/go-live/advanced" },
  { code: "CONTROLLED_STUB",        label: "Controlled Stub",        hrefBase: "/admin/communication-hub/go-live/advanced" },
  { code: "ONE_REAL_EMAIL",         label: "One Real Email",         hrefBase: "/admin/communication-hub/go-live/advanced" },
  { code: "MANUAL_PRODUCTION",      label: "Manual Production",      hrefBase: "/admin/communication-hub/go-live/advanced" },
  { code: "CONTROLLED_REVALIDATION",label: "Controlled Revalidation",hrefBase: "/admin/communication-hub/revalidation" },
  { code: "AUTOMATED_PRODUCTION",   label: "Automated Production",   hrefBase: "/admin/communication-hub/go-live/advanced" },
];

type StageDisplayState = "COMPLETED" | "CURRENT" | "BLOCKED" | "ACTION_REQUIRED" | "FUTURE" | "UNAVAILABLE";

function normaliseStageStatus(raw: string | undefined): StageDisplayState {
  if (!raw) return "UNAVAILABLE";
  const s = raw.toUpperCase();
  if (s === "COMPLETED" || s === "COMPLETE" || s === "CERTIFIED" || s === "PASS") return "COMPLETED";
  if (s === "CURRENT" || s === "IN_PROGRESS" || s === "ACTIVE") return "CURRENT";
  if (s === "BLOCKED" || s === "FAIL" || s === "FAILED") return "BLOCKED";
  if (s === "ACTION_REQUIRED" || s === "NEEDS_ACTION" || s === "PENDING") return "ACTION_REQUIRED";
  if (s === "FUTURE" || s === "NOT_STARTED") return "FUTURE";
  if (s === "UNAVAILABLE" || s === "UNKNOWN" || s === "MISSING") return "UNAVAILABLE";
  return "UNAVAILABLE";
}

function stageColor(state: StageDisplayState) {
  switch (state) {
    case "COMPLETED": return "text-emerald-700 bg-emerald-50 border-emerald-200";
    case "CURRENT":   return "text-primary bg-primary/5 border-primary/30";
    case "BLOCKED":   return "text-red-700 bg-red-50 border-red-200";
    case "ACTION_REQUIRED": return "text-amber-900 bg-amber-50 border-amber-200";
    case "FUTURE":    return "text-muted-foreground bg-muted/30 border-muted";
    case "UNAVAILABLE": return "text-slate-700 bg-slate-50 border-slate-200";
  }
}

/* ---------- Page ---------------------------------------------------------- */

export default function SimpleOperationsPage() {
  const { moduleCode, eventCode, channel, hasSelection, setSelection } =
    useCommunicationHubWorkspace();
  const location = useLocation();
  const searchQS = location.search || "";
  const withSearch = (path: string) => (searchQS ? `${path}${searchQS}` : path);

  // Runtime-contract is ancillary context only. It is NOT used as an
  // authority to derive stage completion or next action — those come from
  // the server summary.
  const { error: contractError } = useRuntimeContract();

  const summaryQ = useQuery({
    queryKey: ["comm-hub-operations-summary", moduleCode, eventCode, channel],
    queryFn: () => getOperationsSummary({ moduleCode, eventCode, channel }),
    enabled: hasSelection,
    staleTime: 15_000,
    retry: 1,
  });

  const summary = summaryQ.data ?? null;
  const loading = summaryQ.isLoading;
  const error = summaryQ.isError;

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
            summary={summary}
            loading={loading}
            error={error}
            onRetry={() => summaryQ.refetch()}
          />
          <ReadinessSummaryCard
            summary={summary}
            loading={loading}
            error={error}
            contractError={contractError}
            to={withSearch("/admin/communication-hub/readiness")}
          />
        </div>
      )}

      {hasSelection && (
        <NextActionCard summary={summary} loading={loading} withSearch={withSearch} />
      )}

      {hasSelection && (
        <CanonicalJourneyCard
          summary={summary}
          loading={loading}
          error={error}
          onRetry={() => summaryQ.refetch()}
          withSearch={withSearch}
        />
      )}

      {hasSelection && (
        <SafetyStripCard summary={summary} withSearch={withSearch} />
      )}

      {hasSelection && (
        <RevalidationSummaryCard
          summary={summary}
          loading={loading}
          error={error}
          onRetry={() => summaryQ.refetch()}
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

/* ---------- Cards --------------------------------------------------------- */

function CurrentStateCard({
  summary, loading, error, onRetry,
}: {
  summary: OperationsSummary | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  return (
    <Card data-testid="ops-current-state-card">
      <CardHeader><CardTitle className="text-sm">Current state</CardTitle></CardHeader>
      <CardContent className="text-sm space-y-1.5">
        {loading && <div className="text-muted-foreground">Loading operations summary…</div>}
        {error && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Failed to load operations summary
              <Badge variant="outline" className="font-mono text-[10px]">SUMMARY_LOAD_FAILED</Badge>
            </div>
            <Button size="sm" variant="outline" onClick={onRetry} data-testid="ops-current-state-retry">
              <RefreshCcw className="h-3.5 w-3.5 mr-1" />Retry
            </Button>
          </div>
        )}
        {!loading && !error && summary && (
          <>
            <Row label="Operating mode" value={
              <span data-testid="ops-mode">{summary.platform.operating_mode}</span>
            } />
            <Row label="Automation state" value={
              <span data-testid="ops-automation">{summary.platform.automation_state}</span>
            } />
            <Row label="Event status" value={
              <span data-testid="ops-event-status">{summary.event.event_status ?? "not_certified"}</span>
            } />
            <Row label="Baseline" value={
              <span data-testid="ops-baseline" className="inline-flex items-center gap-2">
                <Badge variant="outline">{summary.baseline.status.replace(/_/g, " ")}</Badge>
                {summary.baseline.diagnosis_required && (
                  <span className="text-xs text-amber-700">diagnosis required</span>
                )}
                {summary.baseline.correction_required && (
                  <span className="text-xs text-destructive">correction required</span>
                )}
              </span>
            } />
            <Row label="Provider boundary" value={
              summary.platform.provider_boundary_approved ? "APPROVED" : "SEALED"
            } />
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

function ReadinessSummaryCard({
  summary, loading, error, contractError, to,
}: {
  summary: OperationsSummary | null;
  loading: boolean;
  error: boolean;
  contractError: string | null;
  to: string;
}) {
  const blockerCount = summary?.blockers?.length ?? 0;
  const warningCount = summary?.warnings?.length ?? 0;
  let badge: string;
  let colorClass: string;
  let explanation: string;
  if (loading) { badge = "PROCESSING"; colorClass = "border-sky-300 bg-sky-50 text-sky-800"; explanation = "Loading current readiness…"; }
  else if (error) { badge = "UNAVAILABLE"; colorClass = "border-slate-300 bg-slate-50 text-slate-700"; explanation = "Could not load operations summary."; }
  else if (blockerCount > 0) { badge = "BLOCKED"; colorClass = "border-red-300 bg-red-50 text-red-800"; explanation = `${blockerCount} blocker${blockerCount === 1 ? "" : "s"} reported by the server.`; }
  else if (warningCount > 0) { badge = "ACTION REQUIRED"; colorClass = "border-amber-300 bg-amber-50 text-amber-900"; explanation = `${warningCount} warning${warningCount === 1 ? "" : "s"}.`; }
  else { badge = "READY"; colorClass = "border-emerald-300 bg-emerald-50 text-emerald-800"; explanation = "All server-side readiness checks pass."; }

  return (
    <Card data-testid="ops-readiness-summary-card">
      <CardHeader><CardTitle className="text-sm">Readiness</CardTitle></CardHeader>
      <CardContent className="text-sm space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={colorClass}>{badge}</Badge>
          {contractError && (
            <Badge variant="outline" className="font-mono text-[10px]">RUNTIME_CONTRACT_ERROR</Badge>
          )}
          {blockerCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {blockerCount} blocker{blockerCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <p className="text-muted-foreground">{explanation}</p>
        <Button asChild size="sm" variant="outline">
          <Link to={to}>Open Readiness <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function NextActionCard({
  summary, loading, withSearch,
}: {
  summary: OperationsSummary | null;
  loading: boolean;
  withSearch: (p: string) => string;
}) {
  const nextAction = summary?.revalidation?.next_action ?? null;
  // Derive href from action code where applicable.
  const hrefForCode = (code?: string): string | undefined => {
    if (!code) return undefined;
    if (code.startsWith("REVALIDATION") || code.includes("PROMOTE") || code.includes("AUTHORISE") || code.includes("PREPARE") || code.includes("REASSESS") || code.includes("INBOX")) {
      return withSearch("/admin/communication-hub/revalidation");
    }
    return withSearch("/admin/communication-hub/go-live/advanced");
  };

  return (
    <Card data-testid="ops-next-action-card">
      <CardHeader><CardTitle className="text-sm">Next action</CardTitle></CardHeader>
      <CardContent className="text-sm space-y-2">
        {loading && <div className="text-muted-foreground">Loading…</div>}
        {!loading && !nextAction && (
          <div className="text-muted-foreground" data-testid="ops-next-action-none">
            No operator action required.
          </div>
        )}
        {nextAction && (
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium" data-testid="ops-next-action-label">{nextAction.label}</div>
              <div className="text-xs text-muted-foreground font-mono" data-testid="ops-next-action-reason">
                {nextAction.code}
              </div>
            </div>
            <Button asChild size="sm" data-testid="ops-next-action-btn">
              <Link to={hrefForCode(nextAction.code) ?? "#"}>Open <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CanonicalJourneyCard({
  summary, loading, error, onRetry, withSearch,
}: {
  summary: OperationsSummary | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  withSearch: (p: string) => string;
}) {
  const byCode = new Map<string, OperationsSummary["stages"][number]>();
  (summary?.stages ?? []).forEach((s) => byCode.set(s.code, s));
  const stagesForDisplay = CANONICAL_STAGES.map((c) => {
    const server = byCode.get(c.code);
    const state: StageDisplayState = loading
      ? "FUTURE"
      : error
        ? "UNAVAILABLE"
        : normaliseStageStatus(server?.status);
    return {
      code: c.code,
      label: c.label,
      href: c.hrefBase ? withSearch(c.hrefBase) : undefined,
      state,
      certificationId: server?.certification_id ?? null,
      completedAt: server?.completed_at ?? null,
      evidenceSource: server?.evidence_source ?? "server",
      blockerCodes: server?.blocker_codes ?? [],
    };
  });

  return (
    <Card data-testid="ops-lifecycle-stepper">
      <CardHeader>
        <CardTitle className="text-sm">Canonical Go-Live journey</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertTriangle className="h-4 w-4" />
            Journey unavailable — operations summary failed to load.
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RefreshCcw className="h-3.5 w-3.5 mr-1" />Retry
            </Button>
          </div>
        )}
        {stagesForDisplay.map((s) => (
          <StageRow key={s.code} stage={s} />
        ))}
      </CardContent>
    </Card>
  );
}

function StageRow({ stage }: {
  stage: {
    code: string; label: string; state: StageDisplayState;
    href?: string; certificationId?: string | null; completedAt?: string | null;
    blockerCodes?: string[];
  };
}) {
  const [open, setOpen] = useState(
    stage.state === "CURRENT" || stage.state === "ACTION_REQUIRED" || stage.state === "BLOCKED",
  );
  const Icon = stage.state === "COMPLETED" ? CheckCircle2
             : stage.state === "CURRENT" ? ChevronDown
             : stage.state === "BLOCKED" || stage.state === "ACTION_REQUIRED" ? AlertTriangle
             : Circle;
  return (
    <div
      className={`rounded border p-2 ${stageColor(stage.state)}`}
      data-testid={`ops-lifecycle-stage-${stage.code}`}
      data-state={stage.state.toLowerCase()}
      data-expanded={open ? "true" : "false"}
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
      {open && (
        <div className="mt-1 pl-6 text-xs space-y-1">
          {stage.completedAt && (
            <div className="text-muted-foreground">Completed {new Date(stage.completedAt).toLocaleString()}</div>
          )}
          {stage.blockerCodes && stage.blockerCodes.length > 0 && (
            <div className="text-destructive">
              Blockers: {stage.blockerCodes.slice(0, 3).join(", ")}
              {stage.blockerCodes.length > 3 && ` (+${stage.blockerCodes.length - 3})`}
            </div>
          )}
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
  summary, withSearch,
}: { summary: OperationsSummary | null; withSearch: (p: string) => string }) {
  const armed = summary?.platform.automation_state === "ARMED" ||
                summary?.platform.automation_state === "ARMING";
  const recovery = !!summary?.revalidation?.recovery_required;
  const inboxNeeded = !!summary?.revalidation?.inbox_confirmation_required;

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
        {recovery && (
          <Button asChild size="sm" variant="outline" data-testid="ops-recover">
            <Link to={withSearch("/admin/communication-hub/revalidation")}>
              <RefreshCcw className="h-4 w-4 mr-1" />Recover preparation
            </Link>
          </Button>
        )}
        {inboxNeeded && (
          <Button asChild size="sm" variant="outline" data-testid="ops-confirm-inbox">
            <Link to={withSearch("/admin/communication-hub/revalidation")}>
              <Inbox className="h-4 w-4 mr-1" />Confirm inbox receipt
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function RevalidationSummaryCard({
  summary, loading, error, onRetry, to,
}: {
  summary: OperationsSummary | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  to: string;
}) {
  const reval = summary?.revalidation;
  const cycle = reval?.active_cycle ?? null;
  const auth = reval?.usable_authorisation ?? null;
  const prep = reval?.active_preparation_execution ?? null;

  return (
    <Card data-testid="ops-revalidation-summary">
      <CardHeader><CardTitle className="text-sm">Revalidation summary</CardTitle></CardHeader>
      <CardContent className="text-sm space-y-1.5">
        {loading && <div className="text-muted-foreground">Loading revalidation summary…</div>}
        {error && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Failed to load revalidation summary
            </div>
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RefreshCcw className="h-3.5 w-3.5 mr-1" />Retry
            </Button>
          </div>
        )}
        {!loading && !error && !cycle && (
          <>
            <Row label="Cycle" value={<span data-testid="ops-reval-cycle">No active cycle</span>} />
            <Row label="Authorisation" value="—" />
            <Row label="Preparation" value="—" />
          </>
        )}
        {!loading && !error && cycle && (
          <>
            <Row label="Cycle" value={
              <span data-testid="ops-reval-cycle" className="font-mono text-xs">
                {cycle.id.slice(0, 8)}…
              </span>
            } />
            <Row label="Status" value={<Badge variant="outline">{cycle.status}</Badge>} />
            <Row label="Needs reassessment" value={cycle.needs_reassessment ? "Yes" : "No"} />
            <Row label="Authorisation" value={
              auth
                ? <span><Badge variant={auth.usable ? "default" : "destructive"}>{auth.status}</Badge>{!auth.usable && auth.unusable_reason ? <span className="ml-2 text-xs text-muted-foreground">({auth.unusable_reason})</span> : null}</span>
                : "None"
            } />
            <Row label="Preparation" value={
              prep
                ? <span><Badge variant={prep.classified_state === "READY_FOR_PROVIDER" ? "default" : "destructive"}>{prep.classified_state}</Badge><span className="ml-2 text-xs text-muted-foreground">v{prep.preparation_version}</span></span>
                : "None"
            } />
            <Row label="Provider touched" value={prep?.provider_call_attempted ? "Yes" : "No"} />
          </>
        )}
        <Button asChild size="sm" variant="outline" className="mt-2">
          <Link to={to} data-testid="ops-reval-open">Open Revalidation <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
        </Button>
      </CardContent>
    </Card>
  );
}
