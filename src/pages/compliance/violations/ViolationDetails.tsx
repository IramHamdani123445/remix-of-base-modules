import { useCallback, useEffect, useState } from 'react';
import { useUserCode } from '@/hooks/useUserCode';
import { useComplianceRole } from '@/hooks/useComplianceRole';
import { useParams, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  FileText, Bell, History, AlertCircle, MessageSquare, Mail, ListChecks,
  Loader2, Eye, MapPin, UserCheck, ClipboardCheck,
  Play, Search, ArrowUpCircle, CheckCircle, XCircle, RotateCcw, Lock, Building2, Briefcase
} from 'lucide-react';
import { ViolationNotesTab } from '@/components/compliance/ViolationNotesTab';
import { ViolationSLAMetrics } from '@/components/compliance/ViolationSLAMetrics';
import { caseViolationService } from '@/services/caseViolationService';
import { ViolationCorrespondenceTab } from '@/components/compliance/ViolationCorrespondenceTab';
import { ViolationActionPlanTab } from '@/components/compliance/ViolationActionPlanTab';
import { ViolationFollowUpsTab } from '@/components/compliance/ViolationFollowUpsTab';
import { ViolationNoticesTab } from '@/components/compliance/ViolationNoticesTab';
import { ViolationResolutionDialog } from '@/components/compliance/ViolationResolutionDialog';
import { ViolationActionConfirmDialog, ConfirmActionType } from '@/components/compliance/ViolationActionConfirmDialog';
import { violationLifecycleService, ViolationStatus } from '@/services/violationLifecycleService';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { fetchViolationById } from '@/services/complianceDataService';
import { fetchViolationWaivedAmount, computeOutstanding } from '@/services/complianceWaiverAmounts';

import { confirmViolation, rejectViolation } from '@/services/verificationQueueService';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { RiskScoreBadge } from '@/components/compliance/RiskScoreBadge';
import { FinancialSummaryCard } from '@/components/compliance/FinancialSummaryCard';
import { ViolationTimeline } from '@/components/compliance/ViolationTimeline';
import { AssignmentDialog } from '@/components/compliance/AssignmentDialog';
import { CreateLinkCaseDialog } from '@/components/compliance/CreateLinkCaseDialog';

// ============================================
// ACTION BUTTON CONFIGURATION PER STATUS
// ============================================
interface ActionButtonDef {
  label: string;
  icon: React.ReactNode;
  targetStatus: ViolationStatus;
  confirmType?: ConfirmActionType;
  variant: 'default' | 'destructive' | 'outline' | 'secondary';
  useResolutionDialog?: 'resolve' | 'close';
}

