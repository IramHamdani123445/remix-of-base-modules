/**
 * Arrangement Coverage Panel — Covered Liabilities & Payment Attribution
 *
 * Read-only view over the canonical arrangement model:
 *   core_payment_arrangement / _item / core_payment_allocation
 *
 * Shows WHAT debt the arrangement covers, and WHERE each posted payment went.
 * Creates no money entries; all figures are derived server-side.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertCircle, Layers, ArrowRightLeft, ShieldCheck, ShieldAlert } from 'lucide-react';
import { formatDateForDisplay } from '@/lib/format-config';

interface ArrangementCoveragePanelProps {
  /** ce_payment_arrangements.id (legacy operational id) */
  legacyArrangementId: string;
}

interface CoverageItem {
  id: string;
  liability_type: string | null;
  source_record_type: string | null;
  source_reference_no: string | null;
  period_from: string | null;
  period_to: string | null;
  arranged_amount: number | null;
  paid_amount: number | null;
  outstanding_amount: number | null;
  status: string | null;
  coverage_confidence: string | null;
}

interface AllocationRow {
  id: string;
  payment_date: string | null;
  receipt_id: string | null;
  amount_received: number | null;
  allocation_amount: number | null;
  allocated_to_item_id: string | null;
  fund_type: string | null;
  allocation_policy: string | null;
  is_reversed: boolean | null;
}

interface CoverageDetail {
  arrangement: Record<string, unknown> & { coverage_status?: string | null; total_arranged_amount?: number | null };
  coverage: { covered_amount: number; total_arranged_amount: number; difference: number; balanced: boolean; item_count: number };
  items: CoverageItem[];
  allocations: AllocationRow[];
}

const formatCurrency = (amount: number | null | undefined) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'XCD', minimumFractionDigits: 2 })
    .format(Number(amount ?? 0));

const itemStatusColor = (status?: string | null) => {
  switch (status) {
    case 'PAID': return 'bg-success/10 text-success';
    case 'PARTIAL': return 'bg-warning/10 text-warning-foreground';
    case 'CANCELLED': return 'bg-muted text-muted-foreground';
    default: return 'bg-muted text-muted-foreground';
  }
};

const period = (from?: string | null, to?: string | null) => {
  if (!from && !to) return '—';
  return `${from ? formatDateForDisplay(from) : '—'} → ${to ? formatDateForDisplay(to) : '—'}`;
};

export const ArrangementCoveragePanel: React.FC<ArrangementCoveragePanelProps> = ({ legacyArrangementId }) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['arrangement-coverage', legacyArrangementId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('core_arrangement_detail_by_legacy' as never, {
        p_legacy_id: legacyArrangementId,
      } as never);
      if (error) throw error;
      return (data ?? null) as unknown as CoverageDetail | null;
    },
    enabled: Boolean(legacyArrangementId),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-4 space-y-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          Coverage information is not available for this arrangement yet.
        </CardContent>
      </Card>
    );
  }

  const items = data.items ?? [];
  const allocations = (data.allocations ?? []).filter(a => !a.is_reversed);
  const cov = data.coverage;
  const itemLabel = new Map(items.map(i => [i.id, i.source_reference_no || i.liability_type || 'Liability']));

  return (
    <div className="space-y-4">
      {/* Coverage summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Covered Liabilities
            {cov?.balanced ? (
              <Badge className="bg-success/10 text-success gap-1"><ShieldCheck className="h-3 w-3" /> Fully covered</Badge>
            ) : (
              <Badge className="bg-warning/10 text-warning-foreground gap-1"><ShieldAlert className="h-3 w-3" /> Coverage incomplete</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Arrangement amount</p>
              <p className="font-semibold">{formatCurrency(cov?.total_arranged_amount)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Covered amount</p>
              <p className="font-semibold">{formatCurrency(cov?.covered_amount)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Unallocated difference</p>
              <p className="font-semibold">{formatCurrency(cov?.difference)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Liabilities</p>
              <p className="font-semibold">{cov?.item_count ?? 0}</p>
            </div>
          </div>

          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No covered liabilities are recorded for this arrangement. Historical coverage could not be reconstructed with certainty.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Fund</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Covered</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map(item => (
                    <TableRow key={item.id}>
                      <TableCell className="text-sm">
                        <span className="font-medium">{item.source_reference_no || '—'}</span>
                        <span className="block text-xs text-muted-foreground">
                          {item.source_record_type || '—'}
                          {item.coverage_confidence ? ` · ${item.coverage_confidence}` : ''}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">{item.liability_type || '—'}</TableCell>
                      <TableCell className="text-sm">{period(item.period_from, item.period_to)}</TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(item.arranged_amount)}</TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(item.paid_amount)}</TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(item.outstanding_amount)}</TableCell>
                      <TableCell>
                        <Badge className={itemStatusColor(item.status)}>{item.status || 'OPEN'}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Allocations */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4" />
            Payment Attribution ({allocations.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {allocations.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No payments have been attributed to covered liabilities yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payment date</TableHead>
                    <TableHead>Receipt</TableHead>
                    <TableHead>Fund</TableHead>
                    <TableHead>Applied to</TableHead>
                    <TableHead className="text-right">Payment</TableHead>
                    <TableHead className="text-right">Attributed</TableHead>
                    <TableHead>Rule</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allocations.map(a => (
                    <TableRow key={a.id}>
                      <TableCell className="text-sm">{a.payment_date ? formatDateForDisplay(a.payment_date) : '—'}</TableCell>
                      <TableCell className="text-sm">{a.receipt_id || '—'}</TableCell>
                      <TableCell className="text-sm">{a.fund_type || '—'}</TableCell>
                      <TableCell className="text-sm">
                        {a.allocated_to_item_id
                          ? itemLabel.get(a.allocated_to_item_id) || 'Liability'
                          : <span className="text-muted-foreground italic">Unattributed</span>}
                      </TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(a.amount_received)}</TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(a.allocation_amount)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{a.allocation_policy || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ArrangementCoveragePanel;
