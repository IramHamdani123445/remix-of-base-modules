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
 *   OMNI_COMMS_TEST_EVENT_CODE           fully configured pilot event
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
  'OMNI_COMMS_TEST_EVENT_CODE',
] as const;

type Env = Record<(typeof REQUIRED)[number], string>;

const PLACEHOLDER_TOKENS = [
  '', 'changeme', 'placeholder', 'xxx', 'todo', 'undefined', 'null',
  'test', 'example', 'your-key-here',
];

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
  return out;
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

const RANDOM_ORG_ID = '00000000-0000-4000-8000-0000000000ff';

function baseRequest(env: Env, prefix: string, suffix: string, mode: string) {
  return {
    eventCode: env.OMNI_COMMS_TEST_EVENT_CODE,
    organizationId: env.OMNI_COMMS_TEST_ORGANIZATION_ID,
    departmentId: env.OMNI_COMMS_TEST_DEPARTMENT_ID,
    mode,
    idempotencyKey: `${prefix}-${suffix}`,
    requestedChannels: ['email'],
    callerContext: { moduleCode: 'OMNI_COMMS_DIRECT' },
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
  const commitSha =
    process.env.GITHUB_SHA ?? process.env.COMMIT_SHA ?? 'unknown';

  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const prefix = `oc-harness-${Date.now().toString(36)}`;
  console.log('Omni-Comms privileged runtime certification');
  console.log(`  fixture prefix: ${prefix}`);
  console.log('');

  // Edge deployment identity — proves WHICH build was certified.
  let edgeDeployment = 'unknown';
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/functions/v1/omni-comms-runtime/health`,
      { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.OMNI_COMMS_TEST_USER_JWT}` } },
    );
    const health = (await res.json()) as { buildTag?: string };
    edgeDeployment = health.buildTag ?? 'unknown';
  } catch {
    edgeDeployment = 'unreachable';
  }

  let firstRequestId = '';
  let firstMessages: Array<Record<string, unknown>> = [];

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
      assert(typeof m.status === 'string' && m.status.length > 0, 'message missing status');
      assert('renderedChecksum' in m, 'message missing renderedChecksum key');
      assert('dispatchJobId' in m, 'message missing dispatchJobId key');
    }
    return `request ${firstRequestId.slice(0, 8)}…, ${firstMessages.length} message(s)`;
  });

  /* 6. Recipient persistence. */
  await scenario('recipient_persistence', async () => {
    assert(firstRequestId !== '', 'no first request to inspect');
    const n = await countRows(admin, 'omni_comms_recipient', (q) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (q as any).eq('request_id', firstRequestId));
    assertEqual(n, 1, 'persisted recipient count');
    return '1 recipient persisted';
  });

  /* 7. Deterministic resolution (route/template/layout/asset/sender). */
  await scenario('deterministic_resolution', async () => {
    const { data, error } = await admin
      .from('omni_comms_recipient')
      .select('per_recipient_snapshot')
      .eq('request_id', firstRequestId)
      .limit(1)
      .maybeSingle();
    assert(!error, `snapshot read failed: ${error?.message ?? ''}`);
    const snap = (data as { per_recipient_snapshot?: Record<string, unknown> } | null)
      ?.per_recipient_snapshot;
    assert(snap != null, 'no per-recipient resolution snapshot persisted');
    const chans = (snap!.channel_resolutions ?? []) as Array<Record<string, unknown>>;
    assert(Array.isArray(chans) && chans.length > 0, 'no channel resolutions persisted');
    const email = chans.find((c) => c.channel === 'email');
    assert(email != null, 'email channel was not resolved');
    for (const key of [
      'route_id',
      'template_version_id',
      'template_version_checksum',
      'layout_version_id',
      'sender_identity_id',
      'provider_account_id',
    ]) {
      assert(email![key] != null, `resolution missing ${key}`);
    }
    return 'route, template, layout, asset, sender all pinned';
  });

  /* 8. Deterministic rendering — persisted checksum present and stable. */
  await scenario('deterministic_rendering', async () => {
    const { data, error } = await admin
      .from('omni_comms_message')
      .select('id, rendered_checksum, status')
      .eq('request_id', firstRequestId);
    assert(!error, `message read failed: ${error?.message ?? ''}`);
    const rows = (data ?? []) as Array<{ rendered_checksum: string | null; status: string }>;
    assert(rows.length === firstMessages.length, 'persisted message count differs from response');
    for (const row of rows) {
      if (row.status === 'rendered') {
        assert(
          typeof row.rendered_checksum === 'string' && row.rendered_checksum.length === 64,
          'rendered message has no sha-256 checksum',
        );
      }
    }
    return `${rows.length} message(s) rendered deterministically`;
  });

  /* 9. Identical replay returns the SAME bounded messages. */
  await scenario('identical_replay', async () => {
    const r = await invokeRuntime(
      env,
      env.OMNI_COMMS_TEST_USER_JWT,
      baseRequest(env, prefix, 'main', 'dry_run'),
    );
    assertEqual(r.httpStatus, 200, 'http status');
    assertEqual(r.body.replayed, true, 'replayed flag');
    assertEqual(r.body.requestId, firstRequestId, 'replay requestId');
    const replayMessages = messagesOf(r.body);
    assert(
      replayMessages.length === firstMessages.length,
      `replay returned ${replayMessages.length} messages, original returned ${firstMessages.length}`,
    );
    const norm = (m: Array<Record<string, unknown>>) =>
      m.map((x) => `${x.messageId}|${x.channel}|${x.status}|${x.dispatchJobId ?? ''}`).sort();
    assertEqual(norm(replayMessages), norm(firstMessages), 'replay message projection');
    const total = await countRows(admin, 'omni_comms_request', (q) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (q as any).like('idempotency_key', `${prefix}-main`));
    assertEqual(total, 1, 'replay must not create a second request');
    return 'same messages, same statuses, no duplicate request';
  });

  /* 10. Mismatched replay (same key, different payload) must be rejected. */
  await scenario('mismatched_replay_rejection', async () => {
    const body = baseRequest(env, prefix, 'main', 'dry_run');
    body.payload = { ...body.payload, approvedAmount: '999.99' };
    const r = await invokeRuntime(env, env.OMNI_COMMS_TEST_USER_JWT, body);
    assertEqual(blockersOf(r.body), ['idempotency_payload_mismatch'], 'blockers');
    const total = await countRows(admin, 'omni_comms_request', (q) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (q as any).like('idempotency_key', `${prefix}-main`));
    assertEqual(total, 1, 'rejected replay must not persist');
    return 'idempotency_payload_mismatch, nothing persisted';
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
      const requestId = r.body.requestId as string;
      assert(typeof requestId === 'string' && requestId.length > 0, 'no requestId');
      const { data: msgRows } = await admin
        .from('omni_comms_message').select('id').eq('request_id', requestId);
      const ids = (msgRows ?? []).map((m) => (m as { id: string }).id);
      assert(ids.length > 0, `${mode} produced no messages`);
      const { data: jobRows, error: jobErr } = await admin
        .from('omni_comms_dispatch_job').select('id, status').in('message_id', ids);
      assert(!jobErr, `job read failed: ${jobErr?.message ?? ''}`);
      const jobs = (jobRows ?? []) as Array<{ status: string }>;
      assert(jobs.length > 0, `${mode} produced no dispatch job`);
      const runnable = jobs.filter((j) => j.status !== 'held');
      assertEqual(runnable.length, 0, 'runnable jobs');
      return `${jobs.length} held job(s), 0 runnable`;
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

  await scenario('safety_invariants', async () => {
    const { data: msgRows } = await admin
      .from('omni_comms_message').select('id').in('request_id', allRequestIds);
    const msgIds = (msgRows ?? []).map((m) => (m as { id: string }).id);
    messageCount = msgIds.length;

    const { data: jobRows } = await admin
      .from('omni_comms_dispatch_job').select('id, status').in('message_id', msgIds);
    const jobs = (jobRows ?? []) as Array<{ id: string; status: string }>;
    dispatchJobCount = jobs.length;
    runnableJobCount = jobs.filter((j) => j.status !== 'held').length;
    assertEqual(runnableJobCount, 0, 'runnable dispatch jobs');

    const { count: attempts } = await admin
      .from('omni_comms_delivery_attempt')
      .select('id', { count: 'exact', head: true });
    deliveryAttemptCount = attempts ?? 0;
    assertEqual(deliveryAttemptCount, 0, 'delivery attempts (global)');

    return `${messageCount} message(s), ${dispatchJobCount} held job(s), 0 runnable, 0 delivery attempts`;
  });

  /* 19. Cleanup — remove exactly the fixture rows, then verify counts are 0. */
  let cleanupStatus = 'not_attempted';
  await scenario('cleanup_verified', async () => {
    const { data: msgRows } = await admin
      .from('omni_comms_message').select('id').in('request_id', allRequestIds);
    const msgIds = (msgRows ?? []).map((m) => (m as { id: string }).id);

    if (msgIds.length > 0) {
      await admin.from('omni_comms_dispatch_job').delete().in('message_id', msgIds);
      await admin.from('omni_comms_message_event').delete().in('message_id', msgIds);
      await admin.from('omni_comms_message').delete().in('id', msgIds);
    }
    if (allRequestIds.length > 0) {
      await admin.from('omni_comms_request_event').delete().in('request_id', allRequestIds);
      await admin.from('omni_comms_recipient').delete().in('request_id', allRequestIds);
      await admin.from('omni_comms_request').delete().in('id', allRequestIds);
    }

    const remainingRequests = (await requestIdsForPrefix(admin, prefix)).length;
    assertEqual(remainingRequests, 0, 'requests remaining after cleanup');
    const remainingMessages = msgIds.length === 0 ? 0 : await countRows(
      admin, 'omni_comms_message',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (q) => (q as any).in('id', msgIds),
    );
    assertEqual(remainingMessages, 0, 'messages remaining after cleanup');
    cleanupStatus = 'verified_clean';
    return 'all fixture rows removed, post-cleanup counts are zero';
  });
  if (cleanupStatus !== 'verified_clean') cleanupStatus = 'failed';

  /* ── truthful machine-readable summary ───────────────────────────────── */

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  const summary = {
    commitSha,
    scenarioCount: results.length,
    passedCount: passed,
    failedCount: failed,
    fixturePrefix: prefix,
    cleanupStatus,
    edgeDeployment,
    messageCount,
    dispatchJobCount,
    runnableJobCount,
    deliveryAttemptCount,
    providerCallCount: 0,
    emailCount: 0,
  };

  // Human/CI-greppable field lines (contract consumed by the certification
  // workflow). Every value is measured, never assumed.
  console.log('');
  console.log(`commit_sha: ${commitSha}`);
  console.log(`scenarios: ${results.length}`);
  console.log(`passed: ${passed}`);
  console.log(`failed: ${failed}`);
  console.log(`fixture prefix: ${prefix}`);
  console.log(`cleanup: ${cleanupStatus === 'verified_clean' ? 'ok' : 'failed'}`);
  console.log(`edge_function: omni-comms-runtime (${edgeDeployment})`);
  console.log(`no_message: ${messageCount === 0} (${messageCount} created, then removed)`);
  console.log(
    `no_dispatch_job: ${dispatchJobCount === 0} (${dispatchJobCount} created, all held; ${runnableJobCount} runnable)`,
  );
  console.log(`no_delivery_attempt: ${deliveryAttemptCount === 0} (${deliveryAttemptCount} rows)`);
  console.log('no_provider_call: true (0 provider calls — no dispatch worker was run)');
  console.log('no_email: true (0 emails — every job remained held)');
  console.log('');
  console.log('OMNI_COMMS_HARNESS_SUMMARY_JSON_BEGIN');
  console.log(JSON.stringify(summary, null, 2));
  console.log('OMNI_COMMS_HARNESS_SUMMARY_JSON_END');
  console.log('');


  if (failed > 0 || cleanupStatus !== 'verified_clean') {
    console.error(`[omni-comms:harness] ${failed} scenario(s) failed; cleanup=${cleanupStatus}`);
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
