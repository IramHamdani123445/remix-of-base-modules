/**
 * MEANS-TEST EPIC 2 — assessment stage journey.
 *
 * A read-only orientation strip: where the officer is in the assessment
 * journey and what happens next. Stage state is derived from
 * backend-owned section readiness — never from local form state.
 */
import React from 'react';
import { Check, Circle, Dot } from 'lucide-react';

export type BnMeansStageState = 'COMPLETE' | 'CURRENT' | 'PENDING' | 'BLOCKED';

export interface BnMeansStage {
  readonly key: string;
  readonly label: string;
  readonly state: BnMeansStageState;
  readonly hint?: string;
}

export const BnMeansStageJourney: React.FC<{
  stages: readonly BnMeansStage[];
  onSelect?: (key: string) => void;
}> = ({ stages, onSelect }) => (
  <ol
    className="flex flex-wrap items-stretch gap-2"
    data-testid="means-stage-journey"
    aria-label="Assessment journey"
  >
    {stages.map((stage, index) => {
      const tone =
        stage.state === 'COMPLETE'
          ? 'border-primary/40 bg-primary/5'
          : stage.state === 'CURRENT'
            ? 'border-primary bg-primary/10'
            : stage.state === 'BLOCKED'
              ? 'border-destructive/40 bg-destructive/5'
              : 'border-border bg-muted/30';
      return (
        <li key={stage.key} className="min-w-[9rem] flex-1">
          <button
            type="button"
            disabled={!onSelect}
            onClick={() => onSelect?.(stage.key)}
            aria-current={stage.state === 'CURRENT' ? 'step' : undefined}
            data-state={stage.state}
            data-testid={`means-stage-${stage.key}`}
            className={`h-full w-full rounded-md border px-3 py-2 text-left transition ${tone} ${
              onSelect ? 'hover:bg-muted' : 'cursor-default'
            }`}
          >
            <span className="flex items-center gap-1 text-[11px] uppercase text-muted-foreground">
              {stage.state === 'COMPLETE' ? (
                <Check className="h-3 w-3" />
              ) : stage.state === 'CURRENT' ? (
                <Dot className="h-3 w-3" />
              ) : (
                <Circle className="h-2.5 w-2.5" />
              )}
              Step {index + 1}
            </span>
            <span className="block text-sm font-medium">{stage.label}</span>
            {stage.hint && (
              <span className="block text-xs text-muted-foreground">{stage.hint}</span>
            )}
          </button>
        </li>
      );
    })}
  </ol>
);

export default BnMeansStageJourney;
