import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  UserCheck, MapPin, Calendar, ClipboardCheck, AlertTriangle,
  CheckCircle, Clock, ArrowRight, Loader2, ListChecks, Building2
} from 'lucide-react';
import { WorkboardCaseloadSummary } from '@/components/compliance/WorkboardCaseloadSummary';
import { useNavigate } from 'react-router-dom';
import { useInspectorWorkboard } from '@/hooks/useInspectorWorkboard';
import { useInspectorAnalytics, pctDelta } from '@/hooks/compliance/useInspectorAnalytics';
import {
  InspectorPerformanceSection, InspectorRangeSelector,
} from '@/components/compliance/workboard/analytics/InspectorPerformancePanels';
import { WorkboardActionCard } from '@/components/compliance/workboard/WorkboardActionCard';
import { ActionExecutionDialog, ActionDialogMode } from '@/components/compliance/workboard/ActionExecutionDialog';
import { FollowUpAction } from '@/types/violationActions';

const InspectorDashboard = () => {
  const navigate = useNavigate();
  const wb = useInspectorWorkboard();
  const analytics = useInspectorAnalytics();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<ActionDialogMode>('details');
  const [selectedAction, setSelectedAction] = useState<FollowUpAction | null>(null);

  const c = wb.counts.data;
  const ak = analytics.data?.kpis;

  const openDialog = (action: FollowUpAction, mode: ActionDialogMode) => {
    setSelectedAction(action);
    setDialogMode(mode);
    setDialogOpen(true);
  };

  const kpis = [
    {
      label: 'Due Today', value: c?.dueToday ?? '—', icon: ClipboardCheck,
      color: 'text-primary', bg: 'bg-primary/10', delta: null as number | null, invert: false,
    },
    {
      label: 'Overdue', value: c?.overdue ?? '—', icon: AlertTriangle,
      color: 'text-destructive', bg: 'bg-destructive/10',
      delta: ak ? pctDelta(ak.became_overdue, ak.became_overdue_prev) : null, invert: true,
    },
    {
      label: 'This Week', value: c?.thisWeek ?? '—', icon: Calendar,
      color: 'text-blue-600', bg: 'bg-blue-50', delta: null as number | null, invert: false,
    },
    {
      label: 'Completed', value: c?.completed ?? '—', icon: CheckCircle,
      color: 'text-green-600', bg: 'bg-green-50',
      delta: ak ? pctDelta(ak.completed_period, ak.completed_prev) : null, invert: false,
    },
  ];


  const renderList = (data: FollowUpAction[] | undefined, isLoading: boolean, isOverdue = false, emptyMsg = 'No actions') => {
    if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
    if (!data || data.length === 0) return (
      <div className="text-center py-8 text-muted-foreground">
        <ListChecks className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">{emptyMsg}</p>
      </div>
    );
    return (
      <div className="space-y-2">
        {data.map(a => (
          <WorkboardActionCard
            key={a.id}
            action={a}
            isOverdue={isOverdue}
            onStart={id => wb.startAction.mutate(id)}
            onComplete={act => openDialog(act, 'complete')}
            onCancel={act => openDialog(act, 'cancel')}
            onReschedule={act => openDialog(act, 'reschedule')}
            onViewDetails={act => openDialog(act, 'details')}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <UserCheck className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-semibold text-foreground">Inspector Workboard</h1>
          </div>
          <p className="text-muted-foreground">Manage your assigned follow-up actions and field work</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <InspectorRangeSelector
            value={analytics.rangeKey}
            onChange={analytics.setRangeKey}
            generatedAt={analytics.data?.generated_at}
          />
          <Button variant="outline" size="sm" onClick={() => navigate('/compliance/field/my-plans')}>
            <Calendar className="h-4 w-4 mr-1" /> My Plans
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/compliance/violations')}>
            <AlertTriangle className="h-4 w-4 mr-1" /> Violations
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/compliance/field/employer-360')}>
            <Building2 className="h-4 w-4 mr-1" /> Employer 360
          </Button>
          <Button size="sm" onClick={() => navigate('/compliance/field/execution')}>
            <MapPin className="h-4 w-4 mr-1" /> Start Field Visit
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi, idx) => (
          <Card key={idx}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">{kpi.label}</CardTitle>
              <div className={`p-2 rounded-lg ${kpi.bg}`}>
                <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">
                {wb.counts.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : kpi.value}
              </div>
              {kpi.delta !== null && !analytics.unavailable && (
                <p className={`mt-1 text-xs font-medium ${
                  (kpi.invert ? kpi.delta <= 0 : kpi.delta >= 0) ? 'text-emerald-600' : 'text-destructive'
                }`}>
                  {kpi.delta > 0 ? '+' : ''}{Math.round(kpi.delta * 10) / 10}% vs previous period
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Performance & trend intelligence */}
      <InspectorPerformanceSection
        data={analytics.data}
        isLoading={analytics.isLoading}
        unavailable={analytics.unavailable}
      />

      {/* Caseload Summary */}
      <WorkboardCaseloadSummary />


      {/* Total pending */}
      {c && c.total > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          <span>Total open actions: <strong className="text-foreground">{c.total}</strong></span>
        </div>
      )}

      {/* Tabbed work sections */}
      <Tabs defaultValue="overdue" className="w-full">
        <TabsList>
          <TabsTrigger value="overdue" className="gap-1">
            Overdue
            {c && c.overdue > 0 && (
              <Badge variant="destructive" className="text-[10px] h-5 ml-1">{c.overdue}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="today" className="gap-1">
            Due Today
            {c && c.dueToday > 0 && (
              <Badge variant="default" className="text-[10px] h-5 ml-1">{c.dueToday}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="week">This Week</TabsTrigger>
          <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
        </TabsList>

        <TabsContent value="overdue" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  Overdue Actions
                </CardTitle>
                {(wb.overdue.data?.length ?? 0) > 0 && (
                  <Badge variant="destructive">{wb.overdue.data?.length} items</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {renderList(wb.overdue.data, wb.overdue.isLoading, true, 'No overdue actions — great job!')}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="today" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4 text-primary" />
                Due Today
              </CardTitle>
            </CardHeader>
            <CardContent>
              {renderList(wb.dueToday.data, wb.dueToday.isLoading, false, 'Nothing due today')}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="week" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Calendar className="h-4 w-4 text-blue-600" />
                This Week
              </CardTitle>
            </CardHeader>
            <CardContent>
              {renderList(wb.thisWeek.data, wb.thisWeek.isLoading, false, 'No actions scheduled this week')}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="upcoming" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <ArrowRight className="h-4 w-4" />
                Upcoming
              </CardTitle>
            </CardHeader>
            <CardContent>
              {renderList(wb.upcoming.data, wb.upcoming.isLoading, false, 'No upcoming actions')}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Action Execution Dialog */}
      <ActionExecutionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        action={selectedAction}
        mode={dialogMode}
        isSubmitting={wb.completeAction.isPending || wb.cancelAction.isPending || wb.rescheduleAction.isPending || wb.addNotes.isPending}
        onComplete={(outcome, notes) => {
          if (selectedAction) wb.completeAction.mutate({ id: selectedAction.id, outcome, notes }, { onSuccess: () => setDialogOpen(false) });
        }}
        onCancel={(reason) => {
          if (selectedAction) wb.cancelAction.mutate({ id: selectedAction.id, reason }, { onSuccess: () => setDialogOpen(false) });
        }}
        onReschedule={(newDueDate, newScheduledDate, notes) => {
          if (selectedAction) wb.rescheduleAction.mutate({ id: selectedAction.id, newDueDate, newScheduledDate, notes }, { onSuccess: () => setDialogOpen(false) });
        }}
        onSaveNotes={(notes) => {
          if (selectedAction) wb.addNotes.mutate({ id: selectedAction.id, notes }, { onSuccess: () => setDialogOpen(false) });
        }}
      />
    </div>
  );
};

export default InspectorDashboard;
