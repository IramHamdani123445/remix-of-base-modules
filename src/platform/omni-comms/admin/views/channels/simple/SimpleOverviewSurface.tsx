/**
 * Omni-Comms — the normal Overview.
 *
 * One switch, six read-only health rows, three counters, one test action and
 * the business events this channel covers. No readiness counters ("11/11",
 * "3/3", "7/7"), no prerequisite dumps, no authorisation vocabulary and at most
 * ONE actionable blocker.
 *
 * Read-only by construction: nothing here mutates unless a human moves the
 * delivery switch.
 */
import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ShieldAlert } from 'lucide-react';
import type { OmniCommsGenericTab } from '@/platform/omni-comms/domain/channelCatalogue';
import type { DeliveryToggleSnapshot } from '@/platform/omni-comms/application/deliveryToggleService';
import { tabForHealthIndicator } from '../../../navigation/channelSimpleSections';
import { ChannelDeliverySwitch } from './ChannelDeliverySwitch';
import { ReadOnlyHealthSwitch } from './ReadOnlyHealthSwitch';
import { BusinessEventDeliverySwitch } from './BusinessEventDeliverySwitch';
import { formatMoment } from './ChannelActivitySummary';

/** Operator-facing health row labels, in the order the operator reads them. */
export const HEALTH_ROW_ORDER: readonly string[] = [
  'provider',
  'sender_domain',
  'events_templates',
  'dispatcher',
  'callbacks',
  'safety',
];

export const HEALTH_ROW_LABEL: Record<string, string> = {
  provider: 'Provider',
  sender_domain: 'Sender & domain',
  events_templates: 'Events & templates',
  dispatcher: 'Automatic dispatcher',
  callbacks: 'Callbacks',
  safety: 'Safety',
};

/** Configuration rows read "Ready"; operational rows read "Healthy". */
const HEALTHY_WORD_ROWS = new Set(['dispatcher', 'callbacks', 'safety']);

/** ONE plain sentence per unhealthy row. Never a raw prerequisite code. */
export const HEALTH_ROW_PROBLEM: Record<string, string> = {
  provider: 'Email provider needs attention.',
  sender_domain: 'Sending domain needs verification.',
  events_templates: 'Claim Submitted Email is not configured.',
  dispatcher: 'Automatic delivery service is not running.',
  callbacks: 'Delivery result tracking needs attention.',
  safety: 'Sending limits need attention.',
};

export interface SimpleOverviewSurfaceProps {
  channelLabel: string;
  moduleLabel: string | null;
  snapshot: DeliveryToggleSnapshot | null;
  loading: boolean;
  busy: boolean;
  onToggleDelivery: (next: boolean) => void;
  onFix: (tab: OmniCommsGenericTab) => void;
  /** The plain test card. Composed by the coordinator. */
  testCard: React.ReactNode;
  /** Technical details trigger + drawer. Composed by the coordinator. */
  technicalDetails: React.ReactNode;
}

export const SimpleOverviewSurface: React.FC<SimpleOverviewSurfaceProps> = ({
  channelLabel,
  moduleLabel,
  snapshot,
  loading,
  busy,
  onToggleDelivery,
  onFix,
  testCard,
  technicalDetails,
}) => {
  const indicatorByKey = new Map(
    (snapshot?.indicators ?? []).map((i) => [i.key, i.ready] as const),
  );
  const rows = HEALTH_ROW_ORDER.filter((key) => indicatorByKey.has(key));
  const firstProblem = rows.find((key) => indicatorByKey.get(key) !== true) ?? null;
  const events = snapshot?.permittedEventCodes ?? [];

  return (
    <div className="space-y-6" data-testid="omni-comms-simple-overview">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{channelLabel}</CardTitle>
          <CardDescription>{moduleLabel ?? 'Business communications'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <ChannelDeliverySwitch
            label={`Automatic ${channelLabel} delivery`}
            snapshot={snapshot}
            loading={loading}
            busy={busy}
            onChange={onToggleDelivery}
          />

          {loading && !snapshot ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="space-y-2" data-testid="omni-comms-health-rows">
              {rows.map((key) => {
                const ready = indicatorByKey.get(key) === true;
                return (
                  <ReadOnlyHealthSwitch
                    key={key}
                    indicatorKey={key}
                    label={HEALTH_ROW_LABEL[key] ?? key}
                    ready={ready}
                    statusWord={
                      ready
                        ? (HEALTHY_WORD_ROWS.has(key) ? 'Healthy' : 'Ready')
                        : 'Needs attention'
                    }
                    onFix={(k) => onFix(tabForHealthIndicator(k))}
                  />
                );
              })}
            </div>
          )}

          {firstProblem ? (
            <Alert variant="destructive" data-testid="omni-comms-simple-blocker">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>{HEALTH_ROW_PROBLEM[firstProblem] ?? 'Needs attention.'}</AlertTitle>
              <AlertDescription className="mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onFix(tabForHealthIndicator(firstProblem))}
                  data-testid="omni-comms-simple-blocker-fix"
                >
                  Fix
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <div className="text-sm text-muted-foreground">Waiting to send</div>
              <div className="text-lg font-medium" data-testid="omni-comms-waiting-count">
                {snapshot ? snapshot.evidence.queueDepth : '—'}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Last accepted</div>
              <div className="text-lg font-medium">
                {formatMoment(snapshot?.evidence.lastAcceptedAt ?? null)}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Last delivered</div>
              <div className="text-lg font-medium">
                {formatMoment(snapshot?.evidence.lastDeliveredAt ?? null)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {testCard}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Business events</CardTitle>
          <CardDescription>
            The business moments that send {channelLabel} automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No business event is configured to send {channelLabel} yet.
            </p>
          ) : (
            events.map((code) => (
              <BusinessEventDeliverySwitch
                key={code}
                eventCode={code}
                channelLabel={channelLabel}
                enabled={snapshot?.state === 'on'}
              />
            ))
          )}
        </CardContent>
      </Card>

      <div>{technicalDetails}</div>
    </div>
  );
};

export default SimpleOverviewSurface;
