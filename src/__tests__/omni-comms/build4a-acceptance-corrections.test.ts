/**
 * Build 4A — Acceptance corrections.
 *
 * Proves the narrow correction round:
 *  1. the trusted authorizer is called before EVERY persistence operation,
 *     and the binding it returns — never a browser-supplied value — is what
 *     the runtime persists;
 *  2. the pilot emits the APPLICATION_SUBMITTED event, never REGISTERED;
 *  3. the contract, sample, producer payload and template tokens share ONE
 *     vocabulary, proven by running the real producer payload through real
 *     JSON-Schema validation and the real token-resolution pipeline;
 *  4. the binding is carried on the canonical result contract, on both
 *     mirrors;
 *  5. the emission stays provider-free and non-fatal.
 *
 * Source-level + real-pipeline proofs. No network, no provider, no Supabase.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';

import { resolveTokens } from '../../../supabase/functions/omni-comms-runtime/rendering/tokenResolver';
import {
  EMPLOYER_APPLICATION_SUBMITTED_SCHEMA,
  EMPLOYER_APPLICATION_SUBMITTED_SAMPLE,
  EMPLOYER_APPLICATION_SUBMITTED_EMAIL_CONTENT,
  EMPLOYER_APPLICATION_SUBMITTED_FIELDS,
  EMPLOYER_APPLICATION_FORBIDDEN_PHRASES,
} from '@/platform/omni-comms/integrations/business/employerRegistrationPilotContract';
import {
  buildEmployerRegistrationApplicationSubmittedPayload,
  emitEmployerRegistrationApplicationSubmitted,
  EMPLOYER_APPLICATION_SUBMITTED_EVENT_CODE,
  EMPLOYER_REGISTERED_EVENT_CODE,
} from '@/platform/omni-comms/integrations/business/employerRegistrationProducer';
import {
  buildProducerIdempotencyKey,
  buildProducerIdentityString,
} from '@/platform/omni-comms/integrations/business/emitBusinessCommunication';
import { parseSendCommunicationResult } from '@/platform/omni-comms/runtime/responseContract';

const sendMock = vi.fn();
vi.mock('@/platform/omni-comms/sendCommunication', () => ({
  sendCommunication: (input: unknown) => sendMock(input),
}));

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const EDGE = read('supabase/functions/omni-comms-runtime/index.ts');

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({
    contractVersion: 'omni_comms.result.v1',
    requestId: 'req-1',
    idempotencyKey: 'key-1',
    mode: 'shadow',
    status: 'accepted',
    recipients: [],
    messages: [],
    blockers: [],
    createdAt: new Date().toISOString(),
    replayed: false,
    producerEventBindingId: 'b1b1b1b1-1111-4111-8111-111111111111',
  });
});

/* ── 1. trusted authorizer ─────────────────────────────────────────────── */

describe('Build 4A correction — trusted authorizer execution', () => {
  it('authorises before any persistence operation in the Edge runtime', () => {
    const authzAt = EDGE.indexOf('"omni_comms_priv_authorize_producer_event"');
    expect(authzAt).toBeGreaterThan(-1);

    // Every persistence / mutation RPC must appear AFTER the authorizer call.
    const persistenceRpcs = [
      '"omni_comms_priv_send_communication"',
      '"omni_comms_priv_finalize_resolution"',
      '"omni_comms_priv_load_persisted_resolution"',
      '"omni_comms_priv_load_persisted_messages"',
      '"omni_comms_priv_load_persisted_recipients"',
    ];
    for (const rpc of persistenceRpcs) {
      const at = EDGE.indexOf(rpc);
      expect(at, `${rpc} must exist`).toBeGreaterThan(-1);
      expect(at, `${rpc} must run after authorisation`).toBeGreaterThan(authzAt);
    }
  });

  it('refuses the request when the authorizer does not allow it', () => {
    expect(EDGE).toContain('if (authz.allowed !== true)');
    // Denial short-circuits with a bounded blocker before persistence.
    const denyAt = EDGE.indexOf('if (authz.allowed !== true)');
    expect(denyAt).toBeLessThan(EDGE.indexOf('"omni_comms_priv_send_communication"'));
  });

  it('is documented as service_role-only in the SQL verifier', () => {
    const verifier = read('scripts/omni-comms/verify-build4a-producer.sql');
    expect(verifier).toContain('has_function_privilege');
    expect(verifier).toContain('service_role');
    expect(verifier).toContain('AUTHORIZER GRANTS');
  });
});

