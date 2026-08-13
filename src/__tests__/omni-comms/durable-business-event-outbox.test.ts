/**
 * Durable business integration — contract tests.
 *
 * A business module records its communication obligation inside its own
 * database transaction. The browser neither emits nor sends; it only reports
 * the durable evidence the transaction produced.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { OMNI_COMMS_OBJECT_REGISTRY } from '@/platform/omni-comms/registry/objectRegistry';
import { OMNI_COMMS_INTEGRATION_REGISTRY } from '@/platform/omni-comms/registry/integrationRegistry';
import { validateOmniCommsRegistries } from '@/platform/omni-comms/registry/validateRegistries';
import { mapDurableCommunicationEvidence } from '@/services/bn/intake/claimIntakeService';

describe('durable business-event outbox registration', () => {
  it('registers the outbox as a service-role-only runtime object', () => {
    const entry = OMNI_COMMS_OBJECT_REGISTRY.find(
      (o) => o.name === 'omni_comms_business_event_outbox',
    );
    expect(entry).toBeDefined();
    expect(entry?.writeAuthority).toBe('service_role_only');
  });

  it('registers the ingest worker edge function', () => {
    const entry = OMNI_COMMS_INTEGRATION_REGISTRY.find(
      (i) => i.name === 'omni-comms-business-event-ingest',
    );
    expect(entry).toBeDefined();
    expect(entry?.kind).toBe('edge_function');
  });

  it('keeps the registries valid', () => {
    expect(validateOmniCommsRegistries().errors).toEqual([]);
  });
});

describe('claim intake no longer emits from the browser', () => {
  const source = readFileSync('src/services/bn/intake/claimIntakeService.ts', 'utf8');

  it('does not emit the acknowledgement after the claim commits', () => {
    const submitIndex = source.indexOf('export async function submitClaimApplication');
    expect(submitIndex).toBeGreaterThan(-1);
    expect(source.slice(submitIndex)).not.toContain('emitClaimRegisteredAcknowledgement(');
  });

  it('reports the durable evidence returned by the claim transaction', () => {
    expect(source).toContain('communication_event_id');
    expect(source).toContain('communication_event_status');
  });
});

describe('durable evidence projection', () => {
  it('treats a recorded pending event as accepted', () => {
    const r = mapDurableCommunicationEvidence('11111111-1111-1111-1111-111111111111', 'pending');
    expect(r.outcome).toBe('accepted');
    expect(r.blockers).toEqual([]);
  });

  it('treats a recorded blocked event as blocked with a bounded code', () => {
    const r = mapDurableCommunicationEvidence('11111111-1111-1111-1111-111111111111', 'blocked');
    expect(r.outcome).toBe('blocked');
    expect(r.blockers).toEqual(['blocked']);
  });

  it('treats an unrecorded event as skipped', () => {
    expect(mapDurableCommunicationEvidence(null, null).outcome).toBe('skipped');
  });

  it('treats a failed recording as unavailable, never accepted', () => {
    expect(mapDurableCommunicationEvidence(null, 'needs_review').outcome).toBe('unavailable');
  });
});

describe('ingest worker boundaries', () => {
  const worker = readFileSync(
    'supabase/functions/omni-comms-business-event-ingest/index.ts',
    'utf8',
  );

  it('requires the service-role credential and a purpose-bound ticket', () => {
    expect(worker).toContain('ingest_caller_not_permitted');
    expect(worker).toContain('business_event_ingest');
    expect(worker).toContain('omni_comms_priv_scheduler_consume_ticket');
  });

  it('never imports a provider SDK and never sends', () => {
    expect(worker).not.toMatch(/resend|twilio|nodemailer/i);
  });

  it('accepts only a bounded batch limit from callers', () => {
    expect(worker).toContain('caller_supplied_ingest_input_forbidden');
  });

  it('emits only in queued mode through the canonical runtime contract', () => {
    expect(worker).toContain('"queued"');
    expect(worker).toContain('/functions/v1/omni-comms-runtime');
  });
});
