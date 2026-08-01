/**
 * Build 4A — privileged bootstrap authorization + atomicity certification harness.
 *
 * SCOPE
 *   Proves ONLY bootstrap authorization and atomicity. It never produces the
 *   broader "BUILD 4A VERIFIED" verdict; that additionally requires a separate
 *   controlled Employer Registration shadow test.
 *
 * OPERATIONAL CONTRACT
 *   - No durable access-token JWT secrets and no service-role key. Sessions are
 *     obtained at run time through the normal Supabase Auth boundary using
 *     dedicated staging-only certification users, then masked and validated.
 *   - Certification identities are provisioned deterministically through the
 *     canonical identity/permission model (staff profile → assignment →
 *     department → organisation, and roles → role_permissions → user_roles).
 *     Only the exact row IDs this run creates are ever deleted.
 *   - Every negative scenario asserts an exact HTTP status AND an exact bounded
 *     error slug AND zero mutation. A 500, connection error, missing RPC,
 *     invalid overload, expired token or unrelated denial fails certification.
 *   - Certification is bound to the deployed Edge revision before any mutation.
 *   - Cleanup always runs through a single `finally` lifecycle; no refusal or
 *     unexpected exception after fixture creation can bypass it.
 *   - Success is expressed through a structured result file, never printed text.
 *
 * SAFETY
 *   Never modifies Build 4A product logic, grants, RLS or JWT verification.
 *   Never touches real tenants. Never triggers provider delivery. Prints no
 *   credential, token, password, database URL or authorization header.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RESULT_SCHEMA,
  RESULT_VERSION,
  SUCCESS_VERDICT,
  INCOMPLETE_VERDICT,
  AUTHORIZATION_MARKER,
  ATOMICITY_MARKER,
  DENIAL_MATRIX,
  OUTBOUND_PROVIDER_CALLS_SENTINEL,
  REQUIRED_HEALTH_POSTURE,
} from '../certificationContract';

const execFileAsync = promisify(execFile);

/* ------------------------------------------------------------------ */
/* Environment (least privilege — no service-role key)                 */
/* ------------------------------------------------------------------ */

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const DB_URL = process.env.OMNI_COMMS_STAGING_DB_URL ?? '';

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
/** Dedicated staging certification DB role — never the migration owner. */
const CERT_DB_ROLE = process.env.OMNI_COMMS_CERT_DB_ROLE ?? '';
/** Existing non-admin role used to carry the temporary configure capability. */
const CERT_CAPABILITY_ROLE = process.env.OMNI_COMMS_CERT_CAPABILITY_ROLE ?? '';
const COMMIT_SHA = process.env.COMMIT_SHA ?? process.env.GITHUB_SHA ?? '';
const RESULT_FILE =
  process.env.OMNI_COMMS_CERT_RESULT_FILE ?? '.certification-logs/build4a-result.json';

const RUN_ID = (process.env.GITHUB_RUN_ID ?? String(Date.now()))
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '')
  .slice(0, 16);

const MIN_TOKEN_LIFETIME_SECONDS = 900;

const BOOTSTRAP_FN = 'omni_comms_bootstrap_employer_registration_pilot';
const PRIVATE_BOOTSTRAP_FN = 'omni_comms_priv_bootstrap_employer_registration_pilot';
const PILOT_EVENT_CODE = 'REGISTRATION.EMPLOYER.APPLICATION_SUBMITTED';
const PILOT_MODULE_CODE = 'EMPLOYER_REGISTRATION';
const PILOT_FAMILY_CODE = 'pilot_registration_employer_application_submitted';
const OMNI_MODULE_NAME = 'omni_comms';
const CONFIGURE_ACTION = 'configure';

const SCOPED_TABLES = [
  'omni_comms_producer_event_binding',
  'omni_comms_event_route',
  'omni_comms_template_family',
] as const;

const FORBIDDEN_DB_ROLES = [
  'postgres',
  'supabase_admin',
  'supabase_auth_admin',
  'supabase_storage_admin',
  'service_role',
  'authenticator',
  'rds_superuser',
];

/* ------------------------------------------------------------------ */
/* Reporting primitives                                                */
/* ------------------------------------------------------------------ */

interface Measured {
  status: number;
  code: string;
}

interface ScenarioResult {
  name: string;
  ok: boolean;
  detail: string;
  measured?: Measured;
  expected?: Measured;
}

const results: ScenarioResult[] = [];

/** Typed refusal. Never calls process.exit: cleanup must always run. */
class CertificationRefusal extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'CertificationRefusal';
  }
}

function refuse(reason: string): never {
  throw new CertificationRefusal(reason);
}

function writeResult(payload: Record<string, unknown>): void {
  try {
    mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
    writeFileSync(
      RESULT_FILE,
      JSON.stringify({ schema: RESULT_SCHEMA, version: RESULT_VERSION, ...payload }, null, 2),
    );
  } catch (err) {
    console.log(`WARN — structured result could not be written: ${String(err)}`);
  }
}

