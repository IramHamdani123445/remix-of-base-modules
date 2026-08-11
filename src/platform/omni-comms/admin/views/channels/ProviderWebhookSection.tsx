/**
 * Omni-Comms — provider webhook self-service (Email / Resend).
 *
 * Operators complete the whole callback setup here: copy the exact endpoint
 * URL, see which provider events to subscribe to, and save the signing secret
 * without ever leaving the admin UI.
 *
 * Boundaries (permanent):
 *   - The signing secret is write-only: browser → trusted Edge Function →
 *     encrypted vault. It is cleared from state after submission and is never
 *     read back or rendered.
 *   - No provider SDK import, no send behaviour, no direct table writes.
 */
import React from 'react';
import { Check, Copy, Loader2, RefreshCcw, Webhook } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import type { OmniCommsRpcClient } from '@/platform/omni-comms/application/omniCommsRpcErrors';
import {
  PROVIDER_SECRET_WRITE_MESSAGES,
  getProviderSecretConfiguration,
  writeProviderSecret,
  type ProviderSecretConfiguration,
  type ProviderSecretStatusRow,
} from '@/platform/omni-comms/application/channelProviderConfigurationService';
import { toastError } from './channelFormPrimitives';

/** Canonical Omni-Comms inbound callback function for the Resend provider. */
export const OMNI_COMMS_RESEND_WEBHOOK_FUNCTION = 'omni-comms-webhook-resend';

/** Provider events the callback handler records as delivery evidence. */
export const OMNI_COMMS_RESEND_WEBHOOK_EVENTS = [
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
] as const;

export function buildOmniCommsWebhookUrl(
  baseUrl?: string | null,
  providerAccountId?: string | null,
): string {
  const raw =
    baseUrl
    ?? ((import.meta as unknown as { env?: Record<string, string> }).env
      ?.VITE_SUPABASE_URL ?? '');
  if (!raw) return '';
  const endpoint = `${raw.replace(/\/$/, '')}/functions/v1/${OMNI_COMMS_RESEND_WEBHOOK_FUNCTION}`;
  return providerAccountId
    ? `${endpoint}?account=${encodeURIComponent(providerAccountId)}`
    : endpoint;
}

export interface ProviderWebhookSectionProps {
  client: OmniCommsRpcClient;
  orgId: string;
  onChanged?: () => void;
}

