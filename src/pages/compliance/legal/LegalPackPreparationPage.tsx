import { useState } from 'react';
import {
  AlertTriangle, FileCheck2, Filter, Loader2, RefreshCw, Search, TimerReset, TrendingUp, X,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { SortableTableHead } from '@/components/shared/SortableTableHead';
import { TablePagination } from '@/components/shared/TablePagination';
import { formatCurrency } from '@/utils/formatCurrency';
import LegalPackAssemblyDialog from '@/components/compliance/legal/LegalPackAssemblyDialog';
import {
  useLegalPackRegister, PACK_PAGE_SIZES, READINESS_LABEL, READINESS_TONE, ATTENTION_LABEL,
} from '@/hooks/compliance/useLegalPackRegister';

const PERMISSION = 'manage_compliance';

export default function LegalPackPreparationPage() {
  return (
    <PermissionWrapper moduleName={PERMISSION}>
      <PackRegister />
    </PermissionWrapper>
  );
}

const TABS = [
  { value: 'IN_PREPARATION', label: 'In preparation' },
  { value: 'RETURNED', label: 'Returned by Legal' },
  { value: 'PENDING_APPROVAL', label: 'Pending approval' },
  { value: 'ALL', label: 'All' },
];

function PackRegister() {
  const {
    filters, setFilters, resetFilters, rows, total, kpis, attention, facets, thresholds,
    isLoading, isFetching, error, refetch, selectedId, setSelectedId,
  } = useLegalPackRegister();

  const [dialogOpen, setDialogOpen] = useState(!!selectedId);

  function openPack(id: string) {
    setSelectedId(id);
    setDialogOpen(true);
  }

  const totalPages = Math.max(1, Math.ceil(total / filters.page_size));

  return (
    <div className="container mx-auto p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileCheck2 className="h-6 w-6 text-primary" />
            Legal Referral Pack Assembly
          </h1>
          <p className="text-sm text-muted-foreground">
            Stage 1 of legal escalation. Readiness is validated server-side from live case, notice,
            payment and evidence records — nothing reaches Legal until the pack is complete and approved.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="In preparation" value={kpis?.in_preparation ?? 0} />
        <Kpi label="Ready to submit" value={kpis?.ready ?? 0} tone="text-success" />
        <Kpi label="Incomplete" value={kpis?.incomplete ?? 0} tone="text-destructive" />
        <Kpi label="Returned by Legal" value={kpis?.returned ?? 0} tone="text-warning" />
        <Kpi
          label={`SLA breached (> ${thresholds?.sla_days ?? 5}d)`}
          value={kpis?.sla_breached ?? 0}
          tone="text-destructive"
        />
        <Kpi label="Total exposure" value={formatCurrency(Number(kpis?.total_exposure ?? 0))} />
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
                key={a.id}
                onClick={() => openPack(a.id)}
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
                  {formatCurrency(Number(a.amount))} · {a.age_days}d in preparation · {a.completion_pct}% complete
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
            <TabsList>
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search referral number, employer or case…"
                value={filters.search}
                onChange={(e) => setFilters({ search: e.target.value, page: 1 })}
              />
            </div>

            <Select value={filters.readiness || 'ALL'} onValueChange={(v) => setFilters({ readiness: v === 'ALL' ? '' : v, page: 1 })}>
              <SelectTrigger className="w-[190px]"><SelectValue placeholder="Readiness" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All readiness</SelectItem>
                {(facets?.readiness ?? []).map((r) => (
                  <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.missing_item || 'ALL'} onValueChange={(v) => setFilters({ missing_item: v === 'ALL' ? '' : v, page: 1 })}>
              <SelectTrigger className="w-[210px]"><SelectValue placeholder="Missing item" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any missing item</SelectItem>
                {(facets?.items ?? []).map((i) => (
                  <SelectItem key={i.code} value={i.code}>{i.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.reason_code || 'ALL'} onValueChange={(v) => setFilters({ reason_code: v === 'ALL' ? '' : v, page: 1 })}>
              <SelectTrigger className="w-[190px]"><SelectValue placeholder="Reason" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All reasons</SelectItem>
                {(facets?.reason_codes ?? []).filter(Boolean).map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.amount_band || 'ALL'} onValueChange={(v) => setFilters({ amount_band: v === 'ALL' ? '' : v, page: 1 })}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Amount" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any amount</SelectItem>
                <SelectItem value="0-10k">Up to 10k</SelectItem>
                <SelectItem value="10k-50k">10k – 50k</SelectItem>
                <SelectItem value="50k-250k">50k – 250k</SelectItem>
                <SelectItem value="250k+">250k and above</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filters.age_min_days || 'ALL'} onValueChange={(v) => setFilters({ age_min_days: v === 'ALL' ? '' : v, page: 1 })}>
              <SelectTrigger className="w-[170px]"><SelectValue placeholder="Ageing" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any age</SelectItem>
                <SelectItem value="3">3+ days</SelectItem>
                <SelectItem value="7">7+ days</SelectItem>
                <SelectItem value="14">14+ days</SelectItem>
                <SelectItem value="30">30+ days</SelectItem>
              </SelectContent>
            </Select>

            <Button variant="ghost" size="sm" onClick={resetFilters}>
              <X className="h-4 w-4 mr-1" /> Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Register */}
      <Card>
        <CardContent className="pt-4">
          {error && (
            <div className="py-8 text-center text-sm text-destructive">{error.message}</div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead sortKey="referral_no" currentSortKey={filters.sort} direction={filters.dir}
                  onSort={(k) => setFilters({ sort: k, dir: filters.dir === 'asc' ? 'desc' : 'asc' })}>
                  Referral
                </SortableTableHead>
                <SortableTableHead sortKey="employer" currentSortKey={filters.sort} direction={filters.dir}
                  onSort={(k) => setFilters({ sort: k, dir: filters.dir === 'asc' ? 'desc' : 'asc' })}>
                  Employer
                </SortableTableHead>
                <TableHead>Case</TableHead>
                <TableHead>State</TableHead>
                <SortableTableHead sortKey="completion" currentSortKey={filters.sort} direction={filters.dir}
                  onSort={(k) => setFilters({ sort: k, dir: filters.dir === 'asc' ? 'desc' : 'asc' })}>
                  Readiness
                </SortableTableHead>
                <TableHead>Docs</TableHead>
                <SortableTableHead sortKey="amount" currentSortKey={filters.sort} direction={filters.dir}
                  onSort={(k) => setFilters({ sort: k, dir: filters.dir === 'asc' ? 'desc' : 'asc' })}
                  className="text-right">
                  Exposure
                </SortableTableHead>
                <SortableTableHead sortKey="age_days" currentSortKey={filters.sort} direction={filters.dir}
                  onSort={(k) => setFilters({ sort: k, dir: filters.dir === 'asc' ? 'desc' : 'asc' })}>
                  Ageing
                </SortableTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                    No referral packs match the current filters.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => openPack(r.id)}>
                  <TableCell className="font-mono text-xs">
                    {r.referral_number}
                    {r.high_value && <Badge variant="outline" className="ml-2 text-[10px]">High value</Badge>}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium truncate max-w-[220px]">{r.employer_name ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{r.employer_id ?? '—'}{r.employer_zone ? ` · ${r.employer_zone}` : ''}</div>
                  </TableCell>
                  <TableCell className="text-xs">{r.case_number ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px]">{r.status}</Badge>
                    {r.status === 'RETURNED' && r.return_reason && (
                      <div className="text-[11px] text-destructive truncate max-w-[160px]">{r.return_reason}</div>
                    )}
                  </TableCell>
                  <TableCell className="min-w-[170px]">
                    <Badge variant="outline" className={`${READINESS_TONE[r.readiness]} text-[10px]`}>
                      {READINESS_LABEL[r.readiness]}
                    </Badge>
                    <Progress value={r.completion_pct} className="h-1.5 mt-1.5" />
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {r.completion_pct}% · {(r.missing_keys ?? []).length} outstanding
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">{r.documents}</TableCell>
                  <TableCell className="text-right text-sm">{formatCurrency(Number(r.amount))}</TableCell>
                  <TableCell className="text-xs">
                    <span className={r.sla_breached ? 'text-destructive font-medium' : ''}>
                      {r.age_days}d
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <TablePagination
            pagination={{
              page: filters.page,
              pageSize: filters.page_size,
              totalItems: total,
              totalPages,
            }}
            onPageChange={(p) => setFilters({ page: p })}
            onPageSizeChange={(s) => setFilters({ page_size: s, page: 1 })}
            pageSizeOptions={[...PACK_PAGE_SIZES]}
          />
        </CardContent>
      </Card>

      <LegalPackAssemblyDialog
        referralId={selectedId}
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) setSelectedId(null);
        }}
      />
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold ${tone ?? ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
