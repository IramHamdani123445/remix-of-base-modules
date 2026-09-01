import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Eye, Edit, ClipboardList, ShieldAlert, Send, History, FileEdit, FileText, Copy, Download } from 'lucide-react';
import { AnnualPlanForm } from '@/components/audit/AnnualPlanForm';
import { PageShell, StandardSearchFilterBar, DataTable, StatusBadge, ConfirmDialog } from '@/components/common';
import { StandardModal } from '@/components/common/StandardModal';
import type { DataTableColumn, StandardFilterField } from '@/components/common';
import { formatDateForDisplay } from '@/lib/format-config';
import { useIAAnnualPlans, useIAAnnualPlanMutations } from '@/hooks/useAuditData';
import { ConflictAlertPanel } from '@/components/audit/ConflictAlertPanel';
import { PlanVersionHistory } from '@/components/audit/PlanVersionHistory';
import { ApprovalHistoryPanel } from '@/components/audit/ApprovalHistoryPanel';
import { PlanRevisionDialog } from '@/components/audit/PlanRevisionDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getSubmitEligibility, getEditEligibility, getReviseEligibility, getApproveEligibility, useAuditAnnualPlanPermissionContext } from '@/hooks/useAuditPlanWorkflowAccess';
import { useAuditAnnualPlanReadinessMap, useSubmitAnnualPlanWorkflow } from '@/hooks/useAuditAnnualPlanFlow';

