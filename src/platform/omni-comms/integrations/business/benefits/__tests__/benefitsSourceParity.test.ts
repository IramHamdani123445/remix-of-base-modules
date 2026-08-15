import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BENEFITS_SOURCE_BOUNDARIES,
  BENEFITS_COMMAND_ALIASES,
  benefitsCoverageRows,
  benefitsSourceParityReport,
  benefitsThreeNumberCoverage,
  resolveBenefitsProducerState,
  resolveBenefitsSourceStatus,
} from '../benefitsSourceParity';
import { BENEFITS_COMMUNICATION_CATALOGUE } from '../benefitsCommunicationCatalogue';

const GENERATED_TYPES = readFileSync(
  resolve(process.cwd(), 'src/integrations/supabase/types.ts'),
  'utf8',
);

describe('Benefits source parity', () => {
  it('every declared RPC boundary exists in the generated database types', () => {
    const missing: string[] = [];
    for (const [command, boundary] of Object.entries(BENEFITS_SOURCE_BOUNDARIES)) {
      if (!boundary.rpc) continue;
      if (!GENERATED_TYPES.includes(`      ${boundary.rpc}: {`)) {
        missing.push(`${command} → ${boundary.rpc}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('never marks a transition EXECUTABLE without a source reference', () => {
    for (const row of benefitsCoverageRows()) {
      if (row.sourceStatus !== 'PLANNED') {
        expect(row.sourceRef, row.command).toBeTruthy();
        expect(row.triggerOwner, row.command).not.toBe('NOT_IMPLEMENTED');
        // A transition with no communication event legitimately emits nothing.
        if (row.eventCode) {
          expect(row.emissionMechanism, row.command).not.toBe('NONE');
        }
      }

    }
  });

  it('classifies every catalogue transition with a bounded source status', () => {
    for (const row of BENEFITS_COMMUNICATION_CATALOGUE) {
      expect(['EXECUTABLE', 'SCHEDULER', 'PLANNED']).toContain(
        resolveBenefitsSourceStatus(row.command),
      );
    }
  });

  it('never uses a deprecated command alias as a business transition', () => {
    expect(BENEFITS_COMMAND_ALIASES.length).toBeGreaterThan(0);
    expect(benefitsSourceParityReport().aliasesUsedAsTransitions).toEqual([]);
  });

  it('has no duplicate (command, target state) transitions', () => {
    expect(benefitsSourceParityReport().duplicateTransitions).toEqual([]);
  });

  it('invents no catalogue transition without an authoritative source declaration', () => {
    expect(benefitsSourceParityReport().catalogueOnly).toEqual([]);
  });

  it('classifies every authoritative source transition (no source gaps)', () => {
    expect(benefitsSourceParityReport().sourceMissingFromCatalogue).toEqual([]);
  });


  it('never reports a non-executable Benefits command as a missing live producer', () => {
    for (const row of BENEFITS_COMMUNICATION_CATALOGUE) {
      const state = resolveBenefitsProducerState(row);
      if (resolveBenefitsSourceStatus(row.command) === 'PLANNED') {
        expect(state, row.command).not.toBe('PENDING_WIRING');
      }
      if (state === 'PENDING_WIRING') {
        expect(resolveBenefitsSourceStatus(row.command), row.command).not.toBe(
          'PLANNED',
        );
      }
    }
  });

  it('reports three independent coverage numbers', () => {
    const c = benefitsThreeNumberCoverage();
    expect(c.eventsDesigned).toBeGreaterThan(0);
    expect(c.sourceExecutable + c.sourceScheduler + c.sourcePlanned).toBe(
      BENEFITS_COMMUNICATION_CATALOGUE.length,
    );
    expect(
      c.producersWired + c.producersPendingWiring + c.producersWaitingForSource,
    ).toBe(
      BENEFITS_COMMUNICATION_CATALOGUE.filter(
        (r) =>
          r.classification === 'COMMUNICATION_REQUIRED' ||
          r.classification === 'COMMUNICATION_OPTIONAL',
      ).length,
    );
    // Designed ≠ executable ≠ wired: the numbers must never be collapsed.
    expect(c.eventsDesigned).toBeGreaterThanOrEqual(c.sourceExecutable);
    expect(c.producersWired).toBeLessThanOrEqual(c.emailCapableExecutable + 1);
  });

  it('keeps the working Claim Submitted transition executable and wired', () => {
    const row = benefitsCoverageRows().find(
      (r) => r.eventCode === 'BENEFITS.CLAIM.SUBMITTED',
    );
    expect(row?.sourceStatus).toBe('EXECUTABLE');
    expect(row?.sourceRef).toBe('public.bn_submit_claim_application');
    expect(row?.emissionMechanism).toBe('CORE_TRANSACTION');
    expect(row?.producerState).toBe('WIRED');
  });
});
