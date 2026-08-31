import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/shared/PageHeader';
import { MultiSelect, titleise } from '@/components/compliance/ListFilterControls';
import { exportToExcel } from '@/utils/exportUtils';
import {
  useEmployerStatements, STATEMENT_SORTS, POSITION_LABELS, BAND_LABELS, FUND_LABELS,
  PAGE_SIZE_OPTIONS, type StatementRow,
} from '@/hooks/compliance/useEmployerStatements';
import {
  AlertTriangle, ArrowDownUp, CalendarDays, ChevronLeft, ChevronRight, Download,
  FileText, Filter, Loader2, RefreshCw, Search, Shield, X,
} from 'lucide-react';

const currency = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'XCD', minimumFractionDigits: 2 }).format(v || 0);

const compact = (v: number) =>
  `XCD ${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v || 0)}`;

const formatDate = (v: string | null) => {
  if (!v) return '—';
  try { return new Date(v).toLocaleDateString('en-GB'); } catch { return v; }
};

const POSITION_STYLES: Record<string, string> = {
  IN_ARREARS: 'bg-destructive/10 text-destructive border-destructive/30',
  UNDER_ARRANGEMENT: 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400',
  SETTLED: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400',
  IN_CREDIT: 'bg-sky-500/10 text-sky-700 border-sky-500/30 dark:text-sky-400',
};

const BAND_STYLES: Record<string, string> = {
  CURRENT: 'text-muted-foreground',
  '0_3': 'text-foreground',
  '4_12': 'text-amber-600 dark:text-amber-400',
  '13_36': 'text-orange-600 dark:text-orange-400',
  '36_PLUS': 'text-destructive',
};

