/**
 * Omni-Comms C3B — generic, provider-independent Endpoints tab.
 *
 * ONE endpoint administration experience for every channel that owns an
 * endpoint concept (email, sms, whatsapp, in_app, print).
 *
 * Boundaries (permanent):
 *   - No provider SDK import, no DNS lookup, no callback receiver, no fetch of
 *     a configured URL, and no façade emission call.
 *   - No request, message, dispatch job or delivery attempt is created.
 *   - Only bounded Edge secret reference NAMES are captured; a credential
 *     value is never entered, stored or displayed.
 *   - An endpoint is never presented as externally verified by this screen.
 *   - Reference/simulation endpoints are hidden by default and read-only.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, RefreshCcw } from 'lucide-react';
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
import type { useOmniCommsRpcClient } from '../../hooks/useOmniCommsRpcClient';
import {
  getChannelEndpointSummary,
  setChannelEndpointLifecycle,
  upsertChannelEndpointDraft,
} from '@/platform/omni-comms/application/channelEndpointService';
import {
  endpointChannelSupported,
  endpointConfigSummary,
  endpointRequiresProviderAccount,
  endpointScopeLabel,
  isValidEndpointSecretRef,
  ENDPOINT_ACTIVATION_MEANING,
  OMNI_COMMS_EMAIL_EVENT_TYPES,
  OMNI_COMMS_ENDPOINT_REQUIRED_SECRETS,
  OMNI_COMMS_ENDPOINT_SECRET_PURPOSES,
  OMNI_COMMS_ENDPOINT_TYPES_BY_CHANNEL,
  OMNI_COMMS_ENDPOINT_TYPE_LABEL,
  OMNI_COMMS_IN_APP_TRANSPORTS,
  OMNI_COMMS_PRINT_SERVICE_MODES,
  OMNI_COMMS_WHATSAPP_SUBSCRIBED_FIELDS,
  REFERENCE_ENDPOINT_READ_ONLY_HELP,
  type ChannelEndpointConfig,
  type ChannelEndpointRow,
  type ChannelEndpointSummary,
  type OmniCommsEndpointChannel,
  type OmniCommsEndpointType,
} from '@/platform/omni-comms/application/channelEndpointTypes';
import { DeferredCapabilityCard, Field, SelectField, toastError } from './channelFormPrimitives';
import { visibleRecords } from './channelReferenceData';
import { ReferenceDataBadge, ReferenceDataControls } from './ReferenceDataControls';
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
import type { ChannelUiDefinition } from './channelUiRegistry';

type Client = ReturnType<typeof useOmniCommsRpcClient>;

const ORG_SCOPE = '__organisation__';
const NO_ACCOUNT = '__none__';

export const ENDPOINTS_NOT_IMPLEMENTED_LABEL =
  'Endpoint configuration is not modelled for this channel';

/** Truthful statement rendered on every endpoint surface. */
export const ENDPOINT_NO_EXTERNAL_CALL_NOTICE =
  'This screen stores configuration only. No DNS lookup, provider call or '
  + 'callback request is performed, and no message is sent.';

interface FormState {
  id: string | null;
  expectedUpdatedAt: string | null;
  code: string;
  displayName: string;
  scope: string;
  providerAccountId: string;
  endpointType: OmniCommsEndpointType;
  config: ChannelEndpointConfig;
  secretRefs: Record<string, string>;
}

function blankForm(channel: OmniCommsEndpointChannel): FormState {
  return {
    id: null,
    expectedUpdatedAt: null,
    code: '',
    displayName: '',
    scope: ORG_SCOPE,
    providerAccountId: NO_ACCOUNT,
    endpointType: OMNI_COMMS_ENDPOINT_TYPES_BY_CHANNEL[channel][0],
    config: {},
    secretRefs: {},
  };
}

