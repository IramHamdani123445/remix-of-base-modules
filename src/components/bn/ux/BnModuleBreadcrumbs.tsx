/**
 * BnModuleBreadcrumbs — "where am I" for Benefits screens.
 *
 * The sidebar now owns module navigation, so each screen states its own
 * position instead of repeating a module-local tab bar. Purely presentational.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface BnBreadcrumb {
  readonly label: string;
  /** Omit for the current page. */
  readonly to?: string;
}

interface Props {
  readonly items: readonly BnBreadcrumb[];
  readonly className?: string;
}

export const BnModuleBreadcrumbs: React.FC<Props> = ({ items, className }) => (
  <nav aria-label="Breadcrumb" className={cn('w-full', className)} data-testid="bn-module-breadcrumbs">
    <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
      {items.map((item, index) => {
        const last = index === items.length - 1;
        return (
          <li key={`${item.label}-${index}`} className="flex items-center gap-1">
            {item.to && !last ? (
              <Link to={item.to} className="hover:text-foreground hover:underline">
                {item.label}
              </Link>
            ) : (
              <span className={cn(last && 'font-medium text-foreground')} aria-current={last ? 'page' : undefined}>
                {item.label}
              </span>
            )}
            {!last && <ChevronRight className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  </nav>
);
