import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';

import { AwardSuspensionHeader } from './AwardSuspensionHeader';
import { SuspensionSummaryCards, type SummaryCardKey } from './SuspensionSummaryCards';
import { AwardsRegister } from './AwardsRegister';
import { SuspensionRequestsRegister } from './SuspensionRequestsRegister';
import { MySuspensionApprovals } from './MySuspensionApprovals';
import { SuspensionHistory } from './SuspensionHistory';
import { SuspensionRequestDrawer } from './SuspensionRequestDrawer';
import { SuspensionProposalDialog } from './SuspensionProposalDialog';
import {
  AWARD_SUSPENSION_TABS,
  type AwardSuspensionTab,
} from './suspensionViewModels';

import {
  getAwardSuspensionRolloutState,
  listAwardsForSuspension,
  listMyApprovalTasks,
  listSuspensionRequests,
  type AwardSuspensionListItem,
  type AwardSuspensionRolloutState,
  type SuspensionApprovalTask,
  type SuspensionRequestListItem,
  type SuspensionSummaryCounts,
} from '@/services/bn/awardSuspensionViewService';

export default function AwardSuspensionPage() {
  const { user, hasPermission } = useSupabaseAuth();
  const [params, setParams] = useSearchParams();

  const rawTab = params.get('tab') as AwardSuspensionTab | null;
  const activeTab: AwardSuspensionTab =
    rawTab && AWARD_SUSPENSION_TABS.includes(rawTab) ? rawTab : 'awards';

  const [canView, setCanView] = useState<boolean | null>(null);
  const [canPropose, setCanPropose] = useState(false);
  const [canApprove, setCanApprove] = useState(false);
  const [canAudit, setCanAudit] = useState(false);
  const [canExecute, setCanExecute] = useState(false);
  // Reinstatement is governed by its own `resume_*` actions server-side; the
  // suspension propose/approve/execute permissions must NOT stand in for them.
  const [canResumePropose, setCanResumePropose] = useState(false);
  const [canResumeApprove, setCanResumeApprove] = useState(false);
  const [canResumeExecute, setCanResumeExecute] = useState(false);
  const [canViewPaymentImpact, setCanViewPaymentImpact] = useState(false);

  const [awards, setAwards] = useState<AwardSuspensionListItem[]>([]);
  const [requests, setRequests] = useState<SuspensionRequestListItem[]>([]);
  const [myTasks, setMyTasks] = useState<SuspensionApprovalTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);

  const [awardStatusFilter, setAwardStatusFilter] = useState<string>('all');
  const [hasOpenFilter, setHasOpenFilter] = useState<'all' | 'yes' | 'no'>('all');
  const [requestStatusFilter, setRequestStatusFilter] = useState<string>('all');
  const [activeCard, setActiveCard] = useState<SummaryCardKey | null>(null);

  const [drawerRequestId, setDrawerRequestId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [proposalOpen, setProposalOpen] = useState(false);
  const [proposalAward, setProposalAward] = useState<AwardSuspensionListItem | null>(null);

  // Rerun on user change / login / logout so the queue stays honest.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [v, p, a, au, ex, rp, ra, re, vpi] = await Promise.all([
          hasPermission('bn_award_suspension', 'view'),
          hasPermission('bn_award_suspension', 'propose'),
          hasPermission('bn_award_suspension', 'approve'),
          hasPermission('bn_award_suspension', 'audit'),
          hasPermission('bn_award_suspension', 'execute'),
          hasPermission('bn_award_suspension', 'resume_propose'),
          hasPermission('bn_award_suspension', 'resume_approve'),
          hasPermission('bn_award_suspension', 'resume_execute'),
          hasPermission('bn_award_suspension', 'view_payment_impact'),
        ]);
        if (cancelled) return;
        setCanView(Boolean(v));
        setCanPropose(Boolean(p));
        setCanApprove(Boolean(a));
        setCanAudit(Boolean(au));
        setCanExecute(Boolean(ex));
        setCanResumePropose(Boolean(rp));
        setCanResumeApprove(Boolean(ra));
        setCanResumeExecute(Boolean(re));
        setCanViewPaymentImpact(Boolean(vpi));
      } catch {
        if (!cancelled) setCanView(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasPermission, user?.id]);

  const [rollout, setRollout] = useState<AwardSuspensionRolloutState | null>(null);
  const [workflowWarning, setWorkflowWarning] = useState<string | null>(null);
  const [approvalsWarning, setApprovalsWarning] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    setWorkflowWarning(null);
    setApprovalsWarning(null);
    try {
      const [rolloutState, awardsResult, requestsResult, tasksResult] = await Promise.all([
        getAwardSuspensionRolloutState(),
        listAwardsForSuspension(),
        listSuspensionRequests().catch((e: any) => {
          setWorkflowWarning(e?.message ?? 'Workflow information could not be loaded.');
          return [] as SuspensionRequestListItem[];
        }),
        // BN-UI-S1.2 — Never query the approval queue for viewers who
        // lack `bn_award_suspension.approve`. Previously loaded rows are
        // cleared whenever this branch is taken.
        canApprove
          ? listMyApprovalTasks(user?.id ?? null).catch((e: any) => {
              setApprovalsWarning(e?.message ?? 'Approval queue could not be loaded.');
              return [] as SuspensionApprovalTask[];
            })
          : Promise.resolve([] as SuspensionApprovalTask[]),
      ]);
      setRollout(rolloutState);
      setAwards(awardsResult);
      setRequests(requestsResult);
      setMyTasks(tasksResult);
      setLastRefreshed(new Date().toISOString());
    } catch (e: any) {
      setError(e?.message ?? 'Unable to load award suspension data.');
    } finally {
      setLoading(false);
    }
  }, [user?.id, canApprove]);

  useEffect(() => {
    if (canView) void loadAll();
  }, [canView, loadAll]);

  // BN-UI-S1.2 — clear any previously loaded approval tasks the moment a
  // user loses the approve permission (delegation revoked, sign-out, etc).
  useEffect(() => {
    if (!canApprove) setMyTasks([]);
  }, [canApprove]);

  const actionsEnabled = rollout?.effectiveActionsEnabled ?? false;


  const counts: SuspensionSummaryCounts = useMemo(() => {
    const openStatuses = [
      'PROPOSED',
      'PENDING_APPROVAL',
      'PENDING_LEVEL_1',
      'PENDING_LEVEL_2',
      'PENDING_LEVEL_N',
    ];
    return {
      activeAwards: awards.filter((a) => a.awardStatus === 'ACTIVE').length,
      openRequests: requests.filter((r) => openStatuses.includes(r.status)).length,
      pendingMyApproval: myTasks.length,
      approvedNotYetApplied: requests.filter((r) => r.status === 'APPROVED').length,
      currentlySuspended: awards.filter((a) => a.awardStatus === 'SUSPENDED').length,
      rejectedOrWithdrawn: requests.filter((r) =>
        ['REJECTED', 'WITHDRAWN', 'CANCELLED'].includes(r.status)
      ).length,
    };
  }, [awards, requests, myTasks]);

  const setTab = (tab: AwardSuspensionTab) => {
    const next = new URLSearchParams(params);
    next.set('tab', tab);
    setParams(next, { replace: true });
  };

  const openRequest = (requestId: string) => {
    setDrawerRequestId(requestId);
    setDrawerOpen(true);
  };

  const onCardSelect = (key: SummaryCardKey) => {
    setActiveCard(key === activeCard ? null : key);
    switch (key) {
      case 'active':
        setTab('awards');
        setAwardStatusFilter('ACTIVE');
        setHasOpenFilter('all');
        break;
      case 'suspended':
        setTab('awards');
        setAwardStatusFilter('SUSPENDED');
        break;
      case 'openRequests':
        setTab('requests');
        setRequestStatusFilter('all');
        break;
      case 'approvedPending':
        setTab('requests');
        setRequestStatusFilter('APPROVED');
        break;
      case 'rejected':
        setTab('history');
        setRequestStatusFilter('REJECTED');
        break;
      case 'myApprovals':
        setTab('approvals');
        break;
    }
  };

  if (canView === null) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Checking permissions…</div>
    );
  }
  if (canView === false) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-8 text-center">
            <AlertTriangle className="mx-auto h-6 w-6 text-amber-600 mb-2" aria-hidden />
            <h2 className="font-semibold">Access restricted</h2>
            <p className="text-sm text-muted-foreground">
              You do not have the <code>bn_award_suspension.view</code> permission.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <AwardSuspensionHeader
        lastRefreshed={lastRefreshed}
        onRefresh={loadAll}
        canPropose={canPropose}
        onPropose={() => {
          setProposalAward(null);
          setProposalOpen(true);
        }}
        loading={loading}
        rollout={rollout}
        actionsEnabled={actionsEnabled}
      />

      <SuspensionSummaryCards
        counts={counts}
        onSelect={onCardSelect}
        activeKey={activeCard}
        loading={loading}
      />

      {workflowWarning && (
        <Card>
          <CardContent className="p-3 text-sm flex items-start gap-2 border-l-4 border-l-amber-500">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" aria-hidden />
            <div>
              <p className="font-medium text-amber-800 dark:text-amber-200">
                Workflow information could not be loaded.
              </p>
              <p className="text-xs text-muted-foreground">{workflowWarning}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {approvalsWarning && (
        <Card>
          <CardContent className="p-3 text-sm flex items-start gap-2 border-l-4 border-l-amber-500">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" aria-hidden />
            <div>
              <p className="font-medium text-amber-800 dark:text-amber-200">
                Approval queue could not be loaded.
              </p>
              <p className="text-xs text-muted-foreground">{approvalsWarning}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card>
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" aria-hidden />
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">Failed to load data</p>
              <p className="text-xs text-muted-foreground">{error}</p>
            </div>
            <Button size="sm" variant="outline" onClick={loadAll}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={(v) => setTab(v as AwardSuspensionTab)}>
        <TabsList>
          <TabsTrigger value="awards">Awards</TabsTrigger>
          <TabsTrigger value="requests">Suspension Requests</TabsTrigger>
          <TabsTrigger value="approvals">My Approvals</TabsTrigger>
          <TabsTrigger value="history">History &amp; Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="awards" className="mt-4">
          <AwardsRegister
            rows={awards}
            loading={loading}
            canPropose={canPropose}
            filterAwardStatus={awardStatusFilter}
            filterHasOpenRequest={hasOpenFilter}
            onFilterChange={(patch) => {
              if (patch.awardStatus !== undefined) setAwardStatusFilter(patch.awardStatus);
              if (patch.hasOpen !== undefined) setHasOpenFilter(patch.hasOpen);
            }}
            onPropose={(a) => {
              setProposalAward(a);
              setProposalOpen(true);
            }}
            onViewRequest={openRequest}
            actionsEnabled={actionsEnabled}
          />
        </TabsContent>

        <TabsContent value="requests" className="mt-4">
          <SuspensionRequestsRegister
            rows={requests}
            loading={loading}
            onView={openRequest}
            statusFilter={requestStatusFilter}
            onStatusFilterChange={setRequestStatusFilter}
          />
        </TabsContent>

        <TabsContent value="approvals" className="mt-4">
          <MySuspensionApprovals
            rows={myTasks}
            loading={loading}
            canApprove={canApprove}
            onReview={openRequest}
            actionsEnabled={actionsEnabled}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <SuspensionHistory rows={requests} loading={loading} onView={openRequest} />
        </TabsContent>
      </Tabs>

      <SuspensionRequestDrawer
        open={drawerOpen}
        requestId={drawerRequestId}
        onOpenChange={(v) => {
          setDrawerOpen(v);
          if (!v) setDrawerRequestId(null);
        }}
        canApprove={canApprove}
        canAudit={canAudit}
        canExecute={canExecute}
        canPropose={canPropose}
        canResumePropose={canResumePropose}
        canResumeApprove={canResumeApprove}
        canResumeExecute={canResumeExecute}
        canViewPaymentImpact={canViewPaymentImpact}
        currentUserId={user?.id ?? null}
        actionsEnabled={actionsEnabled}
      />

      <SuspensionProposalDialog
        open={proposalOpen}
        onOpenChange={setProposalOpen}
        award={proposalAward}
        actionsEnabled={actionsEnabled}
      />
    </div>
  );
}
