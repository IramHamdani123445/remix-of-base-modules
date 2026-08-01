/**
 * Build 4A — structured certification result assertion.
 *
 * The final verdict must never depend on an unrestricted search for marker text
 * across arbitrary logs. This validator reads the harness's structured result
 * file and independently asserts every certification invariant. A subprocess
 * that merely prints the expected marker text cannot satisfy it.
 *
 * Usage: bunx tsx scripts/omni-comms/integration/assert-build4a-result.ts <file> <expected-sha>
 * Prints: OMNI COMMS BUILD 4A STRUCTURED RESULT OK
 */
import { readFileSync } from 'node:fs';

const RESULT_SCHEMA = 'omni_comms.build4a.certification.result';
const RESULT_VERSION = 1;
const AUTHORIZATION_MARKER = 'OMNI COMMS BUILD 4A AUTHORIZATION INTEGRATION OK';
const ATOMICITY_MARKER = 'OMNI COMMS BUILD 4A ATOMICITY INTEGRATION OK';

const REQUIRED_SCENARIOS = [
  'authorized_caller_success',
  'missing_capability_denied',
  'foreign_tenant_denied',
  'unknown_organization_denied',
  'unauthenticated_denied',
  'private_bootstrap_not_public',
  'prerequisite_failure_no_mutation',
  'late_stage_rollback_restores_baseline',
  'retry_after_rollback_single_result',
  'replay_after_success_is_deterministic',
  'concurrent_equivalent_requests',
];

const ZERO_SIDE_EFFECTS = [
  'dispatch_jobs',
  'delivery_attempts',
  'provider_calls',
  'emails',
  'webhook_events',
  'messages',
  'message_events',
  'unintended_requests',
];

const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

function main(): void {
  const [file, expectedSha] = process.argv.slice(2);
  if (!file) fail('no structured result file was supplied');
  if (!expectedSha || !/^[0-9a-f]{40}$/.test(expectedSha ?? '')) {
    fail('expected commit SHA is not a full 40-character git revision');
  }

  let result: Record<string, unknown> = {};
  if (file) {
    try {
      result = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch {
      fail('structured result file is missing or not valid JSON');
    }
  }

  if (result.schema !== RESULT_SCHEMA) fail('structured result schema is not recognised');
  if (result.version !== RESULT_VERSION) fail('structured result version is not supported');
  if (result.refused === true) fail(`harness refused: ${String(result.refusal_reason ?? 'unknown')}`);
  if (result.commit_sha !== expectedSha) {
    fail('structured result commit SHA does not equal the checked-out revision');
  }

  const scenarios = Array.isArray(result.scenarios)
    ? (result.scenarios as Array<Record<string, unknown>>)
    : [];
  for (const name of REQUIRED_SCENARIOS) {
    const entry = scenarios.find((s) => s.name === name);
    if (!entry) fail(`required scenario missing: ${name}`);
    else if (entry.ok !== true) fail(`scenario did not pass: ${name}`);
  }

  const total = Number(result.scenarios_total ?? -1);
  const passed = Number(result.passed ?? -1);
  const failed = Number(result.failed ?? -1);
  if (total !== scenarios.length) fail('scenario total does not match the recorded scenarios');
  if (total < REQUIRED_SCENARIOS.length) fail('fewer scenarios executed than required');
  if (failed !== 0) fail(`structured result reports ${failed} failed scenario(s)`);
  if (passed !== total) fail('structured result pass count does not equal the scenario total');

  const side = (result.side_effects ?? {}) as Record<string, unknown>;
  for (const key of ZERO_SIDE_EFFECTS) {
    const value = Number(side[key]);
    if (!Number.isFinite(value)) fail(`side-effect counter not measured: ${key}`);
    else if (value !== 0) fail(`side-effect counter is not zero: ${key}=${value}`);
  }
  if (result.safety_breached !== false) fail('structured result reports a safety breach');

  if (result.cleanup_ok !== true) fail(`fixture cleanup did not succeed: ${String(result.cleanup)}`);

  if (result.authorization_marker !== AUTHORIZATION_MARKER) {
    fail('authorization integration marker is not present in the structured result');
  }
  if (result.atomicity_marker !== ATOMICITY_MARKER) {
    fail('atomicity integration marker is not present in the structured result');
  }

  if (failures.length > 0) {
    for (const f of failures) console.log(`FAIL — ${f}`);
    console.log('BUILD 4A IMPLEMENTED — PRIVILEGED CERTIFICATION INCOMPLETE');
    process.exit(1);
  }

  console.log(`structured result scenarios: ${total} (all passed)`);
  console.log(`structured result cleanup: ${String(result.cleanup)}`);
  console.log(AUTHORIZATION_MARKER);
  console.log(ATOMICITY_MARKER);
  console.log('OMNI COMMS BUILD 4A STRUCTURED RESULT OK');
}

main();
