/**
 * Build 4A — privileged authorization + atomicity certification harness.
 *
 * PURPOSE
 *   Executes the remaining Build 4A privileged scenarios (authorization,
 *   prerequisite failure, late-stage rollback, retry, replay, concurrency)
 *   against a protected STAGING environment using isolated certification
 *   fixtures and protected credentials.
 *
 * SAFETY CONTRACT
 *   - Never modifies Build 4A product logic, grants, RLS or JWT verification.
 *   - Never calls the private bootstrap RPC as a substitute for the public
 *     boundary; every scenario goes through
 *     public.omni_comms_bootstrap_employer_registration_pilot.
 *   - Never touches real tenants: the certification organisation codes must
 *     carry the certification namespace prefix, and the harness refuses to run
 *     against a runtime environment that is not authoritatively non-production.
 *   - Never triggers provider delivery: dispatch jobs, delivery attempts,
 *     provider calls, emails, webhook events and messages are measured and
 *     asserted to be zero.
 *   - Removes every fixture it creates and verifies cleanup, including after
 *     failed scenarios.
 *   - Prints no credential, JWT, database URL or authorization header.
 *
 * MARKERS (printed only when everything applicable passed)
 *   OMNI COMMS BUILD 4A AUTHORIZATION INTEGRATION OK
 *   OMNI COMMS BUILD 4A ATOMICITY INTEGRATION OK
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/* ------------------------------------------------------------------ */
/* Environment                                                         */
/* ------------------------------------------------------------------ */

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const DB_URL = process.env.OMNI_COMMS_STAGING_DB_URL ?? '';

const JWT_CONFIGURE = process.env.OMNI_COMMS_CERT_CONFIGURE_JWT ?? '';
const JWT_UNPRIVILEGED = process.env.OMNI_COMMS_CERT_UNPRIVILEGED_JWT ?? '';
const JWT_FOREIGN_TENANT = process.env.OMNI_COMMS_CERT_FOREIGN_TENANT_JWT ?? '';

const CERT_ORG_ID = process.env.OMNI_COMMS_CERT_ORGANIZATION_ID ?? '';
const CERT_FOREIGN_ORG_ID = process.env.OMNI_COMMS_CERT_FOREIGN_ORGANIZATION_ID ?? '';
const CERT_NAMESPACE = process.env.OMNI_COMMS_CERT_NAMESPACE ?? '';
const COMMIT_SHA = process.env.COMMIT_SHA ?? process.env.GITHUB_SHA ?? '';

const BOOTSTRAP_FN = 'omni_comms_bootstrap_employer_registration_pilot';
const PRIVATE_BOOTSTRAP_FN = 'omni_comms_priv_bootstrap_employer_registration_pilot';
const PILOT_EVENT_CODE = 'REGISTRATION.EMPLOYER.APPLICATION_SUBMITTED';
const PILOT_MODULE_CODE = 'EMPLOYER_REGISTRATION';
const PILOT_FAMILY_CODE = 'pilot_registration_employer_application_submitted';

/** Every Build 4A bootstrap table whose certification-scoped rows are counted. */
const SCOPED_TABLES = [
  'omni_comms_producer_event_binding',
  'omni_comms_event_route',
  'omni_comms_template_family',
] as const;

/* ------------------------------------------------------------------ */
/* Reporting primitives                                                */
/* ------------------------------------------------------------------ */

interface ScenarioResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: ScenarioResult[] = [];
let refusal: string | null = null;

function refuse(reason: string): never {
  refusal = reason;
  console.log(`REFUSED — ${reason}`);
  console.log('BUILD 4A IMPLEMENTED — PRIVILEGED CERTIFICATION INCOMPLETE');
  process.exit(3);
}

