import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Inbox, Search, Filter, RotateCcw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ArrowDown, ArrowUp, Info, UserCheck, Eye, AlertTriangle, Clock, RefreshCw, ShieldAlert, X,
} from 'lucide-react';
import { formatDisplayDate } from '@/lib/dateFormat';
import { EmployerCombobox, MultiSelect, titleise } from '@/components/compliance/ListFilterControls';
import { AssignmentDialog } from '@/components/compliance/AssignmentDialog';
import { useHasCapability } from '@/hooks/useHasCapability';
import { COMPLIANCE_CAPABILITIES } from '@/lib/compliance/capabilities';
import {
  useCaseIntake, INTAKE_SORTS, RECOMMENDED_INTAKE_RULE, PAGE_SIZE_OPTIONS,
  WAIT_BUCKETS, OPENED_OPTIONS, AMOUNT_RANGES, type IntakeRow,
} from '@/hooks/compliance/useCaseIntake';

const MODULE = 'manage_compliance';
const ANY = '__ANY__';

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'XCD', minimumFractionDigits: 0 }).format(n || 0);

const priorityVariant = (p: string) =>
  p === 'CRITICAL' ? ('destructive' as const) : p === 'HIGH' ? ('default' as const) : ('secondary' as const);

const riskTone = (band: string) => {
  switch (band) {
    case 'CRITICAL': return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'HIGH': return 'border-warning/30 bg-warning/10 text-warning';
    case 'MEDIUM': return 'border-accent/30 bg-accent/20 text-accent-foreground';
    case 'LOW': return 'border-primary/20 bg-primary/10 text-primary';
    default: return 'text-muted-foreground';
  }
};

const waitTone = (days: number) =>
  days > 14 ? 'border-destructive/40 bg-destructive/10 text-destructive'
    : days > 7 ? 'border-warning/40 bg-warning/10 text-warning'
      : days > 3 ? 'border-warning/25 bg-warning/5 text-warning'
        : 'text-muted-foreground';

const waitLabel = (days: number) =>
  days < 1 ? 'Today' : days === 1 ? '1 day' : `${days} days`;

/** Quick filters — each is backed by real intake data, no invented thresholds. */
const QUICK_FILTERS: { key: string; label: string; patch: Record<string, unknown> }[] = [
  { key: 'all', label: 'All Intake', patch: {} },
  { key: 'crit_high', label: 'Critical / High', patch: { priorities: ['CRITICAL', 'HIGH'] } },
  { key: 'high_risk', label: 'High Risk', patch: { risk_bands: ['CRITICAL', 'HIGH'] } },
  { key: 'wait3', label: 'Waiting > 3 Days', patch: { wait: 'GT_3' } },
  { key: 'exposure', label: 'High Exposure', patch: { amount_min: '50000' } },
  { key: 'today', label: 'Opened Today', patch: { opened: 'TODAY' } },
  { key: 'incomplete', label: 'Missing Assignment Data', patch: { incomplete: true } },
];

