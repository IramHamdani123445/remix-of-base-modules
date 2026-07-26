/**
 * Single top banner for the Go-Live journey.
 * Renders exact server-authoritative lifecycle, next action, blocker,
 * selected module/event/channel, operating mode and automation state.
 */
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Activity } from "lucide-react";
import type { LifecycleSummary } from "./goLiveStateResolver";

interface Props {
  summary: LifecycleSummary;
}

export default function LifecycleBanner({ summary }: Props) {
  return (
    <Alert>
      <Activity className="h-4 w-4" />
      <AlertTitle className="flex flex-wrap items-center gap-2">
        Current lifecycle
        <Badge variant="default" className="font-mono">{summary.lifecycle}</Badge>
      </AlertTitle>
      <AlertDescription>
        <div className="mt-1 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 md:grid-cols-3">
          <div>
            <span className="text-muted-foreground">Next required action:</span>{" "}
            <span className="font-medium">{summary.nextAction}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Exact blocker:</span>{" "}
            {summary.blocker ? (
              <code className="font-mono">{summary.blocker}</code>
            ) : (
              <span>—</span>
            )}
          </div>
          <div>
            <span className="text-muted-foreground">Scope:</span>{" "}
            <code className="font-mono">{summary.moduleCode}</code> ·{" "}
            <code className="font-mono">{summary.eventCode}</code> · {summary.channel}
          </div>
          <div>
            <span className="text-muted-foreground">Operating mode:</span>{" "}
            <Badge variant="outline">{summary.operatingMode}</Badge>
          </div>
          <div>
            <span className="text-muted-foreground">Automation state:</span>{" "}
            <Badge variant="outline">{summary.automationState}</Badge>
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}