async function scenario(name: string, fn: () => Promise<string>): Promise<void> {
  const expected = DENIAL_MATRIX[name];
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail, measured: lastMeasured ?? undefined, expected });
    console.log(`PASS  ${name} — ${detail}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, detail, measured: lastMeasured ?? undefined, expected });
    console.log(`FAIL  ${name} — ${detail}`);
  } finally {
    lastMeasured = null;
  }
}

let lastMeasured: Measured | null = null;

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

/* ------------------------------------------------------------------ */
/* Database access (least-privileged staging certification role)       */
/* ------------------------------------------------------------------ */

async function sql(query: string): Promise<string[][]> {
  const { stdout } = await execFileAsync(
    'psql',
    [DB_URL, '--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '-At', '-F', '\u0001', '-c', query],
    {
      env: { ...process.env, PGSSLMODE: process.env.PGSSLMODE ?? 'require' },
      maxBuffer: 8 * 1024 * 1024,
    },
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

async function boolValue(query: string): Promise<boolean> {
  return (await scalar(query))?.trim() === 't';
}

function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/* ------------------------------------------------------------------ */
/* Recorded temporary fixtures (only these rows are ever deleted)      */
/* ------------------------------------------------------------------ */

interface RecordedRow {
  table: string;
  id: string;
}

const recordedRows: RecordedRow[] = [];

function record(table: string, id: string): string {
  recordedRows.push({ table, id });
  return id;
}

async function deleteRecordedRows(): Promise<string[]> {
  const failures: string[] = [];
  // Reverse order so dependent rows disappear before their parents.
  for (const row of [...recordedRows].reverse()) {
    try {
      await sql(`DELETE FROM public.${row.table} WHERE id = ${lit(row.id)};`);
    } catch (err) {
      failures.push(`${row.table}:${row.id} (${err instanceof Error ? err.message : 'error'})`);
    }
  }
  return failures;
}

/* ------------------------------------------------------------------ */
/* Runtime certification sessions                                      */
/* ------------------------------------------------------------------ */

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
  const json = Buffer.from(
    parts[1].replace(/-/g, '+').replace(/_/g, '/'),
    'base64',
  ).toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

async function signIn(identity: CertIdentity): Promise<CertSession> {
  const { email, password } = CERT_USERS[identity];
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) {
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
 * Canonical tenancy: core_staff_assignments has NO organization_id. Tenancy is
 * reached through department_id → core_department.organization_id.
 */
function tenantAssignmentCountSql(userId: string, predicate: string): string {
  return `
    SELECT count(*)
      FROM public.core_staff_assignments a
      JOIN public.core_department d ON d.id = a.department_id
      JOIN public.core_organization o ON o.id = d.organization_id
     WHERE a.user_id = ${lit(userId)}
       AND ${predicate}
  `;
}

async function assertNoRealTenantMembership(session: CertSession): Promise<void> {
  const realTenantAssignments = await count(
    tenantAssignmentCountSql(session.userId, `o.org_code NOT LIKE ${lit(`${CERT_NAMESPACE}%`)}`),
  );
  if (realTenantAssignments !== 0) {
    refuse(`certification identity is attached to a non-certification tenant: ${session.identity}`);
  }
}

/* ------------------------------------------------------------------ */
/* Public RPC boundary + exact denial assertions                       */
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

/** Extracts a bounded, non-sensitive failure slug — never free-form text. */
function boundedCode(body: unknown): string {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const details = typeof b.details === 'string' ? b.details.trim() : '';
  const text = [b.message, b.details, b.hint, b.code, typeof body === 'string' ? body : '']
    .filter((v): v is string => typeof v === 'string')
    .join(' ');

  if (/permission denied for function/i.test(text)) return 'permission_denied';
  if (/^[a-z][a-z0-9_]{2,}$/.test(details)) return details;
  const oc = text.match(/OC\d{3}\s+([a-z][a-z0-9_]+)/);
  if (oc) return oc[1];
  const known = Object.values(DENIAL_MATRIX)
    .map((d) => d.code)
    .find((c) => text.includes(c));
  if (known) return known;
  if (!text.trim()) return 'no_error_body';
  return 'unrecognized_error';
}

/** Asserts the exact expected status and bounded code for a negative scenario. */
function assertDenial(name: string, r: RpcResult): Measured {
  const expected = DENIAL_MATRIX[name];
  if (!expected) throw new Error(`no denial expectation is declared for ${name}`);
  const measured: Measured = { status: r.status, code: boundedCode(r.body) };
  lastMeasured = measured;
  if (measured.status === 200) {
    throw new Error(`${name}: boundary allowed the call (status 200)`);
  }
  if (measured.status !== expected.status) {
    throw new Error(
      `${name}: expected HTTP ${expected.status}, got ${measured.status} (${measured.code})`,
    );
  }
  if (measured.code !== expected.code) {
    throw new Error(
      `${name}: expected error slug ${expected.code}, got ${measured.code} (HTTP ${measured.status})`,
    );
  }
  return measured;
}

/* ------------------------------------------------------------------ */
/* Scoped measurement                                                  */
/* ------------------------------------------------------------------ */

type ScopedCounts = Record<string, number>;

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
/* Deployed Edge revision binding                                      */
/* ------------------------------------------------------------------ */

async function assertDeployedRevisionBinding(): Promise<Record<string, unknown>> {
  let posture: Record<string, unknown>;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/omni-comms-runtime/health`, {
      method: 'GET',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    if (res.status !== 200) refuse(`deployed runtime health probe returned status ${res.status}`);
    posture = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof CertificationRefusal) throw err;
    refuse('deployed runtime health probe is unreachable');
  }

  if (posture.revision !== COMMIT_SHA) {
    refuse('deployed Edge revision does not equal the checked-out commit');
  }
  for (const [key, expected] of Object.entries(REQUIRED_HEALTH_POSTURE)) {
    if (posture[key] !== expected) {
      refuse(`deployed runtime posture mismatch: ${key} is not ${String(expected)}`);
    }
  }
  return {
    revision: posture.revision,
    revisionVerified: posture.revisionVerified,
    available: posture.available,
    environment: posture.environment,
    certificationState: posture.certificationState,
    certifiedCommit: posture.certifiedCommit,
    revisionMatch: posture.revisionMatch,
    safeTestPermitted: posture.safeTestPermitted,
    liveDeliveryEnabled: posture.liveDeliveryEnabled,
  };
}

