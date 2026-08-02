/**
 * Omni-Comms — provider test delivery card (Email / Resend).
 *
 * This is the ONLY administration control that can cause a real provider send,
 * and it is deliberately narrow:
 *
 *   - it requires a CURRENT passed configuration preflight for the selected
 *     binding and the SAME recipient;
 *   - the recipient must be on the operator-approved technical test list;
 *   - controlled test delivery must be explicitly switched on for the scope;
 *   - it never uses the sendCommunication façade, never creates an Omni-Comms
 *     request, message, dispatch job or delivery attempt, and never enables
 *     live delivery.
 *
 * Every one of those conditions is re-checked in the database; this screen only
 * mirrors them so the operator can see why the action is unavailable.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, MailCheck, RefreshCw, Send } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import type { OmniCommsRpcClient } from '@/platform/omni-comms/application/omniCommsRpcErrors';
import {
  getChannelTestDeliveryDiagnostics,
  runChannelTestDelivery,
  setChannelTestDeliveryApproval,
  type ChannelTestDeliveryTransport,
} from '@/platform/omni-comms/application/channelTestDeliveryService';
import {
  CONTROLLED_DELIVERY_NOTICE,
  DELIVERY_STATUS_LABEL,
  deliveryOutcome,
  isApprovalActive,
  isDeliveryRetryable,
  latestDelivery,
  MAX_APPROVED_TEST_RECIPIENTS,
  MAX_DELIVERY_ATTEMPTS,
  type ChannelTestDelivery,
  type ChannelTestDeliveryDiagnostics,
} from '@/platform/omni-comms/application/channelTestDeliveryTypes';
import type {
  ChannelTestRun,
  TestCentreChannel,
} from '@/platform/omni-comms/application/channelTestCentreTypes';
import { Detail, Field, toastError } from './channelFormPrimitives';

export const DELIVERY_SAFETY_BULLETS: readonly string[] = [
  'One real technical email is sent to an approved test address only.',
  'The subject and body must be the exact content that passed the preflight.',
  'The live sending path is not used and live delivery stays switched off.',
  'The provider credential never reaches the browser.',
  'Each attempt carries a persistent provider idempotency key, so a retry '
  + 'cannot produce a second send.',
  'Recipient, sender, every attempt, the provider outcome and callbacks are '
  + 'recorded permanently.',
] as const;

export function newDeliveryIdempotencyKey(): string {
  const rand = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `test-delivery-${rand}`.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 128);
}

/** Mirrors the database gate so the operator sees the blocking reason. */
export function deliveryBlockReason(input: {
  canConfigure: boolean;
  canExecute?: boolean;
  approvalEnabled: boolean;
  approvalActive?: boolean;
  approvedRecipients: readonly string[];
  target: string;
  run: ChannelTestRun | null;
  runIsCurrent: boolean;
  attemptsExhausted?: boolean;
}): string | null {
  if (input.canExecute === false) {
    return 'You do not have the Omni-Comms operate capability.';
  }
  if (!input.canConfigure) return 'You do not have the Omni-Comms configure capability.';
  if (!input.run) return 'Run a configuration preflight for this binding first.';
  if (input.run.status !== 'passed') return 'The latest configuration preflight did not pass.';
  if (!input.runIsCurrent) return 'The configuration changed — run the preflight again.';
  if (!input.approvalEnabled) return 'Provider test delivery is not approved for this scope.';
  if (input.approvalActive === false) {
    return 'The provider test delivery approval has expired — approve it again.';
  }
  const target = input.target.trim().toLowerCase();
  if (!target) return 'Enter the approved test address used for the preflight.';
  if (!input.approvedRecipients.some((r) => r.toLowerCase() === target)) {
    return 'This address is not on the approved technical test list.';
  }
  if (input.attemptsExhausted) {
    return `This delivery has used all ${MAX_DELIVERY_ATTEMPTS} permitted provider attempts.`;
  }
  return null;
}

