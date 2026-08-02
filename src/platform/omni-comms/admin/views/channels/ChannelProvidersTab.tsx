/**
 * Omni-Comms C2.1 — generic, provider-independent Providers tab.
 * Omni-Comms UX2 — resource-manager presentation (search, action menu,
 * accessible lifecycle dialogs, details drawer, responsive cards).
 *
 * Boundaries (permanent):
 *   - No provider SDK import, no network call to a provider, no send.
 *   - No credential VALUE is requested, stored or displayed — only Edge secret
 *     reference NAME patterns.
 *   - Seeded and reference providers are read-only.
 *   - `core_audit_log` is never queried; history is not fabricated.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import type { OmniCommsRpcClient } from '@/platform/omni-comms/application/omniCommsRpcErrors';
import {
  getChannelProviderAdminSummary,
  setChannelProviderLifecycle,
  upsertChannelProviderDraft,
  type ProviderAdminRow,
  type ProviderAdminSummary,
} from '@/platform/omni-comms/application/channelProviderAdminService';
import {
  adaptersForChannel,
  findAdapter,
  NO_DELIVERY_ADAPTER_MESSAGE,
  providerRegistrationSupported,
} from '@/platform/omni-comms/domain/providerAdapterCatalogue';
import { SECRET_REFERENCE_HELP } from '@/platform/omni-comms/application/channelProviderAccountTypes';
import type { ChannelUiDefinition } from './channelUiRegistry';
import { Field, SelectField, toastError } from './channelFormPrimitives';
import { ReferenceDataControls } from './ReferenceDataControls';
import { useOmniCommsResourceParam } from '../../hooks/useOmniCommsResourceParam';
import {
  DrawerFacts,
  LifecycleActionDialog,
  ResourceActionMenu,
  ResourceDetailsDrawer,
  ResourceRecordCard,
  ResourceResponsiveList,
  ResourceSearchToolbar,
  backendLifecycleAction,
  safeLifecycleFacts,
  useLifecycleDialog,
  useResourceFilter,
  type LifecycleActionDescriptor,
} from './resourceManager';

interface Props {
  definition: ChannelUiDefinition;
  client: OmniCommsRpcClient;
  onChanged?: () => void;
}

interface FormState {
  id: string | null;
  expectedUpdatedAt: string | null;
  adapterKey: string;
  code: string;
  displayName: string;
}

const EMPTY_FORM: FormState = {
  id: null, expectedUpdatedAt: null, adapterKey: '', code: '', displayName: '',
};

/** Providers support exactly two backend lifecycle actions. */
export function providerLifecycleActions(
  row: ProviderAdminRow,
): LifecycleActionDescriptor[] {
  if (row.data_origin !== 'user') return [];
  const actions: LifecycleActionDescriptor[] = [];
  if (row.status === 'draft') actions.push({ key: 'activate', label: 'Activate' });
  if (row.status === 'active') {
    actions.push({ key: 'retire', label: 'Retire', destructive: true });
  }
  return actions;
}