export default function AuditPlansNew() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({ status: 'all', fiscalYear: 'all', boardPack: 'all' });
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [submitPlanId, setSubmitPlanId] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [conflictResult, setConflictResult] = useState<any>(null);
  const [revisionPlan, setRevisionPlan] = useState<any>(null);

  const { data: plans = [], isLoading } = useIAAnnualPlans();
  const { create, update } = useIAAnnualPlanMutations();
  const permissionContext = useAuditAnnualPlanPermissionContext();
  const submitPlan = useSubmitAnnualPlanWorkflow();

  // Get all fiscal years for filter
  const fiscalYears = useMemo(() => {
    const years = (plans || []).map((p: any) => p.fiscal_year).filter(Boolean);
    return [...new Set(years)].sort().reverse();
  }, [plans]);

  const enrichedPlans = useMemo(() => {
    return (plans || []).map((plan: any) => ({
      ...plan,
      _status: plan.status || 'Draft',
      _boardPackStatus: plan.board_pack_status || 'None',
    }));
  }, [plans]);

  const { readinessMap } = useAuditAnnualPlanReadinessMap(enrichedPlans);

  const filteredPlans = useMemo(() => {
    const search = searchTerm.toLowerCase().trim();
    return enrichedPlans.filter((plan: any) => {
      const matchesSearch = !search || [plan.title, plan.fiscal_year, plan.approved_by, plan.plan_owner]
        .filter(Boolean)
        .some((value: string) => value.toLowerCase().includes(search));
      const matchesStatus = filters.status === 'all' || plan._status === filters.status;
      const matchesFY = filters.fiscalYear === 'all' || plan.fiscal_year === filters.fiscalYear;
      const matchesBP = filters.boardPack === 'all' || plan._boardPackStatus === filters.boardPack;
      return matchesSearch && matchesStatus && matchesFY && matchesBP;
    });
  }, [enrichedPlans, searchTerm, filters]);

  const metrics = useMemo(() => ({
    total: enrichedPlans.length,
    approved: enrichedPlans.filter((p: any) => p._status === 'Approved').length,
    drafts: enrichedPlans.filter((p: any) => ['Draft', 'Submitted', 'Under Review', 'Amendment Pending', 'Rejected'].includes(p._status)).length,
    boardPacks: enrichedPlans.filter((p: any) => p._boardPackStatus !== 'None').length,
  }), [enrichedPlans]);

  const columns: DataTableColumn<any>[] = [
    { key: 'title', header: 'Plan Title', render: (row) => <span className="font-medium">{row.title}</span> },
    { key: 'fiscal_year', header: 'Fiscal Year' },
    { key: 'current_version_number', header: 'Version', render: (row) => <span className="text-xs bg-muted px-1.5 py-0.5 rounded">v{row.current_version_number || 1}</span> },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row._status} /> },
    { key: 'board_pack_status', header: 'Board Pack', render: (row) => <StatusBadge status={row._boardPackStatus} /> },
    { key: 'plan_owner', header: 'Plan Owner', render: (row) => row.plan_owner || '—' },
    { key: 'approved_by', header: 'Approved By', render: (row) => row.approved_by || '—' },
    { key: 'approved_date', header: 'Approved Date', render: (row) => row.approved_date ? formatDateForDisplay(row.approved_date) : '—' },
    { key: 'updated_at', header: 'Last Updated', render: (row) => row.updated_at ? formatDateForDisplay(row.updated_at) : '—' },
  ];

  const filterFields: StandardFilterField[] = [
    {
      key: 'status', label: 'Status', type: 'select', options: [
        { value: 'all', label: 'All Statuses' },
        { value: 'Draft', label: 'Draft' },
        { value: 'Submitted', label: 'Submitted' },
        { value: 'Under Review', label: 'Under Review' },
        { value: 'Approved', label: 'Approved' },
        { value: 'Superseded', label: 'Superseded' },
        { value: 'Amendment Pending', label: 'Amendment Pending' },
        { value: 'Archived', label: 'Archived' },
        { value: 'Rejected', label: 'Rejected' },
      ]
    },
    {
      key: 'fiscalYear', label: 'Fiscal Year', type: 'select',
      options: [{ value: 'all', label: 'All Years' }, ...fiscalYears.map(y => ({ value: y, label: y }))],
    },
    {
      key: 'boardPack', label: 'Board Pack', type: 'select', options: [
        { value: 'all', label: 'All' },
        { value: 'None', label: 'None' },
        { value: 'Generated', label: 'Generated' },
        { value: 'Final', label: 'Final' },
      ]
    },
  ];

  return (
    <PageShell
      title="Annual Audit Plans"
      subtitle="Board-ready annual audit plan portfolio"
      breadcrumbs={[{ label: 'Internal Audit' }, { label: 'Annual Plans' }]}
      isLoading={isLoading}
      actions={
        permissionContext.canManagePlans ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button onClick={() => setIsCreateOpen(true)} disabled={permissionContext.isLoading}>
                    <Plus className="mr-2 h-4 w-4" />Create Annual Plan
                  </Button>
                </span>
              </TooltipTrigger>
            </Tooltip>
          </TooltipProvider>
        ) : null
      }

    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={ClipboardList} label="Total Plans" value={metrics.total} />
        <SummaryCard icon={ClipboardList} label="Approved This Year" value={metrics.approved} />
        <SummaryCard icon={ShieldAlert} label="Drafts / Pending" value={metrics.drafts} />
        <SummaryCard icon={FileText} label="Board Packs" value={metrics.boardPacks} />
      </div>

      {conflictResult && conflictResult.total_conflicts > 0 && (
        <ConflictAlertPanel conflicts={conflictResult.conflicts} onDismiss={() => setConflictResult(null)} />
      )}

      <Card>
        <CardContent className="p-4">
          <StandardSearchFilterBar
            searchValue={searchTerm}
            onSearchChange={setSearchTerm}
            searchPlaceholder="Search by title, fiscal year, owner, or approver..."
            filters={filterFields}
            filterValues={filters}
            onFilterChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
            onReset={() => setFilters({ status: 'all', fiscalYear: 'all', boardPack: 'all' })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={filteredPlans}
            emptyMessage="No annual audit plans found."
            renderActions={(row) => {
              const readiness = readinessMap[row.id];
              const submitEl = getSubmitEligibility(permissionContext.hasPermission, row._status, readiness);
              const editEl = getEditEligibility(permissionContext.hasPermission, row._status);
              const reviseEl = getReviseEligibility(permissionContext.hasPermission, row._status);
              const approveEl = getApproveEligibility(permissionContext.hasPermission, row._status);

              return (
                <div className="flex items-center justify-end gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedPlanId(row.id === selectedPlanId ? null : row.id)} title="History">
                    <History className={`h-4 w-4 ${row.id === selectedPlanId ? 'text-primary' : ''}`} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(`/audit/audit-plans/${row.id}`)} title="View Workspace">
                    <Eye className="h-4 w-4" />
                  </Button>

                  {/* Edit button */}
                  {editEl.visible && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => editEl.enabled ? navigate(`/audit/audit-plans/${row.id}`) : undefined} title="Edit in plan workspace" disabled={!editEl.enabled}>
                              <Edit className="h-4 w-4" />
                            </Button>
                          </span>
                        </TooltipTrigger>
                        {!editEl.enabled && editEl.reason && (
                          <TooltipContent side="left" className="max-w-[250px]">
                            <p className="text-xs">{editEl.reason}</p>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                  )}

                  {/* Revise button (for Approved plans) */}
                  {reviseEl.visible && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-warning" onClick={() => setRevisionPlan(row)} title="Revise Plan">
                      <FileEdit className="h-4 w-4" />
                    </Button>
                  )}

                  {/* Submit button — always visible, disabled with tooltip when not eligible */}
                  {submitEl.visible && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-2"
                              onClick={() => submitEl.enabled ? setSubmitPlanId(row.id) : undefined}
                              disabled={!submitEl.enabled}
                              type="button"
                            >
                              <Send className="mr-1 h-4 w-4" />
                              Submit
                            </Button>
                          </span>
                        </TooltipTrigger>
                        {!submitEl.enabled && submitEl.reason && (
                          <TooltipContent side="left" className="max-w-[250px]">
                            <p className="text-xs">{submitEl.reason}</p>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                  )}

                  {/* Approve shortcut for approvers on pending plans */}
                  {approveEl.visible && approveEl.enabled && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-2 text-green-700 border-green-300"
                      onClick={() => navigate(`/audit/plan-approval`)}
                      title="Go to Approval screen"
                      type="button"
                    >
                      Review
                    </Button>
                  )}
                </div>
              );
            }}
          />
        </CardContent>
      </Card>

      {selectedPlanId && (
        <Tabs defaultValue="versions" className="w-full">
          <TabsList>
            <TabsTrigger value="versions">Version History</TabsTrigger>
            <TabsTrigger value="approvals">Approval History</TabsTrigger>
          </TabsList>
          <TabsContent value="versions"><PlanVersionHistory planId={selectedPlanId} /></TabsContent>
          <TabsContent value="approvals"><ApprovalHistoryPanel entityId={selectedPlanId} entityType="plan" /></TabsContent>
        </Tabs>
      )}

      <StandardModal open={isCreateOpen} onOpenChange={setIsCreateOpen} title="Create Annual Audit Plan" mode="create" size="4xl">
        <AnnualPlanForm onClose={() => setIsCreateOpen(false)} onCreate={(data) => create.mutateAsync(data)} onUpdate={(data) => update.mutateAsync(data)} />
      </StandardModal>


      <ConfirmDialog
        open={submitPlanId !== null}
        onOpenChange={() => setSubmitPlanId(null)}
        title="Submit Plan for Approval"
        description="This will run team availability checks and submit the annual plan through the approval workflow."
        onConfirm={() => {
          if (!submitPlanId) return;
          const plan = enrichedPlans.find((candidate: any) => candidate.id === submitPlanId);
          submitPlan.mutate(
            { planId: submitPlanId, plan },
            {
              onSuccess: () => {
                setSubmitPlanId(null);
                setConflictResult(null);
              },
            },
          );
        }}
      />

      <PlanRevisionDialog open={!!revisionPlan} onOpenChange={(open) => !open && setRevisionPlan(null)} plan={revisionPlan} />
    </PageShell>
  );
}

function SummaryCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 pt-6">
        <div className="rounded-lg bg-primary/10 p-3 text-primary"><Icon className="h-5 w-5" /></div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold text-foreground">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
