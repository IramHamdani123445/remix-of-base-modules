import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/common';
import { Briefcase, User, Shield, Calendar, Target, TrendingUp, AlertTriangle, CheckCircle, Clock, MessageSquare, Paperclip, FolderOpen, ClipboardCheck, Search, BarChart3, ArrowRight } from 'lucide-react';
import { formatDateForDisplay } from '@/lib/format-config';
import { LaunchReadinessPanel } from '@/components/audit/LaunchReadinessPanel';
import { AuditNextActionsPanel, deriveNextActions } from '@/components/audit/workspace/AuditNextActionsPanel';
import type { NextActionKey } from '@/components/audit/workspace/AuditNextActionsPanel';
import { useInternalAuditPermissions } from '@/hooks/useInternalAuditPermissions';
import { AuditProgressPanel } from '@/components/audit/execution/AuditProgressPanel';

function InfoRow({ label, value, highlight }: { label: string; value: any; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium text-right max-w-[60%] truncate ${highlight ? 'text-primary font-semibold' : ''}`}>{value ?? '—'}</span>
    </div>
  );
}

interface WorkspaceCounts {
  activities: number;
  evidence: number;
  workingPapers: number;
  controlTests: number;
  findings: number;
  openFindings: number;
  responses: number;
  pendingResponses: number;
  actions: number;
  overdueActions: number;
  followUps: number;
}

interface AuditOverviewTabProps {
  audit: any;
  auditId: string;
  execStatus: string;
  auditFindings: any[];
  auditResponses: any[];
  auditActions: any[];
  openFindings: any[];
  overdueActionsCount: number;
  pendingResponsesCount: number;
  getDeptName: (id: string) => string;
  getFunctionName: (id: string) => string;
  getAuditorName: (id: string) => string;
  getPlanTitle: (id: string) => string;
  workspaceCounts?: WorkspaceCounts;
  onNavigateTab?: (tab: string) => void;
}

export function AuditOverviewTab({
  audit, auditId, execStatus, auditFindings, auditResponses, auditActions,
  openFindings, overdueActionsCount, pendingResponsesCount,
  getDeptName, getFunctionName, getAuditorName, getPlanTitle,
  workspaceCounts, onNavigateTab,
}: AuditOverviewTabProps) {
  const auditPermissions = useInternalAuditPermissions();
  const navigate = useNavigate();

  const sourceLabel = audit?.engagement_type === 'Ad Hoc' ? 'Ad Hoc Audit' :
    audit?.engagement_type === 'Supplementary' ? 'Supplementary Plan' :
    audit?.annual_plan_id ? 'Annual Plan' : 'Ad Hoc Audit';

  const goTo = (tab: string) => onNavigateTab?.(tab);

  /**
   * IA-POST-UAT-01 — single dispatcher for Recommended Actions.
   * Each key resolves to the canonical governed workspace/command surface.
   * No business mutation is performed here.
   */
  const dispatchRecommendedAction = (key: NextActionKey) => {
    switch (key) {
      // Governed launch/readiness flow lives on the Preparation surface
      // (LaunchReadinessPanel → ia_launch_engagement).
      case 'LAUNCH_AUDIT':
        return goTo('preparation');
      // Canonical execution lifecycle transition surface.
      case 'BEGIN_FIELDWORK':
        return goTo('activities');
      case 'DOCUMENT_FINDINGS':
        return goTo('findings');
      // Finding release / response-request workflow.
      case 'REQUEST_MANAGEMENT_RESPONSES':
        return goTo('responses');
      // Action Centre filtered to this engagement.
      case 'FOLLOW_UP_OVERDUE_ACTIONS':
        return navigate(`/audit/action-centre?engagement=${auditId}&overdue=1`);
      // Canonical closure workspace (governed close command + disposition).
      case 'CLOSE_AUDIT':
        return goTo('closure');
      default:
        return undefined;
    }
  };


  return (
    <div className="grid gap-5 md:grid-cols-3">
      <div className="md:col-span-2 space-y-4">
        {/* Server-derived lifecycle progress */}
        <AuditProgressPanel auditId={auditId} />

        {/* Headline counters */}
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MiniStat icon={AlertTriangle} label="Findings" value={auditFindings.length} color="text-amber-600" />
              <MiniStat icon={MessageSquare} label="Responses" value={`${auditResponses.length}/${auditFindings.length}`} color="text-blue-600" />
              <MiniStat icon={CheckCircle} label="Actions" value={auditActions.length} color="text-emerald-600" />
              <MiniStat icon={Clock} label="Overdue" value={overdueActionsCount} color={overdueActionsCount > 0 ? "text-destructive" : "text-muted-foreground"} />
            </div>
          </CardContent>
        </Card>


        {/* Quick Jump Cards */}
        {workspaceCounts && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Workspace Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <QuickJumpCard icon={ClipboardCheck} label="Activities" count={workspaceCounts.activities} onClick={() => goTo('activities')} />
                <QuickJumpCard icon={Paperclip} label="Evidence" count={workspaceCounts.evidence} onClick={() => goTo('evidence')} />
                <QuickJumpCard icon={FolderOpen} label="Working Papers" count={workspaceCounts.workingPapers} onClick={() => goTo('working-papers')} />
                <QuickJumpCard icon={AlertTriangle} label="Findings" count={workspaceCounts.findings} subtitle={workspaceCounts.openFindings > 0 ? `${workspaceCounts.openFindings} open` : undefined} variant={workspaceCounts.openFindings > 0 ? 'warning' : 'default'} onClick={() => goTo('findings')} />
                <QuickJumpCard icon={MessageSquare} label="Responses" count={workspaceCounts.responses} subtitle={workspaceCounts.pendingResponses > 0 ? `${workspaceCounts.pendingResponses} pending` : undefined} variant={workspaceCounts.pendingResponses > 0 ? 'warning' : 'default'} onClick={() => goTo('responses')} />
                <QuickJumpCard icon={CheckCircle} label="Actions" count={workspaceCounts.actions} subtitle={workspaceCounts.overdueActions > 0 ? `${workspaceCounts.overdueActions} overdue` : undefined} variant={workspaceCounts.overdueActions > 0 ? 'danger' : 'default'} onClick={() => goTo('actions')} />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Audit Details */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Briefcase className="h-4 w-4 text-muted-foreground" />Audit Details</CardTitle></CardHeader>
          <CardContent>
            <InfoRow label="Audit Title" value={audit?.engagement_name} highlight />
            <InfoRow label="Audit Code" value={audit?.engagement_code} />
            <InfoRow label="Source" value={sourceLabel} />
            <InfoRow label="Type" value={audit?.engagement_type || 'Planned Audit'} />
            <InfoRow label="Status" value={<StatusBadge status={audit?.status} />} />
            <InfoRow label="Approval" value={
              audit?.approved_by && audit?.approved_at 
                ? <span className="text-primary font-medium">Approved by {audit.approved_by}</span>
                : <span className="text-muted-foreground">Not yet approved</span>
            } />
            <InfoRow label="Risk Rating" value={<StatusBadge status={audit?.engagement_risk_rating} />} />
            {audit?.annual_plan_id && <InfoRow label="Annual Plan" value={getPlanTitle(audit.annual_plan_id)} />}
            {audit?.launched_at && <InfoRow label="Launched" value={`${formatDateForDisplay(audit.launched_at)} by ${audit.launched_by || '—'}`} />}
          </CardContent>
        </Card>

        {/* Coverage & Team */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground" />Coverage & Team</CardTitle></CardHeader>
          <CardContent>
            <InfoRow label="Department" value={audit?.department_id ? getDeptName(audit.department_id) : '—'} />
            <InfoRow label="Function" value={audit?.function_id ? getFunctionName(audit.function_id) : '—'} />
            <InfoRow label="Lead Auditor" value={audit?.lead_auditor_id ? getAuditorName(audit.lead_auditor_id) : '—'} />
            <InfoRow label="Reviewer" value={audit?.reviewer_id ? getAuditorName(audit.reviewer_id) : '—'} />
            <InfoRow label="Auditee Contact" value={audit?.auditee_contact || '—'} />
          </CardContent>
        </Card>

        {/* Schedule */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Calendar className="h-4 w-4 text-muted-foreground" />Schedule</CardTitle></CardHeader>
          <CardContent>
            <InfoRow label="Planned Start" value={audit?.planned_start_date ? formatDateForDisplay(audit.planned_start_date) : '—'} />
            <InfoRow label="Planned End" value={audit?.planned_end_date ? formatDateForDisplay(audit.planned_end_date) : '—'} />
            <InfoRow label="Actual Start" value={audit?.actual_start_date ? formatDateForDisplay(audit.actual_start_date) : '—'} />
            <InfoRow label="Estimated Days" value={audit?.estimated_days || '—'} />
          </CardContent>
        </Card>

        {/* Scope & Objectives */}
        {(audit?.scope || audit?.objectives || audit?.methodology) && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Target className="h-4 w-4 text-muted-foreground" />Scope & Objectives</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {audit?.objectives && <div><p className="text-xs font-medium text-muted-foreground mb-1">Objectives</p><p className="text-sm leading-relaxed whitespace-pre-wrap">{audit.objectives}</p></div>}
              {audit?.scope && <div><p className="text-xs font-medium text-muted-foreground mb-1">Scope</p><p className="text-sm leading-relaxed whitespace-pre-wrap">{audit.scope}</p></div>}
              {audit?.methodology && <div><p className="text-xs font-medium text-muted-foreground mb-1">Methodology</p><p className="text-sm leading-relaxed whitespace-pre-wrap">{audit.methodology}</p></div>}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Right sidebar */}
      <div className="space-y-4">
        <LaunchReadinessPanel engagementId={auditId} currentExecutionStatus={execStatus} />
        <AuditNextActionsPanel
          actions={deriveNextActions(audit, {
            findings: auditFindings.length,
            openFindings: openFindings.length,
            responses: auditResponses.length,
            actions: auditActions.length,
            overdueActions: overdueActionsCount,
          }, {
            canLaunch: auditPermissions.can('launch_department_audit'),
            canClose: auditPermissions.can('close_department_audit'),
            canExecuteAudit: auditPermissions.can('execute_audit_activities'),
            canManageActions: auditPermissions.can('progress_audit_actions') || auditPermissions.can('manage_audit_followups'),
          })}
          onDispatch={dispatchRecommendedAction}
        />

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Execution Summary</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            <InfoRow label="Findings" value={auditFindings.length} />
            <InfoRow label="Open Findings" value={openFindings.length} />
            <InfoRow label="Pending Responses" value={pendingResponsesCount} />
            <InfoRow label="Actions" value={auditActions.length} />
            <InfoRow label="Overdue Actions" value={overdueActionsCount} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value, color }: { icon: any; label: string; value: any; color: string }) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-background border border-border/50">
      <Icon className={`h-4 w-4 ${color} shrink-0`} />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        <p className="text-sm font-bold">{value}</p>
      </div>
    </div>
  );
}

function QuickJumpCard({ icon: Icon, label, count, subtitle, variant = 'default', onClick }: {
  icon: any; label: string; count: number; subtitle?: string; variant?: 'default' | 'warning' | 'danger'; onClick?: () => void;
}) {
  const borderColor = variant === 'danger' ? 'border-destructive/30 hover:border-destructive/50' :
    variant === 'warning' ? 'border-amber-200 hover:border-amber-300 dark:border-amber-800/30 dark:hover:border-amber-700/50' :
    'border-border/50 hover:border-border';
  
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 p-3 rounded-lg border ${borderColor} bg-background hover:bg-muted/30 transition-all text-left group cursor-pointer`}
    >
      <Icon className="h-4 w-4 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold">{count}</p>
          <p className="text-xs text-muted-foreground truncate">{label}</p>
        </div>
        {subtitle && (
          <p className={`text-[10px] font-medium mt-0.5 ${variant === 'danger' ? 'text-destructive' : variant === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
            {subtitle}
          </p>
        )}
      </div>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </button>
  );
}
