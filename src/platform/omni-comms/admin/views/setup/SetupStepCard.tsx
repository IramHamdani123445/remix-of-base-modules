/**
 * Omni-Comms Setup Wizard — single step card.
 *
 * Presentation only. Displays server-derived state, evidence, blockers and
 * a deep link to the permanent admin route that owns the step. It never
 * mutates configuration and never performs its own resolution.
 */
import React from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Circle,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  stepTargetHref,
  type SetupStep,
  type SetupStepState,
} from "@/platform/omni-comms/application/setupReadinessService";

const STATE_BADGE: Record<
  SetupStepState,
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  complete: {
    label: "Complete",
    className: "bg-emerald-600 hover:bg-emerald-700",
    Icon: CheckCircle2,
  },
  attention: {
    label: "Needs attention",
    className: "bg-amber-600 hover:bg-amber-700",
    Icon: AlertTriangle,
  },
  incomplete: {
    label: "Incomplete",
    className: "bg-destructive hover:bg-destructive/90",
    Icon: XCircle,
  },
  not_started: {
    label: "Not started",
    className: "bg-muted text-muted-foreground hover:bg-muted",
    Icon: Circle,
  },
};

export interface SetupStepCardProps {
  step: SetupStep;
  isNextRequired: boolean;
}

export const SetupStepCard: React.FC<SetupStepCardProps> = ({
  step,
  isNextRequired,
}) => {
  const badge = STATE_BADGE[step.state];
  const href = stepTargetHref(step);

  return (
    <div
      data-testid={`omni-comms-setup-step-${step.id}`}
      data-step-state={step.state}
      className={`rounded-md border p-4 ${
        isNextRequired ? "border-primary ring-1 ring-primary/30" : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Step {step.index} of 14
            </span>
            {isNextRequired ? (
              <Badge variant="outline" data-testid="omni-comms-setup-next-marker">
                Next required action
              </Badge>
            ) : null}
          </div>
          <h3 className="font-medium">{step.title}</h3>
          <p className="text-sm text-muted-foreground">{step.purpose}</p>
        </div>
        <Badge
          className={badge.className}
          data-testid={`omni-comms-setup-step-badge-${step.id}`}
        >
          <badge.Icon className="mr-1 h-3 w-3" aria-hidden="true" />
          {badge.label}
        </Badge>
      </div>

      {(step.blockers.length > 0 || step.warnings.length > 0) && (
        <ul className="mt-3 space-y-1">
          {step.blockers.map((b) => (
            <li
              key={b.code}
              className="text-sm text-destructive"
              data-testid={`omni-comms-setup-blocker-${b.code}`}
            >
              {b.message}
            </li>
          ))}
          {step.warnings.map((w) => (
            <li
              key={w.code}
              className="text-sm text-amber-700 dark:text-amber-500"
              data-testid={`omni-comms-setup-warning-${w.code}`}
            >
              {w.message}
            </li>
          ))}
        </ul>
      )}

      <Accordion type="single" collapsible className="mt-2">
        <AccordionItem value="evidence" className="border-none">
          <AccordionTrigger className="py-2 text-sm">
            Evidence
          </AccordionTrigger>
          <AccordionContent>
            <ul
              className="space-y-1 text-xs text-muted-foreground"
              data-testid={`omni-comms-setup-evidence-${step.id}`}
            >
              {step.evidence.map((e) => (
                <li key={e} className="font-mono">
                  {e}
                </li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {href ? (
        <Button asChild size="sm" variant="outline" className="mt-1">
          <Link to={href} data-testid={`omni-comms-setup-link-${step.id}`}>
            {step.target?.label ?? "Open"}
            <ArrowRight className="ml-1 h-3 w-3" aria-hidden="true" />
          </Link>
        </Button>
      ) : null}
    </div>
  );
};

export default SetupStepCard;
