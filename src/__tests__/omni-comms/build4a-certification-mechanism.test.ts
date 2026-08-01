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
    // The private RPC appears only in the negative reachability scenario.
    const privateCalls = harness.match(/PRIVATE_BOOTSTRAP_FN/g) ?? [];
    expect(privateCalls.length).toBeGreaterThan(0);
    expect(harness).toContain('private bootstrap RPC is reachable from a browser role');
  });

  it('refuses to run without a full git revision and a valid namespace', () => {
    expect(harness).toMatch(/\^\[0-9a-f\]\{40\}\$/);
    expect(harness).toContain('OMNI_COMMS_CERT_NAMESPACE');
    expect(harness).toMatch(/is not a valid certification namespace/);
  });

  it('refuses to run outside an authoritative non-production environment', () => {
    expect(harness).toContain('omni_comms_priv_runtime_environment');
    expect(harness).toMatch(/not authoritatively non_production/);
  });

  it('refuses real tenants and requires namespaced fixture organisations', () => {
    expect(harness).toMatch(/resolves to a real tenant/);
    expect(harness).toMatch(/not inside the certification namespace/);
    expect(harness).toContain("'SKN-SSB'");
  });

  it('requires three distinct certification identities', () => {
    expect(harness).toContain('OMNI_COMMS_CERT_CONFIGURE_JWT');
    expect(harness).toContain('OMNI_COMMS_CERT_UNPRIVILEGED_JWT');
    expect(harness).toContain('OMNI_COMMS_CERT_FOREIGN_TENANT_JWT');
    expect(harness).toMatch(/not three distinct identities/);
  });

  it('verifies zero mutation on every denial', () => {
    const denialAsserts = harness.match(/denial mutated bootstrap tables|denial mutated tables/g) ?? [];
    expect(denialAsserts.length).toBeGreaterThanOrEqual(4);
  });

  it('uses a runtime-installed, fixture-scoped fault mechanism', () => {
    expect(harness).toContain('CREATE CONSTRAINT TRIGGER');
    expect(harness).toContain('omni_comms_cert_fault_');
    expect(harness).toMatch(/NEW\.organization_id = \$\{lit\(orgId\)\}/);
    expect(harness).toContain('removeFault');
    expect(harness).toContain('faultPresent');
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
    expect(harness).toMatch(/DELETE FROM public\.omni_comms_producer_event_binding/);
    expect(harness).toContain('cleanupOk');
    expect(harness).toMatch(/cleanup: \$\{cleanupDetail\}/);
    expect(harness).toMatch(/catch \(err\)[\s\S]*removeFault/);
  });

  it('deletes global pilot objects only when it created them', () => {
    expect(harness).toContain('preExistingEventId');
    expect(harness).toMatch(/if \(!preExistingEventId\)/);
  });

  it('prints markers only after the relevant scenarios pass', () => {
    const authIdx = harness.indexOf("'OMNI COMMS BUILD 4A AUTHORIZATION INTEGRATION OK'");
    const atomIdx = harness.indexOf("'OMNI COMMS BUILD 4A ATOMICITY INTEGRATION OK'");
    const exitIdx = harness.indexOf('process.exit(3)');
    expect(authIdx).toBeGreaterThan(-1);
    expect(atomIdx).toBeGreaterThan(-1);
    expect(exitIdx).toBeGreaterThan(-1);
    expect(harness).toMatch(/if \(authorizationPassed\) console\.log/);
    expect(harness).toMatch(/if \(atomicityPassed\) console\.log/);
  });

  it('embeds no literal credentials', () => {
    expect(harness).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
    expect(harness).not.toMatch(/postgres:\/\/[^$\s]+/);
  });

  it('never imports or contacts a provider', () => {
    expect(harness).not.toMatch(/resend|twilio|sendgrid|nodemailer/i);
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

  it('requires a clean checkout and reports the exact commit', () => {
    expect(workflow).toMatch(/git status --short/);
    expect(workflow).toMatch(/commit_sha=\$CERTIFIED_SHA/);
    expect(workflow).toMatch(/harness commit_sha does not equal the checked-out revision/);
  });

  it('references every required protected credential via the secrets context', () => {
    for (const name of [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'OMNI_COMMS_STAGING_DB_URL',
      'OMNI_COMMS_CERT_CONFIGURE_JWT',
      'OMNI_COMMS_CERT_UNPRIVILEGED_JWT',
      'OMNI_COMMS_CERT_FOREIGN_TENANT_JWT',
    ]) {
      expect(workflow).toMatch(new RegExp(`secrets\\.${name}`));
    }
    for (const name of [
      'OMNI_COMMS_CERT_ORGANIZATION_ID',
      'OMNI_COMMS_CERT_FOREIGN_ORGANIZATION_ID',
      'OMNI_COMMS_CERT_NAMESPACE',
    ]) {
      expect(workflow).toMatch(new RegExp(`vars\\.${name}`));
    }
  });

  it('masks credentials and redacts authorization headers', () => {
    expect(workflow).toMatch(/::add-mask::/);
    expect(workflow).toMatch(/set \+x/);
    expect(workflow).toMatch(/Authorization: Bearer \)\[\^ \]\+/);
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

  it('enforces all three required markers plus cleanup', () => {
    expect(workflow).toContain('OMNI COMMS BUILD 4A PRODUCER VERIFY OK');
    expect(workflow).toContain('OMNI COMMS BUILD 4A AUTHORIZATION INTEGRATION OK');
    expect(workflow).toContain('OMNI COMMS BUILD 4A ATOMICITY INTEGRATION OK');
    expect(workflow).toContain('OMNI COMMS BUILD 4A FIXTURE CLEANUP OK');
    expect(workflow).toMatch(/cleanup:\\s\*\(ok\|success\)/);
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

  it('uploads a sanitized artifact under if: always()', () => {
    expect(workflow).toMatch(/upload-artifact@v4/);
    expect(workflow).toMatch(/if:\s*always\(\)[\s\S]*upload-artifact/);
    expect(workflow).toMatch(/retention-days:\s*14/);
  });

  it('uses pinned major versions for third-party actions', () => {
    expect(workflow).toMatch(/actions\/checkout@v4/);
    expect(workflow).toMatch(/oven-sh\/setup-bun@v2/);
    expect(workflow).toMatch(/actions\/upload-artifact@v4/);
  });
});

describe('Build 4A fixture cleanup verifier', () => {
  it('is scoped to the certification namespace', () => {
    expect(cleanupSql).toContain("cert_org");
    expect(cleanupSql).toContain("cert_namespace");
    expect(cleanupSql).toMatch(/not inside the certification namespace/);
  });

  it('checks fixtures, assignments and the fault mechanism', () => {
    expect(cleanupSql).toContain('omni_comms_producer_event_binding');
    expect(cleanupSql).toContain('core_department');
    expect(cleanupSql).toContain('core_staff_assignments');
    expect(cleanupSql).toMatch(/omni\\_comms\\_cert\\_fault\\_%/);
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
