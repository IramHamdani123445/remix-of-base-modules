/**
 * Compliance → Inspection Findings
 * Enterprise Findings Register & Disposition Workspace (`/compliance/field/findings`).
 *
 * This is the MASTER lifecycle register for every inspection finding in the
 * user's authorised scope — pending, flagged, informational and converted.
 * The Conversion Queue (`/compliance/inspections/convert-finding`) remains the
 * narrower work queue of findings still eligible for promotion.
 *
 * All search, filtering, sorting, paging, KPIs and export run server-side via
 * `ce_findings_register_v1`; dispositions and conversions go exclusively
 * through the governed RPCs shared with the Conversion Queue.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowRightLeft, Building2, CheckCircle2, ChevronDown, ChevronLeft,
  ChevronRight, ClipboardCheck, Download, Eye, FileWarning, Filter, Loader2, Paperclip,
  RefreshCw, Search, ShieldAlert, X,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { exportToExcel } from '@/utils/exportUtils';
import { useHasCapability } from '@/hooks/useHasCapability';
import { COMPLIANCE_CAPABILITIES } from '@/lib/compliance/capabilities';
import {
  useFindingsRegister, useActiveViolationTypes,
  QUICK_FILTERS, DISPOSITION_OPTIONS, VIOLATION_OUTCOME_OPTIONS, REGISTER_SORTS,
  SEVERITY_OPTIONS, AGE_BUCKETS, EVIDENCE_OPTIONS, DATE_PRESETS, PAGE_SIZE_OPTIONS,
  type FindingsRegisterRow,
} from '@/hooks/compliance/useFindingsRegister';
import { FindingDetailDialog } from '@/components/compliance/findings/FindingDetailDialog';

const safeDate = (v?: string | null, pattern = 'dd MMM yyyy') => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  try { return format(d, pattern); } catch { return 'Unknown'; }
};

const clean = (v?: string | null, fallback = '—') =>
  v && String(v).trim() ? String(v).replace(/_/g, ' ') : fallback;

function severityTone(severity?: string | null) {
  switch ((severity || '').toLowerCase()) {
    case 'critical': return 'bg-destructive/15 text-destructive border-destructive/30';
    case 'high': return 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30';
    case 'medium': return 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30';
    case 'low': return 'bg-muted text-muted-foreground border-border';
    default: return 'bg-muted text-muted-foreground border-border';
  }
}

function dispositionTone(code: string) {
  switch (code) {
    case 'CONVERTED': return 'bg-primary/15 text-primary border-primary/30';
    case 'VIOLATION_CANDIDATE': return 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30';
    case 'FLAG_FOR_REVIEW': return 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30';
    case 'INFORMATIONAL': return 'bg-muted text-muted-foreground border-border';
    default: return 'bg-secondary text-secondary-foreground border-border';
  }
}

function ageTone(days: number, pending: boolean) {
  if (!pending) return 'text-muted-foreground';
  if (days >= 15) return 'text-destructive font-medium';
  if (days >= 8) return 'text-orange-600 dark:text-orange-400';
  return 'text-muted-foreground';
}

export default function EmployerFindings() {
  const navigate = useNavigate();
  const q = useFindingsRegister();
  const violationTypes = useActiveViolationTypes();

  const canReview = useHasCapability(COMPLIANCE_CAPABILITIES.VIOLATIONS_MANAGE);
  const canConvert = useHasCapability(COMPLIANCE_CAPABILITIES.VIOLATIONS_MANAGE);

  const [selected, setSelected] = useState<FindingsRegisterRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [searchDraft, setSearchDraft] = useState(q.filters.search ?? '');

  const totalPages = Math.max(1, Math.ceil(q.total / q.pageSize));
  const from = q.total === 0 ? 0 : (q.page - 1) * q.pageSize + 1;
  const to = Math.min(q.page * q.pageSize, q.total);

  const chips = useMemo(() => {
    const out: { label: string; clear: () => void }[] = [];
    const f = q.filters;
    if (f.search) out.push({ label: `Search: ${f.search}`, clear: () => { setSearchDraft(''); q.patchFilters({ search: undefined }); } });
    (['severities', 'finding_types', 'categories', 'dispositions'] as const).forEach((k) =>
      (f[k] ?? []).forEach((v) => out.push({ label: `${clean(v)}`, clear: () => q.toggleInList(k, v) })),
    );
    if (f.employer) out.push({ label: 'Employer filter', clear: () => q.patchFilters({ employer: undefined }) });
    if (f.inspection_id) out.push({ label: 'Inspection filter', clear: () => q.patchFilters({ inspection_id: undefined }) });
    if (f.inspector) out.push({ label: 'Inspector filter', clear: () => q.patchFilters({ inspector: undefined }) });
    if (f.territory) out.push({ label: `Zone: ${f.territory}`, clear: () => q.patchFilters({ territory: undefined }) });
    if (f.age) out.push({ label: `Age: ${AGE_BUCKETS.find((a) => a.value === f.age)?.label ?? f.age}`, clear: () => q.patchFilters({ age: undefined }) });
    if (f.evidence) out.push({ label: EVIDENCE_OPTIONS.find((e) => e.value === f.evidence)?.label ?? 'Evidence', clear: () => q.patchFilters({ evidence: undefined }) });
    if (f.violation_outcome) out.push({ label: VIOLATION_OUTCOME_OPTIONS.find((o) => o.value === f.violation_outcome)?.label ?? 'Outcome', clear: () => q.patchFilters({ violation_outcome: undefined }) });
    if (f.mine_only) out.push({ label: 'My inspections', clear: () => q.patchFilters({ mine_only: undefined }) });
    if (q.datePreset !== '90') {
      out.push({ label: `Period: ${DATE_PRESETS.find((d) => d.value === q.datePreset)?.label ?? 'Custom'}`, clear: () => q.setDatePreset('90') });
    }
    return out;
  }, [q]);

  const openDetail = (row: FindingsRegisterRow) => { setSelected(row); setDetailOpen(true); };

  const handleExport = async () => {
    setExporting(true);
    try {
      const rows = await q.fetchAllForExport();
      if (rows.length === 0) { toast.info('There is nothing to export for the current filters.'); return; }
      await exportToExcel(
        rows.map((r) => ({
          created_at: safeDate(r.created_at),
          employer: r.employer_name || 'Unavailable',
          inspection: r.inspection_number || 'Unavailable',
          title: r.title || 'Untitled finding',
          finding_type: clean(r.finding_type, 'Unclassified'),
          category: clean(r.category, 'Uncategorised'),
          severity: clean(r.severity, 'Unknown'),
          disposition: clean(r.disposition_code),
          outcome: clean(r.violation_outcome),
          violation_number: r.violation_number || '',
          evidence_count: r.evidence_count,
          age_days: r.age_days,
          inspector: r.inspector_name || 'Unassigned',
          territory: clean(r.territory),
          reviewed_by: r.reviewed_by || '',
          reviewed_at: safeDate(r.reviewed_at),
          review_notes: r.review_notes || '',
        })),
        [
          { header: 'Finding Date', key: 'created_at', width: 14 },
          { header: 'Employer', key: 'employer', width: 30 },
          { header: 'Inspection', key: 'inspection', width: 18 },
          { header: 'Finding', key: 'title', width: 40 },
          { header: 'Type', key: 'finding_type', width: 20 },
          { header: 'Category', key: 'category', width: 18 },
          { header: 'Severity', key: 'severity', width: 12 },
          { header: 'Disposition', key: 'disposition', width: 22 },
          { header: 'Violation Outcome', key: 'outcome', width: 22 },
          { header: 'Violation No.', key: 'violation_number', width: 18 },
          { header: 'Evidence', key: 'evidence_count', width: 10 },
          { header: 'Age (days)', key: 'age_days', width: 11 },
          { header: 'Inspector', key: 'inspector', width: 22 },
          { header: 'Zone', key: 'territory', width: 14 },
          { header: 'Reviewed By', key: 'reviewed_by', width: 22 },
          { header: 'Reviewed On', key: 'reviewed_at', width: 14 },
          { header: 'Review Notes', key: 'review_notes', width: 50 },
        ],
        `inspection-findings-register-${new Date().toISOString().slice(0, 10)}`,
        'Findings Register',
      );
      toast.success(`Exported ${rows.length.toLocaleString()} findings.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The export could not be produced.');
    } finally {
      setExporting(false);
    }
  };

  const sortButton = (key: string, label: string, className = '') => (
    <TableHead className={className}>
      <button
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => q.toggleSort(key)}
      >
        {label}
        {q.sort === key ? (
          <ChevronDown className={`h-3 w-3 transition-transform ${q.dir === 'asc' ? 'rotate-180' : ''}`} />
        ) : null}
      </button>
    </TableHead>
  );

  return (
    <TooltipProvider>
      <div className="container mx-auto space-y-4 p-6">
        {/* ------------------------------------------------------ header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <FileWarning className="h-6 w-6 text-primary" />
              Inspection Findings Register
            </h1>
            <p className="text-sm text-muted-foreground max-w-3xl">
              Master lifecycle register of every inspection finding in your authorised scope — pending review,
              flagged, advisory and converted. Use the Conversion Queue for the narrower list of findings still
              awaiting promotion to a violation.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
              <RefreshCw className={`h-4 w-4 mr-2 ${q.isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || q.total === 0}>
              {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              Export
            </Button>
            <Button size="sm" onClick={() => navigate('/compliance/inspections/convert-finding')}>
              <ArrowRightLeft className="h-4 w-4 mr-2" />
              Conversion Queue
              {q.conversionQueueCount > 0 ? (
                <Badge variant="secondary" className="ml-2">{q.conversionQueueCount}</Badge>
              ) : null}
            </Button>
          </div>
        </div>

        {q.scope ? (
          <p className="text-xs text-muted-foreground">
            Scope: <span className="font-medium">{clean(q.scope)}</span>
            {q.actorCode ? ` · acting as ${q.actorCode}` : ''} — you only see findings you are authorised to review.
          </p>
        ) : null}

        {/* -------------------------------------------------------- KPIs */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Kpi label="Total findings" value={q.kpis.total} icon={ClipboardCheck}
            onClick={() => q.patchFilters({ quick: 'ALL' })} loading={q.isLoading} />
          <Kpi label="Pending review" value={q.kpis.pending_review} icon={AlertTriangle} tone="warning"
            onClick={() => q.patchFilters({ quick: 'PENDING' })} loading={q.isLoading} />
          <Kpi label="Critical / High" value={q.kpis.critical_high} icon={ShieldAlert} tone="danger"
            onClick={() => q.patchFilters({ quick: 'CRITICAL_HIGH' })} loading={q.isLoading} />
          <Kpi label="Converted" value={q.kpis.converted} icon={CheckCircle2} tone="primary"
            onClick={() => q.patchFilters({ quick: 'CONVERTED' })} loading={q.isLoading} />
          <Kpi label="No violation required" value={q.kpis.no_violation} icon={FileWarning}
            onClick={() => q.patchFilters({ quick: 'NO_VIOLATION' })} loading={q.isLoading} />
          <Kpi label="Missing evidence" value={q.kpis.no_evidence} icon={Paperclip} tone="warning"
            onClick={() => q.patchFilters({ quick: 'NO_EVIDENCE' })} loading={q.isLoading} />
        </div>
        {q.kpis.oldest_pending ? (
          <p className="text-xs text-muted-foreground">
            Oldest unreviewed finding was raised {safeDate(q.kpis.oldest_pending)}.
          </p>
        ) : null}

        {/* ----------------------------------------------------- toolbar */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Register</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <form
                className="relative flex-1 min-w-[240px]"
                onSubmit={(e) => { e.preventDefault(); q.patchFilters({ search: searchDraft || undefined }); }}
              >
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search finding, employer, inspection number, violation number…"
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                />
              </form>

              <Select value={q.filters.quick ?? 'ALL'} onValueChange={(v) => q.patchFilters({ quick: v })}>
                <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {QUICK_FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={q.datePreset} onValueChange={q.setDatePreset}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DATE_PRESETS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                  <SelectItem value="CUSTOM">Custom range</SelectItem>
                </SelectContent>
              </Select>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Filter className="h-4 w-4 mr-2" />
                    Filters
                    {q.activeFilterCount > 0 ? <Badge variant="secondary" className="ml-2">{q.activeFilterCount}</Badge> : null}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[380px] max-h-[70vh] overflow-y-auto space-y-4">
                  {q.datePreset === 'CUSTOM' ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">From</Label>
                        <Input type="date" value={q.filters.date_from ?? ''}
                          onChange={(e) => q.patchFilters({ date_from: e.target.value || undefined })} />
                      </div>
                      <div>
                        <Label className="text-xs">To</Label>
                        <Input type="date" value={q.filters.date_to ?? ''}
                          onChange={(e) => q.patchFilters({ date_to: e.target.value || undefined })} />
                      </div>
                    </div>
                  ) : null}

                  <CheckGroup label="Severity" values={SEVERITY_OPTIONS.map((s) => ({ value: s, label: s }))}
                    selected={q.filters.severities ?? []} onToggle={(v) => q.toggleInList('severities', v)} />
                  <CheckGroup label="Disposition" values={DISPOSITION_OPTIONS}
                    selected={q.filters.dispositions ?? []} onToggle={(v) => q.toggleInList('dispositions', v)} />
                  {q.facets.finding_types.length ? (
                    <CheckGroup label="Finding type" values={q.facets.finding_types.map((t) => ({ value: t, label: clean(t) }))}
                      selected={q.filters.finding_types ?? []} onToggle={(v) => q.toggleInList('finding_types', v)} />
                  ) : null}
                  {q.facets.categories.length ? (
                    <CheckGroup label="Category" values={q.facets.categories.map((t) => ({ value: t, label: clean(t) }))}
                      selected={q.filters.categories ?? []} onToggle={(v) => q.toggleInList('categories', v)} />
                  ) : null}

                  <Separator />

                  <FilterSelect label="Employer" value={q.filters.employer}
                    onChange={(v) => q.patchFilters({ employer: v })}
                    options={q.facets.employers.map((e) => ({ value: e.id, label: e.name }))} />
                  <FilterSelect label="Inspection" value={q.filters.inspection_id}
                    onChange={(v) => q.patchFilters({ inspection_id: v })}
                    options={q.facets.inspections.map((i) => ({ value: i.id, label: `${i.number} — ${i.employer}` }))} />
                  <FilterSelect label="Inspector" value={q.filters.inspector}
                    onChange={(v) => q.patchFilters({ inspector: v })}
                    options={q.facets.inspectors.map((i) => ({ value: i.id, label: i.name }))} />
                  <FilterSelect label="Zone / territory" value={q.filters.territory}
                    onChange={(v) => q.patchFilters({ territory: v })}
                    options={q.facets.territories.map((t) => ({ value: t, label: t }))} />
                  <FilterSelect label="Pending age" value={q.filters.age}
                    onChange={(v) => q.patchFilters({ age: v })} options={AGE_BUCKETS} />
                  <FilterSelect label="Evidence" value={q.filters.evidence}
                    onChange={(v) => q.patchFilters({ evidence: v })} options={EVIDENCE_OPTIONS} />
                  <FilterSelect label="Violation outcome" value={q.filters.violation_outcome}
                    onChange={(v) => q.patchFilters({ violation_outcome: v })} options={VIOLATION_OUTCOME_OPTIONS} />

                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={!!q.filters.mine_only}
                      onCheckedChange={(c) => q.patchFilters({ mine_only: c ? true : undefined })} />
                    Only findings from my inspections
                  </label>

                  <Button variant="ghost" size="sm" className="w-full" onClick={q.resetFilters}>
                    Clear all filters
                  </Button>
                </PopoverContent>
              </Popover>

              <Select value={q.sort} onValueChange={q.changeSort}>
                <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REGISTER_SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {chips.length ? (
              <div className="flex flex-wrap gap-2">
                {chips.map((c, i) => (
                  <Badge key={`${c.label}-${i}`} variant="secondary" className="gap-1">
                    {c.label}
                    <button onClick={c.clear} aria-label={`Remove ${c.label}`}><X className="h-3 w-3" /></button>
                  </Badge>
                ))}
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={q.resetFilters}>Clear all</Button>
              </div>
            ) : null}

            {/* --------------------------------------------------- table */}
            {q.error ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>The findings register could not be loaded</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>{q.error.message}</p>
                  <Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>
                </AlertDescription>
              </Alert>
            ) : q.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : q.rows.length === 0 ? (
              <div className="text-center py-12">
                <FileWarning className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="font-medium">No findings match the current filters</p>
                <p className="text-sm text-muted-foreground">
                  {q.activeFilterCount > 0
                    ? 'Adjust or clear the filters to widen the register.'
                    : 'No inspection findings have been recorded in the selected period.'}
                </p>
                {q.activeFilterCount > 0 ? (
                  <Button variant="outline" size="sm" className="mt-3" onClick={q.resetFilters}>Clear filters</Button>
                ) : null}
              </div>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {sortButton('created_at', 'Date')}
                      {sortButton('employer', 'Employer')}
                      {sortButton('inspection', 'Inspection')}
                      <TableHead>Finding</TableHead>
                      {sortButton('finding_type', 'Type')}
                      {sortButton('severity', 'Severity')}
                      {sortButton('disposition', 'Disposition')}
                      {sortButton('violation', 'Outcome')}
                      {sortButton('evidence', 'Evidence')}
                      {sortButton('age', 'Age')}
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {q.rows.map((r) => {
                      const pending = r.disposition_code === 'PENDING_REVIEW' || r.disposition_code === 'FLAG_FOR_REVIEW';
                      return (
                        <TableRow key={r.id} className="cursor-pointer" onClick={() => openDetail(r)}>
                          <TableCell className="whitespace-nowrap text-xs">{safeDate(r.created_at)}</TableCell>
                          <TableCell className="max-w-[200px]">
                            <button
                              className="text-left hover:underline text-primary truncate block max-w-full"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (r.employer_id) navigate(`/compliance/field/employer-360/${r.employer_id}`);
                              }}
                            >
                              <span className="inline-flex items-center gap-1">
                                <Building2 className="h-3 w-3 shrink-0" />
                                {r.employer_name || 'Employer unavailable'}
                              </span>
                            </button>
                            <span className="text-xs text-muted-foreground">{clean(r.territory)}</span>
                          </TableCell>
                          <TableCell className="font-mono text-xs whitespace-nowrap">
                            {r.inspection_number || 'Unavailable'}
                          </TableCell>
                          <TableCell className="max-w-[260px]">
                            <div className="truncate font-medium text-sm">{r.title?.trim() || 'Untitled finding'}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {r.description?.trim() || 'No description recorded'}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">{clean(r.finding_type, 'Unclassified')}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={severityTone(r.severity)}>
                              {clean(r.severity, 'Unknown')}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={dispositionTone(r.disposition_code)}>
                              {clean(r.disposition_code)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {r.violation_id ? (
                              <button
                                className="text-primary hover:underline font-mono text-xs"
                                onClick={(e) => { e.stopPropagation(); navigate(`/compliance/violations/${r.violation_id}`); }}
                              >
                                {r.violation_number || 'View violation'}
                              </button>
                            ) : (
                              <span className="text-xs text-muted-foreground">{clean(r.violation_outcome)}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {r.evidence_count > 0 ? (
                              <span className="inline-flex items-center gap-1 text-xs">
                                <Paperclip className="h-3 w-3" />{r.evidence_count}
                              </span>
                            ) : (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                                    <AlertTriangle className="h-3 w-3" />None
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>No evidence is attached to this finding.</TooltipContent>
                              </Tooltip>
                            )}
                          </TableCell>
                          <TableCell className={`text-xs whitespace-nowrap ${ageTone(r.age_days, pending)}`}>
                            {r.age_days}d
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openDetail(r); }}>
                              <Eye className="h-4 w-4 mr-1" />
                              {canReview && !r.violation_created ? 'Review' : 'View'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* ---------------------------------------------- pagination */}
            {q.total > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <p className="text-sm text-muted-foreground">
                  Showing {from.toLocaleString()}–{to.toLocaleString()} of {q.total.toLocaleString()} findings
                </p>
                <div className="flex items-center gap-2">
                  <Select value={String(q.pageSize)} onValueChange={(v) => q.setPageSize(Number(v))}>
                    <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" disabled={q.page <= 1} onClick={() => q.setPage(q.page - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm">Page {q.page} of {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={q.page >= totalPages} onClick={() => q.setPage(q.page + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <FindingDetailDialog
          row={selected}
          open={detailOpen}
          onOpenChange={setDetailOpen}
          violationTypes={violationTypes.data ?? []}
          canReview={canReview}
          canConvert={canConvert}
          onClassify={(input) => q.classify.mutateAsync(input)}
          onConvert={(input) => q.convert.mutateAsync(input)}
          busy={q.classify.isPending || q.convert.isPending}
        />
      </div>
    </TooltipProvider>
  );
}

/* ------------------------------------------------------------------ atoms */

function Kpi({
  label, value, icon: Icon, tone, onClick, loading,
}: {
  label: string; value: number; icon: React.ElementType;
  tone?: 'warning' | 'danger' | 'primary'; onClick?: () => void; loading?: boolean;
}) {
  const toneClass =
    tone === 'danger' ? 'text-destructive'
      : tone === 'warning' ? 'text-amber-600 dark:text-amber-400'
        : tone === 'primary' ? 'text-primary'
          : 'text-muted-foreground';
  return (
    <Card className="cursor-pointer hover:border-primary/40 transition-colors" onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{label}</span>
          <Icon className={`h-4 w-4 ${toneClass}`} />
        </div>
        {loading ? (
          <Skeleton className="h-7 w-16 mt-2" />
        ) : (
          <p className={`text-2xl font-semibold mt-1 ${toneClass}`}>{value.toLocaleString()}</p>
        )}
      </CardContent>
    </Card>
  );
}

function CheckGroup({
  label, values, selected, onToggle,
}: {
  label: string;
  values: { value: string; label: string }[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase text-muted-foreground">{label}</Label>
      <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
        {values.map((v) => (
          <label key={v.value} className="flex items-center gap-2 text-sm">
            <Checkbox checked={selected.includes(v.value)} onCheckedChange={() => onToggle(v.value)} />
            <span className="truncate">{v.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string;
  value?: string;
  onChange: (v: string | undefined) => void;
  options: { value: string; label: string }[];
}) {
  if (options.length === 0) return null;
  return (
    <div className="space-y-1">
      <Label className="text-xs uppercase text-muted-foreground">{label}</Label>
      <Select value={value ?? '__ALL__'} onValueChange={(v) => onChange(v === '__ALL__' ? undefined : v)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent className="max-h-64">
          <SelectItem value="__ALL__">All</SelectItem>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
