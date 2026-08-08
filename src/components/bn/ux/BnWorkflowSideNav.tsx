/**
 * BnWorkflowSideNav — left, routed workflow navigator for record workspaces.
 *
 * Replaces long horizontal lifecycle tab bars inside a record. Each step is a
 * real address, so refresh, Back and shared links keep the officer in place.
 * Presentational only: the caller decides which steps exist and what each one
 * is permitted to do.
 */
import React from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

export interface BnWorkflowNavStep {
  readonly id: string;
  readonly label: string;
  readonly to: string;
  readonly badge?: React.ReactNode;
}

export interface BnWorkflowNavGroup {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly steps: readonly BnWorkflowNavStep[];
}

interface Props {
  readonly groups: readonly BnWorkflowNavGroup[];
  readonly activeStepId: string;
  readonly ariaLabel: string;
  readonly className?: string;
}

export const BnWorkflowSideNav: React.FC<Props> = ({
  groups,
  activeStepId,
  ariaLabel,
  className,
}) => (
  <nav
    aria-label={ariaLabel}
    className={cn('w-full lg:w-64 lg:shrink-0', className)}
    data-testid="bn-workflow-side-nav"
  >
    <div className="space-y-4 rounded-lg border bg-card p-3">
      {groups.map((group) => (
        <div key={group.id} className="space-y-1">
          <p className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.label}
          </p>
          {group.description && (
            <p className="px-2 pb-1 text-xs text-muted-foreground">{group.description}</p>
          )}
          <ul className="space-y-0.5">
            {group.steps.map((step) => {
              const isActive = step.id === activeStepId;
              return (
                <li key={step.id}>
                  <NavLink
                    to={step.to}
                    aria-current={isActive ? 'step' : undefined}
                    data-testid={`bn-workflow-step-${step.id}`}
                    className={cn(
                      'flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isActive
                        ? 'bg-primary text-primary-foreground font-medium'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <span className="truncate">{step.label}</span>
                    {step.badge}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  </nav>
);
