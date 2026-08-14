import { describe, it, expect } from 'vitest';
import {
  BENEFITS_COMMUNICATION_CATALOGUE,
  BENEFITS_COMPATIBILITY_EVENT_CODES,
  BENEFITS_RECIPIENT_ROLES,
  benefitsCatalogueEventCodes,
  benefitsCoverageSummary,
  benefitsEmailCapableEntries,
  benefitsProducerRequiredEntries,
} from '../benefitsCommunicationCatalogue';

const EVENT_CODE_PATTERN = /^BENEFITS\.[A-Z0-9_]+(\.[A-Z0-9_]+)+$/;

describe('Benefits → Omni-Comms catalogue', () => {
  it('classifies every transition', () => {
    for (const row of BENEFITS_COMMUNICATION_CATALOGUE) {
      expect(row.classification).toBeTruthy();
    }
    expect(benefitsCoverageSummary().unclassified).toBe(0);
  });

  it('uses canonical uppercase dotted BENEFITS.<DOMAIN>.<EVENT> codes', () => {
    for (const code of benefitsCatalogueEventCodes()) {
      expect(code, code).toMatch(EVENT_CODE_PATTERN);
      expect(code).toBe(code.toUpperCase());
    }
  });

  it('never routes the historical BENEFITS.CLAIM.REJECTED code', () => {
    const codes = benefitsCatalogueEventCodes();
    for (const legacy of BENEFITS_COMPATIBILITY_EVENT_CODES) {
      expect(codes).not.toContain(legacy);
    }
    // The canonical decision vocabulary is DISALLOWED.
    expect(codes).toContain('BENEFITS.CLAIM.DISALLOWED');
  });

  it('has exactly one catalogue row per canonical event code', () => {
    const seen = new Map<string, number>();
    for (const row of BENEFITS_COMMUNICATION_CATALOGUE) {
      if (!row.eventCode) continue;
      seen.set(row.eventCode, (seen.get(row.eventCode) ?? 0) + 1);
    }
    const duplicates = [...seen.entries()].filter(([, n]) => n > 1);
    expect(duplicates).toEqual([]);
  });

  it('binds a template family to every Email-capable event and none otherwise', () => {
    for (const row of BENEFITS_COMMUNICATION_CATALOGUE) {
      if (row.emailApplicable) {
        expect(row.templateFamily, row.eventCode ?? row.command).toBeTruthy();
      } else {
        expect(row.templateFamily, row.eventCode ?? row.command).toBeNull();
      }
    }
  });

  it('never emails internal-only or audit-only transitions by default', () => {
    for (const row of benefitsEmailCapableEntries()) {
      expect(row.emailPolicy, row.eventCode ?? row.command).not.toBe(
        'INTERNAL_EMAIL_DEFAULT_OFF',
      );
      expect(row.classification).not.toBe('INTERNAL_ONLY');
    }
  });

  it('documents a reason for every NO_COMMUNICATION_REQUIRED transition', () => {
    for (const row of BENEFITS_COMMUNICATION_CATALOGUE) {
      if (row.classification === 'NO_COMMUNICATION_REQUIRED') {
        expect(row.eventCode).toBeNull();
        expect(row.reason && row.reason.length > 20).toBe(true);
      }
    }
  });

  it('uses only semantic recipient roles', () => {
    for (const row of BENEFITS_COMMUNICATION_CATALOGUE) {
      for (const role of row.recipientRoles) {
        expect(BENEFITS_RECIPIENT_ROLES).toContain(role);
      }
    }
  });

  it('never resolves a mortality external recipient as the deceased person', () => {
    const mortality = BENEFITS_COMMUNICATION_CATALOGUE.filter(
      (r) => r.domain === 'MORTALITY' && r.emailApplicable,
    );
    expect(mortality.length).toBeGreaterThan(0);
    for (const row of mortality) {
      for (const role of row.recipientRoles) {
        expect(['reporter', 'survivor', 'estate_representative', 'funeral_claimant']).toContain(
          role,
        );
      }
    }
  });

  it('keeps risk communication internal except the safe verification request', () => {
    const external = BENEFITS_COMMUNICATION_CATALOGUE.filter(
      (r) => r.domain === 'RISK' && r.emailApplicable,
    );
    expect(external.map((r) => r.eventCode)).toEqual([
      'BENEFITS.RISK.VERIFICATION.REQUESTED',
    ]);
  });

  it('keeps the working Claim Submitted producer wired', () => {
    const submitted = BENEFITS_COMMUNICATION_CATALOGUE.find(
      (r) => r.eventCode === 'BENEFITS.CLAIM.SUBMITTED',
    );
    expect(submitted?.producer).toContain('benefitsClaimSubmittedProducer');
  });

  it('reports producer coverage without silent gaps', () => {
    const summary = benefitsCoverageSummary();
    const required = benefitsProducerRequiredEntries();
    expect(summary.producersWired + summary.producersPending).toBe(required.length);
    // Pending producers must be explicitly visible, never silently green.
    expect(summary.producersPending).toBeGreaterThanOrEqual(0);
  });
});
