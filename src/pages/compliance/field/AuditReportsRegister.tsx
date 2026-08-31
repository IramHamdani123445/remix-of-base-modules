import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Download,
  Eye,
  FileText,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';

import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { exportToExcel } from '@/utils/exportUtils';
import {
  useAuditReportRegister,
  AUDIT_REPORT_SORTS,
  PAGE_SIZE_OPTIONS,
  AGE_BUCKETS,
  ATTENTION_OPTIONS,
  DATE_PRESETS,
  datePresetRange,
  type AuditReportRow,
} from '@/hooks/compliance/useAuditReportRegister';

const ANY = '__any__';

const STAGE_META: Record<string, { label: string; className: string }> = {
  DRAFT: { label: 'Draft', className: 'bg-muted text-muted-foreground' },
  FINAL: { label: 'Final', className: 'bg-primary/10 text-primary' },
  AWAITING_ACK: { label: 'Awaiting acknowledgement', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  ACKNOWLEDGED: { label: 'Acknowledged', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  SUPERSEDED: { label: 'Superseded', className: 'bg-destructive/10 text-destructive' },
};

const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const titleCase = (v: string) =>
  v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export default function AuditReportsRegister() {
  const navigate = useNavigate();
  const q = useAuditReportRegister();
  const [exporting, setExporting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const openReport = (row: AuditReportRow) => {
    if (row.inspection_id) navigate(`/compliance/field/audit-report/${row.inspection_id}`);
    else toast.info('This report is not linked to an inspection visit and cannot be opened.');
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const rows = await q.fetchAllForExport();
      if (rows.length === 0) { toast.info('Nothing to export for the selected filters'); return; }
      await exportToExcel(
        rows.map((r) => ({
          report_number: r.report_number,
          report_date: fmtDate(r.report_date),
          employer: r.employer_name,
          employer_id: r.employer_id || '',
          inspection_number: r.inspection_number || '',
          territory: r.territory,
          inspector: r.inspector_name || r.inspector_id || '',
          status: titleCase(r.status),
          stage: STAGE_META[r.lifecycle_stage]?.label ?? r.lifecycle_stage,
          acknowledgment: titleCase(r.acknowledgment_status),
          findings: r.total_findings,
          violations: r.total_violations,
          evidence: r.total_evidence,
          version: r.current_version,
          age_days: r.age_days,
        })),
        [
          { header: 'Report No.', key: 'report_number', width: 20 },
          { header: 'Report Date', key: 'report_date', width: 16 },
          { header: 'Employer', key: 'employer', width: 30 },
          { header: 'Employer ID', key: 'employer_id', width: 14 },
          { header: 'Inspection', key: 'inspection_number', width: 20 },
          { header: 'Territory', key: 'territory', width: 16 },
          { header: 'Inspector', key: 'inspector', width: 22 },
          { header: 'Status', key: 'status', width: 14 },
          { header: 'Stage', key: 'stage', width: 26 },
          { header: 'Acknowledgement', key: 'acknowledgment', width: 20 },
          { header: 'Findings', key: 'findings', width: 10 },
          { header: 'Violations', key: 'violations', width: 11 },
          { header: 'Evidence', key: 'evidence', width: 10 },
          { header: 'Version', key: 'version', width: 9 },
          { header: 'Age (days)', key: 'age_days', width: 12 },
        ],
        `field-audit-reports-${new Date().toISOString().slice(0, 10)}`,
        'Audit Reports',
      );
      toast.success(`Exported ${rows.length.toLocaleString()} audit reports`);
    } catch (e) {
      console.error('[AuditReportsRegister] export failed', e);
      toast.error('Unable to export the audit report register. Please retry.');
    } finally {
      setExporting(false);
    }
  };

  const k = q.kpisFiltered;
  const kpis = [
    { label: 'Reports', value: k.total, hint: 'Reports matching current filters' },
    { label: 'Drafts', value: k.draft, filter: { statuses: ['DRAFT'] } },
    { label: 'Finalised', value: k.final, filter: { statuses: ['FINAL'] } },
    { label: 'Awaiting acknowledgement', value: k.awaiting_ack, filter: { attention: 'AWAITING_ACK' } },
    { label: 'Acknowledged', value: k.acknowledged },
    { label: 'Needs attention', value: k.attention, filter: { attention: 'ANY' }, alert: true },
  ];

  const chips: { label: string; clear: () => void }[] = [];
  const push = (label: string, patch: Record<string, unknown>) =>
    chips.push({ label, clear: () => q.patchFilters(patch as never) });
  if (q.filters.search) push(`Search: ${q.filters.search}`, { search: undefined });
  (q.filters.statuses ?? []).forEach((s) => push(`Status: ${titleCase(s)}`, { statuses: (q.filters.statuses ?? []).filter((x) => x !== s) }));
  (q.filters.acknowledgments ?? []).forEach((s) => push(`Ack: ${titleCase(s)}`, { acknowledgments: (q.filters.acknowledgments ?? []).filter((x) => x !== s) }));
  if (q.filters.employer) push(`Employer: ${q.filters.employer}`, { employer: undefined });
  if (q.filters.inspector) push(`Inspector: ${q.filters.inspector}`, { inspector: undefined });
  if (q.filters.territory) push(`Territory: ${q.filters.territory}`, { territory: undefined });
  if (q.filters.attention) push(`Attention: ${q.filters.attention.replace(/_/g, ' ').toLowerCase()}`, { attention: undefined });
  if (q.filters.findings) push(`Findings: ${q.filters.findings.toLowerCase()}`, { findings: undefined });
  if (q.filters.violations) push(`Violations: ${q.filters.violations.toLowerCase()}`, { violations: undefined });
  if (q.filters.pdf) push(`PDF: ${q.filters.pdf.toLowerCase()}`, { pdf: undefined });
  if (q.filters.age) push(`Age: ${q.filters.age.replace(/_/g, '–').toLowerCase()}`, { age: undefined });
  if (q.filters.date_from) push(`From: ${q.filters.date_from}`, { date_from: undefined });
  if (q.filters.date_to) push(`To: ${q.filters.date_to}`, { date_to: undefined });

  const sortButton = (key: string, label: string) => (
    <button
      type="button"
      onClick={() => q.toggleSort(key)}
      className="inline-flex items-center gap-1 hover:text-foreground"
    >
      {label}
      <ArrowUpDown className={`h-3 w-3 ${q.sort === key ? 'text-primary' : 'text-muted-foreground/50'}`} />
    </button>
  );

  return (
    <div className="container mx-auto space-y-4 p-6">
      <PageHeader
        title="Field Audit Reports"
        subtitle="Register of employer audit reports produced from field inspections — draft, finalisation and acknowledgement lifecycle"
        breadcrumbs={[
          { label: 'Compliance', href: '/compliance' },
          { label: 'Field Audit', href: '/compliance/field/audit-management' },
          { label: 'Audit Reports' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${q.isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || q.total === 0}>
              {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Export
            </Button>
          </div>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi) => (
          <Card
            key={kpi.label}
            className={`${kpi.filter ? 'cursor-pointer transition-colors hover:border-primary/50' : ''} ${kpi.alert && kpi.value > 0 ? 'border-amber-500/40' : ''}`}
            onClick={kpi.filter ? () => q.patchFilters(kpi.filter as never) : undefined}
          >
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{kpi.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{kpi.value.toLocaleString()}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Toolbar */}
      <div className="space-y-3 rounded-lg border bg-card/50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search report no., employer, inspection or inspector…"
              defaultValue={q.filters.search ?? ''}
              onKeyDown={(e) => {
                if (e.key === 'Enter') q.patchFilters({ search: (e.target as HTMLInputElement).value });
              }}
              onBlur={(e) => {
                if ((e.target.value || '') !== (q.filters.search ?? '')) q.patchFilters({ search: e.target.value });
              }}
            />
          </div>

          <Select value={q.filters.attention ?? ANY} onValueChange={(v) => q.patchFilters({ attention: v === ANY ? undefined : v })}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Attention" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All reports</SelectItem>
              {ATTENTION_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={q.sort} onValueChange={(v) => q.changeSort(v)}>
            <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {AUDIT_REPORT_SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" onClick={() => q.changeSort(q.sort, q.dir === 'asc' ? 'desc' : 'asc')}>
            {q.dir === 'asc' ? 'Ascending' : 'Descending'}
          </Button>

          <Button variant={showFilters ? 'default' : 'outline'} size="sm" onClick={() => setShowFilters((s) => !s)}>
            <Filter className="mr-2 h-4 w-4" />
            Filters{q.activeFilterCount ? ` (${q.activeFilterCount})` : ''}
          </Button>
        </div>

        {showFilters && (
          <div className="grid gap-3 border-t pt-3 md:grid-cols-3 xl:grid-cols-4">
            <Select value={q.filters.statuses?.[0] ?? ANY} onValueChange={(v) => q.patchFilters({ statuses: v === ANY ? [] : [v] })}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any status</SelectItem>
                {q.options.statuses.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={q.filters.acknowledgments?.[0] ?? ANY} onValueChange={(v) => q.patchFilters({ acknowledgments: v === ANY ? [] : [v] })}>
              <SelectTrigger><SelectValue placeholder="Acknowledgement" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any acknowledgement</SelectItem>
                {q.options.acknowledgments.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={q.filters.inspector ?? ANY} onValueChange={(v) => q.patchFilters({ inspector: v === ANY ? undefined : v })}>
              <SelectTrigger><SelectValue placeholder="Inspector" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any inspector</SelectItem>
                <SelectItem value="ME">My reports</SelectItem>
                <SelectItem value="UNASSIGNED">No inspector recorded</SelectItem>
                {q.options.inspectors.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={q.filters.employer ?? ANY} onValueChange={(v) => q.patchFilters({ employer: v === ANY ? undefined : v })}>
              <SelectTrigger><SelectValue placeholder="Employer" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any employer</SelectItem>
                {q.options.employers.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={q.filters.territory ?? ANY} onValueChange={(v) => q.patchFilters({ territory: v === ANY ? undefined : v })}>
              <SelectTrigger><SelectValue placeholder="Territory" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any territory</SelectItem>
                {q.options.territories.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={q.filters.findings ?? ANY} onValueChange={(v) => q.patchFilters({ findings: v === ANY ? undefined : v })}>
              <SelectTrigger><SelectValue placeholder="Findings" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any findings</SelectItem>
                <SelectItem value="WITH">With findings</SelectItem>
                <SelectItem value="WITHOUT">No findings</SelectItem>
              </SelectContent>
            </Select>

            <Select value={q.filters.violations ?? ANY} onValueChange={(v) => q.patchFilters({ violations: v === ANY ? undefined : v })}>
              <SelectTrigger><SelectValue placeholder="Violations" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any violations</SelectItem>
                <SelectItem value="WITH">Raised violations</SelectItem>
                <SelectItem value="WITHOUT">No violations</SelectItem>
              </SelectContent>
            </Select>

            <Select value={q.filters.pdf ?? ANY} onValueChange={(v) => q.patchFilters({ pdf: v === ANY ? undefined : v })}>
              <SelectTrigger><SelectValue placeholder="Document" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any document state</SelectItem>
                <SelectItem value="YES">PDF available</SelectItem>
                <SelectItem value="NO">No PDF generated</SelectItem>
              </SelectContent>
            </Select>

            <Select value={q.filters.age ?? ANY} onValueChange={(v) => q.patchFilters({ age: v === ANY ? undefined : v })}>
              <SelectTrigger><SelectValue placeholder="Report age" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any age</SelectItem>
                {AGE_BUCKETS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select
              value={ANY}
              onValueChange={(v) => {
                const r = datePresetRange(v);
                q.patchFilters({ date_from: r.from, date_to: r.to });
              }}
            >
              <SelectTrigger><SelectValue placeholder="Date range preset" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Custom / all dates</SelectItem>
                {DATE_PRESETS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>

            <Input type="date" value={q.filters.date_from ?? ''} onChange={(e) => q.patchFilters({ date_from: e.target.value })} />
            <Input type="date" value={q.filters.date_to ?? ''} onChange={(e) => q.patchFilters({ date_to: e.target.value })} />
          </div>
        )}

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            {chips.map((c, i) => (
              <Badge key={`${c.label}-${i}`} variant="secondary" className="gap-1">
                {c.label}
                <button type="button" onClick={c.clear} aria-label={`Clear ${c.label}`}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <Button variant="ghost" size="sm" onClick={q.resetFilters}>Clear all</Button>
          </div>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {q.error ? (
            <div className="p-8 text-center">
              <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive" />
              <p className="font-medium">Unable to load the audit report register</p>
              <p className="mt-1 text-sm text-muted-foreground">{q.error.message}</p>
            </div>
          ) : q.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : q.rows.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="font-medium">No audit reports match the current filters</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Audit reports are generated from completed field inspections.
              </p>
              {q.activeFilterCount > 0 && (
                <Button variant="outline" size="sm" className="mt-4" onClick={q.resetFilters}>Clear filters</Button>
              )}
            </div>
          ) : (
            <TooltipProvider>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{sortButton('report_number', 'Report')}</TableHead>
                    <TableHead>{sortButton('employer', 'Employer')}</TableHead>
                    <TableHead>{sortButton('inspector', 'Inspector')}</TableHead>
                    <TableHead>{sortButton('report_date', 'Report date')}</TableHead>
                    <TableHead>{sortButton('status', 'Stage')}</TableHead>
                    <TableHead>{sortButton('acknowledgment', 'Acknowledgement')}</TableHead>
                    <TableHead className="text-right">{sortButton('findings', 'Findings')}</TableHead>
                    <TableHead className="text-right">{sortButton('violations', 'Violations')}</TableHead>
                    <TableHead className="text-right">{sortButton('age', 'Age')}</TableHead>
                    <TableHead className="w-[70px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.rows.map((r) => {
                    const stage = STAGE_META[r.lifecycle_stage] ?? STAGE_META.FINAL;
                    return (
                      <TableRow key={r.id} className="cursor-pointer" onClick={() => openReport(r)}>
                        <TableCell>
                          <div className="font-medium">{r.report_number}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.inspection_number ?? 'No inspection link'}
                            {r.version_count > 1 ? ` · v${r.current_version}` : ''}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[220px] truncate">{r.employer_name}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.employer_reg_number || r.employer_id || '—'} · {r.territory}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{r.inspector_name || r.inspector_id || '—'}</TableCell>
                        <TableCell className="text-sm">{fmtDate(r.report_date)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge className={stage.className} variant="secondary">{stage.label}</Badge>
                            {r.draft_ageing && (
                              <Tooltip><TooltipTrigger asChild>
                                <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">Ageing</Badge>
                              </TooltipTrigger><TooltipContent>Draft open for more than 7 days</TooltipContent></Tooltip>
                            )}
                            {r.missing_pdf && (
                              <Tooltip><TooltipTrigger asChild>
                                <Badge variant="outline" className="border-destructive/50 text-destructive">No PDF</Badge>
                              </TooltipTrigger><TooltipContent>Finalised without a generated document</TooltipContent></Tooltip>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{titleCase(r.acknowledgment_status)}</div>
                          {r.ack_overdue && (
                            <div className="text-xs text-amber-600 dark:text-amber-400">
                              {r.ack_days_outstanding} days outstanding
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.total_findings}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.total_violations}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.age_days}d</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); openReport(r); }}
                            aria-label={`Open ${r.report_number}`}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {q.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Showing {(q.page - 1) * q.pageSize + 1}–{Math.min(q.page * q.pageSize, q.total)} of {q.total.toLocaleString()} reports
            {q.scope ? ` · ${q.scope} scope` : ''}
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
            <span className="text-sm tabular-nums">Page {q.page} of {q.totalPages}</span>
            <Button variant="outline" size="sm" disabled={q.page >= q.totalPages} onClick={() => q.setPage(q.page + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
