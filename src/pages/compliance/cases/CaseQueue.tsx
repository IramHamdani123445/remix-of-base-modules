import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ListChecks, Clock, Building2, AlertTriangle, Loader2, Inbox, Search, Filter, RotateCcw,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ArrowDown, ArrowUp, Info, UserX,
  CalendarClock, RefreshCw, Scale,
} from 'lucide-react';
import { formatDisplayDate } from '@/lib/dateFormat';
import { EmployerCombobox, MultiSelect, titleise } from '@/components/compliance/ListFilterControls';
import {
  useCaseQueue, QUEUE_SORTS, RECOMMENDED_SORT_RULE, PAGE_SIZE_OPTIONS,
  AGE_BUCKETS, DUE_OPTIONS, AMOUNT_RANGES, ARRANGEMENT_OPTIONS,
  type QueueRow, type DueStatus,
} from '@/hooks/compliance/useCaseQueue';

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

const dueLabel: Record<DueStatus, string> = {
  OVERDUE: 'Overdue',
  DUE_TODAY: 'Due today',
  DUE_1_3: 'Due in 1–3 days',
  DUE_4_7: 'Due in 4–7 days',
  DUE_LATER: 'Due later',
  NO_TARGET: 'No target date',
};

const dueTone = (d: DueStatus) => {
  if (d === 'OVERDUE') return 'border-destructive/40 bg-destructive/10 text-destructive';
  if (d === 'DUE_TODAY' || d === 'DUE_1_3') return 'border-warning/40 bg-warning/10 text-warning';
  if (d === 'DUE_4_7') return 'border-warning/25 bg-warning/5 text-warning';
  return 'text-muted-foreground';
};

/** Quick filters kept visible: the operational questions this queue must answer. */
const QUICK_FILTERS: { key: string; label: string; patch: Record<string, unknown> }[] = [
  { key: 'all', label: 'All Active', patch: {} },
  { key: 'mine', label: 'My Cases', patch: { assigned: 'ME' } },
  { key: 'unassigned', label: 'Unassigned', patch: { assigned: 'UNASSIGNED' } },
  { key: 'overdue', label: 'Overdue', patch: { due: 'OVERDUE' } },
  { key: 'due_today', label: 'Due Today', patch: { due: 'DUE_TODAY' } },
  { key: 'due_7', label: 'Due Next 7 Days', patch: { due: 'DUE_7' } },
  { key: 'crit_high', label: 'Critical / High', patch: { priorities: ['CRITICAL', 'HIGH'] } },
  { key: 'high_risk', label: 'High Risk', patch: { risk_bands: ['CRITICAL', 'HIGH'] } },
  { key: 'legal', label: 'Legal / Court', patch: { legal_only: true } },
];

