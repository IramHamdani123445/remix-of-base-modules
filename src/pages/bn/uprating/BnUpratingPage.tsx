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
            Maintain the governed uprating policy catalogue and prepare uprating runs:
            population snapshots, exception resolution and deterministic simulation.
            Run approval, execution scheduling and payment impact are delivered in a
            later stage — nothing on this page changes an award or a payment.
          </p>

          <Tabs defaultValue="policies">
            <TabsList>
              <TabsTrigger value="policies">Policy catalogue</TabsTrigger>
              <TabsTrigger value="runs">Runs &amp; simulation</TabsTrigger>
              <TabsTrigger value="approvals">Approvals &amp; scheduling</TabsTrigger>
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
          </Tabs>

        </div>
      )}
    </BnModuleRouteGate>
  );
}
