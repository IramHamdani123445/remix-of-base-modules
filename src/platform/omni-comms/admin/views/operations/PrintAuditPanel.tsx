/**
 * Omni-Comms — Print audit trail.
 *
 * Read-only evidence for every correspondence artefact: letter reference,
 * physical outcome, the device that printed it, pages and the PDF checksum.
 * Everything comes from one bounded Omni-Comms RPC; the browser never reads
 * the print tables directly.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSearch, RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { useOmniCommsTenant } from '@/platform/omni-comms/context/OmniCommsTenantContext';
import { useOmniCommsRpcClient } from '@/platform/omni-comms/admin/hooks/useOmniCommsRpcClient';
import { listPrintAudit } from '@/platform/omni-comms/application/printProductionService';

const PAGE_SIZE = 25;

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

export default function PrintAuditPanel(): JSX.Element {
  const { organizationId, departmentId } = useOmniCommsTenant();
  const client = useOmniCommsRpcClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const audit = useQuery({
    queryKey: [
      'omni-comms',
      'print-audit',
      organizationId,
      departmentId,
      search,
      page,
    ],
    enabled: Boolean(organizationId),
    queryFn: () =>
      listPrintAudit(client, {
        organizationId: organizationId as string,
        departmentId,
        search: search.trim() || null,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
  });

  const rows = audit.data?.items ?? [];
  const total = audit.data?.total ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FileSearch className="h-4 w-4" aria-hidden="true" />
            Print audit
          </CardTitle>
          <CardDescription>
            Every produced letter with its physical outcome, the device used,
            page count and the PDF checksum held on file.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void audit.refetch()}
          disabled={audit.isFetching}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${audit.isFetching ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          value={search}
          placeholder="Search by letter reference or checksum"
          onChange={(event) => {
            setPage(0);
            setSearch(event.target.value);
          }}
          className="max-w-sm"
        />

        {audit.isError ? (
          <p className="text-sm text-destructive">
            Print audit could not be loaded. Refresh to try again.
          </p>
        ) : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Letter</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Device</TableHead>
              <TableHead>Pages</TableHead>
              <TableHead>PDF checksum</TableHead>
              <TableHead>Printed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {audit.isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-sm text-muted-foreground">
                  Loading print audit…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-sm text-muted-foreground">
                  No correspondence artefacts have been produced yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">
                    <div>{row.letter_reference ?? '—'}</div>
                    <div className="text-muted-foreground">
                      {row.recipient_display ?? '—'}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{row.module_code ?? '—'}</div>
                    <div className="text-muted-foreground">
                      {row.event_code ?? '—'}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    <Badge variant="outline">{row.physical_status}</Badge>
                    <div className="mt-1 text-muted-foreground">
                      {row.last_outcome ?? 'no attempt yet'}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{row.last_equipment_name ?? row.last_equipment_reference ?? '—'}</div>
                    <div className="text-muted-foreground">
                      {row.attempt_count ?? 0} attempt(s)
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">{row.page_count ?? '—'}</TableCell>
                  <TableCell className="font-mono text-[11px] break-all">
                    {row.checksum_sha256 ?? '—'}
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{formatTimestamp(row.last_printed_at)}</div>
                    <div className="text-muted-foreground">
                      Queued {formatTimestamp(row.queued_for_print_at)}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {total} artefact(s) · page {page + 1}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={(page + 1) * PAGE_SIZE >= total}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
