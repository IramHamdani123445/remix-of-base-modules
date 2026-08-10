/**
 * Omni-Comms — production Email Sender Catalogue panel (Delivery Setup).
 *
 * Shows the canonical sender profiles the organisation should operate, their
 * purpose, audience and current state, and allows an operator to create the
 * missing production profiles.
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
import { bootstrapSenderCatalogue } from '@/platform/omni-comms/application/senderCatalogueService';
import {
  audienceHint,
  catalogueConflicts,
  catalogueProductionTotal,
  catalogueReadyCount,
  SENDER_CATALOGUE_STATUS_LABEL,
  type SenderCatalogueBootstrapResult,
  type SenderCatalogueEntryStatus,
} from '@/platform/omni-comms/application/senderCatalogueTypes';
import { toastError } from '../channelFormPrimitives';

const STATUS_VARIANT: Record<SenderCatalogueEntryStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  created: 'default',
  existing: 'default',
  will_create: 'secondary',
  conflict: 'destructive',
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

  const conflicts = result ? catalogueConflicts(result) : [];

  return (
    <Card data-testid="oc-sender-catalogue">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Production sender catalogue</CardTitle>
          <CardDescription>
            The canonical set of sender profiles for {domain}. Applying creates only the
            missing production profiles — existing senders are never overwritten and
            conflicts are reported for an operator decision.
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
              disabled={busy}
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
                profiles active · {result.conflicts} conflict(s) · {result.future} future
                profile(s) not required yet
              </span>
            </div>

            {conflicts.length > 0 && (
              <div className="rounded-md border border-destructive/40 p-3 text-sm">
                <p className="font-medium">Operator decision required</p>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {conflicts.map((c) => (
                    <li key={c.sender_code}>
                      {c.sender_code} — {c.detail ?? 'conflicting configuration'} (
                      {c.from_address})
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
                          <div className="text-xs text-muted-foreground mt-1">{e.detail}</div>
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
