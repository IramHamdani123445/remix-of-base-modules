/**
 * Omni-Comms C4A — generic, provider-independent Bindings tab.
 *
 * ONE binding administration experience for every channel. A binding declares
 * which provider account (and, where the channel models one, which channel
 * endpoint) an approved channel identity may be presented through, plus the
 * priority used by a FUTURE same-channel fallback capability.
 *
 * Boundaries (permanent):
 *   - No provider SDK import, no provider API call, no DNS lookup, no fetch of
 *     a configured URL, and no façade emission call.
 *   - No request, message, dispatch job or delivery attempt is created.
 *   - No credential value is entered, stored or displayed.
 *   - Verification state is READ-ONLY here. Manual administrator verification
 *     was permanently removed; only the provider or a trusted server-side
 *     service can record it.
 *   - Reference/simulation bindings are hidden by default and read-only.
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
  getChannelBindingSummary,
  setChannelBindingLifecycle,
  upsertChannelBindingDraft,
} from '@/platform/omni-comms/application/channelBindingService';
import {
  bindingActivationBlockers,
  bindingEndpointLabel,
  bindingEndpointRequirement,
  bindingScopeLabel,
  isValidBindingExternalRef,
  isValidBindingPriority,
  BINDING_ACTIVATION_MEANING,
  BINDING_PRIORITY_DEFAULT,
  BINDING_PRIORITY_MEANING,
  BINDING_VERIFICATION_LABEL,
  BINDING_VERIFICATION_OWNERSHIP,
  BINDING_VERIFICATION_SOURCE_LABEL,
  REFERENCE_BINDING_READ_ONLY_HELP,
  type BindingEndpointOption,
  type BindingIdentityOption,
  type BindingProviderAccountOption,
  type ChannelBindingRow,
  type ChannelBindingSummary,
  type OmniCommsBindingChannel,
} from '@/platform/omni-comms/application/channelBindingTypes';
import { identityChannelSupported } from '@/platform/omni-comms/application/channelIdentityTypes';
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

const NO_ENDPOINT = '__none__';

export const BINDINGS_NOT_IMPLEMENTED_LABEL =
  'Binding configuration is not modelled for this channel';

/** Truthful statement rendered on every binding surface. */
export const BINDING_NO_EXTERNAL_CALL_NOTICE =
  'This screen stores configuration only. No provider call, DNS lookup or '
  + 'verification request is performed, and no message is sent.';

interface FormState {
  id: string | null;
  expectedUpdatedAt: string | null;
  senderIdentityId: string;
  providerAccountId: string;
  channelEndpointId: string;
  priority: string;
  externalSenderRef: string;
}

function blankForm(): FormState {
  return {
    id: null,
    expectedUpdatedAt: null,
    senderIdentityId: '',
    providerAccountId: '',
    channelEndpointId: NO_ENDPOINT,
    priority: String(BINDING_PRIORITY_DEFAULT),
    externalSenderRef: '',
  };
}

export const ChannelBindingsTab: React.FC<{
  definition: ChannelUiDefinition;
  client?: Client;
  orgId?: string;
  departmentId?: string | null;
  departmentName?: string | null;
  onChanged?: () => Promise<void> | void;
}> = ({ definition, client, orgId, departmentId = null, departmentName = null, onChanged }) => {
  if (!identityChannelSupported(definition.code) || !client || !orgId) {
    return (
      <DeferredCapabilityCard
        testId="omni-comms-bindings-empty-state"
        title={`${definition.name} bindings`}
        description={BINDINGS_NOT_IMPLEMENTED_LABEL}
        bullets={[definition.bindings]}
        footer="No binding record is created, stored or contacted."
      />
    );
  }

  return (
    <GenericBindingsPanel
      channel={definition.code as OmniCommsBindingChannel}
      channelName={definition.name}
      client={client}
      orgId={orgId}
      departmentId={departmentId}
      departmentName={departmentName}
      onChanged={onChanged ?? (() => undefined)}
    />
  );
};

