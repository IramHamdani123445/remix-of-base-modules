import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ClipboardList, Search, Filter, RotateCcw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ArrowDown, ArrowUp, Info, Eye, AlertTriangle, Clock, RefreshCw, UserX, X, CalendarClock, ShieldAlert,
} from 'lucide-react';
import { formatDisplayDate } from '@/lib/dateFormat';
import { EmployerCombobox, MultiSelect, titleise } from '@/components/compliance/ListFilterControls';
import {
  useAssignedCases, ASSIGNED_SORTS, RECOMMENDED_ASSIGNED_RULE, PAGE_SIZE_OPTIONS,
  DUE_OPTIONS, AGE_OPTIONS, OPENED_OPTIONS, ASSIGNED_SINCE_OPTIONS,
  type AssignedRow, type AssignedScope, type AssignedFilters,
} from '@/hooks/compliance/useAssignedCases';

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

const dueTone = (bucket: string) => {
  switch (bucket) {
    case 'OVERDUE': return 'border-destructive/40 bg-destructive/10 text-destructive';
    case 'TODAY': return 'border-warning/40 bg-warning/10 text-warning';
    case '1_3': return 'border-warning/25 bg-warning/5 text-warning';
    default: return 'text-muted-foreground';
  }
};

const dueLabel = (bucket: string) => ({
  OVERDUE: 'Overdue', TODAY: 'Due today', '1_3': 'Due 1–3 days',
  WEEK: 'Due this week', LATER: 'Due later', NONE: 'No target',
}[bucket] ?? bucket);

/** Quick filters — every preset is backed by real assigned-case data. */
const MY_QUICK_FILTERS: { key: string; label: string; patch: Partial<AssignedFilters> }[] = [
  { key: 'all', label: 'All My Cases', patch: {} },
  { key: 'overdue', label: 'Overdue', patch: { due: 'OVERDUE' } },
  { key: 'today', label: 'Due Today', patch: { due: 'TODAY' } },
  { key: 'week', label: 'Due This Week', patch: { due: 'DUE_WEEK' } },
  { key: 'crit', label: 'Critical / High', patch: { priorities: ['CRITICAL', 'HIGH'] } },
  { key: 'risk', label: 'High Risk', patch: { risk_bands: ['CRITICAL', 'HIGH'] } },
  { key: 'recent', label: 'Recently Assigned', patch: { assigned: '7' } },
  { key: 'legal', label: 'Legal / Court', patch: { statuses: ['ESCALATED_LEGAL', 'RECOMMENDED_FOR_LEGAL'] } },
];

const TEAM_QUICK_FILTERS = MY_QUICK_FILTERS.filter((f) => f.key !== 'today').map((f) =>
  f.key === 'all' ? { ...f, label: 'All Assigned' } : f);

const SCOPE_LABEL: Record<AssignedScope, string> = {
  mine: 'My Cases',
  team: 'My Team',
  all: 'All Assigned Cases',
};

