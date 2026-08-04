import { useState } from 'react';
import { useUserCode } from '@/hooks/useUserCode';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { useParams, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  Loader2, Eye, Briefcase, History, AlertCircle, CheckCircle, Building2,
  ArrowLeft, Link2, HandshakeIcon, Mail, Scale, DollarSign, FileText,
  CalendarClock, XCircle,
} from 'lucide-react';
import { AddToInspectionPlanningDialog } from '@/components/compliance/AddToInspectionPlanningDialog';
import { inspectionNominationService } from '@/services/inspectionNominationService';
import { CasePaymentArrangementDialog } from '@/components/compliance/CasePaymentArrangementDialog';
import { CaseRequestActions } from '@/components/compliance/CaseRequestActions';
import { WorkflowStatusBadge } from '@/components/compliance/WorkflowStatusBadge';
import RequestWaiverDialog from '@/components/compliance/RequestWaiverDialog';
import { BadgePercent } from 'lucide-react';
import { fetchPaymentArrangements } from '@/services/complianceDataService';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { fetchCaseById } from '@/services/complianceDataService';
import { caseViolationService } from '@/services/caseViolationService';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ComplianceTimeline } from '@/components/compliance/ComplianceTimeline';
import { AssignmentDialog } from '@/components/compliance/AssignmentDialog';
import { ForwardToLegalDialog } from '@/components/compliance/ForwardToLegalDialog';
import { UserCheck, Send } from 'lucide-react';
import { useHasCapability } from '@/hooks/useHasCapability';
import { COMPLIANCE_CAPABILITIES } from '@/lib/compliance/capabilities';
import { isComplianceFeatureEnabled } from '@/lib/compliance/featureToggles';
import { PermissionButton } from '@/components/ui/permission-button';
import { CaseDocumentsTab } from '@/components/compliance/case-detail/CaseDocumentsTab';
import { CaseInspectionsTab } from '@/components/compliance/case-detail/CaseInspectionsTab';
import { FolderOpen, ClipboardCheck } from 'lucide-react';

const COMPLIANCE_MODULE = 'manage_compliance';

const getStatusColor = (status: string) => {
  const colors: Record<string, string> = {
    ACTIVE: 'bg-primary/10 text-primary',
    UNDER_REVIEW: 'bg-warning/10 text-warning',
    ESCALATED_LEGAL: 'bg-destructive/10 text-destructive',
    RESOLVED: 'bg-green-100 text-green-800',
    CLOSED: 'bg-muted text-muted-foreground',
    COMPLETED: 'bg-green-100 text-green-800',
  };
  return colors[status] ?? 'bg-muted text-muted-foreground';
};

const getViolationStatusColor = (status: string) => {
  const colors: Record<string, string> = {
    OPEN: 'bg-primary/10 text-primary',
    IN_PROGRESS: 'bg-accent/10 text-accent-foreground',
    UNDER_REVIEW: 'bg-warning/10 text-warning',
    ESCALATED: 'bg-destructive/10 text-destructive',
    RESOLVED: 'bg-green-100 text-green-800',
    CLOSED: 'bg-muted text-muted-foreground',
    CANCELLED: 'bg-muted text-muted-foreground',
  };
  return colors[status] ?? 'bg-muted text-muted-foreground';
};

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'XCD', minimumFractionDigits: 2 }).format(amount);