/* ------------------------------------------------------------------ */
/* Provider-safety evidence (source-measured, never inferred)          */
/* ------------------------------------------------------------------ */

const PROVIDER_SDK_PATTERN =
  /from\s+['"](?:resend|twilio|@sendgrid\/[a-z-]+|nodemailer|firebase-admin|@aws-sdk\/client-ses|whatsapp-web\.js)['"]/;

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(full, out);
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

interface ProviderEvidence {
  provider_adapter_present: boolean;
  provider_sdk_imports: number;
  outbound_provider_calls: string;
}

function measureProviderSurface(repoRoot: string): ProviderEvidence {
  const adapterDir = path.join(repoRoot, 'src/platform/omni-comms/providers');
  const files = [
    ...walkFiles(path.join(repoRoot, 'src/platform/omni-comms')),
    ...walkFiles(path.join(repoRoot, 'supabase/functions')).filter((f) =>
      f.includes('omni-comms-'),
    ),
  ];
  let imports = 0;
  for (const file of files) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (PROVIDER_SDK_PATTERN.test(line)) imports += 1;
    }
  }
  return {
    provider_adapter_present: existsSync(adapterDir) && walkFiles(adapterDir).length > 0,
    provider_sdk_imports: imports,
    outbound_provider_calls: OUTBOUND_PROVIDER_CALLS_SENTINEL,
  };
}

/* ------------------------------------------------------------------ */
/* Fault mechanism (staging only, fixture scoped, run-unique)          */
/* ------------------------------------------------------------------ */

const CERT_FAULT_PREFIX = 'omni_comms_cert_fault_';

function faultNames(ns: string): { fn: string; trg: string } {
  const suffix = `${ns}_${RUN_ID}`.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return { fn: `${CERT_FAULT_PREFIX}${suffix}`, trg: `${CERT_FAULT_PREFIX}trg_${suffix}` };
}

/**
 * Fail-closed proof that the staging certification DB role holds exactly the
 * capability required to create and drop this run's certification trigger —
 * and nothing broader. Schema CREATE privilege alone is NOT sufficient, so the
 * capability is proven by actually creating and dropping probe objects.
 */
interface DbRoleFacts {
  role: string;
  is_superuser: boolean;
  bypasses_rls: boolean;
  can_create_function: boolean;
  owns_target_table: boolean;
  has_trigger_privilege: boolean;
  can_drop_probe_objects: boolean;
  member_of_forbidden_roles: string[];
}

async function assertLeastPrivilegedFaultRole(): Promise<DbRoleFacts> {
  const roleName = (await scalar('SELECT current_user'))?.trim() ?? '';
  if (!CERT_DB_ROLE) refuse('OMNI_COMMS_CERT_DB_ROLE is not configured');
  if (roleName !== CERT_DB_ROLE) {
    refuse('database connection does not use the dedicated staging certification role');
  }
  if (FORBIDDEN_DB_ROLES.includes(roleName)) {
    refuse('database role is a production or platform-owner role');
  }

  const [rolsuper, rolbypassrls] = (
    await sql(
      `SELECT rolsuper::text, rolbypassrls::text FROM pg_roles WHERE rolname = current_user`,
    )
  )[0] ?? ['t', 't'];
  if (rolsuper === 't') refuse('fault mechanism refused: database role is superuser');
  if (rolbypassrls === 't') refuse('fault mechanism refused: database role bypasses RLS');

  const memberOf: string[] = [];
  for (const role of FORBIDDEN_DB_ROLES) {
    const exists = await boolValue(
      `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${lit(role)})::text`,
    );
    if (!exists) continue;
    if (await boolValue(`SELECT pg_has_role(current_user, ${lit(role)}, 'USAGE')::text`)) {
      memberOf.push(role);
    }
  }
  if (memberOf.length > 0) {
    refuse('fault mechanism refused: database role inherits a broader production role');
  }

  const ownsTarget = await boolValue(`
    SELECT pg_has_role(current_user, c.relowner, 'USAGE')::text
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'omni_comms_producer_event_binding'
  `);
  const hasTriggerPriv = await boolValue(
    `SELECT has_table_privilege(current_user, 'public.omni_comms_producer_event_binding', 'TRIGGER')::text`,
  );
  if (!ownsTarget && !hasTriggerPriv) {
    refuse(
      'fault mechanism refused: database role can neither own nor create a trigger on the target table',
    );
  }

  // Prove create + drop for real, using probe objects that are removed at once.
  const probeFn = `${CERT_FAULT_PREFIX}probe_${RUN_ID}`;
  const probeTrg = `${CERT_FAULT_PREFIX}probetrg_${RUN_ID}`;
  let canCreate = false;
  let canDrop = false;
  try {
    await sql(`
      CREATE OR REPLACE FUNCTION public.${probeFn}() RETURNS trigger
      LANGUAGE plpgsql AS $probe$ BEGIN RETURN NULL; END; $probe$;
      DROP TRIGGER IF EXISTS ${probeTrg} ON public.omni_comms_producer_event_binding;
      CREATE CONSTRAINT TRIGGER ${probeTrg}
        AFTER INSERT ON public.omni_comms_producer_event_binding
        DEFERRABLE INITIALLY IMMEDIATE
        FOR EACH ROW EXECUTE FUNCTION public.${probeFn}();
    `);
    canCreate = true;
  } catch {
    refuse('fault mechanism refused: database role cannot create the certification trigger');
  } finally {
    try {
      await sql(`
        DROP TRIGGER IF EXISTS ${probeTrg} ON public.omni_comms_producer_event_binding;
        DROP FUNCTION IF EXISTS public.${probeFn}();
      `);
      canDrop = true;
    } catch {
      /* reported below */
    }
  }
  if (!canDrop) {
    refuse('fault mechanism refused: database role cannot remove the certification trigger');
  }

  return {
    role: roleName,
    is_superuser: false,
    bypasses_rls: false,
    can_create_function: canCreate,
    owns_target_table: ownsTarget,
    has_trigger_privilege: hasTriggerPriv,
    can_drop_probe_objects: canDrop,
    member_of_forbidden_roles: memberOf,
  };
}

