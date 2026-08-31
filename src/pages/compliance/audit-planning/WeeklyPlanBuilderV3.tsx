// ============================================
// WEEKLY PLAN BUILDER V3 — Explainable, governed candidate engine UI
// Reuses useWeeklyPlanBuilder + ce_weekly_plans tables.
// Adds: V3 candidate cards, pin/suppress/demote/exception governance,
//        validation panel, bucket/mandatory grouping. Legacy planner is
//        preserved at /compliance/field/plan-builder and /…-v2.
// ============================================
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs';
import { Loader2, AlertCircle, RefreshCw, ArrowLeft, Sparkles, Send } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

import { useWeeklyPlanBuilder, DayOfWeek } from '@/hooks/useWeeklyPlanBuilder';
import { useComplianceRole } from '@/hooks/useComplianceRole';
import type { PlanCandidateV3 } from '@/types/weeklyPlan';
import {
  plannerCandidateActionsService,
  ACTION_TYPE_LABELS,
  type PlannerCandidateAction,
} from '@/services/plannerCandidateActionsService';
import { plannerApprovalService } from '@/services/plannerApprovalService';
import { CandidateCardV3 } from '@/components/compliance/weekly-plan/v3/CandidateCardV3';
import {
  PlannerExceptionDialog,
  type PlannerExceptionPayload,
} from '@/components/compliance/weekly-plan/v3/PlannerExceptionDialog';
import { PlannerValidationPanelV3 } from '@/components/compliance/weekly-plan/v3/PlannerValidationPanelV3';

const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const BUCKETS: Array<{ key: PlanCandidateV3['bucket']; label: string }> = [
  { key: 'MUST_SCHEDULE', label: 'Must schedule' },
  { key: 'REACTIVE_ENFORCEMENT', label: 'Reactive enforcement' },
  { key: 'RISK_MONITORING', label: 'Risk monitoring' },
  { key: 'ROUTINE_COVERAGE', label: 'Routine coverage' },
  { key: 'CAMPAIGN_INTEL', label: 'Campaign / intel' },
];

function pickDay(itemsByDay: Record<DayOfWeek, any[]>): DayOfWeek {
  let best: DayOfWeek = 'Monday';
  let min = Infinity;
  for (const d of DAYS) {
    const c = itemsByDay[d]?.length || 0;
    if (c < min) { min = c; best = d; }
  }
  return best;
}

