/**
 * Omni-Comms — privileged runtime certification harness.
 *
 * This harness replaces the earlier false-positive implementation, which
 * invoked the Edge Function with a meaningless body and treated ANY
 * non-5xx response as a pass. It certified nothing.
 *
 * Every scenario here:
 *   1. creates or locates valid, isolated fixtures (all keyed by a unique
 *      fixture prefix so cleanup is exact);
 *   2. submits a complete, valid request where the scenario requires one;
 *   3. asserts the exact expected HTTP status;
 *   4. asserts the exact bounded blocker codes;
 *   5. queries and verifies the expected PERSISTED state;
 *   6. FAILS when the semantic result is wrong, even when HTTP is 200.
 *
 * Absolute safety boundaries asserted by the harness itself:
 *   * zero delivery attempts;
 *   * zero runnable dispatch jobs (every job must be `held`);
 *   * zero provider calls;
 *   * zero emails.
 *
 * Secrets are never printed. JWTs, the service-role key and provider
 * credentials never appear in stdout, stderr or the machine-readable block.
 *
 * Required environment:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_ANON_KEY
 *   OMNI_COMMS_TEST_USER_JWT             capability-bearing operator
 *   OMNI_COMMS_TEST_UNPRIVILEGED_JWT     authenticated, NO omni_comms.operate
 *   OMNI_COMMS_TEST_ORGANIZATION_ID
 *   OMNI_COMMS_TEST_DEPARTMENT_ID
 *   OMNI_COMMS_TEST_FOREIGN_ORGANIZATION_ID   REAL staging organisation the
 *                                        authorised test actor has NO access
 *                                        to. Never a synthetic UUID.
 *   OMNI_COMMS_TEST_FOREIGN_DEPARTMENT_ID     REAL staging department the
 *                                        authorised test actor is NOT
 *                                        assigned/entitled to.
 *   OMNI_COMMS_TEST_EVENT_CODE           fully configured pilot event
 *   OMNI_COMMS_TEST_CALLER_MODULE        the ACTUAL pilot business-module
 *                                        caller certified by valid requests
 *   OMNI_COMMS_TEST_UNAUTHORISED_MODULE  registered caller module the test
 *                                        actor must NOT be able to act for
 *   COMMIT_SHA | GITHUB_SHA              full 40-char certified revision
 *
 * Optional environment:
 *   OMNI_COMMS_REQUIRE_EDGE_REVISION=1   fail unless the deployed Edge
 *                                        revision equals COMMIT_SHA


 *
 * On refusal (missing/placeholder credentials) exits non-zero with:
 *   PRIVILEGED EDGE RESOLUTION INTEGRATION NOT EXECUTED
 *
 * On full success — and only after every semantic assertion AND the
 * post-cleanup counts pass — prints:
 *   BUILD 3 SLICE 2C-II EDGE RESOLUTION INTEGRATION OK
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/* ── environment ───────────────────────────────────────────────────────── */

const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
  'OMNI_COMMS_TEST_USER_JWT',
  'OMNI_COMMS_TEST_UNPRIVILEGED_JWT',
  'OMNI_COMMS_TEST_ORGANIZATION_ID',
  'OMNI_COMMS_TEST_DEPARTMENT_ID',
  'OMNI_COMMS_TEST_FOREIGN_ORGANIZATION_ID',
  'OMNI_COMMS_TEST_FOREIGN_DEPARTMENT_ID',
  'OMNI_COMMS_TEST_EVENT_CODE',
  'OMNI_COMMS_TEST_CALLER_MODULE',
  'OMNI_COMMS_TEST_UNAUTHORISED_MODULE',
] as const;

type Env = Record<(typeof REQUIRED)[number], string>;

const PLACEHOLDER_TOKENS = [
  '', 'changeme', 'placeholder', 'xxx', 'todo', 'undefined', 'null',
  'test', 'example', 'your-key-here',
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UUID_ENV_KEYS = [
  'OMNI_COMMS_TEST_ORGANIZATION_ID',
  'OMNI_COMMS_TEST_DEPARTMENT_ID',
  'OMNI_COMMS_TEST_FOREIGN_ORGANIZATION_ID',
  'OMNI_COMMS_TEST_FOREIGN_DEPARTMENT_ID',
] as const;

function refuse(reason: string): never {
  console.error(`[omni-comms:harness] refusing to run: ${reason}`);
  console.error('PRIVILEGED EDGE RESOLUTION INTEGRATION NOT EXECUTED');
  process.exit(2);
}

function readEnv(): Env {
  const out = {} as Env;
  for (const k of REQUIRED) {
    const v = process.env[k];
    if (v === undefined || v === null) refuse(`missing env var ${k}`);
    const t = String(v).trim();
    if (t.length === 0) refuse(`empty env var ${k}`);
    if (PLACEHOLDER_TOKENS.includes(t.toLowerCase())) {
      refuse(`placeholder-like value for ${k}`);
    }
    out[k] = t;
  }
  if (out.SUPABASE_ANON_KEY === out.SUPABASE_SERVICE_ROLE_KEY) {
    refuse('SUPABASE_SERVICE_ROLE_KEY equals the anon key');
  }
  for (const k of ['OMNI_COMMS_TEST_USER_JWT', 'OMNI_COMMS_TEST_UNPRIVILEGED_JWT'] as const) {
    if (out[k].split('.').length !== 3) refuse(`${k} is not a JWT-shaped value`);
  }
  if (out.OMNI_COMMS_TEST_USER_JWT === out.OMNI_COMMS_TEST_UNPRIVILEGED_JWT) {
    refuse('privileged and unprivileged JWTs are identical — negative tests would be meaningless');
  }

  // Tenant-isolation fixtures must be REAL, distinct, well-formed UUIDs.
  // A synthetic or reused identifier turns tenant isolation into theatre.
  for (const k of UUID_ENV_KEYS) {
    if (!UUID_RE.test(out[k])) refuse(`${k} is not a valid UUID`);
  }
  if (
    out.OMNI_COMMS_TEST_FOREIGN_ORGANIZATION_ID.toLowerCase() ===
    out.OMNI_COMMS_TEST_ORGANIZATION_ID.toLowerCase()
  ) {
    refuse('OMNI_COMMS_TEST_FOREIGN_ORGANIZATION_ID equals the primary test organisation');
  }
  if (
    out.OMNI_COMMS_TEST_FOREIGN_DEPARTMENT_ID.toLowerCase() ===
    out.OMNI_COMMS_TEST_DEPARTMENT_ID.toLowerCase()
  ) {
    refuse('OMNI_COMMS_TEST_FOREIGN_DEPARTMENT_ID equals the primary test department');
  }

  out.OMNI_COMMS_TEST_CALLER_MODULE = out.OMNI_COMMS_TEST_CALLER_MODULE.toUpperCase();
  out.OMNI_COMMS_TEST_UNAUTHORISED_MODULE =
    out.OMNI_COMMS_TEST_UNAUTHORISED_MODULE.toUpperCase();
  if (out.OMNI_COMMS_TEST_CALLER_MODULE === out.OMNI_COMMS_TEST_UNAUTHORISED_MODULE) {
    refuse(
      'OMNI_COMMS_TEST_UNAUTHORISED_MODULE equals the authorised caller module — ' +
        'the negative module scenario would prove nothing',
    );
  }
  return out;
}

/**
 * Read the `sub` claim from a JWT WITHOUT verifying it. Used only to identify
 * the actor for read-only preflight capability checks performed with the
 * service role. The token itself is never printed and never logged.
 */
function decodeJwtSubject(jwt: string): string | null {
  try {
    const [, payload] = jwt.split('.');
    if (!payload) return null;
    const json = Buffer.from(
      payload.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8');
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === 'string' && UUID_RE.test(sub) ? sub : null;
  } catch {
    return null;
  }
}


/* ── scenario bookkeeping ──────────────────────────────────────────────── */

interface ScenarioResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: ScenarioResult[] = [];

class AssertionFailure extends Error {}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AssertionFailure(message);
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new AssertionFailure(`${label}: expected ${e}, got ${a}`);
}

async function scenario(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    const detail = await fn();
    results.push({ name, passed: true, detail });
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown failure';
    results.push({ name, passed: false, detail });
    console.error(`  FAIL  ${name} — ${detail}`);
  }
}

