/**
 * Omni-Comms UX Simplification — Email readiness summary (above the fold).
 *
 * One honest answer to three operator questions, in this order:
 *   1. Can this channel send right now?
 *   2. What is the single next thing blocking it?
 *   3. Where do I go to fix it?
 *
 * Boundaries: presentation only. The verdict comes verbatim from the shared
 * go-live projection; this component never derives readiness of its own and
 * never contacts a provider.
 */
import React from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, PauseCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  GO_LIVE_STATUS_LABEL,
  type GoLiveReadinessProjection,
} from './goLiveReadiness';
import {
  CHANNEL_SECTION_TAB_LABELS,
  tabForReadinessCheck,
} from '../../navigation/channelWorkspaceSections';

export interface EmailReadinessSummaryProps {
  readiness: GoLiveReadinessProjection | null;
  /** Navigate to the surface that clears the current blocker. */
  onGoToTab: (tab: string) => void;
  loading?: boolean;
}

export const EmailReadinessSummary: React.FC<EmailReadinessSummaryProps> = ({
  readiness,
  onGoToTab,
  loading,
}) => {
  if (!readiness) {
    return (
      <Card data-testid="omni-comms-readiness-summary">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Readiness</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {loading
            ? 'Checking the current configuration…'
            : 'Readiness is not available for this channel yet.'}
        </CardContent>
      </Card>
    );
  }

  const { nextBlocker, readyCount, totalCount, allReady, pilotSuspended } =
    readiness;
  const percent = totalCount > 0 ? Math.round((readyCount / totalCount) * 100) : 0;
  const targetTab = nextBlocker ? tabForReadinessCheck(nextBlocker.key) : null;

  const headline = pilotSuspended
    ? 'Delivery is suspended'
    : allReady
      ? readiness.liveDeliveryAvailable
        ? 'Ready to send'
        : 'Setup complete · live delivery still switched off'
      : 'Not ready to send yet';

  const Icon = pilotSuspended
    ? PauseCircle
    : allReady
      ? CheckCircle2
      : AlertTriangle;

  return (
    <Card
      data-testid="omni-comms-readiness-summary"
      className={
        pilotSuspended || !allReady ? 'border-destructive/40' : 'border-primary/40'
      }
    >
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon className="h-4 w-4" aria-hidden="true" />
            {headline}
          </CardTitle>
          <Badge
            variant={allReady && !pilotSuspended ? 'secondary' : 'destructive'}
            data-testid="omni-comms-readiness-summary-count"
          >
            {readyCount} of {totalCount} checks passed
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={percent} aria-label="Readiness progress" />

        {nextBlocker ? (
          <div
            className="rounded-lg border bg-muted/40 p-4"
            data-testid="omni-comms-readiness-next-action"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Next action
            </p>
            <p className="mt-1 text-sm font-medium">{nextBlocker.nextAction}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {nextBlocker.label} · {GO_LIVE_STATUS_LABEL[nextBlocker.status]}
              {nextBlocker.detail ? ` · ${nextBlocker.detail}` : ''}
            </p>
            {targetTab ? (
              <Button
                size="sm"
                className="mt-3"
                onClick={() => onGoToTab(targetTab)}
                data-testid="omni-comms-readiness-fix-action"
              >
                Go to {CHANNEL_SECTION_TAB_LABELS[targetTab]}
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Every readiness check has passed. Real delivery still requires an
            approved and active release.
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default EmailReadinessSummary;
