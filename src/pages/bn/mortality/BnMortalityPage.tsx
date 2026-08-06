/**
 * BN Mortality — Operational Dashboard  (/bn/mortality)
 *
 * BN-MORT-UX-2: interactive dashboard cards, business-friendly labels,
 * server-safe open/closed filters, row navigation, differentiated empty
 * and error states, truthful preview-registration action, and filter
 * preservation across dashboard ↔ event-detail navigation.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BnModuleRouteGate,
  type BnModuleAccessContext,
} from '@/components/bn/access/BnModuleRouteGate';
import { BnMortalityAuthState } from './components/BnMortalityAuthState';
import { BnMortalityBreadcrumbs } from './components/BnMortalityBreadcrumbs';
import {
  BnMortalityAssigneeFilter,
} from './components/BnMortalityAssigneeFilter';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';

import {
  useMortalityDashboard,
  useMortalityEventList,
  useMortalityAssignableUsers,
  useMortalityWorklistIndicators,
  type MortalityListFilters,
} from '@/hooks/bn/mortality/useMortalityQueries';
import type { MortalityWorklistIndicator } from '@/types/bn/mortality/mortalityDtos';
import { BnMortalityWorklistIndicators } from './components/BnMortalityWorklistIndicators';
import {
  MORTALITY_SOURCE_LABELS,
  MORTALITY_STATUS_LABELS,
  mortalitySourceLabel,
  mortalityStatusLabel,
} from './lib/mortalityLabels';
import {
  DEFAULT_STATE,
  clearOtherUserStates,
  loadDashboardState,
  reduceDashboardState,
  saveDashboardState,
  type CardId,
  type DashState,
  type AssigneeMode,
} from './lib/dashboardState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertTriangle,
  ClipboardCheck,
  Clock,
  Eye,
  Filter as FilterIcon,
  Inbox,
  Lock,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  UserPlus,
  X,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Dashboard-card catalogue                                            */
/* ------------------------------------------------------------------ */

interface CardSpec {
  id: CardId;
  label: string;
  ariaAction: string;
  totalKey:
    | 'totalOpen' | 'unassigned' | 'verificationPending' | 'provisionallyHeld'
    | 'conflicts' | 'impactReview' | 'approvalPending' | 'followOnProcessing'
    | 'overdue' | 'closedThisMonth';
  icon: React.ReactNode;
  tone?: 'default' | 'warn' | 'success' | 'muted';
}

const CARDS: readonly CardSpec[] = [
  { id: 'totalOpen',           label: 'Total open',           ariaAction: 'total open',           totalKey: 'totalOpen',           icon: <Inbox className="h-4 w-4" /> },
  { id: 'unassigned',          label: 'Unassigned',           ariaAction: 'unassigned',           totalKey: 'unassigned',          icon: <UserPlus className="h-4 w-4" />, tone: 'muted' },
  { id: 'verificationPending', label: 'Verification pending', ariaAction: 'verification pending', totalKey: 'verificationPending', icon: <Clock className="h-4 w-4" /> },
  { id: 'provisionallyHeld',   label: 'Provisionally held',   ariaAction: 'provisionally held',   totalKey: 'provisionallyHeld',   icon: <Lock className="h-4 w-4" />, tone: 'warn' },
  { id: 'conflicts',           label: 'Conflicts',            ariaAction: 'conflicts',            totalKey: 'conflicts',           icon: <AlertTriangle className="h-4 w-4" />, tone: 'warn' },
  { id: 'impactReview',        label: 'Impact review',        ariaAction: 'impact review',        totalKey: 'impactReview',        icon: <ClipboardCheck className="h-4 w-4" /> },
  { id: 'approvalPending',     label: 'Approval pending',     ariaAction: 'approval pending',     totalKey: 'approvalPending',     icon: <ClipboardCheck className="h-4 w-4" /> },
  { id: 'followOn',            label: 'Follow-on',            ariaAction: 'follow-on processing', totalKey: 'followOnProcessing',  icon: <ClipboardCheck className="h-4 w-4" /> },
  { id: 'overdue',             label: 'Overdue',              ariaAction: 'overdue',              totalKey: 'overdue',             icon: <AlertTriangle className="h-4 w-4" />, tone: 'warn' },
  { id: 'closedThisMonth',     label: 'Closed this month',    ariaAction: 'closed this month',    totalKey: 'closedThisMonth',     icon: <ShieldCheck className="h-4 w-4" />, tone: 'success' },
];

