import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ComplianceHelpButton } from '@/components/help/ComplianceHelpButton';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Briefcase, Building2, Check, ChevronLeft,
  ChevronRight, ChevronsLeft, ChevronsRight, ChevronsUpDown, Download, Eye, Filter, Loader2,
  Plus, RotateCcw, Search, X,
} from 'lucide-react';
import { NewCaseDialog } from '@/components/compliance/NewCaseDialog';
import { EmployerLinkChip } from '@/components/compliance/EmployerLinkChip';
import { formatDisplayDate } from '@/lib/dateFormat';
import { exportToExcel } from '@/utils/exportUtils';
import { toast } from 'sonner';
import {
  useCaseRegister, CASE_SORTS, PAGE_SIZE_OPTIONS, AGE_BUCKETS, SLA_OPTIONS,
  AMOUNT_RANGES, ARRANGEMENT_OPTIONS, DATE_PRESETS, datePresetRange,
  type CaseRow,
} from '@/hooks/compliance/useCaseRegister';

const ANY = '__ANY__';
const titleise = (v: string) => v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const statusVariant = (group: CaseRow['status_group']) => {
  switch (group) {
    case 'LEGAL': return 'destructive' as const;
    case 'RESOLVED': return 'default' as const;
    case 'CLOSED': return 'secondary' as const;
    default: return 'outline' as const;
  }
};

const priorityVariant = (p: string) =>
  p === 'CRITICAL' ? ('destructive' as const) : p === 'HIGH' ? ('default' as const) : ('secondary' as const);

const riskTone = (band: string) => {
  switch (band) {
    case 'CRITICAL': return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'HIGH': return 'border-warning/30 bg-warning/10 text-warning';
    case 'MEDIUM': return 'border-accent/30 bg-accent/20 text-accent-foreground';
    case 'LOW': return 'border-primary/20 bg-primary/10 text-primary';
    default: return 'text-muted-foreground';
  }
};

const slaLabel: Record<CaseRow['sla_status'], string> = {
  OVERDUE: 'Overdue',
  DUE_TODAY: 'Due today',
  DUE_1_3: 'Due 1–3d',
  DUE_4_7: 'Due 4–7d',
  WITHIN_SLA: 'Within SLA',
  NO_SLA: 'No target',
  NOT_APPLICABLE: '—',
};

