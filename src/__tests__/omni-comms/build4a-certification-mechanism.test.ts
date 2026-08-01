/**
 * Build 4A certification MECHANISM tests.
 *
 * These tests validate the certification apparatus only — the harness source,
 * the shared contract, the fixture-cleanup verifier and the workflow. They
 * never execute the harness, never touch staging and never assert anything
 * about Build 4A product behaviour or readiness status.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  RESULT_SCHEMA,
  RESULT_VERSION,
  SUCCESS_VERDICT,
  INCOMPLETE_VERDICT,
  REQUIRED_SCENARIOS,
  DENIAL_MATRIX,
  NEGATIVE_SCENARIOS,
  ZERO_SIDE_EFFECTS,
  PREFLIGHT_FIELDS,
  OUTBOUND_PROVIDER_CALLS_SENTINEL,
  REQUIRED_HEALTH_POSTURE,
} from '../../../scripts/omni-comms/integration/certificationContract';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const HARNESS = read('scripts/omni-comms/integration/run-build4a-authorization.ts');
const ASSERTER = read('scripts/omni-comms/integration/assert-build4a-result.ts');
const CLEANUP_SQL = read('scripts/omni-comms/verify-build4a-fixture-cleanup.sql');
const WORKFLOW = read('.github/workflows/omni-comms-build4a-certification.yml');

describe('Build 4A certification contract', () => {
  it('is versioned and scope-correct', () => {
    expect(RESULT_SCHEMA).toBe('omni_comms.build4a.certification.result');
    expect(RESULT_VERSION).toBe(2);
    expect(SUCCESS_VERDICT).toBe('BUILD 4A BOOTSTRAP AUTHORIZATION AND ATOMICITY VERIFIED');
    expect(INCOMPLETE_VERDICT).toContain('PRIVILEGED CERTIFICATION INCOMPLETE');
    // The narrow workflow must never claim the broader Build 4A verdict.
    expect(SUCCESS_VERDICT).not.toBe('BUILD 4A VERIFIED');
  });

  it('requires the full authorization and atomicity scenario set', () => {
    for (const name of [
      'authorized_caller_success',
      'missing_capability_denied',
      'foreign_tenant_denied',
      'unknown_organization_denied',
      'unauthenticated_denied',
      'private_bootstrap_denied',
      'prerequisite_failure_no_mutation',
      'late_stage_rollback_restores_baseline',
      'retry_after_rollback_single_result',
      'replay_after_success_is_deterministic',
      'concurrent_equivalent_requests',
    ]) {
      expect(REQUIRED_SCENARIOS).toContain(name);
    }
    expect(new Set(REQUIRED_SCENARIOS).size).toBe(REQUIRED_SCENARIOS.length);
  });

  it('binds every negative scenario to an exact status and bounded slug', () => {
    for (const name of NEGATIVE_SCENARIOS) {
      const expectation = DENIAL_MATRIX[name];
      expect(expectation, name).toBeDefined();
      expect(expectation.status, name).toBeGreaterThanOrEqual(400);
      expect(expectation.code, name).toMatch(/^[a-z][a-z0-9_]+$/);
      expect(REQUIRED_SCENARIOS as readonly string[]).toContain(name);
    }
    expect(DENIAL_MATRIX.unauthenticated_denied).toEqual({
      status: 401,
      code: 'authentication_required',
    });
    expect(DENIAL_MATRIX.missing_capability_denied).toEqual({
      status: 403,
      code: 'permission_denied',
    });
    expect(DENIAL_MATRIX.private_bootstrap_denied.status).toBe(403);
  });

  it('demands a bounded non-production, uncertified deployed posture', () => {
    expect(REQUIRED_HEALTH_POSTURE.environment).toBe('non_production');
    expect(REQUIRED_HEALTH_POSTURE.liveDeliveryEnabled).toBe(false);
    expect(REQUIRED_HEALTH_POSTURE.safeTestPermitted).toBe(false);
    expect(REQUIRED_HEALTH_POSTURE.revisionVerified).toBe(true);
  });

  it('uses a sentinel instead of a fabricated outbound provider-call count', () => {
    expect(OUTBOUND_PROVIDER_CALLS_SENTINEL).toBe('not_applicable_provider_surface_absent');
    expect(ZERO_SIDE_EFFECTS).toContain('provider_sdk_imports');
    expect(ZERO_SIDE_EFFECTS).toContain('runnable_dispatch_jobs');
    expect(ZERO_SIDE_EFFECTS as readonly string[]).not.toContain('provider_calls');
  });

  it('measures preflight cleanup of interrupted previous runs', () => {
    for (const field of ['stale_fault_triggers', 'stale_fault_functions', 'stale_staff_assignments']) {
      expect(PREFLIGHT_FIELDS as readonly string[]).toContain(field);
    }
  });
});

describe('Build 4A certification harness source', () => {
  it('refuses without a full 40-character commit revision', () => {
    expect(HARNESS).toMatch(/\^\[0-9a-f\]\{40\}\$/);
    expect(HARNESS).toContain('COMMIT_SHA');
  });

  it('binds to the deployed Edge revision before any mutation', () => {
    expect(HARNESS).toContain('assertDeployedRevisionBinding');
    expect(HARNESS).toContain('/health');
    expect(HARNESS).toMatch(/REQUIRED_HEALTH_POSTURE/);
    const bindIndex = HARNESS.indexOf('health = await assertDeployedRevisionBinding()');
    const preflightIndex = HARNESS.indexOf('preflight = await preflightCleanup(');
    expect(bindIndex).toBeGreaterThan(-1);
    expect(preflightIndex).toBeGreaterThan(bindIndex);
  });

  it('proves the fault database role is least-privileged, not superuser', () => {
    expect(HARNESS).toContain('OMNI_COMMS_CERT_DB_ROLE');
    expect(HARNESS).toMatch(/rolsuper/);
    expect(HARNESS).toMatch(/database role is superuser/);
  });

  it('obtains fresh sessions at runtime and never embeds credentials', () => {
    expect(HARNESS).toMatch(/auth\/v1\/token\?grant_type=password/);
    expect(HARNESS).toContain('mask(token)');
    expect(HARNESS).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
    expect(HARNESS).not.toMatch(/postgres(ql)?:\/\/[^$\s'"]+/);
    expect(HARNESS).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('provisions three distinct identities and records rows for cleanup', () => {
    expect(HARNESS).toContain("'configure'");
    expect(HARNESS).toContain("'unprivileged'");
    expect(HARNESS).toContain("'foreign'");
    expect(HARNESS).toContain('recordedRows');
  });

  it('exercises the private bootstrap function with its full signature', () => {
    expect(HARNESS).toContain('omni_comms_priv_bootstrap_employer_registration_pilot');
    expect(HARNESS).toContain('omni_comms_bootstrap_employer_registration_pilot');
  });

  it('guarantees cleanup through a single finally lifecycle', () => {
    expect(HARNESS).toMatch(/\}\s*finally\s*\{/);
    expect(HARNESS).toMatch(/refuse\(/);
  });

  it('measures provider safety by evidence, not inference', () => {
    expect(HARNESS).toContain('provider_adapter_present');
    expect(HARNESS).toContain('provider_sdk_imports');
    expect(HARNESS).toContain('OUTBOUND_PROVIDER_CALLS_SENTINEL');
  });

  it('never sends anything or contacts a provider', () => {
    expect(HARNESS).not.toMatch(/from ['"](resend|twilio|@sendgrid|nodemailer)/i);
    expect(HARNESS).not.toMatch(/omni_comms_delivery_attempt'\)\s*\.insert/);
  });

  it('uses the canonical schema for tenancy, templates and events', () => {
    expect(HARNESS).not.toContain('core_staff_assignments.organization_id');
    expect(HARNESS).toMatch(/core_department\s+d\s+ON\s+d\.id\s*=\s*a\.department_id/i);
    expect(HARNESS).not.toMatch(/tv\.family_id/);
    expect(HARNESS).not.toMatch(/event_code\s*=/);
  });
});

describe('Build 4A fixture-cleanup verifier', () => {
  it('reaches tenancy through the department join', () => {
    expect(CLEANUP_SQL).toMatch(/JOIN public\.core_department d ON d\.id = a\.department_id/);
    expect(CLEANUP_SQL).not.toContain('core_staff_assignments.organization_id');
  });

  it('detects residual fault triggers and functions from interrupted runs', () => {
    expect(CLEANUP_SQL).toMatch(/pg_trigger/);
    expect(CLEANUP_SQL).toMatch(/pg_proc/);
    expect(CLEANUP_SQL).toMatch(/omni\\_comms\\_cert\\_fault\\_%/);
  });

  it('is namespace-scoped and read-only', () => {
    expect(CLEANUP_SQL).toContain('cert_namespace');
    expect(CLEANUP_SQL).not.toMatch(/\b(DELETE|TRUNCATE|DROP|UPDATE)\b/);
  });

  it('protects the real SKN-SSB pilot tenant', () => {
    expect(CLEANUP_SQL).toContain("'SKN-SSB'");
  });

  it('checks orphaned certification template versions by template_family_id', () => {
    expect(CLEANUP_SQL).toContain('tv.template_family_id');
  });
});

describe('Build 4A certification workflow', () => {
  it('is manual-only with serialised concurrency', () => {
    expect(WORKFLOW).toContain('workflow_dispatch');
    expect(WORKFLOW).not.toMatch(/^\s{2}(push|pull_request|schedule):/m);
    expect(WORKFLOW).toContain('concurrency:');
    expect(WORKFLOW).toContain('cancel-in-progress: false');
  });

  it('runs in the protected staging environment with read-only permissions', () => {
    expect(WORKFLOW).toContain('environment: omni-comms-staging');
    expect(WORKFLOW).toMatch(/permissions:\s*\n\s*contents: read/);
  });

  it('pins every third-party action to an immutable commit SHA', () => {
    const uses = [...WORKFLOW.matchAll(/uses:\s*([^\s]+)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) {
      expect(u, `unpinned action: ${u}`).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it('never requests a service-role key', () => {
    expect(WORKFLOW).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('validates credentials and rejects administrator or owner roles', () => {
    expect(WORKFLOW).toContain('OMNI_COMMS_CERT_CAPABILITY_ROLE');
    expect(WORKFLOW).toContain('must not be an administrator role');
    expect(WORKFLOW).toContain('must not be a platform owner role');
  });

  it('always runs cleanup verification and sanitization', () => {
    expect(WORKFLOW).toMatch(/name: Fixture-cleanup verifier[\s\S]*?if: always\(\)/);
    expect(WORKFLOW).toMatch(/name: Sanitize logs[\s\S]*?if: always\(\)/);
    expect(WORKFLOW).toContain('sanitization did not remove every credential-shaped value');
  });

  it('derives the verdict from the structured result and owning gates only', () => {
    expect(WORKFLOW).toContain('assert-build4a-result.ts');
    expect(WORKFLOW).toContain(SUCCESS_VERDICT);
    expect(WORKFLOW).toContain(INCOMPLETE_VERDICT);
    expect(WORKFLOW).toContain('steps.structured.outcome');
    expect(WORKFLOW).toContain('steps.cleanup.outcome');
    // Markers may only be read from their own producing log file.
    expect(WORKFLOW).not.toMatch(/grep -[a-zA-Z]*r[a-zA-Z]*\s+"OMNI COMMS BUILD 4A/);
  });
});

describe('Build 4A asserter source', () => {
  it('is independently importable and contract-driven', () => {
    expect(ASSERTER).toContain('export function assertResult');
    expect(ASSERTER).toContain("from './certificationContract'");
    expect(ASSERTER).toContain('DENIAL_MATRIX');
    expect(ASSERTER).toContain('REQUIRED_HEALTH_POSTURE');
  });

  it('prints the incomplete verdict on any failure', () => {
    expect(ASSERTER).toContain('INCOMPLETE_VERDICT');
    expect(ASSERTER).toContain('process.exit(1)');
  });
});