const STATUS_FILTERS = [
  { value: 'all', label: 'All open' },
  ...Object.entries(MORTALITY_STATUS_LABELS).map(([value, label]) => ({ value, label })),
];

const SOURCE_FILTERS = [
  { value: 'all', label: 'All sources' },
  ...Object.entries(MORTALITY_SOURCE_LABELS).map(([value, label]) => ({ value, label })),
];


/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function StatCard({
  spec,
  value,
  active,
  onSelect,
  loading,
}: {
  spec: CardSpec;
  value: number;
  active: boolean;
  onSelect: (id: CardId) => void;
  loading?: boolean;
}) {
  const tone = spec.tone ?? 'default';
  const toneClass =
    tone === 'warn' ? 'text-amber-600'
      : tone === 'success' ? 'text-emerald-600'
      : tone === 'muted' ? 'text-muted-foreground'
      : 'text-foreground';
  return (
    <button
      type="button"
      role="button"
      aria-pressed={active}
      aria-label={`Filter worklist by ${spec.ariaAction}`}
      onClick={() => onSelect(spec.id)}
      disabled={loading}
      className={
        'text-left rounded-md border bg-card transition ' +
        'hover:border-primary/60 hover:shadow-sm ' +
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
        (active ? 'border-primary ring-1 ring-primary/40 bg-primary/5 ' : 'border-border ') +
        'disabled:opacity-60 disabled:cursor-not-allowed'
      }
      data-testid={`mort-card-${spec.id}`}
      data-active={active ? 'true' : 'false'}
    >
      <div className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {spec.label}
          </span>
          <span className={toneClass}>{spec.icon}</span>
        </div>
        <div className={`mt-2 text-2xl font-semibold tabular-nums ${toneClass}`}>
          {value}
        </div>
      </div>
    </button>
  );
}

function daysAgo(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (['CLOSED', 'COMPLETED', 'REVERSED', 'CANCELLED', 'DUPLICATE'].includes(status)) return 'secondary';
  if (['REJECTED', 'CONFLICT'].includes(status)) return 'destructive';
  return 'default';
}

