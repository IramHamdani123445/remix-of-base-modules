import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertTriangle, CalendarClock, ChevronDown, ClipboardCheck, Clock, Download, FileWarning,
  Filter, Inbox, Loader2, MapPin, PlayCircle, RefreshCw, Search, ShieldAlert, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { ComplianceHelpButton } from '@/components/help/ComplianceHelpButton';
import ScheduleInspectionDialog from '@/components/compliance/inspection/ScheduleInspectionDialog';
import InspectionDetailDialog from '@/components/compliance/inspection/InspectionDetailDialog';
import { exportToExcel } from '@/utils/exportUtils';
import { useActionPermissions } from '@/hooks/useActionPermission';
import {
  EVIDENCE_OPTIONS, FINDINGS_OPTIONS, INSPECTION_QUICK_VIEWS, INSPECTION_SORTS, PAGE_SIZES,
  REPORT_OPTIONS, TIMING_OPTIONS, useInspectionRegister, type InspectionRow,
} from '@/hooks/compliance/useInspectionRegister';

/**
 * Inspection Register & Control Workspace (`/compliance/field/inspections`).
 *
 * Master operational register over `ce_inspections`. Lifecycle status (persisted)
 * and timing status (derived from the scheduled date) are displayed separately —
 * "Scheduled · Overdue" is a valid, unambiguous combination. Every list concern
 * (scope, search, filters, sorting, paging, KPIs) is resolved server-side by
 * `ce_inspection_register_v1`, so counts describe the whole authorised
 * population rather than the fetched page.
 */

const LIFECYCLE_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  ASSIGNED: 'Assigned',
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  RESCHEDULED: 'Rescheduled',
};

const TIMING_LABEL: Record<string, string> = {
  OVERDUE: 'Overdue',
  DUE_TODAY: 'Due today',
  DUE_WEEK: 'Due this week',
  FUTURE: 'Future',
  NO_DATE: 'No date',
  CLOSED: '',
};

const REPORT_LABEL: Record<string, string> = {
  NOT_STARTED: 'Not started',
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  FINAL: 'Final',
};

const DATE_PRESETS = [
  { value: 'ALL', label: 'Any date' },
  { value: 'TODAY', label: 'Today' },
  { value: 'TOMORROW', label: 'Tomorrow' },
  { value: 'THIS_WEEK', label: 'This week' },
  { value: 'NEXT_7', label: 'Next 7 days' },
  { value: 'LAST_30', label: 'Last 30 days' },
  { value: 'CUSTOM', label: 'Custom range' },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

function presetRange(preset: string): { from?: string; to?: string } {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const shift = (days: number) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  };
  switch (preset) {
    case 'TODAY': return { from: iso(today), to: iso(today) };
    case 'TOMORROW': return { from: iso(shift(1)), to: iso(shift(1)) };
    case 'THIS_WEEK': {
      const dow = (today.getUTCDay() + 6) % 7;
      return { from: iso(shift(-dow)), to: iso(shift(6 - dow)) };
    }
    case 'NEXT_7': return { from: iso(today), to: iso(shift(7)) };
    case 'LAST_30': return { from: iso(shift(-30)), to: iso(today) };
    default: return { from: undefined, to: undefined };
  }
}

const fmtDate = (v?: string | null) =>
  v ? new Date(`${v.length <= 10 ? `${v}T00:00:00Z` : v}`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

function Kpi({
  label, value, icon: Icon, tone = 'default', active, onClick, loading,
}: {
  label: string; value?: number; icon: React.ElementType;
  tone?: 'default' | 'primary' | 'warning' | 'danger'; active?: boolean;
  onClick?: () => void; loading?: boolean;
}) {
  const toneClass =
    tone === 'danger' ? 'text-destructive'
      : tone === 'warning' ? 'text-amber-600 dark:text-amber-500'
        : tone === 'primary' ? 'text-primary' : 'text-muted-foreground';
  return (
    <Card
      className={`cursor-pointer transition-shadow hover:shadow-md ${active ? 'ring-2 ring-primary' : ''}`}
      onClick={onClick}
    >
      <CardContent className="flex items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          {loading
            ? <Skeleton className="mt-1 h-6 w-12" />
            : <p className="text-xl font-semibold">{(value ?? 0).toLocaleString()}</p>}
        </div>
        <Icon className={`h-5 w-5 shrink-0 ${toneClass}`} />
      </CardContent>
    </Card>
  );
}

