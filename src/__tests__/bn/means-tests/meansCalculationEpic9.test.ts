/**
 * BN Means-Test — EPIC 9 calculation and explanation.
 *
 * Proves the browser boundary: no arithmetic, no readiness derivation, no
 * silent empty results, and every mutation through the governed command.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const rpc = vi.fn();
const getUser = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    auth: { getUser: () => getUser() },
    from: () => {
      throw new Error('direct table access is prohibited');
    },
  },
}));

import { meansQueryService } from '@/services/bn/meansTests/meansQueryService';
import { parseCommandError } from '@/services/bn/meansTests/meansCommandService';
import {
  BN_MEANS_TREATMENT_LABEL,
  calculationOutcomeLabel,
  calculationStalenessNotice,
  groupCalculationLines,
  meansCalcBlockerText,
  toAmount,
  type BnMeansCalculationLine,
  type BnMeansCalculationReadinessV9,
} from '@/types/bn/meansTests/meansCalculation';

const ACTOR = { data: { user: { id: 'a0000000-0000-4000-8000-000000000001' } } };

beforeEach(() => {
  rpc.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue(ACTOR);
});

const line = (over: Partial<BnMeansCalculationLine>): BnMeansCalculationLine =>
  ({
    line_id: Math.random().toString(16),
    line_no: 1,
    group_code: 'INCOME',
    display_order: 1,
    business_label: 'Wages',
    member_label: null,
    treatment_code: 'INCLUDED',
    explanation: null,
    policy_rule_code: null,
    claimed_amount: null,
    normalised_amount: null,
    disregard_amount: null,
    applied_amount: null,
    included: true,
    exclusion_reason: null,
    narrative: null,
    category_code: null,
    ...over,
  }) as BnMeansCalculationLine;

const readiness = (over: Partial<BnMeansCalculationReadinessV9>): BnMeansCalculationReadinessV9 =>
  ({
    assessment_id: 'x',
    assessment_version_id: 'v',
    status: 'VERIFICATION_PENDING',
    currency_code: 'XCD',
    ready_for_calculation: false,
    blockers: [],
    reason_codes: [],
    missing_verifications: [],
    rejected_facts: [],
    clarification_required: [],
    policy_configuration_issues: [],
    currency_issues: [],
    policy_parameters: null,
    verification_complete: false,
    verification_marked_complete: false,
    verification_outcome: null,
    verification_revision_hash: 'r1',
    has_calculation: false,
    current_calculation_id: null,
    calculation_current: false,
    calculation_stale: false,
    ...over,
  }) as BnMeansCalculationReadinessV9;

describe('explanation grouping', () => {
  it('orders groups business-first and sorts lines by display order', () => {
    const groups = groupCalculationLines([
      line({ group_code: 'RESULT', display_order: 550, business_label: 'Outcome' }),
      line({ group_code: 'INCOME', display_order: 202, business_label: 'Pension' }),
      line({ group_code: 'INCOME', display_order: 201, business_label: 'Wages' }),
      line({ group_code: 'HOUSEHOLD', display_order: 101, business_label: 'Household member' }),
    ]);
    expect(groups.map((g) => g.code)).toEqual(['HOUSEHOLD', 'INCOME', 'RESULT']);
    expect(groups[1].lines.map((l) => l.business_label)).toEqual(['Wages', 'Pension']);
  });

  it('keeps unknown groups rather than dropping backend output', () => {
    const groups = groupCalculationLines([line({ group_code: 'FUTURE_GROUP' })]);
    expect(groups.map((g) => g.code)).toContain('FUTURE_GROUP');
  });
});

describe('officer-readable treatment and blockers', () => {
  it.each([
    ['EXCLUDED_REJECTED', 'Excluded — rejected at verification'],
    ['DISREGARD_APPLIED', 'Disregarded'],
    ['NOT_ALLOWED', 'Not allowed'],
  ])('labels %s', (code, label) => {
    expect(BN_MEANS_TREATMENT_LABEL[code]).toBe(label);
  });

  it('prefers the backend message and falls back to canonical wording', () => {
    expect(meansCalcBlockerText({ code: 'X', message: 'Backend says no' })).toBe('Backend says no');
    expect(meansCalcBlockerText({ code: 'OUTSTANDING_VERIFICATION' })).toMatch(/awaiting a verification decision/);
  });

  it('never implies approval in the outcome wording', () => {
    expect(calculationOutcomeLabel('PASS')).toMatch(/pending independent approval/);
    expect(calculationOutcomeLabel('FAIL')).toMatch(/pending independent approval/);
    expect(calculationOutcomeLabel(null)).toBe('Not yet calculated');
  });
});

describe('staleness is reported, never inferred from arithmetic', () => {
  it('is silent when there is no calculation', () => {
    expect(calculationStalenessNotice(readiness({ has_calculation: false }))).toBeNull();
  });

  it('is silent when the backend says the calculation is current', () => {
    expect(
      calculationStalenessNotice(readiness({ has_calculation: true, calculation_current: true })),
    ).toBeNull();
  });

  it('warns when verification moved on after the calculation', () => {
    expect(
      calculationStalenessNotice(readiness({ has_calculation: true, calculation_current: false })),
    ).toMatch(/Recalculate before approval/);
  });
});

describe('amount parsing tolerates the numeric-as-string wire format', () => {
  it.each([
    ['1200.50', 1200.5],
    [0, 0],
  ])('parses %s', (input, expected) => {
    expect(toAmount(input as string | number)).toBe(expected);
  });

  it('returns null for absent values instead of zero', () => {
    expect(toAmount(null)).toBeNull();
    expect(toAmount(undefined)).toBeNull();
    expect(toAmount('')).toBeNull();
  });
});

describe('calculation workspace query', () => {
  it('reads through the governed RPC with the authenticated actor', async () => {
    rpc.mockResolvedValue({ data: { status: 'OK', data: { assessment_id: 'x' } }, error: null });
    const result = await meansQueryService.calculationWorkspace('x');
    expect(rpc).toHaveBeenCalledWith('bn_means_calculation_workspace_v1', {
      p_actor_user_id: ACTOR.data.user.id,
      p_assessment_id: 'x',
    });
    expect(result.status).toBe('OK');
  });

  it('never represents a failed read as an empty success', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'connection reset' } });
    const result = await meansQueryService.calculationWorkspace('x');
    expect(result.status).toBe('FAILED');
    expect(result.data).toBeNull();
  });

  it('propagates DENIED envelopes', async () => {
    rpc.mockResolvedValue({ data: { status: 'DENIED', code: 'PERMISSION_DENIED' }, error: null });
    const result = await meansQueryService.calculationWorkspace('x');
    expect(result.status).toBe('DENIED');
    expect(result.data).toBeNull();
  });

  it('refuses to read without an authenticated actor', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const result = await meansQueryService.calculationWorkspace('x');
    expect(rpc).not.toHaveBeenCalled();
    expect(result.code).toBe('UNAUTHENTICATED');
  });
});

describe('engine refusals are structured', () => {
  it.each([
    ['E_NOT_READY_FOR_CALCULATION:OUTSTANDING_VERIFICATION', 'NOT_READY_FOR_CALCULATION'],
    ['E_POLICY_PARAMETER_MISSING:income_threshold', 'POLICY_PARAMETER_MISSING'],
    ['E_FROZEN_VERSION_TAMPERED:abc', 'FROZEN_VERSION_TAMPERED'],
    ['E_INVALID_STATE:DRAFT -> CALCULATED', 'INVALID_STATE'],
  ])('maps %s', (message, code) => {
    expect(parseCommandError(message).code).toBe(code);
  });
});

describe('no browser-side calculation', () => {
  const root = 'src/components/bn/meansTests/calculation';

  function walk(dir: string): string[] {
    let out: string[] = [];
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return out;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out = out.concat(walk(full));
      else if (/\.tsx?$/.test(full)) out.push(full);
    }
    return out;
  }

  it('contains no direct table access and no threshold arithmetic', () => {
    const offenders: string[] = [];
    for (const file of walk(root)) {
      const source = readFileSync(file, 'utf8');
      if (/from\(\s*['"]bn_means_/.test(source)) offenders.push(`${file}: direct table access`);
      if (/threshold[^\n]*[-+*/]=|assessable[^\n]*[-+*/]\s*\w/.test(source)) {
        offenders.push(`${file}: local arithmetic`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