const AssignedCases = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const q = useAssignedCases();
  const [searchDraft, setSearchDraft] = useState(q.filters.search ?? '');
  const [showAdvanced, setShowAdvanced] = useState(false);

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

  const mine = q.scope === 'mine';
  const filtered = q.activeFilterCount > 0;
  const kpis = filtered ? q.kpisFiltered : q.kpisAll;
  const from = q.total === 0 ? 0 : (q.page - 1) * q.pageSize + 1;
  const to = Math.min(q.page * q.pageSize, q.total);
  const quickFilters = mine ? MY_QUICK_FILTERS : TEAM_QUICK_FILTERS;

  const isQuickActive = (patch: Partial<AssignedFilters>) => {
    const f = q.filters as Record<string, unknown>;
    const keys = Object.keys(patch);
    if (keys.length === 0) return q.activeFilterCount === 0;
    return keys.every((k) => {
      const v = (patch as Record<string, unknown>)[k];
      if (Array.isArray(v)) {
        const cur = f[k] as string[] | undefined;
        return !!cur && cur.length === v.length && v.every((x) => cur.includes(x as string));
      }
      return f[k] === v;
    });
  };

  const openCase = (row: AssignedRow) =>
    navigate(`/compliance/cases/${row.id}`, { state: { returnTo: `${location.pathname}${location.search}` } });

  const openEmployer = (employerId: string | null) => {
    if (employerId) navigate(`/compliance/field/employer-360/${employerId}`);
  };

  const activeChips: { label: string; clear: () => void }[] = [];
  if (q.filters.search) activeChips.push({ label: `Search: ${q.filters.search}`, clear: () => q.patchFilters({ search: undefined }) });
  if (q.filters.employer) activeChips.push({ label: `Employer: ${q.filters.employer}`, clear: () => q.patchFilters({ employer: undefined }) });
  if (q.filters.officer && !mine) activeChips.push({ label: `Officer: ${q.options.officers.find((o) => o.id === q.filters.officer)?.name ?? q.filters.officer}`, clear: () => q.patchFilters({ officer: undefined }) });
  (q.filters.statuses ?? []).forEach((v) => activeChips.push({ label: `Status: ${titleise(v)}`, clear: () => q.toggleInList('statuses', v) }));
  (q.filters.priorities ?? []).forEach((v) => activeChips.push({ label: `Priority: ${titleise(v)}`, clear: () => q.toggleInList('priorities', v) }));
  (q.filters.risk_bands ?? []).forEach((v) => activeChips.push({ label: `Risk: ${titleise(v)}`, clear: () => q.toggleInList('risk_bands', v) }));
  (q.filters.families ?? []).forEach((v) => activeChips.push({ label: `Family: ${titleise(v)}`, clear: () => q.toggleInList('families', v) }));
  if (q.filters.territory) activeChips.push({ label: `Zone: ${q.filters.territory}`, clear: () => q.patchFilters({ territory: undefined }) });
  if (q.filters.due) activeChips.push({ label: `Target: ${DUE_OPTIONS.find((d) => d.value === q.filters.due)?.label ?? q.filters.due}`, clear: () => q.patchFilters({ due: undefined }) });
  if (q.filters.age) activeChips.push({ label: `Age: ${AGE_OPTIONS.find((a) => a.value === q.filters.age)?.label ?? q.filters.age}`, clear: () => q.patchFilters({ age: undefined }) });
  if (q.filters.assigned) activeChips.push({ label: ASSIGNED_SINCE_OPTIONS.find((a) => a.value === q.filters.assigned)?.label ?? 'Recently assigned', clear: () => q.patchFilters({ assigned: undefined }) });
  if (q.filters.opened) activeChips.push({ label: `Opened: ${OPENED_OPTIONS.find((o) => o.value === q.filters.opened)?.label ?? q.filters.opened}`, clear: () => q.patchFilters({ opened: undefined }) });
  if (q.filters.date_from || q.filters.date_to) activeChips.push({ label: `Opened ${q.filters.date_from ?? '…'} → ${q.filters.date_to ?? '…'}`, clear: () => q.patchFilters({ date_from: undefined, date_to: undefined }) });
  if (q.filters.include_closed) activeChips.push({ label: 'Including closed / resolved', clear: () => q.patchFilters({ include_closed: false }) });

  const kpiCards = [
    { label: mine ? 'My Active Cases' : 'Assigned Cases', value: String(kpis.total), icon: ClipboardList, tone: 'text-primary' },
    { label: 'Overdue', value: String(kpis.overdue), icon: AlertTriangle, tone: 'text-destructive' },
    { label: 'Due This Week', value: String(kpis.due_week), icon: CalendarClock, tone: 'text-warning' },
    { label: 'Critical / High', value: String(kpis.critical_high), icon: ShieldAlert, tone: 'text-destructive' },
  ];

  const countSentence = q.total === 0
    ? 'No cases to show'
    : mine
      ? `Showing ${from}–${to} of ${q.total} ${filtered ? 'matching cases assigned to you' : 'cases assigned to you'}`
      : `Showing ${from}–${to} of ${q.total} ${filtered ? 'matching assigned cases' : 'assigned cases'}`;

  const identityFailure = mine && !q.identityResolved && !q.isLoading && !q.isError;

  return (
    <PermissionWrapper moduleName={MODULE}>
      <TooltipProvider>
        <div className="container mx-auto space-y-5 p-6">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <ClipboardList className="h-6 w-6 text-primary" />
                Assigned Cases
              </h1>
              <p className="text-sm text-muted-foreground">
                Ownership-based caseload management for compliance cases that already have an owning officer.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[11px]">Scope: {SCOPE_LABEL[q.scope]}</Badge>
              <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${q.isFetching ? 'animate-spin' : ''}`} />Refresh
              </Button>
            </div>
          </div>

          {/* Ownership scope — only scopes the user is authorised for are offered */}
          <div className="flex flex-wrap items-center gap-3">
            <Tabs value={q.scope} onValueChange={(v) => q.setScope(v as AssignedScope)}>
              <TabsList className="h-9">
                <TabsTrigger value="mine" className="text-xs">My Cases</TabsTrigger>
                {q.canTeam && <TabsTrigger value="team" className="text-xs">My Team</TabsTrigger>}
                {q.canAll && <TabsTrigger value="all" className="text-xs">All Assigned Cases</TabsTrigger>}
              </TabsList>
            </Tabs>
            <p className="text-xs text-muted-foreground">
              {mine
                ? `${q.kpisAll.total} active ${q.kpisAll.total === 1 ? 'case' : 'cases'} assigned to you`
                : `${q.kpisAll.total} active assigned ${q.kpisAll.total === 1 ? 'case' : 'cases'} in scope`}
            </p>
          </div>

          {identityFailure ? (
            <Card>
              <CardContent className="space-y-3 py-14 text-center">
                <UserX className="mx-auto h-8 w-8 text-warning" />
                <p className="text-sm font-medium">
                  Your Compliance officer profile could not be resolved. My Cases cannot currently be loaded.
                </p>
                <p className="text-xs text-muted-foreground">
                  Ask a Compliance administrator to link your account to a compliance officer record.
                  {(q.canTeam || q.canAll) && ' You can still review the team or enterprise caseload.'}
                </p>
                {(q.canTeam || q.canAll) && (
                  <Button size="sm" variant="outline" onClick={() => q.setScope(q.canAll ? 'all' : 'team')}>
                    View {q.canAll ? 'all assigned cases' : 'my team'}
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              {/* KPI strip — computed across the full authorised scope */}
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
                {filtered ? 'Counters reflect the current filters.' : `Counters reflect every assigned case in the ${SCOPE_LABEL[q.scope]} scope.`}
                {' '}Total exposure: {fmtCurrency(kpis.exposure)}. Overdue is measured against the case target
                resolution date, which is not a formal workflow SLA.
              </p>

              {/* Quick filters */}
              <div className="flex flex-wrap gap-2">
                {quickFilters.map((qf) => (
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
                    <div className="relative min-w-[240px] flex-1">
                      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={searchDraft}
                        onChange={(e) => setSearchDraft(e.target.value)}
                        placeholder={mine ? 'Search case or employer' : 'Search case, employer or officer'}
                        className="h-9 pl-8"
                      />
                    </div>
                    <MultiSelect
                      label="Status" values={q.filters.statuses ?? []} options={q.options.statuses}
                      onToggle={(v) => q.toggleInList('statuses', v)} width="w-[190px]" searchable
                    />
                    <MultiSelect
                      label="Priority" values={q.filters.priorities ?? []} options={q.options.priorities}
                      onToggle={(v) => q.toggleInList('priorities', v)} width="w-[160px]"
                    />
                    <Select value={q.filters.due ?? ANY} onValueChange={(v) => q.patchFilters({ due: v === ANY ? undefined : v })}>
                      <SelectTrigger className="h-9 w-[200px]"><SelectValue placeholder="Target / due" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ANY}>Any target date</SelectItem>
                        {DUE_OPTIONS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {!mine && (
                      <Select value={q.filters.officer ?? ANY} onValueChange={(v) => q.patchFilters({ officer: v === ANY ? undefined : v })}>
                        <SelectTrigger className="h-9 w-[210px]"><SelectValue placeholder="Assigned officer" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ANY}>All officers</SelectItem>
                          {q.options.officers.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
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
                      <EmployerCombobox
                        value={q.filters.employer}
                        options={q.options.employers}
                        onChange={(v) => q.patchFilters({ employer: v })}
                      />
                      <MultiSelect
                        label="Risk Band" values={q.filters.risk_bands ?? []} options={q.options.risk_bands}
                        onToggle={(v) => q.toggleInList('risk_bands', v)} width="w-[170px]"
                      />
                      <MultiSelect
                        label="Case Family" values={q.filters.families ?? []} options={q.options.families}
                        onToggle={(v) => q.toggleInList('families', v)} width="w-[190px]" searchable
                      />
                      <Select value={q.filters.age ?? ANY} onValueChange={(v) => q.patchFilters({ age: v === ANY ? undefined : v })}>
                        <SelectTrigger className="h-9 w-[170px]"><SelectValue placeholder="Case age" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ANY}>Any age</SelectItem>
                          {AGE_OPTIONS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select value={q.filters.territory ?? ANY} onValueChange={(v) => q.patchFilters({ territory: v === ANY ? undefined : v })}>
                        <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="Zone / Territory" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ANY}>All zones</SelectItem>
                          {q.options.territories.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select value={q.filters.assigned ?? ANY} onValueChange={(v) => q.patchFilters({ assigned: v === ANY ? undefined : v })}>
                        <SelectTrigger className="h-9 w-[210px]"><SelectValue placeholder="Assigned since" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ANY}>Any assignment date</SelectItem>
                          {ASSIGNED_SINCE_OPTIONS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select value={q.filters.opened ?? ANY} onValueChange={(v) => q.patchFilters({ opened: v === ANY ? undefined : v })}>
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
                      <Button
                        variant={q.filters.include_closed ? 'default' : 'outline'}
                        size="sm"
                        className="h-9 text-xs"
                        onClick={() => q.patchFilters({ include_closed: !q.filters.include_closed })}
                      >
                        Include Closed / Resolved
                      </Button>
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
                <p className="text-sm text-muted-foreground">{q.isLoading ? 'Loading assigned cases…' : countSentence}</p>
                <div className="flex items-center gap-2">
                  <Select value={q.sort} onValueChange={(v) => q.changeSort(v)}>
                    <SelectTrigger className="h-9 w-[215px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ASSIGNED_SORTS.filter((s) => s.value !== 'officer' || !mine).map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {q.sort === 'recommended' ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" className="h-9 w-9"><Info className="h-3.5 w-3.5" /></Button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">{RECOMMENDED_ASSIGNED_RULE}</TooltipContent>
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
                      <p className="text-sm font-medium">Unable to load assigned cases. Please retry.</p>
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
                      <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" />
                      <p className="text-sm font-medium">
                        {filtered
                          ? mine ? 'No assigned cases match the selected filters' : 'No assigned cases match the current scope and filters.'
                          : mine ? 'You currently have no assigned active cases' : 'No assigned cases in the current scope'}
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
                          <TableHead className="w-[56px]">#</TableHead>
                          <TableHead>Case #</TableHead>
                          <TableHead>Employer</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Priority</TableHead>
                          <TableHead>Risk</TableHead>
                          <TableHead className="text-right">Exposure</TableHead>
                          <TableHead>Opened</TableHead>
                          <TableHead>Days Open</TableHead>
                          <TableHead>Target</TableHead>
                          <TableHead>{mine ? 'Assigned Since' : 'Assigned Officer'}</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {q.rows.map((r) => (
                          <TableRow key={r.id} className={r.due_bucket === 'OVERDUE' ? 'border-l-2 border-l-destructive' : undefined}>
                            <TableCell className="text-xs tabular-nums text-muted-foreground">{r.rn}</TableCell>
                            <TableCell>
                              <button onClick={() => openCase(r)} className="font-mono text-xs font-medium text-primary hover:underline">
                                {r.case_number}
                              </button>
                              <div className="text-[10px] text-muted-foreground">{titleise(r.case_family)}</div>
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
                            <TableCell><Badge variant="outline" className="text-[10px]">{titleise(r.status)}</Badge></TableCell>
                            <TableCell><Badge variant={priorityVariant(r.priority)} className="text-[10px]">{titleise(r.priority)}</Badge></TableCell>
                            <TableCell><Badge variant="outline" className={`text-[10px] ${riskTone(r.risk_band)}`}>{titleise(r.risk_band)}</Badge></TableCell>
                            <TableCell className="text-right text-xs tabular-nums">{fmtCurrency(r.total_amount)}</TableCell>
                            <TableCell className="text-xs">{r.opened_date ? formatDisplayDate(r.opened_date) : '—'}</TableCell>
                            <TableCell className="text-xs tabular-nums">{r.days_open}d</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`text-[10px] ${dueTone(r.due_bucket)}`}>{dueLabel(r.due_bucket)}</Badge>
                              <div className="text-[10px] text-muted-foreground">
                                {r.target_resolution_date ? formatDisplayDate(r.target_resolution_date) : '—'}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs">
                              {mine ? (
                                <span className="text-muted-foreground">
                                  {r.days_assigned === null ? 'Not recorded' : r.days_assigned === 0 ? 'Today' : `${r.days_assigned}d ago`}
                                </span>
                              ) : (
                                <div>
                                  <div className="font-medium">{r.assigned_officer_name || '—'}</div>
                                  <div className="text-[10px] text-muted-foreground">
                                    {r.is_mine ? 'You' : r.days_assigned === null ? 'Assignment date not recorded' : `Assigned ${r.days_assigned}d ago`}
                                    {r.reassigned ? ' • Reassigned' : ''}
                                  </div>
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button size="sm" variant="outline" onClick={() => openCase(r)}>
                                <Eye className="mr-1 h-3.5 w-3.5" />Open
                              </Button>
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

              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                Ownership is resolved server-side across every officer identifier held against your account
                (officer id, inspector code and legacy code). Case workflow does not expose a canonical
                "next required action", so that column is not shown.
              </p>
            </>
          )}
        </div>
      </TooltipProvider>
    </PermissionWrapper>
  );
};

export default AssignedCases;
