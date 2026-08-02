/**
 * Omni-Comms C2 — generic, provider-independent Accounts tab.
 *
 * ONE coherent account-management experience per channel:
 *   1. one account list;
 *   2. one Create/Edit drawer;
 *   3. one advanced evidence section (explicitly non-authoritative).
 *
 * Boundaries (permanent):
 *   - No provider SDK import.
 *   - No façade emission call, no request/message/job/attempt creation.
 *   - Only bounded secret REFERENCE names are entered or displayed; a raw
 *     credential value is never requested, stored, returned or logged.
 *   - Reference/simulation data is hidden by default and never contributes to
 *     readiness.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Plus, RefreshCcw } from 'lucide-react';
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
  getChannelProviderAccountSummary,
  setChannelProviderAccountLifecycle,
  upsertChannelProviderAccountDraft,
} from '@/platform/omni-comms/application/channelProviderAccountService';
import {
  credentialCompleteness,
  credentialsComplete,
  NO_PROVIDER_ADAPTER_MESSAGE,
  OMNI_COMMS_ACCOUNT_ENVIRONMENTS,
  SECRET_REFERENCE_HELP,
  VERIFICATION_NOT_IMPLEMENTED_MESSAGE,
  verificationImplemented,
  type ChannelProviderAccountRow,
  type ChannelProviderAccountSummary,
  type OmniCommsAccountEnvironment,
  type ProviderCredentialRequirementRow,
} from '@/platform/omni-comms/application/channelProviderAccountTypes';
import {
  PROVIDER_VERIFICATION_MESSAGES,
  verifyProviderCredentials,
} from '@/platform/omni-comms/application/providerVerificationService';
import { recordProviderAccountCredentialCheck } from '@/platform/omni-comms/application/channelManagementService';
import { Detail, DeferredCapabilityCard, Field, SelectField, toastError } from './channelFormPrimitives';
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

/**
 * C2 closure — a `reference_seed` account is read-only and non-operational.
 * It is displayed for demonstration only and is never passed into a mutation.
 */
export const REFERENCE_ACCOUNT_READ_ONLY_HELP =
  'Reference account — read-only and excluded from operational configuration.';

export function isReferenceAccountRow(a: ChannelProviderAccountRow): boolean {
  return a.data_origin === 'reference_seed';
}


interface FormState {
  id: string | null;
  expectedUpdatedAt: string | null;
  providerId: string;
  code: string;
  displayName: string;
  environment: OmniCommsAccountEnvironment;
  region: string;
  accountReference: string;
  secretRefs: Record<string, string>;
}

const EMPTY_FORM: FormState = {
  id: null,
  expectedUpdatedAt: null,
  providerId: '',
  code: '',
  displayName: '',
  environment: 'sandbox',
  region: '',
  accountReference: '',
  secretRefs: {},
};

