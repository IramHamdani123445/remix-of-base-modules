import { useCallback, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ArrangementDetailPanel } from '@/components/compliance/ArrangementDetailPanel';
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
  DropdownMenuSeparator,
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
  Info,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useRegnoParam } from '@/hooks/useRegnoParam';
import { RegnoFilterBanner } from '@/components/compliance/EmployerLinkChip';
import {
  formatXCD,
  ArrangementHealthBadge,
  arrangementStatusClass,
} from '@/components/compliance/arrangements/arrangementFormat';
import { formatDateForDisplay } from '@/lib/format-config';
import {
  useArrangementRegister,
  ARRANGEMENT_PAGE_SIZES,
  type ArrangementRegisterRowExt,
} from '@/hooks/compliance/useArrangementRegister';

const sb = supabase as any;

const TABS: { code: string; label: string }[] = [
  { code: 'ALL', label: 'All' },
  { code: 'ATTENTION', label: 'Requires attention' },
  { code: 'ACTIVE', label: 'Active' },
  { code: 'OVERDUE', label: 'Overdue' },
  { code: 'BREACHED', label: 'Breached' },
  { code: 'PENDING_APPROVAL', label: 'Awaiting approval' },
  { code: 'DRAFT', label: 'Draft' },
  { code: 'UNALLOCATED', label: 'Unallocated money' },
  { code: 'CLOSED', label: 'Closed' },
];

const DUE_WINDOWS = [
  { code: 'OVERDUE', label: 'Has overdue instalments' },
  { code: 'TODAY', label: 'Next instalment today' },
  { code: 'D7', label: 'Next instalment ≤ 7 days' },
  { code: 'D30', label: 'Next instalment ≤ 30 days' },
  { code: 'NONE', label: 'No scheduled instalment' },
];

const CREATED_WINDOWS = [
  { code: 'TODAY', label: 'Created today' },
  { code: 'D7', label: 'Last 7 days' },
  { code: 'D30', label: 'Last 30 days' },
  { code: 'D90', label: 'Last 90 days' },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
        ? 'text-warning-foreground'
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
        {active ? (
          dir === 'asc' ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : null}
      </button>
    </TableHead>
  );
}