export const ChannelEndpointsTab: React.FC<{
  definition: ChannelUiDefinition;
  client?: Client;
  orgId?: string;
  departmentId?: string | null;
  departmentName?: string | null;
  onChanged?: () => Promise<void> | void;
}> = ({
  definition,
  client,
  orgId,
  departmentId = null,
  departmentName = null,
  onChanged,
}) => {
  if (!endpointChannelSupported(definition.code) || !client || !orgId) {
    return (
      <DeferredCapabilityCard
        testId="omni-comms-endpoints-empty-state"
        title={`${definition.name} endpoints`}
        description={ENDPOINTS_NOT_IMPLEMENTED_LABEL}
        bullets={definition.endpoints}
        footer="No endpoint record is created, stored or contacted."
      />
    );
  }

  return (
    <GenericEndpointsPanel
      channel={definition.code as OmniCommsEndpointChannel}
      channelName={definition.name}
      client={client}
      orgId={orgId}
      departmentId={departmentId}
      departmentName={departmentName}
      onChanged={onChanged ?? (() => undefined)}
    />
  );
};

const GenericEndpointsPanel: React.FC<{
  channel: OmniCommsEndpointChannel;
  channelName: string;
  client: Client;
  orgId: string;
  departmentId: string | null;
  departmentName: string | null;
  onChanged: () => Promise<void> | void;
}> = ({ channel, channelName, client, orgId, departmentId, departmentName, onChanged }) => {
  const [summary, setSummary] = useState<ChannelEndpointSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showReference, setShowReference] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => blankForm(channel));

  /**
   * Reference endpoints are fetched ONLY when the reference view is active, so
   * reference rows are never delivered to the browser during normal use.
   */
  const load = useCallback(async (includeReference: boolean) => {
    if (!orgId) return;
    setLoading(true);
    try {
      const res = await getChannelEndpointSummary(
        client, orgId, channel, departmentId, includeReference,
      );
      setSummary(res);
    } catch (e) {
      toastError(e, 'Unable to load endpoints');
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [client, orgId, channel, departmentId]);

  useEffect(() => { void load(showReference); }, [load, showReference]);

  const refreshAll = useCallback(async () => {
    await load(showReference);
    await onChanged();
  }, [load, showReference, onChanged]);

  const genuine = summary?.endpoints ?? [];
  const reference = summary?.reference_endpoints ?? [];
  const referenceCount = summary?.reference_endpoint_count ?? reference.length;
  const rows = useMemo(
    () => visibleRecords(genuine, reference, showReference),
    [genuine, reference, showReference],
  );

  const { filter, setFilter, filtered } = useResourceFilter(
    rows,
    (r) => [r.code, r.display_name, r.endpoint_type, r.provider_account_code],
    (r) => r.status,
  );
  const { resourceId, selectResource, clearResource } = useOmniCommsResourceParam();
  const detailRow = rows.find((r) => r.id === resourceId) ?? null;

  const openCreate = () => { setForm(blankForm(channel)); setDialogOpen(true); };
  const openEdit = (row: ChannelEndpointRow) => {
    setForm({
      id: row.id,
      expectedUpdatedAt: row.updated_at,
      code: row.code,
      displayName: row.display_name,
      scope: row.department_id ?? ORG_SCOPE,
      providerAccountId: row.provider_account_id ?? NO_ACCOUNT,
      endpointType:
        (row.endpoint_type as OmniCommsEndpointType)
        ?? OMNI_COMMS_ENDPOINT_TYPES_BY_CHANNEL[channel][0],
      config: { ...(row.endpoint_config ?? {}) },
      secretRefs: Object.fromEntries(
        (row.secret_refs ?? []).map((s) => [s.purpose, s.secret_ref]),
      ),
    });
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      <ReferenceDataControls
        hiddenCount={referenceCount}
        showReference={showReference}
        onToggle={setShowReference}
      />

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>{channelName} endpoints</CardTitle>
            <CardDescription data-testid="omni-comms-endpoint-activation-meaning">
              {ENDPOINT_ACTIVATION_MEANING}
            </CardDescription>
            <p
              className="text-xs text-muted-foreground mt-2"
              data-testid="omni-comms-endpoint-no-external-call"
            >
              {ENDPOINT_NO_EXTERNAL_CALL_NOTICE}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline" size="sm"
              onClick={() => void load(showReference)} disabled={loading}
            >
              <RefreshCcw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button size="sm" onClick={openCreate} data-testid="omni-comms-create-endpoint">
              <Plus className="h-4 w-4 mr-1" /> Create endpoint
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <ResourceSearchToolbar
            filter={filter}
            onChange={setFilter}
            placeholder="Search endpoints by code, name or type"
            total={rows.length}
            shown={filtered.length}
            testId="omni-comms-endpoints-toolbar"
          />
          {loading ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading endpoints…
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="omni-comms-endpoints-none">
              {rows.length === 0
                ? `No ${channelName.toLowerCase()} endpoints are configured for this scope yet.`
                : 'No endpoint matches the current search or status filter.'}
            </p>
          ) : (
            <ResourceResponsiveList table={(
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Provider account</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Verification</TableHead>
                  <TableHead>Configuration</TableHead>
                  <TableHead>Secret references</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <EndpointRow
                    key={row.id}
                    row={row}
                    client={client}
                    onEdit={() => openEdit(row)}
                    onChanged={refreshAll}
                    onViewDetails={() => selectResource(row.id)}
                  />
                ))}
              </TableBody>
            </Table>
            )} cards={filtered.map((row) => (
              <ResourceRecordCard
                key={row.id}
                testId={`omni-comms-endpoint-card-${row.code}`}
                title={row.display_name}
                subtitle={row.code}
                status={row.status}
                fields={[
                  { label: 'Type', value: OMNI_COMMS_ENDPOINT_TYPE_LABEL[row.endpoint_type] ?? row.endpoint_type },
                  { label: 'Scope', value: endpointScopeLabel(row) },
                ]}
                actions={(
                  <EndpointRowActions
                    row={row}
                    client={client}
                    onEdit={() => openEdit(row)}
                    onChanged={refreshAll}
                    onViewDetails={() => selectResource(row.id)}
                  />
                )}
                onOpen={() => selectResource(row.id)}
              />
            ))} />
          )}
        </CardContent>
      </Card>

      <ResourceDetailsDrawer
        open={detailRow !== null}
        onOpenChange={(open) => { if (!open) clearResource(); }}
        title={detailRow?.display_name ?? 'Endpoint'}
        description={detailRow ? `${channelName} endpoint ${detailRow.code}` : undefined}
        facts={detailRow ? safeLifecycleFacts(detailRow as never) : undefined}
        testId="omni-comms-endpoint-drawer"
      >
        {detailRow ? (
          <DrawerFacts
            facts={[
              { label: 'Type', value: OMNI_COMMS_ENDPOINT_TYPE_LABEL[detailRow.endpoint_type] ?? detailRow.endpoint_type },
              { label: 'Scope', value: endpointScopeLabel(detailRow) },
              { label: 'Status', value: detailRow.status },
              { label: 'Configuration', value: endpointConfigSummary(detailRow) },
            ]}
          />
        ) : null}
      </ResourceDetailsDrawer>

      <EndpointDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        channel={channel}
        channelName={channelName}
        form={form}
        setForm={setForm}
        client={client}
        orgId={orgId}
        departmentId={departmentId}
        departmentName={departmentName}
        accounts={summary?.provider_accounts ?? []}
        onSaved={refreshAll}
      />
    </div>
  );
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  active: 'default',
  draft: 'secondary',
  disabled: 'outline',
  retired: 'outline',
};