export default function WeeklyPlanBuilderV3() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const builder = useWeeklyPlanBuilder();
  const role = useComplianceRole();
  const qc = useQueryClient();

  const canPin = role === 'inspector' || role === 'senior' || role === 'head';
  const canGovern = role === 'senior' || role === 'head';

  // Active week's planner actions
  const actionsQuery = useQuery({
    queryKey: ['planner-actions', builder.week.weekStart, builder.inspectorId],
    queryFn: () => plannerCandidateActionsService.listForWeek(
      builder.week.weekStart, builder.inspectorId,
    ),
    enabled: !!builder.inspectorId,
  });
  const actions = actionsQuery.data ?? [];

  const actionsByEmployer = useMemo(() => {
    const m = new Map<string, PlannerCandidateAction[]>();
    for (const a of actions) {
      const list = m.get(a.employer_id) ?? [];
      list.push(a);
      m.set(a.employer_id, list);
    }
    return m;
  }, [actions]);

  const refreshActions = () =>
    qc.invalidateQueries({ queryKey: ['planner-actions'] });

  // Filter visible candidates: hide suppressed unless toggled
  const [showSuppressed, setShowSuppressed] = useState(false);
  const visibleCandidates = useMemo(() => {
    return builder.candidatesV3.filter((c) => {
      const acts = actionsByEmployer.get(c.employer_id) ?? [];
      const suppressed = acts.some((a) => a.action_type === 'suppress');
      return showSuppressed || !suppressed;
    });
  }, [builder.candidatesV3, actionsByEmployer, showSuppressed]);

  const candidatesByBucket = useMemo(() => {
    const groups: Record<PlanCandidateV3['bucket'], PlanCandidateV3[]> = {
      MUST_SCHEDULE: [], REACTIVE_ENFORCEMENT: [], RISK_MONITORING: [],
      ROUTINE_COVERAGE: [], CAMPAIGN_INTEL: [],
    };
    for (const c of visibleCandidates) {
      (groups[c.bucket] ?? groups.CAMPAIGN_INTEL).push(c);
    }
    return groups;
  }, [visibleCandidates]);

  // Exception dialog state
  const [excDialog, setExcDialog] = useState<{ open: boolean; candidate: PlanCandidateV3 | null }>({
    open: false, candidate: null,
  });

  // Map candidate → legacy PlanCandidate (the hook's adapter logic)
  const findLegacy = useCallback((employerId: string) =>
    builder.candidates.find((c) => c.employer_id === employerId),
    [builder.candidates],
  );

  const recordAction = useCallback(async (
    c: PlanCandidateV3,
    actionType: PlannerCandidateAction['action_type'],
    extras: Partial<{
      reason: string; notes: string;
      exception: PlannerExceptionPayload;
    }> = {},
  ) => {
    try {
      const recorded = await plannerCandidateActionsService.record({
        planId: builder.activePlanId,
        inspectorId: builder.inspectorId,
        weekStartDate: builder.week.weekStart,
        employerId: c.employer_id,
        auditProgram: c.audit_program,
        zoneId: c.zone_id,
        actionType,
        reason: extras.reason,
        notes: extras.notes,
        exception: extras.exception
          ? {
              category: extras.exception.category,
              justification: extras.exception.justification,
              approvalRequired: extras.exception.approvalRequired,
              capacityImpactHours: extras.exception.capacityImpactHours,
              displacesCandidate: extras.exception.displacesCandidate,
              linkedCaseId: extras.exception.linkedCaseId,
              linkedViolationId: extras.exception.linkedViolationId,
              requestedByUserCode: builder.userCode ?? undefined,
            }
          : undefined,
        userCode: builder.userCode ?? undefined,
      });
      await refreshActions();

      // Trigger approval workflow for governance-gated actions
      const needsApproval =
        (actionType === 'convert_exception' && extras.exception?.approvalRequired) ||
        actionType === 'merge_duplicate';
      if (needsApproval && recorded?.id && builder.userCode) {
        try {
          const result = await plannerApprovalService.submit(recorded.id, builder.userCode);
          toast({
            title: 'Approval requested',
            description: `${result.approvers} Supervisor(s) notified by email. Status: pending.`,
          });
        } catch (apprErr: any) {
          toast({
            title: 'Action saved — approval request failed',
            description: apprErr?.message ?? 'Could not enqueue approval emails.',
            variant: 'destructive',
          });
        }
      } else {
        toast({
          title: ACTION_TYPE_LABELS[actionType],
          description: `${c.employer_name || c.employer_id} updated.`,
        });
      }
    } catch (err: any) {
      toast({
        title: 'Action failed', description: err?.message,
        variant: 'destructive',
      });
    }
  }, [builder.activePlanId, builder.inspectorId, builder.userCode, builder.week.weekStart, toast]);

  const handlePin       = (c: PlanCandidateV3) => recordAction(c, 'pin');
  const handleSuppress  = (c: PlanCandidateV3) => recordAction(c, 'suppress', { reason: 'Suppressed for this week' });
  const handleDemote    = (c: PlanCandidateV3) => recordAction(c, 'demote_watchlist');
  const handleMerge     = (c: PlanCandidateV3) => recordAction(c, 'merge_duplicate');
  const handleRecalc    = (c: PlanCandidateV3) => recordAction(c, 'recalc_request')
    .then(() => builder.refreshCandidates());
  const handleUnpin = async (a: PlannerCandidateAction) => {
    await plannerCandidateActionsService.revert(a.id, builder.userCode ?? undefined);
    await refreshActions();
  };

  const handleAddToPlan = useCallback(async (c: PlanCandidateV3) => {
    const legacy = findLegacy(c.employer_id);
    if (!legacy) return;
    const day = pickDay(builder.itemsByDay);
    await builder.addCandidateToDay(legacy, day);
  }, [builder, findLegacy]);

  const exceptionActions = actions.filter((a) => a.action_type === 'convert_exception');

  if (builder.userLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!builder.userId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <p className="text-muted-foreground">Please log in to access the Weekly Plan Builder.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4">
      <PageHeader
        title="Weekly Plan Builder · V3"
        subtitle={`Explainable engine · Week of ${builder.week.days[0].label} – ${builder.week.days[4].label}`}
        breadcrumbs={[
          { label: 'Compliance', href: '/compliance/dashboard' },
          { label: 'Audit Planning', href: '/compliance/audit-planning/sampling-dashboard' },
          { label: 'Plan Builder V3' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate('/compliance/field/plan-builder')}>
              <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Legacy planner
            </Button>
            <Button variant="outline" size="sm" onClick={() => builder.refreshCandidates()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh candidates
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Suggestions — left 2/3 */}
        <div className="lg:col-span-2 space-y-3">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Candidate suggestions
                <Badge variant="outline" className="ml-1">{visibleCandidates.length}</Badge>
              </CardTitle>
              <div className="flex items-center gap-2 text-xs">
                <label className="inline-flex items-center gap-1 cursor-pointer">
                  <input type="checkbox"
                    checked={showSuppressed}
                    onChange={(e) => setShowSuppressed(e.target.checked)}
                  />
                  Show suppressed
                </label>
              </div>
            </CardHeader>
            <CardContent className="p-3">
              {builder.candidatesLoading ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
                  Loading candidates…
                </div>
              ) : visibleCandidates.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No candidates for this zone / week.
                </p>
              ) : (
                <Tabs defaultValue="MUST_SCHEDULE">
                  <TabsList className="grid grid-cols-5 h-auto">
                    {BUCKETS.map((b) => (
                      <TabsTrigger key={b.key} value={b.key} className="text-[11px] py-1.5">
                        {b.label}
                        <Badge variant="secondary" className="ml-1 text-[10px] px-1">
                          {candidatesByBucket[b.key].length}
                        </Badge>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {BUCKETS.map((b) => (
                    <TabsContent key={b.key} value={b.key} className="mt-3">
                      <ScrollArea className="h-[520px] pr-3">
                        {candidatesByBucket[b.key].length === 0 ? (
                          <p className="text-xs text-muted-foreground text-center py-8">
                            No candidates in this bucket.
                          </p>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {candidatesByBucket[b.key].map((c) => (
                              <CandidateCardBoundary
                                key={`${c.employer_id}-${c.audit_program ?? '_'}`}
                                label={c.employer_name || c.employer_id}
                              >
                                <CandidateCardV3
                                  candidate={c}
                                  actions={actionsByEmployer.get(c.employer_id) ?? []}
                                  canPin={canPin}
                                  canGovern={canGovern}
                                  isAdded={builder.addedSourceIds.has(c.employer_id)}
                                  onAddToPlan={handleAddToPlan}
                                  onPin={handlePin}
                                  onUnpin={handleUnpin}
                                  onSuppress={handleSuppress}
                                  onDemote={handleDemote}
                                  onConvertException={(cand) =>
                                    setExcDialog({ open: true, candidate: cand })
                                  }
                                  onMerge={handleMerge}
                                  onRecalc={handleRecalc}
                                />
                              </CandidateCardBoundary>
                            ))}
                          </div>
                        )}
                      </ScrollArea>
                    </TabsContent>
                  ))}
                </Tabs>
              )}
            </CardContent>
          </Card>

          {/* Exceptions strip */}
          {exceptionActions.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Recorded exceptions
                  <Badge variant="outline" className="ml-2">{exceptionActions.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {exceptionActions.map((a) => (
                  <div key={a.id} className="flex items-start justify-between border rounded-md p-2 text-xs">
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {a.employer_id} · {a.exception_category}
                      </p>
                      <p className="text-muted-foreground truncate">
                        {a.exception_justification}
                      </p>
                    </div>
                    <Badge variant={a.approval_status === 'APPROVED' ? 'default' : 'outline'}>
                      {a.approval_status}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right rail */}
        <div className="space-y-3">
          <PlannerValidationPanelV3
            candidates={builder.candidatesV3}
            scheduled={builder.planItems}
            actions={actions}
          />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Plan summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Scheduled items</span>
                <span className="font-medium">{builder.planItems.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Mandatory pool</span>
                <span className="font-medium">
                  {builder.candidatesByMandatoryClass.MANDATORY.length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Priority pool</span>
                <span className="font-medium">
                  {builder.candidatesByMandatoryClass.PRIORITY.length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Watchlist</span>
                <span className="font-medium">
                  {builder.candidatesByMandatoryClass.WATCHLIST.length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Active actions</span>
                <span className="font-medium">{actions.length}</span>
              </div>
              <Button
                className="w-full mt-3"
                size="sm"
                disabled={!builder.canEdit || builder.planItems.length === 0 || builder.isSubmitting}
                onClick={() => builder.submitPlan(undefined)}
              >
                <Send className="h-3.5 w-3.5 mr-1" />
                Submit for review
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <PlannerExceptionDialog
        open={excDialog.open}
        onOpenChange={(o) => setExcDialog((s) => ({ ...s, open: o }))}
        employerName={excDialog.candidate?.employer_name ?? null}
        onConfirm={async (payload) => {
          if (!excDialog.candidate) return;
          await recordAction(excDialog.candidate, 'convert_exception', { exception: payload });
        }}
      />
    </div>
  );
}