export default function PaymentArrangements() {
  const navigate = useNavigate();
  const { regno } = useRegnoParam();
  const { arrangementId: routeArrangementId } = useParams<{ arrangementId?: string }>();
  const [searchParams] = useSearchParams();

  const selectedArrangementId = routeArrangementId ?? searchParams.get('arr');

  const register = useArrangementRegister(regno ?? undefined);
  const { data, facets, filters, sort, dir, page, pageSize, isLoading, isFetching, isError, error } = register;

  const openArrangement = useCallback(
    (id: string) => {
      const qs = searchParams.toString();
      navigate(
        `/compliance/enforcement/arrangements/${encodeURIComponent(id)}${
          qs ? `?${qs.replace(/(^|&)arr=[^&]*/g, '').replace(/^&/, '')}` : ''
        }`,
      );
    },
    [navigate, searchParams],
  );

  const closeArrangement = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('arr');
    const qs = next.toString();
    navigate(`/compliance/enforcement/arrangements${qs ? `?${qs}` : ''}`, { replace: true });
  }, [navigate, searchParams]);

  // Deep links may use an arrangement number (e.g. U020-ARR-008) instead of the id.
  const { data: resolved, isLoading: resolving } = useQuery({
    queryKey: ['ce-arrangement-resolve', selectedArrangementId],
    enabled: Boolean(selectedArrangementId) && !UUID_RE.test(selectedArrangementId ?? ''),
    queryFn: async () => {
      const { data: row } = await sb
        .from('ce_v_arrangement_register')
        .select('arrangement_id, arrangement_number')
        .ilike('arrangement_number', selectedArrangementId as string)
        .maybeSingle();
      return row as { arrangement_id: string; arrangement_number: string } | null;
    },
  });

  const rows: ArrangementRegisterRowExt[] = data?.rows ?? [];
  const kpis = data?.kpis ?? {};
  const tabCounts = data?.tab_counts ?? {};
  const attention = data?.attention ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const activeFilterChips = useMemo(() => {
    const chips: { key: string; label: string; clear: () => void }[] = [];
    filters.statuses.forEach((s) =>
      chips.push({
        key: `s-${s}`,
        label: facets?.statuses?.find((x) => x.code === s)?.label ?? s,
        clear: () => register.toggleListFilter('statuses', s),
      }),
    );
    filters.health.forEach((h) =>
      chips.push({
        key: `h-${h}`,
        label: facets?.health?.find((x) => x.code === h)?.label ?? h,
        clear: () => register.toggleListFilter('health', h),
      }),
    );
    filters.frequencies.forEach((f) =>
      chips.push({
        key: `f-${f}`,
        label: facets?.frequencies?.find((x) => x.code === f)?.label ?? f,
        clear: () => register.toggleListFilter('frequencies', f),
      }),
    );
    if (filters.due_window)
      chips.push({
        key: 'due',
        label: DUE_WINDOWS.find((d) => d.code === filters.due_window)?.label ?? filters.due_window,
        clear: () => register.setFilter('due', ''),
      });
    if (filters.created_window)
      chips.push({
        key: 'created',
        label: CREATED_WINDOWS.find((d) => d.code === filters.created_window)?.label ?? filters.created_window,
        clear: () => register.setFilter('created', ''),
      });
    if (filters.min_outstanding)
      chips.push({
        key: 'min',
        label: `Outstanding ≥ ${filters.min_outstanding}`,
        clear: () => register.setFilter('min_out', ''),
      });
    return chips;
  }, [filters, facets, register]);

  if (selectedArrangementId) {
    if (resolving) {
      return (
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      );
    }
    const resolvedId = resolved?.arrangement_id ?? selectedArrangementId;
    return (
      <div className="container mx-auto p-6 space-y-6">
        <PageHeader
          title="Arrangement Detail"
          subtitle="Operational view for compliance officers"
          breadcrumbs={[
            { label: 'Compliance', href: '/compliance/dashboard' },
            { label: 'Payment Arrangements', href: '/compliance/enforcement/arrangements' },
            { label: resolved?.arrangement_number ?? 'Detail' },
          ]}
        />
        <ArrangementDetailPanel arrangementId={resolvedId} onBack={closeArrangement} />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-4">
      <PageHeader
        title="Payment Arrangements"
        subtitle="Arrangement monitoring and default control — schedule adherence, arrears and breach visibility"
        breadcrumbs={[
          { label: 'Compliance', href: '/compliance/dashboard' },
          { label: 'Payment Arrangements' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => register.refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <ComplianceHelpButton screenKey="arrangements" />
          </div>
        }
      />

      <RegnoFilterBanner />

      {isError && (
        <Card className="border-destructive/30">
          <CardContent className="p-3 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {error?.message === 'NOT_AUTHORISED'
              ? 'You do not have access to the payment arrangement register.'
              : (error?.message ?? 'Unable to load the arrangement register.')}
          </CardContent>
        </Card>
      )}

      {/* KPI strip */}
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Arrangements" value={kpis.total_arrangements ?? 0} hint={`${kpis.active ?? 0} active`} />
        <KpiTile label="Awaiting approval" value={kpis.pending_approval ?? 0} tone="warning" />
        <KpiTile
          label="Breached / defaulted"
          value={`${kpis.breached ?? 0} / ${kpis.defaulted ?? 0}`}
          tone="destructive"
        />
        <KpiTile label="Outstanding" value={formatXCD(kpis.outstanding_total ?? 0)} />
        <KpiTile label="Past due" value={formatXCD(kpis.past_due_total ?? 0)} tone="destructive" />
        <KpiTile
          label="Unallocated receipts"
          value={formatXCD(kpis.unallocated_total ?? 0)}
          tone="warning"
          hint="Money received, not yet applied"
        />
      </div>

      {/* Requires attention */}
      {attention.length > 0 && (
        <Card className="border-warning/40">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning-foreground" />
              <span className="text-sm font-semibold">Requires attention</span>
              <Badge variant="outline">{kpis.attention ?? attention.length}</Badge>
              {register.filters.tab !== 'ATTENTION' && (
                <Button variant="link" size="sm" className="h-auto p-0" onClick={() => register.setTab('ATTENTION')}>
                  View all
                </Button>
              )}
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {attention.map((a) => (
                <button
                  key={a.arrangement_id}
                  type="button"
                  onClick={() => openArrangement(a.arrangement_id)}
                  className="text-left rounded-md border bg-muted/30 hover:bg-muted p-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{a.arrangement_number ?? a.arrangement_id.slice(0, 8)}</span>
                    <span className="text-muted-foreground">{formatXCD(a.outstanding ?? 0)}</span>
                  </div>
                  <div className="text-muted-foreground truncate">{a.employer_name}</div>
                  <div className="text-warning-foreground">{a.reason}</div>
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
                value={filters.search}
                onChange={(e) => register.setFilter('q', e.target.value)}
                placeholder="Search arrangement no., employer, registration no., case or violation"
                className="pl-8 h-9"
              />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                  <Filter className="h-3.5 w-3.5 mr-1.5" />
                  Status{filters.statuses.length ? ` (${filters.statuses.length})` : ''}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 bg-popover z-50">
                <DropdownMenuLabel>Arrangement status</DropdownMenuLabel>
                <DropdownMenuSeparator />
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
                <Button variant="outline" size="sm" className="h-9">
                  Health{filters.health.length ? ` (${filters.health.length})` : ''}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52 bg-popover z-50">
                <DropdownMenuLabel>Arrangement health</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {(facets?.health ?? []).map((h) => (
                  <DropdownMenuCheckboxItem
                    key={h.code}
                    checked={filters.health.includes(h.code)}
                    onCheckedChange={() => register.toggleListFilter('health', h.code)}
                  >
                    {h.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                  Frequency{filters.frequencies.length ? ` (${filters.frequencies.length})` : ''}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48 bg-popover z-50">
                <DropdownMenuLabel>Instalment frequency</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {(facets?.frequencies ?? []).map((f) => (
                  <DropdownMenuCheckboxItem
                    key={f.code}
                    checked={filters.frequencies.includes(f.code)}
                    onCheckedChange={() => register.toggleListFilter('frequencies', f.code)}
                  >
                    {f.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Select value={filters.due_window || 'ANY'} onValueChange={(v) => register.setFilter('due', v === 'ANY' ? '' : v)}>
              <SelectTrigger className="h-9 w-[210px]">
                <SelectValue placeholder="Instalment due" />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                <SelectItem value="ANY">Any instalment timing</SelectItem>
                {DUE_WINDOWS.map((d) => (
                  <SelectItem key={d.code} value={d.code}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.created_window || 'ANY'}
              onValueChange={(v) => register.setFilter('created', v === 'ANY' ? '' : v)}
            >
              <SelectTrigger className="h-9 w-[160px]">
                <SelectValue placeholder="Created" />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                <SelectItem value="ANY">Any created date</SelectItem>
                {CREATED_WINDOWS.map((d) => (
                  <SelectItem key={d.code} value={d.code}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              type="number"
              min={0}
              value={filters.min_outstanding}
              onChange={(e) => register.setFilter('min_out', e.target.value)}
              placeholder="Min outstanding"
              className="h-9 w-[150px]"
            />

            {register.hasActiveFilters && (
              <Button variant="ghost" size="sm" className="h-9" onClick={register.clearFilters}>
                <X className="h-3.5 w-3.5 mr-1" />
                Clear
              </Button>
            )}
          </div>

          {activeFilterChips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {activeFilterChips.map((c) => (
                <Badge key={c.key} variant="secondary" className="gap-1 cursor-pointer" onClick={c.clear}>
                  {c.label}
                  <X className="h-3 w-3" />
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Register table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHeader label="Arrangement" sortKey="arrangement_number" sort={sort} dir={dir} onSort={register.setSort} />
                <SortHeader label="Employer" sortKey="employer" sort={sort} dir={dir} onSort={register.setSort} />
                <SortHeader label="Status" sortKey="status" sort={sort} dir={dir} onSort={register.setSort} />
                <SortHeader label="Health" sortKey="health" sort={sort} dir={dir} onSort={register.setSort} />
                <TableHead className="text-xs text-muted-foreground">Schedule</TableHead>
                <SortHeader label="Progress" sortKey="paid_percent" sort={sort} dir={dir} onSort={register.setSort} align="right" />
                <SortHeader label="Outstanding" sortKey="outstanding" sort={sort} dir={dir} onSort={register.setSort} align="right" />
                <SortHeader label="Past due" sortKey="past_due" sort={sort} dir={dir} onSort={register.setSort} align="right" />
                <SortHeader label="Next due" sortKey="next_due_date" sort={sort} dir={dir} onSort={register.setSort} />
                <TableHead className="text-right text-xs text-muted-foreground">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={10}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-10 text-sm text-muted-foreground">
                    No arrangements match the current view.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow
                    key={r.arrangement_id}
                    className="cursor-pointer"
                    onClick={() => openArrangement(r.arrangement_id)}
                  >
                    <TableCell className="align-top">
                      <div className="font-medium text-sm">{r.arrangement_number ?? '—'}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {r.case_number ? `Case ${r.case_number}` : 'No linked case'}
                      </div>
                      {r.attention_score > 0 && (
                        <Badge variant="outline" className="mt-1 text-[10px] border-warning/40 text-warning-foreground">
                          Attention
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="text-sm">{r.employer_name ?? r.employer_id ?? '—'}</div>
                      <div className="text-[11px] text-muted-foreground">{r.regno ?? r.employer_id ?? ''}</div>
                    </TableCell>
                    <TableCell className="align-top">
                      <Badge className={arrangementStatusClass(r.status)}>{r.status_label ?? r.status}</Badge>
                    </TableCell>
                    <TableCell className="align-top">
                      <ArrangementHealthBadge health={r.health_status} />
                      {r.unresolved_breach_count > 0 && (
                        <div className="text-[11px] text-destructive mt-1">
                          {r.unresolved_breach_count} unresolved breach(es)
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="align-top text-xs">
                      <div>
                        {r.installments_paid}/{r.installments_total} paid
                      </div>
                      {r.overdue_count > 0 && (
                        <div className="text-destructive">{r.overdue_count} overdue</div>
                      )}
                      {Number(r.unattributed_amount ?? 0) > 0 && (
                        <div className="text-warning-foreground">
                          {formatXCD(r.unattributed_amount)} unallocated
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="align-top text-right text-xs">
                      <div className="font-medium">{Number(r.paid_percent ?? 0).toFixed(1)}%</div>
                      <div className="text-muted-foreground">{formatXCD(r.total_paid ?? 0)}</div>
                    </TableCell>
                    <TableCell className="align-top text-right text-sm font-medium">
                      {formatXCD(r.outstanding ?? 0)}
                    </TableCell>
                    <TableCell className="align-top text-right text-sm">
                      <span className={Number(r.past_due_amount ?? 0) > 0 ? 'text-destructive font-medium' : ''}>
                        {formatXCD(r.past_due_amount ?? 0)}
                      </span>
                    </TableCell>
                    <TableCell className="align-top text-xs">
                      {r.next_due_date ? (
                        <>
                          <div>{formatDateForDisplay(r.next_due_date)}</div>
                          {r.days_to_next_due !== null && (
                            <div className={r.days_to_next_due < 0 ? 'text-destructive' : 'text-muted-foreground'}>
                              {r.days_to_next_due < 0
                                ? `${Math.abs(r.days_to_next_due)} days late`
                                : `in ${r.days_to_next_due} days`}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          openArrangement(r.arrangement_id);
                        }}
                      >
                        Open
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="text-muted-foreground">
          {total === 0 ? 'No records' : `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
          {isFetching && <Loader2 className="inline h-3 w-3 ml-2 animate-spin" />}
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(pageSize)} onValueChange={(v) => register.setPageSize(Number(v))}>
            <SelectTrigger className="h-8 w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover z-50">
              {ARRANGEMENT_PAGE_SIZES.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s} / page
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

      <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg border text-xs text-muted-foreground">
        <Info className="h-4 w-4 shrink-0" />
        <span>
          Arrangements are created from an individual{' '}
          <Button variant="link" className="h-auto p-0 text-xs" onClick={() => navigate('/compliance/cases')}>
            Compliance Case
          </Button>
          . Legal referral for a defaulting arrangement is raised from the arrangement record itself, so the referral
          always carries the correct employer and default context.
        </span>
      </div>
    </div>
  );
}
