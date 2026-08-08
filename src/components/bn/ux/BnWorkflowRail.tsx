/**
 * BnWorkflowRail — journey/step rail for Benefits record workspaces.
 *
 * Replaces flat lifecycle tab bars. Stage state is supplied by the caller
 * from authoritative backend readiness/action data — this component never
 * derives completion, permission or availability itself.
 */
import React from 'react';
import { cn } from '@/lib/utils';
import { Check, CircleDot, Lock, Circle, AlertTriangle } from 'lucide-react';

export type BnWorkflowStageState =
  | 'COMPLETE'
  | 'CURRENT'
  | 'BLOCKED'
  | 'NEXT'
  | 'NOT_STARTED';

export interface BnWorkflowStage {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly state: BnWorkflowStageState;
  /** Required when state is BLOCKED — shown to the officer. */
  readonly blockedReason?: string;
  /**
   * Exceptional paths (rollback, reopen, correction, failure handling).
   * Callers must omit these stages entirely unless backend state makes
   * them relevant.
   */
  readonly exceptional?: boolean;
}

interface Props {
  readonly stages: readonly BnWorkflowStage[];
  readonly activeId: string;
  readonly onSelect: (id: string) => void;
  readonly ariaLabel?: string;
  readonly className?: string;
}

const STATE_ICON: Record<BnWorkflowStageState, React.ComponentType<{ className?: string }>> = {
  COMPLETE: Check,
  CURRENT: CircleDot,
  BLOCKED: Lock,
  NEXT: Circle,
  NOT_STARTED: Circle,
};

const STATE_LABEL: Record<BnWorkflowStageState, string> = {
  COMPLETE: 'Complete',
  CURRENT: 'Current stage',
  BLOCKED: 'Blocked',
  NEXT: 'Next',
  NOT_STARTED: 'Not started',
};

export const BnWorkflowRail: React.FC<Props> = ({
  stages,
  activeId,
  onSelect,
  ariaLabel = 'Workflow stages',
  className,
}) => (
  <nav aria-label={ariaLabel} className={cn('w-full', className)} data-testid="bn-workflow-rail">
    <ol className="flex flex-col gap-1 rounded-lg border bg-card p-2 md:flex-row md:flex-wrap md:items-stretch">
      {stages.map((stage, index) => {
        const Icon = stage.state === 'BLOCKED' ? AlertTriangle : STATE_ICON[stage.state];
        const isActive = stage.id === activeId;
        const secondary = stage.state === 'NOT_STARTED';
        return (
          <li key={stage.id} className="md:flex-1 md:min-w-[9rem]">
            <button
              type="button"
              onClick={() => onSelect(stage.id)}
              aria-current={isActive ? 'step' : undefined}
              data-stage-state={stage.state}
              data-testid={`bn-workflow-stage-${stage.id}`}
              className={cn(
                'flex w-full flex-col items-start gap-0.5 rounded-md border border-transparent px-3 py-2 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive ? 'border-border bg-muted' : 'hover:bg-muted/60',
                secondary && !isActive && 'opacity-60',
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <Icon
                  className={cn(
                    'h-4 w-4 shrink-0',
                    stage.state === 'COMPLETE' && 'text-primary',
                    stage.state === 'BLOCKED' && 'text-destructive',
                  )}
                  aria-hidden="true"
                />
                <span className="truncate">
                  {index + 1}. {stage.label}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">
                {STATE_LABEL[stage.state]}
                {stage.description ? ` · ${stage.description}` : ''}
              </span>
              {stage.state === 'BLOCKED' && stage.blockedReason && (
                <span className="text-xs text-destructive">{stage.blockedReason}</span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  </nav>
);
