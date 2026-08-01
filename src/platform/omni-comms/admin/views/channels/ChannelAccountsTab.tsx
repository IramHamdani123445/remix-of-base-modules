/**
 * Omni-Comms C1 — channel Accounts tab.
 *
 * Email keeps the full existing account functionality (draft creation, Resend
 * credential verification, manual evidence, activation) unchanged; all writes
 * go through the existing RPC wrappers. Other channels render a truthful,
 * mutation-free empty state.
 */
import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import type { useOmniCommsRpcClient } from '../../hooks/useOmniCommsRpcClient';
import {
  activateProviderAccount,
  recordProviderAccountCredentialCheck,
  upsertProviderAccountDraft,
} from '@/platform/omni-comms/application/channelManagementService';
import type {
  EmailConfigSummary,
  ProviderAccountRow,
} from '@/platform/omni-comms/application/channelManagementTypes';
import {
  PROVIDER_VERIFICATION_MESSAGES,
  verifyProviderCredentials,
} from '@/platform/omni-comms/application/providerVerificationService';
import { Detail, DeferredCapabilityCard, Field, toastError } from './channelFormPrimitives';
import { partitionEmailConfig, visibleRecords } from './channelReferenceData';
import { ReferenceDataBadge, ReferenceDataControls } from './ReferenceDataControls';
import { isReferenceProviderAccount } from './channelReferenceData';
import type { ChannelUiDefinition } from './channelUiRegistry';

type Client = ReturnType<typeof useOmniCommsRpcClient>;

export const ChannelAccountsTab: React.FC<{
  definition: ChannelUiDefinition;
  client: Client;
  orgId: string;
  summary: EmailConfigSummary | null;
  onChanged: () => Promise<void> | void;
}> = ({ definition, client, orgId, summary, onChanged }) => {
  if (definition.code !== 'email') {
    return (
      <DeferredCapabilityCard
        testId="omni-comms-accounts-empty-state"
        title={`${definition.name} provider accounts`}
        description={definition.accounts.meaning}
        bullets={definition.accounts.examples}
        footer={`Provider account configuration will be implemented in ${definition.accounts.futureBuild}. No account can be created here.`}
      />
    );
  }
  return <EmailAccountsPanel client={client} orgId={orgId} summary={summary} onChanged={onChanged} />;
};

