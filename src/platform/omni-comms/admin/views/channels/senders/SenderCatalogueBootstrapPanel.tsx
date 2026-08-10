/**
 * Omni-Comms — production Email Sender Catalogue panel (Delivery Setup).
 *
 * Shows the canonical sender profiles the organisation should operate, their
 * purpose, audience, owning department and current state, and allows an
 * operator to create the missing production profiles.
 *
 * Boundaries (permanent): configuration only. No provider SDK, no send
 * behaviour, no event-route mutation, no automatic conflict resolution.
 */
import React, { useState } from 'react';
import { RefreshCcw } from 'lucide-react';
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
  bootstrapSenderCatalogue,
  resolveSenderCatalogueConflict,
  type SenderCatalogueConflictAction,
} from '@/platform/omni-comms/application/senderCatalogueService';
import {
  audienceHint,
  canRenameToCatalogueCode,
  catalogueApplyBlocker,
  catalogueBlocked,
  catalogueConflicts,
  catalogueEntryExplanation,
  catalogueProductionTotal,
  catalogueReadyCount,
  SENDER_CATALOGUE_STATUS_LABEL,
  type SenderCatalogueBootstrapResult,
  type SenderCatalogueEntry,
  type SenderCatalogueEntryStatus,
} from '@/platform/omni-comms/application/senderCatalogueTypes';
import { toastError } from '../channelFormPrimitives';

const STATUS_VARIANT: Record<SenderCatalogueEntryStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  created: 'default',
  existing: 'default',
  existing_equivalent: 'default',
  will_create: 'secondary',
  conflict: 'destructive',
  blocked: 'destructive',
  future_not_required: 'outline',
};