export const ChannelAccountsTab: React.FC<{
  definition: ChannelUiDefinition;
  client: Client;
  orgId: string;
  /** Retained for signature compatibility; the tab loads its own data. */
  summary?: unknown;
  onChanged: () => Promise<void> | void;
}> = ({ definition, client, orgId, onChanged }) => {
  const [data, setData] = useState<ChannelProviderAccountSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (includeReference: boolean) => {
      if (!orgId) return;
      setLoading(true);
      try {
        setData(
          await getChannelProviderAccountSummary(
            client,
            orgId,
            definition.code,
            includeReference,
          ),
        );
      } catch (e) {
        toastError(e, 'Failed to load provider accounts');
      } finally {
        setLoading(false);
      }
    },
    [client, orgId, definition.code],
  );

  useEffect(() => {
    void load(showReference);
  }, [load, showReference]);

  const refreshAll = useCallback(async () => {
    await load(showReference);
    await onChanged();
  }, [load, showReference, onChanged]);

  const providers = useMemo(
    () => (data?.providers ?? []).filter((p) => p.data_origin !== 'reference_seed'),
    [data],
  );
  const referenceProviders = useMemo(
    () => (data?.providers ?? []).filter((p) => p.data_origin === 'reference_seed'),
    [data],
  );
  const accounts = useMemo(
    () => [
      ...(data?.accounts ?? []),
      ...(showReference ? data?.reference_accounts ?? [] : []),
    ],
    [data, showReference],
  );

  const requirementsFor = useCallback(
    (providerId: string): ProviderCredentialRequirementRow[] =>
      (data?.credential_requirements ?? [])
        .filter((r) => r.provider_id === providerId)
        .sort((a, b) => a.sort_order - b.sort_order || a.purpose.localeCompare(b.purpose)),
    [data],
  );

  const hasInstalledProvider = providers.length > 0;

  const openCreate = () => {
    const providerId = providers[0]?.id ?? '';
    setForm({ ...EMPTY_FORM, providerId, secretRefs: {} });
  };

  const openEdit = (a: ChannelProviderAccountRow) => {
    setForm({
      id: a.id,
      expectedUpdatedAt: a.updated_at,
      providerId: a.provider_id,
      code: a.code,
      displayName: a.display_name,
      environment: a.environment,
      region: a.region ?? '',
      accountReference: a.provider_account_reference ?? '',
      secretRefs: Object.fromEntries(
        a.secret_ref_purposes.map((s) => [s.purpose, s.secret_ref]),
      ),
    });
  };

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      await upsertChannelProviderAccountDraft(client, {
        id: form.id,
        expectedUpdatedAt: form.expectedUpdatedAt,
        organizationId: orgId,
        channel: definition.code,
        providerId: form.providerId,
        code: form.code.trim(),
        displayName: form.displayName.trim(),
        environment: form.environment,
        region: form.region.trim() || null,
        providerAccountReference: form.accountReference.trim() || null,
        secretRefs: requirementsFor(form.providerId).map((r) => ({
          purpose: r.purpose,
          secretRef: (form.secretRefs[r.purpose] ?? '').trim(),
        })),
      });
      toast.success(form.id ? 'Draft account updated' : 'Draft account created');
      setForm(null);
      await refreshAll();
    } catch (e) {
      toastError(e, 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  // ── Channel with no installed provider adapter ────────────────────
  if (!loading && data && !hasInstalledProvider) {
    return (
      <div className="space-y-4" data-testid="omni-comms-accounts-empty-state">
        <DeferredCapabilityCard
          title={`${definition.name} provider accounts`}
          description={NO_PROVIDER_ADAPTER_MESSAGE}
          bullets={definition.accounts.examples}
          footer={`${definition.accounts.meaning} Provider adapters are installed by the platform. No account can be created here. Live delivery remains unavailable.`}
        />
        {referenceProviders.length > 0 && showReference ? (
          <p className="text-xs text-muted-foreground">
            {referenceProviders.length} reference adapter(s) exist for this
            channel. Reference adapters can never be selected for a genuine
            account.
          </p>
        ) : null}
      </div>
    );
  }

  const accountFilter = useResourceFilter(
    accounts,
    (a) => [a.code, a.display_name, a.provider_adapter_key, a.environment],
    (a) => a.status,
  );
  const accountResource = useOmniCommsResourceParam();
  const accountDetail = accounts.find((a) => a.id === accountResource.resourceId) ?? null;

  return (
    <div className="space-y-4" data-testid="omni-comms-accounts-tab">
      <ReferenceDataControls
        hiddenCount={data?.reference_account_count ?? 0}
        showReference={showReference}
        onToggle={setShowReference}
      />

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>{definition.name} provider accounts</CardTitle>
            <CardDescription>
              Organisation accounts for the installed {definition.name.toLowerCase()}{' '}
              provider adapters. Credentials are held in Edge Function secrets;
              only the bounded reference name is stored or displayed here. No
              message can be sent from this screen.
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => void refreshAll()}
              data-testid="omni-comms-accounts-refresh"
            >
              <RefreshCcw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={openCreate}
              data-testid="omni-comms-accounts-create"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create account
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <ResourceSearchToolbar
            filter={accountFilter.filter}
            onChange={accountFilter.setFilter}
            placeholder="Search accounts by code, name or adapter"
            total={accounts.length}
            shown={accountFilter.filtered.length}
            testId="omni-comms-accounts-toolbar"
          />
          {loading && !data ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : accountFilter.filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {accounts.length === 0
                ? 'No provider account exists for this organisation yet.'
                : 'No provider account matches the current search or status filter.'}
            </p>
          ) : (
            <ResourceResponsiveList table={(
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Environment</TableHead>
                  <TableHead>Credentials</TableHead>
                  <TableHead>Verification</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last checked</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accountFilter.filtered.map((a) => (
                  <AccountRow
                    key={a.id}
                    account={a}
                    client={client}
                    orgId={orgId}
                    onEdit={() => openEdit(a)}
                    onChanged={refreshAll}
                    onViewDetails={() => accountResource.selectResource(a.id)}
                  />
                ))}
              </TableBody>
            </Table>
            )} cards={accountFilter.filtered.map((a) => (
              <ResourceRecordCard
                key={a.id}
                testId={`omni-comms-account-card-${a.code}`}
                title={a.display_name}
                subtitle={a.code}
                status={a.status}
                fields={[
                  { label: 'Adapter', value: a.provider_adapter_key },
                  { label: 'Environment', value: a.environment },
                  { label: 'Verification', value: a.verification_status },
                ]}
                actions={(
                  <AccountRowActions
                    account={a}
                    client={client}
                    orgId={orgId}
                    onEdit={() => openEdit(a)}
                    onChanged={refreshAll}
                    onViewDetails={() => accountResource.selectResource(a.id)}
                  />
                )}
                onOpen={() => accountResource.selectResource(a.id)}
              />
            ))} />
          )}
        </CardContent>
      </Card>

      <ResourceDetailsDrawer
        open={accountDetail !== null}
        onOpenChange={(open) => { if (!open) accountResource.clearResource(); }}
        title={accountDetail?.display_name ?? 'Provider account'}
        description={accountDetail
          ? `${definition.name} provider account ${accountDetail.code}`
          : undefined}
        facts={accountDetail ? safeLifecycleFacts(accountDetail as never) : undefined}
        testId="omni-comms-account-drawer"
      >
        {accountDetail ? (
          <DrawerFacts
            facts={[
              { label: 'Adapter', value: accountDetail.provider_adapter_key },
              { label: 'Environment', value: accountDetail.environment },
              { label: 'Status', value: accountDetail.status },
              { label: 'Verification', value: accountDetail.verification_status },
              { label: 'Origin', value: accountDetail.data_origin },
            ]}
          />
        ) : null}
      </ResourceDetailsDrawer>

      <AdvancedEvidenceSection
        accounts={accounts.filter((a) => !isReferenceAccountRow(a))}
        client={client}
        onChanged={refreshAll}
      />


      {form ? (
        <AccountFormDialog
          form={form}
          setForm={setForm}
          providers={providers}
          requirements={requirementsFor(form.providerId)}
          busy={busy}
          onCancel={() => setForm(null)}
          onSave={save}
        />
      ) : null}
    </div>
  );
};

