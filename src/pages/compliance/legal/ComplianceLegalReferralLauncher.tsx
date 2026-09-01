import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { SortableTableHead } from '@/components/shared/SortableTableHead';
import { TablePagination } from '@/components/shared/TablePagination';
import { formatCurrency } from '@/utils/formatCurrency';
import { formatDisplayDate } from '@/lib/dateFormat';
import LegalCandidateInitiationDialog from '@/components/compliance/legal/LegalCandidateInitiationDialog';
import {
  useLegalReferralCandidateRegister,
  CANDIDATE_TABS,
  CANDIDATE_PAGE_SIZES,
  CANDIDATE_SCOPES,
  CANDIDATE_AMOUNT_BANDS,
  CANDIDATE_ACTION_WINDOWS,
  ARRANGEMENT_OPTIONS,
  ENFORCEMENT_OPTIONS,
  type LegalCandidateRow,
} from '@/hooks/compliance/useLegalReferralCandidateRegister';
import {
  Gavel, Search, RefreshCw, X, AlertTriangle, Building2, Loader2, ExternalLink, Scale,
} from 'lucide-react';

const PERMISSION = 'manage_compliance';

export default function ComplianceLegalReferralLauncher() {
  return (
    <PermissionWrapper moduleName={PERMISSION}>
      <LegalReferralCandidateRegister />
    </PermissionWrapper>
  );
}

