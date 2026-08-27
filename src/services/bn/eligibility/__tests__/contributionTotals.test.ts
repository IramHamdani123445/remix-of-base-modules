/**
 * BUG-48 — contribution facts could not be resolved at intake, and every
 * reader of ip_wages named columns the table does not have.
 *
 * Reported from the screen: Sickness 2027 (SICK_11) v4, step 6 of 11, SSN
 * 200004. "Eligibility COULD NOT BE DETERMINED — 1 of 2 rules evaluated. Paid
 * contribution weeks must be at least 26 — UNEVALUATED. Not checked — Paid
 * contribution weeks is not available for this claimant." Next was blocked.
 *
 * Three faults, each on its own enough:
 *
 *   1. Six contribution resolvers began `if (!ctx.claimId) return null`. At
 *      intake the claim does not exist yet, so every contribution rule came
 *      back UNEVALUATED and no product carrying one could be registered.
 *      Contributions belong to the person, not the claim.
 *
 *   2. `ip_wages` has no `wages`, `weeks`, `contributions`, `employer_reg_no`
 *      or `id`. It is week-grained with `wages_paid1..7`, `paid_code1..7`,
 *      `payer_id` and `audit_id`. Five readers named absent columns, so
 *      PostgREST rejected the whole query with 42703 every time.
 *
 *   3. Each of those readers discarded the error and returned 0 or []. A
 *      failed read therefore counted as "this claimant has no contributions"
 *      and failed a minimum-weeks rule against her.
 *
 * The arithmetic now has one implementation, `computeContributionTotals`,
 * shared by the claim snapshot and by intake — so the wizard's Contribution
 * Window panel and the verdict behind it can no longer disagree.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rows: any[] = [];
let readFails = false;

vi.mock('@/integrations/supabase/client', () => {
  const build = (table: string) => {
    let out = table === 'ip_wages' ? [...rows] : [];
    const api: any = {
      select: () => api,
      eq: () => api,
      gte: (_c: string, v: string) => { out = out.filter((r) => r.period >= v); return api; },
      lte: (_c: string, v: string) => { out = out.filter((r) => r.period <= v); return api; },
      order: () => api,
      limit: () => api,
      maybeSingle: () => Promise.resolve({ data: out[0] ?? null, error: null }),
      insert: () => api,
      single: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: any) =>
        resolve(
          readFails && table === 'ip_wages'
            ? { data: null, error: { message: 'column ip_wages.wages does not exist' } }
            : { data: out, error: null },
        ),
    };
    return api;
  };
  return { supabase: { from: (t: string) => build(t) } };
});

const { computeContributionTotals } = await import('../contributionSnapshotService');

/** One ip_wages row — a week — in the shape the table actually has. */
const week = (period: string, wage: number, code = '') => {
  const r: any = { period, payer_id: 'E001', audit_id: 1, ip_ss_amt: wage * 0.05 };
  for (let i = 1; i <= 7; i++) {
    r[`wages_paid${i}`] = i === 1 ? wage : 0;
    r[`paid_code${i}`] = i === 1 ? code : '';
  }
  return r;
};

beforeEach(() => {
  rows.length = 0;
  readFails = false;
});

describe('a week is paid, credited, or neither', () => {
  it('a week with wages is paid', async () => {
    rows.push(week('2026-08-01', 300));
    const t = await computeContributionTotals('900004', '2026-08-27');
    expect(t.paid).toBe(1);
    expect(t.credited).toBe(0);
  });

  it('a week with a code but no wages is credited, not paid', async () => {
    rows.push(week('2026-08-01', 0, 'C'));
    const t = await computeContributionTotals('900004', '2026-08-27');
    expect(t.paid).toBe(0);
    expect(t.credited).toBe(1);
  });

  it('a week with neither is counted in total but is not cover', async () => {
    rows.push(week('2026-08-01', 0, ''));
    const t = await computeContributionTotals('900004', '2026-08-27');
    expect(t.paid).toBe(0);
    expect(t.credited).toBe(0);
    expect(t.total).toBe(1);
  });

  it('paid and credited are counted separately, never conflated', async () => {
    rows.push(week('2026-08-01', 300), week('2026-08-08', 0, 'C'), week('2026-08-15', 300));
    const t = await computeContributionTotals('900004', '2026-08-27');
    expect(t.paid).toBe(2);
    expect(t.credited).toBe(1);
    expect(t.total).toBe(3);
  });
});

