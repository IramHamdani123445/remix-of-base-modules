/**
 * Build 4A — privileged authorization + atomicity certification harness.
 *
 * PURPOSE
 *   Executes the remaining Build 4A privileged scenarios (authorization,
 *   prerequisite failure, late-stage rollback, retry, replay, concurrency)
 *   against a protected STAGING environment using isolated certification
 *   fixtures and protected staging-only certification credentials.
 *
 * OPERATIONAL HARDENING
 *   - No durable access-token JWT secrets. Sessions are obtained at run time
 *     through the normal Supabase Auth boundary using dedicated staging-only
 *     certification users, then masked and validated before any scenario runs.
 *   - An idempotent, namespace-restricted preflight cleanup repairs the residue
 *     of an interrupted previous run before fixtures are created.
 *   - The temporary fault mechanism is proven safe (non-production, isolated
 *     certification organisation, approved namespace, no real tenant), carries a
 *     unique run identifier and fires only for namespaced certification rows.
 *   - Success is expressed through a structured result file, not printed text.
 *
 * SAFETY CONTRACT
 *   - Never modifies Build 4A product logic, grants, RLS or JWT verification.
 *   - Never calls the private bootstrap RPC as a substitute for the public
 *     boundary; every scenario goes through
 *     public.omni_comms_bootstrap_employer_registration_pilot.
 *   - Never touches real tenants.
 *   - Never triggers provider delivery.
 *   - Removes every fixture it creates and verifies cleanup, including after
 *     failed scenarios.
 *   - Prints no credential, token, password, database URL or authorization
 *     header.
 *
 * MARKERS (emitted into the structured result only when everything passed)
 *   OMNI COMMS BUILD 4A AUTHORIZATION INTEGRATION OK
 *   OMNI COMMS BUILD 4A ATOMICITY INTEGRATION OK
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const execFileAsync = promisify(execFile);

/* ------------------------------------------------------------------ */
/* Environment                                                         */
/* ------------------------------------------------------------------ */

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const DB_URL = process.env.OMNI_COMMS_STAGING_DB_URL ?? '';

/** Staging-only certification-user credentials (no durable access tokens). */
const CERT_USERS = {
  configure: {
    email: process.env.OMNI_COMMS_CERT_CONFIGURE_EMAIL ?? '',
    password: process.env.OMNI_COMMS_CERT_CONFIGURE_PASSWORD ?? '',
  },
  unprivileged: {
    email: process.env.OMNI_COMMS_CERT_UNPRIVILEGED_EMAIL ?? '',
    password: process.env.OMNI_COMMS_CERT_UNPRIVILEGED_PASSWORD ?? '',
  },
  foreign: {
    email: process.env.OMNI_COMMS_CERT_FOREIGN_EMAIL ?? '',
    password: process.env.OMNI_COMMS_CERT_FOREIGN_PASSWORD ?? '',
  },
} as const;

type CertIdentity = keyof typeof CERT_USERS;

const CERT_ORG_ID = process.env.OMNI_COMMS_CERT_ORGANIZATION_ID ?? '';
const CERT_FOREIGN_ORG_ID = process.env.OMNI_COMMS_CERT_FOREIGN_ORGANIZATION_ID ?? '';
const CERT_NAMESPACE = process.env.OMNI_COMMS_CERT_NAMESPACE ?? '';
const COMMIT_SHA = process.env.COMMIT_SHA ?? process.env.GITHUB_SHA ?? '';
const RESULT_FILE =
  process.env.OMNI_COMMS_CERT_RESULT_FILE ?? '.certification-logs/build4a-result.json';

/** Sanitised unique run identifier used in every temporary object name. */
const RUN_ID = (process.env.GITHUB_RUN_ID ?? String(Date.now()))
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '')
  .slice(0, 16);

const RESULT_SCHEMA = 'omni_comms.build4a.certification.result';
const RESULT_VERSION = 1;

/** Minimum remaining access-token lifetime required for the full run. */
const MIN_TOKEN_LIFETIME_SECONDS = 900;