function formatIsoDateShort(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

/* ------------------------------------------------------------------ */
/* Dashboard body                                                      */
/* ------------------------------------------------------------------ */

function DashboardContent({ ctx }: { ctx: BnModuleAccessContext }) {
  const { user } = useSupabaseAuth();
  const navigate = useNavigate();
  const currentUserId = user?.id ?? null;

  const [state, setState] = useState<DashState>(() => loadDashboardState(currentUserId));

  // Reload state when the authenticated identity changes; wipe stale
  // per-user entries so a specific-assignee UUID from a prior user
  // cannot leak into the next user's session on the same machine.
  const prevUserIdRef = useRef<string | null | undefined>(currentUserId);
  useEffect(() => {
    if (prevUserIdRef.current !== currentUserId) {
      prevUserIdRef.current = currentUserId;
      clearOtherUserStates(currentUserId);
      setState(loadDashboardState(currentUserId));
    }
  }, [currentUserId]);

  // One-time cleanup on mount (removes legacy v1 key and any other user's state).
  useEffect(() => { clearOtherUserStates(currentUserId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Persist on every change (idempotent; guarded by first-render ref).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    saveDashboardState(currentUserId, state);
  }, [state, currentUserId]);

  const {
    status, source, search, overdueOnly, assignee,
    reportedFrom, reportedTo, activeCard, page,
  } = state;

  const set = useCallback((patch: Partial<DashState>) => {
    setState((s) => reduceDashboardState(s, { type: 'PATCH', patch }));
  }, []);


  const dateRangeInvalid = !!(reportedFrom && reportedTo && reportedFrom > reportedTo);

  const assignableQuery = useMortalityAssignableUsers();
  const assignableUsers = assignableQuery.data?.data;
  const usersById = useMemo(() => {
    const m = new Map<string, { displayName: string; userCode: string | null }>();
    (assignableUsers ?? []).forEach((u) => m.set(u.userId, { displayName: u.displayName, userCode: u.userCode }));
    return m;
  }, [assignableUsers]);

  // Default: All open ⇒ openOnly=true. Explicit status removes it.
  // Closed-this-month card ⇒ closedThisMonthOnly=true (uses closed_at).
  const filters = useMemo<MortalityListFilters>(() => {
    const f: MortalityListFilters = {};
    if (activeCard === 'closedThisMonth') {
      f.closedThisMonthOnly = true;
    } else if (status === 'all') {
      f.openOnly = true;
    } else {
      f.status = status;
    }
    if (source !== 'all') f.source = source;
    if (search.trim()) f.search = search.trim();
    if (overdueOnly) f.overdueOnly = true;
    if (assignee.kind === 'unassigned') f.unassignedOnly = true;
    else if (assignee.kind === 'me' && currentUserId) f.assignedTo = currentUserId;
    else if (assignee.kind === 'user') f.assignedTo = assignee.userId;
    if (!dateRangeInvalid) {
      if (reportedFrom) f.reportedFrom = reportedFrom;
      if (reportedTo) f.reportedTo = reportedTo;
    }
    return f;
  }, [status, source, search, overdueOnly, assignee, currentUserId,
      reportedFrom, reportedTo, dateRangeInvalid, activeCard]);

  const dashboardQuery = useMortalityDashboard();
  const pageSize = 25;
  const listQuery = useMortalityEventList(filters, pageSize, page > 0 ? String(page * pageSize) : null);

  const totals = dashboardQuery.data?.data?.totals;

  const clearAll = () => setState((s) => reduceDashboardState(s, { type: 'CLEAR_ALL' }));

  const onCardSelect = (id: CardId) => setState((s) => reduceDashboardState(s, { type: 'CARD', id }));

  const activeChips: Array<{ key: string; label: string; onRemove: () => void }> = [];
  if (activeCard === 'closedThisMonth') {
    activeChips.push({ key: 'card', label: 'Closed this month', onRemove: () => set({ activeCard: null, status: 'all', page: 0 }) });
  } else if (status !== 'all') {
    activeChips.push({
      key: 'status',
      label: `Status: ${mortalityStatusLabel(status)}`,
      onRemove: () => set({ status: 'all', activeCard: null, page: 0 }),
    });
  }
  if (source !== 'all') {
    activeChips.push({
      key: 'source',
      label: `Source: ${mortalitySourceLabel(source)}`,
      onRemove: () => set({ source: 'all', page: 0 }),
    });
  }
  if (assignee.kind !== 'all') {
    let label = 'Assignment: Unassigned';
    if (assignee.kind === 'me') label = 'Assigned to: Me';
    else if (assignee.kind === 'user') {
      const u = usersById.get(assignee.userId);
      label = `Assigned to: ${u?.displayName ?? 'Assigned user'}`;
    }
    activeChips.push({ key: 'assignee', label, onRemove: () => set({ assignee: { kind: 'all' }, activeCard: null, page: 0 }) });
  }
  if (overdueOnly) activeChips.push({ key: 'overdue', label: 'Overdue', onRemove: () => set({ overdueOnly: false, activeCard: null, page: 0 }) });
  if (search.trim()) activeChips.push({ key: 'search', label: `Search: “${search.trim()}”`, onRemove: () => set({ search: '', page: 0 }) });
  if (!dateRangeInvalid && (reportedFrom || reportedTo)) {
    const from = reportedFrom ? formatIsoDateShort(reportedFrom) : '…';
    const to = reportedTo ? formatIsoDateShort(reportedTo) : '…';
    activeChips.push({
      key: 'reported',
      label: `Reported: ${from} – ${to}`,
      onRemove: () => set({ reportedFrom: '', reportedTo: '', page: 0 }),
    });
  }

  const hasNonDefaultFilters =
    activeChips.length > 0 || activeCard !== null || status !== 'all';

  const filtersAreDefault = !hasNonDefaultFilters;

  const rows = listQuery.data?.data ?? [];
  const totalCount = listQuery.data?.page?.totalCount ?? null;

  // BN-MORT-M3 — operational signals for the visible page only.
  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const indicatorQuery = useMortalityWorklistIndicators(visibleIds);
  const indicatorsById = useMemo(() => {
    const m = new Map<string, MortalityWorklistIndicator>();
    (indicatorQuery.data?.data ?? []).forEach((i) => m.set(i.eventId, i));
    return m;
  }, [indicatorQuery.data]);

  const correlationId = (listQuery.data as any)?.envelope?.correlationId
    ?? (listQuery.error as any)?.correlationId
    ?? null;

  // Preview-registration action (see §6)
  const canWrite = !!ctx.hasWrite && !!ctx.actionsEnabled;
  const registerLabel = canWrite ? 'Register death' : 'Preview registration';
  const registerIcon = canWrite
    ? <Plus className="mr-1.5 h-3.5 w-3.5" />
    : <Eye className="mr-1.5 h-3.5 w-3.5" />;
  const registerTip = canWrite
    ? 'Open the death registration wizard.'
    : 'Registration preview only. Saving and submission remain disabled during internal pilot.';

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <BnMortalityBreadcrumbs leaf={{ kind: 'dashboard' }} />

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold">Death &amp; Mortality Processing</h1>
            {!ctx.actionsEnabled && (
              <Badge variant="secondary" className="gap-1">
                <Lock className="h-3 w-3" /> Read-only pilot
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Register, verify and action pensioner / claimant death reports. Mutations
            unlock only when the internal-pilot certification completes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { dashboardQuery.refetch(); listQuery.refetch(); }}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant={canWrite ? 'default' : 'outline'}
                  onClick={() => navigate('/bn/mortality/new')}
                  data-testid="mort-register-action"
                  data-mode={canWrite ? 'create' : 'preview'}
                >
                  {registerIcon}
                  {registerLabel}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{registerTip}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Stat cards */}
      {dashboardQuery.isLoading ? (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-[88px]" />
          ))}
        </div>
      ) : dashboardQuery.isError ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Dashboard totals unavailable</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-2">
            <span>The worklist below remains usable.</span>
            <Button size="sm" variant="outline" onClick={() => dashboardQuery.refetch()}>Retry</Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
          {CARDS.map((spec) => (
            <StatCard
              key={spec.id}
              spec={spec}
              value={(totals as any)?.[spec.totalKey] ?? 0}
              active={activeCard === spec.id}
              onSelect={onCardSelect}
            />
          ))}
        </div>
      )}

      {/* Worklist */}
      <Card>
        <CardHeader className="pb-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Worklist</CardTitle>
          </div>
          {/* Primary filter row */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[240px] max-w-sm">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by deceased name or event reference"
                value={search}
                onChange={(e) => set({ search: e.target.value, page: 0 })}
                className="h-8 pl-7 text-xs"
                aria-label="Search events"
              />
            </div>
            <Select
              value={status}
              onValueChange={(v) => set({ status: v, activeCard: v === 'CLOSED' ? null : (v === 'all' ? null : activeCard), page: 0 })}
            >
              <SelectTrigger className="h-8 w-44 text-xs" aria-label="Status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={source} onValueChange={(v) => set({ source: v, page: 0 })}>
              <SelectTrigger className="h-8 w-44 text-xs" aria-label="Source">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_FILTERS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <BnMortalityAssigneeFilter
              value={assignee}
              onChange={(v) => set({ assignee: v, page: 0 })}
              users={assignableUsers}
              isLoading={assignableQuery.isLoading}
              isError={assignableQuery.isError}
              onRetry={() => assignableQuery.refetch()}
              currentUserId={currentUserId}
            />
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs">
                  <FilterIcon className="mr-1.5 h-3.5 w-3.5" />
                  Filters
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 space-y-3" align="end">
                <div className="space-y-1">
                  <Label className="text-xs">Reported from</Label>
                  <Input
                    type="date" value={reportedFrom}
                    max={reportedTo || undefined}
                    onChange={(e) => set({ reportedFrom: e.target.value, page: 0 })}
                    className="h-8 text-xs" aria-label="Reported from"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Reported to</Label>
                  <Input
                    type="date" value={reportedTo}
                    min={reportedFrom || undefined}
                    onChange={(e) => set({ reportedTo: e.target.value, page: 0 })}
                    className="h-8 text-xs" aria-label="Reported to"
                  />
                </div>
                {dateRangeInvalid && (
                  <p className="text-xs text-destructive" role="alert">
                    From date must be on or before To date.
                  </p>
                )}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <Label htmlFor="mort-overdue" className="text-xs">Overdue only</Label>
                  <Switch
                    id="mort-overdue"
                    checked={overdueOnly}
                    onCheckedChange={(v) => set({ overdueOnly: !!v, page: 0 })}
                  />
                </div>
                <div className="flex justify-end pt-2 border-t">
                  <Button variant="ghost" size="sm" onClick={clearAll} className="h-7 text-xs">
                    <RotateCcw className="mr-1 h-3 w-3" /> Clear all
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          {/* Active filter chips */}
          {activeChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" data-testid="mort-active-chips">
              {activeChips.map((c) => (
                <Badge key={c.key} variant="secondary" className="gap-1 pr-1 text-[11px] font-normal">
                  {c.label}
                  <button
                    type="button"
                    aria-label={`Remove filter ${c.label}`}
                    onClick={c.onRemove}
                    className="ml-1 rounded p-0.5 hover:bg-muted"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="h-6 px-2 text-[11px] text-muted-foreground"
              >
                Clear all
              </Button>
            </div>
          )}
        </CardHeader>

        <CardContent className="p-0">
          {listQuery.isLoading ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          ) : listQuery.isError ? (
            <div className="p-6">
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>The worklist could not be loaded.</AlertTitle>
                <AlertDescription className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span>Try again in a moment.</span>
                    <Button size="sm" variant="outline" onClick={() => listQuery.refetch()}>
                      Retry
                    </Button>
                  </div>
                  {correlationId && (
                    <div className="text-[11px] text-muted-foreground">
                      Correlation ID: <span className="font-mono">{correlationId}</span>
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              filtersAreDefault={filtersAreDefault}
              onClear={clearAll}
              hasWrite={ctx.hasWrite}
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Deceased</TableHead>
                    <TableHead>Death date</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Assigned</TableHead>
                    <TableHead>SLA due</TableHead>
                    <TableHead>Age</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead>Signals</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const overdue =
                      r.sla_due_at &&
                      new Date(r.sla_due_at).getTime() < Date.now() &&
                      !['CLOSED', 'CANCELLED', 'REVERSED', 'DUPLICATE'].includes(r.status);
                    const openEvent = () => navigate(`/bn/mortality/${r.id}`);
                    const onKey = (e: React.KeyboardEvent) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openEvent();
                      }
                    };
                    const stop = (e: React.MouseEvent) => e.stopPropagation();
                    return (
                      <TableRow
                        key={r.id}
                        role="link"
                        tabIndex={0}
                        aria-label={`Open event ${r.event_reference ?? 'record'}`}
                        onClick={openEvent}
                        onKeyDown={onKey}
                        className="cursor-pointer hover:bg-muted/50 focus:bg-muted/60 focus:outline-none"
                        data-testid={`mort-row-${r.id}`}
                      >
                        <TableCell className="font-mono text-xs">
                          {r.event_reference ?? (
                            <span className="italic text-muted-foreground">Reference unavailable</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[240px] truncate">
                          {r.deceased_full_name ?? '—'}
                        </TableCell>
                        <TableCell className="text-xs">{r.death_date ?? '—'}</TableCell>
                        <TableCell className="text-xs">{mortalitySourceLabel(r.source)}</TableCell>
                        <TableCell>
                          <Badge variant={statusBadgeVariant(r.status)} className="text-[10px]">
                            {mortalityStatusLabel(r.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.assigned_to ? (
                            (() => {
                              const u = usersById.get(r.assigned_to);
                              if (u) {
                                return (
                                  <div className="flex flex-col leading-tight">
                                    <span>{u.displayName}</span>
                                    {u.userCode && <span className="text-[10px] text-muted-foreground">{u.userCode}</span>}
                                  </div>
                                );
                              }
                              return <span className="text-muted-foreground">Assigned user</span>;
                            })()
                          ) : (
                            <span className="text-muted-foreground">Unassigned</span>
                          )}
                        </TableCell>
                        <TableCell className={overdue ? 'text-amber-600 text-xs' : 'text-xs'}>
                          {r.sla_due_at ? new Date(r.sla_due_at).toLocaleDateString() : '—'}
                        </TableCell>
                        <TableCell className="text-xs">{daysAgo(r.reported_at)}</TableCell>
                        <TableCell className="text-xs">{daysAgo(r.updated_at)}</TableCell>
                        <TableCell className="text-right" onClick={stop}>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => { e.stopPropagation(); openEvent(); }}
                          >
                            Open
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between border-t p-3 text-xs text-muted-foreground">
                <span>
                  Showing {rows.length}
                  {totalCount != null ? ` of ${totalCount}` : ''}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm" variant="outline"
                    disabled={page === 0}
                    onClick={() => set({ page: Math.max(0, page - 1) })}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    disabled={!!totalCount && (page + 1) * pageSize >= totalCount}
                    onClick={() => set({ page: page + 1 })}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyState({
  filtersAreDefault,
  onClear,
  hasWrite,
}: {
  filtersAreDefault: boolean;
  onClear: () => void;
  hasWrite: boolean;
}) {
  if (filtersAreDefault) {
    return (
      <div className="p-10 text-center text-sm text-muted-foreground" data-testid="mort-empty-system">
        <Inbox className="mx-auto mb-2 h-8 w-8 opacity-40" />
        <div>No mortality events have been recorded.</div>
        <div className="mt-3">
          <Button asChild size="sm" variant="outline">
            <Link to="/bn/mortality/new">
              <Eye className="mr-1.5 h-3.5 w-3.5" />
              {hasWrite ? 'Register death' : 'Preview registration'}
            </Link>
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="p-10 text-center text-sm text-muted-foreground" data-testid="mort-empty-filtered">
      <Inbox className="mx-auto mb-2 h-8 w-8 opacity-40" />
      <div>No events match the selected filters.</div>
      <div className="mt-3">
        <Button size="sm" variant="outline" onClick={onClear}>
          <RotateCcw className="mr-1 h-3 w-3" /> Clear filters
        </Button>
      </div>
    </div>
  );
}

export default function BnMortalityPage() {
  return (
    <BnModuleRouteGate moduleCode="bn_mortality" requiredAction="view">
      {(ctx) => (
        <BnMortalityAuthState
          frame={
            <div className="p-6 pb-0 max-w-[1400px] mx-auto">
              <BnMortalityBreadcrumbs leaf={{ kind: 'dashboard' }} />
            </div>
          }
        >
          <DashboardContent ctx={ctx} />
        </BnMortalityAuthState>
      )}
    </BnModuleRouteGate>
  );
}