describe('the average weekly wage', () => {
  it('averages over weeks that carried wages, not over every row', async () => {
    // A credited week has no wage; including it would understate the average.
    rows.push(week('2026-08-01', 300), week('2026-08-08', 100), week('2026-08-15', 0, 'C'));
    const t = await computeContributionTotals('900004', '2026-08-27');
    expect(t.avg).toBe(200);
  });

  it('is zero, not NaN, when no week carried wages', async () => {
    rows.push(week('2026-08-01', 0, 'C'));
    const t = await computeContributionTotals('900004', '2026-08-27');
    expect(t.avg).toBe(0);
    expect(Number.isNaN(t.avg)).toBe(false);
  });
});

describe('the windows', () => {
  it('counts only paid weeks inside the window', async () => {
    rows.push(
      week('2026-08-01', 300),   // inside 13 weeks
      week('2026-01-01', 300),   // inside 52, outside 13
      week('2024-01-01', 300),   // outside every window
    );
    const t = await computeContributionTotals('900004', '2026-08-27');
    expect(t.windowCounts.window_13).toBe(1);
    expect(t.windowCounts.window_52).toBe(2);
    expect(t.total).toBe(3);
  });

  it('does not count a credited week as a paid week in a window', async () => {
    rows.push(week('2026-08-01', 0, 'C'));
    const t = await computeContributionTotals('900004', '2026-08-27');
    expect(t.windowCounts.window_13).toBe(0);
  });

  it('the 26-week window is what the SICK_11 rule reads', async () => {
    for (let i = 0; i < 30; i++) {
      const d = new Date('2026-08-27');
      d.setDate(d.getDate() - i * 7);
      rows.push(week(d.toISOString().slice(0, 10), 300));
    }
    const t = await computeContributionTotals('200004', '2026-08-27');
    // Twenty-six weekly rows fall inside 26 weeks; the rest do not.
    expect(t.windowCounts.window_26).toBeGreaterThanOrEqual(26);
    expect(t.windowCounts.window_26).toBeLessThanOrEqual(27);
  });

  it('reports every window the snapshot stores', async () => {
    rows.push(week('2026-08-01', 300));
    const t = await computeContributionTotals('900004', '2026-08-27');
    for (const key of ['window_13', 'window_26', 'window_39', 'window_52', 'window_12m']) {
      expect(t.windowCounts[key], key).toBeTypeOf('number');
    }
  });
});

describe('an empty record and a failed read are different answers', () => {
  it('a claimant with no rows genuinely has zero weeks', async () => {
    const t = await computeContributionTotals('200004', '2026-08-27');
    expect(t.total).toBe(0);
    expect(t.paid).toBe(0);
  });

  it('a failed read throws rather than reporting zero weeks', async () => {
    readFails = true;
    // Zero would have been a finding against the claimant: 0 >= 26 fails.
    await expect(computeContributionTotals('200004', '2026-08-27')).rejects.toThrow(/ip_wages/);
  });
});

describe('the period range', () => {
  it('reports the earliest and latest week on record', async () => {
    rows.push(week('2026-08-01', 300), week('2025-03-15', 300), week('2026-02-20', 300));
    const t = await computeContributionTotals('900004', '2026-08-27');
    expect(t.minP).toBe('2025-03-15');
    expect(t.maxP).toBe('2026-08-01');
  });

  it('reports null for a claimant with no record', async () => {
    const t = await computeContributionTotals('200004', '2026-08-27');
    expect(t.minP).toBeNull();
    expect(t.maxP).toBeNull();
  });
});

describe('contributions are read without a claim — the intake case', () => {
  it('computes from the SSN alone, no claim id anywhere', async () => {
    // This is the whole point: at step 6 there is no claim to key a snapshot to.
    rows.push(week('2026-08-01', 300), week('2026-08-08', 300));
    const t = await computeContributionTotals('200004', '2026-08-27');
    expect(t.paid).toBe(2);
  });
});
