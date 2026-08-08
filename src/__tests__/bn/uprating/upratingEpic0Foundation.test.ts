/**
 * BN Uprating — EPIC 0 certification suite.
 *
 * Certifies the delivered policy catalogue and version governance foundation:
 * canonical command alignment, lifecycle state machine, governed command
 * boundary, validation rules, maker-checker approval, effective-dated
 * succession, audit/idempotency, read services, service error contract and
 * architecture boundaries.
 *
 * The delivered SQL migrations are the authority for backend behaviour; the
 * suite scans them rather than requiring a live database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const rpc = vi.fn();
const getUser = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(args[0], args[1]),
    auth: { getUser: () => getUser() },
  },
}));

import {
  BN_UPRATING_CANONICAL_COMMANDS,
  getUpratingCanonicalCommandSpec,
  type BnUpratingCanonicalCommandName,
} from '@/types/bn/uprating/upratingCanonicalCommands';
import {
  BN_UPRATING_POLICY_TRANSITIONS,
  canUpratingPolicyTransition,
  isUpratingPolicyTerminal,
  reachableUpratingPolicyStates,
  type BnUpratingPolicyStatus,
} from '@/types/bn/uprating/upratingPolicyStateMachine';
import { BN_UPRATING_POLICY_TYPES } from '@/types/bn/uprating/upratingPolicyTypes';
import {
  executeUpratingPolicyCommand,
  fetchUpratingApprovalQueue,
  fetchUpratingPolicyDetail,
  fetchUpratingPolicyList,
  newUpratingUuid,
  upratingErrorMessage,
} from '@/services/bn/uprating/upratingPolicyService';

const SRC = path.resolve(__dirname, '../../../');
const ROOT = path.resolve(SRC, '..');
const readSrc = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
/** Every delivered Uprating migration, concatenated. */
const BACKEND_SQL = fs
  .readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
  .filter((sql) => sql.includes('bn_uprating'))
  .join('\n');

const EPIC0_COMMANDS: readonly BnUpratingCanonicalCommandName[] = [
  'BN_UPRATING_CREATE_POLICY',
  'BN_UPRATING_CREATE_POLICY_VERSION',
  'BN_UPRATING_VALIDATE_POLICY',
  'BN_UPRATING_SUBMIT_POLICY_FOR_APPROVAL',
  'BN_UPRATING_APPROVE_POLICY',
];

const SUPPORTING_COMMANDS = [
  'BN_UPRATING_UPDATE_POLICY_VERSION',
  'BN_UPRATING_ACTIVATE_POLICY_VERSION',
  'BN_UPRATING_SUPERSEDE_POLICY_VERSION',
  'BN_UPRATING_RETIRE_POLICY_VERSION',
] as const;

const UI_SOURCES = [
  'pages/bn/uprating/BnUpratingPage.tsx',
  'components/bn/uprating/BnUpratingPolicyWorkspace.tsx',
  'components/bn/uprating/BnUpratingVersionEditorDialog.tsx',
];

/* ------------------------------------------------------------------ */
/* 1. Canonical catalogue alignment                                    */
/* ------------------------------------------------------------------ */
describe('Uprating Epic 0 — canonical catalogue', () => {
  it('preserves the 17-command canonical catalogue', () => {
    expect(BN_UPRATING_CANONICAL_COMMANDS).toHaveLength(17);
  });

  it('keeps every Epic 0 command implemented', () => {
    const implemented = BN_UPRATING_CANONICAL_COMMANDS.filter((c) => c.implemented).map((c) => c.command);
    for (const command of EPIC0_COMMANDS) {
      expect(implemented).toContain(command);
    }
  });

  it('keeps every execution-stage command NOT_STARTED', () => {
    ['BN_UPRATING_EXECUTE_BATCH', 'BN_UPRATING_ROLLBACK_ELIGIBLE', 'BN_UPRATING_CLOSE_RUN',
     'BN_UPRATING_APPROVE_RUN', 'BN_UPRATING_SCHEDULE_EXECUTION', 'BN_UPRATING_RECONCILE_RUN']
      .forEach((c) => {
        expect(getUpratingCanonicalCommandSpec(c as BnUpratingCanonicalCommandName).implemented).toBe(false);
      });
  });


  it('requires maker-checker and justification for policy approval', () => {
    const spec = getUpratingCanonicalCommandSpec('BN_UPRATING_APPROVE_POLICY');
    expect(spec.requiresMakerChecker).toBe(true);
    expect(spec.requiresJustification).toBe(true);
    expect(spec.capability).toBe('bn_uprating:admin');
  });

  it('scopes authoring commands to the write capability', () => {
    EPIC0_COMMANDS.filter((c) => c !== 'BN_UPRATING_APPROVE_POLICY').forEach((c) => {
      expect(getUpratingCanonicalCommandSpec(c).capability).toBe('bn_uprating:write');
    });
  });
});

