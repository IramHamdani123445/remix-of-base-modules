/**
 * BnDataState — one loading / denied / error / empty presentation for every
 * Benefits queue, table and panel.
 *
 * Before this component each module invented its own states (bare paragraphs,
 * different skeleton heights, inconsistent error copy), which made the four
 * modules feel like separate products. Callers pass the state; the rendering
 * decision is made in one place.
 */
import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Inbox, RefreshCw, ShieldAlert } from 'lucide-react';

export type BnDataStateKind = 'loading' | 'denied' | 'error' | 'empty' | 'ready';

interface Props {
  readonly state: BnDataStateKind;
  /** Rendered when `state` is `ready`. */
  readonly children?: React.ReactNode;
  readonly loadingRows?: number;
  readonly deniedMessage?: string;
  readonly errorTitle?: string;
  readonly errorDetail?: string | null;
  readonly emptyTitle?: string;
  readonly emptyMessage?: string;
  readonly emptyAction?: React.ReactNode;
  readonly onRetry?: () => void;
  readonly testId?: string;
}

export const BnDataState: React.FC<Props> = ({
  state,
  children,
  loadingRows = 4,
  deniedMessage = 'You do not hold the permission required to view this information.',
  errorTitle = 'This information could not be loaded',
  errorDetail,
  emptyTitle = 'Nothing to show',
  emptyMessage = 'No records match the current filters.',
  emptyAction,
  onRetry,
  testId,
}) => {
  if (state === 'ready') return <>{children}</>;

  if (state === 'loading') {
    return (
      <div className="space-y-2" data-testid={testId ? `${testId}-loading` : 'bn-data-loading'}>
        {Array.from({ length: loadingRows }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (state === 'denied') {
    return (
      <Alert variant="destructive" data-testid={testId ? `${testId}-denied` : 'bn-data-denied'}>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Access denied</AlertTitle>
        <AlertDescription>{deniedMessage}</AlertDescription>
      </Alert>
    );
  }

  if (state === 'error') {
    return (
      <Alert variant="destructive" data-testid={testId ? `${testId}-error` : 'bn-data-error'}>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>{errorTitle}</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>{errorDetail ?? 'Try again; if the problem continues, contact support.'}</p>
          {onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RefreshCw className="mr-2 h-4 w-4" />Try again
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-8 text-center"
      data-testid={testId ? `${testId}-empty` : 'bn-data-empty'}
    >
      <Inbox className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">{emptyTitle}</p>
      <p className="max-w-md text-sm text-muted-foreground">{emptyMessage}</p>
      {emptyAction}
    </div>
  );
};
