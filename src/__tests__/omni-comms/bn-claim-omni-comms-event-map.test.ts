import { describe, expect, it } from 'vitest';
import {
  BN_LEGACY_TO_OMNI_EVENT,
  resolveBnOmniEvent,
  supportedLegacyEventCodes,
  unsupportedLegacyEventCodes,
} from '@/services/bn/communication/bnOmniCommsEventMap';
import { benefitsTemplateEventCodes } from '@/platform/omni-comms/integrations/business/benefits/templates/benefitsTemplateRegistry';

describe('Benefits claim legacy → Omni-Comms event mapping', () => {
  it('maps every mapped legacy code onto a catalogued template event', () => {
    const catalogue = new Set(benefitsTemplateEventCodes());
    for (const [legacy, canonical] of Object.entries(BN_LEGACY_TO_OMNI_EVENT)) {
      if (canonical) expect(catalogue.has(canonical), `${legacy} → ${canonical}`).toBe(true);
    }
  });

  it('reports unmapped legacy codes as explicit gaps, never as sendable', () => {
    for (const code of unsupportedLegacyEventCodes()) {
      const r = resolveBnOmniEvent(code);
      expect(r.supported).toBe(false);
      expect(r.gapReason).toBeDefined();
    }
    expect(supportedLegacyEventCodes()).toContain('bn.claim.submitted');
    expect(supportedLegacyEventCodes()).toContain('bn.evidence.requested');
    expect(supportedLegacyEventCodes()).toContain('bn.life_certificate.due');
  });

  it('accepts an already-canonical code', () => {
    expect(resolveBnOmniEvent('BENEFITS.CLAIM.APPROVED')).toMatchObject({
      omniEventCode: 'BENEFITS.CLAIM.APPROVED',
      supported: true,
    });
  });

  it('rejects an unknown code', () => {
    expect(resolveBnOmniEvent('bn.nope').supported).toBe(false);
  });
});
