/**
 * Omni-Comms Setup Wizard — progress and posture summary.
 *
 * Presentation only. Every value shown here is derived from the bounded
 * `omni_comms_setup_readiness` payload.
 */
import React from "react";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { SetupPlan } from "@/platform/omni-comms/application/setupReadinessService";

export interface SetupProgressSummaryProps {
  plan: SetupPlan;
}

export const SetupProgressSummary: React.FC<SetupProgressSummaryProps> = ({
  plan,
}) => {
  const pct = Math.round((plan.completedSteps / plan.totalSteps) * 100);

  return (
    <div className="space-y-4" data-testid="omni-comms-setup-summary">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium" data-testid="omni-comms-setup-progress-label">
          {plan.completedSteps} of {plan.totalSteps} steps satisfied
        </span>
        <Badge
          variant={plan.dryRunReady ? "default" : "secondary"}
          data-testid="omni-comms-setup-dry-run-badge"
        >
          {plan.dryRunReady
            ? "Dry-run ready"
            : "Not ready for a dry run"}
        </Badge>
        <Badge variant="secondary" data-testid="omni-comms-setup-live-badge">
          Live send: not implemented
        </Badge>
        <span className="text-xs text-muted-foreground">
          Evidence generated {new Date(plan.generatedAt).toLocaleString()}
        </span>
      </div>

      <Progress value={pct} aria-label="Setup completion" />

      {plan.nextRequiredStep ? (
        <Alert data-testid="omni-comms-setup-next-required">
          <ArrowRight className="h-4 w-4" />
          <AlertTitle>
            Next required action — step {plan.nextRequiredStep.index}:{" "}
            {plan.nextRequiredStep.title}
          </AlertTitle>
          <AlertDescription className="text-sm">
            {plan.nextRequiredStep.blockers[0]?.message ??
              plan.nextRequiredStep.purpose}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert data-testid="omni-comms-setup-complete">
          <AlertTitle>Configuration path complete</AlertTitle>
          <AlertDescription className="text-sm">
            Every configuration step for this pilot path is satisfied. Live
            provider dispatch is still not implemented in this build.
          </AlertDescription>
        </Alert>
      )}

      <Alert data-testid="omni-comms-setup-live-notice">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>This wizard never sends</AlertTitle>
        <AlertDescription className="text-sm">
          The Setup Wizard is read-only guidance. It creates no request,
          enqueues no job, contacts no provider and changes no configuration.
          Each step links to the screen that owns the change.
        </AlertDescription>
      </Alert>
    </div>
  );
};

export default SetupProgressSummary;
