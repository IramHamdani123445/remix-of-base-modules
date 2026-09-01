import React, { useState, useMemo, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PLAN_WORKSPACE_TABS, useUrlTab } from '@/lib/audit/workspaceTabs';
import { ArrowLeft, Briefcase, CheckCircle, Clock, AlertTriangle, ShieldCheck, Edit, Send, Undo2, BarChart3 } from 'lucide-react';
import { configFromPlan, calculateCapacity, analyzeDistribution, getEngagementHours } from '@/lib/audit/capacityPlanner';
import { useIAAnnualPlans, useIAAnnualPlanMutations, useIADepartments, useIAAuditors, useIADepartmentFunctions } from '@/hooks/useAuditData';
import { useIAPlanChangeLog, useIAPlanChangeLogMutations, useIAPlanEngagements } from '@/hooks/useAuditPlanChangeLog';
import { EngagementBuilder } from '@/components/audit/EngagementBuilder';
import { AutoPlanSuggestions } from '@/components/audit/AutoPlanSuggestions';
import { PlanningWizard } from '@/components/audit/PlanningWizard';
import { PlanVersionHistory } from '@/components/audit/PlanVersionHistory';
import { CapacityCalendarPanel } from '@/components/audit/CapacityCalendarPanel';
import { PlanApprovalHistoryTimeline } from '@/components/audit/PlanApprovalHistoryTimeline';
import { PlanAmendmentHistory } from '@/components/audit/PlanAmendmentHistory';
import { PlanApprovalBanner } from '@/components/audit/PlanApprovalBanner';
import { PlanSubmissionReadiness } from '@/components/audit/PlanSubmissionReadiness';
import { PlanRevisionDialog } from '@/components/audit/PlanRevisionDialog';
import { PlanClosurePanel } from '@/components/audit/PlanClosurePanel';
import { PlanPortfolioPanel } from '@/components/audit/plan/PlanPortfolioPanel';

import { BoardPackTab } from '@/components/audit/BoardPackTab';
import { PlanDistributionTab } from '@/components/audit/PlanDistributionTab';
import { CoverageRiskTab } from '@/components/audit/CoverageRiskTab';
import { AnnualPlanForm } from '@/components/audit/AnnualPlanForm';
import { PageShell, DataTable, StatusBadge, ConfirmDialog } from '@/components/common';
import type { DataTableColumn } from '@/components/common';
import { MetricCard } from '@/components/shared/MetricCard';
import { formatDateForDisplay } from '@/lib/format-config';
import { Progress } from '@/components/ui/progress';
import { Loader2, X } from 'lucide-react';
import { useAuditPlanWorkflow } from '@/hooks/useAuditPlanApproval';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { usePlanWorkflowAccess } from '@/hooks/useAuditPlanWorkflowAccess';
import { getAnnualPlanReadinessChecks, summarizeAnnualPlanReadiness, useAnnualPlanReadiness, useSubmitAnnualPlanWorkflow } from '@/hooks/useAuditAnnualPlanFlow';

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right max-w-[60%] truncate">{value ?? '—'}</span>
    </div>
  );
}

