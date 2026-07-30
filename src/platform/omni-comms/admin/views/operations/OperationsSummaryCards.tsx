/**
 * Omni-Comms Operations — summary counter cards (read-only).
 */
import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { OpsSummary } from "@/platform/omni-comms/application/operationsService";

export interface OperationsSummaryCardsProps {
  summary: OpsSummary | null;
  loading: boolean;
}

interface Cell {
  key: string;
  label: string;
  value: number;
  hint?: string;
}

export const OperationsSummaryCards: React.FC<OperationsSummaryCardsProps> = ({
  summary,
  loading,
}) => {
  const cells: Cell[] = summary
    ? [
        { key: "requests", label: "Requests", value: summary.requests },
        { key: "recipients", label: "Recipients", value: summary.recipients },
        { key: "messages", label: "Messages", value: summary.messages },
        { key: "held-jobs", label: "Held dispatch jobs", value: summary.held_jobs, hint: "Never runnable in this build" },
        { key: "runnable-jobs", label: "Runnable jobs", value: summary.runnable_jobs, hint: "Expected to be zero" },
        { key: "delivery-attempts", label: "Delivery attempts", value: summary.delivery_attempts, hint: "Expected to be zero" },
        { key: "blocked", label: "Blocked requests", value: summary.blocked_requests },
        { key: "dry-runs", label: "Completed dry runs", value: summary.completed_dry_runs },
        { key: "processing", label: "Processing", value: summary.processing_requests },
        { key: "failed", label: "Failed", value: summary.failed_requests },
      ]
    : [];

  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="omni-comms-ops-summary-loading">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="omni-comms-ops-summary">
      {cells.map((c) => (
        <Card key={c.key} data-testid={`omni-comms-ops-counter-${c.key}`}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className="text-2xl font-semibold tabular-nums">{c.value.toLocaleString()}</p>
            {c.hint ? <p className="text-[11px] text-muted-foreground mt-1">{c.hint}</p> : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default OperationsSummaryCards;
