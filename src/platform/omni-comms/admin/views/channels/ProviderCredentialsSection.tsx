/**
 * Omni-Comms — provider credential administration (write-only).
 *
 * Operators can see WHETHER a credential exists, how it is stored, when it was
 * last rotated and whether it verified. They can replace it. They can never
 * read it back.
 *
 * Boundaries (permanent):
 *   - A credential VALUE travels browser → trusted Edge Function → encrypted
 *     vault, once. It is cleared from component state immediately after
 *     submission and is never logged, echoed or re-rendered.
 *   - Status reads use bounded SECURITY DEFINER RPCs returning metadata only.
 *   - No provider SDK import and no send behaviour lives here.
 */
import React from 'react';
import { KeyRound, Loader2, RefreshCcw, ShieldCheck } from 'lucide-react';
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
  PROVIDER_SECRET_PURPOSE_LABELS,
  PROVIDER_SECRET_STORAGE_LABELS,
  PROVIDER_SECRET_WRITE_MESSAGES,
  getProviderSecretConfiguration,
  writeProviderSecret,
  type ProviderSecretConfiguration,
  type ProviderSecretStatusRow,
} from '@/platform/omni-comms/application/channelProviderConfigurationService';
import { toastError } from './channelFormPrimitives';

export interface ProviderCredentialsSectionProps {
  client: OmniCommsRpcClient;
  orgId: string;
  onChanged?: () => void;
}

interface ReplaceTarget {
  row: ProviderSecretStatusRow;
}

const purposeLabel = (purpose: string): string =>
  PROVIDER_SECRET_PURPOSE_LABELS[purpose] ?? purpose;

export const ProviderCredentialsSection: React.FC<
  ProviderCredentialsSectionProps
> = ({ client, orgId, onChanged }) => {
  const [config, setConfig] = React.useState<ProviderSecretConfiguration | null>(
    null,
  );
  const [loading, setLoading] = React.useState(false);
  const [target, setTarget] = React.useState<ReplaceTarget | null>(null);
  const [value, setValue] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      setConfig(await getProviderSecretConfiguration(client, orgId));
    } catch (e) {
      toastError(e, 'Failed to load provider credentials');
    } finally {
      setLoading(false);
    }
  }, [client, orgId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const closeDialog = React.useCallback(() => {
    // The submitted value never survives the dialog.
    setValue('');
    setTarget(null);
  }, []);

  const submit = React.useCallback(async () => {
    if (!target) return;
    const secretValue = value.trim();
    if (!secretValue) {
      toast.error('Enter the credential value before saving.');
      return;
    }
    setSaving(true);
    try {
      const res = await writeProviderSecret({
        organizationId: orgId,
        providerAccountId: target.row.providerAccountId,
        purpose: target.row.purpose as 'api_key' | 'webhook_signing',
        secretValue,
      });
      const message =
        PROVIDER_SECRET_WRITE_MESSAGES[res.code]
        ?? PROVIDER_SECRET_WRITE_MESSAGES.credential_write_failed;
      if (res.ok) {
        toast.success(message);
        closeDialog();
        await load();
        onChanged?.();
      } else {
        toast.error(message);
      }
    } catch (e) {
      toastError(e, 'The credential could not be saved');
    } finally {
      setSaving(false);
      setValue('');
    }
  }, [target, value, orgId, closeDialog, load, onChanged]);

  const canManage = config?.canManageCredentials === true;
  const rows = config?.secrets ?? [];

  return (
    <Card data-testid="omni-comms-provider-credentials">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              Credentials
            </CardTitle>
            <CardDescription>
              Credentials are stored encrypted and can never be read back — only
              replaced.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh credential status"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCcw className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {loading
              ? 'Loading credential status…'
              : 'No provider account exists yet. Add a provider account first.'}
          </p>
        ) : null}

        {rows.map((row) => (
          <div
            key={`${row.providerAccountId}-${row.purpose}`}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
            data-testid={`omni-comms-credential-${row.purpose}`}
          >
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">
                {row.providerAccountName} · {purposeLabel(row.purpose)}
              </p>
              <p className="text-xs text-muted-foreground">
                {PROVIDER_SECRET_STORAGE_LABELS[row.storageMode] ?? row.storageMode}
                {row.lastRotatedAt
                  ? ` · last replaced ${new Date(row.lastRotatedAt).toLocaleString()}`
                  : ''}
              </p>
              {row.verificationStatus ? (
                <p className="text-xs text-muted-foreground">
                  Verification: {row.verificationStatus}
                  {row.verificationResultCode
                    ? ` (${row.verificationResultCode})`
                    : ''}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={row.configured ? 'secondary' : 'destructive'}>
                {row.configured ? (
                  <>
                    <ShieldCheck className="mr-1 h-3 w-3" aria-hidden="true" />
                    Saved
                  </>
                ) : (
                  'Not set'
                )}
              </Badge>
              <Button
                size="sm"
                variant={row.configured ? 'outline' : 'default'}
                disabled={!canManage}
                title={
                  canManage
                    ? undefined
                    : 'You do not have permission to manage credentials.'
                }
                onClick={() => {
                  setValue('');
                  setTarget({ row });
                }}
                data-testid={`omni-comms-credential-replace-${row.purpose}`}
              >
                {row.configured ? 'Replace' : 'Add'}
              </Button>
            </div>
          </div>
        ))}
      </CardContent>

      <Dialog open={target !== null} onOpenChange={(o) => (o ? null : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {target ? purposeLabel(target.row.purpose) : 'Credential'}
            </DialogTitle>
            <DialogDescription>
              The value is sent once to the secure backend and stored encrypted.
              It is never displayed again. Replacing a credential resets its
              verification status.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="omni-comms-credential-value">Credential value</Label>
            <Input
              id="omni-comms-credential-value"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Paste the value from your provider"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              Save securely
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default ProviderCredentialsSection;
