import React from "react";
import {
  BnModuleRouteGate,
  type BnModuleAccessContext,
} from "@/components/bn/access/BnModuleRouteGate";
import { Badge } from "@/components/ui/badge";
import { TrendingUp } from "lucide-react";
import { BnUpratingPolicyWorkspace } from "@/components/bn/uprating/BnUpratingPolicyWorkspace";

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
            Maintain the governed uprating policy catalogue: policy types, effective-dated
            versions, applicability, rounding and independent approval. Uprating runs,
            simulation and execution are delivered in a later stage.
          </p>
          <BnUpratingPolicyWorkspace ctx={ctx} />
        </div>
      )}
    </BnModuleRouteGate>
  );
}
