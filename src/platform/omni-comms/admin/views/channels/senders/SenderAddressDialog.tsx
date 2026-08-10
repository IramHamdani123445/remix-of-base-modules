/**
 * Omni-Comms — Add / Edit Sender dialog (Email).
 *
 * Operator-facing form. The sending domain is DERIVED from the From address
 * and its readiness is read from backend truth; no DNS logic exists here.
 * The technical code is generated and shown only under Technical details.
 *
 * Boundaries: no provider SDK, no send behaviour, no binding or routing.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { toast } from 'sonner';
import { upsertSenderAddressDraft } from '@/platform/omni-comms/application/senderAddressService';
import {
  deriveSenderDomain,
  isValidSenderEmail,
  resolveSenderCode,
  senderDomainLabel,
  type SenderAddressRow,
} from '@/platform/omni-comms/application/senderAddressTypes';
import type { OmniCommsRpcClient } from '@/platform/omni-comms/application/omniCommsRpcErrors';
import { SelectField, toastError } from '../channelFormPrimitives';

const ORG_SCOPE = '__organisation__';

export interface SenderAddressFormState {
  id: string | null;
  expectedUpdatedAt: string | null;
  code: string | null;
  displayName: string;
  fromAddress: string;
  replyToAddress: string;
  scope: string;
}

export function blankSenderForm(): SenderAddressFormState {
  return {
    id: null,
    expectedUpdatedAt: null,
    code: null,
    displayName: '',
    fromAddress: '',
    replyToAddress: '',
    scope: ORG_SCOPE,
  };
}

export function senderFormFromRow(row: SenderAddressRow): SenderAddressFormState {
  return {
    id: row.id,
    expectedUpdatedAt: row.updated_at,
    code: row.code,
    displayName: row.display_name,
    fromAddress: row.identity_config?.from_address ?? row.from_address ?? '',
    replyToAddress:
      row.identity_config?.reply_to_address ?? row.reply_to_address ?? '',
    scope: row.department_id ?? ORG_SCOPE,
  };
}

export const SENDER_SCOPE_ORGANISATION = ORG_SCOPE;

export const SenderAddressDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: SenderAddressFormState;
  setForm: React.Dispatch<React.SetStateAction<SenderAddressFormState>>;
  client: OmniCommsRpcClient;
  orgId: string;
  departmentId: string | null;
  departmentName: string | null;
  /** Existing genuine senders — used for code-collision resolution. */
  existing: readonly SenderAddressRow[];
  onSaved: () => Promise<void> | void;
}> = ({
  open, onOpenChange, form, setForm, client, orgId,
  departmentId, departmentName, existing, onSaved,
}) => {
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<SenderAddressFormState>) =>
    setForm((f) => ({ ...f, ...patch }));

  const isEdit = form.id !== null;
  const domain = deriveSenderDomain(form.fromAddress);
  const emailValid = isValidSenderEmail(form.fromAddress);
  const replyValid =
    form.replyToAddress.trim() === '' || isValidSenderEmail(form.replyToAddress);

  /** Domain readiness comes from a sender that already resolved this domain. */
  const domainFacts = useMemo(
    () => existing.find((r) => r.domain_name === domain && r.channel_endpoint_id) ?? null,
    [existing, domain],
  );

  const code = useMemo(() => {
    if (form.code) return form.code;
    if (!form.displayName.trim()) return '';
    return resolveSenderCode(
      form.displayName,
      existing.map((r) => r.code),
    );
  }, [form.code, form.displayName, existing]);

  const [showTechnical, setShowTechnical] = useState(false);
  useEffect(() => { if (!open) setShowTechnical(false); }, [open]);

  const scopeOptions = [
    { value: ORG_SCOPE, label: 'Organisation-wide' },
    ...(departmentId
      ? [{ value: departmentId, label: departmentName ?? 'Selected department' }]
      : []),
  ];

  const canSave =
    form.displayName.trim().length > 0 && emailValid && replyValid && !busy;

  const save = async () => {
    setBusy(true);
    try {
      await upsertSenderAddressDraft(client, {
        id: form.id,
        expectedUpdatedAt: form.expectedUpdatedAt,
        organizationId: orgId,
        departmentId: form.scope === ORG_SCOPE ? null : form.scope,
        code: code,
        displayName: form.displayName,
        fromAddress: form.fromAddress,
        replyToAddress: form.replyToAddress,
      });
      toast.success(isEdit ? 'Sender updated' : 'Sender created as Draft');
      onOpenChange(false);
      await onSaved();
    } catch (e) {
      toastError(e, 'Unable to save sender');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="omni-comms-sender-dialog">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit sender' : 'Add sender'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Changing the From address returns this sender to Draft so its domain is re-checked.'
              : 'New senders are created as Draft and can be activated once their domain is ready.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="sender-display-name">Display name</Label>
            <Input
              id="sender-display-name"
              value={form.displayName}
              onChange={(e) => set({ displayName: e.target.value })}
              placeholder="Benefits Department"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="sender-from-address">From address</Label>
            <Input
              id="sender-from-address"
              value={form.fromAddress}
              onChange={(e) => set({ fromAddress: e.target.value })}
              placeholder="benefits@secureserve.biz"
            />
            {form.fromAddress.trim() !== '' && !emailValid ? (
              <p className="text-xs text-destructive" data-testid="omni-comms-sender-email-invalid">
                Enter a valid Email address.
              </p>
            ) : null}
          </div>

          <div className="space-y-1">
            <Label htmlFor="sender-reply-to">Reply-to address (optional)</Label>
            <Input
              id="sender-reply-to"
              value={form.replyToAddress}
              onChange={(e) => set({ replyToAddress: e.target.value })}
              placeholder="Leave blank if no monitored mailbox exists"
            />
            {!replyValid ? (
              <p className="text-xs text-destructive">Enter a valid Email address.</p>
            ) : null}
          </div>

          <SelectField
            label="Scope"
            value={form.scope}
            onChange={(v) => set({ scope: v || ORG_SCOPE })}
            options={scopeOptions}
          />

          {domain ? (
            <div
              className="rounded-md border bg-muted/40 p-3 text-sm space-y-1"
              data-testid="omni-comms-sender-domain-preview"
            >
              <p className="font-medium">Sending domain</p>
              <p className="text-muted-foreground">
                {domainFacts ? senderDomainLabel(domainFacts) : `${domain} — Not configured`}
              </p>
              {domainFacts?.provider_account_name ? (
                <p className="text-xs text-muted-foreground">
                  Provider account: {domainFacts.provider_account_name}
                  {domainFacts.domain_association_confirmed
                    ? ' — association confirmed'
                    : ' — association not confirmed'}
                </p>
              ) : null}
            </div>
          ) : null}

          <div>
            <button
              type="button"
              className="text-xs text-muted-foreground underline"
              onClick={() => setShowTechnical((v) => !v)}
              data-testid="omni-comms-sender-technical-toggle"
            >
              {showTechnical ? 'Hide technical details' : 'Technical details'}
            </button>
            {showTechnical ? (
              <p className="mt-2 text-xs font-mono text-muted-foreground">
                sender code: {code || '—'}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!canSave} data-testid="omni-comms-sender-save">
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            {isEdit ? 'Save changes' : 'Create sender'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
