import React from 'react';
import { CheckCircle, Circle, Loader2, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const LIFECYCLE_PHASES = [
  { key: 'planning', label: 'Planning', description: 'Scope, risk, and resource planning' },
  { key: 'approval', label: 'Approval', description: 'Plan review and sign-off' },
  { key: 'preparation', label: 'Preparation', description: 'Readiness checks and notifications' },
  { key: 'execution', label: 'Execution', description: 'Fieldwork and evidence gathering' },
  { key: 'findings', label: 'Findings', description: 'Issue identification and documentation' },
  { key: 'followup', label: 'Follow-up', description: 'Management response and actions' },
  { key: 'closure', label: 'Closure', description: 'Quality review and closeout' },
  { key: 'reporting', label: 'Reporting', description: 'Final report issuance' },
] as const;

export type LifecyclePhase = typeof LIFECYCLE_PHASES[number]['key'];

const STATUS_TO_PHASE: Record<string, LifecyclePhase> = {
  'Planned': 'planning',
  'Ready for Launch': 'approval',
  'Notification Sent': 'preparation',
  'Opening Meeting Scheduled': 'preparation',
  'Fieldwork In Progress': 'execution',
  'Findings Drafting': 'findings',
  'Management Response Pending': 'followup',
  'Final Report Issued': 'reporting',
  'Follow-up Monitoring': 'followup',
  'Closed': 'reporting',
  'Deferred': 'planning',
  'Cancelled': 'planning',
};

interface Props {
  executionStatus: string;
  className?: string;
}

export function AuditLifecycleStepper({ executionStatus, className }: Props) {
  const currentPhase = STATUS_TO_PHASE[executionStatus] || 'planning';
  const currentPhaseIndex = LIFECYCLE_PHASES.findIndex(p => p.key === currentPhase);

  return (
    <TooltipProvider>
      <div className={cn('flex items-center gap-0', className)}>
        {LIFECYCLE_PHASES.map((phase, idx) => {
          const isCompleted = idx < currentPhaseIndex;
          const isCurrent = idx === currentPhaseIndex;
          const isFuture = idx > currentPhaseIndex;

          return (
            // DEF-A-04 — a real element wrapper (not React.Fragment) so the
            // dev tagger's data-lov-id prop has a valid host to land on.
            <div key={phase.key} className="flex items-center shrink-0">
              {idx > 0 && (
                <ChevronRight className={cn(
                  'h-3.5 w-3.5 shrink-0 mx-0.5',
                  isCompleted ? 'text-primary' : 'text-border'
                )} />
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all shrink-0',
                    isCompleted && 'bg-primary/10 text-primary',
                    isCurrent && 'bg-primary text-primary-foreground shadow-sm ring-2 ring-primary/20',
                    isFuture && 'bg-muted/50 text-muted-foreground',
                  )}>
                    {isCompleted ? (
                      <CheckCircle className="h-3.5 w-3.5" />
                    ) : isCurrent ? (
                      <Loader2 className="h-3.5 w-3.5 animate-[spin_3s_linear_infinite]" />
                    ) : (
                      <Circle className="h-3.5 w-3.5" />
                    )}
                    <span className="hidden sm:inline">{phase.label}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="font-medium">{phase.label}</p>
                  <p className="text-xs text-muted-foreground">{phase.description}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

export { LIFECYCLE_PHASES };
