import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowRightLeft, CheckCircle2, Copy, Download, FileWarning,
  Filter, Loader2, RefreshCw, Search, ShieldAlert, SlidersHorizontal, X,
} from 'lucide-react';

import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ComplianceHelpButton } from '@/components/help/ComplianceHelpButton';
import { exportToExcel } from '@/utils/exportUtils';
import {
  useFindingTriage, TRIAGE_QUEUES, TRIAGE_SORTS, TRIAGE_AGE_BUCKETS,
  EVIDENCE_OPTIONS, SEVERITY_OPTIONS, PAGE_SIZE_OPTIONS,
  type FindingTriageRow, type ViolationTypeOption,
} from '@/hooks/compliance/useFindingTriage';

/* ------------------------------------------------------------------ */
/* Presentation helpers                                               */
/* ------------------------------------------------------------------ */

const severityTone = (severity?: string | null) => {
  switch ((severity || '').toLowerCase()) {
    case 'critical': return 'bg-destructive/15 text-destructive border-destructive/30';
    case 'high': return 'bg-orange-500/15 text-orange-600 border-orange-500/30 dark:text-orange-400';
    case 'medium': return 'bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-400';
    default: return 'bg-muted text-muted-foreground border-border';
  }
};

const ageTone = (days: number) => {
  if (days >= 15) return 'text-destructive font-semibold';
  if (days >= 8) return 'text-orange-600 dark:text-orange-400 font-medium';
  return 'text-muted-foreground';
};

const formatAge = (days: number) => {
  const d = Number(days || 0);
  if (d < 1) return 'Today';
  if (d < 2) return '1 day';
  return `${Math.floor(d)} days`;
};

const formatDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/* ------------------------------------------------------------------ */
/* KPI strip                                                          */
/* ------------------------------------------------------------------ */

interface KpiProps {
  label: string;
  value: string | number;
  hint?: string;
  icon: React.ElementType;
  tone?: 'default' | 'warning' | 'danger';
  active?: boolean;
  onClick?: () => void;
}