const EmailAccountsPanel: React.FC<{
  client: Client;
  orgId: string;
  summary: EmailConfigSummary | null;
  onChanged: () => Promise<void> | void;
}> = ({ client, orgId, summary, onChanged }) => {
  const [form, setForm] = useState({
    code: '', displayName: '', secretRef: '', region: '', sandboxMode: false,
  });
  const [busy, setBusy] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const part = partitionEmailConfig({ accounts: summary?.provider_accounts });
  const accounts = visibleRecords(part.accounts, part.referenceAccounts, showReference);

  const create = async () => {
    setBusy(true);
    try {
      await upsertProviderAccountDraft(client, {
        organizationId: orgId,
        code: form.code.trim(),
        displayName: form.displayName.trim(),
        secretRef: form.secretRef.trim(),
        region: form.region.trim() || null,
        sandboxMode: form.sandboxMode,
      });
      toast.success('Draft account created');
      setForm({ code: '', displayName: '', secretRef: '', region: '', sandboxMode: false });
      await onChanged();
    } catch (e) { toastError(e, 'Create failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <ReferenceDataControls
        hiddenCount={part.hiddenCount}
        showReference={showReference}
        onToggle={setShowReference}
      />

      <Card>
        <CardHeader>
          <CardTitle>New provider account (draft)</CardTitle>
          <CardDescription>
            Secret is a reference, not a raw key. Only Resend references are accepted and
            must match <code>^OMNI_COMMS_RESEND_[A-Z0-9]+(?:_[A-Z0-9]+)*$</code>
            (for example <code>OMNI_COMMS_RESEND_PRIMARY</code>).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} />
          <Field label="Display name" value={form.displayName} onChange={(v) => setForm({ ...form, displayName: v })} />
          <Field label="Secret ref" value={form.secretRef} onChange={(v) => setForm({ ...form, secretRef: v })}
            placeholder="OMNI_COMMS_RESEND_PRIMARY" />
          <Field label="Region" value={form.region} onChange={(v) => setForm({ ...form, region: v })}
            placeholder="eu-west-1" />
          <div className="flex items-center gap-2 col-span-2">
            <Switch checked={form.sandboxMode} onCheckedChange={(v) => setForm({ ...form, sandboxMode: v })} />
            <Label>Sandbox mode</Label>
          </div>
          <div className="col-span-2">
            <Button disabled={busy} onClick={create}>Create draft account</Button>
          </div>
        </CardContent>
      </Card>

      <ResendAccountSection orgId={orgId} accounts={accounts} onChanged={onChanged} />

      <Card>
        <CardHeader><CardTitle>Provider accounts</CardTitle></CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No accounts yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead><TableHead>Status</TableHead><TableHead>Health</TableHead>
                  <TableHead>Region</TableHead><TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((a) => (
                  <AccountRow key={a.id} account={a} client={client} onChanged={onChanged} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

// ─── Resend Account (Step 1) ────────────────────────────────────────
// Provider-account configuration state + server-side credential verification.
// The API key itself is never requested, displayed, returned or logged; only
// the bounded secret REFERENCE name is shown.
const ResendAccountSection: React.FC<{
  orgId: string;
  accounts: ProviderAccountRow[];
  onChanged: () => Promise<void> | void;
}> = ({ orgId, accounts, onChanged }) => {
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const verify = async (account: ProviderAccountRow) => {
    setVerifyingId(account.id);
    setLastMessage(null);
    try {
      const res = await verifyProviderCredentials({
        organizationId: orgId,
        providerAccountId: account.id,
      });
      const message =
        PROVIDER_VERIFICATION_MESSAGES[res.code] ??
        'Verification could not be completed.';
      setLastMessage(message);
      if (res.ok) toast.success(message); else toast.error(message);
      await onChanged();
    } catch {
      const message = PROVIDER_VERIFICATION_MESSAGES.provider_unavailable;
      setLastMessage(message);
      toast.error(message);
    } finally {
      setVerifyingId(null);
    }
  };

  return (
    <Card data-testid="omni-comms-resend-account-section">
      <CardHeader>
        <CardTitle>Resend Account</CardTitle>
        <CardDescription>
          Configuration and credential verification only. The API key lives in
          Edge Function secrets and is never shown here or sent to the browser.
          Verification contacts Resend with a read-only check and sends no email.
          Only secret references matching <code>^OMNI_COMMS_RESEND_[A-Z0-9]+(?:_[A-Z0-9]+)*$</code>
          can be resolved. Manual health evidence is not authoritative and never
          makes this account ready.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No Resend account configured yet. Create a draft account below.
          </p>
        ) : (
          accounts.map((a) => (
            <div key={a.id} className="rounded-md border p-4 space-y-3"
              data-testid={`omni-comms-resend-account-${a.code}`}>
              {isReferenceProviderAccount(a) ? <ReferenceDataBadge /> : null}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <Detail label="Account name" value={a.display_name} />
                <Detail label="Provider code" value="resend" />
                <Detail label="Environment" value={a.sandbox_mode ? 'sandbox' : 'standard'} />
                <Detail label="Secret reference" value={a.secret_ref} mono />
                <Detail label="Account status" value={a.status} />
                <Detail
                  label="Verification status"
                  value={a.verification_status ?? 'unverified'}
                />
                <Detail
                  label="Last verified"
                  value={a.verification_checked_at
                    ? new Date(a.verification_checked_at).toLocaleString()
                    : 'Never'}
                />
                <Detail
                  label="Verification message"
                  value={a.verification_detail ?? '—'}
                />
                <Detail label="Updated" value={new Date(a.updated_at).toLocaleString()} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={verifyingId === a.id}
                  onClick={() => void verify(a)}
                  data-testid={`omni-comms-verify-credentials-${a.code}`}>
                  {verifyingId === a.id
                    ? (<><Loader2 className="h-4 w-4 animate-spin mr-2" />Verifying…</>)
                    : 'Verify credentials'}
                </Button>
                <Button size="sm" variant="outline" disabled={verifyingId === a.id}
                  onClick={() => void onChanged()}>
                  <RefreshCcw className="h-4 w-4 mr-2" />Refresh
                </Button>
                {a.verification_status === 'verified' ? (
                  <Badge variant="outline" className="gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Provider verified
                  </Badge>
                ) : a.verification_status === 'failed' ? (
                  <Badge variant="destructive" className="gap-1">
                    <AlertCircle className="h-3 w-3" /> Verification failed
                  </Badge>
                ) : null}
              </div>
              {lastMessage && verifyingId === null ? (
                <p className="text-sm text-muted-foreground">{lastMessage}</p>
              ) : null}
            </div>
          ))
        )}
        <p className="text-xs text-muted-foreground">
          Live delivery remains unavailable. Verification never sends an email
          and creates no delivery attempt or dispatch job.
        </p>
      </CardContent>
    </Card>
  );
};

const AccountRow: React.FC<{
  account: ProviderAccountRow;
  client: Client;
  onChanged: () => Promise<void> | void;
}> = ({ account, client, onChanged }) => {
  const [busy, setBusy] = useState(false);

  const recordCheck = async (result: 'healthy' | 'degraded' | 'failed') => {
    setBusy(true);
    try {
      await recordProviderAccountCredentialCheck(client, account.id, account.updated_at, result);
      toast.success(`Manual configuration evidence recorded: ${result}`);
      await onChanged();
    } catch (e) { toastError(e, 'Credential check failed'); }
    finally { setBusy(false); }
  };

  const activate = async () => {
    setBusy(true);
    try {
      await activateProviderAccount(client, account.id, account.updated_at);
      toast.success('Account activated');
      await onChanged();
    } catch (e) { toastError(e, 'Activate failed'); }
    finally { setBusy(false); }
  };

  return (
    <TableRow>
      <TableCell>
        <code>{account.code}</code>
        {isReferenceProviderAccount(account) ? <ReferenceDataBadge /> : null}
      </TableCell>
      <TableCell><Badge>{account.status}</Badge></TableCell>
      <TableCell><Badge variant="outline">{account.health_state}</Badge></TableCell>
      <TableCell>{account.region ?? '—'}</TableCell>
      <TableCell className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy}
          onClick={() => recordCheck('healthy')}
          title="Manual configuration evidence — not provider verified">
          Manual evidence: healthy — not provider verified
        </Button>
        <Button size="sm" variant="outline" disabled={busy}
          onClick={() => recordCheck('failed')}
          title="Manual configuration evidence — not provider verified">
          Manual evidence: failed — not provider verified
        </Button>
        <Button size="sm"
          disabled={busy || account.status !== 'draft' || account.verification_status !== "verified"}
          title={account.verification_status !== "verified"
            ? 'Verified Resend credentials are required before activation'
            : undefined}
          onClick={activate}>Activate</Button>
      </TableCell>
    </TableRow>
  );
};

export default ChannelAccountsTab;
