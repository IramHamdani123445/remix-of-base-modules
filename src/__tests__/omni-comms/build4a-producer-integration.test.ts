/**
 * Build 4A — Business producer integration and shadow pilot.
 *
 * Source-level proofs. No network, no Supabase client, no provider.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildProducerIdempotencyKey,
  validateProducerEmission,
  emitBusinessCommunication,
} from '@/platform/omni-comms/integrations/business/emitBusinessCommunication';
import {
  BUSINESS_PRODUCER_MODES,
  type BusinessProducerEmission,
} from '@/platform/omni-comms/integrations/business/businessProducerTypes';
import {
  EMPLOYER_APPLICATION_SUBMITTED_EVENT_CODE,
  EMPLOYER_REGISTRATION_MODULE_CODE,
  emitEmployerRegistrationApplicationSubmitted,
} from '@/platform/omni-comms/integrations/business/employerRegistrationProducer';
import { OMNI_COMMS_OBJECT_REGISTRY } from '@/platform/omni-comms/registry/objectRegistry';

const sendMock = vi.fn();
vi.mock('@/platform/omni-comms/sendCommunication', () => ({
  sendCommunication: (input: unknown) => sendMock(input),
}));

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const baseEmission = (): BusinessProducerEmission => ({
  moduleCode: 'EMPLOYER_REGISTRATION',
  eventCode: 'REGISTRATION.EMPLOYER.APPLICATION_SUBMITTED',
  organizationId: '69afc88b-da5c-4f41-a1e7-199e1ee1d416',
  entityType: 'employer_registration',
  entityId: 'ER-00001',
  entityVersion: 'application-submitted-v1',
  mode: 'shadow',
  recipients: [{ recipientType: 'employer', email: 'a@b.test' }],
  payload: {
    reference: 'ER-00001',
    subjectName: 'Acme Ltd',
    submissionStatus: 'Pending review',
    submittedAt: '2026-08-01T08:00:00.000Z',
  },
});

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
  });
});

describe('Build 4A — producer modes', () => {
  it('only exposes provider-free modes', () => {
    expect([...BUSINESS_PRODUCER_MODES]).toEqual(['dry_run', 'shadow']);
    expect(BUSINESS_PRODUCER_MODES as readonly string[]).not.toContain('queued');
  });

  it('refuses a queued emission before it reaches the façade', async () => {
    const res = await emitBusinessCommunication({
      ...baseEmission(),
      mode: 'queued' as never,
    });
    expect(res.outcome).toBe('blocked');
    expect(res.blockers).toContain('producer_mode_not_available');
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('Build 4A — idempotency', () => {
  it('is deterministic for the same business fact', async () => {
    const a = await buildProducerIdempotencyKey(baseEmission());
    const b = await buildProducerIdempotencyKey(baseEmission());
    expect(a).toBe(b);
    expect(a.startsWith('omni-producer:')).toBe(true);
  });

  it('changes when the entity version changes', async () => {
    const a = await buildProducerIdempotencyKey(baseEmission());
    const b = await buildProducerIdempotencyKey({ ...baseEmission(), entityVersion: 'v2' });
    expect(a).not.toBe(b);
  });

  it('changes when the mode changes', async () => {
    const a = await buildProducerIdempotencyKey(baseEmission());
    const b = await buildProducerIdempotencyKey({ ...baseEmission(), mode: 'dry_run' });
    expect(a).not.toBe(b);
  });
});

describe('Build 4A — emission validation and outcomes', () => {
  it('blocks a missing organisation', () => {
    const blockers = validateProducerEmission({ ...baseEmission(), organizationId: '' });
    expect(blockers).toContain('organization_required');
  });

  it('blocks an empty recipient list', () => {
    const blockers = validateProducerEmission({ ...baseEmission(), recipients: [] });
    expect(blockers).toContain('recipients_required');
  });

  it('maps a replayed façade result to the replayed outcome', async () => {
    sendMock.mockResolvedValueOnce({
      requestId: 'req-1', idempotencyKey: 'k', mode: 'shadow', status: 'accepted',
      recipients: [], messages: [], blockers: [], createdAt: '', replayed: true,
    });
    const res = await emitBusinessCommunication(baseEmission());
    expect(res.outcome).toBe('replayed');
  });

  it('maps a blocked façade result to blockers without throwing', async () => {
    sendMock.mockResolvedValueOnce({
      requestId: '', idempotencyKey: '', mode: 'shadow', status: 'blocked',
      recipients: [], messages: [], blockers: ['producer_event_not_authorized'],
      createdAt: '', replayed: false,
    });
    const res = await emitBusinessCommunication(baseEmission());
    expect(res.outcome).toBe('blocked');
    expect(res.blockers).toContain('producer_event_not_authorized');
  });

  it('never throws when the runtime is unavailable', async () => {
    sendMock.mockRejectedValueOnce(new Error('network down'));
    const res = await emitBusinessCommunication(baseEmission());
    expect(res.outcome).toBe('unavailable');
    expect(res.blockers).toEqual(['runtime_unavailable']);
  });
});

describe('Build 4A — employer registration pilot', () => {
  it('emits in shadow mode only, through the façade, with caller context', async () => {
    await emitEmployerRegistrationApplicationSubmitted({
      organizationId: '69afc88b-da5c-4f41-a1e7-199e1ee1d416',
      reference: 'ER-00042',
      subjectName: 'Acme Ltd',
      contactEmail: 'acme@example.com',
      submittedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0][0];
    expect(arg.mode).toBe('shadow');
    expect(arg.eventCode).toBe(EMPLOYER_APPLICATION_SUBMITTED_EVENT_CODE);
    expect(arg.eventCode).not.toBe('REGISTRATION.EMPLOYER.REGISTERED');
    expect(arg.payload).toEqual({
      reference: 'ER-00042',
      subjectName: 'Acme Ltd',
      submissionStatus: 'Pending review',
      submittedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(arg.callerContext.moduleCode).toBe(EMPLOYER_REGISTRATION_MODULE_CODE);
    expect(arg.callerContext.entityId).toBe('ER-00042');
    expect(arg.requestedChannels).toEqual(['email']);
  });
});

describe('Build 4A — architecture and safety invariants', () => {
  const producerFiles = [
    'src/platform/omni-comms/integrations/business/emitBusinessCommunication.ts',
    'src/platform/omni-comms/integrations/business/employerRegistrationProducer.ts',
    'src/platform/omni-comms/integrations/business/businessProducerTypes.ts',
  ];

  it('imports no provider SDK and no Legacy hub module', () => {
    for (const f of producerFiles) {
      const src = read(f);
      expect(src).not.toMatch(/resend|twilio|sendgrid|nodemailer|firebase/i);
      expect(src).not.toMatch(/communication-hub|comm_hub_|notification_queue|notification_logs/);
    }
  });

  it('reaches the runtime only through the canonical façade', () => {
    const src = read('src/platform/omni-comms/integrations/business/emitBusinessCommunication.ts');
    expect(src).toContain("from '../../sendCommunication'");
    expect(src).not.toMatch(/integrations\/supabase\/client/);
    expect(src).not.toMatch(/\.from\(/);
  });

  it('wires the pilot without blocking the business submission', () => {
    const src = read('src/hooks/useEmployerRegistrationSubmit.ts');
    expect(src).toContain('emitEmployerRegistrationApplicationSubmitted');
    // Observed, not fire-and-forget: the outcome is awaited and returned,
    // and the emission helper is total so it can never fail the submission.
    expect(src).toContain('const communication = await emitOmniCommsRegistrationEvent(');
    expect(src).not.toMatch(/void emitOmniCommsRegistrationEvent/);
    expect(src).toContain('communication,');
  });

  it('registers the producer binding object as available and service-role owned', () => {
    const entry = OMNI_COMMS_OBJECT_REGISTRY.find(
      (o) => o.name === 'omni_comms_producer_event_binding',
    );
    expect(entry).toBeDefined();
    expect(entry?.status).toBe('AVAILABLE');
    expect(entry?.writeAuthority).toBe('service_role_only');
    expect(entry?.category).toBe('runtime');
  });

  it('enforces the producer binding inside the trusted runtime', () => {
    const src = read('supabase/functions/omni-comms-runtime/index.ts');
    expect(src).toContain('omni_comms_priv_authorize_producer_event');
    expect(src).toContain('p_event_code: canonical.eventCode');
    expect(src).toContain('p_mode: canonical.mode');
  });

  it('replaces the Events Simulator placeholder with Producer Integrations', () => {
    const page = read('src/platform/omni-comms/admin/views/OmniCommsEventsPage.tsx');
    expect(page).toContain('Producer Integrations');
    expect(page).not.toContain('value="simulator"');
    const tabs = read('src/platform/omni-comms/admin/hooks/useOmniCommsTabParam.ts');
    expect(tabs).toContain("'producers'");
    expect(tabs).not.toContain("'simulator'");
  });

  it('exposes a caller-module filter in the Operations console', () => {
    const ops = read('src/platform/omni-comms/admin/views/OmniCommsOperationsPage.tsx');
    expect(ops).toContain('omni-comms-ops-caller-filter');
    expect(ops).toContain('callerModuleCode:');
  });

  it('keeps the producer administration surface RPC-only', () => {
    const svc = read('src/platform/omni-comms/application/producerIntegrationsService.ts');
    expect(svc).toContain('omni_comms_list_producer_event_bindings');
    expect(svc).toContain('omni_comms_set_producer_event_binding_status');
    expect(svc).not.toMatch(/\.from\(/);
    expect(svc).not.toMatch(/integrations\/supabase\/client/);
  });
});
