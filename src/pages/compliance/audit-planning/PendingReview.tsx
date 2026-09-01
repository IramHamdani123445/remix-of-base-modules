import { useState, useEffect } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  CheckCircle,
  XCircle,
  Eye,
  Calendar,
  Clock,
  User,
  MapPin,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  WeeklyAuditPlan,
  WeeklyPlanWorkflowStatus,
  ReviewPlanRequest
} from '@/types/weeklyAuditPlan';
import { weeklyAuditPlanService } from '@/services/weeklyAuditPlanService';
import { ZoneSelector } from '@/components/compliance/weekly-plan/ZoneSelector';

export default function PendingReview() {
  const { toast } = useToast();
  const [plans, setPlans] = useState<WeeklyAuditPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<WeeklyAuditPlan | null>(null);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [comments, setComments] = useState('');
  const [loading, setLoading] = useState(false);
  const [zoneFilter, setZoneFilter] = useState<string | null>(null);

  useEffect(() => {
    loadPendingPlans();
  }, []);

  const loadPendingPlans = async () => {
    try {
      const data = await weeklyAuditPlanService.getPendingReview('SENIOR_INSPECTOR');
      setPlans(data);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load pending plans',
        variant: 'destructive'
      });
    }
  };

  const handleReviewPlan = (plan: WeeklyAuditPlan) => {
    setSelectedPlan(plan);
    setComments('');
    setReviewDialogOpen(true);
  };

  const handleApprove = async () => {
    if (!selectedPlan) return;

    setLoading(true);
    try {
      const request: ReviewPlanRequest = {
        planId: selectedPlan.id,
        approved: true,
        comments: comments || 'Approved',
        reviewerRole: 'SENIOR_INSPECTOR'
      };

      await weeklyAuditPlanService.review(request);

      toast({
        title: 'Plan Approved',
        description: `Weekly plan ${selectedPlan.planNumber} has been approved`
      });

      setReviewDialogOpen(false);
      setSelectedPlan(null);
      await loadPendingPlans();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to approve plan',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRequestChanges = async () => {
    if (!selectedPlan) return;

    if (!comments.trim()) {
      toast({
        title: 'Comments Required',
        description: 'Please provide feedback for the inspector',
        variant: 'destructive'
      });
      return;
    }

    setLoading(true);
    try {
      const request: ReviewPlanRequest = {
        planId: selectedPlan.id,
        approved: false,
        comments,
        reviewerRole: 'SENIOR_INSPECTOR'
      };

      await weeklyAuditPlanService.review(request);

      toast({
        title: 'Changes Requested',
        description: `Feedback sent to ${selectedPlan.inspectorName}`
      });

      setReviewDialogOpen(false);
      setSelectedPlan(null);
      await loadPendingPlans();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to request changes',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: WeeklyPlanWorkflowStatus) => {
    const colors: Record<WeeklyPlanWorkflowStatus, string> = {
      [WeeklyPlanWorkflowStatus.DRAFT]: 'bg-muted text-muted-foreground',
      [WeeklyPlanWorkflowStatus.SUBMITTED]: 'bg-info/10 text-info',
      [WeeklyPlanWorkflowStatus.NEED_CHANGES]: 'bg-warning/15 text-warning',
      [WeeklyPlanWorkflowStatus.RESUBMITTED]: 'bg-accent/20 text-accent-foreground',
      [WeeklyPlanWorkflowStatus.APPROVED]: 'bg-success/10 text-success',
      [WeeklyPlanWorkflowStatus.IN_EXECUTION]: 'bg-primary/10 text-primary',
      [WeeklyPlanWorkflowStatus.COMPLETED]: 'bg-muted text-muted-foreground',
    };
    return colors[status];
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <PageHeader
        title="Plans Pending Review"
        subtitle="Review and approve inspector weekly plans"
        breadcrumbs={[
          { label: 'Compliance', href: '/compliance/dashboard' },
          { label: 'Audit Planning', href: '/compliance/audit-planning/sampling-dashboard' },
          { label: 'Pending Review' }
        ]}
      />

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pending Review
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{plans.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Submitted
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {plans.filter(p => p.status === WeeklyPlanWorkflowStatus.SUBMITTED).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Resubmitted
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {plans.filter(p => p.status === WeeklyPlanWorkflowStatus.RESUBMITTED).length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Plans Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle>Weekly Plans Awaiting Review</CardTitle>
            <div className="flex items-center gap-2 min-w-[260px]">
              <ZoneSelector value={zoneFilter} onChange={setZoneFilter} className="w-full" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {(() => {
            const filteredPlans = zoneFilter
              ? plans.filter((p) => (p as any).zone_id === zoneFilter)
              : plans;
            return filteredPlans.length === 0 ? (
              <div className="text-center py-12">
                <CheckCircle className="h-12 w-12 text-success mx-auto mb-4" />
                <p className="text-lg font-medium">
                  {zoneFilter ? 'No plans in selected zone' : 'All plans reviewed!'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {zoneFilter ? 'Try a different zone filter.' : 'No plans pending review at this time.'}
                </p>
              </div>
            ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan Number</TableHead>
                  <TableHead>Inspector</TableHead>
                  <TableHead>Week Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Visits</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPlans.map((plan) => (
                  <TableRow key={plan.id}>
                    <TableCell className="font-medium">{plan.planNumber}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        {plan.inspectorName}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span>{plan.weekStartDate} - {plan.weekEndDate}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(plan.status)}>
                        {plan.status.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-sm">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        {/* Reviewers need the exact submission timestamp, not just the day. */}
                        {plan.submittedAt
                          ? new Date(plan.submittedAt).toLocaleString()
                          : '-'}
                      </div>
                    </TableCell>
                    <TableCell>{plan.plannedVisits?.length ?? plan.totalPlannedVisits ?? 0}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleReviewPlan(plan)}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            );
          })()}
        </CardContent>
      </Card>

      {/* Review Dialog */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Weekly Plan</DialogTitle>
            <DialogDescription>
              {selectedPlan?.planNumber} - {selectedPlan?.inspectorName}
            </DialogDescription>
          </DialogHeader>

          {selectedPlan && (
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-sm text-muted-foreground">Week Period</Label>
                  <p className="font-medium">
                    {selectedPlan.weekStartDate} - {selectedPlan.weekEndDate}
                  </p>
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">Planned Visits</Label>
                  <p className="font-medium">{selectedPlan.plannedVisits?.length ?? selectedPlan.totalPlannedVisits ?? 0}</p>
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">Status</Label>
                  <Badge className={getStatusColor(selectedPlan.status)}>
                    {selectedPlan.status.replace(/_/g, ' ')}
                  </Badge>
                </div>
              </div>

              <div>
                <Label className="text-base font-semibold mb-3 block">Scheduled Visits</Label>
                <div className="space-y-3">
                  {selectedPlan.plannedVisits.map((visit) => (
                    <div key={visit.id} className="border rounded-lg p-3">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-medium">{visit.employerName}</p>
                          <p className="text-sm text-muted-foreground">{visit.dayOfWeek}, {visit.visitDate}</p>
                        </div>
                        <Badge variant="outline">{visit.visitType.replace(/_/g, ' ')}</Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {visit.plannedStartTime} - {visit.plannedEndTime}
                        </span>
                        <span>Duration: {visit.duration.replace(/_/g, ' ')}</span>
                      </div>
                      <p className="text-sm mt-2">{visit.purpose}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Review Comments / Feedback</Label>
                <Textarea
                  placeholder="Provide feedback to the inspector (required if requesting changes)..."
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  rows={4}
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReviewDialogOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={handleRequestChanges}
              disabled={loading}
              className="text-yellow-600 hover:text-yellow-700"
            >
              <XCircle className="h-4 w-4 mr-2" />
              Request Changes
            </Button>
            <Button onClick={handleApprove} disabled={loading}>
              <CheckCircle className="h-4 w-4 mr-2" />
              Approve Plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
