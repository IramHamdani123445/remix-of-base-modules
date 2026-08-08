/**
 * BN Uprating — Epic 3 certification suite.
 *
 * Certifies batch execution and failed-item retry: deterministic batching from
 * the approved package, a governed award target boundary, immutable per-item
 * execution results, no double-application, retry limited to transient
 * failures, maker-checker separation, idempotency, concurrency protection and
 * a complete operational surface.
 *
 * Governed behaviour lives in PL/pgSQL, so the delivered boundary SQL is
 * certified as source of truth alongside the typed contracts and surfaces.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  BN_UPRATING_CANONICAL_COMMANDS,
  getUpratingCanonicalCommandSpec,
} from '@/types/bn/uprating/upratingCanonicalCommands';
import {
  BN_UPRATING_EPIC1_CANONICAL_COMMANDS,
  BN_UPRATING_EPIC2_CANONICAL_COMMANDS,
  BN_UPRATING_EPIC3_CANONICAL_COMMANDS,
  BN_UPRATING_EXECUTION_STATUSES,
  BN_UPRATING_RETRYABLE_FAILURE_CODES,
  BN_UPRATING_RUN_BOUNDARY_RPC,
  BN_UPRATING_RUN_READ_SERVICES,
  formatMinor,
  isUpratingFailureRetryable,
  upratingExecutionProgressPercent,
} from '@/types/bn/uprating/upratingRun';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const migrationsDir = path.join(root, 'supabase/migrations');
const epic3Sql = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
  .filter((sql) => sql.includes('bn_uprating_execution_session'))
  .join('\n');

const runService = read('src/services/bn/uprating/upratingRunService.ts');
const workspace = read('src/components/bn/uprating/BnUpratingRunWorkspace.tsx');
const executionSection = read('src/components/bn/uprating/BnUpratingExecutionSection.tsx');
const executeDialog = read('src/components/bn/uprating/BnUpratingExecuteBatchDialog.tsx');
const retryDialog = read('src/components/bn/uprating/BnUpratingRetryFailedDialog.tsx');
const executionQueue = read('src/components/bn/uprating/BnUpratingExecutionQueue.tsx');
const page = read('src/pages/bn/uprating/BnUpratingPage.tsx');
const matrix = read('docs/bn/uprating/UPRATING_IMPLEMENTATION_MATRIX.md');

const epic3Surfaces = [
  runService,
  workspace,
  executionSection,
  executeDialog,
  retryDialog,
  executionQueue,
];

// ---------------------------------------------------------------------------

describe('Epic 3 — canonical catalogue certification', () => {
  it('keeps exactly 17 unique canonical BN_UPRATING commands', () => {
    expect(BN_UPRATING_CANONICAL_COMMANDS).toHaveLength(17);
    expect(new Set(BN_UPRATING_CANONICAL_COMMANDS.map((c) => c.command)).size).toBe(17);
  });

  it('reports 14 of 17 implemented after Epic 3 (5 + 4 + 3 + 2)', () => {
    expect(BN_UPRATING_CANONICAL_COMMANDS.filter((c) => c.implemented)).toHaveLength(14);
    expect(BN_UPRATING_EPIC1_CANONICAL_COMMANDS).toHaveLength(4);
    expect(BN_UPRATING_EPIC2_CANONICAL_COMMANDS).toHaveLength(3);
    expect(BN_UPRATING_EPIC3_CANONICAL_COMMANDS).toHaveLength(2);
  });

  it('marks both Epic 3 commands implemented', () => {
    for (const command of BN_UPRATING_EPIC3_CANONICAL_COMMANDS) {
      expect(getUpratingCanonicalCommandSpec(command).implemented).toBe(true);
    }
  });

  it('leaves the three Epic 4+ commands NOT_STARTED', () => {
    for (const command of [
      'BN_UPRATING_RECONCILE_RUN',
      'BN_UPRATING_ROLLBACK_ELIGIBLE',
      'BN_UPRATING_CLOSE_RUN',
    ] as const) {
      expect(getUpratingCanonicalCommandSpec(command).implemented).toBe(false);
    }
  });

  it('keeps execution on admin capability, maker-checker and transactional', () => {
    const exec = getUpratingCanonicalCommandSpec('BN_UPRATING_EXECUTE_BATCH');
    expect(exec.capability).toBe('bn_uprating:admin');
    expect(exec.requiresMakerChecker).toBe(true);
    expect(exec.transactional).toBe(true);

    const retry = getUpratingCanonicalCommandSpec('BN_UPRATING_RETRY_FAILED');
    expect(retry.capability).toBe('bn_uprating:admin');
    expect(retry.transactional).toBe(true);
  });

  it('routes execution through the single governed run boundary', () => {
    expect(BN_UPRATING_RUN_BOUNDARY_RPC).toBe('bn_uprating_run_command_v1');
    expect(epic3Sql).toContain('CREATE OR REPLACE FUNCTION public.bn_uprating_run_command_v1');
    expect(epic3Sql).toContain("p_command_name NOT IN ('BN_UPRATING_EXECUTE_BATCH','BN_UPRATING_RETRY_FAILED')");
  });
});

// ---------------------------------------------------------------------------

describe('Epic 3 — execution schema', () => {
  it('delivers the three execution tables', () => {
    for (const table of [
      'bn_uprating_execution_session',
      'bn_uprating_execution_batch',
      'bn_uprating_execution_item',
    ]) {
      expect(epic3Sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
      expect(epic3Sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(epic3Sql).toMatch(new RegExp(`GRANT[^;]*ON[^;]*public\\.${table}[^;]*service_role`));
    }
  });

  it('never grants browser roles direct access to execution tables', () => {
    expect(epic3Sql).not.toMatch(/GRANT[^;]*bn_uprating_execution_item[^;]*TO\s+anon/i);
    expect(epic3Sql).not.toMatch(/GRANT[^;]*bn_uprating_execution_item[^;]*TO\s+authenticated/i);
  });

  it('carries the approved figures on every execution item', () => {
    for (const column of [
      'approved_base_amount_minor',
      'approved_amount_minor',
      'approved_delta_minor',
      'expected_row_version',
      'attempt_no',
    ]) {
      expect(epic3Sql).toContain(column);
    }
  });

  it('governs batch size and retry attempts through reference configuration', () => {
    expect(epic3Sql).toContain("'EXECUTION_CONFIG','MAX_RETRY_ATTEMPTS'");
    expect(epic3Sql).toContain('_bn_uprating_execution_config');
  });
});

// ---------------------------------------------------------------------------

describe('Epic 3 — execute exactly what was approved', () => {
  it('builds the execution plan from the frozen simulation of the approved package', () => {
    expect(epic3Sql).toContain('FROM public.bn_uprating_simulation_item si');
    expect(epic3Sql).toContain("si.calculation_status = 'CALCULATED'");
    expect(epic3Sql).toContain("sn.eligibility_status = 'ELIGIBLE'");
    expect(epic3Sql).toContain("sn.exception_status IN ('NONE','RESOLVED')");
    expect(epic3Sql).toContain('si.delta_amount_minor <> 0');
  });

  it('never recalculates: the applied amount is the approved amount', () => {
    expect(epic3Sql).toContain("v_new_amount := (it.approved_amount_minor::numeric / 100);");
    expect(epic3Sql).toContain(
      "applied_amount_minor = CASE WHEN res->>'status' = 'APPLIED' THEN approved_amount_minor END",
    );
    expect(epic3Sql).not.toContain('_bn_uprating_calc_item(');
  });

  it('freezes the approval provenance on the execution session', () => {
    for (const column of ['package_id', 'approval_id', 'snapshot_id', 'simulation_id', 'input_fingerprint']) {
      expect(epic3Sql).toContain(column);
    }
  });

  it('batches deterministically by award reference and simulation item', () => {
    expect(epic3Sql).toContain('row_number() OVER (ORDER BY si.award_reference, si.simulation_item_id)');
    expect(epic3Sql).toContain('ORDER BY award_reference, simulation_item_id');
  });

  it('refuses to execute when the approved package contains no change', () => {
    expect(epic3Sql).toContain('E_NOTHING_TO_EXECUTE');
  });
});

// ---------------------------------------------------------------------------

describe('Epic 3 — governed award target boundary', () => {
  it('mutates the award only through _bn_uprating_apply_award', () => {
    expect(epic3Sql).toContain('CREATE OR REPLACE FUNCTION public._bn_uprating_apply_award');
    const awardUpdates = epic3Sql.match(/UPDATE public\.bn_award\b/g) ?? [];
    expect(awardUpdates).toHaveLength(1);
  });

  it('locks the award row and the execution item before applying', () => {
    expect(epic3Sql).toContain('FROM public.bn_uprating_execution_item WHERE execution_item_id = p_item_id FOR UPDATE');
    expect(epic3Sql).toContain('FROM public.bn_award WHERE id = it.award_id FOR UPDATE');
  });

  it('fails closed on drift instead of forcing the change', () => {
    for (const code of [
      'AWARD_NOT_FOUND',
      'STALE_ROW_VERSION',
      'AWARD_STATUS_CHANGED',
      'BASE_AMOUNT_MISMATCH',
      'AWARD_PAYMENT_HELD',
      'TRANSIENT_ERROR',
    ]) {
      expect(epic3Sql).toContain(`'failure_code','${code}'`);
    }
  });

  it('only uprates an award that is still payable', () => {
    expect(epic3Sql).toContain("upper(COALESCE(aw.status,'')) NOT IN ('ACTIVE','IN_PAYMENT','CURRENT')");
  });

  it('respects an active suspension as a retryable hold', () => {
    expect(epic3Sql).toContain('bn_award_suspension_event');
    expect(epic3Sql).toMatch(/AWARD_PAYMENT_HELD[\s\S]{0,220}'is_retryable',true/);
  });

  it('writes an auditable rate history row and closes the previous rate', () => {
    expect(epic3Sql).toContain('UPDATE public.bn_award_rate_history');
    expect(epic3Sql).toContain('INSERT INTO public.bn_award_rate_history');
    expect(epic3Sql).toContain("'UPRATING'");
    expect(epic3Sql).toContain('effective_to = p_target_effective_date - 1');
  });

  it('bumps the award row version so later drift is detectable', () => {
    expect(epic3Sql).toContain('row_version = COALESCE(row_version,1) + 1');
  });

  it('never writes a payment, entitlement or communication from this boundary', () => {
    expect(epic3Sql).not.toMatch(/INSERT INTO public\.bn_payment/i);
    expect(epic3Sql).not.toMatch(/INSERT INTO public\.bn_entitlement/i);
    expect(epic3Sql).not.toMatch(/INSERT INTO public\.communication_request/i);
    expect(epic3Sql).not.toMatch(/INSERT INTO public\.notification_queue/i);
  });
});

// ---------------------------------------------------------------------------

describe('Epic 3 — no double application', () => {
  it('skips an item whose approved change already applied in this session', () => {
    expect(epic3Sql).toContain("'status','SKIPPED'");
    expect(epic3Sql).toContain('This approved change was already applied.');
  });

  it('excludes already-applied simulation items from retry eligibility', () => {
    expect(epic3Sql).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.bn_uprating_execution_item x[\s\S]{0,260}status='APPLIED'/);
  });

  it('supersedes the previous attempt rather than mutating it', () => {
    expect(epic3Sql).toContain("SET status='SUPERSEDED'");
    expect(epic3Sql).toContain('e.attempt_no + 1');
  });

  it('only executes items still in PENDING', () => {
    expect(epic3Sql).toContain("WHERE batch_id = p_batch_id AND status = 'PENDING'");
  });
});

// ---------------------------------------------------------------------------

describe('Epic 3 — retry governance', () => {
  it('exposes exactly two retryable failure codes', () => {
    expect([...BN_UPRATING_RETRYABLE_FAILURE_CODES].sort()).toEqual([
      'AWARD_PAYMENT_HELD',
      'TRANSIENT_ERROR',
    ]);
    expect(isUpratingFailureRetryable('TRANSIENT_ERROR')).toBe(true);
    expect(isUpratingFailureRetryable('AWARD_PAYMENT_HELD')).toBe(true);
    expect(isUpratingFailureRetryable('BASE_AMOUNT_MISMATCH')).toBe(false);
    expect(isUpratingFailureRetryable('STALE_ROW_VERSION')).toBe(false);
    expect(isUpratingFailureRetryable(null)).toBe(false);
  });

  it('retries only failed, retryable items within the attempt limit', () => {
    expect(epic3Sql).toContain("l.status = 'FAILED' AND l.is_retryable");
    expect(epic3Sql).toContain('l.attempt_no < v_max_attempts');
  });

  it('refuses retry before execution, in the wrong state, or with pending batches', () => {
    expect(epic3Sql).toContain('E_NO_SESSION');
    expect(epic3Sql).toContain("r.status NOT IN ('EXECUTING','PARTIAL')");
    expect(epic3Sql).toContain('E_BATCHES_PENDING');
    expect(epic3Sql).toContain('E_NO_RETRYABLE_ITEMS');
  });

  it('records the retry as its own RETRY batch', () => {
    expect(epic3Sql).toContain("'RETRY', 'PENDING'");
  });
});

// ---------------------------------------------------------------------------

describe('Epic 3 — readiness, permission and concurrency', () => {
  it('requires the admin capability on the command boundary', () => {
    expect(epic3Sql).toContain("PERFORM public._bn_uprating_require(p_actor_user_id,'admin',true)");
    expect(epic3Sql).toContain("bn_uprating_check_actor_permission(p_actor,'admin',true)");
  });

  it('keeps the preparer and submitter out of execution', () => {
    expect(epic3Sql).toContain('E_MAKER_CHECKER');
    expect(epic3Sql).toContain('an independent officer must execute it');
  });

  it('blocks execution without an approved, non-stale package', () => {
    for (const code of ['E_NO_APPROVAL', 'E_APPROVAL_STALE', 'E_INVALID_STATE']) {
      expect(epic3Sql).toContain(code);
    }
  });

  it('blocks execution outside the approved schedule window', () => {
    for (const code of ['E_NO_SCHEDULE', 'E_NOT_DUE', 'E_WINDOW_CLOSED', 'E_NO_PENDING_BATCH']) {
      expect(epic3Sql).toContain(code);
    }
  });

  it('enforces optimistic concurrency and idempotency replay', () => {
    expect(epic3Sql).toContain('E_STALE_ROW_VERSION');
    expect(epic3Sql).toContain('E_IDEMPOTENCY_MISMATCH');
    expect(epic3Sql).toContain('bn_uprating_command_idempotency');
    expect(epic3Sql).toContain("jsonb_build_object('replayed', true)");
  });

  it('audits every execution command attempt', () => {
    expect(epic3Sql).toContain('INSERT INTO public.bn_uprating_command_audit');
    for (const event of ['EXECUTION_STARTED', 'BATCH_EXECUTED', 'RETRY_EXECUTED']) {
      expect(epic3Sql).toContain(`'${event}'`);
    }
  });
});

// ---------------------------------------------------------------------------

describe('Epic 3 — read surface', () => {
  it('registers the four Epic 3 read services', () => {
    for (const fn of [
      'bn_uprating_execution_readiness_v1',
      'bn_uprating_run_execution_v1',
      'bn_uprating_execution_items_v1',
      'bn_uprating_execution_queue_v1',
    ]) {
      expect(BN_UPRATING_RUN_READ_SERVICES).toContain(fn);
      expect(epic3Sql).toContain(`CREATE OR REPLACE FUNCTION public.${fn}`);
      expect(runService).toContain(fn);
    }
  });

  it('exposes execute and retry availability from bn_uprating_run_actions_v1', () => {
    expect(epic3Sql).toContain("'command','BN_UPRATING_RETRY_FAILED'");
    expect(epic3Sql).toContain('BN_UPRATING_EXECUTE_BATCH');
    expect(runService).toContain('fetchUpratingRunActions');
  });

  it('reads are permission-gated and return the standard envelope', () => {
    expect(epic3Sql).toContain("public._bn_uprating_require(p_actor_user_id,'read',false)");
    expect(epic3Sql).toContain("jsonb_build_object('status','OK','code',NULL,'message',NULL");
  });
});

// ---------------------------------------------------------------------------

describe('Epic 3 — typed contracts', () => {
  it('treats execution run statuses as preparation-locked', () => {
    expect([...BN_UPRATING_EXECUTION_STATUSES].sort()).toEqual([
      'COMPLETED',
      'EXECUTING',
      'FAILED',
      'PARTIAL',
    ]);
  });

  it('computes progress defensively', () => {
    expect(upratingExecutionProgressPercent(null)).toBe(0);
    expect(
      upratingExecutionProgressPercent({
        planned_item_count: 0,
        applied_item_count: 0,
        failed_item_count: 0,
        skipped_item_count: 0,
      } as never),
    ).toBe(0);
    expect(
      upratingExecutionProgressPercent({
        planned_item_count: 10,
        applied_item_count: 4,
        failed_item_count: 1,
        skipped_item_count: 0,
      } as never),
    ).toBe(50);
    expect(
      upratingExecutionProgressPercent({
        planned_item_count: 4,
        applied_item_count: 4,
        failed_item_count: 2,
        skipped_item_count: 0,
      } as never),
    ).toBe(100);
  });

  it('formats minor amounts consistently for the execution surfaces', () => {
    expect(formatMinor(123456)).toBe('XCD 1,234.56');
    expect(formatMinor(null)).toBe('XCD 0.00');
  });
});

// ---------------------------------------------------------------------------

describe('Epic 3 — operational surfaces', () => {
  it('delivers the execute and retry confirmation dialogs', () => {
    expect(executeDialog).toContain('BnUpratingExecuteBatchDialog');
    expect(retryDialog).toContain('BnUpratingRetryFailedDialog');
    expect(workspace).toContain('BnUpratingExecuteBatchDialog');
    expect(workspace).toContain('BnUpratingRetryFailedDialog');
  });

  it('opens the dialogs instead of firing the command straight from the section', () => {
    expect(workspace).toContain('onExecuteBatch={() => setExecuteOpen(true)}');
    expect(workspace).toContain('onRetryFailed={() => setRetryOpen(true)}');
  });

  it('shows the approved package figures before executing', () => {
    for (const token of [
      'planned_item_count',
      'planned_batch_count',
      'approved_delta_total_minor',
      'target_effective_date',
    ]) {
      expect(executeDialog).toContain(token);
    }
  });

  it('requires an explicit acknowledgement and backend availability to execute', () => {
    expect(executeDialog).toContain('acknowledged');
    expect(executeDialog).toContain('disabled={!canExecute || !acknowledged || isSaving}');
    expect(executeDialog).toContain('can_execute');
  });

  it('separates retryable from permanent failures in the retry dialog', () => {
    expect(retryDialog).toContain('retryable_failures');
    expect(retryDialog).toContain('permanent_failures');
    expect(retryDialog).toContain('need correction at source');
    expect(retryDialog).toContain('disabled={!canRetry || isSaving}');
  });

  it('delivers the operational execution queue on the module page', () => {
    expect(executionQueue).toContain('fetchUpratingExecutionQueue');
    expect(executionQueue).toContain('Execution queue');
    expect(page).toContain('BnUpratingExecutionQueue');
    expect(page).toContain('value="execution"');
  });

  it('never reports a failed queue load as an empty queue', () => {
    expect(executionQueue).toContain('This is not an empty queue');
  });

  it('sends every execution command through the governed service with an idempotency key', () => {
    expect(workspace).toContain("command: 'BN_UPRATING_EXECUTE_BATCH'");
    expect(workspace).toContain("command: 'BN_UPRATING_RETRY_FAILED'");
    const executeBlock = workspace.slice(workspace.indexOf('const executeBatch'));
    expect(executeBlock).toContain('idempotencyKey: newUpratingUuid()');
    expect(executeBlock).toContain('expectedRowVersion');
  });

  it('refreshes the execution queue after any command', () => {
    expect(workspace).toContain("queryKey: ['bn-uprating-execution-queue']");
  });

  it('keeps every surface free of direct table access', () => {
    for (const surface of epic3Surfaces) {
      expect(surface).not.toMatch(/supabase\s*\.\s*from\(/);
    }
  });
});

// ---------------------------------------------------------------------------

describe('Epic 3 — matrix reconciliation', () => {
  it('records Epic 3 as complete and 14 of 17 commands implemented', () => {
    expect(matrix).toContain('| Epic 3 | Batch execution and retry | **COMPLETE — CERTIFIED** |');
    expect(matrix).toContain('BN_UPRATING_EXECUTE_BATCH | admin | yes | IMPLEMENTED (Epic 3)');
    expect(matrix).toContain('BN_UPRATING_RETRY_FAILED | admin | no | IMPLEMENTED (Epic 3)');
    expect(matrix).toContain('14 implemented');
  });

  it('keeps Epic 4 and Epic 5 not started', () => {
    expect(matrix).toContain('| Epic 4 | Reconciliation and rollback | NOT_STARTED |');
    expect(matrix).toContain('| Epic 5 | Run closure | NOT_STARTED |');
  });
});