const CaseQueue = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const q = useCaseQueue();
  const [searchDraft, setSearchDraft] = useState(q.filters.search ?? '');
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => { setSearchDraft(q.filters.search ?? ''); }, [q.filters.search]);

  // Debounced server-side search.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = searchDraft.trim();
      if (next !== (q.filters.search ?? '')) q.patchFilters({ search: next || undefined });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  const kpis = q.activeFilterCount > 0 ? q.kpisFiltered : q.kpisAll;
  const filteredKpis = q.activeFilterCount > 0;
  const from = q.total === 0 ? 0 : (q.page - 1) * q.pageSize + 1;
  const to = Math.min(q.page * q.pageSize, q.total);

  const isQuickActive = (patch: Record<string, unknown>) => {
    const f = q.filters;
    const keys = Object.keys(patch);
    if (keys.length === 0) return q.activeFilterCount === 0;
    return keys.every((k) => {
      const v = patch[k];
      if (Array.isArray(v)) {
        const cur = (f as any)[k] as string[] | undefined;
        return !!cur && cur.length === v.length && v.every((x) => cur.includes(x as string));
      }
      return (f as any)[k] === v;
    });
  };

  const openCase = (row: QueueRow) => {
    // Filters, sort, page and size live in the URL, so returning restores the queue exactly.
    navigate(`/compliance/cases/${row.id}`, { state: { returnTo: `${location.pathname}${location.search}` } });
  };

  const amountValue = q.filters.amount_min || q.filters.amount_max
    ? `${q.filters.amount_min ?? ''}-${q.filters.amount_max ?? ''}`
    : ANY;

  return (
    <TooltipProvider>
      <div className="container mx-auto p-6 space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ListChecks className="h-6 w-6 text-primary" />
              <h1 className="text-3xl font-semibold text-foreground">Case Queue</h1>
              {q.scope && (
                <Badge variant="outline" className="text-[10px] uppercase">{q.scope} scope</Badge>
              )}
            </div>
            <p className="text-muted-foreground">
              Active compliance cases requiring action, prioritised by urgency and ownership.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {q.isFetching && !q.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            <Button variant="outline" size="sm" className="h-9" onClick={() => q.refetch()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
        </div>

        {/* KPI strip — aggregated across the whole authorised queue */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { label: 'Critical', value: kpis.critical, tone: 'text-destructive' },
            { label: 'High', value: kpis.high, tone: 'text-warning' },
            { label: 'Overdue', value: kpis.overdue, tone: 'text-destructive' },
            { label: 'Due this week', value: kpis.due_week, tone: 'text-warning' },
            { label: 'Unassigned', value: kpis.unassigned, tone: 'text-primary' },
          ].map((k) => (
            <Card key={k.label}>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">
                  {k.label}{filteredKpis ? ' (filtered)' : ''}
                </p>
                <p className={`text-2xl font-bold ${k.tone}`}>{k.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Quick filters */}
        <div className="flex flex-wrap items-center gap-2">
          {QUICK_FILTERS.map((qf) => (
            <Button
              key={qf.key}
              size="sm"
              variant={isQuickActive(qf.patch) ? 'default' : 'outline'}
              className="h-8 rounded-full text-xs"
              onClick={() => (qf.key === 'all' ? q.resetFilters() : q.applyQuickFilter(qf.patch as any))}
            >
              {qf.label}
              {qf.key === 'mine' && q.kpisAll.mine > 0 && (
                <span className="ml-1.5 opacity-70">({q.kpisAll.mine})</span>
              )}
            </Button>
          ))}
        </div>

        {/* Primary toolbar */}
        <Card>
          <CardContent className="space-y-3 py-4">
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

              <Select
                value={q.filters.assigned ?? ANY}
                onValueChange={(v) => q.patchFilters({ assigned: v === ANY ? undefined : v })}
              >
                <SelectTrigger className="h-9 w-[190px]"><SelectValue placeholder="Assigned to" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any authorised officer</SelectItem>
                  <SelectItem value="ME">My cases</SelectItem>
                  <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
                  {q.options.officers.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <MultiSelect
                label="Stage"
                values={q.filters.statuses ?? []}
                options={q.options.statuses}
                onToggle={(v) => q.toggleInList('statuses', v)}
                width="w-[190px]"
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
                value={q.filters.due ?? ANY}
                onValueChange={(v) => q.patchFilters({ due: v === ANY ? undefined : v })}
              >
                <SelectTrigger className="h-9 w-[190px]"><SelectValue placeholder="Target resolution" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any target date</SelectItem>
                  {DUE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>

              <Button
                variant={showAdvanced ? 'default' : 'outline'}
                size="sm"
                className="h-9"
                onClick={() => setShowAdvanced((s) => !s)}
              >
                <Filter className="mr-1.5 h-3.5 w-3.5" /> Filters
                {q.activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{q.activeFilterCount}</Badge>
                )}
              </Button>

              {q.activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" className="h-9" onClick={q.resetFilters}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset filters
                </Button>
              )}
            </div>

            {showAdvanced && (
              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                <EmployerCombobox
                  value={q.filters.employer}
                  options={q.options.employers}
                  onChange={(v) => q.patchFilters({ employer: v })}
                />
                <MultiSelect
                  label="Risk band"
                  values={q.filters.risk_bands ?? []}
                  options={q.options.risk_bands}
                  onToggle={(v) => q.toggleInList('risk_bands', v)}
                  width="w-[170px]"
                />
                <Select
                  value={q.filters.territory ?? ANY}
                  onValueChange={(v) => q.patchFilters({ territory: v === ANY ? undefined : v })}
                >
                  <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="Zone / territory" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>All zones</SelectItem>
                    {q.options.territories.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select
                  value={q.filters.age ?? ANY}
                  onValueChange={(v) => q.patchFilters({ age: v === ANY ? undefined : v })}
                >
                  <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="Case age" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Any age</SelectItem>
                    {AGE_BUCKETS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select
                  value={amountValue}
                  onValueChange={(v) => {
                    if (v === ANY) return q.patchFilters({ amount_min: undefined, amount_max: undefined });
                    const [min, max] = v.split('-');
                    q.patchFilters({ amount_min: min || undefined, amount_max: max || undefined });
                  }}
                >
                  <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="Amount" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Any amount</SelectItem>
                    {AMOUNT_RANGES.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input
                  type="date"
                  value={q.filters.date_from ?? ''}
                  onChange={(e) => q.patchFilters({ date_from: e.target.value || undefined })}
                  className="h-9 w-[150px]"
                  aria-label="Opened from"
                />
                <Input
                  type="date"
                  value={q.filters.date_to ?? ''}
                  onChange={(e) => q.patchFilters({ date_to: e.target.value || undefined })}
                  className="h-9 w-[150px]"
                  aria-label="Opened to"
                />
                <Select
                  value={q.filters.case_type ?? ANY}
                  onValueChange={(v) => q.patchFilters({ case_type: v === ANY ? undefined : v })}
                >
                  <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="Case type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>All case types</SelectItem>
                    {q.options.case_types.map((t) => <SelectItem key={t} value={t}>{titleise(t)}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select
                  value={q.filters.arrangement ?? ANY}
                  onValueChange={(v) => q.patchFilters({ arrangement: v === ANY ? undefined : v })}
                >
                  <SelectTrigger className="h-9 w-[200px]"><SelectValue placeholder="Arrangement" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Any arrangement status</SelectItem>
                    {ARRANGEMENT_OPTIONS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Active filter chips */}
            {q.activeFilterCount > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
                <span className="text-xs text-muted-foreground">Active:</span>
                {Object.entries(q.filters).map(([k, v]) => {
                  const text = Array.isArray(v) ? v.map(titleise).join(', ') : v === true ? 'Yes' : String(v);
                  return (
                    <Badge
                      key={k}
                      variant="secondary"
                      className="cursor-pointer text-[11px]"
                      onClick={() => q.patchFilters({ [k]: Array.isArray(v) ? [] : undefined } as any)}
                    >
                      {titleise(k)}: {text} ×
                    </Badge>
                  );
                })}
              </div>
            )}

            {/* Sort + paging summary */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Sort</span>
                <Select value={q.sort} onValueChange={(v) => q.changeSort(v)}>
                  <SelectTrigger className="h-9 w-[220px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {QUEUE_SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {q.sort !== 'recommended' && (
                  <Button variant="outline" size="sm" className="h-9" onClick={q.toggleDir}>
                    {q.dir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                    <span className="ml-1 text-xs">{q.dir === 'asc' ? 'Ascending' : 'Descending'}</span>
                  </Button>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8"><Info className="h-3.5 w-3.5" /></Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-sm text-xs">{RECOMMENDED_SORT_RULE}</TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {q.total === 0 ? 'No active cases' : `Showing ${from}–${to} of ${q.total} active cases`}
                </span>
                <Select value={String(q.pageSize)} onValueChange={(v) => q.setPageSize(Number(v))}>
                  <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Queue body */}
        {q.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-lg" />)}
          </div>
        ) : q.isError ? (
          <Card className="border-destructive/40">
            <CardContent className="py-12 text-center">
              <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-destructive" />
              <p className="font-medium text-foreground">Unable to load the case queue.</p>
              <p className="mt-1 text-sm text-muted-foreground">{q.error?.message}</p>
              <Button className="mt-4" size="sm" onClick={() => q.refetch()}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
              </Button>
            </CardContent>
          </Card>
        ) : q.rows.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <Inbox className="mx-auto mb-3 h-12 w-12 opacity-50" />
              {q.activeFilterCount > 0 ? (
                <>
                  <p className="font-medium text-foreground">No active cases match the selected filters</p>
                  <p className="mt-1 text-sm">Adjust or clear the filters to see the full active queue.</p>
                  <Button variant="outline" size="sm" className="mt-4" onClick={q.resetFilters}>
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Clear filters
                  </Button>
                </>
              ) : (
                <>
                  <p className="font-medium text-foreground">No active cases in the queue</p>
                  <p className="mt-1 text-sm">Every case in your authorised scope is resolved or closed.</p>
                </>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {q.rows.map((item) => {
              const unassigned = !item.assigned_officer_id;
              const elevated = item.due_status === 'OVERDUE' || (unassigned && item.priority === 'CRITICAL');
              return (
                <Card
                  key={item.id}
                  className={`transition-shadow hover:shadow-md ${
                    item.due_status === 'OVERDUE'
                      ? 'border-l-4 border-l-destructive'
                      : item.due_status === 'DUE_TODAY' || item.due_status === 'DUE_1_3'
                        ? 'border-l-4 border-l-warning'
                        : ''
                  }`}
                >
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-muted-foreground">#{item.rn}</span>
                          <button
                            className="font-mono text-sm font-medium text-primary hover:underline"
                            onClick={() => openCase(item)}
                          >
                            {item.case_number}
                          </button>
                          <Badge variant={priorityVariant(item.priority)} className="text-[10px]">
                            {titleise(item.priority)}
                          </Badge>
                          <Badge variant="outline" className={`text-[10px] ${riskTone(item.risk_band)}`}>
                            Risk: {titleise(item.risk_band)}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">{titleise(item.status)}</Badge>
                          {item.status_group === 'LEGAL' && (
                            <Badge variant="destructive" className="text-[10px]">
                              <Scale className="mr-1 h-3 w-3" /> Legal
                            </Badge>
                          )}
                          {unassigned && (
                            <Badge
                              variant={elevated ? 'destructive' : 'secondary'}
                              className="text-[10px]"
                            >
                              <UserX className="mr-1 h-3 w-3" /> Unassigned
                            </Badge>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-4">
                          <span className="flex items-center gap-1 font-medium text-foreground">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            {item.employer_name || '—'}
                          </span>
                          {item.employer_id && (
                            <Badge variant="outline" className="font-mono text-[10px]">{item.employer_id}</Badge>
                          )}
                          <span className="text-sm text-foreground">{fmtCurrency(Number(item.total_amount || 0))}</span>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />{item.age_days} days open
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {unassigned ? 'Unassigned' : `Assigned: ${item.assigned_officer_name || item.assigned_officer_id}`}
                          </span>
                          {item.territory && (
                            <span className="text-xs text-muted-foreground">Zone: {item.territory}</span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          <Badge variant="outline" className={`text-[10px] ${dueTone(item.due_status)}`}>
                            <CalendarClock className="mr-1 h-3 w-3" />
                            {dueLabel[item.due_status]}
                            {item.target_resolution_date ? ` · ${formatDisplayDate(item.target_resolution_date)}` : ''}
                          </Badge>
                          {item.arrangement_state !== 'NONE' && (
                            <span className="text-xs text-muted-foreground">
                              Arrangement: {titleise(item.arrangement_state)}
                            </span>
                          )}
                        </div>

                        {item.summary && (
                          <div className="flex items-start gap-2 text-sm">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                            <span className="line-clamp-2 text-muted-foreground">{item.summary}</span>
                          </div>
                        )}
                      </div>

                      <Button size="sm" onClick={() => openCase(item)}>Take Action</Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {/* Pagination */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-xs text-muted-foreground">
                Showing {from}–{to} of {q.total} active cases · page {q.page} of {q.totalPages}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={q.page <= 1} onClick={() => q.setPage(1)}>
                  <ChevronsLeft className="h-3.5 w-3.5" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={q.page <= 1} onClick={() => q.setPage(q.page - 1)}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="px-2 text-xs text-muted-foreground">{q.page} / {q.totalPages}</span>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={q.page >= q.totalPages} onClick={() => q.setPage(q.page + 1)}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={q.page >= q.totalPages} onClick={() => q.setPage(q.totalPages)}>
                  <ChevronsRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
};

export default CaseQueue;
