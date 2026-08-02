/**
 * Omni-Comms C3A — generic, provider-independent Identities tab.
 *
 * ONE identity administration experience for every database-supported
 * channel (email, sms, whatsapp, push, in_app, print).
 *
 * Boundaries (permanent):
 *   - No provider SDK import, no façade emission call, no request, message,
 *     dispatch job or delivery attempt is created or referenced.
 *   - No endpoint, domain, SPF/DKIM, webhook or callback surface (C3B).
 *   - No identity is ever presented as provider verified.
 *   - Reference/simulation identities are hidden by default, read-only and
 *     excluded from readiness.
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
  getChannelIdentitySummary,
  setChannelIdentityLifecycle,
  upsertChannelIdentityDraft,
} from '@/platform/omni-comms/application/channelIdentityService';
import {
  identityChannelSupported,
  identityChannelValue,
  identityConfigSummary,
  IDENTITY_ACTIVATION_MEANING,
  OMNI_COMMS_IDENTITY_TYPES_BY_CHANNEL,
  OMNI_COMMS_IDENTITY_TYPE_LABEL,
  OMNI_COMMS_PUSH_PLATFORMS,
  OMNI_COMMS_SMS_MESSAGE_CLASSES,
  REFERENCE_IDENTITY_READ_ONLY_HELP,
  type ChannelIdentityConfig,
  type ChannelIdentityRow,
  type ChannelIdentitySummary,
  type OmniCommsIdentityChannel,
  type OmniCommsIdentityType,
} from '@/platform/omni-comms/application/channelIdentityTypes';
import { DeferredCapabilityCard, Field, SelectField, toastError } from './channelFormPrimitives';
import { isReferenceSenderIdentity, visibleRecords } from './channelReferenceData';
import { ReferenceDataBadge, ReferenceDataControls } from './ReferenceDataControls';
import type { ChannelUiDefinition } from './channelUiRegistry';

type Client = ReturnType<typeof useOmniCommsRpcClient>;

const ORG_SCOPE = '__organisation__';

interface FormState {
  id: string | null;
  expectedUpdatedAt: string | null;
  code: string;
  displayName: string;
  scope: string;
  identityType: OmniCommsIdentityType;
  config: ChannelIdentityConfig;
}

function blankForm(channel: OmniCommsIdentityChannel): FormState {
  return {
    id: null,
    expectedUpdatedAt: null,
    code: '',
    displayName: '',
    scope: ORG_SCOPE,
    identityType: OMNI_COMMS_IDENTITY_TYPES_BY_CHANNEL[channel][0],
    config: {},
  };
}

export const ChannelIdentitiesTab: React.FC<{
  definition: ChannelUiDefinition;
  client: Client;
  orgId: string;
  departmentId?: string | null;
  departmentName?: string | null;
  onChanged: () => Promise<void> | void;
}> = ({ definition, client, orgId, departmentId = null, departmentName = null, onChanged }) => {
  if (!identityChannelSupported(definition.code)) {
    return (
      <DeferredCapabilityCard
        testId="omni-comms-identities-empty-state"
        title={`${definition.name} identities`}
        description={definition.identities}
        bullets={[
          `Identity model: ${definition.identities}`,
          'This channel value is not yet supported by the identity schema, so no identity can be created.',
        ]}
        footer={`Identity configuration will be implemented in ${definition.accounts.futureBuild}.`}
      />
    );
  }

  return (
    <GenericIdentitiesPanel
      channel={definition.code as OmniCommsIdentityChannel}
      channelName={definition.name}
      client={client}
      orgId={orgId}
      departmentId={departmentId}
      departmentName={departmentName}
      onChanged={onChanged}
    />
  );
};

const GenericIdentitiesPanel: React.FC<{
  channel: OmniCommsIdentityChannel;
  channelName: string;
  client: Client;
  orgId: string;
  departmentId: string | null;
  departmentName: string | null;
  onChanged: () => Promise<void> | void;
}> = ({ channel, channelName, client, orgId, departmentId, departmentName, onChanged }) => {
  const [summary, setSummary] = useState<ChannelIdentitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showReference, setShowReference] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => blankForm(channel));

  /**
   * C3A closure — reference identities are fetched ONLY when the authorised
   * reference view is active. A normal load asks the server for genuine rows
   * only, so reference rows are never delivered to the browser.
   */
  const load = useCallback(async (includeReference: boolean) => {
    if (!orgId) return;
    setLoading(true);
    try {
      const res = await getChannelIdentitySummary(
        client, orgId, channel, departmentId, includeReference,
      );
      setSummary(res);
    } catch (e) {
      toastError(e, 'Unable to load identities');
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

  const genuine = summary?.identities ?? [];
  const reference = summary?.reference_identities ?? [];
  const referenceCount = summary?.reference_identity_count ?? reference.length;
  const rows = useMemo(
    () => visibleRecords(genuine, reference, showReference),
    [genuine, reference, showReference],
  );

  const openCreate = () => { setForm(blankForm(channel)); setDialogOpen(true); };
  const openEdit = (row: ChannelIdentityRow) => {
    setForm({
      id: row.id,
      expectedUpdatedAt: row.updated_at,
      code: row.code,
      displayName: row.display_name,
      scope: row.department_id ?? ORG_SCOPE,
      identityType:
        (row.identity_type as OmniCommsIdentityType)
        ?? OMNI_COMMS_IDENTITY_TYPES_BY_CHANNEL[channel][0],
      config: { ...(row.identity_config ?? {}) },
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
            <CardTitle>{channelName} identities</CardTitle>
            <CardDescription data-testid="omni-comms-identity-activation-meaning">
              {IDENTITY_ACTIVATION_MEANING}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCcw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button size="sm" onClick={openCreate} data-testid="omni-comms-create-identity">
              <Plus className="h-4 w-4 mr-1" /> Create identity
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading identities…
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="omni-comms-identities-none">
              No {channelName.toLowerCase()} identities are configured for this scope yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Identity</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Channel value</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Configuration</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <IdentityRow
                    key={row.id}
                    row={row}
                    client={client}
                    departmentName={departmentName}
                    onEdit={() => openEdit(row)}
                    onChanged={refreshAll}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <IdentityDialog
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

const IdentityRow: React.FC<{
  row: ChannelIdentityRow;
  client: Client;
  departmentName: string | null;
  onEdit: () => void;
  onChanged: () => Promise<void> | void;
}> = ({ row, client, departmentName, onEdit, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const isReference =
    row.data_origin === 'reference_seed'
    || (!row.data_origin && isReferenceSenderIdentity(row as never));

  const lifecycle = async (action: 'activate' | 'disable' | 'retire') => {
    if (isReference) return;
    let reason: string | null = null;
    if (action === 'retire') {
      reason = window.prompt('Retirement reason (required)')?.trim() || null;
      if (!reason) return;
    }
    setBusy(true);
    try {
      await setChannelIdentityLifecycle(client, {
        id: row.id,
        expectedUpdatedAt: row.updated_at,
        action,
        reason,
      });
      toast.success(`Identity ${action}d`);
      await onChanged();
    } catch (e) { toastError(e, `${action} failed`); }
    finally { setBusy(false); }
  };

  const canActivate = row.status === 'draft' || row.status === 'disabled';
  const activateLabel = row.status === 'disabled' ? 'Reactivate' : 'Activate';

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
        {row.identity_type
          ? OMNI_COMMS_IDENTITY_TYPE_LABEL[row.identity_type] ?? row.identity_type
          : '—'}
      </TableCell>
      <TableCell className="font-mono text-xs break-all">
        {identityChannelValue(row)}
      </TableCell>
      <TableCell className="text-sm">
        {row.department_id ? (departmentName ?? 'Department') : 'Organisation-wide'}
      </TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[row.status] ?? 'outline'}>{row.status}</Badge>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground max-w-xs break-words">
        {identityConfigSummary(row)}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {new Date(row.updated_at).toLocaleString()}
      </TableCell>
      <TableCell>
        {isReference ? (
          <p
            className="text-xs text-muted-foreground max-w-xs"
            data-testid={`omni-comms-reference-identity-readonly-${row.code}`}
          >
            {REFERENCE_IDENTITY_READ_ONLY_HELP}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy || row.status !== 'draft'} onClick={onEdit}>
              Edit draft
            </Button>
            <Button size="sm" disabled={busy || !canActivate} onClick={() => void lifecycle('activate')}>
              {activateLabel}
            </Button>
            <Button
              size="sm" variant="outline"
              disabled={busy || row.status !== 'active'}
              onClick={() => void lifecycle('disable')}
            >
              Disable
            </Button>
            <Button
              size="sm" variant="outline"
              disabled={busy || row.status === 'retired'}
              onClick={() => void lifecycle('retire')}
            >
              Retire
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
};

const IdentityDialog: React.FC<{
  open: boolean;
  onOpenChange: (v: boolean) => void;
  channel: OmniCommsIdentityChannel;
  channelName: string;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  client: Client;
  orgId: string;
  departmentId: string | null;
  departmentName: string | null;
  onSaved: () => Promise<void> | void;
}> = ({
  open, onOpenChange, channel, channelName, form, setForm,
  client, orgId, departmentId, departmentName, onSaved,
}) => {
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  const cfg = (key: string, value: string) =>
    setForm((f) => ({ ...f, config: { ...f.config, [key]: value } }));

  const types = OMNI_COMMS_IDENTITY_TYPES_BY_CHANNEL[channel];

  const scopeOptions = [
    { value: ORG_SCOPE, label: 'Organisation-wide' },
    ...(departmentId
      ? [{ value: departmentId, label: departmentName ?? 'Selected department' }]
      : []),
  ];

  const save = async () => {
    setBusy(true);
    try {
      const config: ChannelIdentityConfig = {};
      for (const [k, v] of Object.entries(form.config)) {
        const t = (v ?? '').trim();
        if (t) config[k] = t;
      }
      await upsertChannelIdentityDraft(client, {
        id: form.id,
        expectedUpdatedAt: form.expectedUpdatedAt,
        organizationId: orgId,
        departmentId: form.scope === ORG_SCOPE ? null : form.scope,
        channel,
        code: form.code.trim(),
        displayName: form.displayName.trim(),
        identityType: form.identityType,
        identityConfig: config,
      });
      toast.success(form.id ? 'Draft identity updated' : 'Draft identity created');
      onOpenChange(false);
      await onSaved();
    } catch (e) { toastError(e, 'Save failed'); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {form.id ? `Edit ${channelName} identity` : `Create ${channelName} identity`}
          </DialogTitle>
          <DialogDescription>{IDENTITY_ACTIVATION_MEANING}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Code" value={form.code} onChange={(v) => set({ code: v })}
            placeholder="primary_sender" />
          <Field label="Display name" value={form.displayName}
            onChange={(v) => set({ displayName: v })} />
          <SelectField label="Scope" value={form.scope}
            onChange={(v) => set({ scope: v })} options={scopeOptions} />

          {types.length > 1 ? (
            <SelectField
              label="Identity type"
              value={form.identityType}
              onChange={(v) => set({ identityType: v as OmniCommsIdentityType, config: {} })}
              options={types.map((t) => ({ value: t, label: OMNI_COMMS_IDENTITY_TYPE_LABEL[t] }))}
            />
          ) : null}

          {channel === 'email' ? (
            <>
              <Field label="From address" value={form.config.from_address ?? ''}
                onChange={(v) => cfg('from_address', v)} placeholder="noreply@your-domain.gov" />
              <Field label="From name" value={form.config.from_name ?? ''}
                onChange={(v) => cfg('from_name', v)} />
              <Field label="Reply-to" value={form.config.reply_to_address ?? ''}
                onChange={(v) => cfg('reply_to_address', v)} />
            </>
          ) : null}

          {channel === 'sms' ? (
            <>
              <Field
                label={form.identityType === 'originating_number'
                  ? 'Originating number (E.164)' : 'Sender ID'}
                value={form.config.sender_value ?? ''}
                onChange={(v) => cfg('sender_value', v)}
                placeholder={form.identityType === 'originating_number' ? '+18695551234' : 'SSBSKN'}
              />
              <Field label="Default country code" value={form.config.default_country_code ?? ''}
                onChange={(v) => cfg('default_country_code', v)} placeholder="+1" />
              <SelectField
                label="Message class"
                value={form.config.message_class ?? ''}
                onChange={(v) => cfg('message_class', v)}
                options={OMNI_COMMS_SMS_MESSAGE_CLASSES.map((m) => ({ value: m, label: m }))}
              />
            </>
          ) : null}

          {channel === 'whatsapp' ? (
            <>
              <Field label="Display number (E.164)" value={form.config.display_number ?? ''}
                onChange={(v) => cfg('display_number', v)} placeholder="+18695551234" />
              <Field label="Phone-number ID" value={form.config.phone_number_id ?? ''}
                onChange={(v) => cfg('phone_number_id', v)} />
              <Field label="Business-account ID" value={form.config.business_account_id ?? ''}
                onChange={(v) => cfg('business_account_id', v)} />
              <Field label="WhatsApp display name" value={form.config.display_name ?? ''}
                onChange={(v) => cfg('display_name', v)} />
            </>
          ) : null}

          {channel === 'push' ? (
            <>
              <Field label="Application code" value={form.config.application_code ?? ''}
                onChange={(v) => cfg('application_code', v)} placeholder="ssb_citizen_app" />
              <SelectField
                label="Platform"
                value={form.config.platform ?? ''}
                onChange={(v) => cfg('platform', v)}
                options={OMNI_COMMS_PUSH_PLATFORMS.map((p) => ({ value: p, label: p }))}
              />
              <Field label="Package or bundle ID" value={form.config.package_or_bundle_id ?? ''}
                onChange={(v) => cfg('package_or_bundle_id', v)} />
            </>
          ) : null}

          {channel === 'in_app' ? (
            <>
              <Field label="Application code" value={form.config.application_code ?? ''}
                onChange={(v) => cfg('application_code', v)} placeholder="ssb_admin" />
              <Field label="Application display name" value={form.config.display_name ?? ''}
                onChange={(v) => cfg('display_name', v)} />
              <Field label="Icon key" value={form.config.icon_key ?? ''}
                onChange={(v) => cfg('icon_key', v)} />
              <Field label="Default category" value={form.config.default_category ?? ''}
                onChange={(v) => cfg('default_category', v)} />
            </>
          ) : null}

          {channel === 'print' ? (
            <>
              <Field label="Issuing authority" value={form.config.issuing_authority ?? ''}
                onChange={(v) => cfg('issuing_authority', v)} />
              <Field label="Letterhead code" value={form.config.letterhead_code ?? ''}
                onChange={(v) => cfg('letterhead_code', v)} />
              <Field label="Document profile" value={form.config.document_profile ?? ''}
                onChange={(v) => cfg('document_profile', v)} />
              <Field label="Return address" value={form.config.return_address ?? ''}
                onChange={(v) => cfg('return_address', v)} />
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy} data-testid="omni-comms-save-identity">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ChannelIdentitiesTab;
