/**
 * Checkpoint D — Warning → Demand → Legal escalation and governed handoff.
 *
 * The trusted boundary is the database (stage configuration, SECURITY DEFINER
 * commands and the `zz_ce_legal_referral_governance` trigger). These tests
 * guard the client half of the contract:
 *  - no runtime path may create a legal referral directly;
 *  - no notice timing literal may survive in code;
 *  - all three Legal entry paths converge on the governed lifecycle.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { stageEligibleFrom } from '@/services/compliance/escalationStageService';

const SRC = join(process.cwd(), 'src');
const NOTICE_WORKER = readFileSync('supabase/functions/run-notice-generation/index.ts', 'utf8');
const FORWARDING = readFileSync(join(SRC, 'services/legal/complianceForwardingService.ts'), 'utf8');
const ESC_SERVICE = readFileSync(join(SRC, 'services/legalEscalationService.ts'), 'utf8');
const GOVERNANCE = readFileSync(join(SRC, 'services/compliance/legalReferralGovernance.ts'), 'utf8');

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
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
  const write = new RegExp(
    `from\\(\\s*['"\`]${table}['"\`](\\s+as\\s+any)?\\s*\\)[\\s\\S]{0,300}?\\.(insert|upsert)\\(`,
    'm',
  );
  return FILES.filter((f) => write.test(readFileSync(f, 'utf8')));
}

describe('one authoritative escalation-stage configuration', () => {
  it('the notice worker reads ce_escalation_stage_config, not job parameters', () => {
    expect(NOTICE_WORKER).toContain('ce_escalation_stage_config');
    expect(NOTICE_WORKER).not.toContain('notice_rules');
  });

  it('the notice worker holds no day-threshold literals of its own', () => {
    expect(NOTICE_WORKER).not.toMatch(/days_open/);
    expect(NOTICE_WORKER).not.toMatch(/\b(7|21|45)\s*\*\s*24\s*\*\s*60/);
  });

  it('generation and eligibility both run through the governed commands', () => {
    expect(NOTICE_WORKER).toContain('ce_generate_stage_notice_system_v1');
    expect(NOTICE_WORKER).toContain('ce_evaluate_stage_eligibility_v1');
  });

  it('an unconfigured waiting period is reported, never guessed', () => {
    expect(NOTICE_WORKER).toContain('unconfigured_stages');
    expect(NOTICE_WORKER).toContain('configuration_error');
  });

  it('computes the stage eligibility date from the configured delay', () => {
    expect(stageEligibleFrom('2026-08-01T00:00:00Z', 14).toISOString().slice(0, 10)).toBe('2026-08-15');
    expect(stageEligibleFrom('2026-08-01T00:00:00Z', 0).toISOString().slice(0, 10)).toBe('2026-08-01');
  });
});

describe('legal referrals cannot be created outside the governed lifecycle', () => {
  it('no application code inserts ce_legal_referrals directly', () => {
    expect(sourcesWriting('ce_legal_referrals')).toEqual([]);
  });

  it('"Refer to Legal" submits a recommendation when none is approved', () => {
    expect(FORWARDING).toContain('findApprovedRecommendation');
    expect(FORWARDING).toContain('recommendLegal');
    expect(FORWARDING).toContain('PENDING_APPROVAL');
  });

  it('the recommendation-driven path requires management approval first', () => {
    expect(ESC_SERVICE).toContain('Management approval is required');
    expect(ESC_SERVICE).not.toContain("from('ce_legal_referrals' as any)\n      .insert(");
  });
});

describe('all Legal entry paths converge on one governed engine', () => {
  it('exposes recommend / approve / reject commands only', () => {
    for (const rpc of [
      'ce_recommend_legal_v1',
      'ce_approve_legal_referral_v1',
      'ce_reject_legal_referral_v1',
    ]) {
      expect(GOVERNANCE).toContain(rpc);
    }
  });

  it('quick forward is a configuration-gated entry path, not a bypass', () => {
    expect(GOVERNANCE).toContain('QUICK_FORWARD');
    expect(GOVERNANCE).toContain('compliance.legal.quick_forward');
    // it still enters the same recommendation command
    expect(GOVERNANCE).toMatch(/entryPath[\s\S]{0,400}ce_recommend_legal_v1/);
  });
});

describe('financial truth comes from the canonical derived ledger', () => {
  it('legal governance never reads the cached period balance', () => {
    expect(GOVERNANCE).toContain('ce_canonical_financial_snapshot');
    expect(GOVERNANCE).not.toContain('ce_ledger_periods');
  });

  it('arrears escalation uses the average × multiplier model, not a flat figure', () => {
    expect(GOVERNANCE).toContain('ce_evaluate_arrears_threshold_v1');
    expect(GOVERNANCE).not.toContain('50000');
    expect(GOVERNANCE).not.toContain('50,000');
  });
});
