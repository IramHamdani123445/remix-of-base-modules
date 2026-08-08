/**
 * BnModuleSectionNav — module-local primary navigation for Benefits modules.
 *
 * Replaces large horizontal lifecycle tab bars with a small set of routed
 * destinations (4–6). Navigation is URL driven so every destination can be
 * bookmarked, refreshed and reached with browser Back.
 *
 * Visibility is convenience only — every destination remains protected by
 * `BnModuleRouteGate` and backend action permissions.
 */
import React from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

export interface BnModuleSectionNavItem {
  /** Absolute route for this destination. */
  readonly to: string;
  /** Officer-friendly label — no implementation terminology. */
  readonly label: string;
  /** Match the route exactly (used for the module landing page). */
  readonly end?: boolean;
  /** Hide when the officer does not hold the relevant permission. */
  readonly visible?: boolean;
}

interface Props {
  readonly items: readonly BnModuleSectionNavItem[];
  readonly ariaLabel: string;
  readonly className?: string;
}

export const BnModuleSectionNav: React.FC<Props> = ({ items, ariaLabel, className }) => {
  const visible = items.filter((item) => item.visible !== false);
  return (
    <nav aria-label={ariaLabel} className={cn('w-full', className)} data-testid="bn-module-section-nav">
      <ul className="flex flex-wrap items-center gap-1 rounded-lg border bg-card p-1">
        {visible.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'inline-flex min-h-9 items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
};
