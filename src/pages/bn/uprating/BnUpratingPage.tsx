/**
 * BN Uprating & Indexation — module experience.
 *
 * Operational UX pattern:
 *   MODULE → FIND WORK → OPEN RECORD → UNDERSTAND STAGE → NEXT ACTION
 *
 * Navigation is URL driven and every run has a stable address:
 *   /bn/uprating                     overview and outstanding work
 *   /bn/uprating/policies            policy catalogue
 *   /bn/uprating/runs                runs and simulation
 *   /bn/uprating/approvals           approvals and scheduling
 *   /bn/uprating/execution           execution queue
 *   /bn/uprating/post-execution      post-execution queue
 *   /bn/uprating/runs/:runId/:section    run workflow screen
 */
import React from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  BnModuleRouteGate,
  type BnModuleAccessContext,
} from "@/components/bn/access/BnModuleRouteGate";
import { Badge } from "@/components/ui/badge";
import { TrendingUp } from "lucide-react";
import { BnUpratingPolicyWorkspace } from "@/components/bn/uprating/BnUpratingPolicyWorkspace";
import { BnUpratingRunWorkspace } from "@/components/bn/uprating/BnUpratingRunWorkspace";
import { BnUpratingApprovalQueue } from "@/components/bn/uprating/BnUpratingApprovalQueue";
import { BnUpratingExecutionQueue } from "@/components/bn/uprating/BnUpratingExecutionQueue";
import { BnUpratingOperationalQueue } from "@/components/bn/uprating/BnUpratingOperationalQueue";
import { BnUpratingOverview } from "@/components/bn/uprating/BnUpratingOverview";
import { BnModuleBreadcrumbs } from "@/components/bn/ux";

export const UPRATING_MODULE_BASE = "/bn/uprating";

export const UPRATING_DEFAULT_SECTION = "population";

export function upratingRunPath(runId: string, section?: string | null): string {
  const step = section && section.trim() ? section.trim() : UPRATING_DEFAULT_SECTION;
  return `${UPRATING_MODULE_BASE}/runs/${runId}/${encodeURIComponent(step)}`;
}

/** Screen-level "where am I", replacing the module-local tab bar. */
const UPRATING_SCREEN_LABELS: Record<string, string> = {
  "": "Overview",
  policies: "Policy catalogue",
  runs: "Runs & simulation",
  approvals: "Approvals & scheduling",
  execution: "Execution queue",
  "post-execution": "Post-execution queue",
};

const UpratingBreadcrumbs: React.FC = () => {
  const { pathname } = useLocation();
  const tail = pathname.replace(UPRATING_MODULE_BASE, "").replace(/^\/+|\/+$/g, "").split("/")[0] ?? "";
  return (
    <BnModuleBreadcrumbs
      items={[
        { label: "Benefit Management" },
        { label: "Uprating & Indexation", to: UPRATING_MODULE_BASE },
        { label: UPRATING_SCREEN_LABELS[tail] ?? "Overview" },
      ]}
    />
  );
}

function useOpenRun() {
  const navigate = useNavigate();
  return React.useCallback(
    (runId: string, section?: string | null) => navigate(upratingRunPath(runId, section)),
    [navigate],
  );
}

const UpratingModuleShell: React.FC<{ ctx: BnModuleAccessContext }> = ({ ctx }) => (
  <div className="p-6 space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <TrendingUp className="mt-1 h-6 w-6 text-primary" aria-hidden="true" />
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Uprating &amp; Indexation</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Prepare, approve, execute and reconcile governed uprating runs that apply
            approved benefit increases to live awards.
          </p>
          {ctx.rolloutState !== "public" && (
            <div className="pt-1">
              <Badge variant="secondary">Internal pilot</Badge>
            </div>
          )}
        </div>
      </div>
    </header>

    <details className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
      <summary className="cursor-pointer font-medium text-foreground">
        How an uprating run works
      </summary>
      <p className="max-w-3xl pt-2">
        Maintain the governed uprating policy catalogue, prepare runs — population
        snapshots, exception resolution and deterministic simulation — execute approved
        runs in controlled batches, then complete the consequences: payment-schedule
        rebuilds, claimant notices through the Communication Hub, reconciliation and, on
        the failure path, controlled compensating rollback. Execution applies exactly what
        was approved; no amount is recalculated at execution time.
      </p>
    </details>

    {/* Module navigation lives in the left sidebar. */}
    <UpratingBreadcrumbs />

    <Outlet />
  </div>
);

