/**
 * Omni-Comms — Webhook subscription administration.
 *
 * Binds ONE governed communication action to ONE exact subscriber endpoint.
 * The endpoint configuration checksum is re-snapshotted on every save, so a
 * later endpoint change surfaces as drift instead of silently redirecting
 * delivery.
 *
 * Boundaries: no provider SDK, no DNS lookup, no fetch of a subscriber URL,
 * no façade emission, no dispatch job. Only bounded secret reference NAMES.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, RefreshCcw, ShieldAlert } from 'lucide-react';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import type { OmniCommsRpcClient } from '@/platform/omni-comms/application/omniCommsRpcErrors';
import {
  hasEndpointDrift,
  isValidWebhookSigningSecretRef,
  listCommunicationActions,
  listWebhookSubscriptions,
  setWebhookSubscriptionLifecycle,
  upsertWebhookSubscription,
  type CommunicationActionOption,
  type WebhookSubscriptionRow,
} from '@/platform/omni-comms/application/webhookSubscriptionService';
import { Field, SelectField, toastError } from './channelFormPrimitives';

interface EndpointOption {
  id: string;
  code: string;
  display_name: string;
  status: string;
}

interface FormState {
  id: string | null;
  expectedUpdatedAt: string | null;
  actionId: string;
  endpointId: string;
  signingSecretRef: string;
}

const blankForm = (): FormState => ({
  id: null,
  expectedUpdatedAt: null,
  actionId: '',
  endpointId: '',
  signingSecretRef: '',
});

export const WebhookSubscriptionsSection: React.FC<{
  client: OmniCommsRpcClient;
  orgId: string;
  departmentId: string | null;
  endpoints: EndpointOption[];
}> = ({ client, orgId, departmentId, endpoints }) => {
  const [rows, setRows] = useState<WebhookSubscriptionRow[]>([]);
  const [actions, setActions] = useState<CommunicationActionOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [subs, acts] = await Promise.all([
        listWebhookSubscriptions(client, orgId, departmentId),
        listCommunicationActions(client, orgId, departmentId).catch(() => []),
      ]);
      setRows(Array.isArray(subs) ? subs : []);
      setActions(Array.isArray(acts) ? acts : []);
    } catch (e) {
      toastError(e, 'Could not load webhook subscriptions');
    } finally {
      setLoading(false);
    }
  }, [client, orgId, departmentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeEndpoints = useMemo(
    () => endpoints.filter((e) => e.status !== 'retired'),
    [endpoints],
  );

  const openCreate = () => {
    setForm(blankForm());
    setDialogOpen(true);
  };

  const openEdit = (row: WebhookSubscriptionRow) => {
    setForm({
      id: row.id,
      expectedUpdatedAt: row.updated_at,
      actionId: row.action_id ?? '',
      endpointId: row.endpoint_id,
      signingSecretRef: row.signing_secret_ref ?? '',
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.actionId || !form.endpointId) {
      toast.error('Choose both a communication action and a subscriber endpoint.');
      return;
    }
    if (
      form.signingSecretRef.trim() &&
      !isValidWebhookSigningSecretRef(form.signingSecretRef)
    ) {
      toast.error('Signing secret reference must look like OMNI_COMMS_WEBHOOK_CLAIMS.');
      return;
    }
    setSaving(true);
    try {
      await upsertWebhookSubscription(client, {
        id: form.id,
        expectedUpdatedAt: form.expectedUpdatedAt,
        organizationId: orgId,
        departmentId,
        actionId: form.actionId,
        endpointId: form.endpointId,
        signingSecretRef: form.signingSecretRef.trim() || null,
      });
      toast.success('Webhook subscription saved.');
      setDialogOpen(false);
      await refresh();
    } catch (e) {
      toastError(e, 'Could not save the webhook subscription');
    } finally {
      setSaving(false);
    }
  };

  const lifecycle = async (
    row: WebhookSubscriptionRow,
    action: 'activate' | 'suspend' | 'retire',
  ) => {
    try {
      await setWebhookSubscriptionLifecycle(client, {
        id: row.id,
        expectedUpdatedAt: row.updated_at,
        action,
      });
      toast.success(`Subscription ${action}d.`);
      await refresh();
    } catch (e) {
      toastError(e, 'Could not update the subscription');
    }
  };

  return (
    <Card data-testid="omni-comms-webhook-subscriptions">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Webhook subscriptions</CardTitle>
          <CardDescription>
            Bind a communication action to one exact subscriber endpoint. Delivery
            only ever reaches an endpoint that is bound here and released.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          </Button>
          <Button size="sm" onClick={openCreate} disabled={activeEndpoints.length === 0}>
            <Plus className="mr-1 h-4 w-4" /> Add subscription
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {activeEndpoints.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Create a webhook endpoint above first — a subscription must point at an
            exact endpoint.
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No subscriber is bound yet. Nothing will be delivered on this channel.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Subscriber endpoint</TableHead>
                <TableHead>Signing secret</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Manage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.action_code ?? '—'}
                    {row.action_name ? (
                      <div className="text-xs text-muted-foreground">{row.action_name}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {row.display_name}
                    <div className="text-xs text-muted-foreground">{row.endpoint_code}</div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.signing_secret_ref ?? 'Not set'}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <Badge variant={row.status === 'active' ? 'default' : 'secondary'}>
                        {row.status}
                      </Badge>
                      {hasEndpointDrift(row) ? (
                        <span className="flex items-center gap-1 text-xs text-destructive">
                          <ShieldAlert className="h-3 w-3" /> Endpoint changed since binding
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
                      Edit
                    </Button>
                    {row.status === 'active' ? (
                      <Button variant="ghost" size="sm" onClick={() => void lifecycle(row, 'suspend')}>
                        Suspend
                      </Button>
                    ) : row.status === 'suspended' ? (
                      <Button variant="ghost" size="sm" onClick={() => void lifecycle(row, 'activate')}>
                        Activate
                      </Button>
                    ) : null}
                    {row.status !== 'retired' ? (
                      <Button variant="ghost" size="sm" onClick={() => void lifecycle(row, 'retire')}>
                        Retire
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit' : 'Add'} webhook subscription</DialogTitle>
            <DialogDescription>
              Saving re-snapshots the endpoint configuration checksum used to detect
              later tampering.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <SelectField
              label="Communication action"
              value={form.actionId}
              onChange={(v) => setForm((f) => ({ ...f, actionId: v }))}
              options={actions.map((a) => ({
                value: a.id,
                label: a.name ? `${a.code} — ${a.name}` : a.code,
              }))}
            />
            <SelectField
              label="Subscriber endpoint"
              value={form.endpointId}
              onChange={(v) => setForm((f) => ({ ...f, endpointId: v }))}
              options={activeEndpoints.map((e) => ({
                value: e.id,
                label: `${e.display_name} (${e.code})`,
              }))}
            />
            <div className="space-y-1">
              <Field
                label="Signing secret reference"
                value={form.signingSecretRef}
                onChange={(v) => setForm((f) => ({ ...f, signingSecretRef: v }))}
                placeholder="OMNI_COMMS_WEBHOOK_CLAIMS"
              />
              <p className="text-xs text-muted-foreground">
                Reference name only — the secret value is never entered or shown here.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default WebhookSubscriptionsSection;
