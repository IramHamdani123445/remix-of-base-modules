/**
 * Omni-Comms — the plain "Send test Email" card.
 *
 * The operator supplies a recipient and presses one button. The SERVER resolves
 * the provider, the binding, the sender, the domain, the configuration
 * preflight and callback readiness. The browser shows none of that: no binding
 * selector, no idempotency key, no fingerprint, no correlation ID, no internal
 * check codes.
 *
 * Testing is an ACTION, not a persistent setting, so this card offers a button
 * and never a "Testing ON/OFF" switch.
 *
 * Boundaries: uses the existing technical test contracts only. It never uses
 * the sendCommunication façade, never creates a business request and never
 * touches live delivery or release state.
 */
import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Send } from 'lucide-react';
import type { OmniCommsRpcClient } from '@/platform/omni-comms/application/omniCommsRpcErrors';
import { runChannelTestPreflight } from '@/platform/omni-comms/application/channelTestCentreService';
import {
  runChannelTestDelivery,
  setChannelTestDeliveryApproval,
} from '@/platform/omni-comms/application/channelTestDeliveryService';
import type { ChannelTestDeliveryTransport } from '@/platform/omni-comms/application/channelTestDeliveryService';
import type { TestCentreChannel } from '@/platform/omni-comms/application/channelTestCentreTypes';

export type SimpleTestState =
  | 'idle'
  | 'sending'
  | 'accepted'
  | 'delivered'
  | 'delivery_pending'
  | 'failed';

/** Plain result words. Never a provider status code. */
export const SIMPLE_TEST_RESULT_LABEL: Record<SimpleTestState, string> = {
  idle: '',
  sending: 'Sending',
  accepted: 'Accepted',
  delivered: 'Delivered',
  delivery_pending: 'Delivery pending',
  failed: 'Failed',
};

const describeTestProblem = (error: unknown): string => {
  const detail = error instanceof Error ? error.message : '';
  if (detail.includes('invalid_idempotency_key')) {
    return 'The test request could not be validated. Refresh the page and try again.';
  }
  if (detail.includes('permission_denied')) {
    return 'Your current role does not allow test delivery.';
  }
  if (detail.includes('credential_missing')) {
    return 'The Email provider credential is not available. Open Settings to repair it.';
  }
  if (detail.includes('from_address_missing')) {
    return 'The sender address is missing. Open Settings to select a sender.';
  }
  return 'The test message could not be sent. Open Technical details for the full evidence.';
};

const maskRecipient = (value: string): string => {
  const at = value.indexOf('@');
  if (at <= 0) return '***';
  return `${value[0]}***${value.slice(at)}`;
};

export interface SimpleTestDeliveryCardProps {
  client: OmniCommsRpcClient;
  transport: ChannelTestDeliveryTransport;
  organizationId: string;
  departmentId: string | null;
  channel: TestCentreChannel;
  channelLabel: string;
  /** Server-selected binding. The operator never chooses one. */
  bindingId: string | null;
  canExecute: boolean;
}