/** Execution and post-execution work are two separate management screens. */
const UpratingExecutionRoute: React.FC = () => {
  const openRun = useOpenRun();
  return <BnUpratingExecutionQueue onOpenRun={(runId) => openRun(runId, "execution")} />;
};

const UpratingPostExecutionRoute: React.FC = () => {
  const openRun = useOpenRun();
  return <BnUpratingOperationalQueue onOpenRun={(runId, section) => openRun(runId, section)} />;
};

/** Back-compatibility for the retired combined `operations` destination. */
const UpratingOperationsRedirect: React.FC = () => {
  const { search } = useLocation();
  const stage = new URLSearchParams(search).get("stage");
  return (
    <Navigate
      to={`${UPRATING_MODULE_BASE}/${stage === "operations" ? "post-execution" : "execution"}`}
      replace
    />
  );
};


const UpratingRunsRoute: React.FC<{ ctx: BnModuleAccessContext }> = ({ ctx }) => {
  const navigate = useNavigate();
  return (
    <BnUpratingRunWorkspace
      ctx={ctx}
      initialRunId={null}
      onSelectRun={(runId) => runId && navigate(upratingRunPath(runId))}
    />
  );
};

const UpratingRunRecordRoute: React.FC<{ ctx: BnModuleAccessContext }> = ({ ctx }) => {
  const { runId, section } = useParams<{ runId: string; section?: string }>();
  const navigate = useNavigate();

  if (!runId) return <Navigate to={`${UPRATING_MODULE_BASE}/runs`} replace />;
  if (!section) {
    return <Navigate to={upratingRunPath(runId, UPRATING_DEFAULT_SECTION)} replace />;
  }

  return (
    <div className="space-y-4 p-6">
      <BnModuleBreadcrumbs
        items={[
          { label: "Benefit Management" },
          { label: "Uprating & Indexation", to: UPRATING_MODULE_BASE },
          { label: "Runs & simulation", to: `${UPRATING_MODULE_BASE}/runs` },
          { label: section.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) },
        ]}
      />
      <BnUpratingRunWorkspace
        ctx={ctx}
        initialRunId={runId}
        initialTab={section}
        sectionHref={(next) => upratingRunPath(runId, next)}
        onSectionChange={(next) => navigate(upratingRunPath(runId, next))}
        onSelectRun={(next) =>
          navigate(next ? upratingRunPath(next) : `${UPRATING_MODULE_BASE}/runs`)
        }
      />
    </div>
  );
};

export default function BnUpratingPage() {
  return (
    <BnModuleRouteGate moduleCode="bn_uprating" requiredAction="view">
      {(ctx: BnModuleAccessContext) => (
        <Routes>
          <Route path="runs/:runId" element={<UpratingRunRecordRoute ctx={ctx} />} />
          <Route path="runs/:runId/:section" element={<UpratingRunRecordRoute ctx={ctx} />} />

          <Route element={<UpratingModuleShell ctx={ctx} />}>
            <Route index element={<BnUpratingOverview />} />
            <Route path="policies" element={<BnUpratingPolicyWorkspace ctx={ctx} />} />

            <Route path="runs" element={<UpratingRunsRoute ctx={ctx} />} />
            <Route path="approvals" element={<BnUpratingApprovalQueue />} />
            <Route path="execution" element={<UpratingExecutionRoute />} />
            <Route path="post-execution" element={<UpratingPostExecutionRoute />} />
            <Route path="operations" element={<UpratingOperationsRedirect />} />
            <Route path="*" element={<Navigate to={UPRATING_MODULE_BASE} replace />} />
          </Route>
        </Routes>
      )}
    </BnModuleRouteGate>
  );
}
