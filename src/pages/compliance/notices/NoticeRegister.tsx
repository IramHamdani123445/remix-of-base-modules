/**
 * Compliance → Notice Register (CANONICAL).
 *
 * Enterprise Notice Lifecycle & Communication Control workspace: register +
 * lifecycle + delivery tracking + employer-response monitoring. This page
 * replaces the legacy `/compliance/enforcement/notices` management screen
 * (that route now redirects here).
 *
 * Everything (search, filters, sort, paging, KPIs, attention set) is resolved
 * server-side by `ce_notice_register_v1`. Creation stays in the canonical
 * Generate Notice workflow; approval / delivery / response deep queues remain
 * on their dedicated subpages.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { ComplianceHelpButton } from '@/components/help/ComplianceHelpButton';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { PermissionButton } from '@/components/ui/permission-button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Bell, Plus, Loader2, Search, AlertTriangle, Filter, ChevronDown, ArrowUpDown,
  Building2, Truck, MessageSquare, ClipboardCheck, Inbox, Timer, ExternalLink,
} from 'lucide-react';
import { GenerateNoticeDialog } from '@/components/compliance/GenerateNoticeDialog';
import { NoticeDetailDialog } from '@/components/compliance/notices/NoticeDetailDialog';
import { isComplianceFeatureEnabled } from '@/lib/compliance/featureToggles';
import { useNoticeRegister, NOTICE_PAGE_SIZES, labelFor, type NoticeRow } from '@/hooks/compliance/useNoticeRegister';

const MODULE = 'manage_compliance';

const QUICK_TABS: { key: string; label: string }[] = [
  { key: 'ALL', label: 'All Notices' },
  { key: 'ATTENTION', label: 'Requires Attention' },
  { key: 'DRAFT', label: 'Draft' },
  { key: 'PENDING_APPROVAL', label: 'Pending Approval' },
  { key: 'FAILED_DELIVERY', label: 'Failed Delivery' },
  { key: 'AWAITING_RESPONSE', label: 'Awaiting Response' },
  { key: 'RESPONSE_OVERDUE', label: 'Response Overdue' },
  { key: 'FINAL_LEGAL', label: 'Final / Legal Warning' },
  { key: 'CREATED_WEEK', label: 'Created This Week' },
];

const SORTS: { key: string; label: string }[] = [
  { key: 'attention', label: 'Action Required' },
  { key: 'created_at', label: 'Created Date' },
  { key: 'notice_number', label: 'Notice Number' },
  { key: 'employer', label: 'Employer' },
  { key: 'status', label: 'Status' },
  { key: 'notice_type', label: 'Notice Type' },
  { key: 'due_response_date', label: 'Response Due' },
  { key: 'sent_at', label: 'Sent Date' },
  { key: 'delivered_at', label: 'Delivered Date' },
];

const DATE_WINDOWS = [
  { code: 'TODAY', label: 'Today' },
  { code: 'D7', label: 'Last 7 Days' },
  { code: 'D30', label: 'Last 30 Days' },
  { code: 'D90', label: 'Last 90 Days' },
];

const DUE_WINDOWS = [
  { code: 'OVERDUE', label: 'Overdue' },
  { code: 'TODAY', label: 'Due Today' },
  { code: 'D1_3', label: 'Due in 1–3 Days' },
  { code: 'WEEK', label: 'Due This Week' },
  { code: 'NONE', label: 'No Due Date' },
];

const DELIVERY_TONE: Record<string, string> = {
  PENDING: 'bg-muted text-muted-foreground',
  SENT: 'bg-blue-500/15 text-blue-700 border-blue-300',
  DELIVERED: 'bg-green-500/15 text-green-700 border-green-300',
  FAILED: 'bg-destructive/10 text-destructive border-destructive/30',
};
const RESPONSE_TONE: Record<string, string> = {
  NOT_REQUIRED: 'bg-muted text-muted-foreground',
  AWAITING: 'bg-amber-500/15 text-amber-700 border-amber-300',
  OVERDUE: 'bg-destructive/10 text-destructive border-destructive/30',
  RECEIVED: 'bg-emerald-500/15 text-emerald-700 border-emerald-300',
};
const STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  PENDING_APPROVAL: 'bg-amber-500/15 text-amber-700 border-amber-300',
  APPROVED: 'bg-blue-500/15 text-blue-700 border-blue-300',
  SENT: 'bg-blue-600/15 text-blue-800 border-blue-400',
  DELIVERED: 'bg-green-500/15 text-green-700 border-green-300',
  ACKNOWLEDGED: 'bg-emerald-500/15 text-emerald-700 border-emerald-300',
  FAILED: 'bg-destructive/10 text-destructive border-destructive/30',
  CANCELLED: 'bg-muted text-muted-foreground',
};

const DELIVERY_LABELS: Record<string, string> = {
  PENDING: 'Not Yet Dispatched', SENT: 'Dispatched', DELIVERED: 'Delivered', FAILED: 'Failed',
};
const RESPONSE_LABELS: Record<string, string> = {
  NOT_REQUIRED: 'No Response Required', AWAITING: 'Awaiting Response',
  OVERDUE: 'Response Overdue', RECEIVED: 'Response Received',
};

function fmtDate(v?: string | null) {
  if (!v) return '—';
  try { return new Date(v).toLocaleDateString('en-GB'); } catch { return v; }
}

function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number | undefined; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <div className={`rounded-md p-2 ${tone || 'bg-muted'}`}><Icon className="h-4 w-4" /></div>
        <div>
          <p className="text-lg font-semibold leading-none">{value ?? '—'}</p>
          <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function NoticeRegister() {
  const navigate = useNavigate();
  const {
    filters, sort, dir, page, pageSize, activeFilterCount,
    setFilter, toggleListFilter, setSort, setPage, setPageSize, setTab, clearFilters,
    register, facets,
  } = useNoticeRegister();

  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [openGen, setOpenGen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => { setSearchDraft(filters.search); }, [filters.search]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchDraft !== filters.search) setFilter('search', searchDraft);
    }, 350);
    return () => clearTimeout(t);
  }, [searchDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = register.data;
  const rows: NoticeRow[] = (data?.rows as NoticeRow[]) || [];
  const total = data?.total ?? 0;
  const kpis = data?.kpis || {};
  const tabCounts = data?.tab_counts || {};
  const actor = data?.actor;
  const f = facets.data;

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const isFiltered = activeFilterCount > 0 || filters.tab !== 'ALL';

  const attention = data?.attention || [];

  const header = useMemo(() => (
    <div className="flex items-center gap-2">
      <ComplianceHelpButton screenKey="notices" />
      {isComplianceFeatureEnabled('notices.generate') && (
        <PermissionButton moduleName={MODULE} actionName="create" onClick={() => setOpenGen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Generate Notice
        </PermissionButton>
      )}
    </div>
  ), []);

  return (
    <PermissionWrapper moduleName={MODULE}>
      <div className="container mx-auto p-6 space-y-4">
        <PageHeader
          title="Notice Register"
          subtitle="Formal enforcement notices — lifecycle, delivery and employer response control."
          actions={header}
        />

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Kpi icon={ClipboardCheck} label="Pending Approval" value={kpis.pending_approval} tone="bg-amber-500/15 text-amber-700" />
          <Kpi icon={Truck} label="Failed Delivery" value={kpis.failed_delivery} tone="bg-destructive/10 text-destructive" />
          <Kpi icon={Inbox} label="Awaiting Response" value={kpis.awaiting_response} tone="bg-blue-500/15 text-blue-700" />
          <Kpi icon={Timer} label="Response Overdue" value={kpis.response_overdue} tone="bg-destructive/10 text-destructive" />
          <Kpi icon={Bell} label="Sent This Month" value={kpis.sent_this_month} />
        </div>

        {/* Requires attention */}
        {attention.length > 0 && (
          <Card className="border-amber-300/70">
            <CardContent className="p-3 space-y-2">
              <p className="text-sm font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" /> Requires Attention
                <span className="text-xs font-normal text-muted-foreground">
                  (thresholds from notice configuration — approval ageing {data?.thresholds?.approval_ageing_days}d,
                  approved-not-sent {data?.thresholds?.approved_not_sent_days}d)
                </span>
              </p>
              <div className="grid md:grid-cols-2 gap-2">
                {attention.map(a => (
                  <button key={a.id} onClick={() => setDetailId(a.id)}
                    className="text-left rounded-md border px-3 py-2 hover:bg-muted/50 transition">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs">{a.notice_number}</span>
                      <Badge variant="outline" className="text-[10px]">{a.status_label}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{a.employer_name}</p>
                    <p className="text-xs mt-0.5">{a.reason}</p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quick filters + search */}
        <div className="flex flex-wrap items-center gap-2">
          {QUICK_TABS.map(t => (
            <Button key={t.key} size="sm" variant={filters.tab === t.key ? 'default' : 'outline'}
              className="h-8" onClick={() => setTab(t.key)}>
              {t.label}
              <span className="ml-1.5 text-[11px] opacity-70">{tabCounts[t.key] ?? 0}</span>
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[280px]">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8 h-9" placeholder="Search notice, employer, case or violation..."
              value={searchDraft} onChange={e => setSearchDraft(e.target.value)} />
          </div>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="h-9 w-[190px]"><ArrowUpDown className="h-3.5 w-3.5 mr-1" /><SelectValue /></SelectTrigger>
            <SelectContent>{SORTS.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-9" onClick={() => setSort(sort)}>
            {dir === 'asc' ? 'Ascending' : 'Descending'}
          </Button>
          <Collapsible open={advanced} onOpenChange={setAdvanced}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                <Filter className="h-4 w-4 mr-1" /> Filters
                {activeFilterCount > 0 && <Badge className="ml-1.5 h-5">{activeFilterCount}</Badge>}
                <ChevronDown className="h-3.5 w-3.5 ml-1" />
              </Button>
            </CollapsibleTrigger>
          </Collapsible>
          {isFiltered && (
            <Button variant="ghost" size="sm" className="h-9" onClick={clearFilters}>Clear Filters</Button>
          )}
        </div>

        <Collapsible open={advanced} onOpenChange={setAdvanced}>
          <CollapsibleContent>
            <Card>
              <CardContent className="p-4 grid md:grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs">Employer</Label>
                  <Select value={filters.employer_id || 'ALL'} onValueChange={v => setFilter('employer_id', v === 'ALL' ? '' : v)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="All employers" /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="ALL">All employers</SelectItem>
                      {(f?.employers || []).map(e => <SelectItem key={e.code} value={e.code}>{e.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Case</Label>
                  <Select value={filters.case_id || 'ALL'} onValueChange={v => setFilter('case_id', v === 'ALL' ? '' : v)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="All cases" /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="ALL">All cases</SelectItem>
                      {(f?.cases || []).map(c => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Violation</Label>
                  <Select value={filters.violation_id || 'ALL'} onValueChange={v => setFilter('violation_id', v === 'ALL' ? '' : v)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="All violations" /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="ALL">All violations</SelectItem>
                      {(f?.violations || []).map(v => <SelectItem key={v.code} value={v.code}>{v.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="md:col-span-3"><Separator /></div>

                <div className="md:col-span-3 grid md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">Notice Type</Label>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {(f?.types || []).map(t => (
                        <Badge key={t.code} variant={filters.types.includes(t.code) ? 'default' : 'outline'}
                          className="cursor-pointer" onClick={() => toggleListFilter('types', t.code)}>{t.label}</Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Notice Status</Label>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {(f?.statuses || []).map(s => (
                        <Badge key={s.code} variant={filters.statuses.includes(s.code) ? 'default' : 'outline'}
                          className="cursor-pointer" onClick={() => toggleListFilter('statuses', s.code)}>{s.label}</Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Delivery Status</Label>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {(f?.delivery || []).map(s => (
                        <Badge key={s.code} variant={filters.delivery.includes(s.code) ? 'default' : 'outline'}
                          className="cursor-pointer" onClick={() => toggleListFilter('delivery', s.code)}>{s.label}</Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Employer Response</Label>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {(f?.response || []).map(s => (
                        <Badge key={s.code} variant={filters.response.includes(s.code) ? 'default' : 'outline'}
                          className="cursor-pointer" onClick={() => toggleListFilter('response', s.code)}>{s.label}</Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Delivery Method</Label>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {(f?.methods || []).map(s => (
                        <Badge key={s.code} variant={filters.methods.includes(s.code) ? 'default' : 'outline'}
                          className="cursor-pointer" onClick={() => toggleListFilter('methods', s.code)}>{s.label}</Badge>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="md:col-span-3"><Separator /></div>

                <div>
                  <Label className="text-xs">Response Due</Label>
                  <Select value={filters.due_window || 'ALL'} onValueChange={v => setFilter('due_window', v === 'ALL' ? '' : v)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Any" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">Any</SelectItem>
                      {DUE_WINDOWS.map(d => <SelectItem key={d.code} value={d.code}>{d.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Created Date</Label>
                  <Select value={filters.created_window || 'ALL'} onValueChange={v => setFilter('created_window', v === 'ALL' ? '' : v)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Any" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">Any</SelectItem>
                      {DATE_WINDOWS.map(d => <SelectItem key={d.code} value={d.code}>{d.label}</SelectItem>)}
                      <SelectItem value="CUSTOM">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Sent Date</Label>
                    <Select value={filters.sent_window || 'ALL'} onValueChange={v => setFilter('sent_window', v === 'ALL' ? '' : v)}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Any" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">Any</SelectItem>
                        {DATE_WINDOWS.map(d => <SelectItem key={d.code} value={d.code}>{d.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Delivered Date</Label>
                    <Select value={filters.delivered_window || 'ALL'} onValueChange={v => setFilter('delivered_window', v === 'ALL' ? '' : v)}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Any" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">Any</SelectItem>
                        {DATE_WINDOWS.map(d => <SelectItem key={d.code} value={d.code}>{d.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {filters.created_window === 'CUSTOM' && (
                  <div className="grid grid-cols-2 gap-2 md:col-span-3">
                    <div>
                      <Label className="text-xs">Created From</Label>
                      <Input type="date" className="h-9" value={filters.created_from} onChange={e => setFilter('created_from', e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Created To</Label>
                      <Input type="date" className="h-9" value={filters.created_to} onChange={e => setFilter('created_to', e.target.value)} />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>

        {/* Register */}
        <Card>
          <CardContent className="p-0">
            {register.isLoading ? (
              <div className="p-12 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>
            ) : register.isError ? (
              <div className="p-12 text-center space-y-3">
                <AlertTriangle className="h-6 w-6 mx-auto text-destructive" />
                <p className="text-sm font-medium">Unable to load notices</p>
                <p className="text-xs text-muted-foreground">{(register.error as any)?.message}</p>
                <Button variant="outline" size="sm" onClick={() => register.refetch()}>Retry</Button>
              </div>
            ) : rows.length === 0 ? (
              <div className="p-12 text-center space-y-2">
                <Bell className="h-6 w-6 mx-auto text-muted-foreground" />
                {isFiltered ? (
                  <>
                    <p className="text-sm font-medium">No notices match the selected filters</p>
                    <Button variant="outline" size="sm" onClick={clearFilters}>Clear Filters</Button>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium">No compliance notices found</p>
                    <p className="text-xs text-muted-foreground">Notices generated from Compliance cases or violations will appear here.</p>
                  </>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer" onClick={() => setSort('notice_number')}>Notice #</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => setSort('employer')}>Employer</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => setSort('notice_type')}>Type</TableHead>
                    <TableHead>Case / Violation</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => setSort('status')}>Status</TableHead>
                    <TableHead>Delivery</TableHead>
                    <TableHead>Response</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => setSort('due_response_date')}>Due</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => setSort('created_at')}>Created</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(n => (
                    <TableRow key={n.id} className={n.attention_score >= 45 ? 'bg-destructive/[0.03]' : undefined}>
                      <TableCell className="whitespace-nowrap">
                        <button className="font-mono text-xs text-primary hover:underline" onClick={() => setDetailId(n.id)}>
                          {n.notice_number}
                        </button>
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        {n.employer_id ? (
                          <button className="text-sm text-primary hover:underline inline-flex items-center gap-1 truncate"
                            onClick={() => navigate(`/compliance/field/employer-360/${encodeURIComponent(n.employer_id!)}`)}>
                            <Building2 className="h-3 w-3 shrink-0" />
                            <span className="truncate">{n.employer_name || n.employer_id}</span>
                          </button>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs">{labelFor(n.notice_type, n.notice_type_label, 'Notice Type')}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {n.case_id && (
                          <button className="text-primary hover:underline font-mono mr-2"
                            onClick={() => navigate(`/compliance/cases/${n.case_id}`)}>{n.case_number || 'Case'}</button>
                        )}
                        {n.violation_id && (
                          <button className="text-primary hover:underline font-mono"
                            onClick={() => navigate(`/compliance/violations/${n.violation_id}`)}>{n.violation_number || 'Violation'}</button>
                        )}
                        {!n.case_id && !n.violation_id && <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_TONE[n.status] || ''}>
                          {labelFor(n.status, n.status_label, 'Status')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={DELIVERY_TONE[n.delivery_status] || ''}>
                          {DELIVERY_LABELS[n.delivery_status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={RESPONSE_TONE[n.response_state] || ''}>
                          {RESPONSE_LABELS[n.response_state]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{fmtDate(n.due_response_date)}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{fmtDate(n.created_at)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setDetailId(n.id)}>
                          Open <ExternalLink className="h-3 w-3 ml-1" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {!register.isError && total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Showing {rangeStart}–{rangeEnd} of {total} {isFiltered ? 'matching notices' : 'notices'}
            </p>
            <div className="flex items-center gap-2">
              <Select value={String(pageSize)} onValueChange={v => setPageSize(Number(v))}>
                <SelectTrigger className="h-8 w-[90px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NOTICE_PAGE_SIZES.map(s => <SelectItem key={s} value={String(s)}>{s} / page</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="h-8" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" className="h-8" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <button className="hover:underline" onClick={() => navigate('/compliance/notices/pending-approval')}><ClipboardCheck className="h-3 w-3 inline mr-1" />Approval Queue</button>
          <button className="hover:underline" onClick={() => navigate('/compliance/notices/delivery-tracking')}><Truck className="h-3 w-3 inline mr-1" />Delivery Tracking</button>
          <button className="hover:underline" onClick={() => navigate('/compliance/notices/employer-responses')}><MessageSquare className="h-3 w-3 inline mr-1" />Employer Responses</button>
          <button className="hover:underline" onClick={() => navigate('/compliance/notices/communication-history')}><Bell className="h-3 w-3 inline mr-1" />Communication History</button>
        </div>

        <GenerateNoticeDialog open={openGen} onOpenChange={setOpenGen} />
        <NoticeDetailDialog
          noticeId={detailId}
          open={!!detailId}
          onOpenChange={o => !o && setDetailId(null)}
          actor={actor}
        />
      </div>
    </PermissionWrapper>
  );
}
