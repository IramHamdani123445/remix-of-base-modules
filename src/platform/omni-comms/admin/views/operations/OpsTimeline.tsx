/**
 * Omni-Comms Operations — sequence-verified request timeline (read-only).
 *
 * Ordering is by `event_sequence`. Gaps and duplicates reported by the
 * server-side verifier are surfaced explicitly rather than hidden.
 */
import React from "react";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type {
  OpsTimelineEntry,
  OpsTimelineWarning,
} from "@/platform/omni-comms/application/operationsService";
import OmniCommsEmptyState from "../../components/OmniCommsEmptyState";

export interface OpsTimelineProps {
  entries: OpsTimelineEntry[];
  warnings: OpsTimelineWarning[];
}

function formatTs(v: string | null): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return v;
  }
}

export const OpsTimeline: React.FC<OpsTimelineProps> = ({ entries, warnings }) => {
  const ordered = [...entries].sort((a, b) => a.event_sequence - b.event_sequence);

  return (
    <div className="space-y-3" data-testid="omni-comms-ops-timeline">
      {warnings.length > 0 && (
        <Alert variant="destructive" data-testid="omni-comms-ops-timeline-warnings">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="space-y-1 text-xs">
            {warnings.map((w, i) => (
              <div key={`${w.code}-${i}`}>
                <span className="font-mono">{w.code}</span> — {w.message}
              </div>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {ordered.length === 0 ? (
        <OmniCommsEmptyState
          title="No timeline events"
          description="This request has no recorded lifecycle events."
        />
      ) : (
        <ol className="relative border-l pl-4 space-y-4">
          {ordered.map((e) => (
            <li key={e.id} className="relative" data-testid={`omni-comms-ops-timeline-${e.event_sequence}`}>
              <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono text-[11px]">
                  #{e.event_sequence}
                </Badge>
                <span className="text-sm font-medium">{e.event_type}</span>
                {e.status_before || e.status_after ? (
                  <span className="text-xs text-muted-foreground">
                    {e.status_before ?? "—"} → {e.status_after ?? "—"}
                  </span>
                ) : null}
                <span className="text-xs text-muted-foreground ml-auto">
                  {formatTs(e.created_at)}
                </span>
              </div>
              {e.summary ? (
                <p className="text-xs text-muted-foreground mt-1">{e.summary}</p>
              ) : null}
              {e.message_id ? (
                <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                  message {e.message_id}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

export default OpsTimeline;
