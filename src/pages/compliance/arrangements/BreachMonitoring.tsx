import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
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
  PlayCircle,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useRegnoParam } from '@/hooks/useRegnoParam';
import { RegnoFilterBanner } from '@/components/compliance/EmployerLinkChip';
import { formatXCD } from '@/components/compliance/arrangements/arrangementFormat';
import { formatDateForDisplay } from '@/lib/format-config';
import { BreachDetailDialog } from '@/components/compliance/BreachDetailDialog';
import {
  useBreachRegister,
  BREACH_PAGE_SIZES,
  type BreachRegisterRow,
} from '@/hooks/compliance/useBreachRegister';

const sb = supabase as any;

const TABS: { code: string; label: string }[] = [
  { code: 'OPEN', label: 'Open' },
  { code: 'ATTENTION', label: 'Requires attention' },
  { code: 'NEW', label: 'Newly detected' },
  { code: 'REPEATED', label: 'Repeated misses' },
  { code: 'HIGH_VALUE', label: 'High value' },
  { code: 'DEFAULTED', label: 'Defaulted' },
  { code: 'LEGAL', label: 'Legal escalation' },
  { code: 'AUTO', label: 'Auto-detected' },
  { code: 'MINE', label: 'Assigned to me' },
  { code: 'RESOLVED', label: 'Resolved' },
  { code: 'ALL', label: 'All' },
];

const WINDOWS = [
  { code: 'TODAY', label: 'Detected today' },
  { code: 'D7', label: 'Last 7 days' },
  { code: 'D30', label: 'Last 30 days' },
  { code: 'D90', label: 'Last 90 days' },
];