const STATUS_ACTIONS: Record<string, ActionButtonDef[]> = {
  OPEN: [
    { label: 'Start Work', icon: <Play className="h-4 w-4" />, targetStatus: 'IN_PROGRESS', confirmType: 'start_work', variant: 'default' },
    { label: 'Move to Review', icon: <Search className="h-4 w-4" />, targetStatus: 'UNDER_REVIEW', confirmType: 'move_to_review', variant: 'outline' },
    { label: 'Escalate', icon: <ArrowUpCircle className="h-4 w-4" />, targetStatus: 'ESCALATED', confirmType: 'escalate', variant: 'destructive' },
    { label: 'Resolve', icon: <CheckCircle className="h-4 w-4" />, targetStatus: 'RESOLVED', variant: 'default', useResolutionDialog: 'resolve' },
    { label: 'Cancel', icon: <XCircle className="h-4 w-4" />, targetStatus: 'CANCELLED', confirmType: 'cancel', variant: 'destructive' },
  ],
  IN_PROGRESS: [
    { label: 'Move to Review', icon: <Search className="h-4 w-4" />, targetStatus: 'UNDER_REVIEW', confirmType: 'move_to_review', variant: 'outline' },
    { label: 'Escalate', icon: <ArrowUpCircle className="h-4 w-4" />, targetStatus: 'ESCALATED', confirmType: 'escalate', variant: 'destructive' },
    { label: 'Resolve', icon: <CheckCircle className="h-4 w-4" />, targetStatus: 'RESOLVED', variant: 'default', useResolutionDialog: 'resolve' },
    { label: 'Cancel', icon: <XCircle className="h-4 w-4" />, targetStatus: 'CANCELLED', confirmType: 'cancel', variant: 'destructive' },
  ],
  // Note: "Return to Open" intentionally OMITTED — backward transition from
  // UNDER_REVIEW to OPEN is forbidden by the workflow engine. Use the
  // Cancel / Resolve → Reopen path instead.
  UNDER_REVIEW: [
    { label: 'Resume Work', icon: <Play className="h-4 w-4" />, targetStatus: 'IN_PROGRESS', confirmType: 'start_work', variant: 'default' },
    { label: 'Escalate', icon: <ArrowUpCircle className="h-4 w-4" />, targetStatus: 'ESCALATED', confirmType: 'escalate', variant: 'destructive' },
    { label: 'Resolve', icon: <CheckCircle className="h-4 w-4" />, targetStatus: 'RESOLVED', variant: 'default', useResolutionDialog: 'resolve' },
    { label: 'Cancel', icon: <XCircle className="h-4 w-4" />, targetStatus: 'CANCELLED', confirmType: 'cancel', variant: 'destructive' },
  ],
  ESCALATED: [
    { label: 'De-escalate to Review', icon: <RotateCcw className="h-4 w-4" />, targetStatus: 'UNDER_REVIEW', confirmType: 'de_escalate', variant: 'outline' },
    { label: 'Resolve', icon: <CheckCircle className="h-4 w-4" />, targetStatus: 'RESOLVED', variant: 'default', useResolutionDialog: 'resolve' },
    { label: 'Cancel', icon: <XCircle className="h-4 w-4" />, targetStatus: 'CANCELLED', confirmType: 'cancel', variant: 'destructive' },
  ],
  RESOLVED: [
    { label: 'Close', icon: <Lock className="h-4 w-4" />, targetStatus: 'CLOSED', variant: 'default', useResolutionDialog: 'close' },
    { label: 'Reopen', icon: <RotateCcw className="h-4 w-4" />, targetStatus: 'OPEN', confirmType: 'reopen', variant: 'outline' },
  ],
  CLOSED: [
    { label: 'Reopen', icon: <RotateCcw className="h-4 w-4" />, targetStatus: 'OPEN', confirmType: 'reopen', variant: 'outline' },
  ],
  CANCELLED: [
    { label: 'Reopen', icon: <RotateCcw className="h-4 w-4" />, targetStatus: 'OPEN', confirmType: 'reopen', variant: 'outline' },
  ],
};