export const ChannelProvidersTab: React.FC<Props> = ({
  definition, client, onChanged,
}) => {
  const channel = definition.code;
  const [data, setData] = useState<ProviderAdminSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [actionRow, setActionRow] = useState<ProviderAdminRow | null>(null);

  const supported = providerRegistrationSupported(channel);
  const adapters = useMemo(() => adaptersForChannel(channel), [channel]);
  const providers = useMemo(() => data?.providers ?? [], [data]);

  const { resourceId, selectResource, clearResource } = useOmniCommsResourceParam();
  const detailRow = providers.find((p) => p.id === resourceId) ?? null;

  const { filter, setFilter, filtered } = useResourceFilter(
    providers,
    (p) => [p.code, p.display_name, p.adapter_key],
    (p) => p.status,
  );

  const load = useCallback(async () => {
    if (!supported) return;
    setLoading(true);
    try {
      setData(await getChannelProviderAdminSummary(client, channel, showReference));
    } catch (e) {
      toastError(e, 'Failed to load providers');
    } finally {
      setLoading(false);
    }
  }, [client, channel, showReference, supported]);

  useEffect(() => { void load(); }, [load]);

  const runLifecycle = useCallback(
    async (key: 'activate' | 'reactivate' | 'disable' | 'retire' | 'verify', reason: string | null) => {
      const p = actionRow;
      if (!p) return;
      const action = backendLifecycleAction(key);
      if (action === 'verify' || action === 'disable') return; // unsupported for providers
      setBusy(true);
      try {
        await setChannelProviderLifecycle(client, {
          id: p.id, expectedUpdatedAt: p.updated_at, action, reason,
        });
        toast.success(action === 'activate' ? 'Provider activated' : 'Provider retired');
        await load();
        onChanged?.();
      } catch (e) {
        toastError(e, 'Lifecycle action failed');
      } finally {
        setBusy(false);
        setActionRow(null);
      }
    },
    [actionRow, client, load, onChanged],
  );

  const lifecycleDialog = useLifecycleDialog(runLifecycle);

  const selectedAdapter = form ? findAdapter(form.adapterKey) : undefined;
  const startCreate = () => setForm({ ...EMPTY_FORM, adapterKey: adapters[0]?.adapterKey ?? '' });
  const startEdit = (p: ProviderAdminRow) =>
    setForm({
      id: p.id,
      expectedUpdatedAt: p.updated_at,
      adapterKey: p.adapter_key,
      code: p.code,
      displayName: p.display_name,
    });

  const save = async () => {
    if (!form || !selectedAdapter) return;
    setBusy(true);
    try {
      await upsertChannelProviderDraft(client, {
        id: form.id,
        expectedUpdatedAt: form.expectedUpdatedAt,
        channel,
        code: form.code.trim().toLowerCase(),
        displayName: form.displayName.trim(),
        adapterKey: selectedAdapter.adapterKey,
        credentialRequirements: selectedAdapter.credentials.map((c) => ({
          purpose: c.purpose,
          displayName: c.displayName,
          description: c.description ?? null,
          required: c.required,
          secretRefPattern: c.secretRefPattern,
        })),
      });
      toast.success('Provider draft saved');
      setForm(null);
      await load();
      onChanged?.();
    } catch (e) {
      toastError(e, 'Failed to save provider');
    } finally {
      setBusy(false);
    }
  };

  if (!supported) {
    return (
      <Card data-testid="channel-providers-unsupported">
        <CardHeader>
          <CardTitle>{definition.name} providers</CardTitle>
          <CardDescription>
            The current database schema does not accept a provider for this
            channel, so no provider can be registered here yet.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const openActions = (p: ProviderAdminRow) => (a: LifecycleActionDescriptor) => {
    setActionRow(p);
    lifecycleDialog.request(a);
  };

  const rowActions = (p: ProviderAdminRow) => (
    <ResourceActionMenu
      testId={`omni-comms-provider-actions-${p.code}`}
      label={`Actions for ${p.display_name}`}
      disabled={busy || p.data_origin !== 'user'}
      actions={providerLifecycleActions(p)}
      onSelect={openActions(p)}
      onEdit={p.status === 'draft' && p.data_origin === 'user' ? () => startEdit(p) : undefined}
      onViewDetails={() => selectResource(p.id)}
    />
  );

  return (
    <div className="space-y-4" data-testid="channel-providers-tab">
      <Card>
        <CardHeader className="flex flex-col items-start justify-between gap-4 sm:flex-row">
          <div>
            <CardTitle>{definition.name} providers</CardTitle>
            <CardDescription>
              Register the provider vendors this organisation may use on{' '}
              {definition.name}. A provider must be active before an account can
              be created against it on the Accounts tab. Credentials are never
              entered here — only the Edge secret reference names an account
              must supply.
            </CardDescription>
          </div>
          <Button size="sm" onClick={startCreate} disabled={busy || adapters.length === 0}>
            <Plus className="mr-1 h-4 w-4" /> Register provider
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <ReferenceDataControls
            showReference={showReference}
            onToggle={setShowReference}
            hiddenCount={providers.filter((p) => p.data_origin === 'reference_seed').length}
          />

          <ResourceSearchToolbar
            filter={filter}
            onChange={setFilter}
            placeholder="Search providers by name, code or adapter"
            total={providers.length}
            shown={filtered.length}
            testId="omni-comms-providers-toolbar"
          />

          {loading ? (
            <p className="text-sm text-muted-foreground">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading providers…
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {providers.length === 0
                ? 'No provider is registered for this channel yet.'
                : 'No provider matches the current search or status filter.'}
            </p>
          ) : (
            <ResourceResponsiveList
              table={(
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider</TableHead>
                      <TableHead>Adapter</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Credentials</TableHead>
                      <TableHead>Accounts</TableHead>
                      <TableHead>Origin</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((p) => {
                      const adapter = findAdapter(p.adapter_key);
                      return (
                        <TableRow key={p.id}>
                          <TableCell>
                            <div className="font-medium">{p.display_name}</div>
                            <div className="font-mono text-xs text-muted-foreground">{p.code}</div>
                          </TableCell>
                          <TableCell>
                            <div className="font-mono text-xs">{p.adapter_key}</div>
                            {!adapter?.deliveryImplemented ? (
                              <div className="text-xs text-muted-foreground">
                                No delivery adapter installed
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <Badge variant={p.status === 'active' ? 'default' : 'secondary'}>
                              {p.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {p.credential_requirements.length === 0
                              ? 'None declared'
                              : p.credential_requirements.map((r) => r.purpose).join(', ')}
                          </TableCell>
                          <TableCell className="text-sm">{p.account_count}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {p.data_origin}
                          </TableCell>
                          <TableCell className="text-right">
                            {p.data_origin !== 'user' ? (
                              <span className="text-xs text-muted-foreground">Read-only</span>
                            ) : null}
                            {rowActions(p)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
              cards={filtered.map((p) => (
                <ResourceRecordCard
                  key={p.id}
                  testId={`omni-comms-provider-card-${p.code}`}
                  title={p.display_name}
                  subtitle={p.code}
                  status={p.status}
                  fields={[
                    { label: 'Adapter', value: p.adapter_key },
                    { label: 'Accounts', value: String(p.account_count) },
                    { label: 'Origin', value: p.data_origin },
                  ]}
                  actions={rowActions(p)}
                  onOpen={() => selectResource(p.id)}
                />
              ))}
            />
          )}
        </CardContent>
      </Card>

      <LifecycleActionDialog
        controller={lifecycleDialog}
        resourceLabel="provider"
        recordLabel={actionRow ? `${actionRow.display_name} (${actionRow.code})` : ''}
      />

      <ResourceDetailsDrawer
        open={detailRow !== null}
        onOpenChange={(open) => { if (!open) clearResource(); }}
        title={detailRow?.display_name ?? 'Provider'}
        description={detailRow ? `Provider ${detailRow.code} on ${definition.name}` : undefined}
        facts={detailRow ? safeLifecycleFacts(detailRow as never) : undefined}
        testId="omni-comms-provider-drawer"
      >
        {detailRow ? (
          <DrawerFacts
            facts={[
              { label: 'Adapter', value: detailRow.adapter_key },
              { label: 'Status', value: detailRow.status },
              { label: 'Origin', value: detailRow.data_origin },
              { label: 'Accounts', value: String(detailRow.account_count) },
              {
                label: 'Credential purposes',
                value: detailRow.credential_requirements.map((r) => r.purpose).join(', ') || 'None declared',
              },
            ]}
          />
        ) : null}
      </ResourceDetailsDrawer>

      {form ? (
        <Card data-testid="channel-provider-form">
          <CardHeader>
            <CardTitle>
              {form.id ? 'Edit draft provider' : 'Register provider'}
            </CardTitle>
            <CardDescription>
              Identity fields become immutable once the provider is activated.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <SelectField
              label="Provider adapter"
              value={form.adapterKey}
              onChange={(v) => setForm({ ...form, adapterKey: v })}
              options={adapters.map((a) => ({ value: a.adapterKey, label: a.label }))}
            />
            <Field
              label="Code" value={form.code}
              onChange={(v) => setForm({ ...form, code: v })}
              placeholder="lowercase_with_underscores"
            />
            <Field
              label="Display name" value={form.displayName}
              onChange={(v) => setForm({ ...form, displayName: v })}
              placeholder="Operator-facing provider name"
            />

            {selectedAdapter ? (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">Credential requirements</p>
                <p className="text-xs text-muted-foreground">{SECRET_REFERENCE_HELP}</p>
                {selectedAdapter.credentials.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    This adapter needs no credential. Activation is still
                    required before accounts can reference it.
                  </p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {selectedAdapter.credentials.map((c) => (
                      <li key={c.purpose} className="flex items-start gap-2">
                        <Checkbox checked disabled className="mt-1" />
                        <span>
                          <span className="font-mono text-xs">{c.purpose}</span>
                          {' — '}{c.displayName}
                          <span className="block font-mono text-xs text-muted-foreground">
                            {c.secretRefPattern}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {!selectedAdapter.deliveryImplemented ? (
                  <Alert>
                    <ShieldAlert className="h-4 w-4" />
                    <AlertTitle>Configuration only</AlertTitle>
                    <AlertDescription>{NO_DELIVERY_ADAPTER_MESSAGE}</AlertDescription>
                  </Alert>
                ) : null}
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button
                onClick={() => void save()}
                disabled={busy || !form.adapterKey || !form.code.trim() || !form.displayName.trim()}
              >
                Save draft
              </Button>
              <Button variant="outline" onClick={() => setForm(null)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};