/** Verification is never claimed by this screen. */
export const VERIFICATION_LABEL: Record<string, string> = {
  unverified: 'Not verified here',
  pending: 'Provider verification pending',
  verified: 'Recorded as provider-verified',
  failed: 'Provider verification failed',
};

export function endpointLifecycleActions(row: ChannelEndpointRow): LifecycleActionDescriptor[] {
  const actions: LifecycleActionDescriptor[] = [];
  if (row.status === 'draft') actions.push({ key: 'activate', label: 'Activate' });
  if (row.status === 'disabled') actions.push({ key: 'reactivate', label: 'Reactivate' });
  if (row.status === 'active') actions.push({ key: 'disable', label: 'Disable' });
  if (row.status !== 'retired') {
    actions.push({ key: 'retire', label: 'Retire', destructive: true });
  }
  return actions;
}

export const EndpointRowActions: React.FC<{
  row: ChannelEndpointRow;
  client: Client;
  onEdit: () => void;
  onChanged: () => Promise<void> | void;
  onViewDetails: () => void;
}> = ({ row, client, onEdit, onChanged, onViewDetails }) => {
  const [busy, setBusy] = useState(false);
  const isReference = row.data_origin === 'reference_seed';

  const run = async (
    key: 'activate' | 'reactivate' | 'disable' | 'retire' | 'verify',
    reason: string | null,
  ) => {
    if (isReference) return;
    const action = backendLifecycleAction(key);
    if (action === 'verify') return;
    setBusy(true);
    try {
      await setChannelEndpointLifecycle(client, {
        id: row.id,
        expectedUpdatedAt: row.updated_at,
        action,
        reason,
      });
      toast.success(`Endpoint ${action}d`);
      await onChanged();
    } catch (e) { toastError(e, `${action} failed`); }
    finally { setBusy(false); }
  };

  const dialog = useLifecycleDialog(run);

  return (
    <>
      <ResourceActionMenu
        testId={`omni-comms-endpoint-actions-${row.code}`}
        label={`Actions for ${row.display_name}`}
        disabled={busy || isReference}
        actions={isReference ? [] : endpointLifecycleActions(row)}
        onSelect={dialog.request}
        onEdit={!isReference && row.status === 'draft' ? onEdit : undefined}
        onViewDetails={onViewDetails}
      />
      <LifecycleActionDialog
        controller={dialog}
        resourceLabel="endpoint"
        recordLabel={`${row.display_name} (${row.code})`}
      />
    </>
  );
};