/* ── 2. persisted producer binding ─────────────────────────────────────── */

describe('Build 4A correction — persisted producer binding', () => {
  it('passes the authorizer-returned binding into the send RPC', () => {
    expect(EDGE).toContain('const producerEventBindingId =');
    expect(EDGE).toContain('typeof authz.binding_id === "string"');
    expect(EDGE).toContain('p_producer_event_binding_id: producerEventBindingId');
  });

  it('never accepts a browser-supplied binding as authoritative', () => {
    // The only assignment of producerEventBindingId comes from `authz`.
    const assignments = EDGE.match(/producerEventBindingId\s*=/g) ?? [];
    expect(assignments).toHaveLength(1);
    expect(EDGE).not.toMatch(/input\.producerEventBindingId/);
    expect(EDGE).not.toMatch(/body\.producerEventBindingId/);
  });

  it('returns the binding on fresh and replayed responses', () => {
    expect(EDGE).toContain('producerEventBindingId: row.producer_event_binding_id ?? null');
    const occurrences = EDGE.match(/producerEventBindingId: row\.producer_event_binding_id/g) ?? [];
    // resolved, replay and finalizeBlocked paths.
    expect(occurrences.length).toBeGreaterThanOrEqual(3);
  });

  it('carries the binding on both contract mirrors', () => {
    for (const f of [
      'src/platform/omni-comms/runtime/responseContract.ts',
      'supabase/functions/omni-comms-runtime/responseContract.ts',
    ]) {
      expect(read(f)).toContain('producerEventBindingId');
    }
  });

  it('parses the binding out of a runtime response', () => {
    const parsed = parseSendCommunicationResult({
      contractVersion: 'omni_comms.result.v1',
      requestId: 'req-9',
      idempotencyKey: 'k',
      mode: 'shadow',
      status: 'completed',
      recipients: [],
      messages: [],
      blockers: [],
      createdAt: new Date().toISOString(),
      replayed: false,
      producerEventBindingId: 'b1b1b1b1-1111-4111-8111-111111111111',
    });
    expect(parsed?.producerEventBindingId).toBe('b1b1b1b1-1111-4111-8111-111111111111');
  });
});

/* ── 3. correct business event + aligned vocabulary ────────────────────── */

describe('Build 4A correction — application submitted event', () => {
  it('uses the application-submitted event, not the completed-registration event', () => {
    expect(EMPLOYER_APPLICATION_SUBMITTED_EVENT_CODE).toBe(
      'REGISTRATION.EMPLOYER.APPLICATION_SUBMITTED',
    );
    expect(EMPLOYER_APPLICATION_SUBMITTED_EVENT_CODE).not.toBe(
      EMPLOYER_REGISTERED_EVENT_CODE,
    );
    const producer = read(
      'src/platform/omni-comms/integrations/business/employerRegistrationProducer.ts',
    );
    expect(producer).toContain('eventCode: EMPLOYER_APPLICATION_SUBMITTED_EVENT_CODE');
    expect(producer).not.toContain('eventCode: EMPLOYER_REGISTERED_EVENT_CODE');
  });

  it('emits the application-submitted event through the façade', async () => {
    await emitEmployerRegistrationApplicationSubmitted({
      organizationId: '69afc88b-da5c-4f41-a1e7-199e1ee1d416',
      reference: 'ER-004512',
      subjectName: 'Frigate Bay Retail Ltd',
      submittedAt: '2026-08-01T08:00:00.000Z',
      contactEmail: 'ops@example.com',
    });
    const arg = sendMock.mock.calls[0][0];
    expect(arg.eventCode).toBe(EMPLOYER_APPLICATION_SUBMITTED_EVENT_CODE);
    expect(arg.mode).toBe('shadow');
    expect(arg.payload).toEqual(EMPLOYER_APPLICATION_SUBMITTED_SAMPLE);
  });

  it('surfaces the trusted binding back to the business caller', async () => {
    const res = await emitEmployerRegistrationApplicationSubmitted({
      organizationId: '69afc88b-da5c-4f41-a1e7-199e1ee1d416',
      reference: 'ER-004512',
      subjectName: 'Frigate Bay Retail Ltd',
      submittedAt: '2026-08-01T08:00:00.000Z',
    });
    expect(res.outcome).toBe('accepted');
    expect(res.producerEventBindingId).toBe('b1b1b1b1-1111-4111-8111-111111111111');
  });
});

