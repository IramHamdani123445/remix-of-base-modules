/**
 * BN Uprating — Run workspace (Epic 1).
 *
 * Governed run creation, parameterisation, immutable population snapshots,
 * exception resolution and deterministic simulation. Epic 1 is pre-execution:
 * nothing here changes an award, an entitlement, a payment or a communication.
 *
 * Every action shown comes from `bn_uprating_run_actions_v1`; the screen never
 * decides lifecycle availability locally and never mutates data directly.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Plus, ShieldAlert } from 'lucide-react';
import type { BnModuleAccessContext } from '@/components/bn/access/BnModuleRouteGate';
import {
  BnUpratingCreateRunDialog,
  type CreateRunFormValues,
  type UpratingPolicyVersionOption,
} from './BnUpratingCreateRunDialog';
import { BnUpratingResolveExceptionDialog } from './BnUpratingResolveExceptionDialog';
import { BnUpratingRunApprovalSection } from './BnUpratingRunApprovalSection';
import { BnUpratingExecutionScheduleSection } from './BnUpratingExecutionScheduleSection';
import { BnUpratingExecutionSection } from './BnUpratingExecutionSection';
import { BnUpratingExecuteBatchDialog } from './BnUpratingExecuteBatchDialog';
import { BnUpratingRetryFailedDialog } from './BnUpratingRetryFailedDialog';
import { BnUpratingReconciliationSection } from './BnUpratingReconciliationSection';
import { BnUpratingRollbackWorkbench } from './BnUpratingRollbackWorkbench';
import { BnUpratingReconcileDialog } from './BnUpratingReconcileDialog';
import { BnUpratingRollbackDialog } from './BnUpratingRollbackDialog';
import { BnUpratingClosureSection } from './BnUpratingClosureSection';
import { BnUpratingCloseRunDialog } from './BnUpratingCloseRunDialog';
import { BnUpratingMarkFailedDialog } from './BnUpratingMarkFailedDialog';
import { BnUpratingSubmitForApprovalDialog } from './BnUpratingSubmitForApprovalDialog';
import { BnUpratingApprovalDecisionDialog } from './BnUpratingApprovalDecisionDialog';
import {
  BnUpratingScheduleExecutionDialog,
  type ScheduleExecutionFormValues,
} from './BnUpratingScheduleExecutionDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  executeUpratingRunCommand,
  fetchUpratingExecutionItems,
  fetchUpratingExecutionReadiness,
  fetchUpratingRunActions,
  fetchUpratingRunExecution,
  fetchUpratingRunApproval,
  fetchUpratingRunDetail,
  fetchUpratingRunExceptions,
  fetchUpratingRunList,
  fetchUpratingRunPopulation,
  fetchUpratingScheduleReadiness,
  fetchUpratingSimulationResult,
  fetchUpratingPostExecutionReadiness,
  fetchUpratingReconciliation,
  fetchUpratingRollbackReadiness,
  fetchUpratingCloseReadiness,
} from '@/services/bn/uprating/upratingRunService';
import { fetchUpratingPolicyList } from '@/services/bn/uprating/upratingPolicyService';
import { newUpratingUuid } from '@/services/bn/uprating/upratingPolicyService';
import {
  formatMinor,
  type BnUpratingApprovalDecision,
  type BnUpratingExceptionRow,
  type BnUpratingRunAction,
  type BnUpratingRunCommandName,
} from '@/types/bn/uprating/upratingRun';


const runStatusVariant = (status: string): 'default' | 'secondary' | 'outline' | 'destructive' => {
  if (status === 'DRY_RUN') return 'default';
  if (status === 'EXCLUSIONS_APPLIED') return 'destructive';
  if (status === 'ELIGIBILITY_SNAPSHOT' || status === 'PARAMETERISED') return 'secondary';
  return 'outline';
};

export interface BnUpratingRunWorkspaceProps {
  readonly ctx: BnModuleAccessContext;
  /** Deep link from the operational queues — run to open on mount. */
  readonly initialRunId?: string | null;
  /** Deep link target tab inside the run workspace. */
  readonly initialTab?: string | null;
}

