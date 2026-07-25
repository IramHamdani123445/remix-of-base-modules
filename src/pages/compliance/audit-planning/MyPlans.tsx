import { Fragment, useState } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Calendar,
  Eye,
  Edit,
  Send,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  FileText,
  Play,
  Undo2,
  Loader2,
  GitBranch,
  History,
  UserPlus,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { weeklyPlanService } from '@/services/weeklyPlanService';
import { WeeklyPlan, WeeklyPlanStatus } from '@/types/weeklyPlan';
import { useNavigate } from 'react-router-dom';
import { useUserCode } from '@/hooks/useUserCode';
import { PlanRevisionDialog } from '@/components/compliance/weekly-plan/PlanRevisionDialog';
import { PlanVersionHistoryDialog } from '@/components/compliance/weekly-plan/PlanVersionHistoryDialog';
import { AssignInspectorDialog } from '@/components/compliance/weekly-plan/AssignInspectorDialog';
import { useHasCapability } from '@/hooks/useHasCapability';
import { COMPLIANCE_CAPABILITIES } from '@/lib/compliance/capabilities';

export default function MyPlans() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { userCode, userId } = useUserCode();
  const [withdrawDialogPlan, setWithdrawDialogPlan] = useState<WeeklyPlan | null>(null);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [revisionPlan, setRevisionPlan] = useState<WeeklyPlan | null>(null);
  const [historyPlan, setHistoryPlan] = useState<WeeklyPlan | null>(null);
  const [assignPlan, setAssignPlan] = useState<WeeklyPlan | null>(null);
  const canAssign = useHasCapability(COMPLIANCE_CAPABILITIES.FIELD_APPROVE_PLANS);

  const plansQuery = useQuery({
    queryKey: ['my-weekly-plans'],
    queryFn: () => weeklyPlanService.getAll(),
  });

  const plans = plansQuery.data ?? [];
  const loading = plansQuery.isLoading;

  const withdrawMutation = useMutation({
    mutationFn: async () => {
      if (!withdrawDialogPlan) throw new Error('No plan selected');
      await weeklyPlanService.withdraw(withdrawDialogPlan.id, userCode || userId || '', withdrawReason);
    },
    onSuccess: () => {
      toast({ title: 'Plan Withdrawn', description: 'Your plan has been withdrawn and is now editable.' });
      setWithdrawDialogPlan(null);
      setWithdrawReason('');
      queryClient.invalidateQueries({ queryKey: ['my-weekly-plans'] });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case WeeklyPlanStatus.DRAFT: return <Edit className="h-4 w-4" />;
      case WeeklyPlanStatus.SUBMITTED: return <Clock className="h-4 w-4" />;
      case WeeklyPlanStatus.NEEDS_CHANGES: return <AlertCircle className="h-4 w-4" />;
      case WeeklyPlanStatus.RESUBMITTED: return <Send className="h-4 w-4" />;
      case WeeklyPlanStatus.APPROVED: return <CheckCircle className="h-4 w-4" />;
      case WeeklyPlanStatus.IN_EXECUTION: return <Play className="h-4 w-4" />;
      case WeeklyPlanStatus.OUTCOME_SUBMITTED: return <FileText className="h-4 w-4" />;
      case WeeklyPlanStatus.COMPLETED: return <CheckCircle className="h-4 w-4" />;
      case WeeklyPlanStatus.WITHDRAWN: return <Undo2 className="h-4 w-4" />;
      case WeeklyPlanStatus.REVISION_DRAFT: return <GitBranch className="h-4 w-4" />;
      case WeeklyPlanStatus.REVISION_SUBMITTED: return <Send className="h-4 w-4" />;
      case WeeklyPlanStatus.REVISION_QUERIED: return <AlertCircle className="h-4 w-4" />;
      case WeeklyPlanStatus.REVISION_APPROVED: return <CheckCircle className="h-4 w-4" />;
      case WeeklyPlanStatus.REVISION_REJECTED: return <XCircle className="h-4 w-4" />;
      case WeeklyPlanStatus.SUPERSEDED: return <History className="h-4 w-4" />;
      default: return <FileText className="h-4 w-4" />;
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      [WeeklyPlanStatus.DRAFT]: 'bg-muted text-muted-foreground',
      [WeeklyPlanStatus.SUBMITTED]: 'bg-primary/10 text-primary',
      [WeeklyPlanStatus.NEEDS_CHANGES]: 'bg-warning/15 text-warning',
      [WeeklyPlanStatus.RESUBMITTED]: 'bg-accent/20 text-accent-foreground',
      [WeeklyPlanStatus.APPROVED]: 'bg-success/15 text-success',
      [WeeklyPlanStatus.IN_EXECUTION]: 'bg-primary/15 text-primary',
      [WeeklyPlanStatus.OUTCOME_SUBMITTED]: 'bg-primary/10 text-primary',
      [WeeklyPlanStatus.COMPLETED]: 'bg-muted text-muted-foreground',
      [WeeklyPlanStatus.WITHDRAWN]: 'bg-destructive/10 text-destructive',
      [WeeklyPlanStatus.REVISION_DRAFT]: 'bg-warning/15 text-warning',
      [WeeklyPlanStatus.REVISION_SUBMITTED]: 'bg-primary/15 text-primary',
      [WeeklyPlanStatus.REVISION_QUERIED]: 'bg-warning/20 text-warning',
      [WeeklyPlanStatus.REVISION_APPROVED]: 'bg-success/15 text-success',
      [WeeklyPlanStatus.REVISION_REJECTED]: 'bg-destructive/10 text-destructive',
      [WeeklyPlanStatus.SUPERSEDED]: 'bg-muted/60 text-muted-foreground line-through',
    };
    return colors[status] || 'bg-muted text-muted-foreground';
  };

  const getVersionLabel = (plan: any): string => {
    const v = plan.version_no ?? 1;
    switch (plan.status) {
      case WeeklyPlanStatus.REVISION_DRAFT: return `Working Revision v${v}`;
      case WeeklyPlanStatus.REVISION_QUERIED: return `Revision v${v} — Queried`;
      case WeeklyPlanStatus.REVISION_SUBMITTED: return `Revision v${v} — In Review`;
      case WeeklyPlanStatus.SUPERSEDED: return `v${v} — Superseded`;
      case WeeklyPlanStatus.APPROVED:
      case WeeklyPlanStatus.IN_EXECUTION:
      case WeeklyPlanStatus.OUTCOME_SUBMITTED:
      case WeeklyPlanStatus.COMPLETED:
        return plan.is_revision ? `Approved Revision v${v}` : `Approved v${v}`;
      default:
        return `v${v}`;
    }
  };

  const isRevisionEditable = (status: string) =>
    status === WeeklyPlanStatus.REVISION_DRAFT ||
    status === WeeklyPlanStatus.REVISION_QUERIED;

  const goToBuilder = (plan: any) => {
    // Revisions open in the Enhanced builder (V2) so the version banner is shown.
    if (plan.is_revision || isRevisionEditable(plan.status)) {
      navigate(`/compliance/field/plan-builder-v2?planId=${plan.id}`);
    } else {
      navigate('/compliance/field/plan-builder');
    }
  };

  // Buckets — include Phase 3 revision statuses where appropriate.
  const activePlans = plans.filter(p => p.status !== WeeklyPlanStatus.WITHDRAWN);

  // Group by plan family (root id) + week so all versions for the same week
  // are shown together. The "root" is parent_plan_id when present, else the
  // plan's own id. Within a group we sort by version_no ascending so v1 is at
  // the top and the latest revision is at the bottom.
  type PlanGroup = {
    rootId: string;
    weekStart: string;
    weekEnd: string;
    inspectorName: string | null;
    plans: WeeklyPlan[];
  };
  const planGroups: PlanGroup[] = (() => {
    const map = new Map<string, PlanGroup>();
    for (const p of activePlans) {
      const rootId = ((p as any).parent_plan_id as string | null) ?? p.id;
      const key = `${rootId}__${p.week_start_date}`;
      const existing = map.get(key);
      if (existing) {
        existing.plans.push(p);
      } else {
        map.set(key, {
          rootId,
          weekStart: p.week_start_date,
          weekEnd: p.week_end_date,
          inspectorName: p.inspector_name,
          plans: [p],
        });
      }
    }
    const groups = Array.from(map.values());
    // Sort versions within each group
    for (const g of groups) {
      g.plans.sort((a, b) => ((a as any).version_no ?? 1) - ((b as any).version_no ?? 1));
    }
    // Sort groups by latest activity (most recent week first, then most recent updated_at)
    groups.sort((a, b) => {
      if (a.weekStart !== b.weekStart) return b.weekStart.localeCompare(a.weekStart);
      const aLatest = a.plans[a.plans.length - 1]?.updated_at ?? '';
      const bLatest = b.plans[b.plans.length - 1]?.updated_at ?? '';
      return bLatest.localeCompare(aLatest);
    });
    return groups;
  })();
  const draftPlans = activePlans.filter(p =>
    p.status === WeeklyPlanStatus.DRAFT ||
    p.status === WeeklyPlanStatus.REVISION_DRAFT ||
    p.status === WeeklyPlanStatus.REVISION_QUERIED
  );
  const needsChangesPlans = activePlans.filter(p => p.status === WeeklyPlanStatus.NEEDS_CHANGES);
  const pendingPlans = activePlans.filter(p =>
    p.status === WeeklyPlanStatus.SUBMITTED ||
    p.status === WeeklyPlanStatus.RESUBMITTED ||
    p.status === WeeklyPlanStatus.REVISION_SUBMITTED
  );
  const approvedPlans = activePlans.filter(p =>
    p.status === WeeklyPlanStatus.APPROVED ||
    p.status === WeeklyPlanStatus.IN_EXECUTION ||
    p.status === WeeklyPlanStatus.REVISION_APPROVED
  );
  const completedPlans = activePlans.filter(p => p.status === WeeklyPlanStatus.COMPLETED);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <PageHeader
        title="My Weekly Plans"
        subtitle="View and manage your weekly audit plans"
        breadcrumbs={[
          { label: 'Compliance', href: '/compliance/dashboard' },
          { label: 'Audit Planning', href: '/compliance/audit-planning/sampling-dashboard' },
          { label: 'My Plans' }
        ]}
        actions={
          <Button onClick={() => navigate('/compliance/audit-planning/weekly-plan-builder')}>
            <Calendar className="h-4 w-4 mr-2" />
            Create New Plan
          </Button>
        }
      />

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Draft Plans</CardTitle>
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{draftPlans.length}</div></CardContent>
        </Card>
        <Card className={needsChangesPlans.length > 0 ? 'border-warning/40' : ''}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Needs Changes</CardTitle>
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-warning">{needsChangesPlans.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Review</CardTitle>
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-primary">{pendingPlans.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Approved/Active</CardTitle>
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-success">{approvedPlans.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Completed</CardTitle>
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-foreground">{completedPlans.length}</div></CardContent>
        </Card>
      </div>

      {/* Plans Table */}
      <Card>
        <CardHeader>
          <CardTitle>All My Plans</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-12">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : activePlans.length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-medium">No plans found</p>
              <p className="text-sm text-muted-foreground mb-4">Create your first weekly plan to get started</p>
              <Button onClick={() => navigate('/compliance/audit-planning/weekly-plan-builder')}>
                <Calendar className="h-4 w-4 mr-2" />
                Create Plan
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan Number</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Week Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Planned Visits</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {planGroups.map((group) => (
                  <Fragment key={`group-${group.rootId}-${group.weekStart}`}>
                    {/* Family header row — only render when the family has more than one version */}
                    {group.plans.length > 1 && (
                      <TableRow
                        key={`group-${group.rootId}-${group.weekStart}`}
                        className="bg-muted/40 hover:bg-muted/40"
                      >
                        <TableCell colSpan={8} className="py-2">
                          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                            <GitBranch className="h-3.5 w-3.5" />
                            <span>
                              Plan family — week {group.weekStart} → {group.weekEnd}
                              {group.inspectorName ? ` · ${group.inspectorName}` : ''}
                            </span>
                            <Badge variant="outline" className="text-[10px]">
                              {group.plans.length} version{group.plans.length === 1 ? '' : 's'}
                            </Badge>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    {group.plans.map((plan, idx) => {
                      const isFamilyMember = group.plans.length > 1;
                      const isLastInFamily = idx === group.plans.length - 1;
                      return (
                        <TableRow
                          key={plan.id}
                          className={[
                            plan.status === WeeklyPlanStatus.SUPERSEDED ? 'opacity-60' : '',
                            isFamilyMember && !isLastInFamily ? 'border-b-0' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              {isFamilyMember && (
                                <span
                                  className="inline-block w-3 border-l-2 border-b-2 border-muted-foreground/30 h-3 -mt-2 ml-2"
                                  aria-hidden
                                />
                              )}
                              {plan.plan_number}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs whitespace-nowrap">
                              {getVersionLabel(plan)}
                            </Badge>
                            {(plan as any).is_revision && (plan as any).revision_reason_code && (
                              <div className="text-[10px] text-muted-foreground mt-1">
                                {(plan as any).revision_reason_code.replace(/_/g, ' ')}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              <span>{plan.week_start_date} - {plan.week_end_date}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className={getStatusColor(plan.status)}>
                              <span className="flex items-center gap-1">
                                {getStatusIcon(plan.status)}
                                {plan.status.replace(/_/g, ' ')}
                              </span>
                            </Badge>
                          </TableCell>
                          {(() => {
                            const items = (plan as any).ce_weekly_plan_items ?? [];
                            const planned = items.length || plan.total_planned_visits || 0;
                            const completed = items.filter((i: any) => i.execution_status === 'COMPLETED').length || plan.completed_visits || 0;
                            return (
                              <>
                                <TableCell>{planned}</TableCell>
                                <TableCell>{completed} / {planned}</TableCell>
                              </>
                            );
                          })()}
                          <TableCell>
                            {plan.submitted_date ? new Date(plan.submitted_date).toLocaleDateString() : '-'}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex gap-2 justify-end flex-wrap">
                              {plan.status === WeeklyPlanStatus.DRAFT && (
                                <Button variant="outline" size="sm" onClick={() => goToBuilder(plan)}>
                                  <Edit className="h-4 w-4 mr-1" />
                                  Edit
                                </Button>
                              )}
                              {plan.status === WeeklyPlanStatus.NEEDS_CHANGES && (
                                <Button variant="outline" size="sm" onClick={() => goToBuilder(plan)}>
                                  <Edit className="h-4 w-4 mr-1" />
                                  Update & Resubmit
                                </Button>
                              )}
                              {isRevisionEditable(plan.status) && (
                                <Button variant="outline" size="sm" onClick={() => goToBuilder(plan)}>
                                  <GitBranch className="h-4 w-4 mr-1" />
                                  Edit Revision
                                </Button>
                              )}
                              {(plan.status === WeeklyPlanStatus.SUBMITTED ||
                                plan.status === WeeklyPlanStatus.RESUBMITTED ||
                                plan.status === WeeklyPlanStatus.REVISION_SUBMITTED) && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-destructive border-destructive/30 hover:bg-destructive/5"
                                  onClick={() => setWithdrawDialogPlan(plan)}
                                >
                                  <Undo2 className="h-4 w-4 mr-1" />
                                  Withdraw
                                </Button>
                              )}
                              {(plan.status === WeeklyPlanStatus.APPROVED ||
                                plan.status === WeeklyPlanStatus.IN_EXECUTION ||
                                plan.status === WeeklyPlanStatus.OUTCOME_SUBMITTED ||
                                plan.status === WeeklyPlanStatus.COMPLETED) && (
                                <Button
                                  size="sm"
                                  onClick={() => navigate(`/compliance/field/execution-dashboard/${plan.id}`)}
                                >
                                  <Play className="h-4 w-4 mr-1" />
                                  {plan.status === WeeklyPlanStatus.COMPLETED ? 'View' : 'Execute'}
                                </Button>
                              )}
                              {(plan.status === WeeklyPlanStatus.APPROVED ||
                                plan.status === WeeklyPlanStatus.IN_EXECUTION) && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setRevisionPlan(plan)}
                                  title="Create a revision draft of this approved plan"
                                >
                                  <GitBranch className="h-4 w-4 mr-1" />
                                  Revise
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setHistoryPlan(plan)}
                                title="View version history"
                              >
                                <History className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => navigate(`/compliance/field/execution-dashboard/${plan.id}`)}
                                title="View plan details"
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Need Changes Section */}
      {needsChangesPlans.length > 0 && (
        <Card className="border-warning/40 bg-warning/5">
          <CardHeader>
            <CardTitle className="text-warning flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Plans Requiring Changes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {needsChangesPlans.map(plan => (
                <div key={plan.id} className="bg-card border border-border p-4 rounded-lg">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">{plan.plan_number}</p>
                      <p className="text-sm text-muted-foreground">
                        Week: {plan.week_start_date} - {plan.week_end_date}
                      </p>
                      {plan.reviewer_comments && (
                        <p className="text-sm mt-2 text-foreground">
                          <span className="font-medium">Feedback:</span> {plan.reviewer_comments}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => goToBuilder(plan)}
                    >
                      <Edit className="h-4 w-4 mr-2" />
                      Update Plan
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Withdraw Confirmation Dialog */}
      <Dialog open={!!withdrawDialogPlan} onOpenChange={(open) => !open && setWithdrawDialogPlan(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw Plan</DialogTitle>
            <DialogDescription>
              Withdraw {withdrawDialogPlan?.plan_number} from review? It will become editable again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Reason (optional)</Label>
            <Textarea
              value={withdrawReason}
              onChange={(e) => setWithdrawReason(e.target.value)}
              placeholder="Why are you withdrawing this plan?"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWithdrawDialogPlan(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => withdrawMutation.mutate()}
              disabled={withdrawMutation.isPending}
            >
              {withdrawMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Undo2 className="h-4 w-4 mr-1" />}
              Withdraw Plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phase 3 — Approved-plan revision flow */}
      <PlanRevisionDialog plan={revisionPlan} onClose={() => setRevisionPlan(null)} />
      <PlanVersionHistoryDialog plan={historyPlan} onClose={() => setHistoryPlan(null)} />
    </div>
  );
}
