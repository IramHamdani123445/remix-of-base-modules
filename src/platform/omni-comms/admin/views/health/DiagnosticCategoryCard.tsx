/**
 * Omni-Comms Live Diagnostics — one diagnostic category card.
 *
 * Renders bounded, safe evidence only. No payloads, destinations or
 * credential material can reach this component: the diagnostic model has no
 * field for them.
 */
import React from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type {
  DiagnosticCategory,
  DiagnosticState,
} from "@/platform/omni-comms/application/healthDiagnosticsTypes";

const STATE_TONE: Record<DiagnosticState, string> = {
  healthy: "bg-primary/10 text-primary",
  ready: "bg-primary/10 text-primary",
  configured: "bg-primary/10 text-primary",
  partial: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  blocked: "bg-destructive/10 text-destructive",
  unavailable: "bg-destructive/10 text-destructive",
  not_implemented: "bg-muted text-muted-foreground",
  not_certified: "bg-muted text-muted-foreground",
  unknown: "bg-muted text-muted-foreground",
};

const STATE_LABEL: Record<DiagnosticState, string> = {
  healthy: "Healthy",
  ready: "Ready",
  configured: "Configured",
  partial: "Partial",
  blocked: "Blocked",
  unavailable: "Unavailable",
  not_implemented: "Not implemented",
  not_certified: "Not certified",
  unknown: "Unknown",
};

export const DiagnosticCategoryCard: React.FC<{ category: DiagnosticCategory }> = ({
  category,
}) => (
  <Card data-testid={`omni-comms-health-category-${category.code}`}>
    <CardHeader className="pb-3">
      <CardTitle className="text-base">{category.title}</CardTitle>
      <CardDescription>{category.description}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      {category.rows.map((r) => (
        <div
          key={r.code}
          data-testid={`omni-comms-health-row-${r.code}`}
          className="flex flex-col gap-1 border-b border-border/60 pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
        >
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{r.title}</span>
              <span className="text-xs text-muted-foreground">{r.code}</span>
            </div>
            <p className="text-sm text-muted-foreground">{r.summary}</p>
            {r.evidence.length > 0 && (
              <p className="text-xs text-muted-foreground/80">{r.evidence.join(" · ")}</p>
            )}
            {r.recommendedAction && (
              <p className="text-xs">
                Recommended: {r.recommendedAction}
                {r.targetScreen && (
                  <>
                    {" — "}
                    <Link className="underline" to={r.targetScreen}>
                      Open screen
                    </Link>
                  </>
                )}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground/70">
              Evidence at {new Date(r.evidenceAt).toLocaleTimeString()}
            </p>
          </div>
          <Badge
            variant="outline"
            className={`${STATE_TONE[r.state]} shrink-0`}
            data-testid={`omni-comms-health-state-${r.code}`}
          >
            {STATE_LABEL[r.state]}
          </Badge>
        </div>
      ))}
    </CardContent>
  </Card>
);

export default DiagnosticCategoryCard;
