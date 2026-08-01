/**
 * Build 4A — independent structured certification result assertion.
 *
 * The verdict must never depend on searching arbitrary logs for marker text.
 * This validator reads the harness's structured result file and independently
 * asserts every certification invariant, including the exact denial matrix,
 * the deployed-revision binding, identity provisioning and cleanup residue.
 *
 * Usage: bunx tsx scripts/omni-comms/integration/assert-build4a-result.ts <file> <expected-sha>
 * Prints (only when everything holds): OMNI COMMS BUILD 4A STRUCTURED RESULT OK
 */
import { readFileSync } from 'node:fs';
import {
  RESULT_SCHEMA,
  RESULT_VERSION,
  SUCCESS_VERDICT,
  INCOMPLETE_VERDICT,
  AUTHORIZATION_MARKER,
  ATOMICITY_MARKER,
  REQUIRED_SCENARIOS,
  DENIAL_MATRIX,
  ZERO_SIDE_EFFECTS,
  PREFLIGHT_FIELDS,
  OUTBOUND_PROVIDER_CALLS_SENTINEL,
  REQUIRED_HEALTH_POSTURE,
} from './certificationContract';

const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
}

export function assertResult(result: Record<string, unknown>, expectedSha: string): string[] {
  failures.length = 0;

  if (!expectedSha || !/^[0-9a-f]{40}$/.test(expectedSha)) {
    fail('expected commit SHA is not a full 40-character git revision');
  }
  if (result.schema !== RESULT_SCHEMA) fail('structured result schema is not recognised');
  if (result.version !== RESULT_VERSION) fail('structured result version is not supported');
  if (result.refused !== false) {
    fail(`harness refused: ${String(result.refusal_reason ?? 'unknown')}`);
  }
  if (result.commit_sha !== expectedSha) {
    fail('structured result commit SHA does not equal the checked-out revision');
  }
  if (result.environment !== 'non_production') {
    fail('structured result environment is not non_production');
  }
  if (result.verdict !== SUCCESS_VERDICT) {
    fail('structured result does not carry the bootstrap authorization and atomicity verdict');
  }

  /* ---- deployed Edge revision binding ---- */
  const health = (result.deployed_health ?? {}) as Record<string, unknown>;
  if (health.revision !== expectedSha) {
    fail('deployed Edge revision does not equal the checked-out revision');
  }
  for (const [key, expected] of Object.entries(REQUIRED_HEALTH_POSTURE)) {
    if (health[key] !== expected) {
      fail(`deployed runtime posture mismatch: ${key} is not ${String(expected)}`);
    }
  }

  /* ---- identities ---- */
  if (result.identities_validated !== 3) fail('three certification identities were not validated');
  const identities = Array.isArray(result.identities)
    ? (result.identities as Array<Record<string, unknown>>)
    : [];
  if (identities.length !== 3) fail('identity provisioning evidence is incomplete');
  for (const identity of identities) {
    if (identity.is_admin === true) {
      fail(`certification identity is a global administrator: ${String(identity.identity)}`);
    }
  }
  const configure = identities.find((i) => i.identity === 'configure');
  const unprivileged = identities.find((i) => i.identity === 'unprivileged');
  const foreign = identities.find((i) => i.identity === 'foreign');
  if (configure?.has_configure_capability !== true) fail('configure identity lacks the capability');
  if (unprivileged?.has_configure_capability !== false) {
    fail('unprivileged identity must not hold the configure capability');
  }
  if (foreign?.has_configure_capability !== true) {
    fail('foreign identity must hold the capability needed to reach tenant enforcement');
  }
  if (
    configure &&
    foreign &&
    configure.organization_id === foreign.organization_id
  ) {
    fail('foreign identity is not in a separate certification tenant');
  }
  if (result.namespaced_organizations_verified !== 2) {
    fail('both certification organisations were not verified as namespaced fixtures');
  }

  /* ---- scenarios ---- */
  const scenarios = Array.isArray(result.scenarios)
    ? (result.scenarios as Array<Record<string, unknown>>)
    : [];
  const seen = new Map<string, number>();
  for (const s of scenarios) {
    const name = String(s.name);
    seen.set(name, (seen.get(name) ?? 0) + 1);
  }
  for (const [name, n] of seen) {
    if (n > 1) fail(`duplicate scenario name: ${name}`);
  }
  for (const name of REQUIRED_SCENARIOS) {
    const entry = scenarios.find((s) => s.name === name);
    if (!entry) fail(`required scenario missing: ${name}`);
    else if (entry.ok !== true) fail(`scenario did not pass: ${name}`);
  }
  for (const [name, expected] of Object.entries(DENIAL_MATRIX) as Array<
    [string, { status: number; code: string }]
  >) {
    const entry = scenarios.find((s) => s.name === name);
    if (!entry) continue;
    const measured = (entry.measured ?? {}) as Record<string, unknown>;
    if (measured.status !== expected.status) {
      fail(`${name}: measured HTTP status ${String(measured.status)} is not ${expected.status}`);
    }
    if (measured.code !== expected.code) {
      fail(`${name}: measured error code ${String(measured.code)} is not ${expected.code}`);
    }
  }

  const total = num(result.scenarios_total);
  const passed = num(result.passed);
  const failed = num(result.failed);
  if (total !== scenarios.length) fail('scenario total does not match the recorded scenarios');
  if (!(total >= REQUIRED_SCENARIOS.length)) fail('fewer scenarios executed than required');
  if (failed !== 0) fail(`structured result reports ${failed} failed scenario(s)`);
  if (passed !== total) fail('structured result pass count does not equal the scenario total');

  /* ---- preflight ---- */
  const preflight = (result.preflight_cleanup ?? {}) as Record<string, unknown>;
  for (const field of PREFLIGHT_FIELDS) {
    if (!Number.isFinite(num(preflight[field]))) {
      fail(`preflight cleanup field is not numeric: ${field}`);
    }
  }

  /* ---- side effects and provider evidence ---- */
  const side = (result.side_effects ?? {}) as Record<string, unknown>;
  for (const key of ZERO_SIDE_EFFECTS) {
    const value = num(side[key]);
    if (!Number.isFinite(value)) fail(`side-effect counter not measured: ${key}`);
    else if (value !== 0) fail(`side-effect counter is not zero: ${key}=${value}`);
  }
  if (side.provider_adapter_present !== false) {
    fail('a provider adapter capable of dispatch is present');
  }
  if (side.outbound_provider_calls !== OUTBOUND_PROVIDER_CALLS_SENTINEL) {
    fail('outbound provider calls must use the not-applicable sentinel, not a fabricated count');
  }
  if ('provider_calls' in side) {
    fail('provider_calls must not be inferred from delivery attempts');
  }
  if (result.safety_breached !== false) fail('structured result reports a safety breach');

  /* ---- cleanup residue ---- */
  if (result.cleanup_ok !== true) fail(`fixture cleanup did not succeed: ${String(result.cleanup)}`);
  const cleanupFailures = Array.isArray(result.cleanup_failures) ? result.cleanup_failures : [];
  if (cleanupFailures.length > 0) fail('cleanup reported failures');
  const residual = (result.residual_rows ?? {}) as Record<string, unknown>;
  if (Object.keys(residual).length === 0) fail('residual row measurement is missing');
  for (const [table, value] of Object.entries(residual)) {
    const n = num(value);
    if (!Number.isFinite(n)) fail(`residual row count is not numeric: ${table}`);
    else if (n !== 0) fail(`residual rows remain after cleanup: ${table}=${n}`);
  }
  for (const key of ['fault_objects', 'core_staff_assignments', 'temporary_role_grants']) {
    if (!(key in residual)) fail(`residual measurement missing: ${key}`);
  }

  /* ---- markers ---- */
  if (result.authorization_marker !== AUTHORIZATION_MARKER) {
    fail('authorization integration marker is not present in the structured result');
  }
  if (result.atomicity_marker !== ATOMICITY_MARKER) {
    fail('atomicity integration marker is not present in the structured result');
  }

  return [...failures];
}

function main(): void {
  const [file, expectedSha] = process.argv.slice(2);
  let result: Record<string, unknown> = {};
  let readFailure: string | null = null;
  if (!file) readFailure = 'no structured result file was supplied';
  else {
    try {
      result = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch {
      readFailure = 'structured result file is missing or not valid JSON';
    }
  }

  const problems = readFailure ? [readFailure] : assertResult(result, expectedSha ?? '');

  if (problems.length > 0) {
    for (const f of problems) console.log(`FAIL — ${f}`);
    console.log(INCOMPLETE_VERDICT);
    process.exit(1);
  }

  console.log(`structured result scenarios: ${String(result.scenarios_total)} (all passed)`);
  console.log(`deployed revision bound: ${String(expectedSha)}`);
  console.log(`identities validated: ${String(result.identities_validated)}`);
  console.log(`structured result cleanup: ${String(result.cleanup)}`);
  console.log(AUTHORIZATION_MARKER);
  console.log(ATOMICITY_MARKER);
  console.log('OMNI COMMS BUILD 4A STRUCTURED RESULT OK');
}

const invokedDirectly = process.argv[1]?.includes('assert-build4a-result');
if (invokedDirectly) main();
