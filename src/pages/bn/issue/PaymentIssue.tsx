/**
 * Payment Issue Management Page (Enhanced)
 *
 * Business Purpose: Issue outbound benefit disbursements to cl_cheques*
 * with duplicate prevention, partial-failure handling, reissue support,
 * and void/stop controls.
 *
 * Enhanced: Holding release, void/stop actions, issue confirmation dialog.
 */
import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  Banknote, Clock, CheckCircle2, XCircle, AlertTriangle,
  Loader2, Zap, RotateCcw, ShieldCheck, Hand,
} from 'lucide-react';
import {
  useBnIssueRecords, useBnIssueSummary, useExecuteIssue, useExecuteIssueAction,
} from '@/hooks/bn/useBnPaymentIssue';
import { IssueListTable } from '@/components/bn/issue/IssueListTable';
import { IssueDetailDrawer } from '@/components/bn/issue/IssueDetailDrawer';
import { IssueFiltersBar } from '@/components/bn/issue/IssueFiltersBar';
import { IssueActionBar } from '@/components/bn/issue/IssueActionBar';
import type { IssueFilters } from '@/services/bn/paymentIssueService';

import { formatNumber } from '@/lib/culture/culture';
import { useActorUserCode } from '@/hooks/bn/useActorUserCode';
const STAT_CARDS = [
  { key: 'total', label: 'Total', icon: Banknote, color: 'text-foreground' },
  { key: 'pending', label: 'Pending', icon: Clock, color: 'text-amber-600' },
  { key: 'issued', label: 'Issued', icon: CheckCircle2, color: 'text-green-600' },
  { key: 'failed', label: 'Failed', icon: XCircle, color: 'text-destructive' },
  { key: 'voided', label: 'Voided', icon: AlertTriangle, color: 'text-orange-600' },
  { key: 'holding', label: 'Holding', icon: Hand, color: 'text-blue-600' },
];

export default function PaymentIssue() {
  // Writes must name a person, never the 'CURRENT_USER' placeholder.
  const { actor } = useActorUserCode();

  const [filters, setFilters] = useState<IssueFilters>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmNarrative, setConfirmNarrative] = useState('');

  const { data: records = [], isLoading } = useBnIssueRecords(filters);
  const { data: summary } = useBnIssueSummary(filters.batch_id);
  const executeMutation = useExecuteIssue();
  const actionMutation = useExecuteIssueAction();

  const handleBulkIssue = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try {
      const result = await executeMutation.mutateAsync({ issueIds: ids, userCode: actor() });
      toast.success(`Issued: ${result.issued}, Failed: ${result.failed}`);
      setSelectedIds(new Set());
      setShowConfirm(false);
      setConfirmNarrative('');
    } catch (err: any) {
      toast.error(err.message || 'Issue failed');
    }
  };

  const handleAction = async (params: any) => {
    try {
      await actionMutation.mutateAsync(params);
      toast.success(`Action "${params.action}" completed`);
    } catch (err: any) {
      toast.error(err.message || 'Action failed');
    }
  };

  const pendingRecords = records.filter(r => ['PENDING', 'REISSUE_PENDING'].includes(r.status));
  const totalIssueAmount = Array.from(selectedIds)
    .reduce((sum, id) => {
      const r = records.find(rec => rec.id === id);
      return sum + (r?.amount ?? 0);
    }, 0);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="t-page-title">Payment Issue</h1>
          <p className="t-page-subtitle mt-1">
            Issue outbound benefit disbursements to legacy payment tables.
            Each issue is fully audited with duplicate prevention.
          </p>
        </div>
        <div className="flex gap-2">
          {pendingRecords.length > 0 && (
            <Button
              onClick={() => setSelectedIds(new Set(pendingRecords.map(r => r.id)))}
              variant="outline"
              className="gap-2"
            >
              <Zap className="h-4 w-4" /> Select All Pending ({pendingRecords.length})
            </Button>
          )}
          {selectedIds.size > 0 && (
            <Button onClick={() => setShowConfirm(true)} className="gap-2">
              <ShieldCheck className="h-4 w-4" /> Issue Selected ({selectedIds.size})
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
        {STAT_CARDS.map(({ key, label, icon: Icon, color }) => (
          <Card key={key}>
            <CardContent className="p-3 text-center">
              <Icon className={`h-5 w-5 mx-auto mb-1 ${color}`} />
              <div className="text-lg font-bold">{summary?.[key as keyof typeof summary] ?? 0}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardContent className="p-3 text-center">
            <Banknote className="h-5 w-5 mx-auto mb-1 text-green-600" />
            <div className="text-lg font-bold">
              {formatNumber((summary?.totalAmount || 0), 2)}
            </div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Issued Amt</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <IssueFiltersBar filters={filters} onChange={setFilters} />

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <IssueActionBar
          selectedCount={selectedIds.size}
          onIssue={() => setShowConfirm(true)}
          onClear={() => setSelectedIds(new Set())}
          isActing={executeMutation.isPending}
        />
      )}

      {/* Table */}
      <IssueListTable
        records={records}
        isLoading={isLoading}
        selectedIds={selectedIds}
        onToggleSelect={(id) => {
          const next = new Set(selectedIds);
          next.has(id) ? next.delete(id) : next.add(id);
          setSelectedIds(next);
        }}
        onSelectRecord={(r) => setSelectedId(r.id)}
      />

      {/* Detail Drawer */}
      <IssueDetailDrawer
        issueId={selectedId}
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        onAction={handleAction}
        isActing={actionMutation.isPending}
      />

      {/* Issue Confirmation Dialog */}
      <Dialog open={showConfirm} onOpenChange={(v) => !v && setShowConfirm(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Confirm Payment Issue
            </DialogTitle>
            <DialogDescription>
              This will write {selectedIds.size} payment record(s) to the legacy payment system.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded border p-2 text-center">
                <p className="text-[10px] text-muted-foreground">Records</p>
                <p className="font-bold text-lg">{selectedIds.size}</p>
              </div>
              <div className="rounded border p-2 text-center">
                <p className="text-[10px] text-muted-foreground">Total Amount</p>
                <p className="font-mono font-bold">
                  XCD {formatNumber(totalIssueAmount, 2)}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Confirmation Note (optional)</Label>
              <Textarea
                value={confirmNarrative}
                onChange={(e) => setConfirmNarrative(e.target.value)}
                placeholder="Issue confirmation notes..."
                rows={2}
              />
            </div>

            <div className="rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 p-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3 inline mr-1" />
              Payments will be written to cl_cheques. Ensure all items have been validated.
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)} disabled={executeMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={handleBulkIssue} disabled={executeMutation.isPending}>
              {executeMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Confirm Issue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