export const SimpleTestDeliveryCard: React.FC<SimpleTestDeliveryCardProps> = ({
  client,
  transport,
  organizationId,
  departmentId,
  channel,
  channelLabel,
  bindingId,
  canExecute,
}) => {
  const [recipient, setRecipient] = React.useState('');
  const [state, setState] = React.useState<SimpleTestState>('idle');
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [sentAt, setSentAt] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);

  const send = React.useCallback(async () => {
    const target = recipient.trim();
    if (!target || !bindingId) return;
    setState('sending');
    setProblem(null);
    try {
      // The zero-send configuration preflight authorises the attempt. Its
      // internal identifiers stay inside this function and are never rendered.
      // The database contract permits letters, numbers, dot, underscore,
      // colon and hyphen only. Keep this key valid while retaining tenant and
      // attempt uniqueness.
      const key = `simple-test:${organizationId}:${Date.now()}`;
      const preflight = await runChannelTestPreflight(client, {
        organizationId,
        departmentId,
        channel,
        bindingId,
        target,
        payload: {
          subject: `${channelLabel} configuration test`,
          bodyText: 'This is a configuration test message from the Communication Hub.',
        },
        idempotencyKey: key,
      });
      if (preflight.run.status !== 'passed') {
        setState('failed');
        setProblem('The configuration check did not pass. Open Settings to fix the setup.');
        return;
      }
      // The operator typed the recipient, so the browser authorises exactly
      // that one address for a single bounded delivery. The server still owns
      // every safety decision.
      await setChannelTestDeliveryApproval(client, {
        organizationId,
        departmentId,
        channel,
        enabled: true,
        recipients: [target],
        expiresInHours: 1,
        maxDeliveries: 1,
        minIntervalSeconds: 30,
      });
      const result = await runChannelTestDelivery(transport, {
        testRunId: preflight.run.id,
        target,
        idempotencyKey: key,
        subject: `${channelLabel} configuration test`,
        bodyText: 'This is a configuration test message from the Communication Hub.',
      });
      const delivery = result.delivery;
      setSentTo(delivery?.target_masked ?? maskRecipient(target));
      setSentAt(new Date().toLocaleString());
      if (delivery?.status === 'accepted') setState('accepted');
      else if (delivery?.status === 'failed') {
        setState('failed');
        setProblem('The provider rejected the test message.');
      } else setState('delivery_pending');
    } catch (e) {
      setState('failed');
      setProblem(describeTestProblem(e));
    }
  }, [
    recipient, bindingId, organizationId, departmentId, channel, channelLabel, client, transport,
  ]);

  const busy = state === 'sending';
  const finished = state === 'accepted' || state === 'delivered'
    || state === 'delivery_pending' || state === 'failed';

  return (
    <Card data-testid="omni-comms-simple-test-card">
      <CardHeader>
        <CardTitle className="text-base">Test {channelLabel}</CardTitle>
        <CardDescription>
          Send one test message to an address you choose. Nothing about a real
          business transaction is sent.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!finished || state === 'failed' ? (
          <div className="space-y-2">
            <Label htmlFor="omni-comms-simple-test-recipient">Recipient</Label>
            <Input
              id="omni-comms-simple-test-recipient"
              value={recipient}
              disabled={busy}
              placeholder="name@example.com"
              onChange={(e) => setRecipient(e.target.value)}
            />
          </div>
        ) : null}

        {finished && state !== 'failed' ? (
          <div className="space-y-1" data-testid="omni-comms-simple-test-result">
            <div className="flex items-center gap-2">
              <Badge variant={state === 'delivered' ? 'default' : 'secondary'}>
                {SIMPLE_TEST_RESULT_LABEL[state]}
              </Badge>
              <span className="text-sm font-medium">
                {state === 'delivered'
                  ? 'Delivered successfully'
                  : state === 'accepted'
                    ? 'Accepted by the provider'
                    : 'Waiting for the delivery result'}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">to {sentTo}</p>
            <p className="text-sm text-muted-foreground">{sentAt}</p>
          </div>
        ) : null}

        {state === 'failed' && problem ? (
          <Alert variant="destructive">
            <AlertTitle>{SIMPLE_TEST_RESULT_LABEL.failed}</AlertTitle>
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        ) : null}

        {!canExecute || !bindingId ? (
          <p className="text-sm text-muted-foreground">
            {canExecute
              ? 'Delivery routing is not ready yet, so a test cannot be sent.'
              : 'You do not have permission to send a test message.'}
          </p>
        ) : null}

        <Button
          onClick={() => void send()}
          disabled={busy || !canExecute || !bindingId || recipient.trim().length === 0}
          data-testid="omni-comms-simple-test-send"
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          {finished && state !== 'failed' ? 'Send another test' : `Send test ${channelLabel}`}
        </Button>
      </CardContent>
    </Card>
  );
};

export default SimpleTestDeliveryCard;
