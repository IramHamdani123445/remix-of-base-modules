import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertTriangle,
  ArrowUpDown,
  Building2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
  Gavel,
  Inbox,
  RefreshCw,
  Scale,
  Search,
  Timer,
  X,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { formatDate } from '@/lib/culture/culture';
import { formatXCD } from '@/utils/formatCurrency';
import {
  PROCEEDING_PAGE_SIZES,
  useLegalProceedingRegister,
  type ProceedingRow,
} from '@/hooks/compliance/useLegalProceedingRegister';
import { ProceedingDetailDialog } from '@/components/compliance/legal/ProceedingDetailDialog';

/**
 * Compliance → Legal Proceedings & Enforcement Tracking Register.
 *
 * Read-only Compliance-side tracking of matters that Legal owns after handover.
 * All search, filtering, sorting, paging, KPIs and exception detection are
 * executed server-side by `ce_legal_proceeding_register_v1`.
 */

const TABS = [
  { key: 'ACTIVE', label: 'Active' },
  { key: 'AWAITING_LEGAL', label: 'Awaiting Legal Action' },
  { key: 'HEARING', label: 'Hearing Scheduled' },
  { key: 'JUDGMENT', label: 'Judgment Obtained' },
  { key: 'ENFORCEMENT', label: 'Enforcement' },
  { key: 'RECOVERY', label: 'Recovery Monitoring' },
  { key: 'CLOSED', label: 'Closed' },
  { key: 'ALL', label: 'All' },
];

const SORTS: { key: string; label: string; className?: string }[] = [
  { key: 'attention', label: 'Priority' },
  { key: 'proceeding_no', label: 'Proceeding / Case No.' },
  { key: 'employer', label: 'Employer' },
  { key: 'stage', label: 'Stage' },
  { key: 'filed_date', label: 'Filed' },
  { key: 'next_hearing', label: 'Next Hearing' },
  { key: 'outstanding', label: 'Outstanding', className: 'text-right' },
  { key: 'last_update', label: 'Last Update' },
];

const stageVariant = (group?: string | null): 'destructive' | 'default' | 'secondary' | 'outline' => {
  switch (group) {
    case 'ENFORCEMENT':
      return 'destructive';
    case 'JUDGMENT':
      return 'default';
    case 'RECOVERY':
      return 'secondary';
    case 'CLOSED':
      return 'outline';
    default:
      return 'outline';
  }
};

const money = (v: unknown) => (v === null || v === undefined ? '—' : formatXCD(Number(v)));

const KpiCard = ({
  label,
  value,
  hint,
  tone = 'default',
  onClick,
  active,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'default' | 'warn' | 'danger';
  onClick?: () => void;
  active?: boolean;
}) => (
  <Card
    onClick={onClick}
    className={[
      'transition-colors',
      onClick ? 'cursor-pointer hover:border-primary/60' : '',
      active ? 'border-primary ring-1 ring-primary/30' : '',
    ].join(' ')}
  >
    <CardContent className="p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={[
          'mt-1 text-2xl font-semibold',
          tone === 'danger' ? 'text-destructive' : tone === 'warn' ? 'text-amber-600' : 'text-foreground',
        ].join(' ')}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </CardContent>
  </Card>
);

const MultiSelectFilter = ({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { code: string; label: string }[];
  selected: string[];
  onToggle: (code: string) => void;
}) => (
  <Popover>
    <PopoverTrigger asChild>
      <Button variant="outline" size="sm" className="h-9 justify-between gap-2">
        {label}
        {selected.length > 0 && (
          <Badge variant="secondary" className="px-1.5 text-[10px]">
            {selected.length}
          </Badge>
        )}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="max-h-72 w-64 overflow-y-auto p-2">
      {options.length === 0 && <p className="p-2 text-xs text-muted-foreground">No options</p>}
      {options.map((o) => (
        <label
          key={o.code}
          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
        >
          <Checkbox checked={selected.includes(o.code)} onCheckedChange={() => onToggle(o.code)} />
          <span className="flex-1">{o.label}</span>
        </label>
      ))}
    </PopoverContent>
  </Popover>
);

