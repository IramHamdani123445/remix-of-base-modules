/**
 * Static validation of the Build 4A privileged certification mechanism.
 * These tests read the sources; they never execute them and never touch
 * staging.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const root = path.resolve(__dirname, '../../..');
const harness = readFileSync(
  path.join(root, 'scripts/omni-comms/integration/run-build4a-authorization.ts'),
  'utf8',
);
const asserter = readFileSync(
  path.join(root, 'scripts/omni-comms/integration/assert-build4a-result.ts'),
  'utf8',
);
const workflow = readFileSync(
  path.join(root, '.github/workflows/omni-comms-build4a-certification.yml'),
  'utf8',
);
const cleanupSql = readFileSync(
  path.join(root, 'scripts/omni-comms/verify-build4a-fixture-cleanup.sql'),
  'utf8',
);

describe('Build 4A certification harness', () => {
  it('covers every required authorization scenario', () => {
    for (const name of [
      'authorized_caller_success',
      'missing_capability_denied',
      'foreign_tenant_denied',
      'unknown_organization_denied',
      'unauthenticated_denied',
      'private_bootstrap_not_public',
    ]) {
      expect(harness).toContain(`'${name}'`);
    }
  });

  it('covers every required atomicity scenario', () => {
    for (const name of [
      'prerequisite_failure_no_mutation',
      'late_stage_rollback_restores_baseline',
      'retry_after_rollback_single_result',
      'replay_after_success_is_deterministic',
      'concurrent_equivalent_requests',
    ]) {
      expect(harness).toContain(`'${name}'`);
    }
  });

  it('exercises the public boundary and never substitutes the private RPC', () => {
    expect(harness).toContain('omni_comms_bootstrap_employer_registration_pilot');
    expect(harness).toMatch(/rest\/v1\/rpc\/\$\{BOOTSTRAP_FN\}/);
    const privateCalls = harness.match(/PRIVATE_BOOTSTRAP_FN/g) ?? [];
    expect(privateCalls.length).toBeGreaterThan(0);
    expect(harness).toContain('private bootstrap RPC is reachable from a browser role');
  });

  it('refuses to run without a full git revision and a valid namespace', () => {
    expect(harness).toMatch(/\^\[0-9a-f\]\{40\}\$/);
    expect(harness).toContain('OMNI_COMMS_CERT_NAMESPACE');
    expect(harness).toMatch(/is not a valid certification namespace/);
  });

  it('refuses to run outside an exactly non_production environment', () => {
    expect(harness).toContain('omni_comms_priv_runtime_environment');
    expect(harness).toMatch(/environment !== 'non_production'/);
    expect(harness).toMatch(/not authoritatively non_production/);
  });

  it('refuses real tenants and requires namespaced fixture organisations', () => {
    expect(harness).toMatch(/resolves to a real tenant/);
    expect(harness).toMatch(/not inside the certification namespace/);
    expect(harness).toContain("'SKN-SSB'");
  });

  /* ---- 1. runtime sessions instead of durable JWT secrets ---------- */

  it('uses no durable access-token JWT secrets', () => {
    expect(harness).not.toContain('OMNI_COMMS_CERT_CONFIGURE_JWT');
    expect(harness).not.toContain('OMNI_COMMS_CERT_UNPRIVILEGED_JWT');
    expect(harness).not.toContain('OMNI_COMMS_CERT_FOREIGN_TENANT_JWT');
  });

  it('obtains fresh sessions through the normal Supabase Auth boundary', () => {
    expect(harness).toContain('/auth/v1/token?grant_type=password');
    expect(harness).toContain('SUPABASE_ANON_KEY');
    for (const name of [
      'OMNI_COMMS_CERT_CONFIGURE_EMAIL',
      'OMNI_COMMS_CERT_CONFIGURE_PASSWORD',
      'OMNI_COMMS_CERT_UNPRIVILEGED_EMAIL',
      'OMNI_COMMS_CERT_UNPRIVILEGED_PASSWORD',
      'OMNI_COMMS_CERT_FOREIGN_EMAIL',
      'OMNI_COMMS_CERT_FOREIGN_PASSWORD',
    ]) {
      expect(harness).toContain(name);
    }
  });

  it('masks access and refresh tokens immediately and never prints them', () => {
    expect(harness).toMatch(/mask\(token\)/);
    expect(harness).toMatch(/mask\(refresh\)/);
    expect(harness).toContain('::add-mask::');
    expect(harness).not.toMatch(/console\.log\([^)]*\btoken\b/);
    expect(harness).not.toMatch(/console\.log\([^)]*password/i);
  });

  it('validates every runtime-issued token before testing', () => {
    expect(harness).toMatch(/already expired/);
    expect(harness).toMatch(/does not carry the authenticated role/);
    expect(harness).toMatch(/subject does not match the issued user/);
    expect(harness).toMatch(/identity does not match the configured user/);
    expect(harness).toMatch(/lifetime is insufficient for the run/);
    expect(harness).toContain('MIN_TOKEN_LIFETIME_SECONDS');
    expect(harness).toMatch(/attached to a non-certification tenant/);
  });

  it('fails closed with a sanitized identity name on auth failure', () => {
    expect(harness).toMatch(/certification identity could not authenticate: \$\{identity\}/);
    expect(harness).toMatch(/Sanitised: identity name only/);
  });

  /* ---- 2. preflight cleanup of interrupted runs -------------------- */

  it('runs an idempotent, namespace-restricted preflight cleanup', () => {
    expect(harness).toContain('preflightCleanup');
    expect(harness).toMatch(/preflight cleanup refused: a target organisation is outside/);
    expect(harness).toMatch(/preflight cleanup: \$\{/);
    for (const key of [
      'stale_fault_triggers',
      'stale_fault_functions',
      'temporary_capability_assignments',
      'temporary_department_assignments',
      'incomplete_bootstrap_fixtures',
      'namespaced_test_records',
    ]) {
      expect(harness).toContain(key);
    }
  });

  it('never deletes outside the certification organisations', () => {
    const deletes = harness.match(/DELETE FROM public\.[a-z_]+[^;]*/g) ?? [];
    expect(deletes.length).toBeGreaterThan(0);
    for (const stmt of deletes) {
      expect(
        /organization_id IN \(\$\{orgList\}\)|organization_id = \$\{lit\(/.test(stmt) ||
          /event_code = \$\{lit\(PILOT_EVENT_CODE\)\}/.test(stmt) ||
          /tf\.organization_id IN \(\$\{orgList\}\)/.test(stmt),
      ).toBe(true);
    }
  });

  /* ---- 3. hardened fault mechanism --------------------------------- */

  it('proves every precondition before installing the fault mechanism', () => {
    expect(harness).toContain('assertFaultInstallationPermitted');
    expect(harness).toMatch(/authoritative environment is not exactly non_production/);
    expect(harness).toMatch(/target is not the isolated certification organisation/);
    expect(harness).toMatch(/fixture namespace does not match the approved prefix/);
    expect(harness).toMatch(/a real organisation identifier is involved/);
    expect(harness).toMatch(/database role is superuser/);
    expect(harness).toMatch(/database role bypasses RLS/);
    expect(harness).toMatch(/lacks the required staging DDL capability/);
    const installIdx = harness.indexOf('async function installFault');
    const assertIdx = harness.indexOf('await assertFaultInstallationPermitted');
    expect(installIdx).toBeGreaterThan(-1);
    expect(assertIdx).toBeGreaterThan(-1);
  });

  it('names temporary objects with a sanitized unique run identifier', () => {
    expect(harness).toContain('RUN_ID');
    expect(harness).toMatch(/replace\(\/\[\^a-z0-9\]\+\/g, ''\)/);
    expect(harness).toMatch(/\$\{ns\}_\$\{RUN_ID\}/);
    expect(harness).toContain('CERT_FAULT_PREFIX');
  });

  it('requires both the isolated organisation and the namespace in the fault predicate', () => {
    expect(harness).toContain('CREATE CONSTRAINT TRIGGER');
    expect(harness).toMatch(/NEW\.organization_id = \$\{lit\(orgId\)\}/);
    expect(harness).toMatch(/o\.org_code LIKE \$\{lit\(`\$\{CERT_NAMESPACE\}%`\)\}/);
  });

  it('drops the fault in normal and failure cleanup and verifies its absence', () => {
    expect(harness).toContain('removeFault');
    expect(harness).toContain('faultPresent');
    expect(harness).toMatch(/catch \(err\)[\s\S]*removeFault/);
  });

  /* ---- side effects, cleanup, markers ------------------------------ */

  it('verifies zero mutation on every denial', () => {
    const denialAsserts = harness.match(/denial mutated bootstrap tables|denial mutated tables/g) ?? [];
    expect(denialAsserts.length).toBeGreaterThanOrEqual(4);
  });

  it('measures every zero-side-effect counter instead of hardcoding it', () => {
    for (const key of [
      'no_dispatch_job',
      'no_delivery_attempt',
      'no_provider_call',
      'no_email',
      'no_webhook_event',
      'no_unintended_message',
      'no_unintended_message_event',
    ]) {
      expect(harness).toContain(key);
    }
    expect(harness).toContain('sanctioned_dry_run_requests');
    expect(harness).toMatch(/const safetyBreached =/);
  });

  it('cleans up and verifies cleanup, including on failure', () => {
    expect(harness).toContain('deleteScopedFixtures');
    expect(harness).toContain('cleanupOk');
    expect(harness).toMatch(/cleanup: \$\{cleanupDetail\}/);
  });

  it('deletes global pilot objects only when it created them', () => {
    expect(harness).toContain('preExistingEventId');
    expect(harness).toMatch(/if \(!preExistingEventId\)/);
  });

  /* ---- 5. structured result ---------------------------------------- */

  it('writes a structured result carrying schema, sha, totals and markers', () => {
    expect(harness).toContain('omni_comms.build4a.certification.result');
    expect(harness).toContain('RESULT_VERSION');
    expect(harness).toMatch(/writeResult\(/);
    for (const field of [
      'commit_sha',
      'scenarios_total',
      'passed',
      'failed',
      'side_effects',
      'cleanup_ok',
      'authorization_marker',
      'atomicity_marker',
    ]) {
      expect(harness).toContain(field);
    }
  });

  it('emits markers into the result only when every gate passed', () => {
    expect(harness).toMatch(/authorizationPassed && allPassed \? AUTHORIZATION_MARKER : null/);
    expect(harness).toMatch(/atomicityPassed && allPassed \? ATOMICITY_MARKER : null/);
    expect(harness).toMatch(/const allPassed = failed === 0 && !safetyBreached && cleanupOk/);
  });

  it('embeds no literal credentials', () => {
    expect(harness).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
    expect(harness).not.toMatch(/postgres:\/\/[^$\s]+/);
  });

  it('never imports or contacts a provider', () => {
    expect(harness).not.toMatch(/resend|twilio|sendgrid|nodemailer/i);
  });
});

describe('Build 4A structured result assertion', () => {
  it('validates schema, version and the exact commit SHA', () => {
    expect(asserter).toContain('omni_comms.build4a.certification.result');
    expect(asserter).toMatch(/version !== RESULT_VERSION/);
    expect(asserter).toMatch(/\^\[0-9a-f\]\{40\}\$/);
    expect(asserter).toMatch(/commit SHA does not equal the checked-out revision/);
  });

  it('requires every scenario to be present and passing', () => {
    for (const name of [
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
    ]) {
      expect(asserter).toContain(`'${name}'`);
    }
    expect(asserter).toMatch(/required scenario missing/);
    expect(asserter).toMatch(/scenario did not pass/);
  });

  it('requires zero side effects and successful cleanup', () => {
    for (const key of [
      'dispatch_jobs',
      'delivery_attempts',
      'provider_calls',
      'emails',
      'webhook_events',
      'messages',
      'message_events',
      'unintended_requests',
    ]) {
      expect(asserter).toContain(`'${key}'`);
    }
    expect(asserter).toMatch(/fixture cleanup did not succeed/);
    expect(asserter).toMatch(/safety breach/);
  });

  it('requires both integration markers inside the structured result', () => {
    expect(asserter).toMatch(/result\.authorization_marker !== AUTHORIZATION_MARKER/);
    expect(asserter).toMatch(/result\.atomicity_marker !== ATOMICITY_MARKER/);
  });

  it('fails closed with the incomplete verdict', () => {
    expect(asserter).toContain('BUILD 4A IMPLEMENTED — PRIVILEGED CERTIFICATION INCOMPLETE');
    expect(asserter).toContain('OMNI COMMS BUILD 4A STRUCTURED RESULT OK');
    expect(asserter).toMatch(/process\.exit\(1\)/);
  });
});

describe('Build 4A certification workflow', () => {
  it('is workflow_dispatch only', () => {
    expect(workflow).toMatch(/on:\s*\n\s*workflow_dispatch:/);
    expect(workflow).not.toMatch(/^\s*pull_request\s*:/m);
    expect(workflow).not.toMatch(/^\s*push\s*:/m);
    expect(workflow).not.toMatch(/^\s*schedule\s*:/m);
  });

  it('reuses the protected staging environment with read-only permissions', () => {
    expect(workflow).toMatch(/environment:\s*omni-comms-staging/);
    expect(workflow).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(workflow).not.toMatch(/contents:\s*write/);
    expect(workflow).not.toMatch(/id-token:\s*write/);
  });

  it('prevents overlapping certification runs', () => {
    expect(workflow).toMatch(/concurrency:\s*\n\s*group:\s*omni-comms-build4a-certification/);
    expect(workflow).toMatch(/cancel-in-progress:\s*false/);
  });

  it('requires a clean checkout and verifies the exact commit after checkout', () => {
    expect(workflow).toMatch(/git status --short/);
    expect(workflow).toMatch(/commit_sha=\$CERTIFIED_SHA/);
    expect(workflow).toMatch(/-ne 40/);
    expect(workflow).toMatch(/assert-build4a-result\.ts[\s\S]*git rev-parse HEAD/);
  });

  it('uses staging certification-user credentials, not durable access tokens', () => {
    for (const name of [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'OMNI_COMMS_STAGING_DB_URL',
      'OMNI_COMMS_CERT_CONFIGURE_EMAIL',
      'OMNI_COMMS_CERT_CONFIGURE_PASSWORD',
      'OMNI_COMMS_CERT_UNPRIVILEGED_EMAIL',
      'OMNI_COMMS_CERT_UNPRIVILEGED_PASSWORD',
      'OMNI_COMMS_CERT_FOREIGN_EMAIL',
      'OMNI_COMMS_CERT_FOREIGN_PASSWORD',
    ]) {
      expect(workflow).toMatch(new RegExp(`secrets\\.${name}`));
    }
    expect(workflow).not.toContain('OMNI_COMMS_CERT_CONFIGURE_JWT');
    expect(workflow).not.toContain('OMNI_COMMS_CERT_UNPRIVILEGED_JWT');
    expect(workflow).not.toContain('OMNI_COMMS_CERT_FOREIGN_TENANT_JWT');
    for (const name of [
      'OMNI_COMMS_CERT_ORGANIZATION_ID',
      'OMNI_COMMS_CERT_FOREIGN_ORGANIZATION_ID',
      'OMNI_COMMS_CERT_NAMESPACE',
    ]) {
      expect(workflow).toMatch(new RegExp(`vars\\.${name}`));
    }
  });

  it('masks credentials and redacts tokens and authorization headers', () => {
    expect(workflow).toMatch(/::add-mask::/);
    expect(workflow).toMatch(/set \+x/);
    expect(workflow).toMatch(/Authorization: Bearer \)\[\^ \]\+/);
    expect(workflow).toMatch(/eyJ\[A-Za-z0-9_-\]\{10,\}/);
  });

  it('embeds no literal secret values', () => {
    expect(workflow).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
    expect(workflow).not.toMatch(/postgres:\/\/[^$][^\s]+/);
  });

  it('never weakens grants or contacts providers', () => {
    expect(workflow).not.toMatch(/\bGRANT\s+/i);
    expect(workflow).not.toMatch(/\bREVOKE\s+/i);
    expect(workflow).not.toMatch(/RESEND_API_KEY|TWILIO_|SENDGRID_/);
  });

  it('determines success from the structured result, not arbitrary log text', () => {
    expect(workflow).toMatch(/Validate structured certification result/);
    expect(workflow).toMatch(/steps\.structured\.outcome/);
    expect(workflow).toMatch(/steps\.cleanup\.outcome/);
    // markers are read only from their own producing gate
    expect(workflow).toMatch(
      /AUTHORIZATION INTEGRATION OK" \.certification-logs\/structured-result\.log/,
    );
    expect(workflow).not.toMatch(/INTEGRATION OK" "\$log"/);
  });

  it('runs cleanup and artifact upload with if: always()', () => {
    expect(workflow).toMatch(/Fixture-cleanup verifier[\s\S]{0,120}if:\s*always\(\)/);
    expect(workflow).toMatch(/if:\s*always\(\)[\s\S]*upload-artifact/);
  });

  it('runs the full final gate battery', () => {
    expect(workflow).toMatch(/vitest run src\/__tests__\/omni-comms\//);
    expect(workflow).toMatch(/check:omni-comms-architecture/);
    expect(workflow).toMatch(/tsgo --noEmit/);
    expect(workflow).toMatch(/bun run build/);
    expect(workflow).toMatch(/eslint/);
    expect(workflow).toMatch(/verify-build4a-producer\.sql/);
    expect(workflow).toMatch(/story3-registries\.test\.ts/);
    expect(workflow).toMatch(/verify-build4a-fixture-cleanup\.sql/);
  });

  it('emits exactly one of the two permitted verdicts', () => {
    expect(workflow).toContain('BUILD 4A VERIFIED');
    expect(workflow).toContain('BUILD 4A IMPLEMENTED — PRIVILEGED CERTIFICATION INCOMPLETE');
    expect(workflow).toMatch(/missing protected capability or gate/);
  });

  it('does not mutate readiness, baselines, or evidence', () => {
    expect(workflow).not.toMatch(/readinessManifest/);
    expect(workflow).not.toMatch(/git\s+commit/);
    expect(workflow).not.toMatch(/git\s+push/);
  });

  it('uses pinned major versions for third-party actions', () => {
    expect(workflow).toMatch(/actions\/checkout@v4/);
    expect(workflow).toMatch(/oven-sh\/setup-bun@v2/);
    expect(workflow).toMatch(/actions\/upload-artifact@v4/);
  });
});

describe('Build 4A fixture cleanup verifier', () => {
  it('is scoped to the certification namespace and both certification tenants', () => {
    expect(cleanupSql).toContain('cert_org');
    expect(cleanupSql).toContain('cert_foreign_org');
    expect(cleanupSql).toContain('cert_namespace');
    expect(cleanupSql).toMatch(/not inside the certification namespace/);
  });

  it('checks fixtures, assignments and the fault mechanism', () => {
    expect(cleanupSql).toContain('omni_comms_producer_event_binding');
    expect(cleanupSql).toContain('core_department');
    expect(cleanupSql).toContain('core_staff_assignments');
    expect(cleanupSql).toMatch(/omni\\_comms\\_cert\\_fault\\_%/);
  });

  it('fails when either the fault trigger or its function remains', () => {
    expect(cleanupSql).toMatch(/injected certification fault trigger\(s\) remain/);
    expect(cleanupSql).toMatch(/injected certification fault function\(s\) remain/);
  });

  it('prints the cleanup marker', () => {
    expect(cleanupSql).toContain('OMNI COMMS BUILD 4A FIXTURE CLEANUP OK');
  });

  it('contains no grant changes or credentials', () => {
    expect(cleanupSql).not.toMatch(/\bGRANT\s+/i);
    expect(cleanupSql).not.toMatch(/\bREVOKE\s+/i);
    expect(cleanupSql).not.toMatch(/postgres:\/\//);
  });
});
