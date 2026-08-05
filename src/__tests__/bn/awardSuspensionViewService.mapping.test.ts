/**
 * BN-UI-S1.2 — Canonical schema mapping tests for the read-only view service.
 *
 * Uses an in-memory Supabase router that implements the subset of
 * PostgREST filters the production code exercises: .eq, .in, .lte, .gte,
 * .or (PostgREST expression parsing), .order, .limit, .maybeSingle.
 *
 * Every fixture uses canonical column names and canonical
 * bn_award_suspension_event.status values (PROPOSED / APPROVED / REJECTED /
 * WITHDRAWN / ACTIVE / RESUMED) — never PENDING_APPROVAL.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Fake supabase client ──────────────────────────────────────────────
type Row = Record<string, unknown>;
type TableStub = { rows: Row[] };
const tables: Record<string, TableStub> = {};
const rpcHandlers: Record<string, (args: any) => any[]> = {};
const queryLog: { table: string; op: string; args?: any }[] = [];

const seed = (table: string, rows: Row[]) => (tables[table] = { rows });

/**
 * Tiny PostgREST-ish predicate evaluator supporting:
 *   col.eq.val | col.in.(a,b) | and(...) | or(...)
 */
function makeMatcher(expr: string): (r: Row) => boolean {
  expr = expr.trim();
  if (expr.startsWith('and(') && expr.endsWith(')')) {
    const inner = splitTop(expr.slice(4, -1));
    const parts = inner.map(makeMatcher);
    return (r) => parts.every((f) => f(r));
  }
  if (expr.startsWith('or(') && expr.endsWith(')')) {
    const inner = splitTop(expr.slice(3, -1));
    const parts = inner.map(makeMatcher);
    return (r) => parts.some((f) => f(r));
  }
  const eqM = /^([\w.]+)\.eq\.(.+)$/.exec(expr);
  if (eqM) {
    const [, col, val] = eqM;
    return (r) => String(r[col] ?? '') === val;
  }
  const inM = /^([\w.]+)\.in\.\((.+)\)$/.exec(expr);
  if (inM) {
    const [, col, list] = inM;
    const vs = list.split(',').map((s) => s.trim());
    return (r) => vs.includes(String(r[col] ?? ''));
  }
  return () => true;
}
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

function buildQuery(table: string) {
  queryLog.push({ table, op: 'from' });
  let filtered: Row[] = [...(tables[table]?.rows ?? [])];
  const q: any = {
    select: () => q,
    order: () => q,
    limit: () => q,
    eq: (c: string, v: unknown) => {
      filtered = filtered.filter((r) => r[c] === v);
      return q;
    },
    in: (c: string, v: unknown[]) => {
      filtered = filtered.filter((r) => v.includes(r[c]));
      return q;
    },
    lte: (c: string, v: unknown) => {
      filtered = filtered.filter((r) => {
        const rv = r[c] as any;
        if (rv == null) return true;
        return new Date(String(rv)).getTime() <= new Date(String(v)).getTime();
      });
      return q;
    },
    gte: (c: string, v: unknown) => {
      filtered = filtered.filter((r) => {
        const rv = r[c] as any;
        if (rv == null) return false;
        return new Date(String(rv)).getTime() >= new Date(String(v)).getTime();
      });
      return q;
    },
    or: (expr: string) => {
      const top = splitTop(expr).map(makeMatcher);
      filtered = filtered.filter((r) => top.some((f) => f(r)));
      return q;
    },
    maybeSingle: async () => ({ data: filtered[0] ?? null, error: null }),
    then: (resolve: any) => resolve({ data: filtered, error: null }),
  };
  return q;
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (t: string) => buildQuery(t),
    rpc: async (name: string, args: any) => {
      queryLog.push({ table: `rpc:${name}`, op: 'rpc', args });
      const fn = rpcHandlers[name];
      if (!fn) return { data: [], error: null };
      return { data: fn(args), error: null };
    },
  },
}));

