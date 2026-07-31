/**
 * Static validation of the privileged Edge-resolution certification harness.
 * These tests read the source; they never execute it and never touch staging.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const HARNESS_PATH = path.resolve(
  __dirname,
  '../../../scripts/omni-comms/integration/run-edge-resolution.ts',
);
const src = readFileSync(HARNESS_PATH, 'utf8');

const REQUIRED_SCENARIOS = [
  'missing_jwt_rejection',
  'permission_rejection',
  'cross_tenant_rejection',
  'spoofed_caller_module_rejection',
  'department_access_rejection',
  'registered_but_unauthorised_module_rejection',
  'valid_first_request',
  'recipient_persistence',
  'deterministic_resolution',
  'deterministic_rendering',
  'identical_replay',
  'mismatched_replay_rejection',
  'concurrent_idempotency_semantics',
  'dry_run_creates_no_jobs',
  'atomic_failure_no_partial_records',
  'safety_invariants',
  'cleanup_verified',
];

describe('Omni-Comms privileged certification harness', () => {
  it('covers every required semantic scenario', () => {
    for (const name of REQUIRED_SCENARIOS) {
      expect(src).toContain(`'${name}'`);
    }
    // Held-job scenarios are generated per mode.
    expect(src).toMatch(/\$\{mode\}_creates_held_jobs_only/);
  });

  it('reports a truthful, drift-proof scenario count', () => {
    expect(src).toContain('EXPECTED_SCENARIO_COUNT');
    expect(src).toMatch(/scenarioCountTruthful\s*=\s*results\.length === EXPECTED_SCENARIO_COUNT/);
    expect(src).toMatch(/!scenarioCountTruthful/);
    expect(src).toContain('duplicateScenarioNames');
  });

  it('refuses to run without a full git revision', () => {
    expect(src).toMatch(/\^\[0-9a-f\]\{40\}\$/);
    expect(src).toMatch(/COMMIT_SHA.*GITHUB_SHA/s);
  });

  it('treats edge-revision binding as a precondition, not a scenario', () => {
    expect(src).toContain('edgeRevisionMatchesCommit');
    expect(src).toContain('OMNI_COMMS_REQUIRE_EDGE_REVISION');
    expect(src).toMatch(/requireEdgeRevision && !edgeRevisionMatchesCommit/);
    // It must refuse before creating fixtures, never be counted as a pass.
    expect(src).not.toContain("scenario('edge_revision_binding'");
    expect(src).toMatch(/refuse\('deployed Edge revision does not equal the certified commit'\)/);
  });

  it('asserts terminal message statuses, never the transient rendered state', () => {
    expect(src).toContain('TERMINAL_MESSAGE_STATUS');
    expect(src).toContain('dry_run_completed');
    expect(src).toContain('shadow_completed');
    expect(src).not.toMatch(/assertEqual\(row\.status, 'rendered'/);
  });

  it('scopes safety measurement to this run\'s fixtures', () => {
    expect(src).toContain('harness_fixtures_only');
    expect(src).toMatch(/delivery attempts \(fixture-scoped\)/);
    expect(src).not.toMatch(/delivery attempts \(global\)/);
  });

  it('verifies recipients come from the persisted projection', () => {
    expect(src).toContain('firstRecipientIds');
    expect(src).toMatch(/projected vs persisted recipient ids/);
    expect(src).toMatch(/replay recipient identity/);
  });

  it('requires real, distinct tenant-isolation fixtures', () => {
    expect(src).toContain('OMNI_COMMS_TEST_FOREIGN_ORGANIZATION_ID');
    expect(src).toContain('OMNI_COMMS_TEST_FOREIGN_DEPARTMENT_ID');
    expect(src).not.toContain('RANDOM_ORG_ID');
    expect(src).not.toContain('RANDOM_DEPARTMENT_ID');
    expect(src).toMatch(/equals the primary test organisation/);
    expect(src).toMatch(/equals the primary test department/);
    // Fixtures must be proven to exist before the negative scenarios run.
    expect(src).toContain('core_organization');
    expect(src).toContain('core_department');
    expect(src).toMatch(/does not exist in staging/);
  });

  it('certifies the real pilot caller module through the registry', () => {
    expect(src).toContain('OMNI_COMMS_TEST_CALLER_MODULE');
    expect(src).toContain('omni_comms_caller_module_registry');
    expect(src).toMatch(/is not registered/);
    expect(src).toMatch(/registered but inactive/);
    expect(src).toMatch(/has_permission/);
    expect(src).not.toMatch(/moduleCode:\s*'OMNI_COMMS_DIRECT'/);
  });

  it('asserts the atomic-failure scenario exactly', () => {
    expect(src).toMatch(/assertEqual\(blockersOf\(r\.body\), \['event_code_not_found'\]/);
    expect(src).toMatch(/assertEqual\(r\.body\.status, 'blocked'/);
    expect(src).toMatch(/assertEqual\(ids\.length, 0, 'persisted request rows'\)/);
  });


  it('measures provider calls and emails instead of hardcoding zero', () => {
    expect(src).not.toMatch(/providerCallCount:\s*0\s*,/);
    expect(src).not.toMatch(/emailCount:\s*0\s*,/);
    expect(src).toMatch(/providerCallCount\s*=/);
    expect(src).toMatch(/emailCount\s*=/);
    expect(src).toMatch(/assertEqual\(providerCallCount, 0/);
    expect(src).toMatch(/assertEqual\(emailCount, 0/);
  });

  it('asserts held dispatch jobs are non-runnable and untouched', () => {
    expect(src).toMatch(/assertEqual\(j\.is_runnable, false/);
    expect(src).toMatch(/assertEqual\(j\.attempt_count \?\? 0, 0/);
    expect(src).toMatch(/assertEqual\(j\.locked_at, null/);
    expect(src).toMatch(/assertEqual\(j\.lease_expires_at, null/);
  });

  it('reads the real recipient resolution column', () => {
    expect(src).toContain('resolution_snapshot');
  });

  it('checks every cleanup delete and verifies post-cleanup emptiness', () => {
    expect(src).toMatch(/delete failed/);
    expect(src).toContain('omni_comms_message_event');
    expect(src).not.toContain('omni_comms_request_event');
    expect(src).toMatch(/messages remaining/);
    expect(src).toMatch(/dispatch jobs remaining/);
    expect(src).toMatch(/recipients remaining/);
  });

  it('fails the run when any safety invariant is breached', () => {
    expect(src).toMatch(/const safetyBreached =/);
    expect(src).toMatch(/runnableJobCount > 0/);
    expect(src).toMatch(/deliveryAttemptCount > 0/);
    expect(src).toMatch(/providerCallCount > 0/);
    expect(src).toMatch(/emailCount > 0/);
  });

  it('does not claim success unless everything passed', () => {
    const okIndex = src.lastIndexOf('BUILD 3 SLICE 2C-II EDGE RESOLUTION INTEGRATION OK');
    const exitIndex = src.indexOf('process.exit(3)');
    expect(exitIndex).toBeGreaterThan(-1);
    expect(okIndex).toBeGreaterThan(exitIndex);
  });

  it('never contacts a provider or sends anything', () => {
    expect(src).not.toMatch(/resend|twilio|sendgrid|nodemailer/i);
    expect(src).not.toMatch(/omni_comms_delivery_attempt'\)\s*\.insert/);
  });

  it('embeds no literal credentials', () => {
    expect(src).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
    expect(src).not.toMatch(/postgres:\/\/[^$\s]+/);
  });
});