// ─── Account lifecycle actions ──────────────────────────────────────
/**
 * Backend-supported provider-account actions only. A disabled account is
 * offered as "Reactivate" but invokes the existing `activate` operation.
 */
export function accountLifecycleActions(
  account: ChannelProviderAccountRow,
  opts: { verifiable: boolean; complete: boolean },
): LifecycleActionDescriptor[] {
  const actions: LifecycleActionDescriptor[] = [];
  if (opts.verifiable) {
    actions.push({ key: 'verify', label: 'Verify credentials' });
  }
  if (account.status === 'draft' || account.status === 'disabled') {
    const blocked =
      !opts.verifiable
        ? VERIFICATION_NOT_IMPLEMENTED_MESSAGE
        : !opts.complete
          ? 'All required credential references must be configured.'
          : account.verification_status !== 'verified'
            ? 'Verified provider credentials are required before activation.'
            : undefined;
    actions.push({
      key: account.status === 'disabled' ? 'reactivate' : 'activate',
      label: account.status === 'disabled' ? 'Reactivate' : 'Activate',
      disabled: Boolean(blocked),
      disabledReason: blocked,
    });
  }
  if (account.status === 'active') actions.push({ key: 'disable', label: 'Disable' });
  if (account.status !== 'retired') {
    actions.push({ key: 'retire', label: 'Retire', destructive: true });
  }
  return actions;
}

