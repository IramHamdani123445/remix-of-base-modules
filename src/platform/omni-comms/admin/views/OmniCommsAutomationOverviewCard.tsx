/**
 * Omni-Comms Overview — compact automation status card.
 *
 * Deliberately NOT a second automation dashboard: it shows the headline
 * status and links to the single canonical surface, Activity & Automation.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { automationHealthLabel } from '@/platform/omni-comms/application/automationStatusService';
import { useAutomationStatus } from '../hooks/useAutomationStatus';
import { formatMoment } from './channels/simple/ChannelActivitySummary';

export const OMNI_COMMS_ACTIVITY_ROUTE = '/admin/omnichannel-communications/operations';

export const OmniCommsAutomationOverviewCard: React.FC<{
  organizationId: string | null;
}> = ({ organizationId }) => {
  const { status } = useAutomationStatus(organizationId, Boolean(organizationId));

  const healthy =
    status != null &&
    status.business_event_processor.healthy &&
    status.delivery_processor.healthy;

  return (
    <Card data-testid="omni-comms-overview-automation">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Automatic processing</CardTitle>
          <Badge variant={healthy ? 'default' : 'secondary'}>
            {status ? automationHealthLabel(healthy) : 'Unavailable'}
          </Badge>
        </div>
        <CardDescription>
          Business events and Email delivery run automatically every minute.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid gap-1 sm:grid-cols-3">
          <p>
            Events waiting:{' '}
            <strong data-testid="omni-comms-overview-events-waiting">
              {status?.business_event_processor.pending_events ?? 0}
            </strong>
          </p>
          <p>
            Emails waiting:{' '}
            <strong data-testid="omni-comms-overview-emails-waiting">
              {status?.delivery_processor.waiting_jobs ?? 0}
            </strong>
          </p>
          <p>
            Last delivered:{' '}
            <strong>{formatMoment(status?.delivery_processor.last_delivered_at ?? null)}</strong>
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to={OMNI_COMMS_ACTIVITY_ROUTE}>View activity &amp; automation</Link>
        </Button>
      </CardContent>
    </Card>
  );
};

export default OmniCommsAutomationOverviewCard;
