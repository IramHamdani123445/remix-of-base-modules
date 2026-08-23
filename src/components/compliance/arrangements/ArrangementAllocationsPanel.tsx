/**
 * Canonical payment allocation trail for a single arrangement.
 * Shows how each posted payment was attributed to installments and to the
 * covered liability behind them. Read-only.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertCircle, Coins } from 'lucide-react';
import { formatDateForDisplay } from '@/lib/format-config';
import {
  fetchAllocationTrail,
  type AllocationTrailRow,
} from '@/services/compliance/arrangementRegisterService';
import { formatXCD } from './arrangementFormat';

interface Props {
  arrangementId: string;
  allocations?: AllocationTrailRow[];
}

export const ArrangementAllocationsPanel: React.FC<Props> = ({ arrangementId, allocations }) => {
  const { data = [], isLoading, isError } = useQuery({
    queryKey: ['arrangement_allocation_trail', arrangementId],
    queryFn: () => fetchAllocationTrail(arrangementId),
    enabled: !!arrangementId && !allocations,
  });
  const rows = allocations ?? data;

  if (!allocations && isLoading) return <Skeleton className="h-48 w-full" />;
  if (!allocations && isError) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/5 border border-destructive/10 text-xs text-destructive">
        <AlertCircle className="h-4 w-4" /> Failed to load the allocation trail.
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground text-sm">
          <Coins className="h-6 w-6 mx-auto mb-2 opacity-50" />
          No canonical payment allocations have been recorded for this arrangement yet.
          Allocations appear once a payment is posted to the employer ledger and reconciled.
        </CardContent>
      </Card>
    );
  }

  const unattributed = rows.filter((r) => r.is_unattributed);

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        {unattributed.length > 0 && (
          <div className="rounded-md border border-warning/20 bg-warning/5 p-3 text-xs text-warning-foreground">
            {unattributed.length} payment amount(s) could not be attributed to a covered liability.
            They remain recorded against the arrangement and are shown below.
          </div>
        )}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payment date</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-center">Installment</TableHead>
                <TableHead>Covered liability</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Fund</TableHead>
                <TableHead className="text-right">Payment</TableHead>
                <TableHead className="text-right">Allocated</TableHead>
                <TableHead>Policy</TableHead>
                <TableHead>State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.allocation_id} className={a.is_reversed ? 'opacity-60' : ''}>
                  <TableCell className="text-xs whitespace-nowrap">
                    {a.payment_date ? formatDateForDisplay(a.payment_date) : '—'}
                  </TableCell>
                  <TableCell className="text-xs font-mono truncate max-w-[140px]">
                    {a.ledger_payment_reference || a.receipt_id || '—'}
                  </TableCell>
                  <TableCell className="text-center text-xs">
                    {a.installment_number ?? '—'}
                    {a.installment_due_date && (
                      <span className="block text-muted-foreground">
                        {formatDateForDisplay(a.installment_due_date)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {a.is_unattributed ? (
                      <span className="text-warning-foreground">Not attributable</span>
                    ) : (
                      <>
                        {a.liability_type || '—'}
                        {a.source_reference_no && (
                          <span className="block font-mono text-muted-foreground">{a.source_reference_no}</span>
                        )}
                      </>
                    )}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {a.period_from ? formatDateForDisplay(a.period_from) : '—'}
                    {a.period_to ? ` – ${formatDateForDisplay(a.period_to)}` : ''}
                  </TableCell>
                  <TableCell className="text-xs">{a.fund_type || '—'}</TableCell>
                  <TableCell className="text-right text-xs">{formatXCD(a.amount_received)}</TableCell>
                  <TableCell className="text-right text-xs font-medium">{formatXCD(a.allocation_amount)}</TableCell>
                  <TableCell className="text-xs">{a.allocation_policy || '—'}</TableCell>
                  <TableCell>
                    {a.is_reversed ? (
                      <Badge variant="outline" className="text-xs border-destructive/30 text-destructive">
                        Reversed
                      </Badge>
                    ) : a.is_unattributed ? (
                      <Badge variant="outline" className="text-xs border-warning/30 text-warning-foreground">
                        Unattributed
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">Allocated</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