/** Searchable employer combobox driven by employers present in the caller's authorised case scope. */
function EmployerCombobox({
  value, options, onChange,
}: { value?: string; options: { id: string; name: string }[]; onChange: (v?: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 w-[240px] justify-between font-normal">
          <span className="flex items-center gap-1.5 truncate">
            <Building2 className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="truncate">
              {selected ? `${selected.name} — ${selected.id}` : value ? value : 'All employers'}
            </span>
          </span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search employer or registration no." />
          <CommandList>
            <CommandEmpty>No employer found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="all-employers" onSelect={() => { onChange(undefined); setOpen(false); }}>
                <Check className={`mr-2 h-4 w-4 ${!value ? 'opacity-100' : 'opacity-0'}`} />
                All employers
              </CommandItem>
              {options.map((o) => (
                <CommandItem key={o.id} value={`${o.name} ${o.id}`} onSelect={() => { onChange(o.id); setOpen(false); }}>
                  <Check className={`mr-2 h-4 w-4 ${value === o.id ? 'opacity-100' : 'opacity-0'}`} />
                  <span className="truncate">{o.name}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{o.id}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Multi-select popover used for canonical status / priority / risk-band vocabularies. */
function MultiSelect({
  label, values, options, onToggle, width = 'w-[200px]', format = titleise,
}: {
  label: string; values: string[]; options: string[];
  onToggle: (v: string) => void; width?: string; format?: (v: string) => string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={`h-9 ${width} justify-between font-normal`}>
          <span className="truncate">
            {values.length === 0 ? label : values.length === 1 ? format(values[0]) : `${label}: ${values.length}`}
          </span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-80 w-[260px] overflow-y-auto p-2" align="start">
        {options.length === 0 && <p className="p-2 text-xs text-muted-foreground">No values available.</p>}
        {options.map((o) => (
          <label key={o} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
            <Checkbox checked={values.includes(o)} onCheckedChange={() => onToggle(o)} />
            <span className="truncate">{format(o)}</span>
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}

const CaseManagement = () => {
  const navigate = useNavigate();
  const q = useCaseRegister();
  const [newCaseOpen, setNewCaseOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState(q.filters.search ?? '');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { setSearchDraft(q.filters.search ?? ''); }, [q.filters.search]);
  useEffect(() => {
    const t = setTimeout(() => {
      if ((q.filters.search ?? '') !== searchDraft) q.patchFilters({ search: searchDraft.trim() || undefined });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  const f = q.filters;
  const filtersActive = q.activeFilterCount > 0;
  const kpis = filtersActive ? q.kpisFiltered : q.kpisAll;
  const start = q.total === 0 ? 0 : (q.page - 1) * q.pageSize + 1;
  const end = Math.min(q.page * q.pageSize, q.total);

  const amountValue = f.amount_min || f.amount_max ? `${f.amount_min ?? ''}-${f.amount_max ?? ''}` : ANY;
  const setAmountRange = (v: string) => {
    if (v === ANY) return q.patchFilters({ amount_min: undefined, amount_max: undefined });
    const [min, max] = v.split('-');
    q.patchFilters({ amount_min: min || undefined, amount_max: max || undefined });
  };

  const pageNumbers = useMemo(() => {
    const to = Math.min(q.totalPages, Math.max(1, q.page - 2) + 4);
    const from = Math.max(1, to - 4);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }, [q.page, q.totalPages]);

  const sortIcon = (key: string) =>
    q.sort !== key ? <ArrowUpDown className="h-3 w-3 opacity-40" />
      : q.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;

  const Th = ({ label, sortKey, className }: { label: string; sortKey?: string; className?: string }) => (
    <TableHead
      className={`${className ?? ''} ${sortKey ? 'cursor-pointer select-none hover:bg-muted/50' : ''}`}
      onClick={sortKey ? () => q.toggleSort(sortKey) : undefined}
    >
      <div className={`flex items-center gap-1 ${className?.includes('text-right') ? 'justify-end' : ''}`}>
        {label}{sortKey && sortIcon(sortKey)}
      </div>
    </TableHead>
  );

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (f.search) chips.push({ key: 'search', label: `Search: ${f.search}`, clear: () => q.patchFilters({ search: undefined }) });
  if (f.employer) {
    const name = q.options.employers.find((e) => e.id === f.employer)?.name;
    chips.push({ key: 'employer', label: `Employer: ${name ? `${name} (${f.employer})` : f.employer}`, clear: () => q.patchFilters({ employer: undefined }) });
  }
  (f.statuses ?? []).forEach((s) => chips.push({ key: `st-${s}`, label: `Status: ${titleise(s)}`, clear: () => q.toggleInList('statuses', s) }));
  if (f.status_group) chips.push({ key: 'group', label: `Group: ${titleise(f.status_group)}`, clear: () => q.patchFilters({ status_group: undefined }) });
  (f.priorities ?? []).forEach((p) => chips.push({ key: `pr-${p}`, label: `Priority: ${titleise(p)}`, clear: () => q.toggleInList('priorities', p) }));
  (f.risk_bands ?? []).forEach((r) => chips.push({ key: `rk-${r}`, label: `Risk: ${titleise(r)}`, clear: () => q.toggleInList('risk_bands', r) }));
  if (f.assigned) {
    const label = f.assigned === 'ME' ? 'My cases' : f.assigned === 'UNASSIGNED' ? 'Unassigned'
      : q.options.officers.find((o) => o.id === f.assigned)?.name ?? f.assigned;
    chips.push({ key: 'assigned', label: `Assigned: ${label}`, clear: () => q.patchFilters({ assigned: undefined }) });
  }
  if (f.territory) chips.push({ key: 'terr', label: `Zone: ${f.territory}`, clear: () => q.patchFilters({ territory: undefined }) });
  if (f.case_type) chips.push({ key: 'ctype', label: `Type: ${titleise(f.case_type)}`, clear: () => q.patchFilters({ case_type: undefined }) });
  if (f.date_from || f.date_to) chips.push({ key: 'dates', label: `Opened: ${f.date_from ?? '…'} → ${f.date_to ?? '…'}`, clear: () => q.patchFilters({ date_from: undefined, date_to: undefined }) });
  if (f.age) chips.push({ key: 'age', label: `Age: ${AGE_BUCKETS.find((a) => a.value === f.age)?.label}`, clear: () => q.patchFilters({ age: undefined }) });
  if (f.sla) chips.push({ key: 'sla', label: `SLA: ${SLA_OPTIONS.find((s) => s.value === f.sla)?.label}`, clear: () => q.patchFilters({ sla: undefined }) });
  if (f.amount_min || f.amount_max) chips.push({ key: 'amt', label: `Amount: ${f.amount_min ?? '0'} – ${f.amount_max ?? '∞'}`, clear: () => q.patchFilters({ amount_min: undefined, amount_max: undefined }) });
  if (f.arrangement) chips.push({ key: 'arr', label: `Arrangement: ${ARRANGEMENT_OPTIONS.find((a) => a.value === f.arrangement)?.label}`, clear: () => q.patchFilters({ arrangement: undefined }) });
  if (f.legal_only) chips.push({ key: 'legal', label: 'Legal / Court only', clear: () => q.patchFilters({ legal_only: false }) });

  const quickChips: { label: string; active: boolean; apply: () => void }[] = [
    { label: 'All Cases', active: !filtersActive, apply: q.resetFilters },
    { label: 'My Cases', active: f.assigned === 'ME', apply: () => q.patchFilters({ assigned: f.assigned === 'ME' ? undefined : 'ME' }) },
    { label: 'Unassigned', active: f.assigned === 'UNASSIGNED', apply: () => q.patchFilters({ assigned: f.assigned === 'UNASSIGNED' ? undefined : 'UNASSIGNED' }) },
    {
      label: 'Critical / High',
      active: (f.priorities ?? []).length === 2 && (f.priorities ?? []).includes('CRITICAL'),
      apply: () => q.patchFilters({ priorities: (f.priorities ?? []).includes('CRITICAL') ? [] : ['CRITICAL', 'HIGH'] }),
    },
    { label: 'Overdue', active: f.sla === 'OVERDUE', apply: () => q.patchFilters({ sla: f.sla === 'OVERDUE' ? undefined : 'OVERDUE' }) },
    {
      label: 'High Risk',
      active: (f.risk_bands ?? []).includes('HIGH') || (f.risk_bands ?? []).includes('CRITICAL'),
      apply: () => q.patchFilters({ risk_bands: (f.risk_bands ?? []).includes('HIGH') ? [] : ['CRITICAL', 'HIGH'] }),
    },
    { label: 'Legal / Court', active: f.status_group === 'LEGAL', apply: () => q.patchFilters({ status_group: f.status_group === 'LEGAL' ? undefined : 'LEGAL' }) },
    {
      label: 'Recently Opened',
      active: f.age === '0_7',
      apply: () => q.patchFilters({ age: f.age === '0_7' ? undefined : '0_7' }),
    },
    { label: 'Resolved', active: f.status_group === 'RESOLVED', apply: () => q.patchFilters({ status_group: f.status_group === 'RESOLVED' ? undefined : 'RESOLVED' }) },
  ];

  const handleExport = async () => {
    setExporting(true);
    try {
      const rows = await q.fetchAllForExport();
      if (rows.length === 0) { toast.info('Nothing to export for the selected filters'); return; }
      await exportToExcel(
        rows.map((r) => ({
          case_number: r.case_number,
          employer: r.employer_name || '',
          employer_id: r.employer_id || '',
          territory: r.territory,
          status: titleise(r.status),
          priority: titleise(r.priority),
          risk_band: titleise(r.risk_band),
          total_amount: Number(r.total_amount) || 0,
          assigned: r.assigned_officer_name || 'Unassigned',
          opened_date: r.opened_date ? formatDisplayDate(r.opened_date) : '',
          age_days: r.age_days,
          sla: slaLabel[r.sla_status],
          arrangement: titleise(r.arrangement_state),
        })),
        [
          { header: 'Case No.', key: 'case_number', width: 20 },
          { header: 'Employer', key: 'employer', width: 30 },
          { header: 'Registration No.', key: 'employer_id', width: 18 },
          { header: 'Territory / Zone', key: 'territory', width: 20 },
          { header: 'Status', key: 'status', width: 22 },
          { header: 'Priority', key: 'priority', width: 12 },
          { header: 'Risk Band', key: 'risk_band', width: 12 },
          { header: 'Arrears / Exposure', key: 'total_amount', width: 18 },
          { header: 'Assigned To', key: 'assigned', width: 24 },
          { header: 'Opened', key: 'opened_date', width: 14 },
          { header: 'Age (days)', key: 'age_days', width: 12 },
          { header: 'SLA', key: 'sla', width: 14 },
          { header: 'Arrangement', key: 'arrangement', width: 18 },
        ],
        `compliance-case-register-${new Date().toISOString().slice(0, 10)}`,
        'Case Register',
      );
      toast.success(`Exported ${rows.length.toLocaleString()} cases`);
    } catch (e) {
      console.error('[CaseManagement] export failed', e);
      toast.error('Unable to export the case register. Please retry.');
    } finally {
      setExporting(false);
    }
  };

  const kpiCards = [
    { label: 'Total Cases', value: kpis.total.toLocaleString(), tone: 'text-foreground' },
    { label: 'Open', value: kpis.open.toLocaleString(), tone: 'text-warning' },
    { label: 'Legal / Court', value: kpis.legal.toLocaleString(), tone: 'text-destructive' },
    { label: 'Overdue', value: kpis.overdue.toLocaleString(), tone: 'text-destructive' },
    { label: 'Unassigned', value: kpis.unassigned.toLocaleString(), tone: 'text-muted-foreground' },
    {
      label: 'Total Arrears',
      value: `$${Number(kpis.arrears) >= 1000 ? `${(Number(kpis.arrears) / 1000).toFixed(1)}K` : Number(kpis.arrears).toFixed(0)}`,
      tone: 'text-primary',
    },
  ];

  return (
    <div className="container mx-auto space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold text-foreground">Compliance Case Register</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Master operational register of compliance cases across their full lifecycle
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ComplianceHelpButton screenKey="cases" />
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || q.total === 0}>
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Export register
          </Button>
          <Button size="sm" className="gap-2" onClick={() => setNewCaseOpen(true)}><Plus className="h-4 w-4" />New Case</Button>
          <NewCaseDialog open={newCaseOpen} onOpenChange={setNewCaseOpen} />
        </div>
      </div>

      {/* KPI strip — aggregated server-side over the authorised case population */}
      <div>
        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{filtersActive ? 'Metrics reflect the current filtered view' : 'Metrics reflect your full authorised case population'}</span>
          {filtersActive && <Badge variant="secondary" className="text-[10px]">Filtered view</Badge>}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {kpiCards.map((k) => (
            <Card key={k.label}>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className={`text-xl font-bold ${k.tone}`}>{q.isLoading ? '—' : k.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div className="space-y-3 rounded-lg border bg-card/50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search case no., employer or registration no."
              className="h-9 pl-8"
            />
            {searchDraft && (
              <button type="button" aria-label="Clear search" className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
                onClick={() => setSearchDraft('')}>
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <EmployerCombobox value={f.employer} options={q.options.employers} onChange={(v) => q.patchFilters({ employer: v })} />

          <MultiSelect label="Status" values={f.statuses ?? []} options={q.options.statuses}
            onToggle={(v) => q.toggleInList('statuses', v)} width="w-[190px]" />

          <Select value={f.assigned ?? ANY} onValueChange={(v) => q.patchFilters({ assigned: v === ANY ? undefined : v })}>
            <SelectTrigger className="h-9 w-[190px]"><SelectValue placeholder="Any officer" /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={ANY}>Any officer</SelectItem>
              <SelectItem value="ME">My cases</SelectItem>
              <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
              {q.options.officers.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <MultiSelect label="Priority" values={f.priorities ?? []} options={q.options.priorities}
            onToggle={(v) => q.toggleInList('priorities', v)} width="w-[160px]" />

          <Button variant="ghost" size="sm" className="h-9" onClick={() => setShowAdvanced((s) => !s)}>
            <Filter className="mr-1 h-4 w-4" /> Filters
            {q.activeFilterCount > 0 && <Badge variant="secondary" className="ml-1">{q.activeFilterCount}</Badge>}
          </Button>

          <div className="flex items-center gap-1">
            <Select value={q.sort} onValueChange={(v) => q.changeSort(v)}>
              <SelectTrigger className="h-9 w-[190px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CASE_SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-9" disabled={q.sort === 'urgency'}
              onClick={() => q.changeSort(q.sort, q.dir === 'asc' ? 'desc' : 'asc')}>
              {q.dir === 'asc' ? 'Asc' : 'Desc'}
            </Button>
          </div>

          {filtersActive && (
            <Button variant="ghost" size="sm" className="h-9" onClick={q.resetFilters}>
              <RotateCcw className="mr-1 h-4 w-4" /> Reset
            </Button>
          )}
        </div>

        {showAdvanced && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <MultiSelect label="Risk band" values={f.risk_bands ?? []} options={q.options.risk_bands}
              onToggle={(v) => q.toggleInList('risk_bands', v)} width="w-full" />
            <Select value={f.territory ?? ANY} onValueChange={(v) => q.patchFilters({ territory: v === ANY ? undefined : v })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="All territories / zones" /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={ANY}>All territories / zones</SelectItem>
                {q.options.territories.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select
              value={ANY}
              onValueChange={(v) => {
                if (v === ANY) return q.patchFilters({ date_from: undefined, date_to: undefined });
                const r = datePresetRange(v);
                q.patchFilters({ date_from: r.from, date_to: r.to });
              }}
            >
              <SelectTrigger className="h-9"><SelectValue placeholder="Opened date" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any opened date</SelectItem>
                {DATE_PRESETS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Input type="date" className="h-9" value={f.date_from ?? ''} onChange={(e) => q.patchFilters({ date_from: e.target.value || undefined })} />
              <Input type="date" className="h-9" value={f.date_to ?? ''} onChange={(e) => q.patchFilters({ date_to: e.target.value || undefined })} />
            </div>
            <Select value={f.age ?? ANY} onValueChange={(v) => q.patchFilters({ age: v === ANY ? undefined : v })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Case age" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any case age</SelectItem>
                {AGE_BUCKETS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={f.sla ?? ANY} onValueChange={(v) => q.patchFilters({ sla: v === ANY ? undefined : v })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="SLA status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any SLA status</SelectItem>
                {SLA_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={amountValue} onValueChange={setAmountRange}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Case amount" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any amount</SelectItem>
                {AMOUNT_RANGES.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={f.case_type ?? ANY} onValueChange={(v) => q.patchFilters({ case_type: v === ANY ? undefined : v })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Case type" /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={ANY}>All case types</SelectItem>
                {q.options.case_types.map((t) => <SelectItem key={t} value={t}>{titleise(t)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={f.arrangement ?? ANY} onValueChange={(v) => q.patchFilters({ arrangement: v === ANY ? undefined : v })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Arrangement status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any arrangement status</SelectItem>
                {ARRANGEMENT_OPTIONS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={f.status_group ?? ANY} onValueChange={(v) => q.patchFilters({ status_group: v === ANY ? undefined : v })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Lifecycle group" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All lifecycle groups</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="LEGAL">Legal / Court</SelectItem>
                <SelectItem value="RESOLVED">Resolved</SelectItem>
                <SelectItem value="CLOSED">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Quick operational filters */}
        <div className="flex flex-wrap items-center gap-1">
          {quickChips.map((c) => (
            <Badge key={c.label} variant={c.active ? 'default' : 'outline'} className="cursor-pointer" onClick={c.apply}>
              {c.label}
            </Badge>
          ))}
        </div>

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 border-t pt-2">
            {chips.map((c) => (
              <Badge key={c.key} variant="secondary" className="cursor-pointer gap-1" onClick={c.clear}>
                {c.label}<X className="h-3 w-3" />
              </Badge>
            ))}
          </div>
        )}
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {q.isLoading
                ? 'Loading cases…'
                : `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${q.total.toLocaleString()} ${filtersActive ? 'matching ' : ''}cases`}
              {q.isFetching && !q.isLoading && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" />}
            </p>
            {q.scope && q.scope !== 'enterprise' && (
              <Badge variant="outline" className="text-[10px]">Scope: {titleise(q.scope)} cases only</Badge>
            )}
          </div>

          {q.error ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <AlertTriangle className="h-8 w-8 text-destructive" />
              <div>
                <p className="text-sm font-medium">The case register could not be loaded.</p>
                <p className="text-xs text-muted-foreground">This is a system error, not an empty register.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => q.refetch()}>Retry</Button>
            </div>
          ) : q.isLoading ? (
            <div className="space-y-2">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : q.rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center text-muted-foreground">
              <Briefcase className="h-10 w-10" />
              {filtersActive ? (
                <>
                  <p className="text-sm">No cases match the selected filters.</p>
                  <Button variant="outline" size="sm" onClick={q.resetFilters}>Clear filters</Button>
                </>
              ) : (
                <p className="text-sm">No compliance cases exist yet.</p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <Th label="Case No." sortKey="case_number" />
                    <Th label="Employer" sortKey="employer" />
                    <Th label="Territory / Zone" />
                    <Th label="Status" sortKey="status" />
                    <Th label="Priority" sortKey="priority" />
                    <Th label="Risk" sortKey="risk" />
                    <Th label="Arrears" sortKey="amount" className="text-right" />
                    <Th label="Assigned To" sortKey="assigned" />
                    <Th label="Opened" sortKey="opened_date" />
                    <Th label="Age / SLA" sortKey="age" />
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.rows.map((c) => (
                    <TableRow key={c.id} className="hover:bg-muted/50">
                      <TableCell className="font-mono text-xs">
                        <button className="font-medium text-primary hover:underline"
                          onClick={() => navigate(`/compliance/cases/${c.id}`)}>
                          {c.case_number}
                        </button>
                      </TableCell>
                      <TableCell><EmployerLinkChip regno={c.employer_id} name={c.employer_name} /></TableCell>
                      <TableCell className="text-xs">{c.territory}</TableCell>
                      <TableCell>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant={statusVariant(c.status_group)} className="text-[10px]">{titleise(c.status)}</Badge>
                            </TooltipTrigger>
                            <TooltipContent>Lifecycle group: {titleise(c.status_group)}</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell>
                        <Badge variant={priorityVariant(c.priority)} className="text-[10px]">{titleise(c.priority)}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${riskTone(c.risk_band)}`}>{titleise(c.risk_band)}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">${(Number(c.total_amount) || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-xs">{c.assigned_officer_name || <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{c.opened_date ? formatDisplayDate(c.opened_date) : '—'}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        <span>{c.age_days}d</span>
                        {c.sla_status !== 'NOT_APPLICABLE' && c.sla_status !== 'NO_SLA' && (
                          <Badge
                            variant={c.sla_status === 'OVERDUE' ? 'destructive' : c.sla_status === 'DUE_TODAY' ? 'default' : 'outline'}
                            className="ml-1 text-[10px]"
                          >
                            {slaLabel[c.sla_status]}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" aria-label="View case" onClick={() => navigate(`/compliance/cases/${c.id}`)}>
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
              <Select value={String(q.pageSize)} onValueChange={(v) => q.setPageSize(Number(v))}>
                <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex flex-wrap items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={q.page <= 1} onClick={() => q.setPage(1)}>
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" className="h-8" disabled={q.page <= 1} onClick={() => q.setPage(q.page - 1)}>
                  <ChevronLeft className="mr-1 h-4 w-4" /> Previous
                </Button>
                {pageNumbers.map((p) => (
                  <Button key={p} size="sm" className="h-8 w-8 p-0" variant={p === q.page ? 'default' : 'outline'} onClick={() => q.setPage(p)}>{p}</Button>
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
};

export default CaseManagement;