const EndpointRow: React.FC<{
  row: ChannelEndpointRow;
  client: Client;
  onEdit: () => void;
  onChanged: () => Promise<void> | void;
  onViewDetails: () => void;
}> = ({ row, client, onEdit, onChanged, onViewDetails }) => {
  const isReference = row.data_origin === 'reference_seed';

  return (
    <TableRow>
      <TableCell>
        <div className="space-y-1">
          <code className="text-xs">{row.code}</code>
          <p className="text-sm">{row.display_name}</p>
          {isReference ? <ReferenceDataBadge /> : null}
        </div>
      </TableCell>
      <TableCell className="text-sm">
        {OMNI_COMMS_ENDPOINT_TYPE_LABEL[row.endpoint_type] ?? row.endpoint_type}
      </TableCell>
      <TableCell className="text-xs">
        {row.provider_account_code
          ? `${row.provider_account_code}${row.provider_adapter_key ? ` (${row.provider_adapter_key})` : ''}`
          : 'Internal — no provider account'}
      </TableCell>
      <TableCell className="text-sm">{endpointScopeLabel(row)}</TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[row.status] ?? 'outline'}>{row.status}</Badge>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {VERIFICATION_LABEL[row.verification_status] ?? row.verification_status}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground max-w-xs break-words">
        {endpointConfigSummary(row)}
      </TableCell>
      <TableCell className="text-xs font-mono break-all max-w-[14rem]">
        {(row.secret_refs ?? []).length === 0
          ? '—'
          : row.secret_refs.map((s) => `${s.purpose}: ${s.secret_ref}`).join(' · ')}
      </TableCell>
      <TableCell>
        {isReference ? (
          <p
            className="text-xs text-muted-foreground max-w-xs"
            data-testid={`omni-comms-reference-endpoint-readonly-${row.code}`}
          >
            {REFERENCE_ENDPOINT_READ_ONLY_HELP}
          </p>
        ) : (
          <EndpointRowActions
            row={row}
            client={client}
            onEdit={onEdit}
            onChanged={onChanged}
            onViewDetails={onViewDetails}
          />
        )}
      </TableCell>
    </TableRow>
  );
};