const AMOUNT_BANDS = [
  { code: 'LT1K', label: 'Under 1,000' },
  { code: '1K5K', label: '1,000 – 5,000' },
  { code: '5K10K', label: '5,000 – 10,000' },
  { code: '10K50K', label: '10,000 – 50,000' },
  { code: 'GT50K', label: 'Over 50,000' },
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

function severityClass(severity?: string | null) {
  switch (severity) {
    case 'CRITICAL':
      return 'bg-destructive/10 text-destructive border-destructive/30';
    case 'MATERIAL':
      return 'bg-warning/10 text-warning border-warning/30';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function statusClass(status?: string | null) {
  switch (status) {
    case 'OPEN':
      return 'bg-destructive/10 text-destructive border-destructive/30';
    case 'UNDER_REVIEW':
      return 'bg-warning/10 text-warning border-warning/30';
    case 'RESOLVED':
    case 'CLOSED':
      return 'bg-success/10 text-success border-success/30';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

export default function BreachMonitoring() {
  const navigate = useNavigate();
  const { regno } = useRegnoParam();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();

  const register = useBreachRegister(regno ?? undefined);
  const { data, facets, filters, sort, dir, page, pageSize, isLoading, isFetching, isError, error } = register;

  const [selectedBreachId, setSelectedBreachId] = useState<string | null>(searchParams.get('breach'));

  const rows: BreachRegisterRow[] = data?.rows ?? [];
  const kpis = data?.kpis ?? {};
  const tabCounts = data?.tab_counts ?? {};
  const attention = data?.attention ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const actor = data?.actor;

  const runDetection = useMutation({
    mutationFn: async () => {
      const { data: res, error: err } = await sb.rpc('ce_breach_run_detection_v1', {});
      if (err) throw new Error(err.message);
      if (res?.error) throw new Error(res.message || res.error);
      return res as { detected?: number; cured?: number; defaulted?: number };
    },
    onSuccess: (res) => {
      toast.success(
        `Detection complete — ${res?.detected ?? 0} new breach(es), ${res?.cured ?? 0} cured, ${res?.defaulted ?? 0} defaulted`,
      );
      qc.invalidateQueries({ queryKey: ['ce-breach-register'] });
    },
    onError: (e: any) => toast.error(e.message || 'Detection run failed'),
  });

  const openBreach = useCallback((id: string) => setSelectedBreachId(id), []);

  const activeFilterChips = useMemo(() => {
    const chips: { key: string; label: string; clear: () => void }[] = [];
    filters.types.forEach((t) =>
      chips.push({
        key: `t-${t}`,
        label: facets?.types?.find((x) => x.code === t)?.label ?? t,
        clear: () => register.toggleListFilter('types', t),
      }),
    );
    filters.statuses.forEach((s) =>
      chips.push({
        key: `s-${s}`,
        label: facets?.statuses?.find((x) => x.code === s)?.label ?? s,
        clear: () => register.toggleListFilter('statuses', s),
      }),
    );
    filters.escalations.forEach((e) =>
      chips.push({
        key: `e-${e}`,
        label: facets?.escalations?.find((x) => x.code === e)?.label ?? e,
        clear: () => register.toggleListFilter('escalations', e),
      }),
    );
    filters.health.forEach((h) =>
      chips.push({
        key: `h-${h}`,
        label: facets?.health?.find((x) => x.code === h)?.label ?? h,
        clear: () => register.toggleListFilter('health', h),
      }),
    );
    if (filters.breach_window)
      chips.push({
        key: 'window',
        label: WINDOWS.find((w) => w.code === filters.breach_window)?.label ?? filters.breach_window,
        clear: () => register.setFilter('window', ''),
      });
    if (filters.amount_band)
      chips.push({
        key: 'amount',
        label: AMOUNT_BANDS.find((a) => a.code === filters.amount_band)?.label ?? filters.amount_band,
        clear: () => register.setFilter('amount', ''),
      });
    if (filters.detection)
      chips.push({
        key: 'detection',
        label: filters.detection === 'AUTOMATIC' ? 'Auto-detected' : 'Manually raised',
        clear: () => register.setFilter('detection', ''),
      });
    if (filters.officer)
      chips.push({
        key: 'officer',
        label:
          filters.officer === 'ME'
            ? 'Assigned to me'
            : filters.officer === 'UNASSIGNED'
              ? 'Unassigned'
              : (facets?.officers?.find((o) => o.code === filters.officer)?.label ?? 'Officer'),
        clear: () => register.setFilter('officer', ''),
      });
    if (filters.min_shortfall)
      chips.push({
        key: 'min',
        label: `Shortfall ≥ ${filters.min_shortfall}`,
        clear: () => register.setFilter('min', ''),
      });
    return chips;
  }, [filters, facets, register]);

  return (
    <div className="container mx-auto p-6 space-y-4">
      <PageHeader
        title="Breach Monitoring"
        subtitle="Payment arrangement breach and default control — detection, cure tracking and escalation"
        breadcrumbs={[
          { label: 'Compliance', href: '/compliance/dashboard' },
          { label: 'Payment Arrangements', href: '/compliance/enforcement/arrangements' },
          { label: 'Breach Monitoring' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            {actor?.can_manage && (
              <Button variant="outline" size="sm" onClick={() => runDetection.mutate()} disabled={runDetection.isPending}>
                {runDetection.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <PlayCircle className="h-4 w-4 mr-1.5" />
                )}
                Run detection
              </Button>
            )}
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
              ? 'You do not have access to the breach register.'
              : (error?.message ?? 'Unable to load the breach register.')}
          </CardContent>
        </Card>
      )}

      {/* KPI strip */}
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Open breaches" value={kpis.open_breaches ?? 0} tone="destructive" hint={`${kpis.total ?? 0} recorded`} />
        <KpiTile
          label="Newly detected"
          value={kpis.new_breaches ?? 0}
          tone="warning"
          hint={`Last ${data?.thresholds?.new_breach_days ?? 7} days`}
        />
        <KpiTile label="Defaulted arrangements" value={kpis.defaulted ?? 0} tone="destructive" />
        <KpiTile label="Unpaid exposure" value={formatXCD(kpis.past_due_exposure ?? 0)} tone="destructive" hint="Open breach shortfalls" />
        <KpiTile
          label="Awaiting action"
          value={kpis.awaiting_action ?? 0}
          tone="warning"
          hint={`Response interval ${data?.thresholds?.response_sla_days ?? 5} days`}
        />
        <KpiTile label="Resolved" value={kpis.resolved ?? 0} tone="success" hint={`${kpis.auto_rate ?? 0}% auto-detected`} />
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
                  key={a.breach_id}
                  type="button"
                  onClick={() => openBreach(a.breach_id)}
                  className="text-left rounded-md border bg-muted/30 hover:bg-muted p-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {a.breach_reference} · {a.arrangement_number ?? '—'}
                    </span>
                    <span className="text-muted-foreground">{formatXCD(a.shortfall ?? 0)}</span>
                  </div>
                  <div className="text-muted-foreground truncate">{a.employer_name}</div>
                  <div className="text-warning">{a.reason}</div>
                  <div className="text-foreground/80">Next: {a.next_action}</div>
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
                placeholder="Search breach ref, arrangement, employer, registration no., case or violation"
                className="pl-8 h-9"
              />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                  <Filter className="h-3.5 w-3.5 mr-1.5" />
                  Type{filters.types.length ? ` (${filters.types.length})` : ''}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 bg-popover z-50">
                <DropdownMenuLabel>Breach type</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {(facets?.types ?? []).map((t) => (
                  <DropdownMenuCheckboxItem
                    key={t.code}
                    checked={filters.types.includes(t.code)}
                    onCheckedChange={() => register.toggleListFilter('types', t.code)}
                  >
                    {t.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                  Status{filters.statuses.length ? ` (${filters.statuses.length})` : ''}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52 bg-popover z-50">
                <DropdownMenuLabel>Breach status</DropdownMenuLabel>
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
                  Escalation{filters.escalations.length ? ` (${filters.escalations.length})` : ''}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 bg-popover z-50">
                <DropdownMenuLabel>Escalation status</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {(facets?.escalations ?? []).map((e) => (
                  <DropdownMenuCheckboxItem
                    key={e.code}
                    checked={filters.escalations.includes(e.code)}
                    onCheckedChange={() => register.toggleListFilter('escalations', e.code)}
                  >
                    {e.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Select
              value={filters.breach_window || 'ANY'}
              onValueChange={(v) => register.setFilter('window', v === 'ANY' ? '' : v)}
            >
              <SelectTrigger className="h-9 w-[165px]">
                <SelectValue placeholder="Breach date" />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                <SelectItem value="ANY">Any breach date</SelectItem>
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
              <SelectTrigger className="h-9 w-[170px]">
                <SelectValue placeholder="Shortfall" />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                <SelectItem value="ANY">Any shortfall</SelectItem>
                {AMOUNT_BANDS.map((a) => (
                  <SelectItem key={a.code} value={a.code}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.officer || 'ANY'}
              onValueChange={(v) => register.setFilter('officer', v === 'ANY' ? '' : v)}
            >
              <SelectTrigger className="h-9 w-[175px]">
                <SelectValue placeholder="Officer" />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                <SelectItem value="ANY">Any officer</SelectItem>
                <SelectItem value="ME">Assigned to me</SelectItem>
                <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
                {(facets?.officers ?? []).map((o) => (
                  <SelectItem key={o.code} value={o.code}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.detection || 'ANY'}
              onValueChange={(v) => register.setFilter('detection', v === 'ANY' ? '' : v)}
            >
              <SelectTrigger className="h-9 w-[160px]">
                <SelectValue placeholder="Detection" />
              </SelectTrigger>
              <SelectContent className="bg-popover z-50">
                <SelectItem value="ANY">Any detection</SelectItem>
                {(facets?.detection_methods ?? []).map((d) => (
                  <SelectItem key={d.code} value={d.code}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

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
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHeader label="Breach" sortKey="breach_date" sort={sort} dir={dir} onSort={register.setSort} />
                <SortHeader label="Employer" sortKey="employer" sort={sort} dir={dir} onSort={register.setSort} />
                <SortHeader label="Arrangement" sortKey="arrangement" sort={sort} dir={dir} onSort={register.setSort} />
                <TableHead className="text-xs text-muted-foreground">Instalment</TableHead>
                <SortHeader label="Shortfall" sortKey="shortfall" sort={sort} dir={dir} onSort={register.setSort} align="right" />
                <SortHeader label="Past due" sortKey="past_due" sort={sort} dir={dir} onSort={register.setSort} align="right" />
                <SortHeader label="Misses" sortKey="misses" sort={sort} dir={dir} onSort={register.setSort} align="right" />
                <SortHeader label="Status" sortKey="status" sort={sort} dir={dir} onSort={register.setSort} />
                <SortHeader label="Age" sortKey="age" sort={sort} dir={dir} onSort={register.setSort} align="right" />
                <TableHead className="text-xs text-muted-foreground">Next action</TableHead>
                <TableHead className="text-right text-xs text-muted-foreground">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={11}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-10 text-sm text-muted-foreground">
                    No breaches match the current view.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.breach_id} className="cursor-pointer" onClick={() => openBreach(r.breach_id)}>
                    <TableCell className="align-top">
                      <div className="font-medium text-sm">{r.breach_reference}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatDateForDisplay(r.breach_date)} · {r.detection_method_label ?? r.detection_method}
                      </div>
                      <Badge variant="outline" className={`mt-1 text-[10px] ${severityClass(r.severity)}`}>
                        {r.breach_type_label ?? r.breach_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="text-sm">{r.employer_name ?? r.employer_id ?? '—'}</div>
                      <div className="text-[11px] text-muted-foreground">{r.regno ?? r.employer_id ?? ''}</div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="text-sm">{r.arrangement_number ?? '—'}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {r.arrangement_health_label ?? r.arrangement_status_label ?? ''}
                      </div>
                      {r.case_number && <div className="text-[11px] text-muted-foreground">Case {r.case_number}</div>}
                    </TableCell>
                    <TableCell className="align-top text-xs">
                      {r.installment_number ? (
                        <>
                          <div>#{r.installment_number}</div>
                          <div className="text-muted-foreground">
                            {r.installment_due_date ? formatDateForDisplay(r.installment_due_date) : '—'}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Arrangement level</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top text-right text-sm font-medium">
                      {formatXCD(r.shortfall ?? 0)}
                    </TableCell>
                    <TableCell className="align-top text-right text-sm">
                      <span className={Number(r.arrangement_past_due ?? 0) > 0 ? 'text-destructive font-medium' : ''}>
                        {formatXCD(r.arrangement_past_due ?? 0)}
                      </span>
                    </TableCell>
                    <TableCell className="align-top text-right text-xs">
                      <Badge variant="outline" className="text-[10px]">
                        {r.consecutive_misses}x
                      </Badge>
                    </TableCell>
                    <TableCell className="align-top">
                      <Badge variant="outline" className={`text-[10px] ${statusClass(r.breach_status)}`}>
                        {r.breach_status_label ?? r.breach_status}
                      </Badge>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        {r.escalation_status_label ?? r.escalation_status}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {r.assigned_to_name ?? 'Unassigned'}
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-right text-xs">
                      <span className={r.sla_overdue ? 'text-destructive font-medium' : ''}>{r.age_days}d</span>
                    </TableCell>
                    <TableCell className="align-top text-xs max-w-[190px]">
                      <span className={r.attention_score > 0 ? 'text-warning' : 'text-muted-foreground'}>
                        {r.next_action}
                      </span>
                    </TableCell>
                    <TableCell className="align-top text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          openBreach(r.breach_id);
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
              {BREACH_PAGE_SIZES.map((s) => (
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

      <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg border text-xs text-muted-foreground">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          Breaches are detected automatically from the instalment schedule using the arrangement policy (grace days and
          missed-instalment threshold). A breach is cured automatically once the instalment is settled in the payment
          ledger. Legal escalation is raised from the{' '}
          <Button
            variant="link"
            className="h-auto p-0 text-xs"
            onClick={() => navigate('/compliance/enforcement/arrangements')}
          >
            arrangement record
          </Button>{' '}
          so the referral carries the correct default context.
        </span>
      </div>

      <BreachDetailDialog breachId={selectedBreachId} facets={facets} onClose={() => setSelectedBreachId(null)} />
    </div>
  );
}
