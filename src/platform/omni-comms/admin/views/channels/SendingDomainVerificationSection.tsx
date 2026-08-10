/**
 * Omni-Comms — sending-domain verification section.
 *
 * The runtime Resend credential is deliberately sending-only, so it cannot
 * read the provider's domain API. This surface therefore lets an operator
 * record that a domain was verified in the provider's own console, and then
 * asks the TRUSTED SERVER to independently resolve the DNS records the
 * provider requires. Only server-observed evidence marks a domain verified —
 * an administrator statement alone never does.
 *
 * Boundaries (permanent):
 *   - The browser performs no DNS lookup and contacts no provider.
 *   - No credential value is entered, stored or displayed.
 *   - No message, dispatch job or delivery attempt is created; no email is sent.
 */
import React from 'react';
import { CheckCircle2, Globe, Loader2, RefreshCcw, ShieldAlert, XCircle } from 'lucide-react';
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
  DOMAIN_VERIFICATION_RESULT_MESSAGES,
  DOMAIN_VERIFICATION_SOURCE_LABELS,
  DOMAIN_VERIFICATION_STATUS_LABELS,
  getDomainVerificationSummary,
  resendExpectedDnsRecords,
  upsertDomainVerification,
  verifySendingDomain,
  type DomainVerificationRow,
  type DomainVerificationSummary,
  type ExpectedDnsRecord,
} from '@/platform/omni-comms/application/domainVerificationService';
import { toastError } from './channelFormPrimitives';

export const EXTERNAL_VERIFICATION_REQUIRED_HELP =
  'The sending credential is intentionally sending-only, so this platform '
  + 'cannot read the provider\u2019s domain list. Verify the domain in the '
  + 'provider console, then run the DNS check here so the platform proves it '
  + 'independently.';

export const ATTESTATION_NEVER_VERIFIED_HELP =
  'An administrator statement is recorded for audit only. It never marks a '
  + 'domain verified — only DNS records observed by the server can do that.';

export interface SendingDomainVerificationSectionProps {
  client: OmniCommsRpcClient;
  orgId: string;
  /** Sending-domain endpoints the operator may attach a verification to. */
  endpoints: readonly { id: string; code: string; display_name: string }[];
  providerAccountId?: string | null;
  onChanged?: () => void;
}

