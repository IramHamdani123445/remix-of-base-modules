/**
 * BN Medical Reviews — section state renderer.
 *
 * Renders the six independent section states so a failure is never disguised
 * as an empty result.
 */
import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Lock, RefreshCw } from 'lucide-react';
import type { SectionState as SectionStateModel } from '@/hooks/bn/useMedicalReviewSection';

interface Props<T> {
  /** Used for stable test ids: `mr-section-<name>-<state>`. */
  name: string;
  section: SectionStateModel<T>;
  emptyMessage: string;
  children: (data: T) => React.ReactNode;
}

export function SectionStateView<T>({ name, section, emptyMessage, children }: Props<T>) {
  switch (section.status) {
    case 'loading':
      return (
        <div data-testid={`mr-section-${name}-loading`}>
          <Skeleton className="h-20 w-full" />
        </div>
      );

    case 'permission_denied':
      return (
        <Alert data-testid={`mr-section-${name}-permission-denied`}>
          <Lock className="h-4 w-4" />
          <AlertTitle>Not visible to you</AlertTitle>
          <AlertDescription>
            {section.message ?? 'You do not have permission to view this section.'}
          </AlertDescription>
        </Alert>
      );

    case 'failed':
      return (
        <Alert variant="destructive" data-testid={`mr-section-${name}-failed`}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>This section could not be loaded</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{section.message ?? 'The request could not be completed.'}</p>
            <p className="text-xs">
              This is a load failure, not an empty result. Do not treat it as "nothing recorded".
            </p>
            <Button variant="outline" size="sm" onClick={section.reload}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Retry section
            </Button>
          </AlertDescription>
        </Alert>
      );

    case 'not_applicable':
      return (
        <p className="text-sm text-muted-foreground" data-testid={`mr-section-${name}-not-applicable`}>
          {section.message ?? 'Not applicable to this review.'}
        </p>
      );

    case 'empty':
      return (
        <p className="text-sm text-muted-foreground" data-testid={`mr-section-${name}-empty`}>
          {emptyMessage}
        </p>
      );

    case 'loaded':
    default:
      return (
        <div data-testid={`mr-section-${name}-loaded`}>
          {section.data !== null ? children(section.data) : null}
        </div>
      );
  }
}

export default SectionStateView;
