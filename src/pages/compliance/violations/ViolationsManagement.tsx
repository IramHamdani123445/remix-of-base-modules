import { useState, useCallback, useMemo } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { PageHeader } from '@/components/shared/PageHeader';
import { ComplianceHelpButton } from '@/components/help/ComplianceHelpButton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Eye, Plus, Filter, Loader2, Merge, Split, ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchViolationsPaginated, fetchViolationSummaryCounts } from '@/services/complianceDataService';
import { BulkViolationActions } from '@/components/compliance/BulkViolationActions';
import { ViolationMergeDialog } from '@/components/compliance/ViolationMergeDialog';
import { ViolationSplitDialog } from '@/components/compliance/ViolationSplitDialog';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { PermissionButton } from '@/components/ui/permission-button';
import { ViolationFiltersBar, emptyViolationFilterState } from '@/components/compliance/ViolationFiltersBar';
import { useRegnoParam } from '@/hooks/useRegnoParam';
import { EmployerLinkChip, RegnoFilterBanner } from '@/components/compliance/EmployerLinkChip';
import { RunDetectionNowButton } from '@/components/compliance/violations/RunDetectionNowButton';


const PAGE_SIZE = 50;
const MODULE = 'manage_compliance';

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-primary/10 text-primary',
  UNDER_REVIEW: 'bg-warning/10 text-warning',
  IN_PROGRESS: 'bg-accent/10 text-accent-foreground',
  ESCALATED: 'bg-destructive/10 text-destructive',
  RESOLVED: 'bg-green-100 text-green-800',
  CLOSED: 'bg-muted text-muted-foreground',
  CANCELLED: 'bg-muted text-muted-foreground',
};

const PRIORITY_COLORS: Record<string, string> = {
  Critical: 'bg-destructive/10 text-destructive',
  High: 'bg-orange-100 text-orange-800',
  Medium: 'bg-warning/10 text-warning',
  Low: 'bg-muted text-muted-foreground',
};

const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'XCD', minimumFractionDigits: 2 });

export function resolveViolationTotal(v: any): number {
  if (v == null) return 0;
  if (v.total_amount != null && !Number.isNaN(Number(v.total_amount))) {
    const t = Number(v.total_amount);
    if (t !== 0) return t;
  }
  const p = Number(v.principal_amount ?? 0) || 0;
  const pen = Number(v.penalty_amount ?? 0) || 0;
  const i = Number(v.interest_amount ?? 0) || 0;
  const sum = p + pen + i;
  if (sum !== 0) return sum;
  return Number(v.total_amount ?? 0) || 0;
}