const AttentionChips = ({ row }: { row: ProceedingRow }) => {
  const chips: { label: string; tone: string }[] = [];
  if (row.hearing_overdue) chips.push({ label: 'Hearing date passed', tone: 'destructive' });
  if (row.hearing_soon) chips.push({ label: 'Hearing soon', tone: 'warn' });
  if (row.judgment_no_enforcement) chips.push({ label: 'Judgment, no enforcement', tone: 'destructive' });
  if (row.awaiting_legal_overdue) chips.push({ label: 'Handover overdue', tone: 'warn' });
  if (row.legal_stale) chips.push({ label: 'No recent activity', tone: 'warn' });
  if (row.no_next_action) chips.push({ label: 'No next action', tone: 'warn' });
  if (chips.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {chips.map((c) => (
        <span
          key={c.label}
          className={[
            'rounded px-1.5 py-0.5 text-[10px] font-medium',
            c.tone === 'destructive'
              ? 'bg-destructive/10 text-destructive'
              : 'bg-amber-500/10 text-amber-700',
          ].join(' ')}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
};

const LegalProceedingsPage = () => {
  const navigate = useNavigate();
  const reg = useLegalProceedingRegister();
  const { filters, data, facets } = reg;
  const [searchInput, setSearchInput] = useState(filters.search);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => setSearchInput(filters.search), [filters.search]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== filters.search) reg.setFilter('q', searchInput);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const kpis = data?.kpis ?? {};
  const canMoney = data?.actor?.can_view_financials ?? false;
  const canOpenLegal = data?.actor?.can_open_legal ?? false;
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(Math.ceil(total / reg.pageSize), 1);
  const from = total === 0 ? 0 : (reg.page - 1) * reg.pageSize + 1;
  const to = Math.min(reg.page * reg.pageSize, total);

  const columns = useMemo(
    () => SORTS.filter((s) => (s.key === 'outstanding' ? canMoney : true)),
    [canMoney],
  );

  return (
    <TooltipProvider>
      <div className="space-y-5 p-6">
        <PageHeader
          title="Legal Proceedings & Enforcement Tracking"
          subtitle="Compliance-side register of matters handed to Legal — court progress, judgments, enforcement and recovery. Read-only: Legal owns the case workflow."
          breadcrumbs={[
            { label: 'Compliance', href: '/compliance' },
            { label: 'Enforcement', href: '/compliance/enforcement/legal-queue' },
            { label: 'Legal Proceedings' },
          ]}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => reg.refetch()} disabled={reg.isFetching}>
                <RefreshCw className={`mr-1 h-4 w-4 ${reg.isFetching ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button size="sm" onClick={() => navigate('/compliance/enforcement/legal-queue')}>
                <Scale className="mr-1 h-4 w-4" />
                Legal Handover Queue
              </Button>
            </div>
          }
        />

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <KpiCard label="Active Proceedings" value={kpis.active ?? 0} />
          <KpiCard
            label="Awaiting Legal Action"
            value={kpis.awaiting_legal ?? 0}
            hint={`${kpis.awaiting_legal_overdue ?? 0} past handover SLA`}
            tone={(kpis.awaiting_legal_overdue ?? 0) > 0 ? 'warn' : 'default'}
            active={filters.tab === 'AWAITING_LEGAL'}
            onClick={() => reg.setTab('AWAITING_LEGAL')}
          />
          <KpiCard
            label="Hearings Next 7 Days"
            value={kpis.hearings_soon ?? 0}
            tone="warn"
            active={filters.hearing_window === 'NEXT_7'}
            onClick={() => reg.setFilter('hearing', filters.hearing_window === 'NEXT_7' ? '' : 'NEXT_7')}
          />
          <KpiCard
            label="Hearings Overdue"
            value={kpis.hearings_overdue ?? 0}
            tone="danger"
            active={filters.hearing_window === 'OVERDUE'}
            onClick={() => reg.setFilter('hearing', filters.hearing_window === 'OVERDUE' ? '' : 'OVERDUE')}
          />
          <KpiCard label="Judgments Obtained" value={kpis.judgments ?? 0} active={filters.tab === 'JUDGMENT'} onClick={() => reg.setTab('JUDGMENT')} />
          <KpiCard
            label="Judgment, No Enforcement"
            value={kpis.judgment_no_enforcement ?? 0}
            tone="danger"
          />
          {canMoney ? (
            <KpiCard
              label="Outstanding Exposure"
              value={money(kpis.outstanding_exposure)}
              hint={`${money(kpis.recovered_total)} recovered`}
            />
          ) : (
            <KpiCard label="Closed Matters" value={kpis.closed ?? 0} onClick={() => reg.setTab('CLOSED')} />
          )}
        </div>

        {/* Requires Attention */}
        {(data?.attention?.length ?? 0) > 0 && (
          <Card className="border-amber-500/40">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                Requires Attention
                <Badge variant="secondary">{data!.attention.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 pt-0">
              {data!.attention.map((a) => (
                <button
                  key={a.row_key}
                  onClick={() => setSelectedKey(a.row_key)}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-mono text-xs text-muted-foreground">{a.proceeding_no}</span>{' '}
                    <span className="font-medium">{a.employer_name}</span>
                    <span className="ml-2 text-muted-foreground">— {a.reason}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{a.stage_label}</span>
                  {canMoney && (
                    <span className="w-28 shrink-0 text-right text-xs font-medium">
                      {money(a.outstanding_amount)}
                    </span>
                  )}
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 border-b">
          {TABS.map((t) => {
            const count = data?.tab_counts?.[t.key];
            const active = filters.tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => reg.setTab(t.key)}
                className={[
                  '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
                  active
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {t.label}
                {count !== undefined && (
                  <Badge variant={active ? 'default' : 'secondary'} className="ml-2 px-1.5 text-[10px]">
                    {count}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[260px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search employer, case no., court case no., referral, intake…"
              className="h-9 pl-9"
            />
          </div>

          <Select
            value={filters.employer_id || 'ALL'}
            onValueChange={(v) => reg.setFilter('employer', v === 'ALL' ? '' : v)}
          >
            <SelectTrigger className="h-9 w-[190px]">
              <SelectValue placeholder="Employer" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All employers</SelectItem>
              {(facets?.employers ?? []).map((e) => (
                <SelectItem key={e.code} value={e.code}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <MultiSelectFilter
            label="Stage"
            options={facets?.stages ?? []}
            selected={filters.stages}
            onToggle={(c) => reg.toggleListFilter('stages', c)}
          />
          <MultiSelectFilter
            label="Outcome"
            options={facets?.outcomes ?? []}
            selected={filters.outcomes}
            onToggle={(c) => reg.toggleListFilter('outcomes', c)}
          />
          <MultiSelectFilter
            label="Recovery"
            options={facets?.recovery ?? []}
            selected={filters.recovery}
            onToggle={(c) => reg.toggleListFilter('recovery', c)}
          />

          <Select
            value={filters.court || 'ALL'}
            onValueChange={(v) => reg.setFilter('court', v === 'ALL' ? '' : v)}
          >
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue placeholder="Court" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All courts</SelectItem>
              {(facets?.courts ?? []).map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                <Filter className="mr-1 h-4 w-4" />
                More
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Filed from</Label>
                  <Input
                    type="date"
                    className="h-9"
                    value={filters.filed_from}
                    onChange={(e) => reg.setFilter('filed_from', e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Filed to</Label>
                  <Input
                    type="date"
                    className="h-9"
                    value={filters.filed_to}
                    onChange={(e) => reg.setFilter('filed_to', e.target.value)}
                  />
                </div>
              </div>
              {canMoney && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Min outstanding</Label>
                    <Input
                      type="number"
                      className="h-9"
                      value={filters.amount_min}
                      onChange={(e) => reg.setFilter('amount_min', e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Max outstanding</Label>
                    <Input
                      type="number"
                      className="h-9"
                      value={filters.amount_max}
                      onChange={(e) => reg.setFilter('amount_max', e.target.value)}
                    />
                  </div>
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs">Hearing window</Label>
                <Select
                  value={filters.hearing_window || 'ALL'}
                  onValueChange={(v) => reg.setFilter('hearing', v === 'ALL' ? '' : v)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Any</SelectItem>
                    <SelectItem value="OVERDUE">Date passed</SelectItem>
                    <SelectItem value="NEXT_7">Next 7 days</SelectItem>
                    <SelectItem value="NEXT_30">Next 30 days</SelectItem>
                    <SelectItem value="NONE">No hearing scheduled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Legal officer</Label>
                <Select
                  value={filters.officer || 'ALL'}
                  onValueChange={(v) => reg.setFilter('officer', v === 'ALL' ? '' : v)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All officers</SelectItem>
                    {(facets?.officers ?? []).map((o) => (
                      <SelectItem key={o.code} value={o.code}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </PopoverContent>
          </Popover>

          {reg.hasActiveFilters && (
            <Button variant="ghost" size="sm" className="h-9" onClick={reg.clearFilters}>
              <X className="mr-1 h-4 w-4" />
              Clear
            </Button>
          )}
        </div>

        {/* Stage distribution */}
        {(data?.stage_distribution?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-2">
            {data!.stage_distribution.map((s) => (
              <button
                key={s.code}
                onClick={() => reg.toggleListFilter('stages', s.code)}
                className={[
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  filters.stages.includes(s.code)
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {s.label} <span className="font-semibold">{s.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Register */}
        <Card>
          <CardContent className="p-0">
            {reg.isError && (
              <div className="flex flex-col items-center gap-3 p-10 text-center">
                <AlertTriangle className="h-8 w-8 text-destructive" />
                <div>
                  <p className="font-medium">Unable to load the proceedings register</p>
                  <p className="text-sm text-muted-foreground">{reg.error?.message}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => reg.refetch()}>
                  <RefreshCw className="mr-1 h-4 w-4" /> Retry
                </Button>
              </div>
            )}

            {!reg.isError && reg.isLoading && (
              <div className="space-y-2 p-4">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            )}

            {!reg.isError && !reg.isLoading && rows.length === 0 && (
              <div className="flex flex-col items-center gap-2 p-12 text-center">
                <Inbox className="h-10 w-10 text-muted-foreground" />
                <p className="font-medium">No proceedings match this view</p>
                <p className="text-sm text-muted-foreground">
                  {reg.hasActiveFilters
                    ? 'Try clearing filters or switching tab.'
                    : 'Matters appear here once Legal accepts a Compliance referral.'}
                </p>
                {reg.hasActiveFilters && (
                  <Button variant="outline" size="sm" onClick={reg.clearFilters}>
                    Clear filters
                  </Button>
                )}
              </div>
            )}

            {!reg.isError && !reg.isLoading && rows.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {columns.map((c) => (
                        <TableHead key={c.key} className={c.className}>
                          <button
                            className="inline-flex items-center gap-1 hover:text-foreground"
                            onClick={() => reg.setSort(c.key)}
                          >
                            {c.label}
                            <ArrowUpDown
                              className={`h-3 w-3 ${reg.sort === c.key ? 'text-primary' : 'text-muted-foreground/50'}`}
                            />
                          </button>
                        </TableHead>
                      ))}
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow
                        key={r.row_key}
                        className="cursor-pointer"
                        onClick={() => setSelectedKey(r.row_key)}
                      >
                        <TableCell>
                          {r.attention_score > 0 ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-destructive">
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                  {r.attention_score}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>Exception score — higher needs attention sooner</TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="font-mono text-xs font-medium">{r.proceeding_no ?? '—'}</div>
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            {r.court_case_no && <span>Court {r.court_case_no}</span>}
                            {r.is_legacy && (
                              <Badge variant="outline" className="px-1 text-[9px]">
                                Legacy
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 font-medium">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            {r.employer_name ?? '—'}
                          </div>
                          <AttentionChips row={r} />
                        </TableCell>
                        <TableCell>
                          <Badge variant={stageVariant(r.stage_group)}>{r.stage_label}</Badge>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {r.court_name ?? 'Court not set'}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.filed_date ? formatDate(r.filed_date) : '—'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.next_hearing_date ? (
                            <span
                              className={
                                r.hearing_overdue
                                  ? 'font-medium text-destructive'
                                  : r.hearing_soon
                                    ? 'font-medium text-amber-600'
                                    : ''
                              }
                            >
                              {formatDate(r.next_hearing_date)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        {canMoney && (
                          <TableCell className="text-right text-sm font-medium">
                            {money(r.outstanding_amount)}
                          </TableCell>
                        )}
                        <TableCell className="text-sm">
                          {r.last_legal_update ? (
                            <span className={r.legal_stale ? 'text-amber-600' : ''}>
                              {formatDate(r.last_legal_update)}
                            </span>
                          ) : (
                            '—'
                          )}
                          <div className="text-[11px] text-muted-foreground">{r.recovery_label}</div>
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="sm" onClick={() => setSelectedKey(r.row_key)}>
                              <Gavel className="mr-1 h-3.5 w-3.5" /> View
                            </Button>
                            {r.lg_case_id && canOpenLegal && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="icon" asChild>
                                    <Link to={`/legal/lg/cases/${r.lg_case_id}`}>
                                      <ExternalLink className="h-3.5 w-3.5" />
                                    </Link>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Open in Legal module</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {!reg.isError && rows.length > 0 && (
              <>
                <Separator />
                <div className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>
                      Showing {from}–{to} of {total}
                    </span>
                    <Select
                      value={String(reg.pageSize)}
                      onValueChange={(v) => reg.setPageSize(Number(v))}
                    >
                      <SelectTrigger className="h-8 w-[90px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PROCEEDING_PAGE_SIZES.map((s) => (
                          <SelectItem key={s} value={String(s)}>
                            {s} / page
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={reg.page <= 1}
                      onClick={() => reg.setPage(reg.page - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm">
                      Page {reg.page} of {pageCount}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={reg.page >= pageCount}
                      onClick={() => reg.setPage(reg.page + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Timer className="h-3.5 w-3.5" />
          Thresholds: hearing alert {data?.thresholds?.hearing_soon_days ?? 7} days, stale activity{' '}
          {data?.thresholds?.stale_days ?? 30} days, handover SLA {data?.thresholds?.handover_days ?? 5} days.
        </p>

        <ProceedingDetailDialog
          rowKey={selectedKey}
          onClose={() => setSelectedKey(null)}
          canOpenLegal={canOpenLegal}
        />
      </div>
    </TooltipProvider>
  );
};

export default LegalProceedingsPage;
