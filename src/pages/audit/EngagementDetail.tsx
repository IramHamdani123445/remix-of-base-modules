import React, { useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Briefcase, Loader2, AlertTriangle, ClipboardCheck,
  FileText, MessageSquare, CheckCircle, BarChart3, Clock, Shield, ListChecks, Eye,
  Paperclip, FolderOpen, Search, ArrowRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { StatusBadge } from '@/components/common';
import { useIAEngagements } from '@/hooks/useAuditDataPhase2';
import { useIADepartments, useIAAnnualPlans, useIAAuditors, useIADepartmentFunctions, useIAFindings, useIAActionTracking, useIAManagementResponses } from '@/hooks/useAuditData';
import { useEngagementActivities, useEngagementEvidence, useEngagementWorkingPapers, useEngagementControlTests, useEngagementFollowUps } from '@/hooks/useEngagementData';
import { formatDateForDisplay } from '@/lib/format-config';
import { useToast } from '@/hooks/use-toast';
import { useTransitionExecutionStatus, type ExecutionStatus } from '@/hooks/useEngagementExecution';
import { AuditWorkspaceShell } from '@/components/audit/workspace/AuditWorkspaceShell';
import { AuditEmptyState } from '@/components/audit/workspace/AuditEmptyState';
import { formatDepartmentLabel } from '@/lib/audit/departmentLabel';

import {
  AuditOverviewTab,
  AuditPreparationTab,
  AuditActivitiesTab,
  AuditEvidenceTab,
  AuditWorkingPapersTab,
  AuditFindingsTab,
  AuditResponsesTab,
  AuditActionsTab,
  AuditTimelineTab,
  AuditControlTestsTab,
  AuditFollowUpsTab,
  AuditClosureTab,
} from '@/components/audit/execution';

// ===== Tab Badge =====
function TabBadge({ count, variant = 'default' }: { count: number; variant?: 'default' | 'warning' | 'danger' | 'success' }) {
  if (count === 0) return null;
  const colors = {
    default: 'bg-muted text-muted-foreground',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    danger: 'bg-destructive/10 text-destructive',
    success: 'bg-primary/10 text-primary',
  };
  return (
    <span className={`ml-1.5 h-5 min-w-[20px] rounded-full px-1.5 text-[10px] font-bold leading-5 inline-flex items-center justify-center ${colors[variant]}`}>
      {count}
    </span>
  );
}

// ===== Smart Alerts =====
function SmartAlertsBanner({ audit, auditFindings, auditResponses, auditActions }: {
  audit: any; auditFindings: any[]; auditResponses: any[]; auditActions: any[];
}) {
  const alerts: { type: 'warning' | 'info' | 'error'; message: string }[] = [];
  const execStatus = audit.execution_status || 'Planned';

  if ((execStatus === 'Planned' || execStatus === 'Ready for Launch') && audit.planned_start_date) {
    const daysUntilStart = Math.ceil((new Date(audit.planned_start_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysUntilStart <= 7 && daysUntilStart > 0) {
      alerts.push({ type: 'warning', message: `Planned start in ${daysUntilStart} day(s) — audit not yet launched.` });
    } else if (daysUntilStart <= 0) {
      alerts.push({ type: 'error', message: 'Planned start date has passed — audit not yet launched.' });
    }
  }

  const pendingResponses = auditFindings.filter(f =>
    !auditResponses.find(r => r.finding_id === f.id) && f.status !== 'Closed'
  );
  if (pendingResponses.length > 0 && execStatus === 'Management Response Pending') {
    alerts.push({ type: 'warning', message: `${pendingResponses.length} finding(s) awaiting management response.` });
  }

  const overdueActions = auditActions.filter(a =>
    a.target_date && !['Completed', 'Closed'].includes(a.status || '') && new Date(a.target_date) < new Date()
  );
  if (overdueActions.length > 0) {
    alerts.push({ type: 'error', message: `${overdueActions.length} overdue action item(s).` });
  }

  const findingsWithoutEvidence = auditFindings.filter(f =>
    f.status !== 'Closed' && (!f.evidence_ids || (Array.isArray(f.evidence_ids) && f.evidence_ids.length === 0))
  );
  if (findingsWithoutEvidence.length > 0) {
    alerts.push({ type: 'info', message: `${findingsWithoutEvidence.length} finding(s) have no supporting evidence attached.` });
  }

  const unassignedActions = auditActions.filter(a =>
    !a.assigned_to && !['Completed', 'Closed'].includes(a.status || '')
  );
  if (unassignedActions.length > 0) {
    alerts.push({ type: 'warning', message: `${unassignedActions.length} action(s) have no assignee.` });
  }

  if (audit.planned_end_date && !['Closed', 'Completed'].includes(execStatus)) {
    const daysUntilEnd = Math.ceil((new Date(audit.planned_end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysUntilEnd <= 3 && daysUntilEnd > 0) {
      alerts.push({ type: 'warning', message: `Planned end date is in ${daysUntilEnd} day(s).` });
    } else if (daysUntilEnd <= 0) {
      alerts.push({ type: 'error', message: `Planned end date has passed (${Math.abs(daysUntilEnd)} day(s) overdue).` });
    }
  }

  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2">
      {alerts.map((alert, idx) => (
        <div key={idx} className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium ${
          alert.type === 'error' ? 'bg-destructive/10 text-destructive border border-destructive/20' :
          alert.type === 'warning' ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 border border-amber-200 dark:border-amber-800/30' :
          'bg-primary/10 text-primary border border-primary/20'
        }`}>
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {alert.message}
        </div>
      ))}
    </div>
  );
}

// ===== Tab Separator =====
function TabSep() {
  return <div className="h-4 w-px bg-border/60 mx-1 shrink-0 self-center" />;
}

// ===== Main Component =====
export default function EngagementDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const transitionMutation = useTransitionExecutionStatus();

  const { data: engagements = [], isLoading, update: updateAudit } = useIAEngagements();
  const { data: departments = [] } = useIADepartments();
  const { data: plans = [] } = useIAAnnualPlans();
  const { data: auditors = [] } = useIAAuditors();
  const audit = useMemo(() => engagements.find((e: any) => e.id === id), [engagements, id]);
  const { data: deptFunctions = [] } = useIADepartmentFunctions(audit?.department_id || undefined);

  const { data: allFindings = [] } = useIAFindings();
  const { data: allActions = [] } = useIAActionTracking();
  const { data: allResponses = [] } = useIAManagementResponses();
  const { data: auditActivities = [] } = useEngagementActivities(id);
  const { data: auditEvidence = [] } = useEngagementEvidence(id);
  const { data: auditWorkingPapers = [] } = useEngagementWorkingPapers(id);
  const { data: auditControlTests = [] } = useEngagementControlTests(id);
  const { data: auditFollowUps = [] } = useEngagementFollowUps(id);

  const auditFindings = useMemo(() => allFindings.filter((f: any) => f.engagement_id === id), [allFindings, id]);
  const auditActions = useMemo(() => allActions.filter((a: any) => a.engagement_id === id), [allActions, id]);
  const auditResponses = useMemo(() => {
    const findingIds = auditFindings.map((f: any) => f.id);
    return allResponses.filter((r: any) => r.engagement_id === id || findingIds.includes(r.finding_id));
  }, [allResponses, auditFindings, id]);

  const openFindings = auditFindings.filter((f: any) => !['Closed', 'Resolved'].includes(f.status || ''));
  const overdueActionsCount = auditActions.filter((a: any) => a.target_date && !['Completed', 'Closed'].includes(a.status || '') && new Date(a.target_date) < new Date()).length;
  const pendingResponsesCount = auditFindings.filter((f: any) => !auditResponses.find((r: any) => r.finding_id === f.id) && f.status !== 'Closed').length;

  const getDeptName = (did: string) => formatDepartmentLabel(departments?.find((d: any) => d.id === did));
  const getDeptObj = (did: string) => departments?.find((d: any) => d.id === did);
  const getFunctionName = (fid: string) => deptFunctions?.find((f: any) => f.id === fid)?.function_name || '—';
  const getAuditorName = (aid: string) => auditors?.find((a: any) => a.id === aid)?.name || '—';
  const getPlanTitle = (pid: string) => plans?.find((p: any) => p.id === pid)?.title || '—';

  const [activeTab, setActiveTab] = useState('overview');

  const engagementContext = useMemo(() => {
    if (!audit) return undefined;
    const dept = getDeptObj(audit.department_id);
    return {
      engagement_name: audit.engagement_name || '',
      department_name: formatDepartmentLabel(dept),
      department_head: dept?.head || '',
      department_email: dept?.email || '',
      lead_auditor_name: getAuditorName(audit.lead_auditor_id),
      planned_start_date: audit.planned_start_date || '',
      planned_end_date: audit.planned_end_date || '',
      objectives: audit.objectives || '',
      scope: audit.scope || '',
      function_name: getFunctionName(audit.function_id),
    };
  }, [audit, departments, auditors, deptFunctions]);

  // Closure is a governed server-side command — route the user to the Closure tab,
  // where the closure gate is evaluated and the disposition is captured.
  const handleCloseAudit = () => setActiveTab('closure');

  // Workspace counts for overview quick-jump
  const workspaceCounts = useMemo(() => ({
    activities: auditActivities.length,
    evidence: auditEvidence.length,
    workingPapers: auditWorkingPapers.length,
    controlTests: auditControlTests.length,
    findings: auditFindings.length,
    openFindings: openFindings.length,
    responses: auditResponses.length,
    pendingResponses: pendingResponsesCount,
    actions: auditActions.length,
    overdueActions: overdueActionsCount,
    followUps: auditFollowUps.length,
  }), [auditActivities, auditEvidence, auditWorkingPapers, auditControlTests, auditFindings, openFindings, auditResponses, pendingResponsesCount, auditActions, overdueActionsCount, auditFollowUps]);

  if (!audit && !isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Button variant="ghost" onClick={() => navigate('/audit/audits')}><ArrowLeft className="h-4 w-4 mr-2" />Back</Button>
        <AuditEmptyState icon={Briefcase} title="Audit not found" description="The requested audit could not be found." />
      </div>
    );
  }

  const execStatus = audit?.execution_status || 'Planned';
  const sourceLabel = audit?.engagement_type === 'Ad Hoc' ? 'Ad Hoc' :
    audit?.engagement_type === 'Supplementary' ? 'Supplementary Plan' :
    audit?.annual_plan_id ? 'Annual Plan' : 'Ad Hoc';

  return (
    <div className="p-6">
      <AuditWorkspaceShell
        title={audit?.engagement_name || 'Untitled Audit'}
        code={audit?.engagement_code}
        subtitle={[
          audit?.department_id ? getDeptName(audit.department_id) : null,
          audit?.function_id ? getFunctionName(audit.function_id) : null,
        ].filter(Boolean).join(' › ') || undefined}
        backTo="/audit/audits"
        breadcrumbs={[
          { label: 'Internal Audit', href: '/audit/dashboard' },
          { label: 'Audits', href: '/audit/audits' },
          { label: audit?.engagement_code || 'Detail' },
        ]}
        status={audit?.status}
        executionStatus={execStatus}
        isLoading={isLoading}
        summaryProps={{
          department: audit?.department_id ? getDeptName(audit.department_id) : undefined,
          leadAuditor: audit?.lead_auditor_id ? getAuditorName(audit.lead_auditor_id) : undefined,
          startDate: audit?.planned_start_date,
          endDate: audit?.planned_end_date,
          riskRating: audit?.engagement_risk_rating,
          findingsCount: auditFindings.length,
          openFindingsCount: openFindings.length,
          overdueActions: overdueActionsCount,
          pendingResponses: pendingResponsesCount,
        }}
        actions={
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`px-2 py-0.5 rounded-full font-medium ${
              sourceLabel === 'Annual Plan' ? 'bg-primary/10 text-primary' :
              sourceLabel === 'Supplementary Plan' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
              'bg-muted text-muted-foreground'
            }`}>{sourceLabel}</span>
          </div>
        }
        alerts={audit ? <SmartAlertsBanner audit={audit} auditFindings={auditFindings} auditResponses={auditResponses} auditActions={auditActions} /> : undefined}
      >
        {/* Grouped Tab Structure */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-2">
          <TabsList className="flex-wrap bg-transparent h-auto gap-0 p-0">
            {/* === Overview Group === */}
            <TabsTrigger value="overview" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
              <Eye className="h-3.5 w-3.5 mr-1.5" />Overview
            </TabsTrigger>
            <TabsTrigger value="preparation" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
              Preparation
            </TabsTrigger>

            <TabSep />

            {/* === Fieldwork Group === */}
            <TabsTrigger value="activities" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
              <ClipboardCheck className="h-3.5 w-3.5 mr-1.5" />Activities
              <TabBadge count={auditActivities.length} />
            </TabsTrigger>
            <TabsTrigger value="evidence" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
              <Paperclip className="h-3.5 w-3.5 mr-1.5" />Evidence
              <TabBadge count={auditEvidence.length} />
            </TabsTrigger>
            <TabsTrigger value="working-papers" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
              <FolderOpen className="h-3.5 w-3.5 mr-1.5" />Working Papers
              <TabBadge count={auditWorkingPapers.length} />
            </TabsTrigger>

            <TabSep />

            {/* === Findings & Response Group === */}
            <TabsTrigger value="findings" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
              <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />Findings
              <TabBadge count={auditFindings.length} variant={openFindings.length > 0 ? 'warning' : 'default'} />
            </TabsTrigger>
            <TabsTrigger value="responses" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
              <MessageSquare className="h-3.5 w-3.5 mr-1.5" />Responses
              <TabBadge count={pendingResponsesCount} variant="warning" />
            </TabsTrigger>
            <TabsTrigger value="actions" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
              <CheckCircle className="h-3.5 w-3.5 mr-1.5" />Actions
              <TabBadge count={overdueActionsCount} variant="danger" />
            </TabsTrigger>
            <TabsTrigger value="follow-ups" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
              <Search className="h-3.5 w-3.5 mr-1.5" />Follow-ups
              <TabBadge count={auditFollowUps.length} />
            </TabsTrigger>

            <TabSep />

            {/* === Output Group === */}

            <TabsTrigger value="timeline" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
              <Clock className="h-3.5 w-3.5 mr-1.5" />Timeline
            </TabsTrigger>
            <TabsTrigger value="closure" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
              <Shield className="h-3.5 w-3.5 mr-1.5" />Closure
            </TabsTrigger>


            {/* === Report Center CTA === */}
            <Button
              variant="outline"
              size="sm"
              className="ml-3 gap-1.5 text-xs border-primary/30 text-primary hover:bg-primary/10"
              onClick={() => navigate(`/audit/audit-reports?engagementId=${id}`)}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              Open Report Center
              <ArrowRight className="h-3 w-3" />
            </Button>
          </TabsList>

          <TabsContent value="overview">
            <AuditOverviewTab
              audit={audit} auditId={id!} execStatus={execStatus}
              auditFindings={auditFindings} auditResponses={auditResponses} auditActions={auditActions}
              openFindings={openFindings} overdueActionsCount={overdueActionsCount} pendingResponsesCount={pendingResponsesCount}
              getDeptName={getDeptName} getFunctionName={getFunctionName} getAuditorName={getAuditorName} getPlanTitle={getPlanTitle}
              workspaceCounts={workspaceCounts}
              onNavigateTab={setActiveTab}
            />
          </TabsContent>

          <TabsContent value="preparation">
            <AuditPreparationTab auditId={id!} audit={audit} engagementContext={engagementContext} />
          </TabsContent>

          <TabsContent value="activities">
            <AuditActivitiesTab auditId={id!} auditors={auditors} />
          </TabsContent>

          <TabsContent value="evidence">
            <AuditEvidenceTab auditId={id!} auditFindings={auditFindings} auditActivities={auditActivities} />
          </TabsContent>

          <TabsContent value="working-papers">
            <AuditWorkingPapersTab auditId={id!} />
          </TabsContent>

          <TabsContent value="findings">
            <AuditFindingsTab auditId={id!} auditFindings={auditFindings} auditResponses={auditResponses} auditActions={auditActions} auditEvidence={auditEvidence} auditWorkingPapers={auditWorkingPapers} departmentId={audit?.department_id} />
          </TabsContent>

          <TabsContent value="responses">
            <AuditResponsesTab auditId={id!} auditFindings={auditFindings} auditResponses={auditResponses} departmentId={audit?.department_id} leadAuditorId={audit?.lead_auditor_id} />
          </TabsContent>

          <TabsContent value="actions">
            <AuditActionsTab auditId={id!} audit={audit} auditFindings={auditFindings} auditActions={auditActions} auditResponses={auditResponses} auditEvidence={auditEvidence} onClose={handleCloseAudit} />
          </TabsContent>

          <TabsContent value="follow-ups">
            <AuditFollowUpsTab auditId={id!} auditFindings={auditFindings} departmentId={audit?.department_id} />
          </TabsContent>


          <TabsContent value="timeline">
            <AuditTimelineTab auditId={id!} departmentId={audit?.department_id} />
          </TabsContent>

          <TabsContent value="closure">
            <AuditClosureTab auditId={id!} audit={audit} />
          </TabsContent>
        </Tabs>
      </AuditWorkspaceShell>
    </div>
  );
}
