import React from "react";
import {
  BnModuleRouteGate,
  type BnModuleAccessContext,
} from "@/components/bn/access/BnModuleRouteGate";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingUp } from "lucide-react";
import { BnUpratingPolicyWorkspace } from "@/components/bn/uprating/BnUpratingPolicyWorkspace";
import { BnUpratingRunWorkspace } from "@/components/bn/uprating/BnUpratingRunWorkspace";
import { BnUpratingApprovalQueue } from "@/components/bn/uprating/BnUpratingApprovalQueue";
import { BnUpratingExecutionQueue } from "@/components/bn/uprating/BnUpratingExecutionQueue";
import { BnUpratingOperationalQueue } from "@/components/bn/uprating/BnUpratingOperationalQueue";

export default function BnUpratingPage() {
  const [tab, setTab] = React.useState("policies");
  const [deepLinkRunId, setDeepLinkRunId] = React.useState<string | null>(null);
  const [deepLinkSection, setDeepLinkSection] = React.useState<string | null>(null);

  const openRun = (runId: string, section: string) => {
    setDeepLinkRunId(runId);
    setDeepLinkSection(section);
    setTab("runs");
  };

  return (
    <BnModuleRouteGate moduleCode="bn_uprating" requiredAction="view">
      {(ctx: BnModuleAccessContext) => (
        <div className="p-6 space-y-6">
          <div className="flex items-center gap-3">
            <TrendingUp className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold">Uprating</h1>
            {ctx.rolloutState !== "public" && (
              <Badge variant="secondary">Internal pilot</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Maintain the governed uprating policy catalogue, prepare uprating runs — population
            snapshots, exception resolution and deterministic simulation — execute approved runs in
            controlled batches, then complete the consequences: payment-schedule rebuilds, claimant
            notices through the Communication Hub, reconciliation and, on the failure path,
            controlled compensating rollback.
          </p>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex-wrap">
              <TabsTrigger value="policies">Policy catalogue</TabsTrigger>
              <TabsTrigger value="runs">Runs &amp; simulation</TabsTrigger>
              <TabsTrigger value="approvals">Approvals &amp; scheduling</TabsTrigger>
              <TabsTrigger value="execution">Execution queue</TabsTrigger>
              <TabsTrigger value="operations">Post-execution queue</TabsTrigger>
            </TabsList>
            <TabsContent value="policies" className="pt-4">
              <BnUpratingPolicyWorkspace ctx={ctx} />
            </TabsContent>
            <TabsContent value="runs" className="pt-4">
              <BnUpratingRunWorkspace
                ctx={ctx}
                initialRunId={deepLinkRunId}
                initialTab={deepLinkSection}
              />
            </TabsContent>
            <TabsContent value="approvals" className="pt-4">
              <BnUpratingApprovalQueue />
            </TabsContent>
            <TabsContent value="execution" className="pt-4">
              <BnUpratingExecutionQueue
                onOpenRun={(runId) => openRun(runId, "execution")}
              />
            </TabsContent>
            <TabsContent value="operations" className="pt-4">
              <BnUpratingOperationalQueue onOpenRun={openRun} />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </BnModuleRouteGate>
  );
}
