/**
 * Static validation tests for the Slice 2c-ii privileged certification
 * workflow. These tests inspect the YAML source; they do not execute it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const WORKFLOW_PATH = path.resolve(
  __dirname,
  '../../../.github/workflows/omni-comms-slice2c-ii-certification.yml',
);
const src = readFileSync(WORKFLOW_PATH, 'utf8');

describe('Omni-Comms Slice 2c-ii certification workflow', () => {
  it('is workflow_dispatch only', () => {
    expect(src).toMatch(/on:\s*\n\s*workflow_dispatch:/);
    expect(src).not.toMatch(/^\s*pull_request\s*:/m);
    expect(src).not.toMatch(/^\s*push\s*:/m);
    expect(src).not.toMatch(/^\s*schedule\s*:/m);
  });

  it('runs in the protected omni-comms-staging environment', () => {
    expect(src).toMatch(/environment:\s*omni-comms-staging/);
  });

  it('grants read-only repository permissions', () => {
    expect(src).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(src).not.toMatch(/contents:\s*write/);
    expect(src).not.toMatch(/id-token:\s*write/);
  });

  it('references required secrets via secrets context only', () => {
    for (const name of [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'OMNI_COMMS_TEST_USER_JWT',
      'OMNI_COMMS_STAGING_DB_URL',
    ]) {
      expect(src).toMatch(new RegExp(`secrets\\.${name}`));
    }
  });

  it('embeds no literal secret values', () => {
    // No hardcoded JWTs, keys, or connection strings.
    expect(src).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
    expect(src).not.toMatch(/postgres:\/\/[^$][^\s]+/);
  });

  it('invokes the real Edge harness (not private RPCs)', () => {
    expect(src).toMatch(/scripts\/omni-comms\/integration\/run-edge-resolution\.ts/);
    expect(src).not.toMatch(/omni_comms_priv_send_communication\s*\(/);
    expect(src).not.toMatch(/omni_comms_priv_runtime_resolution_snapshot\s*\(/);
  });

  it('enforces the exact privileged integration marker', () => {
    expect(src).toContain('BUILD 3 SLICE 2C-II EDGE RESOLUTION INTEGRATION OK');
    expect(src).toMatch(/grep\s+-qxF\s+"BUILD 3 SLICE 2C-II EDGE RESOLUTION INTEGRATION OK"/);
  });

  it('runs full gate battery', () => {
    expect(src).toMatch(/vitest run src\/__tests__\/omni-comms\//);
    expect(src).toMatch(/check:omni-comms-architecture/);
    expect(src).toMatch(/tsgo --noEmit/);
    expect(src).toMatch(/bun run build/);
    expect(src).toMatch(/eslint/);
  });

  it('runs all three SQL verifiers with markers', () => {
    expect(src).toMatch(/verify-build3-slice1-runtime-db\.sql/);
    expect(src).toMatch(/verify-build3-slice2b-idempotency\.sql/);
    expect(src).toMatch(/verify-build3-slice2c-ii-resolution\.sql/);
    expect(src).toContain('BUILD 3 SLICE 1 RUNTIME DATABASE VERIFY OK');
    expect(src).toContain('BUILD 3 SLICE 2B IDEMPOTENCY VERIFY OK');
    expect(src).toContain('BUILD 3 SLICE 2C-II RESOLUTION VERIFY OK');
  });

  it('enforces explicit fixture cleanup success', () => {
    expect(src).toMatch(/cleanup:\\s\*\(ok\|success\)/);
  });

  it('uploads a sanitized artifact under if: always()', () => {
    expect(src).toMatch(/upload-artifact@v4/);
    expect(src).toMatch(/if:\s*always\(\)[\s\S]*upload-artifact/);
    expect(src).toMatch(/retention-days:\s*14/);
    expect(src).toMatch(/omni-comms-slice2c-ii-certification-/);
  });

  it('does not mutate readiness, baseline, or evidence files', () => {
    expect(src).not.toMatch(/readinessManifest/);
    expect(src).not.toMatch(/build3-slice2c-ii-test-baseline\.json/);
    expect(src).not.toMatch(/build3-slice2c-ii-resolution\.md/);
    expect(src).not.toMatch(/git\s+commit/);
    expect(src).not.toMatch(/git\s+push/);
  });

  it('contains no grant-changing SQL and no provider credentials', () => {
    expect(src).not.toMatch(/\bGRANT\s+/i);
    expect(src).not.toMatch(/\bREVOKE\s+/i);
    expect(src).not.toMatch(/RESEND_API_KEY|TWILIO_|SENDGRID_/);
  });

  it('has concurrency protection', () => {
    expect(src).toMatch(/concurrency:\s*\n\s*group:\s*omni-comms-slice2c-ii-certification/);
    expect(src).toMatch(/cancel-in-progress:\s*false/);
  });

  it('registers masks and disables shell tracing before validation', () => {
    expect(src).toMatch(/::add-mask::/);
    expect(src).toMatch(/set \+x/);
  });

  it('uses pinned major versions for third-party actions', () => {
    expect(src).toMatch(/actions\/checkout@v4/);
    expect(src).toMatch(/oven-sh\/setup-bun@v2/);
    expect(src).toMatch(/actions\/upload-artifact@v4/);
  });
});
