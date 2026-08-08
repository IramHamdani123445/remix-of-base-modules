/**
 * Shared, memoised source scanner for Benefits architecture guard tests.
 *
 * Guard tests repeatedly walk `src/` and read every file, which made them the
 * slowest tests in the suite and prone to timeouts under full-suite load. The
 * walk and the file reads are performed once per process and cached here, so
 * every guard shares the same snapshot.
 *
 * This changes test performance only — the assertions each guard makes are
 * unchanged.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const SOURCE_ROOT = process.cwd();

const SKIP_DIRECTORIES = new Set(['__tests__', 'node_modules', 'test', '.git']);

let cachedFiles: readonly string[] | null = null;
const cachedSources = new Map<string, string>();

function walk(dir: string, out: string[]): string[] {
  let entries: string[];
  try {
    entries = readdirSync(join(SOURCE_ROOT, dir));
  } catch {
    return out;
  }
  for (const name of entries) {
    const rel = `${dir}/${name}`;
    const stat = statSync(join(SOURCE_ROOT, rel));
    if (stat.isDirectory()) {
      if (SKIP_DIRECTORIES.has(name)) continue;
      walk(rel, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(rel);
    }
  }
  return out;
}

/** Every non-test TypeScript source file under `src/`, walked once. */
export function listSourceFiles(): readonly string[] {
  if (!cachedFiles) {
    cachedFiles = walk('src', []).filter((f) => !f.includes('/integrations/supabase/types.ts'));
  }
  return cachedFiles;
}

/** File contents, read at most once per process. */
export function readSource(relativePath: string): string {
  const cached = cachedSources.get(relativePath);
  if (cached !== undefined) return cached;
  const source = readFileSync(join(SOURCE_ROOT, relativePath), 'utf8');
  cachedSources.set(relativePath, source);
  return source;
}

/** `[path, contents]` for every scanned source file. */
export function listSourcesWithContents(): readonly (readonly [string, string])[] {
  return listSourceFiles().map((f) => [f, readSource(f)] as const);
}
