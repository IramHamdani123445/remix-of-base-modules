/**
 * Arrangement Detail Panel — Compliance Officer Operational View
 *
 * Read-only + action panel for a single payment arrangement.
 * Tabs: Installments | Breaches | Reconciliation | Case History | Notices
 *
 * RESILIENCE: Each data section loads independently with safe fallbacks.
 * A failing secondary query never breaks the primary arrangement view.
 *
 * Actions are backed by existing server-side RPCs only:
 *   - recalculateArrangementSummary (repair totals)
 *   - recalculateBreachState (re-evaluate breach after payment)
 *
 * Does NOT modify payment posting or arrangement creation flows.
 */

import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertTriangle, ArrowLeft, CalendarDays, CheckCircle2, Clock,
  FileText, Loader2, RefreshCw, Shield, XCircle, Activity,
  ShieldCheck, ShieldAlert, AlertCircle, Bell,
} from 'lucide-react';
import { formatDateForDisplay } from '@/lib/format-config';
import { toast } from 'sonner';
import {
  fetchArrangementWithInstallments,
  recalculateArrangementSummary,
} from '@/services/compliance/paymentReconciliationService';
import { recalculateBreachState } from '@/services/compliance/breachEvaluationService';
import {
  submitForApproval,
  approveArrangement,
  rejectArrangement,
  activateArrangement,
} from '@/services/arrangementWorkflowService';
import { ArrangementCoveragePanel } from '@/components/compliance/ArrangementCoveragePanel';
import { ArrangementInstallmentsPanel } from '@/components/compliance/arrangements/ArrangementInstallmentsPanel';
import { ArrangementAllocationsPanel } from '@/components/compliance/arrangements/ArrangementAllocationsPanel';
import { ArrangementOperationalStrip } from '@/components/compliance/arrangements/ArrangementOperationalStrip';
import { useUserCode } from '@/hooks/useUserCode';
import { useHasCapability } from '@/hooks/useHasCapability';
import { COMPLIANCE_CAPABILITIES } from '@/lib/compliance/capabilities';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';

// ── Types ───────────────────────────────────────────────────

interface ArrangementDetailPanelProps {
  arrangementId: string;
  onBack: () => void;
}

// ── Helpers ─────────────────────────────────────────────────

const formatCurrency = (amount: number | null | undefined) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'XCD', minimumFractionDigits: 2 })
    .format(Number(amount ?? 0));

const statusColor = (status: string) => {
  const map: Record<string, string> = {
    ACTIVE: 'bg-success/10 text-success',
    COMPLETED: 'bg-primary/10 text-primary',
    DEFAULTED: 'bg-destructive/10 text-destructive',
    DRAFT: 'bg-muted text-muted-foreground',
    CANCELLED: 'bg-muted text-muted-foreground',
    SUPERSEDED: 'bg-muted text-muted-foreground',
    PAID: 'bg-success/10 text-success',
    OVERDUE: 'bg-destructive/10 text-destructive',
    PARTIAL: 'bg-warning/10 text-warning-foreground',
    PENDING: 'bg-muted text-muted-foreground',
    PLANNED: 'bg-muted text-muted-foreground',
  };
  return map[status] || 'bg-muted text-muted-foreground';
};

const observationColor = (type: string) => {
  switch (type) {
    case 'PAYMENT_RECEIVED': return 'bg-success/10 text-success border-success/20';
    case 'ARRANGEMENT_CREDIT': return 'bg-primary/10 text-primary border-primary/20';
    case 'ALLOCATED': return 'bg-success/10 text-success border-success/20';
    case 'SKIPPED': return 'bg-muted text-muted-foreground border-border';
    case 'DETECTED': return 'bg-warning/10 text-warning-foreground border-warning/20';
    default: return 'bg-muted text-muted-foreground border-border';
  }
};

/** Inline error fallback for a section */
const SectionError: React.FC<{ message?: string }> = ({ message }) => (
  <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/5 border border-destructive/10 text-xs text-destructive">
    <AlertCircle className="h-4 w-4 shrink-0" />
    <span>{message || 'Failed to load this section. The data may be temporarily unavailable.'}</span>
  </div>
);

