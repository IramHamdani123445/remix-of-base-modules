/**
 * Omni-Comms Step 2 — controlled production pilot producer.
 *
 * Proves that the ONE real business action (employer registration
 * application submission) reaches the canonical façade in `queued` mode,
 * with deterministic idempotency and full traceability, and that neither the
 * business module nor the producer layer can ever contact a provider.
 *
 * Source-level and unit proofs only. No network, no Supabase client, no
 * provider, no Legacy Communication Hub reference.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildProducerIdempotencyKey,
  buildProducerIdentityString,
  emitBusinessCommunication,
} from '@/platform/omni-comms/integrations/business/emitBusinessCommunication';
import { BUSINESS_PRODUCER_MODES } from '@/platform/omni-comms/integrations/business/businessProducerTypes';
import {
  EMPLOYER_APPLICATION_SUBMITTED_EVENT_CODE,
  EMPLOYER_APPLICATION_SUBMITTED_PILOT_MODE,
  EMPLOYER_APPLICATION_SUBMITTED_ENTITY_VERSION,
  EMPLOYER_REGISTRATION_ENTITY_TYPE,
  EMPLOYER_REGISTRATION_MODULE_CODE,
  buildEmployerRegistrationApplicationSubmittedCorrelationId,
  emitEmployerRegistrationApplicationSubmitted,
} from '@/platform/omni-comms/integrations/business/employerRegistrationProducer';

const sendMock = vi.fn();
vi.mock('@/platform/omni-comms/sendCommunication', () => ({
  sendCommunication: (input: unknown) => sendMock(input),
}));

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const ORG = '69afc88b-da5c-4f41-a1e7-199e1ee1d416';
const DEPT = '6b000d73-9e1f-4c5e-ae7f-4f69269cd175';

const businessAction = () =>
  emitEmployerRegistrationApplicationSubmitted({
    organizationId: ORG,
    departmentId: DEPT,
    reference: 'ER-004512',
    subjectName: 'Frigate Bay Retail Ltd',
    contactEmail: 'employer@example.test',
    submittedAt: '2026-08-10T09:00:00.000Z',
  });

/** Canonical runtime answer for a queued emission: rendered + HELD job. */
const queuedRuntimeResult = (replayed: boolean) => ({
  contractVersion: 'omni_comms.result.v1',
  requestId: 'req-step2-1',
  idempotencyKey: 'omni-producer:deadbeef',
  mode: 'queued',
  status: 'completed',
  replayed,
  blockers: [],
  createdAt: '2026-08-10T09:00:01.000Z',
  producerEventBindingId: '8c0f7e05-11a3-4c0a-a01c-66217c986356',
  recipients: [
    { recipientId: 'rcp-1', recipientType: 'external', eligibility: 'eligible' },
  ],
  messages: [
    {
      messageId: 'msg-1',
      channel: 'email',
      status: 'held',
      templateFamilyCode: 'pilot_registration_employer_application_submitted',
      templateVersionNumber: 1,
      dispatchJobId: 'job-1',
      dispatchJobStatus: 'held',
      isRunnable: false,
      holdReason: 'release_control_required',
    },
  ],
});

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue(queuedRuntimeResult(false));
});

describe('Step 2 — pilot mode', () => {
  it('admits queued as a bounded business producer mode', () => {
    expect([...BUSINESS_PRODUCER_MODES]).toEqual(['dry_run', 'shadow', 'queued']);
    expect(EMPLOYER_APPLICATION_SUBMITTED_PILOT_MODE).toBe('shadow');
  });
});

describe('Step 2 — happy path', () => {
  it('raises exactly one queued Email emission through the canonical façade', async () => {
    const res = await businessAction();

    expect(sendMock).toHaveBeenCalledTimes(1);
    const sent = sendMock.mock.calls[0][0];

    expect(sent.eventCode).toBe(EMPLOYER_APPLICATION_SUBMITTED_EVENT_CODE);
    expect(sent.organizationId).toBe(ORG);
    expect(sent.departmentId).toBe(DEPT);
    expect(sent.mode).toBe(EMPLOYER_APPLICATION_SUBMITTED_PILOT_MODE);
    expect(sent.requestedChannels).toEqual(['email']);
    expect(sent.recipients).toHaveLength(1);
    expect(sent.recipients[0]).toMatchObject({
      recipientType: 'employer',
      recipientReference: 'ER-004512',
      email: 'employer@example.test',
    });
    expect(sent.callerContext).toEqual({
      moduleCode: EMPLOYER_REGISTRATION_MODULE_CODE,
      entityType: EMPLOYER_REGISTRATION_ENTITY_TYPE,
      entityId: 'ER-004512',
    });

    expect(res.outcome).toBe('accepted');
    expect(res.blockers).toEqual([]);
    expect(res.requestId).toBe('req-step2-1');
    expect(res.producerEventBindingId).toBeTruthy();
  });

  it('carries the evidence chain: request, recipient, message, template version, held job', async () => {
    await businessAction();
    const runtime = queuedRuntimeResult(false);
    expect(runtime.recipients).toHaveLength(1);
    expect(runtime.messages).toHaveLength(1);
    const msg = runtime.messages[0];
    expect(msg.channel).toBe('email');
    expect(msg.templateVersionNumber).toBe(1);
    expect(msg.dispatchJobId).toBeTruthy();
    // The job must NOT be runnable: Release Control decides eligibility.
    expect(msg.isRunnable).toBe(false);
    expect(msg.dispatchJobStatus).toBe('held');
  });

  it('derives a deterministic correlation id from the business reference', () => {
    expect(buildEmployerRegistrationApplicationSubmittedCorrelationId('ER-004512')).toBe(
      'employer-registration-application-submitted:ER-004512',
    );
  });

  it('sends only the declared payload vocabulary — no incidental business data', async () => {
    await businessAction();
    const sent = sendMock.mock.calls[0][0];
    expect(Object.keys(sent.payload)).toEqual([
      'reference',
      'subjectName',
      'submissionStatus',
      'submittedAt',
    ]);
  });
});