function Kpi({
  label, value, hint, tone = 'default', onClick, active,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'danger' | 'warn' | 'good';
  onClick?: () => void;
  active?: boolean;
}) {
  const toneClass =
    tone === 'danger' ? 'text-destructive'
      : tone === 'warn' ? 'text-amber-600 dark:text-amber-400'
        : tone === 'good' ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-foreground';
  return (
    <Card
      className={`${onClick ? 'cursor-pointer transition-colors hover:border-primary/50' : ''} ${active ? 'border-primary' : ''}`}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-1 text-xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default function EmployerStatements() {
  const navigate = useNavigate();
  const q = useEmployerStatements();
  const [exporting, setExporting] = useState(false);
  const [searchDraft, setSearchDraft] = useState(q.filters.search ?? '');

  const from = q.total === 0 ? 0 : (q.page - 1) * q.pageSize + 1;
  const to = Math.min(q.page * q.pageSize, q.total);

  const chips: { label: string; clear: () => void }[] = [];
  const push = (label: string | undefined, clear: () => void) => {
    if (label) chips.push({ label, clear });
  };
  push(q.filters.search && `Search: ${q.filters.search}`, () => {
    setSearchDraft('');
    q.patchFilters({ search: undefined });
  });
  push(q.filters.territory && `Territory: ${q.filters.territory}`, () => q.patchFilters({ territory: undefined }));
  (q.filters.positions ?? []).forEach((p) =>
    push(POSITION_LABELS[p] ?? titleise(p), () => q.toggleInList('positions', p)));
  (q.filters.bands ?? []).forEach((b) =>
    push(`Age: ${BAND_LABELS[b] ?? b}`, () => q.toggleInList('bands', b)));
  (q.filters.funds ?? []).forEach((f) =>
    push(`Fund: ${f}`, () => q.toggleInList('funds', f)));
  push(q.filters.arrangement && (q.filters.arrangement === 'yes' ? 'Has arrangement' : 'No arrangement'),
    () => q.patchFilters({ arrangement: undefined }));
  push(q.filters.min_outstanding && `Min ${q.filters.min_outstanding}`, () => q.patchFilters({ min_outstanding: undefined }));
  push(q.filters.max_outstanding && `Max ${q.filters.max_outstanding}`, () => q.patchFilters({ max_outstanding: undefined }));
  push(q.filters.period_from && `From period ${q.filters.period_from}`, () => q.patchFilters({ period_from: undefined }));
  push(q.filters.period_to && `To period ${q.filters.period_to}`, () => q.patchFilters({ period_to: undefined }));

  const handleExport = async () => {
    setExporting(true);
    try {
      const rows = await q.fetchAllForExport();
      if (rows.length === 0) { toast.info('Nothing to export for the selected filters'); return; }
      await exportToExcel(
        rows.map((r) => ({
          employer_id: r.employer_id,
          employer_name: r.employer_name,
          territory: r.territory,
          position: POSITION_LABELS[r.position_status] ?? r.position_status,
          principal: r.principal_outstanding,
          penalty: r.penalty_outstanding,
          interest: r.interest_outstanding,
          outstanding: r.total_outstanding,
          charged: r.total_charged,
          paid: r.payments_received,
          credit: r.credit_available,
          oldest_period: r.oldest_arrears_period || '',
          age_months: r.arrears_age_months,
          periods: r.period_count,
          funds: (r.funds_in_arrears || []).join(', '),
          arrangement: r.arrangement_status || '',
          open_violations: r.open_violations,
          open_cases: r.open_cases,
          last_payment: r.last_payment_at ? formatDate(r.last_payment_at) : '',
        })),
        [
          { header: 'Registration No.', key: 'employer_id', width: 16 },
          { header: 'Employer', key: 'employer_name', width: 32 },
          { header: 'Territory', key: 'territory', width: 12 },
          { header: 'Position', key: 'position', width: 18 },
          { header: 'Principal Outstanding', key: 'principal', width: 20 },
          { header: 'Penalty Outstanding', key: 'penalty', width: 20 },
          { header: 'Interest Outstanding', key: 'interest', width: 20 },
          { header: 'Total Outstanding', key: 'outstanding', width: 20 },
          { header: 'Total Charged', key: 'charged', width: 18 },
          { header: 'Total Paid', key: 'paid', width: 16 },
          { header: 'Credit Available', key: 'credit', width: 16 },
          { header: 'Oldest Arrears Period', key: 'oldest_period', width: 20 },
          { header: 'Arrears Age (months)', key: 'age_months', width: 20 },
          { header: 'Periods', key: 'periods', width: 10 },
          { header: 'Funds in Arrears', key: 'funds', width: 22 },
          { header: 'Arrangement', key: 'arrangement', width: 18 },
          { header: 'Open Violations', key: 'open_violations', width: 16 },
          { header: 'Open Cases', key: 'open_cases', width: 14 },
          { header: 'Last Payment', key: 'last_payment', width: 16 },
        ],
        `employer-statement-register-${q.asOf}`,
        'Statement Register',
      );
      toast.success(`Exported ${rows.length.toLocaleString()} employer statements`);
    } catch (e) {
      console.error('[EmployerStatements] export failed', e);
      toast.error('Unable to export the statement register. Please retry.');
    } finally {
      setExporting(false);
    }
  };

  const openStatement = (row: StatementRow) =>
    navigate(`/compliance/field/employer-statement/${row.employer_id}?as_of=${q.asOf}`);

  const forbidden = /FORBIDDEN|permission denied/i.test(q.error?.message ?? '');

  return (
    <div className="container mx-auto space-y-4 p-6">
      <PageHeader
        title="Employer Statement Register"
        subtitle="Authoritative financial position per employer, computed from the posted compliance ledger"
        breadcrumbs={[
          { label: 'Compliance', href: '/compliance' },
          { label: 'Employer Statements' },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-md border bg-card px-2 py-1">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Statement as of</span>
              <Input
                type="date"
                value={q.asOf}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => q.setAsOf(e.target.value)}
                className="h-8 w-[150px] border-0 px-1 text-sm shadow-none focus-visible:ring-0"
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${q.isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={handleExport} disabled={exporting || !q.canExport || q.total === 0}>
              {exporting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
              Export register
            </Button>
          </div>
        }
      />

      {q.error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-3 p-4">
            <Shield className="mt-0.5 h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium text-destructive">
                {forbidden ? 'You do not have access to the statement register' : 'Unable to load the statement register'}
              </p>
              <p className="text-sm text-muted-foreground">
                {forbidden
                  ? 'Compliance reporting, violation or case-handling permissions are required to view employer financial positions.'
                  : q.error.message}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi
          label="Total outstanding"
          value={compact(q.kpisFiltered.outstanding)}
          hint={`${q.kpisFiltered.employers.toLocaleString()} employers in view`}
          tone="danger"
        />
        <Kpi label="Principal" value={compact(q.kpisFiltered.principal)} hint="Contributions due" />
        <Kpi label="Penalty" value={compact(q.kpisFiltered.penalty)} hint="Assessed penalties" tone="warn" />
        <Kpi label="Interest" value={compact(q.kpisFiltered.interest)} hint="Accrued interest" tone="warn" />
        <Kpi
          label="In arrears"
          value={q.kpisAll.in_arrears.toLocaleString()}
          hint={`${q.kpisAll.under_arrangement} under arrangement`}
          tone="danger"
          active={(q.filters.positions ?? []).includes('IN_ARREARS')}
          onClick={() => q.applyQuickFilter({ positions: ['IN_ARREARS'] })}
        />
        <Kpi
          label="Aged over 12 months"
          value={compact(q.kpisAll.aged_over_12m)}
          hint={`Oldest ${q.kpisAll.oldest_months} months`}
          tone="danger"
          active={(q.filters.bands ?? []).includes('13_36')}
          onClick={() => q.applyQuickFilter({ bands: ['13_36', '36_PLUS'] })}
        />
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <form
              className="relative min-w-[240px] flex-1"
              onSubmit={(e) => { e.preventDefault(); q.patchFilters({ search: searchDraft || undefined }); }}
            >
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                onBlur={() => q.patchFilters({ search: searchDraft || undefined })}
                placeholder="Search employer name or registration no. — press Enter"
                className="h-9 pl-9"
              />
            </form>

            <MultiSelect
              label="Position"
              values={q.filters.positions ?? []}
              options={q.options.positions}
              onToggle={(v) => q.toggleInList('positions', v)}
              format={(v) => POSITION_LABELS[v] ?? titleise(v)}
            />
            <MultiSelect
              label="Arrears age"
              values={q.filters.bands ?? []}
              options={q.options.bands}
              onToggle={(v) => q.toggleInList('bands', v)}
              format={(v) => BAND_LABELS[v] ?? v}
            />
            <MultiSelect
              label="Fund"
              values={q.filters.funds ?? []}
              options={q.options.funds}
              onToggle={(v) => q.toggleInList('funds', v)}
              width="w-[170px]"
              format={(v) => FUND_LABELS[v] ?? v}
            />

            <Select
              value={q.filters.territory ?? 'all'}
              onValueChange={(v) => q.patchFilters({ territory: v === 'all' ? undefined : v })}
            >
              <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="Territory" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All territories</SelectItem>
                {q.options.territories.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={q.filters.arrangement ?? 'all'}
              onValueChange={(v) => q.patchFilters({ arrangement: v === 'all' ? undefined : v })}
            >
              <SelectTrigger className="h-9 w-[170px]"><SelectValue placeholder="Arrangement" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any arrangement</SelectItem>
                <SelectItem value="yes">Has arrangement</SelectItem>
                <SelectItem value="no">No arrangement</SelectItem>
              </SelectContent>
            </Select>

            <Input
              value={q.filters.min_outstanding ?? ''}
              onChange={(e) => q.patchFilters({ min_outstanding: e.target.value || undefined })}
              placeholder="Min balance"
              inputMode="decimal"
              className="h-9 w-[120px]"
            />
            <Input
              value={q.filters.period_from ?? ''}
              onChange={(e) => q.patchFilters({ period_from: e.target.value || undefined })}
              placeholder="From YYYY-MM"
              className="h-9 w-[130px]"
            />

            <Separator orientation="vertical" className="h-8" />

            <Select value={q.sort} onValueChange={(v) => q.changeSort(v)}>
              <SelectTrigger className="h-9 w-[200px]">
                <ArrowDownUp className="mr-1.5 h-3.5 w-3.5 opacity-70" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATEMENT_SORTS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-9" onClick={q.toggleDir}>
              {q.dir === 'desc' ? 'Desc' : 'Asc'}
            </Button>
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              {chips.map((c, i) => (
                <Badge key={`${c.label}-${i}`} variant="secondary" className="gap-1 font-normal">
                  {c.label}
                  <button type="button" onClick={c.clear} aria-label={`Remove ${c.label}`}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => { setSearchDraft(''); q.resetFilters(); }}
              >
                Clear all
              </Button>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Balances reflect posted, non-reversed ledger entries for periods up to{' '}
            <span className="font-medium text-foreground">{q.periodCutoff || q.asOf.slice(0, 7)}</span>, with payments
            allocated principal → penalty → interest.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {q.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : q.rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <FileText className="h-8 w-8 text-muted-foreground" />
              <p className="font-medium">No employer statements match this view</p>
              <p className="text-sm text-muted-foreground">
                Adjust the statement date or clear the filters to widen the register.
              </p>
              {q.activeFilterCount > 0 && (
                <Button variant="outline" size="sm" onClick={() => { setSearchDraft(''); q.resetFilters(); }}>
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <TooltipProvider>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[280px]">Employer</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead className="text-right">Principal</TableHead>
                    <TableHead className="text-right">Penalty</TableHead>
                    <TableHead className="text-right">Interest</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead>Arrears age</TableHead>
                    <TableHead>Exposure</TableHead>
                    <TableHead className="text-right">Last payment</TableHead>
                    <TableHead className="w-[110px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.rows.map((r) => (
                    <TableRow
                      key={r.employer_id}
                      className="cursor-pointer"
                      onClick={() => openStatement(r)}
                    >
                      <TableCell>
                        <div className="font-medium leading-tight">{r.employer_name}</div>
                        <div className="text-xs text-muted-foreground">
                          <span className="font-mono">{r.employer_id}</span> · {r.territory} · {r.period_count} period{r.period_count === 1 ? '' : 's'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={POSITION_STYLES[r.position_status]}>
                          {POSITION_LABELS[r.position_status] ?? r.position_status}
                        </Badge>
                        {r.arrangement_status && (
                          <div className="mt-0.5 text-xs text-muted-foreground">{titleise(r.arrangement_status)}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{currency(r.principal_outstanding)}</TableCell>
                      <TableCell className="text-right tabular-nums">{currency(r.penalty_outstanding)}</TableCell>
                      <TableCell className="text-right tabular-nums">{currency(r.interest_outstanding)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {currency(r.total_outstanding)}
                        {r.credit_available > 0 && (
                          <div className="text-xs font-normal text-sky-600 dark:text-sky-400">
                            Credit {currency(r.credit_available)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className={`text-sm ${BAND_STYLES[r.ageing_band] ?? ''}`}>
                          {BAND_LABELS[r.ageing_band] ?? r.ageing_band}
                        </span>
                        {r.oldest_arrears_period && (
                          <div className="text-xs text-muted-foreground">since {r.oldest_arrears_period}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(r.funds_in_arrears ?? []).map((f) => (
                            <Tooltip key={f}>
                              <TooltipTrigger asChild>
                                <Badge variant="secondary" className="px-1.5 text-[10px] font-medium">{f}</Badge>
                              </TooltipTrigger>
                              <TooltipContent>{FUND_LABELS[f] ?? f}</TooltipContent>
                            </Tooltip>
                          ))}
                          {r.open_violations > 0 && (
                            <Badge variant="outline" className="gap-1 px-1.5 text-[10px]">
                              <AlertTriangle className="h-3 w-3" />{r.open_violations}
                            </Badge>
                          )}
                          {r.open_cases > 0 && (
                            <Badge variant="outline" className="px-1.5 text-[10px]">{r.open_cases} case{r.open_cases === 1 ? '' : 's'}</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {formatDate(r.last_payment_at)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); openStatement(r); }}
                        >
                          Statement
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {q.total === 0 ? 'No employers' : `Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${q.total.toLocaleString()} employers`}
        </p>
        <div className="flex items-center gap-2">
          <Select value={String(q.pageSize)} onValueChange={(v) => q.setPageSize(Number(v))}>
            <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" disabled={q.page <= 1} onClick={() => q.setPage(q.page - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm tabular-nums">Page {q.page} of {q.totalPages}</span>
          <Button variant="outline" size="sm" disabled={q.page >= q.totalPages} onClick={() => q.setPage(q.page + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