export const AccountRowActions: React.FC<{
  account: ChannelProviderAccountRow;
  client: Client;
  orgId: string;
  onEdit: () => void;
  onChanged: () => Promise<void> | void;
  onViewDetails: () => void;
}> = ({ account, client, orgId, onEdit, onChanged, onViewDetails }) => {
  const [busy, setBusy] = useState(false);
  const isReference = account.data_origin === 'reference_seed';
  const verifiable = verificationImplemented(account.provider_adapter_key);
  const complete = credentialsComplete(account);

  const verify = async () => {
    if (isReference) return;
    setBusy(true);
    try {
      const res = await verifyProviderCredentials({
        organizationId: orgId,
        providerAccountId: account.id,
      });
      const message =
        PROVIDER_VERIFICATION_MESSAGES[res.code]
        ?? 'Verification could not be completed.';
      if (res.ok) toast.success(message);
      else toast.error(message);
      await onChanged();
    } catch {
      toast.error(PROVIDER_VERIFICATION_MESSAGES.provider_unavailable);
    } finally {
      setBusy(false);
    }
  };

  const run = async (
    key: 'activate' | 'reactivate' | 'disable' | 'retire' | 'verify',
    reason: string | null,
  ) => {
    if (isReference) return;
    const action = backendLifecycleAction(key);
    if (action === 'verify') { await verify(); return; }
    setBusy(true);
    try {
      await setChannelProviderAccountLifecycle(client, {
        id: account.id,
        expectedUpdatedAt: account.updated_at,
        action,
        reason,
      });
      toast.success(`Account ${action}d`);
      await onChanged();
    } catch (e) {
      toastError(e, `${action} failed`);
    } finally {
      setBusy(false);
    }
  };

  const dialog = useLifecycleDialog(run);

  return (
    <>
      <ResourceActionMenu
        testId={`omni-comms-account-actions-${account.code}`}
        label={`Actions for ${account.display_name}`}
        disabled={busy || isReference}
        actions={isReference ? [] : accountLifecycleActions(account, { verifiable, complete })}
        onSelect={dialog.request}
        onEdit={!isReference && account.status === 'draft' ? onEdit : undefined}
        onViewDetails={onViewDetails}
      />
      <LifecycleActionDialog
        controller={dialog}
        resourceLabel="provider account"
        recordLabel={`${account.display_name} (${account.code})`}
      />
    </>
  );
};

// ─── Account row ────────────────────────────────────────────────────
const AccountRow: React.FC<{
  account: ChannelProviderAccountRow;
  client: Client;
  orgId: string;
  onEdit: () => void;
  onChanged: () => Promise<void> | void;
  onViewDetails: () => void;
}> = ({ account, client, orgId, onEdit, onChanged, onViewDetails }) => {
  const isReference = account.data_origin === 'reference_seed';
  const verifiable = verificationImplemented(account.provider_adapter_key);


  return (
    <TableRow data-testid={`omni-comms-account-${account.code}`}>
      <TableCell>
        <div className="space-y-1">
          <code>{account.code}</code>
          <p className="text-xs text-muted-foreground">{account.display_name}</p>
          {isReference ? <ReferenceDataBadge /> : null}
        </div>
      </TableCell>
      <TableCell>{account.provider_adapter_key}</TableCell>
      <TableCell>{account.environment}</TableCell>
      <TableCell>
        <div className="space-y-1">
          <span>{credentialCompleteness(account)}</span>
          {account.secret_ref_purposes.map((s) => (
            <p key={s.purpose} className="text-xs font-mono break-all text-muted-foreground">
              {s.purpose}: {s.secret_ref}
            </p>
          ))}
        </div>
      </TableCell>
      <TableCell>
        {!verifiable ? (
          <span className="text-xs text-muted-foreground">
            {VERIFICATION_NOT_IMPLEMENTED_MESSAGE}
          </span>
        ) : account.verification_status === 'verified' ? (
          <Badge variant="outline" className="gap-1">
            <CheckCircle2 className="h-3 w-3" /> verified
          </Badge>
        ) : account.verification_status === 'failed' ? (
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="h-3 w-3" /> failed
          </Badge>
        ) : (
          <Badge variant="outline">{account.verification_status}</Badge>
        )}
      </TableCell>
      <TableCell><Badge>{account.status}</Badge></TableCell>
      <TableCell className="text-xs">
        {account.verification_checked_at
          ? new Date(account.verification_checked_at).toLocaleString()
          : 'Never'}
      </TableCell>
      <TableCell className="text-xs">
        {new Date(account.updated_at).toLocaleString()}
      </TableCell>
      <TableCell>
        {isReference ? (
          <p
            className="text-xs text-muted-foreground max-w-xs"
            data-testid={`omni-comms-reference-readonly-${account.code}`}
          >
            {REFERENCE_ACCOUNT_READ_ONLY_HELP}
          </p>
        ) : (
          <AccountRowActions
            account={account}
            client={client}
            orgId={orgId}
            onEdit={onEdit}
            onChanged={onChanged}
            onViewDetails={onViewDetails}
          />
        )}
      </TableCell>
    </TableRow>
  );
};


