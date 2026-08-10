/**
 * Omni-Comms — Email "Sender Addresses" operator screen.
 *
 * Full administration/master-data surface: add, view, edit, activate,
 * disable, reactivate, retire and safe permanent delete, with backend-truth
 * domain readiness, provider readiness visibility, usage visibility and
 * reference-data protection.
 *
 * Boundaries (permanent): no provider SDK, no send behaviour, no provider
 * binding, no delivery route, no controlled recipient, no release control.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, RefreshCcw } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  activateSenderAddress,
  deleteSenderAddress,
  disableSenderAddress,
  getSenderAddressSummary,
  retireSenderAddress,
} from '@/platform/omni-comms/application/senderAddressService';
import {
  isReferenceSender,
  REFERENCE_SENDER_READ_ONLY_HELP,
  SENDER_ADDRESS_SCREEN_DESCRIPTION,
  SENDER_ADDRESS_SCREEN_TITLE,
  senderBlockerAction,
  senderBlockerMessage,
  senderDisplayStatus,
  senderDomainLabel,
  senderProviderLabel,
  senderScopeLabel,
  senderUsageLabel,
  type SenderAddressRow,
  type SenderAddressSummary,
} from '@/platform/omni-comms/application/senderAddressTypes';
import { toastError } from '../channelFormPrimitives';
import { ReferenceDataBadge, ReferenceDataControls } from '../ReferenceDataControls';
import {
  blankSenderForm,
  SenderAddressDialog,
  senderFormFromRow,
  type SenderAddressFormState,
} from './SenderAddressDialog';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  Active: 'default',
  Ready: 'secondary',
  Draft: 'secondary',
  Disabled: 'outline',
  Retired: 'outline',
  'Needs attention': 'outline',
};

type PendingAction =
  | { kind: 'disable' | 'reactivate'; row: SenderAddressRow }
  | { kind: 'retire'; row: SenderAddressRow }
  | { kind: 'delete'; row: SenderAddressRow }
  | null;

export const EmailSenderAddressesPanel: React.FC<{
  client: OmniCommsRpcClient;
  orgId: string;
  departmentId: string | null;
  departmentName: string | null;
  onChanged: () => Promise<void> | void;
}> = ({ client, orgId, departmentId, departmentName, onChanged }) => {
  const [summary, setSummary] = useState<SenderAddressSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showReference, setShowReference] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<SenderAddressFormState>(blankSenderForm);
  const [detail, setDetail] = useState<SenderAddressRow | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [, setSearchParams] = useSearchParams();

  const load = useCallback(async (includeReference: boolean) => {
    if (!orgId) return;
    setLoading(true);
    try {
      setSummary(await getSenderAddressSummary(client, orgId, departmentId, includeReference));
    } catch (e) {
      toastError(e, 'Unable to load sender addresses');
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [client, orgId, departmentId]);

  useEffect(() => { void load(showReference); }, [load, showReference]);

  const refreshAll = useCallback(async () => {
    await load(showReference);
    await onChanged();
  }, [load, showReference, onChanged]);

  const genuine = summary?.senders ?? [];
  const reference = summary?.reference_senders ?? [];
  const rows = useMemo(
    () => (showReference ? [...genuine, ...reference] : genuine),
    [genuine, reference, showReference],
  );

  const goToTab = (tab: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      return next;
    });
  };

  const openCreate = () => { setForm(blankSenderForm()); setDialogOpen(true); };
  const openEdit = (row: SenderAddressRow) => {
    setForm(senderFormFromRow(row));
    setDialogOpen(true);
  };

  const runActivate = async (row: SenderAddressRow) => {
    setBusy(true);
    try {
      await activateSenderAddress(client, row.id, row.updated_at);
      toast.success('Sender activated');
      await refreshAll();
    } catch (e) { toastError(e, 'Unable to activate sender'); }
    finally { setBusy(false); }
  };

  const confirmPending = async () => {
    if (!pending) return;
    const { kind, row } = pending;
    setBusy(true);
    try {
      if (kind === 'disable') {
        await disableSenderAddress(client, row.id, row.updated_at, reason || null);
        toast.success('Sender disabled');
      } else if (kind === 'reactivate') {
        await activateSenderAddress(client, row.id, row.updated_at);
        toast.success('Sender reactivated');
      } else if (kind === 'retire') {
        if (!reason.trim()) { toast.error('A retirement reason is required'); return; }
        await retireSenderAddress(client, row.id, row.updated_at, reason.trim());
        toast.success('Sender retired');
      } else {
        await deleteSenderAddress(client, row.id, row.updated_at);
        toast.success('Sender permanently deleted');
      }
      setPending(null);
      setReason('');
      await refreshAll();
    } catch (e) { toastError(e, 'Action failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <ReferenceDataControls
        hiddenCount={summary?.reference_sender_count ?? 0}
        showReference={showReference}
        onToggle={setShowReference}
      />

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>{SENDER_ADDRESS_SCREEN_TITLE}</CardTitle>
            <CardDescription data-testid="omni-comms-sender-addresses-description">
              {SENDER_ADDRESS_SCREEN_DESCRIPTION}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void load(showReference)} disabled={loading}>
              <RefreshCcw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button size="sm" onClick={openCreate} data-testid="omni-comms-add-sender">
              <Plus className="h-4 w-4 mr-1" /> Add Sender
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading sender addresses…
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="omni-comms-senders-none">
              No sender addresses have been added yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sender</TableHead>
                    <TableHead>Email address</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Domain</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Provider readiness</TableHead>
                    <TableHead>Usage</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const reference = isReferenceSender(row);
                    const status = senderDisplayStatus(row);
                    const blocker = senderBlockerMessage(row.activation_blocker, row.domain_name);
                    const action = senderBlockerAction(row.activation_blocker);
                    return (
                      <TableRow key={row.id} data-testid={`omni-comms-sender-row-${row.code}`}>
                        <TableCell>
                          <p className="text-sm font-medium">{row.display_name}</p>
                          {reference ? <ReferenceDataBadge /> : null}
                        </TableCell>
                        <TableCell className="font-mono text-xs break-all">
                          {row.identity_config?.from_address ?? row.from_address ?? '—'}
                        </TableCell>
                        <TableCell className="text-sm">{senderScopeLabel(row)}</TableCell>
                        <TableCell className="text-sm">{senderDomainLabel(row)}</TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[status] ?? 'outline'}>{status}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{senderProviderLabel(row)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {senderUsageLabel(row)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(row.updated_at).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {reference ? (
                            <p
                              className="text-xs text-muted-foreground max-w-xs"
                              data-testid={`omni-comms-reference-sender-readonly-${row.code}`}
                            >
                              {REFERENCE_SENDER_READ_ONLY_HELP}
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              <Button size="sm" variant="ghost" onClick={() => setDetail(row)}>
                                Open
                              </Button>
                              {row.status !== 'retired' ? (
                                <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
                                  Edit
                                </Button>
                              ) : null}
                              {row.status === 'draft' ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={busy || !row.can_activate}
                                  onClick={() => void runActivate(row)}
                                  data-testid={`omni-comms-sender-activate-${row.code}`}
                                >
                                  Activate
                                </Button>
                              ) : null}
                              {row.status === 'active' ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => { setReason(''); setPending({ kind: 'disable', row }); }}
                                >
                                  Disable
                                </Button>
                              ) : null}
                              {row.status === 'disabled' ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => { setReason(''); setPending({ kind: 'reactivate', row }); }}
                                >
                                  Reactivate
                                </Button>
                              ) : null}
                              {row.status !== 'retired' ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => { setReason(''); setPending({ kind: 'retire', row }); }}
                                >
                                  Retire
                                </Button>
                              ) : null}
                              {row.can_hard_delete ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive"
                                  onClick={() => { setReason(''); setPending({ kind: 'delete', row }); }}
                                  data-testid={`omni-comms-sender-delete-${row.code}`}
                                >
                                  Delete
                                </Button>
                              ) : null}
                            </div>
                          )}
                          {!reference && row.status === 'draft' && blocker ? (
                            <div className="mt-1 text-xs text-muted-foreground max-w-xs">
                              <p data-testid={`omni-comms-sender-blocker-${row.code}`}>
                                Cannot activate — {blocker}
                              </p>
                              {action ? (
                                <button
                                  type="button"
                                  className="underline"
                                  onClick={() => goToTab(action.tab)}
                                >
                                  {action.label}
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <SenderAddressDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        form={form}
        setForm={setForm}
        client={client}
        orgId={orgId}
        departmentId={departmentId}
        departmentName={departmentName}
        existing={genuine}
        onSaved={refreshAll}
      />

      <SenderDetailsDialog
        row={detail}
        onClose={() => setDetail(null)}
        onConfigureDomain={() => { setDetail(null); goToTab('endpoints'); }}
      />

      <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null); }}>
        <DialogContent data-testid="omni-comms-sender-action-dialog">
          <DialogHeader>
            <DialogTitle>
              {pending?.kind === 'delete' ? 'Delete sender?' : null}
              {pending?.kind === 'retire' ? 'Retire sender?' : null}
              {pending?.kind === 'disable' ? 'Disable sender?' : null}
              {pending?.kind === 'reactivate' ? 'Reactivate sender?' : null}
            </DialogTitle>
            <DialogDescription>
              {pending ? `${pending.row.display_name} — ${pending.row.from_address ?? ''}` : ''}
            </DialogDescription>
          </DialogHeader>

          {pending?.kind === 'delete' ? (
            <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
              <li>has no delivery routes;</li>
              <li>has no provider bindings;</li>
              <li>has never been used.</li>
            </ul>
          ) : null}
          {pending?.kind === 'reactivate' ? (
            <p className="text-sm text-muted-foreground">
              Current domain and provider readiness is re-checked before the sender
              becomes operational again.
            </p>
          ) : null}
          {pending?.kind === 'disable' ? (
            <p className="text-sm text-muted-foreground">
              The sender stays in configuration and history, but no new routing may
              select it.
            </p>
          ) : null}
          {pending?.kind === 'retire' || pending?.kind === 'disable' ? (
            <div className="space-y-1">
              <Label htmlFor="sender-action-reason">
                Reason{pending.kind === 'retire' ? '' : ' (optional)'}
              </Label>
              <Input
                id="sender-action-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={pending?.kind === 'delete' ? 'destructive' : 'default'}
              onClick={() => void confirmPending()}
              disabled={busy}
              data-testid="omni-comms-sender-action-confirm"
            >
              {pending?.kind === 'delete' ? 'Delete permanently' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const SenderDetailsDialog: React.FC<{
  row: SenderAddressRow | null;
  onClose: () => void;
  onConfigureDomain: () => void;
}> = ({ row, onClose, onConfigureDomain }) => {
  const [showTechnical, setShowTechnical] = useState(false);
  if (!row) return null;
  const blocker = senderBlockerMessage(row.activation_blocker, row.domain_name);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid="omni-comms-sender-details">
        <DialogHeader>
          <DialogTitle>{row.display_name}</DialogTitle>
          <DialogDescription className="font-mono break-all">
            {row.identity_config?.from_address ?? row.from_address ?? '—'}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Fact label="Status" value={senderDisplayStatus(row)} />
          <Fact label="Scope" value={senderScopeLabel(row)} />
          <Fact label="Domain" value={row.domain_name ?? '—'} />
          <Fact label="Domain readiness" value={senderDomainLabel(row)} />
          <Fact label="Provider association" value={senderProviderLabel(row)} />
          <Fact
            label="Reply-to"
            value={
              row.identity_config?.reply_to_address
              ?? row.reply_to_address
              ?? 'Not configured'
            }
          />
          <Fact label="Created" value={new Date(row.created_at).toLocaleString()} />
          <Fact label="Updated" value={new Date(row.updated_at).toLocaleString()} />
          <Fact label="Usage" value={senderUsageLabel(row)} />
          <Fact
            label="Provider binding"
            value={row.usage_bindings > 0 ? 'Configured' : 'Not configured'}
          />
        </dl>

        {blocker ? (
          <div className="rounded-md border p-3 text-sm space-y-1">
            <p className="font-medium">Cannot activate</p>
            <p className="text-muted-foreground">{blocker}</p>
            {senderBlockerAction(row.activation_blocker) ? (
              <Button size="sm" variant="outline" onClick={onConfigureDomain}>
                Configure domain
              </Button>
            ) : null}
          </div>
        ) : row.status === 'active' && row.usage_bindings === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="omni-comms-sender-next-step">
            Sender ready. Next step: configure Delivery Routing.
          </p>
        ) : null}

        <div>
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => setShowTechnical((v) => !v)}
            data-testid="omni-comms-sender-details-technical"
          >
            {showTechnical ? 'Hide technical details' : 'Technical details'}
          </button>
          {showTechnical ? (
            <div className="mt-2 space-y-1 text-xs font-mono text-muted-foreground break-all">
              <p>sender id: {row.id}</p>
              <p>sender code: {row.code}</p>
              <p>domain endpoint id: {row.channel_endpoint_id ?? '—'}</p>
              <p>data origin: {row.data_origin}</p>
              <p>activated at: {row.activated_at ?? '—'}</p>
              <p>retired at: {row.retired_at ?? '—'}</p>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const Fact: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="text-sm">{value}</dd>
  </div>
);