vi.mock('@/lib/bn/featureToggles', () => ({
  isFeatureEnabled: vi.fn(() => false),
}));

import {
  ALLOWED_READ_RPCS,
  getAwardSuspensionRolloutState,
  getSuspensionRequestDetails,
  listAwardsForSuspension,
  listMyApprovalTasks,
  listSuspensionReasonCodes,
  listSuspensionRequests,
  resolveDisplayStatus,
  normaliseEventStatus,
} from '@/services/bn/awardSuspensionViewService';
import { isFeatureEnabled } from '@/lib/bn/featureToggles';

const AWARD_ID = 'a1111111-1111-1111-1111-111111111111';
const EVENT_ID = 'e1111111-1111-1111-1111-111111111111';
const INST_ID = 'i1111111-1111-1111-1111-111111111111';
const INST_OTHER = 'i2222222-2222-2222-2222-222222222222';
const TASK_L1 = 't1111111-1111-1111-1111-111111111111';
const TASK_L2 = 't2222222-2222-2222-2222-222222222222';
const TASK_COMPLETED = 't3333333-3333-3333-3333-333333333333';
const TASK_OTHER_DOMAIN = 't4444444-4444-4444-4444-444444444444';
const WB_A = 'w1111111-1111-1111-1111-111111111111';
const WB_B = 'w2222222-2222-2222-2222-222222222222';
const USER = 'u1111111-1111-1111-1111-111111111111';
const CLAIM_ID = 'c1111111-1111-1111-1111-111111111111';
const PV_ID = 'v1111111-1111-1111-1111-111111111111';
const PV_OTHER = 'v2222222-2222-2222-2222-222222222222';

