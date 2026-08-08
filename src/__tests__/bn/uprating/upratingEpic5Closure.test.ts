/**
 * BN Uprating — Epic 5 certification suite (run closure and end-to-end
 * technical certification).
 *
 * Certifies that closure is a governed lifecycle transition only: it never
 * mutates an award, an entitlement, a payment schedule or a communication, it
 * never deletes evidence, it is unreachable from any state other than
 * RECONCILED or ROLLED_BACK, it fails closed when readiness cannot be read,
 * and it renders as a terminal state with no further action in the UI.
 *
 * Governed behaviour lives in PL/pgSQL, so the delivered boundary SQL is
 * certified as the source of truth alongside the typed contracts and surfaces.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  BN_UPRATING_CANONICAL_COMMANDS,
  getUpratingCanonicalCommandSpec,
} from '@/types/bn/uprating/upratingCanonicalCommands';
import {
  BN_UPRATING_CLOSABLE_STATUSES,
  BN_UPRATING_EPIC1_RUN_TRANSITIONS,
  BN_UPRATING_EPIC4_RUN_TRANSITIONS,
  BN_UPRATING_EPIC5_CANONICAL_COMMANDS,
  BN_UPRATING_EPIC5_RUN_TRANSITIONS,
  canUpratingEpic1Transition,
  canUpratingEpic4Transition,
  canUpratingEpic5Transition,
  isUpratingRunClosed,
} from '@/types/bn/uprating/upratingRun';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const migrationsDir = path.join(root, 'supabase/migrations');
const allMigrations = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'));

const epic5Sql = allMigrations
  .filter(
    (sql) =>
      sql.includes('_bn_uprating_close_readiness') ||
      sql.includes('bn_uprating_close_readiness_v1'),
  )
  .join('\n');

const runService = read('src/services/bn/uprating/upratingRunService.ts');
const types = read('src/types/bn/uprating/upratingRun.ts');
const workspace = read('src/components/bn/uprating/BnUpratingRunWorkspace.tsx');
const closureSection = read('src/components/bn/uprating/BnUpratingClosureSection.tsx');
const closeDialog = read('src/components/bn/uprating/BnUpratingCloseRunDialog.tsx');

// ---------------------------------------------------------------------------
// Command catalogue
// ---------------------------------------------------------------------------

describe('Uprating Epic 5 — canonical command catalogue', () => {
  it('implements BN_UPRATING_CLOSE_RUN', () => {
    expect(getUpratingCanonicalCommandSpec('BN_UPRATING_CLOSE_RUN').implemented).toBe(true);
  });

  it('reaches 17 of 17 canonical commands implemented', () => {
    expect(BN_UPRATING_CANONICAL_COMMANDS).toHaveLength(17);
    expect(BN_UPRATING_CANONICAL_COMMANDS.filter((c) => c.implemented)).toHaveLength(17);
  });

  it('keeps closure on the decide capability, non-transactional and unforced', () => {
    const spec = getUpratingCanonicalCommandSpec('BN_UPRATING_CLOSE_RUN');
    expect(spec.capability).toBe('bn_uprating:decide');
    // Closure changes no money, so it needs no transactional award boundary.
    expect(spec.transactional).toBe(false);
    expect(spec.requiresMakerChecker).toBe(false);
    expect(spec.requiresJustification).toBe(false);
  });

  it('names exactly one canonical Epic 5 command', () => {
    expect(BN_UPRATING_EPIC5_CANONICAL_COMMANDS).toEqual(['BN_UPRATING_CLOSE_RUN']);
  });
});

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

describe('Uprating Epic 5 — closure state machine', () => {
  it('permits closure only from RECONCILED or ROLLED_BACK', () => {
    expect([...BN_UPRATING_CLOSABLE_STATUSES].sort()).toEqual(['RECONCILED', 'ROLLED_BACK']);
    expect(canUpratingEpic5Transition('RECONCILED', 'CLOSED')).toBe(true);
    expect(canUpratingEpic5Transition('ROLLED_BACK', 'CLOSED')).toBe(true);
    for (const from of [
      'DRAFT',
      'AWAITING_APPROVAL',
      'APPROVED',
      'EXECUTING',
      'COMPLETED',
      'PARTIAL',
      'FAILED',
      'SCHEDULES_REBUILT',
      'COMMUNICATIONS_ISSUED',
    ] as const) {
      expect(canUpratingEpic5Transition(from, 'CLOSED')).toBe(false);
    }
  });

  it('makes CLOSED terminal with no reopen transition', () => {
    expect(BN_UPRATING_EPIC5_RUN_TRANSITIONS.CLOSED).toEqual([]);
    expect(BN_UPRATING_EPIC1_RUN_TRANSITIONS.CLOSED).toEqual([]);
    expect(isUpratingRunClosed('CLOSED')).toBe(true);
    expect(isUpratingRunClosed('RECONCILED')).toBe(false);
    expect(canUpratingEpic5Transition('CLOSED', 'RECONCILED')).toBe(false);
    expect(types).not.toMatch(/BN_UPRATING_REOPEN/);
    expect(epic5Sql).not.toMatch(/REOPEN/i);
  });

  it('threads closure into the full lifecycle map', () => {
    expect(canUpratingEpic1Transition('RECONCILED', 'CLOSED')).toBe(true);
    expect(canUpratingEpic1Transition('ROLLED_BACK', 'CLOSED')).toBe(true);
    expect(canUpratingEpic1Transition('EXECUTING', 'CLOSED')).toBe(false);
  });

  it('keeps Epic 4 free of closure', () => {
    for (const targets of Object.values(BN_UPRATING_EPIC4_RUN_TRANSITIONS)) {
      expect(targets).not.toContain('CLOSED');
    }
    expect(canUpratingEpic4Transition('RECONCILED', 'CLOSED')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Governed backend boundary
// ---------------------------------------------------------------------------

describe('Uprating Epic 5 — governed backend boundary', () => {
  it('ships the closure boundary SQL', () => {
    expect(epic5Sql.length).toBeGreaterThan(0);
    expect(epic5Sql).toContain('CREATE OR REPLACE FUNCTION public._bn_uprating_close_readiness');
    expect(epic5Sql).toContain(
      'CREATE OR REPLACE FUNCTION public.bn_uprating_close_readiness_v1',
    );
    expect(epic5Sql).toContain('BN_UPRATING_CLOSE_RUN');
  });

  it('routes closure through the single governed command boundary', () => {
    expect(epic5Sql).toContain(
      'CREATE OR REPLACE FUNCTION public.bn_uprating_run_command_v1',
    );
    expect(epic5Sql).toContain('_bn_uprating_run_command_epic4');
  });

  it('enforces the decide capability and authentication', () => {
    expect(epic5Sql).toContain("_bn_uprating_require(p_actor_user_id,'decide',true)");
    expect(epic5Sql).toContain('E_UNAUTHENTICATED');
  });

  it('guards optimistic concurrency and replay', () => {
    expect(epic5Sql).toContain('E_STALE_ROW_VERSION');
    expect(epic5Sql).toContain('E_IDEMPOTENCY_MISMATCH');
    expect(epic5Sql).toContain('bn_uprating_command_idempotency');
    expect(epic5Sql).toContain("jsonb_build_object('replayed', true)");
  });

  it('rejects a second closure rather than transitioning again', () => {
    expect(epic5Sql).toContain('E_ALREADY_CLOSED');
  });

  it('refuses closure from a non-closable state', () => {
    expect(epic5Sql).toContain('NOT_CLOSABLE_STATE');
    expect(epic5Sql).toContain('E_INVALID_TRANSITION');
    expect(epic5Sql).toContain('_bn_uprating_epic5_can_transition');
    expect(epic5Sql).toContain("p_from IN ('RECONCILED','ROLLED_BACK')");
  });

  it('blocks closure while operational consequences remain outstanding', () => {
    for (const code of [
      'NO_RECONCILIATION',
      'RECONCILIATION_NOT_PASSED',
      'RECONCILIATION_FINDINGS_OPEN',
      'EXECUTION_INCOMPLETE',
      'SCHEDULE_OUTSTANDING',
      'COMMUNICATION_OUTSTANDING',
      'ROLLBACK_AWAITING_AUTHORISATION',
      'NO_ROLLBACK',
      'ROLLBACK_INCOMPLETE',
      'ROLLBACK_ITEMS_PENDING',
      'ROLLBACK_COMMUNICATION_OUTSTANDING',
    ]) {
      expect(epic5Sql).toContain(code);
    }
    expect(epic5Sql).toContain('E_CLOSURE_BLOCKED');
  });

  it('fails closed when an authoritative source cannot be read', () => {
    expect(epic5Sql).toContain('SOURCE_UNAVAILABLE');
    expect(epic5Sql).toContain("'source_available', false");
    expect(epic5Sql).toContain("'can_close', false");
  });

  it('records closure evidence on the run without destroying anything', () => {
    expect(epic5Sql).toContain('closed_at');
    expect(epic5Sql).toContain('closed_by');
    expect(epic5Sql).toContain('closure_path');
    expect(epic5Sql).toContain('closure_reconciliation_id');
    expect(epic5Sql).toContain('closure_rollback_id');
    expect(epic5Sql).not.toMatch(/DELETE\s+FROM/i);
    expect(epic5Sql).not.toMatch(/TRUNCATE/i);
    expect(epic5Sql).not.toMatch(/DROP\s+TABLE/i);
  });

  it('never touches award, payment, schedule or communication state on closure', () => {
    const closeBlock = epic5Sql.slice(epic5Sql.indexOf('BN_UPRATING_CLOSE_RUN'));
    expect(closeBlock).not.toMatch(/UPDATE public\.bn_award/i);
    expect(closeBlock).not.toMatch(/INSERT INTO public\.bn_award/i);
    expect(closeBlock).not.toMatch(/UPDATE public\.bn_uprating_execution_item/i);
    expect(closeBlock).not.toMatch(/INSERT INTO public\.bn_uprating_communication_intent/i);
    expect(closeBlock).not.toMatch(/INSERT INTO public\.bn_uprating_schedule_rebuild/i);
  });

  it('writes an audit record and a lifecycle event for the closure', () => {
    expect(epic5Sql).toContain('bn_uprating_command_audit');
    expect(epic5Sql).toContain("'RUN_CLOSED'");
    expect(epic5Sql).toContain('_bn_uprating_run_event');
  });

  it('offers no action at all once a run is CLOSED', () => {
    expect(epic5Sql).toContain("IF r.status = 'CLOSED' THEN");
    expect(epic5Sql).toContain("'actions', '[]'::jsonb");
    expect(epic5Sql).toContain("'is_terminal', true");
  });

  it('grants execute on the closure reads to the app roles', () => {
    expect(epic5Sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.bn_uprating_close_readiness_v1(uuid,uuid) TO authenticated, service_role;',
    );
  });

  it('publishes closure reference values instead of hard-coded labels', () => {
    expect(epic5Sql).toContain("('RUN_STATUS','CLOSED'");
    expect(epic5Sql).toContain("('CLOSURE_PATH','RECONCILED'");
    expect(epic5Sql).toContain("('CLOSURE_PATH','ROLLED_BACK'");
  });
});

// ---------------------------------------------------------------------------
// Service façade
// ---------------------------------------------------------------------------

describe('Uprating Epic 5 — service façade', () => {
  it('exposes closure readiness and the closure command through the governed façade', () => {
    expect(runService).toContain('bn_uprating_close_readiness_v1');
    expect(runService).toContain('export async function closeUpratingRun');
    expect(runService).toContain("command: 'BN_UPRATING_CLOSE_RUN'");
  });

  it('routes the closure command through bn_uprating_run_command_v1 only', () => {
    expect(runService).toContain('executeUpratingRunCommand');
    expect(runService).not.toMatch(/from\('bn_uprating_run'\)/);
  });

  it('translates closure errors into plain language', () => {
    for (const code of ['E_ALREADY_CLOSED', 'E_CLOSURE_BLOCKED', 'E_CLOSURE_NOT_PERMITTED']) {
      expect(runService).toContain(code);
    }
    expect(runService).not.toMatch(/E_CLOSURE_BLOCKED: '[^']*(SQL|null|undefined)/);
  });

  it('sends an idempotency key and the expected row version with closure', () => {
    expect(workspace).toContain("command: 'BN_UPRATING_CLOSE_RUN'");
    const block = workspace.slice(workspace.indexOf("command: 'BN_UPRATING_CLOSE_RUN'"));
    expect(block.slice(0, 400)).toContain('idempotencyKey: newUpratingUuid()');
    expect(block.slice(0, 400)).toContain('expectedRowVersion');
  });
});

// ---------------------------------------------------------------------------
// Operational surfaces
// ---------------------------------------------------------------------------

describe('Uprating Epic 5 — closure surfaces', () => {
  it('reaches closure from the run workspace', () => {
    expect(workspace).toContain('BnUpratingClosureSection');
    expect(workspace).toContain('BnUpratingCloseRunDialog');
    expect(workspace).toContain('value="closure"');
    expect(workspace).toContain('fetchUpratingCloseReadiness');
  });

  it('refreshes closure readiness after every governed command', () => {
    expect(workspace).toContain("queryKey: ['bn-uprating-close-readiness']");
  });

  it('renders the backend decision instead of deciding locally', () => {
    expect(closureSection).toContain('readiness.can_close');
    expect(closureSection).toContain('blocking_reasons');
    expect(closureSection).not.toMatch(/status === 'RECONCILED'\s*\|\|/);
  });

  it('fails closed in the section when readiness cannot be read', () => {
    expect(closureSection).toContain('isError || !readiness');
    expect(closureSection).toMatch(/Closure readiness is unavailable/);
    expect(closureSection).toMatch(/Try again/);
  });

  it('fails closed in the dialog when readiness is missing or loading', () => {
    expect(closeDialog).toContain('readiness?.can_close === true');
    expect(closeDialog).toContain('disabled={!canClose || isSaving}');
  });

  it('explains in plain language that closure changes nothing operational', () => {
    expect(closureSection).toMatch(/changes no award/i);
    expect(closureSection).toMatch(/cannot be reopened/i);
    expect(closeDialog).toMatch(/deletes nothing/i);
  });

  it('shows retained closure evidence once the run is closed', () => {
    expect(closureSection).toContain('Closed on');
    expect(closureSection).toContain('closed_by_name');
    expect(closureSection).toMatch(/evidence are all retained|evidence/i);
  });

  it('hides the closure action on a closed run', () => {
    expect(closureSection).toContain('{!isClosed && (');
  });

  it('lists every blocking reason rather than a single generic message', () => {
    expect(closureSection).toContain('blockers.map');
    expect(closeDialog).toContain('blockers.map');
  });

  it('keeps the closure surfaces free of raw error codes', () => {
    for (const code of ['E_CLOSURE_BLOCKED', 'E_ALREADY_CLOSED', 'E_STALE_ROW_VERSION']) {
      expect(closureSection).not.toContain(code);
      expect(closeDialog).not.toContain(code);
    }
  });
});

// ---------------------------------------------------------------------------
// End-to-end certification record
// ---------------------------------------------------------------------------

describe('Uprating — end-to-end technical certification', () => {
  const matrix = read('docs/bn/uprating/UPRATING_IMPLEMENTATION_MATRIX.md');
  const completion = read('docs/bn/uprating/UPRATING_COMPLETION_RECORD.md');

  it('records all five epics as complete and certified', () => {
    for (const epic of [0, 1, 2, 3, 4, 5]) {
      expect(matrix).toMatch(new RegExp(`\\| Epic ${epic} \\|[^|]*\\| \\*\\*COMPLETE — CERTIFIED\\*\\*`));
    }
  });

  it('records 17 of 17 canonical commands implemented', () => {
    expect(matrix).toContain('17 implemented');
    expect(matrix).toContain('BN_UPRATING_CLOSE_RUN | decide | no | IMPLEMENTED (Epic 5)');
  });

  it('publishes an accurate completion record', () => {
    expect(completion).toMatch(/17\s*\/\s*17/);
    expect(completion).toMatch(/FUNCTIONALLY COMPLETE AND TECHNICALLY CERTIFIED/);
  });

  it('records the controlled existing-data UAT limitation honestly', () => {
    expect(completion).toMatch(/UAT/);
    expect(completion).toMatch(/non-production/i);
    expect(completion).not.toMatch(/UAT (complete|passed)/i);
  });
});