const BOOTSTRAP_FN = 'omni_comms_bootstrap_employer_registration_pilot';
const PRIVATE_BOOTSTRAP_FN = 'omni_comms_priv_bootstrap_employer_registration_pilot';
const PILOT_EVENT_CODE = 'REGISTRATION.EMPLOYER.APPLICATION_SUBMITTED';
const PILOT_MODULE_CODE = 'EMPLOYER_REGISTRATION';
const PILOT_FAMILY_CODE = 'pilot_registration_employer_application_submitted';

const AUTHORIZATION_MARKER = 'OMNI COMMS BUILD 4A AUTHORIZATION INTEGRATION OK';
const ATOMICITY_MARKER = 'OMNI COMMS BUILD 4A ATOMICITY INTEGRATION OK';

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

function writeResult(payload: Record<string, unknown>): void {
  try {
    mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
    writeFileSync(
      RESULT_FILE,
      JSON.stringify(
        { schema: RESULT_SCHEMA, version: RESULT_VERSION, ...payload },
        null,
        2,
      ),
    );
  } catch (err) {
    console.log(`WARN — structured result could not be written: ${String(err)}`);
  }
}

function refuse(reason: string): never {
  refusal = reason;
  writeResult({
    commit_sha: COMMIT_SHA,
    fixture_namespace: CERT_NAMESPACE,
    run_id: RUN_ID,
    refused: true,
    refusal_reason: reason,
    scenarios: results,
    scenarios_total: results.length,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    authorization_marker: null,
    atomicity_marker: null,
    cleanup: 'not verified',
    cleanup_ok: false,
  });
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
/* Runtime certification sessions (no durable JWT secrets)             */
/* ------------------------------------------------------------------ */

/** Masks a value in CI logs without ever printing it in a readable form. */
function mask(value: string): void {
  if (!value) return;
  if (process.env.GITHUB_ACTIONS === 'true') {
    process.stdout.write(`::add-mask::${value}\n`);
  }
}

interface CertSession {
  identity: CertIdentity;
  token: string;
  userId: string;
  email: string;
  expiresAt: number;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('token is not JWT-shaped');
  const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

/**
 * Signs in a dedicated staging certification user through the normal Supabase
 * Auth boundary. Tokens are masked immediately and never printed or returned to
 * any log surface.
 */
async function signIn(identity: CertIdentity): Promise<CertSession> {
  const { email, password } = CERT_USERS[identity];
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) {
    // Sanitised: identity name only, never the response body.
    refuse(`certification identity could not authenticate: ${identity}`);
  }
  const body = (await res.json()) as Record<string, unknown>;
  const token = typeof body.access_token === 'string' ? body.access_token : '';
  const refresh = typeof body.refresh_token === 'string' ? body.refresh_token : '';
  mask(token);
  mask(refresh);
  if (!token) refuse(`certification identity returned no access token: ${identity}`);

  const user = (body.user ?? {}) as Record<string, unknown>;
  const userId = typeof user.id === 'string' ? user.id : '';
  const userEmail = typeof user.email === 'string' ? user.email : '';

  let claims: Record<string, unknown>;
  try {
    claims = decodeJwtPayload(token);
  } catch {
    refuse(`certification access token is malformed: ${identity}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = typeof claims.exp === 'number' ? claims.exp : 0;
  if (exp <= now) refuse(`certification access token is already expired: ${identity}`);
  if (exp - now < MIN_TOKEN_LIFETIME_SECONDS) {
    refuse(`certification access token lifetime is insufficient for the run: ${identity}`);
  }
  if (claims.role !== 'authenticated') {
    refuse(`certification access token does not carry the authenticated role: ${identity}`);
  }
  if (!userId || claims.sub !== userId) {
    refuse(`certification access token subject does not match the issued user: ${identity}`);
  }
  if (!userEmail || userEmail.toLowerCase() !== email.toLowerCase()) {
    refuse(`certification access token identity does not match the configured user: ${identity}`);
  }

  return { identity, token, userId, email: userEmail, expiresAt: exp };
}

/**
 * Fail-closed proof that a certification identity holds no authorization inside
 * any real (non-namespaced) tenant.
 */
async function assertNoRealTenantMembership(session: CertSession): Promise<void> {
  const realTenantAssignments = await count(`
    SELECT count(*)
      FROM public.core_staff_assignments a
      JOIN public.core_organization o ON o.id = a.organization_id
     WHERE a.user_id = ${lit(session.userId)}
       AND o.org_code NOT LIKE ${lit(`${CERT_NAMESPACE}%`)}
  `).catch(() => -1);
  if (realTenantAssignments !== 0) {
    refuse(`certification identity is attached to a non-certification tenant: ${session.identity}`);
  }
}

/* ------------------------------------------------------------------ */
/* Public RPC boundary                                                 */
/* ------------------------------------------------------------------ */

interface RpcResult {
  status: number;
  body: unknown;
}

async function callBootstrap(
  auth: { kind: 'session'; session: CertSession } | { kind: 'anonymous' },
  orgCode: string,
  apply: boolean,
): Promise<RpcResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
  };
  if (auth.kind === 'session') headers.Authorization = `Bearer ${auth.session.token}`;

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
  return r.status >= 400;
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
 * dropped again in normal and failure cleanup. It exists in no migration, so it
 * can never reach production. Its name carries a sanitised unique run
 * identifier, and its predicate requires BOTH the isolated certification
 * organisation AND the approved certification namespace, so it can never fire
 * for a real tenant. It changes no Build 4A logic whatsoever.
 */

const CERT_FAULT_PREFIX = 'omni_comms_cert_fault_';

function faultNames(ns: string): { fn: string; trg: string } {
  const suffix = `${ns}_${RUN_ID}`.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return {
    fn: `${CERT_FAULT_PREFIX}${suffix}`,
    trg: `${CERT_FAULT_PREFIX}trg_${suffix}`,
  };
}

/**
 * Fail-closed preconditions that must all hold before any DDL is issued.
 */
async function assertFaultInstallationPermitted(
  environment: string,
  orgId: string,
  orgCode: string,
): Promise<void> {
  if (environment !== 'non_production') {
    refuse('fault mechanism refused: authoritative environment is not exactly non_production');
  }
  if (orgId !== CERT_ORG_ID) {
    refuse('fault mechanism refused: target is not the isolated certification organisation');
  }
  if (!CERT_NAMESPACE || !orgCode.startsWith(CERT_NAMESPACE)) {
    refuse('fault mechanism refused: fixture namespace does not match the approved prefix');
  }
  if (orgCode === 'SKN-SSB' || orgCode.includes('SKN-SSB')) {
    refuse('fault mechanism refused: a real organisation identifier is involved');
  }
  const realOrgTouched = await count(
    `SELECT count(*) FROM public.core_organization
      WHERE id = ${lit(orgId)} AND org_code NOT LIKE ${lit(`${CERT_NAMESPACE}%`)}`,
  );
  if (realOrgTouched !== 0) {
    refuse('fault mechanism refused: target organisation is outside the certification namespace');
  }
  // The database role must hold exactly the staging DDL capability required —
  // never superuser, never a role able to bypass RLS platform-wide.
  const roleFacts = await sql(`
    SELECT rolsuper::text, rolbypassrls::text,
           pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE')::text
      FROM pg_roles WHERE rolname = current_user
  `);
  const [isSuper, bypassRls, canCreate] = roleFacts[0] ?? ['t', 't', 'f'];
  if (isSuper === 't') refuse('fault mechanism refused: database role is superuser');
  if (bypassRls === 't') refuse('fault mechanism refused: database role bypasses RLS');
  if (canCreate !== 't') {
    refuse('fault mechanism refused: database role lacks the required staging DDL capability');
  }
}

async function installFault(ns: string, orgId: string): Promise<void> {
  const { fn, trg } = faultNames(ns);
  await sql(`
    CREATE OR REPLACE FUNCTION public.${fn}() RETURNS trigger
    LANGUAGE plpgsql AS $cert$
    BEGIN
      IF NEW.organization_id = ${lit(orgId)}
         AND EXISTS (
           SELECT 1 FROM public.core_organization o
            WHERE o.id = NEW.organization_id
              AND o.org_code LIKE ${lit(`${CERT_NAMESPACE}%`)}
         )
      THEN
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

/** Drops this run's fault objects and any residue of an interrupted run. */
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
/* Idempotent, namespace-restricted preflight cleanup                  */
/* ------------------------------------------------------------------ */

interface PreflightCounts {
  stale_fault_triggers: number;
  stale_fault_functions: number;
  temporary_capability_assignments: number;
  temporary_department_assignments: number;
  incomplete_bootstrap_fixtures: number;
  namespaced_test_records: number;
}

/**
 * Repairs the residue of an interrupted previous run. Every statement is
 * restricted to the isolated certification organisations and the configured
 * certification namespace; nothing outside that scope is ever touched.
 */
async function preflightCleanup(certOrgIds: string[]): Promise<PreflightCounts> {
  const orgList = certOrgIds.map(lit).join(', ');
  const nsLike = lit(`${CERT_NAMESPACE}%`);

  // Refuse to proceed unless every target organisation is namespaced.
  const namespacedOrgs = await count(
    `SELECT count(*) FROM public.core_organization
      WHERE id IN (${orgList}) AND org_code LIKE ${nsLike}`,
  );
  if (namespacedOrgs !== certOrgIds.length) {
    refuse('preflight cleanup refused: a target organisation is outside the certification namespace');
  }

  // 1. stale certification-only fault triggers and functions (any previous run id)
  const staleTriggers = await sql(`
    SELECT t.tgname FROM pg_trigger t
     WHERE NOT t.tgisinternal AND t.tgname LIKE ${lit(`${CERT_FAULT_PREFIX}%`)}
  `);
  for (const [tgname] of staleTriggers) {
    await sql(`DROP TRIGGER IF EXISTS ${tgname} ON public.omni_comms_producer_event_binding;`);
  }
  const staleFunctions = await sql(`
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE ${lit(`${CERT_FAULT_PREFIX}%`)}
  `);
  for (const [proname] of staleFunctions) {
    await sql(`DROP FUNCTION IF EXISTS public.${proname}();`);
  }

  // 2. temporary certification capability / tenant / department assignments
  const capabilityAssignments = await count(
    `SELECT count(*) FROM public.core_staff_assignments WHERE organization_id IN (${orgList})`,
  );
  await sql(`DELETE FROM public.core_staff_assignments WHERE organization_id IN (${orgList});`);

  const departmentFixtures = await count(
    `SELECT count(*) FROM public.core_department WHERE organization_id IN (${orgList})`,
  );

  // 3. incomplete bootstrap fixtures and previously namespaced test records
  const incomplete = await count(
    `SELECT count(*) FROM public.omni_comms_producer_event_binding
      WHERE organization_id IN (${orgList})`,
  );
  const namespacedRecords = await count(`
    SELECT
      (SELECT count(*) FROM public.omni_comms_event_route WHERE organization_id IN (${orgList}))
    + (SELECT count(*) FROM public.omni_comms_template_family WHERE organization_id IN (${orgList}))
    + (SELECT count(*) FROM public.omni_comms_request WHERE organization_id IN (${orgList}))
  `);

  await deleteScopedFixtures(certOrgIds);

  return {
    stale_fault_triggers: staleTriggers.length,
    stale_fault_functions: staleFunctions.length,
    temporary_capability_assignments: capabilityAssignments,
    temporary_department_assignments: departmentFixtures,
    incomplete_bootstrap_fixtures: incomplete,
    namespaced_test_records: namespacedRecords,
  };
}

/** Namespace-restricted deletion of every certification-scoped fixture row. */
async function deleteScopedFixtures(certOrgIds: string[]): Promise<void> {
  const orgList = certOrgIds.map(lit).join(', ');
  await sql(`
    DELETE FROM public.omni_comms_producer_event_binding WHERE organization_id IN (${orgList});
    DELETE FROM public.omni_comms_event_route WHERE organization_id IN (${orgList});
    DELETE FROM public.omni_comms_message_event WHERE organization_id IN (${orgList});
    DELETE FROM public.omni_comms_delivery_attempt WHERE organization_id IN (${orgList});
    DELETE FROM public.omni_comms_dispatch_job WHERE organization_id IN (${orgList});
    DELETE FROM public.omni_comms_message WHERE organization_id IN (${orgList});
    DELETE FROM public.omni_comms_request WHERE organization_id IN (${orgList});
    DELETE FROM public.omni_comms_template_version tv
      USING public.omni_comms_template_family tf
     WHERE tv.family_id = tf.id AND tf.organization_id IN (${orgList});
    DELETE FROM public.omni_comms_template_family WHERE organization_id IN (${orgList});
    DELETE FROM public.omni_comms_sender_identity WHERE organization_id IN (${orgList});
    DELETE FROM public.core_department WHERE organization_id IN (${orgList});
  `);
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
    ['OMNI_COMMS_CERT_CONFIGURE_EMAIL', CERT_USERS.configure.email],
    ['OMNI_COMMS_CERT_CONFIGURE_PASSWORD', CERT_USERS.configure.password],
    ['OMNI_COMMS_CERT_UNPRIVILEGED_EMAIL', CERT_USERS.unprivileged.email],
    ['OMNI_COMMS_CERT_UNPRIVILEGED_PASSWORD', CERT_USERS.unprivileged.password],
    ['OMNI_COMMS_CERT_FOREIGN_EMAIL', CERT_USERS.foreign.email],
    ['OMNI_COMMS_CERT_FOREIGN_PASSWORD', CERT_USERS.foreign.password],
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
  const distinctEmails = new Set(
    Object.values(CERT_USERS).map((u) => u.email.toLowerCase()),
  );
  if (distinctEmails.size !== 3) refuse('certification users are not three distinct identities');
  if (SUPABASE_ANON_KEY === SUPABASE_SERVICE_ROLE_KEY) {
    refuse('service-role key equals the anon key');
  }

  // Authoritative environment gate: the DB itself must report non-production.
  const environment =
    (
      await scalar(
        `SELECT coalesce((public.omni_comms_priv_runtime_environment())::text, 'unknown')`,
      ).catch(() => null)
    )?.trim() ?? '';
  if (environment !== 'non_production') {
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
  console.log(`run identifier: ${RUN_ID}`);

  /* ---------- preflight cleanup of an interrupted previous run ----- */

  const preflight = await preflightCleanup([CERT_ORG_ID, CERT_FOREIGN_ORG_ID]);
  console.log(
    `preflight cleanup: ${Object.entries(preflight)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}`,
  );

  /* ---------- runtime certification sessions ----------------------- */

  const sessionConfigure = await signIn('configure');
  const sessionUnprivileged = await signIn('unprivileged');
  const sessionForeign = await signIn('foreign');
  for (const s of [sessionConfigure, sessionUnprivileged, sessionForeign]) {
    await assertNoRealTenantMembership(s);
  }
  if (new Set([sessionConfigure.userId, sessionUnprivileged.userId, sessionForeign.userId]).size !== 3) {
    refuse('certification sessions do not resolve to three distinct user subjects');
  }
  console.log('certification sessions: 3 validated (tokens masked, never printed)');

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
      const r = await callBootstrap({ kind: 'session', session: sessionConfigure }, orgCode, false);
      assertEqual(r.status, 200, 'status');
      const body = r.body as Record<string, unknown>;
      assertEqual(body.organization_id, CERT_ORG_ID, 'organization_id');
      assertEqual(body.applied, false, 'applied');
      return 'plan-mode bootstrap authorised';
    });

    await scenario('missing_capability_denied', async () => {
      const before = await scopedCounts(CERT_ORG_ID);
      const r = await callBootstrap({ kind: 'session', session: sessionUnprivileged }, orgCode, true);
      if (!isDenial(r)) throw new Error(`expected denial, got status ${r.status}`);
      const after = await scopedCounts(CERT_ORG_ID);
      if (!sameCounts(before, after)) throw new Error('denial mutated bootstrap tables');
      return `denied (${denialCode(r.body)}), zero mutation`;
    });

    await scenario('foreign_tenant_denied', async () => {
      const before = await scopedCounts(CERT_ORG_ID);
      const r = await callBootstrap({ kind: 'session', session: sessionForeign }, orgCode, true);
      if (!isDenial(r)) throw new Error(`expected tenant-safe denial, got status ${r.status}`);
      const after = await scopedCounts(CERT_ORG_ID);
      if (!sameCounts(before, after)) throw new Error('cross-tenant denial mutated bootstrap tables');
      return `tenant-safe denial (${denialCode(r.body)}), zero mutation`;
    });

    await scenario('unknown_organization_denied', async () => {
      const before = await scopedCounts(CERT_ORG_ID);
      const r = await callBootstrap(
        { kind: 'session', session: sessionConfigure },
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
          Authorization: `Bearer ${sessionConfigure.token}`,
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
      const r = await callBootstrap({ kind: 'session', session: sessionConfigure }, orgCode, true);
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
      await assertFaultInstallationPermitted(environment, CERT_ORG_ID, orgCode);
      await installFault(CERT_NAMESPACE, CERT_ORG_ID);
      const r = await callBootstrap({ kind: 'session', session: sessionConfigure }, orgCode, true);
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
      const r = await callBootstrap({ kind: 'session', session: sessionConfigure }, orgCode, true);
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
      const r = await callBootstrap({ kind: 'session', session: sessionConfigure }, orgCode, true);
      assertEqual(r.status, 200, 'status');
      const after = await scopedCounts(CERT_ORG_ID);
      if (!sameCounts(before, after)) throw new Error('replay created duplicate objects');
      return `deterministic reuse (${renderCounts(after)})`;
    });

    await scenario('concurrent_equivalent_requests', async () => {
      const before = await scopedCounts(CERT_ORG_ID);
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          callBootstrap({ kind: 'session', session: sessionConfigure }, orgCode, true),
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
    await deleteScopedFixtures([CERT_ORG_ID, CERT_FOREIGN_ORG_ID]);

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
    const faultRemaining = (await count(
      `SELECT count(*) FROM pg_trigger
        WHERE NOT tgisinternal AND tgname LIKE ${lit(`${CERT_FAULT_PREFIX}%`)}`,
    ));

    const leftovers = Object.entries(remaining).filter(([, n]) => n > 0);
    cleanupOk = leftovers.length === 0 && faultRemaining === 0;
    cleanupDetail = cleanupOk
      ? 'ok'
      : `failed — ${leftovers.map(([k, n]) => `${k}=${n}`).join(', ')}${faultRemaining ? ', fault_mechanism=1' : ''}`;

    /* ---------- report --------------------------------------------- */

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    const sideEffects = {
      dispatch_jobs: dispatchJobCount,
      delivery_attempts: deliveryAttemptCount,
      provider_calls: providerCallCount,
      emails: emailCount,
      webhook_events: webhookEventCount,
      messages: messageCount,
      message_events: messageEventCount,
      unintended_requests: nonDryRunRequestCount,
      sanctioned_dry_run_requests: dryRunRequestCount,
    };
    const safetyBreached =
      dispatchJobCount > 0 ||
      deliveryAttemptCount > 0 ||
      providerCallCount > 0 ||
      emailCount > 0 ||
      webhookEventCount > 0 ||
      messageCount > 0 ||
      messageEventCount > 0 ||
      nonDryRunRequestCount > 0;

    const allPassed = failed === 0 && !safetyBreached && cleanupOk;

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

    writeResult({
      commit_sha: COMMIT_SHA,
      environment,
      run_id: RUN_ID,
      fixture_namespace: CERT_NAMESPACE,
      refused: false,
      preflight_cleanup: preflight,
      identities_validated: 3,
      scenarios: results,
      scenarios_total: results.length,
      passed,
      failed,
      authorization_scenarios: authorizationScenarios,
      atomicity_scenarios: results.length - authorizationScenarios,
      final_scoped_rows: finalCounts,
      side_effects: sideEffects,
      safety_breached: safetyBreached,
      cleanup: cleanupDetail,
      cleanup_ok: cleanupOk,
      authorization_marker: authorizationPassed && allPassed ? AUTHORIZATION_MARKER : null,
      atomicity_marker: atomicityPassed && allPassed ? ATOMICITY_MARKER : null,
    });

    if (!allPassed) {
      console.log('BUILD 4A IMPLEMENTED — PRIVILEGED CERTIFICATION INCOMPLETE');
      process.exit(3);
    }

    if (authorizationPassed) console.log(AUTHORIZATION_MARKER);
    if (atomicityPassed) console.log(ATOMICITY_MARKER);
  } catch (err) {
    // Best-effort cleanup after an unexpected failure, then refuse.
    try {
      await removeFault(CERT_NAMESPACE);
      await deleteScopedFixtures([CERT_ORG_ID, CERT_FOREIGN_ORG_ID]);
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