/* ── runtime invocation ────────────────────────────────────────────────── */

interface RuntimeResponse {
  httpStatus: number;
  body: Record<string, unknown>;
}

async function invokeRuntime(
  env: Env,
  jwt: string | null,
  body: unknown,
): Promise<RuntimeResponse> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    apikey: env.SUPABASE_ANON_KEY,
  };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;

  const res = await fetch(`${env.SUPABASE_URL}/functions/v1/omni-comms-runtime`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await res.json()) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return { httpStatus: res.status, body: parsed };
}

function blockersOf(body: Record<string, unknown>): string[] {
  return Array.isArray(body.blockers)
    ? (body.blockers as unknown[]).filter((b): b is string => typeof b === 'string')
    : [];
}

function messagesOf(body: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(body.messages)
    ? (body.messages as Array<Record<string, unknown>>)
    : [];
}

/* ── fixtures ──────────────────────────────────────────────────────────── */

// Tenant-isolation fixtures are supplied as REAL staging identifiers through
// the protected environment. Fixed synthetic UUID constants are deliberately
// absent: rejecting a nonexistent id proves nothing about tenant isolation.
const CONTRACT_VERSION = 'omni_comms.result.v1';


/**
 * The number of scenarios this harness is CONTRACTUALLY required to execute.
 * The run fails when the executed count differs, so the reported figure can
 * never overstate (or understate) what was actually proven.
 */
const EXPECTED_SCENARIO_COUNT = 19;

/**
 * Terminal message status per execution mode. A message is only transiently
 * `rendered`; persistence immediately advances it to the mode-derived
 * terminal status. Asserting `rendered` would certify the wrong state.
 */
const TERMINAL_MESSAGE_STATUS: Record<string, string> = {
  dry_run: 'dry_run_completed',
  shadow: 'shadow_completed',
  queued: 'held',
};


function baseRequest(env: Env, prefix: string, suffix: string, mode: string) {
  return {
    eventCode: env.OMNI_COMMS_TEST_EVENT_CODE,
    organizationId: env.OMNI_COMMS_TEST_ORGANIZATION_ID,
    departmentId: env.OMNI_COMMS_TEST_DEPARTMENT_ID,
    mode,
    idempotencyKey: `${prefix}-${suffix}`,
    requestedChannels: ['email'],
    // Every valid request certifies the ACTUAL pilot business-module caller
    // path, never a generic direct-caller placeholder.
    callerContext: { moduleCode: env.OMNI_COMMS_TEST_CALLER_MODULE },

    recipients: [
      {
        recipientType: 'primary',
        recipientReference: `${prefix}-r1`,
        displayName: 'Harness Recipient',
        locale: 'en-US',
        email: `${prefix}-r1@example.com`,
      },
    ],
    payload: {
      harness: true,
      fixturePrefix: prefix,
      claimReference: `${prefix}-CLAIM`,
      approvedAmount: '100.00',
    },
  };
}

/* ── persisted-state queries (service-role) ────────────────────────────── */

async function countRows(
  admin: SupabaseClient,
  table: string,
  filter: (q: ReturnType<SupabaseClient['from']>) => unknown,
): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = (admin.from(table).select('id', { count: 'exact', head: true }) as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count, error } = await (filter(q) as any);
  if (error) throw new AssertionFailure(`count(${table}) failed: ${error.message}`);
  return count ?? 0;
}

async function requestIdsForPrefix(admin: SupabaseClient, prefix: string): Promise<string[]> {
  const { data, error } = await admin
    .from('omni_comms_request')
    .select('id')
    .like('idempotency_key', `${prefix}%`);
  if (error) throw new AssertionFailure(`request lookup failed: ${error.message}`);
  return (data ?? []).map((r) => (r as { id: string }).id);
}

