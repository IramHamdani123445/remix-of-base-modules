/**
 * MEANS-TEST EPIC 14 — architecture and hygiene certification.
 *
 * Source-level guards that keep the certified module honest: no direct
 * table access from Means-Test UI, no parallel command path, no stale
 * "not implemented" wording, no retired legacy surfaces.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = [
  'src/components/bn/meansTests',
  'src/pages/bn/meansTests',
  'src/services/bn/meansTests',
  'src/types/bn/meansTests',
];

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const FILES = ROOTS.flatMap(walk).filter((f) => /\.tsx?$/.test(f));
const SOURCES = FILES.map((path) => ({ path, text: readFileSync(path, 'utf8') }));

describe('EPIC 14 · architecture certification', () => {
  it('finds the Means-Test module source tree', () => {
    expect(SOURCES.length).toBeGreaterThan(20);
  });

  it('never reaches the database directly from Means-Test UI or pages', () => {
    const offenders = SOURCES.filter(
      (f) => /^src\/(components|pages)\//.test(f.path) && /supabase\s*\.\s*from\s*\(/.test(f.text),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('keeps mutations inside the governed command service', () => {
    const offenders = SOURCES.filter(
      (f) =>
        !f.path.includes('/services/') &&
        /supabase\s*\.\s*rpc\s*\(\s*['"]bn_means_[a-z_]*command/.test(f.text),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('carries no stale "not implemented"/"coming soon"/"TODO" statements in the UI', () => {
    const offenders = SOURCES.filter(
      (f) =>
        /^src\/(components|pages)\//.test(f.path) &&
        /(not implemented|coming soon|placeholder screen|TODO:)/i.test(f.text),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('has removed the superseded MT6 panels', () => {
    expect(existsSync('src/components/bn/meansTests/BnMeansVerificationPanel.tsx')).toBe(false);
    expect(existsSync('src/components/bn/meansTests/BnMeansCalculationPanel.tsx')).toBe(false);
  });

  it('exposes no raw MT-epic jargon (MT6/MT7/MT8) in user-facing copy', () => {
    const offenders = SOURCES.filter(
      (f) => /^src\/(components|pages)\//.test(f.path) && />[^<\n]*\bMT[6-8]\b/.test(f.text),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe('EPIC 14 · documentation reconciliation', () => {
  const matrixPath = 'docs/bn/means-tests/BN_MEANS_IMPLEMENTATION_MATRIX.md';

  it('publishes an implementation matrix that reaches Epic 14', () => {
    expect(existsSync(matrixPath)).toBe(true);
    const text = readFileSync(matrixPath, 'utf8');
    expect(text).toMatch(/Epic 14/i);
  });

  it('records a final Epic 14 completion record', () => {
    const record = 'docs/bn/means-tests/BN_MEANS_EPIC_14_COMPLETION_RECORD.md';
    expect(existsSync(record)).toBe(true);
    const text = readFileSync(record, 'utf8');
    for (const journey of ['Journey A', 'Journey B', 'Journey C', 'Journey D', 'Journey E', 'Journey F', 'Journey G', 'Journey H']) {
      expect(text).toContain(journey);
    }
  });
});
