import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { SortableTableHead } from '@/components/shared/SortableTableHead';
import { TablePagination } from '@/components/shared/TablePagination';
import { formatCurrency } from '@/utils/formatCurrency';
import { formatDisplayDate } from '@/lib/dateFormat';
import LegalReturnDetailDialog from '@/components/compliance/legal/LegalReturnDetailDialog';
import {
  useLegalReturnRegister,
  formatReworkAge,
  RETURN_TABS,
  RETURN_PAGE_SIZES,
  RETURN_AMOUNT_BANDS,
  RETURN_WINDOWS,
  READINESS_OPTIONS,
  SLA_OPTIONS,
  type LegalReturnRow,
} from '@/hooks/compliance/useLegalReturnRegister';
import {
  ArrowLeftRight, RefreshCw, Search, AlertTriangle, X, Building2, Clock, Loader2, Gavel,
} from 'lucide-react';

const PERMISSION = 'manage_compliance';

export default function ReturnedFromLegalPage() {
  return (
    <PermissionWrapper moduleName={PERMISSION}>
      <LegalReturnRegister />
    </PermissionWrapper>
  );
}

function Kpi({
  label, value, tone, hint, onClick, active,
}: { label: string; value: React.ReactNode; tone?: string; hint?: string; onClick?: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`text-left rounded-lg border p-3 transition-colors ${onClick ? 'hover:bg-muted/50' : ''} ${
        active ? 'border-primary ring-1 ring-primary/30' : ''
      }`}
    >
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold ${tone ?? ''}`}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </button>
  );
}

const ATTENTION_LABEL: Record<string, string> = {
  OVERDUE: 'Rework overdue',
  UNASSIGNED: 'No rework owner',
  MISSING_ITEMS: 'Mandatory pack items outstanding',
  NOT_RESUBMITTED: 'Ready but not resubmitted',
  NO_REQUIRED_ACTION: 'Legal recorded no required action',
  REPEAT_RETURN: 'Returned more than once',
  HIGH_VALUE: 'High-value exposure',
};

function toneClass(tone: string | null | undefined) {
  switch (tone) {
    case 'success': return 'bg-success/10 text-success border-success/30';
    case 'warning': return 'bg-warning/10 text-warning border-warning/30';
    case 'danger': return 'bg-destructive/10 text-destructive border-destructive/30';
    default: return '';
  }
}

const READINESS_LABEL: Record<string, string> = {
  READY: 'Ready',
  MISSING_MANDATORY: 'Missing items',
  IN_PROGRESS: 'In progress',
  NOT_STARTED: 'Not started',
};

function LegalReturnRegister() {
  const navigate = useNavigate();
  const {
    filters, setFilters, resetFilters, toggleSort, hasActiveFilters,
    rows, total, kpis, tabCounts, attention, facets, thresholds,
    isLoading, isFetching, error, refetch, selectedId, setSelectedId,
  } = useLegalReturnRegister();

  const [dialogOpen, setDialogOpen] = useState(!!selectedId);
  const [searchDraft, setSearchDraft] = useState(filters.search);

  function openReturn(id: string) {
    setSelectedId(id);
    setDialogOpen(true);
  }
  function closeReturn(open: boolean) {
    setDialogOpen(open);
    if (!open) setSelectedId(null);
  }

  const totalPages = Math.max(1, Math.ceil(total / filters.page_size));

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <Card className="border-destructive/40">
          <CardContent className="py-12 text-center space-y-2">
            <AlertTriangle className="h-6 w-6 text-destructive mx-auto" />
            <p className="text-sm font-medium">Unable to load the Legal return queue</p>
            <p className="text-xs text-muted-foreground">{error.message}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ArrowLeftRight className="h-6 w-6 text-primary" />
            Returned From Legal — Return &amp; Rework Control
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Referrals Legal has sent back to Compliance. Track the return reason and required action, assign a
            rework owner, complete the outstanding pack items, then resubmit through the governed approval path.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Open rework" value={kpis?.open ?? 0} onClick={() => setFilters({ tab: 'OPEN' })} active={filters.tab === 'OPEN'} />
        <Kpi
          label={`Overdue (> ${thresholds?.rework_sla_days ?? 5}d)`}
          value={kpis?.overdue ?? 0}
          tone="text-destructive"
          onClick={() => setFilters({ tab: 'OVERDUE' })}
          active={filters.tab === 'OVERDUE'}
        />
        <Kpi label="Unassigned" value={tabCounts.UNASSIGNED ?? 0} tone="text-warning" onClick={() => setFilters({ tab: 'UNASSIGNED' })} active={filters.tab === 'UNASSIGNED'} />
        <Kpi label="Ready to resubmit" value={kpis?.ready ?? 0} tone="text-success" onClick={() => setFilters({ tab: 'READY' })} active={filters.tab === 'READY'} />
        <Kpi label="Avg rework age" value={formatReworkAge(kpis?.avg_rework_hours)} hint={`${kpis?.returned_this_month ?? 0} returned this month`} />
        <Kpi label="Open exposure" value={formatCurrency(Number(kpis?.open_exposure ?? 0))} />
      </div>

      {/* Requires attention */}
      {attention.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Requires attention ({attention.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {attention.map((a) => (
              <button
                key={a.return_id}
                onClick={() => openReturn(a.return_id)}
                className="text-left rounded-md border p-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{a.referral_number ?? '—'}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {ATTENTION_LABEL[a.reason] ?? a.reason}
                  </Badge>
                </div>
                <div className="text-sm font-medium truncate">{a.employer_name ?? '—'}</div>
                <div className="text-xs text-muted-foreground">{formatCurrency(Number(a.amount ?? 0))}</div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Toolbar */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <Tabs value={filters.tab} onValueChange={(v) => setFilters({ tab: v, page: 1 })}>
            <TabsList className="flex-wrap h-auto">
              {RETURN_TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>
                  {t.label}
                  <span className="ml-1.5 text-[10px] text-muted-foreground">{tabCounts[t.value] ?? 0}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="flex flex-wrap gap-2">
            <form
              className="relative flex-1 min-w-[240px]"
              onSubmit={(e) => { e.preventDefault(); setFilters({ search: searchDraft, page: 1 }); }}
            >
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search referral, employer, case, Legal reference or reason…"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                onBlur={() => setFilters({ search: searchDraft, page: 1 })}
              />
            </form>

            <Select value={filters.reason_code || 'ALL'} onValueChange={(v) => setFilters({ reason_code: v === 'ALL' ? '' : v })}>
              <SelectTrigger className="w-[190px]"><SelectValue placeholder="Return reason" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All reasons</SelectItem>
                {(facets?.reasons ?? []).map((r) => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.rework_status || 'ALL'} onValueChange={(v) => setFilters({ rework_status: v === 'ALL' ? '' : v })}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Rework status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All rework states</SelectItem>
                {(facets?.rework_statuses ?? []).map((r) => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.owner || 'ALL'} onValueChange={(v) => setFilters({ owner: v === 'ALL' ? '' : v })}>
              <SelectTrigger className="w-[170px]"><SelectValue placeholder="Owner" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All owners</SelectItem>
                <SelectItem value="__ME__">Assigned to me</SelectItem>
                <SelectItem value="__UNASSIGNED__">Unassigned</SelectItem>
                {(facets?.owners ?? []).map((o) => <SelectItem key={o.code} value={o.code}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.readiness || 'ALL'} onValueChange={(v) => setFilters({ readiness: v === 'ALL' ? '' : v })}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Pack readiness" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any readiness</SelectItem>
                {READINESS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.sla || 'ALL'} onValueChange={(v) => setFilters({ sla: v === 'ALL' ? '' : v })}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="SLA" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any SLA state</SelectItem>
                {SLA_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.returned_window || 'ALL'} onValueChange={(v) => setFilters({ returned_window: v === 'ALL' ? '' : v })}>
              <SelectTrigger className="w-[190px]"><SelectValue placeholder="Returned window" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any return date</SelectItem>
                {RETURN_WINDOWS.map((w) => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.amount_band || 'ALL'} onValueChange={(v) => setFilters({ amount_band: v === 'ALL' ? '' : v })}>
              <SelectTrigger className="w-[170px]"><SelectValue placeholder="Amount" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any amount</SelectItem>
                {RETURN_AMOUNT_BANDS.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
              </SelectContent>
            </Select>

            {filters.returned_window === 'CUSTOM' && (
              <>
                <Input type="date" className="w-[150px]" value={filters.returned_from} onChange={(e) => setFilters({ returned_from: e.target.value })} />
                <Input type="date" className="w-[150px]" value={filters.returned_to} onChange={(e) => setFilters({ returned_to: e.target.value })} />
              </>
            )}
            {filters.amount_band === 'CUSTOM' && (
              <>
                <Input type="number" className="w-[120px]" placeholder="Min" value={filters.amount_min} onChange={(e) => setFilters({ amount_min: e.target.value })} />
                <Input type="number" className="w-[120px]" placeholder="Max" value={filters.amount_max} onChange={(e) => setFilters({ amount_max: e.target.value })} />
              </>
            )}

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={() => { resetFilters(); setSearchDraft(''); }}>
                <X className="h-4 w-4 mr-1" /> Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Register */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            Return register
            <span className="text-xs font-normal text-muted-foreground">{total} record(s)</span>
            {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead sortKey="referral" currentSortKey={filters.sort} direction={filters.dir} onSort={toggleSort}>Referral</SortableTableHead>
                  <SortableTableHead sortKey="employer" currentSortKey={filters.sort} direction={filters.dir} onSort={toggleSort}>Employer</SortableTableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Required action</TableHead>
                  <SortableTableHead sortKey="rework_status" currentSortKey={filters.sort} direction={filters.dir} onSort={toggleSort}>Rework</SortableTableHead>
                  <SortableTableHead sortKey="owner" currentSortKey={filters.sort} direction={filters.dir} onSort={toggleSort}>Owner</SortableTableHead>
                  <SortableTableHead sortKey="returned_at" currentSortKey={filters.sort} direction={filters.dir} onSort={toggleSort}>Returned</SortableTableHead>
                  <SortableTableHead sortKey="age" currentSortKey={filters.sort} direction={filters.dir} onSort={toggleSort}>Age</SortableTableHead>
                  <SortableTableHead sortKey="due_date" currentSortKey={filters.sort} direction={filters.dir} onSort={toggleSort}>Due</SortableTableHead>
                  <TableHead>Pack</TableHead>
                  <SortableTableHead sortKey="amount" currentSortKey={filters.sort} direction={filters.dir} onSort={toggleSort} className="text-right">Amount</SortableTableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={12} className="py-12 text-center text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" /> Loading return register…
                  </TableCell></TableRow>
                )}
                {!isLoading && rows.length === 0 && (
                  <TableRow><TableCell colSpan={12} className="py-12 text-center text-muted-foreground">
                    No returns match the current view.
                  </TableCell></TableRow>
                )}
                {rows.map((r: LegalReturnRow) => (
                  <TableRow key={r.return_id} className="cursor-pointer" onClick={() => openReturn(r.return_id)}>
                    <TableCell className="align-top">
                      <div className="font-mono text-xs">{r.referral_number ?? '—'}</div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                        {r.total_returns > 1 && <Badge variant="destructive" className="text-[9px] px-1">#{r.return_seq}</Badge>}
                        {r.lg_case_no && <span className="inline-flex items-center gap-0.5"><Gavel className="h-3 w-3" />{r.lg_case_no}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="align-top max-w-[200px]">
                      <button
                        className="text-sm text-primary hover:underline text-left truncate block"
                        onClick={(e) => { e.stopPropagation(); if (r.employer_reg_no) navigate(`/compliance/employer/${r.employer_reg_no}`); }}
                      >
                        <Building2 className="h-3 w-3 inline mr-1" />
                        {r.employer_name ?? r.employer_reg_no ?? '—'}
                      </button>
                      {r.ce_case_number && (
                        <button
                          className="text-[11px] text-muted-foreground hover:underline"
                          onClick={(e) => { e.stopPropagation(); if (r.ce_case_id) navigate(`/compliance/cases/${r.ce_case_id}`); }}
                        >
                          {r.ce_case_number}
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="align-top max-w-[180px]">
                      <Badge variant="outline" className={`text-[10px] ${toneClass(r.reason_tone)}`}>
                        {r.reason_label ?? r.reason_code ?? '—'}
                      </Badge>
                      <div className="text-[11px] text-muted-foreground truncate">{r.reason_text}</div>
                    </TableCell>
                    <TableCell className="align-top max-w-[200px]">
                      <div className="text-xs truncate">
                        {r.required_action || <span className="text-destructive">Not specified by Legal</span>}
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <Badge variant="outline" className={`text-[10px] ${toneClass(r.rework_tone)}`}>{r.rework_label}</Badge>
                      <div className="text-[11px] text-muted-foreground">{r.status_label}</div>
                    </TableCell>
                    <TableCell className="align-top text-xs">
                      {r.assigned_to_name ?? r.assigned_to ?? <span className="text-warning">Unassigned</span>}
                    </TableCell>
                    <TableCell className="align-top text-xs">
                      {formatDisplayDate(r.returned_at)}
                      <div className="text-[11px] text-muted-foreground truncate">{r.returned_by_display ?? '—'}</div>
                    </TableCell>
                    <TableCell className="align-top text-xs">
                      <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{formatReworkAge(r.rework_hours)}</span>
                    </TableCell>
                    <TableCell className="align-top text-xs">
                      {r.due_date ? formatDisplayDate(r.due_date) : '—'}
                      {r.sla_state === 'OVERDUE' && <Badge variant="destructive" className="ml-1 text-[9px]">Overdue</Badge>}
                      {r.sla_state === 'DUE_SOON' && <Badge variant="outline" className="ml-1 text-[9px] text-warning">Due soon</Badge>}
                    </TableCell>
                    <TableCell className="align-top text-xs">
                      <div>{READINESS_LABEL[r.readiness_code] ?? r.readiness_code}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {r.pack_required_complete ?? 0}/{r.pack_required_items ?? 0} mandatory
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-right text-xs font-medium">
                      {formatCurrency(Number(r.total_referred ?? 0))}
                    </TableCell>
                    <TableCell className="align-top text-right">
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openReturn(r.return_id); }}>
                        Manage
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="p-3 border-t">
            <TablePagination
              pagination={{ page: filters.page, pageSize: filters.page_size, totalItems: total, totalPages }}
              onPageChange={(p) => setFilters({ page: p })}
              onPageSizeChange={(s) => setFilters({ page_size: s, page: 1 })}
              pageSizeOptions={[...RETURN_PAGE_SIZES]}
            />
          </div>
        </CardContent>
      </Card>

      <LegalReturnDetailDialog returnId={selectedId} open={dialogOpen} onOpenChange={closeReturn} />
    </div>
  );
}