function ViolationsManagementInner() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { regno } = useRegnoParam();
  // Issue #7 — All Violations must show auto-generated rows by default. The
  // previous implementation defaulted to the current month, which hid older
  // DETECTION_RULE rows. Leave month empty; user can still filter by period.
  const [filters, setFilters] = useState({ ...emptyViolationFilterState });
  const debouncedSearch = useDebounce(filters.search, 400);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [splitTarget, setSplitTarget] = useState<any>(null);

  /*
   * The employer scope (regno) MUST be part of the server query. It used to be
   * applied client-side to the current page only, so on a large violation set
   * page 1 rarely contained the employer's rows and freshly auto-generated
   * violations looked missing from All Violations.
   */
  const filterParams = useMemo(() => ({
    status: filters.status,
    priority: filters.priority,
    fund: filters.fund,
    violationTypeId: filters.violationTypeId,
    severity: filters.severity,
    source: filters.source,
    assignedOfficer: filters.assignedOfficer,
    search: debouncedSearch || undefined,
    month: filters.month || undefined,
    employerId: regno || undefined,
  }), [filters.status, filters.priority, filters.fund, filters.violationTypeId, filters.severity, filters.source, filters.assignedOfficer, filters.month, debouncedSearch, regno]);

  const filterKey = JSON.stringify(filterParams);

  const { data: pageData, isLoading } = useQuery({
    queryKey: ['ce_violations_page', filterKey, page],
    queryFn: () => fetchViolationsPaginated({ ...filterParams, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  const { data: counts } = useQuery({
    queryKey: ['ce_violations_counts', filterKey],
    queryFn: () => fetchViolationSummaryCounts(filterParams),
    staleTime: 30_000,
  });

  const violations = pageData?.rows ?? [];
  // Money for the visible page comes from the shared compliance read layer.
  const { data: rowFinancials = {} } = useQuery({
    queryKey: ['ce_violation_financials_map', violations.map((v: any) => v.id).join(',')],
    queryFn: () => fetchViolationFinancialsMap(violations.map((v: any) => v.id)),
    enabled: violations.length > 0,
  });


  const totalCount = pageData?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const handleFiltersChange = useCallback((next: typeof filters) => {
    setFilters(next);
    setPage(1);
    setSelectedIds([]);
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds(prev => prev.length === violations.length ? [] : violations.map((v: any) => v.id));
  }, [violations]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <PageHeader
        title="Violations Management"
        subtitle="View and manage all compliance violations"
        breadcrumbs={[
          { label: 'Compliance', href: '/compliance' },
          { label: 'Violations Management' }
        ]}
        actions={
          <div className="flex items-center gap-2">
            <RunDetectionNowButton employerId={regno} />
            <ComplianceHelpButton screenKey="violations" />
          </div>
        }

      />


      <RegnoFilterBanner />

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Violations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{counts?.total ?? totalCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Open</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{counts?.OPEN ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Under Review</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{counts?.UNDER_REVIEW ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Escalated</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{counts?.ESCALATED ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ViolationFiltersBar value={filters} onChange={handleFiltersChange} showSource />
        </CardContent>
      </Card>

      {/* Bulk Actions Bar */}
      <BulkViolationActions
        selectedIds={selectedIds}
        violations={violations}
        onComplete={() => queryClient.invalidateQueries({ queryKey: ['ce_violations_page'] })}
        onClearSelection={() => setSelectedIds([])}
      />

      {/* Violations Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>
            Violations ({totalCount})
            {isLoading && <Loader2 className="inline-block ml-2 h-4 w-4 animate-spin" />}
          </CardTitle>
          <div className="flex gap-2">
            {selectedIds.length >= 2 && (
              <Button size="sm" variant="outline" onClick={() => setMergeDialogOpen(true)}>
                <Merge className="mr-1 h-4 w-4" /> Merge ({selectedIds.length})
              </Button>
            )}
            <Button size="sm" onClick={() => navigate('/compliance/violations/manual-entry')}>
              <Plus className="mr-2 h-4 w-4" /> Create Manual Violation
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={violations.length > 0 && selectedIds.length === violations.length}
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
                  <TableHead className="min-w-[150px]">Violation #</TableHead>
                  <TableHead className="min-w-[200px]">Employer</TableHead>
                  <TableHead className="min-w-[150px]">Type</TableHead>
                  <TableHead className="min-w-[110px]">Status</TableHead>
                  <TableHead className="min-w-[90px]">Priority</TableHead>
                  <TableHead className="min-w-[90px]">Period</TableHead>
                  <TableHead className="min-w-[110px] text-right">Gross</TableHead>
                  <TableHead className="min-w-[110px] text-right">Outstanding</TableHead>
                  <TableHead className="min-w-[100px]">Zone</TableHead>
                  <TableHead className="min-w-[130px]">Assigned To</TableHead>
                  <TableHead className="min-w-[110px]">Discovered</TableHead>
                  <TableHead className="min-w-[80px] sticky right-0 bg-background">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {violations.length === 0 && !isLoading ? (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center text-muted-foreground py-8">
                      No violations found
                    </TableCell>
                  </TableRow>
                ) : (
                  violations.map((v: any) => (
                    <TableRow key={v.id} className={selectedIds.includes(v.id) ? 'bg-primary/5' : ''}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.includes(v.id)}
                          onCheckedChange={() => toggleSelect(v.id)}
                        />
                      </TableCell>
                      <TableCell className="font-medium font-mono text-xs">{v.violation_number}</TableCell>
                      <TableCell>
                        <EmployerLinkChip regno={v.employer_id} name={v.employer_name ?? 'Unknown'} />
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{v.ce_violation_types?.name ?? '-'}</div>
                        <div className="text-xs text-muted-foreground">{v.ce_violation_types?.category}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_COLORS[v.status] ?? 'bg-muted text-muted-foreground'}>
                          {v.status?.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={PRIORITY_COLORS[v.priority] ?? 'bg-muted text-muted-foreground'}>
                          {v.priority}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{v.period_from ?? '-'}</TableCell>
                      <TableCell className="text-right">
                        {currencyFormatter.format(rowFinancials[v.id]?.gross ?? resolveViolationTotal(v))}
                      </TableCell>
                      <TableCell className="font-medium text-right">
                        {currencyFormatter.format(rowFinancials[v.id]?.outstanding ?? resolveViolationTotal(v))}
                      </TableCell>
                      <TableCell>
                        <div className="text-xs">
                          {v.ce_zones?.zone_code || <span className="text-muted-foreground">—</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        {v.assigned_to_name ? (
                          <div>
                            <div className="text-sm">{v.assigned_to_name}</div>
                            {v.ce_assignment_queues?.queue_code && (
                              <div className="text-xs text-muted-foreground">{v.ce_assignment_queues.queue_code}</div>
                            )}
                          </div>
                        ) : v.ce_assignment_queues?.queue_code ? (
                          <Badge variant="outline" className="text-xs">{v.ce_assignment_queues.queue_code}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {v.discovered_date ? new Date(v.discovered_date).toLocaleDateString() : '-'}
                      </TableCell>
                      <TableCell className="sticky right-0 bg-background">
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => navigate(`/compliance/violations/${v.id}`)}
                            title="View Details"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => { setSplitTarget(v); setSplitDialogOpen(true); }}
                            title="Split Violation"
                          >
                            <Split className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t">
              <div className="text-sm text-muted-foreground">
                Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, totalCount)} of {totalCount}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                </Button>
                <span className="text-sm font-medium px-2">
                  Page {page} of {totalPages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                >
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Merge Dialog */}
      {mergeDialogOpen && selectedIds.length >= 2 && (
        <ViolationMergeDialog
          open={mergeDialogOpen}
          onOpenChange={setMergeDialogOpen}
          violations={violations.filter((v: any) => selectedIds.includes(v.id)).map((v: any) => ({
            id: v.id, violation_number: v.violation_number, status: v.status,
            period_from: v.period_from, total_amount: v.total_amount,
          }))}
          onSuccess={() => { setSelectedIds([]); queryClient.invalidateQueries({ queryKey: ['ce_violations_page'] }); }}
        />
      )}

      {/* Split Dialog */}
      {splitDialogOpen && splitTarget && (
        <ViolationSplitDialog
          open={splitDialogOpen}
          onOpenChange={setSplitDialogOpen}
          violation={splitTarget}
          onSuccess={() => { setSplitTarget(null); queryClient.invalidateQueries({ queryKey: ['ce_violations_page'] }); }}
        />
      )}
    </div>
  );
}

export default function ViolationsManagement() {
  return (
    <PermissionWrapper moduleName={MODULE}>
      <ViolationsManagementInner />
    </PermissionWrapper>
  );
}
