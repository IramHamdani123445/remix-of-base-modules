/**
 * Omni-Comms Live Diagnostics — overall posture card.
 *
 * The posture is DERIVED from live diagnostics only. It never renders
 * "Operational" or "Production Ready".
 */
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  OVERALL_POSTURE_LABELS,
  type OverallPosture,
} from "@/platform/omni-comms/application/healthDiagnosticsTypes";

const TONE: Record<OverallPosture, string> = {
  unavailable: "bg-muted text-muted-foreground",
  blocked: "bg-destructive/10 text-destructive",
  configuration_incomplete: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  ready_for_dry_run: "bg-primary/10 text-primary",
  implementation_testing_only: "bg-primary/10 text-primary",
  runtime_certified: "bg-primary/10 text-primary",
  live_delivery_enabled: "bg-primary/10 text-primary",
};

export interface HealthPostureCardProps {
  posture: OverallPosture;
  reason: string;
  generatedAt: string;
}

export const HealthPostureCard: React.FC<HealthPostureCardProps> = ({
  posture,
  reason,
  generatedAt,
}) => (
  <Card data-testid="omni-comms-health-posture">
    <CardHeader className="pb-2">
      <CardTitle className="text-base">Overall live posture</CardTitle>
    </CardHeader>
    <CardContent className="space-y-2">
      <Badge
        variant="outline"
        className={TONE[posture]}
        data-testid={`omni-comms-health-posture-${posture}`}
      >
        {OVERALL_POSTURE_LABELS[posture]}
      </Badge>
      <p className="text-sm text-muted-foreground">{reason}</p>
      <p className="text-xs text-muted-foreground">
        Evidence timestamp: {new Date(generatedAt).toLocaleString()}
      </p>
    </CardContent>
  </Card>
);

export default HealthPostureCard;
