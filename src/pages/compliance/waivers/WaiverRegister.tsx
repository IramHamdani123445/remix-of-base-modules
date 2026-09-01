import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { ComplianceHelpButton } from '@/components/help/ComplianceHelpButton';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Filter,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { formatXCD } from '@/components/compliance/arrangements/arrangementFormat';
import { formatDateForDisplay } from '@/lib/format-config';
import NewWaiverRequestDialog from '@/pages/compliance/legal/NewWaiverRequestDialog';
import { WaiverDetailDialog } from '@/components/compliance/WaiverDetailDialog';
import {
  useWaiverRegister,
  WAIVER_PAGE_SIZES,
  type WaiverRegisterRow,
} from '@/hooks/compliance/useWaiverRegister';

const TABS: { code: string; label: string }[] = [
  { code: 'ACTION', label: 'Awaiting decision' },
  { code: 'ATTENTION', label: 'Requires attention' },
  { code: 'OVERDUE', label: 'Overdue' },
  { code: 'HIGH_VALUE', label: 'High value' },
  { code: 'MINE', label: 'My requests' },
  { code: 'APPROVED', label: 'Approved' },
  { code: 'APPLIED', label: 'Applied' },
  { code: 'REJECTED', label: 'Rejected' },
  { code: 'CLOSED', label: 'Closed' },
  { code: 'ALL', label: 'All' },
];

const WINDOWS = [
  { code: 'TODAY', label: 'Requested today' },
  { code: 'D7', label: 'Last 7 days' },
  { code: 'D30', label: 'Last 30 days' },
  { code: 'D90', label: 'Last 90 days' },
  { code: 'YTD', label: 'This year' },
];

const AMOUNT_BANDS = [
  { code: 'LT1K', label: 'Under 1,000' },
  { code: '1K5K', label: '1,000 – 5,000' },
  { code: '5K10K', label: '5,000 – 10,000' },
  { code: '10K50K', label: '10,000 – 50,000' },
  { code: 'GT50K', label: 'Over 50,000' },
];

const SLA_OPTIONS = [
  { code: 'OVERDUE', label: 'Past the approval interval' },
  { code: 'DUE_SOON', label: 'Approaching the interval' },
  { code: 'WITHIN', label: 'Within the interval' },
];