function statusBadge(row: DomainVerificationRow) {
  if (row.status === 'verified') {
    return (
      <Badge className="gap-1" data-testid={`omni-comms-domain-status-${row.domainName}`}>
        <CheckCircle2 className="h-3 w-3" /> {DOMAIN_VERIFICATION_STATUS_LABELS.verified}
      </Badge>
    );
  }
  if (row.status === 'failed') {
    return (
      <Badge variant="destructive" className="gap-1" data-testid={`omni-comms-domain-status-${row.domainName}`}>
        <XCircle className="h-3 w-3" /> {DOMAIN_VERIFICATION_STATUS_LABELS.failed}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1" data-testid={`omni-comms-domain-status-${row.domainName}`}>
      <ShieldAlert className="h-3 w-3" /> {DOMAIN_VERIFICATION_STATUS_LABELS[row.status]}
    </Badge>
  );
}

export const SendingDomainVerificationSection: React.FC<
  SendingDomainVerificationSectionProps
> = ({ client, orgId, endpoints, providerAccountId, onChanged }) => {
  const [summary, setSummary] = React.useState<DomainVerificationSummary | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [checking, setChecking] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [endpointId, setEndpointId] = React.useState('');
  const [domainName, setDomainName] = React.useState('');
  const [providerReference, setProviderReference] = React.useState('');
  const [attestationOnly, setAttestationOnly] = React.useState(false);
  const [expected, setExpected] = React.useState<ExpectedDnsRecord[]>([]);

  const load = React.useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      setSummary(await getDomainVerificationSummary(client, orgId));
    } catch (err) {
      toastError(err, 'Could not load sending domains.');
    } finally {
      setLoading(false);
    }
  }, [client, orgId]);

  React.useEffect(() => { void load(); }, [load]);

  const openDialog = () => {
    setEndpointId(endpoints[0]?.id ?? '');
    setDomainName('');
    setProviderReference('');
    setAttestationOnly(false);
    setExpected([]);
    setOpen(true);
  };

  const onDomainChange = (value: string) => {
    setDomainName(value);
    setExpected(value.trim() ? resendExpectedDnsRecords(value) : []);
  };

  const save = async () => {
    if (!endpointId || !domainName.trim()) {
      toast.error('Choose a sending-domain endpoint and enter the domain.');
      return;
    }
    setSaving(true);
    try {
      await upsertDomainVerification(client, {
        organizationId: orgId,
        channelEndpointId: endpointId,
        domainName,
        providerAccountId: providerAccountId ?? null,
        verificationSource: attestationOnly
          ? 'external_admin_attestation'
          : 'external_provider_plus_dns',
        claimedStatus: attestationOnly ? 'claimed_verified' : 'verified_in_provider_console',
        providerReference: providerReference.trim() || null,
        expectedDns: expected,
      });
      toast.success('Sending domain recorded. Run the DNS check to prove it.');
      setOpen(false);
      await load();
      onChanged?.();
    } catch (err) {
      toastError(err, 'Could not save the sending domain.');
    } finally {
      setSaving(false);
    }
  };

  const runCheck = async (row: DomainVerificationRow) => {
    setChecking(row.id);
    try {
      const res = await verifySendingDomain({
        organizationId: orgId,
        domainVerificationId: row.id,
      });
      const message = res.detail
        ?? DOMAIN_VERIFICATION_RESULT_MESSAGES[res.code]
        ?? 'DNS check completed.';
      if (res.ok && res.code === 'verified') toast.success(message);
      else if (res.ok) toast.warning(message);
      else toast.error(message);
      await load();
      onChanged?.();
    } catch (err) {
      toastError(err, 'The DNS check could not be completed.');
    } finally {
      setChecking(null);
    }
  };

  const rows = summary?.domains ?? [];
  const canManage = summary?.canManage ?? false;

  return (
    <Card data-testid="omni-comms-sending-domain-verification">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="h-4 w-4" /> Sending domain verification
            </CardTitle>
            <CardDescription>{EXTERNAL_VERIFICATION_REQUIRED_HELP}</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCcw className="mr-2 h-4 w-4" /> Refresh
            </Button>
            <Button
              size="sm"
              onClick={openDialog}
              disabled={!canManage || endpoints.length === 0}
              data-testid="omni-comms-domain-record"
            >
              Record verified domain
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {endpoints.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Create a sending-domain endpoint first, then record how it was verified.
          </p>
        ) : null}

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading domains…
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="omni-comms-domain-none">
            No sending domain has been recorded yet.
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <div
                key={row.id}
                className="rounded-md border p-3 space-y-2"
                data-testid={`omni-comms-domain-row-${row.domainName}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{row.domainName}</p>
                    <p className="text-xs text-muted-foreground">
                      {DOMAIN_VERIFICATION_SOURCE_LABELS[row.verificationSource]}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {statusBadge(row)}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!canManage || checking === row.id}
                      onClick={() => void runCheck(row)}
                      data-testid={`omni-comms-domain-check-${row.domainName}`}
                    >
                      {checking === row.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Run DNS check
                    </Button>
                  </div>
                </div>

                {row.verificationSource === 'external_admin_attestation' ? (
                  <p className="text-xs text-muted-foreground">
                    {ATTESTATION_NEVER_VERIFIED_HELP}
                  </p>
                ) : null}

                <p className="text-xs text-muted-foreground">
                  {row.detail
                    ?? DOMAIN_VERIFICATION_RESULT_MESSAGES[row.resultCode ?? '']
                    ?? 'No DNS check has been run yet.'}
                  {row.dnsCheckedAt
                    ? ` Last checked ${new Date(row.dnsCheckedAt).toLocaleString()}.`
                    : ''}
                </p>

                {row.dnsEvidence.length > 0 ? (
                  <ul className="space-y-1 text-xs">
                    {row.dnsEvidence.map((e, i) => (
                      <li key={`${e.recordType}-${e.name}-${i}`} className="flex items-start gap-2">
                        {e.matched ? (
                          <CheckCircle2 className="mt-0.5 h-3 w-3 text-primary" />
                        ) : (
                          <XCircle className="mt-0.5 h-3 w-3 text-destructive" />
                        )}
                        <span className="break-all">
                          <span className="font-medium">{e.recordType}</span> {e.name} —{' '}
                          {e.matched
                            ? 'matched the expected value'
                            : `expected “${e.expectedValue}”, observed ${
                                e.observed.length ? e.observed.join('; ') : 'nothing'
                              }`}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Record a verified sending domain</DialogTitle>
            <DialogDescription>
              Record the domain you verified in the provider console. Nothing is
              sent, and the platform will still prove the DNS records itself.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="omni-domain-endpoint">Sending-domain endpoint</Label>
              <select
                id="omni-domain-endpoint"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={endpointId}
                onChange={(e) => setEndpointId(e.target.value)}
              >
                {endpoints.map((ep) => (
                  <option key={ep.id} value={ep.id}>{ep.display_name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="omni-domain-name">Domain</Label>
              <Input
                id="omni-domain-name"
                value={domainName}
                placeholder="example.org"
                onChange={(e) => onDomainChange(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="omni-domain-ref">Provider reference (optional)</Label>
              <Input
                id="omni-domain-ref"
                value={providerReference}
                placeholder="Domain id shown in the provider console"
                onChange={(e) => setProviderReference(e.target.value)}
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={attestationOnly}
                onChange={(e) => setAttestationOnly(e.target.checked)}
                data-testid="omni-comms-domain-attestation"
              />
              <span>
                Record as an administrator statement only.
                <span className="block text-xs text-muted-foreground">
                  {ATTESTATION_NEVER_VERIFIED_HELP}
                </span>
              </span>
            </label>
            {expected.length > 0 ? (
              <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1">
                <p className="font-medium">DNS records the server will check</p>
                {expected.map((e, i) => (
                  <p key={i} className="break-all text-muted-foreground">
                    {e.recordType} {e.name} → contains “{e.expectedValue}”
                  </p>
                ))}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save domain
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