const seedAll = () => {
  seed('bn_award', [
    {
      id: AWARD_ID,
      award_number: 'AW-1',
      ssn: '123456789',
      benefit_code: 'AGE',
      award_type: 'PENSION',
      status: 'ACTIVE',
      base_amount: 500,
      currency: 'XCD',
      frequency: 'MONTHLY',
      start_date: '2024-01-01',
      next_review_date: null,
      bn_claim_id: CLAIM_ID,
    },
  ]);
  seed('bn_claim', [{ id: CLAIM_ID, product_version_id: PV_ID }]);
  seed('ip_master', [
    { ssn: '123456789', firstname: 'Jane', middle_name: null, surname: 'Doe' },
  ]);
  seed('bn_award_suspension_event', [
    {
      id: EVENT_ID,
      bn_award_id: AWARD_ID,
      // BN-UI-S1.2 — canonical event status is PROPOSED, never PENDING_*.
      status: 'PROPOSED',
      suspended_from: '2024-02-01',
      reason_code: 'MEDICAL_PENDING',
      reason_text: 'Awaiting medical evidence',
      proposed_by_user_id: 'u-proposer',
      entered_at: '2024-01-15T10:00:00Z',
      entered_by: 'u-proposer',
      workflow_instance_id: INST_ID,
      modified_at: '2024-01-15T10:00:00Z',
      correlation_id: 'corr-1',
      entity_type: 'bn_award_suspension_event',
      entity_id: EVENT_ID,
    },
  ]);
  seed('core_workflow_instance', [
    {
      id: INST_ID,
      workflow_code: 'BN_AWARD_SUSPENSION',
      module_code: 'bn_award_suspension',
      entity_type: 'bn_award_suspension_event',
      entity_id: EVENT_ID,
      status: 'ACTIVE',
      metadata: {},
    },
    {
      id: INST_OTHER,
      workflow_code: 'BN_CLAIM',
      module_code: 'bn_claim',
      entity_type: 'bn_claim',
      entity_id: 'c-1',
      status: 'ACTIVE',
      metadata: {},
    },
  ]);
  seed('core_workflow_task', [
    {
      id: TASK_L1,
      workflow_instance_id: INST_ID,
      task_code: 'BN_SUS_L1',
      step_code: 'L1',
      assigned_to_user_id: USER,
      assigned_to_role_key: 'BN_SUPERVISOR',
      assigned_to_permission_key: null,
      task_status: 'PENDING',
      due_at: '2024-02-10T00:00:00Z',
      claimed_by: null,
      completed_by: null,
      completed_at: null,
      outcome: null,
      metadata: { approval_level: 1, workbasket_id: WB_A, policy_id: 'p1' },
      is_active: true,
      created_at: '2024-01-15T10:00:00Z',
    },
    {
      id: TASK_L2,
      workflow_instance_id: INST_ID,
      task_code: 'BN_SUS_L2',
      step_code: 'L2',
      assigned_to_user_id: null,
      assigned_to_role_key: 'BN_MANAGER',
      task_status: 'PENDING',
      due_at: null,
      claimed_by: null,
      completed_by: null,
      completed_at: null,
      outcome: null,
      metadata: { approval_level: 2, workbasket_id: WB_A, policy_id: 'p2' },
      is_active: true,
      created_at: '2024-01-15T11:00:00Z',
    },
    {
      id: TASK_COMPLETED,
      workflow_instance_id: INST_ID,
      task_code: 'BN_SUS_L0',
      task_status: 'COMPLETED',
      assigned_to_user_id: USER,
      assigned_to_role_key: null,
      due_at: null,
      claimed_by: null,
      completed_by: USER,
      completed_at: '2024-01-15T09:00:00Z',
      outcome: 'APPROVED',
      metadata: { approval_level: 0 },
      is_active: false,
      created_at: '2024-01-15T08:00:00Z',
    },
    {
      id: TASK_OTHER_DOMAIN,
      workflow_instance_id: INST_OTHER,
      task_code: 'CLAIM_REVIEW',
      task_status: 'PENDING',
      assigned_to_user_id: USER,
      metadata: { approval_level: 1 },
      is_active: true,
      created_at: '2024-01-15T10:00:00Z',
    },
  ]);
  seed('bn_workbasket', [
    { id: WB_A, basket_code: 'BEN_SUPS', basket_name: 'Benefits Supervisors' },
    { id: WB_B, basket_code: 'OTHER', basket_name: 'Other basket' },
  ]);
  seed('bn_workbasket_role', []);
  seed('bn_role_delegation', []);
  seed('bn_approval_policy', [
    // Correct product version, correct area+action → included
    { id: 'p1', level: 1, action_code: 'SUSPEND', policy_area: 'AWARD', is_enabled: true, product_version_id: PV_ID },
    { id: 'p2', level: 2, action_code: 'SUSPEND', policy_area: 'AWARD', is_enabled: true, product_version_id: PV_ID },
    // Wrong product version — must NOT influence this award's total levels
    { id: 'p3', level: 3, action_code: 'SUSPEND', policy_area: 'AWARD', is_enabled: true, product_version_id: PV_OTHER },
    // Payment policy on this product — must NOT count
    { id: 'p4', level: 5, action_code: 'SUSPEND', policy_area: 'PAYMENT', is_enabled: true, product_version_id: PV_ID },
    // Wrong action on this product — must NOT count
    { id: 'p5', level: 7, action_code: 'DISCONTINUE', policy_area: 'AWARD', is_enabled: true, product_version_id: PV_ID },
  ]);
  seed('v_bn_user_effective_roles', []);
  seed('bn_reason_code', [
    { reason_code: 'MEDICAL_PENDING', reason_label: 'Medical evidence pending', applicable_actions: ['SUSPEND', 'HOLD'], is_active: true, requires_narrative: false },
    { reason_code: 'RETURN_TO_WORK', reason_label: 'Return to work', applicable_actions: ['DISCONTINUE', 'SUSPEND'], is_active: true, requires_narrative: false },
    { reason_code: 'UNRELATED', reason_label: 'Something else', applicable_actions: ['DISCONTINUE'], is_active: true, requires_narrative: false },
  ]);
  seed('core_workflow_action_log', [
    {
      id: 'log-1',
      workflow_instance_id: INST_ID,
      workflow_task_id: TASK_COMPLETED,
      action_type: 'APPROVE_L0',
      action_name: 'Level 0 approved',
      actor_user_id: USER,
      actor_name: 'Jane Approver',
      before_status: 'PROPOSED',
      after_status: 'PROPOSED',
      reason: null,
      comments: 'ok',
      action_at: '2024-01-15T09:05:00Z',
      metadata: { correlation_id: 'corr-1' },
    },
  ]);
  seed('core_audit_log', [
    {
      id: 'audit-1',
      event_time: '2024-01-15T09:00:00Z',
      action: 'CREATE',
      event_name: 'Suspension proposed',
      actor_user_id: 'u-proposer',
      actor_name: 'Proposer',
      before_value: null,
      after_value: { status: 'PROPOSED' },
      metadata: { permission_action: 'bn_award_suspension.propose', policy_id: 'p1', approval_level: 1 },
      correlation_id: 'corr-1',
      entity_type: 'bn_award_suspension_event',
      entity_id: EVENT_ID,
    },
  ]);
  seed('app_modules', [
    {
      name: 'bn_award_suspension',
      is_enabled: true,
      actions_enabled: false,
      show_in_menu: false,
      rollout_state: 'public',
    },
  ]);
};

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(rpcHandlers)) delete rpcHandlers[k];
  queryLog.length = 0;
  seedAll();
  vi.mocked(isFeatureEnabled).mockReturnValue(false);
});