// ─── Create / Edit drawer ───────────────────────────────────────────
const AccountFormDialog: React.FC<{
  form: FormState;
  setForm: (f: FormState) => void;
  providers: { id: string; code: string; display_name: string }[];
  requirements: ProviderCredentialRequirementRow[];
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
}> = ({ form, setForm, providers, requirements, busy, onCancel, onSave }) => (
  <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
    <DialogContent className="max-w-2xl" data-testid="omni-comms-account-form">
      <DialogHeader>
        <DialogTitle>
          {form.id ? 'Edit draft provider account' : 'Create provider account'}
        </DialogTitle>
        <DialogDescription>
          {SECRET_REFERENCE_HELP} Credential values live in Edge Function
          secrets and are never entered, stored or displayed here.
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <SelectField
          label="Provider"
          value={form.providerId}
          onChange={(v) => setForm({ ...form, providerId: v, secretRefs: {} })}
          options={providers.map((p) => ({ value: p.id, label: p.display_name }))}
        />
        <Field
          label="Code"
          value={form.code}
          onChange={(v) => setForm({ ...form, code: v })}
          placeholder="primary_email"
        />
        <Field
          label="Display name"
          value={form.displayName}
          onChange={(v) => setForm({ ...form, displayName: v })}
        />
        <SelectField
          label="Environment"
          value={form.environment}
          onChange={(v) =>
            setForm({ ...form, environment: v as OmniCommsAccountEnvironment })
          }
          options={OMNI_COMMS_ACCOUNT_ENVIRONMENTS.map((e) => ({ value: e, label: e }))}
        />
        <Field
          label="Region"
          value={form.region}
          onChange={(v) => setForm({ ...form, region: v })}
          placeholder="eu-west-1"
        />
        <Field
          label="Provider account reference"
          value={form.accountReference}
          onChange={(v) => setForm({ ...form, accountReference: v })}
          placeholder="optional provider-side account or project id"
        />
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">Credential references</p>
        <p className="text-xs text-muted-foreground">
          Resend references are restricted to{' '}
          <code>^OMNI_COMMS_RESEND_[A-Z0-9]+(?:_[A-Z0-9]+)*$</code>. Each
          installed provider declares its own accepted pattern below.
        </p>
        {requirements.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Select a provider to see its credential requirements.
          </p>
        ) : (

          requirements.map((r) => (
            <div key={r.purpose} className="space-y-1">
              <Field
                label={`${r.display_name} (${r.purpose})${r.required ? ' *' : ''}`}
                value={form.secretRefs[r.purpose] ?? ''}
                onChange={(v) =>
                  setForm({ ...form, secretRefs: { ...form.secretRefs, [r.purpose]: v } })
                }
                placeholder="OMNI_COMMS_RESEND_PRIMARY"
              />
              <p className="text-xs text-muted-foreground">
                {SECRET_REFERENCE_HELP} Accepted pattern:{' '}
                <code>{r.secret_ref_pattern}</code>
              </p>
            </div>
          ))
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          onClick={onSave}
          disabled={busy || !form.providerId || requirements.length === 0}
          data-testid="omni-comms-account-save"
        >
          {form.id ? 'Save draft' : 'Create draft'}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

// ─── Advanced, explicitly non-authoritative evidence ────────────────
const AdvancedEvidenceSection: React.FC<{
  accounts: ChannelProviderAccountRow[];
  client: Client;
  onChanged: () => Promise<void> | void;
}> = ({ accounts, client, onChanged }) => {
  const [busy, setBusy] = useState(false);
  // reference accounts never expose manual evidence controls
  const operational = accounts.filter((a) => !isReferenceAccountRow(a));
  if (operational.length === 0) return null;


  const record = async (
    account: ChannelProviderAccountRow,
    result: 'healthy' | 'failed',
  ) => {
    setBusy(true);
    try {
      await recordProviderAccountCredentialCheck(
        client,
        account.id,
        account.updated_at,
        result,
      );
      toast.success(`Manual configuration evidence recorded: ${result}`);
      await onChanged();
    } catch (e) {
      toastError(e, 'Credential check failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="omni-comms-accounts-advanced-evidence">
      <CardHeader>
        <CardTitle>Advanced — manual evidence</CardTitle>
        <CardDescription>
          Manual health evidence is not authoritative. It never verifies a
          provider, never contributes to readiness and can never activate an
          account. Live delivery remains unavailable.
        </CardDescription>

      </CardHeader>
      <CardContent className="space-y-3">
        {operational.map((a) => (

          <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
            <Detail label="Account" value={a.code} />
            <Detail label="Health (non-authoritative)" value={a.health_state} />
            <Detail
              label="Health checked"
              value={a.health_checked_at ? new Date(a.health_checked_at).toLocaleString() : 'Never'}
            />
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => void record(a, 'healthy')}>
              Record evidence: healthy — not provider verified
            </Button>
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => void record(a, 'failed')}>
              Record evidence: failed — not provider verified
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

export default ChannelAccountsTab;
