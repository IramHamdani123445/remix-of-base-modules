/**
 * Omni-Comms C1 — channel Bindings tab.
 *
 * Email preserves the existing binding actions (draft, verification recording,
 * activation) and enriches the table using data already returned by the
 * summary RPC. No provider fallback fields are introduced in C1.
 */
import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import type { useOmniCommsRpcClient } from '../../hooks/useOmniCommsRpcClient';
import {
  activateBinding,
  recordBindingVerification,
  upsertBindingDraft,
} from '@/platform/omni-comms/application/channelManagementService';
import type {
  EmailConfigSummary,
} from '@/platform/omni-comms/application/channelManagementTypes';
import { DeferredCapabilityCard, Field, SelectField, toastError } from './channelFormPrimitives';
import { partitionEmailConfig, visibleRecords } from './channelReferenceData';
import { ReferenceDataControls } from './ReferenceDataControls';
import type { ChannelUiDefinition } from './channelUiRegistry';

type Client = ReturnType<typeof useOmniCommsRpcClient>;

export const ChannelBindingsTab: React.FC<{
  definition: ChannelUiDefinition;
  client: Client;
  summary: EmailConfigSummary | null;
  onChanged: () => Promise<void> | void;
}> = ({ definition, client, summary, onChanged }) => {
  if (definition.code !== 'email') {
    return (
      <DeferredCapabilityCard
        testId="omni-comms-bindings-empty-state"
        title={`${definition.name} bindings`}
        description="Identity → Provider account → Priority/fallback"
        bullets={[definition.bindings]}
        footer={`Binding configuration will be implemented in ${definition.accounts.futureBuild}.`}
      />
    );
  }
  return <EmailBindingsPanel client={client} summary={summary} onChanged={onChanged} />;
};

const EmailBindingsPanel: React.FC<{
  client: Client;
  summary: EmailConfigSummary | null;
  onChanged: () => Promise<void> | void;
}> = ({ client, summary, onChanged }) => {
  const [form, setForm] = useState({
    senderId: '', accountId: '', priority: '100', externalRef: '',
  });
  const [busy, setBusy] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const part = partitionEmailConfig({
    accounts: summary?.provider_accounts,
    senders: summary?.sender_identities,
    bindings: summary?.bindings,
  });
  const bindings = visibleRecords(part.bindings, part.referenceBindings, showReference);
  const senders = visibleRecords(part.senders, part.referenceSenders, showReference);
  const accounts = visibleRecords(part.accounts, part.referenceAccounts, showReference);

  const allSenders = summary?.sender_identities ?? [];
  const allAccounts = summary?.provider_accounts ?? [];
  const senderLabel = (id: string) => {
    const s = allSenders.find((x) => x.id === id);
    return s ? `${s.code}${s.from_address ? ` — ${s.from_address}` : ''}` : id;
  };
  const accountLabel = (id: string) => {
    const a = allAccounts.find((x) => x.id === id);
    return a ? a.code : id;
  };

  const create = async () => {
    setBusy(true);
    try {
      const priority = Number.parseInt(form.priority, 10);
      await upsertBindingDraft(client, {
        senderIdentityId: form.senderId,
        providerAccountId: form.accountId,
        priority: Number.isFinite(priority) ? priority : 100,
        externalSenderRef: form.externalRef.trim() || null,
      });
      toast.success('Draft binding created');
      setForm({ senderId: '', accountId: '', priority: '100', externalRef: '' });
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
          <CardTitle>Bind sender to provider account</CardTitle>
          <CardDescription>
            A binding must be verified before it can be activated. Verification is recorded here;
            a later build wires real Resend domain checks.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SelectField label="Sender identity" value={form.senderId}
            onChange={(v) => setForm({ ...form, senderId: v })}
            options={senders.map((s) => ({ value: s.id, label: `${s.code} — ${s.from_address ?? ''}` }))} />
          <SelectField label="Provider account" value={form.accountId}
            onChange={(v) => setForm({ ...form, accountId: v })}
            options={accounts.map((a) => ({ value: a.id, label: `${a.code} (${a.status})` }))} />
          <Field label="Priority" value={form.priority} onChange={(v) => setForm({ ...form, priority: v })} />
          <Field label="External sender ref" value={form.externalRef}
            onChange={(v) => setForm({ ...form, externalRef: v })} placeholder="Resend domain id" />
          <div className="col-span-2">
            <Button disabled={busy || !form.senderId || !form.accountId} onClick={create}>Create draft</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Bindings</CardTitle></CardHeader>
        <CardContent>
          {bindings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bindings yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sender identity</TableHead>
                  <TableHead>Provider account</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>External sender ref</TableHead>
                  <TableHead>Verification</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bindings.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>{senderLabel(b.sender_identity_id)}</TableCell>
                    <TableCell><code>{accountLabel(b.provider_account_id)}</code></TableCell>
                    <TableCell>{b.priority}</TableCell>
                    <TableCell>{b.external_sender_ref ?? '—'}</TableCell>
                    <TableCell><Badge variant="outline">{b.verification_status}</Badge></TableCell>
                    <TableCell><Badge>{b.status}</Badge></TableCell>
                    <TableCell className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline"
                        onClick={async () => {
                          try {
                            await recordBindingVerification(client, b.id, b.updated_at, 'verified');
                            toast.success('Verification recorded: verified');
                            await onChanged();
                          } catch (e) { toastError(e, 'Record failed'); }
                        }}
                      >Mark verified</Button>
                      <Button size="sm" variant="outline"
                        onClick={async () => {
                          try {
                            await recordBindingVerification(client, b.id, b.updated_at, 'failed');
                            toast.success('Verification recorded: failed');
                            await onChanged();
                          } catch (e) { toastError(e, 'Record failed'); }
                        }}
                      >Mark failed</Button>
                      <Button size="sm" disabled={b.status !== 'draft' || b.verification_status !== 'verified'}
                        onClick={async () => {
                          try {
                            await activateBinding(client, b.id, b.updated_at);
                            toast.success('Binding activated');
                            await onChanged();
                          } catch (e) { toastError(e, 'Activate failed'); }
                        }}
                      >Activate</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ChannelBindingsTab;
