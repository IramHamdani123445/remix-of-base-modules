/**
 * Architecture test — no browser source may mutate a Medical Review table
 * directly.
 *
 * `authenticated` holds no INSERT/UPDATE/DELETE privilege on
 * `bn_medical_review_schedule`, and every canonical `bn_medical_review*`,
 * `bn_medical_board*` and `bn_medical_provider*` table is RPC-only. This test
 * fails the build if any non-test source under `src/` reintroduces a direct
 * `.insert(...)` / `.update(...)` / `.upsert(...)` / `.delete(...)` against one
 * of those tables.
 *
 * Documented read-only exceptions (SELECT only, still permitted):
 *   - `bn_medical_review_schedule` — Award 360 + Screen 24 read surface,
 *     pending migration to a secured query RPC.
 *   - `bn_medical_provider_type`   — reference data lookup.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

const TABLE_PATTERN = /bn_medical_(review|board|provider)[a-z_]*/;
const MUTATIONS = ['insert', 'update', 'upsert', 'delete'] as const;

/** Files allowed to name these tables in a mutating statement (none today). */
const ALLOWED: ReadonlySet<string> = new Set<string>([]);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    return out;
  }
  for (const name of entries) {
    const rel = `${dir}/${name}`;
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      walk(rel, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * Detects `.from('<medical table>')` followed (within the same statement) by a
 * mutating call, in either chain order.
 */
function findOffences(source: string): string[] {
  const found: string[] = [];
  const fromRe = /\.from\(\s*['"`](bn_medical_[a-z_]+)['"`]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(source)) !== null) {
    const table = m[1];
    if (!TABLE_PATTERN.test(table)) continue;
    // Look ahead through the chained statement (bounded window, stop at `;`).
    const tail = source.slice(m.index, m.index + 400);
    const statement = tail.split(';')[0];
    for (const op of MUTATIONS) {
      if (new RegExp(`\\.${op}\\s*\\(`).test(statement)) {
        found.push(`${table}.${op}()`);
      }
    }
  }
  return found;
}

describe('architecture: Medical Review tables are RPC-only from the browser', () => {
  const files = walk('src').filter((f) => !f.includes('/integrations/supabase/types.ts'));

  it('scans a non-trivial number of source files', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('no direct mutation of bn_medical_review_schedule', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (ALLOWED.has(f)) continue;
      const src = readFileSync(join(ROOT, f), 'utf8');
      if (!src.includes('bn_medical_review_schedule')) continue;
      const hits = findOffences(src).filter((h) => h.startsWith('bn_medical_review_schedule.'));
      if (hits.length) offenders.push(`${f}: ${hits.join(', ')}`);
    }
    expect(offenders, `Direct mutations found:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no direct mutation of any canonical Medical Review / Board / Provider table', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (ALLOWED.has(f)) continue;
      const src = readFileSync(join(ROOT, f), 'utf8');
      const hits = findOffences(src);
      if (hits.length) offenders.push(`${f}: ${hits.join(', ')}`);
    }
    expect(offenders, `Direct mutations found:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('retired servicing helpers are not reintroduced', () => {
    const src = readFileSync(join(ROOT, 'src/services/bn/awardServicingService.ts'), 'utf8');
    expect(src).not.toMatch(/export async function scheduleMedicalReview\b/);
    expect(src).not.toMatch(/export async function recordMedicalReviewOutcome\b/);
  });

  it('the governed legacy command wrapper exists and calls only versioned RPCs', () => {
    const src = readFileSync(
      join(ROOT, 'src/services/bn/medicalReviewLegacyScheduleCommands.ts'),
      'utf8',
    );
    for (const fn of [
      'bn_medical_review_legacy_schedule_v1',
      'bn_medical_review_legacy_record_outcome_v1',
      'bn_medical_review_legacy_provision_v1',
    ]) {
      expect(src).toContain(fn);
    }
    expect(src).not.toMatch(/\.from\(/);
  });
});
