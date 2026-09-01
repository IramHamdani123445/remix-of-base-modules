import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Scale,
  Building2,
  Clock,
  Loader2,
  Inbox,
  AlertTriangle,
  RefreshCw,
  Filter,
  X,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  FileWarning,
  Gavel,
  Timer,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useUserCode } from '@/hooks/useUserCode';
import {
  REFERRAL_STATUS,
  REFERRAL_STATUS_LABEL,
  referralStatusVariant,
  approveReferral,
  rejectReferral,
} from '@/services/compliance/legalEscalationFlow';
import { submitReferralToLegal } from '@/services/legal/complianceForwardingService';
import {
  useLegalReferralQueue,
  type LegalQueueRow,
} from '@/hooks/compliance/useLegalReferralQueue';

const fmtCurrency = (n: number | null | undefined) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'XCD',
    minimumFractionDigits: 0,
  }).format(Number(n || 0));

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '—');

const TABS: { key: string; label: string }[] = [
  { key: 'ACTION', label: 'Action Required' },
  { key: 'PENDING_APPROVAL', label: 'Pending Approval' },
  { key: 'APPROVED_FOR_SUBMISSION', label: 'Ready To Hand Over' },
  { key: 'RETURNED_BY_LEGAL', label: 'Returned By Legal' },
  { key: 'TRACKING', label: 'With Legal' },
  { key: 'CLOSED', label: 'Closed / Rejected' },
  { key: 'ALL', label: 'All' },
];

const ALL_STATUSES = Object.values(REFERRAL_STATUS);

const SORTS: { key: string; label: string }[] = [
  { key: 'waiting', label: 'Waiting Time' },
  { key: 'created', label: 'Created' },
  { key: 'approved', label: 'Approved' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'amount', label: 'Amount' },
  { key: 'employer', label: 'Employer' },
  { key: 'zone', label: 'Zone' },
  { key: 'status', label: 'Status' },
  { key: 'referral', label: 'Referral No.' },
];

const KpiCard = ({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: React.ElementType;
  tone?: 'default' | 'warn' | 'danger' | 'success';
}) => {
  const toneClass =
    tone === 'danger'
      ? 'text-destructive'
      : tone === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'success'
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-primary';
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground truncate">{label}</p>
            <p className={`text-2xl font-semibold ${toneClass}`}>{value}</p>
            {hint && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{hint}</p>}
          </div>
          <Icon className={`h-4 w-4 shrink-0 ${toneClass}`} />
        </div>
      </CardContent>
    </Card>
  );
};

const SlaBadge = ({ row }: { row: LegalQueueRow }) => {
  if (row.sla_days == null) {
    return <span className="text-xs text-muted-foreground">{Number(row.days_in_stage ?? 0).toFixed(1)}d</span>;
  }
  const days = Number(row.days_in_stage ?? 0).toFixed(1);
  const variant = row.is_overdue ? 'destructive' : row.is_due_soon ? 'secondary' : 'outline';
  return (
    <Badge variant={variant} className="text-[10px] font-mono">
      {days}d / {row.sla_days}d
    </Badge>
  );
};

