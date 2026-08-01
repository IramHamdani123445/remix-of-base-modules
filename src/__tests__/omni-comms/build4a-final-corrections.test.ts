/**
 * Build 4A — FINAL acceptance corrections.
 *
 * Source-level proofs over the shipped migration, the SQL verifier and the
 * business producer layer. No network, no provider, no Supabase.
 *
 *  1. the pilot environment guard fails closed on the authoritative reader;
 *  2. the administrator-facing bootstrap enforces capability AND tenant access;
 *  3. retirement of the incorrect binding is scoped to the SKN-SSB pilot;
 *  4. the idempotency identity is complete (tenant included);
 *  5. the bootstrap cannot leave a partially active pilot;
 *  6. the submission surface links to the Operations evidence.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildProducerIdentityString,
  buildProducerIdempotencyKey,
} from '@/platform/omni-comms/integrations/business/emitBusinessCommunication';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
const FINAL_MIGRATION = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
  .filter((sql) => sql.includes('omni_comms_priv_pilot_assert_non_production'))
  .pop() as string;

const VERIFIER = read('scripts/omni-comms/verify-build4a-producer.sql');

/* ── 1. environment guard ──────────────────────────────────────────────── */

describe('Build 4A final — pilot environment guard fails closed', () => {
  const guard = FINAL_MIGRATION.slice(
    FINAL_MIGRATION.indexOf('FUNCTION public.omni_comms_priv_pilot_assert_non_production'),
    FINAL_MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.omni_comms_priv_bootstrap_employer_registration_pilot'),
  );

  it('reads the authoritative runtime environment record', () => {
    expect(guard).toContain('public.omni_comms_priv_runtime_environment()');
  });

  it('requires an exact non_production environment', () => {
    expect(guard).toContain("v_env <> 'non_production'");
    expect(guard).toContain('pilot_bootstrap_non_production_required');
  });

  it('no longer fails open by testing only for production', () => {
    expect(guard).not.toMatch(/=\s*'production'/);
    expect(guard).not.toContain('pilot_bootstrap_forbidden_in_production');
  });

  it('treats an unreadable environment as unknown and refuses', () => {
    expect(guard).toContain('EXCEPTION WHEN OTHERS');
    expect(guard).toContain("v_env := 'unknown'");
  });

  it('is not executable by browser roles', () => {
    expect(FINAL_MIGRATION).toContain(
      'REVOKE ALL ON FUNCTION public.omni_comms_priv_pilot_assert_non_production() FROM authenticated',
    );
  });

  it('is asserted by the verifier', () => {
    expect(VERIFIER).toContain('omni_comms_priv_runtime_environment()');
    expect(VERIFIER).toContain('pilot guard still fails open');
  });
});

/* ── 2. tenant authorisation on the public wrapper ─────────────────────── */

describe('Build 4A final — tenant authorisation on the public bootstrap', () => {
  const wrapper = FINAL_MIGRATION.slice(
    FINAL_MIGRATION.indexOf(
      'CREATE OR REPLACE FUNCTION public.omni_comms_bootstrap_employer_registration_pilot',
    ),
  );

  it('requires the configure capability', () => {
    expect(wrapper).toContain("omni_comms_priv_require_capability('configure')");
  });

  it('resolves the organisation and enforces tenant access before running', () => {
    const org = wrapper.indexOf('FROM public.core_organization');
    const tenant = wrapper.indexOf('omni_comms_priv_require_tenant_access');
    const run = wrapper.indexOf('omni_comms_priv_bootstrap_employer_registration_pilot(\n    v_actor');
    expect(org).toBeGreaterThan(-1);
    expect(tenant).toBeGreaterThan(org);
    expect(run).toBeGreaterThan(tenant);
  });

  it('keeps the internal bootstrap service-role only', () => {
    expect(FINAL_MIGRATION).toContain(
      'REVOKE ALL ON FUNCTION public.omni_comms_priv_bootstrap_employer_registration_pilot(uuid, text, boolean) FROM authenticated',
    );
    expect(FINAL_MIGRATION).toContain(
      'GRANT EXECUTE ON FUNCTION public.omni_comms_priv_bootstrap_employer_registration_pilot(uuid, text, boolean) TO service_role',
    );
  });
});

