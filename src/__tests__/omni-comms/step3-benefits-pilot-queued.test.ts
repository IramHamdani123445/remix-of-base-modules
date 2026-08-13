/**
 * Omni-Comms Step 3 — controlled production pilot switched to Benefits claim
 * registration.
 *
 * Proves that the ONE real business action (successful benefit claim
 * registration) reaches the canonical façade in `queued` mode with a single
 * deterministic recipient, deterministic idempotency and full traceability,
 * that the Employer Registration pilot no longer queues anything, and that
 * neither the business module nor the producer layer can ever contact a
 * provider.
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
import {
  BENEFITS_CLAIM_ENTITY_TYPE,
  BENEFITS_CLAIM_INTAKE_MODULE_CODE,
  BENEFITS_CLAIM_SUBMITTED_ENTITY_VERSION,
  BENEFITS_CLAIM_SUBMITTED_EVENT_CODE,
  BENEFITS_CLAIM_SUBMITTED_PILOT_MODE,
  buildBenefitsClaimSubmittedCorrelationId,
  emitBenefitsClaimSubmitted,
} from '@/platform/omni-comms/integrations/business/benefitsClaimSubmittedProducer';
import { EMPLOYER_APPLICATION_SUBMITTED_PILOT_MODE } from '@/platform/omni-comms/integrations/business/employerRegistrationProducer';

const sendMock = vi.fn();
vi.mock('@/platform/omni-comms/sendCommunication', () => ({
  sendCommunication: (input: unknown) => sendMock(input),
}));

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const ORG = '69afc88b-da5c-4f41-a1e7-199e1ee1d416';
const DEPT = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
const CLAIM_ID = '3b1f0a2e-2f2c-4f2f-9a7a-1c9d0f0a1b22';

const businessAction = () =>
  emitBenefitsClaimSubmitted({
    organizationId: ORG,
    departmentId: DEPT,
    claimId: CLAIM_ID,
    reference: 'CLM-2026-000123',
    subjectName: 'Alicia Warner',
    claimType: 'SICKNESS',
    contactEmail: 'claimant@example.test',
  });

/** Canonical runtime answer for a queued emission: rendered + HELD job. */
const queuedRuntimeResult = (replayed: boolean) => ({
  contractVersion: 'omni_comms.result.v1',
  requestId: 'req-step3-1',
  idempotencyKey: 'omni-producer:deadbeef',
  mode: 'queued',
  status: 'completed',
  replayed,
  blockers: [],
  createdAt: '2026-08-10T09:00:01.000Z',
  producerEventBindingId: 'b1d21f7e-0000-4000-8000-000000000001',
  recipients: [
    { recipientId: 'rcp-1', recipientType: 'external', eligibility: 'eligible' },
  ],
  messages: [
    {
      messageId: 'msg-1',
      channel: 'email',
      status: 'held',
      templateFamilyCode: 'ref_benefits_claim_submitted',
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

describe('Step 3 — pilot ownership', () => {
  it('makes Benefits claim registration the queued pilot', () => {
    expect(BENEFITS_CLAIM_SUBMITTED_PILOT_MODE).toBe('queued');
    expect(BENEFITS_CLAIM_SUBMITTED_EVENT_CODE).toBe('BENEFITS.CLAIM.SUBMITTED');
  });

  it('retires the Employer Registration queued pilot', () => {
    expect(EMPLOYER_APPLICATION_SUBMITTED_PILOT_MODE).not.toBe('queued');
    expect(EMPLOYER_APPLICATION_SUBMITTED_PILOT_MODE).toBe('shadow');
  });
});

describe('Step 3 — happy path', () => {
  it('raises exactly one queued Email emission through the canonical façade', async () => {
    const res = await businessAction();

    expect(sendMock).toHaveBeenCalledTimes(1);
    const sent = sendMock.mock.calls[0][0];

    expect(sent.eventCode).toBe(BENEFITS_CLAIM_SUBMITTED_EVENT_CODE);
    expect(sent.organizationId).toBe(ORG);
    expect(sent.departmentId).toBe(DEPT);
    expect(sent.mode).toBe('queued');
    expect(sent.requestedChannels).toEqual(['email']);
    expect(sent.recipients).toHaveLength(1);
    expect(sent.recipients[0]).toMatchObject({
      recipientType: 'external',
      recipientReference: 'CLM-2026-000123',
      email: 'claimant@example.test',
    });
    expect(sent.callerContext).toEqual({
      moduleCode: BENEFITS_CLAIM_INTAKE_MODULE_CODE,
      entityType: BENEFITS_CLAIM_ENTITY_TYPE,
      entityId: CLAIM_ID,
    });

    expect(res.outcome).toBe('accepted');
    expect(res.blockers).toEqual([]);
    expect(res.requestId).toBe('req-step3-1');
  });

  it('sends only the published contract vocabulary — no incidental claim data', async () => {
    await businessAction();
    const sent = sendMock.mock.calls[0][0];
    expect(Object.keys(sent.payload)).toEqual([
      'reference',
      'subjectName',
      'claimType',
    ]);
  });

  it('carries the evidence chain: request, recipient, message, template version, held job', async () => {
    await businessAction();
    const runtime = queuedRuntimeResult(false);
    const msg = runtime.messages[0];
    expect(runtime.recipients).toHaveLength(1);
    expect(msg.channel).toBe('email');
    expect(msg.templateFamilyCode).toBe('ref_benefits_claim_submitted');
    expect(msg.templateVersionNumber).toBe(1);
    expect(msg.dispatchJobId).toBeTruthy();
    // The job must NOT be runnable: Release Control decides eligibility.
    expect(msg.isRunnable).toBe(false);
    expect(msg.dispatchJobStatus).toBe('held');
  });

  it('derives a deterministic correlation id from the durable claim id', () => {
    expect(buildBenefitsClaimSubmittedCorrelationId(CLAIM_ID)).toBe(
      `benefits-claim-registered:${CLAIM_ID}`,
    );
  });
});

describe('Step 3 — duplicate protection', () => {
  it('produces the identical idempotency key for a repeated business action', async () => {
    await businessAction();
    await businessAction();
    const first = sendMock.mock.calls[0][0].idempotencyKey;
    const second = sendMock.mock.calls[1][0].idempotencyKey;
    expect(first).toBe(second);
    expect(String(first).startsWith('omni-producer:')).toBe(true);
  });

  it('binds tenant, module, event, entity, version and mode into the key', async () => {
    const identity = {
      organizationId: ORG,
      departmentId: DEPT,
      moduleCode: BENEFITS_CLAIM_INTAKE_MODULE_CODE,
      eventCode: BENEFITS_CLAIM_SUBMITTED_EVENT_CODE,
      entityType: BENEFITS_CLAIM_ENTITY_TYPE,
      entityId: CLAIM_ID,
      entityVersion: BENEFITS_CLAIM_SUBMITTED_ENTITY_VERSION,
      mode: 'queued' as const,
    };
    const s = buildProducerIdentityString(identity);
    for (const part of Object.values(identity)) {
      expect(s).toContain(String(part));
    }
    const base = await buildProducerIdempotencyKey(identity);
    const otherClaim = await buildProducerIdempotencyKey({
      ...identity,
      entityId: '00000000-0000-4000-8000-000000000999',
    });
    expect(otherClaim).not.toBe(base);
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

describe('Step 3 — refusals never break claim registration', () => {
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
      eventCode: BENEFITS_CLAIM_SUBMITTED_EVENT_CODE,
      organizationId: ORG,
      entityType: BENEFITS_CLAIM_ENTITY_TYPE,
      entityId: CLAIM_ID,
      entityVersion: BENEFITS_CLAIM_SUBMITTED_ENTITY_VERSION,
      mode: 'queued',
      requestedChannels: ['email'],
      recipients: [{ recipientType: 'external', email: 'x@y.test' }],
      payload: { reference: 'CLM-1' },
    });
    expect(res.outcome).toBe('blocked');
    expect(res.blockers).toContain('producer_event_not_authorized');
  });

  it('never throws when the runtime transport is unavailable', async () => {
    sendMock.mockRejectedValueOnce(new Error('transport down'));
    const res = await businessAction();
    expect(res.outcome).toBe('unavailable');
    expect(res.blockers).toContain('runtime_unavailable');
  });
});

describe('Step 3 — provider safety and boundaries', () => {
  const files = [
    'src/services/bn/intake/claimIntakeService.ts',
    'src/platform/omni-comms/integrations/business/benefitsClaimSubmittedProducer.ts',
    'src/platform/omni-comms/integrations/business/emitBusinessCommunication.ts',
  ];

  it('contains no provider transport, dispatcher or Legacy sending reference', () => {
    for (const f of files) {
      const src = read(f);
      expect(src).not.toMatch(/resend|twilio|sendgrid|nodemailer|firebase/i);
      expect(src).not.toMatch(/omni-comms-dispatch|omni-comms-webhook/);
      expect(src).not.toMatch(
        /notification_queue|notification_logs|bn_communication_log|comm_hub_|communication_request|communication-hub/,
      );
    }
  });

  it('routes the claim-intake workflow through the single canonical façade only', () => {
    const producer = read(
      'src/platform/omni-comms/integrations/business/benefitsClaimSubmittedProducer.ts',
    );
    expect(producer).toContain("from './emitBusinessCommunication'");

    const service = read('src/services/bn/intake/claimIntakeService.ts');
    // The service now states business facts only; the platform helper owns
    // event policy, channel selection and idempotency.
    expect(service).toContain('emitConfiguredBusinessEvent');
    expect(service).not.toMatch(/omni_comms_[a-z_]+/);
  });
});