/* ── main ──────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const env = readEnv();

  // Certification is bound to an EXACT source revision. Without it the run
  // certifies nothing identifiable and is refused.
  const commitSha = (process.env.COMMIT_SHA ?? process.env.GITHUB_SHA ?? '').trim();
  if (!/^[0-9a-f]{40}$/i.test(commitSha)) {
    refuse('COMMIT_SHA/GITHUB_SHA must be a full 40-character git revision');
  }
  const requireEdgeRevision = process.env.OMNI_COMMS_REQUIRE_EDGE_REVISION === '1';
  const callerModule = env.OMNI_COMMS_TEST_CALLER_MODULE;
  const unauthorisedModule = env.OMNI_COMMS_TEST_UNAUTHORISED_MODULE;


  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const prefix = `oc-harness-${Date.now().toString(36)}`;
  console.log('Omni-Comms privileged runtime certification');
  console.log(`  fixture prefix: ${prefix}`);
  console.log('');

  // Edge deployment identity — proves WHICH build was certified.
  let edgeDeployment = 'unknown';
  let edgeRevision = 'unknown';
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/functions/v1/omni-comms-runtime/health`,
      { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.OMNI_COMMS_TEST_USER_JWT}` } },
    );
    const health = (await res.json()) as { buildTag?: string; revision?: string | null };
    edgeDeployment = health.buildTag ?? 'unknown';
    edgeRevision = typeof health.revision === 'string' && health.revision.length > 0
      ? health.revision
      : 'unset';
  } catch {
    edgeDeployment = 'unreachable';
    edgeRevision = 'unreachable';
  }
  const edgeRevisionMatchesCommit =
    edgeRevision.toLowerCase() === commitSha.toLowerCase();

  /* ── PREFLIGHT: source/deployment binding ──────────────────────────────
   * Revision binding is NOT a scenario. It is a precondition: a run against
   * an unidentified or mismatched deployment certifies nothing, so it is
   * refused before a single fixture is created.
   */
  if (edgeRevision === 'unreachable') {
    refuse('the deployed Edge Function health probe is unreachable');
  }
  if (requireEdgeRevision) {
    if (edgeRevision === 'unset') {
      refuse('deployed Edge Function does not publish OMNI_COMMS_EDGE_REVISION');
    }
    if (!edgeRevisionMatchesCommit) {
      refuse('deployed Edge revision does not equal the certified commit');
    }
    console.log('  preflight: deployed Edge revision equals the certified commit');
  } else {
    console.log(
      `  preflight: edge revision ${edgeRevision === 'unset' ? 'not published' : 'published'} ` +
        `(non-enforcing run; matches_commit=${edgeRevisionMatchesCommit})`,
    );
  }
  console.log('');

  /* ── PREFLIGHT: tenant-isolation fixtures must be REAL ─────────────────
   * A rejection of a nonexistent organisation or department proves nothing
   * about tenant isolation. Both foreign fixtures must exist in staging
   * before the corresponding negative scenario is allowed to run.
   */
  const actorId = decodeJwtSubject(env.OMNI_COMMS_TEST_USER_JWT);
  if (!actorId) refuse('OMNI_COMMS_TEST_USER_JWT carries no subject claim');

  const foreignOrg = await admin
    .from('core_organization')
    .select('id')
    .eq('id', env.OMNI_COMMS_TEST_FOREIGN_ORGANIZATION_ID)
    .maybeSingle();
  if (foreignOrg.error) {
    refuse('foreign organisation lookup failed');
  }
  if (!foreignOrg.data) {
    refuse(
      'OMNI_COMMS_TEST_FOREIGN_ORGANIZATION_ID does not exist in staging — ' +
        'a nonexistent id cannot prove tenant isolation',
    );
  }

  const foreignDept = await admin
    .from('core_department')
    .select('id, organization_id')
    .eq('id', env.OMNI_COMMS_TEST_FOREIGN_DEPARTMENT_ID)
    .maybeSingle();
  if (foreignDept.error) {
    refuse('foreign department lookup failed');
  }
  if (!foreignDept.data) {
    refuse(
      'OMNI_COMMS_TEST_FOREIGN_DEPARTMENT_ID does not exist in staging — ' +
        'a nonexistent id cannot prove department entitlement enforcement',
    );
  }
  console.log('  preflight: foreign organisation and department fixtures exist');

  /* ── PREFLIGHT: the certified caller module must be the real pilot path ── */
  const { data: callerReg, error: callerRegErr } = await admin
    .from('omni_comms_caller_module_registry')
    .select('module_code, permission_module, permission_action, is_active')
    .eq('module_code', callerModule)
    .maybeSingle();
  if (callerRegErr) refuse('caller-module registry lookup failed');
  if (!callerReg) {
    refuse(`OMNI_COMMS_TEST_CALLER_MODULE ${callerModule} is not registered`);
  }
  const reg = callerReg as {
    permission_module: string;
    permission_action: string;
    is_active: boolean;
  };
  if (reg.is_active !== true) {
    refuse(`OMNI_COMMS_TEST_CALLER_MODULE ${callerModule} is registered but inactive`);
  }
  const { data: hasCap, error: capErr } = await admin.rpc('has_permission', {
    _user_id: actorId,
    _module_name: reg.permission_module,
    _action_name: reg.permission_action,
  });
  if (capErr) refuse('caller-module capability check failed');
  if (hasCap !== true) {
    refuse(
      `the authorised test actor does not hold the capability required by ` +
        `caller module ${callerModule}`,
    );
  }
  console.log(
    `  preflight: caller module ${callerModule} is registered, active and authorised`,
  );
  console.log('');


  let firstRequestId = '';
  let firstMessages: Array<Record<string, unknown>> = [];
  let firstRecipientIds: string[] = [];




  /* 1. Missing JWT must be rejected at the boundary. */
  await scenario('missing_jwt_rejection', async () => {
    const r = await invokeRuntime(env, null, baseRequest(env, prefix, 'nojwt', 'dry_run'));
    assertEqual(r.httpStatus, 401, 'http status');
    assertEqual(blockersOf(r.body), ['authentication_required'], 'blockers');
    const persisted = await requestIdsForPrefix(admin, `${prefix}-nojwt`);
    assertEqual(persisted.length, 0, 'persisted requests');
    return 'HTTP 401, authentication_required, nothing persisted';
  });

  /* 2. Authenticated but WITHOUT the Omni-Comms execution capability. */
  await scenario('permission_rejection', async () => {
    const r = await invokeRuntime(
      env,
      env.OMNI_COMMS_TEST_UNPRIVILEGED_JWT,
      baseRequest(env, prefix, 'noperm', 'dry_run'),
    );
    assertEqual(r.httpStatus, 403, 'http status');
    assertEqual(blockersOf(r.body), ['permission_denied'], 'blockers');
    const persisted = await requestIdsForPrefix(admin, `${prefix}-noperm`);
    assertEqual(persisted.length, 0, 'persisted requests');
    return 'HTTP 403, permission_denied, nothing persisted';
  });

  /* 3. Cross-tenant submission must be refused server-side. */
  await scenario('cross_tenant_rejection', async () => {
    const body = {
      ...baseRequest(env, prefix, 'xtenant', 'dry_run'),
      organizationId: RANDOM_ORG_ID,
      departmentId: null,
    };
    const r = await invokeRuntime(env, env.OMNI_COMMS_TEST_USER_JWT, body);
    assertEqual(r.httpStatus, 403, 'http status');
    const b = blockersOf(r.body);
    assert(
      b.length === 1 && b[0] === 'organization_access_denied',
      `expected ["organization_access_denied"], got ${JSON.stringify(b)}`,
    );
    const persisted = await requestIdsForPrefix(admin, `${prefix}-xtenant`);
    assertEqual(persisted.length, 0, 'persisted requests');
    return 'HTTP 403, organization_access_denied, nothing persisted';
  });

  /* 4. Spoofed caller module must be refused. */
  await scenario('spoofed_caller_module_rejection', async () => {
    const body = {
      ...baseRequest(env, prefix, 'spoof', 'dry_run'),
      callerContext: { moduleCode: 'NOT_A_REGISTERED_MODULE' },
    };
    const r = await invokeRuntime(env, env.OMNI_COMMS_TEST_USER_JWT, body);
    assertEqual(r.httpStatus, 403, 'http status');
    assertEqual(blockersOf(r.body), ['caller_module_not_registered'], 'blockers');
    const persisted = await requestIdsForPrefix(admin, `${prefix}-spoof`);
    assertEqual(persisted.length, 0, 'persisted requests');
    return 'HTTP 403, caller_module_not_registered, nothing persisted';
  });

  /* 4b. Department the actor is not entitled to must be refused. */
  await scenario('department_access_rejection', async () => {
    const body = {
      ...baseRequest(env, prefix, 'xdept', 'dry_run'),
      departmentId: RANDOM_DEPARTMENT_ID,
    };
    const r = await invokeRuntime(env, env.OMNI_COMMS_TEST_USER_JWT, body);
    assertEqual(r.httpStatus, 403, 'http status');
    const b = blockersOf(r.body);
    assert(
      b.length === 1 &&
        (b[0] === 'department_access_denied' || b[0] === 'department_organization_mismatch'),
      `expected a single department refusal code, got ${JSON.stringify(b)}`,
    );
    assertEqual(r.body.contractVersion, CONTRACT_VERSION, 'contract version');
    const persisted = await requestIdsForPrefix(admin, `${prefix}-xdept`);
    assertEqual(persisted.length, 0, 'persisted requests');
    return `HTTP 403, ${b[0]}, nothing persisted`;
  });

  /* 4c. A REGISTERED caller module the actor may not act for must be refused. */
  await scenario('registered_but_unauthorised_module_rejection', async () => {
    const { data: reg, error: regErr } = await admin
      .from('omni_comms_caller_module_registry')
      .select('module_code, is_active')
      .eq('module_code', unauthorisedModule)
      .maybeSingle();
    assert(!regErr, `caller-module registry read failed: ${regErr?.message ?? ''}`);
    assert(
      reg != null && (reg as { is_active: boolean }).is_active === true,
      `${unauthorisedModule} is not an active registered caller module — the scenario cannot prove anything`,
    );

    const body = {
      ...baseRequest(env, prefix, 'unauthmod', 'dry_run'),
      callerContext: { moduleCode: unauthorisedModule },
    };
    const r = await invokeRuntime(env, env.OMNI_COMMS_TEST_USER_JWT, body);
    assertEqual(r.httpStatus, 403, 'http status');
    assertEqual(blockersOf(r.body), ['permission_denied'], 'blockers');
    const persisted = await requestIdsForPrefix(admin, `${prefix}-unauthmod`);
    assertEqual(persisted.length, 0, 'persisted requests');
    return `HTTP 403, permission_denied for registered module ${unauthorisedModule}`;
  });

  /* 5. Valid first request — full resolution + rendering. */
  await scenario('valid_first_request', async () => {
    const r = await invokeRuntime(
      env,
      env.OMNI_COMMS_TEST_USER_JWT,
      baseRequest(env, prefix, 'main', 'dry_run'),
    );
    assertEqual(r.httpStatus, 200, 'http status');
    assertEqual(r.body.contractVersion, 'omni_comms.result.v1', 'contract version');
    assertEqual(r.body.replayed, false, 'replayed');
    assert(typeof r.body.requestId === 'string' && r.body.requestId.length > 0, 'missing requestId');
    assertEqual(blockersOf(r.body), [], 'blockers');
    firstRequestId = r.body.requestId as string;
    firstMessages = messagesOf(r.body);
    assert(firstMessages.length > 0, 'no messages produced by a fully configured request');
    for (const m of firstMessages) {
      assert(typeof m.messageId === 'string' && m.messageId.length > 0, 'message missing messageId');
      assert(typeof m.channel === 'string' && m.channel.length > 0, 'message missing channel');
      assertEqual(m.status, TERMINAL_MESSAGE_STATUS.dry_run, 'message terminal status');
      assert('renderedChecksum' in m, 'message missing renderedChecksum key');
      assert('dispatchJobId' in m, 'message missing dispatchJobId key');
      assertEqual(m.dispatchJobId, null, 'dry_run message must carry no dispatch job');
    }
    // Recipients must be projected from PERSISTENCE, not echoed from input.
    const recips = Array.isArray(r.body.recipients)
      ? (r.body.recipients as Array<Record<string, unknown>>)
      : [];
    assert(recips.length > 0, 'no recipients projected on the fresh response');
    for (const rc of recips) {
      assert(
        typeof rc.recipientId === 'string' && rc.recipientId.length > 0,
        'fresh response recipient carries no persisted recipientId',
      );
      assert(!('email' in rc) && !('phone' in rc), 'recipient projection leaked a destination');
    }
    firstRecipientIds = recips.map((rc) => String(rc.recipientId));


    return `request ${firstRequestId.slice(0, 8)}…, ${firstMessages.length} message(s)`;
  });

  /* 6. Recipient persistence. */
  await scenario('recipient_persistence', async () => {
    assert(firstRequestId !== '', 'no first request to inspect');
    const { data, error } = await admin
      .from('omni_comms_recipient')
      .select('id')
      .eq('request_id', firstRequestId);
    assert(!error, `recipient read failed: ${error?.message ?? ''}`);
    const ids = ((data ?? []) as Array<{ id: string }>).map((x) => x.id).sort();
    assertEqual(ids.length, 1, 'persisted recipient count');
    // The response projection must be the persisted identity, not an echo.
    assertEqual(firstRecipientIds.slice().sort(), ids, 'projected vs persisted recipient ids');
    return '1 recipient persisted, identity matches the response projection';
  });


  /* 7. Deterministic resolution (route/template/layout/asset/sender). */
  await scenario('deterministic_resolution', async () => {
    const { data, error } = await admin
      .from('omni_comms_recipient')
      .select('resolution_snapshot')
      .eq('request_id', firstRequestId)
      .limit(1)
      .maybeSingle();
    assert(!error, `snapshot read failed: ${error?.message ?? ''}`);
    const stored = (data as { resolution_snapshot?: Record<string, unknown> } | null)
      ?.resolution_snapshot;
    assert(stored != null, 'no per-recipient resolution snapshot persisted');
    // The finalize RPC may store the per-recipient snapshot directly or nested.
    const snap = (
      (stored as Record<string, unknown>).channel_resolutions
        ? stored
        : ((stored as Record<string, unknown>).per_recipient_snapshot as Record<string, unknown>)
    ) as Record<string, unknown> | undefined;
    assert(snap != null, 'resolution snapshot carries no channel resolutions');
    const chans = (snap!.channel_resolutions ?? []) as Array<Record<string, unknown>>;
    assert(Array.isArray(chans) && chans.length > 0, 'no channel resolutions persisted');
    const email = chans.find((c) => c.channel === 'email');
    assert(email != null, 'email channel was not resolved');
    for (const key of [
      'route_id',
      'template_family_id',
      'template_version_id',
      'template_version_number',
      'template_version_checksum',
      'layout_id',
      'layout_version_id',
      'layout_checksum',
      'sender_identity_id',
      'sender_provider_binding_id',
      'provider_id',
      'provider_account_id',
    ]) {
      assert(email![key] != null, `resolution missing ${key}`);
    }
    // Checksums must be real sha-256 digests, not placeholders.
    for (const key of ['template_version_checksum', 'layout_checksum']) {
      const v = String(email![key]);
      assert(/^[0-9a-f]{64}$/i.test(v), `${key} is not a sha-256 digest`);
    }
    const assets = (email!.assets ?? []) as Array<Record<string, unknown>>;
    assert(Array.isArray(assets), 'assets must be an array');
    for (const a of assets) {
      if (a.required === true) {
        assert(a.asset_version_id != null, `required asset slot ${String(a.slot)} not pinned`);
        assert(
          typeof a.asset_checksum === 'string' && /^[0-9a-f]{64}$/i.test(a.asset_checksum),
          `required asset slot ${String(a.slot)} has no sha-256 checksum`,
        );
      }
    }
    assert(email!.live_delivery_ready !== true, 'live delivery must never be reported ready');
    return `route, template v${String(email!.template_version_number)}, layout, ${assets.length} asset(s), sender all pinned`;
  });

  /* 8. Deterministic rendering — persisted checksum present and stable. */
  await scenario('deterministic_rendering', async () => {
    const { data, error } = await admin
      .from('omni_comms_message')
      .select('id, rendered_checksum, status, unresolved_tokens, unresolved_required_slots, blockers')
      .eq('request_id', firstRequestId);
    assert(!error, `message read failed: ${error?.message ?? ''}`);
    const rows = (data ?? []) as Array<{
      id: string;
      rendered_checksum: string | null;
      status: string;
      unresolved_tokens: unknown;
      unresolved_required_slots: unknown;
      blockers: unknown;
    }>;
    assertEqual(rows.length, firstMessages.length, 'persisted message count vs response');
    const responseIds = firstMessages.map((m) => String(m.messageId)).sort();
    assertEqual(rows.map((r) => r.id).sort(), responseIds, 'persisted message ids vs response');
    let rendered = 0;
    for (const row of rows) {
      // `rendered` is transient. The persisted terminal status for a dry_run
      // is `dry_run_completed`; asserting `rendered` would certify a state the
      // runtime never leaves behind.
      assertEqual(
        row.status,
        TERMINAL_MESSAGE_STATUS.dry_run,
        `message ${row.id.slice(0, 8)} terminal status`,
      );
      assert(
        typeof row.rendered_checksum === 'string' && /^[0-9a-f]{64}$/i.test(row.rendered_checksum),
        'rendered message has no sha-256 checksum',
      );
      assertEqual(
        Array.isArray(row.unresolved_required_slots) ? row.unresolved_required_slots : [],
        [],
        'unresolved required slots',
      );
      assertEqual(Array.isArray(row.blockers) ? row.blockers : [], [], 'message blockers');
      rendered += 1;
    }

    // Response projection must carry the same checksums as persistence.
    const byId = new Map(rows.map((r) => [r.id, r.rendered_checksum]));
    for (const m of firstMessages) {
      assertEqual(
        m.renderedChecksum,
        byId.get(String(m.messageId)),
        'response checksum vs persisted checksum',
      );
    }
    return `${rendered} message(s) rendered deterministically with matching checksums`;
  });

  /* 9. Identical replay returns the SAME bounded messages. */
  await scenario('identical_replay', async () => {
    const r = await invokeRuntime(
      env,
      env.OMNI_COMMS_TEST_USER_JWT,
      baseRequest(env, prefix, 'main', 'dry_run'),
    );
    assertEqual(r.httpStatus, 200, 'http status');
    assertEqual(r.body.contractVersion, CONTRACT_VERSION, 'contract version');
    assertEqual(r.body.replayed, true, 'replayed flag');
    assertEqual(r.body.requestId, firstRequestId, 'replay requestId');
    assertEqual(blockersOf(r.body), [], 'replay blockers');
    const replayMessages = messagesOf(r.body);
    assertEqual(replayMessages.length, firstMessages.length, 'replay message count');
    const norm = (m: Array<Record<string, unknown>>) =>
      m
        .map((x) =>
          `${x.messageId}|${x.channel}|${x.status}|${x.renderedChecksum ?? ''}|${x.dispatchJobId ?? ''}`)
        .sort();
    assertEqual(norm(replayMessages), norm(firstMessages), 'replay message projection');
    // Recipient projection must be identical to the fresh response and must
    // come from the same canonical persisted source.
    const replayRecips = Array.isArray(r.body.recipients)
      ? (r.body.recipients as Array<Record<string, unknown>>)
      : [];
    assertEqual(
      replayRecips.map((x) => String(x.recipientId)).sort(),
      firstRecipientIds.slice().sort(),
      'replay recipient identity',
    );

    const total = await countRows(admin, 'omni_comms_request', (q) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (q as any).like('idempotency_key', `${prefix}-main`));
    assertEqual(total, 1, 'replay must not create a second request');
    const msgs = await countRows(admin, 'omni_comms_message', (q) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (q as any).eq('request_id', firstRequestId));
    assertEqual(msgs, firstMessages.length, 'replay must not create additional messages');
    return 'same messages, same checksums, no duplicate request';
  });

  /* 10. Mismatched replay (same key, different payload) must be rejected. */
  await scenario('mismatched_replay_rejection', async () => {
    const body = baseRequest(env, prefix, 'main', 'dry_run');
    body.payload = { ...body.payload, approvedAmount: '999.99' };
    const r = await invokeRuntime(env, env.OMNI_COMMS_TEST_USER_JWT, body);
    assertEqual(r.httpStatus, 200, 'http status');
    assertEqual(r.body.contractVersion, CONTRACT_VERSION, 'contract version');
    assertEqual(r.body.status, 'blocked', 'status');
    assertEqual(blockersOf(r.body), ['idempotency_payload_mismatch'], 'blockers');
    assertEqual(messagesOf(r.body).length, 0, 'rejected replay messages');
    const total = await countRows(admin, 'omni_comms_request', (q) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (q as any).like('idempotency_key', `${prefix}-main`));
    assertEqual(total, 1, 'rejected replay must not persist');
    const msgs = await countRows(admin, 'omni_comms_message', (q) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (q as any).eq('request_id', firstRequestId));
    assertEqual(msgs, firstMessages.length, 'rejected replay must not create messages');
    return 'idempotency_payload_mismatch, nothing persisted';
  });

  /* 10b. Concurrent identical submissions collapse to exactly one request. */
  await scenario('concurrent_idempotency_semantics', async () => {
    const body = baseRequest(env, prefix, 'concurrent', 'dry_run');
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => invokeRuntime(env, env.OMNI_COMMS_TEST_USER_JWT, body)),
    );
    for (const r of responses) {
      assertEqual(r.httpStatus, 200, 'http status');
      assertEqual(r.body.contractVersion, CONTRACT_VERSION, 'contract version');
      assertEqual(blockersOf(r.body), [], 'blockers');
    }
    const ids = new Set(responses.map((r) => String(r.body.requestId)));
    assertEqual(ids.size, 1, 'distinct requestIds across concurrent submissions');
    const requestId = [...ids][0];
    assert(requestId.length > 0, 'concurrent submissions produced no requestId');

    const persisted = await requestIdsForPrefix(admin, `${prefix}-concurrent`);
    assertEqual(persisted.length, 1, 'persisted request rows');

    const projections = responses.map((r) =>
      messagesOf(r.body)
        .map((m) => `${m.messageId}|${m.channel}|${m.status}|${m.renderedChecksum ?? ''}`)
        .sort()
        .join(','));
    assertEqual(new Set(projections).size, 1, 'divergent message projections');

    const msgCount = await countRows(admin, 'omni_comms_message', (q) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (q as any).eq('request_id', requestId));
    assertEqual(
      msgCount,
      messagesOf(responses[0].body).length,
      'duplicate messages created under concurrency',
    );
    const jobs = await countRows(admin, 'omni_comms_dispatch_job', (q) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (q as any).eq('request_id', requestId));
    assertEqual(jobs, 0, 'dry_run concurrency must not create dispatch jobs');
    return '4 concurrent submissions → 1 request, identical projections, no duplicates';
  });

  /* 11. dry_run creates messages but NO dispatch jobs. */
  await scenario('dry_run_creates_no_jobs', async () => {
    const messages = await countRows(admin, 'omni_comms_message', (q) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (q as any).eq('request_id', firstRequestId));
    assert(messages > 0, 'dry_run produced no messages');
    const { data: msgRows } = await admin
      .from('omni_comms_message').select('id').eq('request_id', firstRequestId);
    const ids = (msgRows ?? []).map((m) => (m as { id: string }).id);
    const jobs = await countRows(admin, 'omni_comms_dispatch_job', (q) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (q as any).in('message_id', ids));
    assertEqual(jobs, 0, 'dry_run dispatch jobs');
    return `${messages} message(s), 0 dispatch jobs`;
  });

  /* 12 + 13. shadow and queued create HELD, non-runnable jobs only. */
  for (const mode of ['shadow', 'queued'] as const) {
    await scenario(`${mode}_creates_held_jobs_only`, async () => {
      const r = await invokeRuntime(
        env,
        env.OMNI_COMMS_TEST_USER_JWT,
        baseRequest(env, prefix, mode, mode),
      );
      assertEqual(r.httpStatus, 200, 'http status');
      assertEqual(r.body.contractVersion, CONTRACT_VERSION, 'contract version');
      assertEqual(r.body.mode, mode, 'mode echoed');
      assertEqual(blockersOf(r.body), [], 'blockers');
      const requestId = r.body.requestId as string;
      assert(typeof requestId === 'string' && requestId.length > 0, 'no requestId');
      const { data: msgRows } = await admin
        .from('omni_comms_message').select('id, status').eq('request_id', requestId);
      const rows = (msgRows ?? []) as Array<{ id: string; status: string }>;
      const ids = rows.map((m) => m.id);
      assert(ids.length > 0, `${mode} produced no messages`);
      assertEqual(messagesOf(r.body).length, ids.length, 'response vs persisted message count');
      // Terminal status is mode-derived, never the transient `rendered`.
      for (const row of rows) {
        assertEqual(row.status, TERMINAL_MESSAGE_STATUS[mode], `${mode} terminal message status`);
      }
      for (const m of messagesOf(r.body)) {
        assertEqual(m.status, TERMINAL_MESSAGE_STATUS[mode], `${mode} response message status`);
        assert(
          typeof m.dispatchJobId === 'string' && m.dispatchJobId.length > 0,
          `${mode} message carries no held dispatch job id`,
        );
      }

      const { data: jobRows, error: jobErr } = await admin
        .from('omni_comms_dispatch_job')
        .select('id, status, is_runnable, hold_reason, attempt_count, locked_at, lease_expires_at')
        .in('message_id', ids);
      assert(!jobErr, `job read failed: ${jobErr?.message ?? ''}`);
      const jobs = (jobRows ?? []) as Array<{
        status: string;
        is_runnable: boolean | null;
        hold_reason: string | null;
        attempt_count: number | null;
        locked_at: string | null;
        lease_expires_at: string | null;
      }>;
      assert(jobs.length > 0, `${mode} produced no dispatch job`);
      for (const j of jobs) {
        assertEqual(j.status, 'held', 'job status');
        assertEqual(j.is_runnable, false, 'job is_runnable');
        assert(j.hold_reason != null && j.hold_reason !== '', 'held job carries no hold reason');
        assertEqual(j.attempt_count ?? 0, 0, 'job attempt count');
        assertEqual(j.locked_at, null, 'job locked_at');
        assertEqual(j.lease_expires_at, null, 'job lease_expires_at');
      }
      // Every message must have an auditable timeline entry.
      const events = await countRows(admin, 'omni_comms_message_event', (q) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (q as any).in('message_id', ids));
      assert(events > 0, `${mode} produced no message timeline events`);
      // And no delivery attempt may exist for them.
      const attempts = await countRows(admin, 'omni_comms_delivery_attempt', (q) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (q as any).in('message_id', ids));
      assertEqual(attempts, 0, 'delivery attempts');
      return `${jobs.length} held job(s), 0 runnable, ${events} timeline event(s), 0 attempts`;
    });
  }

  /* 14. Atomic failure — an invalid event code persists nothing. */
  await scenario('atomic_failure_no_partial_records', async () => {
    const body = {
      ...baseRequest(env, prefix, 'atomic', 'dry_run'),
      eventCode: `${prefix.toUpperCase()}.NO.SUCH.EVENT`,
    };
    const r = await invokeRuntime(env, env.OMNI_COMMS_TEST_USER_JWT, body);
    const b = blockersOf(r.body);
    assert(b.length > 0, 'invalid event code was accepted without a blocker');
    const ids = await requestIdsForPrefix(admin, `${prefix}-atomic`);
    if (ids.length > 0) {
      // A request row may exist, but it must be terminal-blocked with no
      // messages and no jobs — never a partial success.
      const { data } = await admin
        .from('omni_comms_request').select('status').in('id', ids);
      for (const row of (data ?? []) as Array<{ status: string }>) {
        assertEqual(row.status, 'blocked', 'aborted request status');
      }
      const msgs = await countRows(admin, 'omni_comms_message', (q) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (q as any).in('request_id', ids));
      assertEqual(msgs, 0, 'messages for aborted request');
    }
    return `blocked (${b.join(',')}), no partial records`;
  });

  /* 15-18. Global safety invariants across every fixture request. */
  const allRequestIds = await requestIdsForPrefix(admin, prefix);
  let messageCount = 0;
  let dispatchJobCount = 0;
  let runnableJobCount = 0;
  let deliveryAttemptCount = 0;
  let providerCallCount = 0;
  let emailCount = 0;
  let fixtureMessageIds: string[] = [];

  await scenario('safety_invariants', async () => {
    const { data: msgRows } = await admin
      .from('omni_comms_message').select('id, channel').in('request_id', allRequestIds);
    const msgs = (msgRows ?? []) as Array<{ id: string; channel: string }>;
    fixtureMessageIds = msgs.map((m) => m.id);
    messageCount = msgs.length;

    const { data: jobRows } = await admin
      .from('omni_comms_dispatch_job')
      .select('id, status, is_runnable')
      .in('message_id', fixtureMessageIds);
    const jobs = (jobRows ?? []) as Array<{ id: string; status: string; is_runnable: boolean | null }>;
    dispatchJobCount = jobs.length;
    runnableJobCount = jobs.filter((j) => j.status !== 'held' || j.is_runnable === true).length;
    assertEqual(runnableJobCount, 0, 'runnable dispatch jobs');

    // Provider contact is measured, never assumed: a provider call can only
    // exist as a delivery attempt row, and an email can only exist as an
    // attempt against an email-channel message.
    //
    // The measurement is SCOPED TO THIS RUN'S FIXTURES. A global count would
    // make the result depend on unrelated rows in the shared staging project
    // and could fail (or pass) for reasons this harness did not cause.
    const { data: attemptRows, error: attemptErr } = fixtureMessageIds.length
      ? await admin
          .from('omni_comms_delivery_attempt')
          .select('id, message_id, provider_id')
          .in('message_id', fixtureMessageIds)
      : { data: [] as Array<Record<string, unknown>>, error: null };
    assert(!attemptErr, `delivery attempt read failed: ${attemptErr?.message ?? ''}`);
    const attempts = (attemptRows ?? []) as Array<{
      message_id: string | null;
      provider_id: string | null;
    }>;
    deliveryAttemptCount = attempts.length;
    assertEqual(deliveryAttemptCount, 0, 'delivery attempts (fixture-scoped)');
    providerCallCount = attempts.filter((a) => a.provider_id != null).length;
    const emailMessageIds = new Set(
      msgs.filter((m) => m.channel === 'email').map((m) => m.id),
    );
    emailCount = attempts.filter(
      (a) => a.message_id != null && emailMessageIds.has(a.message_id),
    ).length;
    assertEqual(providerCallCount, 0, 'provider calls');
    assertEqual(emailCount, 0, 'emails');

    return `${messageCount} message(s), ${dispatchJobCount} held job(s), 0 runnable, 0 delivery attempts, 0 provider calls, 0 emails (all fixture-scoped)`;
  });


  /* 19. Cleanup — remove exactly the fixture rows, then verify counts are 0. */
  let cleanupStatus = 'not_attempted';
  await scenario('cleanup_verified', async () => {
    const msgIds = fixtureMessageIds;

    const check = (label: string, error: { message?: string } | null) => {
      if (error) throw new AssertionFailure(`${label} delete failed: ${error.message ?? ''}`);
    };

    if (msgIds.length > 0) {
      check('dispatch_job', (await admin
        .from('omni_comms_dispatch_job').delete().in('message_id', msgIds)).error);
      check('message_event(message)', (await admin
        .from('omni_comms_message_event').delete().in('message_id', msgIds)).error);
      check('message', (await admin
        .from('omni_comms_message').delete().in('id', msgIds)).error);
    }
    if (allRequestIds.length > 0) {
      check('message_event(request)', (await admin
        .from('omni_comms_message_event').delete().in('request_id', allRequestIds)).error);
      check('recipient', (await admin
        .from('omni_comms_recipient').delete().in('request_id', allRequestIds)).error);
      check('request', (await admin
        .from('omni_comms_request').delete().in('id', allRequestIds)).error);
    }

    // Post-cleanup verification across EVERY fixture-owned table.
    const remainingRequests = (await requestIdsForPrefix(admin, prefix)).length;
    assertEqual(remainingRequests, 0, 'requests remaining after cleanup');

    const remaining = async (
      table: string,
      column: 'id' | 'message_id' | 'request_id',
      ids: string[],
    ) => (ids.length === 0
      ? 0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : countRows(admin, table, (q) => (q as any).in(column, ids)));

    assertEqual(await remaining('omni_comms_message', 'id', msgIds), 0, 'messages remaining');
    assertEqual(
      await remaining('omni_comms_dispatch_job', 'message_id', msgIds), 0, 'dispatch jobs remaining');
    assertEqual(
      await remaining('omni_comms_message_event', 'message_id', msgIds), 0, 'message events remaining');
    assertEqual(
      await remaining('omni_comms_recipient', 'request_id', allRequestIds), 0, 'recipients remaining');
    assertEqual(
      await remaining('omni_comms_message_event', 'request_id', allRequestIds),
      0,
      'request-scoped events remaining',
    );
    cleanupStatus = 'verified_clean';
    return 'all fixture rows removed; post-cleanup counts are zero across every fixture table';
  });
  if (cleanupStatus !== 'verified_clean') cleanupStatus = 'failed';

  /* ── truthful machine-readable summary ───────────────────────────────── */

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  // The reported scenario count must be the number ACTUALLY executed, and it
  // must equal the contractual inventory. Any drift (a scenario added, removed
  // or silently skipped) invalidates the run rather than misreporting coverage.
  const scenarioCountTruthful = results.length === EXPECTED_SCENARIO_COUNT;
  const executedScenarioNames = results.map((r) => r.name);
  const duplicateScenarioNames = executedScenarioNames.filter(
    (n, i) => executedScenarioNames.indexOf(n) !== i,
  );

  const summary = {
    commitSha,
    edgeRevision,
    edgeRevisionMatchesCommit,
    expectedScenarioCount: EXPECTED_SCENARIO_COUNT,
    scenarioCount: results.length,
    scenarioCountTruthful,
    executedScenarios: executedScenarioNames,
    passedCount: passed,
    failedCount: failed,
    fixturePrefix: prefix,
    cleanupStatus,
    edgeDeployment,
    messagesCreatedThenRemoved: messageCount,
    dispatchJobsCreatedAllHeld: dispatchJobCount,
    runnableJobCount,
    deliveryAttemptCount,
    providerCallCount,
    emailCount,
    safetyMeasurementScope: 'harness_fixtures_only',
  };


  // Human/CI-greppable field lines (contract consumed by the certification
  // workflow). Every value is measured, never assumed.
  console.log('');
  console.log(`commit_sha: ${commitSha}`);
  console.log(`scenarios: ${results.length} (expected ${EXPECTED_SCENARIO_COUNT})`);
  console.log(`scenario_count_truthful: ${scenarioCountTruthful}`);
  console.log(`executed_scenarios: ${executedScenarioNames.join(', ')}`);
  console.log(`passed: ${passed}`);
  console.log(`failed: ${failed}`);
  console.log(`fixture prefix: ${prefix}`);
  console.log(`cleanup: ${cleanupStatus === 'verified_clean' ? 'ok' : 'failed'}`);
  console.log(`edge_function: omni-comms-runtime (${edgeDeployment})`);
  console.log(`edge_revision: ${edgeRevision}`);
  console.log(`edge_revision_matches_commit: ${edgeRevisionMatchesCommit}`);
  console.log(
    `messages_created_then_removed: ${messageCount}`,
  );
  console.log(
    `no_message_remaining: ${cleanupStatus === 'verified_clean'} (${messageCount} created, then removed)`,
  );
  console.log(
    `no_runnable_dispatch_job: ${runnableJobCount === 0} (${dispatchJobCount} created, all held; ${runnableJobCount} runnable)`,
  );
  console.log(`no_delivery_attempt: ${deliveryAttemptCount === 0} (${deliveryAttemptCount} rows)`);
  console.log(`no_provider_call: ${providerCallCount === 0} (${providerCallCount} measured provider calls)`);
  console.log(`no_email: ${emailCount === 0} (${emailCount} measured email deliveries)`);
  console.log('');
  console.log('OMNI_COMMS_HARNESS_SUMMARY_JSON_BEGIN');
  console.log(JSON.stringify(summary, null, 2));
  console.log('OMNI_COMMS_HARNESS_SUMMARY_JSON_END');
  console.log('');



  const safetyBreached =
    runnableJobCount > 0 ||
    deliveryAttemptCount > 0 ||
    providerCallCount > 0 ||
    emailCount > 0;

  if (
    failed > 0 ||
    cleanupStatus !== 'verified_clean' ||
    safetyBreached ||
    !scenarioCountTruthful ||
    duplicateScenarioNames.length > 0 ||
    (requireEdgeRevision && !edgeRevisionMatchesCommit)
  ) {
    console.error(
      `[omni-comms:harness] ${failed} scenario(s) failed; cleanup=${cleanupStatus}; ` +
        `safetyBreached=${safetyBreached}; scenarioCountTruthful=${scenarioCountTruthful} ` +
        `(${results.length}/${EXPECTED_SCENARIO_COUNT}); ` +
        `duplicates=[${duplicateScenarioNames.join(',')}]; ` +
        `edgeRevisionMatchesCommit=${edgeRevisionMatchesCommit}`,
    );
    console.error('PRIVILEGED EDGE RESOLUTION INTEGRATION NOT EXECUTED');
    process.exit(3);
  }


  // Only reachable when every semantic assertion AND cleanup verification passed.
  console.log('BUILD 3 SLICE 2C-II EDGE RESOLUTION INTEGRATION OK');
}

main().catch((e) => {
  console.error('[omni-comms:harness] unexpected error');
  console.error(e instanceof Error ? e.message : 'unknown');
  console.error('PRIVILEGED EDGE RESOLUTION INTEGRATION NOT EXECUTED');
  process.exit(4);
});
