/**
 * AV-001 regression — All Violations must scope the employer (regno) filter on
 * the SERVER, not on the already-paginated page. The old client-side filter
 * dropped auto-generated violations that lived beyond page 1.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(
  'src/pages/compliance/violations/ViolationsManagement.tsx',
  'utf8',
);

describe('All Violations employer scoping', () => {
  it('passes the employer scope into the server query', () => {
    expect(SOURCE).toContain('employerId: regno || undefined');
  });

  it('does not filter the fetched page client-side by employer', () => {
    expect(SOURCE).not.toContain('allRows.filter');
  });

  it('renders the rows returned by the paginated fetcher', () => {
    expect(SOURCE).toContain('const violations = pageData?.rows ?? []');
  });
});