export default function ViolationDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('overview');

  // Lifecycle dialog state
  const [resolutionDialogOpen, setResolutionDialogOpen] = useState(false);
  const [resolutionMode, setResolutionMode] = useState<'resolve' | 'close'>('resolve');
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmActionType, setConfirmActionType] = useState<ConfirmActionType>('start_work');
  const [pendingTargetStatus, setPendingTargetStatus] = useState<ViolationStatus>('IN_PROGRESS');
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
  const [creatingCase, setCreatingCase] = useState(false);
  const [createLinkOpen, setCreateLinkOpen] = useState(false);

  const { userCode } = useUserCode();
  const currentUserCode = userCode || 'UNKNOWN';
  const complianceRole = useComplianceRole();
  // Compliance Head/Admin-only actions: reopening cancelled violations and
  // (re)assigning violations. Officers/Inspectors are intentionally blocked.
  const canReopenCancelled = complianceRole === 'head';
  const canManageAssignments = complianceRole === 'head';
  // Verification actions (Approve / Reject) are available to Compliance Head
  // and Senior officers when a violation is sitting in UNDER_REVIEW with no
  // verification decision recorded yet — matching the Verification Queue rules.
  const canVerifyViolations = complianceRole === 'head' || complianceRole === 'senior';

  // Verification decision dialog state
  const [verifyOpen, setVerifyOpen] = useState<null | 'confirm' | 'reject'>(null);
  const [verifyNotes, setVerifyNotes] = useState('');

  const { data: violationData, isLoading: loadingCase } = useQuery({
    queryKey: ['ce_violation', id],
    queryFn: () => fetchViolationById(id!),
    enabled: !!id,
  });

  // Approved waivers reduce the displayed outstanding amount at read time.
  const { data: violationWaived = 0 } = useQuery({
    queryKey: ['ce_violation_waived', id],
    queryFn: () => fetchViolationWaivedAmount(id!),
    enabled: !!id,
  });



  const { data: otherViolations = [] } = useQuery({
    queryKey: ['ce_violations_employer', violationData?.employer_id, id],
    queryFn: async () => {
      if (!violationData?.employer_id) return [];
      const { data, error } = await supabase
        .from('ce_violations')
        .select('*, ce_violation_types(code, name, category)')
        .eq('employer_id', violationData.employer_id)
        .eq('is_deleted', false)
        .neq('id', id!)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!violationData?.employer_id,
  });

  const { data: violationHistory = [] } = useQuery({
    queryKey: ['ce_violation_history', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ce_violation_history')
        .select('*')
        .eq('violation_id', id!)
        .order('performed_at', { ascending: false });
      if (error) return [];
      return data ?? [];
    },
    enabled: !!id,
  });

  const { data: violationNoticesCount = 0 } = useQuery({
    queryKey: ['ce_notices_violation_count', id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('ce_notices')
        .select('id', { count: 'exact', head: true })
        .eq('violation_id', id!);
      if (error) return 0;
      return count ?? 0;
    },
    enabled: !!id,
  });

  // Fallback due date derived from the most recent linked notice's response
  // deadline. `ce_violations.due_date` is often null until a notice is issued,
  // so surface the notice deadline so Violation Details always show an
  // actionable due date when one exists.
  const { data: latestNoticeDue } = useQuery({
    queryKey: ['ce_notices_latest_due', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ce_notices')
        .select('due_response_date, sent_at, created_at, status')
        .eq('violation_id', id!)
        .not('due_response_date', 'is', null)
        .order('due_response_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return data;
    },
    enabled: !!id,
  });

  const { data: assignmentHistory = [] } = useQuery({
    queryKey: ['ce_violation_assignments', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ce_violation_assignments')
        .select('*, ce_assignment_queues(queue_code, queue_name, queue_type), ce_inspectors(inspector_code)')
        .eq('violation_id', id!)
        .order('assigned_at', { ascending: false });
      if (error) return [];
      return data ?? [];
    },
    enabled: !!id,
  });

  const { data: linkedCase } = useQuery({
    queryKey: ['ce_violation_linked_case', id],
    queryFn: () => caseViolationService.getLinkedCase(id!),
    enabled: !!id,
  });

  // Risk profile for employer
  const { data: riskProfile } = useQuery({
    queryKey: ['ce_risk_profile_employer', violationData?.employer_id],
    queryFn: async () => {
      if (!violationData?.employer_id) return null;
      const { data } = await supabase
        .from('ce_risk_profiles')
        .select('id, risk_band, total_score')
        .eq('employer_id', violationData.employer_id)
        .maybeSingle();
      return data;
    },
    enabled: !!violationData?.employer_id,
  });

  // ============================================
  // LIFECYCLE TRANSITION HANDLERS
  // ============================================
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['ce_violation', id] });
    queryClient.invalidateQueries({ queryKey: ['ce_violation_waived', id] });

    queryClient.invalidateQueries({ queryKey: ['ce_violation_history', id] });
    queryClient.invalidateQueries({ queryKey: ['ce_violation_linked_case', id] });
  };

  // Radix Dialog / AlertDialog occasionally leaves `pointer-events: none`
  // on <body> after a previous dialog closes (known Radix issue). That makes
  // subsequent header buttons — including Escalate — appear to "do nothing"
  // on the first click. Clearing the inline style before opening a new
  // dialog guarantees the click is honoured.
  const clearStuckBodyPointerEvents = useCallback(() => {
    if (typeof document !== 'undefined' && document.body.style.pointerEvents === 'none') {
      document.body.style.pointerEvents = '';
    }
  }, []);

  useEffect(() => {
    if (!resolutionDialogOpen && !confirmDialogOpen && !assignmentDialogOpen && !createLinkOpen && verifyOpen === null) {
      clearStuckBodyPointerEvents();
    }
  }, [resolutionDialogOpen, confirmDialogOpen, assignmentDialogOpen, createLinkOpen, verifyOpen, clearStuckBodyPointerEvents]);

  const handleActionClick = (action: ActionButtonDef) => {
    clearStuckBodyPointerEvents();
    if (action.useResolutionDialog) {
      setResolutionMode(action.useResolutionDialog);
      setResolutionDialogOpen(true);
    } else if (action.confirmType) {
      setConfirmActionType(action.confirmType);
      setPendingTargetStatus(action.targetStatus);
      setConfirmDialogOpen(true);
    }
  };

  const confirmVerificationMut = useMutation({
    mutationFn: () => confirmViolation(id!, currentUserCode, verifyNotes),
    onSuccess: () => {
      toast.success('Violation approved and moved to OPEN.');
      setVerifyOpen(null); setVerifyNotes('');
      invalidateAll();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to approve violation'),
  });
  const rejectVerificationMut = useMutation({
    mutationFn: () => rejectViolation(id!, currentUserCode, verifyNotes),
    onSuccess: () => {
      toast.success('Violation rejected and cancelled.');
      setVerifyOpen(null); setVerifyNotes('');
      invalidateAll();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to reject violation'),
  });


  const handleResolutionConfirm = async (data: { resolutionType: string; notes: string; resolutionNotes: string }) => {
    if (resolutionMode === 'resolve') {
      const result = await violationLifecycleService.resolve(
        id!, currentUserCode,
        `[${data.resolutionType}] ${data.resolutionNotes}`,
        data.notes || `Resolved as ${data.resolutionType}`
      );
      if (result.success) {
        toast.success('Violation resolved', { description: `${result.previousStatus} → RESOLVED` });
        invalidateAll();
      } else {
        toast.error('Failed to resolve', { description: result.error });
      }
    } else {
      const result = await violationLifecycleService.close(id!, currentUserCode, data.notes);
      if (result.success) {
        toast.success('Violation closed', { description: 'The violation has been finalised.' });
        invalidateAll();
      } else {
        toast.error('Failed to close', { description: result.error });
      }
    }
  };

  const handleConfirmAction = async (notes: string) => {
    const result = await violationLifecycleService.transition({
      violationId: id!,
      targetStatus: pendingTargetStatus,
      performedBy: currentUserCode,
      notes,
    });
    if (result.success) {
      toast.success(`Status updated: ${result.newStatus?.replace(/_/g, ' ')}`, {
        description: `Transitioned from ${result.previousStatus}`,
      });
      invalidateAll();
    } else {
      toast.error('Transition failed', { description: result.error });
    }
  };

  // ============================================
  // HELPERS
  // ============================================
  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      OPEN: 'bg-primary/10 text-primary',
      UNDER_REVIEW: 'bg-warning/10 text-warning',
      IN_PROGRESS: 'bg-accent/10 text-accent-foreground',
      ESCALATED: 'bg-destructive/10 text-destructive',
      RESOLVED: 'bg-green-100 text-green-800',
      CLOSED: 'bg-muted text-muted-foreground',
      CANCELLED: 'bg-muted text-muted-foreground',
    };
    return colors[status] ?? 'bg-muted text-muted-foreground';
  };

  const getPriorityColor = (priority: string) => {
    const colors: Record<string, string> = {
      Critical: 'bg-destructive/10 text-destructive',
      High: 'bg-orange-100 text-orange-800',
      Medium: 'bg-warning/10 text-warning',
      Low: 'bg-muted text-muted-foreground',
    };
    return colors[priority] ?? 'bg-muted text-muted-foreground';
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'XCD', minimumFractionDigits: 2 }).format(amount);

  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  if (loadingCase) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!violationData) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold">Violation not found</h2>
          <Button onClick={() => navigate('/compliance/violations')} className="mt-4">
            Back to Violations
          </Button>
        </div>
      </div>
    );
  }

  const v = violationData as any;
  const violationGross = Number(v.total_amount) || 0;
  const violationWaivedAmount = Number(violationWaived) || 0;
  const violationOutstanding = computeOutstanding(violationGross, 0, violationWaivedAmount);

  const typeName = v.ce_violation_types?.name ?? 'Unknown Type';
  const typeCategory = v.ce_violation_types?.category ?? '';
  const currentStatus = (v.status as string) || 'OPEN';
  const availableActions = (STATUS_ACTIONS[currentStatus] || []).filter((a) => {
    // Only Compliance Head/Admin may reopen a CANCELLED violation.
    // Officers/Inspectors cannot bypass the approval workflow.
    if (currentStatus === 'CANCELLED' && a.confirmType === 'reopen' && !canReopenCancelled) {
      return false;
    }
    return true;
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <PageHeader
        title={`Violation: ${v.violation_number}`}
        subtitle={v.employer_name}
        breadcrumbs={[
          { label: 'Compliance', href: '/compliance' },
          { label: 'Violations', href: '/compliance/violations' },
          { label: v.violation_number }
        ]}
      />

      {/* Violation Header with Action Buttons */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <CardTitle className="text-2xl">{v.violation_number}</CardTitle>
                <Badge className={getStatusColor(currentStatus)}>
                  {currentStatus.replace(/_/g, ' ')}
                </Badge>
                <Badge className={getPriorityColor(v.priority)}>
                  {v.priority}
                </Badge>
                {riskProfile && (
                  <RiskScoreBadge riskBand={riskProfile.risk_band} score={riskProfile.total_score} />
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Discovered: {v.discovered_date ? formatDate(v.discovered_date) : 'N/A'} | Created: {formatDate(v.created_at)}
              </p>
            </div>
            <div className="text-right">
              <div className="text-sm text-muted-foreground">Outstanding Amount</div>
              <div className="text-2xl font-bold text-destructive">
                {formatCurrency(violationOutstanding)}
              </div>
              {violationWaivedAmount > 0 && (
                <div className="text-xs text-muted-foreground">
                  After waiver of {formatCurrency(violationWaivedAmount)}
                </div>
              )}
            </div>

          </div>

          {/* Lifecycle Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap pt-3 border-t mt-4">
            {availableActions.map((action) => (
              <Button
                key={action.label}
                type="button"
                variant={action.variant}
                size="sm"
                title={
                  action.confirmType === 'escalate'
                    ? 'Escalate this violation to Compliance Head / Legal for senior review, formal notice or referral. Requires a written reason and is logged on the case history.'
                    : action.confirmType === 'de_escalate'
                      ? 'Return this violation from ESCALATED back to UNDER_REVIEW.'
                      : undefined
                }
                onClick={() => handleActionClick(action)}
              >
                {action.icon}
                <span className="ml-1">{action.label}</span>
              </Button>
            ))}

            {/* Verification actions — shown for violations awaiting verification
                (UNDER_REVIEW with no verification decision yet). Approves or
                rejects the row using the same service as the Verification Queue
                so decisions, history and downstream case grouping stay aligned. */}
            {canVerifyViolations
              && currentStatus === 'UNDER_REVIEW'
              && !v.verification_decision && (
              <>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => { setVerifyNotes(''); setVerifyOpen('confirm'); }}
                >
                  <CheckCircle className="h-4 w-4" />
                  <span className="ml-1">Approve (Verify)</span>
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => { setVerifyNotes(''); setVerifyOpen('reject'); }}
                >
                  <XCircle className="h-4 w-4" />
                  <span className="ml-1">Reject (Verify)</span>
                </Button>
              </>
            )}

            {/* Navigation buttons */}
            <div className="ml-auto flex gap-2">
              {linkedCase ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/compliance/cases/${linkedCase.id}`)}
                >
                  <Briefcase className="h-4 w-4 mr-1" />
                  Case: {linkedCase.case_number}
                </Button>
              ) : v.employer_id && !['RESOLVED', 'CLOSED', 'CANCELLED'].includes(currentStatus) ? (
                <Button
                  variant="default"
                  size="sm"
                  disabled={creatingCase}
                  onClick={() => setCreateLinkOpen(true)}
                >
                  <Briefcase className="h-4 w-4 mr-1" />
                  Create / Link Case
                </Button>
              ) : null}
              {v.employer_id && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/compliance/employer-360/${v.employer_id}`)}
                >
                  <Building2 className="h-4 w-4 mr-1" />
                  Employer 360
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Financial Summary */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Principal</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{formatCurrency(Number(v.principal_amount) || 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Penalties</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{formatCurrency(Number(v.penalty_amount) || 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Interest</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{formatCurrency(Number(v.interest_amount) || 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Due</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-destructive">{formatCurrency(violationOutstanding)}</div>
            {violationWaivedAmount > 0 && (
              <div className="text-xs text-muted-foreground">
                Gross {formatCurrency(violationGross)} · Waived {formatCurrency(violationWaivedAmount)}
              </div>
            )}
          </CardContent>

        </Card>
      </div>

      {/* SLA Metrics */}
      <ViolationSLAMetrics
        violationId={v.id}
        createdAt={v.created_at}
        assignedAt={v.assigned_at}
        dueDate={v.due_date ?? latestNoticeDue?.due_response_date ?? null}
        status={currentStatus}
      />

      {/* Assignment & Routing Info */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Assignment & Routing
          </CardTitle>
          {canManageAssignments && (
            <Button size="sm" variant="outline" onClick={() => setAssignmentDialogOpen(true)}>
              <UserCheck className="h-4 w-4 mr-2" />
              {v.assigned_to_name ? 'Reassign' : 'Assign'}
            </Button>
          )}
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div>
            <div className="text-sm font-medium text-muted-foreground">Zone</div>
            <div className="text-base font-medium">
              {(v as any).ce_zones?.zone_name || <span className="text-muted-foreground italic">Unresolved</span>}
            </div>
            {(v as any).ce_zones?.zone_code && (
              <div className="text-xs text-muted-foreground">{(v as any).ce_zones.zone_code}</div>
            )}
          </div>
          <div>
            <div className="text-sm font-medium text-muted-foreground">Queue</div>
            <div className="text-base font-medium">
              {(v as any).ce_assignment_queues?.queue_name || <span className="text-muted-foreground italic">Unassigned</span>}
            </div>
            {(v as any).ce_assignment_queues?.queue_type && (
              <Badge variant="outline" className="mt-1">
                {(v as any).ce_assignment_queues.queue_type}
              </Badge>
            )}
          </div>
          <div>
            <div className="text-sm font-medium text-muted-foreground">Assigned Officer</div>
            <div className="text-base font-medium">
              {v.assigned_to_name || <span className="text-muted-foreground italic">Queue-only</span>}
            </div>
            {v.assigned_at && (
              <div className="text-xs text-muted-foreground">Since {formatDate(v.assigned_at)}</div>
            )}
          </div>
          <div>
            <div className="text-sm font-medium text-muted-foreground">Resolution Method</div>
            <Badge variant="outline" className="mt-1">
              {(v as any).assignment_method || 'N/A'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5 lg:grid-cols-9">
          <TabsTrigger value="overview"><FileText className="h-4 w-4 mr-2" />Overview</TabsTrigger>
          <TabsTrigger value="timeline"><History className="h-4 w-4 mr-2" />Timeline</TabsTrigger>
          <TabsTrigger value="follow-ups"><ClipboardCheck className="h-4 w-4 mr-2" />Follow-Ups</TabsTrigger>
          <TabsTrigger value="notes"><MessageSquare className="h-4 w-4 mr-2" />Notes</TabsTrigger>
          <TabsTrigger value="correspondence"><Mail className="h-4 w-4 mr-2" />Correspondence</TabsTrigger>
          <TabsTrigger value="actions"><ListChecks className="h-4 w-4 mr-2" />Action Plan</TabsTrigger>
          <TabsTrigger value="history"><History className="h-4 w-4 mr-2" />History ({violationHistory.length})</TabsTrigger>
          <TabsTrigger value="notices"><Bell className="h-4 w-4 mr-2" />Notices ({violationNoticesCount})</TabsTrigger>
          <TabsTrigger value="other-violations"><AlertCircle className="h-4 w-4 mr-2" />Other ({otherViolations.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="space-y-4">
          <ViolationTimeline violationId={id!} />
        </TabsContent>


        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Violation Information</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-sm font-medium text-muted-foreground">Violation Type</div>
                <div className="text-base">{typeName}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Category</div>
                <Badge variant="outline">{typeCategory || '-'}</Badge>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Priority</div>
                <Badge className={getPriorityColor(v.priority)}>{v.priority}</Badge>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Severity</div>
                <div className="text-base">{v.severity || '-'}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Employer</div>
                <div className="text-base">{v.employer_name}</div>
                <div className="text-xs text-muted-foreground">{v.employer_id}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Territory</div>
                <div className="text-base">{v.territory || '-'}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Assigned To</div>
                <div className="text-base">{v.assigned_to_name || 'Unassigned'}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Due Date</div>
                <div className="text-base">
                  {v.due_date
                    ? formatDate(v.due_date)
                    : latestNoticeDue?.due_response_date
                      ? `${formatDate(latestNoticeDue.due_response_date)}`
                      : 'N/A'}
                </div>
                {!v.due_date && latestNoticeDue?.due_response_date && (
                  <div className="text-xs text-muted-foreground mt-0.5">From latest notice</div>
                )}
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Period</div>
                <div className="text-base">{v.period_from ?? '-'}{v.period_to ? ` to ${v.period_to}` : ''}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Fund Type</div>
                <div className="text-base">{v.fund_type || '-'}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Source</div>
                <div className="text-base">{v.source_type || '-'}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Discovered By</div>
                <div className="text-base">{v.discovered_by || '-'}</div>
              </div>
              <div className="md:col-span-2">
                <div className="text-sm font-medium text-muted-foreground">Summary</div>
                <div className="text-base">{v.summary || '-'}</div>
              </div>
              {v.description && (
                <div className="md:col-span-2">
                  <div className="text-sm font-medium text-muted-foreground">Description</div>
                  <div className="text-base">{v.description}</div>
                </div>
              )}
              {v.resolution_notes && (
                <div className="md:col-span-2">
                  <div className="text-sm font-medium text-muted-foreground">Resolution Notes</div>
                  <div className="text-base">{v.resolution_notes}</div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notes" className="space-y-4">
          <ViolationNotesTab violationId={v.id} />
        </TabsContent>

        <TabsContent value="correspondence" className="space-y-4">
          <ViolationCorrespondenceTab violationId={v.id} employerId={v.employer_id} employerName={v.employer_name} />
        </TabsContent>

        <TabsContent value="follow-ups" className="space-y-4">
          <ViolationFollowUpsTab violationId={v.id} employerId={v.employer_id} employerName={v.employer_name} />
        </TabsContent>

        <TabsContent value="actions" className="space-y-4">
          <ViolationActionPlanTab violationId={v.id} employerId={v.employer_id} employerName={v.employer_name} />
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Violation History</CardTitle></CardHeader>
            <CardContent>
              {violationHistory.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No history records yet</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead>Performed By</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {violationHistory.map((h: any) => (
                      <TableRow key={h.id}>
                        <TableCell>{h.performed_at ? formatDate(h.performed_at) : '-'}</TableCell>
                        <TableCell className="font-medium">{h.action || '-'}</TableCell>
                        <TableCell>
                          {h.from_value ? (
                            <Badge variant="outline">{h.from_value.replace(/_/g, ' ')}</Badge>
                          ) : '-'}
                        </TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(h.to_value || '')}>
                            {h.to_value?.replace(/_/g, ' ') || '-'}
                          </Badge>
                        </TableCell>
                        <TableCell>{h.performed_by || '-'}</TableCell>
                        <TableCell className="max-w-xs truncate">{h.notes || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Assignment History */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><UserCheck className="h-5 w-5" />Assignment History</CardTitle></CardHeader>
            <CardContent>
              {assignmentHistory.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No assignment records yet</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Queue</TableHead>
                      <TableHead>Officer</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignmentHistory.map((a: any) => (
                      <TableRow key={a.id} className={!a.is_current ? 'opacity-50' : ''}>
                        <TableCell>{a.assigned_at ? formatDate(a.assigned_at) : '-'}</TableCell>
                        <TableCell>
                          <Badge variant={a.is_current ? 'default' : 'secondary'}>
                            {a.assignment_type || '-'}
                          </Badge>
                        </TableCell>
                        <TableCell>{a.ce_assignment_queues?.queue_name || '-'}</TableCell>
                        <TableCell>{a.ce_inspectors?.inspector_code || 'Queue-only'}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{a.resolution_method || '-'}</Badge>
                        </TableCell>
                        <TableCell className="max-w-xs truncate">{a.notes || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notices" className="space-y-4">
          <ViolationNoticesTab violationId={v.id} employerId={v.employer_id} employerName={v.employer_name} />
        </TabsContent>

        <TabsContent value="other-violations" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Other Violations for {v.employer_name}</CardTitle></CardHeader>
            <CardContent>
              {otherViolations.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No other violations for this employer</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Violation #</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {otherViolations.map((ov: any) => (
                      <TableRow key={ov.id}>
                        <TableCell className="font-medium font-mono text-xs">{ov.violation_number}</TableCell>
                        <TableCell>{ov.ce_violation_types?.name || '-'}</TableCell>
                        <TableCell><Badge className={getStatusColor(ov.status)}>{ov.status?.replace(/_/g, ' ')}</Badge></TableCell>
                        <TableCell><Badge className={getPriorityColor(ov.priority)}>{ov.priority}</Badge></TableCell>
                        <TableCell>{ov.period_from ?? '-'}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => navigate(`/compliance/violations/${ov.id}`)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Lifecycle Dialogs */}
      <ViolationResolutionDialog
        open={resolutionDialogOpen}
        onOpenChange={setResolutionDialogOpen}
        violationNumber={v.violation_number}
        mode={resolutionMode}
        onConfirm={handleResolutionConfirm}
      />

      <ViolationActionConfirmDialog
        open={confirmDialogOpen}
        onOpenChange={setConfirmDialogOpen}
        violationNumber={v.violation_number}
        actionType={confirmActionType}
        onConfirm={handleConfirmAction}
      />

      <AssignmentDialog
        open={assignmentDialogOpen}
        onOpenChange={setAssignmentDialogOpen}
        entityType="violation"
        entityId={v.id}
        currentOfficerId={(v as any).assigned_to_user_id || null}
        currentOfficerName={v.assigned_to_name || null}
        onAssigned={() => queryClient.invalidateQueries({ queryKey: ['ce_violation', id] })}
      />

      {v.employer_id && (
        <CreateLinkCaseDialog
          open={createLinkOpen}
          onOpenChange={setCreateLinkOpen}
          violation={{
            id: v.id,
            violation_number: v.violation_number,
            employer_id: v.employer_id,
            employer_name: v.employer_name,
            territory: v.territory,
            priority: v.priority,
            total_amount: Number(v.total_amount) || 0,
          }}
          performedBy={currentUserCode}
          onSuccess={(caseId) => {
            invalidateAll();
            navigate(`/compliance/cases/${caseId}`);
          }}
        />
      )}

      {/* Verification Approve / Reject dialog */}
      <AlertDialog
        open={verifyOpen !== null}
        onOpenChange={(o) => { if (!o) { setVerifyOpen(null); setVerifyNotes(''); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {verifyOpen === 'confirm' ? 'Approve violation?' : 'Reject violation?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {verifyOpen === 'confirm'
                ? 'This confirms the possible violation, moves it to OPEN and records the verification decision. Any duplicate/case grouping will be auto-applied.'
                : 'This rejects the possible violation and cancels the record. A reason is required and will be recorded on the case history.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder={verifyOpen === 'reject' ? 'Reason for rejection (required)' : 'Verification notes (optional)'}
            value={verifyNotes}
            onChange={(e) => setVerifyNotes(e.target.value)}
            rows={4}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                (verifyOpen === 'reject' && verifyNotes.trim().length < 3)
                || confirmVerificationMut.isPending
                || rejectVerificationMut.isPending
              }
              onClick={(e) => {
                e.preventDefault();
                if (verifyOpen === 'confirm') confirmVerificationMut.mutate();
                else if (verifyOpen === 'reject') rejectVerificationMut.mutate();
              }}
            >
              {(confirmVerificationMut.isPending || rejectVerificationMut.isPending)
                ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {verifyOpen === 'confirm' ? 'Approve' : 'Confirm Reject'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>

  );
}
