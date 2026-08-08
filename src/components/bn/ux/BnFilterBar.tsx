/**
 * BnFilterBar — one search-and-filter pattern for every Benefits queue.
 *
 * Search is always first and always full width on small screens; filters follow
 * in a predictable row; a single "Clear filters" affordance is offered whenever
 * something is applied, so officers never hunt for how to get back to the full
 * list.
 */
import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  readonly searchValue?: string;
  readonly onSearchChange?: (value: string) => void;
  readonly searchPlaceholder?: string;
  readonly searchLabel?: string;
  /** Selects, date pickers and other narrow controls. */
  readonly children?: React.ReactNode;
  readonly onClear?: () => void;
  readonly hasFilters?: boolean;
  readonly actions?: React.ReactNode;
  readonly className?: string;
}

export const BnFilterBar: React.FC<Props> = ({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search',
  searchLabel = 'Search records',
  children,
  onClear,
  hasFilters,
  actions,
  className,
}) => (
  <div
    className={cn('flex flex-col gap-3 lg:flex-row lg:items-center', className)}
    data-testid="bn-filter-bar"
  >
    {onSearchChange && (
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-8"
          value={searchValue ?? ''}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchLabel}
        />
      </div>
    )}
    {children && (
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    )}
    <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
      {hasFilters && onClear && (
        <Button variant="ghost" size="sm" onClick={onClear} data-testid="bn-filter-clear">
          <X className="mr-1 h-4 w-4" />Clear filters
        </Button>
      )}
      {actions}
    </div>
  </div>
);
