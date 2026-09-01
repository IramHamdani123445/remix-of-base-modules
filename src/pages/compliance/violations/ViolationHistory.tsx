import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Download, Filter, History, Loader2, RotateCcw, Search, X, Eye, AlertTriangle,
} from 'lucide-react';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { formatAuditDateTime } from '@/lib/dateFormat';
import { exportToExcel } from '@/utils/exportUtils';
import { toast } from 'sonner';
import {
  useViolationHistory, HISTORY_SORTS, PAGE_SIZE_OPTIONS,
  type HistoryRow,
} from '@/hooks/compliance/useViolationHistory';

const MODULE = 'manage_compliance';
const ANY = '__ANY__';

/** Canonical violation lifecycle statuses (source: ce_violations.status vocabulary). */
const LIFECYCLE_STATUSES = new Set([
  'OPEN', 'DRAFT', 'IN_PROGRESS', 'UNDER_REVIEW', 'ESCALATED',
  'RESOLVED', 'CLOSED', 'CANCELLED', 'PENDING',
]);

const titleise = (value: string) =>
  value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const statusTone = (value: string) => {
  switch (value.toUpperCase()) {
    case 'RESOLVED':
    case 'CLOSED':
      return 'bg-primary/10 text-primary border-primary/20';
    case 'ESCALATED':
    case 'CANCELLED':
      return 'bg-destructive/10 text-destructive border-destructive/20';
    case 'UNDER_REVIEW':
    case 'PENDING':
      return 'bg-accent/30 text-accent-foreground border-accent/20';
    case 'IN_PROGRESS':
      return 'bg-secondary/10 text-secondary border-secondary/20';
    default:
      return 'bg-muted text-muted-foreground';
  }
};

