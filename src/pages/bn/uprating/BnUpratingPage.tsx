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
 *   /bn/uprating/operations          execution and post-execution queues
 *   /bn/uprating/runs/:runId?section=…   run workspace (five phases)
 */
import React from "react";
import { Navigate, Outlet, Route, Routes, useNavigate, useParams } from "react-router-dom";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BnModuleSectionNav, useBnWorkspaceSection } from "@/components/bn/ux";

export const UPRATING_MODULE_BASE = "/bn/uprating";

export function upratingRunPath(runId: string, section?: string | null): string {
  const query = section ? `?section=${encodeURIComponent(section)}` : "";
  return `${UPRATING_MODULE_BASE}/runs/${runId}${query}`;
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
    <div className="flex items-center gap-3">
      <TrendingUp className="h-6 w-6 text-primary" />
      <h1 className="text-2xl font-semibold">Uprating</h1>
      {ctx.rolloutState !== "public" && <Badge variant="secondary">Internal pilot</Badge>}
    </div>
    <p className="text-sm text-muted-foreground max-w-3xl">
      Maintain the governed uprating policy catalogue, prepare uprating runs — population
      snapshots, exception resolution and deterministic simulation — execute approved runs in
      controlled batches, then complete the consequences: payment-schedule rebuilds, claimant
      notices through the Communication Hub, reconciliation and, on the failure path,
      controlled compensating rollback. Execution applies exactly what was approved;
      no amount is recalculated at execution time.
    </p>

    <BnModuleSectionNav
      ariaLabel="Uprating destinations"
      items={[
        { to: UPRATING_MODULE_BASE, label: "Overview", end: true },
        { to: `${UPRATING_MODULE_BASE}/policies`, label: "Policy catalogue" },
        { to: `${UPRATING_MODULE_BASE}/runs`, label: "Runs & simulation" },
        { to: `${UPRATING_MODULE_BASE}/approvals`, label: "Approvals & scheduling" },
        { to: `${UPRATING_MODULE_BASE}/operations`, label: "Operational queues" },
      ]}
    />


    <Outlet />
  </div>
);

/** Execution and post-execution work is one destination, not two tabs. */
const UpratingOperationsRoute: React.FC = () => {
  const openRun = useOpenRun();
  const [stage, setStage] = useBnWorkspaceSection("execution", "stage");

  return (
    <Tabs value={stage} onValueChange={(next) => setStage(next, { replace: true })}>
      <TabsList>
        <TabsTrigger value="execution">Execution queue</TabsTrigger>
        <TabsTrigger value="operations">Post-execution queue</TabsTrigger>
      </TabsList>
      <TabsContent value="execution" className="pt-4">
        <BnUpratingExecutionQueue onOpenRun={(runId) => openRun(runId, "execution")} />
      </TabsContent>
      <TabsContent value="operations" className="pt-4">
        <BnUpratingOperationalQueue onOpenRun={(runId, section) => openRun(runId, section)} />
      </TabsContent>
    </Tabs>
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
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const [section, setSection] = useBnWorkspaceSection("population");

  if (!runId) return <Navigate to={`${UPRATING_MODULE_BASE}/runs`} replace />;

  return (
    <div className="p-6">
      <BnUpratingRunWorkspace
        ctx={ctx}
        initialRunId={runId}
        initialTab={section}
        onSectionChange={(next) => setSection(next, { replace: true })}
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

          <Route element={<UpratingModuleShell ctx={ctx} />}>
            <Route index element={<BnUpratingOverview />} />
            <Route path="policies" element={<BnUpratingPolicyWorkspace ctx={ctx} />} />

            <Route path="runs" element={<UpratingRunsRoute ctx={ctx} />} />
            <Route path="approvals" element={<BnUpratingApprovalQueue />} />
            <Route path="operations" element={<UpratingOperationsRoute />} />
            <Route path="*" element={<Navigate to={UPRATING_MODULE_BASE} replace />} />
          </Route>
        </Routes>
      )}
    </BnModuleRouteGate>
  );
}
