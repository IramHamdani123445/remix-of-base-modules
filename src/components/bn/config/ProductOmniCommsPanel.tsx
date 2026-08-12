/**
 * Product Definition → Communications (Omni-Comms).
 *
 * Read-only projection of the Hub's per-product configuration plus bounded
 * configuration actions. This panel never sends, enqueues or dispatches: it
 * only records what the Hub should do when the business event occurs.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Info, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  readProductCommunicationConfig,
  updateProductCommunicationConfig,
  type OmniCommsProductChannelConfig,
  type OmniCommsProductCommunicationRead,
} from '@/platform/omni-comms/application/productCommunicationService';

interface ProductOmniCommsPanelProps {
  organizationId: string | null | undefined;
  productId: string | null | undefined;
}

function sourceLabel(source: string | null): string {
  switch (source) {
    case 'product_override':
      return 'Product override';
    case 'event_default':
      return 'Inherited from event';
    case 'channel_default':
      return 'Inherited from channel';
    default:
      return 'Not resolved';
  }
}

export function ProductOmniCommsPanel({ organizationId, productId }: ProductOmniCommsPanelProps) {
  const [data, setData] = useState<OmniCommsProductCommunicationRead | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { template: string; sender: string }>>({});

  const load = useCallback(async () => {
    if (!organizationId || !productId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await readProductCommunicationConfig(organizationId, productId);
      setData(result);
      const next: Record<string, { template: string; sender: string }> = {};
      (result?.configs ?? []).forEach((c) => {
        next[`${c.event_code}:${c.channel}`] = {
          template: c.template_override ?? '',
          sender: c.sender_override ?? '',
        };
      });
      setDrafts(next);
    } catch (e: any) {
      setError(e?.message ?? 'Communication configuration could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [organizationId, productId]);

  useEffect(() => {
    void load();
  }, [load]);

  const canConfigure = data?.can_configure === true;

  const apply = useCallback(
    async (config: OmniCommsProductChannelConfig, patch: Record<string, unknown>, reason: string) => {
      if (!organizationId || !productId) return;
      const key = `${config.event_code}:${config.channel}`;
      setSaving(key);
      try {
        await updateProductCommunicationConfig({
          organizationId,
          productId,
          eventCode: config.event_code,
          channel: config.channel,
          reason,
          ...patch,
        });
        toast.success('Communication configuration updated');
        await load();
      } catch (e: any) {
        toast.error(e?.message ?? 'Configuration change was rejected');
      } finally {
        setSaving(null);
      }
    },
    [organizationId, productId, load],
  );

  const configs = useMemo(() => data?.configs ?? [], [data]);

  if (!organizationId || !productId) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Select a product to configure its Omnichannel Communications.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Omnichannel Communications</CardTitle>
            <CardDescription>
              What this product asks the Communication Hub to send. The Hub still decides branding,
              approval, queueing and delivery.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {loading && !data && <Skeleton className="h-24 w-full" />}
          {!loading && configs.length === 0 && !error && (
            <p className="text-sm text-muted-foreground">
              No communication events are registered for this product yet.
            </p>
          )}
          {configs.map((config) => {
            const key = `${config.event_code}:${config.channel}`;
            const draft = drafts[key] ?? { template: '', sender: '' };
            const busy = saving === key;
            return (
              <div key={key} className="rounded-lg border p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{config.event_code}</span>
                      <Badge variant="outline" className="uppercase">
                        {config.channel}
                      </Badge>
                      {config.applicability && config.applicability !== 'applicable' && (
                        <Badge variant="secondary">{config.applicability.replace(/_/g, ' ')}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Mode {config.delivery_mode ?? 'queued'} · recipients{' '}
                      {config.recipient_source ?? 'not set'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`enable-${key}`} className="text-sm">
                      Enabled
                    </Label>
                    <Switch
                      id={`enable-${key}`}
                      checked={config.is_enabled}
                      disabled={!canConfigure || busy}
                      onCheckedChange={(checked) =>
                        void apply(
                          config,
                          { isEnabled: checked },
                          checked ? 'Enabled from Product Definition' : 'Disabled from Product Definition',
                        )
                      }
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor={`tpl-${key}`}>Template override</Label>
                    <Input
                      id={`tpl-${key}`}
                      value={draft.template}
                      placeholder={config.effective_template ?? 'Inherited'}
                      disabled={!canConfigure || busy}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [key]: { ...draft, template: e.target.value } }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Effective: {config.effective_template ?? '—'} ({sourceLabel(config.effective_template_source)})
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`snd-${key}`}>Sender profile override</Label>
                    <Input
                      id={`snd-${key}`}
                      value={draft.sender}
                      placeholder={config.effective_sender ?? 'Inherited'}
                      disabled={!canConfigure || busy}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [key]: { ...draft, sender: e.target.value } }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Effective: {config.effective_sender ?? '—'} ({sourceLabel(config.effective_sender_source)})
                    </p>
                  </div>
                </div>

                {canConfigure && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void apply(
                          config,
                          {
                            templateOverride: draft.template.trim() || null,
                            senderOverride: draft.sender.trim() || null,
                            clearTemplateOverride: draft.template.trim() === '',
                            clearSenderOverride: draft.sender.trim() === '',
                          },
                          'Overrides updated from Product Definition',
                        )
                      }
                    >
                      Save overrides
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void apply(
                          config,
                          { clearTemplateOverride: true, clearSenderOverride: true },
                          'Reverted to inherited configuration',
                        )
                      }
                    >
                      Use inherited
                    </Button>
                  </div>
                )}
              </div>
            );
          })}

          {!canConfigure && !loading && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                You can view this configuration but not change it. Ask an Omni-Comms administrator
                for the configure capability.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {(data?.audit?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent configuration changes</CardTitle>
            <CardDescription>Append-only record of who changed what and why.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data!.audit.map((entry) => (
              <div key={entry.id} className="rounded-md border px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{entry.action.replace(/_/g, ' ')}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(entry.changed_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {entry.changed_by_label ?? 'Unknown operator'}
                  {entry.reason ? ` — ${entry.reason}` : ''}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default ProductOmniCommsPanel;