export const SenderCatalogueBootstrapPanel: React.FC<{
  client: OmniCommsRpcClient;
  orgId: string;
  channel?: string;
  domain?: string;
  onChanged?: () => Promise<void> | void;
}> = ({ client, orgId, channel = 'email', domain = 'secureserve.biz', onChanged }) => {
  const [result, setResult] = useState<SenderCatalogueBootstrapResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (apply: boolean) => {
    if (!orgId) return;
    setBusy(true);
    try {
      const res = await bootstrapSenderCatalogue(client, {
        organizationId: orgId,
        apply,
        channel,
        domain,
      });
      setResult(res);
      if (apply) {
        toast.success(
          `Catalogue applied — ${res.created} created, ${res.existing} unchanged, ${res.conflicts} needing a decision`,
        );
        await onChanged?.();
      }
    } catch (e) {
      toastError(e, 'Sender catalogue bootstrap failed');
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (
    entry: SenderCatalogueEntry,
    action: SenderCatalogueConflictAction,
  ) => {
    if (!entry.sender_identity_id) return;
    setBusy(true);
    try {
      await resolveSenderCatalogueConflict(client, {
        organizationId: orgId,
        senderIdentityId: entry.sender_identity_id,
        catalogueSenderCode: entry.sender_code,
        action,
      });
      toast.success('Conflict decision recorded');
      await run(false);
      await onChanged?.();
    } catch (e) {
      toastError(e, 'Conflict decision failed');
    } finally {
      setBusy(false);
    }
  };

  const conflicts = result ? catalogueConflicts(result) : [];
  const blocked = result ? catalogueBlocked(result) : [];
  const applyBlocker = result ? catalogueApplyBlocker(result) : null;

  return (
    <Card data-testid="oc-sender-catalogue">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Production sender catalogue</CardTitle>
          <CardDescription>
            The canonical set of sender profiles for {domain}. Applying creates only the
            missing production profiles — existing senders are never overwritten, profiles
            are only activated when the sending domain is genuinely ready, and conflicts
            are always left to an operator decision.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void run(false)}
            data-testid="oc-sender-catalogue-preview"
          >
            <RefreshCcw className={`h-4 w-4 mr-1 ${busy ? 'animate-spin' : ''}`} />
            Preview catalogue
          </Button>
          {result && !result.applied && (
            <Button
              size="sm"
              disabled={busy || applyBlocker !== null}
              onClick={() => void run(true)}
              data-testid="oc-sender-catalogue-apply"
            >
              Create missing profiles
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!result ? (
          <p className="text-sm text-muted-foreground">
            Preview the catalogue to see which production sender profiles exist, which are
            missing, and which need an operator decision.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={result.domain_ready ? 'default' : 'outline'}>
                {result.domain_ready ? 'DOMAIN READY' : 'DOMAIN NOT READY'}
              </Badge>
              <span className="text-muted-foreground">
                {catalogueReadyCount(result)} of {catalogueProductionTotal(result)} production
                profiles active · {result.conflicts} conflict(s) · {result.blocked} blocked ·{' '}
                {result.future} future profile(s) not required yet
              </span>
            </div>

            {!result.domain_ready && result.domain_readiness_blocker && (
              <p
                className="text-sm text-muted-foreground"
                data-testid="oc-sender-catalogue-domain-blocker"
              >
                Sending domain: {result.domain_readiness_blocker} New profiles will be created
                as drafts and cannot be activated until this is resolved.
              </p>
            )}

            {applyBlocker && (
              <p className="text-sm text-destructive" data-testid="oc-sender-catalogue-apply-blocker">
                {applyBlocker}
              </p>
            )}

            {conflicts.length > 0 && (
              <div className="rounded-md border border-destructive/40 p-3 text-sm space-y-3">
                <p className="font-medium">Operator decision required</p>
                {conflicts.map((c) => (
                  <div key={c.sender_code} className="space-y-1">
                    <div className="text-muted-foreground">
                      {c.sender_code} — {catalogueEntryExplanation(c)} ({c.from_address})
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Usage — routes {c.usage?.routes ?? 0}, messages {c.usage?.messages ?? 0},
                      provider bindings {c.usage?.bindings ?? 0}, module assignments{' '}
                      {c.usage?.module_assignments ?? 0}, tests {c.usage?.tests ?? 0}
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void resolve(c, 'approve_equivalent')}
                        data-testid={`oc-catalogue-approve-${c.sender_code}`}
                      >
                        Treat existing sender as this profile
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || !canRenameToCatalogueCode(c)}
                        onClick={() => void resolve(c, 'rename_to_catalogue_code')}
                        data-testid={`oc-catalogue-rename-${c.sender_code}`}
                      >
                        Rename existing sender to {c.sender_code}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {blocked.length > 0 && (
              <div className="rounded-md border border-destructive/40 p-3 text-sm">
                <p className="font-medium">Missing master data</p>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {blocked.map((b) => (
                    <li key={b.sender_code}>
                      {b.sender_code} — {catalogueEntryExplanation(b)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Profile</TableHead>
                    <TableHead>From address</TableHead>
                    <TableHead>Owning department</TableHead>
                    <TableHead>Audience</TableHead>
                    <TableHead>Purpose</TableHead>
                    <TableHead>Sender status</TableHead>
                    <TableHead>Catalogue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.plan.map((e) => (
                    <TableRow key={e.sender_code} data-testid={`oc-catalogue-row-${e.sender_code}`}>
                      <TableCell className="font-medium">
                        <div>{e.display_name}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {e.sender_code}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs break-all">
                        {e.from_address}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div>
                          {e.department_code
                            ? `${e.department_code}${e.department_resolved ? '' : ' — not found'}`
                            : 'Organisation-wide'}
                        </div>
                        <div className="text-muted-foreground">{e.scope_note}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={e.audience === 'internal' ? 'secondary' : 'outline'}>
                          {e.audience.toUpperCase()}
                        </Badge>
                        <div className="text-xs text-muted-foreground mt-1 max-w-[16rem]">
                          {audienceHint(e.audience)}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-xs">
                        {e.purpose}
                      </TableCell>
                      <TableCell className="text-sm">{e.sender_status ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[e.status] ?? 'outline'}>
                          {SENDER_CATALOGUE_STATUS_LABEL[e.status] ?? e.status}
                        </Badge>
                        {e.detail && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {catalogueEntryExplanation(e)}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
