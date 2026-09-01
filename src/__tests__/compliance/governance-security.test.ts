/**
 * Step 5 — Compliance governance negative security tests (source boundary).
 *
 * The trusted boundary is the database (SECURITY DEFINER commands +
 * revoked table grants). These tests guard the *client* half of the
 * contract: no application code may write waiver lifecycle tables or the
 * legal handoff override register directly, because those writes would
 * bypass authority, cap, fund, reason and SoD checks.
 *
 * Runtime proof of the database half lives in
 * `supabase/tests/sql/ce_governance_negative.sql`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

const FILES = walk(SRC);

function sourcesWriting(table: string): string[] {
  const writePattern = new RegExp(
    `from\\(\\s*['"\`]${table}['"\`]\\s*\\)[\\s\\S]{0,200}?\\.(insert|update|upsert|delete)\\(`,
    'm',
  );
  const constPattern = new RegExp(`['"\`]${table}['"\`]\\s+as\\s+never`);
  return FILES.filter((f) => {
    const src = readFileSync(f, 'utf8');
    if (writePattern.test(src)) return true;
    // services that alias the table name into a constant then write through it
    if (constPattern.test(src) && /\.(insert|update|upsert|delete)\(/.test(src)) {
      // allow only if the alias is never used for a write
      const aliasMatch = src.match(new RegExp(`const\\s+(\\w+)\\s*=\\s*['"\`]${table}['"\`]`));
      if (!aliasMatch) return false;
      const alias = aliasMatch[1];
      const aliasWrite = new RegExp(
        `from\\(\\s*${alias}[\\s\\S]{0,200}?\\.(insert|update|upsert|delete)\\(`,
        'm',
      );
      return aliasWrite.test(src);
    }
    return false;
  });
}

describe('Compliance governance — client write boundary', () => {
  it('no application code writes ce_waivers directly', () => {
    expect(sourcesWriting('ce_waivers')).toEqual([]);
  });

  it('no application code writes ce_waiver_decisions directly', () => {
    expect(sourcesWriting('ce_waiver_decisions')).toEqual([]);
  });

  it('no application code writes the legal handoff override register directly', () => {
    expect(sourcesWriting('ce_legal_handoff_overrides')).toEqual([]);
  });

  it('waiverService routes every lifecycle transition through governed commands', () => {
    const src = readFileSync(join(SRC, 'services', 'waiverService.ts'), 'utf8');
    for (const rpc of [
      'ce_request_waiver_v1',
      'ce_approve_waiver_v1',
      'ce_reject_waiver_v1',
      'ce_cancel_waiver_v1',
    ]) {
      expect(src).toContain(rpc);
    }
    // client-side cap arithmetic must no longer decide the outcome
    expect(src).not.toContain('exceeds rule cap');
  });

  it('the legal referral wizard records overrides through the governed command', () => {
    const src = readFileSync(
      join(SRC, 'pages', 'compliance', 'legal', 'ComplianceLegalReferralWizard.tsx'),
      'utf8',
    );
    expect(src).toContain('ce_record_legal_handoff_override_v1');
  });
});
