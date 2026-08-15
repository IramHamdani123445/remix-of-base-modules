/**
 * Benefits claim communications — Phase 1 of the Omni-Comms cutover.
 *
 * Maps every LEGACY Benefits claim event code (`bn.*`, held in
 * `bn_comm_event`) to its CANONICAL Omni-Comms catalogue event code
 * (`BENEFITS.*`). Anything without a canonical counterpart is reported as an
 * explicit gap so the claim screen can say so instead of silently sending
 * through the old local stack.
 *
 * Pure data + pure functions. No Supabase client, no provider, no writes.
 */
import { benefitsTemplateEntry } from '@/platform/omni-comms/integrations/business/benefits/templates/benefitsTemplateRegistry';

/** legacy event code → canonical catalogue event code (null = no counterpart yet). */
export const BN_LEGACY_TO_OMNI_EVENT: Readonly<Record<string, string | null>> = {
  'bn.claim.submitted': 'BENEFITS.CLAIM.SUBMITTED',
  'bn.claim.withdrawn': 'BENEFITS.CLAIM.WITHDRAWN',
  'bn.claim.approved': 'BENEFITS.CLAIM.APPROVED',
  'bn.claim.denied': 'BENEFITS.CLAIM.DISALLOWED',
  'bn.claim.disallowed': 'BENEFITS.CLAIM.DISALLOWED',
  'bn.evidence.requested': 'BENEFITS.CLAIM.EVIDENCE.REQUESTED',
  'bn.evidence.received': 'BENEFITS.CLAIM.EVIDENCE.RECEIVED',
  'bn.life_certificate.due': 'BENEFITS.LIFE_CERTIFICATE.DUE',
  'bn.overpayment.created': 'BENEFITS.OVERPAYMENT.NOTICE.ISSUED',
  'bn.payment.issued': 'BENEFITS.PAYMENT.ISSUED',
  'bn.calculation.completed': 'BENEFITS.CLAIM.CALCULATION.COMPLETED',
  'bn.decision.pending': 'BENEFITS.CLAIM.DECISION.PENDING',

  // Recorded gaps — no published Benefits Email template exists yet.
  'bn.claim.intake.started': null,
  'bn.claim.reopened': null,
  'bn.claim.suspended': null,
  'bn.eligibility.failed': null,
  'bn.eligibility.passed': null,
  'bn.identity.verified': null,
  'bn.payment.ready': null,
};

export interface BnOmniEventResolution {
  legacyEventCode: string;
  /** Canonical catalogue code, when one exists AND is published. */
  omniEventCode: string | null;
  /** `true` when the event can be raised through Omni-Comms right now. */
  supported: boolean;
  /** Bounded reason when unsupported. */
  gapReason?: 'not_mapped' | 'no_published_template';
}

/**
 * Resolve a legacy or canonical event code. Passing an already-canonical
 * `BENEFITS.*` code is allowed and validated against the template registry.
 */
export function resolveBnOmniEvent(eventCode: string): BnOmniEventResolution {
  const code = String(eventCode ?? '').trim();
  const canonical = code.startsWith('BENEFITS.')
    ? code
    : (BN_LEGACY_TO_OMNI_EVENT[code] ?? null);

  if (!canonical) {
    return { legacyEventCode: code, omniEventCode: null, supported: false, gapReason: 'not_mapped' };
  }
  if (!benefitsTemplateEntry(canonical)) {
    return {
      legacyEventCode: code,
      omniEventCode: canonical,
      supported: false,
      gapReason: 'no_published_template',
    };
  }
  return { legacyEventCode: code, omniEventCode: canonical, supported: true };
}

/** All legacy codes that can already be raised through Omni-Comms. */
export function supportedLegacyEventCodes(): string[] {
  return Object.keys(BN_LEGACY_TO_OMNI_EVENT)
    .filter((c) => resolveBnOmniEvent(c).supported)
    .sort();
}

/** All legacy codes still waiting for a canonical event/template. */
export function unsupportedLegacyEventCodes(): string[] {
  return Object.keys(BN_LEGACY_TO_OMNI_EVENT)
    .filter((c) => !resolveBnOmniEvent(c).supported)
    .sort();
}