function CheckGroup({
  label, options, selected, onToggle,
}: { label: string; options: { value: string; label: string }[]; selected: string[]; onToggle: (v: string) => void }) {
  if (!options.length) return null;
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      <div className="grid grid-cols-2 gap-1.5">
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-xs">
            <Checkbox checked={selected.includes(o.value)} onCheckedChange={() => onToggle(o.value)} />
            <span className="truncate">{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function FilterSelect({
  label, value, options, placeholder, onChange,
}: { label: string; value?: string; options: { value: string; label: string }[]; placeholder: string; onChange: (v?: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      <Select value={value ?? '__ALL__'} onValueChange={(v) => onChange(v === '__ALL__' ? undefined : v)}>
        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent className="max-h-[280px]">
          <SelectItem value="__ALL__">{placeholder}</SelectItem>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export default function InspectionManagement() {
  const navigate = useNavigate();
  const q = useInspectionRegister();
  const { can, isAdmin } = useActionPermissions('manage_compliance');
  const [searchDraft, setSearchDraft] = useState(q.search);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Debounced server-side search.
  useEffect(() => { setSearchDraft(q.search); /* keep URL as source of truth */ }, [q.search]);
  useEffect(() => {
    const t = setTimeout(() => {
      if ((searchDraft || '') !== (q.search || '')) q.patch({ q: searchDraft || undefined });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  const canSchedule = isAdmin || can('create') || can('edit');
  const canSeeAll = q.access === 'ALL';

  const datePreset = q.params.get('preset') ?? 'ALL';
  const setDatePreset = (v: string) => {
    if (v === 'CUSTOM') { q.patch({ preset: v }); return; }
    const { from, to } = presetRange(v);
    q.patch({ preset: v === 'ALL' ? undefined : v, from, to });
  };

  const toggleList = (key: 'statuses' | 'types' | 'territories' | 'risk_bands', value: string) => {
    const current = (q.filters[key] as string[] | undefined) ?? [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    q.patch({ [key]: next });
  };

  const totalPages = Math.max(1, Math.ceil(q.total / q.pageSize));
  const firstRow = q.total === 0 ? 0 : (q.page - 1) * q.pageSize + 1;
  const lastRow = Math.min(q.page * q.pageSize, q.total);
  const hasFilters = q.activeFilterChips.length > 0;

  const attentionItems = useMemo(() => {
    const a = q.attention;
    if (!a) return [];
    return [
      { label: 'Overdue, not started', value: a.overdue_not_started, apply: () => q.patch({ quick: 'OVERDUE', statuses: ['SCHEDULED'] }) },
      { label: 'In progress > 2 days', value: a.stalled_in_progress, apply: () => q.patch({ quick: 'IN_PROGRESS' }) },
      { label: 'Completed, no report', value: a.completed_no_report, apply: () => q.patch({ quick: 'ALL', statuses: ['COMPLETED'], report: 'NOT_STARTED' }) },
      { label: 'Completed, no evidence', value: a.completed_no_evidence, apply: () => q.patch({ quick: 'ALL', evidence: 'MISSING_ON_COMPLETED' }) },
      { label: 'Critical findings awaiting review', value: a.critical_findings_pending, apply: () => q.patch({ quick: 'ALL', findings: 'CRITICAL_HIGH' }) },
      { label: 'No inspector assigned', value: a.unassigned, apply: () => q.patch({ quick: 'ALL', sort: 'inspector' }) },
    ].filter((i) => (i.value ?? 0) > 0);
  }, [q]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const rows = await q.exportRows();
      if (!rows.length) { toast.info('There is nothing to export for the current filters.'); return; }
      exportToExcel(
        rows.map((r) => ({
          inspection_number: r.inspection_number,
          employer_name: r.employer_name ?? '',
          employer_id: r.employer_id ?? '',
          inspection_type: r.inspection_type ?? '',
          inspector: r.inspector_name ?? r.inspector_id ?? 'Unassigned',
          inspector_code: r.inspector_code ?? '',
          scheduled_date: r.scheduled_date ?? '',
          territory: r.territory ?? '',
          lifecycle: LIFECYCLE_LABEL[r.lifecycle_status] ?? r.lifecycle_status,
          timing: TIMING_LABEL[r.timing_status] ?? r.timing_status,
          risk_band: r.risk_band ?? 'Unrated',
          findings_count: r.findings_count,
          critical_high: r.critical_high_findings,
          evidence_count: r.evidence_count,
          report_status: REPORT_LABEL[r.report_status] ?? r.report_status,
          plan_number: r.plan_number ?? '',
          case_number: r.case_number ?? '',
        })),
        [
          { header: 'Inspection', key: 'inspection_number', width: 20 },
          { header: 'Employer', key: 'employer_name', width: 32 },
          { header: 'Reg. No.', key: 'employer_id', width: 14 },
          { header: 'Type', key: 'inspection_type', width: 20 },
          { header: 'Inspector', key: 'inspector', width: 24 },
          { header: 'Inspector Code', key: 'inspector_code', width: 16 },
          { header: 'Scheduled', key: 'scheduled_date', width: 14 },
          { header: 'Zone', key: 'territory', width: 14 },
          { header: 'Lifecycle', key: 'lifecycle', width: 14 },
          { header: 'Timing', key: 'timing', width: 14 },
          { header: 'Risk Band', key: 'risk_band', width: 12 },
          { header: 'Findings', key: 'findings_count', width: 10 },
          { header: 'Critical/High', key: 'critical_high', width: 13 },
          { header: 'Evidence', key: 'evidence_count', width: 10 },
          { header: 'Report', key: 'report_status', width: 14 },
          { header: 'Plan', key: 'plan_number', width: 20 },
          { header: 'Case', key: 'case_number', width: 20 },
        ],
        `inspection-register-${new Date().toISOString().slice(0, 10)}`,
        'Inspection Register',
      );
      toast.success(`Exported ${rows.length.toLocaleString()} inspections.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The export could not be produced.');
    } finally {
      setExporting(false);
    }
  };

  const sortHead = (key: string, label: string, className = '') => (
    <TableHead className={className}>
      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => q.changeSort(key)}>
        {label}
        {q.sort === key ? <ChevronDown className={`h-3 w-3 transition-transform ${q.dir === 'asc' ? 'rotate-180' : ''}`} /> : null}
      </button>
    </TableHead>
  );

  const lifecycleBadge = (r: InspectionRow) => {
    const variant = r.lifecycle_status === 'COMPLETED' ? 'default'
      : r.lifecycle_status === 'CANCELLED' ? 'outline'
        : r.lifecycle_status === 'IN_PROGRESS' ? 'secondary' : 'outline';
    return <Badge variant={variant} className="text-[10px]">{LIFECYCLE_LABEL[r.lifecycle_status] ?? r.lifecycle_status}</Badge>;
  };

  const riskBadge = (band?: string | null) => {
    if (!band) return <span className="text-xs text-muted-foreground">Unrated</span>;
    const b = band.toUpperCase();
    const variant = b === 'CRITICAL' || b === 'HIGH' ? 'destructive' : b === 'MEDIUM' ? 'secondary' : 'outline';
    return <Badge variant={variant} className="text-[10px]">{b}</Badge>;
  };

  return (
    <TooltipProvider>
      <div className="container mx-auto space-y-4 p-6">
        {/* header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <ClipboardCheck className="h-6 w-6 text-primary" />
              Inspection Register
            </h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Master operational register of every compliance inspection in your authorised scope — lifecycle state,
              ownership, employer risk, findings, evidence and report completion.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ComplianceHelpButton screenKey="inspections" />
            <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${q.isFetching ? 'animate-spin' : ''}`} />Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || q.total === 0}>
              {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Export
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/compliance/field/findings">Findings register</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/compliance/inspections/convert-finding">Conversion queue</Link>
            </Button>
            {canSchedule ? <ScheduleInspectionDialog /> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>
            Access: <span className="font-medium">{q.access === 'ALL' ? 'Enterprise-wide' : 'Own inspections'}</span>
          </span>
          <span>·</span>
          <span className="flex items-center gap-2">
            Scope
            <Select value={q.scope} onValueChange={(v) => q.patch({ scope: v === 'AUTO' ? undefined : v })}>
              <SelectTrigger className="h-7 w-[170px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="AUTO">{canSeeAll ? 'All inspections' : 'My inspections'}</SelectItem>
                <SelectItem value="MINE">My inspections</SelectItem>
                {canSeeAll ? <SelectItem value="TEAM">My team</SelectItem> : null}
                {canSeeAll ? <SelectItem value="ALL">All inspections</SelectItem> : null}
              </SelectContent>
            </Select>
          </span>
          <span>·</span>
          <span>Legal referral is raised from the inspection, finding or case record, not from this register.</span>
        </div>

        {/* KPI strip — full authorised scope, not the current page */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Kpi label="Due today" value={q.kpis?.due_today} icon={CalendarClock} loading={q.isLoading}
            active={q.quick === 'TODAY'} onClick={() => q.patch({ quick: 'TODAY' })} />
          <Kpi label="Scheduled" value={q.kpis?.scheduled} icon={ClipboardCheck} loading={q.isLoading}
            active={q.quick === 'SCHEDULED'} onClick={() => q.patch({ quick: 'SCHEDULED' })} />
          <Kpi label="In progress" value={q.kpis?.in_progress} icon={PlayCircle} tone="primary" loading={q.isLoading}
            active={q.quick === 'IN_PROGRESS'} onClick={() => q.patch({ quick: 'IN_PROGRESS' })} />
          <Kpi label="Overdue" value={q.kpis?.overdue} icon={AlertTriangle} tone="danger" loading={q.isLoading}
            active={q.quick === 'OVERDUE'} onClick={() => q.patch({ quick: 'OVERDUE' })} />
          <Kpi label="Completed (30 days)" value={q.kpis?.completed_30d} icon={Clock} loading={q.isLoading}
            onClick={() => q.patch({ quick: 'ALL', statuses: ['COMPLETED'] })} />
          <Kpi label="Findings awaiting review" value={q.kpis?.findings_pending_review} icon={FileWarning} tone="warning"
            loading={q.isLoading} active={q.filters.findings === 'PENDING_REVIEW'}
            onClick={() => q.patch({ quick: 'ALL', findings: 'PENDING_REVIEW' })} />
        </div>

        {/* requires attention */}
        {attentionItems.length ? (
          <Card className="border-amber-500/40">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldAlert className="h-4 w-4 text-amber-600" />Requires attention
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 pb-4">
              {attentionItems.map((i) => (
                <Button key={i.label} variant="outline" size="sm" className="h-7 text-xs" onClick={i.apply}>
                  {i.label}
                  <Badge variant="secondary" className="ml-2">{i.value}</Badge>
                </Button>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Register</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* toolbar */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[260px] flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search inspection, employer, inspector, plan or case..."
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                />
              </div>

              <Select value={q.quick} onValueChange={(v) => q.patch({ quick: v })}>
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INSPECTION_QUICK_VIEWS.map((v) => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={datePreset} onValueChange={setDatePreset}>
                <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DATE_PRESETS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Filter className="mr-2 h-4 w-4" />Filters
                    {hasFilters ? <Badge variant="secondary" className="ml-2">{q.activeFilterChips.length}</Badge> : null}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="max-h-[70vh] w-[400px] space-y-4 overflow-y-auto">
                  {datePreset === 'CUSTOM' ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">From</Label>
                        <Input type="date" value={q.filters.date_from ?? ''} onChange={(e) => q.patch({ from: e.target.value || undefined })} />
                      </div>
                      <div>
                        <Label className="text-xs">To</Label>
                        <Input type="date" value={q.filters.date_to ?? ''} onChange={(e) => q.patch({ to: e.target.value || undefined })} />
                      </div>
                    </div>
                  ) : null}

                  <CheckGroup
                    label="Lifecycle status"
                    options={(q.facets?.statuses ?? []).map((s) => ({ value: s, label: LIFECYCLE_LABEL[s] ?? s }))}
                    selected={q.filters.statuses ?? []}
                    onToggle={(v) => toggleList('statuses', v)}
                  />
                  <CheckGroup
                    label="Inspection type"
                    options={(q.facets?.types ?? []).map((t) => ({ value: t, label: t }))}
                    selected={q.filters.types ?? []}
                    onToggle={(v) => toggleList('types', v)}
                  />
                  <CheckGroup
                    label="Zone / territory"
                    options={(q.facets?.territories ?? []).map((t) => ({ value: t, label: t }))}
                    selected={q.filters.territories ?? []}
                    onToggle={(v) => toggleList('territories', v)}
                  />
                  <CheckGroup
                    label="Employer risk band"
                    options={(q.facets?.risk_bands ?? []).map((t) => ({ value: t, label: t }))}
                    selected={q.filters.risk_bands ?? []}
                    onToggle={(v) => toggleList('risk_bands', v)}
                  />

                  <Separator />

                  <FilterSelect
                    label="Timing" placeholder="Any timing" value={q.filters.timing}
                    options={TIMING_OPTIONS.filter((o) => o.value !== 'ANY')}
                    onChange={(v) => q.patch({ timing: v })}
                  />
                  <FilterSelect
                    label="Findings" placeholder="Any findings state" value={q.filters.findings}
                    options={FINDINGS_OPTIONS.filter((o) => o.value !== 'ANY')}
                    onChange={(v) => q.patch({ findings: v })}
                  />
                  <FilterSelect
                    label="Report status" placeholder="Any report status" value={q.filters.report}
                    options={REPORT_OPTIONS.filter((o) => o.value !== 'ANY')}
                    onChange={(v) => q.patch({ report: v })}
                  />
                  <FilterSelect
                    label="Evidence" placeholder="Any evidence state" value={q.filters.evidence}
                    options={EVIDENCE_OPTIONS.filter((o) => o.value !== 'ANY')}
                    onChange={(v) => q.patch({ evidence: v })}
                  />
                  {q.effectiveScope !== 'MINE' ? (
                    <FilterSelect
                      label="Inspector" placeholder="Any inspector" value={q.filters.inspector}
                      options={(q.facets?.inspectors ?? []).map((i) => ({
                        value: i.id, label: i.code && i.code !== i.name ? `${i.name} — ${i.code}` : i.name,
                      }))}
                      onChange={(v) => q.patch({ inspector: v })}
                    />
                  ) : null}
                  <FilterSelect
                    label="Employer" placeholder="Any employer" value={q.filters.employer}
                    options={(q.facets?.employers ?? []).map((e) => ({ value: e.id, label: `${e.name} (${e.id})` }))}
                    onChange={(v) => q.patch({ employer: v })}
                  />

                  <Button variant="ghost" size="sm" className="w-full" onClick={q.resetFilters}>Reset filters</Button>
                </PopoverContent>
              </Popover>

              <Select value={q.sort} onValueChange={(v) => q.patch({ sort: v }, false)}>
                <SelectTrigger className="w-[210px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INSPECTION_SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {hasFilters ? (
              <div className="flex flex-wrap gap-2">
                {q.activeFilterChips.map((c) => (
                  <Badge key={c.key} variant="secondary" className="gap-1">
                    {c.label}
                    <button aria-label={`Remove ${c.label}`} onClick={() => q.patch({ [c.key]: undefined })}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={q.resetFilters}>Reset filters</Button>
              </div>
            ) : null}

            {/* body */}
            {q.error ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Unable to load inspections</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>Inspection Management could not be loaded. {q.error.message}</p>
                  <Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>
                </AlertDescription>
              </Alert>
            ) : q.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : q.rows.length === 0 ? (
              <div className="py-12 text-center">
                <Inbox className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                <p className="font-medium">No inspections found</p>
                <p className="text-sm text-muted-foreground">
                  {hasFilters ? 'No inspections match the selected filters.' : 'No inspections exist in your authorised scope yet.'}
                </p>
                <div className="mt-3 flex justify-center gap-2">
                  {hasFilters ? <Button variant="outline" size="sm" onClick={q.resetFilters}>Clear filters</Button> : null}
                  {!hasFilters && canSchedule ? <ScheduleInspectionDialog /> : null}
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {sortHead('inspection', 'Inspection')}
                      {sortHead('employer', 'Employer')}
                      {sortHead('type', 'Type')}
                      {sortHead('inspector', 'Inspector')}
                      {sortHead('scheduled', 'Scheduled')}
                      <TableHead>Zone / location</TableHead>
                      {sortHead('status', 'Status')}
                      {sortHead('risk', 'Risk')}
                      {sortHead('findings', 'Findings', 'text-center')}
                      <TableHead>Report</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {q.rows.map((r) => (
                      <TableRow key={r.id} className="align-top">
                        <TableCell className="py-2">
                          <button
                            className="font-mono text-xs font-medium text-primary hover:underline"
                            onClick={() => setDetailId(r.id)}
                          >
                            {r.inspection_number}
                          </button>
                          {r.plan_number || r.case_number ? (
                            <p className="text-[11px] text-muted-foreground">
                              {r.plan_number ? `Plan ${r.plan_number}` : ''}
                              {r.plan_number && r.case_number ? ' · ' : ''}
                              {r.case_number ? `Case ${r.case_number}` : ''}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="py-2">
                          {r.employer_id ? (
                            <Link to={`/compliance/field/employer-360/${r.employer_id}`} className="font-medium hover:underline">
                              {r.employer_name ?? r.employer_id}
                            </Link>
                          ) : <span className="font-medium">{r.employer_name ?? '—'}</span>}
                          <p className="font-mono text-[11px] text-muted-foreground">{r.employer_id ?? '—'}</p>
                        </TableCell>
                        <TableCell className="py-2 text-xs">{r.inspection_type ?? '—'}</TableCell>
                        <TableCell className="py-2 text-xs">
                          {r.inspector_name ?? r.inspector_id ?? <span className="text-destructive">Unassigned</span>}
                          {r.inspector_code && r.inspector_code !== r.inspector_name ? (
                            <p className="text-[11px] text-muted-foreground">{r.inspector_code}</p>
                          ) : null}
                        </TableCell>
                        <TableCell className="py-2 text-xs">
                          {fmtDate(r.scheduled_date)}
                          {r.scheduled_time ? <p className="text-[11px] text-muted-foreground">{r.scheduled_time.slice(0, 5)}</p> : null}
                        </TableCell>
                        <TableCell className="py-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />{r.territory ?? '—'}
                          </span>
                          {r.location_address ? <p className="max-w-[180px] truncate text-[11px]">{r.location_address}</p> : null}
                        </TableCell>
                        <TableCell className="py-2">
                          <div className="flex flex-col items-start gap-1">
                            {lifecycleBadge(r)}
                            {TIMING_LABEL[r.timing_status] ? (
                              <Badge variant={r.is_overdue ? 'destructive' : 'outline'} className="text-[10px]">
                                {TIMING_LABEL[r.timing_status]}
                                {r.is_overdue && r.age_days ? ` ${r.age_days}d` : ''}
                              </Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="py-2">{riskBadge(r.risk_band)}</TableCell>
                        <TableCell className="py-2 text-center">
                          {r.findings_count > 0 ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  className="font-medium text-primary hover:underline"
                                  onClick={() => navigate(`/compliance/field/findings?inspection_id=${r.id}`)}
                                >
                                  {r.findings_count}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {r.critical_high_findings} critical/high · {r.findings_pending_review} awaiting review
                              </TooltipContent>
                            </Tooltip>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="py-2">
                          {r.report_id ? (
                            <Link to={`/compliance/field/audit-report/${r.id}`} className="text-xs text-primary hover:underline">
                              {REPORT_LABEL[r.report_status] ?? r.report_status}
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground">Not started</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2 text-right">
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setDetailId(r.id)}>
                            Open
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* pagination */}
            {q.rows.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <p className="text-xs text-muted-foreground">
                  Showing {firstRow.toLocaleString()}–{lastRow.toLocaleString()} of {q.total.toLocaleString()}
                  {hasFilters ? ' matching' : ''} inspections
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Rows per page</span>
                  <Select value={String(q.pageSize)} onValueChange={(v) => q.patch({ size: v })}>
                    <SelectTrigger className="h-8 w-[80px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZES.map((s) => <SelectItem key={s} value={String(s)}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">Page {q.page} of {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={q.page <= 1} onClick={() => q.patch({ page: q.page - 1 }, false)}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={q.page >= totalPages} onClick={() => q.patch({ page: q.page + 1 }, false)}>
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <InspectionDetailDialog inspectionId={detailId} onOpenChange={(open) => !open && setDetailId(null)} />
      </div>
    </TooltipProvider>
  );
}