/* ── 3. scoped retirement ──────────────────────────────────────────────── */

describe('Build 4A final — scoped retirement', () => {
  const block = FINAL_MIGRATION.slice(FINAL_MIGRATION.lastIndexOf('UPDATE public.omni_comms_producer_event_binding'));

  it('scopes the retirement to organisation, module, event and pilot reference', () => {
    expect(block).toContain("b.caller_module_code = 'EMPLOYER_REGISTRATION'");
    expect(block).toContain("b.integration_reference = 'useEmployerRegistrationSubmit'");
    expect(block).toContain("org_code = 'SKN-SSB'");
    expect(block).toContain("code = 'REGISTRATION.EMPLOYER.REGISTERED'");
  });

  it('is proven by the verifier', () => {
    expect(VERIFIER).toContain('a binding outside the SKN-SSB submission pilot was retired');
  });
});

/* ── 4. complete idempotency identity ──────────────────────────────────── */

describe('Build 4A final — complete idempotency identity', () => {
  const identity = {
    organizationId: 'org-1',
    departmentId: 'dept-1',
    moduleCode: 'EMPLOYER_REGISTRATION',
    eventCode: 'REGISTRATION.EMPLOYER.APPLICATION_SUBMITTED',
    entityType: 'employer_registration',
    entityId: 'ER-1',
    entityVersion: 'application-submitted-v1',
    mode: 'shadow' as const,
  };

  it('includes organisation and department', () => {
    const parts = buildProducerIdentityString(identity).split('\u001f');
    expect(parts).toHaveLength(8);
    expect(parts[0]).toBe('org-1');
    expect(parts[1]).toBe('dept-1');
  });

  it('produces a distinct key per tenant', async () => {
    const a = await buildProducerIdempotencyKey(identity);
    const b = await buildProducerIdempotencyKey({ ...identity, organizationId: 'org-2' });
    expect(a).not.toBe(b);
    expect(a).toMatch(/^omni-producer:[0-9a-f]{64}$/);
  });
});

/* ── 5. all-or-nothing bootstrap ───────────────────────────────────────── */

describe('Build 4A final — no partially active pilot', () => {
  it('refuses every missing prerequisite in apply mode', () => {
    for (const reason of [
      'pilot_bootstrap_department_missing',
      'pilot_bootstrap_caller_module_inactive',
      'pilot_bootstrap_sender_identity_missing',
      'pilot_bootstrap_layout_missing',
    ]) {
      expect(FINAL_MIGRATION).toContain(reason);
    }
  });

  it('verifies the whole configuration before returning', () => {
    expect(FINAL_MIGRATION).toContain('pilot_bootstrap_incomplete_configuration');
  });

  it('never downgrades the binding to active without a route and template', () => {
    const gate = FINAL_MIGRATION.slice(
      FINAL_MIGRATION.indexOf('Completion gate'),
      FINAL_MIGRATION.indexOf('pilot_bootstrap_incomplete_configuration'),
    );
    expect(gate).toContain('v_route IS NULL');
    expect(gate).toContain('v_version IS NULL');
    expect(gate).toContain('v_binding IS NULL');
  });
});

/* ── 6. Operations evidence link ───────────────────────────────────────── */

describe('Build 4A final — Operations evidence link', () => {
  const form = read('src/pages/employer-registration/EmployerRegistrationForm.tsx');

  it('links the submission acknowledgement to the exact request', () => {
    expect(form).toContain('/admin/omnichannel-communications/operations?request=');
    expect(form).toContain('View communication evidence');
  });

  it('only offers the link when a request was actually recorded', () => {
    expect(form).toContain('communication?.requestId');
  });

  it('does not import a provider or a Legacy communication module', () => {
    expect(form).not.toMatch(/resend|twilio|nodemailer|notification_queue|comm_hub_/i);
  });
});
