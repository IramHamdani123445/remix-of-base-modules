/**
 * Omni-Comms C1 — channel Identities tab.
 *
 * Email keeps the existing sender-identity creation and activation. Other
 * channels render a channel-specific explanatory empty state with no mutation
 * controls; no fake identities are ever displayed.
 */
import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import type { useOmniCommsRpcClient } from '../../hooks/useOmniCommsRpcClient';
import {
  activateSenderIdentity,
  upsertSenderIdentityDraft,
} from '@/platform/omni-comms/application/channelManagementService';
import type {
  EmailConfigSummary,
  SenderIdentityRow,
} from '@/platform/omni-comms/application/channelManagementTypes';
import { DeferredCapabilityCard, Field, toastError } from './channelFormPrimitives';
import {
  isReferenceSenderIdentity,
  partitionEmailConfig,
  visibleRecords,
} from './channelReferenceData';
import { ReferenceDataBadge, ReferenceDataControls } from './ReferenceDataControls';
import type { ChannelUiDefinition } from './channelUiRegistry';

type Client = ReturnType<typeof useOmniCommsRpcClient>;

export const ChannelIdentitiesTab: React.FC<{
  definition: ChannelUiDefinition;
  client: Client;
  orgId: string;
  summary: EmailConfigSummary | null;
  onChanged: () => Promise<void> | void;
}> = ({ definition, client, orgId, summary, onChanged }) => {
  if (definition.code !== 'email') {
    return (
      <DeferredCapabilityCard
        testId="omni-comms-identities-empty-state"
        title={`${definition.name} identities`}
        description={definition.identities}
        bullets={[`Identity model: ${definition.identities}`]}
        footer={`Identity configuration will be implemented in ${definition.accounts.futureBuild}.`}
      />
    );
  }
  return <EmailIdentitiesPanel client={client} orgId={orgId} summary={summary} onChanged={onChanged} />;
};

const EmailIdentitiesPanel: React.FC<{
  client: Client;
  orgId: string;
  summary: EmailConfigSummary | null;
  onChanged: () => Promise<void> | void;
}> = ({ client, orgId, summary, onChanged }) => {
  const [form, setForm] = useState({
    code: '', displayName: '', fromAddress: '', fromName: '', replyTo: '',
  });
  const [busy, setBusy] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const part = partitionEmailConfig({ senders: summary?.sender_identities });
  const senders = visibleRecords(part.senders, part.referenceSenders, showReference);

  const create = async () => {
    setBusy(true);
    try {
      await upsertSenderIdentityDraft(client, {
        organizationId: orgId,
        code: form.code.trim(),
        displayName: form.displayName.trim(),
        fromAddress: form.fromAddress.trim(),
        fromName: form.fromName.trim() || null,
        replyToAddress: form.replyTo.trim() || null,
      });
      toast.success('Draft sender identity created');
      setForm({ code: '', displayName: '', fromAddress: '', fromName: '', replyTo: '' });
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
          <CardTitle>Email sender identities</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v })} />
          <Field label="Display name" value={form.displayName} onChange={(v) => setForm({ ...form, displayName: v })} />
          <Field label="From address" value={form.fromAddress} onChange={(v) => setForm({ ...form, fromAddress: v })}
            placeholder="noreply@your-domain.gov" />
          <Field label="From name" value={form.fromName} onChange={(v) => setForm({ ...form, fromName: v })} />
          <Field label="Reply-to" value={form.replyTo} onChange={(v) => setForm({ ...form, replyTo: v })} />
          <div className="col-span-2">
            <Button disabled={busy} onClick={create}>Create draft sender</Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Sender identities</CardTitle></CardHeader>
        <CardContent>
          {senders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No senders yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead><TableHead>From</TableHead>
                  <TableHead>Status</TableHead><TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {senders.map((s) => (
                  <SenderRow key={s.id} sender={s} client={client} onChanged={onChanged} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const SenderRow: React.FC<{
  sender: SenderIdentityRow;
  client: Client;
  onChanged: () => Promise<void> | void;
}> = ({ sender, client, onChanged }) => {
  const [busy, setBusy] = useState(false);
  return (
    <TableRow>
      <TableCell>
        <code>{sender.code}</code>
        {isReferenceSenderIdentity(sender) ? <ReferenceDataBadge /> : null}
      </TableCell>
      <TableCell>{sender.from_address}</TableCell>
      <TableCell><Badge>{sender.status}</Badge></TableCell>
      <TableCell>
        <Button
          size="sm"
          disabled={busy || sender.status !== 'draft'}
          onClick={async () => {
            setBusy(true);
            try {
              await activateSenderIdentity(client, sender.id, sender.updated_at);
              toast.success('Sender activated');
              await onChanged();
            } catch (e) { toastError(e, 'Activate failed'); }
            finally { setBusy(false); }
          }}
        >
          Activate
        </Button>
      </TableCell>
    </TableRow>
  );
};

export default ChannelIdentitiesTab;
