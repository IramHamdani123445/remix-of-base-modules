/**
 * BN Uprating — Retry failed items dialog (Epic 3).
 *
 * Only transient failures may be retried; permanent failures must be corrected
 * at source and re-approved. Retry never re-derives an amount: the superseded
 * attempt's approved figures are carried forward, so an item can never be
 * applied twice.
 */
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, ShieldAlert } from 'lucide-react';
import { BnBusyButton } from '@/components/bn/shared';
import type {
  BnUpratingExecutionReadiness,
  BnUpratingRunExecutionView,
} from '@/types/bn/uprating/upratingRun';

interface Props {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly readiness: BnUpratingExecutionReadiness | null;
  readonly execution: BnUpratingRunExecutionView | null;
  readonly isSaving: boolean;
  readonly onConfirm: () => void;
}

export const BnUpratingRetryFailedDialog: React.FC<Props> = ({
  open,
  onOpenChange,
  readiness,
  execution,
  isSaving,
  onConfirm,
}) => {
  const retryable = readiness?.retryable_failures ?? 0;
  const permanent = readiness?.permanent_failures ?? 0;
  const canRetry = !!readiness?.can_retry;
  const summary = execution?.failure_summary ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Retry failed items</DialogTitle>
          <DialogDescription>
            A new retry batch is created for eligible items only. Items that already applied are
            never re-applied, and permanent failures are left untouched.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{retryable} eligible to retry</Badge>
            <Badge variant="outline">{permanent} need correction at source</Badge>
            {readiness?.run_reference && <Badge variant="outline">{readiness.run_reference}</Badge>}
          </div>

          {summary.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Failure</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Retryable</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.map((f) => (
                    <TableCellRow key={f.failure_code ?? 'unknown'} label={f.label ?? f.failure_code ?? '—'} count={f.count} retryable={f.retryable} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {!canRetry && (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Nothing can be retried right now</AlertTitle>
              <AlertDescription>
                Retry becomes available once execution has run and at least one transient failure is
                outstanding. Finish any pending batch first.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <BnBusyButton loading={isSaving} variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </BnBusyButton>
          <Button onClick={onConfirm} disabled={!canRetry || isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Retry eligible items
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const TableCellRow: React.FC<{ label: string; count: number; retryable: boolean }> = ({
  label,
  count,
  retryable,
}) => (
  <TableRow>
    <TableCell>{label}</TableCell>
    <TableCell className="text-right">{count}</TableCell>
    <TableCell className="text-right">
      <Badge variant={retryable ? 'secondary' : 'outline'}>{retryable ? 'Yes' : 'No'}</Badge>
    </TableCell>
  </TableRow>
);