async function assertFaultTargetPermitted(
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
  if (orgCode.includes('SKN-SSB')) {
    refuse('fault mechanism refused: a real organisation identifier is involved');
  }
  const realOrgTouched = await count(
    `SELECT count(*) FROM public.core_organization
      WHERE id = ${lit(orgId)} AND org_code NOT LIKE ${lit(`${CERT_NAMESPACE}%`)}`,
  );
  if (realOrgTouched !== 0) {
    refuse('fault mechanism refused: target organisation is outside the certification namespace');
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
        RAISE EXCEPTION 'OC599 certification_late_stage_fault'
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
    (await count(
      `SELECT count(*) FROM pg_trigger WHERE tgname = ${lit(trg)} AND NOT tgisinternal`,
    )) > 0
  );
}

/* ------------------------------------------------------------------ */
/* Preflight cleanup (namespace restricted)                            */
/* ------------------------------------------------------------------ */

interface PreflightCounts {
  stale_fault_triggers: number;
  stale_fault_functions: number;
  stale_staff_assignments: number;
  stale_role_grants: number;
  stale_department_fixtures: number;
  incomplete_bootstrap_fixtures: number;
  namespaced_test_records: number;
}

async function preflightCleanup(certOrgIds: string[], userIds: string[]): Promise<PreflightCounts> {
  const orgList = certOrgIds.map(lit).join(', ');
  const userList = userIds.length ? userIds.map(lit).join(', ') : lit('00000000-0000-0000-0000-000000000000');
  const nsLike = lit(`${CERT_NAMESPACE}%`);

  const namespacedOrgs = await count(
    `SELECT count(*) FROM public.core_organization
      WHERE id IN (${orgList}) AND org_code LIKE ${nsLike}`,
  );
  if (namespacedOrgs !== certOrgIds.length) {
    refuse('preflight cleanup refused: a target organisation is outside the certification namespace');
  }

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

  // Assignments of the certification identities inside certification departments
  // only. Reached through department_id → core_department.organization_id.
  const staleAssignments = await count(`
    SELECT count(*)
      FROM public.core_staff_assignments a
      JOIN public.core_department d ON d.id = a.department_id
     WHERE a.user_id IN (${userList}) AND d.organization_id IN (${orgList})
  `);
  await sql(`
    DELETE FROM public.core_staff_assignments a
     USING public.core_department d
     WHERE d.id = a.department_id
       AND a.user_id IN (${userList})
       AND d.organization_id IN (${orgList});
  `);

  const staleRoleGrants = await count(
    `SELECT count(*) FROM public.user_roles WHERE user_id IN (${userList})
       AND role = ${lit(CERT_CAPABILITY_ROLE)}`,
  );
  await sql(
    `DELETE FROM public.user_roles WHERE user_id IN (${userList})
       AND role = ${lit(CERT_CAPABILITY_ROLE)};`,
  );

  const departmentFixtures = await count(
    `SELECT count(*) FROM public.core_department WHERE organization_id IN (${orgList})`,
  );
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
    stale_staff_assignments: staleAssignments,
    stale_role_grants: staleRoleGrants,
    stale_department_fixtures: departmentFixtures,
    incomplete_bootstrap_fixtures: incomplete,
    namespaced_test_records: namespacedRecords,
  };
}

