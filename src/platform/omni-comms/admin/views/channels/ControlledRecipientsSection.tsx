/**
 * Omni-Comms — controlled test recipients.
 *
 * A test delivery may only ever reach an approved address. This surface is the
 * operator's way to manage that allowlist.
 *
 * Boundaries (permanent): metadata mutation only, through bounded RPCs. No
 * provider contact, no send, no credential material.
 */
import React from 'react';
import { Loader2, Plus, RefreshCcw, Users } from 'lucide-react';
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
import { toast } from 'sonner';
import type { OmniCommsRpcClient } from '@/platform/omni-comms/application/omniCommsRpcErrors';
import {
  getTestRecipientSummary,
  setTestRecipientActive,
  upsertTestRecipient,
  type TestRecipientSummary,
} from '@/platform/omni-comms/application/channelProviderConfigurationService';
import { TEST_VERIFY_RECIPIENT_PURPOSE } from '@/platform/omni-comms/application/testRecipientPurpose';
import { toastError } from './channelFormPrimitives';

export interface ControlledRecipientsSectionProps {
  client: OmniCommsRpcClient;
  orgId: string;
  channel: string;
}

export const ControlledRecipientsSection: React.FC<
  ControlledRecipientsSectionProps
> = ({ client, orgId, channel }) => {
  const [summary, setSummary] = React.useState<TestRecipientSummary | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [label, setLabel] = React.useState('');
  const [address, setAddress] = React.useState('');

  const load = React.useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      setSummary(await getTestRecipientSummary(client, orgId, channel));
    } catch (e) {
      toastError(e, 'Failed to load approved test recipients');
    } finally {
      setLoading(false);
    }
  }, [client, orgId, channel]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const add = React.useCallback(async () => {
    const trimmedLabel = label.trim();
    const trimmedAddress = address.trim();
    if (!trimmedLabel || !trimmedAddress) {
      toast.error('Give the recipient a name and an address.');
      return;
    }
    setSaving(true);
    try {
      await upsertTestRecipient(client, {
        organizationId: orgId,
        channel,
        label: trimmedLabel,
        address: trimmedAddress,
        purpose: TEST_VERIFY_RECIPIENT_PURPOSE,
      });
      toast.success('Approved test recipient saved.');
      setLabel('');
      setAddress('');
      setOpen(false);
      await load();
    } catch (e) {
      toastError(e, 'The test recipient could not be saved');
    } finally {
      setSaving(false);
    }
  }, [client, orgId, channel, label, address, load]);

  const toggle = React.useCallback(
    async (id: string, updatedAt: string, isActive: boolean) => {
      try {
        await setTestRecipientActive(client, {
          id,
          expectedUpdatedAt: updatedAt,
          isActive,
        });
        await load();
      } catch (e) {
        toastError(e, 'The test recipient could not be updated');
      }
    },
    [client, load],
  );

  const canManage = summary?.canManage === true;
  const rows = summary?.recipients ?? [];

  return (
    <Card data-testid="omni-comms-controlled-recipients">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" aria-hidden="true" />
              Approved test recipients
            </CardTitle>
            <CardDescription>
              A test message can only be delivered to an address on this list.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={loading}
              aria-label="Refresh approved test recipients"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCcw className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
            <Button
              size="sm"
              disabled={!canManage}
              onClick={() => setOpen(true)}
              data-testid="omni-comms-add-test-recipient"
            >
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Add recipient
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {loading
              ? 'Loading approved recipients…'
              : 'No approved test recipient exists yet. Add one before running a test delivery.'}
          </p>
        ) : null}
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{row.label}</p>
              <p className="truncate text-xs text-muted-foreground">
                {row.address}
                {row.addressMasked ? ' · masked' : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={row.isActive ? 'secondary' : 'outline'}>
                {row.isActive ? 'Approved' : 'Withdrawn'}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                disabled={!canManage}
                onClick={() => void toggle(row.id, row.updatedAt, !row.isActive)}
              >
                {row.isActive ? 'Withdraw' : 'Approve'}
              </Button>
            </div>
          </div>
        ))}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add an approved test recipient</DialogTitle>
            <DialogDescription>
              Only addresses on this list can receive a controlled test message.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="omni-comms-recipient-label">Name</Label>
              <Input
                id="omni-comms-recipient-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Benefits test mailbox"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="omni-comms-recipient-address">Address</Label>
              <Input
                id="omni-comms-recipient-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="name@example.com"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void add()} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default ControlledRecipientsSection;
