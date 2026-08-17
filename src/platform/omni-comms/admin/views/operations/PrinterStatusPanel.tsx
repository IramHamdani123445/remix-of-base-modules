/**
 * Omni-Comms Print — device status board.
 *
 * Shows every registered production device, whether it is online, offline, in
 * maintenance, retired or in error, and the last job it actually produced.
 * Everything comes from the bounded status RPC; the browser never reads the
 * print tables directly.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Printer } from 'lucide-react';

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

import { useOmniCommsTenant } from '@/platform/omni-comms/context/OmniCommsTenantContext';
import { useOmniCommsRpcClient } from '@/platform/omni-comms/admin/hooks/useOmniCommsRpcClient';
import {
  listPrintEquipmentStatus,
  PRINT_DEVICE_HEALTH_LABELS,
  type PrintDeviceHealth,
} from '@/platform/omni-comms/application/printEquipmentStatusService';

const HEALTH_TONE: Record<PrintDeviceHealth, string> = {
  online: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  offline: 'bg-muted text-muted-foreground',
  error: 'bg-destructive/10 text-destructive',
  maintenance: 'bg-amber-500/10 text-amber-700 dark:text-amber-500',
  retired: 'bg-muted text-muted-foreground',
};

const formatWhen = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : '—';

export const PrinterStatusPanel: React.FC = () => {
  const { organizationId, departmentId } = useOmniCommsTenant();
  const client = useOmniCommsRpcClient();

  const status = useQuery({
    queryKey: ['omni-comms', 'print-device-status', organizationId, departmentId],
    enabled: Boolean(organizationId),
    queryFn: () =>
      listPrintEquipmentStatus(client, {
        organizationId: organizationId as string,
        departmentId: departmentId ?? null,
      }),
    refetchInterval: 60_000,
  });

  const rows = status.data?.items ?? [];

  return (
    <Card data-testid="omni-comms-printer-status-panel">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="flex items-start gap-3">
          <Printer className="mt-1 h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <CardTitle className="text-base">Printer status</CardTitle>
            <CardDescription>
              Registered production devices, their current state and the last
              letter each one produced.
            </CardDescription>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void status.refetch()}
          disabled={status.isFetching}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${status.isFetching ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {status.isLoading && (
          <p className="text-sm text-muted-foreground">Loading devices…</p>
        )}
        {status.isError && (
          <p className="text-sm text-destructive">
            The device status could not be loaded.
          </p>
        )}
        {!status.isLoading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No production devices are registered yet. Register one from the
            printer picker on a print item.
          </p>
        )}

        {rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead>Last job</TableHead>
                <TableHead className="text-right">7-day printed / failed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="font-medium">
                      {row.code} — {row.display_name}
                      {row.is_default && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (default)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {row.location ?? 'Location not recorded'}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={HEALTH_TONE[row.health]}>
                      {PRINT_DEVICE_HEALTH_LABELS[row.health]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.discovery_source === 'ipp_sync'
                      ? formatWhen(row.last_seen_at)
                      : 'Manually registered'}
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.last_job ? (
                      <>
                        <div className="font-medium">
                          {row.last_job.letter_reference ?? row.last_job.print_item_id}
                        </div>
                        <div className="text-muted-foreground">
                          {row.last_job.outcome} · {formatWhen(row.last_job.completed_at)}
                          {row.last_job.failure_reason
                            ? ` · ${row.last_job.failure_reason}`
                            : ''}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">No jobs yet</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    <span className="font-medium">{row.printed_7d}</span>
                    <span className="text-muted-foreground"> / {row.failed_7d}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default PrinterStatusPanel;