export default function CaseDetailView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('violations');
  const [cascadeDialogOpen, setCascadeDialogOpen] = useState(false);
  const [cascadeReason, setCascadeReason] = useState('');
  const [cascading, setCascading] = useState(false);
  const [arrangementDialogOpen, setArrangementDialogOpen] = useState(false);
  const [waiverDialogOpen, setWaiverDialogOpen] = useState(false);
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
  const [forwardLegalOpen, setForwardLegalOpen] = useState(false);
  const [breakdownDialogOpen, setBreakdownDialogOpen] = useState(false);
  const [planningDialogOpen, setPlanningDialogOpen] = useState(false);


  const { userCode } = useUserCode();
  const { user } = useSupabaseAuth();
  const currentUserCode = userCode || 'UNKNOWN';
  
  // Case ownership (re)assignment uses the shared capability model rather than
  // a raw role comparison, so Admin / legacy manage_compliance holders pass too.
  const canManageAssignments = useHasCapability(COMPLIANCE_CAPABILITIES.CASES_MANAGE);
  const complianceRole = useComplianceRole();

  // Resolve the current user's officer identifiers (UUID + inspector codes) so
  // we can tell if this case is theirs, regardless of which identifier shape
  // was written into ce_cases.assigned_officer_id.
  const { data: myOfficerIds = [] } = useQuery({
    queryKey: ['ce_my_officer_ids', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ce_inspectors')
        .select('id, inspector_code, legacy_inspector_code')
        .eq('profile_id', user!.id);
      if (error) throw error;
      const out = new Set<string>();
      (data || []).forEach((r: any) => {
        if (r.id) out.add(r.id);
        if (r.inspector_code) out.add(r.inspector_code);
        if (r.legacy_inspector_code) out.add(r.legacy_inspector_code);
      });
      return Array.from(out);
    },
  });

  const { data: caseData, isLoading } = useQuery({
    queryKey: ['ce_case_detail', id],
    queryFn: () => fetchCaseById(id!),
    enabled: !!id,
  });

  const { data: linkedViolations = [], isLoading: loadingViolations } = useQuery({
    queryKey: ['ce_case_violations', id],
    queryFn: () => caseViolationService.getCaseViolations(id!),
    enabled: !!id,
  });

  const { data: caseHistory = [] } = useQuery({
    queryKey: ['ce_case_history', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ce_case_history')
        .select('*')
        .eq('case_id', id!)
        .order('performed_at', { ascending: false });
      if (error) return [];
      return data ?? [];
    },
    enabled: !!id,
  });

  const { data: caseNotices = [] } = useQuery({
    queryKey: ['ce_case_notices', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ce_notices')
        .select('*')
        .eq('case_id', id!)
        .order('created_at', { ascending: false });
      if (error) return [];
      return data ?? [];
    },
    enabled: !!id,
  });

  const { data: caseArrangements = [] } = useQuery({
    queryKey: ['ce_case_arrangements', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ce_payment_arrangements')
        .select('*')
        .eq('case_id', id!)
        .order('created_at', { ascending: false });
      if (error) return [];
      return data ?? [];
    },
    enabled: !!id,
  });

  // Existing pending nomination (if any) for this case + officer
  const { data: existingNomination } = useQuery({
    queryKey: ['pending-nomination', id, currentUserCode],
    enabled: !!id && !!userCode,
    queryFn: () => inspectionNominationService.getNominationForCase({
      caseId: id!, officerUserCode: currentUserCode,
    }),
  });

  const withdrawNominationMutation = useMutation({
    mutationFn: () => inspectionNominationService.withdrawNomination(
      existingNomination!.nomination_id, currentUserCode
    ),
    onSuccess: () => {
      toast.success('Removed from pending planning');
      queryClient.invalidateQueries({ queryKey: ['pending-nomination', id] });
      queryClient.invalidateQueries({ queryKey: ['pending-nominations'] });
    },
    onError: (err: any) => toast.error('Could not remove', { description: err?.message }),
  });


  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['ce_case_detail', id] });
    queryClient.invalidateQueries({ queryKey: ['ce_case_violations', id] });
    queryClient.invalidateQueries({ queryKey: ['ce_case_history', id] });
  };

  const handleCascadeResolve = async () => {
    if (!cascadeReason.trim() || !caseData) return;
    setCascading(true);
    try {
      const result = await caseViolationService.cascadeResolveCaseViolations(
        id!, (caseData as any).case_number, currentUserCode, cascadeReason
      );
      if (result.success) {
        toast.success(`Cascade complete: ${result.transitioned} resolved, ${result.skipped} skipped`);
        if (result.errors.length > 0) {
          toast.warning(`${result.errors.length} errors`, { description: result.errors[0] });
        }
        invalidateAll();
      }
    } catch (err: any) {
      toast.error('Cascade failed', { description: err.message });
    } finally {
      setCascading(false);
      setCascadeDialogOpen(false);
      setCascadeReason('');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="container mx-auto p-6 text-center">
        <h2 className="text-2xl font-bold">Case not found</h2>
        <Button onClick={() => navigate('/compliance/cases')} className="mt-4">Back to Cases</Button>
      </div>
    );
  }

  const c = caseData as any;
  const caseIsClosed = ['RESOLVED', 'CLOSED', 'COMPLETED'].includes(c.status);
  const noticesFeatureEnabled = isComplianceFeatureEnabled('notices.generate');
  const arrangementsFeatureEnabled = isComplianceFeatureEnabled('arrangements.new');
  const activeViolationCount = linkedViolations.filter(
    (v: any) => ['OPEN', 'IN_PROGRESS', 'UNDER_REVIEW', 'ESCALATED'].includes(v.status)
  ).length;

  // --- Due Period (min period_from → max period_to across linked violations) ---
  const periodTokens = (linkedViolations as any[])
    .flatMap((v) => [v.period_from, v.period_to, v.period])
    .filter((t: any) => typeof t === 'string' && t.trim().length > 0) as string[];
  const sortedPeriods = [...periodTokens].sort();
  const duePeriodStart = sortedPeriods[0] ?? c.period_from ?? null;
  const duePeriodEnd = sortedPeriods[sortedPeriods.length - 1] ?? c.period_to ?? null;
  const duePeriodLabel = duePeriodStart
    ? duePeriodEnd && duePeriodEnd !== duePeriodStart
      ? `${duePeriodStart} → ${duePeriodEnd}`
      : duePeriodStart
    : null;

  // --- Priority (highest of case priority or any linked violation priority/severity) ---
  const prioRank = (v?: string | null) => {
    const s = (v || '').toUpperCase();
    if (s === 'CRITICAL' || s === 'URGENT') return 4;
    if (s === 'HIGH') return 3;
    if (s === 'MEDIUM' || s === 'NORMAL') return 2;
    if (s === 'LOW') return 1;
    return 0;
  };
  const prioLabel = (n: number) =>
    n >= 4 ? 'Critical' : n >= 3 ? 'High' : n >= 2 ? 'Medium' : n >= 1 ? 'Low' : null;
  let derivedPrio = prioRank(c.priority);
  for (const v of linkedViolations as any[]) {
    derivedPrio = Math.max(derivedPrio, prioRank(v.priority), prioRank(v.severity));
  }
  const priorityText = c.priority || prioLabel(derivedPrio) || 'N/A';
  const priorityDerived = !c.priority && derivedPrio > 0;


  return (
    <div className="container mx-auto p-6 space-y-6">
      <PageHeader
        title={`Case: ${c.case_number}`}
        subtitle={c.employer_name || 'Unknown Employer'}
        breadcrumbs={[
          { label: 'Compliance', href: '/compliance' },
          { label: 'Cases', href: '/compliance/cases' },
          { label: c.case_number },
        ]}
      />

      {/* Case Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Briefcase className="h-6 w-6" />
                <CardTitle className="text-2xl">{c.case_number}</CardTitle>
                <Badge className={getStatusColor(c.status || '')}>
                  {(c.status || '').replace(/_/g, ' ')}
                </Badge>
                <Badge variant="outline">
                  {priorityText}{priorityDerived ? ' (derived)' : ''}
                </Badge>
                <WorkflowStatusBadge eventKey="case.closure_approval"
                  context={{ fund: c.fund_type, amount: Number(c.total_amount) || 0 }} compact />
              </div>
              <p className="text-sm text-muted-foreground">
                Opened: {c.opened_date ? formatDate(c.opened_date) : 'N/A'} | Type: {c.case_type || 'General'}
              </p>
            </div>
            <div className="text-right">
              <div className="text-sm text-muted-foreground">Total Amount</div>
              <div className="text-2xl font-bold text-destructive">
                {formatCurrency(Number(c.total_amount) || 0)}
              </div>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={() => setBreakdownDialogOpen(true)}
              >
                View breakdown
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap pt-3 border-t mt-4">
            <Button variant="outline" size="sm" onClick={() => navigate('/compliance/cases')}>
              <ArrowLeft className="h-4 w-4 mr-1" />Back to Cases
            </Button>
            {c.employer_id && (
              <Button variant="outline" size="sm" onClick={() => navigate(`/compliance/employer-360/${c.employer_id}`)}>
                <Building2 className="h-4 w-4 mr-1" />Employer 360
              </Button>
            )}
            {/* Create Notice - navigates to notices screen with case prefilled */}
            {!caseIsClosed && isComplianceFeatureEnabled('notices.generate') && (
              <PermissionButton
                moduleName={COMPLIANCE_MODULE}
                actionName="create"
                variant="outline"
                size="sm"
                onClick={() => navigate('/compliance/enforcement/notices', {
                  state: { prefill: { case_id: c.id, case_number: c.case_number, employer_id: c.employer_id, employer_name: c.employer_name } }
                })}
              >
                <Mail className="h-4 w-4 mr-1" />Create Notice
              </PermissionButton>
            )}
            {/* Recommend Legal Escalation */}
            {['ACTIVE', 'ESCALATED_LEGAL', 'UNDER_REVIEW'].includes(c.status) &&
              isComplianceFeatureEnabled('legal.approvedEscalations') && (
              <PermissionButton
                moduleName={COMPLIANCE_MODULE}
                actionName="edit"
                variant="outline"
                size="sm"
                onClick={() => navigate('/compliance/enforcement/recommendation-queue', {
                  state: { prefill: { case_id: c.id, case_number: c.case_number, employer_id: c.employer_id, employer_name: c.employer_name, total_amount: c.total_amount } }
                })}
              >
                <Scale className="h-4 w-4 mr-1" />Recommend Legal
              </PermissionButton>
            )}
            {/* Forward to Legal — full 6-step wizard vs. quick hand-off */}
            {!caseIsClosed && !(c as any).lg_intake_id && !(c as any).legal_case_id &&
              isComplianceFeatureEnabled('legal.handoff') && (
              <div className="flex items-center gap-2">
                <PermissionButton
                  moduleName={COMPLIANCE_MODULE}
                  actionName="edit"
                  size="sm"
                  title="Full 6-step referral: select items, review history and attach documents before sending to Legal. Wizard = full referral with item selection, history and documents."
                  onClick={() => navigate(`/compliance/cases/${c.id}/legal-referral`)}
                >
                  <Scale className="h-4 w-4 mr-1" />Refer to Legal (Wizard)
                </PermissionButton>
                <PermissionButton
                  moduleName={COMPLIANCE_MODULE}
                  actionName="edit"
                  size="sm"
                  variant="outline"
                  title="Fast hand-off: sends the whole case to Legal intake without item selection. Quick Forward = immediate hand-off of the whole case to Legal intake."
                  onClick={() => setForwardLegalOpen(true)}
                >
                  <Send className="h-4 w-4 mr-1" />Quick Forward
                </PermissionButton>
              </div>
            )}

            {(c as any).lg_intake_id && !(c as any).legal_case_id && (
              <Button variant="outline" size="sm" onClick={() => navigate(`/legal/cases/intake/${(c as any).lg_intake_id}`)}>
                <Scale className="h-4 w-4 mr-1" />View Legal Intake {(c as any).lg_intake_no ?? ''}
              </Button>
            )}
            {(c as any).legal_case_id && (
              <Button variant="outline" size="sm" onClick={() => navigate(`/legal/cases/${(c as any).legal_case_id}`)}>
                <Scale className="h-4 w-4 mr-1" />View Legal Case {(c as any).lg_case_no ?? ''}
              </Button>
            )}
            {activeViolationCount > 0 && !caseIsClosed && (
              <PermissionButton
                moduleName={COMPLIANCE_MODULE}
                actionName="edit"
                variant="destructive"
                size="sm"
                onClick={() => setCascadeDialogOpen(true)}
              >
                <CheckCircle className="h-4 w-4 mr-1" />
                Cascade Resolve ({activeViolationCount})
              </PermissionButton>
            )}
            {!['RESOLVED', 'CLOSED', 'COMPLETED', 'CSTG_PAYMENT_ARRANGEMENT_ACTIVE'].includes(c.status) &&
              isComplianceFeatureEnabled('arrangements.new') &&
              (Number(c.total_amount ?? 0) - Number(c.amount_collected ?? 0)) > 0 && (
              <PermissionButton
                moduleName={COMPLIANCE_MODULE}
                actionName="create"
                size="sm"
                onClick={() => setArrangementDialogOpen(true)}
                disabled={!(c as any).assigned_officer_id}
                title={!(c as any).assigned_officer_id ? 'Assign an officer to this case before creating an arrangement' : undefined}
              >
                <HandshakeIcon className="h-4 w-4 mr-1" />
                Create Payment Arrangement
              </PermissionButton>
            )}
            {!caseIsClosed && isComplianceFeatureEnabled('enforcement.waivers') &&
              (Number(c.total_amount ?? 0) - Number(c.amount_collected ?? 0) - Number((c as any).amount_waived ?? 0)) > 0 && (
              <PermissionButton
                moduleName={COMPLIANCE_MODULE}
                actionName="create"
                variant="outline"
                size="sm"
                onClick={() => setWaiverDialogOpen(true)}
              >
                <BadgePercent className="h-4 w-4 mr-1" />
                Request Waiver
              </PermissionButton>
            )}
            {/* Add to / Remove from Inspection Planning — assigned officer or Compliance Head only */}
            {(() => {
              const isAssignedOfficer =
                !!(c as any).assigned_officer_id &&
                myOfficerIds.includes((c as any).assigned_officer_id);
              const canNominate = isAssignedOfficer || complianceRole === 'head';
              if (!canNominate || caseIsClosed || !c.employer_id) return null;
              if (!isComplianceFeatureEnabled('inspections.planning')) return null;
              if (existingNomination) {
                return (
                  <PermissionButton
                    moduleName={COMPLIANCE_MODULE}
                    actionName="edit"
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => withdrawNominationMutation.mutate()}
                    disabled={withdrawNominationMutation.isPending}
                    title={`Queued for week starting ${existingNomination.week_start_date}. Click to remove.`}
                  >
                    <XCircle className="h-4 w-4 mr-1" />Remove from Planning
                  </PermissionButton>
                );
              }
              return (
                <PermissionButton
                  moduleName={COMPLIANCE_MODULE}
                  actionName="edit"
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setPlanningDialogOpen(true)}
                  title="Queue this case for an inspection in your weekly plan"
                >
                  <CalendarClock className="h-4 w-4 mr-1" />Add to Inspection Planning
                </PermissionButton>
              );
            })()}
            <CaseRequestActions
              caseId={c.id}
              caseStatus={c.status}
              caseNumber={c.case_number}
            />
          </div>
        </CardHeader>
      </Card>

      {/* Case Info Grid */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Linked Violations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{linkedViolations.length}</div>
            <div className="text-xs text-muted-foreground">{activeViolationCount} active</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Officer</CardTitle>
            {canManageAssignments && (
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setAssignmentDialogOpen(true)}>
                <UserCheck className="h-3.5 w-3.5 mr-1" />{c.assigned_officer_name ? 'Reassign' : 'Assign'}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <div className="text-base font-medium">{c.assigned_officer_name || 'Unassigned'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Risk</CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const rank = (v?: string | null) => {
                const s = (v || '').toUpperCase();
                if (s === 'CRITICAL') return 4;
                if (s === 'HIGH') return 3;
                if (s === 'MEDIUM') return 2;
                if (s === 'LOW') return 1;
                return 0;
              };
              const label = (n: number) =>
                n >= 4 ? 'Critical' : n >= 3 ? 'High' : n >= 2 ? 'Medium' : n >= 1 ? 'Low' : null;
              let derived = rank(c.risk_band);
              for (const v of linkedViolations as any[]) {
                derived = Math.max(derived, rank(v.severity), rank(v.priority));
              }
              const text = c.risk_band ? c.risk_band : (label(derived) ?? 'N/A');
              return (
                <>
                  <div className="text-base font-medium">{text}</div>
                  {c.risk_score != null ? (
                    <div className="text-xs text-muted-foreground">Score: {c.risk_score}</div>
                  ) : !c.risk_band && derived > 0 ? (
                    <div className="text-xs text-muted-foreground">Derived from violations</div>
                  ) : null}
                </>
              );
            })()}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Due Period</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-base font-medium">{duePeriodLabel ?? 'N/A'}</div>
            {duePeriodLabel ? (
              <div className="text-xs text-muted-foreground">
                {periodTokens.length > 0 ? 'Derived from linked violations' : 'From case record'}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">No period on violations</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Priority</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-base font-medium">{priorityText}</div>
            {priorityDerived ? (
              <div className="text-xs text-muted-foreground">Derived from violations</div>
            ) : c.priority ? (
              <div className="text-xs text-muted-foreground">From case record</div>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Collected</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{formatCurrency(Number(c.amount_collected) || 0)}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="violations">
            <Link2 className="h-4 w-4 mr-2" />Violations ({linkedViolations.length})
          </TabsTrigger>
          {noticesFeatureEnabled && (
            <TabsTrigger value="notices">
              <Mail className="h-4 w-4 mr-2" />Notices ({caseNotices.length})
            </TabsTrigger>
          )}
          {arrangementsFeatureEnabled && (
            <TabsTrigger value="arrangements">
              <DollarSign className="h-4 w-4 mr-2" />Arrangements ({caseArrangements.length})
            </TabsTrigger>
          )}
          <TabsTrigger value="documents">
            <FolderOpen className="h-4 w-4 mr-2" />Documents
          </TabsTrigger>
          <TabsTrigger value="inspections">
            <ClipboardCheck className="h-4 w-4 mr-2" />Inspections
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="h-4 w-4 mr-2" />History ({caseHistory.length})
          </TabsTrigger>
          <TabsTrigger value="timeline">
            <History className="h-4 w-4 mr-2" />Timeline
          </TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="space-y-4">
          <ComplianceTimeline
            mode="aggregate"
            title="Case Timeline (all related events)"
            aggregate={{
              caseId: id!,
              violationIds: linkedViolations.map((v: any) => v.id).filter(Boolean),
              noticeIds: caseNotices.map((n: any) => n.id).filter(Boolean),
              arrangementIds: caseArrangements.map((a: any) => a.id).filter(Boolean),
            }}
          />
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          <CaseDocumentsTab caseId={id!} />
        </TabsContent>

        <TabsContent value="inspections" className="space-y-4">
          <CaseInspectionsTab caseId={id!} employerId={c.employer_id} />
        </TabsContent>





        <TabsContent value="violations" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Linked Violations</CardTitle></CardHeader>
            <CardContent>
              {loadingViolations ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : linkedViolations.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No violations linked to this case</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Violation #</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Linked</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linkedViolations.map((v: any) => (
                      <TableRow key={v.id}>
                        <TableCell className="font-mono text-xs font-medium">{v.violation_number}</TableCell>
                        <TableCell>{(v.ce_violation_types as any)?.name || '-'}</TableCell>
                        <TableCell>
                          <Badge className={getViolationStatusColor(v.status)}>
                            {v.status?.replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell>{v.priority || '-'}</TableCell>
                        <TableCell className="text-xs">
                          {v.period_from
                            ? (v.period_to && v.period_to !== v.period_from
                                ? `${v.period_from} → ${v.period_to}`
                                : v.period_from)
                            : (v.period || '-')}
                        </TableCell>
                        <TableCell>{formatCurrency(Number(v.total_amount) || 0)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {v.linked_at ? formatDate(v.linked_at) : '-'}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => navigate(`/compliance/violations/${v.id}`)}>
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

        <TabsContent value="notices" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Notices</CardTitle>
                {!caseIsClosed && noticesFeatureEnabled && (
                  <PermissionButton
                    moduleName={COMPLIANCE_MODULE}
                    actionName="create"
                    size="sm"
                    variant="outline"
                    onClick={() => navigate('/compliance/enforcement/notices', {
                      state: { prefill: { case_id: c.id, case_number: c.case_number, employer_id: c.employer_id, employer_name: c.employer_name } }
                    })}
                  >
                    <Mail className="h-4 w-4 mr-1" />Create Notice
                  </PermissionButton>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {caseNotices.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No notices issued for this case</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Notice #</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Sent</TableHead>
                      <TableHead>Response</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {caseNotices.map((n: any) => (
                      <TableRow key={n.id}>
                        <TableCell className="font-mono text-xs font-medium">{n.notice_number}</TableCell>
                        <TableCell>{n.notice_type || '-'}</TableCell>
                        <TableCell><Badge variant="outline">{n.status?.replace(/_/g, ' ')}</Badge></TableCell>
                        <TableCell>{n.sent_at ? formatDate(n.sent_at) : '-'}</TableCell>
                        <TableCell>{n.response_received ? <Badge className="bg-green-100 text-green-800">Received</Badge> : '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="arrangements" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Payment Arrangements</CardTitle>
                {!caseIsClosed && arrangementsFeatureEnabled && (Number(c.total_amount ?? 0) - Number(c.amount_collected ?? 0)) > 0 && (
                  <PermissionButton
                    moduleName={COMPLIANCE_MODULE}
                    actionName="create"
                    size="sm"
                    variant="outline"
                    onClick={() => setArrangementDialogOpen(true)}
                    disabled={!(c as any).assigned_officer_id}
                    title={!(c as any).assigned_officer_id ? 'Assign an officer to this case before creating an arrangement' : undefined}
                  >
                    <HandshakeIcon className="h-4 w-4 mr-1" />New Arrangement
                  </PermissionButton>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {caseArrangements.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No payment arrangements for this case</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Arrangement #</TableHead>
                      <TableHead>Schedule</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Paid</TableHead>
                      <TableHead>Start</TableHead>
                      <TableHead>End / Next</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {caseArrangements.map((a: any) => {
                      const freq = a.frequency ? String(a.frequency).charAt(0).toUpperCase() + String(a.frequency).slice(1) : null;
                      const installments = a.number_of_installments ? `${a.number_of_installments} installments` : null;
                      const schedule = [freq, installments].filter(Boolean).join(' · ') || '-';
                      const endCell = a.end_date
                        ? formatDate(a.end_date)
                        : a.next_due_date
                          ? `Next: ${formatDate(a.next_due_date)}`
                          : '-';
                      return (
                        <TableRow key={a.id}>
                          <TableCell className="font-mono text-xs font-medium">{a.arrangement_number || a.id.slice(0, 8)}</TableCell>
                          <TableCell className="text-sm">{schedule}</TableCell>
                          <TableCell><Badge variant="outline">{a.status?.replace(/_/g, ' ')}</Badge></TableCell>
                          <TableCell>{formatCurrency(Number(a.total_debt) || 0)}</TableCell>
                          <TableCell>{formatCurrency(Number(a.total_paid) || 0)}</TableCell>
                          <TableCell>{a.start_date ? formatDate(a.start_date) : '-'}</TableCell>
                          <TableCell>{endCell}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Case History</CardTitle></CardHeader>
            <CardContent>
              {caseHistory.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No history records</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead>By</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {caseHistory.map((h: any) => (
                      <TableRow key={h.id}>
                        <TableCell>{h.performed_at ? formatDate(h.performed_at) : '-'}</TableCell>
                        <TableCell className="font-medium">{h.action || '-'}</TableCell>
                        <TableCell>
                          {h.from_status ? <Badge variant="outline">{h.from_status.replace(/_/g, ' ')}</Badge> : '-'}
                        </TableCell>
                        <TableCell>
                          {h.to_status ? <Badge className={getStatusColor(h.to_status)}>{h.to_status.replace(/_/g, ' ')}</Badge> : '-'}
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
        </TabsContent>
      </Tabs>

      {/* Cascade Resolution Dialog */}
      <Dialog open={cascadeDialogOpen} onOpenChange={setCascadeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Cascade Resolve Violations
            </DialogTitle>
            <DialogDescription>
              This will resolve all {activeViolationCount} active violations linked to case {c.case_number}.
              Each transition will be fully audited.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="text-sm font-medium">Resolution Reason *</label>
            <Textarea
              value={cascadeReason}
              onChange={(e) => setCascadeReason(e.target.value)}
              placeholder="Provide a reason for cascade resolution..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCascadeDialogOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleCascadeResolve}
              disabled={!cascadeReason.trim() || cascading}
            >
              {cascading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle className="h-4 w-4 mr-1" />}
              Resolve {activeViolationCount} Violations
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Case-Driven Payment Arrangement Dialog */}
      <CasePaymentArrangementDialog
        open={arrangementDialogOpen}
        onOpenChange={setArrangementDialogOpen}
        caseId={c.id}
        caseNumber={c.case_number}
        employerId={c.employer_id}
        employerName={c.employer_name || 'Unknown Employer'}
        totalAmount={Number(c.total_amount) || 0}
        amountCollected={Number(c.amount_collected) || 0}
        assignedOfficerId={(c as any).assigned_officer_id ?? null}
        assignedOfficerName={(c as any).assigned_officer_name ?? null}
      />

      <RequestWaiverDialog
        open={waiverDialogOpen}
        onClose={() => setWaiverDialogOpen(false)}
        context={{
          employer_id: c.employer_id,
          case_id: c.id,
          fund: (c as any).fund_type ?? null,
          source: 'CASE',
          defaultAmount: Math.max(
            0,
            Number(c.total_amount ?? 0) - Number(c.amount_collected ?? 0) - Number((c as any).amount_waived ?? 0),
          ),
        }}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['ce_case_detail', id] })}
      />

      <AssignmentDialog
        open={assignmentDialogOpen}
        onOpenChange={setAssignmentDialogOpen}
        entityType="case"
        entityId={c.id}
        currentOfficerId={c.assigned_officer_id || null}
        currentOfficerName={c.assigned_officer_name || null}
        onAssigned={() => queryClient.invalidateQueries({ queryKey: ['ce_case_detail', id] })}
      />

      <ForwardToLegalDialog
        open={forwardLegalOpen}
        onOpenChange={setForwardLegalOpen}
        ceCaseId={c.id}
        ceCaseNumber={c.case_number}
        outstandingAmount={
          Number(c.total_amount ?? 0) - Number(c.amount_collected ?? 0) - Number((c as any).amount_waived ?? 0)
        }
      />

      <AddToInspectionPlanningDialog
        open={planningDialogOpen}
        onOpenChange={setPlanningDialogOpen}
        caseId={c.id}
        caseNumber={c.case_number}
        employerId={c.employer_id || ''}
        employerName={c.employer_name || ''}
        officerUserCode={currentUserCode}
      />



      {/* Amount Breakdown Dialog */}
      <Dialog open={breakdownDialogOpen} onOpenChange={setBreakdownDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Total Amount Breakdown</DialogTitle>
            <DialogDescription>
              Case {c.case_number} — components of the outstanding total, aggregated from linked violations.
            </DialogDescription>
          </DialogHeader>

          {(() => {
            const principal = Number(c.total_principal) || 0;
            const penalty = Number(c.total_penalties) || 0;
            const interest = Number(c.total_interest) || 0;
            const componentTotal = principal + penalty + interest;
            const total = Number(c.total_amount) || 0;
            const other = Math.max(0, total - componentTotal);
            const collected = Number(c.amount_collected) || 0;
            const waived = Number((c as any).amount_waived) || 0;
            const netOutstanding = Math.max(0, total - collected - waived);

            const rows: Array<{ label: string; value: number; muted?: boolean; strong?: boolean }> = [
              { label: 'Principal Contribution', value: principal },
              { label: 'Penalty', value: penalty },
              { label: 'Interest', value: interest },
            ];
            if (other > 0) rows.push({ label: 'Fees / Levy / Other charges', value: other });
            rows.push({ label: 'Total Amount', value: total, strong: true });
            rows.push({ label: 'Less: Amount Collected', value: -collected, muted: true });
            if (waived > 0) rows.push({ label: 'Less: Amount Waived', value: -waived, muted: true });
            rows.push({ label: 'Net Outstanding', value: netOutstanding, strong: true });

            return (
              <div className="space-y-6">
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Component</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.label} className={r.strong ? 'bg-muted/40' : ''}>
                          <TableCell className={r.strong ? 'font-semibold' : r.muted ? 'text-muted-foreground' : ''}>
                            {r.label}
                          </TableCell>
                          <TableCell
                            className={`text-right tabular-nums ${
                              r.strong ? 'font-semibold' : r.muted ? 'text-muted-foreground' : ''
                            }`}
                          >
                            {formatCurrency(r.value)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div>
                  <h4 className="text-sm font-semibold mb-2">Per-Violation Breakdown</h4>
                  {loadingViolations ? (
                    <div className="text-sm text-muted-foreground py-4">Loading violations…</div>
                  ) : linkedViolations.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-4">No linked violations.</div>
                  ) : (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Violation</TableHead>
                            <TableHead>Period</TableHead>
                            <TableHead className="text-right">Principal</TableHead>
                            <TableHead className="text-right">Penalty</TableHead>
                            <TableHead className="text-right">Interest</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(linkedViolations as any[]).map((v) => {
                            const vp = Number(v.principal_amount) || 0;
                            const vpen = Number(v.penalty_amount) || 0;
                            const vi = Number(v.interest_amount) || 0;
                            const vt = Number(v.total_amount) || vp + vpen + vi;
                            const period = v.period_from
                              ? v.period_to && v.period_to !== v.period_from
                                ? `${v.period_from} → ${v.period_to}`
                                : v.period_from
                              : '—';
                            return (
                              <TableRow key={v.id}>
                                <TableCell className="font-mono text-xs">{v.violation_number}</TableCell>
                                <TableCell className="text-xs">{period}</TableCell>
                                <TableCell className="text-right tabular-nums">{formatCurrency(vp)}</TableCell>
                                <TableCell className="text-right tabular-nums">{formatCurrency(vpen)}</TableCell>
                                <TableCell className="text-right tabular-nums">{formatCurrency(vi)}</TableCell>
                                <TableCell className="text-right tabular-nums font-medium">
                                  {formatCurrency(vt)}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>

                {other > 0 && (
                  <p className="text-xs text-muted-foreground">
                    "Fees / Levy / Other charges" reflects the difference between the case Total Amount and the sum
                    of principal, penalty, and interest components recorded on the case.
                  </p>
                )}
              </div>
            );
          })()}

          <DialogFooter>
            <Button variant="outline" onClick={() => setBreakdownDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