export default function AuditPlanDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // DEF-A-01 — controlled tabs bound to ?tab= (preserves other params).
  const [activeTab, setActiveTab] = useUrlTab(PLAN_WORKSPACE_TABS);

  const { data: plans = [], isLoading: plansLoading } = useIAAnnualPlans();
  const { data: engagements = [], isLoading: engLoading } = useIAPlanEngagements(id);
  const { data: changeLog = [] } = useIAPlanChangeLog(id);
  const { data: departments = [] } = useIADepartments();
  const { data: auditors = [] } = useIAAuditors();
  const { update: updatePlan } = useIAAnnualPlanMutations();

  const [isEditingHeader, setIsEditingHeader] = useState(false);
  const [showReadiness, setShowReadiness] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [conflictResult, setConflictResult] = useState<any>(null);
  const [revisionPlan, setRevisionPlan] = useState<any>(null);

  const { withdrawSubmission } = useAuditPlanWorkflow();
  const submitPlan = useSubmitAnnualPlanWorkflow();

  const plan = useMemo(() => (plans || []).find((p: any) => p.id === id), [plans, id]);
  const planStatus = plan?.status || 'Draft';
  const { readiness: serverReadiness } = useAnnualPlanReadiness(id);

  // Display checklist stays granular, but the authoritative gate is the server
  // readiness function (ia_annual_plan_readiness) enforced by the submit command.
  const readinessChecks = useMemo(() => {
    const checks = getAnnualPlanReadinessChecks(plan, engagements || []);
    const clientFailures = new Set(checks.filter((c) => !c.passed).map((c) => c.label));
    (serverReadiness?.failedChecks || []).forEach((blocker) => {
      if (![...clientFailures].some((label) => blocker.toLowerCase().includes(label.toLowerCase().slice(0, 12)))) {
        checks.push({ label: blocker, passed: false });
      }
    });
    return checks;
  }, [engagements, plan, serverReadiness]);

  const readinessSummary = useMemo(
    () => serverReadiness ?? summarizeAnnualPlanReadiness(readinessChecks),
    [serverReadiness, readinessChecks],
  );

  const access = usePlanWorkflowAccess(planStatus, readinessSummary);

  // Auto-open submission readiness dialog when navigated with ?action=submit
  useEffect(() => {
    if (searchParams.get('action') === 'submit' && plan && !plansLoading) {
      if (access.submit.enabled) {
        setShowReadiness(true);
      }
      searchParams.delete('action');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, plan, plansLoading, access.submit.enabled]);

  const stats = useMemo(() => {
    const all = engagements || [];
    const closed = all.filter((e: any) => ['Closed', 'Completed'].includes(e.status));
    const ongoing = all.filter((e: any) => ['In Progress', 'Fieldwork', 'Fieldwork Complete', 'Observation', 'Reporting', 'Report Issued'].includes(e.status));
    const planned = all.filter((e: any) => ['Planned', 'Draft', 'Ready', 'In Preparation', 'Approved'].includes(e.status));
    const totalDays = all.reduce((sum: number, e: any) => sum + (Number(e.estimated_days) || 0), 0);
    const totalWeeks = all.reduce((sum: number, e: any) => sum + (Number(e.estimated_hours) || 0), 0);
    const highRisk = all.filter((e: any) => ['High', 'Critical'].includes(e.engagement_risk_rating)).length;
    return { total: all.length, planned: planned.length, ongoing: ongoing.length, completed: closed.length, totalDays, totalWeeks, highRisk };
  }, [engagements]);

  const handleSubmitForApproval = async () => {
    if (!id || !plan) return;
    submitPlan.mutate(
      { planId: id, plan, engagements },
      {
        onSuccess: () => {
          setShowReadiness(false);
          setConflictResult(null);
        },
      },
    );
  };

  if (plansLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-muted-foreground">Audit plan not found.</p>
        <Button variant="outline" onClick={() => navigate('/audit/audit-plans')}>
          <ArrowLeft className="h-4 w-4 mr-2" />Back to Plans
        </Button>
      </div>
    );
  }

  return (
    <PageShell
      title={plan.title || 'Plan Workspace'}
      subtitle={`Fiscal Year: ${plan.fiscal_year || '—'} • Version: v${plan.current_version_number || 1} • Status: ${planStatus}`}
      breadcrumbs={[{ label: 'Internal Audit' }, { label: 'Annual Plans', href: '/audit/audit-plans' }, { label: plan.title || 'Workspace' }]}
      isLoading={engLoading}
      actions={
        <div className="flex items-center gap-2">
          {/* Submit button — visible with tooltip when disabled */}
          {access.submit.visible && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      onClick={() => access.submit.enabled ? setShowReadiness(true) : undefined}
                      disabled={!access.submit.enabled}
                    >
                      <Send className="h-4 w-4 mr-2" />Submit for Approval
                    </Button>
                  </span>
                </TooltipTrigger>
                {!access.submit.enabled && access.submit.reason && (
                  <TooltipContent className="max-w-[300px]">
                    <p className="text-xs">{access.submit.reason}</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          )}

          {access.revise.visible && access.revise.enabled && (
            <Button variant="outline" onClick={() => setRevisionPlan(plan)}>
              <Edit className="h-4 w-4 mr-2" />Revise Plan
            </Button>
          )}

          {/* Withdraw */}
          {access.withdraw.visible && access.withdraw.enabled && (
            <Button variant="outline" onClick={() => setShowWithdraw(true)}>
              <Undo2 className="h-4 w-4 mr-2" />Withdraw
            </Button>
          )}

          <Button variant="outline" onClick={() => navigate('/audit/audit-plans')}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        </div>
      }
    >
      {/* Approval Status Banner */}
      <PlanApprovalBanner plan={plan} />
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <MetricCard title="Engagements" value={stats.total} icon={Briefcase} variant="info" />
        <MetricCard title="Planned" value={stats.planned} icon={Clock} variant="warning" />
        <MetricCard title="In Progress" value={stats.ongoing} icon={AlertTriangle} variant="default" />
        <MetricCard title="Completed" value={stats.completed} icon={CheckCircle} variant="success" />
        <MetricCard title="High/Critical" value={stats.highRisk} icon={ShieldCheck} variant="default" />
        <MetricCard title="Total Days" value={`${stats.totalDays}d (${stats.totalWeeks}w)`} icon={Clock} variant="info" />
      </div>

      {/* 7-Tab Workspace */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
          <TabsTrigger value="engagements">Engagements ({stats.total})</TabsTrigger>
          <TabsTrigger value="coverage">Coverage & Risk</TabsTrigger>
          <TabsTrigger value="capacity">Capacity & Schedule</TabsTrigger>
          <TabsTrigger value="autoplan">Auto Plan</TabsTrigger>
          <TabsTrigger value="approval">Approval & Amendments</TabsTrigger>
          <TabsTrigger value="boardpack">Board Pack</TabsTrigger>
          <TabsTrigger value="distribution">Distribution</TabsTrigger>
          <TabsTrigger value="closure">Closure</TabsTrigger>
        </TabsList>

        <TabsContent value="portfolio">
          <PlanPortfolioPanel planId={id!} />
        </TabsContent>

        <TabsContent value="closure">
          <PlanClosurePanel planId={id!} plan={plan} />
        </TabsContent>


        {/* Overview Tab */}
        <TabsContent value="overview">
          {isEditingHeader ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Edit Plan Header & Narrative</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setIsEditingHeader(false)}><X className="h-4 w-4" /></Button>
              </CardHeader>
              <CardContent>
                <AnnualPlanForm
                  plan={plan}
                  onClose={() => setIsEditingHeader(false)}
                  onCreate={async (data) => {}}
                  onUpdate={async (data) => { await updatePlan.mutateAsync(data); }}
                />
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-sm">Plan Information</CardTitle>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Button variant="ghost" size="sm" onClick={() => access.edit.enabled ? setIsEditingHeader(true) : undefined} disabled={!access.edit.enabled}>
                              <Edit className="h-3.5 w-3.5 mr-1" />Edit
                            </Button>
                          </span>
                        </TooltipTrigger>
                        {!access.edit.enabled && access.edit.reason && (
                          <TooltipContent className="max-w-[280px]">
                            <p className="text-xs">{access.edit.reason}</p>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                  </CardHeader>
                  <CardContent>
                    <DetailRow label="Plan Title" value={plan.title} />
                    <DetailRow label="Fiscal Year" value={plan.fiscal_year} />
                    <DetailRow label="Status" value={<StatusBadge status={plan.status || 'Draft'} />} />
                    <DetailRow label="Board Pack" value={<StatusBadge status={plan.board_pack_status || 'None'} />} />
                    <DetailRow label="Version" value={`v${plan.current_version_number || 1}`} />
                    <DetailRow label="Created By" value={plan.created_by || plan.plan_owner || '—'} />
                    <DetailRow label="Last Updated By" value={plan.updated_by || '—'} />
                    <DetailRow label="Approved By" value={plan.approved_by || '—'} />
                    <DetailRow label="Created" value={plan.created_at ? formatDateForDisplay(plan.created_at) : '—'} />
                    <DetailRow label="Last Updated" value={plan.updated_at ? formatDateForDisplay(plan.updated_at) : '—'} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-sm">Planning Narrative</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    {plan.executive_summary && (
                      <div>
                        <p className="text-xs text-muted-foreground">Executive Summary</p>
                        <p className="text-sm mt-1 whitespace-pre-wrap">{plan.executive_summary}</p>
                      </div>
                    )}
                    {plan.objective && (
                      <div>
                        <p className="text-xs text-muted-foreground">Objective</p>
                        <p className="text-sm mt-1 whitespace-pre-wrap">{plan.objective}</p>
                      </div>
                    )}
                    {plan.methodology && (
                      <div>
                        <p className="text-xs text-muted-foreground">Methodology</p>
                        <p className="text-sm mt-1 whitespace-pre-wrap">{plan.methodology}</p>
                      </div>
                    )}
                    {plan.planning_assumptions && (
                      <div>
                        <p className="text-xs text-muted-foreground">Planning Assumptions</p>
                        <p className="text-sm mt-1 whitespace-pre-wrap">{plan.planning_assumptions}</p>
                      </div>
                    )}
                    {plan.exclusions && (
                      <div>
                        <p className="text-xs text-muted-foreground">Exclusions</p>
                        <p className="text-sm mt-1 whitespace-pre-wrap">{plan.exclusions}</p>
                      </div>
                    )}
                    {!plan.executive_summary && !plan.objective && !plan.methodology && (
                      <p className="text-sm text-muted-foreground italic">No planning narrative entered yet. Click Edit to add details.</p>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Resource & Governance Summary */}
              <div className="grid gap-4 md:grid-cols-2 mt-4">
              <Card>
                  <CardHeader><CardTitle className="text-sm">Resource & Capacity Summary</CardTitle></CardHeader>
                  <CardContent>
                    {(() => {
                      const capConfig = configFromPlan(plan);
                      const hasCapacity = capConfig.auditorCount > 0;
                      const totalHours = (engagements || []).reduce((s: number, e: any) => s + getEngagementHours(e), 0);
                      
                      if (hasCapacity) {
                        const cap = calculateCapacity(capConfig);
                        const dist = analyzeDistribution(capConfig, engagements || []);
                        return (
                          <>
                            <DetailRow label="Team Size" value={`${capConfig.auditorCount} auditor(s)`} />
                            <DetailRow label="Annual Net Capacity" value={`${cap.annualNetHours.toLocaleString()}h`} />
                            <DetailRow label="Total Planned Hours" value={totalHours > 0 ? `${totalHours.toLocaleString()}h` : 'No engagements yet'} />
                            <DetailRow label="Total Planned Days" value={stats.totalDays > 0 ? `${stats.totalDays} days` : '—'} />
                            <DetailRow label="Buffer Reserved" value={`${cap.bufferHours.toLocaleString()}h (${capConfig.bufferPct}%)`} />
                            <DetailRow label="Overall Utilization" value={
                              <span className={cn("font-semibold", dist.overallUtilization > 100 ? "text-destructive" : dist.overallUtilization > 85 ? "text-amber-600" : "text-primary")}>
                                {dist.overallUtilization}%
                              </span>
                            } />
                            <DetailRow label="Balance Score" value={
                              <span className={cn("font-semibold", dist.isBalanced ? "text-green-600" : "text-amber-600")}>
                                {dist.balanceScore}/100 {dist.isBalanced ? '✓' : '⚠'}
                              </span>
                            } />
                            <div className="mt-3 space-y-1.5">
                              <div className="flex justify-between text-xs">
                                <span className="text-muted-foreground">Utilization ({totalHours}h of {cap.annualNetHours}h)</span>
                                <span className={cn("font-semibold", dist.overallUtilization > 100 ? "text-destructive" : "text-primary")}>{dist.overallUtilization}%</span>
                              </div>
                              <Progress value={Math.min(100, dist.overallUtilization)} className="h-2" />
                            </div>
                          </>
                        );
                      }
                      
                      // Fallback: no capacity config
                      return (
                        <>
                          <DetailRow label="Total Planned Days" value={stats.totalDays > 0 ? `${stats.totalDays} days` : 'No engagements yet'} />
                          <DetailRow label="Total Planned Hours" value={totalHours > 0 ? `${totalHours}h` : '—'} />
                          <div className="mt-3 p-2 rounded border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 text-xs text-amber-700 dark:text-amber-400">
                            <BarChart3 className="h-3.5 w-3.5 inline mr-1" />
                            Configure <strong>Team Capacity</strong> in plan settings to enable effort-based planning.
                          </div>
                        </>
                      );
                    })()}
                    {plan.resource_constraints && (
                      <div className="mt-3 pt-2 border-t border-border/50">
                        <p className="text-xs text-muted-foreground">Constraints</p>
                        <p className="text-sm mt-1">{plan.resource_constraints}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-sm">Governance & Approval</CardTitle></CardHeader>
                  <CardContent>
                    <DetailRow label="Board / Committee" value={plan.board_committee_name || '—'} />
                    <DetailRow label="Plan Status" value={<StatusBadge status={plan.status || 'Draft'} />} />
                    <DetailRow label="Approved By" value={plan.approved_by || 'Pending'} />
                    <DetailRow label="Approved Date" value={plan.approved_date ? formatDateForDisplay(plan.approved_date) : 'Pending'} />
                    <DetailRow label="Minutes Reference" value={plan.minutes_reference || 'To be recorded after approval'} />
                    {plan.approval_comments && (
                      <div className="mt-3 pt-2 border-t border-border/50">
                        <p className="text-xs text-muted-foreground">Last Review Comments</p>
                        <p className="text-sm mt-1 italic">{plan.approval_comments}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        {/* Engagements Tab */}
        <TabsContent value="engagements">
          <EngagementBuilder planId={id!} planStatus={planStatus} planFiscalYear={plan.fiscal_year} />
        </TabsContent>

        {/* Coverage & Risk Tab */}
        <TabsContent value="coverage">
          <CoverageRiskTab planId={id!} engagements={engagements || []} />
        </TabsContent>

        {/* Capacity & Schedule Tab */}
        <TabsContent value="capacity">
          <CapacityCalendarPanel planId={id!} plan={plan} />
        </TabsContent>

        {/* Auto Plan Tab */}
        <TabsContent value="autoplan">
          <AutoPlanSuggestions planId={id!} planStatus={planStatus} />
        </TabsContent>

        {/* Approval & Amendments Tab */}
        <TabsContent value="approval">
          <div className="grid gap-4 md:grid-cols-2">
            <PlanApprovalHistoryTimeline planId={id!} />
            <PlanAmendmentHistory planId={id!} planType="annual" />
          </div>
          <PlanVersionHistory planId={id!} />
        </TabsContent>

        {/* Board Pack Tab */}
        <TabsContent value="boardpack">
          <BoardPackTab planId={id!} plan={plan} engagements={engagements || []} />
        </TabsContent>

        {/* Distribution Tab */}
        <TabsContent value="distribution">
          <PlanDistributionTab planId={id!} plan={plan} />
        </TabsContent>
      </Tabs>

      {/* Submission Readiness Dialog — uses same startApproval RPC */}
      <PlanSubmissionReadiness
        open={showReadiness}
        onOpenChange={setShowReadiness}
        checks={readinessChecks}
        engagementCount={(engagements || []).length}
        onSubmit={handleSubmitForApproval}
        isSubmitting={submitPlan.isPending}
      />

      {/* Withdraw Dialog */}
      <ConfirmDialog
        open={showWithdraw}
        onOpenChange={setShowWithdraw}
        title="Withdraw Submission"
        description="This will move the plan back to Draft and unlock it for editing."
        onConfirm={() => {
          withdrawSubmission.mutate({ planId: id! });
          setShowWithdraw(false);
        }}
      />

      <PlanRevisionDialog open={!!revisionPlan} onOpenChange={(open) => !open && setRevisionPlan(null)} plan={revisionPlan} />
    </PageShell>
  );
}