export const ProviderWebhookSection: React.FC<ProviderWebhookSectionProps> = ({
  client,
  orgId,
  onChanged,
}) => {
  const [config, setConfig] = React.useState<ProviderSecretConfiguration | null>(
    null,
  );
  const [loading, setLoading] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [target, setTarget] = React.useState<ProviderSecretStatusRow | null>(null);
  const [value, setValue] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      setConfig(await getProviderSecretConfiguration(client, orgId));
    } catch (e) {
      toastError(e, 'Failed to load webhook status');
    } finally {
      setLoading(false);
    }
  }, [client, orgId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const signingRows = (config?.secrets ?? []).filter(
    (r) => r.purpose === 'webhook_signing',
  );
  const canManage = config?.canManageCredentials === true;

  const copyUrl = React.useCallback(async (webhookUrl: string) => {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      toast.success('Webhook URL copied.');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copy failed — select the URL and copy it manually.');
    }
  }, []);

  const closeDialog = React.useCallback(() => {
    setValue('');
    setTarget(null);
  }, []);

  const submit = React.useCallback(async () => {
    if (!target) return;
    const secretValue = value.trim();
    if (!secretValue) {
      toast.error('Paste the signing secret before saving.');
      return;
    }
    setSaving(true);
    try {
      const res = await writeProviderSecret({
        organizationId: orgId,
        providerAccountId: target.providerAccountId,
        purpose: 'webhook_signing',
        secretValue,
      });
      const message =
        PROVIDER_SECRET_WRITE_MESSAGES[res.code]
        ?? PROVIDER_SECRET_WRITE_MESSAGES.credential_write_failed;
      if (res.ok) {
        toast.success(message);
        closeDialog();
        await load();
        onChanged?.();
      } else {
        toast.error(message);
      }
    } catch (e) {
      toastError(e, 'The signing secret could not be saved');
    } finally {
      setSaving(false);
      setValue('');
    }
  }, [target, value, orgId, closeDialog, load, onChanged]);

  return (
    <Card data-testid="omni-comms-provider-webhook">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Webhook className="h-4 w-4" aria-hidden="true" />
              Delivery callbacks (webhook)
            </CardTitle>
            <CardDescription>
              Register this endpoint with your provider so delivered, bounced
              and complaint outcomes appear here automatically. A sending-only
              API key cannot report outcomes without it.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh webhook status"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCcw className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="space-y-2">
          <p className="text-sm font-medium">Events to subscribe</p>
          <div className="flex flex-wrap gap-2">
            {OMNI_COMMS_RESEND_WEBHOOK_EVENTS.map((event) => (
              <Badge key={event} variant="secondary" className="font-mono text-xs">
                {event}
              </Badge>
            ))}
          </div>
        </div>

        <div className="space-y-2 rounded-lg border bg-muted/40 p-4">
          <p className="text-sm font-medium">How to complete this</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Open your provider console and add a new webhook.</li>
            <li>Paste the endpoint URL above and select the events listed.</li>
            <li>Copy the signing secret the provider shows you.</li>
            <li>Save it below — it is stored encrypted and never shown again.</li>
          </ol>
        </div>

        <div className="space-y-3">
          {signingRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {loading
                ? 'Loading webhook status…'
                : 'No provider account exists yet. Add a provider account first.'}
            </p>
          ) : null}

          {signingRows.map((row) => {
            const health = (healthRows ?? []).find(
              (h) => h.providerAccountId === row.providerAccountId,
            );
            return (
            <div
              key={row.providerAccountId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
              data-testid="omni-comms-webhook-signing-secret"
            >
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium">
                  {row.providerAccountName} · Signing secret
                </p>
                <p className="text-xs text-muted-foreground">
                  {row.configured
                    ? row.lastRotatedAt
                      ? `Saved · last replaced ${new Date(row.lastRotatedAt).toLocaleString()}`
                      : 'Saved'
                    : 'Callback signatures cannot be verified until this is saved.'}
                </p>
                {health ? (
                  <div
                    className={`flex items-start gap-2 rounded-md border p-2 text-xs ${
                      health.state === 'healthy'
                        ? 'border-border text-muted-foreground'
                        : 'border-destructive/40 bg-destructive/5 text-destructive'
                    }`}
                    data-testid="omni-comms-webhook-health"
                    data-state={health.state}
                    role={health.state === 'healthy' ? undefined : 'alert'}
                  >
                    {health.state === 'healthy' ? (
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    )}
                    <span className="min-w-0">
                      <span className="font-medium">
                        {health.state === 'healthy'
                          ? 'Callbacks verified'
                          : health.state === 'rejecting'
                            ? 'Signing secret does not match the provider'
                            : 'No callback received yet'}
                      </span>{' '}
                      {CALLBACK_HEALTH_GUIDANCE[health.state]}
                      <span className="mt-1 block opacity-80">
                        {`Accepted ${health.acceptedCount} · Rejected ${health.rejectedCount}`}
                        {health.lastAcceptedAt
                          ? ` · Last accepted ${new Date(health.lastAcceptedAt).toLocaleString()}`
                          : ''}
                        {health.lastRejectedAt
                          ? ` · Last rejected ${new Date(health.lastRejectedAt).toLocaleString()}`
                          : ''}
                        {health.lastRejectionReason
                          ? ` · Reason: ${health.lastRejectionReason}`
                          : ''}
                      </span>
                    </span>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <Input
                    readOnly
                    aria-label={`${row.providerAccountName} webhook URL`}
                    value={buildOmniCommsWebhookUrl(undefined, row.providerAccountId)}
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 font-mono text-xs"
                    data-testid="omni-comms-webhook-url"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void copyUrl(
                      buildOmniCommsWebhookUrl(undefined, row.providerAccountId),
                    )}
                  >
                    {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                    <span className="sr-only">Copy webhook URL</span>
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={row.configured ? 'secondary' : 'destructive'}>
                  {row.configured ? 'Saved' : 'Not set'}
                </Badge>
                <Button
                  size="sm"
                  variant={row.configured ? 'outline' : 'default'}
                  disabled={!canManage}
                  title={
                    canManage
                      ? undefined
                      : 'You do not have permission to manage credentials.'
                  }
                  onClick={() => {
                    setValue('');
                    setTarget(row);
                  }}
                  data-testid="omni-comms-webhook-secret-replace"
                >
                  {row.configured ? 'Replace' : 'Add'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>

      <Dialog open={target !== null} onOpenChange={(o) => (o ? null : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Webhook signing secret</DialogTitle>
            <DialogDescription>
              Paste the signing secret shown by your provider when you created
              the webhook. It is sent once to the secure backend, stored
              encrypted, and never displayed again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="omni-comms-webhook-secret-value">Signing secret</Label>
            <Input
              id="omni-comms-webhook-secret-value"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="whsec_…"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              Save securely
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default ProviderWebhookSection;