const CaseIntake = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const q = useCaseIntake();
  const canAssign = useHasCapability(COMPLIANCE_CAPABILITIES.CASES_MANAGE);
  const [searchDraft, setSearchDraft] = useState(q.filters.search ?? '');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [assignTarget, setAssignTarget] = useState<{ id: string; number: string } | null>(null);

  useEffect(() => { setSearchDraft(q.filters.search ?? ''); }, [q.filters.search]);

  // Debounced, server-side search.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = searchDraft.trim();
      if (next !== (q.filters.search ?? '')) q.patchFilters({ search: next || undefined });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  const filtered = q.activeFilterCount > 0;
  const kpis = filtered ? q.kpisFiltered : q.kpisAll;
  const from = q.total === 0 ? 0 : (q.page - 1) * q.pageSize + 1;
  const to = Math.min(q.page * q.pageSize, q.total);

  const isQuickActive = (patch: Record<string, unknown>) => {
    const f = q.filters as Record<string, unknown>;
    const keys = Object.keys(patch);
    if (keys.length === 0) return q.activeFilterCount === 0;
    return keys.every((k) => {
      const v = patch[k];
      if (Array.isArray(v)) {
        const cur = f[k] as string[] | undefined;
        return !!cur && cur.length === v.length && v.every((x) => cur.includes(x as string));
      }
      return f[k] === v;
    });
  };

  const openCase = (row: IntakeRow) => {
    navigate(`/compliance/cases/${row.id}`, { state: { returnTo: `${location.pathname}${location.search}` } });
  };

  const openEmployer = (employerId: string | null) => {
    if (employerId) navigate(`/compliance/field/employer-360/${employerId}`);
  };

  const amountValue = q.filters.amount_min || q.filters.amount_max
    ? `${q.filters.amount_min ?? ''}-${q.filters.amount_max ?? ''}`
    : ANY;

  const activeChips: { label: string; clear: () => void }[] = [];
  if (q.filters.search) activeChips.push({ label: `Search: ${q.filters.search}`, clear: () => q.patchFilters({ search: undefined }) });
  if (q.filters.employer) activeChips.push({ label: `Employer: ${q.filters.employer}`, clear: () => q.patchFilters({ employer: undefined }) });
  (q.filters.families ?? []).forEach((v) => activeChips.push({ label: `Family: ${titleise(v)}`, clear: () => q.toggleInList('families', v) }));
  (q.filters.funds ?? []).forEach((v) => activeChips.push({ label: `Fund: ${titleise(v)}`, clear: () => q.toggleInList('funds', v) }));
  (q.filters.priorities ?? []).forEach((v) => activeChips.push({ label: `Priority: ${titleise(v)}`, clear: () => q.toggleInList('priorities', v) }));
  (q.filters.risk_bands ?? []).forEach((v) => activeChips.push({ label: `Risk: ${titleise(v)}`, clear: () => q.toggleInList('risk_bands', v) }));
  (q.filters.statuses ?? []).forEach((v) => activeChips.push({ label: `Status: ${titleise(v)}`, clear: () => q.toggleInList('statuses', v) }));
  if (q.filters.territory) activeChips.push({ label: `Zone: ${q.filters.territory}`, clear: () => q.patchFilters({ territory: undefined }) });
  if (q.filters.wait) activeChips.push({ label: `Waiting: ${WAIT_BUCKETS.find((b) => b.value === q.filters.wait)?.label ?? q.filters.wait}`, clear: () => q.patchFilters({ wait: undefined }) });
  if (q.filters.opened) activeChips.push({ label: `Opened: ${OPENED_OPTIONS.find((o) => o.value === q.filters.opened)?.label ?? q.filters.opened}`, clear: () => q.patchFilters({ opened: undefined }) });
  if (q.filters.date_from || q.filters.date_to) activeChips.push({ label: `Opened ${q.filters.date_from ?? '…'} → ${q.filters.date_to ?? '…'}`, clear: () => q.patchFilters({ date_from: undefined, date_to: undefined }) });
  if (q.filters.amount_min || q.filters.amount_max) activeChips.push({ label: `Exposure ${q.filters.amount_min ?? '0'}–${q.filters.amount_max ?? '∞'}`, clear: () => q.patchFilters({ amount_min: undefined, amount_max: undefined }) });
  if (q.filters.incomplete) activeChips.push({ label: 'Missing assignment data', clear: () => q.patchFilters({ incomplete: false }) });

  const kpiCards = [
    { label: 'Awaiting Assignment', value: String(kpis.total), icon: Inbox, tone: 'text-primary' },
    { label: 'Critical / High', value: String(kpis.critical_high), icon: AlertTriangle, tone: 'text-destructive' },
    { label: 'Waiting > 3 Days', value: String(kpis.waiting_gt_3), icon: Clock, tone: 'text-warning' },
    { label: 'Oldest Waiting', value: `${kpis.oldest_waiting}d`, icon: ShieldAlert, tone: 'text-muted-foreground' },
  ];

  return (
    <PermissionWrapper moduleName={MODULE}>
      <TooltipProvider>
        <div className="container mx-auto p-6 space-y-5">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
                <Inbox className="h-6 w-6 text-primary" />
                Case Intake
              </h1>
              <p className="text-sm text-muted-foreground">
                Triage and assign newly created compliance cases that have no owning officer.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {q.scope && <Badge variant="outline" className="text-[11px]">Scope: {titleise(q.scope)}</Badge>}
              <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${q.isFetching ? 'animate-spin' : ''}`} />Refresh
              </Button>
            </div>
          </div>

          {/* KPI strip — computed across the full authorised intake population */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {kpiCards.map((k) => (
              <Card key={k.label}>
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-xs text-muted-foreground">{k.label}</p>
                    <p className="text-2xl font-semibold tabular-nums">{k.value}</p>
                  </div>
                  <k.icon className={`h-5 w-5 ${k.tone}`} />
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="-mt-3 text-[11px] text-muted-foreground">
            {filtered ? 'Counters reflect the current filters.' : 'Counters reflect all cases awaiting assignment in your scope.'}
            {' '}Total exposure: {fmtCurrency(kpis.exposure)}. No assignment SLA is configured for compliance cases,
            so SLA state is not shown (configuration gap).
          </p>

          {/* Quick filters */}
          <div className="flex flex-wrap gap-2">
            {QUICK_FILTERS.map((qf) => (
              <Button
                key={qf.key}
                size="sm"
                variant={isQuickActive(qf.patch) ? 'default' : 'outline'}
                className="h-8 text-xs"
                onClick={() => (qf.key === 'all' ? q.resetFilters() : q.applyQuickFilter(qf.patch))}
              >
                {qf.label}
              </Button>
            ))}
          </div>

          {/* Filter toolbar */}
          <Card>
            <CardContent className="space-y-3 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[260px] flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchDraft}
                    onChange={(e) => setSearchDraft(e.target.value)}
                    placeholder="Search case, employer or registration no."
                    className="h-9 pl-8"
                  />
                </div>
                <EmployerCombobox
                  value={q.filters.employer}
                  options={q.options.employers}
                  onChange={(v) => q.patchFilters({ employer: v })}
                />
                <MultiSelect
                  label="Case Family"
                  values={q.filters.families ?? []}
                  options={q.options.families}
                  onToggle={(v) => q.toggleInList('families', v)}
                  searchable
                />
                <MultiSelect
                  label="Priority"
                  values={q.filters.priorities ?? []}
                  options={q.options.priorities}
                  onToggle={(v) => q.toggleInList('priorities', v)}
                  width="w-[160px]"
                />
                <Select
                  value={q.filters.wait ?? ANY}
                  onValueChange={(v) => q.patchFilters({ wait: v === ANY ? undefined : v })}
                >
                  <SelectTrigger className="h-9 w-[190px]"><SelectValue placeholder="Waiting time" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Any waiting time</SelectItem>
                    {WAIT_BUCKETS.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" className="h-9" onClick={() => setShowAdvanced((s) => !s)}>
                  <Filter className="mr-1.5 h-3.5 w-3.5" />Filters
                  {q.activeFilterCount > 0 && <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{q.activeFilterCount}</Badge>}
                </Button>
                <Button variant="ghost" size="sm" className="h-9" onClick={q.resetFilters} disabled={q.activeFilterCount === 0}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />Reset
                </Button>
              </div>

              {showAdvanced && (
                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  <MultiSelect
                    label="Fund" values={q.filters.funds ?? []} options={q.options.funds}
                    onToggle={(v) => q.toggleInList('funds', v)} width="w-[170px]"
                  />
                  <MultiSelect
                    label="Risk Band" values={q.filters.risk_bands ?? []} options={q.options.risk_bands}
                    onToggle={(v) => q.toggleInList('risk_bands', v)} width="w-[170px]"
                  />
                  <MultiSelect
                    label="Status" values={q.filters.statuses ?? []} options={q.options.statuses}
                    onToggle={(v) => q.toggleInList('statuses', v)} width="w-[190px]" searchable
                  />
                  <Select
                    value={q.filters.territory ?? ANY}
                    onValueChange={(v) => q.patchFilters({ territory: v === ANY ? undefined : v })}
                  >
                    <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="Zone / Territory" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>All zones</SelectItem>
                      {q.options.territories.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select
                    value={q.filters.opened ?? ANY}
                    onValueChange={(v) => q.patchFilters({ opened: v === ANY ? undefined : v })}
                  >
                    <SelectTrigger className="h-9 w-[170px]"><SelectValue placeholder="Opened date" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>Any opened date</SelectItem>
                      {OPENED_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-1">
                    <Input type="date" className="h-9 w-[150px]" value={q.filters.date_from ?? ''}
                      onChange={(e) => q.patchFilters({ date_from: e.target.value || undefined })} />
                    <span className="text-xs text-muted-foreground">to</span>
                    <Input type="date" className="h-9 w-[150px]" value={q.filters.date_to ?? ''}
                      onChange={(e) => q.patchFilters({ date_to: e.target.value || undefined })} />
                  </div>
                  <Select
                    value={amountValue}
                    onValueChange={(v) => {
                      if (v === ANY) return q.patchFilters({ amount_min: undefined, amount_max: undefined });
                      const [min, max] = v.split('-');
                      q.patchFilters({ amount_min: min || undefined, amount_max: max || undefined });
                    }}
                  >
                    <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="Exposure" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>Any exposure</SelectItem>
                      {AMOUNT_RANGES.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {activeChips.length > 0 && (
                <div className="flex flex-wrap gap-1.5 border-t pt-2">
                  {activeChips.map((c, i) => (
                    <Badge key={`${c.label}-${i}`} variant="secondary" className="gap-1 text-[11px]">
                      {c.label}
                      <button onClick={c.clear} className="ml-0.5 rounded-sm hover:text-destructive" aria-label={`Remove ${c.label}`}>
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Sort + count */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {q.isLoading ? 'Loading intake queue…'
                : q.total === 0 ? 'No cases to show'
                  : `Showing ${from}–${to} of ${q.total} ${filtered ? 'matching intake cases' : 'cases awaiting assignment'}`}
            </p>
            <div className="flex items-center gap-2">
              <Select value={q.sort} onValueChange={(v) => q.changeSort(v)}>
                <SelectTrigger className="h-9 w-[210px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INTAKE_SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {q.sort === 'recommended' ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" className="h-9 w-9"><Info className="h-3.5 w-3.5" /></Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">{RECOMMENDED_INTAKE_RULE}</TooltipContent>
                </Tooltip>
              ) : (
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={q.toggleDir} aria-label="Toggle sort direction">
                  {q.dir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                </Button>
              )}
            </div>
          </div>

          {/* Table */}
          <Card>
            <CardContent className="p-0">
              {q.isError ? (
                <div className="space-y-3 py-16 text-center">
                  <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
                  <p className="text-sm font-medium">Unable to load Case Intake. Please retry.</p>
                  <p className="text-xs text-muted-foreground">{q.error?.message}</p>
                  <Button size="sm" variant="outline" onClick={() => q.refetch()}>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Retry
                  </Button>
                </div>
              ) : q.isLoading ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : q.rows.length === 0 ? (
                <div className="space-y-3 py-16 text-center">
                  <Inbox className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">
                    {filtered ? 'No intake cases match the selected filters' : 'No cases awaiting assignment'}
                  </p>
                  {filtered && (
                    <Button size="sm" variant="outline" onClick={q.resetFilters}>
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />Clear Filters
                    </Button>
                  )}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[60px]">#</TableHead>
                      <TableHead>Case #</TableHead>
                      <TableHead>Employer</TableHead>
                      <TableHead>Case Family</TableHead>
                      <TableHead>Fund</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Risk</TableHead>
                      <TableHead className="text-right">Exposure</TableHead>
                      <TableHead>Opened</TableHead>
                      <TableHead>Waiting</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {q.rows.map((r) => (
                      <TableRow key={r.id} className={r.waiting_days > 14 ? 'border-l-2 border-l-destructive' : undefined}>
                        <TableCell className="text-xs text-muted-foreground tabular-nums">{r.rn}</TableCell>
                        <TableCell>
                          <button
                            onClick={() => openCase(r)}
                            className="font-mono text-xs font-medium text-primary hover:underline"
                          >
                            {r.case_number}
                          </button>
                          {r.data_incomplete && (
                            <div className="mt-0.5 text-[10px] text-warning">Missing assignment data</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <button
                            onClick={() => openEmployer(r.employer_id)}
                            className="text-left text-sm font-medium hover:underline"
                            disabled={!r.employer_id}
                          >
                            {r.employer_name || '—'}
                          </button>
                          <div className="font-mono text-[11px] text-muted-foreground">{r.employer_id || '—'}</div>
                        </TableCell>
                        <TableCell className="text-xs">{titleise(r.case_family)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">{titleise(r.fund_display)}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={priorityVariant(r.priority)} className="text-[10px]">{titleise(r.priority)}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[10px] ${riskTone(r.risk_band)}`}>{titleise(r.risk_band)}</Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{fmtCurrency(r.total_amount)}</TableCell>
                        <TableCell className="text-xs">{r.opened_date ? formatDisplayDate(r.opened_date) : '—'}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[10px] ${waitTone(r.waiting_days)}`}>
                            {waitLabel(r.waiting_days)}
                          </Badge>
                        </TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{titleise(r.status)}</Badge></TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => openCase(r)}>
                              <Eye className="mr-1 h-3.5 w-3.5" />Review
                            </Button>
                            {canAssign ? (
                              <Button size="sm" onClick={() => setAssignTarget({ id: r.id, number: r.case_number })}>
                                <UserCheck className="mr-1 h-3.5 w-3.5" />Assign
                              </Button>
                            ) : (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Button size="sm" disabled><UserCheck className="mr-1 h-3.5 w-3.5" />Assign</Button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="text-xs">
                                  You can review intake cases but you are not authorised to assign them.
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Pagination */}
          {q.total > 0 && !q.isError && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Rows per page</span>
                <Select value={String(q.pageSize)} onValueChange={(v) => q.setPageSize(Number(v))}>
                  <SelectTrigger className="h-8 w-[80px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => q.setPage(1)} disabled={q.page === 1}>
                  <ChevronsLeft className="h-3.5 w-3.5" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => q.setPage(q.page - 1)} disabled={q.page === 1}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="px-2 text-sm text-muted-foreground">Page {q.page} of {q.totalPages}</span>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => q.setPage(q.page + 1)} disabled={q.page >= q.totalPages}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => q.setPage(q.totalPages)} disabled={q.page >= q.totalPages}>
                  <ChevronsRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          {assignTarget && (
            <AssignmentDialog
              open={!!assignTarget}
              onOpenChange={(o) => { if (!o) setAssignTarget(null); }}
              entityType="case"
              entityId={assignTarget.id}
              currentOfficerId={null}
              currentOfficerName={null}
              onAssigned={() => {
                qc.invalidateQueries({ queryKey: ['ce-case-intake'] });
                setAssignTarget(null);
              }}
            />
          )}
        </div>
      </TooltipProvider>
    </PermissionWrapper>
  );
};

export default CaseIntake;