/** Client-side mirror of the server normaliser's structural expectations. */
export function validateEndpointForm(
  channel: OmniCommsEndpointChannel,
  form: Pick<FormState, 'code' | 'displayName' | 'endpointType' | 'config' | 'secretRefs' | 'providerAccountId'>,
): string | null {
  if (!form.code.trim()) return 'Endpoint code is required.';
  if (!form.displayName.trim()) return 'Display name is required.';
  const cfg = form.config;
  const t = form.endpointType;

  if (t === 'sending_domain' && !cfg.domain_name?.trim()) {
    return 'Sending domain name is required.';
  }
  if (
    (t === 'event_callback' || t === 'delivery_callback'
      || t === 'inbound_callback' || t === 'business_webhook')
    && !cfg.callback_url?.trim()
  ) {
    return 'Callback URL is required.';
  }
  if (cfg.callback_url && !/^https:\/\//i.test(cfg.callback_url.trim())) {
    return 'Callback URL must use HTTPS.';
  }
  if (t === 'realtime_endpoint' && !cfg.transport) {
    return 'Transport is required.';
  }
  if (t === 'render_service') {
    if (!cfg.service_mode) return 'Service mode is required.';
    if (!cfg.service_reference?.trim()) return 'Service reference is required.';
  }
  if (endpointRequiresProviderAccount(channel, t, cfg)
    && (!form.providerAccountId || form.providerAccountId === NO_ACCOUNT)) {
    return 'A genuine provider account must be associated with this endpoint.';
  }
  for (const [purpose, ref] of Object.entries(form.secretRefs)) {
    if (!ref.trim()) continue;
    if (!OMNI_COMMS_ENDPOINT_SECRET_PURPOSES[t].includes(purpose)) {
      return `Secret purpose "${purpose}" is not accepted for this endpoint type.`;
    }
    if (!isValidEndpointSecretRef(ref)) {
      return `Secret reference for "${purpose}" must match OMNI_COMMS_*.`;
    }
  }
  return null;
}

