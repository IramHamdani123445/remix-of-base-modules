/**
 * BnPhaseSectionNav — two-level workflow navigation.
 *
 * Long lifecycle tab bars (13 Means-Test sections, 9 Uprating sections) are
 * grouped into a small number of officer-meaningful PHASES. The officer picks
 * a phase, then a step inside it, so no more than a handful of choices are
 * visible at once.
 *
 * Purely presentational — the caller owns which section is active and what
 * each section is permitted to do.
 */
import React from 'react';
import { cn } from '@/lib/utils';

export interface BnPhaseSection {
  readonly id: string;
  readonly label: string;
  readonly badge?: React.ReactNode;
}

export interface BnPhase {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly sections: readonly BnPhaseSection[];
}

interface Props {
  readonly phases: readonly BnPhase[];
  readonly activeSection: string;
  readonly onSelect: (sectionId: string) => void;
  readonly ariaLabel: string;
  readonly className?: string;
}

export const BnPhaseSectionNav: React.FC<Props> = ({
  phases,
  activeSection,
  onSelect,
  ariaLabel,
  className,
}) => {
  const activePhase =
    phases.find((phase) => phase.sections.some((s) => s.id === activeSection)) ?? phases[0];

  if (!activePhase) return null;

  return (
    <nav aria-label={ariaLabel} className={cn('space-y-2', className)} data-testid="bn-phase-section-nav">
      <ul className="flex flex-wrap gap-1 rounded-lg border bg-card p-1">
        {phases.map((phase) => {
          const isActive = phase.id === activePhase.id;
          return (
            <li key={phase.id}>
              <button
                type="button"
                onClick={() => onSelect(phase.sections[0]?.id ?? activeSection)}
                aria-current={isActive ? 'true' : undefined}
                data-testid={`bn-phase-${phase.id}`}
                className={cn(
                  'inline-flex min-h-9 items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {phase.label}
              </button>
            </li>
          );
        })}
      </ul>

      {activePhase.description && (
        <p className="text-xs text-muted-foreground">{activePhase.description}</p>
      )}

      <ul className="flex flex-wrap gap-1" data-testid="bn-phase-sections">
        {activePhase.sections.map((section) => {
          const isActive = section.id === activeSection;
          return (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => onSelect(section.id)}
                aria-current={isActive ? 'step' : undefined}
                data-testid={`bn-phase-section-${section.id}`}
                className={cn(
                  'inline-flex min-h-9 items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'border-primary bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {section.label}
                {section.badge}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
