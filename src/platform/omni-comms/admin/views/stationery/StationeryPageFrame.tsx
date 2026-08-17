/**
 * Omni-Comms — Stationery page frame.
 *
 * Stationery is no longer a tab strip inside Overview. Each section is its
 * own route and its own page; this frame renders the shared explanation and
 * the section rail that matches the left-hand menu.
 *
 * IMPORTANT: these pages are a second entry point, not a second system. The
 * very same Communication Hub editors, hooks and tables are rendered here —
 * no duplicate records, no parallel editors.
 */
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { OMNI_COMMS_NAV_GROUPS } from '../../navigation/omniCommsNavigation';

const STATIONERY_ITEMS =
  OMNI_COMMS_NAV_GROUPS.find((g) => g.id === 'stationery')?.items ?? [];

export interface StationeryPageFrameProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

export const StationeryPageFrame: React.FC<StationeryPageFrameProps> = ({
  title,
  description,
  children,
}) => {
  const { pathname } = useLocation();

  return (
    <div className="space-y-4" data-testid="omni-comms-stationery">
      <Card>
        <CardContent className="pt-6">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </CardContent>
      </Card>

      <nav
        aria-label="Stationery sections"
        className="flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1.5"
      >
        {STATIONERY_ITEMS.map((s) => {
          const isActive = pathname.replace(/\/+$/, '') === s.route;
          return (
            <Link
              key={s.id}
              to={s.href}
              aria-current={isActive ? 'page' : undefined}
              title={s.description}
              data-testid={`omni-comms-${s.id}`}
              className={cn(
                'inline-flex min-h-11 items-center rounded-md px-4 text-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive
                  ? 'bg-background font-medium text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {s.label}
            </Link>
          );
        })}
      </nav>

      <div>{children}</div>
    </div>
  );
};

export default StationeryPageFrame;