const EndpointDialog: React.FC<{
  open: boolean;
  onOpenChange: (v: boolean) => void;
  channel: OmniCommsEndpointChannel;
  channelName: string;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  client: Client;
  orgId: string;
  departmentId: string | null;
  departmentName: string | null;
  accounts: ChannelEndpointSummary['provider_accounts'];
  onSaved: () => Promise<void> | void;
}> = ({
  open, onOpenChange, channel, channelName, form, setForm, client, orgId,
  departmentId, departmentName, accounts, onSaved,
}) => {
  const [saving, setSaving] = useState(false);
  const types = OMNI_COMMS_ENDPOINT_TYPES_BY_CHANNEL[channel];
  const purposes = OMNI_COMMS_ENDPOINT_SECRET_PURPOSES[form.endpointType];
  const required = OMNI_COMMS_ENDPOINT_REQUIRED_SECRETS[form.endpointType];

  const setConfig = (patch: Partial<ChannelEndpointConfig>) =>
    setForm((f) => ({ ...f, config: { ...f.config, ...patch } }));

  const save = async () => {
    const problem = validateEndpointForm(channel, form);
    if (problem) { toast.error(problem); return; }
    setSaving(true);
    try {
      await upsertChannelEndpointDraft(client, {
        id: form.id,
        expectedUpdatedAt: form.expectedUpdatedAt,
        organizationId: orgId,
        departmentId: form.scope === ORG_SCOPE ? null : form.scope,
        channel,
        providerAccountId:
          form.providerAccountId === NO_ACCOUNT ? null : form.providerAccountId,
        code: form.code.trim(),
        displayName: form.displayName.trim(),
        endpointType: form.endpointType,
        endpointConfig: form.config,
        secretRefs: Object.fromEntries(
          Object.entries(form.secretRefs)
            .filter(([, v]) => v.trim().length > 0)
            .map(([k, v]) => [k, v.trim()]),
        ),
      });
      toast.success('Endpoint draft saved');
      onOpenChange(false);
      await onSaved();
    } catch (e) { toastError(e, 'Unable to save endpoint'); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {form.id ? 'Edit' : 'Create'} {channelName.toLowerCase()} endpoint
          </DialogTitle>
          <DialogDescription>
            Saved as a draft. {ENDPOINT_NO_EXTERNAL_CALL_NOTICE}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <Field
            label="Endpoint code"
            value={form.code}
            onChange={(v) => setForm((f) => ({ ...f, code: v }))}
            placeholder="ssb_primary_sending_domain"
          />
          <Field
            label="Display name"
            value={form.displayName}
            onChange={(v) => setForm((f) => ({ ...f, displayName: v }))}
          />
          <SelectField
            label="Endpoint type"
            value={form.endpointType}
            onChange={(v) =>
              setForm((f) => ({
                ...f,
                endpointType: v as OmniCommsEndpointType,
                config: {},
                secretRefs: {},
              }))}
            options={types.map((t) => ({
              value: t, label: OMNI_COMMS_ENDPOINT_TYPE_LABEL[t],
            }))}
          />
          <SelectField
            label="Scope"
            value={form.scope}
            onChange={(v) => setForm((f) => ({ ...f, scope: v }))}
            options={[
              { value: ORG_SCOPE, label: 'Organisation-wide' },
              ...(departmentId
                ? [{ value: departmentId, label: departmentName || 'Department' }]
                : []),
            ]}
          />
          <SelectField
            label="Provider account"
            value={form.providerAccountId}
            onChange={(v) => setForm((f) => ({ ...f, providerAccountId: v }))}
            options={[
              { value: NO_ACCOUNT, label: 'None (internal endpoint)' },
              ...accounts.map((a) => ({
                value: a.id,
                label: `${a.code} — ${a.display_name} (${a.status})`,
              })),
            ]}
          />

          <EndpointTypeFields
            endpointType={form.endpointType}
            config={form.config}
            setConfig={setConfig}
          />

          {purposes.length > 0 ? (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Edge secret references</p>
              <p className="text-xs text-muted-foreground">
                Enter the Edge secret NAME only (must match OMNI_COMMS_*). Credential
                values are never entered or stored here.
              </p>
              {purposes.map((p) => (
                <Field
                  key={p}
                  label={`${p}${required.includes(p) ? ' (required to activate)' : ''}`}
                  value={form.secretRefs[p] ?? ''}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, secretRefs: { ...f.secretRefs, [p]: v } }))}
                  placeholder="OMNI_COMMS_EMAIL_CALLBACK_SIGNING"
                />
              ))}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Save draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const MultiSelectField: React.FC<{
  label: string;
  options: readonly string[];
  selected: string[];
  onToggle: (value: string, on: boolean) => void;
}> = ({ label, options, selected, onToggle }) => (
  <div className="space-y-1">
    <p className="text-sm font-medium">{label}</p>
    <div className="flex flex-wrap gap-3">
      {options.map((o) => (
        <label key={o} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={selected.includes(o)}
            onChange={(e) => onToggle(o, e.target.checked)}
          />
          {o}
        </label>
      ))}
    </div>
  </div>
);

const EndpointTypeFields: React.FC<{
  endpointType: OmniCommsEndpointType;
  config: ChannelEndpointConfig;
  setConfig: (patch: Partial<ChannelEndpointConfig>) => void;
}> = ({ endpointType, config, setConfig }) => {
  switch (endpointType) {
    case 'sending_domain':
      return (
        <>
          <Field
            label="Sending domain"
            value={config.domain_name ?? ''}
            onChange={(v) => setConfig({ domain_name: v })}
            placeholder="mail.socialsecurity.kn"
          />
          <Field
            label="Return-path domain (optional)"
            value={config.return_path_domain ?? ''}
            onChange={(v) => setConfig({ return_path_domain: v })}
            placeholder="bounce.socialsecurity.kn"
          />
          <p className="text-xs text-muted-foreground">
            DNS records are configured with the provider. This screen performs no DNS
            lookup and cannot mark a domain verified.
          </p>
        </>
      );
    case 'event_callback':
      return (
        <>
          <Field
            label="Callback URL"
            value={config.callback_url ?? ''}
            onChange={(v) => setConfig({ callback_url: v })}
            placeholder="https://example.gov.kn/omni-comms/email-events"
          />
          <MultiSelectField
            label="Event types"
            options={OMNI_COMMS_EMAIL_EVENT_TYPES}
            selected={config.event_types ?? []}
            onToggle={(value, on) =>
              setConfig({
                event_types: on
                  ? [...(config.event_types ?? []), value]
                  : (config.event_types ?? []).filter((x) => x !== value),
              })}
          />
        </>
      );
    case 'delivery_callback':
    case 'inbound_callback':
      return (
        <Field
          label="Callback URL"
          value={config.callback_url ?? ''}
          onChange={(v) => setConfig({ callback_url: v })}
          placeholder="https://example.gov.kn/omni-comms/sms-status"
        />
      );
    case 'business_webhook':
      return (
        <>
          <Field
            label="Webhook URL"
            value={config.callback_url ?? ''}
            onChange={(v) => setConfig({ callback_url: v })}
            placeholder="https://example.gov.kn/omni-comms/whatsapp"
          />
          <MultiSelectField
            label="Subscribed fields"
            options={OMNI_COMMS_WHATSAPP_SUBSCRIBED_FIELDS}
            selected={config.subscribed_fields ?? []}
            onToggle={(value, on) =>
              setConfig({
                subscribed_fields: on
                  ? [...(config.subscribed_fields ?? []), value]
                  : (config.subscribed_fields ?? []).filter((x) => x !== value),
              })}
          />
        </>
      );
    case 'realtime_endpoint':
      return (
        <>
          <SelectField
            label="Transport"
            value={config.transport ?? ''}
            onChange={(v) => setConfig({ transport: v })}
            options={OMNI_COMMS_IN_APP_TRANSPORTS.map((t) => ({ value: t, label: t }))}
          />
          <Field
            label="Topic prefix (optional)"
            value={config.topic_prefix ?? ''}
            onChange={(v) => setConfig({ topic_prefix: v })}
            placeholder="omni.notifications"
          />
          <p className="text-xs text-muted-foreground">
            Internal endpoint. No external service is contacted.
          </p>
        </>
      );
    case 'render_service':
      return (
        <>
          <SelectField
            label="Service mode"
            value={config.service_mode ?? ''}
            onChange={(v) => setConfig({ service_mode: v, service_reference: '' })}
            options={OMNI_COMMS_PRINT_SERVICE_MODES.map((m) => ({ value: m, label: m }))}
          />
          <Field
            label={config.service_mode === 'https' ? 'Service URL' : 'Internal service reference'}
            value={config.service_reference ?? ''}
            onChange={(v) => setConfig({ service_reference: v })}
            placeholder={
              config.service_mode === 'https'
                ? 'https://render.example.gov.kn/print'
                : 'internal_pdf_renderer'
            }
          />
          <Field
            label="Health path (optional)"
            value={config.health_path ?? ''}
            onChange={(v) => setConfig({ health_path: v })}
            placeholder="/health"
          />
        </>
      );
    default:
      return null;
  }
};

export default ChannelEndpointsTab;
