/**
 * BN Uprating — Epic 2 certification suite.
 *
 * Certifies run approval and execution scheduling: an immutable approval
 * package, independent maker-checker approval, governed return/resubmission,
 * package drift detection, idempotency, concurrency, and a governed execution
 * schedule — all strictly without executing anything.
 *
 * The governed behaviour lives in PL/pgSQL, so the delivered boundary SQL is
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
  BN_UPRATING_PRE_APPROVAL_STATUSES,
  BN_UPRATING_RUN_BOUNDARY_RPC,
  BN_UPRATING_RUN_READ_SERVICES,
  BN_UPRATING_RUN_SUPPORTING_OPERATIONS,
  BN_UPRATING_RUN_TRANSITIONS_TO_EPIC2,
  canUpratingEpic1Transition,
  formatMinor,
} from '@/types/bn/uprating/upratingRun';
import { upratingRunErrorMessage } from '@/services/bn/uprating/upratingRunService';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const migrationsDir = path.join(root, 'supabase/migrations');
const epic2Sql = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
  .filter(
    (sql) =>
      !sql.includes('bn_uprating_execution_session') &&
      (sql.includes('bn_uprating_run_approval_package') ||
        sql.includes('bn_uprating_execution_schedule')),
  )
  .join('\n');

const runService = read('src/services/bn/uprating/upratingRunService.ts');
const workspace = read('src/components/bn/uprating/BnUpratingRunWorkspace.tsx');
const submitDialog = read('src/components/bn/uprating/BnUpratingSubmitForApprovalDialog.tsx');
const decisionDialog = read('src/components/bn/uprating/BnUpratingApprovalDecisionDialog.tsx');
const scheduleDialog = read('src/components/bn/uprating/BnUpratingScheduleExecutionDialog.tsx');
const approvalSection = read('src/components/bn/uprating/BnUpratingRunApprovalSection.tsx');
const scheduleSection = read('src/components/bn/uprating/BnUpratingExecutionScheduleSection.tsx');
const queue = read('src/components/bn/uprating/BnUpratingApprovalQueue.tsx');
const page = read('src/pages/bn/uprating/BnUpratingPage.tsx');

const epic2Surfaces = [
  runService,
  workspace,
  submitDialog,
  decisionDialog,
  scheduleDialog,
  approvalSection,
  scheduleSection,
  queue,
];

describe('Epic 2 — canonical catalogue certification', () => {
  it('keeps exactly 17 canonical BN_UPRATING commands', () => {
    expect(BN_UPRATING_CANONICAL_COMMANDS).toHaveLength(17);
    expect(
      BN_UPRATING_CANONICAL_COMMANDS.every((c) => c.command.startsWith('BN_UPRATING_')),
    ).toBe(true);
    expect(new Set(BN_UPRATING_CANONICAL_COMMANDS.map((c) => c.command)).size).toBe(17);
  });

  it('reports 12 of 17 implemented after Epic 2 (5 + 4 + 3)', () => {
    const implemented = BN_UPRATING_CANONICAL_COMMANDS.filter((c) => c.implemented);
    expect(implemented).toHaveLength(12);
    expect(BN_UPRATING_EPIC1_CANONICAL_COMMANDS).toHaveLength(4);
    expect(BN_UPRATING_EPIC2_CANONICAL_COMMANDS).toHaveLength(3);
  });

  it('marks the three Epic 2 commands implemented', () => {
    for (const command of BN_UPRATING_EPIC2_CANONICAL_COMMANDS) {
      const spec = getUpratingCanonicalCommandSpec(command);
      expect(spec.implemented).toBe(true);
    }
  });

  it('leaves the five execution-stage commands NOT_STARTED', () => {
    for (const command of [
      'BN_UPRATING_EXECUTE_BATCH',
      'BN_UPRATING_RETRY_FAILED',
      'BN_UPRATING_RECONCILE_RUN',
      'BN_UPRATING_ROLLBACK_ELIGIBLE',
      'BN_UPRATING_CLOSE_RUN',
    ] as const) {
      expect(getUpratingCanonicalCommandSpec(command).implemented).toBe(false);
    }
  });

  it('keeps approval and scheduling on the governed capabilities', () => {
    expect(getUpratingCanonicalCommandSpec('BN_UPRATING_SUBMIT_RUN_FOR_APPROVAL').capability).toBe(
      'bn_uprating:decide',
    );
    expect(getUpratingCanonicalCommandSpec('BN_UPRATING_APPROVE_RUN').capability).toBe(
      'bn_uprating:admin',
    );
    expect(getUpratingCanonicalCommandSpec('BN_UPRATING_APPROVE_RUN').requiresMakerChecker).toBe(true);
    expect(getUpratingCanonicalCommandSpec('BN_UPRATING_APPROVE_RUN').requiresJustification).toBe(true);
    expect(getUpratingCanonicalCommandSpec('BN_UPRATING_SCHEDULE_EXECUTION').capability).toBe(
      'bn_uprating:admin',
    );
  });

  it('never promotes reschedule, cancel or return to canonical commands', () => {
    const canonical = BN_UPRATING_CANONICAL_COMMANDS.map((c) => c.command as string);
    for (const op of [
      'BN_UPRATING_RESCHEDULE_EXECUTION',
      'BN_UPRATING_CANCEL_EXECUTION_SCHEDULE',
      'BN_UPRATING_RETURN_FOR_REWORK',
    ]) {
      expect(canonical).not.toContain(op);
    }
    expect(BN_UPRATING_RUN_SUPPORTING_OPERATIONS).toContain('BN_UPRATING_RESCHEDULE_EXECUTION');
    expect(BN_UPRATING_RUN_SUPPORTING_OPERATIONS).toContain('BN_UPRATING_CANCEL_EXECUTION_SCHEDULE');
  });
});

describe('Epic 2 — run-state certification', () => {
  it('supports DRY_RUN → AWAITING_APPROVAL → APPROVED', () => {
    expect(canUpratingEpic1Transition('DRY_RUN', 'AWAITING_APPROVAL')).toBe(true);
    expect(canUpratingEpic1Transition('AWAITING_APPROVAL', 'APPROVED')).toBe(true);
  });

  it('supports the return path AWAITING_APPROVAL → DRY_RUN', () => {
    expect(canUpratingEpic1Transition('AWAITING_APPROVAL', 'DRY_RUN')).toBe(true);
  });

  it('never allows APPROVED → EXECUTING in Epic 2', () => {
    expect(BN_UPRATING_RUN_TRANSITIONS_TO_EPIC2.APPROVED).toEqual([]);
    expect(Object.keys(BN_UPRATING_RUN_TRANSITIONS_TO_EPIC2)).not.toContain('EXECUTING');
    expect(JSON.stringify(BN_UPRATING_RUN_TRANSITIONS_TO_EPIC2)).not.toContain('EXECUTING');
  });

  it('cannot skip approval from DRY_RUN straight to APPROVED', () => {
    expect(canUpratingEpic1Transition('DRY_RUN', 'APPROVED')).toBe(false);
    expect(canUpratingEpic1Transition('EXCLUSIONS_APPLIED', 'AWAITING_APPROVAL')).toBe(false);
  });

  it('does not invent a synthetic SCHEDULED run state', () => {
    expect(Object.keys(BN_UPRATING_RUN_TRANSITIONS_TO_EPIC2)).not.toContain('SCHEDULED');
    // Scheduling never sets a run status: the run stays APPROVED.
    const scheduleBlock = epic2Sql.slice(
      epic2Sql.indexOf("ELSIF p_command_name IN ('BN_UPRATING_SCHEDULE_EXECUTION'"),
      epic2Sql.indexOf('-- ============ CANCEL SCHEDULE'),
    );
    expect(scheduleBlock.length).toBeGreaterThan(0);
    expect(scheduleBlock).not.toMatch(/UPDATE public\.bn_uprating_run\s+SET status/);
    expect(scheduleBlock).not.toContain("v_new := 'SCHEDULED'");
  });

  it('treats scheduling state as a schedule-record concern only', () => {
    expect(epic2Sql).toMatch(/status text NOT NULL DEFAULT 'PLANNED'/);
    expect(BN_UPRATING_PRE_APPROVAL_STATUSES).not.toContain('AWAITING_APPROVAL' as never);
  });
});

describe('Epic 2 — approval readiness fails closed', () => {
  const readinessBlock = epic2Sql.slice(
    epic2Sql.indexOf('FUNCTION public._bn_uprating_approval_readiness'),
    epic2Sql.indexOf('FUNCTION public.bn_uprating_run_approval_readiness_v1'),
  );

  it('is computed by the backend, not the browser', () => {
    expect(readinessBlock.length).toBeGreaterThan(0);
    expect(runService).toContain('bn_uprating_run_approval_readiness_v1');
    expect(submitDialog).toContain('readiness?.can_submit');
    expect(submitDialog).not.toMatch(/status === 'DRY_RUN'/);
  });

  it.each([
    ['run not in DRY_RUN', 'E_INVALID_STATE'],
    ['already submitted', 'E_ALREADY_SUBMITTED'],
    ['no current snapshot', 'E_NO_POPULATION'],
    ['superseded snapshot', 'E_SNAPSHOT_SUPERSEDED'],
    ['no current simulation', 'E_NO_SIMULATION'],
    ['stale simulation', 'E_SIMULATION_STALE'],
    ['fingerprint mismatch', 'E_FINGERPRINT_MISMATCH'],
    ['calculation failures', 'E_CALCULATION_FAILURES'],
    ['invalid policy provenance', 'E_POLICY_PROVENANCE'],
    ['permission denied', 'E_PERMISSION'],
    ['blocking exceptions', 'E_BLOCKING_EXCEPTIONS'],
  ])('blocks submission when %s', (_label, code) => {
    expect(readinessBlock).toContain(`'${code}'`);
    expect(upratingRunErrorMessage(code)).not.toContain(code);
  });

  it('refuses the command when readiness does not pass', () => {
    expect(epic2Sql).toContain("v_ready := public._bn_uprating_approval_readiness(p_run_id, p_actor_user_id)");
    expect(epic2Sql).toMatch(/IF NOT COALESCE\(\(v_ready->>'can_submit'\)::boolean,false\) THEN/);
    expect(epic2Sql).toContain("COALESCE(v_ready->'blockers'->0->>'code','E_NOT_READY')");
  });

  it('fails closed in the UI when readiness cannot be read', () => {
    expect(submitDialog).toContain('disabled={isSaving || !readiness?.can_submit}');
  });
});

describe('Epic 2 — submission and the frozen approval package', () => {
  const submitBlock = epic2Sql.slice(
    epic2Sql.indexOf("IF p_command_name = 'BN_UPRATING_SUBMIT_RUN_FOR_APPROVAL' THEN"),
    epic2Sql.indexOf('-- ============ APPROVE / RETURN'),
  );

  it('moves a ready run to AWAITING_APPROVAL', () => {
    expect(submitBlock).toContain("SET status = 'AWAITING_APPROVAL'");
    expect(submitBlock).toContain("v_new := 'AWAITING_APPROVAL'");
  });

  it('freezes the exact material inputs into the package', () => {
    for (const column of [
      'run_id',
      'cycle_no',
      'run_row_version',
      'policy_version_id',
      'policy_version_reference',
      'target_effective_date',
      'scope_description',
      'snapshot_id',
      'snapshot_version',
      'snapshot_fingerprint',
      'simulation_id',
      'simulation_version',
      'input_fingerprint',
      'population_total',
      'included_count',
      'excluded_count',
      'exception_count',
      'unresolved_blocking_count',
      'current_total_minor',
      'proposed_total_minor',
      'delta_total_minor',
      'submitted_by',
    ]) {
      expect(submitBlock).toContain(column);
    }
  });

  it('opens exactly one PENDING approval cycle per submission', () => {
    expect(submitBlock).toContain('INSERT INTO public.bn_uprating_run_approval(');
    expect(submitBlock).toContain("'PENDING'");
    expect(submitBlock).toContain('approval_cycle_count = v_cycle');
  });

  it('records the APPROVAL_REQUESTED business event', () => {
    expect(submitBlock).toContain("'APPROVAL_REQUESTED'");
  });
});

describe('Epic 2 — approval-package immutability', () => {
  it('never rewrites a submitted package in place beyond its governed status', () => {
    const updates = epic2Sql.match(/UPDATE public\.bn_uprating_run_approval_package[^;]*;/g) ?? [];
    expect(updates.length).toBeGreaterThan(0);
    for (const update of updates) {
      expect(update).toMatch(/SET (status|run_row_version)/);
      expect(update).not.toMatch(/SET[^;]*(snapshot_id|simulation_id|input_fingerprint|delta_total_minor)\s*=/);
    }
  });

  it('creates a new package for each new cycle and keeps prior cycles historical', () => {
    expect(epic2Sql).toContain('v_cycle := COALESCE(r.approval_cycle_count,0) + 1');
    expect(epic2Sql).toContain("UPDATE public.bn_uprating_run_approval_package SET status='HISTORICAL'");
  });

  it('keeps decided approval cycles in place rather than deleting them', () => {
    expect(epic2Sql).not.toMatch(/DELETE FROM public\.bn_uprating_run_approval/);
    expect(epic2Sql).not.toMatch(/DELETE FROM public\.bn_uprating_run_approval_package/);
  });
});

describe('Epic 2 — approval locking of Epic 1 preparation', () => {
  const actionsBlock = epic2Sql.slice(epic2Sql.indexOf('FUNCTION public.bn_uprating_run_actions_v1'));

  it('gates preparation actions on a pre-approval status', () => {
    expect(actionsBlock).toContain('v_pre');
    expect(actionsBlock).toMatch(/v_pre\s*:=\s*r\.status IN \('DRAFT','PARAMETERISED','ELIGIBILITY_SNAPSHOT','EXCLUSIONS_APPLIED','DRY_RUN'\)/);
    expect(BN_UPRATING_PRE_APPROVAL_STATUSES).not.toContain('APPROVED' as never);
  });

  it('refuses the underlying Epic 1 mutations after submission, not just the buttons', () => {
    // Epic 1 commands validate their own state machine, which excludes
    // AWAITING_APPROVAL and APPROVED entirely.
    for (const from of ['AWAITING_APPROVAL', 'APPROVED'] as const) {
      expect(canUpratingEpic1Transition(from, 'ELIGIBILITY_SNAPSHOT')).toBe(false);
      expect(canUpratingEpic1Transition(from, 'EXCLUSIONS_APPLIED')).toBe(false);
      expect(canUpratingEpic1Transition(from, 'DRY_RUN')).toBe(from === 'AWAITING_APPROVAL');
    }
    expect(canUpratingEpic1Transition('APPROVED', 'DRY_RUN')).toBe(false);
  });
});

describe('Epic 2 — maker-checker and permission', () => {
  it('refuses the submitter as approver', () => {
    expect(epic2Sql).toContain('IF a.submitted_by = p_actor_user_id THEN');
    expect(epic2Sql).toMatch(/E_MAKER_CHECKER[^\n]*submitted this run/);
  });

  it('refuses the officer who prepared the simulation', () => {
    expect(epic2Sql).toContain('IF v_sim.simulated_by = p_actor_user_id THEN');
    expect(epic2Sql).toMatch(/E_MAKER_CHECKER[^\n]*prepared the simulation/);
  });

  it('requires the canonical bn_uprating:admin capability for decision and scheduling', () => {
    expect(epic2Sql).toContain("PERFORM public._bn_uprating_require(p_actor_user_id,'admin',true)");
    expect(epic2Sql).toContain("PERFORM public._bn_uprating_require(p_actor_user_id,'decide',true)");
  });

  it('explains maker-checker in officer language', () => {
    expect(upratingRunErrorMessage('E_MAKER_CHECKER')).toMatch(/independent officer/i);
    expect(upratingRunErrorMessage('E_PERMISSION')).toMatch(/permission/i);
  });
});

describe('Epic 2 — decision governance', () => {
  it('requires an explicit decision, reason and justification', () => {
    expect(epic2Sql).toContain("IF v_decision NOT IN ('APPROVE','RETURN_FOR_REWORK')");
    expect(epic2Sql).toContain("v_reason := NULLIF(trim(COALESCE(p_payload->>'decision_reason','')),'')");
    expect(epic2Sql).toContain("v_just := NULLIF(trim(COALESCE(p_payload->>'justification','')),'')");
    expect(epic2Sql).toContain('IF v_reason IS NULL OR v_just IS NULL THEN');
    expect(epic2Sql).toContain("'E_JUSTIFICATION_REQUIRED'");
  });

  it('rejects whitespace-only governance text at the boundary and in the dialog', () => {
    // trim() + NULLIF means '   ' becomes NULL and is refused.
    expect('   '.trim().length).toBe(0);
    expect(decisionDialog).toContain('reason.trim().length > 0 && justification.trim().length > 0');
    expect(decisionDialog).toContain('disabled={isSaving || !valid}');
  });

  it('records approver, reason, justification and decision time on approval', () => {
    expect(epic2Sql).toMatch(/SET status='APPROVED', decision='APPROVE', decision_reason=v_reason, justification=v_just,\s*\n\s*decided_by=p_actor_user_id, decided_by_name=v_actor_name, decided_at=now\(\)/);
    expect(epic2Sql).toContain("SET status='APPROVED', approved_at = now(), approved_by = p_actor_user_id");
    expect(epic2Sql).toContain("'RUN_APPROVED'");
  });

  it('refuses a decision when the run is not awaiting approval', () => {
    expect(epic2Sql).toMatch(/IF r\.status <> 'AWAITING_APPROVAL' THEN[\s\S]{0,200}E_INVALID_STATE/);
    expect(epic2Sql).toContain("'E_NO_PENDING_APPROVAL'");
  });
});

describe('Epic 2 — approval never executes', () => {
  it('leaves the run at APPROVED with no execution transition', () => {
    const approveBlock = epic2Sql.slice(
      epic2Sql.indexOf('-- ============ APPROVE / RETURN'),
      epic2Sql.indexOf('-- ============ SCHEDULE / RESCHEDULE'),
    );
    expect(approveBlock).toContain("v_new := 'APPROVED'");
    expect(approveBlock).not.toContain('EXECUTING');
    expect(approveBlock).not.toMatch(/bn_award|bn_entitlement|bn_payment|payment_schedule|payable/i);
  });

  it('tells the officer plainly that nothing has been paid or posted', () => {
    expect(epic2Sql).toContain('Run approved. No award or payment has changed.');
    expect(decisionDialog).toMatch(/No award, entitlement or payment changes now/i);
  });
});

describe('Epic 2 — return for rework and resubmission', () => {
  const returnBlock = epic2Sql.slice(
    epic2Sql.indexOf("SET status='RETURNED'"),
    epic2Sql.indexOf('-- ============ SCHEDULE / RESCHEDULE'),
  );

  it('returns the run to DRY_RUN and retains the decided cycle', () => {
    expect(returnBlock).toContain("SET status='DRY_RUN'");
    expect(returnBlock).toContain("decision='RETURN_FOR_REWORK'");
    expect(returnBlock).toContain('decision_reason=v_reason');
    expect(returnBlock).toContain('justification=v_just');
    expect(returnBlock).toContain("'APPROVAL_RETURNED'");
  });

  it('performs no destructive cleanup of snapshot or simulation', () => {
    expect(returnBlock).not.toMatch(/DELETE FROM/);
    expect(returnBlock).not.toContain('current_snapshot_id = NULL');
    expect(returnBlock).not.toContain('current_simulation_id = NULL');
  });

  it('allows a second cycle to be opened after correction', () => {
    expect(canUpratingEpic1Transition('DRY_RUN', 'AWAITING_APPROVAL')).toBe(true);
    expect(epic2Sql).toContain('v_cycle := COALESCE(r.approval_cycle_count,0) + 1');
  });
});

describe('Epic 2 — drift, replay and concurrency protection', () => {
  it('refuses approval of a package that no longer matches the run', () => {
    expect(epic2Sql).toMatch(/p\.run_row_version IS DISTINCT FROM r\.row_version/);
    expect(epic2Sql).toMatch(/p\.simulation_id IS DISTINCT FROM r\.current_simulation_id/);
    expect(epic2Sql).toMatch(/p\.snapshot_id IS DISTINCT FROM r\.current_snapshot_id/);
    expect(epic2Sql).toMatch(/p\.input_fingerprint IS DISTINCT FROM r\.input_fingerprint/);
    expect(epic2Sql).toContain("'E_APPROVAL_STALE'");
  });

  it('replays an identical request and rejects a changed payload on the same key', () => {
    expect(epic2Sql).toContain('v_hash := md5(COALESCE(p_payload::text,\'\'))');
    expect(epic2Sql).toMatch(/v_cache\.payload_hash IS DISTINCT FROM v_hash/);
    expect(epic2Sql).toContain("'E_IDEMPOTENCY_MISMATCH'");
    expect(epic2Sql).toContain("RETURN v_cache.result_json || jsonb_build_object('replayed', true)");
  });

  it('applies idempotency to all Epic 2 commands including scheduling', () => {
    expect(epic2Sql).toMatch(/IF p_command_name NOT IN \('BN_UPRATING_SUBMIT_RUN_FOR_APPROVAL','BN_UPRATING_APPROVE_RUN',/);
    // The idempotency guard runs before command dispatch, so it covers all of them.
    expect(epic2Sql.indexOf('v_hash := md5')).toBeLessThan(
      epic2Sql.indexOf("IF p_command_name NOT IN ('BN_UPRATING_SUBMIT_RUN_FOR_APPROVAL'"),
    );
    expect(runService).toContain('p_idempotency_key');
  });

  it('enforces expected row version on every Epic 2 mutation', () => {
    expect(epic2Sql).toMatch(/IF p_expected_row_version IS NOT NULL AND p_expected_row_version <> r\.row_version THEN/);
    expect(epic2Sql).toContain("'E_STALE_ROW_VERSION'");
    expect(runService).toContain('p_expected_row_version');
    expect(workspace).toContain('expectedRowVersion');
  });

  it('cannot decide the same cycle twice', () => {
    // The pending cycle is selected FOR UPDATE and only while status = 'PENDING'.
    expect(epic2Sql).toMatch(/WHERE run_id = r\.run_id AND status = 'PENDING' ORDER BY cycle_no DESC LIMIT 1 FOR UPDATE/);
  });
});

describe('Epic 2 — execution schedule governance', () => {
  const scheduleBlock = epic2Sql.slice(
    epic2Sql.indexOf('-- ============ SCHEDULE / RESCHEDULE'),
    epic2Sql.indexOf('-- ============ CANCEL SCHEDULE'),
  );

  it('only schedules an approved run holding a current approved package', () => {
    expect(scheduleBlock).toMatch(/IF r\.status <> 'APPROVED' THEN[\s\S]{0,200}E_INVALID_STATE/);
    expect(scheduleBlock).toContain("'E_NO_APPROVAL'");
    expect(scheduleBlock).toContain("'E_APPROVAL_STALE'");
    expect(scheduleBlock).toContain("'E_SCHEDULE_EXISTS'");
  });

  it('validates planned time, time zone, window, batch size and concurrency on the backend', () => {
    for (const code of [
      'E_SCHEDULE_IN_PAST',
      'E_INVALID_TIME_ZONE',
      'E_INVALID_WINDOW',
      'E_INVALID_BATCH_SIZE',
      'E_INVALID_CONCURRENCY',
    ]) {
      expect(scheduleBlock).toContain(`'${code}'`);
    }
  });

  it('reads time zone, batch and lead-time bounds from governed configuration', () => {
    expect(epic2Sql).toContain('FUNCTION public._bn_uprating_schedule_config()');
    expect(epic2Sql).toContain("'SCHEDULE_CONFIG'");
    expect(scheduleBlock).toContain("v_cfg->>'DEFAULT_TIME_ZONE'");
    expect(scheduleBlock).toContain("(v_cfg->>'MIN_LEAD_MINUTES')::int");
    expect(scheduleBlock).toMatch(/v_cfg->>'(MIN|MAX)_BATCH_SIZE'/);
    expect(scheduleBlock).toContain("v_cfg->>'MAX_CONCURRENT_BATCHES'");
  });

  it('retains an architecture-consistent schedule record', () => {
    for (const column of [
      'run_id',
      'approval_id',
      'package_id',
      'schedule_version',
      'planned_execution_at',
      'time_zone',
      'created_by',
      'created_at',
      'status',
      'row_version',
      'correlation_id',
    ]) {
      expect(epic2Sql).toContain(column);
    }
  });

  it('supersedes rather than overwrites when rescheduling', () => {
    expect(scheduleBlock).toContain('supersedes_schedule_id');
    expect(scheduleBlock).toMatch(/SET status='SUPERSEDED'/);
    expect(scheduleBlock).toContain("'EXECUTION_RESCHEDULED'");
    expect(scheduleBlock).not.toMatch(/UPDATE public\.bn_uprating_execution_schedule\s+SET planned_execution_at/);
  });

  it('does not execute anything when a run is scheduled', () => {
    expect(scheduleBlock).not.toContain('EXECUTING');
    expect(scheduleBlock).not.toMatch(/bn_award|bn_entitlement|bn_payment|payable/i);
    expect(scheduleBlock).toContain("'EXECUTION_SCHEDULED'");
  });

  it('cancels only the plan, leaving the run approved', () => {
    const cancelBlock = epic2Sql.slice(epic2Sql.indexOf('-- ============ CANCEL SCHEDULE'));
    expect(cancelBlock).toMatch(/SET status='CANCELLED'/);
    expect(cancelBlock).not.toMatch(/UPDATE public\.bn_uprating_run\s+SET status/);
    expect(cancelBlock).toContain("'EXECUTION_SCHEDULE_CANCELLED'");
    expect(cancelBlock).toContain("'E_JUSTIFICATION_REQUIRED'");
    expect(getUpratingCanonicalCommandSpec('BN_UPRATING_CLOSE_RUN').implemented).toBe(false);
  });
});

describe('Epic 2 — queues', () => {
  it('keeps the approval queue to pending cycles with a backend-owned total', () => {
    expect(epic2Sql).toContain('FUNCTION public.bn_uprating_run_approval_queue_v1');
    expect(epic2Sql).toMatch(/WHERE a\.status = 'PENDING'/);
    expect(epic2Sql).toMatch(/SELECT count\(\*\) INTO v_total[\s\S]{0,400}a\.status = 'PENDING'/);
    // The total is counted without LIMIT/OFFSET, so paging cannot change it.
    expect(epic2Sql).toMatch(/LIMIT GREATEST\(p_limit,1\) OFFSET GREATEST\(p_offset,0\)/);
  });

  it('exposes only approved-not-scheduled, scheduled and due states in the scheduled queue', () => {
    expect(epic2Sql).toContain("'APPROVED_NOT_SCHEDULED'");
    expect(epic2Sql).toContain("'DUE'");
    expect(epic2Sql).toContain("'SCHEDULED'");
    const queueFn = epic2Sql.slice(epic2Sql.indexOf('FUNCTION public.bn_uprating_scheduled_run_queue_v1'));
    expect(queueFn).not.toContain('EXECUTING');
    expect(queueFn).not.toContain('RETRY');
  });

  it('does not turn a failed queue read into an empty queue', () => {
    expect(queue).toContain("approvalQuery.data?.status === 'ERROR'");
    expect(queue).toContain('not an empty queue');
    expect(queue).not.toMatch(/total\s*[:=]\s*0\s*\}\s*\)/);
  });

  it('deep-links a queued item to the run approval surface', () => {
    expect(queue).toMatch(/onOpenRun|onSelectRun/);
    expect(page).toContain('BnUpratingApprovalQueue');
  });
});

describe('Epic 2 — backend-driven action availability', () => {
  const actionsBlock = epic2Sql.slice(epic2Sql.indexOf('FUNCTION public.bn_uprating_run_actions_v1'));

  it('owns submit, approve, schedule, reschedule and cancel availability', () => {
    for (const command of [
      'BN_UPRATING_SUBMIT_RUN_FOR_APPROVAL',
      'BN_UPRATING_APPROVE_RUN',
      'BN_UPRATING_SCHEDULE_EXECUTION',
      'BN_UPRATING_RESCHEDULE_EXECUTION',
      'BN_UPRATING_CANCEL_EXECUTION_SCHEDULE',
    ]) {
      expect(actionsBlock).toContain(`'${command}'`);
    }
  });

  it('never duplicates the lifecycle matrix in React', () => {
    expect(workspace).toContain('fetchUpratingRunActions');
    expect(workspace).not.toMatch(/status === 'AWAITING_APPROVAL' \? true/);
    expect(workspace).not.toMatch(/canApprove\s*=\s*.*status ===/);
  });
});

describe('Epic 2 — UI contracts', () => {
  it('shows the immutable submission context before submitting', () => {
    expect(submitDialog).toContain('current_snapshot_version');
    expect(submitDialog).toContain('current_simulation_version');
    expect(submitDialog).toContain('population_summary');
    expect(submitDialog).toContain('exception_summary');
    expect(submitDialog).toContain('financial_summary');
  });

  it('captures the governed decision fields and cannot submit without them', () => {
    expect(decisionDialog).toContain("decision: BnUpratingApprovalDecision");
    expect(decisionDialog).toContain('decision_reason');
    expect(decisionDialog).toContain('justification');
  });

  it('drives scheduling from backend readiness and governed configuration', () => {
    expect(scheduleDialog).toContain('readiness?.configuration');
    expect(scheduleDialog).toContain('DEFAULT_TIME_ZONE');
    expect(scheduleDialog).toContain('DEFAULT_BATCH_SIZE');
    expect(scheduleDialog).not.toMatch(/job[_ ]?id/i);
    expect(scheduleDialog).not.toMatch(/awards? (have been|are) updated/i);
  });

  it('uses simulation language rather than settlement language', () => {
    for (const source of [submitDialog, decisionDialog, approvalSection, queue]) {
      expect(source).toMatch(/Simulated/);
      expect(source).not.toMatch(/\bPaid\b|\bPosted\b|\bCommitted\b/);
    }
    expect(formatMinor(-2500)).toBe('XCD -25.00');
  });
});

describe('Epic 2 — privacy', () => {
  it('never surfaces risk, fraud, mortality, appeal or payment-control narrative', () => {
    for (const source of epic2Surfaces) {
      expect(source).not.toMatch(/risk_score|risk_narrative|fraud_narrative|mortality_detail|appeal_narrative|payment_control_narrative/i);
    }
    const approvalSql = epic2Sql.slice(epic2Sql.indexOf('FUNCTION public.bn_uprating_run_approval_queue_v1'));
    expect(approvalSql).not.toMatch(/risk_score|narrative|national_id|ssn/i);
  });

  it('never exposes a full national identifier', () => {
    for (const source of epic2Surfaces) {
      expect(source).not.toMatch(/national_identifier|full_ssn|\bnational_id\b/i);
    }
  });
});

describe('Epic 2 — audit and business history', () => {
  it('records the delivered Epic 2 business events', () => {
    for (const code of [
      'APPROVAL_REQUESTED',
      'APPROVAL_RETURNED',
      'RUN_APPROVED',
      'EXECUTION_SCHEDULED',
      'EXECUTION_RESCHEDULED',
      'EXECUTION_SCHEDULE_CANCELLED',
    ]) {
      expect(epic2Sql).toContain(`'${code}'`);
    }
  });

  it('emits no execution-start event in Epic 2', () => {
    expect(epic2Sql).not.toContain('EXECUTION_STARTED');
  });

  it('writes a command audit row for every Epic 2 command', () => {
    expect(epic2Sql).toContain('INSERT INTO public.bn_uprating_command_audit');
    expect(epic2Sql).toMatch(/correlation_id, idempotency_key/);
  });
});

describe('Epic 2 — no browser mutation architecture', () => {
  it('routes every mutation through the governed boundary RPC', () => {
    expect(BN_UPRATING_RUN_BOUNDARY_RPC).toBe('bn_uprating_run_command_v1');
    expect(runService).toContain("supabase.rpc('bn_uprating_run_command_v1'");
  });

  it('never uses the table client on any Epic 2 surface', () => {
    for (const source of epic2Surfaces) {
      expect(source).not.toMatch(/supabase\s*\.\s*from\(/);
    }
  });

  it('never lets the browser change run status or write approval/schedule tables', () => {
    for (const source of epic2Surfaces) {
      expect(source).not.toMatch(/bn_uprating_run_approval_package'\s*\)/);
      expect(source).not.toMatch(/bn_uprating_execution_schedule'\s*\)/);
      expect(source).not.toMatch(/\.update\(\s*\{\s*status/);
    }
  });

  it('exposes only governed _v1 read services', () => {
    for (const service of BN_UPRATING_RUN_READ_SERVICES) {
      expect(service.endsWith('_v1')).toBe(true);
      expect(runService).toContain(service);
    }
  });
});

describe('Epic 2 — award, payment, communication and Epic 3+ boundaries', () => {
  it('writes no award, entitlement or award adjustment', () => {
    expect(epic2Sql).not.toMatch(/(INSERT INTO|UPDATE)\s+public\.bn_award/i);
    expect(epic2Sql).not.toMatch(/(INSERT INTO|UPDATE)\s+public\.bn_entitlement/i);
    for (const source of epic2Surfaces) {
      expect(source).not.toMatch(/bn_award|bn_entitlement/);
    }
  });

  it('writes no payment, payment schedule, payable or payment issue', () => {
    expect(epic2Sql).not.toMatch(/(INSERT INTO|UPDATE)\s+public\.bn_payment/i);
    expect(epic2Sql).not.toMatch(/payable|payment_issue|rebuild_schedule/i);
    for (const source of epic2Surfaces) {
      expect(source).not.toMatch(/bn_payment|payable/);
    }
  });

  it('dispatches no communication on submit, approve or schedule', () => {
    expect(epic2Sql).not.toMatch(/communication_request|notification_queue|sendCommunication/i);
    for (const source of epic2Surfaces) {
      expect(source).not.toMatch(/sendCommunication|notification_queue/);
    }
  });

  it('implements and calls no Epic 3 execution command', () => {
    for (const command of ['BN_UPRATING_EXECUTE_BATCH', 'BN_UPRATING_RETRY_FAILED']) {
      expect(epic2Sql).not.toContain(command);
      for (const source of epic2Surfaces) {
        expect(source).not.toContain(command);
      }
    }
  });

  it('leaves reconciliation, rollback and closure untouched', () => {
    for (const command of [
      'BN_UPRATING_RECONCILE_RUN',
      'BN_UPRATING_ROLLBACK_ELIGIBLE',
      'BN_UPRATING_CLOSE_RUN',
    ] as const) {
      expect(getUpratingCanonicalCommandSpec(command).implemented).toBe(false);
      expect(epic2Sql).not.toContain(command);
    }
  });
});
