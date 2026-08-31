import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Search, Building2, Loader2, X, SlidersHorizontal, AlertTriangle, RotateCcw,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ArrowUpDown, ExternalLink, Clock,
} from 'lucide-react';
import {
  useEmployerLookup, EMPLOYER_SORTS, PAGE_SIZE_OPTIONS, REGISTERED_OPTIONS, MIN_SEARCH_LENGTH,
  type EmployerLookupRow,
} from '@/hooks/compliance/useEmployerLookup';
import { formatComplianceCurrency } from '@/services/complianceViolationAmountService';

/** Local (per-browser) recently viewed employers — never shared across users. */
const RECENT_KEY = 'ce.employer360.recent';
interface RecentEmployer { regno: string; name: string }

function readRecent(): RecentEmployer[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function rememberEmployer(entry: RecentEmployer) {
  try {
    const next = [entry, ...readRecent().filter((r) => r.regno !== entry.regno)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — recents are a convenience only */
  }
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  ACTIVE: 'default',
  INACTIVE: 'secondary',
  CLOSED: 'destructive',
  CEASED: 'destructive',
  UNCLASSIFIED: 'outline',
};

const RISK_CLASS: Record<string, string> = {
  LOW: 'bg-green-500/15 text-green-700',
  MEDIUM: 'bg-yellow-500/15 text-yellow-700',
  HIGH: 'bg-orange-500/15 text-orange-700',
  CRITICAL: 'bg-destructive/15 text-destructive',
  UNRATED: 'bg-muted text-muted-foreground',
};

const titleCase = (v: string) => v.charAt(0) + v.slice(1).toLowerCase();
const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');

export default function Employer360Search() {
  const navigate = useNavigate();
  const lookup = useEmployerLookup();
  const {
    rows, options, total, exactRegno, isLoading, isFetching, isError,
    filters, search, sort, dir, page, pageSize, totalPages, activeFilterCount,
    patchFilters, toggleInList, resetFilters, changeSort, toggleDir, setPage, setPageSize,
    enabled, hasSearch, refetch,
  } = lookup;

  const [term, setTerm] = useState(search);
  const [recent, setRecent] = useState<RecentEmployer[]>(() => readRecent());

  useEffect(() => { setTerm(search); }, [search]);

  // Debounced search — never queries on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = term.trim();
      if (trimmed === (search ?? '')) return;
      if (trimmed.length === 0 || trimmed.length >= MIN_SEARCH_LENGTH) {
        patchFilters({ search: trimmed || undefined });
      }
    }, 350);
    return () => clearTimeout(t);
  }, [term, search, patchFilters]);

  const openEmployer = useCallback((row: EmployerLookupRow) => {
    rememberEmployer({ regno: row.regno, name: row.name });
    setRecent(readRecent());
    navigate(`/compliance/field/employer-360/${encodeURIComponent(row.regno)}`);
  }, [navigate]);

  const chips = useMemo(() => {
    const out: { key: string; label: string; clear: () => void }[] = [];
    (filters.statuses ?? []).forEach((s) =>
      out.push({ key: `st-${s}`, label: `Status: ${titleCase(s)}`, clear: () => toggleInList('statuses', s) }));
    (filters.offices ?? []).forEach((o) =>
      out.push({ key: `of-${o}`, label: `Office: ${o}`, clear: () => toggleInList('offices', o) }));
    (filters.risk_bands ?? []).forEach((r) =>
      out.push({ key: `rk-${r}`, label: `Risk: ${titleCase(r)}`, clear: () => toggleInList('risk_bands', r) }));
    if (filters.registered) out.push({
      key: 'reg', label: `Registered: ${REGISTERED_OPTIONS.find((o) => o.value === filters.registered)?.label}`,
      clear: () => patchFilters({ registered: undefined, date_from: undefined, date_to: undefined }),
    });
    if (filters.sector) out.push({ key: 'sec', label: `Sector: ${filters.sector}`, clear: () => patchFilters({ sector: undefined }) });
    if (filters.ownership) out.push({ key: 'own', label: `Type: ${filters.ownership}`, clear: () => patchFilters({ ownership: undefined }) });
    if (filters.has_violations) out.push({ key: 'hv', label: 'Has open violations', clear: () => patchFilters({ has_violations: false }) });
    if (filters.has_cases) out.push({ key: 'hc', label: 'Has active cases', clear: () => patchFilters({ has_cases: false }) });
    if (filters.has_outstanding) out.push({ key: 'ho', label: 'Outstanding balance', clear: () => patchFilters({ has_outstanding: false }) });
    if (filters.high_risk) out.push({ key: 'hr', label: 'High / critical risk', clear: () => patchFilters({ high_risk: false }) });
    return out;
  }, [filters, toggleInList, patchFilters]);

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const multi = (
    label: string,
    key: 'statuses' | 'offices' | 'risk_bands',
    values: string[],
  ) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9">
          {label}
          {(filters[key]?.length ?? 0) > 0 && (
            <Badge variant="secondary" className="ml-2 h-5 px-1.5">{filters[key]!.length}</Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto w-56 bg-popover z-50">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {values.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No values available</div>}
        {values.map((v) => (
          <DropdownMenuCheckboxItem
            key={v}
            checked={filters[key]?.includes(v) ?? false}
            onCheckedChange={() => toggleInList(key, v)}
            onSelect={(e) => e.preventDefault()}
          >
            {titleCase(v)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="container mx-auto p-6 space-y-4">
      <PageHeader
        title="Employer 360°"
        subtitle="Locate the correct employer and open the comprehensive Employer 360 profile"
        breadcrumbs={[{ label: 'Compliance', href: '/compliance' }, { label: 'Employer 360°' }]}
      />

      {/* Toolbar */}
      <Card>
        <CardContent className="p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[260px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Registration number, employer name, trade name, email or phone…"
                className="pl-9 h-9"
                aria-label="Search employers"
              />
              {term && (
                <button
                  onClick={() => { setTerm(''); patchFilters({ search: undefined }); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {multi('Status', 'statuses', options.statuses)}
            {multi('Office / Zone', 'offices', options.offices)}
            {multi('Risk', 'risk_bands', options.risk_bands)}

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                  <SlidersHorizontal className="h-4 w-4 mr-1" />More filters
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 bg-popover z-50 space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Registered date</label>
                  <Select
                    value={filters.registered ?? 'ANY'}
                    onValueChange={(v) => patchFilters({ registered: v === 'ANY' ? undefined : v })}
                  >
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-popover z-50">
                      <SelectItem value="ANY">Any time</SelectItem>
                      {REGISTERED_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {filters.registered === 'CUSTOM' && (
                  <div className="flex gap-2">
                    <Input type="date" className="h-9" value={filters.date_from ?? ''}
                      onChange={(e) => patchFilters({ date_from: e.target.value || undefined })} />
                    <Input type="date" className="h-9" value={filters.date_to ?? ''}
                      onChange={(e) => patchFilters({ date_to: e.target.value || undefined })} />
                  </div>
                )}
                {options.sectors.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Sector</label>
                    <Select value={filters.sector ?? 'ANY'} onValueChange={(v) => patchFilters({ sector: v === 'ANY' ? undefined : v })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-popover z-50 max-h-64">
                        <SelectItem value="ANY">Any sector</SelectItem>
                        {options.sectors.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {options.ownerships.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Employer type (ownership)</label>
                    <Select value={filters.ownership ?? 'ANY'} onValueChange={(v) => patchFilters({ ownership: v === 'ANY' ? undefined : v })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-popover z-50 max-h-64">
                        <SelectItem value="ANY">Any type</SelectItem>
                        {options.ownerships.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </PopoverContent>
            </Popover>

            <Button variant="ghost" size="sm" className="h-9" onClick={() => { setTerm(''); resetFilters(); }}
              disabled={activeFilterCount === 0 && !search}>
              <RotateCcw className="h-4 w-4 mr-1" />Reset
            </Button>
          </div>

          {/* Quick filters + sort */}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={filters.has_violations ? 'default' : 'outline'} className="h-8"
              onClick={() => patchFilters({ has_violations: !filters.has_violations })}>Has open violations</Button>
            <Button size="sm" variant={filters.has_cases ? 'default' : 'outline'} className="h-8"
              onClick={() => patchFilters({ has_cases: !filters.has_cases })}>Has active cases</Button>
            <Button size="sm" variant={filters.high_risk ? 'default' : 'outline'} className="h-8"
              onClick={() => patchFilters({ high_risk: !filters.high_risk })}>High / critical risk</Button>
            <Button size="sm" variant={filters.has_outstanding ? 'default' : 'outline'} className="h-8"
              onClick={() => patchFilters({ has_outstanding: !filters.has_outstanding })}>Outstanding balance</Button>

            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Sort</span>
              <Select value={sort} onValueChange={(v) => changeSort(v)}>
                <SelectTrigger className="h-8 w-[190px]"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover z-50">
                  {EMPLOYER_SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="h-8" onClick={toggleDir} disabled={sort === 'relevance'}>
                <ArrowUpDown className="h-4 w-4 mr-1" />{dir === 'asc' ? 'Asc' : 'Desc'}
              </Button>
            </div>
          </div>

          {chips.length > 0 && (
            <>
              <Separator />
              <div className="flex flex-wrap items-center gap-1.5">
                {chips.map((c) => (
                  <Badge key={c.key} variant="secondary" className="gap-1">
                    {c.label}
                    <button onClick={c.clear} aria-label={`Remove ${c.label}`}><X className="h-3 w-3" /></button>
                  </Badge>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Exact registration-number match */}
      {exactRegno && (
        <Card className="border-primary/40">
          <CardContent className="flex items-center justify-between gap-3 p-3">
            <div className="text-sm">
              Exact registration number match: <span className="font-mono font-semibold">{exactRegno}</span>
            </div>
            <Button size="sm" asChild>
              <Link to={`/compliance/field/employer-360/${encodeURIComponent(exactRegno)}`}>
                Open 360 <ExternalLink className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Initial state */}
      {!enabled && (
        <Card>
          <CardContent className="py-10 text-center space-y-4">
            <Building2 className="h-10 w-10 mx-auto text-muted-foreground opacity-40" />
            <div>
              <p className="font-medium">Search by registration number, employer name or trade name to open an Employer 360 profile.</p>
              <p className="text-sm text-muted-foreground mt-1">
                Enter at least {MIN_SEARCH_LENGTH} characters, or apply a filter to browse the authorised employer register.
              </p>
            </div>
            {recent.length > 0 && (
              <div className="max-w-xl mx-auto text-left">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
                  <Clock className="h-3.5 w-3.5" />Recently viewed
                </div>
                <div className="flex flex-wrap gap-2">
                  {recent.map((r) => (
                    <Button key={r.regno} variant="outline" size="sm" asChild>
                      <Link to={`/compliance/field/employer-360/${encodeURIComponent(r.regno)}`}>
                        <span className="font-mono mr-2">{r.regno}</span>{r.name}
                      </Link>
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Error state */}
      {enabled && isError && (
        <Card className="border-destructive/40">
          <CardContent className="py-10 text-center space-y-3">
            <AlertTriangle className="h-10 w-10 mx-auto text-destructive opacity-70" />
            <p className="font-medium">Unable to load employer search results. Please retry.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </CardContent>
        </Card>
      )}

      {enabled && !isError && isLoading && (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      )}

      {/* Results */}
      {enabled && !isError && !isLoading && (
        rows.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center space-y-3">
              <Building2 className="h-10 w-10 mx-auto text-muted-foreground opacity-40" />
              <div>
                <p className="font-medium">No employers match the current search and filters.</p>
                <p className="text-sm text-muted-foreground">Adjust the search term or clear the active filters.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => { setTerm(''); resetFilters(); }}>Clear filters</Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="flex items-center justify-between px-4 py-2.5 text-sm text-muted-foreground border-b">
                <span>
                  Showing {from}–{to} of {total} matching employer{total === 1 ? '' : 's'}
                  {isFetching && <Loader2 className="inline h-3.5 w-3.5 ml-2 animate-spin" />}
                </span>
                {hasSearch && sort === 'relevance' && <span className="text-xs">Ordered by best match</span>}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[110px]">Reg. No.</TableHead>
                    <TableHead>Employer</TableHead>
                    <TableHead>Trade name</TableHead>
                    <TableHead className="w-[110px]">Status</TableHead>
                    <TableHead className="w-[110px]">Office / Zone</TableHead>
                    <TableHead className="w-[100px]">Risk</TableHead>
                    <TableHead className="w-[170px]">Open issues</TableHead>
                    <TableHead className="w-[110px]">Registered</TableHead>
                    <TableHead className="w-[120px] text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.regno}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => openEmployer(row)}
                    >
                      <TableCell className="font-mono font-medium">
                        <Link
                          to={`/compliance/field/employer-360/${encodeURIComponent(row.regno)}`}
                          className="text-primary hover:underline"
                          onClick={(e) => { e.stopPropagation(); rememberEmployer({ regno: row.regno, name: row.name }); }}
                        >
                          {row.regno}
                        </Link>
                      </TableCell>
                      <TableCell className="font-medium">{row.name || '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.trade_name || '—'}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[row.status] ?? 'outline'}>{titleCase(row.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{row.office_code || '—'}</TableCell>
                      <TableCell>
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${RISK_CLASS[row.risk_band] ?? RISK_CLASS.UNRATED}`}>
                          {titleCase(row.risk_band)}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs space-x-1">
                        {row.open_violations > 0 && <Badge variant="destructive" className="font-normal">{row.open_violations} viol.</Badge>}
                        {row.active_cases > 0 && <Badge variant="secondary" className="font-normal">{row.active_cases} case{row.active_cases === 1 ? '' : 's'}</Badge>}
                        {row.outstanding > 0 && <span className="text-muted-foreground">{formatComplianceCurrency(row.outstanding)}</span>}
                        {row.open_violations === 0 && row.active_cases === 0 && row.outstanding <= 0 && <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-sm">{fmtDate(row.registration_date)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openEmployer(row); }}>
                          Open 360
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Rows</span>
                  <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                    <SelectTrigger className="h-8 w-[80px]"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-popover z-50">
                      {PAGE_SIZE_OPTIONS.map((s) => <SelectItem key={s} value={String(s)}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(1)} disabled={page <= 1}>
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(page - 1)} disabled={page <= 1}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="px-2 text-sm">Page {page} of {totalPages}</span>
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(page + 1)} disabled={page >= totalPages}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
}