const GenericBindingsPanel: React.FC<{
  channel: OmniCommsBindingChannel;
  channelName: string;
  client: Client;
  orgId: string;
  departmentId: string | null;
  departmentName: string | null;
  onChanged: () => Promise<void> | void;
}> = ({ channel, channelName, client, orgId, departmentId, departmentName, onChanged }) => {
  const [summary, setSummary] = useState<ChannelBindingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showReference, setShowReference] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm);

  /**
   * Reference bindings are fetched ONLY when the reference view is active, so
   * reference rows are never delivered to the browser during normal use.
   */
  const load = useCallback(async (includeReference: boolean) => {
    if (!orgId) return;
    setLoading(true);
    try {
      setSummary(
        await getChannelBindingSummary(client, orgId, channel, departmentId, includeReference),
      );
    } catch (e) {
      toastError(e, 'Unable to load bindings');
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

  const genuine = summary?.bindings ?? [];
  const reference = summary?.reference_bindings ?? [];
  const referenceCount = summary?.reference_binding_count ?? reference.length;
  const rows = useMemo(
    () => visibleRecords(genuine, reference, showReference),
    [genuine, reference, showReference],
  );

  const identities = summary?.identities ?? [];
  const accounts = summary?.provider_accounts ?? [];
  const endpoints = summary?.endpoints ?? [];
  const requirement = bindingEndpointRequirement(channel);

  const { filter, setFilter, filtered } = useResourceFilter(
    rows,
    (r) => [r.identity_code, r.identity_display_name, r.provider_account_code,
      r.provider_account_display_name, r.external_sender_ref],
    (r) => r.status,
  );
  const { resourceId, selectResource, clearResource } = useOmniCommsResourceParam();
  const detailRow = rows.find((r) => r.id === resourceId) ?? null;

  const openCreate = () => { setForm(blankForm()); setDialogOpen(true); };
  const openEdit = (row: ChannelBindingRow) => {
    setForm({
      id: row.id,
      expectedUpdatedAt: row.updated_at,
      senderIdentityId: row.sender_identity_id,
      providerAccountId: row.provider_account_id,
      channelEndpointId: row.channel_endpoint_id ?? NO_ENDPOINT,
      priority: String(row.priority),
      externalSenderRef: row.external_sender_ref ?? '',
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
            <CardTitle>{channelName} bindings</CardTitle>
            <CardDescription data-testid="omni-comms-binding-activation-meaning">
              {BINDING_ACTIVATION_MEANING}
            </CardDescription>
            <p
              className="text-xs text-muted-foreground mt-2"
              data-testid="omni-comms-binding-verification-ownership"
            >
              {BINDING_VERIFICATION_OWNERSHIP}
            </p>
            <p
              className="text-xs text-muted-foreground mt-1"
              data-testid="omni-comms-binding-priority-meaning"
            >
              {BINDING_PRIORITY_MEANING}
            </p>
            <p
              className="text-xs text-muted-foreground mt-1"
              data-testid="omni-comms-binding-no-external-call"
            >
              {BINDING_NO_EXTERNAL_CALL_NOTICE}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline" size="sm"
              onClick={() => void load(showReference)} disabled={loading}
            >
              <RefreshCcw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button size="sm" onClick={openCreate} data-testid="omni-comms-create-binding">
              <Plus className="h-4 w-4 mr-1" /> Create binding
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <ResourceSearchToolbar
            filter={filter}
            onChange={setFilter}
            placeholder="Search bindings by identity or provider account"
            total={rows.length}
            shown={filtered.length}
            testId="omni-comms-bindings-toolbar"
          />
          {loading ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading bindings…
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="omni-comms-bindings-none">
              {rows.length === 0
                ? `No ${channelName.toLowerCase()} bindings are configured for this scope yet.`
                : 'No binding matches the current search or status filter.'}
            </p>
          ) : (
            <ResourceResponsiveList table={(
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Identity</TableHead>
                  <TableHead>Provider account</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Provider reference</TableHead>
                  <TableHead>Verification</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <BindingRow
                    key={row.id}
                    row={row}
                    client={client}
                    identity={identities.find((i) => i.id === row.sender_identity_id)}
                    account={accounts.find((a) => a.id === row.provider_account_id)}
                    endpoint={endpoints.find((e) => e.id === row.channel_endpoint_id)}
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
                testId={`omni-comms-binding-card-${row.id}`}
                title={row.identity_display_name}
                subtitle={row.provider_account_display_name}
                status={row.status}
                fields={[
                  { label: 'Priority', value: String(row.priority) },
                  { label: 'Scope', value: bindingScopeLabel(row) },
                ]}
                actions={(
                  <BindingRowActions
                    row={row}
                    client={client}
                    blockers={bindingActivationBlockers(
                      row,
                      identities.find((i) => i.id === row.sender_identity_id),
                      accounts.find((a) => a.id === row.provider_account_id),
                      endpoints.find((e) => e.id === row.channel_endpoint_id),
                    )}
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
        title={detailRow?.identity_display_name ?? 'Binding'}
        description={detailRow
          ? `${channelName} binding to ${detailRow.provider_account_display_name}`
          : undefined}
        facts={detailRow ? safeLifecycleFacts(detailRow as never) : undefined}
        testId="omni-comms-binding-drawer"
      >
        {detailRow ? (
          <DrawerFacts
            facts={[
              { label: 'Identity', value: detailRow.identity_code },
              { label: 'Provider account', value: detailRow.provider_account_code },
              { label: 'Endpoint', value: bindingEndpointLabel(detailRow) },
              { label: 'Scope', value: bindingScopeLabel(detailRow) },
              { label: 'Priority', value: String(detailRow.priority) },
              { label: 'Status', value: detailRow.status },
              {
                label: 'Verification',
                value: BINDING_VERIFICATION_LABEL[detailRow.verification_status],
              },
            ]}
          />
        ) : null}
      </ResourceDetailsDrawer>

      <BindingDialog
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
        identities={identities}
        accounts={accounts}
        endpoints={endpoints}
        requirement={requirement}
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

export function bindingLifecycleActions(
  row: ChannelBindingRow,
  blockers: readonly string[],
): LifecycleActionDescriptor[] {
  const actions: LifecycleActionDescriptor[] = [];
  if (row.status === 'draft' || row.status === 'disabled') {
    actions.push({
      key: row.status === 'disabled' ? 'reactivate' : 'activate',
      label: row.status === 'disabled' ? 'Reactivate' : 'Activate',
      disabled: blockers.length > 0,
      disabledReason: blockers.join(' '),
    });
  }
  if (row.status === 'active') actions.push({ key: 'disable', label: 'Disable' });
  if (row.status !== 'retired') {
    actions.push({ key: 'retire', label: 'Retire', destructive: true });
  }
  return actions;
}

export const BindingRowActions: React.FC<{
  row: ChannelBindingRow;
  client: Client;
  blockers: readonly string[];
  onEdit: () => void;
  onChanged: () => Promise<void> | void;
  onViewDetails: () => void;
}> = ({ row, client, blockers, onEdit, onChanged, onViewDetails }) => {
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
      await setChannelBindingLifecycle(client, {
        id: row.id,
        expectedUpdatedAt: row.updated_at,
        action,
        reason,
      });
      toast.success(`Binding ${action}d`);
      await onChanged();
    } catch (e) { toastError(e, `${action} failed`); }
    finally { setBusy(false); }
  };

  const dialog = useLifecycleDialog(run);

  return (
    <>
      <ResourceActionMenu
        testId={`omni-comms-binding-actions-${row.id}`}
        label={`Actions for binding ${row.identity_display_name}`}
        disabled={busy || isReference}
        actions={isReference ? [] : bindingLifecycleActions(row, blockers)}
        onSelect={dialog.request}
        onEdit={!isReference && row.status === 'draft' ? onEdit : undefined}
        onViewDetails={onViewDetails}
      />
      <LifecycleActionDialog
        controller={dialog}
        resourceLabel="binding"
        recordLabel={`${row.identity_display_name} → ${row.provider_account_display_name}`}
      />
    </>
  );
};

const BindingRow: React.FC<{
  row: ChannelBindingRow;
  client: Client;
  identity?: BindingIdentityOption;
  account?: BindingProviderAccountOption;
  endpoint?: BindingEndpointOption;
  onEdit: () => void;
  onChanged: () => Promise<void> | void;
  onViewDetails: () => void;
}> = ({ row, client, identity, account, endpoint, onEdit, onChanged, onViewDetails }) => {
  const isReference = row.data_origin === 'reference_seed';
  const blockers = bindingActivationBlockers(row, identity, account, endpoint);

  return (
    <TableRow data-testid={`omni-comms-binding-row-${row.id}`}>
      <TableCell>
        <div className="flex items-center gap-2">
          <div>
            <p className="font-medium">{row.identity_display_name}</p>
            <p className="text-xs text-muted-foreground font-mono">
              {row.identity_value ?? row.identity_code}
            </p>
          </div>
          {isReference ? <ReferenceDataBadge /> : null}
        </div>
      </TableCell>
      <TableCell>
        <p className="text-sm">{row.provider_account_display_name}</p>
        <p className="text-xs text-muted-foreground font-mono">
          {row.adapter_key ?? row.provider_account_code}
        </p>
      </TableCell>
      <TableCell className="text-sm">{bindingEndpointLabel(row)}</TableCell>
      <TableCell className="text-sm">{bindingScopeLabel(row)}</TableCell>
      <TableCell>{row.priority}</TableCell>
      <TableCell className="font-mono text-xs break-all">
        {row.external_sender_ref ?? '—'}
      </TableCell>
      <TableCell>
        <Badge variant="outline" data-testid={`omni-comms-binding-verification-${row.id}`}>
          {BINDING_VERIFICATION_LABEL[row.verification_status]}
        </Badge>
        <p className="text-xs text-muted-foreground mt-1">
          {BINDING_VERIFICATION_SOURCE_LABEL[row.verification_source]}
          {row.verification_result_code ? ` · ${row.verification_result_code}` : ''}
        </p>
      </TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[row.status] ?? 'outline'}>{row.status}</Badge>
      </TableCell>
      <TableCell>
        {isReference ? (
          <p className="text-xs text-muted-foreground" data-testid="omni-comms-binding-reference-help">
            {REFERENCE_BINDING_READ_ONLY_HELP}
          </p>
        ) : (
          <BindingRowActions
            row={row}
            client={client}
            blockers={blockers}
            onEdit={onEdit}
            onChanged={onChanged}
            onViewDetails={onViewDetails}
          />
        )}
      </TableCell>
    </TableRow>
  );
};

const BindingDialog: React.FC<{
  open: boolean;
  onOpenChange: (v: boolean) => void;
  channel: OmniCommsBindingChannel;
  channelName: string;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  client: Client;
  orgId: string;
  departmentId: string | null;
  departmentName: string | null;
  identities: readonly BindingIdentityOption[];
  accounts: readonly BindingProviderAccountOption[];
  endpoints: readonly BindingEndpointOption[];
  requirement: 'required' | 'optional' | 'forbidden';
  onSaved: () => Promise<void> | void;
}> = ({
  open, onOpenChange, channel, channelName, form, setForm, client, orgId,
  departmentId, departmentName, identities, accounts, endpoints, requirement, onSaved,
}) => {
  const [busy, setBusy] = useState(false);
  const priority = Number.parseInt(form.priority, 10);
  const endpointId = form.channelEndpointId === NO_ENDPOINT ? null : form.channelEndpointId;

  /** Endpoints are filtered to the chosen provider account where one applies. */
  const eligibleEndpoints = useMemo(
    () => endpoints.filter(
      (e) => e.provider_account_id === null
        || e.provider_account_id === form.providerAccountId,
    ),
    [endpoints, form.providerAccountId],
  );

  const problems: string[] = [];
  if (!form.senderIdentityId) problems.push('Select a channel identity.');
  if (!form.providerAccountId) problems.push('Select a provider account.');
  if (requirement === 'required' && !endpointId) {
    problems.push(`A ${channelName.toLowerCase()} endpoint is required for this channel.`);
  }
  if (!isValidBindingPriority(priority)) problems.push('Priority must be between 1 and 1000.');
  if (form.externalSenderRef.trim() && !isValidBindingExternalRef(form.externalSenderRef)) {
    problems.push('Provider reference contains unsupported characters.');
  }

  const save = async () => {
    setBusy(true);
    try {
      await upsertChannelBindingDraft(client, {
        id: form.id,
        expectedUpdatedAt: form.expectedUpdatedAt,
        organizationId: orgId,
        departmentId,
        channel,
        senderIdentityId: form.senderIdentityId,
        providerAccountId: form.providerAccountId,
        channelEndpointId: endpointId,
        priority,
        externalSenderRef: form.externalSenderRef.trim() || null,
      });
      toast.success(form.id ? 'Binding draft updated' : 'Binding draft created');
      onOpenChange(false);
      await onSaved();
    } catch (e) { toastError(e, 'Save failed'); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{form.id ? 'Edit binding draft' : `New ${channelName} binding`}</DialogTitle>
          <DialogDescription>
            {BINDING_ACTIVATION_MEANING} {BINDING_NO_EXTERNAL_CALL_NOTICE}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SelectField
            label="Channel identity"
            value={form.senderIdentityId}
            onChange={(v) => setForm((f) => ({ ...f, senderIdentityId: v }))}
            options={identities.map((i) => ({
              value: i.id,
              label: `${i.display_name} — ${i.identity_value ?? i.code} (${i.status})`,
            }))}
          />
          <SelectField
            label="Provider account"
            value={form.providerAccountId}
            onChange={(v) => setForm((f) => ({
              ...f, providerAccountId: v, channelEndpointId: NO_ENDPOINT,
            }))}
            options={accounts.map((a) => ({
              value: a.id,
              label: `${a.display_name} — ${a.adapter_key ?? a.code} (${a.status})`,
            }))}
          />
          {requirement === 'forbidden' ? null : (
            <SelectField
              label={`Channel endpoint${requirement === 'required' ? '' : ' (optional)'}`}
              value={form.channelEndpointId}
              onChange={(v) => setForm((f) => ({ ...f, channelEndpointId: v }))}
              options={[
                ...(requirement === 'optional'
                  ? [{ value: NO_ENDPOINT, label: 'No endpoint' }]
                  : []),
                ...eligibleEndpoints.map((e) => ({
                  value: e.id,
                  label: `${e.display_name} — ${e.endpoint_type} (${e.status})`,
                })),
              ]}
            />
          )}
          <Field
            label="Priority"
            value={form.priority}
            onChange={(v) => setForm((f) => ({ ...f, priority: v }))}
            placeholder="100"
          />
          <Field
            label="Provider identity reference (optional)"
            value={form.externalSenderRef}
            onChange={(v) => setForm((f) => ({ ...f, externalSenderRef: v }))}
            placeholder="Provider-side identifier — never a credential"
          />
          <div className="md:col-span-2 text-xs text-muted-foreground space-y-1">
            <p>{BINDING_PRIORITY_MEANING}</p>
            <p>
              Scope: {departmentId ? (departmentName?.trim() || 'Department') : 'Organisation-wide'}
            </p>
            <p data-testid="omni-comms-binding-dialog-verification-ownership">
              {BINDING_VERIFICATION_OWNERSHIP}
            </p>
          </div>
          {problems.length > 0 ? (
            <ul
              className="md:col-span-2 list-disc pl-5 text-xs text-destructive space-y-1"
              data-testid="omni-comms-binding-problems"
            >
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={busy || problems.length > 0}
            data-testid="omni-comms-save-binding"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Save draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ChannelBindingsTab;
