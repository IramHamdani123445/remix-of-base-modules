/**
 * Regression — when All Violations is scoped to an employer (?regno=), the
 * "Run Detection" action must scan ONLY that employer (and bypass the per-day
 * idempotency key). A tenant-wide scan runs in chained slices and can stop part
 * way through, which left late-sorting employers (e.g. newly created ones like
 * regno 761828) with no violations even though the rule simulator matched them.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const BUTTON = readFileSync(
  'src/components/compliance/violations/RunDetectionNowButton.tsx',
  'utf8',
);
const PAGE = readFileSync(
  'src/pages/compliance/violations/ViolationsManagement.tsx',
  'utf8',
);
const HOOK = readFileSync('src/hooks/compliance/useComplianceJobs.ts', 'utf8');

describe('scoped violation detection', () => {
  it('passes the employer scope into the detection job', () => {
    expect(BUTTON).toContain("params: employerId ? { employer_id: employerId } : undefined");
  });

  it('forces the run when scoped so the daily idempotency key cannot skip it', () => {
    expect(BUTTON).toContain('force: employerId ? true : undefined');
  });

  it('wires the current employer filter into the button', () => {
    expect(PAGE).toContain('<RunDetectionNowButton employerId={regno} />');
  });

  it('forwards extra params to the run-compliance-job function', () => {
    expect(HOOK).toContain('...(params ?? {})');
  });
});