function KpiTile({
  label,
  value,
  tone = 'default',
  hint,
}: {
  label: string;
  value: string | number;
  tone?: 'default' | 'success' | 'warning' | 'destructive' | 'primary';
  hint?: string;
}) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'destructive'
          ? 'text-destructive'
          : tone === 'primary'
            ? 'text-primary'
            : 'text-foreground';
  return (
    <Card className="shadow-none">
      <CardContent className="p-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`text-xl font-semibold leading-tight ${toneClass}`}>{value}</p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  dir,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: string;
  sort: string;
  dir: 'asc' | 'desc';
  onSort: (key: string) => void;
  align?: 'left' | 'right';
}) {
  const active = sort === sortKey;
  return (
    <TableHead className={align === 'right' ? 'text-right' : undefined}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 text-xs font-medium hover:text-foreground ${
          active ? 'text-foreground' : 'text-muted-foreground'
        }`}
      >
        {label}
        {active ? dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : null}
      </button>
    </TableHead>
  );
}

function statusToneClass(tone?: string | null) {
  switch (tone) {
    case 'success':
      return 'bg-success/10 text-success border-success/30';
    case 'warning':
      return 'bg-warning/10 text-warning border-warning/30';
    case 'destructive':
      return 'bg-destructive/10 text-destructive border-destructive/30';
    case 'primary':
      return 'bg-primary/10 text-primary border-primary/30';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

export default function WaiverRegister() {
  const [searchParams] = useSearchParams();
  const register = useWaiverRegister();
  const { data, facets, filters, sort, dir, page, pageSize, isLoading, isFetching, isError, error } = register;

  const [selectedWaiverId, setSelectedWaiverId] = useState<string | null>(searchParams.get('waiver'));
  const [showNewRequest, setShowNewRequest] = useState(false);
  const [searchDraft, setSearchDraft] = useState(filters.search);

  useEffect(() => setSearchDraft(filters.search), [filters.search]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchDraft !== filters.search) register.setFilter('q', searchDraft);
    }, 350);
    return () => clearTimeout(t);
  }, [searchDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows: WaiverRegisterRow[] = data?.rows ?? [];
  const kpis = data?.kpis ?? {};
  const tabCounts = data?.tab_counts ?? {};
  const attention = data?.attention ?? [];
  const thresholds = data?.thresholds;
  const actor = data?.actor;
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const chips = useMemo(() => {
    const list: { key: string; label: string; clear: () => void }[] = [];
    filters.statuses.forEach((s) =>
      list.push({
        key: `s-${s}`,
        label: facets?.statuses?.find((x) => x.code === s)?.label ?? s,
        clear: () => register.toggleListFilter('statuses', s),
      }),
    );
    filters.components.forEach((c) =>
      list.push({
        key: `c-${c}`,
        label: facets?.components?.find((x) => x.code === c)?.label ?? c,
        clear: () => register.toggleListFilter('components', c),
      }),
    );
    filters.scopes.forEach((c) =>
      list.push({
        key: `sc-${c}`,
        label: facets?.scopes?.find((x) => x.code === c)?.label ?? c,
        clear: () => register.toggleListFilter('scopes', c),
      }),
    );
    filters.sources.forEach((c) =>
      list.push({
        key: `so-${c}`,
        label: facets?.sources?.find((x) => x.code === c)?.label ?? c,
        clear: () => register.toggleListFilter('sources', c),
      }),
    );
    if (filters.employer_id)
      list.push({
        key: 'employer',
        label: facets?.employers?.find((e) => e.code === filters.employer_id)?.label ?? 'Employer',
        clear: () => register.setFilter('employer', ''),
      });
    if (filters.requested_by)
      list.push({
        key: 'requester',
        label:
          filters.requested_by === 'ME'
            ? 'Raised by me'
            : (facets?.requesters?.find((r) => r.code === filters.requested_by)?.label ?? 'Requester'),
        clear: () => register.setFilter('requester', ''),
      });
    if (filters.rule_id)
      list.push({
        key: 'rule',
        label: facets?.rules?.find((r) => r.code === filters.rule_id)?.label ?? 'Rule',
        clear: () => register.setFilter('rule', ''),
      });
    if (filters.sla)
      list.push({
        key: 'sla',
        label: SLA_OPTIONS.find((s) => s.code === filters.sla)?.label ?? filters.sla,
        clear: () => register.setFilter('sla', ''),
      });
    if (filters.date_window)
      list.push({
        key: 'window',
        label: WINDOWS.find((w) => w.code === filters.date_window)?.label ?? filters.date_window,
        clear: () => register.setFilter('window', ''),
      });
    if (filters.amount_band)
      list.push({
        key: 'amount',
        label: AMOUNT_BANDS.find((a) => a.code === filters.amount_band)?.label ?? filters.amount_band,
        clear: () => register.setFilter('amount', ''),
      });
    if (filters.case_id)
      list.push({ key: 'case', label: 'Single case', clear: () => register.setFilter('case', '') });
    if (filters.violation_id)
      list.push({ key: 'violation', label: 'Single violation', clear: () => register.setFilter('violation', '') });
    return list;
  }, [filters, facets, register]);

  return (
    <div className="container mx-auto p-6 space-y-4">
      <PageHeader
        title="Waiver Requests"
        subtitle="Waiver governance and approval control — request, review, decide and apply penalty, interest and fee relief"
        breadcrumbs={[
          { label: 'Compliance', href: '/compliance/dashboard' },
          { label: 'Enforcement', href: '/compliance/enforcement/violations' },
          { label: 'Waiver Requests' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            {actor?.can_request && (
              <Button size="sm" onClick={() => setShowNewRequest(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
                New waiver request
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => register.refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <ComplianceHelpButton screenKey="waivers" />
          </div>
        }
      />

      {isError && (
        <Card className="border-destructive/30">
          <CardContent className="p-3 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {error?.message === 'NOT_AUTHORISED'
              ? 'You do not have access to the waiver register.'
              : (error?.message ?? 'Unable to load the waiver register.')}
          </CardContent>
        </Card>
      )}

      {/* KPI strip */}
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile
          label="Awaiting decision"
          value={kpis.awaiting ?? 0}
          tone="warning"
          hint={`${formatXCD(kpis.awaiting_amount ?? 0)} at stake`}
        />
        <KpiTile
          label="Past the interval"
          value={kpis.overdue ?? 0}
          tone="destructive"
          hint={`Interval ${thresholds?.approval_sla_days ?? 5} day(s)`}
        />
        <KpiTile
          label="Approved this month"
          value={kpis.approved_month ?? 0}
          tone="success"
          hint={formatXCD(kpis.approved_month_amount ?? 0)}
        />
        <KpiTile
          label="Rejected this month"
          value={kpis.rejected_month ?? 0}
          hint={`${kpis.approval_rate ?? 0}% approval rate`}
        />
        <KpiTile
          label="High value pending"
          value={kpis.high_value_pending ?? 0}
          tone="warning"
          hint={`Above ${formatXCD(thresholds?.high_value_amount ?? 0)}`}
        />
        <KpiTile
          label="Approved not applied"
          value={kpis.approved_not_applied ?? 0}
          tone="primary"
          hint={`${kpis.total ?? 0} requests recorded`}
        />
      </div>

      {/* Requires attention */}
      {attention.length > 0 && (
        <Card className="border-warning/40">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <span className="text-sm font-semibold">Requires attention</span>
              <Badge variant="outline">{tabCounts.ATTENTION ?? attention.length}</Badge>
              {filters.tab !== 'ATTENTION' && (
                <Button variant="link" size="sm" className="h-auto p-0" onClick={() => register.setTab('ATTENTION')}>
                  View all
                </Button>
              )}
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {attention.map((a) => (
                <button
                  key={a.waiver_id}
                  type="button"
                  onClick={() => setSelectedWaiverId(a.waiver_id)}
                  className="text-left rounded-md border bg-muted/30 hover:bg-muted p-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{a.waiver_number}</span>
                    <span className="text-muted-foreground">{formatXCD(a.amount_requested)}</span>
                  </div>
                  <div className="text-muted-foreground truncate">{a.employer_name ?? '—'}</div>
                  <div className="text-warning">{a.reason}</div>
                  <div className="text-foreground/80">Waiting {a.waiting_days} day(s)</div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={filters.tab} onValueChange={register.setTab}>
        <TabsList className="flex flex-wrap h-auto">
          {TABS.map((t) => (
            <TabsTrigger key={t.code} value={t.code} className="text-xs">
              {t.label}
              <span className="ml-1.5 text-[10px] text-muted-foreground">{tabCounts[t.code] ?? 0}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Toolbar */}
      <Card>
        <CardContent className="p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder="Search waiver number, employer, registration number, case, violation or justification"
                className="pl-8"
              />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Filter className="h-4 w-4 mr-1.5" />
                  Status
                  {filters.statuses.length > 0 && (
                    <Badge variant="secondary" className="ml-1.5">
                      {filters.statuses.length}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>Request status</DropdownMenuLabel>
                {(facets?.statuses ?? []).map((s) => (
                  <DropdownMenuCheckboxItem
                    key={s.code}
                    checked={filters.statuses.includes(s.code)}
                    onCheckedChange={() => register.toggleListFilter('statuses', s.code)}
                  >
                    {s.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Component
                  {filters.components.length > 0 && (
                    <Badge variant="secondary" className="ml-1.5">
                      {filters.components.length}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Debt component</DropdownMenuLabel>
                {(facets?.components ?? []).map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.code}
                    checked={filters.components.includes(c.code)}
                    onCheckedChange={() => register.toggleListFilter('components', c.code)}
                  >
                    {c.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Scope
                  {filters.scopes.length > 0 && (
                    <Badge variant="secondary" className="ml-1.5">
                      {filters.scopes.length}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Relief scope</DropdownMenuLabel>
                {(facets?.scopes ?? []).map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.code}
                    checked={filters.scopes.includes(c.code)}
                    onCheckedChange={() => register.toggleListFilter('scopes', c.code)}
                  >
                    {c.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Source
                  {filters.sources.length > 0 && (
                    <Badge variant="secondary" className="ml-1.5">
                      {filters.sources.length}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Origin</DropdownMenuLabel>
                {(facets?.sources ?? []).map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.code}
                    checked={filters.sources.includes(c.code)}
                    onCheckedChange={() => register.toggleListFilter('sources', c.code)}
                  >
                    {c.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Select value={filters.sla || 'ANY'} onValueChange={(v) => register.setFilter('sla', v === 'ANY' ? '' : v)}>
              <SelectTrigger className="w-[190px] h-9">
                <SelectValue placeholder="Approval interval" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ANY">Any interval state</SelectItem>
                {SLA_OPTIONS.map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.date_window || 'ANY'}
              onValueChange={(v) => register.setFilter('window', v === 'ANY' ? '' : v)}
            >
              <SelectTrigger className="w-[170px] h-9">
                <SelectValue placeholder="Period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ANY">Any period</SelectItem>
                {WINDOWS.map((w) => (
                  <SelectItem key={w.code} value={w.code}>
                    {w.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.amount_band || 'ANY'}
              onValueChange={(v) => register.setFilter('amount', v === 'ANY' ? '' : v)}
            >
              <SelectTrigger className="w-[170px] h-9">
                <SelectValue placeholder="Amount" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ANY">Any amount</SelectItem>
                {AMOUNT_BANDS.map((a) => (
                  <SelectItem key={a.code} value={a.code}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.employer_id || 'ANY'}
              onValueChange={(v) => register.setFilter('employer', v === 'ANY' ? '' : v)}
            >
              <SelectTrigger className="w-[200px] h-9">
                <SelectValue placeholder="Employer" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="ANY">All employers</SelectItem>
                {(facets?.employers ?? []).map((e) => (
                  <SelectItem key={e.code} value={e.code}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.requested_by || 'ANY'}
              onValueChange={(v) => register.setFilter('requester', v === 'ANY' ? '' : v)}
            >
              <SelectTrigger className="w-[180px] h-9">
                <SelectValue placeholder="Requested by" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="ANY">Any requester</SelectItem>
                <SelectItem value="ME">Raised by me</SelectItem>
                {(facets?.requesters ?? []).map((r) => (
                  <SelectItem key={r.code} value={r.code}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.rule_id || 'ANY'} onValueChange={(v) => register.setFilter('rule', v === 'ANY' ? '' : v)}>
              <SelectTrigger className="w-[200px] h-9">
                <SelectValue placeholder="Waiver rule" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="ANY">Any rule</SelectItem>
                {(facets?.rules ?? []).map((r) => (
                  <SelectItem key={r.code} value={r.code}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {register.hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={register.clearFilters}>
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <Badge key={c.key} variant="secondary" className="gap-1">
                  {c.label}
                  <button type="button" onClick={c.clear} aria-label={`Remove ${c.label}`}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Register */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHeader label="Reference" sortKey="waiver_number" sort={sort} dir={dir} onSort={register.setSort} />
                <SortHeader label="Employer" sortKey="employer" sort={sort} dir={dir} onSort={register.setSort} />
                <TableHead className="text-xs">Case / Violation</TableHead>
                <SortHeader label="Component" sortKey="component" sort={sort} dir={dir} onSort={register.setSort} />
                <SortHeader
                  label="Requested"
                  sortKey="amount_requested"
                  sort={sort}
                  dir={dir}
                  onSort={register.setSort}
                  align="right"
                />
                <SortHeader
                  label="Approved"
                  sortKey="amount_approved"
                  sort={sort}
                  dir={dir}
                  onSort={register.setSort}
                  align="right"
                />
                <SortHeader label="Status" sortKey="status" sort={sort} dir={dir} onSort={register.setSort} />
                <SortHeader label="Requested on" sortKey="requested_at" sort={sort} dir={dir} onSort={register.setSort} />
                <SortHeader label="Waiting" sortKey="waiting" sort={sort} dir={dir} onSort={register.setSort} align="right" />
                <TableHead className="text-xs">Flags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={`sk-${i}`}>
                    <TableCell colSpan={10}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {!isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-10">
                    No waiver requests match this view.
                  </TableCell>
                </TableRow>
              )}

              {rows.map((r) => (
                <TableRow
                  key={r.waiver_id}
                  className="cursor-pointer"
                  onClick={() => setSelectedWaiverId(r.waiver_id)}
                >
                  <TableCell className="text-xs font-medium">{r.waiver_number}</TableCell>
                  <TableCell className="text-xs">
                    <div className="font-medium truncate max-w-[180px]">{r.employer_name ?? '—'}</div>
                    <div className="text-muted-foreground">{r.regno ?? '—'}</div>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{r.case_number ?? <span className="text-warning">No case</span>}</div>
                    <div className="text-muted-foreground">{r.violation_number ?? '—'}</div>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{r.component_label}</div>
                    <div className="text-muted-foreground">{r.scope_label ?? '—'}</div>
                  </TableCell>
                  <TableCell className="text-xs text-right">{formatXCD(r.amount_requested)}</TableCell>
                  <TableCell className="text-xs text-right">
                    {r.amount_approved != null ? formatXCD(r.amount_approved) : '—'}
                  </TableCell>
                  <TableCell className="text-xs">
                    <Badge variant="outline" className={statusToneClass(r.status_tone)}>
                      {r.status_label ?? r.status_code}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{formatDateForDisplay(r.requested_at)}</div>
                    <div className="text-muted-foreground truncate max-w-[140px]">{r.requested_by_name ?? '—'}</div>
                  </TableCell>
                  <TableCell className="text-xs text-right">{r.is_open ? `${r.waiting_days}d` : '—'}</TableCell>
                  <TableCell className="text-xs">
                    <div className="flex flex-wrap gap-1">
                      {r.sla_overdue && (
                        <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                          Overdue
                        </Badge>
                      )}
                      {r.high_value && (
                        <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">
                          High value
                        </Badge>
                      )}
                      {r.exceeds_rule_cap && (
                        <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                          Above ceiling
                        </Badge>
                      )}
                      {r.approved_not_applied && (
                        <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                          Not applied
                        </Badge>
                      )}
                      {r.weak_justification && (
                        <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">
                          Thin justification
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {total === 0 ? 'No records' : `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
        </p>
        <div className="flex items-center gap-2">
          <Select value={String(pageSize)} onValueChange={(v) => register.setPageSize(Number(v))}>
            <SelectTrigger className="w-[110px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WAIVER_PAGE_SIZES.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s} per page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => register.setPage(page - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page} of {pageCount}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => register.setPage(page + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <WaiverDetailDialog waiverId={selectedWaiverId} onClose={() => setSelectedWaiverId(null)} />
      <NewWaiverRequestDialog open={showNewRequest} onClose={() => setShowNewRequest(false)} />
    </div>
  );
}
