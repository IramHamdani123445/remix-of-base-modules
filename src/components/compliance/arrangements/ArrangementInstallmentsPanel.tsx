/**
 * Installment schedule for a single arrangement, with per-installment
 * drill-down into the canonical allocation trail and breach occurrences.
 *
 * All amounts and statuses come from ce_v_arrangement_installment_operational.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CalendarDays, ChevronDown, ChevronRight, Coins, AlertCircle } from 'lucide-react';
import { formatDateForDisplay } from '@/lib/format-config';
import {
  fetchArrangementInstallments,
  fetchAllocationTrail,
  type OperationalInstallment,
  type AllocationTrailRow,
} from '@/services/compliance/arrangementRegisterService';
import { formatXCD, InstallmentStatusBadge } from './arrangementFormat';

interface Props {
  /** ce_payment_arrangements.id */
  arrangementId: string;
  /** Optional pre-loaded allocation trail to avoid a second fetch. */
  allocations?: AllocationTrailRow[];
  /** Breach occurrences keyed by installment number (from ce_arrangement_breaches text match). */
  breachInstallmentNumbers?: Set<number>;
}

export const ArrangementInstallmentsPanel: React.FC<Props> = ({
  arrangementId,
  allocations,
  breachInstallmentNumbers,
}) => {
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const { data: installments = [], isLoading, isError } = useQuery({
    queryKey: ['arrangement_installments_operational', arrangementId],
    queryFn: () => fetchArrangementInstallments(arrangementId),
    enabled: !!arrangementId,
  });

  const { data: trail = [] } = useQuery({
    queryKey: ['arrangement_allocation_trail', arrangementId],
    queryFn: () => fetchAllocationTrail(arrangementId),
    enabled: !!arrangementId && !allocations,
  });
  const allTrail = allocations ?? trail;

  if (isLoading) return <Skeleton className="h-56 w-full" />;
  if (isError) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/5 border border-destructive/10 text-xs text-destructive">
        <AlertCircle className="h-4 w-4" /> Failed to load the installment schedule.
      </div>
    );
  }
  if (installments.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground text-sm">
          No installment schedule exists for this arrangement.
        </CardContent>
      </Card>
    );
  }

  const grace = installments[0]?.grace_days ?? 0;

  const renderDrill = (inst: OperationalInstallment) => {
    const rows = allTrail.filter((a) => a.installment_id === inst.installment_id);
    return (
      <TableRow className="bg-muted/30">
        <TableCell colSpan={10} className="p-4">
          <div className="grid gap-4 md:grid-cols-4 text-xs mb-3">
            <div><p className="text-muted-foreground">Scheduled</p><p className="font-medium">{formatXCD(inst.scheduled_amount)}</p></div>
            <div><p className="text-muted-foreground">Paid</p><p className="font-medium">{formatXCD(inst.paid_amount)}</p></div>
            <div><p className="text-muted-foreground">Outstanding</p><p className="font-medium">{formatXCD(inst.outstanding_amount)}</p></div>
            <div><p className="text-muted-foreground">Paid date</p><p className="font-medium">{inst.paid_date ? formatDateForDisplay(inst.paid_date) : '—'}</p></div>
          </div>
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No canonical payment allocation recorded against this installment yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Order</TableHead>
                  <TableHead className="text-xs">Payment</TableHead>
                  <TableHead className="text-xs">Covered liability</TableHead>
                  <TableHead className="text-xs">Fund</TableHead>
                  <TableHead className="text-xs text-right">Payment amount</TableHead>
                  <TableHead className="text-xs text-right">Allocated</TableHead>
                  <TableHead className="text-xs">State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.allocation_id}>
                    <TableCell className="text-xs">{a.allocation_order ?? '—'}</TableCell>
                    <TableCell className="text-xs font-mono">
                      {a.ledger_payment_reference || a.receipt_id || '—'}
                      <span className="block text-muted-foreground font-sans">
                        {a.payment_date ? formatDateForDisplay(a.payment_date) : '—'}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">
                      {a.is_unattributed ? (
                        <span className="text-warning-foreground">Not attributable</span>
                      ) : (
                        <>
                          {a.liability_type || '—'}
                          {a.source_reference_no && (
                            <span className="block text-muted-foreground font-mono">{a.source_reference_no}</span>
                          )}
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{a.fund_type || '—'}</TableCell>
                    <TableCell className="text-xs text-right">{formatXCD(a.amount_received)}</TableCell>
                    <TableCell className="text-xs text-right font-medium">{formatXCD(a.allocation_amount)}</TableCell>
                    <TableCell className="text-xs">
                      {a.is_reversed ? (
                        <Badge variant="outline" className="text-xs border-destructive/30 text-destructive">Reversed</Badge>
                      ) : a.is_unattributed ? (
                        <Badge variant="outline" className="text-xs border-warning/30 text-warning-foreground">Unattributed</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">Allocated</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TableCell>
      </TableRow>
    );
  };

  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground mb-3">
          Overdue is determined server-side using the configured grace period
          (<span className="font-medium">{grace} day{grace === 1 ? '' : 's'}</span> after the due date).
        </p>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="w-12">#</TableHead>
                <TableHead>Due date</TableHead>
                <TableHead className="text-right">Scheduled</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Paid date</TableHead>
                <TableHead className="text-right">Days overdue</TableHead>
                <TableHead className="text-center">Allocations</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {installments.map((inst) => {
                const open = expanded === inst.installment_id;
                const breached = breachInstallmentNumbers?.has(Number(inst.installment_number));
                return (
                  <React.Fragment key={inst.installment_id}>
                    <TableRow
                      className={`cursor-pointer ${inst.effective_status === 'OVERDUE' ? 'bg-destructive/5' : ''}`}
                      onClick={() => setExpanded(open ? null : inst.installment_id)}
                    >
                      <TableCell>
                        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{inst.installment_number}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        <span className="inline-flex items-center gap-1.5">
                          <CalendarDays className="h-3 w-3 text-muted-foreground" />
                          {inst.due_date ? formatDateForDisplay(inst.due_date) : '—'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{formatXCD(inst.scheduled_amount)}</TableCell>
                      <TableCell className="text-right">{formatXCD(inst.paid_amount)}</TableCell>
                      <TableCell className="text-right font-medium">{formatXCD(inst.outstanding_amount)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <InstallmentStatusBadge status={inst.effective_status} />
                          {breached && (
                            <Badge variant="outline" className="text-xs border-destructive/30 text-destructive">
                              Breach
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {inst.paid_date ? formatDateForDisplay(inst.paid_date) : '—'}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {inst.days_overdue > 0 ? (
                          <span className="text-destructive font-medium">{inst.days_overdue}d</span>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-center text-sm">
                        <span className="inline-flex items-center gap-1">
                          <Coins className="h-3 w-3 text-muted-foreground" />
                          {inst.allocation_count}
                        </span>
                      </TableCell>
                    </TableRow>
                    {open && renderDrill(inst)}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