/** Renders lifecycle statuses as semantic badges; anything else stays plain text. */
function LifecycleValue({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const key = value.toUpperCase();
  if (LIFECYCLE_STATUSES.has(key)) {
    return <Badge variant="outline" className={statusTone(key)}>{titleise(key)}</Badge>;
  }
  return <span className="text-xs">{value}</span>;
}

function Inner() {
  const navigate = useNavigate();
  const q = useViolationHistory();
  const [searchDraft, setSearchDraft] = useState(q.filters.search ?? '');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { setSearchDraft(q.filters.search ?? ''); }, [q.filters.search]);
  useEffect(() => {
    const t = setTimeout(() => {
      if ((q.filters.search ?? '') !== searchDraft) {
        q.patchFilters({ search: searchDraft.trim() || undefined });
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  const sel = (v?: string) => v ?? ANY;
  const toVal = (v: string) => (v === ANY ? undefined : v);

  const violationSelected = Boolean(q.filters.violation_id);
  const start = q.total === 0 ? 0 : (q.page - 1) * q.pageSize + 1;
  const end = Math.min(q.page * q.pageSize, q.total);

  const pageNumbers = useMemo(() => {
    const pages: number[] = [];
    const from = Math.max(1, q.page - 2);
    const to = Math.min(q.totalPages, from + 4);
    for (let p = Math.max(1, to - 4); p <= to; p++) pages.push(p);
    return pages;
  }, [q.page, q.totalPages]);

  const sortIcon = (key: string) =>
    q.sort !== key
      ? <ArrowUpDown className="h-3 w-3 opacity-40" />
      : q.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;

  const Th = ({ label, sortKey, className }: { label: string; sortKey?: string; className?: string }) => (
    <TableHead
      className={`${className ?? ''} ${sortKey ? 'cursor-pointer select-none hover:bg-muted/50' : ''}`}
      onClick={sortKey ? () => q.toggleSort(sortKey) : undefined}
    >
      <div className="flex items-center gap-1">{label}{sortKey && sortIcon(sortKey)}</div>
    </TableHead>
  );

  const activeChips: { label: string; clear: () => void }[] = [];
  const push = (label: string, key: keyof typeof q.filters) =>
    q.filters[key] && activeChips.push({ label, clear: () => q.patchFilters({ [key]: undefined } as any) });
  push(`Search: ${q.filters.search}`, 'search');
  if (q.filters.employer) {
    const name = q.options.employers.find((e) => e.id === q.filters.employer)?.name ?? q.filters.employer;
    activeChips.push({ label: `Employer: ${name}`, clear: () => q.patchFilters({ employer: undefined, violation_id: undefined }) });
  }
  if (q.filters.violation_id) {
    const num = q.summary?.violation_number
      ?? q.options.violations.find((v) => v.id === q.filters.violation_id)?.number
      ?? 'selected';
    activeChips.push({ label: `Violation: ${num}`, clear: () => q.patchFilters({ violation_id: undefined }) });
  }
  if (q.filters.violation_type) {
    const name = q.options.violation_types.find((t) => t.id === q.filters.violation_type)?.name ?? q.filters.violation_type;
    activeChips.push({ label: `Type: ${name}`, clear: () => q.patchFilters({ violation_type: undefined }) });
  }
  push(`Action: ${q.filters.action}`, 'action');
  push(`By: ${q.filters.performed_by}`, 'performed_by');
  push(`From: ${q.filters.from_value}`, 'from_value');
  push(`To: ${q.filters.to_value}`, 'to_value');
  push(`From date: ${q.filters.date_from}`, 'date_from');
  push(`To date: ${q.filters.date_to}`, 'date_to');

  const handleExport = async () => {
    setExporting(true);
    try {
      const rows = await q.fetchAllForExport();
      if (rows.length === 0) { toast.info('Nothing to export for the selected filters'); return; }
      await exportToExcel(
        rows.map((r) => ({
          performed_at: formatAuditDateTime(r.performed_at),
          employer: r.employer_name || r.employer_id || '',
          violation_number: r.violation_number,
          violation_type: r.violation_type || '',
          action: r.action,
          from_value: r.from_value || '',
          to_value: r.to_value || '',
          performed_by: r.performed_by || '',
          notes: r.notes || '',
        })),
        [
          { header: 'Date/Time', key: 'performed_at', width: 22 },
          { header: 'Employer', key: 'employer', width: 28 },
          { header: 'Violation', key: 'violation_number', width: 20 },
          { header: 'Violation Type', key: 'violation_type', width: 24 },
          { header: 'Action', key: 'action', width: 24 },
          { header: 'From', key: 'from_value', width: 18 },
          { header: 'To', key: 'to_value', width: 18 },
          { header: 'Performed By', key: 'performed_by', width: 22 },
          { header: 'Notes', key: 'notes', width: 50 },
        ],
        `violation-history-${new Date().toISOString().slice(0, 10)}`,
        'Violation History',
      );
      toast.success(`Exported ${rows.length.toLocaleString()} history records`);
    } catch (e) {
      console.error('[ViolationHistory] export failed', e);
      toast.error('Unable to export violation history. Please retry.');
    } finally {
      setExporting(false);
    }
  };

  const goToViolation = (row: HistoryRow) => navigate(`/compliance/violations/${row.violation_id}`);

  return (
    <div className="container mx-auto space-y-4 p-6">
      <PageHeader
        title="Violation History"
        subtitle="Read-only audit trail of violation lifecycle events and decisions"
        breadcrumbs={[
          { label: 'Compliance', href: '/compliance' },
          { label: 'Violations', href: '/compliance/violations' },
          { label: 'History' },
        ]}
        actions={
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || q.total === 0}>
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Export filtered history
          </Button>
        }
      />

      {/* Compact filter toolbar */}
      <div className="space-y-3 rounded-lg border bg-card/50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search employer, violation, action, user or notes"
              className="h-9 pl-8"
            />
            {searchDraft && (
              <button type="button" aria-label="Clear search"
                className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
                onClick={() => setSearchDraft('')}>
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <Select value={sel(q.filters.employer)} onValueChange={(v) => q.patchFilters({ employer: toVal(v), violation_id: undefined })}>
            <SelectTrigger className="h-9 w-[210px]"><SelectValue placeholder="All employers" /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={ANY}>All employers</SelectItem>
              {q.options.employers.map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sel(q.filters.violation_id)} onValueChange={(v) => q.patchFilters({ violation_id: toVal(v) })}>
            <SelectTrigger className="h-9 w-[210px]"><SelectValue placeholder="All violations" /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={ANY}>All violations</SelectItem>
              {q.options.violations.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.number}{v.employer_name ? ` — ${v.employer_name}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1">
            <Select value={q.sort} onValueChange={(v) => q.changeSort(v, v === 'performed_at' ? 'desc' : 'asc')}>
              <SelectTrigger className="h-9 w-[190px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {HISTORY_SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-9"
              onClick={() => q.changeSort(q.sort, q.dir === 'asc' ? 'desc' : 'asc')}>
              {q.dir === 'asc' ? 'Oldest first' : 'Newest first'}
            </Button>
          </div>

          <Button variant="ghost" size="sm" className="h-9" onClick={() => setShowAdvanced((s) => !s)}>
            <Filter className="mr-1 h-4 w-4" /> Filters
            {q.activeFilterCount > 0 && <Badge variant="secondary" className="ml-1">{q.activeFilterCount}</Badge>}
          </Button>
          {q.activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" className="h-9" onClick={q.resetFilters}>
              <RotateCcw className="mr-1 h-4 w-4" /> Clear
            </Button>
          )}
        </div>

        {showAdvanced && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Select value={sel(q.filters.violation_type)} onValueChange={(v) => q.patchFilters({ violation_type: toVal(v) })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="All violation types" /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={ANY}>All violation types</SelectItem>
                {q.options.violation_types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sel(q.filters.action)} onValueChange={(v) => q.patchFilters({ action: toVal(v) })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="All actions" /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={ANY}>All actions</SelectItem>
                {q.options.actions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sel(q.filters.performed_by)} onValueChange={(v) => q.patchFilters({ performed_by: toVal(v) })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="All users" /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={ANY}>All users</SelectItem>
                {q.options.performers.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Input type="date" className="h-9" value={q.filters.date_from ?? ''}
                onChange={(e) => q.patchFilters({ date_from: e.target.value || undefined })} />
              <Input type="date" className="h-9" value={q.filters.date_to ?? ''}
                onChange={(e) => q.patchFilters({ date_to: e.target.value || undefined })} />
            </div>
            <Select value={sel(q.filters.from_value)} onValueChange={(v) => q.patchFilters({ from_value: toVal(v) })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Any from status" /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={ANY}>Any from status</SelectItem>
                {q.options.from_values.filter((v) => LIFECYCLE_STATUSES.has(v.toUpperCase()))
                  .map((v) => <SelectItem key={v} value={v}>{titleise(v)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sel(q.filters.to_value)} onValueChange={(v) => q.patchFilters({ to_value: toVal(v) })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Any to status" /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={ANY}>Any to status</SelectItem>
                {q.options.to_values.filter((v) => LIFECYCLE_STATUSES.has(v.toUpperCase()))
                  .map((v) => <SelectItem key={v} value={v}>{titleise(v)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {activeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {activeChips.map((c) => (
              <Badge key={c.label} variant="secondary" className="cursor-pointer gap-1" onClick={c.clear}>
                {c.label}<X className="h-3 w-3" />
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Context summary for a single violation */}
      {violationSelected && q.summary && (
        <Card>
          <CardContent className="grid gap-3 p-4 text-sm sm:grid-cols-3 lg:grid-cols-7">
            <div><p className="text-xs text-muted-foreground">Violation</p>
              <button className="font-mono text-primary hover:underline"
                onClick={() => navigate(`/compliance/violations/${q.summary!.violation_id}`)}>
                {q.summary.violation_number}
              </button></div>
            <div><p className="text-xs text-muted-foreground">Employer</p>
              <span>{q.summary.employer_name || q.summary.employer_id || '—'}</span></div>
            <div><p className="text-xs text-muted-foreground">Type</p><span>{q.summary.violation_type || '—'}</span></div>
            <div><p className="text-xs text-muted-foreground">Current status</p>
              <LifecycleValue value={q.summary.status} /></div>
            <div><p className="text-xs text-muted-foreground">Created</p>
              <span>{q.summary.created_at ? formatAuditDateTime(q.summary.created_at) : '—'}</span></div>
            <div><p className="text-xs text-muted-foreground">Assignee</p><span>{q.summary.assignee || 'Unassigned'}</span></div>
            <div><p className="text-xs text-muted-foreground">History events</p>
              <span className="font-medium">{q.summary.event_count}</span></div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 py-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            {q.total.toLocaleString()} history record{q.total === 1 ? '' : 's'}
            {q.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </CardTitle>
          {violationSelected && (
            <div className="flex items-center gap-1 rounded-md border p-0.5">
              <Button size="sm" variant={q.view === 'table' ? 'secondary' : 'ghost'} className="h-7"
                onClick={() => q.setView('table')}>Table</Button>
              <Button size="sm" variant={q.view === 'timeline' ? 'secondary' : 'ghost'} className="h-7"
                onClick={() => q.setView('timeline')}>Timeline</Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {q.error ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <AlertTriangle className="h-8 w-8 text-destructive" />
              <p className="text-sm font-medium">Unable to load violation history. Please retry.</p>
              <Button variant="outline" size="sm" onClick={() => q.refetch()}>Retry</Button>
            </div>
          ) : q.isLoading ? (
            <div className="space-y-2 py-2">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : q.rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center text-muted-foreground">
              <History className="h-10 w-10" />
              {q.activeFilterCount > 0 ? (
                <>
                  <p className="text-sm">No history records match the selected filters.</p>
                  <Button variant="outline" size="sm" onClick={q.resetFilters}>Clear filters</Button>
                </>
              ) : (
                <p className="text-sm">No violation history exists yet.</p>
              )}
            </div>
          ) : violationSelected && q.view === 'timeline' ? (
            <ol className="relative space-y-4 border-l pl-6">
              {q.rows.map((h) => (
                <li key={h.id} className="relative">
                  <span className="absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-xs text-muted-foreground">{formatAuditDateTime(h.performed_at)}</span>
                    <span className="font-medium">{h.action}</span>
                    {(h.from_value || h.to_value) && (
                      <span className="flex items-center gap-1">
                        <LifecycleValue value={h.from_value} /> <span className="text-muted-foreground">→</span>
                        <LifecycleValue value={h.to_value} />
                      </span>
                    )}
                    {h.performed_by && <span className="text-xs text-muted-foreground">· {h.performed_by}</span>}
                  </div>
                  {h.notes && <p className="mt-1 text-xs text-muted-foreground">{h.notes}</p>}
                </li>
              ))}
            </ol>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <Th label="Date/Time" sortKey="performed_at" />
                    <Th label="Employer" sortKey="employer" />
                    <Th label="Violation" sortKey="violation" />
                    <Th label="Violation Type" />
                    <Th label="Action" sortKey="action" />
                    <Th label="From" sortKey="from_value" />
                    <Th label="To" sortKey="to_value" />
                    <Th label="Performed By" sortKey="performed_by" />
                    <Th label="Notes" />
                    <TableHead className="text-right">View</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.rows.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="whitespace-nowrap text-xs">{formatAuditDateTime(h.performed_at)}</TableCell>
                      <TableCell className="text-xs">
                        {h.employer_id ? (
                          <button className="text-primary hover:underline"
                            onClick={() => navigate(`/compliance/field/employer-360/${h.employer_id}`)}>
                            {h.employer_name || h.employer_id}
                          </button>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-xs">
                        <button className="font-mono text-primary hover:underline" onClick={() => goToViolation(h)}>
                          {h.violation_number}
                        </button>
                      </TableCell>
                      <TableCell className="text-xs">{h.violation_type || '—'}</TableCell>
                      <TableCell><Badge variant="outline">{h.action}</Badge></TableCell>
                      <TableCell><LifecycleValue value={h.from_value} /></TableCell>
                      <TableCell><LifecycleValue value={h.to_value} /></TableCell>
                      <TableCell className="text-xs">{h.performed_by || '—'}</TableCell>
                      <TableCell className="max-w-[220px] text-xs">
                        {h.notes ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="block truncate">{h.notes}</span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-sm">{h.notes}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => goToViolation(h)} aria-label="View violation">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {q.total > 0 && !q.error && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 text-sm">
              <span className="text-muted-foreground">
                Showing {start.toLocaleString()}–{end.toLocaleString()} of {q.total.toLocaleString()} history records
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={String(q.pageSize)} onValueChange={(v) => q.setPageSize(Number(v))}>
                  <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={q.page <= 1} onClick={() => q.setPage(1)}>
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" className="h-8" disabled={q.page <= 1} onClick={() => q.setPage(q.page - 1)}>
                  <ChevronLeft className="mr-1 h-4 w-4" /> Previous
                </Button>
                {pageNumbers.map((p) => (
                  <Button key={p} size="sm" className="h-8 w-8 p-0"
                    variant={p === q.page ? 'default' : 'outline'} onClick={() => q.setPage(p)}>{p}</Button>
                ))}
                <Button variant="outline" size="sm" className="h-8" disabled={q.page >= q.totalPages} onClick={() => q.setPage(q.page + 1)}>
                  Next <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={q.page >= q.totalPages} onClick={() => q.setPage(q.totalPages)}>
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ViolationHistory() {
  return <PermissionWrapper moduleName={MODULE}><Inner /></PermissionWrapper>;
}
