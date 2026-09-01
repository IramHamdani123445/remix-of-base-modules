/**
 * Enterprise governance queue for CLOSURE / REOPEN / MERGE case requests.
 * Shared by Case Closure, Reopen Requests and Case Merge Review.
 *
 * Reading is fully server-side (`ce_case_requests_v1`): data scope, search,
 * filters, sorting, paging, status counts and KPIs are all resolved in the
 * database, so counts describe the whole authorised population.
 *
 * Deciding is transactional (`ce_case_request_precheck_v1` →
 * `ce_case_request_claim_v1` → case action → revert on failure), so a request
 * can never show as approved while the case itself was never changed.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/shared/PageHeader';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { PermissionButton } from '@/components/ui/permission-button';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Loader2, CheckCircle, XCircle, ExternalLink, AlertTriangle, RefreshCw, Search,
  ArrowUpDown, RotateCcw, Download, Clock, ShieldAlert, Info, type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { useUserCode } from '@/hooks/useUserCode';
import {
  reviewCaseRequest, precheckCaseRequest,
  type CaseRequestQueueRow, type CaseRequestPrecheck,
  type CaseRequestStatus, type CaseRequestType,
} from '@/services/caseRequestsService';
import {
  useCaseRequests, REQUEST_SORTS, REQUEST_STATUSES, RECOMMENDED_REQUEST_RULE,
  WAITING_BUCKETS, PAGE_SIZE_OPTIONS,
} from '@/hooks/compliance/useCaseRequests';
import { EmployerCombobox, MultiSelect, titleise } from '@/components/compliance/ListFilterControls';
import { isComplianceFeatureEnabled, type ComplianceFeatureKey } from '@/lib/compliance/featureToggles';

const MODULE = 'manage_compliance';

interface Props {
  title: string;
  description: string;
  icon: LucideIcon;
  type: CaseRequestType;
  featureKey: ComplianceFeatureKey;
}

const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'XCD', maximumFractionDigits: 0 })
    .format(Number(n) || 0);

const dateTime = (v?: string | null) => (v ? new Date(v).toLocaleString() : '—');

const priorityTone = (p: string) =>
  p === 'CRITICAL' ? 'bg-destructive/10 text-destructive border-destructive/30'
    : p === 'HIGH' ? 'bg-orange-500/10 text-orange-600 border-orange-500/30'
    : p === 'MEDIUM' ? 'bg-amber-500/10 text-amber-600 border-amber-500/30'
    : 'bg-muted text-muted-foreground';

const waitingTone = (bucket: string, breached: boolean) =>
  breached || bucket === '15_PLUS' ? 'text-destructive font-semibold'
    : bucket === '8_14' ? 'text-orange-600 font-medium'
    : 'text-muted-foreground';

const statusTone = (s: string) =>
  s === 'APPROVED' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
    : s === 'REJECTED' ? 'bg-destructive/10 text-destructive border-destructive/30'
    : s === 'CANCELLED' ? 'bg-muted text-muted-foreground'
    : 'bg-primary/10 text-primary border-primary/30';

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-semibold ${tone ?? ''}`}>{value}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

const CaseRequestsQueue = ({ title, description, icon: Icon, type, featureKey }: Props) => {
  const enabled = isComplianceFeatureEnabled(featureKey);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { userCode } = useUserCode();
  const q = useCaseRequests(type);

  const [searchDraft, setSearchDraft] = useState(q.filters.search ?? '');
  const [reviewing, setReviewing] = useState<CaseRequestQueueRow | null>(null);
  const [approve, setApprove] = useState(true);
  const [notes, setNotes] = useState('');
  const [precheck, setPrecheck] = useState<CaseRequestPrecheck | null>(null);
  const [precheckLoading, setPrecheckLoading] = useState(false);

  // Debounced search keeps typing responsive while the query stays server-side.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((q.filters.search ?? '') !== searchDraft) q.patchFilters({ search: searchDraft });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  // Re-validate the request at the moment the reviewer opens the decision dialog.
  useEffect(() => {
    if (!reviewing) { setPrecheck(null); return; }
    let live = true;
    setPrecheckLoading(true);
    precheckCaseRequest(reviewing.id)
      .then((p) => { if (live) setPrecheck(p); })
      .catch((e: any) => { if (live) toast.error(e.message || 'Unable to validate this request'); })
      .finally(() => { if (live) setPrecheckLoading(false); });
    return () => { live = false; };
  }, [reviewing]);

  const reviewMut = useMutation({
    mutationFn: () => reviewCaseRequest({
      id: reviewing!.id,
      approve,
      reviewedBy: userCode || 'UNKNOWN',
      notes,
    }),
    onSuccess: () => {
      toast.success(`Request ${approve ? 'approved' : 'rejected'}`);
      qc.invalidateQueries({ queryKey: ['ce-case-requests'] });
      qc.invalidateQueries({ queryKey: ['ce_case_requests'] });
      qc.invalidateQueries({ queryKey: ['ce_cases'] });
      setReviewing(null); setNotes('');
    },
    onError: (e: any) => {
      toast.error(e.message || 'Review failed');
      q.refetch();
    },
  });

  const isMerge = type === 'MERGE';
  const label = type.toLowerCase();

  const exportCsv = () => {
    const cols: (keyof CaseRequestQueueRow)[] = [
      'case_number', 'employer_id', 'employer_name', 'case_status', 'case_priority',
      'case_risk_band', 'case_total_amount', 'open_violations', 'arrangement_state',
      'target_case_number', 'reason', 'requested_by_name', 'requested_at',
      'waiting_days', 'status', 'reviewed_by_name', 'reviewed_at', 'review_notes',
    ];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...q.rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `case-${label}-requests-${q.status.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selfBlocked = Boolean(precheck?.is_self_request && !precheck?.can_approve_own);
  const decisionBlocked =
    precheckLoading || selfBlocked || precheck?.found === false ||
    precheck?.status !== 'PENDING' || (approve && precheck?.eligible === false);

  const countFor = (s: CaseRequestStatus) => q.statusCounts?.[s] ?? 0;

  const quickFilters = useMemo(() => ([
    { key: 'overdue', label: 'Past SLA', active: q.filters.waiting === '15_PLUS',
      onClick: () => q.applyQuickFilter({ waiting: q.filters.waiting === '15_PLUS' ? undefined : '15_PLUS' }) },
    { key: 'aging', label: 'Waiting 8+ days', active: q.filters.waiting === '8_14',
      onClick: () => q.applyQuickFilter({ waiting: q.filters.waiting === '8_14' ? undefined : '8_14' }) },
    { key: 'critical', label: 'Critical / High case',
      active: (q.filters.priorities ?? []).length === 2,
      onClick: () => q.applyQuickFilter({
        priorities: (q.filters.priorities ?? []).length === 2 ? [] : ['CRITICAL', 'HIGH'],
      }) },
    ...(isMerge ? [{
      key: 'cross', label: 'Different employers', active: q.filters.same_employer === 'NO',
      onClick: () => q.applyQuickFilter({ same_employer: q.filters.same_employer === 'NO' ? undefined : 'NO' }),
    }] : []),
  ]), [q, isMerge]);

  if (!enabled) {
    return (
      <PermissionWrapper moduleName={MODULE}>
        <div className="container mx-auto p-6">
          <PageHeader title={title} subtitle={description} />
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            This feature is disabled in configuration.
          </CardContent></Card>
        </div>
      </PermissionWrapper>
    );
  }

  return (
    <PermissionWrapper moduleName={MODULE}>
      <TooltipProvider>
        <div className="container mx-auto space-y-5 p-6">
          <PageHeader
            title={title}
            subtitle={description}
            actions={
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="gap-1 font-normal">
                  <Icon className="h-3 w-3" /> {q.scope ? `${titleise(q.scope)} scope` : 'Scoped view'}
                </Badge>
                <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
                  <RefreshCw className={`mr-1 h-3.5 w-3.5 ${q.isFetching ? 'animate-spin' : ''}`} /> Refresh
                </Button>
                <Button variant="outline" size="sm" onClick={exportCsv} disabled={!q.rows.length}>
                  <Download className="mr-1 h-3.5 w-3.5" /> Export page
                </Button>
              </div>
            }
          />

          {/* Governance KPIs — computed across the entire authorised population */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label="Awaiting decision" value={String(q.kpis.pending)} />
            <Kpi label="Past approval SLA" value={String(q.kpis.sla_breached)}
                 tone={q.kpis.sla_breached ? 'text-destructive' : ''}
                 hint={`${q.kpis.waiting_gt_3d} waiting over 3 days`} />
            <Kpi label="Critical / high cases" value={String(q.kpis.critical_high)} />
            <Kpi label="Exposure pending" value={money(q.kpis.exposure)} />
            <Kpi label="Oldest pending" value={`${q.kpis.oldest_pending_days} d`} />
          </div>

          <Card>
            <CardContent className="space-y-3 p-4">
              <Tabs value={q.status} onValueChange={(v) => q.setStatus(v as CaseRequestStatus)}>
                <TabsList>
                  {REQUEST_STATUSES.map((s) => (
                    <TabsTrigger key={s} value={s} className="gap-1.5">
                      {titleise(s)}
                      <span className="rounded bg-muted px-1.5 text-[11px] tabular-nums">{countFor(s)}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[240px] flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchDraft}
                    onChange={(e) => setSearchDraft(e.target.value)}
                    placeholder="Search case number, employer, reason or requester"
                    className="h-9 pl-8"
                  />
                </div>
                <EmployerCombobox
                  value={q.filters.employer}
                  options={q.options.employers}
                  onChange={(v) => q.patchFilters({ employer: v })}
                />
                <MultiSelect label="Case priority" values={q.filters.priorities ?? []}
                  options={q.options.priorities} onToggle={(v) => q.toggleInList('priorities', v)} />
                <MultiSelect label="Risk band" values={q.filters.risk_bands ?? []}
                  options={q.options.risk_bands} onToggle={(v) => q.toggleInList('risk_bands', v)} />
                <MultiSelect label="Case status" values={q.filters.case_statuses ?? []}
                  options={q.options.case_statuses} onToggle={(v) => q.toggleInList('case_statuses', v)} searchable />
                <Select
                  value={q.filters.waiting ?? 'all'}
                  onValueChange={(v) => q.patchFilters({ waiting: v === 'all' ? undefined : v })}
                >
                  <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="Waiting time" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any waiting time</SelectItem>
                    {WAITING_BUCKETS.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select
                  value={q.filters.requested_by ?? 'all'}
                  onValueChange={(v) => q.patchFilters({ requested_by: v === 'all' ? undefined : v })}
                >
                  <SelectTrigger className="h-9 w-[190px]"><SelectValue placeholder="Requested by" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any requester</SelectItem>
                    {q.options.requesters.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {q.status !== 'PENDING' && (
                  <Select
                    value={q.filters.reviewed_by ?? 'all'}
                    onValueChange={(v) => q.patchFilters({ reviewed_by: v === 'all' ? undefined : v })}
                  >
                    <SelectTrigger className="h-9 w-[190px]"><SelectValue placeholder="Decided by" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any reviewer</SelectItem>
                      {q.options.reviewers.map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Input type="date" className="h-9 w-[150px]" value={q.filters.date_from ?? ''}
                  onChange={(e) => q.patchFilters({ date_from: e.target.value || undefined })} />
                <Input type="date" className="h-9 w-[150px]" value={q.filters.date_to ?? ''}
                  onChange={(e) => q.patchFilters({ date_to: e.target.value || undefined })} />
                {q.activeFilterCount > 0 && (
                  <Button variant="ghost" size="sm" className="h-9" onClick={() => { setSearchDraft(''); q.resetFilters(); }}>
                    <RotateCcw className="mr-1 h-3.5 w-3.5" /> Clear ({q.activeFilterCount})
                  </Button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {quickFilters.map((f) => (
                  <Button key={f.key} size="sm" variant={f.active ? 'default' : 'outline'}
                          className="h-8" onClick={f.onClick}>
                    {f.label}
                  </Button>
                ))}
                <Separator orientation="vertical" className="mx-1 h-6" />
                <Select value={q.sort} onValueChange={(v) => q.changeSort(v)}>
                  <SelectTrigger className="h-8 w-[220px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REQUEST_SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" className="h-8" onClick={q.toggleDir}>
                  <ArrowUpDown className="mr-1 h-3.5 w-3.5" />{q.dir === 'asc' ? 'Ascending' : 'Descending'}
                </Button>
                {q.sort === 'recommended' && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-sm">{RECOMMENDED_REQUEST_RULE}</TooltipContent>
                  </Tooltip>
                )}
                <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{q.total} request{q.total === 1 ? '' : 's'}</span>
                  <Select value={String(q.pageSize)} onValueChange={(v) => q.setPageSize(Number(v))}>
                    <SelectTrigger className="h-8 w-[90px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              {q.isLoading ? (
                <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
              ) : q.isError ? (
                <div className="space-y-3 p-8 text-center">
                  <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
                  <div className="font-medium">This queue could not be loaded</div>
                  <div className="text-sm text-muted-foreground">{q.error?.message}</div>
                  <Button variant="outline" size="sm" onClick={() => q.refetch()}>Try again</Button>
                </div>
              ) : q.rows.length === 0 ? (
                <div className="space-y-2 py-16 text-center">
                  <div className="font-medium">
                    No {q.status.toLowerCase()} {label} requests{q.activeFilterCount ? ' match these filters' : ''}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {q.activeFilterCount
                      ? 'Clear the filters to see the full authorised queue.'
                      : `${titleise(label)} requests are raised from a case record and appear here for approval.`}
                  </div>
                  {q.activeFilterCount > 0 && (
                    <Button variant="outline" size="sm" onClick={() => { setSearchDraft(''); q.resetFilters(); }}>
                      Clear filters
                    </Button>
                  )}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Case</TableHead>
                      <TableHead>Employer</TableHead>
                      {isMerge && <TableHead>Surviving case</TableHead>}
                      <TableHead>Case context</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Requested</TableHead>
                      {q.status !== 'PENDING' && <TableHead>Decision</TableHead>}
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {q.rows.map((r) => (
                      <TableRow key={r.id} className={r.sla_breached && r.status === 'PENDING' ? 'bg-destructive/5' : ''}>
                        <TableCell className="align-top">
                          <button
                            className="font-mono text-xs font-medium text-primary hover:underline"
                            onClick={() => navigate(`/compliance/cases/${r.case_id}`)}
                          >
                            {r.case_number}
                          </button>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <Badge variant="outline" className={`text-[10px] ${priorityTone(r.case_priority)}`}>
                              {titleise(r.case_priority)}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">{titleise(r.case_status)}</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="text-sm">{r.employer_name || '—'}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">{r.employer_id}</div>
                        </TableCell>
                        {isMerge && (
                          <TableCell className="align-top text-xs">
                            {r.target_case_number ? (
                              <>
                                <button
                                  className="font-mono text-primary hover:underline"
                                  onClick={() => r.target_case_id && navigate(`/compliance/cases/${r.target_case_id}`)}
                                >
                                  {r.target_case_number}
                                </button>
                                <div className="text-muted-foreground">{r.target_employer_name}</div>
                                {r.same_employer === false && (
                                  <Badge variant="outline" className="mt-1 border-orange-500/30 bg-orange-500/10 text-[10px] text-orange-600">
                                    Different employer
                                  </Badge>
                                )}
                              </>
                            ) : (
                              <span className="text-destructive">No target recorded</span>
                            )}
                          </TableCell>
                        )}
                        <TableCell className="align-top text-xs text-muted-foreground">
                          <div>{money(r.case_total_amount)} exposure</div>
                          <div>{r.open_violations} open violation{r.open_violations === 1 ? '' : 's'}</div>
                          {r.arrangement_state && r.arrangement_state !== 'NONE' && (
                            <div>{titleise(r.arrangement_state)} arrangement</div>
                          )}
                          {r.legal_case_id && <div className="text-orange-600">Legal linked</div>}
                          {r.reopened_count > 0 && <div>Reopened {r.reopened_count}×</div>}
                        </TableCell>
                        <TableCell className="max-w-xs align-top">
                          <span className="line-clamp-3 text-sm">{r.reason}</span>
                        </TableCell>
                        <TableCell className="align-top text-xs">
                          <div>{r.requested_by_name || r.requested_by}</div>
                          <div className="text-muted-foreground">{dateTime(r.requested_at)}</div>
                          {r.status === 'PENDING' && (
                            <div className={`mt-0.5 flex items-center gap-1 ${waitingTone(r.waiting_bucket, r.sla_breached)}`}>
                              <Clock className="h-3 w-3" />
                              {r.waiting_days < 1 ? `${Math.round(r.waiting_hours)}h` : `${Math.round(r.waiting_days)}d`} waiting
                              {r.sla_breached && ' · past SLA'}
                            </div>
                          )}
                        </TableCell>
                        {q.status !== 'PENDING' && (
                          <TableCell className="align-top text-xs">
                            <Badge variant="outline" className={`text-[10px] ${statusTone(r.status)}`}>
                              {titleise(r.status)}
                            </Badge>
                            <div className="mt-1">{r.reviewed_by_name || r.reviewed_by || '—'}</div>
                            <div className="text-muted-foreground">{dateTime(r.reviewed_at)}</div>
                            {r.review_notes && <div className="mt-1 line-clamp-2 italic">{r.review_notes}</div>}
                          </TableCell>
                        )}
                        <TableCell className="space-x-1 whitespace-nowrap text-right align-top">
                          <Button size="sm" variant="ghost" onClick={() => navigate(`/compliance/cases/${r.case_id}`)}>
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                          {r.status === 'PENDING' && (
                            <>
                              <PermissionButton moduleName={MODULE} actionName="edit" size="sm" variant="outline"
                                onClick={() => { setReviewing(r); setApprove(true); setNotes(''); }}>
                                <CheckCircle className="mr-1 h-3 w-3" /> Approve
                              </PermissionButton>
                              <PermissionButton moduleName={MODULE} actionName="edit" size="sm" variant="destructive"
                                onClick={() => { setReviewing(r); setApprove(false); setNotes(''); }}>
                                <XCircle className="mr-1 h-3 w-3" /> Reject
                              </PermissionButton>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {q.total > 0 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Showing {(q.page - 1) * q.pageSize + 1}–{Math.min(q.page * q.pageSize, q.total)} of {q.total}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={q.page <= 1} onClick={() => q.setPage(q.page - 1)}>
                  Previous
                </Button>
                <span>Page {q.page} of {q.totalPages}</span>
                <Button variant="outline" size="sm" disabled={q.page >= q.totalPages} onClick={() => q.setPage(q.page + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}

          {/* Decision dialog — revalidated server-side before anything is recorded */}
          <Dialog open={!!reviewing} onOpenChange={(o) => !o && setReviewing(null)}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{approve ? 'Approve' : 'Reject'} {label} request</DialogTitle>
                <DialogDescription>
                  Case {reviewing?.case_number} — {reviewing?.employer_name}
                </DialogDescription>
              </DialogHeader>

              {precheckLoading ? (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Validating the request against the live case…
                </div>
              ) : (
                <div className="space-y-3">
                  {selfBlocked && (
                    <Alert variant="destructive">
                      <ShieldAlert className="h-4 w-4" />
                      <AlertTitle>Segregation of duties</AlertTitle>
                      <AlertDescription>
                        You submitted this request, so it must be decided by another reviewer.
                      </AlertDescription>
                    </Alert>
                  )}
                  {precheck?.status && precheck.status !== 'PENDING' && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Already decided</AlertTitle>
                      <AlertDescription>
                        This request was {precheck.status.toLowerCase()} by another reviewer. Refresh the queue.
                      </AlertDescription>
                    </Alert>
                  )}
                  {approve && (precheck?.blockers?.length ?? 0) > 0 && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Approval blocked</AlertTitle>
                      <AlertDescription>
                        <ul className="list-disc pl-4">
                          {precheck!.blockers.map((b) => <li key={b}>{b}</li>)}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}
                  {approve && (precheck?.warnings?.length ?? 0) > 0 && (
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertTitle>Please confirm before approving</AlertTitle>
                      <AlertDescription>
                        <ul className="list-disc pl-4">
                          {precheck!.warnings.map((w) => <li key={w}>{w}</li>)}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}
                  {isMerge && precheck?.target && (
                    <div className="rounded border p-3 text-sm">
                      <div className="text-xs uppercase text-muted-foreground">Surviving case</div>
                      <div className="font-mono">{precheck.target.case_number}</div>
                      <div className="text-muted-foreground">
                        {precheck.target.employer_name} · {titleise(precheck.target.status)} · {money(precheck.target.total_amount)}
                      </div>
                    </div>
                  )}
                  <div>
                    <div className="mb-1 text-sm text-muted-foreground">Original reason</div>
                    <div className="rounded bg-muted p-3 text-sm">{reviewing?.reason}</div>
                  </div>
                  <Textarea
                    rows={3}
                    placeholder="Review notes (required — recorded permanently against the case)"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setReviewing(null)}>Cancel</Button>
                <PermissionButton
                  moduleName={MODULE}
                  actionName="edit"
                  variant={approve ? 'default' : 'destructive'}
                  disabled={!notes.trim() || reviewMut.isPending || decisionBlocked}
                  onClick={() => reviewMut.mutate()}
                >
                  {reviewMut.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                  Confirm {approve ? 'approval' : 'rejection'}
                </PermissionButton>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </TooltipProvider>
    </PermissionWrapper>
  );
};

export default CaseRequestsQueue;
