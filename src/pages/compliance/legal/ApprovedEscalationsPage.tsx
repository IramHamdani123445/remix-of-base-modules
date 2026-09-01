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
import { formatDisplayDate, formatAuditDateTime } from '@/lib/dateFormat';
import EscalationDetailDialog from '@/components/compliance/legal/EscalationDetailDialog';
import {
  useApprovedEscalationRegister,
  formatWaiting,
  ESCALATION_TABS,
  ESCALATION_PAGE_SIZES,
  AMOUNT_BANDS,
  SUBMITTED_WINDOWS,
  UPDATE_WINDOWS,
  type EscalationRow,
} from '@/hooks/compliance/useApprovedEscalationRegister';
import {
  Scale, RefreshCw, Search, AlertTriangle, X, Building2, Gavel, Clock, ArrowLeftRight, Loader2,
} from 'lucide-react';

const PERMISSION = 'manage_compliance';

export default function ApprovedEscalationsPage() {
  return (
    <PermissionWrapper moduleName={PERMISSION}>
      <EscalationRegister />
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
  ACCEPTANCE_OVERDUE: 'Legal has not accepted within SLA',
  ACCEPTANCE_DUE_SOON: 'Acceptance due soon',
  ACCEPTED_NO_CASE: 'Accepted but no Legal case recorded',
  STALE: 'No Legal update recently',
  RETURNED: 'Returned by Legal — rework required',
  HIGH_VALUE: 'High-value exposure',
};

function statusTone(tone: string | null | undefined) {
  switch (tone) {
    case 'success': return 'bg-success/10 text-success border-success/30';
    case 'warning': return 'bg-warning/10 text-warning border-warning/30';
    case 'danger': return 'bg-destructive/10 text-destructive border-destructive/30';
    default: return '';
  }
}

function EscalationRegister() {
  const navigate = useNavigate();
  const {
    filters, setFilters, resetFilters, toggleSort, hasActiveFilters,
    rows, total, kpis, tabCounts, attention, facets, thresholds, actor,
    isLoading, isFetching, error, refetch, selectedId, setSelectedId,
  } = useApprovedEscalationRegister();

  const [dialogOpen, setDialogOpen] = useState(!!selectedId);

  function openReferral(id: string) {
    setSelectedId(id);
    setDialogOpen(true);
  }
  function closeReferral(open: boolean) {
    setDialogOpen(open);
    if (!open) setSelectedId(null);
  }

  const money = actor?.can_view_financials ?? false;
  const amount = (v: any) => (money ? formatCurrency(Number(v ?? 0)) : 'Restricted');
  const totalPages = Math.max(1, Math.ceil(total / filters.page_size));

  return (
    <div className="container mx-auto p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Scale className="h-6 w-6 text-primary" />
            Approved Escalations — Post-Handover Legal Tracking
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Referrals that have crossed the Compliance → Legal boundary. Legal owns the matter from here;
            Compliance monitors acceptance, progress and recovery. Approval and submission happen in the
            Legal Review queue, and rework is handled in Returned From Legal.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi
          label="Awaiting Legal acceptance"
          value={kpis?.awaiting ?? 0}
          onClick={() => setFilters({ tab: 'AWAITING' })}
          active={filters.tab === 'AWAITING'}
        />
        <Kpi
          label={`Acceptance overdue (> ${thresholds?.acceptance_sla_days ?? 5}d)`}
          value={kpis?.acceptance_overdue ?? 0}
          tone="text-destructive"
          onClick={() => setFilters({ tab: 'AWAITING', sort: 'waiting', dir: 'desc' })}
        />
        <Kpi
          label="In proceedings"
          value={kpis?.proceedings ?? 0}
          onClick={() => setFilters({ tab: 'PROCEEDINGS' })}
          active={filters.tab === 'PROCEEDINGS'}
        />
        <Kpi
          label={`No update ${thresholds?.stale_days ?? 14}+ days`}
          value={kpis?.stale ?? 0}
          tone="text-warning"
          onClick={() => setFilters({ tab: 'STALE' })}
          active={filters.tab === 'STALE'}
        />
        <Kpi
          label="Returned by Legal"
          value={kpis?.returned ?? 0}
          tone="text-warning"
          onClick={() => setFilters({ tab: 'RETURNED' })}
          active={filters.tab === 'RETURNED'}
        />
        <Kpi
          label="Exposure with Legal"
          value={money ? formatCurrency(Number(kpis?.total_exposure ?? 0)) : 'Restricted'}
          hint={money ? `Outstanding ${formatCurrency(Number(kpis?.outstanding_exposure ?? 0))}` : undefined}
        />
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
                key={`${a.referral_id}-${a.reason}`}
                onClick={() => openReferral(a.referral_id)}
                className="text-left rounded-md border p-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{a.referral_number}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {ATTENTION_LABEL[a.reason] ?? a.reason}
                  </Badge>
                </div>
                <div className="text-sm font-medium truncate">{a.employer_name ?? '—'}</div>
                <div className="text-xs text-muted-foreground">
                  {a.legal_status_label} · {money ? formatCurrency(Number(a.amount ?? 0)) : 'Restricted'}
                </div>
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
              {ESCALATION_TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>
                  {t.label}
                  {tabCounts?.[t.value] !== undefined && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground">{tabCounts[t.value]}</span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[260px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search referral, employer, registration no., case, Legal or court reference…"
                value={filters.search}
                onChange={(e) => setFilters({ search: e.target.value, page: 1 })}
              />
            </div>

            <Select value={filters.status || 'ALL'} onValueChange={(v) => setFilters({ status: v === 'ALL' ? '' : v, page: 1 })}>
              <SelectTrigger className="w-[190px]"><SelectValue placeholder="Referral status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All referral statuses</SelectItem>
                {(facets?.statuses ?? []).map((s) => (
                  <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.legal_status || 'ALL'} onValueChange={(v) => setFilters({ legal_status: v === 'ALL' ? '' : v, page: 1 })}>
              <SelectTrigger className="w-[190px]"><SelectValue placeholder="Legal status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Legal statuses</SelectItem>
                {(facets?.legal_statuses ?? []).map((s) => (
                  <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.zone || 'ALL'} onValueChange={(v) => setFilters({ zone: v === 'ALL' ? '' : v, page: 1 })}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Zone" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All zones</SelectItem>
                {(facets?.zones ?? []).map((z) => (
                  <SelectItem key={z} value={z}>{z}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.reason_code || 'ALL'} onValueChange={(v) => setFilters({ reason_code: v === 'ALL' ? '' : v, page: 1 })}>
              <SelectTrigger className="w-[170px]"><SelectValue placeholder="Referral reason" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All reasons</SelectItem>
                {(facets?.reasons ?? []).map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.amount_band || 'ALL'} onValueChange={(v) => setFilters({ amount_band: v === 'ALL' ? '' : v, page: 1 })}>
              <SelectTrigger className="w-[170px]"><SelectValue placeholder="Amount" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any amount</SelectItem>
                {AMOUNT_BANDS.map((b) => (
                  <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {filters.amount_band === 'CUSTOM' && (
              <>
                <Input
                  className="w-[110px]" type="number" placeholder="Min"
                  value={filters.amount_min}
                  onChange={(e) => setFilters({ amount_min: e.target.value, page: 1 })}
                />
                <Input
                  className="w-[110px]" type="number" placeholder="Max"
                  value={filters.amount_max}
                  onChange={(e) => setFilters({ amount_max: e.target.value, page: 1 })}
                />
              </>
            )}

            <Select
              value={filters.submitted_window || 'ALL'}
              onValueChange={(v) => setFilters({ submitted_window: v === 'ALL' ? '' : v, page: 1 })}
            >
              <SelectTrigger className="w-[170px]"><SelectValue placeholder="Submitted" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any submission date</SelectItem>
                {SUBMITTED_WINDOWS.map((w) => (
                  <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {filters.submitted_window === 'CUSTOM' && (
              <>
                <Input
                  className="w-[150px]" type="date" value={filters.submitted_from}
                  onChange={(e) => setFilters({ submitted_from: e.target.value, page: 1 })}
                />
                <Input
                  className="w-[150px]" type="date" value={filters.submitted_to}
                  onChange={(e) => setFilters({ submitted_to: e.target.value, page: 1 })}
                />
              </>
            )}

            <Select
              value={filters.update_window || 'ALL'}
              onValueChange={(v) => setFilters({ update_window: v === 'ALL' ? '' : v, page: 1 })}
            >
              <SelectTrigger className="w-[190px]"><SelectValue placeholder="Legal update" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any update recency</SelectItem>
                {UPDATE_WINDOWS.map((w) => (
                  <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                <X className="h-4 w-4 mr-1" /> Clear
              </Button>
            )}
          </div>

          <div className="text-xs text-muted-foreground">
            {isFetching ? 'Updating…' : `${total} referral${total === 1 ? '' : 's'} match the current view`}
          </div>
        </CardContent>
      </Card>

      {/* Register */}
      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="py-16 text-center space-y-2">
              <AlertTriangle className="h-6 w-6 text-destructive mx-auto" />
              <p className="text-sm font-medium">Unable to load the escalation register</p>
              <p className="text-xs text-muted-foreground">{error.message}</p>
            </div>
          ) : isLoading ? (
            <div className="py-16 text-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
              Loading escalations…
            </div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center space-y-1">
              <p className="text-sm font-medium">No referrals in this view</p>
              <p className="text-xs text-muted-foreground">
                Approved referrals appear here once they are submitted to Legal.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead sortKey="referral_number" currentSortKey={filters.sort} direction={filters.dir} onSort={toggleSort}>
                      Referral
                    </SortableTableHead>
                    <SortableTableHead sortKey="employer" currentSortKey={filters.sort} direction={filters.dir} onSort={toggleSort}>
                      Employer
                    </SortableTableHead>
                    <TableHead>Compliance case</TableHead>
                    <SortableTableHead sortKey="amount" currentSortKey={filters.sort} direction={filters.dir} onSort={toggleSort} className="text-right">
                      Referred
                    </SortableTableHead>
                    <SortableTableHead sortKey="submitted" currentSortKey={filters.sort} direction={filters.dir} onSort={toggleSort}>
                      Submitted
                    </SortableTableHead>
                    <SortableTableHead sortKey="waiting" currentSortKey={filters.sort} direction={filters.dir} onSort={toggleSort}>
                      Acceptance
                    </SortableTableHead>
                    <TableHead>Legal reference</TableHead>
                    <SortableTableHead sortKey="legal_status" currentSortKey={filters.sort} direction={filters.dir} onSort={toggleSort}>
                      Legal status
                    </SortableTableHead>
                    <SortableTableHead sortKey="last_update" currentSortKey={filters.sort} direction={filters.dir} onSort={toggleSort}>
                      Last update
                    </SortableTableHead>
                    <TableHead>Recovery</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r: EscalationRow) => (
                    <TableRow
                      key={r.referral_id}
                      className="cursor-pointer"
                      onClick={() => openReferral(r.referral_id)}
                    >
                      <TableCell className="whitespace-nowrap">
                        <div className="font-mono text-xs">{r.referral_number}</div>
                        <Badge variant="outline" className={`mt-1 text-[10px] ${statusTone(r.status_tone)}`}>
                          {r.status_label}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        <button
                          className="text-primary hover:underline inline-flex items-center gap-1 text-left"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (r.employer_reg_no) navigate(`/employers/${r.employer_reg_no}`);
                          }}
                        >
                          <Building2 className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{r.employer_name ?? r.employer_reg_no ?? '—'}</span>
                        </button>
                        <div className="text-[11px] text-muted-foreground">
                          {r.employer_reg_no ?? '—'}{r.zone ? ` · ${r.zone}` : ''}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {r.ce_case_id ? (
                          <button
                            className="text-primary hover:underline text-xs"
                            onClick={(e) => { e.stopPropagation(); navigate(`/compliance/cases/${r.ce_case_id}`); }}
                          >
                            {r.ce_case_number ?? 'Case'}
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        <div className="text-[11px] text-muted-foreground">{r.referral_reason_text ?? r.reason_code ?? '—'}</div>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <div className="font-medium">{amount(r.total_referred)}</div>
                        {money && (
                          <div className="text-[11px] text-muted-foreground">
                            Out. {formatCurrency(Number(r.outstanding_amount ?? r.total_referred ?? 0))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {r.submitted_date ? formatDisplayDate(r.submitted_date) : '—'}
                        <div className="text-[11px] text-muted-foreground">{r.submitted_by ?? '—'}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {r.accepted_date ? (
                          <span className="text-success">Accepted {formatDisplayDate(r.accepted_date)}</span>
                        ) : (
                          <span
                            className={
                              r.acceptance_overdue ? 'text-destructive font-medium'
                                : r.acceptance_due_soon ? 'text-warning' : ''
                            }
                          >
                            <Clock className="h-3 w-3 inline mr-1" />
                            {formatWaiting(r.waiting_hours)} waiting
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        <div className="flex items-center gap-1">
                          <Gavel className="h-3 w-3 text-muted-foreground" />
                          {r.lg_case_no ?? r.lg_intake_no ?? '—'}
                        </div>
                        <div className="text-[11px] text-muted-foreground">{r.court_case_no ?? r.court_name ?? '—'}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant="secondary" className="text-[10px]">{r.legal_status_label}</Badge>
                        {r.is_returned && (
                          <div className="text-[11px] text-warning flex items-center gap-1 mt-1">
                            <ArrowLeftRight className="h-3 w-3" /> Returned
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        <span className={r.legal_stale ? 'text-warning' : ''}>
                          {r.last_legal_update ? formatAuditDateTime(r.last_legal_update) : '—'}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {r.recovery_label ?? '—'}
                        {money && r.recovered_amount ? (
                          <div className="text-[11px] text-success">{formatCurrency(Number(r.recovered_amount))}</div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {total > 0 && (
            <div className="px-4">
              <TablePagination
                pagination={{
                  page: filters.page,
                  pageSize: filters.page_size,
                  totalItems: total,
                  totalPages,
                }}
                onPageChange={(p) => setFilters({ page: p })}
                onPageSizeChange={(s) => setFilters({ page_size: s, page: 1 })}
                pageSizeOptions={[...ESCALATION_PAGE_SIZES]}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <EscalationDetailDialog
        referralId={selectedId}
        open={dialogOpen}
        onOpenChange={closeReferral}
        canOpenLegal={actor?.can_open_legal}
      />
    </div>
  );
}