describe('BN-UI-S1.2 · canonical schema mapping', () => {
  it('exposes only allow-listed read RPCs', () => {
    expect([...ALLOWED_READ_RPCS]).toEqual(['bn_workbaskets_for_user']);
  });

  // ── Display-status resolver ─────────────────────────────────────────
  describe('resolveDisplayStatus', () => {
    it('PROPOSED + open L1 task → PENDING_LEVEL_1', () => {
      expect(
        resolveDisplayStatus('PROPOSED', {
          task_status: 'PENDING',
          metadata: { approval_level: 1 },
        }),
      ).toBe('PENDING_LEVEL_1');
    });
    it('PROPOSED + open L2 task → PENDING_LEVEL_2', () => {
      expect(
        resolveDisplayStatus('PROPOSED', {
          task_status: 'PENDING',
          metadata: { approval_level: 2 },
        }),
      ).toBe('PENDING_LEVEL_2');
    });
    it('PROPOSED + open L3 task → PENDING_LEVEL_N', () => {
      expect(
        resolveDisplayStatus('PROPOSED', {
          task_status: 'PENDING',
          metadata: { approval_level: 3 },
        }),
      ).toBe('PENDING_LEVEL_N');
    });
    it('PROPOSED + open task without level → PENDING_APPROVAL', () => {
      expect(
        resolveDisplayStatus('PROPOSED', { task_status: 'PENDING', metadata: {} }),
      ).toBe('PENDING_APPROVAL');
    });
    it('PROPOSED + no task → PROPOSED', () => {
      expect(resolveDisplayStatus('PROPOSED', null)).toBe('PROPOSED');
    });
    it('APPROVED / REJECTED / WITHDRAWN pass through', () => {
      expect(resolveDisplayStatus('APPROVED', null)).toBe('APPROVED');
      expect(resolveDisplayStatus('REJECTED', null)).toBe('REJECTED');
      expect(resolveDisplayStatus('WITHDRAWN', null)).toBe('WITHDRAWN');
    });
    it('ACTIVE / RESUMED → APPLIED', () => {
      expect(resolveDisplayStatus('ACTIVE', null)).toBe('APPLIED');
      expect(resolveDisplayStatus('RESUMED', null)).toBe('APPLIED');
    });
    it('normaliseEventStatus fails closed to UNKNOWN for non-canonical values', () => {
      expect(normaliseEventStatus('PENDING_APPROVAL')).toBe('UNKNOWN');
      expect(normaliseEventStatus('PENDING_LEVEL_1')).toBe('UNKNOWN');
      expect(normaliseEventStatus('bogus')).toBe('UNKNOWN');
    });

  });

  // ── Listings apply the resolver ─────────────────────────────────────
  it('listSuspensionRequests produces PENDING_LEVEL_1 for the seeded request', async () => {
    const rows = await listSuspensionRequests();
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.status).toBe('PENDING_LEVEL_1');
    expect(r.currentTaskCode).toBe('BN_SUS_L1');
    expect(r.currentApprovalLevel).toBe(1);
    expect(r.assignedWorkbasketCode).toBe('BEN_SUPS');
    // Level 2 policy on same product → total is 2 (p3/p4/p5 excluded)
    expect(r.totalApprovalLevels).toBe(2);
  });

  it('listSuspensionRequests: bumping current level to L2 yields PENDING_LEVEL_2', async () => {
    tables['core_workflow_task'].rows = tables['core_workflow_task'].rows.map((t) =>
      t.id === TASK_L1 ? { ...t, task_status: 'COMPLETED', is_active: false } : t,
    );
    const rows = await listSuspensionRequests();
    expect(rows[0].status).toBe('PENDING_LEVEL_2');
  });

  it('APPROVED event stays APPROVED regardless of open task', async () => {
    tables['bn_award_suspension_event'].rows = tables['bn_award_suspension_event'].rows.map(
      (e) => ({ ...e, status: 'APPROVED' }),
    );
    const rows = await listSuspensionRequests();
    expect(rows[0].status).toBe('APPROVED');
  });

  // ── Policy scoping ──────────────────────────────────────────────────
  it("excludes another product's policy, PAYMENT policies, and other actions", async () => {
    const rows = await listSuspensionRequests();
    // Only p1(L1) + p2(L2) → totalLevels stays 2, not 3/5/7.
    expect(rows[0].totalApprovalLevels).toBe(2);
  });

  it('falls back to task-derived levels when the award has no product version', async () => {
    tables['bn_award'].rows = tables['bn_award'].rows.map((a) => ({ ...a, bn_claim_id: null }));
    const rows = await listSuspensionRequests();
    // Only task levels (0, 1, 2) contribute — max = 2.
    expect(rows[0].totalApprovalLevels).toBe(2);
    // No policy query returned rows: still, no failure.
    expect(rows[0].status).toBe('PENDING_LEVEL_1');
  });

  // ── Reasons ────────────────────────────────────────────────────────
  it('reason-code loader returns only reasons with SUSPEND', async () => {
    const rs = await listSuspensionReasonCodes();
    expect(rs.map((r) => r.code).sort()).toEqual(['MEDICAL_PENDING', 'RETURN_TO_WORK']);
  });

  // ── Rollout gate ───────────────────────────────────────────────────
  it('effectiveActionsEnabled requires all three gates (module + actions + frontend)', async () => {
    // Frontend feature off, DB actions off → false
    let s = await getAwardSuspensionRolloutState();
    expect(s.effectiveActionsEnabled).toBe(false);

    // Turn only DB actions on — still false because frontend is off
    tables['app_modules'].rows = [
      { name: 'bn_award_suspension', is_enabled: true, actions_enabled: true, show_in_menu: false, rollout_state: 'public' },
    ];
    s = await getAwardSuspensionRolloutState();
    expect(s.actionsEnabled).toBe(true);
    expect(s.frontendFeatureEnabled).toBe(false);
    expect(s.effectiveActionsEnabled).toBe(false);

    // Turn frontend on — now true
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    s = await getAwardSuspensionRolloutState();
    expect(s.effectiveActionsEnabled).toBe(true);

    // Turn module off — false again
    tables['app_modules'].rows = [
      { name: 'bn_award_suspension', is_enabled: false, actions_enabled: true, show_in_menu: false, rollout_state: 'public' },
    ];
    s = await getAwardSuspensionRolloutState();
    expect(s.effectiveActionsEnabled).toBe(false);
  });

  // ── My Approvals matching ──────────────────────────────────────────
  it('My Approvals: DIRECT assignment matches', async () => {
    const rows = await listMyApprovalTasks(USER);
    expect(rows.find((r) => r.taskId === TASK_L1)?.assignmentReason).toBe('DIRECT');
  });

  it('My Approvals: role-only task matches on effective role', async () => {
    seed('v_bn_user_effective_roles', [{ user_id: USER, role_name: 'BN_MANAGER' }]);
    // Strip workbasket from L2 to make it role-only
    tables['core_workflow_task'].rows = tables['core_workflow_task'].rows.map((t) =>
      t.id === TASK_L2 ? { ...t, metadata: { approval_level: 2 } } : t,
    );
    const rows = await listMyApprovalTasks(USER);
    expect(rows.find((r) => r.taskId === TASK_L2)?.assignmentReason).toBe('ROLE');
  });

  it('My Approvals: correct role but WRONG workbasket is excluded', async () => {
    seed('v_bn_user_effective_roles', [{ user_id: USER, role_name: 'BN_MANAGER' }]);
    rpcHandlers['bn_workbaskets_for_user'] = () => [{ workbasket_id: WB_B }];
    // L2 has role BN_MANAGER and wb WB_A; user has role but only WB_B
    const rows = await listMyApprovalTasks(USER);
    expect(rows.find((r) => r.taskId === TASK_L2)).toBeUndefined();
  });

  it('My Approvals: correct workbasket but WRONG role is excluded', async () => {
    seed('v_bn_user_effective_roles', []); // no roles
    rpcHandlers['bn_workbaskets_for_user'] = () => [{ workbasket_id: WB_A }];
    // Strip direct assignment on L2 so only role+wb can match
    tables['core_workflow_task'].rows = tables['core_workflow_task'].rows.map((t) =>
      t.id === TASK_L2 ? { ...t } : t,
    );
    const rows = await listMyApprovalTasks(USER);
    expect(rows.find((r) => r.taskId === TASK_L2)).toBeUndefined();
  });

  it('My Approvals: role AND workbasket both required when both present', async () => {
    seed('v_bn_user_effective_roles', [{ user_id: USER, role_name: 'BN_MANAGER' }]);
    rpcHandlers['bn_workbaskets_for_user'] = () => [{ workbasket_id: WB_A }];
    const rows = await listMyApprovalTasks(USER);
    expect(rows.find((r) => r.taskId === TASK_L2)?.assignmentReason).toBe('ROLE');
  });

  it('My Approvals: expired delegation is excluded', async () => {
    tables['core_workflow_task'].rows = tables['core_workflow_task'].rows.map((t) =>
      t.id === TASK_L2 ? { ...t, metadata: { approval_level: 2 } } : t, // role-only
    );
    seed('bn_role_delegation', [
      {
        id: 'd-exp',
        to_user_id: USER,
        role_name: 'BN_MANAGER',
        workbasket_id: null,
        valid_from: '2023-01-01T00:00:00Z',
        valid_to: '2023-06-01T00:00:00Z',
        status: 'APPROVED',
      },
    ]);
    const rows = await listMyApprovalTasks(USER);
    expect(rows.find((r) => r.taskId === TASK_L2)).toBeUndefined();
  });

  it('My Approvals: delegation for another role/workbasket does not qualify', async () => {
    seed('bn_role_delegation', [
      {
        id: 'd-wrong',
        to_user_id: USER,
        role_name: 'SOMETHING_ELSE',
        workbasket_id: WB_B,
        valid_from: '2024-01-01T00:00:00Z',
        valid_to: '2099-01-01T00:00:00Z',
        status: 'APPROVED',
      },
    ]);
    tables['core_workflow_task'].rows = tables['core_workflow_task'].rows.map((t) =>
      t.id === TASK_L2 ? { ...t } : t,
    );
    const rows = await listMyApprovalTasks(USER);
    expect(rows.find((r) => r.taskId === TASK_L2)).toBeUndefined();
  });

  // ── Audit permission gate ──────────────────────────────────────────
  it('non-auditor drawer load does NOT query core_audit_log', async () => {
    queryLog.length = 0;
    const d = await getSuspensionRequestDetails(EVENT_ID, { includeAudit: false });
    expect(d).not.toBeNull();
    expect(d!.audit).toEqual([]);
    expect(queryLog.some((q) => q.table === 'core_audit_log')).toBe(false);
  });

  it('auditor drawer load DOES query core_audit_log and returns entries', async () => {
    queryLog.length = 0;
    const d = await getSuspensionRequestDetails(EVENT_ID, { includeAudit: true });
    expect(queryLog.some((q) => q.table === 'core_audit_log')).toBe(true);
    expect(d!.audit).toHaveLength(1);
    expect(d!.audit[0].actionName).toBe('Suspension proposed');
  });

  it('defaults to no-audit when includeAudit is omitted', async () => {
    queryLog.length = 0;
    const d = await getSuspensionRequestDetails(EVENT_ID);
    expect(d!.audit).toEqual([]);
    expect(queryLog.some((q) => q.table === 'core_audit_log')).toBe(false);
  });

  // ── BN-UI-S1.2A · Awards tab aligns with workflow status ─────────────
  describe('BN-UI-S1.2A · Awards tab display status matches workflow', () => {
    it('PROPOSED event + open Level 1 task → Awards tab shows PENDING_LEVEL_1', async () => {
      const rows = await listAwardsForSuspension();
      expect(rows).toHaveLength(1);
      expect(rows[0].openRequestStatus).toBe('PENDING_LEVEL_1');
      expect(rows[0].openRequestId).toBe(EVENT_ID);
    });

    it('PROPOSED event + open Level 2 task → Awards tab shows PENDING_LEVEL_2', async () => {
      tables['core_workflow_task'].rows = tables['core_workflow_task'].rows.map((t) =>
        t.id === TASK_L1 ? { ...t, task_status: 'COMPLETED', is_active: false } : t,
      );
      const rows = await listAwardsForSuspension();
      expect(rows[0].openRequestStatus).toBe('PENDING_LEVEL_2');
    });

    it('PROPOSED event + no workflow task → Awards tab shows PROPOSED', async () => {
      tables['core_workflow_task'].rows = [];
      const rows = await listAwardsForSuspension();
      expect(rows[0].openRequestStatus).toBe('PROPOSED');
    });

    it('Awards tab and Requests tab return the same display status for the same request', async () => {
      const [awards, requests] = await Promise.all([
        listAwardsForSuspension(),
        listSuspensionRequests(),
      ]);
      expect(awards[0].openRequestId).toBe(requests[0].requestId);
      expect(awards[0].openRequestStatus).toBe(requests[0].status);
    });

    it('listAwardsForSuspension introduces no write method or write RPC', async () => {
      queryLog.length = 0;
      await listAwardsForSuspension();
      const writeOps = new Set(['insert', 'update', 'delete', 'upsert']);
      for (const entry of queryLog) {
        expect(writeOps.has(entry.op)).toBe(false);
        if (entry.op === 'rpc') {
          expect((ALLOWED_READ_RPCS as readonly string[]).includes(entry.table.replace(/^rpc:/, ''))).toBe(true);
        }
      }
    });
  });
});