describe('Build 4A correction — one payload vocabulary, real pipeline', () => {
  const payload = buildEmployerRegistrationApplicationSubmittedPayload({
    organizationId: 'org',
    reference: 'ER-004512',
    subjectName: 'Frigate Bay Retail Ltd',
    submittedAt: '2026-08-01T08:00:00.000Z',
  });

  it('uses the same field names everywhere', () => {
    expect(Object.keys(payload).sort()).toEqual(
      [...EMPLOYER_APPLICATION_SUBMITTED_FIELDS].sort(),
    );
    expect(payload).toEqual(EMPLOYER_APPLICATION_SUBMITTED_SAMPLE);
  });

  it('passes the REAL producer payload through REAL contract validation', () => {
    const ajv = new Ajv();
    // The installed validator predates the 2020-12 meta-schema; the schema
    // body itself is validated verbatim.
    const { $schema: _meta, ...schemaBody } = EMPLOYER_APPLICATION_SUBMITTED_SCHEMA;
    const validate = ajv.compile(schemaBody as object);
    expect(validate(payload)).toBe(true);
    // A stale vocabulary must fail closed.
    expect(validate({ registration_number: 'ER-004512', employer_name: 'X' })).toBe(false);
  });

  it('passes the REAL producer payload through the REAL rendering pipeline', () => {
    const context = { payload: payload as unknown as Record<string, unknown>, recipient: {}, sender: {} };
    for (const [field, source] of Object.entries(
      EMPLOYER_APPLICATION_SUBMITTED_EMAIL_CONTENT,
    )) {
      const rendered = resolveTokens(source, context, field === 'html');
      expect(rendered.unresolvedRequired, `${field} has unresolved tokens`).toEqual([]);
      expect(rendered.output).toContain('ER-004512');
      expect(rendered.output).not.toContain('{{');
      if (field !== 'subject') {
        expect(rendered.output).toContain('Frigate Bay Retail Ltd');
        expect(rendered.output).toContain('Pending review');
        expect(rendered.output).toContain('2026-08-01T08:00:00.000Z');
      }
    }
  });

  it('never states or implies approval, completion, activation or an effective date', () => {
    const context = { payload: payload as unknown as Record<string, unknown>, recipient: {}, sender: {} };
    for (const [field, source] of Object.entries(
      EMPLOYER_APPLICATION_SUBMITTED_EMAIL_CONTENT,
    )) {
      const text = resolveTokens(source, context, false).output.toLowerCase();
      for (const phrase of EMPLOYER_APPLICATION_FORBIDDEN_PHRASES) {
        expect(text, `${field} must not say "${phrase}"`).not.toContain(phrase);
      }
      expect(text).toContain('received');
    }
  });
});

/* ── 4. idempotency strength ───────────────────────────────────────────── */