async function scenario(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`PASS  ${name} — ${detail}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, detail });
    console.log(`FAIL  ${name} — ${detail}`);
  }
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

/* ------------------------------------------------------------------ */
/* Database access (service-role, fixture provisioning only)           */
/* ------------------------------------------------------------------ */

async function sql(query: string): Promise<string[][]> {
  const { stdout } = await execFileAsync(
    'psql',
    [DB_URL, '--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '-At', '-F', '\u0001', '-c', query],
    { env: { ...process.env, PGSSLMODE: process.env.PGSSLMODE ?? 'require' }, maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => l.split('\u0001'));
}

async function scalar(query: string): Promise<string | null> {
  const rows = await sql(query);
  return rows.length ? rows[0][0] : null;
}

async function count(query: string): Promise<number> {
  return Number((await scalar(query)) ?? '0');
}

function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/* ------------------------------------------------------------------ */
/* Public RPC boundary                                                 */
/* ------------------------------------------------------------------ */

interface RpcResult {
  status: number;
  body: unknown;
}

async function callBootstrap(
  auth: { kind: 'jwt'; token: string } | { kind: 'anonymous' },
  orgCode: string,
  apply: boolean,
): Promise<RpcResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
  };
  if (auth.kind === 'jwt') headers.Authorization = `Bearer ${auth.token}`;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${BOOTSTRAP_FN}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ p_organization_code: orgCode, p_apply: apply }),
  });
  let body: unknown = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/** Extracts the safe, non-sensitive failure discriminator from an error body. */
function denialCode(body: unknown): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const parts = [b.message, b.details, b.hint, b.code].filter(
      (v): v is string => typeof v === 'string',
    );
    return parts.join(' | ').slice(0, 200);
  }
  return String(body).slice(0, 200);
}

function isDenial(r: RpcResult): boolean {
  if (r.status === 200) return false;
  return r.status === 401 || r.status === 403 || r.status === 404 || r.status >= 400;
}

/* ------------------------------------------------------------------ */
/* Scoped measurement                                                  */
/* ------------------------------------------------------------------ */

interface ScopedCounts {
  [table: string]: number;
}

async function scopedCounts(orgId: string): Promise<ScopedCounts> {
  const out: ScopedCounts = {};
  for (const table of SCOPED_TABLES) {
    out[table] = await count(
      `SELECT count(*) FROM public.${table} WHERE organization_id = ${lit(orgId)}`,
    );
  }
  return out;
}

function sameCounts(a: ScopedCounts, b: ScopedCounts): boolean {
  return SCOPED_TABLES.every((t) => a[t] === b[t]);
}

function renderCounts(c: ScopedCounts): string {
  return SCOPED_TABLES.map((t) => `${t}=${c[t]}`).join(', ');
}

/* ------------------------------------------------------------------ */
/* Staging-only, fixture-scoped fault mechanism                        */
/* ------------------------------------------------------------------ */
/*
 * The fault is a CONSTRAINT TRIGGER created at run time by this harness and
 * dropped again in cleanup. It exists in no migration, so it can never reach
 * production, and it fires only for rows belonging to the certification
 * organisation. Because it raises AFTER the final bootstrap INSERT, the
 * enclosing RPC transaction has already mutated several tables — which is
 * exactly the late-stage rollback condition under test. It changes no Build 4A
 * logic whatsoever.
 */

function faultNames(ns: string): { fn: string; trg: string } {
  const suffix = ns.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return {
    fn: `omni_comms_cert_fault_${suffix}`,
    trg: `omni_comms_cert_fault_trg_${suffix}`,
  };
}

async function installFault(ns: string, orgId: string): Promise<void> {
  const { fn, trg } = faultNames(ns);
  await sql(`
    CREATE OR REPLACE FUNCTION public.${fn}() RETURNS trigger
    LANGUAGE plpgsql AS $cert$
    BEGIN
      IF NEW.organization_id = ${lit(orgId)} THEN
        RAISE EXCEPTION 'OC599 certification_injected_fault'
          USING ERRCODE = 'P0001', DETAIL = 'certification_late_stage_fault';
      END IF;
      RETURN NULL;
    END;
    $cert$;
    DROP TRIGGER IF EXISTS ${trg} ON public.omni_comms_producer_event_binding;
    CREATE CONSTRAINT TRIGGER ${trg}
      AFTER INSERT ON public.omni_comms_producer_event_binding
      DEFERRABLE INITIALLY IMMEDIATE
      FOR EACH ROW EXECUTE FUNCTION public.${fn}();
  `);
}

async function removeFault(ns: string): Promise<void> {
  const { fn, trg } = faultNames(ns);
  await sql(`
    DROP TRIGGER IF EXISTS ${trg} ON public.omni_comms_producer_event_binding;
    DROP FUNCTION IF EXISTS public.${fn}();
  `);
}

async function faultPresent(ns: string): Promise<boolean> {
  const { trg } = faultNames(ns);
  return (
    (await count(`SELECT count(*) FROM pg_trigger WHERE tgname = ${lit(trg)} AND NOT tgisinternal`)) >
    0
  );
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  /* ---------- preconditions (refusals, never silent passes) -------- */

  const required: Array<[string, string]> = [
    ['SUPABASE_URL', SUPABASE_URL],
    ['SUPABASE_ANON_KEY', SUPABASE_ANON_KEY],
    ['SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY],
    ['OMNI_COMMS_STAGING_DB_URL', DB_URL],
    ['OMNI_COMMS_CERT_CONFIGURE_JWT', JWT_CONFIGURE],
    ['OMNI_COMMS_CERT_UNPRIVILEGED_JWT', JWT_UNPRIVILEGED],
    ['OMNI_COMMS_CERT_FOREIGN_TENANT_JWT', JWT_FOREIGN_TENANT],
    ['OMNI_COMMS_CERT_ORGANIZATION_ID', CERT_ORG_ID],
    ['OMNI_COMMS_CERT_FOREIGN_ORGANIZATION_ID', CERT_FOREIGN_ORG_ID],
    ['OMNI_COMMS_CERT_NAMESPACE', CERT_NAMESPACE],
  ];
  for (const [name, value] of required) {
    if (!value) refuse(`protected capability missing: ${name}`);
  }

  if (!/^[0-9a-f]{40}$/.test(COMMIT_SHA)) {
    refuse('COMMIT_SHA / GITHUB_SHA is not a full 40-character git revision');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{3,31}$/.test(CERT_NAMESPACE)) {
    refuse('OMNI_COMMS_CERT_NAMESPACE is not a valid certification namespace');
  }
  const uuidRe = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!uuidRe.test(CERT_ORG_ID)) refuse('OMNI_COMMS_CERT_ORGANIZATION_ID is not a UUID');
  if (!uuidRe.test(CERT_FOREIGN_ORG_ID)) {
    refuse('OMNI_COMMS_CERT_FOREIGN_ORGANIZATION_ID is not a UUID');
  }
  if (CERT_ORG_ID === CERT_FOREIGN_ORG_ID) {
    refuse('certification and foreign certification organisations are identical');
  }
  const distinctJwts = new Set([JWT_CONFIGURE, JWT_UNPRIVILEGED, JWT_FOREIGN_TENANT]);
  if (distinctJwts.size !== 3) refuse('certification JWTs are not three distinct identities');
  if (SUPABASE_ANON_KEY === SUPABASE_SERVICE_ROLE_KEY) {
    refuse('service-role key equals the anon key');
  }

  // Authoritative environment gate: the DB itself must report non-production.
  const environment = await scalar(
    `SELECT coalesce((public.omni_comms_priv_runtime_environment())::text, 'unknown')`,
  ).catch(() => null);
  if (!environment || !environment.toLowerCase().includes('non_production')) {
    refuse('runtime environment is not authoritatively non_production');
  }

  // Certification organisations must be namespaced fixtures, never real tenants.
  const orgCode = await scalar(
    `SELECT org_code FROM public.core_organization WHERE id = ${lit(CERT_ORG_ID)}`,
  );
  const foreignOrgCode = await scalar(
    `SELECT org_code FROM public.core_organization WHERE id = ${lit(CERT_FOREIGN_ORG_ID)}`,
  );
  if (!orgCode) refuse('certification organisation does not exist in staging');
  if (!foreignOrgCode) refuse('foreign certification organisation does not exist in staging');
  for (const code of [orgCode, foreignOrgCode]) {
    if (!code.startsWith(CERT_NAMESPACE)) {
      refuse('certification organisation is not inside the certification namespace');
    }
    if (code === 'SKN-SSB') refuse('certification organisation resolves to a real tenant');
  }

  // The pilot caller module must already be registered and active; the harness
  // never modifies the registry.
  const moduleActive = await count(
    `SELECT count(*) FROM public.omni_comms_caller_module_registry
      WHERE module_code = ${lit(PILOT_MODULE_CODE)} AND is_active`,
  );
  if (moduleActive !== 1) refuse('pilot caller module is not registered and active in staging');

  console.log(`commit_sha: ${COMMIT_SHA}`);
  console.log(`environment: ${environment}`);
  console.log(`fixture namespace: ${CERT_NAMESPACE}`);

  /* ---------- global-object baseline (only delete what we create) --- */

  const preExistingEventId = await scalar(
    `SELECT id::text FROM public.omni_comms_event_definition WHERE event_code = ${lit(PILOT_EVENT_CODE)}`,
  );

  let cleanupOk = false;
  let cleanupDetail = 'not attempted';

  try {
    /* ---------- fixtures ------------------------------------------- */

    const deptCode = 'REGISTRATION';
    await sql(`
      INSERT INTO public.core_department (organization_id, code, name, is_active)
      VALUES (${lit(CERT_ORG_ID)}, ${lit(deptCode)}, ${lit(`${CERT_NAMESPACE} Registration`)}, true)
      ON CONFLICT DO NOTHING;
    `);
    const deptId = await scalar(
      `SELECT id::text FROM public.core_department
        WHERE organization_id = ${lit(CERT_ORG_ID)} AND code = ${lit(deptCode)}`,
    );
    if (!deptId) refuse('certification department fixture could not be provisioned');

    await sql(`
      INSERT INTO public.omni_comms_sender_identity
        (organization_id, code, display_name, channel, from_address, status)
      VALUES (${lit(CERT_ORG_ID)}, 'ref_sender_registration',
              ${lit(`${CERT_NAMESPACE} Registration Sender`)}, 'email',
              ${lit(`${CERT_NAMESPACE.toLowerCase()}@certification.invalid`)}, 'active')
      ON CONFLICT DO NOTHING;
    `);

    const baseline = await scopedCounts(CERT_ORG_ID);
    console.log(`baseline scoped rows: ${renderCounts(baseline)}`);

    /* ---------- authorization scenarios ---------------------------- */

    await scenario('authorized_caller_success', async () => {
      const r = await callBootstrap({ kind: 'jwt', token: JWT_CONFIGURE }, orgCode, false);
      assertEqual(r.status, 200, 'status');
      const body = r.body as Record<string, unknown>;
      assertEqual(body.organization_id, CERT_ORG_ID, 'organization_id');
      assertEqual(body.applied, false, 'applied');
      return 'plan-mode bootstrap authorised';
    });

    await scenario('missing_capability_denied', async () => {
      const before = await scopedCounts(CERT_ORG_ID);
      const r = await callBootstrap({ kind: 'jwt', token: JWT_UNPRIVILEGED }, orgCode, true);
      if (!isDenial(r)) throw new Error(`expected denial, got status ${r.status}`);
      const after = await scopedCounts(CERT_ORG_ID);
      if (!sameCounts(before, after)) throw new Error('denial mutated bootstrap tables');
      return `denied (${denialCode(r.body)}), zero mutation`;
    });

    await scenario('foreign_tenant_denied', async () => {
      const before = await scopedCounts(CERT_ORG_ID);
      const r = await callBootstrap({ kind: 'jwt', token: JWT_FOREIGN_TENANT }, orgCode, true);
      if (!isDenial(r)) throw new Error(`expected tenant-safe denial, got status ${r.status}`);
      const after = await scopedCounts(CERT_ORG_ID);
      if (!sameCounts(before, after)) throw new Error('cross-tenant denial mutated bootstrap tables');
      return `tenant-safe denial (${denialCode(r.body)}), zero mutation`;
    });

    await scenario('unknown_organization_denied', async () => {
      const before = await scopedCounts(CERT_ORG_ID);
      const r = await callBootstrap(
        { kind: 'jwt', token: JWT_CONFIGURE },
        `${CERT_NAMESPACE}-UNKNOWN-ORG`,
        true,
      );
      if (!isDenial(r)) throw new Error(`expected denial, got status ${r.status}`);
      const after = await scopedCounts(CERT_ORG_ID);
      if (!sameCounts(before, after)) throw new Error('unknown-organisation denial mutated tables');
      return `denied (${denialCode(r.body)}), zero mutation`;
    });

    await scenario('unauthenticated_denied', async () => {
      const before = await scopedCounts(CERT_ORG_ID);
      const r = await callBootstrap({ kind: 'anonymous' }, orgCode, true);
      if (!isDenial(r)) throw new Error(`expected denial, got status ${r.status}`);
      const after = await scopedCounts(CERT_ORG_ID);
      if (!sameCounts(before, after)) throw new Error('unauthenticated denial mutated tables');
      return `denied (status ${r.status}), zero mutation`;
    });

    await scenario('private_bootstrap_not_public', async () => {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${PRIVATE_BOOTSTRAP_FN}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${JWT_CONFIGURE}`,
        },
        body: JSON.stringify({ p_organization_code: orgCode, p_apply: false }),
      });
      if (res.status === 200) throw new Error('private bootstrap RPC is reachable from a browser role');
      return `private RPC unreachable (status ${res.status})`;
    });

    const authorizationScenarios = results.length;
    const authorizationPassed = results.every((r) => r.ok);

    /* ---------- atomicity scenarios -------------------------------- */

    await scenario('prerequisite_failure_no_mutation', async () => {
      const before = await scopedCounts(CERT_ORG_ID);
      // Remove a required prerequisite (fixture-scoped) so apply must abort
      // before any bootstrap mutation.
      await sql(`
        UPDATE public.omni_comms_sender_identity SET status = 'retired'
         WHERE organization_id = ${lit(CERT_ORG_ID)} AND code = 'ref_sender_registration';
      `);
      const r = await callBootstrap({ kind: 'jwt', token: JWT_CONFIGURE }, orgCode, true);
      await sql(`
        UPDATE public.omni_comms_sender_identity SET status = 'active'
         WHERE organization_id = ${lit(CERT_ORG_ID)} AND code = 'ref_sender_registration';
      `);
      if (!isDenial(r)) throw new Error('bootstrap succeeded despite a missing prerequisite');
      const after = await scopedCounts(CERT_ORG_ID);
      if (!sameCounts(before, after)) throw new Error('prerequisite failure left mutations behind');
      const completed = await count(
        `SELECT count(*) FROM public.omni_comms_producer_event_binding
          WHERE organization_id = ${lit(CERT_ORG_ID)} AND status = 'active'`,
      );
      assertEqual(completed, before.omni_comms_producer_event_binding, 'completion records');
      return `aborted (${denialCode(r.body)}), zero mutation, no completion record`;
    });

    await scenario('late_stage_rollback_restores_baseline', async () => {
      const before = await scopedCounts(CERT_ORG_ID);
      await installFault(CERT_NAMESPACE, CERT_ORG_ID);
      const r = await callBootstrap({ kind: 'jwt', token: JWT_CONFIGURE }, orgCode, true);
      await removeFault(CERT_NAMESPACE);
      if (!isDenial(r)) throw new Error('injected late-stage fault did not fail the bootstrap');
      const after = await scopedCounts(CERT_ORG_ID);
      if (!sameCounts(before, after)) {
        throw new Error(`rollback incomplete: before[${renderCounts(before)}] after[${renderCounts(after)}]`);
      }
      const active = await count(
        `SELECT count(*) FROM public.omni_comms_producer_event_binding
          WHERE organization_id = ${lit(CERT_ORG_ID)} AND status = 'active'`,
      );
      assertEqual(active, before.omni_comms_producer_event_binding, 'partial active state');
      return `rolled back to baseline (${renderCounts(after)}), no completion record`;
    });

    await scenario('retry_after_rollback_single_result', async () => {
      if (await faultPresent(CERT_NAMESPACE)) throw new Error('fault mechanism still installed');
      const r = await callBootstrap({ kind: 'jwt', token: JWT_CONFIGURE }, orgCode, true);
      assertEqual(r.status, 200, 'status');
      const bindings = await count(
        `SELECT count(*) FROM public.omni_comms_producer_event_binding
          WHERE organization_id = ${lit(CERT_ORG_ID)} AND status = 'active'`,
      );
      assertEqual(bindings, 1, 'active bindings');
      const routes = await count(
        `SELECT count(*) FROM public.omni_comms_event_route WHERE organization_id = ${lit(CERT_ORG_ID)}`,
      );
      assertEqual(routes, 1, 'event routes');
      return 'one complete logical bootstrap, no duplicates';
    });

    await scenario('replay_after_success_is_deterministic', async () => {
      const before = await scopedCounts(CERT_ORG_ID);
      const r = await callBootstrap({ kind: 'jwt', token: JWT_CONFIGURE }, orgCode, true);
      assertEqual(r.status, 200, 'status');
      const after = await scopedCounts(CERT_ORG_ID);
      if (!sameCounts(before, after)) throw new Error('replay created duplicate objects');
      return `deterministic reuse (${renderCounts(after)})`;
    });

    await scenario('concurrent_equivalent_requests', async () => {
      const before = await scopedCounts(CERT_ORG_ID);
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          callBootstrap({ kind: 'jwt', token: JWT_CONFIGURE }, orgCode, true),
        ),
      );
      const succeeded = responses.filter((r) => r.status === 200);
      if (succeeded.length === 0) throw new Error('no concurrent caller succeeded');
      const bindingIds = new Set(
        succeeded.map((r) => String((r.body as Record<string, unknown>).producer_event_binding_id)),
      );
      if (bindingIds.size !== 1) throw new Error('concurrent callers resolved to different bindings');
      const after = await scopedCounts(CERT_ORG_ID);
      if (!sameCounts(before, after)) throw new Error('concurrency created duplicate state');
      const active = await count(
        `SELECT count(*) FROM public.omni_comms_producer_event_binding
          WHERE organization_id = ${lit(CERT_ORG_ID)} AND status = 'active'`,
      );
      assertEqual(active, 1, 'active bindings');
      return `${succeeded.length}/5 succeeded, one logical outcome, no partial state`;
    });

    const atomicityPassed = results.slice(authorizationScenarios).every((r) => r.ok);

    /* ---------- side-effect measurement ---------------------------- */

    const dispatchJobCount = await count(
      `SELECT count(*) FROM public.omni_comms_dispatch_job WHERE organization_id = ${lit(CERT_ORG_ID)}`,
    );
    const deliveryAttemptCount = await count(
      `SELECT count(*) FROM public.omni_comms_delivery_attempt WHERE organization_id = ${lit(CERT_ORG_ID)}`,
    );
    const messageCount = await count(
      `SELECT count(*) FROM public.omni_comms_message WHERE organization_id = ${lit(CERT_ORG_ID)}`,
    );
    const messageEventCount = await count(
      `SELECT count(*) FROM public.omni_comms_message_event WHERE organization_id = ${lit(CERT_ORG_ID)}`,
    );
    const providerCallCount = deliveryAttemptCount;
    const emailCount = await count(
      `SELECT count(*) FROM public.omni_comms_delivery_attempt
        WHERE organization_id = ${lit(CERT_ORG_ID)} AND channel = 'email'`,
    ).catch(() => deliveryAttemptCount);
    const webhookEventCount = await count(
      `SELECT count(*) FROM public.omni_comms_message_event
        WHERE organization_id = ${lit(CERT_ORG_ID)} AND event_type ILIKE '%webhook%'`,
    ).catch(() => messageEventCount);
    const dryRunRequestCount = await count(
      `SELECT count(*) FROM public.omni_comms_request
        WHERE organization_id = ${lit(CERT_ORG_ID)} AND mode = 'dry_run'`,
    );
    const nonDryRunRequestCount = await count(
      `SELECT count(*) FROM public.omni_comms_request
        WHERE organization_id = ${lit(CERT_ORG_ID)} AND mode <> 'dry_run'`,
    );

    const finalCounts = await scopedCounts(CERT_ORG_ID);

    /* ---------- cleanup -------------------------------------------- */

    await removeFault(CERT_NAMESPACE);
    await sql(`
      DELETE FROM public.omni_comms_producer_event_binding WHERE organization_id = ${lit(CERT_ORG_ID)};
      DELETE FROM public.omni_comms_event_route WHERE organization_id = ${lit(CERT_ORG_ID)};
      DELETE FROM public.omni_comms_message_event WHERE organization_id = ${lit(CERT_ORG_ID)};
      DELETE FROM public.omni_comms_delivery_attempt WHERE organization_id = ${lit(CERT_ORG_ID)};
      DELETE FROM public.omni_comms_dispatch_job WHERE organization_id = ${lit(CERT_ORG_ID)};
      DELETE FROM public.omni_comms_message WHERE organization_id = ${lit(CERT_ORG_ID)};
      DELETE FROM public.omni_comms_request WHERE organization_id = ${lit(CERT_ORG_ID)};
      DELETE FROM public.omni_comms_template_version tv
        USING public.omni_comms_template_family tf
       WHERE tv.family_id = tf.id AND tf.organization_id = ${lit(CERT_ORG_ID)};
      DELETE FROM public.omni_comms_template_family WHERE organization_id = ${lit(CERT_ORG_ID)};
      DELETE FROM public.omni_comms_sender_identity WHERE organization_id = ${lit(CERT_ORG_ID)};
      DELETE FROM public.core_department
       WHERE organization_id = ${lit(CERT_ORG_ID)} AND code = ${lit(deptCode)};
    `);

    // Global pilot objects are removed ONLY when this run created them.
    if (!preExistingEventId) {
      await sql(`
        DELETE FROM public.omni_comms_event_contract c
         USING public.omni_comms_event_definition d
         WHERE c.event_definition_id = d.id AND d.event_code = ${lit(PILOT_EVENT_CODE)};
        DELETE FROM public.omni_comms_event_definition WHERE event_code = ${lit(PILOT_EVENT_CODE)};
      `);
    }

    const remaining: Record<string, number> = {};
    for (const table of [
      ...SCOPED_TABLES,
      'omni_comms_request',
      'omni_comms_message',
      'omni_comms_dispatch_job',
      'omni_comms_delivery_attempt',
      'omni_comms_message_event',
      'omni_comms_sender_identity',
    ]) {
      remaining[table] = await count(
        `SELECT count(*) FROM public.${table} WHERE organization_id = ${lit(CERT_ORG_ID)}`,
      );
    }
    remaining[`template_family_${PILOT_FAMILY_CODE}`] = await count(
      `SELECT count(*) FROM public.omni_comms_template_family
        WHERE organization_id = ${lit(CERT_ORG_ID)} AND code = ${lit(PILOT_FAMILY_CODE)}`,
    );
    const faultRemaining = (await faultPresent(CERT_NAMESPACE)) ? 1 : 0;

    const leftovers = Object.entries(remaining).filter(([, n]) => n > 0);
    cleanupOk = leftovers.length === 0 && faultRemaining === 0;
    cleanupDetail = cleanupOk
      ? 'ok'
      : `failed — ${leftovers.map(([k, n]) => `${k}=${n}`).join(', ')}${faultRemaining ? ', fault_mechanism=1' : ''}`;

    /* ---------- report --------------------------------------------- */

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    const safetyBreached =
      dispatchJobCount > 0 ||
      deliveryAttemptCount > 0 ||
      providerCallCount > 0 ||
      emailCount > 0 ||
      webhookEventCount > 0 ||
      messageCount > 0 ||
      messageEventCount > 0 ||
      nonDryRunRequestCount > 0;

    console.log('');
    console.log(`scenarios: ${results.length}`);
    console.log(`passed: ${passed}`);
    console.log(`failed: ${failed}`);
    console.log(`fixture namespace: ${CERT_NAMESPACE}`);
    console.log(`final scoped rows: ${renderCounts(finalCounts)}`);
    console.log(`sanctioned_dry_run_requests: ${dryRunRequestCount}`);
    console.log(`no_dispatch_job: ${dispatchJobCount === 0}`);
    console.log(`no_delivery_attempt: ${deliveryAttemptCount === 0}`);
    console.log(`no_provider_call: ${providerCallCount === 0}`);
    console.log(`no_email: ${emailCount === 0}`);
    console.log(`no_webhook_event: ${webhookEventCount === 0}`);
    console.log(`no_unintended_message: ${messageCount === 0}`);
    console.log(`no_unintended_message_event: ${messageEventCount === 0}`);
    console.log(`cleanup: ${cleanupDetail}`);

    console.log('OMNI_COMMS_BUILD4A_SUMMARY_JSON_BEGIN');
    console.log(
      JSON.stringify(
        {
          commit_sha: COMMIT_SHA,
          environment,
          fixture_namespace: CERT_NAMESPACE,
          scenarios: results.map((r) => ({ name: r.name, ok: r.ok, detail: r.detail })),
          passed,
          failed,
          final_scoped_rows: finalCounts,
          side_effects: {
            dispatch_jobs: dispatchJobCount,
            delivery_attempts: deliveryAttemptCount,
            provider_calls: providerCallCount,
            emails: emailCount,
            webhook_events: webhookEventCount,
            messages: messageCount,
            message_events: messageEventCount,
            sanctioned_dry_run_requests: dryRunRequestCount,
          },
          cleanup: cleanupDetail,
        },
        null,
        2,
      ),
    );
    console.log('OMNI_COMMS_BUILD4A_SUMMARY_JSON_END');

    if (failed > 0 || safetyBreached || !cleanupOk) {
      console.log('BUILD 4A IMPLEMENTED — PRIVILEGED CERTIFICATION INCOMPLETE');
      process.exit(3);
    }

    if (authorizationPassed) console.log('OMNI COMMS BUILD 4A AUTHORIZATION INTEGRATION OK');
    if (atomicityPassed) console.log('OMNI COMMS BUILD 4A ATOMICITY INTEGRATION OK');
  } catch (err) {
    // Best-effort cleanup after an unexpected failure, then refuse.
    try {
      await removeFault(CERT_NAMESPACE);
    } catch {
      /* reported through the cleanup verifier */
    }
    console.log(`cleanup: ${cleanupOk ? 'ok' : cleanupDetail}`);
    refuse(`harness aborted: ${err instanceof Error ? err.message : String(err)}`);
  }
}

main().catch((err) => {
  if (!refusal) {
    console.log(`REFUSED — ${err instanceof Error ? err.message : String(err)}`);
    console.log('BUILD 4A IMPLEMENTED — PRIVILEGED CERTIFICATION INCOMPLETE');
  }
  process.exit(3);
});