const KpiCard: React.FC<KpiProps> = ({ label, value, hint, icon: Icon, tone = 'default', active, onClick }) => (
  <Card
    onClick={onClick}
    className={`transition-shadow ${onClick ? 'cursor-pointer hover:shadow-md' : ''} ${active ? 'ring-2 ring-primary' : ''}`}
  >
    <CardContent className="pt-4">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-2xl font-bold ${tone === 'danger' ? 'text-destructive' : tone === 'warning' ? 'text-orange-600 dark:text-orange-400' : 'text-foreground'}`}>
            {value}
          </p>
          {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        </div>
        <Icon className={`h-5 w-5 ${tone === 'danger' ? 'text-destructive' : tone === 'warning' ? 'text-orange-500' : 'text-primary'}`} />
      </div>
    </CardContent>
  </Card>
);

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */

export default function ConvertFindingToViolationPage() {
  const navigate = useNavigate();
  const q = useFindingTriage();

  const [searchDraft, setSearchDraft] = useState(q.filters.search ?? '');
  const [exporting, setExporting] = useState(false);

  const [convertRow, setConvertRow] = useState<FindingTriageRow | null>(null);
  const [disposeRow, setDisposeRow] = useState<FindingTriageRow | null>(null);

  React.useEffect(() => { setSearchDraft(q.filters.search ?? ''); }, [q.filters.search]);

  const queue = q.filters.queue ?? 'PENDING';

  const activeChips = useMemo(() => {
    const chips: { label: string; clear: () => void }[] = [];
    const f = q.filters;
    if (f.search) chips.push({ label: `Search: ${f.search}`, clear: () => q.patchFilters({ search: undefined }) });
    (f.severities ?? []).forEach((s) => chips.push({ label: `Severity: ${s}`, clear: () => q.toggleInList('severities', s) }));
    (f.finding_types ?? []).forEach((s) => chips.push({ label: `Type: ${s}`, clear: () => q.toggleInList('finding_types', s) }));
    (f.categories ?? []).forEach((s) => chips.push({ label: `Category: ${s}`, clear: () => q.toggleInList('categories', s) }));
    if (f.employer) chips.push({ label: 'Employer filter', clear: () => q.patchFilters({ employer: undefined }) });
    if (f.inspection_id) chips.push({ label: 'Inspection filter', clear: () => q.patchFilters({ inspection_id: undefined }) });
    if (f.inspector) chips.push({ label: `Inspector: ${f.inspector}`, clear: () => q.patchFilters({ inspector: undefined }) });
    if (f.territory) chips.push({ label: `Territory: ${f.territory}`, clear: () => q.patchFilters({ territory: undefined }) });
    if (f.age) chips.push({ label: `Age: ${TRIAGE_AGE_BUCKETS.find((a) => a.value === f.age)?.label ?? f.age}`, clear: () => q.patchFilters({ age: undefined }) });
    if (f.evidence) chips.push({ label: EVIDENCE_OPTIONS.find((e) => e.value === f.evidence)?.label ?? f.evidence, clear: () => q.patchFilters({ evidence: undefined }) });
    if (f.date_from) chips.push({ label: `From ${f.date_from}`, clear: () => q.patchFilters({ date_from: undefined }) });
    if (f.date_to) chips.push({ label: `To ${f.date_to}`, clear: () => q.patchFilters({ date_to: undefined }) });
    if (f.duplicates_only) chips.push({ label: 'Potential duplicates only', clear: () => q.patchFilters({ duplicates_only: undefined }) });
    if (f.mine_only) chips.push({ label: 'My findings only', clear: () => q.patchFilters({ mine_only: undefined }) });
    return chips;
  }, [q]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const rows = await q.fetchAllForExport();
      if (rows.length === 0) { toast.info('Nothing to export for the selected filters'); return; }
      await exportToExcel(
        rows.map((r) => ({
          created_at: formatDate(r.created_at),
          employer: r.employer_name || r.employer_id || '',
          inspection: r.inspection_number || '',
          title: r.title || '',
          finding_type: r.finding_type || '',
          category: r.category || '',
          severity: r.severity || '',
          evidence_count: r.evidence_count,
          age_days: Math.floor(Number(r.age_days || 0)),
          duplicate: r.possible_duplicate ? 'Yes' : 'No',
          disposition: r.disposition || '',
          violation_number: r.converted_violation_number || '',
          inspector: r.inspector_name || r.inspector_id || '',
          territory: r.territory,
        })),
        [
          { header: 'Raised', key: 'created_at', width: 16 },
          { header: 'Employer', key: 'employer', width: 30 },
          { header: 'Inspection', key: 'inspection', width: 20 },
          { header: 'Finding', key: 'title', width: 40 },
          { header: 'Type', key: 'finding_type', width: 20 },
          { header: 'Category', key: 'category', width: 20 },
          { header: 'Severity', key: 'severity', width: 12 },
          { header: 'Evidence', key: 'evidence_count', width: 10 },
          { header: 'Waiting (days)', key: 'age_days', width: 14 },
          { header: 'Possible Duplicate', key: 'duplicate', width: 18 },
          { header: 'Disposition', key: 'disposition', width: 20 },
          { header: 'Violation', key: 'violation_number', width: 20 },
          { header: 'Inspector', key: 'inspector', width: 22 },
          { header: 'Territory', key: 'territory', width: 16 },
        ],
        `finding-triage-${new Date().toISOString().slice(0, 10)}`,
        'Finding Triage',
      );
      toast.success(`Exported ${rows.length.toLocaleString()} findings`);
    } catch (e) {
      console.error('[FindingTriage] export failed', e);
      toast.error('Unable to export the triage register. Please retry.');
    } finally {
      setExporting(false);
    }
  };

  const permissionDenied = (q.error?.message ?? '').includes('CE-FIND-REG-403');

  return (
    <TooltipProvider>
      <div className="container mx-auto space-y-4 p-6">
        <PageHeader
          title="Finding Triage & Violation Promotion"
          subtitle="Review inspection findings, decide whether an enforceable violation is warranted, and promote them under governed, audited controls"
          breadcrumbs={[
            { label: 'Compliance', href: '/compliance' },
            { label: 'Inspections', href: '/compliance/field/inspections' },
            { label: 'Convert Finding To Violation' },
          ]}
          actions={
            <div className="flex items-center gap-2">
              <ComplianceHelpButton screenKey="inspections" />
              <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
                <RefreshCw className={`mr-2 h-4 w-4 ${q.isFetching ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
                {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                Export
              </Button>
            </div>
          }
        />

        {permissionDenied ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
              <ShieldAlert className="h-10 w-10 text-destructive" />
              <p className="text-lg font-semibold">Access denied</p>
              <p className="max-w-md text-sm text-muted-foreground">
                Your compliance role does not permit access to the finding triage register.
                Ask a compliance administrator for inspection review rights.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* KPI strip */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <KpiCard
                label="In current queue" value={q.total.toLocaleString()}
                hint={TRIAGE_QUEUES.find((t) => t.value === queue)?.label}
                icon={ArrowRightLeft}
              />
              <KpiCard
                label="Critical / High" value={q.kpis.critical_high.toLocaleString()}
                hint="Priority promotion candidates" icon={AlertTriangle} tone="danger"
                active={(q.filters.severities ?? []).length > 0}
                onClick={() => q.patchFilters({ severities: (q.filters.severities ?? []).length ? [] : ['Critical', 'High'] })}
              />
              <KpiCard
                label="Potential duplicates" value={q.kpis.duplicates.toLocaleString()}
                hint="Open violation already exists" icon={Copy} tone="warning"
                active={Boolean(q.filters.duplicates_only)}
                onClick={() => q.patchFilters({ duplicates_only: !q.filters.duplicates_only })}
              />
              <KpiCard
                label="No evidence" value={q.kpis.no_evidence.toLocaleString()}
                hint="Weak promotion basis" icon={FileWarning} tone="warning"
                active={q.filters.evidence === 'NONE'}
                onClick={() => q.patchFilters({ evidence: q.filters.evidence === 'NONE' ? undefined : 'NONE' })}
              />
              <KpiCard
                label="Oldest waiting" value={formatAge(q.kpis.max_age_days)}
                hint={q.kpis.oldest_pending ? `Since ${formatDate(q.kpis.oldest_pending)}` : 'Nothing waiting'}
                icon={AlertTriangle}
                tone={q.kpis.max_age_days >= 15 ? 'danger' : 'default'}
              />
            </div>

            {/* Queue tabs */}
            <div className="flex flex-wrap items-center gap-2">
              {TRIAGE_QUEUES.map((t) => (
                <Button
                  key={t.value}
                  size="sm"
                  variant={queue === t.value ? 'default' : 'outline'}
                  onClick={() => q.patchFilters({ queue: t.value })}
                >
                  {t.label}
                </Button>
              ))}
              {q.scope && (
                <Badge variant="outline" className="ml-auto">
                  Data scope: {q.scope}
                </Badge>
              )}
            </div>

            {/* Toolbar */}
            <Card>
              <CardContent className="space-y-3 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[260px] flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      placeholder="Search employer, inspection number, finding title or description"
                      value={searchDraft}
                      onChange={(e) => setSearchDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') q.patchFilters({ search: searchDraft.trim() || undefined }); }}
                      onBlur={() => q.patchFilters({ search: searchDraft.trim() || undefined })}
                    />
                  </div>

                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm">
                        <Filter className="mr-2 h-4 w-4" />
                        Filters
                        {q.activeFilterCount > 0 && <Badge className="ml-2" variant="secondary">{q.activeFilterCount}</Badge>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-[360px] space-y-4 p-4">
                      <div className="space-y-2">
                        <Label className="text-xs uppercase text-muted-foreground">Severity</Label>
                        <div className="flex flex-wrap gap-2">
                          {SEVERITY_OPTIONS.map((s) => (
                            <Button
                              key={s} size="sm"
                              variant={(q.filters.severities ?? []).includes(s) ? 'default' : 'outline'}
                              onClick={() => q.toggleInList('severities', s)}
                            >
                              {s}
                            </Button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs uppercase text-muted-foreground">Waiting age</Label>
                          <Select value={q.filters.age ?? 'ALL'} onValueChange={(v) => q.patchFilters({ age: v === 'ALL' ? undefined : v })}>
                            <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ALL">Any age</SelectItem>
                              {TRIAGE_AGE_BUCKETS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs uppercase text-muted-foreground">Evidence</Label>
                          <Select value={q.filters.evidence ?? 'ALL'} onValueChange={(v) => q.patchFilters({ evidence: v === 'ALL' ? undefined : v })}>
                            <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ALL">Any</SelectItem>
                              {EVIDENCE_OPTIONS.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs uppercase text-muted-foreground">Employer</Label>
                        <Select value={q.filters.employer ?? 'ALL'} onValueChange={(v) => q.patchFilters({ employer: v === 'ALL' ? undefined : v })}>
                          <SelectTrigger><SelectValue placeholder="All employers" /></SelectTrigger>
                          <SelectContent className="max-h-64">
                            <SelectItem value="ALL">All employers</SelectItem>
                            {q.facets.employers.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs uppercase text-muted-foreground">Inspection</Label>
                        <Select value={q.filters.inspection_id ?? 'ALL'} onValueChange={(v) => q.patchFilters({ inspection_id: v === 'ALL' ? undefined : v })}>
                          <SelectTrigger><SelectValue placeholder="All inspections" /></SelectTrigger>
                          <SelectContent className="max-h-64">
                            <SelectItem value="ALL">All inspections</SelectItem>
                            {q.facets.inspections.map((i) => (
                              <SelectItem key={i.id} value={i.id}>{i.number} — {i.employer}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs uppercase text-muted-foreground">Inspector</Label>
                          <Select value={q.filters.inspector ?? 'ALL'} onValueChange={(v) => q.patchFilters({ inspector: v === 'ALL' ? undefined : v })}>
                            <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
                            <SelectContent className="max-h-64">
                              <SelectItem value="ALL">All inspectors</SelectItem>
                              {q.facets.inspectors.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs uppercase text-muted-foreground">Territory</Label>
                          <Select value={q.filters.territory ?? 'ALL'} onValueChange={(v) => q.patchFilters({ territory: v === 'ALL' ? undefined : v })}>
                            <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ALL">All territories</SelectItem>
                              {q.facets.territories.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs uppercase text-muted-foreground">Raised from</Label>
                          <Input type="date" value={q.filters.date_from ?? ''} onChange={(e) => q.patchFilters({ date_from: e.target.value || undefined })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs uppercase text-muted-foreground">Raised to</Label>
                          <Input type="date" value={q.filters.date_to ?? ''} onChange={(e) => q.patchFilters({ date_to: e.target.value || undefined })} />
                        </div>
                      </div>

                      {q.facets.finding_types.length > 0 && (
                        <div className="space-y-2">
                          <Label className="text-xs uppercase text-muted-foreground">Finding type</Label>
                          <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
                            {q.facets.finding_types.map((t) => (
                              <Button key={t} size="sm" variant={(q.filters.finding_types ?? []).includes(t) ? 'default' : 'outline'} onClick={() => q.toggleInList('finding_types', t)}>
                                {t}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="mine-only"
                          checked={Boolean(q.filters.mine_only)}
                          onCheckedChange={(c) => q.patchFilters({ mine_only: c === true ? true : undefined })}
                        />
                        <Label htmlFor="mine-only" className="text-sm">Only findings I raised or inspected</Label>
                      </div>

                      <Separator />
                      <Button variant="ghost" size="sm" className="w-full" onClick={q.resetFilters}>Clear all filters</Button>
                    </PopoverContent>
                  </Popover>

                  <div className="flex items-center gap-1">
                    <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                    <Select value={q.sort} onValueChange={q.changeSort}>
                      <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TRIAGE_SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" onClick={() => q.toggleSort(q.sort)}>
                      {q.dir === 'asc' ? 'Asc' : 'Desc'}
                    </Button>
                  </div>
                </div>

                {activeChips.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {activeChips.map((c, i) => (
                      <Badge key={`${c.label}-${i}`} variant="secondary" className="gap-1">
                        {c.label}
                        <button type="button" onClick={c.clear} aria-label={`Remove ${c.label}`}>
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                    <Button variant="ghost" size="sm" onClick={q.resetFilters}>Clear all</Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Register */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Findings ({q.total.toLocaleString()})
                  {q.isFetching && <Loader2 className="ml-2 inline h-4 w-4 animate-spin text-muted-foreground" />}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {q.isLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : q.error ? (
                  <div className="py-10 text-center text-sm text-destructive">
                    {q.error.message}
                  </div>
                ) : q.rows.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-14 text-center">
                    <CheckCircle2 className="h-9 w-9 text-primary" />
                    <p className="font-medium">No findings match this view</p>
                    <p className="text-sm text-muted-foreground">
                      {queue === 'PENDING'
                        ? 'Every reviewed finding has been converted or dispositioned.'
                        : 'Adjust the queue or filters to see more findings.'}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="cursor-pointer" onClick={() => q.toggleSort('employer')}>Employer</TableHead>
                          <TableHead className="cursor-pointer" onClick={() => q.toggleSort('inspection')}>Inspection</TableHead>
                          <TableHead>Finding</TableHead>
                          <TableHead className="cursor-pointer" onClick={() => q.toggleSort('severity')}>Severity</TableHead>
                          <TableHead className="cursor-pointer" onClick={() => q.toggleSort('evidence')}>Evidence</TableHead>
                          <TableHead className="cursor-pointer" onClick={() => q.toggleSort('age')}>Waiting</TableHead>
                          <TableHead>Signals</TableHead>
                          <TableHead className="text-right">Decision</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {q.rows.map((r) => (
                          <TableRow key={r.id} className="align-top">
                            <TableCell>
                              <button
                                type="button"
                                className="text-left font-medium text-primary hover:underline"
                                onClick={() => r.employer_id && navigate(`/compliance/field/employer-360/${r.employer_id}`)}
                              >
                                {r.employer_name || r.employer_id || 'Unknown employer'}
                              </button>
                              <p className="text-xs text-muted-foreground">{r.territory}</p>
                            </TableCell>
                            <TableCell>
                              <button
                                type="button"
                                className="text-left text-primary hover:underline"
                                onClick={() => navigate('/compliance/field/inspections')}
                              >
                                {r.inspection_number || '—'}
                              </button>
                              <p className="text-xs text-muted-foreground">{r.inspector_name || r.inspector_id || 'Unassigned'}</p>
                            </TableCell>
                            <TableCell className="max-w-[320px]">
                              <p className="font-medium">{r.title || 'Untitled finding'}</p>
                              {r.description && (
                                <p className="line-clamp-2 text-xs text-muted-foreground">{r.description}</p>
                              )}
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                {[r.finding_type, r.category].filter(Boolean).join(' • ') || '—'} · Raised {formatDate(r.created_at)}
                              </p>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={severityTone(r.severity)}>
                                {r.severity || 'Medium'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {r.evidence_count > 0 ? (
                                <Badge variant="secondary">{r.evidence_count} item{r.evidence_count === 1 ? '' : 's'}</Badge>
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge variant="outline" className="border-orange-500/30 text-orange-600 dark:text-orange-400">None</Badge>
                                  </TooltipTrigger>
                                  <TooltipContent>No evidence is attached to this finding</TooltipContent>
                                </Tooltip>
                              )}
                            </TableCell>
                            <TableCell className={ageTone(Number(r.age_days))}>{formatAge(Number(r.age_days))}</TableCell>
                            <TableCell className="space-y-1">
                              {r.possible_duplicate && (
                                <Badge variant="outline" className="border-orange-500/30 text-orange-600 dark:text-orange-400">
                                  Possible duplicate
                                </Badge>
                              )}
                              {r.violation_created && (
                                <Badge variant="secondary" className="cursor-pointer" onClick={() => r.violation_id && navigate(`/compliance/violations/${r.violation_id}`)}>
                                  {r.converted_violation_number || 'Converted'}
                                </Badge>
                              )}
                              {!r.violation_created && r.disposition === 'INFORMATIONAL' && (
                                <Badge variant="outline">No violation required</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {r.violation_created ? (
                                <Button size="sm" variant="outline" onClick={() => r.violation_id && navigate(`/compliance/violations/${r.violation_id}`)}>
                                  View violation
                                </Button>
                              ) : (
                                <div className="flex justify-end gap-2">
                                  <Button size="sm" variant="outline" onClick={() => setDisposeRow(r)}>No violation</Button>
                                  <Button size="sm" onClick={() => setConvertRow(r)}>
                                    <ArrowRightLeft className="mr-2 h-4 w-4" />
                                    Convert
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Pagination */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    {q.total === 0
                      ? 'No records'
                      : `Showing ${(q.page - 1) * q.pageSize + 1}–${Math.min(q.page * q.pageSize, q.total)} of ${q.total.toLocaleString()}`}
                  </p>
                  <div className="flex items-center gap-2">
                    <Select value={String(q.pageSize)} onValueChange={(v) => q.setPageSize(Number(v))}>
                      <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PAGE_SIZE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" disabled={q.page <= 1} onClick={() => q.setPage(q.page - 1)}>Previous</Button>
                    <span className="text-sm text-muted-foreground">Page {q.page} of {q.totalPages}</span>
                    <Button variant="outline" size="sm" disabled={q.page >= q.totalPages} onClick={() => q.setPage(q.page + 1)}>Next</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        <ConvertDialog
          row={convertRow}
          violationTypes={q.violationTypes}
          onClose={() => setConvertRow(null)}
          isPending={q.convert.isPending}
          onSubmit={async (payload) => {
            try {
              const res = await q.convert.mutateAsync(payload);
              toast.success(
                `${res.violation_number} created${res.status === 'PENDING_VERIFICATION' ? ' and routed to the verification queue' : ''}`,
                {
                  action: {
                    label: 'Open violation',
                    onClick: () => navigate(`/compliance/violations/${res.violation_id}`),
                  },
                },
              );
              setConvertRow(null);
            } catch (e) {
              const msg = e instanceof Error ? e.message : 'Conversion failed';
              console.error('[FindingTriage] conversion failed', e);
              toast.error(msg);
            }
          }}
        />

        <DisposeDialog
          row={disposeRow}
          onClose={() => setDisposeRow(null)}
          isPending={q.dispose.isPending}
          onSubmit={async (payload) => {
            try {
              await q.dispose.mutateAsync(payload);
              toast.success('Finding recorded as requiring no violation');
              setDisposeRow(null);
            } catch (e) {
              const msg = e instanceof Error ? e.message : 'Unable to record the decision';
              console.error('[FindingTriage] disposition failed', e);
              toast.error(msg);
            }
          }}
        />
      </div>
    </TooltipProvider>
  );
}

/* ------------------------------------------------------------------ */
/* Conversion dialog                                                  */
/* ------------------------------------------------------------------ */

interface ConvertDialogProps {
  row: FindingTriageRow | null;
  violationTypes: ViolationTypeOption[];
  isPending: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    findingId: string;
    violationTypeId: string;
    summary: string;
    severity: string;
    principalAmount?: number;
    duplicateOfId?: string | null;
    duplicateJustification?: string | null;
  }) => Promise<void>;
}

const ConvertDialog: React.FC<ConvertDialogProps> = ({ row, violationTypes, isPending, onClose, onSubmit }) => {
  const [typeId, setTypeId] = useState('');
  const [summary, setSummary] = useState('');
  const [severity, setSeverity] = useState('Medium');
  const [amount, setAmount] = useState('');
  const [justification, setJustification] = useState('');

  React.useEffect(() => {
    if (!row) return;
    setTypeId(row.candidate_violation_type_id ?? '');
    setSummary(row.title ?? '');
    setSeverity(row.severity ?? 'Medium');
    setAmount('');
    setJustification('');
  }, [row]);

  if (!row) return null;

  const selectedType = violationTypes.find((t) => t.id === typeId);
  const needsJustification = row.possible_duplicate;
  const canSubmit =
    Boolean(typeId) &&
    summary.trim().length >= 5 &&
    (!needsJustification || justification.trim().length >= 10);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Convert finding to violation</DialogTitle>
          <DialogDescription>
            The violation is created, evidence is carried across, the finding is closed and the decision is
            audited in a single governed transaction.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-medium">{row.title || 'Untitled finding'}</p>
            {row.description && <p className="mt-1 text-muted-foreground">{row.description}</p>}
            <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted-foreground">
              <span>Employer: {row.employer_name || row.employer_id || '—'}</span>
              <span>Inspection: {row.inspection_number || '—'}</span>
              <span>Evidence: {row.evidence_count} item(s)</span>
              <span>Raised: {formatDate(row.created_at)}</span>
            </div>
            {row.recommended_action && (
              <p className="mt-2 text-xs"><span className="font-medium">Recommended action:</span> {row.recommended_action}</p>
            )}
          </div>

          {row.evidence_count === 0 && (
            <div className="flex items-start gap-2 rounded-md border border-orange-500/30 bg-orange-500/10 p-3 text-sm">
              <FileWarning className="mt-0.5 h-4 w-4 text-orange-600 dark:text-orange-400" />
              <p>No evidence is attached. Consider attaching supporting evidence before promoting this finding.</p>
            </div>
          )}

          {row.possible_duplicate && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
              <Copy className="mt-0.5 h-4 w-4 text-destructive" />
              <p>An open violation already exists for this employer and violation type. A written justification is required to proceed.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Violation type <span className="text-destructive">*</span></Label>
              <Select value={typeId} onValueChange={setTypeId}>
                <SelectTrigger><SelectValue placeholder="Select a configured violation type" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {violationTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.code} — {t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedType?.requires_supervisor_review && (
                <p className="text-xs text-muted-foreground">This type always routes to supervisor verification.</p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Severity</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SEVERITY_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Violation summary <span className="text-destructive">*</span></Label>
            <Textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Concise statutory description of the violation" />
          </div>

          <div className="space-y-1">
            <Label>Principal amount (optional)</Label>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>

          {needsJustification && (
            <div className="space-y-1">
              <Label>Duplicate override justification <span className="text-destructive">*</span></Label>
              <Textarea rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Explain why a separate violation is warranted (minimum 10 characters)" />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            disabled={!canSubmit || isPending}
            onClick={() =>
              onSubmit({
                findingId: row.id,
                violationTypeId: typeId,
                summary: summary.trim(),
                severity,
                principalAmount: amount ? Number(amount) : 0,
                duplicateJustification: needsJustification ? justification.trim() : null,
              })
            }
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create violation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ------------------------------------------------------------------ */
/* Disposition dialog                                                 */
/* ------------------------------------------------------------------ */

interface DisposeDialogProps {
  row: FindingTriageRow | null;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (payload: { findingId: string; disposition: string; reason: string }) => Promise<void>;
}

const DisposeDialog: React.FC<DisposeDialogProps> = ({ row, isPending, onClose, onSubmit }) => {
  const [reason, setReason] = useState('');

  React.useEffect(() => { setReason(''); }, [row]);

  if (!row) return null;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record “no violation required”</DialogTitle>
          <DialogDescription>
            The finding remains on the inspection record but leaves the promotion queue. The decision and
            reason are audited.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-medium">{row.title || 'Untitled finding'}</p>
            <p className="text-xs text-muted-foreground">
              {row.employer_name || row.employer_id || '—'} · {row.inspection_number || '—'}
            </p>
          </div>
          <div className="space-y-1">
            <Label>Decision reason <span className="text-destructive">*</span></Label>
            <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain why no enforceable violation arises (minimum 10 characters)" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            disabled={reason.trim().length < 10 || isPending}
            onClick={() => onSubmit({ findingId: row.id, disposition: 'INFORMATIONAL', reason: reason.trim() })}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record decision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