/** Inline empty state for a section */
const SectionEmpty: React.FC<{ message: string; icon?: React.ReactNode }> = ({ message, icon }) => (
  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
    {icon || <FileText className="h-6 w-6 mb-2 opacity-50" />}
    <p className="text-sm">{message}</p>
  </div>
);

// ── Breach Health Indicator ─────────────────────────────────

type BreachHealth = 'healthy' | 'warning' | 'breached' | 'defaulted';

function getBreachHealth(arr: any): { health: BreachHealth; label: string; description: string } {
  if (arr.status === 'DEFAULTED') {
    return { health: 'defaulted', label: 'Defaulted', description: arr.breach_reason || 'Arrangement has been defaulted due to breach conditions.' };
  }
  if (arr.breach_detected) {
    return { health: 'breached', label: 'Breach Detected', description: arr.breach_reason || 'Active breach — requires attention.' };
  }
  const missed = arr.missed_payments ?? 0;
  const max = arr.max_missed_before_breach ?? 2;
  if (missed > 0 && missed < max) {
    return { health: 'warning', label: 'Warning', description: `${missed} missed payment(s) of ${max} max before breach.` };
  }
  return { health: 'healthy', label: 'Healthy', description: 'All payments on track. No breaches detected.' };
}

const healthConfig: Record<BreachHealth, { icon: React.ReactNode; bg: string; text: string; border: string }> = {
  healthy: { icon: <ShieldCheck className="h-5 w-5" />, bg: 'bg-success/10', text: 'text-success', border: 'border-success/20' },
  warning: { icon: <ShieldAlert className="h-5 w-5" />, bg: 'bg-warning/10', text: 'text-warning-foreground', border: 'border-warning/20' },
  breached: { icon: <AlertTriangle className="h-5 w-5" />, bg: 'bg-destructive/10', text: 'text-destructive', border: 'border-destructive/20' },
  defaulted: { icon: <XCircle className="h-5 w-5" />, bg: 'bg-destructive/10', text: 'text-destructive', border: 'border-destructive/30' },
};

// ── Component ───────────────────────────────────────────────

