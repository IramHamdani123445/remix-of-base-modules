/**
 * BN Overpayment Recovery — governed worklist (Phase B11).
 *
 * ALL reads go through `overpaymentQueryService` (secured query RPCs) and ALL
 * mutations go through `overpaymentCommandService` (secured versioned command
 * RPCs). This screen performs NO direct Supabase table access.
 *
 * The module is registered as `internal_pilot` with actions disabled, so
 * command attempts are expected to fail with `E_ACTIONS_DISABLED`. The UI
 * surfaces that state honestly rather than pretending the action succeeded.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Search, TrendingDown, Banknote, Loader2, ShieldAlert, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { formatNumber } from '@/lib/culture/culture';
import { BnNextActionCard, BnRecordWorkspaceHeader } from '@/components/bn/ux';
import ReferToLegalButton from '@/components/legal/lg/ReferToLegalButton';
import {
  overpaymentQueryService,
  type BnOverpaymentWorklistRow,
  type BnOverpaymentAvailableAction,
} from '@/services/bn/overpayments/overpaymentQueryService';
import {
  overpaymentCommandService,
  overpaymentIdempotencyKey,
  BnOverpaymentCommandError,
} from '@/services/bn/overpayments/overpaymentCommandService';

const STATUS_STYLES: Record<string, string> = {
  CANDIDATE: 'bg-muted text-muted-foreground border-muted',
  CALCULATED: 'bg-amber-500/10 text-amber-700 border-amber-300',
  VERIFIED: 'bg-blue-500/10 text-blue-700 border-blue-300',
  NOTICE_ISSUED: 'bg-blue-500/10 text-blue-700 border-blue-300',
  REPRESENTATION: 'bg-amber-500/10 text-amber-700 border-amber-300',
  LIABILITY_CONFIRMED: 'bg-indigo-500/10 text-indigo-700 border-indigo-300',
  PLAN_PROPOSED: 'bg-indigo-500/10 text-indigo-700 border-indigo-300',
  PLAN_APPROVED: 'bg-emerald-500/10 text-emerald-700 border-emerald-300',
  IN_RECOVERY: 'bg-emerald-500/10 text-emerald-700 border-emerald-300',
  SUSPENDED: 'bg-destructive/10 text-destructive border-destructive/30',
  ON_APPEAL_HOLD: 'bg-destructive/10 text-destructive border-destructive/30',
  RECONCILED: 'bg-emerald-600/10 text-emerald-700 border-emerald-400',
  CLOSED: 'bg-muted text-muted-foreground border-muted',
  CANCELLED: 'bg-muted text-muted-foreground border-muted',
};

const humaniseLoadError = (raw: string): string => {
  const code = raw.split(':')[0]?.trim();
  switch (code) {
    case 'E_PERMISSION_DENIED':
      return 'You do not have permission to view the overpayment worklist. Ask an administrator for the Overpayment Recovery view permission.';
    case 'E_ACTIONS_DISABLED':
      return 'Overpayment Recovery is in internal pilot, so this data cannot be read in this environment yet.';
    case 'E_MODULE_DISABLED':
      return 'Overpayment Recovery is not activated in this environment.';
    default:
      return 'The overpayment worklist could not be loaded. Try refreshing; if it continues, contact support.';
  }
};

const STATUS_FILTERS = [
  'CANDIDATE', 'CALCULATED', 'VERIFIED', 'NOTICE_ISSUED', 'REPRESENTATION',
  'LIABILITY_CONFIRMED', 'PLAN_PROPOSED', 'PLAN_APPROVED', 'IN_RECOVERY',
  'SUSPENDED', 'ON_APPEAL_HOLD', 'RECONCILED', 'CLOSED',
];

const money = (n: number | null | undefined, currency = 'XCD') =>
  `${currency} ${formatNumber(n ?? 0, 2)}`;

const ERROR_HINTS: Record<string, string> = {
  E_ACTIONS_DISABLED: 'Overpayment actions are disabled for this environment (internal pilot). No change was made.',
  E_PERMISSION_DENIED: 'You do not hold the granular Overpayment permission required for this action.',
  E_STALE_ROW_VERSION: 'This case changed since it was loaded. Refresh and try again.',
  E_SELF_APPROVAL: 'Maker–checker: the same officer cannot approve their own submission.',
  E_INVALID_STATE: 'The case is not in a state that allows this action.',
  E_IDEMPOTENCY_PAYLOAD_MISMATCH: 'The same idempotency key was reused with different data.',
};

export const OVERPAYMENT_MODULE_BASE = '/bn/overpayments';

const OverpaymentRecovery: React.FC = () => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [rows, setRows] = useState<BnOverpaymentWorklistRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * The open case is its own screen (`/bn/overpayments/cases/<case_id>`) so
   * refresh, browser Back and shared links land the officer on the record.
   */
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const openCaseId = /\/cases\/([^/]+)/.exec(pathname)?.[1] ?? null;
  const [selected, setSelected] = useState<BnOverpaymentWorklistRow | null>(null);
  const [actions, setActions] = useState<BnOverpaymentAvailableAction[]>([]);
  const [planOpen, setPlanOpen] = useState(false);
  const [instalment, setInstalment] = useState('');
  const [planNotes, setPlanNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await overpaymentQueryService.worklist({
        status: statusFilter === 'all' ? null : statusFilter,
        search: search.trim() || null,
        limit: 100,
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setRows([]);
      setLoadError(e instanceof Error ? e.message : 'Failed to load overpayment worklist');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => ({
    outstanding: rows.reduce((s, r) => s + (r.outstanding_amount ?? 0), 0),
    recovered: rows.reduce((s, r) => s + (r.recovered_amount ?? 0), 0),
    inRecovery: rows.filter((r) => r.status === 'IN_RECOVERY').length,
    held: rows.filter((r) => r.status === 'ON_APPEAL_HOLD' || r.status === 'SUSPENDED').length,
  }), [rows]);

  const setOpenCaseId = useCallback(
    (caseId: string | null) => {
      navigate(
        caseId ? `${OVERPAYMENT_MODULE_BASE}/cases/${caseId}` : OVERPAYMENT_MODULE_BASE,
        { replace: !caseId },
      );
    },
    [navigate],
  );

  const openCase = useCallback(async (row: BnOverpaymentWorklistRow) => {
    setSelected(row);
    setCommandError(null);
    setActions([]);
    try {
      const list = await overpaymentQueryService.availableActions(row.case_id);
      setActions(Array.isArray(list) ? list : []);
    } catch {
      setActions([]);
    }
  }, []);

  /**
   * Restore the open case from the URL once the worklist is available. The
   * record is only ever rendered from server data, never from the URL alone.
   */
  useEffect(() => {
    if (!openCaseId) {
      setSelected(null);
      return;
    }
    if (selected?.case_id === openCaseId) return;
    const row = rows.find((r) => r.case_id === openCaseId);
    if (row) void openCase(row);
  }, [openCaseId, rows, selected?.case_id, openCase]);

  const can = (action: string) => actions.some((a) => a.action === action && a.allowed);

  const handleCommandError = (e: unknown) => {
    if (e instanceof BnOverpaymentCommandError) {
      const hint = ERROR_HINTS[e.code] ?? e.message;
      setCommandError(`${e.code}: ${hint}`);
      toast.error(hint);
      return;
    }
    const msg = e instanceof Error ? e.message : 'Command failed';
    setCommandError(msg);
    toast.error(msg);
  };

  const submitPlan = async () => {
    if (!selected) return;
    const amount = parseFloat(instalment);
    if (!Number.isFinite(amount) || amount <= 0) {
      setCommandError('E_AMOUNT_INVALID: enter a positive instalment amount.');
      return;
    }
    setSubmitting(true);
    setCommandError(null);
    try {
      await overpaymentCommandService.proposeRecoveryPlan({
        caseId: selected.case_id,
        rowVersion: selected.row_version,
        totalAmount: selected.outstanding_amount ?? 0,
        instalmentAmount: amount,
        currency: selected.currency,
        idempotencyKey: overpaymentIdempotencyKey(
          'BN_OVP_PROPOSE_RECOVERY_PLAN',
          selected.case_id,
          `${selected.row_version}:${amount}:${planNotes}`,
        ),
      });
      toast.success('Recovery plan proposed');
      setPlanOpen(false);
      setInstalment('');
      setPlanNotes('');
      await load();
    } catch (e) {
      handleCommandError(e);
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * The recovery-plan form remains a focused dialog, but it is now raised from
   * the page-level case workspace rather than from a nested modal.
   */
  const planDialog = (
    <Dialog open={planOpen} onOpenChange={setPlanOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Propose recovery plan</DialogTitle>
          <DialogDescription>
            Submitted through <code>bn_overpayment_propose_recovery_plan_v1</code> with an
            idempotency key and the current row version.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="op-instalment">Instalment amount</Label>
            <Input
              id="op-instalment"
              inputMode="decimal"
              value={instalment}
              onChange={(e) => setInstalment(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="op-notes">Notes</Label>
            <Textarea id="op-notes" value={planNotes} onChange={(e) => setPlanNotes(e.target.value)} />
          </div>
          {commandError && (
            <Alert variant="destructive"><AlertDescription className="text-xs">{commandError}</AlertDescription></Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPlanOpen(false)}>Cancel</Button>
          <Button onClick={() => void submitPlan()} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  /**
   * OPEN RECORD. A selected case is a page-level workspace with its own
   * refresh-survivable address (`?case=<case_id>`), not a modal. Available
   * actions come from the secured `available_actions` query only.
   */
  if (selected) {
    const nextActions = actions.map((a) => ({
      id: a.action,
      label: a.action.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
      available: a.allowed,
      reason: a.allowed ? undefined : (a as { reason?: string }).reason,
      onSelect:
        a.action === 'propose_recovery_plan'
          ? () => { setPlanOpen(true); setCommandError(null); }
          : undefined,
    }));

    return (
      <div className="space-y-6 p-6" data-testid="bn-overpayment-case-workspace">
        <BnRecordWorkspaceHeader
          backLabel="Overpayment worklist"
          onBack={() => { setOpenCaseId(null); setSelected(null); setCommandError(null); }}
          reference={selected.case_reference}
          context={selected.claimant_display ?? 'Claimant not identified'}
          status={selected.status.replace(/_/g, ' ')}
          facts={[
            { label: 'Gross', value: money(selected.gross_amount, selected.currency) },
            {
              label: 'Outstanding',
              value: money(selected.outstanding_amount, selected.currency),
              emphasis: true,
            },
            { label: 'Recovered', value: money(selected.recovered_amount, selected.currency) },
          ]}
          actions={
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="h-4 w-4 mr-2" />Refresh
            </Button>
          }
        />

        {commandError && (
          <Alert variant="destructive">
            <AlertDescription className="text-xs">{commandError}</AlertDescription>
          </Alert>
        )}

        <BnNextActionCard
          status="ready"
          actions={nextActions}
          emptyMessage="No overpayment operation is available for this case at this stage."
        />

        <Card>
          <CardContent className="p-4 space-y-2">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Banknote className="h-4 w-4" />Case detail
            </h2>
            <p className="text-sm text-muted-foreground">
              Available actions are resolved server side from case state and your granular
              permissions. This screen performs no direct table access.
            </p>
            <div className="grid gap-3 pt-2 text-sm sm:grid-cols-3">
              <div>
                <p className="text-muted-foreground text-xs">Status</p>
                <Badge variant="outline" className={STATUS_STYLES[selected.status] ?? ''}>
                  {selected.status.replace(/_/g, ' ')}
                </Badge>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Currency</p>
                <p>{selected.currency}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Record version</p>
                <p>{selected.row_version}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {planDialog}
      </div>
    );
  }

  return (

    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="t-page-title flex items-center gap-2">
            <TrendingDown className="h-6 w-6" />Overpayment Recovery
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Governed detection, liability, recovery and reconciliation of benefit overpayments
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="h-4 w-4 mr-2" />Refresh
          </Button>
          <ReferToLegalButton module="benefits" reasonCode="BENEFIT_OVERPAYMENT" matter="BENEFIT_OVERPAYMENT" />
        </div>
      </div>

      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Internal pilot — actions disabled</AlertTitle>
        <AlertDescription>
          Overpayment commands run through the secured server boundary. While the module is in
          internal pilot, command attempts are rejected with <code>E_ACTIONS_DISABLED</code> and no
          state changes are recorded.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Outstanding</p>
          <p className="text-2xl font-semibold">{loadError ? 'Unavailable' : money(totals.outstanding)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Recovered</p>
          <p className="text-2xl font-semibold">{loadError ? 'Unavailable' : money(totals.recovered)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">In recovery</p>
          <p className="text-2xl font-semibold">{loadError ? 'Unavailable' : totals.inRecovery}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Held / suspended</p>
          <p className="text-2xl font-semibold">{loadError ? 'Unavailable' : totals.held}</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search by case reference or claimant"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search overpayment cases"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="sm:w-56" aria-label="Filter by status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUS_FILTERS.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {loadError && (
            <Alert variant="destructive">
              <AlertTitle>Worklist unavailable</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>{humaniseLoadError(loadError)}</p>
                <p className="text-xs opacity-80">Technical detail: <code>{loadError}</code></p>
              </AlertDescription>
            </Alert>
          )}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Case</TableHead>
                  <TableHead>Claimant</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow><TableCell colSpan={6} className="text-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin inline" />
                  </TableCell></TableRow>
                )}
                {!loading && loadError && (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Unavailable — the worklist could not be read, so the number of cases is unknown.
                  </TableCell></TableRow>
                )}
                {!loading && !loadError && rows.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    {search.trim() || statusFilter !== 'all'
                      ? 'No overpayment cases match the current search or status filter.'
                      : 'No overpayment cases are currently open for recovery.'}
                  </TableCell></TableRow>
                )}
                {!loading && !loadError && rows.map((r) => (
                  <TableRow key={r.case_id}>
                    <TableCell className="font-mono text-xs">{r.case_reference}</TableCell>
                    <TableCell>{r.claimant_display ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_STYLES[r.status] ?? ''}>
                        {r.status.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{money(r.gross_amount, r.currency)}</TableCell>
                    <TableCell className="text-right">{money(r.outstanding_amount, r.currency)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setOpenCaseId(r.case_id)}>Open</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>

  );
};

export default OverpaymentRecovery;
