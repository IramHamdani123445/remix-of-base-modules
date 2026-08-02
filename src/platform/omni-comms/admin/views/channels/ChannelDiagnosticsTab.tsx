/**
 * Omni-Comms — channel delivery diagnostics.
 *
 * Read-only evidence for the ONE narrow path that can reach a provider: the
 * approved technical test delivery. Nothing on this screen sends anything, and
 * the live sending path is not represented here because it is not enabled.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { OmniCommsRpcClient } from '@/platform/omni-comms/application/omniCommsRpcErrors';
import { getChannelTestDeliveryDiagnostics } from '@/platform/omni-comms/application/channelTestDeliveryService';
import {
  DELIVERY_STATUS_LABEL,
  deliveryOutcome,
  type ChannelTestDeliveryDiagnostics,
} from '@/platform/omni-comms/application/channelTestDeliveryTypes';
import { isTestCentreChannel, type TestCentreChannel } from '@/platform/omni-comms/application/channelTestCentreTypes';
import { DeferredCapabilityCard, toastError } from './channelFormPrimitives';
import type { ChannelUiDefinition } from './channelUiRegistry';

export const DIAGNOSTICS_EVIDENCE: readonly string[] = [
  'Provider dispatch attempt and provider reference',
  'Provider callback and delivery status events',
  'Technical delivery result and failure category',
  'Latency and retry history',
  'Credential and identity verification history',
];

export const DIAGNOSTICS_NOTICE =
  'Delivery diagnostics cover approved technical test deliveries only. A '
  + 'passed configuration preflight is not proof of delivery, and nothing on '
  + 'this screen sends a message or changes configuration.';

export const ChannelDiagnosticsTab: React.FC<{
  definition: ChannelUiDefinition;
  client?: OmniCommsRpcClient;
  orgId?: string | null;
  departmentId?: string | null;
}> = ({ definition, client, orgId, departmentId }) => {
  const channel = definition.code;
  const supported = isTestCentreChannel(channel) && Boolean(client) && Boolean(orgId);

  const [data, setData] = useState<ChannelTestDeliveryDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!client || !orgId || !supported) return;
    setLoading(true);
    try {
      setData(await getChannelTestDeliveryDiagnostics(
        client, orgId, channel as TestCentreChannel, departmentId ?? null, null, 50,
      ));
    } catch (e) {
      toastError(e, 'Failed to load delivery diagnostics');
    } finally {
      setLoading(false);
    }
  }, [client, orgId, departmentId, channel, supported]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!supported) {
    return (
      <DeferredCapabilityCard
        testId="omni-comms-diagnostics"
        title={`${definition.name} diagnostics`}
        description={DIAGNOSTICS_NOTICE}
        bullets={DIAGNOSTICS_EVIDENCE}
        footer="Delivery diagnostics are unavailable for this channel or scope."
      />
    );
  }

  const rows = data?.deliveries ?? [];

  return (
    <Card data-testid="omni-comms-diagnostics">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {definition.name} delivery diagnostics
          <Badge variant="outline">
            live delivery {data?.live_delivery_enabled ? 'enabled' : 'disabled'}
          </Badge>
          <Badge variant={data?.controlled_test_delivery_enabled ? 'default' : 'secondary'}>
            test delivery {data?.controlled_test_delivery_enabled ? 'approved' : 'not approved'}
          </Badge>
        </CardTitle>
        <CardDescription>{DIAGNOSTICS_NOTICE}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No provider test delivery has been recorded for this channel and scope.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="p-2">Result</th>
                  <th className="p-2">Recipient</th>
                  <th className="p-2">From</th>
                  <th className="p-2">Provider reference</th>
                  <th className="p-2">Provider status</th>
                  <th className="p-2">Callback</th>
                  <th className="p-2">Requested</th>
                  <th className="p-2">Completed</th>
                  <th className="p-2">Failure</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className="border-t align-top" data-testid="omni-comms-diagnostics-row">
                    <td className="p-2">
                      <Badge variant={d.status === 'accepted' ? 'default' : 'destructive'}>
                        {DELIVERY_STATUS_LABEL[d.status]}
                      </Badge>
                    </td>
                    <td className="p-2 font-mono text-xs">{d.target_masked}</td>
                    <td className="p-2 text-xs">{d.from_address ?? '—'}</td>
                    <td className="p-2 font-mono text-xs">{d.provider_message_id ?? '—'}</td>
                    <td className="p-2 text-xs">{d.provider_status_code ?? '—'}</td>
                    <td className="p-2 text-xs">{deliveryOutcome(d) ?? 'none received'}</td>
                    <td className="p-2 text-xs">{new Date(d.requested_at).toLocaleString()}</td>
                    <td className="p-2 text-xs">
                      {d.completed_at ? new Date(d.completed_at).toLocaleString() : '—'}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {d.error_code ? `${d.error_code}${d.error_detail ? ` — ${d.error_detail}` : ''}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ChannelDiagnosticsTab;
