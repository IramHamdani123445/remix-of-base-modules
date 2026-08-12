/**
 * Omni-Comms — the plain operator switch.
 *
 * One question, one control. No release-control vocabulary, no fingerprints,
 * no revisions. The server decides everything; this card only renders the
 * server's verdict and offers the single action that is legitimately available.
 */
import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, CircleDashed, Power, ShieldAlert } from 'lucide-react';
import {
  describeBlocker,
  INDICATOR_LABEL,
  STATE_EXPLANATION,
  STATE_LABEL,
  type DeliveryToggleSnapshot,
} from '@/platform/omni-comms/application/deliveryToggleService';

const formatMoment = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : 'Not yet';

export const DeliveryToggleCard: React.FC<{
  title: string;
  snapshot: DeliveryToggleSnapshot | null;
  busy?: boolean;
  onEnable: () => void;
  onDisable: () => void;
}> = ({ title, snapshot, busy, onEnable, onDisable }) => {
  const state = snapshot?.state ?? 'action_required';
  const on = state === 'on';
  const enableDisabled = busy
    || !snapshot?.canEnable
    || on
    || (state === 'awaiting_approval' && snapshot?.awaitingSelfApproval === true);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Power className="h-4 w-4" /> {title}
          </CardTitle>
          <CardDescription>
            Should this module send its configured business Email automatically?
          </CardDescription>
        </div>
        <Badge variant={on ? 'default' : state === 'action_required' ? 'destructive' : 'secondary'}>
          {STATE_LABEL[state]}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{STATE_EXPLANATION[state]}</p>

        {state === 'awaiting_approval' && snapshot?.awaitingSelfApproval && (
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>A second person must confirm</AlertTitle>
            <AlertDescription>
              You requested automatic sending. For safety, a different administrator
              has to turn the switch on to confirm it.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap gap-2">
          <Button onClick={onEnable} disabled={enableDisabled}>
            {state === 'awaiting_approval' ? 'Confirm and turn on' : 'Turn on'}
          </Button>
          <Button
            variant="outline"
            onClick={onDisable}
            disabled={busy || !snapshot?.canDisable}
          >
            Turn off
          </Button>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {(snapshot?.indicators ?? []).map((indicator) => (
            <div key={indicator.key} className="flex items-start gap-2 text-sm">
              {indicator.ready
                ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
                : <CircleDashed className="mt-0.5 h-4 w-4 text-muted-foreground" />}
              <span className={indicator.ready ? '' : 'text-muted-foreground'}>
                {INDICATOR_LABEL[indicator.key] ?? indicator.key}
              </span>
            </div>
          ))}
        </div>

        {(snapshot?.blockers.length ?? 0) > 0 && (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>What still has to be done</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-4">
                {snapshot?.blockers.map((code) => (
                  <li key={code}>{describeBlocker(code)}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <div className="font-medium">Waiting to be sent</div>
            <div className="text-muted-foreground">
              {snapshot?.evidence.queueDepth ?? 0} message(s)
            </div>
          </div>
          <div>
            <div className="font-medium">Last delivery confirmed</div>
            <div className="text-muted-foreground">
              {formatMoment(snapshot?.evidence.lastDeliveredAt ?? null)}
            </div>
          </div>
          <div>
            <div className="font-medium">Covered business events</div>
            <div className="text-muted-foreground">
              {(snapshot?.permittedEventCodes.length ?? 0) > 0
                ? snapshot?.permittedEventCodes.join(', ')
                : 'None configured'}
            </div>
          </div>
          <div>
            <div className="font-medium">Sending service last checked</div>
            <div className="text-muted-foreground">
              {formatMoment(snapshot?.evidence.schedulerLastRunAt ?? null)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
