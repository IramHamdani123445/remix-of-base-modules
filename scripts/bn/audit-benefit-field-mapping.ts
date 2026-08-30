/**
 * BUG-51 — audit benefit-field resolution for EVERY product.
 *
 * For each bn_product row this reports:
 *   benefit_code | category | normalizeBenefitKey() | field count | fields with
 *   no ownership entry
 *
 * Report only — always exits 0.
 *
 *   npx tsx scripts/bn/audit-benefit-field-mapping.ts
 *   npx tsx scripts/bn/audit-benefit-field-mapping.ts --json
 */
import { readFileSync } from 'node:fs';
import {
  BENEFIT_FIELDS,
  normalizeBenefitKey,
} from '../../src/services/bn/forms/sectionCatalogue';
import { BN_FIELD_OWNERSHIP } from '../../src/lib/bn/fieldOwnership';

interface ProductRow {
  benefit_code: string | null;
  benefit_name: string | null;
  category: string | null;
}

function readEnv(): { url: string; key: string } {
  const fromProcess = {
    url: process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL,
    key: process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY,
  };
  if (fromProcess.url && fromProcess.key) return { url: fromProcess.url, key: fromProcess.key };

  const text = readFileSync('.env', 'utf8');
  const pick = (name: string) =>
    text.split(/\r?\n/).find((l) => l.startsWith(`${name}=`))?.slice(name.length + 1).trim()
      .replace(/^["']|["']$/g, '');
  const url = pick('VITE_SUPABASE_URL');
  const key = pick('VITE_SUPABASE_PUBLISHABLE_KEY');
  if (!url || !key) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY not found');
  return { url, key };
}

const { url: SUPABASE_URL, key: SUPABASE_KEY } = readEnv();

async function rest<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  const body = await res.json();
  if (!res.ok || (body && (body as any).code)) {
    throw new Error(`GET ${path} → ${JSON.stringify(body)}`);
  }
  return body as T;
}

function ownershipGaps(category: string | null, benefitKey: string | null): string[] {
  if (!benefitKey) return [];
  const map = BN_FIELD_OWNERSHIP[category ?? ''] ?? {};
  return (BENEFIT_FIELDS[benefitKey] ?? [])
    .map((f) => f.field_code)
    .filter((code) => !map[code]);
}

async function main() {
  const asJson = process.argv.includes('--json');
  const products = await rest<ProductRow[]>(
    'bn_product?select=benefit_code,benefit_name,category&order=benefit_code',
  );

  const rows = products.map((p) => {
    const key = normalizeBenefitKey(p.benefit_code);
    const gaps = ownershipGaps(p.category, key);
    return {
      benefit_code: p.benefit_code ?? '(null)',
      category: p.category ?? '(null)',
      benefit_key: key,
      field_count: key ? (BENEFIT_FIELDS[key] ?? []).length : 0,
      missing_ownership: gaps,
    };
  });

  const resolved = rows.filter((r) => r.benefit_key).length;
  const missingAll = Array.from(
    new Set(rows.flatMap((r) => r.missing_ownership.map((f) => `${r.category}.${f}`))),
  ).sort();

  if (asJson) {
    console.log(JSON.stringify({ rows, resolved, unresolved: rows.length - resolved, missingAll }, null, 2));
    return;
  }

  const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
  console.log(
    `${pad('BENEFIT_CODE', 26)} ${pad('CATEGORY', 18)} ${pad('RESOLVED KEY', 26)} ${pad('#F', 3)} MISSING OWNERSHIP`,
  );
  console.log('-'.repeat(110));
  for (const r of rows) {
    console.log(
      `${pad(r.benefit_code, 26)} ${pad(r.category, 18)} ${pad(r.benefit_key ?? '— unresolved —', 26)} ${pad(
        String(r.field_count),
        3,
      )} ${r.missing_ownership.join(', ')}`,
    );
  }
  console.log('-'.repeat(110));
  console.log(`Products: ${rows.length}   resolved: ${resolved}   unresolved: ${rows.length - resolved}`);
  console.log(
    missingAll.length
      ? `Fields with no ownership entry (${missingAll.length}): ${missingAll.join(', ')}`
      : 'Every resolved benefit field has an ownership entry.',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(0);
});