const LegalQueue = () => {
  const navigate = useNavigate();
  const { userCode } = useUserCode();
  const {
    data,
    isLoading,
    isFetching,
    error,
    facets,
    filters,
    sort,
    dir,
    page,
    pageSize,
    activeFilterCount,
    setFilter,
    setSort,
    setPage,
    clearFilters,
    refresh,
  } = useLegalReferralQueue();

  const [showFilters, setShowFilters] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<LegalQueueRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [approveTarget, setApproveTarget] = useState<LegalQueueRow | null>(null);
  const [approveNotes, setApproveNotes] = useState('');
  const [detail, setDetail] = useState<LegalQueueRow | null>(null);

  const rows = data?.rows ?? [];
  const kpis = data?.kpis ?? ({} as Record<string, number>);
  const tabCounts = data?.tab_counts ?? {};
  const attention = data?.attention ?? [];
  const actor = data?.actor;
  const sla = data?.sla;
  const total = data?.total ?? 0;
  const pageCount = Math.max(Math.ceil(total / pageSize), 1);

  const notAuthorised = (data as { error?: string } | undefined)?.error === 'NOT_AUTHORISED';

  const canApprove = !!actor?.can_approve;
  const canSubmit = !!actor?.can_submit;

  const runAction = async (id: string, fn: () => Promise<unknown>, ok: string, description?: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await fn();
      toast.success(ok, description ? { description } : undefined);
      refresh();
    } catch (e: unknown) {
      toast.error('Action failed', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusyId(null);
    }
  };

  const doApprove = async () => {
    if (!approveTarget) return;
    const target = approveTarget;
    setApproveTarget(null);
    await runAction(
      target.id,
      () => approveReferral(target.id, userCode || null, approveNotes.trim() || undefined),
      `Referral ${target.referral_number} approved`,
      'It can now be handed over to Legal from this queue.',
    );
    setApproveNotes('');
  };

  const doReject = async () => {
    if (!rejectTarget) return;
    const target = rejectTarget;
    const reason = rejectReason;
    setRejectTarget(null);
    await runAction(
      target.id,
      () => rejectReferral(target.id, reason, userCode || null),
      `Referral ${target.referral_number} rejected`,
    );
    setRejectReason('');
  };

  const doSubmit = (row: LegalQueueRow) =>
    runAction(
      row.id,
      async () => {
        const r = await submitReferralToLegal(row.id, userCode || null);
        toast.message(`Legal intake ${r.lg_intake_no} created`);
      },
      `Referral ${row.referral_number} handed over to Legal`,
      'The compliance case is now escalated and Legal owns the intake.',
    );

  const employerOptions = useMemo(
    () =>
      (facets?.employers ?? [])
        .filter((e) => e?.code)
        .sort((a, b) => (a.label || '').localeCompare(b.label || '')),
    [facets],
  );

  const sortLabel = SORTS.find((s) => s.key === sort)?.label ?? 'Waiting Time';

  if (notAuthorised) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="py-16 text-center space-y-2">
            <ShieldAlert className="h-10 w-10 mx-auto text-destructive" />
            <p className="font-medium">Access denied</p>
            <p className="text-sm text-muted-foreground">
              You do not have the compliance legal-enforcement permission required to view the referral queue.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="container mx-auto p-6 space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Scale className="h-6 w-6 text-primary" />
              <h1 className="text-2xl font-semibold text-foreground">Legal Review &amp; Handover Queue</h1>
            </div>
            <p className="text-sm text-muted-foreground max-w-3xl">
              Stage 2 of the legal escalation, owned by Compliance — a supervisor approves the prepared referral
              and an authorised officer hands the approved referral over to Legal. Legal accepts, returns or
              litigates it afterwards from Legal Intake.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {actor && (
              <Badge variant="outline" className="text-[11px]">
                Scope: {actor.scope}
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={refresh} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <KpiCard label="Pending Approval" value={kpis.pending_approval ?? 0} icon={Clock}
            hint={sla ? `${sla.approval_days}d target` : undefined} />
          <KpiCard label="Awaiting Handover" value={kpis.awaiting_handover ?? 0} icon={Gavel}
            hint={sla ? `${sla.handover_days}d target` : undefined} tone="warn" />
          <KpiCard label="With Legal" value={kpis.with_legal ?? 0} icon={Scale}
            hint={fmtCurrency(kpis.value_with_legal)} tone="success" />
          <KpiCard label="Returned / Rejected" value={(kpis.returned ?? 0) + (kpis.rejected ?? 0)} icon={FileWarning}
            hint={`${kpis.returned ?? 0} returned · ${kpis.rejected ?? 0} rejected`} tone="danger" />
          <KpiCard label="Breaching Target" value={kpis.overdue ?? 0} icon={AlertTriangle} tone="danger"
            hint={`${kpis.pack_incomplete ?? 0} incomplete packs`} />
          <KpiCard label="Referred Value" value={fmtCurrency(kpis.value_total)} icon={Timer}
            hint={`Avg ${kpis.avg_days_pending ?? 0}d pending approval`} />
        </div>

        {/* Requires attention */}
        {attention.length > 0 && (
          <Card className="border-destructive/40">
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                Requires Attention ({attention.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 pb-3 space-y-1.5">
              {attention.slice(0, 6).map((a) => (
                <button
                  key={a.id}
                  onClick={() => setFilter('q', a.referral_number ?? '')}
                  className="w-full text-left flex flex-wrap items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm hover:bg-muted/60 transition-colors"
                >
                  <span className="font-mono text-xs">{a.referral_number}</span>
                  <span className="font-medium truncate max-w-[220px]">{a.employer_name}</span>
                  <Badge variant="destructive" className="text-[10px]">{a.attention_reason}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {Number(a.days_in_stage ?? 0).toFixed(1)}d in stage
                    {a.sla_days ? ` · target ${a.sla_days}d` : ''}
                  </span>
                  <span className="ml-auto text-xs font-medium">{fmtCurrency(a.grand_total)}</span>
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => {
            const count = tabCounts[t.key] ?? 0;
            const active = (filters.tab || 'ACTION') === t.key;
            return (
              <Button
                key={t.key}
                size="sm"
                variant={active ? 'default' : 'outline'}
                onClick={() => setFilter('tab', t.key)}
              >
                {t.label}
                <Badge variant={active ? 'secondary' : 'outline'} className="ml-2 text-[10px]">
                  {count}
                </Badge>
              </Button>
            );
          })}
        </div>

        {/* Toolbar */}
        <Card>
          <CardContent className="p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={filters.search ?? ''}
                onChange={(e) => setFilter('q', e.target.value)}
                placeholder="Search referral no., employer, intake no., court case, reason…"
                className="max-w-md"
              />
              <Button
                variant={showFilters ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowFilters((v) => !v)}
              >
                <Filter className="h-4 w-4 mr-1" />
                Filters
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-2 text-[10px]">{activeFilterCount}</Badge>
                )}
              </Button>
              <Select value={sort} onValueChange={(v) => setSort(v === sort ? v : v)}>
                <SelectTrigger className="w-[190px]">
                  <SelectValue placeholder="Sort by">{`Sort: ${sortLabel}`}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SORTS.map((s) => (
                    <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => setSort(sort)}>
                <ArrowUpDown className="h-4 w-4 mr-1" />
                {dir === 'desc' ? 'Descending' : 'Ascending'}
              </Button>
              {activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="h-4 w-4 mr-1" />
                  Clear
                </Button>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {total} referral{total === 1 ? '' : 's'}
              </span>
            </div>

            {showFilters && (
              <>
                <Separator />
                <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Status</Label>
                    <Select
                      value={filters.statuses?.[0] || 'ALL'}
                      onValueChange={(v) => setFilter('statuses', v === 'ALL' ? '' : [v])}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All statuses</SelectItem>
                        {ALL_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>{REFERRAL_STATUS_LABEL[s] ?? s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Employer</Label>
                    <Select
                      value={filters.employer_id || 'ALL'}
                      onValueChange={(v) => setFilter('employer', v === 'ALL' ? '' : v)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent className="max-h-72">
                        <SelectItem value="ALL">All employers</SelectItem>
                        {employerOptions.map((e) => (
                          <SelectItem key={e.code} value={e.code}>{e.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Zone</Label>
                    <Select
                      value={filters.zone || 'ALL'}
                      onValueChange={(v) => setFilter('zone', v === 'ALL' ? '' : v)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent className="max-h-72">
                        <SelectItem value="ALL">All zones</SelectItem>
                        {(facets?.zones ?? []).map((z) => (
                          <SelectItem key={z} value={z}>{z}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Requested By</Label>
                    <Select
                      value={filters.requested_by || 'ALL'}
                      onValueChange={(v) => setFilter('requested_by', v === 'ALL' ? '' : v)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent className="max-h-72">
                        <SelectItem value="ALL">Anyone</SelectItem>
                        {(facets?.requesters ?? []).map((r) => (
                          <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Approved By</Label>
                    <Select
                      value={filters.approved_by || 'ALL'}
                      onValueChange={(v) => setFilter('approved_by', v === 'ALL' ? '' : v)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent className="max-h-72">
                        <SelectItem value="ALL">Anyone</SelectItem>
                        {(facets?.approvers ?? []).map((r) => (
                          <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Amount From</Label>
                    <Input
                      type="number"
                      value={filters.amount_min ?? ''}
                      onChange={(e) => setFilter('amount_min', e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Amount To</Label>
                    <Input
                      type="number"
                      value={filters.amount_max ?? ''}
                      onChange={(e) => setFilter('amount_max', e.target.value)}
                      placeholder="Any"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Created From</Label>
                    <Input type="date" value={filters.created_from ?? ''}
                      onChange={(e) => setFilter('created_from', e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Created To</Label>
                    <Input type="date" value={filters.created_to ?? ''}
                      onChange={(e) => setFilter('created_to', e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Submitted From</Label>
                    <Input type="date" value={filters.submitted_from ?? ''}
                      onChange={(e) => setFilter('submitted_from', e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Submitted To</Label>
                    <Input type="date" value={filters.submitted_to ?? ''}
                      onChange={(e) => setFilter('submitted_to', e.target.value)} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 pt-1">
                  {[
                    { key: 'overdue_only', label: 'Breaching target only' },
                    { key: 'high_value_only', label: `High value only${sla ? ` (≥ ${fmtCurrency(sla.high_value_threshold)})` : ''}` },
                    { key: 'pack_incomplete_only', label: 'Incomplete packs only' },
                    { key: 'mine_only', label: 'Raised or requested by me' },
                  ].map((c) => (
                    <div key={c.key} className="flex items-center gap-2">
                      <Checkbox
                        id={c.key}
                        checked={Boolean((filters as Record<string, unknown>)[c.key])}
                        onCheckedChange={(v) => setFilter(c.key, v === true)}
                      />
                      <Label htmlFor={c.key} className="text-xs font-normal">{c.label}</Label>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Register */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : error ? (
              <div className="py-16 text-center text-sm text-destructive">{error.message}</div>
            ) : rows.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <Inbox className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No referrals match this view</p>
                <p className="text-sm mt-1">
                  Referrals appear here once a compliance officer completes the legal pack and sends them for approval.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="cursor-pointer" onClick={() => setSort('referral')}>Referral</TableHead>
                      <TableHead className="cursor-pointer" onClick={() => setSort('employer')}>Employer</TableHead>
                      <TableHead className="cursor-pointer" onClick={() => setSort('status')}>Status</TableHead>
                      <TableHead className="text-right cursor-pointer" onClick={() => setSort('amount')}>Amount</TableHead>
                      <TableHead>Pack</TableHead>
                      <TableHead className="cursor-pointer" onClick={() => setSort('waiting')}>Ageing</TableHead>
                      <TableHead>Ownership</TableHead>
                      <TableHead>Legal</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const busy = busyId === row.id;
                      const isSameOfficer = !!actor?.user_code && row.approval_requested_by === actor.user_code;
                      return (
                        <TableRow key={row.id} className={row.is_overdue ? 'bg-destructive/5' : undefined}>
                          <TableCell className="align-top">
                            <button
                              className="font-mono text-xs font-medium hover:underline"
                              onClick={() => setDetail(row)}
                            >
                              {row.referral_number}
                            </button>
                            <div className="text-[11px] text-muted-foreground">{fmtDate(row.created_at)}</div>
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="flex items-center gap-1 font-medium text-sm">
                              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="truncate max-w-[200px]">{row.employer_name}</span>
                            </div>
                            <div className="text-[11px] text-muted-foreground font-mono">
                              {row.employer_id}{row.employer_zone ? ` · ${row.employer_zone}` : ''}
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            <Badge variant={referralStatusVariant(row.status)} className="text-[10px]">
                              {REFERRAL_STATUS_LABEL[row.status] ?? row.status}
                            </Badge>
                            {row.status === REFERRAL_STATUS.RETURNED_BY_LEGAL && row.return_reason && (
                              <div className="text-[11px] text-destructive mt-1 max-w-[200px] truncate">
                                {row.return_reason}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="align-top text-right">
                            <div className="font-medium text-sm">{fmtCurrency(row.grand_total)}</div>
                            {row.is_high_value && (
                              <Badge variant="secondary" className="text-[10px] mt-1">High value</Badge>
                            )}
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="text-[11px] text-muted-foreground">
                              {row.items_count ?? 0} items · {row.documents_count ?? 0} docs
                            </div>
                            {row.pack_incomplete && (
                              <Badge variant="destructive" className="text-[10px] mt-1">Incomplete</Badge>
                            )}
                          </TableCell>
                          <TableCell className="align-top"><SlaBadge row={row} /></TableCell>
                          <TableCell className="align-top text-[11px] text-muted-foreground">
                            <div>Req: {row.approval_requested_by_name ?? '—'}</div>
                            <div>App: {row.approved_by_name ?? '—'}</div>
                          </TableCell>
                          <TableCell className="align-top text-[11px]">
                            {row.lg_intake_no ? (
                              <span className="font-mono">{row.lg_intake_no}</span>
                            ) : (
                              <span className="text-muted-foreground">Not handed over</span>
                            )}
                            {row.court_case_number && (
                              <div className="font-mono text-muted-foreground">{row.court_case_number}</div>
                            )}
                          </TableCell>
                          <TableCell className="align-top text-right">
                            <div className="flex justify-end gap-1 flex-wrap">
                              {row.source_case_id && (
                                <Button variant="ghost" size="sm"
                                  onClick={() => navigate(`/compliance/cases/${row.source_case_id}`)}>
                                  Case
                                </Button>
                              )}
                              {row.status === REFERRAL_STATUS.PENDING_APPROVAL && (
                                <>
                                  <Button variant="outline" size="sm" disabled={busy || !canApprove}
                                    onClick={() => setRejectTarget(row)}>
                                    Reject
                                  </Button>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span>
                                        <Button size="sm" disabled={busy || isSameOfficer || !canApprove}
                                          onClick={() => setApproveTarget(row)}>
                                          {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                                          Approve
                                        </Button>
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {!canApprove
                                        ? 'You do not have the legal approval permission'
                                        : isSameOfficer
                                          ? 'Maker-checker: you requested this approval, so another officer must approve it'
                                          : 'Approve this referral for hand-over to Legal'}
                                    </TooltipContent>
                                  </Tooltip>
                                </>
                              )}
                              {row.status === REFERRAL_STATUS.APPROVED_FOR_SUBMISSION && (
                                <Button size="sm" disabled={busy || !canSubmit || row.pack_incomplete}
                                  title={row.pack_incomplete ? 'Complete the referral pack before hand-over' : undefined}
                                  onClick={() => doSubmit(row)}>
                                  {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                                  Hand Over
                                </Button>
                              )}
                              {row.status === REFERRAL_STATUS.RETURNED_BY_LEGAL && row.source_case_id && (
                                <Button variant="outline" size="sm"
                                  onClick={() => navigate(`/compliance/legal/pack-preparation?referral=${row.id}`)}>
                                  Rework
                                </Button>
                              )}
                              {[REFERRAL_STATUS.SUBMITTED_TO_LEGAL, REFERRAL_STATUS.ACCEPTED_BY_LEGAL,
                                REFERRAL_STATUS.IN_LEGAL_PROCEEDINGS].includes(row.status as never) && (
                                <Button variant="outline" size="sm"
                                  onClick={() => navigate('/compliance/legal/approved-escalations')}>
                                  Track
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {total > pageSize && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Page {page} of {pageCount} · showing {rows.length} of {total}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <ChevronLeft className="h-4 w-4" /> Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Approve dialog */}
        <Dialog open={!!approveTarget} onOpenChange={(o) => !o && setApproveTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Approve Legal Referral</DialogTitle>
              <DialogDescription>
                {approveTarget?.referral_number} — {approveTarget?.employer_name} ·{' '}
                {fmtCurrency(approveTarget?.grand_total)}. Approval authorises hand-over to Legal.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              rows={4}
              value={approveNotes}
              onChange={(e) => setApproveNotes(e.target.value)}
              placeholder="Approval notes (optional)"
              maxLength={2000}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setApproveTarget(null)}>Cancel</Button>
              <Button onClick={doApprove}>Approve Referral</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Reject dialog */}
        <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject Legal Referral</DialogTitle>
              <DialogDescription>
                {rejectTarget?.referral_number} will be rejected and the compliance case stays with Compliance.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              rows={4}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Why is this referral being rejected?"
              maxLength={2000}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setRejectTarget(null)}>Cancel</Button>
              <Button variant="destructive" disabled={!rejectReason.trim()} onClick={doReject}>
                Reject Referral
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Detail dialog */}
        <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="font-mono text-base">{detail?.referral_number}</DialogTitle>
              <DialogDescription>
                {detail?.employer_name} · {detail?.employer_id}
                {detail?.employer_zone ? ` · ${detail.employer_zone}` : ''}
              </DialogDescription>
            </DialogHeader>
            {detail && (
              <div className="grid gap-3 md:grid-cols-2 text-sm">
                <div><span className="text-muted-foreground">Status: </span>
                  {REFERRAL_STATUS_LABEL[detail.status] ?? detail.status}</div>
                <div><span className="text-muted-foreground">Amount: </span>{fmtCurrency(detail.grand_total)}</div>
                <div><span className="text-muted-foreground">Principal: </span>{fmtCurrency(detail.total_principal)}</div>
                <div><span className="text-muted-foreground">Interest: </span>{fmtCurrency(detail.total_interest)}</div>
                <div><span className="text-muted-foreground">Penalties: </span>{fmtCurrency(detail.total_penalties)}</div>
                <div><span className="text-muted-foreground">Periods: </span>
                  {detail.period_from ?? '—'} → {detail.period_to ?? '—'} ({detail.periods_count ?? 0})</div>
                <div><span className="text-muted-foreground">Items / Documents: </span>
                  {detail.items_count ?? 0} / {detail.documents_count ?? 0}</div>
                <div><span className="text-muted-foreground">Notices sent: </span>{detail.notices_sent ?? 0}</div>
                <div><span className="text-muted-foreground">Requested by: </span>
                  {detail.approval_requested_by_name ?? '—'} ({fmtDate(detail.approval_requested_at)})</div>
                <div><span className="text-muted-foreground">Approved by: </span>
                  {detail.approved_by_name ?? '—'} ({fmtDate(detail.approved_at)})</div>
                <div><span className="text-muted-foreground">Handed over: </span>{fmtDate(detail.submitted_date)}</div>
                <div><span className="text-muted-foreground">Accepted: </span>{fmtDate(detail.accepted_date)}</div>
                <div><span className="text-muted-foreground">Legal intake: </span>{detail.lg_intake_no ?? '—'}</div>
                <div><span className="text-muted-foreground">Court case: </span>{detail.court_case_number ?? '—'}</div>
                <div className="md:col-span-2">
                  <span className="text-muted-foreground">Reason: </span>
                  {detail.referral_reason_text ?? detail.referral_reason_code ?? '—'}
                </div>
                {detail.return_reason && (
                  <div className="md:col-span-2 text-destructive">
                    <span className="text-muted-foreground">Return reason: </span>{detail.return_reason}
                  </div>
                )}
                {detail.rejection_reason && (
                  <div className="md:col-span-2 text-destructive">
                    <span className="text-muted-foreground">Rejection reason: </span>{detail.rejection_reason}
                  </div>
                )}
              </div>
            )}
            <DialogFooter>
              {detail?.source_case_id && (
                <Button variant="outline" onClick={() => navigate(`/compliance/cases/${detail.source_case_id}`)}>
                  Open Compliance Case
                </Button>
              )}
              <Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
};

export default LegalQueue;