function Kpi({
  label, value, hint, tone, onClick, active,
}: { label: string; value: React.ReactNode; hint?: string; tone?: string; onClick?: () => void; active?: boolean }) {
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

function toneClass(tone?: string | null) {
  switch (tone) {
    case 'success': return 'bg-success/10 text-success border-success/30';
    case 'warning': return 'bg-warning/10 text-warning border-warning/30';
    case 'danger': return 'bg-destructive/10 text-destructive border-destructive/30';
    default: return '';
  }
}

function LegalReferralCandidateRegister() {
  const navigate = useNavigate();
  const {
    filters, setFilters, resetFilters, toggleSort, hasActiveFilters,
    rows, total, kpis, tabCounts, attention, facets, thresholds, actor,
    isLoading, isFetching, error, refetch, selectedCaseId, setSelectedCaseId,
  } = useLegalReferralCandidateRegister();

  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [dialogOpen, setDialogOpen] = useState(!!selectedCaseId);

  const openCase = (caseId: string) => {
    setSelectedCaseId(caseId);
    setDialogOpen(true);
  };
  const closeDialog = (v: boolean) => {
    setDialogOpen(v);
    if (!v) setSelectedCaseId(null);
  };

  const applySearch = () => setFilters({ search: searchDraft.trim(), page: 1 });

  const totalPages = Math.max(1, Math.ceil(total / filters.page_size));

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Gavel className="h-5 w-5" /> Legal Referral Launcher
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Controlled entry point into legal escalation. Cases are evaluated against the configured
            handoff policy; escalation always runs Recommendation → Approval → Pack → Referral.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Refresh</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/compliance/enforcement/recommendation-queue')}>
            <Scale className="h-4 w-4 mr-2" /> Recommendation queue
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="py-4 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> {error.message}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi
          label="Eligible now" value={kpis?.eligible ?? 0} tone="text-success"
          hint="Meet all policy conditions" active={filters.tab === 'ELIGIBLE'}
          onClick={() => setFilters({ tab: 'ELIGIBLE', page: 1 })}
        />
        <Kpi
          label="Recommendation required" value={kpis?.recommendation_required ?? 0}
          hint="Eligible, none raised" active={filters.tab === 'REC_REQ'}
          onClick={() => setFilters({ tab: 'REC_REQ', page: 1 })}
        />
        <Kpi
          label="Awaiting approval" value={kpis?.awaiting_approval ?? 0} tone="text-warning"
          hint="With management" active={filters.tab === 'AWAITING'}
          onClick={() => setFilters({ tab: 'AWAITING', page: 1 })}
        />
        <Kpi
          label="Ready for pack" value={kpis?.ready_for_pack ?? 0}
          hint="Approved, pack pending" active={filters.tab === 'READY_PACK'}
          onClick={() => setFilters({ tab: 'READY_PACK', page: 1 })}
        />
        <Kpi
          label="With Legal" value={kpis?.with_legal ?? 0}
          hint="Referred / in proceedings" active={filters.tab === 'REFERRED'}
          onClick={() => setFilters({ tab: 'REFERRED', page: 1 })}
        />
        <Kpi
          label="Eligible exposure" value={formatCurrency(kpis?.eligible_exposure ?? 0)}
          hint={`${kpis?.employers ?? 0} employers in scope`}
        />
      </div>

      {attention.length > 0 && (
        <Card className="border-warning/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" /> Requires attention
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {attention.slice(0, 5).map((a) => (
              <button
                key={a.case_id}
                type="button"
                onClick={() => openCase(a.case_id)}
                className="w-full text-left text-xs flex flex-wrap items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50"
              >
                <Badge variant="outline">{a.eligibility_label}</Badge>
                <span className="font-medium">{a.employer_name ?? 'Employer not recorded'}</span>
                <span className="text-muted-foreground">{a.case_number ?? '—'}</span>
                <span className="text-muted-foreground">{a.reason}</span>
                {a.amount != null && <span className="ml-auto font-medium">{formatCurrency(a.amount)}</span>}
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3 space-y-3">
          <Tabs value={filters.tab} onValueChange={(v) => setFilters({ tab: v, page: 1 })}>
            <TabsList className="flex flex-wrap h-auto">
              {CANDIDATE_TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="text-xs">
                  {t.label}
                  <span className="ml-1.5 text-[10px] text-muted-foreground">{tabCounts[t.value] ?? 0}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applySearch()}
                onBlur={applySearch}
                placeholder="Search employer, registration number, case or referral number…"
                className="pl-8 h-9"
              />
            </div>

            <FilterSelect
              value={filters.scope} onChange={(v) => setFilters({ scope: v, page: 1 })}
              placeholder="Scope" options={CANDIDATE_SCOPES.map((s) => ({ value: s.value, label: s.label }))}
              allLabel={null}
            />
            <FilterSelect
              value={filters.eligibility} onChange={(v) => setFilters({ eligibility: v, page: 1 })}
              placeholder="Eligibility" allLabel="All eligibility states"
              options={(facets?.eligibilities ?? []).map((o) => ({ value: o.code, label: o.label }))}
            />
            <FilterSelect
              value={filters.referral_state} onChange={(v) => setFilters({ referral_state: v, page: 1 })}
              placeholder="Referral state" allLabel="All referral states"
              options={(facets?.referral_states ?? []).map((o) => ({ value: o.code, label: o.label }))}
            />
            <FilterSelect
              value={filters.case_status} onChange={(v) => setFilters({ case_status: v, page: 1 })}
              placeholder="Case status" allLabel="All case statuses"
              options={(facets?.case_statuses ?? []).map((o) => ({ value: o.code, label: o.label }))}
            />
            <FilterSelect
              value={filters.case_stage} onChange={(v) => setFilters({ case_stage: v, page: 1 })}
              placeholder="Enforcement stage" allLabel="All stages"
              options={(facets?.case_stages ?? []).map((o) => ({ value: o.code, label: o.label }))}
            />
            <FilterSelect
              value={filters.enforcement} onChange={(v) => setFilters({ enforcement: v, page: 1 })}
              placeholder="Notices" allLabel="Any notice history" options={ENFORCEMENT_OPTIONS}
            />
            <FilterSelect
              value={filters.arrangement} onChange={(v) => setFilters({ arrangement: v, page: 1 })}
              placeholder="Arrangement" allLabel="Any arrangement status" options={ARRANGEMENT_OPTIONS}
            />
            <FilterSelect
              value={filters.zone} onChange={(v) => setFilters({ zone: v, page: 1 })}
              placeholder="Zone" allLabel="All zones"
              options={(facets?.zones ?? []).map((z) => ({ value: z, label: z }))}
            />
            <FilterSelect
              value={filters.officer} onChange={(v) => setFilters({ officer: v, page: 1 })}
              placeholder="Officer" allLabel="All officers"
              options={[
                { value: '__ME__', label: 'Assigned to me' },
                { value: '__UNASSIGNED__', label: 'Unassigned' },
                ...(facets?.officers ?? []).map((o) => ({ value: o, label: o })),
              ]}
            />
            <FilterSelect
              value={filters.amount_band} onChange={(v) => setFilters({ amount_band: v, page: 1 })}
              placeholder="Outstanding" allLabel="Any amount"
              options={CANDIDATE_AMOUNT_BANDS.map((b) => ({ value: b.value, label: b.label }))}
            />
            {filters.amount_band === 'CUSTOM' && (
              <>
                <Input
                  className="h-9 w-28" placeholder="Min" inputMode="decimal" value={filters.amount_min}
                  onChange={(e) => setFilters({ amount_min: e.target.value, page: 1 })}
                />
                <Input
                  className="h-9 w-28" placeholder="Max" inputMode="decimal" value={filters.amount_max}
                  onChange={(e) => setFilters({ amount_max: e.target.value, page: 1 })}
                />
              </>
            )}
            <FilterSelect
              value={filters.action_window} onChange={(v) => setFilters({ action_window: v, page: 1 })}
              placeholder="Last action" allLabel="Any time"
              options={CANDIDATE_ACTION_WINDOWS.map((w) => ({ value: w.value, label: w.label }))}
            />
            {filters.action_window === 'CUSTOM' && (
              <>
                <Input
                  type="date" className="h-9 w-[150px]" value={filters.action_from}
                  onChange={(e) => setFilters({ action_from: e.target.value, page: 1 })}
                />
                <Input
                  type="date" className="h-9 w-[150px]" value={filters.action_to}
                  onChange={(e) => setFilters({ action_to: e.target.value, page: 1 })}
                />
              </>
            )}

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={() => { resetFilters(); setSearchDraft(''); }}>
                <X className="h-4 w-4 mr-1" /> Clear filters
              </Button>
            )}
          </div>

          <div className="text-xs text-muted-foreground">
            {isLoading ? 'Loading…' : `${total} case${total === 1 ? '' : 's'} in view`}
            {thresholds?.high_value
              ? ` · High exposure threshold ${formatCurrency(thresholds.high_value)}`
              : ''}
            {actor && !actor.can_view_all ? ' · Restricted to cases within your remit' : ''}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead
                    sortKey="employer" currentSortKey={filters.sort} direction={filters.dir}
                    onSort={toggleSort}
                  >
                    Employer / case
                  </SortableTableHead>
                  <TableHead>Eligibility</TableHead>
                  <TableHead>Blocking requirements</TableHead>
                  <SortableTableHead
                    sortKey="exposure" currentSortKey={filters.sort} direction={filters.dir}
                    onSort={toggleSort} className="text-right"
                  >
                    Outstanding
                  </SortableTableHead>
                  <TableHead>Enforcement</TableHead>
                  <TableHead>Referral state</TableHead>
                  <SortableTableHead
                    sortKey="age" currentSortKey={filters.sort} direction={filters.dir} onSort={toggleSort}
                  >
                    Age / last action
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="readiness" currentSortKey={filters.sort} direction={filters.dir} onSort={toggleSort}
                  >
                    Readiness
                  </SortableTableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Evaluating cases…
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="h-32 text-center text-muted-foreground text-sm">
                      No cases match this view. Adjust the filters or select another tab.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((r) => (
                  <CandidateRow key={r.case_id} row={r} onOpen={() => openCase(r.case_id)} navigate={navigate} />
                ))}
              </TableBody>
            </Table>
          </div>

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
              pageSizeOptions={[...CANDIDATE_PAGE_SIZES]}
            />
          </div>
        </CardContent>
      </Card>

      <LegalCandidateInitiationDialog
        caseId={selectedCaseId}
        open={dialogOpen && !!selectedCaseId}
        onOpenChange={closeDialog}
      />
    </div>
  );
}

function CandidateRow({
  row, onOpen, navigate,
}: { row: LegalCandidateRow; onOpen: () => void; navigate: (p: string) => void }) {
  const blocks = row.blocks ?? [];
  return (
    <TableRow className="align-top">
      <TableCell className="max-w-[260px]">
        <button
          type="button"
          className="text-left font-medium hover:underline flex items-center gap-1"
          onClick={() =>
            row.employer_reg_no && navigate(`/compliance/field/employer-360/${row.employer_reg_no}`)
          }
        >
          <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="truncate">{row.employer_name ?? 'Employer not recorded'}</span>
        </button>
        <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1">
          <span>{row.employer_reg_no ?? '—'}</span>
          <span>·</span>
          <button
            type="button"
            className="hover:underline"
            onClick={() => navigate(`/compliance/cases/${row.case_id}`)}
          >
            {row.case_number ?? 'Case'}
          </button>
          {row.zone && <><span>·</span><span>{row.zone}</span></>}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {row.assigned_officer_name ? `Officer ${row.assigned_officer_name}` : 'Unassigned'}
          {row.open_violations > 0 ? ` · ${row.open_violations} open violation(s)` : ''}
        </div>
      </TableCell>

      <TableCell>
        <Badge variant="outline" className={toneClass(row.eligibility?.tone)}>
          {row.eligibility?.label ?? '—'}
        </Badge>
        {row.rule_name && (
          <div className="text-[11px] text-muted-foreground mt-1">{row.rule_name}</div>
        )}
      </TableCell>

      <TableCell className="max-w-[240px]">
        {blocks.length === 0 ? (
          <span className="text-xs text-success">All conditions met</span>
        ) : (
          <TooltipProvider>
            <div className="space-y-0.5">
              {blocks.slice(0, 2).map((b, i) => (
                <Tooltip key={i}>
                  <TooltipTrigger asChild>
                    <div className="text-xs truncate cursor-help">
                      {b.label}{b.detail ? ` — ${b.detail}` : ''}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    {b.description ?? b.label}
                  </TooltipContent>
                </Tooltip>
              ))}
              {blocks.length > 2 && (
                <div className="text-[11px] text-muted-foreground">+{blocks.length - 2} more</div>
              )}
            </div>
          </TooltipProvider>
        )}
      </TableCell>

      <TableCell className="text-right whitespace-nowrap">
        <div className="font-medium">{formatCurrency(row.outstanding_amount ?? 0)}</div>
        <div className="text-[11px] text-muted-foreground">
          P {formatCurrency(row.total_principal ?? 0)} · Pen {formatCurrency(row.total_penalties ?? 0)}
        </div>
        {row.high_value && <Badge variant="outline" className={`${toneClass('danger')} mt-1`}>High exposure</Badge>}
      </TableCell>

      <TableCell className="text-xs">
        <div>{row.notices_sent ?? 0} notice(s)</div>
        <div className="text-muted-foreground">
          {row.final_notice_at
            ? `Final ${formatDisplayDate(row.final_notice_at)}`
            : row.last_notice_at ? `Last ${formatDisplayDate(row.last_notice_at)}` : 'None served'}
        </div>
        {row.arrangement_number && (
          <button
            type="button"
            className="text-muted-foreground hover:underline"
            onClick={() => navigate(`/compliance/enforcement/arrangements/${row.arrangement_id}`)}
          >
            {row.arrangement_number}{row.arrangement_breach ? ' · in default' : ''}
          </button>
        )}
      </TableCell>

      <TableCell className="text-xs">
        <Badge variant="outline" className={toneClass(row.referral_state?.tone)}>
          {row.referral_state?.label ?? '—'}
        </Badge>
        {(row.referral_number || row.lg_case_no) && (
          <div className="text-muted-foreground mt-1">
            {row.referral_number ?? row.lg_case_no}
          </div>
        )}
        {row.open_returns > 0 && (
          <div className="text-destructive mt-0.5">{row.open_returns} open return(s)</div>
        )}
      </TableCell>

      <TableCell className="text-xs whitespace-nowrap">
        <div>{row.case_age_days ?? 0} days old</div>
        <div className="text-muted-foreground">
          {row.last_action_at ? formatDisplayDate(row.last_action_at) : 'No recent action'}
        </div>
      </TableCell>

      <TableCell>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary"
              style={{ width: `${Math.max(0, Math.min(100, Number(row.readiness_score ?? 0)))}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">{Math.round(Number(row.readiness_score ?? 0))}%</span>
        </div>
        {row.attention_reason && (
          <div className="text-[11px] text-warning mt-1">{row.attention_reason}</div>
        )}
      </TableCell>

      <TableCell className="text-right">
        <Button size="sm" variant={row.can_initiate ? 'default' : 'outline'} onClick={onOpen}>
          {row.action?.label ?? 'Review'}
          <ExternalLink className="h-3.5 w-3.5 ml-1" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function FilterSelect({
  value, onChange, options, placeholder, allLabel = 'All',
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
  allLabel?: string | null;
}) {
  return (
    <Select value={value || '__ALL__'} onValueChange={(v) => onChange(v === '__ALL__' ? '' : v)}>
      <SelectTrigger className="h-9 w-[180px]">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="bg-popover z-50">
        {allLabel && <SelectItem value="__ALL__">{allLabel}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
