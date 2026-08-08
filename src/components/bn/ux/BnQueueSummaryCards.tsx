/**
 * BnQueueSummaryCards — backend-driven operational counts.
 *
 * A failed read is never rendered as zero: `count === undefined` with
 * `unavailable` shows "Unavailable" so an officer can never mistake a query
 * failure for an empty queue.
 */
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface BnQueueSummaryItem {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  /** Undefined + unavailable === the read failed. */
  readonly count?: number;
  readonly loading?: boolean;
  readonly unavailable?: boolean;
  readonly onSelect?: () => void;
}

interface Props {
  readonly items: readonly BnQueueSummaryItem[];
  readonly ariaLabel: string;
  readonly className?: string;
}

export const BnQueueSummaryCards: React.FC<Props> = ({ items, ariaLabel, className }) => (
  <section
    aria-label={ariaLabel}
    data-testid="bn-queue-summary-cards"
    className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-4', className)}
  >
    {items.map((item) => {
      const body = (
        <Card className={cn('h-full', item.onSelect && 'transition-colors hover:border-primary')}>
          <CardHeader className="pb-2">
            <CardDescription>{item.label}</CardDescription>
            <CardTitle className="text-2xl" data-testid={`bn-queue-count-${item.id}`}>
              {item.loading ? (
                <Skeleton className="h-7 w-12" />
              ) : item.unavailable || item.count === undefined ? (
                <span className="text-base font-medium text-destructive">Unavailable</span>
              ) : (
                item.count
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-xs text-muted-foreground">
            {item.unavailable
              ? 'This count could not be loaded — it is not zero.'
              : item.description}
          </CardContent>
        </Card>
      );

      return item.onSelect ? (
        <button
          key={item.id}
          type="button"
          onClick={item.onSelect}
          className="rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid={`bn-queue-card-${item.id}`}
        >
          {body}
        </button>
      ) : (
        <div key={item.id} data-testid={`bn-queue-card-${item.id}`}>
          {body}
        </div>
      );
    })}
  </section>
);
