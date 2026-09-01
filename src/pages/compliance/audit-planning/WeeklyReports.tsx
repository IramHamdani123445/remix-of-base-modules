import { useState } from 'react';
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
  FileText,
  Send,
  CheckCircle,
  Calendar,
  TrendingUp,
  TrendingDown,
  Eye,
  Loader2,
  AlertTriangle,
  AlertCircle,
  Clock,
  Camera,
  Search,
  Scale,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { weeklyPlanService, WeeklyReportSummary } from '@/services/weeklyPlanService';
import { WeeklyPlan, WeeklyPlanStatus } from '@/types/weeklyPlan';
import { useUserCode } from '@/hooks/useUserCode';

export default function WeeklyReports() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { userCode, userId } = useUserCode();
  const [selectedPlan, setSelectedPlan] = useState<WeeklyPlan | null>(null);
  const [reportSummary, setReportSummary] = useState<WeeklyReportSummary | null>(null);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [narrative, setNarrative] = useState('');
  const [exceptions, setExceptions] = useState('');
  const [recommendations, setRecommendations] = useState('');
  const [loadingSummary, setLoadingSummary] = useState(false);

  const plansQuery = useQuery({
    queryKey: ['weekly-report-plans'],
    queryFn: async () => {
      const data = await weeklyPlanService.getAll();
      return data.filter(p =>
        p.status === WeeklyPlanStatus.IN_EXECUTION ||
        p.status === WeeklyPlanStatus.OUTCOME_SUBMITTED ||
        p.status === WeeklyPlanStatus.COMPLETED ||
        p.status === WeeklyPlanStatus.APPROVED
      );
    },
  });

  const plans = plansQuery.data ?? [];

  const handleOpenReport = async (plan: WeeklyPlan) => {
    setSelectedPlan(plan);
    // Parse existing narrative sections
    const existingNarrative = plan.outcome_narrative || '';
    const parts = existingNarrative.split('\n---\n');
    setNarrative(parts[0] || '');
    setExceptions(parts[1] || '');
    setRecommendations(parts[2] || '');
    setLoadingSummary(true);

    try {
      const summary = await weeklyPlanService.getReportSummary(plan.id);
      setReportSummary(summary);
      setReportDialogOpen(true);
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to generate report summary', variant: 'destructive' });
    } finally {
      setLoadingSummary(false);
    }
  };

  const submitReportMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPlan || !narrative.trim()) throw new Error('Please provide a weekly narrative');
      const fullNarrative = [
        narrative.trim(),
        exceptions.trim() ? exceptions.trim() : undefined,
        recommendations.trim() ? recommendations.trim() : undefined,
      ].filter(Boolean).join('\n---\n');
      await weeklyPlanService.submitWeeklyReport(selectedPlan.id, userCode || userId || '', fullNarrative);
    },
    onSuccess: () => {
      toast({ title: 'Report Submitted', description: 'Weekly report submitted for supervisor review.' });
      setReportDialogOpen(false);
      setSelectedPlan(null);
      setNarrative('');
      setExceptions('');
      setRecommendations('');
      queryClient.invalidateQueries({ queryKey: ['weekly-report-plans'] });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      [WeeklyPlanStatus.APPROVED]: 'bg-green-100 text-green-800',
      [WeeklyPlanStatus.IN_EXECUTION]: 'bg-cyan-100 text-cyan-800',
      [WeeklyPlanStatus.OUTCOME_SUBMITTED]: 'bg-indigo-100 text-indigo-800',
      [WeeklyPlanStatus.COMPLETED]: 'bg-gray-100 text-gray-800',
    };
    return colors[status] || 'bg-muted text-muted-foreground';
  };

  const completionRate = (plan: WeeklyPlan) => {
    if (plan.total_planned_visits === 0) return 0;
    return Math.round((plan.completed_visits / plan.total_planned_visits) * 100);
  };

  const getReportValidations = (summary: WeeklyReportSummary | null) => {
    const blockers: string[] = [];
    const warnings: string[] = [];
    if (!summary) return { blockers, warnings };

    if (summary.still_planned > 0) {
      blockers.push(`${summary.still_planned} plan item(s) still in PLANNED status — must be executed, rescheduled, or marked not done`);
    }
    if (summary.completed_visits > 0 && summary.findings_count === 0) {
      blockers.push('Completed visits have no findings recorded — at least one finding per visit is required');
    }
    if (summary.not_done_visits > 0) {
      warnings.push(`${summary.not_done_visits} visit(s) marked as not done`);
    }
    if (summary.evidence_count === 0 && summary.completed_visits > 0) {
      warnings.push('No evidence collected for completed visits');
    }
    if (summary.violations_created === 0 && summary.findings_count > 0) {
      warnings.push('No violations created from findings');
    }
    return { blockers, warnings };
  };

  const validations = getReportValidations(reportSummary);
  const hasBlockers = validations.blockers.length > 0;
  const isAlreadySubmitted = selectedPlan?.status === WeeklyPlanStatus.OUTCOME_SUBMITTED || selectedPlan?.status === WeeklyPlanStatus.COMPLETED;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <PageHeader
        title="Weekly Reports"
        subtitle="Submit and track weekly execution reports"
        breadcrumbs={[
          { label: 'Compliance', href: '/compliance/dashboard' },
          { label: 'Audit Planning', href: '/compliance/audit-planning/sampling-dashboard' },
          { label: 'Weekly Reports' }
        ]}
      />

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Plans</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-cyan-600">
              {plans.filter(p => p.status === WeeklyPlanStatus.IN_EXECUTION).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Outcome Submitted</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-indigo-600">
              {plans.filter(p => p.status === WeeklyPlanStatus.OUTCOME_SUBMITTED).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Completed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {plans.filter(p => p.status === WeeklyPlanStatus.COMPLETED).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Visits</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {plans.reduce((sum, p) => sum + p.completed_visits, 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Plans Table */}
      <Card>
        <CardHeader>
          <CardTitle>Weekly Plans & Reports</CardTitle>
        </CardHeader>
        <CardContent>
          {plansQuery.isLoading ? (
            <div className="text-center py-12">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : plans.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-medium">No active or completed plans</p>
              <p className="text-sm text-muted-foreground">Plans ready for reporting will appear here.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan Number</TableHead>
                  <TableHead>Week Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Visits</TableHead>
                  <TableHead>Completion</TableHead>
                  <TableHead>Report Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map((plan) => {
                  const rate = completionRate(plan);
                  return (
                    <TableRow key={plan.id}>
                      <TableCell className="font-medium">{plan.plan_number}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{plan.week_start_date} - {plan.week_end_date}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(plan.status)}>
                          {plan.status.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {plan.completed_visits} / {plan.total_planned_visits}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {rate >= 80 ? (
                            <TrendingUp className="h-4 w-4 text-green-600" />
                          ) : (
                            <TrendingDown className="h-4 w-4 text-yellow-600" />
                          )}
                          <span className={rate >= 80 ? 'text-green-600' : 'text-yellow-600'}>
                            {rate}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {plan.status === WeeklyPlanStatus.OUTCOME_SUBMITTED || plan.status === WeeklyPlanStatus.COMPLETED ? (
                          <Badge variant="secondary">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            {plan.status === WeeklyPlanStatus.COMPLETED ? 'Approved' : 'Submitted'}
                          </Badge>
                        ) : (
                          <Badge variant="outline">Pending</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenReport(plan)}
                          disabled={loadingSummary}
                        >
                          {plan.status === WeeklyPlanStatus.OUTCOME_SUBMITTED || plan.status === WeeklyPlanStatus.COMPLETED ? (
                            <>
                              <Eye className="h-4 w-4 mr-2" />
                              View
                            </>
                          ) : (
                            <>
                              <FileText className="h-4 w-4 mr-2" />
                              Submit Report
                            </>
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Weekly Report Dialog */}
      <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Weekly Report</DialogTitle>
            <DialogDescription>
              {selectedPlan?.plan_number} — Week of {selectedPlan?.week_start_date}
            </DialogDescription>
          </DialogHeader>

          {selectedPlan && reportSummary && (
            <div className="space-y-6 py-4">
              {/* Auto-Generated Summary — Visit Breakdown */}
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3">Visit Summary (Auto-Generated)</h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div className="border rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-foreground">{reportSummary.total_planned}</div>
                    <div className="text-xs text-muted-foreground">Planned</div>
                  </div>
                  <div className="border rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-green-600">{reportSummary.completed_visits}</div>
                    <div className="text-xs text-muted-foreground">Completed</div>
                  </div>
                  <div className="border rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-yellow-600">{reportSummary.rescheduled_visits}</div>
                    <div className="text-xs text-muted-foreground">Rescheduled</div>
                  </div>
                  <div className="border rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-orange-600">{reportSummary.not_done_visits}</div>
                    <div className="text-xs text-muted-foreground">Not Done</div>
                  </div>
                  <div className="border rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-red-600">{reportSummary.cancelled_visits}</div>
                    <div className="text-xs text-muted-foreground">Cancelled</div>
                  </div>
                </div>
              </div>

              {/* Execution Metrics */}
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3">Execution Metrics (Auto-Generated)</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="border rounded-lg p-3 flex items-center gap-3">
                    <Clock className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-xl font-bold">{reportSummary.total_hours}h</p>
                      <p className="text-xs text-muted-foreground">Total Hours</p>
                    </div>
                  </div>
                  <div className="border rounded-lg p-3 flex items-center gap-3">
                    <Camera className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-xl font-bold">{reportSummary.evidence_count}</p>
                      <p className="text-xs text-muted-foreground">Evidence</p>
                    </div>
                  </div>
                  <div className="border rounded-lg p-3 flex items-center gap-3">
                    <Search className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-xl font-bold">{reportSummary.findings_count}</p>
                      <p className="text-xs text-muted-foreground">Findings</p>
                    </div>
                  </div>
                  <div className="border rounded-lg p-3 flex items-center gap-3">
                    <Scale className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-xl font-bold">{reportSummary.violations_created}</p>
                      <p className="text-xs text-muted-foreground">Violations</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Still Planned Warning */}
              {reportSummary.still_planned > 0 && !isAlreadySubmitted && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm">
                  <span className="font-medium text-amber-800">{reportSummary.still_planned} item(s)</span>
                  <span className="text-amber-700"> still in PLANNED status and must be addressed before submission.</span>
                </div>
              )}

              {/* Validation Blockers & Warnings */}
              {!isAlreadySubmitted && (
                <>
                  {validations.blockers.length > 0 && (
                    <div className="space-y-2">
                      {validations.blockers.map((b, idx) => (
                        <div key={idx} className="flex items-start gap-2 p-3 rounded-md text-sm bg-destructive/10 text-destructive">
                          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                          <span>{b} <Badge variant="destructive" className="ml-1 text-[10px]">Blocking</Badge></span>
                        </div>
                      ))}
                    </div>
                  )}
                  {validations.warnings.length > 0 && (
                    <div className="space-y-2">
                      {validations.warnings.map((w, idx) => (
                        <div key={idx} className="flex items-start gap-2 p-3 rounded-md text-sm bg-warning/10 text-warning">
                          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Inspector Narrative Sections */}
              <div className="space-y-4 border-t pt-4">
                <h3 className="text-sm font-medium">Inspector Narrative (Required)</h3>

                <div className="space-y-2">
                  <Label>Weekly Summary *</Label>
                  <Textarea
                    placeholder="Provide a comprehensive summary of the week's activities, outcomes, and observations..."
                    value={narrative}
                    onChange={(e) => setNarrative(e.target.value)}
                    rows={4}
                    disabled={isAlreadySubmitted}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Exceptions & Blockers (Optional)</Label>
                  <Textarea
                    placeholder="Document any exceptions, challenges, or blockers encountered during the week..."
                    value={exceptions}
                    onChange={(e) => setExceptions(e.target.value)}
                    rows={3}
                    disabled={isAlreadySubmitted}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Recommendations & Next Week Priorities (Optional)</Label>
                  <Textarea
                    placeholder="Suggestions for follow-up actions, next week's priorities, or process improvements..."
                    value={recommendations}
                    onChange={(e) => setRecommendations(e.target.value)}
                    rows={3}
                    disabled={isAlreadySubmitted}
                  />
                </div>
              </div>

              {isAlreadySubmitted && (
                <div className="border-l-4 border-green-500 bg-green-50 p-4">
                  <p className="text-sm font-medium text-green-800">
                    Report submitted on {(selectedPlan.outcome_submitted_at ?? (selectedPlan as any).submitted_date) ? new Date((selectedPlan.outcome_submitted_at ?? (selectedPlan as any).submitted_date) as string).toLocaleString() : 'N/A'}
                  </p>
                  {selectedPlan.status === WeeklyPlanStatus.COMPLETED && (
                    <p className="text-sm text-green-700 mt-1">✓ Approved by supervisor</p>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setReportDialogOpen(false)}>
              Close
            </Button>
            {selectedPlan && !isAlreadySubmitted && (
              <Button
                onClick={() => submitReportMutation.mutate()}
                disabled={submitReportMutation.isPending || hasBlockers || !narrative.trim()}
              >
                {submitReportMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Submit Weekly Report
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
