import { useUserCode } from '@/hooks/useUserCode';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
/**
 * Approval Console — Main Page
 * 
 * Business Purpose: Queue-based supervisor review of benefit decisions
 * before entitlement creation and payment orchestration.
 * 
 * Approval does NOT directly create issued payments in cl_cheques*.
 * Approval creates/activates bn_entitlement + bn_payment_instruction.
 */
import React, { useState, useMemo } from 'react';
import { BnStatCard, BnEmptyState } from '@/components/bn/shared';
import { ClipboardCheck, Clock, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { showBlockerToast } from '@/lib/bn/showBlockerToast';
import { useBnApprovalQueue, useExecuteApprovalAction, useBulkApproval } from '@/hooks/bn/useBnApprovalConsole';
import { ApprovalQueueFilters } from '@/components/bn/approval/ApprovalQueueFilters';
import { ApprovalQueueTable } from '@/components/bn/approval/ApprovalQueueTable';
import { ApprovalCaseDrawer } from '@/components/bn/approval/ApprovalCaseDrawer';
import { ApprovalActionBar } from '@/components/bn/approval/ApprovalActionBar';
import type { ApprovalFilters } from '@/services/bn/approvalConsoleService';

export default function ApprovalConsole() {
  const [filters, setFilters] = useState<ApprovalFilters>({ status: ['DECISION'] });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [viewingClaimId, setViewingClaimId] = useState<string | null>(null);

  const { data: queue, isLoading, error } = useBnApprovalQueue(filters);
  const executeAction = useExecuteApprovalAction();
  const bulkApprove = useBulkApproval();

  const { roles: authRoles } = useSupabaseAuth();
  const userRoles = (authRoles ?? []).map((r) => String(r));
  // `?? ''` used to turn a still-loading profile into an empty user code, which
  // then failed no check: maker-checker compared '' against the recommender and
  // passed, and the approval was recorded with no approver name.
  const { userCode: _uc, isLoading: userCodeLoading, error: userCodeError } = useUserCode();
  const userCode = _uc ?? '';
  const approvalsBlocked = userCodeLoading || !!userCodeError || !userCode;
  const approvalsBlockedReason = userCodeLoading
    ? 'Loading your profile — your user code has not arrived yet.'
    : userCodeError
      ? `Your profile could not be read: ${userCodeError}`
      : !userCode
        ? 'Your account has no user code recorded. Ask an administrator to set one.'
        : null;

  // Stats
  const stats = useMemo(() => {
    const items = queue ?? [];
    return {
      total: items.length,
      decision: items.filter(i => i.status === 'DECISION').length,
      urgent: items.filter(i => i.priority === 'URGENT').length,
      overdue: items.filter(i => i.age_days > 14).length,
    };
  }, [queue]);

  // Get maker user code for selected case (for maker-checker)
  const selectedMaker = useMemo(() => {
    if (selectedIds.size === 1) {
      const item = queue?.find(q => selectedIds.has(q.claim_id));
      return item?.entered_by || null;
    }
    return null;
  }, [selectedIds, queue]);

  const handleAction = (action: string, narrative: string, reasonCodeId?: string) => {
    if (approvalsBlocked) {
      showBlockerToast(approvalsBlockedReason, { fallbackTitle: 'Cannot record this decision' });
      return;
    }
    if (selectedIds.size === 0) {
      toast.error('Select at least one case.');
      return;
    }
    // For single actions, use the first selected
    const claimId = Array.from(selectedIds)[0];
    executeAction.mutate(
      { claimId, action, narrative, reasonCodeId, performedBy: userCode },
      {
        onSuccess: (res) => {
          toast.success(`${action} completed. Status → ${res.newStatus}`);
          setSelectedIds(new Set());
        },
        onError: (err: any) => showBlockerToast(err, { fallbackTitle: 'Action failed' }),
      }
    );
  };

  const handleBulkApprove = (narrative: string) => {
    if (approvalsBlocked) {
      showBlockerToast(approvalsBlockedReason, { fallbackTitle: 'Cannot record these decisions' });
      return;
    }
    const ids = Array.from(selectedIds);
    bulkApprove.mutate(
      { claimIds: ids, narrative, performedBy: userCode },
      {
        onSuccess: (res) => {
          toast.success(`Bulk approved: ${res.succeeded.length} succeeded, ${res.failed.length} failed.`);
          if (res.failed.length > 0) {
            // One notification per claim, each listing its own conditions.
            res.failed.forEach(f =>
              showBlockerToast(f.error, {
                fallbackTitle: `Claim ${f.claimId.slice(0, 8)} was not approved`,
              }),
            );
          }
          setSelectedIds(new Set());
        },
        onError: (err: any) => showBlockerToast(err, { fallbackTitle: 'Action failed' }),
      }
    );
  };

  if (error) {
    return (
      <div className="p-6">
        <BnEmptyState type="error" description="Could not load approval queue." />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6 pb-24">
      {/* Header */}
      <div>
        <h1 className="t-page-title">Approval Console</h1>
        <p className="t-page-subtitle mt-1">
          Review and approve benefit decisions. Approval activates entitlements — does not issue payments directly.
        </p>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <BnStatCard title="Awaiting Decision" value={stats.decision} icon={ClipboardCheck} />
        <BnStatCard title="Total in Queue" value={stats.total} icon={Clock} />
        <BnStatCard title="Urgent" value={stats.urgent} icon={AlertTriangle} subtitle="Priority cases" />
        <BnStatCard title="Overdue (>14d)" value={stats.overdue} icon={CheckCircle} subtitle="SLA breached" />
      </div>

      {/* Filters */}
      <ApprovalQueueFilters filters={filters} onChange={setFilters} totalCount={queue?.length ?? 0} />

      {/* Queue Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <ApprovalQueueTable
          items={queue ?? []}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          onViewCase={setViewingClaimId}
        />
      )}

      {/* Action Bar */}
      <ApprovalActionBar
        selectedCount={selectedIds.size}
        userRoles={userRoles}
        currentUserCode={userCode}
        makerUserCode={selectedMaker}
        onAction={handleAction}
        onBulkApprove={handleBulkApprove}
        isExecuting={executeAction.isPending || bulkApprove.isPending}
      />

      {/* Case Detail Drawer */}
      <ApprovalCaseDrawer claimId={viewingClaimId} onClose={() => setViewingClaimId(null)} />
    </div>
  );
}
