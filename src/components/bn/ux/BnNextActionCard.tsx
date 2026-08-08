/**
 * BnNextActionCard — "What needs to happen next?" panel.
 *
 * Driven exclusively by backend action/readiness data. React never infers
 * lifecycle permissions. If availability cannot be loaded the card fails
 * closed with an explicit "could not be confirmed" message — it must never
 * present a query failure as "no action required".
 */
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle } from 'lucide-react';

export const BN_ACTION_UNCONFIRMED_MESSAGE =
  'Action availability could not be confirmed.';

export interface BnNextAction {
  readonly id: string;
  /** Officer-friendly operation name. */
  readonly label: string;
  /** Backend-declared availability. */
  readonly available: boolean;
  /** Why it is available, or the blocking reason when it is not. */
  readonly reason?: string;
  /** Role or actor expected to perform the operation, where known. */
  readonly actor?: string;
  readonly onSelect?: () => void;
}

interface Props {
  /** `loading` while readiness is in flight, `error` when the read failed. */
  readonly status: 'loading' | 'error' | 'ready';
  readonly actions?: readonly BnNextAction[];
  readonly heading?: string;
  /** Shown when the backend authoritatively returns no available action. */
  readonly emptyMessage?: string;
  readonly errorDetail?: string;
}

export const BnNextActionCard: React.FC<Props> = ({
  status,
  actions = [],
  heading = 'What needs to happen next?',
  emptyMessage = 'The backend reports no operation available to you at this stage.',
  errorDetail,
}) => (
  <Card data-testid="bn-next-action-card">
    <CardHeader className="pb-3">
      <CardTitle className="text-base">{heading}</CardTitle>
      <CardDescription>
        Availability is decided by the module backend, not by this screen.
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      {status === 'loading' && <Skeleton className="h-16 w-full" />}

      {status === 'error' && (
        <Alert variant="destructive" data-testid="bn-next-action-unconfirmed">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{BN_ACTION_UNCONFIRMED_MESSAGE}</AlertTitle>
          <AlertDescription>
            No operation is offered while availability is unknown.
            {errorDetail ? ` (${errorDetail})` : ''}
          </AlertDescription>
        </Alert>
      )}

      {status === 'ready' && actions.length === 0 && (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      )}

      {status === 'ready' &&
        actions.map((action) => (
          <div
            key={action.id}
            className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
            data-testid={`bn-next-action-${action.id}`}
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{action.label}</p>
              {action.reason && (
                <p className="text-xs text-muted-foreground">{action.reason}</p>
              )}
              {action.actor && (
                <p className="text-xs text-muted-foreground">Responsible: {action.actor}</p>
              )}
            </div>
            <Button
              size="sm"
              variant={action.available ? 'default' : 'outline'}
              disabled={!action.available || !action.onSelect}
              onClick={action.onSelect}
            >
              {action.available ? 'Go to this step' : 'Not available'}
            </Button>
          </div>
        ))}
    </CardContent>
  </Card>
);