/* ------------------------------------------------------------------ */
/* 2. Policy version lifecycle                                         */
/* ------------------------------------------------------------------ */
describe('Uprating Epic 0 — policy version lifecycle', () => {
  it('supports the governed happy path end to end', () => {
    const path_: BnUpratingPolicyStatus[] = ['DRAFT', 'REVIEW', 'APPROVED', 'ACTIVE', 'SUPERSEDED', 'RETIRED'];
    for (let i = 0; i < path_.length - 1; i += 1) {
      expect(canUpratingPolicyTransition(path_[i], path_[i + 1])).toBe(true);
    }
  });

  it('allows return-to-draft from review', () => {
    expect(canUpratingPolicyTransition('REVIEW', 'DRAFT')).toBe(true);
  });

  it('never allows an approved or active version to be edited back to draft', () => {
    expect(canUpratingPolicyTransition('APPROVED', 'DRAFT')).toBe(false);
    expect(canUpratingPolicyTransition('ACTIVE', 'DRAFT')).toBe(false);
    expect(canUpratingPolicyTransition('SUPERSEDED', 'ACTIVE')).toBe(false);
  });

  it('never allows a draft to skip approval', () => {
    expect(canUpratingPolicyTransition('DRAFT', 'APPROVED')).toBe(false);
    expect(canUpratingPolicyTransition('DRAFT', 'ACTIVE')).toBe(false);
    expect(canUpratingPolicyTransition('REVIEW', 'ACTIVE')).toBe(false);
  });

  it('treats RETIRED as the only terminal state and reaches it from everywhere', () => {
    expect(isUpratingPolicyTerminal('RETIRED')).toBe(true);
    (Object.keys(BN_UPRATING_POLICY_TRANSITIONS) as BnUpratingPolicyStatus[])
      .filter((s) => s !== 'RETIRED')
      .forEach((s) => {
        expect(isUpratingPolicyTerminal(s)).toBe(false);
        expect(reachableUpratingPolicyStates(s)).toContain('RETIRED');
      });
    expect(BN_UPRATING_POLICY_TRANSITIONS.RETIRED).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Governed command boundary                                        */
/* ------------------------------------------------------------------ */
describe('Uprating Epic 0 — governed command boundary', () => {
  it('exposes a single mutation entry point', () => {
    expect(BACKEND_SQL).toContain('FUNCTION public.bn_uprating_policy_command_v1');
  });

  it('handles every implemented and supporting command inside the boundary', () => {
    [...EPIC0_COMMANDS, ...SUPPORTING_COMMANDS].forEach((c) => {
      expect(BACKEND_SQL).toContain(`'${c}'`);
    });
  });

  it('rejects unknown commands', () => {
    expect(BACKEND_SQL).toContain('E_UNKNOWN_COMMAND');
  });

  it('authenticates the actor against auth.uid()', () => {
    expect(BACKEND_SQL).toContain('p_actor_user_id <> auth.uid()');
    expect(BACKEND_SQL).toContain('E_UNAUTHENTICATED');
  });

  it('checks module rollout and registered action permissions', () => {
    expect(BACKEND_SQL).toContain('bn_uprating_check_actor_permission');
    ['MODULE_NOT_REGISTERED', 'MODULE_DISABLED', 'ROUTES_DISABLED', 'ACTIONS_DISABLED',
     'ACTION_UNREGISTERED', 'PERMISSION_DENIED'].forEach((code) => {
      expect(BACKEND_SQL).toContain(code);
    });
  });

  it('grants admin capability only to decision and succession commands', () => {
    const boundary = BACKEND_SQL.slice(BACKEND_SQL.indexOf('v_capability := CASE p_command_name'));
    const table = boundary.slice(0, boundary.indexOf('ELSE NULL END'));
    ['BN_UPRATING_APPROVE_POLICY', 'BN_UPRATING_ACTIVATE_POLICY_VERSION',
     'BN_UPRATING_SUPERSEDE_POLICY_VERSION', 'BN_UPRATING_RETIRE_POLICY_VERSION'].forEach((c) => {
      expect(table).toMatch(new RegExp(`'${c}'\\s+THEN\\s+'admin'`));
    });
    EPIC0_COMMANDS.filter((c) => c !== 'BN_UPRATING_APPROVE_POLICY').forEach((c) => {
      expect(table).toMatch(new RegExp(`'${c}'\\s+THEN\\s+'write'`));
    });
  });

  it('enforces optimistic concurrency on version mutations', () => {
    expect(BACKEND_SQL).toContain('E_STALE_ROW_VERSION');
    expect(BACKEND_SQL).toContain('p_expected_row_version <> v_ver.row_version');
  });

  it('locks the target row before mutating it', () => {
    expect(BACKEND_SQL).toMatch(/policy_version_id = p_policy_version_id FOR UPDATE/);
  });

  it('writes a command audit row and supports idempotent replay', () => {
    expect(BACKEND_SQL).toContain('INSERT INTO public.bn_uprating_command_audit');
    expect(BACKEND_SQL).toContain('bn_uprating_command_idempotency');
    expect(BACKEND_SQL).toContain("to_jsonb('REPLAYED'::text)");
  });

  it('records a governance event for every lifecycle transition', () => {
    ['POLICY_CREATED', 'VERSION_CREATED', 'VERSION_UPDATED', 'VERSION_VALIDATED', 'VERSION_SUBMITTED',
     'VERSION_DECISION', 'VERSION_ACTIVATED', 'VERSION_SUPERSEDED', 'VERSION_RETIRED']
      .forEach((code) => expect(BACKEND_SQL).toContain(`'${code}'`));
  });
});

/* ------------------------------------------------------------------ */
/* 4. Catalogue and immutability rules                                 */
/* ------------------------------------------------------------------ */
describe('Uprating Epic 0 — catalogue and immutability', () => {
  it('creates the policy, version, tier and governance tables', () => {
    ['bn_uprating_policy', 'bn_uprating_policy_version', 'bn_uprating_policy_tier',
     'bn_uprating_policy_validation', 'bn_uprating_policy_approval', 'bn_uprating_policy_event',
     'bn_uprating_command_audit', 'bn_uprating_command_idempotency', 'bn_uprating_index_series',
     'bn_uprating_index_observation', 'bn_uprating_reference_value']
      .forEach((t) => expect(BACKEND_SQL).toContain(`CREATE TABLE IF NOT EXISTS public.${t}`));
  });

  it('protects every uprating table with RLS and service-role-only grants', () => {
    expect(BACKEND_SQL).toContain('ENABLE ROW LEVEL SECURITY');
    expect(BACKEND_SQL).toContain('REVOKE ALL ON public.bn_uprating_command_audit FROM anon, authenticated');
  });

  it('rejects duplicate policy codes', () => {
    expect(BACKEND_SQL).toContain('E_DUPLICATE_CODE');
  });

  it('allows only one open version per policy at a time', () => {
    expect(BACKEND_SQL).toContain('E_OPEN_VERSION_EXISTS');
    expect(BACKEND_SQL).toMatch(/status IN \('DRAFT','REVIEW'\)/);
  });

  it('permits edits only while the version is a draft', () => {
    expect(BACKEND_SQL).toContain('E_IMMUTABLE_VERSION');
    expect(BACKEND_SQL).toContain('Only a draft version can be edited.');
  });

  it('resets validation whenever the draft payload changes', () => {
    expect(BACKEND_SQL).toContain("validation_status = 'NOT_VALIDATED'");
  });

  it('numbers versions sequentially per policy', () => {
    expect(BACKEND_SQL).toContain('COALESCE(max(version_no),0)+1');
  });
});

/* ------------------------------------------------------------------ */
/* 5. Validation rules                                                 */
/* ------------------------------------------------------------------ */
describe('Uprating Epic 0 — validation rules', () => {
  it('is implemented as a governed backend validator', () => {
    expect(BACKEND_SQL).toContain('FUNCTION public._bn_uprating_validate_version');
  });

  it('requires effective dating, applicability and a legal or source reference', () => {
    ['effective_from', 'country_code', 'award_component_code', 'legal_reference_id']
      .forEach((f) => expect(BACKEND_SQL).toContain(`'field','${f}'`));
    expect(BACKEND_SQL).toContain('E_INVALID_PERIOD');
  });

  it('covers every policy type with type-specific rules', () => {
    BN_UPRATING_POLICY_TYPES.forEach((t) => expect(BACKEND_SQL).toContain(`'${t}'`));
    ['E_MISSING_INDEX_REFERENCE', 'E_INVALID_INDEX_REFERENCE', 'E_MISSING_FORMULA_REFERENCE',
     'E_INVALID_FORMULA_REFERENCE'].forEach((c) => expect(BACKEND_SQL).toContain(c));
  });

  it('enforces tier integrity', () => {
    ['E_INVALID_TIER_RANGE', 'E_OVERLAPPING_TIERS', 'E_UNBOUNDED_TIERS', 'E_INVALID_TIER_SEQUENCE']
      .forEach((c) => expect(BACKEND_SQL).toContain(c));
  });

  it('raises warnings without blocking where policy allows', () => {
    ['W_INDEX_NOT_PUBLISHED', 'W_NO_UNBOUNDED_TIER', 'W_FORMULA_INACTIVE']
      .forEach((c) => expect(BACKEND_SQL).toContain(c));
    expect(BACKEND_SQL).toContain("jsonb_array_length(v_val->'errors') = 0");
  });

  it('detects overlapping effective periods for the same applicability', () => {
    expect(BACKEND_SQL).toContain('E_VERSION_CONFLICT');
  });

  it('records every validation attempt', () => {
    expect(BACKEND_SQL).toContain('INSERT INTO public.bn_uprating_policy_validation');
    expect(BACKEND_SQL).toContain('attempt_no');
  });

  it('blocks submission until validation passes', () => {
    expect(BACKEND_SQL).toContain('E_NOT_VALIDATED');
  });
});

/* ------------------------------------------------------------------ */
/* 6. Maker-checker approval and succession                            */
/* ------------------------------------------------------------------ */
describe('Uprating Epic 0 — independent approval and succession', () => {
  it('blocks the author or submitter from deciding', () => {
    expect(BACKEND_SQL).toContain('E_SELF_APPROVAL');
    expect(BACKEND_SQL).toContain('v_ver.created_by = p_actor_user_id OR v_ver.submitted_by = p_actor_user_id');
  });

  it('requires a reason and justification for every decision', () => {
    expect(BACKEND_SQL).toContain('E_JUSTIFICATION_REQUIRED');
  });

  it('supports approve, return-to-draft and reject only', () => {
    expect(BACKEND_SQL).toContain("v_decision NOT IN ('APPROVE','RETURN_TO_DRAFT','REJECT')");
  });

  it('decides only versions awaiting approval', () => {
    expect(BACKEND_SQL).toContain('Only a version awaiting approval can be decided.');
  });

  it('persists an immutable approval record', () => {
    expect(BACKEND_SQL).toContain('INSERT INTO public.bn_uprating_policy_approval');
  });

  it('supersedes the previous active version on activation', () => {
    expect(BACKEND_SQL).toContain("SET status='SUPERSEDED', superseded_at = now()");
    expect(BACKEND_SQL).toContain("WHERE policy_id = v_ver.policy_id AND status = 'ACTIVE'");
  });

  it('activates only approved versions and supersedes only active ones', () => {
    expect(BACKEND_SQL).toContain('Only an approved version can be activated.');
    expect(BACKEND_SQL).toContain('Only an active version can be superseded.');
  });

  it('requires a justification to retire a version', () => {
    expect(BACKEND_SQL).toContain('A reason and justification are required to retire a version.');
  });
});

/* ------------------------------------------------------------------ */
/* 7. Read services and readiness                                      */
/* ------------------------------------------------------------------ */
describe('Uprating Epic 0 — read services', () => {
  it('delivers the register, detail, approval queue, reference data and actions reads', () => {
    ['bn_uprating_policy_list_v1', 'bn_uprating_policy_detail_v1', 'bn_uprating_policy_approval_queue_v1',
     'bn_uprating_reference_data_v1', 'bn_uprating_policy_actions_v1',
     'bn_uprating_policy_validation_readiness_v1', 'bn_uprating_policy_approval_readiness_v1']
      .forEach((fn) => expect(BACKEND_SQL).toContain(`FUNCTION public.${fn}`));
  });

  it('marks approval-queue rows that the actor may not decide', () => {
    expect(BACKEND_SQL).toContain('AS can_decide');
  });

  it('drives available actions from state and capability, never from the client', () => {
    const actions = BACKEND_SQL.slice(BACKEND_SQL.indexOf('FUNCTION public.bn_uprating_policy_actions_v1'));
    ['edit_draft', 'validate', 'submit_for_approval', 'create_version', 'approve', 'return',
     'reject', 'activate', 'supersede', 'retire'].forEach((a) => expect(actions).toContain(`'${a}'`));
    expect(actions).toContain("v.validation_status = 'VALID'");
  });
});

/* ------------------------------------------------------------------ */
/* 8. Service contract behaviour                                       */
/* ------------------------------------------------------------------ */
describe('Uprating Epic 0 — service contract', () => {
  beforeEach(() => {
    rpc.mockReset();
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: 'actor-1' } } });
  });
  afterEach(() => vi.clearAllMocks());

  it('routes every mutation through the governed command RPC', async () => {
    rpc.mockResolvedValue({ data: { status: 'OK', code: null, message: 'Policy created.', data: {} }, error: null });
    await executeUpratingPolicyCommand({
      command: 'BN_UPRATING_CREATE_POLICY',
      payload: { policy_code: 'UPR1', policy_name: 'Annual', policy_type: 'PERCENTAGE' },
    });
    expect(rpc).toHaveBeenCalledWith('bn_uprating_policy_command_v1', expect.objectContaining({
      p_command_name: 'BN_UPRATING_CREATE_POLICY',
      p_actor_user_id: 'actor-1',
    }));
  });

  it('sends a fresh idempotency key with each command', async () => {
    rpc.mockResolvedValue({ data: { status: 'OK', data: {} }, error: null });
    await executeUpratingPolicyCommand({ command: 'BN_UPRATING_VALIDATE_POLICY', policyVersionId: 'v1' });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(String(args.p_idempotency_key)).toMatch(/^[0-9a-f-]{36}$/);
    expect(newUpratingUuid()).not.toBe(newUpratingUuid());
  });

  it('refuses to act without an authenticated user', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await executeUpratingPolicyCommand({ command: 'BN_UPRATING_CREATE_POLICY' });
    expect(res.status).toBe('ERROR');
    expect(res.code).toBe('E_UNAUTHENTICATED');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('surfaces governed error codes as business-readable messages', async () => {
    rpc.mockResolvedValue({ data: { status: 'ERROR', code: 'E_SELF_APPROVAL', message: null, data: null }, error: null });
    const res = await executeUpratingPolicyCommand({
      command: 'BN_UPRATING_APPROVE_POLICY', policyVersionId: 'v1',
    });
    expect(res.status).toBe('ERROR');
    expect(res.message).toBe('The author or submitter of a version cannot approve it.');
    expect(res.message).not.toMatch(/rpc|jsonb|row_version|E_/);
  });

  it('never leaks transport failures verbatim as a success', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied for function' } });
    const res = await fetchUpratingPolicyList({});
    expect(res.status).toBe('ERROR');
  });

  it('maps unknown codes onto a safe fallback message', () => {
    const message = upratingErrorMessage('E_SOMETHING_NEW');
    expect(message.length).toBeGreaterThan(10);
    expect(message).not.toContain('E_SOMETHING_NEW');
  });

  it('reads the register, detail and approval queue through governed RPCs', async () => {
    rpc.mockResolvedValue({ data: { status: 'OK', data: { rows: [], total: 0 } }, error: null });
    await fetchUpratingPolicyList({});
    await fetchUpratingPolicyDetail('p1');
    await fetchUpratingApprovalQueue();
    expect(rpc.mock.calls.map((c) => c[0])).toEqual([
      'bn_uprating_policy_list_v1',
      'bn_uprating_policy_detail_v1',
      'bn_uprating_policy_approval_queue_v1',
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* 9. Architecture boundary and scope                                  */
/* ------------------------------------------------------------------ */
describe('Uprating Epic 0 — architecture boundary', () => {
  it('never touches bn_uprating_* tables directly from the browser', () => {
    [...UI_SOURCES, 'services/bn/uprating/upratingPolicyService.ts'].forEach((f) => {
      expect(readSrc(f)).not.toMatch(/\.from\(['"]bn_uprating_/);
    });
  });

  it('keeps the route behind the existing module access gate', () => {
    const page = readSrc('pages/bn/uprating/BnUpratingPage.tsx');
    expect(page).toContain('BnModuleRouteGate');
    expect(page).toContain('moduleCode="bn_uprating"');
    expect(page).toContain('requiredAction="view"');
  });

  it('replaces the read-only pilot placeholder with the operational workspace', () => {
    const page = readSrc('pages/bn/uprating/BnUpratingPage.tsx');
    expect(page).toContain('BnUpratingPolicyWorkspace');
    expect(page).not.toContain('BnModuleReadOnlyPilotNotice');
  });

  it('renders actions from the backend action list rather than local assumptions', () => {
    const ws = readSrc('components/bn/uprating/BnUpratingPolicyWorkspace.tsx');
    expect(ws).toContain('fetchUpratingVersionActions');
    expect(ws).toContain('actions.includes');
  });

  it('does not implement run, simulation, execution or communication concepts', () => {
    [...UI_SOURCES, 'services/bn/uprating/upratingPolicyService.ts',
     'types/bn/uprating/upratingPolicy.ts'].forEach((f) => {
      const code = readSrc(f).replace(/\/\*\*[\s\S]*?\*\//g, '');
      expect(code).not.toMatch(/BN_UPRATING_(CREATE_RUN|BUILD_POPULATION|SIMULATE|EXECUTE_BATCH|RECONCILE_RUN|ROLLBACK_ELIGIBLE|CLOSE_RUN)/);
    });
  });

  it('does not create a competing uprating command vocabulary', () => {
    const canonical = new Set<string>([
      ...BN_UPRATING_CANONICAL_COMMANDS.map((c) => c.command),
      ...SUPPORTING_COMMANDS,
    ]);
    const used = new Set(readSrc('types/bn/uprating/upratingPolicy.ts').match(/BN_UPRATING_[A-Z_]+/g) ?? []);
    used.forEach((c) => expect(canonical.has(c)).toBe(true));
  });
});