export const ArrangementDetailPanel: React.FC<ArrangementDetailPanelProps> = ({
  arrangementId,
  onBack,
}) => {
  const queryClient = useQueryClient();
  const { userCode } = useUserCode();
  const canManageArrangements = useHasCapability(COMPLIANCE_CAPABILITIES.ENFORCEMENT_ARRANGEMENTS);
  const [rejectReason, setRejectReason] = React.useState('');
  const [rejectOpen, setRejectOpen] = React.useState(false);

  // ── PRIMARY: Arrangement + Installments ───────────────────
  const { data, isLoading, isError: primaryError } = useQuery({
    queryKey: ['arrangement_detail', arrangementId],
    queryFn: () => fetchArrangementWithInstallments(arrangementId),
    enabled: !!arrangementId,
  });

  // ── SECONDARY: Breaches (independent, safe fallback) ──────
  const { data: breaches = [], isError: breachesError } = useQuery({
    queryKey: ['arrangement_breaches', arrangementId],
    queryFn: async () => {
      const { data: b, error } = await supabase
        .from('ce_arrangement_breaches')
        .select('*')
        .eq('arrangement_id', arrangementId)
        .order('detected_at', { ascending: false });
      if (error) throw error;
      return b ?? [];
    },
    enabled: !!arrangementId,
    retry: 1,
  });

  // ── SECONDARY: Case Info (independent) ────────────────────
  const caseId = data?.arrangement?.case_id;
  const { data: linkedCase, isError: caseError } = useQuery({
    queryKey: ['arrangement_linked_case', caseId],
    queryFn: async () => {
      const { data: c, error } = await supabase
        .from('ce_cases')
        .select('id, case_number, status, priority, summary, assigned_officer_name')
        .eq('id', caseId!)
        .single();
      if (error) throw error;
      return c;
    },
    enabled: !!caseId,
    retry: 1,
  });

  // ── SECONDARY: Case History (independent) ─────────────────
  const { data: caseHistory = [], isError: historyError } = useQuery({
    queryKey: ['arrangement_case_history', caseId],
    queryFn: async () => {
      const { data: h, error } = await supabase
        .from('ce_case_history')
        .select('*')
        .eq('case_id', caseId!)
        .order('performed_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return h ?? [];
    },
    enabled: !!caseId,
    retry: 1,
  });

  // ── SECONDARY: Reconciliation log (independent) ───────────
  const employerId = data?.arrangement?.employer_id;
  const { data: recentReconciliations = [], isError: reconError } = useQuery({
    queryKey: ['arrangement_reconciliation_log', arrangementId, employerId],
    queryFn: async () => {
      const { data: r, error } = await supabase
        .from('ce_payment_observation_log')
        .select('*')
        .eq('employer_id', employerId!)
        .order('observed_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return r ?? [];
    },
    enabled: !!employerId,
    retry: 1,
  });

  // ── SECONDARY: Notices (independent) ──────────────────────
  const { data: notices = [], isError: noticesError } = useQuery({
    queryKey: ['arrangement_notices', caseId],
    queryFn: async () => {
      if (!caseId) return [];
      const { data: n, error } = await supabase
        .from('ce_notices')
        .select('id, notice_number, notice_type, status, subject, created_at, delivery_method')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return n ?? [];
    },
    enabled: !!caseId,
    retry: 1,
  });

  // ── Actions ───────────────────────────────────────────────

  const recalcMutation = useMutation({
    mutationFn: () => recalculateArrangementSummary(arrangementId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['arrangement_detail', arrangementId] });
      toast.success('Arrangement summary recalculated');
    },
    onError: (e: any) => toast.error('Recalculation failed', { description: e.message }),
  });

  const breachRefreshMutation = useMutation({
    mutationFn: () => recalculateBreachState(arrangementId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['arrangement_detail', arrangementId] });
      queryClient.invalidateQueries({ queryKey: ['arrangement_breaches', arrangementId] });
      toast.success('Breach state refreshed', {
        description: `Missed: ${result.current_missed}, Breached: ${result.is_breached ? 'Yes' : 'No'}`,
      });
    },
    onError: (e: any) => toast.error('Breach refresh failed', { description: e.message }),
  });

  // ── Lifecycle: Submit / Approve / Activate / Reject ───────
  const invalidateArrangement = () => {
    queryClient.invalidateQueries({ queryKey: ['arrangement_detail', arrangementId] });
    queryClient.invalidateQueries({ queryKey: ['ce_payment_arrangements'] });
    queryClient.invalidateQueries({ queryKey: ['my-work-queue'] });
  };
  const actor = userCode || 'SYSTEM';

  const submitMutation = useMutation({
    mutationFn: () => submitForApproval(arrangementId, actor),
    onSuccess: () => { invalidateArrangement(); toast.success('Submitted for approval'); },
    onError: (e: any) => toast.error('Submit failed', { description: e.message }),
  });

  const approveMutation = useMutation({
    mutationFn: () => approveArrangement(arrangementId, actor),
    onSuccess: () => { invalidateArrangement(); toast.success('Arrangement approved and activated'); },
    onError: (e: any) => toast.error('Approve failed', { description: e.message }),
  });

  const activateMutation = useMutation({
    mutationFn: () => activateArrangement(arrangementId, actor),
    onSuccess: () => { invalidateArrangement(); toast.success('Arrangement activated'); },
    onError: (e: any) => toast.error('Activate failed', { description: e.message }),
  });

  const rejectMutation = useMutation({
    mutationFn: (reason: string) => rejectArrangement(arrangementId, actor, reason),
    onSuccess: () => {
      invalidateArrangement();
      toast.success('Arrangement rejected');
      setRejectOpen(false);
      setRejectReason('');
    },
    onError: (e: any) => toast.error('Reject failed', { description: e.message }),
  });

  // ── Render: Loading ───────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-6 w-48" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // ── Render: Not Found ─────────────────────────────────────

  if (primaryError || !data?.arrangement) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <XCircle className="h-10 w-10 mb-3 text-destructive/50" />
        <h3 className="text-lg font-semibold text-foreground">Arrangement Not Found</h3>
        <p className="text-sm mt-1">
          {primaryError
            ? 'Failed to load arrangement data. Please try again.'
            : 'The requested arrangement does not exist or has been removed.'}
        </p>
        <Button variant="outline" className="mt-4" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />Back to List
        </Button>
      </div>
    );
  }

  const arr = data.arrangement;
  const installments = data.installments;
  const outstanding = Number(arr.total_debt ?? 0) - Number(arr.total_paid ?? 0);
  const progressPct = arr.number_of_installments
    ? ((arr.installments_paid ?? 0) / arr.number_of_installments) * 100
    : 0;

  const breachHealthInfo = getBreachHealth(arr);
  const hCfg = healthConfig[breachHealthInfo.health];
  const unresolvedBreaches = breaches.filter((b: any) => !b.resolution).length;

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />Back
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold truncate">{arr.arrangement_number}</h2>
          <p className="text-sm text-muted-foreground">{arr.employer_name} · {arr.employer_id}</p>
          {linkedCase && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Case: <span className="font-mono">{linkedCase.case_number}</span>
            </p>
          )}
        </div>
        <Badge className={statusColor(arr.status)}>{arr.status}</Badge>
        {arr.breach_detected && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" />BREACH
          </Badge>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {/* ── Lifecycle actions ── */}
          {canManageArrangements && arr.status === 'DRAFT' && (
            <>
              <Button
                variant="outline" size="sm"
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending}
                title="Submit this draft to a supervisor for approval"
              >
                {submitMutation.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  : <Bell className="h-4 w-4 mr-1" />}
                Submit for Approval
              </Button>
              <Button
                variant="default" size="sm"
                onClick={() => activateMutation.mutate()}
                disabled={activateMutation.isPending}
                title="Approve and activate immediately (requires arrangement authority)"
              >
                {activateMutation.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  : <CheckCircle2 className="h-4 w-4 mr-1" />}
                Approve &amp; Activate
              </Button>
            </>
          )}
          {canManageArrangements && arr.status === 'PENDING_APPROVAL' && (
            <Button
              variant="default" size="sm"
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
            >
              {approveMutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
                : <CheckCircle2 className="h-4 w-4 mr-1" />}
              Approve
            </Button>
          )}
          {canManageArrangements && ['DRAFT', 'PENDING_APPROVAL'].includes(arr.status) && (
            <AlertDialog open={rejectOpen} onOpenChange={setRejectOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={rejectMutation.isPending}>
                  <XCircle className="h-4 w-4 mr-1" />Reject
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reject payment arrangement?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will cancel the arrangement. A reason is recorded on the record and shown in case history.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Textarea
                  placeholder="Reason for rejection (required)"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={3}
                />
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={rejectReason.trim().length < 3 || rejectMutation.isPending}
                    onClick={(e) => { e.preventDefault(); rejectMutation.mutate(rejectReason.trim()); }}
                  >
                    {rejectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Confirm Reject
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          <Button
            variant="outline" size="sm"
            onClick={() => breachRefreshMutation.mutate()}
            disabled={breachRefreshMutation.isPending}
            title="Re-evaluate breach state from current installment data"
          >
            {breachRefreshMutation.isPending
              ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
              : <Shield className="h-4 w-4 mr-1" />}
            Refresh Breach
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={() => recalcMutation.mutate()}
            disabled={recalcMutation.isPending}
          >
            {recalcMutation.isPending
              ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
              : <RefreshCw className="h-4 w-4 mr-1" />}
            Recalculate
          </Button>
        </div>
      </div>

      {/* ── Financial Summary Cards ─────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Total Debt</p>
            <p className="text-lg font-bold">{formatCurrency(arr.total_debt)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Total Paid</p>
            <p className="text-lg font-bold text-success">{formatCurrency(arr.total_paid)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Outstanding</p>
            <p className="text-lg font-bold text-destructive">{formatCurrency(outstanding)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Installments</p>
            <p className="text-lg font-bold">{arr.installments_paid ?? 0} / {arr.number_of_installments ?? 0}</p>
            <div className="w-full bg-muted rounded-full h-1.5 mt-1">
              <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${Math.min(progressPct, 100)}%` }} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Next Due</p>
            <p className="text-lg font-bold flex items-center gap-1">
              <Clock className="h-4 w-4 text-muted-foreground" />
              {arr.next_due_date ? formatDateForDisplay(arr.next_due_date) : 'N/A'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Breach Health Widget ─────────────────────────── */}
      <Card className={`border ${hCfg.border}`}>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg ${hCfg.bg} ${hCfg.text}`}>
              {hCfg.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className={`text-sm font-semibold ${hCfg.text}`}>{breachHealthInfo.label}</h4>
                {unresolvedBreaches > 0 && (
                  <Badge variant="destructive" className="text-xs">
                    {unresolvedBreaches} unresolved
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{breachHealthInfo.description}</p>
            </div>
            <div className="text-right text-xs text-muted-foreground space-y-0.5 shrink-0">
              <p>Missed: <span className={`font-medium ${(arr.missed_payments ?? 0) > 0 ? 'text-destructive' : ''}`}>{arr.missed_payments ?? 0}</span> / {arr.max_missed_before_breach ?? 2}</p>
              {arr.breach_date && <p>Since: {formatDateForDisplay(arr.breach_date)}</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Arrangement Meta Row ────────────────────────── */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Frequency</p>
              <p className="font-medium">{arr.frequency ?? '-'}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Start Date</p>
              <p className="font-medium">{arr.start_date ? formatDateForDisplay(arr.start_date) : '-'}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">End Date</p>
              <p className="font-medium">{arr.end_date ? formatDateForDisplay(arr.end_date) : '-'}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Installment Amount</p>
              <p className="font-medium">{formatCurrency(arr.installment_amount)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Linked Case (with error fallback) ────────────── */}
      {caseError ? (
        <SectionError message="Could not load linked case details." />
      ) : linkedCase ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              Linked Case
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-muted-foreground text-xs">Case #</p>
                <p className="font-mono text-xs font-medium">{linkedCase.case_number}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Status</p>
                <Badge className={statusColor(linkedCase.status ?? '')}>{linkedCase.status}</Badge>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Priority</p>
                <p className="font-medium">{linkedCase.priority ?? '-'}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Officer</p>
                <p className="font-medium">{linkedCase.assigned_officer_name ?? 'Unassigned'}</p>
              </div>
            </div>
            {linkedCase.summary && (
              <p className="text-xs text-muted-foreground mt-2 italic">{linkedCase.summary}</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* ── Tabs ────────────────────────────────────────── */}
      <Tabs defaultValue="installments" className="w-full">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="installments">
            Installments ({installments.length})
          </TabsTrigger>
          <TabsTrigger value="coverage">
            Coverage
          </TabsTrigger>
          <TabsTrigger value="breaches">
            Breaches ({breaches.length})
          </TabsTrigger>
          <TabsTrigger value="reconciliation">
            Reconciliation ({recentReconciliations.length})
          </TabsTrigger>
          <TabsTrigger value="history">
            History ({caseHistory.length})
          </TabsTrigger>
          <TabsTrigger value="notices">
            Notices ({notices.length})
          </TabsTrigger>
        </TabsList>

        {/* ── Coverage Tab ──────────────────────────────── */}
        <TabsContent value="coverage">
          <ArrangementCoveragePanel legacyArrangementId={arrangementId} />
        </TabsContent>


        {/* ── Installments Tab (server-derived operational status) ── */}
        <TabsContent value="installments">
          <ArrangementInstallmentsPanel arrangementId={arrangementId} />
        </TabsContent>

        {/* ── Allocations Tab ───────────────────────────── */}
        <TabsContent value="allocations">
          <ArrangementAllocationsPanel arrangementId={arrangementId} />
        </TabsContent>


        {/* ── Breaches Tab ──────────────────────────────── */}
        <TabsContent value="breaches">
          <Card>
            <CardContent className="pt-4">
              {breachesError ? (
                <SectionError message="Failed to load breach records." />
              ) : breaches.length === 0 ? (
                <SectionEmpty message="No breaches recorded — arrangement is in good standing." icon={<ShieldCheck className="h-6 w-6 mb-2 opacity-50" />} />
              ) : (
                <div className="space-y-3">
                  {breaches.map((b: any) => (
                    <div key={b.id} className={`rounded-md border p-3 space-y-2 ${!b.resolution ? 'border-destructive/20 bg-destructive/5' : ''}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className={`h-4 w-4 ${b.resolution ? 'text-muted-foreground' : 'text-destructive'}`} />
                          <Badge variant={b.resolution ? 'secondary' : 'destructive'}>
                            {b.breach_type ?? 'STANDARD'}
                          </Badge>
                          {!b.resolution && (
                            <Badge variant="outline" className="text-xs border-destructive/30 text-destructive">
                              Unresolved
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {b.detected_at ? formatDateForDisplay(b.detected_at) : '-'}
                        </span>
                      </div>
                      <p className="text-sm">{b.description}</p>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                        <span>Detected by: {b.detected_by ?? 'SYSTEM'}</span>
                        {b.resolution && (
                          <>
                            <Separator orientation="vertical" className="h-3" />
                            <span className="text-success flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              Resolved: {b.resolution}
                            </span>
                            {b.resolved_at && <span>on {formatDateForDisplay(b.resolved_at)}</span>}
                          </>
                        )}
                      </div>
                      {b.resolution_notes && (
                        <p className="text-xs italic text-muted-foreground border-t pt-1 mt-1">{b.resolution_notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Reconciliation Tab ────────────────────────── */}
        <TabsContent value="reconciliation">
          <Card>
            <CardContent className="pt-4">
              {reconError ? (
                <SectionError message="Failed to load reconciliation log. This does not affect the arrangement." />
              ) : recentReconciliations.length === 0 ? (
                <SectionEmpty
                  message="No reconciliation observations yet. Payment credits appear here after ledger posting."
                  icon={<Activity className="h-6 w-6 mb-2 opacity-50" />}
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Observed At</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Ledger Entry</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Observer</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentReconciliations.map((r: any) => (
                        <TableRow key={r.id}>
                          <TableCell className="text-xs whitespace-nowrap">
                            {r.observed_at ? formatDateForDisplay(r.observed_at) : '-'}
                          </TableCell>
                          <TableCell>
                            <Badge className={`text-xs ${observationColor(r.observation_type ?? '')}`}>
                              {r.observation_type ?? '-'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {r.status ?? r.observation_status ?? '-'}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs truncate max-w-[100px]">
                            {r.ledger_entry_id?.slice(0, 8) ?? '-'}
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            {r.amount ? formatCurrency(r.amount) : '-'}
                          </TableCell>
                          <TableCell className="text-xs">{r.observed_by ?? 'SYSTEM'}</TableCell>
                          <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]">
                            {r.notes || '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Case History Tab ──────────────────────────── */}
        <TabsContent value="history">
          <Card>
            <CardContent className="pt-4">
              {historyError ? (
                <SectionError message="Failed to load case history." />
              ) : !caseId ? (
                <SectionEmpty message="No linked case — history is unavailable." />
              ) : caseHistory.length === 0 ? (
                <SectionEmpty message="No case history entries recorded yet." />
              ) : (
                <div className="space-y-2">
                  {caseHistory.map((h: any) => (
                    <div key={h.id} className="flex items-start gap-3 py-2 border-b last:border-0">
                      <div className="mt-0.5">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{h.action}</span>
                          {h.from_status && h.to_status && (
                            <span className="text-xs text-muted-foreground">
                              {h.from_status} → {h.to_status}
                            </span>
                          )}
                        </div>
                        {h.notes && <p className="text-xs text-muted-foreground mt-0.5">{h.notes}</p>}
                      </div>
                      <div className="text-xs text-muted-foreground whitespace-nowrap text-right">
                        <p>{h.performed_at ? formatDateForDisplay(h.performed_at) : '-'}</p>
                        <p>{h.performed_by ?? 'SYSTEM'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Notices Tab ───────────────────────────────── */}
        <TabsContent value="notices">
          <Card>
            <CardContent className="pt-4">
              {noticesError ? (
                <SectionError message="Failed to load related notices." />
              ) : !caseId ? (
                <SectionEmpty message="No linked case — notices are unavailable." icon={<Bell className="h-6 w-6 mb-2 opacity-50" />} />
              ) : notices.length === 0 ? (
                <SectionEmpty message="No notices have been issued for this case." icon={<Bell className="h-6 w-6 mb-2 opacity-50" />} />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Notice #</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Delivery</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {notices.map((n: any) => (
                        <TableRow key={n.id}>
                          <TableCell className="font-mono text-xs">{n.notice_number}</TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">{n.notice_type}</Badge></TableCell>
                          <TableCell className="text-xs truncate max-w-[200px]">{n.subject}</TableCell>
                          <TableCell><Badge className={statusColor(n.status ?? '')}>{n.status}</Badge></TableCell>
                          <TableCell className="text-xs">{n.delivery_method ?? '-'}</TableCell>
                          <TableCell className="text-xs">{n.created_at ? formatDateForDisplay(n.created_at) : '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