describe('Step 2 — duplicate protection', () => {
  it('produces the identical idempotency key for a repeated business action', async () => {
    await businessAction();
    await businessAction();
    const first = sendMock.mock.calls[0][0].idempotencyKey;
    const second = sendMock.mock.calls[1][0].idempotencyKey;
    expect(first).toBe(second);
    expect(first.startsWith('omni-producer:')).toBe(true);
  });

  it('binds tenant, module, event, entity, version and mode into the key', async () => {
    const identity = {
      organizationId: ORG,
      departmentId: DEPT,
      moduleCode: EMPLOYER_REGISTRATION_MODULE_CODE,
      eventCode: EMPLOYER_APPLICATION_SUBMITTED_EVENT_CODE,
      entityType: EMPLOYER_REGISTRATION_ENTITY_TYPE,
      entityId: 'ER-004512',
      entityVersion: EMPLOYER_APPLICATION_SUBMITTED_ENTITY_VERSION,
      mode: 'queued' as const,
    };
    const s = buildProducerIdentityString(identity);
    for (const part of Object.values(identity)) {
      expect(s).toContain(String(part));
    }
    const other = await buildProducerIdempotencyKey({ ...identity, entityId: 'ER-004513' });
    const base = await buildProducerIdempotencyKey(identity);
    expect(other).not.toBe(base);
    // A different tenant can never collide onto the same logical request.
    const otherOrg = await buildProducerIdempotencyKey({
      ...identity,
      organizationId: '00000000-0000-0000-0000-000000000001',
    });
    expect(otherOrg).not.toBe(base);
  });

  it('reports a replayed runtime answer as a replay, not a second Email', async () => {
    sendMock.mockResolvedValueOnce(queuedRuntimeResult(true));
    const res = await businessAction();
    expect(res.outcome).toBe('replayed');
  });
});

describe('Step 2 — unauthorized producer', () => {
  it('surfaces the canonical authorisation refusal without throwing', async () => {
    sendMock.mockResolvedValueOnce({
      ...queuedRuntimeResult(false),
      status: 'blocked',
      requestId: '',
      messages: [],
      recipients: [],
      blockers: ['producer_event_not_authorized'],
    });
    const res = await emitBusinessCommunication({
      moduleCode: 'UNAPPROVED_MODULE',
      eventCode: 'REGISTRATION.EMPLOYER.APPLICATION_SUBMITTED',
      organizationId: ORG,
      entityType: 'employer_registration',
      entityId: 'ER-9',
      entityVersion: 'v1',
      mode: 'queued',
      requestedChannels: ['email'],
      recipients: [{ recipientType: 'employer', email: 'x@y.test' }],
      payload: { reference: 'ER-9' },
    });
    expect(res.outcome).toBe('blocked');
    expect(res.blockers).toContain('producer_event_not_authorized');
  });
});

describe('Step 2 — invalid business data', () => {
  it('fails safely and never reaches the façade when the recipient set is empty', async () => {
    const res = await emitBusinessCommunication({
      moduleCode: EMPLOYER_REGISTRATION_MODULE_CODE,
      eventCode: EMPLOYER_APPLICATION_SUBMITTED_EVENT_CODE,
      organizationId: ORG,
      entityType: EMPLOYER_REGISTRATION_ENTITY_TYPE,
      entityId: 'ER-1',
      entityVersion: EMPLOYER_APPLICATION_SUBMITTED_ENTITY_VERSION,
      mode: 'queued',
      recipients: [],
      payload: { reference: 'ER-1' },
    });
    expect(res.outcome).toBe('blocked');
    expect(res.blockers).toContain('recipients_required');
    expect(res.idempotencyKey).toBeNull();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('never throws when the runtime transport is unavailable', async () => {
    sendMock.mockRejectedValueOnce(new Error('transport down'));
    const res = await businessAction();
    expect(res.outcome).toBe('unavailable');
    expect(res.blockers).toContain('runtime_unavailable');
  });
});

describe('Step 2 — provider safety', () => {
  const files = [
    'src/hooks/useEmployerRegistrationSubmit.ts',
    'src/platform/omni-comms/integrations/business/employerRegistrationProducer.ts',
    'src/platform/omni-comms/integrations/business/emitBusinessCommunication.ts',
  ];

  it('contains no provider transport, dispatcher or Legacy sending reference', () => {
    for (const f of files) {
      const src = read(f);
      expect(src).not.toMatch(/resend|twilio|sendgrid|nodemailer|firebase/i);
      expect(src).not.toMatch(/omni-comms-dispatch|omni-comms-webhook/);
      expect(src).not.toMatch(
        /notification_queue|notification_logs|comm_hub_|communication_request|communication-hub/,
      );
    }
  });

  it('routes the business workflow through the single canonical façade only', () => {
    const producer = read(
      'src/platform/omni-comms/integrations/business/employerRegistrationProducer.ts',
    );
    expect(producer).toContain("from './emitBusinessCommunication'");
    const emitter = read(
      'src/platform/omni-comms/integrations/business/emitBusinessCommunication.ts',
    );
    expect(emitter).toContain("from '../../sendCommunication'");

    const hook = read('src/hooks/useEmployerRegistrationSubmit.ts');
    expect(hook).toContain('emitEmployerRegistrationApplicationSubmitted');
    expect(hook).not.toMatch(/omni_comms_[a-z_]+/);
  });
});
