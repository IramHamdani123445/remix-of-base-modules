/**
 * Omni-Comms Live Diagnostics — prioritized recommended actions.
 *
 * Every entry links to an existing permanent Omni-Comms route. No new route
 * is introduced by this surface.
 */
import React from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { RecommendedAction } from "@/platform/omni-comms/application/healthDiagnosticsTypes";

export const RecommendedActions: React.FC<{ actions: RecommendedAction[] }> = ({ actions }) => (
  <Card data-testid="omni-comms-health-recommendations">
    <CardHeader className="pb-3">
      <CardTitle className="text-base">Recommended actions</CardTitle>
      <CardDescription>
        Derived from failing live diagnostics, most urgent first.
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      {actions.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="omni-comms-health-no-actions">
          No corrective action is outstanding for this tenant.
        </p>
      ) : (
        actions.map((a) => (
          <div
            key={`${a.priority}-${a.blockingDiagnostic}`}
            data-testid={`omni-comms-health-action-${a.blockingDiagnostic}`}
            className="flex items-start gap-3 border-b border-border/60 pb-3 last:border-0 last:pb-0"
          >
            <Badge variant="outline" className="shrink-0">
              {a.priority}
            </Badge>
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">{a.title}</p>
              <p className="text-xs text-muted-foreground">{a.reason}</p>
              <p className="text-xs text-muted-foreground">
                Blocking diagnostic: {a.blockingDiagnostic} —{" "}
                <Link className="underline" to={a.targetScreen}>
                  {a.targetScreen}
                </Link>
              </p>
            </div>
          </div>
        ))
      )}
    </CardContent>
  </Card>
);

export default RecommendedActions;
