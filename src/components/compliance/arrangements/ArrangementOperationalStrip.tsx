/**
 * Operational strip for the Arrangement Detail view.
 * Surfaces server-derived operational figures (overdue installments, past-due
 * amount, unattributed payments, breach health) and any disagreement between
 * the arrangement header, its installments and the canonical allocation trail.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle } from 'lucide-react';
import {
  fetchArrangementRegisterRow,
  fetchArrangementInstallments,
  fetchAllocationTrail,
  detectReconciliationIssues,
} from '@/services/compliance/arrangementRegisterService';
import { formatXCD, ArrangementHealthBadge } from './arrangementFormat';

export const ArrangementOperationalStrip: React.FC<{ arrangementId: string }> = ({
  arrangementId,
}) => {
  const { data: row, isLoading } = useQuery({
    queryKey: ['arrangement_register_row', arrangementId],
    queryFn: () => fetchArrangementRegisterRow(arrangementId),
    enabled: !!arrangementId,
    retry: 1,
  });
  const { data: installments = [] } = useQuery({
    queryKey: ['arrangement_installments_operational', arrangementId],
    queryFn: () => fetchArrangementInstallments(arrangementId),
    enabled: !!arrangementId,
    retry: 1,
  });
  const { data: allocations = [] } = useQuery({
    queryKey: ['arrangement_allocation_trail', arrangementId],
    queryFn: () => fetchAllocationTrail(arrangementId),
    enabled: !!arrangementId,
    retry: 1,
  });

  if (isLoading) return <Skeleton className="h-20 w-full" />;
  if (!row) return null;

  const issues = detectReconciliationIssues(row, installments, allocations);

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Health</p>
              <div className="mt-1"><ArrangementHealthBadge health={row.health_status} /></div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Installments paid</p>
              <p className="font-semibold">{row.installments_paid} / {row.installments_total}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Overdue</p>
              <p className={`font-semibold ${row.overdue_count > 0 ? 'text-destructive' : ''}`}>
                {row.overdue_count}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Past due amount</p>
              <p className={`font-semibold ${Number(row.past_due_amount) > 0 ? 'text-destructive' : ''}`}>
                {formatXCD(row.past_due_amount)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Unattributed</p>
              <p className={`font-semibold ${Number(row.unattributed_amount) > 0 ? 'text-warning-foreground' : ''}`}>
                {formatXCD(row.unattributed_amount)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Unresolved breaches</p>
              <p className={`font-semibold ${row.unresolved_breach_count > 0 ? 'text-destructive' : ''}`}>
                {row.unresolved_breach_count} / {row.breach_count}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {issues.length > 0 && (
        <Card className="border-destructive/30">
          <CardContent className="pt-4 pb-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Reconciliation disagreement ({issues.length})
            </div>
            <p className="text-xs text-muted-foreground">
              The arrangement header, the installment schedule and the canonical allocation trail
              do not agree. No figure has been silently corrected — the difference is shown for review.
            </p>
            <ul className="space-y-1 text-xs">
              {issues.map((i, idx) => (
                <li key={idx} className="flex flex-wrap gap-x-2">
                  <span className="font-medium">{i.scope}:</span>
                  <span>{i.message}</span>
                  <span className="text-muted-foreground">
                    expected {formatXCD(i.expected)}, found {formatXCD(i.actual)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