const DeliveryEvidence: React.FC<{ delivery: ChannelTestDelivery }> = ({ delivery }) => {
  const outcome = deliveryOutcome(delivery);
  return (
    <div className="space-y-3" data-testid="omni-comms-test-delivery-result">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={delivery.status === 'accepted' ? 'default' : 'destructive'}>
          {DELIVERY_STATUS_LABEL[delivery.status]}
        </Badge>
        {delivery.result_code ? <Badge variant="outline">{delivery.result_code}</Badge> : null}
        {outcome ? <Badge variant="secondary">callback: {outcome}</Badge> : null}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Detail label="Recipient" value={delivery.target_masked} />
        <Detail label="From" value={delivery.from_address ?? '—'} />
        <Detail label="Provider" value={delivery.provider_code ?? '—'} />
        <Detail label="Provider message" value={delivery.provider_message_id ?? '—'} mono />
        <Detail label="Provider status" value={String(delivery.provider_status_code ?? '—')} />
        <Detail label="Requested" value={new Date(delivery.requested_at).toLocaleString()} />
        <Detail
          label="Completed"
          value={delivery.completed_at ? new Date(delivery.completed_at).toLocaleString() : '—'}
        />
        <Detail label="Error" value={delivery.error_code ?? '—'} />
      </div>
      {delivery.error_detail ? (
        <p className="text-xs text-destructive">{delivery.error_detail}</p>
      ) : null}
      <div>
        <p className="text-xs font-medium uppercase text-muted-foreground mb-1">
          Provider attempts
        </p>
        {(delivery.attempts ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">No provider attempt recorded.</p>
        ) : (
          <ul className="space-y-1">
            {(delivery.attempts ?? []).map((a) => (
              <li key={a.id} className="text-xs" data-testid="omni-comms-test-delivery-attempt">
                <Badge variant="outline" className="mr-2">#{a.attempt_number}</Badge>
                {a.state}
                {a.provider_status_code ? ` · HTTP ${a.provider_status_code}` : ''}
                {a.error_code ? ` · ${a.error_code}` : ''}
                {' · '}
                {new Date(a.started_at).toLocaleString()}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="text-xs font-medium uppercase text-muted-foreground mb-1">
          Provider callbacks
        </p>
        {delivery.events.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No provider callback received yet for this delivery.
          </p>
        ) : (
          <ul className="space-y-1">
            {delivery.events.map((e) => (
              <li key={e.id} className="text-xs" data-testid="omni-comms-test-delivery-event">
                <Badge variant="outline" className="mr-2">{e.event_type}</Badge>
                {new Date(e.occurred_at ?? e.received_at).toLocaleString()}
                {e.signature_verified ? ' · signature verified' : ' · signature unverified'}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export const ChannelTestDeliveryCard: React.FC<{
  client: OmniCommsRpcClient;
  transport: ChannelTestDeliveryTransport;
  orgId: string;
  departmentId?: string | null;
  channel: TestCentreChannel;
  bindingId: string;
  target: string;
  /** C5B — must be the exact content that passed the preflight. */
  subject?: string;
  bodyText?: string;
  run: ChannelTestRun | null;
  runIsCurrent: boolean;
  configurationFingerprint?: string | null;
  onChanged?: () => void;
}> = ({
  client, transport, orgId, departmentId, channel, bindingId, target, run,
  subject = '', bodyText = '', runIsCurrent, onChanged,
}) => {
  const [diagnostics, setDiagnostics] = useState<ChannelTestDeliveryDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recipientsText, setRecipientsText] = useState('');
  const [approvalEnabled, setApprovalEnabled] = useState(false);
  const [expiresInHours, setExpiresInHours] = useState('4');
  const [maxDeliveries, setMaxDeliveries] = useState('5');
  const [minIntervalSeconds, setMinIntervalSeconds] = useState('60');
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => newDeliveryIdempotencyKey());
  const [lastDelivery, setLastDelivery] = useState<ChannelTestDelivery | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getChannelTestDeliveryDiagnostics(
        client, orgId, channel, departmentId ?? null, bindingId || null,
      );
      setDiagnostics(d);
      setApprovalEnabled(d.controlled_test_delivery_enabled);
      setRecipientsText(d.controlled_test_recipients.join(', '));
      if (typeof d.controlled_test_max_deliveries === 'number') {
        setMaxDeliveries(String(d.controlled_test_max_deliveries));
      }
      if (typeof d.controlled_test_min_interval_seconds === 'number') {
        setMinIntervalSeconds(String(d.controlled_test_min_interval_seconds));
      }
    } catch (e) {
      toastError(e, 'Failed to load provider test delivery status');
    } finally {
      setLoading(false);
    }
  }, [client, orgId, channel, departmentId, bindingId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const approvedRecipients = diagnostics?.controlled_test_recipients ?? [];
  const canConfigure = diagnostics?.can_configure ?? false;

  const blockReason = useMemo(
    () => deliveryBlockReason({
      canConfigure,
      approvalEnabled: diagnostics?.controlled_test_delivery_enabled ?? false,
      approvedRecipients,
      target,
      run,
      runIsCurrent,
    }),
    [canConfigure, diagnostics, approvedRecipients, target, run, runIsCurrent],
  );

  const onSaveApproval = useCallback(async () => {
    setSaving(true);
    try {
      const recipients = recipientsText
        .split(/[,\n;]/)
        .map((r) => r.trim().toLowerCase())
        .filter((r) => r !== '');
      const res = await setChannelTestDeliveryApproval(client, {
        organizationId: orgId,
        departmentId: departmentId ?? null,
        channel,
        enabled: approvalEnabled,
        recipients,
      });
      toast.success(
        res.controlled_test_delivery_enabled
          ? 'Provider test delivery approved for the listed addresses.'
          : 'Provider test delivery approval withdrawn.',
      );
      await refresh();
      onChanged?.();
    } catch (e) {
      toastError(e, 'Approval could not be saved');
    } finally {
      setSaving(false);
    }
  }, [client, orgId, departmentId, channel, approvalEnabled, recipientsText, refresh, onChanged]);

  const onSend = useCallback(async () => {
    if (!run) return;
    setSending(true);
    try {
      const res = await runChannelTestDelivery(transport, {
        testRunId: run.id,
        target,
        idempotencyKey,
        subject,
      });
      setLastDelivery(res.delivery);
      toast.success(
        res.replayed && !res.dispatched
          ? 'Existing delivery evidence returned — nothing was sent again.'
          : res.delivery?.status === 'accepted'
            ? 'The provider accepted the technical test message.'
            : 'The provider did not accept the test message. See the evidence below.',
      );
      await refresh();
      onChanged?.();
    } catch (e) {
      toastError(e, 'Test delivery could not be completed');
      await refresh();
    } finally {
      setSending(false);
    }
  }, [transport, run, target, idempotencyKey, subject, refresh, onChanged]);

  const current = lastDelivery ?? latestDelivery(diagnostics, bindingId);

  return (
    <Card data-testid="omni-comms-test-delivery">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <MailCheck className="h-4 w-4" /> Provider test delivery
          <Badge variant={diagnostics?.controlled_test_delivery_enabled ? 'default' : 'secondary'}>
            {diagnostics?.controlled_test_delivery_enabled ? 'approved' : 'not approved'}
          </Badge>
          <Badge variant="outline">
            live delivery {diagnostics?.live_delivery_enabled ? 'enabled' : 'disabled'}
          </Badge>
        </CardTitle>
        <CardDescription>{CONTROLLED_DELIVERY_NOTICE}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="list-disc pl-5 space-y-1 text-xs text-muted-foreground">
          {DELIVERY_SAFETY_BULLETS.map((b) => <li key={b}>{b}</li>)}
        </ul>

        <div className="rounded-md border p-3 space-y-3" data-testid="omni-comms-test-delivery-approval">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Approve provider test delivery</p>
              <p className="text-xs text-muted-foreground">
                Up to {MAX_APPROVED_TEST_RECIPIENTS} technical test addresses. Approval never
                enables live delivery.
              </p>
            </div>
            <Switch
              checked={approvalEnabled}
              onCheckedChange={setApprovalEnabled}
              disabled={!canConfigure || saving}
              aria-label="Approve provider test delivery"
            />
          </div>
          <Field
            label="Approved test addresses (comma separated)"
            value={recipientsText}
            onChange={setRecipientsText}
            placeholder="qa.mailbox@example.com"
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void onSaveApproval()}
            disabled={!canConfigure || saving}
          >
            {saving ? 'Saving…' : 'Save approval'}
          </Button>
        </div>

        <Field
          label="Test message subject"
          value={subject}
          onChange={setSubject}
          placeholder="Omni-Comms channel test"
        />
        <p className="text-xs text-muted-foreground">
          The subject is prefixed with [TEST] and the body states plainly that the
          message is a technical test with no personal or case information.
        </p>

        <div className="text-xs text-muted-foreground" data-testid="omni-comms-test-delivery-idempotency">
          Delivery key: <span className="font-mono">{idempotencyKey}</span>
          {' — retrying the same delivery returns the existing evidence without sending again.'}
        </div>

        {blockReason ? (
          <Alert variant="destructive" data-testid="omni-comms-test-delivery-blocked">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Test delivery unavailable</AlertTitle>
            <AlertDescription>{blockReason}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => void onSend()}
            disabled={Boolean(blockReason) || sending || loading}
            data-testid="omni-comms-test-delivery-send"
          >
            <Send className="h-4 w-4 mr-1" />
            {sending ? 'Sending test message…' : 'Send provider test message'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => { setIdempotencyKey(newDeliveryIdempotencyKey()); setLastDelivery(null); }}
            disabled={sending}
          >
            New delivery
          </Button>
          <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {current ? (
          <DeliveryEvidence delivery={current} />
        ) : (
          <p className="text-sm text-muted-foreground">
            No provider test delivery has been attempted for this binding.
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default ChannelTestDeliveryCard;
