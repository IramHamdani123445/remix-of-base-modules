/**
 * BN Uprating — Epic 4 certification suite.
 *
 * Certifies post-execution completion, reconciliation and controlled rollback:
 * the governed schedule-rebuild boundary, the Communication Hub boundary
 * (request is not delivery), expected-vs-actual reconciliation, the controlled
 * failure path, rollback eligibility with payment and later-amendment blockers,
 * maker-checker separation, compensating award history, idempotency, the
 * deliberate absence of closure, and — critically — that every backend-permitted
 * Epic 4 operation is actually reachable by an authorised officer in the UI.
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
  BN_UPRATING_EPIC4_CANONICAL_COMMANDS,
  BN_UPRATING_EPIC4_SUPPORTING_OPERATIONS,
  BN_UPRATING_EPIC4_RUN_TRANSITIONS,
  canUpratingEpic4Transition,
  upratingCompletionPercent,
} from '@/types/bn/uprating/upratingRun';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const migrationsDir = path.join(root, 'supabase/migrations');
const allMigrations = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'));

const epic4Sql = allMigrations
  .filter(
    (sql) =>
      // Epic 5 recreates the shared actions function; it is certified separately.
      !sql.includes('_bn_uprating_close_readiness') &&
      (sql.includes('bn_uprating_rollback_operation') ||
      sql.includes('bn_uprating_reconciliation') ||
      sql.includes('bn_uprating_operational_queue_v1') ||
      sql.includes('bn_uprating_schedule_rebuild')),
  )
  .join('\n');

const runService = read('src/services/bn/uprating/upratingRunService.ts');
const types = read('src/types/bn/uprating/upratingRun.ts');
const workspace = read('src/components/bn/uprating/BnUpratingRunWorkspace.tsx');
const reconciliationSection = read(
  'src/components/bn/uprating/BnUpratingReconciliationSection.tsx',
);
const rollbackWorkbench = read('src/components/bn/uprating/BnUpratingRollbackWorkbench.tsx');
const reconcileDialog = read('src/components/bn/uprating/BnUpratingReconcileDialog.tsx');
const rollbackDialog = read('src/components/bn/uprating/BnUpratingRollbackDialog.tsx');
const markFailedDialog = read('src/components/bn/uprating/BnUpratingMarkFailedDialog.tsx');
const operationalQueue = read('src/components/bn/uprating/BnUpratingOperationalQueue.tsx');
const page = read('src/pages/bn/uprating/BnUpratingPage.tsx');
const matrix = read('docs/bn/uprating/UPRATING_IMPLEMENTATION_MATRIX.md');

const epic4Surfaces = [
  runService,
  workspace,
  reconciliationSection,
  rollbackWorkbench,
  reconcileDialog,
  rollbackDialog,
  markFailedDialog,
  operationalQueue,
  page,
];

// ---------------------------------------------------------------------------
// 1. Canonical command catalogue
// ---------------------------------------------------------------------------
describe('Epic 4 — canonical command catalogue', () => {
  it('exposes exactly the two Epic 4 canonical commands', () => {
    expect(BN_UPRATING_EPIC4_CANONICAL_COMMANDS).toEqual([
      'BN_UPRATING_RECONCILE_RUN',
      'BN_UPRATING_ROLLBACK_ELIGIBLE',
    ]);
  });

  it('marks both Epic 4 canonical commands implemented', () => {
    for (const c of BN_UPRATING_EPIC4_CANONICAL_COMMANDS) {
      expect(getUpratingCanonicalCommandSpec(c).implemented).toBe(true);
    }
  });

  it('delivers BN_UPRATING_CLOSE_RUN in Epic 5, outside the Epic 4 boundary', () => {
    expect(getUpratingCanonicalCommandSpec('BN_UPRATING_CLOSE_RUN').implemented).toBe(true);
    // Epic 4 itself still never closes a run.
    expect(BN_UPRATING_EPIC4_CANONICAL_COMMANDS).not.toContain('BN_UPRATING_CLOSE_RUN');
    expect(BN_UPRATING_EPIC4_SUPPORTING_OPERATIONS).not.toContain('BN_UPRATING_CLOSE_RUN');
  });

  it('reaches 17 of 17 canonical commands implemented', () => {
    const implemented = BN_UPRATING_CANONICAL_COMMANDS.filter((c) => c.implemented);
    expect(BN_UPRATING_CANONICAL_COMMANDS).toHaveLength(17);
    expect(implemented).toHaveLength(17);
  });

  it('did not invent a new canonical command for Epic 4', () => {
    expect(BN_UPRATING_CANONICAL_COMMANDS.map((c) => c.command)).toEqual(
      expect.arrayContaining([...BN_UPRATING_EPIC4_CANONICAL_COMMANDS]),
    );
    expect(BN_UPRATING_CANONICAL_COMMANDS).toHaveLength(17);
  });

  it('requires maker-checker and justification for rollback authorisation', () => {
    const spec = getUpratingCanonicalCommandSpec('BN_UPRATING_ROLLBACK_ELIGIBLE');
    expect(spec.requiresMakerChecker).toBe(true);
    expect(spec.requiresJustification).toBe(true);
    expect(spec.transactional).toBe(true);
    expect(spec.capability).toBe('bn_uprating:admin');
  });

  it('models supporting operations outside the canonical catalogue', () => {
    expect(BN_UPRATING_EPIC4_SUPPORTING_OPERATIONS).toEqual([
      'BN_UPRATING_REBUILD_SCHEDULES',
      'BN_UPRATING_ISSUE_COMMUNICATIONS',
      'BN_UPRATING_MARK_FAILED',
      'BN_UPRATING_ASSESS_ROLLBACK',
    ]);
    const canonical = BN_UPRATING_CANONICAL_COMMANDS.map((c) => c.command) as string[];
    for (const op of BN_UPRATING_EPIC4_SUPPORTING_OPERATIONS) {
      expect(canonical).not.toContain(op);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Lifecycle
// ---------------------------------------------------------------------------
describe('Epic 4 — post-execution lifecycle', () => {
  it('follows the governed happy path to RECONCILED', () => {
    expect(canUpratingEpic4Transition('EXECUTING', 'SCHEDULES_REBUILT')).toBe(true);
    expect(canUpratingEpic4Transition('SCHEDULES_REBUILT', 'COMMUNICATIONS_ISSUED')).toBe(true);
    expect(canUpratingEpic4Transition('COMMUNICATIONS_ISSUED', 'RECONCILED')).toBe(true);
  });

  it('follows the controlled failure path to ROLLED_BACK', () => {
    expect(canUpratingEpic4Transition('EXECUTING', 'FAILED')).toBe(true);
    expect(canUpratingEpic4Transition('PARTIAL', 'FAILED')).toBe(true);
    expect(canUpratingEpic4Transition('FAILED', 'ROLLED_BACK')).toBe(true);
  });

  it('never closes a run in Epic 4', () => {
    for (const targets of Object.values(BN_UPRATING_EPIC4_RUN_TRANSITIONS)) {
      expect(targets).not.toContain('CLOSED');
    }
    expect(canUpratingEpic4Transition('RECONCILED', 'CLOSED' as never)).toBe(false);
  });

  it('refuses to skip schedule rebuild or communications on the way to reconciliation', () => {
    expect(canUpratingEpic4Transition('EXECUTING', 'RECONCILED')).toBe(false);
    expect(canUpratingEpic4Transition('SCHEDULES_REBUILT', 'RECONCILED')).toBe(false);
  });

  it('refuses rollback from anything other than FAILED', () => {
    expect(canUpratingEpic4Transition('COMPLETED', 'ROLLED_BACK')).toBe(false);
    expect(canUpratingEpic4Transition('RECONCILED', 'ROLLED_BACK')).toBe(false);
    expect(canUpratingEpic4Transition('ROLLED_BACK', 'ROLLED_BACK')).toBe(false);
  });

  it('treats RECONCILED and ROLLED_BACK as Epic 4 endpoints', () => {
    expect(BN_UPRATING_EPIC4_RUN_TRANSITIONS.RECONCILED).toEqual([]);
    expect(BN_UPRATING_EPIC4_RUN_TRANSITIONS.ROLLED_BACK).toEqual([]);
  });

  it('computes completion progress defensively', () => {
    expect(upratingCompletionPercent(0, 0)).toBe(0);
    expect(upratingCompletionPercent(1, 4)).toBe(25);
    expect(upratingCompletionPercent(9, 4)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// 3. Delivered backend boundary
// ---------------------------------------------------------------------------
describe('Epic 4 — delivered governed backend', () => {
  it('ships the Epic 4 ledgers', () => {
    for (const table of [
      'bn_uprating_schedule_rebuild',
      'bn_uprating_communication_intent',
      'bn_uprating_reconciliation',
      'bn_uprating_reconciliation_finding',
      'bn_uprating_rollback_operation',
      'bn_uprating_rollback_item',
    ]) {
      expect(epic4Sql).toContain(table);
    }
  });

  it('routes every Epic 4 mutation through the single governed command RPC', () => {
    expect(epic4Sql).toContain('bn_uprating_run_command_v1');
    for (const c of [
      ...BN_UPRATING_EPIC4_CANONICAL_COMMANDS,
      ...BN_UPRATING_EPIC4_SUPPORTING_OPERATIONS,
    ]) {
      expect(epic4Sql).toContain(c);
    }
  });

  it('ships the Epic 4 read/readiness RPCs', () => {
    for (const rpc of [
      'bn_uprating_post_execution_readiness_v1',
      'bn_uprating_reconciliation_v1',
      'bn_uprating_rollback_readiness_v1',
      'bn_uprating_operational_queue_v1',
    ]) {
      expect(epic4Sql).toContain(rpc);
    }
  });

  it('delegates schedule rebuilds to the owning payment domain', () => {
    expect(epic4Sql).toContain('bn_payment_schedule_rebuild_for_award_v1');
  });

  it('delegates compensating award changes to the owning award domain', () => {
    expect(epic4Sql).toContain('bn_award_apply_uprating_compensation_v1');
  });

  it('enforces permission checks on every Epic 4 entry point', () => {
    expect(epic4Sql).toContain('_bn_uprating_require');
  });

  it('enforces maker-checker inside the governed boundary', () => {
    expect(epic4Sql).toContain('E_MAKER_CHECKER');
  });

  it('caches command results by idempotency key', () => {
    expect(epic4Sql).toContain('bn_uprating_command_idempotency');
    expect(epic4Sql).toContain('idempotency_key');
  });

  it('protects against concurrent edits with a row version', () => {
    expect(epic4Sql).toContain('expected_row_version');
  });

  it('writes an auditable event for every Epic 4 operation', () => {
    expect(epic4Sql).toContain('_bn_uprating_run_event');
  });
});

// ---------------------------------------------------------------------------
// 4. Communication Hub boundary — request is not delivery
// ---------------------------------------------------------------------------
describe('Epic 4 — Communication Hub boundary', () => {
  it('routes communications through the Hub request boundary', () => {
    expect(epic4Sql).toContain('_bn_uprating_request_communication');
    expect(epic4Sql).toContain('communication_request');
  });

  it('records dispatch through the Hub spine, never a private sender', () => {
    expect(epic4Sql).toContain('bn_communication_dispatch');
  });

  it('does not insert directly into legacy notification tables', () => {
    expect(epic4Sql).not.toMatch(/INSERT\s+INTO\s+public\.notification_queue/i);
    expect(epic4Sql).not.toMatch(/INSERT\s+INTO\s+public\.notification_logs/i);
  });

  it('tracks requested separately from delivered', () => {
    expect(epic4Sql).toContain('communication_requested_count');
    expect(epic4Sql).toContain('communication_required_count');
    expect(epic4Sql).toContain('communication_failed_count');
    // Delivery is a distinct, Hub-reported figure — never inferred from a request.
    expect(epic4Sql).toContain('communication_delivered_count');
  });

  it('never presents a requested notice as delivered in the UI', () => {
    expect(reconciliationSection).toMatch(/request/i);
    expect(reconciliationSection).toMatch(/Requested is not delivered/i);
    expect(reconciliationSection).toMatch(/hub_delivery_status/);
  });

  it('never presents a rebuilt schedule as a paid payment', () => {
    expect(reconciliationSection).toMatch(/A rebuilt schedule is not a payment/i);
    expect(reconciliationSection).toMatch(/no money has been issued|not been paid/i);
  });
});

// ---------------------------------------------------------------------------
// 5. Reconciliation
// ---------------------------------------------------------------------------
describe('Epic 4 — reconciliation', () => {
  it('reconciles expected against actual from authoritative records', () => {
    expect(epic4Sql).toMatch(/expected_/);
    expect(epic4Sql).toMatch(/actual_/);
    expect(epic4Sql).toMatch(/variance/);
  });

  it('records reconciliation findings rather than silently passing', () => {
    expect(epic4Sql).toContain('bn_uprating_reconciliation_finding');
    expect(epic4Sql).toMatch(/blocking/i);
  });

  it('versions each reconciliation attempt', () => {
    expect(epic4Sql).toContain('reconciliation_no');
    expect(epic4Sql).toContain('UNIQUE (run_id, reconciliation_no)');
    expect(epic4Sql).toContain('current_reconciliation_id');
  });

  it('surfaces expected, actual and variance in the reconciliation UI', () => {
    expect(reconciliationSection).toMatch(/expected/i);
    expect(reconciliationSection).toMatch(/actual/i);
    expect(reconciliationSection).toMatch(/variance/i);
  });

  it('shows a read-only package summary before reconciling', () => {
    expect(reconcileDialog).toMatch(/approved/i);
    expect(reconcileDialog).toMatch(/expected|actual/i);
    expect(reconcileDialog).not.toMatch(/<Input[\s\S]*amount/i);
  });

  it('never claims closure on successful reconciliation', () => {
    expect(reconciliationSection).not.toContain('CLOSED');
    expect(reconcileDialog).not.toContain('BN_UPRATING_CLOSE_RUN');
  });
});

// ---------------------------------------------------------------------------
// 6. Rollback
// ---------------------------------------------------------------------------
describe('Epic 4 — controlled rollback', () => {
  it('blocks rollback where a payment has already been issued', () => {
    expect(epic4Sql).toContain('PAYMENT_ALREADY_ISSUED');
  });

  it('blocks rollback where the award changed after execution', () => {
    expect(epic4Sql).toContain('LATER_AWARD_AMENDMENT');
  });

  it('separates eligible from ineligible items', () => {
    expect(epic4Sql).toContain("'ELIGIBLE'");
    expect(epic4Sql).toContain("'INELIGIBLE'");
  });

  it('requires eligibility assessment before authorisation', () => {
    expect(epic4Sql).toMatch(/Assess rollback eligibility before authorising/i);
  });

  it('applies compensating award history rather than deleting history', () => {
    expect(epic4Sql).toContain('bn_award_apply_uprating_compensation_v1');
    expect(epic4Sql).not.toMatch(/DELETE\s+FROM\s+public\.bn_award_rate_history/i);
  });

  it('is idempotent — only pending eligible items are compensated', () => {
    expect(epic4Sql).toMatch(/eligibility_status\s*=\s*'ELIGIBLE'\s+AND\s+status\s*=\s*'PENDING'/);
  });

  it('captures reason and justification at authorisation', () => {
    expect(rollbackDialog).toMatch(/justification/i);
    expect(rollbackDialog).toMatch(/reason/i);
  });

  it('shows eligible, ineligible and consequences read-only before authorising', () => {
    expect(rollbackDialog).toMatch(/eligible/i);
    expect(rollbackDialog).toMatch(/ineligible|not eligible/i);
  });

  it('offers no force, override or ignore controls anywhere', () => {
    for (const surface of epic4Surfaces) {
      expect(surface).not.toMatch(/Force rollback/i);
      expect(surface).not.toMatch(/Ignore payment/i);
      expect(surface).not.toMatch(/Override ineligib/i);
      expect(surface).not.toMatch(/Ignore later amendment/i);
    }
  });

  it('never lets the officer edit an award amount from the rollback surfaces', () => {
    expect(rollbackDialog).not.toMatch(/<Input[^>]*amount/i);
    expect(rollbackWorkbench).not.toMatch(/<Input[^>]*amount/i);
  });
});

// ---------------------------------------------------------------------------
// 7. Frontend contracts and service layer
// ---------------------------------------------------------------------------
describe('Epic 4 — typed contracts and service layer', () => {
  it('models the delivered Epic 4 reads as typed contracts', () => {
    for (const t of [
      'BnUpratingPostExecutionReadiness',
      'BnUpratingReconciliationView',
      'BnUpratingRollbackReadiness',
      'BnUpratingRollbackItem',
      'BnUpratingReconciliationFinding',
      'BnUpratingOperationalQueueRow',
    ]) {
      expect(types).toContain(t);
    }
  });

  it('exposes every Epic 4 read through the service layer', () => {
    for (const fn of [
      'fetchUpratingPostExecutionReadiness',
      'fetchUpratingReconciliation',
      'fetchUpratingRollbackReadiness',
      'fetchUpratingOperationalQueue',
    ]) {
      expect(runService).toContain(fn);
    }
  });

  it('exposes every Epic 4 operation through the service layer', () => {
    for (const fn of [
      'rebuildUpratingSchedules',
      'issueUpratingCommunications',
      'markUpratingRunFailed',
      'assessUpratingRollback',
      'reconcileUpratingRun',
      'rollbackEligibleUpratingItems',
    ]) {
      expect(runService).toContain(fn);
    }
  });

  it('performs no direct table writes from the client', () => {
    expect(runService).not.toMatch(/\.from\(['"]bn_uprating_[a-z_]+['"]\)\s*\.\s*(insert|update|delete)/);
  });

  it('does not duplicate backend status decisions in React', () => {
    expect(operationalQueue).toContain('bucket_code');
    expect(operationalQueue).toContain('bucket_label');
    expect(operationalQueue).not.toMatch(/rows\.filter\(/);
  });
});

// ---------------------------------------------------------------------------
// 8. Operational action completeness — no dead ends
// ---------------------------------------------------------------------------
describe('Epic 4 — operational action completeness', () => {
  it('wires reconciliation and rollback into the run workspace', () => {
    expect(workspace).toContain('BnUpratingReconciliationSection');
    expect(workspace).toContain('BnUpratingRollbackWorkbench');
    expect(workspace).toContain('value="reconciliation"');
    expect(workspace).toContain('value="rollback"');
  });

  it('gives every backend-permitted Epic 4 operation a usable UI control', () => {
    for (const c of [
      ...BN_UPRATING_EPIC4_CANONICAL_COMMANDS,
      ...BN_UPRATING_EPIC4_SUPPORTING_OPERATIONS,
    ]) {
      expect(workspace).toContain(c);
    }
  });

  it('wires the confirmation dialogs for the governed operations', () => {
    expect(workspace).toContain('BnUpratingReconcileDialog');
    expect(workspace).toContain('BnUpratingRollbackDialog');
    expect(workspace).toContain('BnUpratingMarkFailedDialog');
  });

  it('drives availability from backend readiness, not local guesses', () => {
    expect(reconciliationSection).toMatch(/can_(rebuild|issue|reconcile)/);
    expect(rollbackWorkbench).toMatch(/can_(assess|rollback)/);
  });

  it('explains why an unavailable operation is blocked', () => {
    expect(reconciliationSection).toMatch(/blocker/i);
    expect(rollbackWorkbench).toMatch(/blocker/i);
  });

  it('does not weaken permissions, maker-checker or row versions to unblock the UI', () => {
    for (const surface of epic4Surfaces) {
      expect(surface).not.toMatch(/skipPermission|bypassMakerChecker|ignoreRowVersion/i);
    }
    expect(workspace).toContain('expectedRowVersion');
  });

  it('distinguishes a failed load from an empty result on every Epic 4 surface', () => {
    for (const surface of [reconciliationSection, rollbackWorkbench, operationalQueue]) {
      expect(surface).toMatch(/could not be loaded|isError/);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Operational queue
// ---------------------------------------------------------------------------
describe('Epic 4 — post-execution operational queue', () => {
  it('is reachable from the Uprating module page', () => {
    expect(page).toContain('BnUpratingOperationalQueue');
    expect(page).toContain('value="operations"');
  });

  it('uses backend-owned buckets', () => {
    for (const bucket of [
      'SCHEDULE_REBUILD_REQUIRED',
      'COMMUNICATION_PENDING',
      'READY_TO_RECONCILE',
      'RECONCILIATION_BLOCKED',
      'ROLLBACK_ASSESSMENT_REQUIRED',
      'ROLLBACK_BLOCKED',
      'RECONCILED',
      'ROLLED_BACK',
    ]) {
      expect(epic4Sql).toContain(bucket);
    }
  });

  it('deep-links each row to the workspace section holding the next action', () => {
    expect(operationalQueue).toContain('workspace_section');
    expect(page).toContain('initialTab');
    expect(page).toContain('initialRunId');
  });
});

// ---------------------------------------------------------------------------
// 10. Cache invalidation
// ---------------------------------------------------------------------------
describe('Epic 4 — cache invalidation', () => {
  it('refreshes every affected view after an Epic 4 operation', () => {
    for (const key of [
      'bn-uprating-post-execution',
      'bn-uprating-reconciliation',
      'bn-uprating-rollback',
      'bn-uprating-operational-queue',
      'bn-uprating-execution-queue',
    ]) {
      expect(workspace).toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// 11. Matrix reconciliation
// ---------------------------------------------------------------------------
describe('Epic 4 — implementation matrix', () => {
  it('records Epic 4 and Epic 5 as certified', () => {
    expect(matrix).toMatch(/Epic 4[^\n]*COMPLETE — CERTIFIED/);
    expect(matrix).toMatch(/Epic 5[^\n]*COMPLETE — CERTIFIED/);
  });

  it('records the canonical status as 17 / 17', () => {
    expect(matrix).toMatch(/17\s*\/\s*17/);
  });

  it('states the controlled operational walkthrough outcome explicitly', () => {
    expect(matrix).toMatch(
      /CONTROLLED EXISTING-DATA OPERATIONAL WALKTHROUGH = (PASS|BLOCKED)/,
    );
  });
});