describe('Build 4A correction — SHA-256 idempotency', () => {
  const identity = {
    organizationId: '11111111-1111-4111-8111-111111111111',
    departmentId: '22222222-2222-4222-8222-222222222222',
    moduleCode: 'EMPLOYER_REGISTRATION',
    eventCode: 'REGISTRATION.EMPLOYER.APPLICATION_SUBMITTED',
    entityType: 'employer_registration',
    entityId: 'ER-004512',
    entityVersion: 'application-submitted-v1',
    mode: 'shadow' as const,
  };

  it('derives a bounded SHA-256 key from the complete canonical string', async () => {
    const key = await buildProducerIdempotencyKey(identity);
    expect(key).toMatch(/^omni-producer:[0-9a-f]{64}$/);
    expect(key.length).toBeLessThanOrEqual(200);
    expect(key.length).toBeGreaterThanOrEqual(8);
  });

  it('includes the complete identity: tenant, module, event, entity and mode', () => {
    const s = buildProducerIdentityString(identity);
    const parts = s.split('\u001f');
    expect(parts).toEqual([
      identity.organizationId,
      identity.departmentId,
      identity.moduleCode,
      identity.eventCode,
      identity.entityType,
      identity.entityId,
      identity.entityVersion,
      identity.mode,
    ]);
  });

  it('separates tenants and departments', async () => {
    const base = await buildProducerIdempotencyKey(identity);
    const otherOrg = await buildProducerIdempotencyKey({
      ...identity,
      organizationId: '33333333-3333-4333-8333-333333333333',
    });
    const otherDept = await buildProducerIdempotencyKey({
      ...identity,
      departmentId: '44444444-4444-4444-8444-444444444444',
    });
    const noDept = await buildProducerIdempotencyKey({ ...identity, departmentId: null });
    expect(new Set([base, otherOrg, otherDept, noDept]).size).toBe(4);
  });

  it('separates modes for the same business fact', async () => {
    const shadow = await buildProducerIdempotencyKey(identity);
    const dryRun = await buildProducerIdempotencyKey({ ...identity, mode: 'dry_run' });
    expect(shadow).not.toBe(dryRun);
  });

  it('never truncates a component', () => {
    const long = 'X'.repeat(400);
    const s = buildProducerIdentityString({ ...identity, entityId: long });
    expect(s).toContain(long);
    const src = read(
      'src/platform/omni-comms/integrations/business/emitBusinessCommunication.ts',
    );
    expect(src).not.toMatch(/\.slice\(0,\s*\d+\)/);
  });

  it('distinguishes business facts that differ only past a truncation point', async () => {
    const prefix = 'ER-'.padEnd(120, '0');
    const a = await buildProducerIdempotencyKey({ ...identity, entityId: `${prefix}1` });
    const b = await buildProducerIdempotencyKey({ ...identity, entityId: `${prefix}2` });
    expect(a).not.toBe(b);
  });
});


/* ── 5. safety invariants ──────────────────────────────────────────────── */

describe('Build 4A correction — safety invariants hold', () => {
  const files = [
    'src/platform/omni-comms/integrations/business/emitBusinessCommunication.ts',
    'src/platform/omni-comms/integrations/business/employerRegistrationProducer.ts',
    'src/platform/omni-comms/integrations/business/employerRegistrationPilotContract.ts',
    'src/hooks/useEmployerRegistrationSubmit.ts',
  ];

  it('contacts no provider and touches no Legacy communication object', () => {
    for (const f of files) {
      const src = read(f);
      expect(src).not.toMatch(/resend|twilio|sendgrid|nodemailer|firebase/i);
      expect(src).not.toMatch(/notification_queue|notification_logs|comm_hub_|communication_request/);
    }
  });

  it('keeps the pilot in provider-free modes only', () => {
    const producer = read(
      'src/platform/omni-comms/integrations/business/employerRegistrationProducer.ts',
    );
    expect(producer).toContain("mode: 'shadow'");
    expect(producer).not.toContain("mode: 'queued'");
  });

  it('reports the emission outcome without failing the submission', async () => {
    sendMock.mockRejectedValueOnce(new Error('down'));
    const res = await emitEmployerRegistrationApplicationSubmitted({
      organizationId: 'org-1',
      reference: 'ER-1',
      subjectName: 'A',
      submittedAt: '2026-08-01T08:00:00.000Z',
    });
    expect(res.outcome).toBe('unavailable');
    const hook = read('src/hooks/useEmployerRegistrationSubmit.ts');
    expect(hook).toContain('CommunicationOutcome');
    const form = read('src/pages/employer-registration/EmployerRegistrationForm.tsx');
    expect(form).toContain('communication?.summary');
  });
});
