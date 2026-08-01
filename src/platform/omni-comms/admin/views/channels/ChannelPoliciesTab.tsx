/**
 * Omni-Comms C1 — channel Policies tab.
 *
 * Email preserves the existing channel-setting mutation exactly. The live
 * delivery flag is a configuration flag only: provider dispatch is not
 * implemented anywhere in this build.
 */
import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import type { useOmniCommsRpcClient } from '../../hooks/useOmniCommsRpcClient';
import { upsertEmailChannelSetting } from '@/platform/omni-comms/application/channelManagementService';
import type { EmailConfigSummary } from '@/platform/omni-comms/application/channelManagementTypes';
import { DeferredCapabilityCard, Field, toastError } from './channelFormPrimitives';
import type { ChannelUiDefinition } from './channelUiRegistry';

type Client = ReturnType<typeof useOmniCommsRpcClient>;

export const POLICY_HELPER_TEXT =
  'Configuration flag only. Provider dispatch is not implemented.';

export const ChannelPoliciesTab: React.FC<{
  definition: ChannelUiDefinition;
  client: Client;
  orgId: string;
  summary: EmailConfigSummary | null;
  onChanged: () => Promise<void> | void;
}> = ({ definition, client, orgId, summary, onChanged }) => {
  if (definition.code !== 'email') {
    return (
      <DeferredCapabilityCard
        testId="omni-comms-policies-empty-state"
        title={`${definition.name} policies`}
        description="Planned policy fields. Nothing on this tab is saved in C1."
        bullets={definition.policies}
        footer="No policy columns are created in C1."
      />
    );
  }
  return <EmailPoliciesPanel client={client} orgId={orgId} summary={summary} onChanged={onChanged} />;
};

const EmailPoliciesPanel: React.FC<{
  client: Client;
  orgId: string;
  summary: EmailConfigSummary | null;
  onChanged: () => Promise<void> | void;
}> = ({ client, orgId, summary, onChanged }) => {
  const existing = summary?.channel_setting ?? null;
  const [enabled, setEnabled] = useState(existing?.enabled ?? false);
  const [live, setLive] = useState(existing?.live_delivery_enabled ?? false);
  const [rate, setRate] = useState<string>(existing?.per_minute_limit?.toString() ?? '');
  const [quietStart, setQuietStart] = useState<string>(existing?.quiet_hours_start ?? '');
  const [quietEnd, setQuietEnd] = useState<string>(existing?.quiet_hours_end ?? '');
  const [tz, setTz] = useState<string>(existing?.quiet_hours_timezone ?? 'America/St_Kitts');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEnabled(existing?.enabled ?? false);
    setLive(existing?.live_delivery_enabled ?? false);
    setRate(existing?.per_minute_limit?.toString() ?? '');
    setQuietStart(existing?.quiet_hours_start ?? '');
    setQuietEnd(existing?.quiet_hours_end ?? '');
    setTz(existing?.quiet_hours_timezone ?? 'America/St_Kitts');
  }, [existing?.id, existing]);

  const save = async () => {
    setBusy(true);
    try {
      const parsedRate = rate.trim() === '' ? null : Number.parseInt(rate, 10);
      await upsertEmailChannelSetting(client, {
        id: existing?.id ?? null,
        expectedUpdatedAt: existing?.updated_at ?? null,
        organizationId: orgId,
        departmentId: null,
        enabled,
        liveDeliveryEnabled: live,
        quietHoursStart: quietStart || null,
        quietHoursEnd: quietEnd || null,
        quietHoursTimezone: quietStart ? tz : null,
        perMinuteLimit: parsedRate && Number.isFinite(parsedRate) ? parsedRate : null,
      });
      toast.success('Email channel settings saved');
      await onChanged();
    } catch (e) { toastError(e, 'Save failed'); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email channel policies (organisation)</CardTitle>
        <CardDescription>{POLICY_HELPER_TEXT}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          <Label>Channel enabled</Label>
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={live} onCheckedChange={setLive} disabled={!enabled} />
          <Label>Live delivery enabled — unavailable, governed elsewhere</Label>
        </div>
        <p className="text-xs text-muted-foreground">{POLICY_HELPER_TEXT}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Per-minute limit" value={rate} onChange={setRate} placeholder="e.g. 120" />
          <Field label="Timezone" value={tz} onChange={setTz} />
          <Field label="Quiet hours start (HH:MM)" value={quietStart} onChange={setQuietStart} />
          <Field label="Quiet hours end (HH:MM)" value={quietEnd} onChange={setQuietEnd} />
        </div>
        <Button disabled={busy} onClick={save}>Save settings</Button>
      </CardContent>
    </Card>
  );
};

export default ChannelPoliciesTab;
