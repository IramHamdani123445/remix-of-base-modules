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


export default function BnUpratingPage() {
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
            snapshots, exception resolution and deterministic simulation — and execute approved
            runs in controlled batches. Execution applies exactly what was approved; no amount is
            recalculated at execution time.
          </p>

          <Tabs defaultValue="policies">
            <TabsList>
              <TabsTrigger value="policies">Policy catalogue</TabsTrigger>
              <TabsTrigger value="runs">Runs &amp; simulation</TabsTrigger>
              <TabsTrigger value="approvals">Approvals &amp; scheduling</TabsTrigger>
              <TabsTrigger value="execution">Execution queue</TabsTrigger>
            </TabsList>
            <TabsContent value="policies" className="pt-4">
              <BnUpratingPolicyWorkspace ctx={ctx} />
            </TabsContent>
            <TabsContent value="runs" className="pt-4">
              <BnUpratingRunWorkspace ctx={ctx} />
            </TabsContent>
            <TabsContent value="approvals" className="pt-4">
              <BnUpratingApprovalQueue />
            </TabsContent>
            <TabsContent value="execution" className="pt-4">
              <BnUpratingExecutionQueue />
            </TabsContent>
          </Tabs>


        </div>
      )}
    </BnModuleRouteGate>
  );
}