/** Namespace-restricted deletion of certification-scoped data fixtures. */
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
     WHERE tv.template_family_id = tf.id AND tf.organization_id IN (${orgList});
    DELETE FROM public.omni_comms_template_family WHERE organization_id IN (${orgList});
    DELETE FROM public.omni_comms_sender_identity WHERE organization_id IN (${orgList});
    DELETE FROM public.core_department WHERE organization_id IN (${orgList});
  `);
}

/* ------------------------------------------------------------------ */
/* Deterministic identity provisioning                                 */
/* ------------------------------------------------------------------ */

interface ProvisionedIdentity {
  identity: CertIdentity;
  user_id: string;
  organization_id: string;
  department_id: string;
  has_configure_capability: boolean;
  is_admin: boolean;
  assignment_id: string;
}

async function ensureStaffProfile(userId: string): Promise<string> {
  const existing = await scalar(
    `SELECT id::text FROM public.core_staff_profiles WHERE user_id = ${lit(userId)} LIMIT 1`,
  );
  if (existing) return existing;
  const created = await scalar(`
    INSERT INTO public.core_staff_profiles (user_id, employment_status, staff_type, is_active)
    VALUES (${lit(userId)}, 'ACTIVE', 'TEMPORARY', true)
    RETURNING id::text
  `);
  if (!created) refuse('certification staff profile could not be provisioned');
  return record('core_staff_profiles', created);
}

async function ensureDepartment(orgId: string, code: string): Promise<string> {
  const created = await scalar(`
    INSERT INTO public.core_department (organization_id, code, name, is_active)
    VALUES (${lit(orgId)}, ${lit(code)}, ${lit(`${CERT_NAMESPACE} ${code}`)}, true)
    RETURNING id::text
  `);
  if (!created) refuse('certification department fixture could not be provisioned');
  return record('core_department', created);
}

async function grantCapabilityRole(userId: string): Promise<void> {
  const created = await scalar(`
    INSERT INTO public.user_roles (user_id, role)
    VALUES (${lit(userId)}, ${lit(CERT_CAPABILITY_ROLE)})
    RETURNING id::text
  `);
  if (!created) refuse('certification capability role could not be granted');
  record('user_roles', created);
}

async function ensureCapabilityRolePermission(): Promise<void> {
  const roleId = await scalar(
    `SELECT id::text FROM public.roles WHERE role_name = ${lit(CERT_CAPABILITY_ROLE)}`,
  );
  if (!roleId) refuse('certification capability role does not exist in the identity model');
  const moduleId = await scalar(
    `SELECT id::text FROM public.app_modules WHERE name = ${lit(OMNI_MODULE_NAME)} AND is_enabled`,
  );
  if (!moduleId) refuse('omni_comms module is not registered and enabled');
  const actionId = await scalar(`
    SELECT id::text FROM public.module_actions
     WHERE module_id = ${lit(moduleId)} AND action_name = ${lit(CONFIGURE_ACTION)} AND is_enabled
  `);
  if (!actionId) refuse('omni_comms configure action is not registered and enabled');

  const existing = await scalar(`
    SELECT id::text FROM public.role_permissions
     WHERE role_id = ${lit(roleId)} AND module_id = ${lit(moduleId)} AND action_id = ${lit(actionId)}
  `);
  if (existing) return; // pre-existing grant — never deleted by this run
  const created = await scalar(`
    INSERT INTO public.role_permissions (role_id, module_id, action_id, is_granted)
    VALUES (${lit(roleId)}, ${lit(moduleId)}, ${lit(actionId)}, true)
    RETURNING id::text
  `);
  if (!created) refuse('certification configure capability could not be granted');
  record('role_permissions', created);
}

async function provisionIdentity(
  session: CertSession,
  orgId: string,
  departmentId: string,
  withCapability: boolean,
): Promise<ProvisionedIdentity> {
  const profileId = await ensureStaffProfile(session.userId);
  const assignmentId = await scalar(`
    INSERT INTO public.core_staff_assignments
      (staff_profile_id, user_id, department_id, assignment_type, assignment_status,
       effective_from, is_primary, is_active, reason)
    VALUES (${lit(profileId)}, ${lit(session.userId)}, ${lit(departmentId)}, 'TEMPORARY', 'ACTIVE',
            CURRENT_DATE, false, true, ${lit(`${CERT_NAMESPACE} certification run ${RUN_ID}`)})
    RETURNING id::text
  `);
  if (!assignmentId) refuse(`certification assignment could not be provisioned: ${session.identity}`);
  record('core_staff_assignments', assignmentId);

  if (withCapability) await grantCapabilityRole(session.userId);

  const isAdmin = await boolValue(`SELECT public.is_admin(${lit(session.userId)})::text`);
  if (isAdmin) {
    refuse(
      `certification identity is a global administrator and would bypass the tenant boundary: ${session.identity}`,
    );
  }
  const hasCapability = await boolValue(
    `SELECT public.has_permission(${lit(session.userId)}, ${lit(OMNI_MODULE_NAME)}, ${lit(CONFIGURE_ACTION)})::text`,
  );
  if (hasCapability !== withCapability) {
    refuse(
      `certification identity capability is not as required (${session.identity}: expected ${String(withCapability)})`,
    );
  }

  const inExpectedOrg = await count(
    tenantAssignmentCountSql(session.userId, `d.organization_id = ${lit(orgId)} AND a.is_active`),
  );
  if (inExpectedOrg < 1) {
    refuse(`certification identity is not a member of its certification tenant: ${session.identity}`);
  }
  const otherOrg = orgId === CERT_ORG_ID ? CERT_FOREIGN_ORG_ID : CERT_ORG_ID;
  const inOtherOrg = await count(
    tenantAssignmentCountSql(session.userId, `d.organization_id = ${lit(otherOrg)}`),
  );
  if (inOtherOrg !== 0) {
    refuse(`certification identity has membership in the opposite tenant: ${session.identity}`);
  }
  await assertNoRealTenantMembership(session);

  return {
    identity: session.identity,
    user_id: session.userId,
    organization_id: orgId,
    department_id: departmentId,
    has_configure_capability: hasCapability,
    is_admin: false,
    assignment_id: assignmentId,
  };
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

async function main(): Promise<number> {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

  let refusalReason: string | null = null;
  let cleanupOk = false;
  let cleanupDetail = 'not attempted';
  let fixturesCreated = false;
  let environment = '';
  let health: Record<string, unknown> = {};
  let dbRoleFacts: DbRoleFacts | null = null;
  let preflight: PreflightCounts | null = null;
  let identities: ProvisionedIdentity[] = [];
  let sideEffects: Record<string, unknown> = {};
  let safetyBreached = true;
  let finalCounts: ScopedCounts = {};
  let authorizationScenarios = 0;
  let preExistingEventId: string | null = null;
  const providerEvidence = measureProviderSurface(repoRoot);

  try {
    /* ---------- 1. immutable preconditions ------------------------- */

    const required: Array<[string, string]> = [
      ['SUPABASE_URL', SUPABASE_URL],
      ['SUPABASE_ANON_KEY', SUPABASE_ANON_KEY],
      ['OMNI_COMMS_STAGING_DB_URL', DB_URL],
      ['OMNI_COMMS_CERT_DB_ROLE', CERT_DB_ROLE],
      ['OMNI_COMMS_CERT_CAPABILITY_ROLE', CERT_CAPABILITY_ROLE],
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
    if (CERT_CAPABILITY_ROLE.toLowerCase() === 'admin') {
      refuse('the certification capability role must not be a global administrator role');
    }
    const uuidRe = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!uuidRe.test(CERT_ORG_ID)) refuse('OMNI_COMMS_CERT_ORGANIZATION_ID is not a UUID');
    if (!uuidRe.test(CERT_FOREIGN_ORG_ID)) {
      refuse('OMNI_COMMS_CERT_FOREIGN_ORGANIZATION_ID is not a UUID');
    }
    if (CERT_ORG_ID === CERT_FOREIGN_ORG_ID) {
      refuse('certification and foreign certification organisations are identical');
    }
    const distinctEmails = new Set(Object.values(CERT_USERS).map((u) => u.email.toLowerCase()));
    if (distinctEmails.size !== 3) refuse('certification users are not three distinct identities');

    environment =
      (
        await scalar(
          `SELECT coalesce((public.omni_comms_priv_runtime_environment())::text, 'unknown')`,
        ).catch(() => null)
      )?.trim() ?? '';
    if (environment !== 'non_production') {
      refuse('runtime environment is not authoritatively non_production');
    }

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
      if (code.includes('SKN-SSB')) refuse('certification organisation resolves to a real tenant');
    }

    const moduleActive = await count(
      `SELECT count(*) FROM public.omni_comms_caller_module_registry
        WHERE module_code = ${lit(PILOT_MODULE_CODE)} AND is_active`,
    );
    if (moduleActive !== 1) refuse('pilot caller module is not registered and active in staging');

    // Deployed Edge revision binding — before any mutation.
    health = await assertDeployedRevisionBinding();

    // Least-privilege DB role proof — before any fixture is created.
    dbRoleFacts = await assertLeastPrivilegedFaultRole();

    console.log(`commit_sha: ${COMMIT_SHA}`);
    console.log(`environment: ${environment}`);
    console.log(`fixture namespace: ${CERT_NAMESPACE}`);
    console.log(`run identifier: ${RUN_ID}`);
    console.log(`deployed revision bound: ${String(health.revision) === COMMIT_SHA}`);

    /* ---------- 2. authenticate --------------------------------- */

    const sessionConfigure = await signIn('configure');
    const sessionUnprivileged = await signIn('unprivileged');
    const sessionForeign = await signIn('foreign');
    const sessions = [sessionConfigure, sessionUnprivileged, sessionForeign];
    if (new Set(sessions.map((s) => s.userId)).size !== 3) {
      refuse('certification sessions do not resolve to three distinct user subjects');
    }
    console.log('certification sessions: 3 validated (tokens masked, never printed)');

    /* ---------- 3. safe preflight cleanup ------------------------- */

    preflight = await preflightCleanup(
      [CERT_ORG_ID, CERT_FOREIGN_ORG_ID],
      sessions.map((s) => s.userId),
    );
    console.log(
      `preflight cleanup: ${Object.entries(preflight)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')}`,
    );

    preExistingEventId = await scalar(
      `SELECT id::text FROM public.omni_comms_event_definition WHERE code = ${lit(PILOT_EVENT_CODE)}`,
    );

    /* ---------- 4. recorded fixtures ------------------------------ */

    fixturesCreated = true;
    await ensureCapabilityRolePermission();
    const deptId = await ensureDepartment(CERT_ORG_ID, 'REGISTRATION');
    const foreignDeptId = await ensureDepartment(CERT_FOREIGN_ORG_ID, 'REGISTRATION');

    identities = [
      await provisionIdentity(sessionConfigure, CERT_ORG_ID, deptId, true),
      await provisionIdentity(sessionUnprivileged, CERT_ORG_ID, deptId, false),
      await provisionIdentity(sessionForeign, CERT_FOREIGN_ORG_ID, foreignDeptId, true),
    ];
    console.log(`identities validated: ${identities.length}`);

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

    /* ---------- 5. scenarios -------------------------------------- */

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
      const m = assertDenial('missing_capability_denied', r);
      const after = await scopedCounts(CERT_ORG_ID);
      if (!sameCounts(before, after)) throw new Error('denial mutated bootstrap tables');
      return `HTTP ${m.status} ${m.code}, zero mutation`;
    });

    await scenario('foreign_tenant_denied', async () => {
      const before = await scopedCounts(CERT_ORG_ID);
      const r = await callBootstrap({ kind: 'session', session: sessionForeign }, orgCode, true);
      const m = assertDenial('foreign_tenant_denied', r);
      const after = await scopedCounts(CERT_ORG_ID);
      if (!sameCounts(before, after)) throw new Error('cross-tenant denial mutated bootstrap tables');
      return `HTTP ${m.status} ${m.code}, zero mutation`;
    });

    await scenario('unknown_organization_denied', async () => {
      const before = await scopedCounts(CERT_ORG_ID);
      const r = await callBootstrap(
        { kind: 'session', session: sessionConfigure },
        `${CERT_NAMESPACE}-UNKNOWN-ORG`,
        true,
      );
      const m = assertDenial('unknown_organization_denied', r);
      const after = await scopedCounts(CERT_ORG_ID);
      if (!sameCounts(before, after)) throw new Error('unknown-organisation denial mutated tables');
      return `HTTP ${m.status} ${m.code}, zero mutation`;
    });

    await scenario('unauthenticated_denied', async () => {
      const before = await scopedCounts(CERT_ORG_ID);
      const r = await callBootstrap({ kind: 'anonymous' }, orgCode, true);
      const m = assertDenial('unauthenticated_denied', r);
      const after = await scopedCounts(CERT_ORG_ID);
      if (!sameCounts(before, after)) throw new Error('unauthenticated denial mutated tables');
      return `HTTP ${m.status} ${m.code}, zero mutation`;
    });

    await scenario('private_bootstrap_denied', async () => {
      const before = await scopedCounts(CERT_ORG_ID);
      // Complete actual signature — an overload-not-found or missing-argument
      // response is NOT acceptable security evidence.
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${PRIVATE_BOOTSTRAP_FN}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${sessionConfigure.token}`,
        },
        body: JSON.stringify({
          p_actor_id: sessionConfigure.userId,
          p_organization_code: orgCode,
          p_apply: false,
        }),
      });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        /* keep raw text */
      }
      if (/could not find the function|does not exist|without parameters/i.test(text)) {
        throw new Error('private RPC responded overload-not-found instead of a permission denial');
      }
      const m = assertDenial('private_bootstrap_denied', { status: res.status, body });
      const after = await scopedCounts(CERT_ORG_ID);
      if (!sameCounts(before, after)) throw new Error('private RPC call mutated tables');
      return `HTTP ${m.status} ${m.code} on the complete signature, zero mutation`;
    });

    authorizationScenarios = results.length;
    const authorizationPassed = results.every((r) => r.ok);

    await scenario('prerequisite_failure_no_mutation', async () => {
      const before = await scopedCounts(CERT_ORG_ID);
      await sql(`
        UPDATE public.omni_comms_sender_identity SET status = 'retired'
         WHERE organization_id = ${lit(CERT_ORG_ID)} AND code = 'ref_sender_registration';
      `);
      const r = await callBootstrap({ kind: 'session', session: sessionConfigure }, orgCode, true);
      await sql(`
        UPDATE public.omni_comms_sender_identity SET status = 'active'
         WHERE organization_id = ${lit(CERT_ORG_ID)} AND code = 'ref_sender_registration';
      `);
      const m = assertDenial('prerequisite_failure_no_mutation', r);
      const after = await scopedCounts(CERT_ORG_ID);
      if (!sameCounts(before, after)) throw new Error('prerequisite failure left mutations behind');
      const completed = await count(
        `SELECT count(*) FROM public.omni_comms_producer_event_binding
          WHERE organization_id = ${lit(CERT_ORG_ID)} AND status = 'active'`,
      );
      assertEqual(completed, before.omni_comms_producer_event_binding, 'completion records');
      return `HTTP ${m.status} ${m.code}, zero mutation, no completion record`;
    });

    await scenario('late_stage_rollback_restores_baseline', async () => {
      const before = await scopedCounts(CERT_ORG_ID);
      await assertFaultTargetPermitted(environment, CERT_ORG_ID, orgCode);
      await installFault(CERT_NAMESPACE, CERT_ORG_ID);
      let m: Measured;
      try {
        const r = await callBootstrap({ kind: 'session', session: sessionConfigure }, orgCode, true);
        m = assertDenial('late_stage_rollback_restores_baseline', r);
      } finally {
        await removeFault(CERT_NAMESPACE);
      }
      const after = await scopedCounts(CERT_ORG_ID);
      if (!sameCounts(before, after)) {
        throw new Error(
          `rollback incomplete: before[${renderCounts(before)}] after[${renderCounts(after)}]`,
        );
      }
      const active = await count(
        `SELECT count(*) FROM public.omni_comms_producer_event_binding
          WHERE organization_id = ${lit(CERT_ORG_ID)} AND status = 'active'`,
      );
      assertEqual(active, before.omni_comms_producer_event_binding, 'partial active state');
      return `HTTP ${m.status} ${m.code}, rolled back to baseline (${renderCounts(after)})`;
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

    /* ---------- 6. side-effect measurement ------------------------- */

    const dispatchJobCount = await count(
      `SELECT count(*) FROM public.omni_comms_dispatch_job WHERE organization_id = ${lit(CERT_ORG_ID)}`,
    );
    const runnableJobCount = await count(
      `SELECT count(*) FROM public.omni_comms_dispatch_job
        WHERE organization_id = ${lit(CERT_ORG_ID)} AND is_runnable`,
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
    const emailCount = await count(
      `SELECT count(*) FROM public.omni_comms_delivery_attempt
        WHERE organization_id = ${lit(CERT_ORG_ID)} AND channel = 'email'`,
    );
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

    finalCounts = await scopedCounts(CERT_ORG_ID);

    sideEffects = {
      dispatch_jobs: dispatchJobCount,
      runnable_dispatch_jobs: runnableJobCount,
      delivery_attempts: deliveryAttemptCount,
      emails: emailCount,
      webhook_events: webhookEventCount,
      messages: messageCount,
      message_events: messageEventCount,
      unintended_requests: nonDryRunRequestCount,
      sanctioned_dry_run_requests: dryRunRequestCount,
      // Provider evidence is measured separately and never inferred from
      // delivery attempts.
      provider_adapter_present: providerEvidence.provider_adapter_present,
      provider_sdk_imports: providerEvidence.provider_sdk_imports,
      outbound_provider_calls: providerEvidence.outbound_provider_calls,
    };
    safetyBreached =
      dispatchJobCount > 0 ||
      runnableJobCount > 0 ||
      deliveryAttemptCount > 0 ||
      emailCount > 0 ||
      webhookEventCount > 0 ||
      messageCount > 0 ||
      messageEventCount > 0 ||
      nonDryRunRequestCount > 0 ||
      providerEvidence.provider_adapter_present ||
      providerEvidence.provider_sdk_imports > 0;

    console.log('');
    console.log(`scenarios: ${results.length}`);
    console.log(`passed: ${results.filter((r) => r.ok).length}`);
    console.log(`failed: ${results.filter((r) => !r.ok).length}`);
    console.log(`final scoped rows: ${renderCounts(finalCounts)}`);
    console.log(`no_runnable_dispatch_job: ${runnableJobCount === 0}`);
    console.log(`no_delivery_attempt: ${deliveryAttemptCount === 0}`);
    console.log(`provider_adapter_present: ${providerEvidence.provider_adapter_present}`);
    console.log(`provider_sdk_imports: ${providerEvidence.provider_sdk_imports}`);
    console.log(`outbound_provider_calls: ${providerEvidence.outbound_provider_calls}`);

    void authorizationPassed;
  } catch (err) {
    if (err instanceof CertificationRefusal) refusalReason = err.message;
    else refusalReason = `harness aborted: ${err instanceof Error ? err.message : String(err)}`;
    console.log(`REFUSED — ${refusalReason}`);
  } finally {
    /* ---------- 7. cleanup always ---------------------------------- */
    const cleanupFailures: string[] = [];
    try {
      await removeFault(CERT_NAMESPACE);
    } catch (err) {
      cleanupFailures.push(`fault removal (${err instanceof Error ? err.message : 'error'})`);
    }
    try {
      cleanupFailures.push(...(await deleteRecordedRows()));
    } catch (err) {
      cleanupFailures.push(`recorded rows (${err instanceof Error ? err.message : 'error'})`);
    }
    try {
      await deleteScopedFixtures([CERT_ORG_ID, CERT_FOREIGN_ORG_ID]);
    } catch (err) {
      cleanupFailures.push(`scoped fixtures (${err instanceof Error ? err.message : 'error'})`);
    }
    if (fixturesCreated && !preExistingEventId) {
      try {
        await sql(`
          DELETE FROM public.omni_comms_event_contract c
           USING public.omni_comms_event_definition d
           WHERE c.event_definition_id = d.id AND d.code = ${lit(PILOT_EVENT_CODE)};
          DELETE FROM public.omni_comms_event_definition WHERE code = ${lit(PILOT_EVENT_CODE)};
        `);
      } catch (err) {
        cleanupFailures.push(`pilot event (${err instanceof Error ? err.message : 'error'})`);
      }
    }

    /* ---------- 8. verify zero residue ----------------------------- */
    const remaining: Record<string, number> = {};
    try {
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
      remaining.core_department = await count(
        `SELECT count(*) FROM public.core_department
          WHERE organization_id IN (${lit(CERT_ORG_ID)}, ${lit(CERT_FOREIGN_ORG_ID)})`,
      );
      remaining.core_staff_assignments = await count(`
        SELECT count(*) FROM public.core_staff_assignments a
          JOIN public.core_department d ON d.id = a.department_id
         WHERE d.organization_id IN (${lit(CERT_ORG_ID)}, ${lit(CERT_FOREIGN_ORG_ID)})
      `);
      remaining.temporary_role_grants = recordedRows.some((r) => r.table === 'user_roles')
        ? await count(
            `SELECT count(*) FROM public.user_roles
              WHERE id IN (${recordedRows
                .filter((r) => r.table === 'user_roles')
                .map((r) => lit(r.id))
                .join(', ')})`,
          )
        : 0;
      remaining.fault_objects =
        (await count(
          `SELECT count(*) FROM pg_trigger
            WHERE NOT tgisinternal AND tgname LIKE ${lit(`${CERT_FAULT_PREFIX}%`)}`,
        )) +
        (await count(
          `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE ${lit(`${CERT_FAULT_PREFIX}%`)}`,
        ));
    } catch (err) {
      cleanupFailures.push(`residue verification (${err instanceof Error ? err.message : 'error'})`);
    }

    const leftovers = Object.entries(remaining).filter(([, n]) => n > 0);
    cleanupOk = cleanupFailures.length === 0 && leftovers.length === 0;
    cleanupDetail = cleanupOk
      ? 'ok'
      : `failed — ${[...leftovers.map(([k, n]) => `${k}=${n}`), ...cleanupFailures].join(', ')}`;
    console.log(`cleanup: ${cleanupDetail}`);

    /* ---------- 9. structured result ------------------------------- */
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    const allPassed =
      refusalReason === null && failed === 0 && results.length > 0 && !safetyBreached && cleanupOk;

    writeResult({
      commit_sha: COMMIT_SHA,
      environment,
      run_id: RUN_ID,
      fixture_namespace: CERT_NAMESPACE,
      refused: refusalReason !== null,
      refusal_reason: refusalReason,
      verdict_scope: 'bootstrap_authorization_and_atomicity',
      deployed_health: health,
      db_role: dbRoleFacts,
      preflight_cleanup: preflight,
      identities_validated: identities.length,
      identities: identities.map((i) => ({
        identity: i.identity,
        user_id: i.user_id,
        organization_id: i.organization_id,
        department_id: i.department_id,
        has_configure_capability: i.has_configure_capability,
        is_admin: i.is_admin,
      })),
      namespaced_organizations_verified: 2,
      scenarios: results,
      scenarios_total: results.length,
      passed,
      failed,
      authorization_scenarios: authorizationScenarios,
      atomicity_scenarios: Math.max(results.length - authorizationScenarios, 0),
      final_scoped_rows: finalCounts,
      residual_rows: remaining,
      side_effects: sideEffects,
      safety_breached: safetyBreached,
      cleanup: cleanupDetail,
      cleanup_ok: cleanupOk,
      cleanup_failures: cleanupFailures,
      authorization_marker: allPassed ? AUTHORIZATION_MARKER : null,
      atomicity_marker: allPassed ? ATOMICITY_MARKER : null,
      verdict: allPassed ? SUCCESS_VERDICT : INCOMPLETE_VERDICT,
    });

    if (!allPassed) {
      console.log(INCOMPLETE_VERDICT);
      return 3;
    }
    console.log(AUTHORIZATION_MARKER);
    console.log(ATOMICITY_MARKER);
    console.log(SUCCESS_VERDICT);
    return 0;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.log(`REFUSED — ${err instanceof Error ? err.message : String(err)}`);
    console.log(INCOMPLETE_VERDICT);
    process.exit(3);
  });