export const BnUpratingRunWorkspace: React.FC<BnUpratingRunWorkspaceProps> = ({
  ctx,
  initialRunId = null,
  initialTab = null,
}) => {
  const qc = useQueryClient();
  const [selectedRunId, setSelectedRunId] = React.useState<string | null>(initialRunId);
  const [activeTab, setActiveTab] = React.useState<string>(initialTab ?? 'population');

  React.useEffect(() => {
    if (initialRunId) setSelectedRunId(initialRunId);
    if (initialTab) setActiveTab(initialTab);
  }, [initialRunId, initialTab]);
  const [search, setSearch] = React.useState('');
  const [createOpen, setCreateOpen] = React.useState(false);
  const [resolveTarget, setResolveTarget] = React.useState<BnUpratingExceptionRow | null>(null);
  const [submitOpen, setSubmitOpen] = React.useState(false);
  const [decisionOpen, setDecisionOpen] = React.useState(false);
  const [scheduleMode, setScheduleMode] = React.useState<'SCHEDULE' | 'RESCHEDULE' | null>(null);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState('');
  const [onlyFailures, setOnlyFailures] = React.useState(false);
  const [executeOpen, setExecuteOpen] = React.useState(false);
  const [retryOpen, setRetryOpen] = React.useState(false);
  const [reconcileOpen, setReconcileOpen] = React.useState(false);
  const [markFailedOpen, setMarkFailedOpen] = React.useState(false);
  const [rollbackOpen, setRollbackOpen] = React.useState(false);
  const [closeOpen, setCloseOpen] = React.useState(false);



  const listQuery = useQuery({
    queryKey: ['bn-uprating-runs', search],
    queryFn: () => fetchUpratingRunList(search ? { search } : {}),
  });

  const policyQuery = useQuery({
    queryKey: ['bn-uprating-policies', 'run-options'],
    queryFn: () => fetchUpratingPolicyList({}, 100, 0),
    enabled: createOpen,
  });

  const versionOptions: readonly UpratingPolicyVersionOption[] = React.useMemo(() => {
    const rows = (policyQuery.data?.data?.rows ?? []) as unknown as Record<string, unknown>[];
    return rows
      .map((row) => {
        const versionId =
          (row.active_version_id as string | undefined) ??
          (row.current_version_id as string | undefined) ??
          (row.policy_version_id as string | undefined) ??
          null;
        if (!versionId) return null;
        const reference =
          (row.active_version_reference as string | undefined) ??
          (row.version_reference as string | undefined) ??
          'Active version';
        return {
          policy_version_id: versionId,
          label: `${row.policy_code ?? ''} — ${row.policy_name ?? ''} (${reference})`,
          policy_type: (row.policy_type as string | undefined) ?? '',
          effective_from: (row.effective_from as string | undefined) ?? null,
          effective_to: (row.effective_to as string | undefined) ?? null,
        } satisfies UpratingPolicyVersionOption;
      })
      .filter((o): o is UpratingPolicyVersionOption => o !== null);
  }, [policyQuery.data]);

  const detailQuery = useQuery({
    queryKey: ['bn-uprating-run', selectedRunId],
    queryFn: () => fetchUpratingRunDetail(selectedRunId as string),
    enabled: !!selectedRunId,
  });
  const detail = detailQuery.data?.data ?? null;
  const run = detail?.run ?? null;

  const actionsQuery = useQuery({
    queryKey: ['bn-uprating-run-actions', selectedRunId, run?.row_version],
    queryFn: () => fetchUpratingRunActions(selectedRunId as string),
    enabled: !!selectedRunId,
  });
  const actions: readonly BnUpratingRunAction[] = actionsQuery.data?.data?.actions ?? [];
  const action = (command: BnUpratingRunCommandName) => actions.find((a) => a.command === command);

  const populationQuery = useQuery({
    queryKey: ['bn-uprating-run-population', selectedRunId, run?.current_snapshot_id],
    queryFn: () => fetchUpratingRunPopulation(selectedRunId as string),
    enabled: !!selectedRunId && !!run?.current_snapshot_id,
  });

  const exceptionsQuery = useQuery({
    queryKey: ['bn-uprating-run-exceptions', selectedRunId, run?.current_snapshot_id, run?.row_version],
    queryFn: () => fetchUpratingRunExceptions(selectedRunId as string),
    enabled: !!selectedRunId && !!run?.current_snapshot_id,
  });

  const simulationQuery = useQuery({
    queryKey: ['bn-uprating-simulation', selectedRunId, run?.current_simulation_id],
    queryFn: () => fetchUpratingSimulationResult(selectedRunId as string),
    enabled: !!selectedRunId && !!run?.current_simulation_id,
  });

  const approvalQuery = useQuery({
    queryKey: ['bn-uprating-run-approval', selectedRunId, run?.row_version],
    queryFn: () => fetchUpratingRunApproval(selectedRunId as string),
    enabled: !!selectedRunId,
  });
  const approvalView = approvalQuery.data?.data ?? null;

  const scheduleQuery = useQuery({
    queryKey: ['bn-uprating-run-schedule', selectedRunId, run?.row_version],
    queryFn: () => fetchUpratingScheduleReadiness(selectedRunId as string),
    enabled: !!selectedRunId,
  });
  const scheduleReadiness = scheduleQuery.data?.data ?? null;

  const executionReadinessQuery = useQuery({
    queryKey: ['bn-uprating-execution-readiness', selectedRunId, run?.row_version],
    queryFn: () => fetchUpratingExecutionReadiness(selectedRunId as string),
    enabled: !!selectedRunId,
  });

  const executionQuery = useQuery({
    queryKey: ['bn-uprating-execution', selectedRunId, run?.row_version],
    queryFn: () => fetchUpratingRunExecution(selectedRunId as string),
    enabled: !!selectedRunId,
  });

  const executionItemsQuery = useQuery({
    queryKey: ['bn-uprating-execution-items', selectedRunId, run?.row_version, onlyFailures],
    queryFn: () =>
      fetchUpratingExecutionItems(
        selectedRunId as string,
        onlyFailures ? { status: 'FAILED' } : {},
      ),
    enabled: !!selectedRunId && !!executionQuery.data?.data?.has_session,
  });

  const postExecutionQuery = useQuery({
    queryKey: ['bn-uprating-post-execution', selectedRunId, run?.row_version],
    queryFn: () => fetchUpratingPostExecutionReadiness(selectedRunId as string),
    enabled: !!selectedRunId,
  });

  const reconciliationQuery = useQuery({
    queryKey: ['bn-uprating-reconciliation', selectedRunId, run?.row_version],
    queryFn: () => fetchUpratingReconciliation(selectedRunId as string),
    enabled: !!selectedRunId,
  });

  const rollbackQuery = useQuery({
    queryKey: ['bn-uprating-rollback', selectedRunId, run?.row_version],
    queryFn: () => fetchUpratingRollbackReadiness(selectedRunId as string),
    enabled: !!selectedRunId,
  });

  // Epic 5 — closure readiness is decided by the backend only.
  const closeQuery = useQuery({
    queryKey: ['bn-uprating-close-readiness', selectedRunId, run?.row_version],
    queryFn: () => fetchUpratingCloseReadiness(selectedRunId as string),
    enabled: !!selectedRunId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bn-uprating-runs'] });
    qc.invalidateQueries({ queryKey: ['bn-uprating-run'] });
    qc.invalidateQueries({ queryKey: ['bn-uprating-run-actions'] });
    qc.invalidateQueries({ queryKey: ['bn-uprating-run-population'] });
    qc.invalidateQueries({ queryKey: ['bn-uprating-run-exceptions'] });
    qc.invalidateQueries({ queryKey: ['bn-uprating-simulation'] });
    qc.invalidateQueries({ queryKey: ['bn-uprating-run-approval'] });
    qc.invalidateQueries({ queryKey: ['bn-uprating-close-readiness'] });
    qc.invalidateQueries({ queryKey: ['bn-uprating-run-schedule'] });
    qc.invalidateQueries({ queryKey: ['bn-uprating-approval-queue'] });
    qc.invalidateQueries({ queryKey: ['bn-uprating-scheduled-queue'] });
    qc.invalidateQueries({ queryKey: ['bn-uprating-execution-readiness'] });
    qc.invalidateQueries({ queryKey: ['bn-uprating-execution'] });
    qc.invalidateQueries({ queryKey: ['bn-uprating-execution-items'] });
    qc.invalidateQueries({ queryKey: ['bn-uprating-execution-queue'] });
    // Epic 4 — post-execution, reconciliation, rollback and operational queues
    qc.invalidateQueries({ queryKey: ['bn-uprating-post-execution'] });
    qc.invalidateQueries({ queryKey: ['bn-uprating-reconciliation'] });
    qc.invalidateQueries({ queryKey: ['bn-uprating-rollback'] });
    qc.invalidateQueries({ queryKey: ['bn-uprating-operational-queue'] });
  };


  const command = useMutation({
    mutationFn: executeUpratingRunCommand,
    onSuccess: (result) => {
      if (result.status === 'ERROR') {
        toast.error(result.message ?? 'The action could not be completed.');
        return;
      }
      toast.success(result.message ?? 'Action completed.');
      invalidate();
    },
    onError: () => toast.error('The action could not be completed.'),
  });

  const createRun = async (values: CreateRunFormValues) => {
    const result = await command.mutateAsync({
      command: 'BN_UPRATING_CREATE_RUN',
      payload: { ...values },
      idempotencyKey: newUpratingUuid(),
    });
    if (result.status !== 'ERROR') {
      setCreateOpen(false);
      setSelectedRunId((result.data?.run_id as string) ?? null);
    }
  };

  const runCommand = (name: BnUpratingRunCommandName) =>
    command.mutate({
      command: name,
      runId: selectedRunId,
      expectedRowVersion: run?.row_version ?? null,
      idempotencyKey: newUpratingUuid(),
    });

  const submitForApproval = async (values: { submission_note: string }) => {
    const result = await command.mutateAsync({
      command: 'BN_UPRATING_SUBMIT_RUN_FOR_APPROVAL',
      runId: selectedRunId,
      payload: values,
      expectedRowVersion: run?.row_version ?? null,
      idempotencyKey: newUpratingUuid(),
    });
    if (result.status !== 'ERROR') setSubmitOpen(false);
  };

  const recordDecision = async (values: {
    decision: BnUpratingApprovalDecision;
    decision_reason: string;
    justification: string;
  }) => {
    const result = await command.mutateAsync({
      command: 'BN_UPRATING_APPROVE_RUN',
      runId: selectedRunId,
      payload: values,
      expectedRowVersion: run?.row_version ?? null,
      idempotencyKey: newUpratingUuid(),
    });
    if (result.status !== 'ERROR') setDecisionOpen(false);
  };

  const submitSchedule = async (values: ScheduleExecutionFormValues) => {
    const result = await command.mutateAsync({
      command:
        scheduleMode === 'RESCHEDULE'
          ? 'BN_UPRATING_RESCHEDULE_EXECUTION'
          : 'BN_UPRATING_SCHEDULE_EXECUTION',
      runId: selectedRunId,
      payload: { ...values },
      expectedRowVersion: run?.row_version ?? null,
      idempotencyKey: newUpratingUuid(),
    });
    if (result.status !== 'ERROR') setScheduleMode(null);
  };

  const executeBatch = async () => {
    const result = await command.mutateAsync({
      command: 'BN_UPRATING_EXECUTE_BATCH',
      runId: selectedRunId,
      expectedRowVersion: run?.row_version ?? null,
      idempotencyKey: newUpratingUuid(),
    });
    if (result.status !== 'ERROR') setExecuteOpen(false);
  };

  const retryFailed = async () => {
    const result = await command.mutateAsync({
      command: 'BN_UPRATING_RETRY_FAILED',
      runId: selectedRunId,
      expectedRowVersion: run?.row_version ?? null,
      idempotencyKey: newUpratingUuid(),
    });
    if (result.status !== 'ERROR') setRetryOpen(false);
  };

  const rebuildSchedules = () =>
    command.mutate({
      command: 'BN_UPRATING_REBUILD_SCHEDULES',
      runId: selectedRunId,
      expectedRowVersion: run?.row_version ?? null,
      idempotencyKey: newUpratingUuid(),
    });

  const issueCommunications = () =>
    command.mutate({
      command: 'BN_UPRATING_ISSUE_COMMUNICATIONS',
      runId: selectedRunId,
      expectedRowVersion: run?.row_version ?? null,
      idempotencyKey: newUpratingUuid(),
    });

  const reconcileRun = async () => {
    const result = await command.mutateAsync({
      command: 'BN_UPRATING_RECONCILE_RUN',
      runId: selectedRunId,
      expectedRowVersion: run?.row_version ?? null,
      idempotencyKey: newUpratingUuid(),
    });
    if (result.status !== 'ERROR') setReconcileOpen(false);
  };

  const markRunFailed = async (values: { reason_code: string; justification: string }) => {
    const result = await command.mutateAsync({
      command: 'BN_UPRATING_MARK_FAILED',
      runId: selectedRunId,
      payload: values,
      expectedRowVersion: run?.row_version ?? null,
      idempotencyKey: newUpratingUuid(),
    });
    if (result.status !== 'ERROR') setMarkFailedOpen(false);
  };

  const assessRollback = () =>
    command.mutate({
      command: 'BN_UPRATING_ASSESS_ROLLBACK',
      runId: selectedRunId,
      expectedRowVersion: run?.row_version ?? null,
      idempotencyKey: newUpratingUuid(),
    });

  const authoriseRollback = async (values: { reason_code: string; justification: string }) => {
    const result = await command.mutateAsync({
      command: 'BN_UPRATING_ROLLBACK_ELIGIBLE',
      runId: selectedRunId,
      payload: values,
      expectedRowVersion: run?.row_version ?? null,
      idempotencyKey: newUpratingUuid(),
    });
    if (result.status !== 'ERROR') setRollbackOpen(false);
  };

  /** Canonical `BN_UPRATING_CLOSE_RUN` — lifecycle transition only. */
  const closeRun = async (justification: string | null) => {
    const result = await command.mutateAsync({
      command: 'BN_UPRATING_CLOSE_RUN',
      runId: selectedRunId,
      payload: { justification },
      expectedRowVersion: run?.row_version ?? null,
      idempotencyKey: newUpratingUuid(),
    });
    if (result.status !== 'ERROR') setCloseOpen(false);
  };

  const cancelSchedule = async () => {
    const result = await command.mutateAsync({
      command: 'BN_UPRATING_CANCEL_EXECUTION_SCHEDULE',
      runId: selectedRunId,
      payload: { cancelled_reason: cancelReason.trim() },
      expectedRowVersion: run?.row_version ?? null,
      idempotencyKey: newUpratingUuid(),
    });
    if (result.status !== 'ERROR') {
      setCancelOpen(false);
      setCancelReason('');
    }
  };



  const resolveException = async (values: { resolution_code: string; justification: string }) => {
    if (!resolveTarget) return;
    const result = await command.mutateAsync({
      command: 'BN_UPRATING_RESOLVE_EXCEPTION',
      runId: selectedRunId,
      exceptionId: resolveTarget.exception_id,
      payload: values,
      idempotencyKey: newUpratingUuid(),
    });
    if (result.status !== 'ERROR') setResolveTarget(null);
  };

  const ActionButton: React.FC<{ command: BnUpratingRunCommandName }> = ({ command: name }) => {
    const a = action(name);
    if (!a) return null;
    return (
      <Button
        size="sm"
        variant={name === 'BN_UPRATING_SIMULATE' ? 'default' : 'outline'}
        disabled={!a.available || command.isPending}
        title={a.reason ?? undefined}
        onClick={() => runCommand(name)}
      >
        {command.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {a.label}
      </Button>
    );
  };

  // -------------------- Register --------------------
  if (!selectedRunId) {
    const rows = listQuery.data?.data?.rows ?? [];
    return (
      <>
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Uprating runs</CardTitle>
              <CardDescription>
                Create, snapshot and simulate uprating runs. Runs are pre-execution only — no award or
                payment is changed at this stage.
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> New run
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by run reference or name"
              className="max-w-sm"
            />
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run</TableHead>
                    <TableHead>Policy</TableHead>
                    <TableHead>Effective</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Population</TableHead>
                    <TableHead className="text-right">Exceptions</TableHead>
                    <TableHead className="text-right">Projected change</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        No uprating runs yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {rows.map((r) => (
                    <TableRow
                      key={r.run_id}
                      className="cursor-pointer"
                      onClick={() => setSelectedRunId(r.run_id)}
                    >
                      <TableCell>
                        <div className="font-medium">{r.run_reference}</div>
                        <div className="text-xs text-muted-foreground">{r.run_name ?? '—'}</div>
                      </TableCell>
                      <TableCell>
                        <div>{r.policy_code}</div>
                        <div className="text-xs text-muted-foreground">{r.version_reference ?? '—'}</div>
                      </TableCell>
                      <TableCell>{r.target_effective_date}</TableCell>
                      <TableCell>
                        <Badge variant={runStatusVariant(r.status)}>{r.status_label ?? r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{r.eligible_items ?? 0}/{r.total_items ?? 0}</TableCell>
                      <TableCell className="text-right">{r.blocking_exception_items ?? 0}</TableCell>
                      <TableCell className="text-right">
                        {r.delta_total_minor == null ? '—' : formatMinor(r.delta_total_minor)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <BnUpratingCreateRunDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          versionOptions={versionOptions}
          isSaving={command.isPending}
          onSubmit={createRun}
        />
      </>
    );
  }

  // -------------------- Run detail --------------------
  const population = populationQuery.data?.data;
  const exceptions = exceptionsQuery.data?.data;
  const simulation = simulationQuery.data?.data;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => setSelectedRunId(null)}>
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to runs
      </Button>

      {detailQuery.isLoading && <p className="text-sm text-muted-foreground">Loading run…</p>}

      {run && (
        <>
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {run.run_reference}
                  <Badge variant={runStatusVariant(run.status)}>{run.status_label ?? run.status}</Badge>
                  {run.simulation_state === 'STALE' && <Badge variant="destructive">Simulation stale</Badge>}
                </CardTitle>
                <CardDescription>
                  {run.policy_code} · {run.version_reference} · effective {run.target_effective_date}
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <ActionButton command="BN_UPRATING_PARAMETERISE_RUN" />
                <ActionButton command="BN_UPRATING_BUILD_POPULATION" />
                <ActionButton command="BN_UPRATING_SIMULATE" />
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Method</p>
                <p className="font-medium">{run.frozen_policy_type ?? 'Not locked'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Rounding</p>
                <p className="font-medium">{run.frozen_rounding_mode ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Snapshot</p>
                <p className="font-medium">
                  {run.current_snapshot_version ? `v${run.current_snapshot_version}` : 'Not taken'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Simulation</p>
                <p className="font-medium">
                  {run.current_simulation_version ? `v${run.current_simulation_version}` : 'Not run'}
                </p>
              </div>
            </CardContent>
          </Card>

          {run.simulation_state === 'STALE' && (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Simulation is out of date</AlertTitle>
              <AlertDescription>
                The population or exception decisions changed after this simulation was produced. Run the
                simulation again before relying on these figures.
              </AlertDescription>
            </Alert>
          )}

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="population">Population</TabsTrigger>
              <TabsTrigger value="exceptions">
                Exceptions{exceptions?.open ? ` (${exceptions.open})` : ''}
              </TabsTrigger>
              <TabsTrigger value="simulation">Simulation</TabsTrigger>
              <TabsTrigger value="approval">Approval</TabsTrigger>
              <TabsTrigger value="execution">Execution</TabsTrigger>
              <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
              <TabsTrigger value="rollback">Rollback</TabsTrigger>
              <TabsTrigger value="closure">Closure</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>

            </TabsList>

            <TabsContent value="population" className="pt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Population snapshot</CardTitle>
                  <CardDescription>
                    {detail?.snapshot
                      ? `Snapshot v${detail.snapshot.snapshot_version} taken ${new Date(
                          detail.snapshot.taken_at,
                        ).toLocaleString()} — ${detail.snapshot.total_items} award(s), ${
                          detail.snapshot.eligible_items
                        } eligible, ${detail.snapshot.excluded_items} excluded. Snapshots are immutable;
                        rebuilding creates a new version.`
                      : 'No population snapshot has been taken for this run yet.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Award</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>Frequency</TableHead>
                        <TableHead className="text-right">Current amount</TableHead>
                        <TableHead>Eligibility</TableHead>
                        <TableHead>Exception</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(population?.rows ?? []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground">
                            No awards in the snapshot.
                          </TableCell>
                        </TableRow>
                      )}
                      {(population?.rows ?? []).map((row) => (
                        <TableRow key={row.snapshot_item_id}>
                          <TableCell className="font-medium">{row.award_reference}</TableCell>
                          <TableCell>{row.product_code ?? '—'}</TableCell>
                          <TableCell>{row.payment_frequency ?? '—'}</TableCell>
                          <TableCell className="text-right">
                            {formatMinor(row.base_amount_minor, row.currency_code ?? 'XCD')}
                          </TableCell>
                          <TableCell>
                            <Badge variant={row.eligibility_status === 'ELIGIBLE' ? 'secondary' : 'outline'}>
                              {row.eligibility_status}
                            </Badge>
                            {row.exclusion_reason_label && (
                              <div className="text-xs text-muted-foreground">{row.exclusion_reason_label}</div>
                            )}
                          </TableCell>
                          <TableCell>
                            {row.exception_status === 'NONE' ? (
                              '—'
                            ) : (
                              <Badge variant={row.exception_status === 'BLOCKING' ? 'destructive' : 'outline'}>
                                {row.exception_status}
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="exceptions" className="pt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Exceptions</CardTitle>
                  <CardDescription>
                    Every exception must be resolved with a permitted resolution and a justification before
                    the run can be simulated.
                  </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Award</TableHead>
                        <TableHead>Exception</TableHead>
                        <TableHead>Owner</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(exceptions?.rows ?? []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground">
                            No exceptions on the current snapshot.
                          </TableCell>
                        </TableRow>
                      )}
                      {(exceptions?.rows ?? []).map((row) => (
                        <TableRow key={row.exception_id}>
                          <TableCell className="font-medium">{row.award_reference}</TableCell>
                          <TableCell>
                            <div>{row.exception_label ?? row.exception_code}</div>
                            <div className="text-xs text-muted-foreground">{row.business_explanation}</div>
                          </TableCell>
                          <TableCell>{row.owning_domain}</TableCell>
                          <TableCell>
                            {row.resolution_status === 'RESOLVED' ? (
                              <Badge variant="secondary">{row.resolution_label ?? row.resolution_code}</Badge>
                            ) : (
                              <Badge variant={row.is_blocking ? 'destructive' : 'outline'}>
                                {row.is_blocking ? 'Blocking' : 'Warning'}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={row.resolution_status === 'RESOLVED'}
                              onClick={() => setResolveTarget(row)}
                            >
                              Resolve
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="simulation" className="pt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Simulation preview</CardTitle>
                  <CardDescription>
                    {simulation?.simulation
                      ? `Simulation v${simulation.simulation.simulation_version} — ${simulation.simulation.simulated_items} award(s), fingerprint ${simulation.simulation.input_fingerprint.slice(0, 12)}…`
                      : 'No simulation has been produced for this run yet.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {simulation?.simulation && (
                    <>
                      <div className="grid gap-4 sm:grid-cols-4">
                        <div>
                          <p className="text-xs text-muted-foreground">Current total</p>
                          <p className="font-medium">{formatMinor(simulation.simulation.current_total_minor)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Proposed total</p>
                          <p className="font-medium">{formatMinor(simulation.simulation.proposed_total_minor)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Difference</p>
                          <p className="font-medium">{formatMinor(simulation.simulation.delta_total_minor)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Increased / unchanged / reduced</p>
                          <p className="font-medium">
                            {simulation.simulation.increase_count} / {simulation.simulation.no_change_count} /{' '}
                            {simulation.simulation.decrease_count}
                          </p>
                        </div>
                      </div>
                      <Separator />
                    </>
                  )}
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Award</TableHead>
                          <TableHead>Method</TableHead>
                          <TableHead className="text-right">Current</TableHead>
                          <TableHead className="text-right">Proposed</TableHead>
                          <TableHead className="text-right">Difference</TableHead>
                          <TableHead>Result</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(simulation?.rows ?? []).length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-muted-foreground">
                              No simulated awards.
                            </TableCell>
                          </TableRow>
                        )}
                        {(simulation?.rows ?? []).map((row) => (
                          <TableRow key={row.simulation_item_id}>
                            <TableCell className="font-medium">{row.award_reference}</TableCell>
                            <TableCell>{row.policy_method}</TableCell>
                            <TableCell className="text-right">{formatMinor(row.base_amount_minor)}</TableCell>
                            <TableCell className="text-right">{formatMinor(row.proposed_amount_minor)}</TableCell>
                            <TableCell className="text-right">{formatMinor(row.delta_amount_minor)}</TableCell>
                            <TableCell>
                              <Badge variant={row.calculation_status === 'CALCULATED' ? 'secondary' : 'destructive'}>
                                {row.calculation_status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="timeline" className="pt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Run timeline</CardTitle>
                  <CardDescription>Every governed action taken on this run.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(detail?.events ?? []).length === 0 && (
                    <p className="text-sm text-muted-foreground">No events recorded yet.</p>
                  )}
                  {(detail?.events ?? []).map((e) => (
                    <div key={e.event_id} className="rounded-md border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{e.event_label}</span>
                        <Badge variant="outline">{e.event_code}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(e.occurred_at).toLocaleString()} · {e.actor_name ?? 'System'}
                        </span>
                      </div>
                      {e.detail && <p className="text-sm text-muted-foreground">{e.detail}</p>}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="approval" className="pt-4">
              <BnUpratingRunApprovalSection
                view={approvalView}
                isLoading={approvalQuery.isLoading}
                isError={approvalQuery.isError || approvalQuery.data?.status === 'ERROR'}
                onRetry={() => approvalQuery.refetch()}
                submitAction={action('BN_UPRATING_SUBMIT_RUN_FOR_APPROVAL')}
                decideAction={action('BN_UPRATING_APPROVE_RUN')}
                onSubmitForApproval={() => setSubmitOpen(true)}
                onRecordDecision={() => setDecisionOpen(true)}
              />
            </TabsContent>

            <TabsContent value="execution" className="pt-4 space-y-4">
              <BnUpratingExecutionScheduleSection
                readiness={scheduleReadiness}
                schedules={approvalView?.schedules ?? []}
                isLoading={scheduleQuery.isLoading}
                isError={scheduleQuery.isError || scheduleQuery.data?.status === 'ERROR'}
                onRetry={() => scheduleQuery.refetch()}
                scheduleAction={action('BN_UPRATING_SCHEDULE_EXECUTION')}
                rescheduleAction={action('BN_UPRATING_RESCHEDULE_EXECUTION')}
                cancelAction={action('BN_UPRATING_CANCEL_EXECUTION_SCHEDULE')}
                onSchedule={() => setScheduleMode('SCHEDULE')}
                onReschedule={() => setScheduleMode('RESCHEDULE')}
                onCancel={() => setCancelOpen(true)}
              />
              <BnUpratingExecutionSection
                readiness={executionReadinessQuery.data?.data ?? null}
                execution={executionQuery.data?.data ?? null}
                items={executionItemsQuery.data?.data?.rows ?? []}
                itemTotal={executionItemsQuery.data?.data?.total ?? 0}
                isLoading={executionReadinessQuery.isLoading}
                isError={
                  executionReadinessQuery.isError ||
                  executionReadinessQuery.data?.status === 'ERROR'
                }
                onRetryLoad={() => {
                  executionReadinessQuery.refetch();
                  executionQuery.refetch();
                  executionItemsQuery.refetch();
                }}
                executeAction={action('BN_UPRATING_EXECUTE_BATCH')}
                retryAction={action('BN_UPRATING_RETRY_FAILED')}
                onExecuteBatch={() => setExecuteOpen(true)}
                onRetryFailed={() => setRetryOpen(true)}
                failureFilter={onlyFailures}
                onFailureFilterChange={setOnlyFailures}
              />
            </TabsContent>

            <TabsContent value="reconciliation" className="pt-4">
              <BnUpratingReconciliationSection
                readiness={postExecutionQuery.data?.data ?? null}
                view={reconciliationQuery.data?.data ?? null}
                isLoading={postExecutionQuery.isLoading || reconciliationQuery.isLoading}
                isError={
                  postExecutionQuery.isError ||
                  postExecutionQuery.data?.status === 'ERROR' ||
                  reconciliationQuery.isError ||
                  reconciliationQuery.data?.status === 'ERROR'
                }
                isBusy={command.isPending}
                onRetryLoad={() => {
                  postExecutionQuery.refetch();
                  reconciliationQuery.refetch();
                }}
                onRebuildSchedules={rebuildSchedules}
                onIssueCommunications={issueCommunications}
                onReconcile={() => setReconcileOpen(true)}
                onMarkFailed={() => setMarkFailedOpen(true)}
              />
            </TabsContent>

            <TabsContent value="rollback" className="pt-4">
              <BnUpratingRollbackWorkbench
                readiness={rollbackQuery.data?.data ?? null}
                isLoading={rollbackQuery.isLoading}
                isError={rollbackQuery.isError || rollbackQuery.data?.status === 'ERROR'}
                isBusy={command.isPending}
                onRetryLoad={() => rollbackQuery.refetch()}
                onAssessRollback={assessRollback}
                onAuthoriseRollback={() => setRollbackOpen(true)}
              />
            </TabsContent>

            <TabsContent value="closure" className="pt-4">
              <BnUpratingClosureSection
                readiness={closeQuery.data?.data ?? null}
                isLoading={closeQuery.isLoading}
                isError={closeQuery.isError || closeQuery.data?.status === 'ERROR'}
                isBusy={command.isPending}
                onRetryLoad={() => closeQuery.refetch()}
                onCloseRun={() => setCloseOpen(true)}
              />
            </TabsContent>
          </Tabs>

        </>
      )}

      <BnUpratingResolveExceptionDialog
        open={!!resolveTarget}
        onOpenChange={(open) => !open && setResolveTarget(null)}
        exception={resolveTarget}
        isSaving={command.isPending}
        onSubmit={resolveException}
      />

      <BnUpratingSubmitForApprovalDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        readiness={approvalView?.approval_readiness ?? null}
        isSaving={command.isPending}
        onSubmit={submitForApproval}
      />

      <BnUpratingApprovalDecisionDialog
        open={decisionOpen}
        onOpenChange={setDecisionOpen}
        pkg={approvalView?.current_package ?? null}
        isSaving={command.isPending}
        onSubmit={recordDecision}
      />

      <BnUpratingExecuteBatchDialog
        open={executeOpen}
        onOpenChange={setExecuteOpen}
        readiness={executionReadinessQuery.data?.data ?? null}
        execution={executionQuery.data?.data ?? null}
        isSaving={command.isPending}
        onConfirm={executeBatch}
      />

      <BnUpratingRetryFailedDialog
        open={retryOpen}
        onOpenChange={setRetryOpen}
        readiness={executionReadinessQuery.data?.data ?? null}
        execution={executionQuery.data?.data ?? null}
        isSaving={command.isPending}
        onConfirm={retryFailed}
      />

      <BnUpratingScheduleExecutionDialog
        open={scheduleMode !== null}
        onOpenChange={(open) => !open && setScheduleMode(null)}
        readiness={scheduleReadiness}
        mode={scheduleMode ?? 'SCHEDULE'}
        isSaving={command.isPending}
        onSubmit={submitSchedule}
      />

      <BnUpratingReconcileDialog
        open={reconcileOpen}
        onOpenChange={setReconcileOpen}
        readiness={postExecutionQuery.data?.data ?? null}
        view={reconciliationQuery.data?.data ?? null}
        isSaving={command.isPending}
        onConfirm={reconcileRun}
      />

      <BnUpratingMarkFailedDialog
        open={markFailedOpen}
        onOpenChange={setMarkFailedOpen}
        readiness={postExecutionQuery.data?.data ?? null}
        isSaving={command.isPending}
        onConfirm={markRunFailed}
      />

      <BnUpratingRollbackDialog
        open={rollbackOpen}
        onOpenChange={setRollbackOpen}
        readiness={rollbackQuery.data?.data ?? null}
        isSaving={command.isPending}
        onConfirm={authoriseRollback}
      />

      <BnUpratingCloseRunDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        readiness={closeQuery.data?.data ?? null}
        isLoading={closeQuery.isLoading}
        isSaving={command.isPending}
        onConfirm={closeRun}
      />

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel execution schedule</DialogTitle>
            <DialogDescription>
              The schedule is retained in history with your reason. Nothing has executed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="uprating-cancel-reason">Reason</Label>
            <Textarea
              id="uprating-cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={command.isPending}>
              Keep schedule
            </Button>
            <Button
              onClick={cancelSchedule}
              disabled={command.isPending || cancelReason.trim().length === 0}
            >
              Cancel schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
};
