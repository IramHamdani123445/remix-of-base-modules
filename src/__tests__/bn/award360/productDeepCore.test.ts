/**
 * AW360-WAVE-1-C1 Sub-batch B2-c.2 — Product Deep certification.
 *
 * Executes the REAL `getAwardProductDeep` loader through the shared
 * `AwardQueryRecorder` against `AWARD360_SCHEMA_CONTRACT`, covering:
 *
 *   • Primary Award/Product semantics
 *   • Version resolution via bn_award.bn_claim_id → bn_claim.product_version_id
 *   • Exact bn_product_version selection (every readiness field)
 *   • Configuration permission suppression
 *   • Full-ready readiness result
 *   • Missing / partial / not-applicable readiness result
 *   • Product-mismatch, publication and effective-date warnings
 *   • Independent optional-source failure isolation matrix
 *   • Exact scope/filter/count/head assertions
 *   • Negative scope-contract guards (non-certified `contract:` tag)
 *
 * This file owns the `product-deep-certification` suite. Evidence
 * reconciliation is delegated to the shared helper
 * `assertLoaderCertificationEvidence` so it stays symmetric with the
 * `main-loader-certification` suite.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AwardQueryRecorder,
  type RecordedScenarioExecution,
} from '@/test/mocks/award360QueryRecorder';
import {
  assertLoaderCertificationEvidence,
  assertSuiteOwnershipIsPartitioned,
} from '@/test/award360/assertLoaderCertificationEvidence';

// Suite-local evidence sink — Product Deep executions ONLY.
const capturedExecutions: RecordedScenarioExecution[] = [];

const holder = vi.hoisted(() => ({ recorder: null as AwardQueryRecorder | null }));

vi.mock('@/integrations/supabase/client', () => {
  const supabase = {
    from(table: string) {
      if (!holder.recorder) throw new Error('AwardQueryRecorder not initialised');
      return holder.recorder.client().from(table);
    },
  };
  return { supabase };
});

holder.recorder = new AwardQueryRecorder({
  onExecutionComplete: (evidence) => capturedExecutions.push(evidence),
});
const recorder = holder.recorder;

import { getAwardProductDeep } from '@/services/bn/awards/award360DeepService';

function setResponses(map: Record<string, unknown>) {
  (recorder as any).opts.responses = map;
}
function setErrors(map: Record<string, { message: string; code?: string }>) {
  (recorder as any).opts.errors = map;
}
function setScenarioErrors(rules: Array<{ table: string; loaderName?: string; scenarioId?: string; occurrence?: number; error: { message: string; code?: string } }>) {
  (recorder as any).opts.scenarioErrors = rules;
}

beforeEach(() => {
  recorder.reset();
  (recorder as any).opts.responses = {};
  (recorder as any).opts.errors = {};
  (recorder as any).opts.scenarioErrors = [];
  (recorder as any).opts.scenarioResponses = [];
});

// ─── fixtures ─────────────────────────────────────────────────────────────
const A_ID = 'a-1';
const P_ID = 'p-1';
const C_ID = 'c-1';
const PV_ID = 'pv-1';

const AWARD_START = '2024-06-01';

const AWARD_ROW = {
  id: A_ID,
  bn_product_id: P_ID,
  bn_claim_id: C_ID,
  start_date: AWARD_START,
  base_amount: 100,
};

const PRODUCT_ROW = {
  id: P_ID,
  benefit_code: 'RET',
  benefit_name: 'Retirement',
  description: 'Retirement benefit',
  scheme_id: 'S-1',
  branch_id: 'B-1',
  category: 'PENSION',
  branch: 'B-1',
  payment_type: 'RECURRING',
  country_code: 'KN',
  status: 'ACTIVE',
};

/** Every field the readiness resolver reads — the EXACT `.select()` set. */
const REQUIRED_VERSION_SELECT_FIELDS = [
  'id', 'product_id', 'version_number', 'status',
  'effective_from', 'effective_to',
  'entered_by', 'entered_at', 'modified_by', 'modified_at',
  'formula_template_id', 'workflow_template_id',
  'document_profile_id', 'screen_template_id',
  'payment_frequency',
  'life_certificate_policy', 'medical_review_policy',
  'review_policy', 'survivor_beneficiary_policy',
] as const;

function versionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: PV_ID,
    product_id: P_ID,
    version_number: 3,
    status: 'PUBLISHED',
    effective_from: '2024-01-01',
    effective_to: '2025-12-31',
    entered_by: 'u-1',
    entered_at: '2024-01-01T00:00:00Z',
    modified_by: 'u-1',
    modified_at: '2024-01-01T00:00:00Z',
    formula_template_id: 'ft-1',
    workflow_template_id: 'wf-1',
    document_profile_id: 'dp-1',
    screen_template_id: 'st-1',
    payment_frequency: 'MONTHLY',
    life_certificate_policy: { every: 'YEAR' },
    medical_review_policy: { every: '2Y' },
    review_policy: { window: '30D' },
    survivor_beneficiary_policy: { rule: 'SPOUSE_FIRST' },
    ...overrides,
  };
}

const FULL_ACCESS = { canViewConfiguration: true };
const NO_CONFIG = { canViewConfiguration: false };

const FULL_READY_RESPONSES = () => ({
  bn_award: AWARD_ROW,
  bn_product: PRODUCT_ROW,
  bn_claim: { product_version_id: PV_ID },
  bn_product_version: versionRow(),
  bn_product_formula_binding: [{ id: 'fb-1', formula_template_id: 'ft-1', formula_version_id: 'fv-1', calculation_stage: 'BASE' }],
  bn_eligibility_rule: [{ id: 'er-1' }],
  bn_approval_policy: [{ id: 'ap-1' }],
  bn_comm_mapping: [{ id: 'cm-1' }, { id: 'cm-2' }, { id: 'cm-3' }],
});

// ═════════════════════════════════════════════════════════════════════════
describe('AW360 B2-c.2 · getAwardProductDeep — primary-source semantics', () => {
  it('scenario `product-deep-award-without-product` returns null and never queries downstream', async () => {
    setResponses({ bn_award: { ...AWARD_ROW, bn_product_id: null, bn_claim_id: null } });
    const v = await recorder.runAs('getAwardProductDeep', 'product-deep-award-without-product', () =>
      getAwardProductDeep(A_ID, FULL_ACCESS),
    );
    expect(v).toBeNull();
    expect(recorder.queries.map((q) => q.table)).toEqual(['bn_award']);
  });

  it('scenario `product-deep-award-query-error` rejects (no downstream queries)', async () => {
    setErrors({ bn_award: { message: 'award unavailable' } });
    await expect(
      recorder.runAs('getAwardProductDeep', 'product-deep-award-query-error', () =>
        getAwardProductDeep(A_ID, FULL_ACCESS),
      ),
    ).rejects.toBeTruthy();
    expect(recorder.queries.map((q) => q.table)).toEqual(['bn_award']);
  });

  it('scenario `product-deep-product-not-found` returns null after bn_product miss', async () => {
    setResponses({ bn_award: AWARD_ROW, bn_product: null });
    const v = await recorder.runAs('getAwardProductDeep', 'product-deep-product-not-found', () =>
      getAwardProductDeep(A_ID, FULL_ACCESS),
    );
    expect(v).toBeNull();
    expect(recorder.queries.map((q) => q.table)).toEqual(['bn_award', 'bn_product']);
  });

  it('scenario `product-deep-product-query-error` rejects after bn_award succeeds', async () => {
    setResponses({ bn_award: AWARD_ROW });
    setErrors({ bn_product: { message: 'product unavailable' } });
    await expect(
      recorder.runAs('getAwardProductDeep', 'product-deep-product-query-error', () =>
        getAwardProductDeep(A_ID, FULL_ACCESS),
      ),
    ).rejects.toBeTruthy();
    expect(recorder.queries.map((q) => q.table)).toEqual(['bn_award', 'bn_product']);
  });

  it('scenario `product-deep-identity-mapping` maps benefit_code / benefit_name (never product_code); resolves scheme_id/branch_id to names (BUG-011)', async () => {
    setResponses({
      bn_award: { ...AWARD_ROW, bn_claim_id: null },
      bn_product: PRODUCT_ROW,
      bn_scheme: { scheme_name: 'Short-Term Benefits' },
      bn_branch: { branch_name: 'Main Branch' },
    });
    const v = await recorder.runAs('getAwardProductDeep', 'product-deep-identity-mapping', () =>
      getAwardProductDeep(A_ID, FULL_ACCESS),
    );
    expect(v).not.toBeNull();
    expect(v!.identity.productCode).toBe('RET');
    expect(v!.identity.productName).toBe('Retirement');
    expect(v!.identity.benefitCode).toBe('RET');
    expect(v!.identity.scheme).toBe('Short-Term Benefits');
    expect(v!.identity.branch).toBe('Main Branch');
    const pq = recorder.queries.find((q) => q.table === 'bn_product')!;
    expect(pq.selectedColumns).not.toContain('product_code');
    expect(pq.selectedColumns).not.toContain('product_name');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('AW360 B2-c.2 · getAwardProductDeep — Product Version resolution', () => {
  it('scenario `product-deep-no-linked-claim` skips bn_claim/bn_product_version and leaves readiness NOT_APPLICABLE', async () => {
    setResponses({ bn_award: { ...AWARD_ROW, bn_claim_id: null }, bn_product: PRODUCT_ROW });
    const v = await recorder.runAs('getAwardProductDeep', 'product-deep-no-linked-claim', () =>
      getAwardProductDeep(A_ID, FULL_ACCESS),
    );
    expect(v).not.toBeNull();
    expect(v!.version.present).toBe(false);
    expect(v!.warnings.some((w) => w.key === 'MISSING_VERSION')).toBe(true);
    expect(v!.readiness).toHaveLength(12);
    for (const r of v!.readiness) expect(r.state).toBe('NOT_APPLICABLE');
    const tables = new Set(recorder.queries.map((q) => q.table));
    expect(tables.has('bn_claim')).toBe(false);
    expect(tables.has('bn_product_version')).toBe(false);
  });

  it('scenario `product-deep-claim-without-version` queries bn_claim but not bn_product_version', async () => {
    setResponses({
      bn_award: AWARD_ROW,
      bn_product: PRODUCT_ROW,
      bn_claim: { product_version_id: null },
    });
    const v = await recorder.runAs('getAwardProductDeep', 'product-deep-claim-without-version', () =>
      getAwardProductDeep(A_ID, FULL_ACCESS),
    );
    expect(v).not.toBeNull();
    expect(v!.version.present).toBe(false);
    expect(v!.warnings.some((w) => w.key === 'MISSING_VERSION')).toBe(true);
    const tables = recorder.queries.map((q) => q.table);
    expect(tables).toContain('bn_claim');
    expect(tables).not.toContain('bn_product_version');
    const claimQ = recorder.queries.find((q) => q.table === 'bn_claim')!;
    expect(claimQ.filters.some((f) => f.method === 'eq' && f.column === 'id' && f.value === C_ID)).toBe(true);
  });

  it('scenario `product-deep-version-select-contract` — bn_product_version .select() exactly equals the 19 readiness fields', async () => {
    setResponses({
      bn_award: AWARD_ROW,
      bn_product: PRODUCT_ROW,
      bn_claim: { product_version_id: PV_ID },
      bn_product_version: versionRow(),
      bn_product_formula_binding: [],
      bn_eligibility_rule: [],
      bn_approval_policy: [],
      bn_comm_mapping: [],
    });
    await recorder.runAs('getAwardProductDeep', 'product-deep-version-select-contract', () =>
      getAwardProductDeep(A_ID, FULL_ACCESS),
    );
    const pvQ = recorder.queries.find((q) => q.table === 'bn_product_version')!;
    expect([...pvQ.selectedColumns].sort()).toEqual(
      [...REQUIRED_VERSION_SELECT_FIELDS].sort(),
    );
    expect(pvQ.filters.some((f) => f.method === 'eq' && f.column === 'id' && f.value === PV_ID)).toBe(true);
  });

  it('regression: an unexpected extra selected field fails the exact-contract assertion', () => {
    const observed = [...REQUIRED_VERSION_SELECT_FIELDS, 'legacy_extra'];
    const cmp = () =>
      expect([...observed].sort()).toEqual([...REQUIRED_VERSION_SELECT_FIELDS].sort());
    expect(cmp).toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('AW360 B2-c.2 · getAwardProductDeep — configuration permission suppression', () => {
  it('scenario `product-deep-configuration-restricted` never queries configuration sources', async () => {
    setResponses({
      bn_award: AWARD_ROW,
      bn_product: PRODUCT_ROW,
      bn_claim: { product_version_id: PV_ID },
      bn_product_version: versionRow(),
    });
    const v = await recorder.runAs('getAwardProductDeep', 'product-deep-configuration-restricted', () =>
      getAwardProductDeep(A_ID, NO_CONFIG),
    );
    expect(v).not.toBeNull();
    expect(v!.restrictedConfiguration).toBe(true);
    expect(v!.identity.productId).toBe(P_ID);
    expect(v!.version.present).toBe(true);
    const tables = new Set(recorder.queries.map((q) => q.table));
    for (const t of ['bn_product_formula_binding', 'bn_eligibility_rule', 'bn_approval_policy', 'bn_comm_mapping']) {
      expect(tables.has(t), `${t} must not be queried under restricted configuration`).toBe(false);
    }
    expect(v!.readiness).toHaveLength(12);
    for (const r of v!.readiness) expect(r.state).toBe('RESTRICTED');
    for (const w of v!.warnings) {
      expect(w.key.startsWith('MISSING_')).toBe(false);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('AW360 B2-c.2 · getAwardProductDeep — full-ready readiness', () => {
  it('scenario `product-deep-full-ready` yields READY on every row and clean version flags', async () => {
    setResponses(FULL_READY_RESPONSES());
    const v = await recorder.runAs('getAwardProductDeep', 'product-deep-full-ready', () =>
      getAwardProductDeep(A_ID, FULL_ACCESS),
    );
    expect(v).not.toBeNull();
    expect(v!.version.productMatchesAward).toBe(true);
    expect(v!.version.awardWithinEffective).toBe(true);
    expect(v!.version.published).toBe(true);
    const byKey = new Map(v!.readiness.map((r) => [r.key, r.state]));
    for (const key of ['FORMULA', 'ELIG', 'WF', 'APPROVAL', 'DOC', 'SCREEN', 'PAY', 'LC', 'MR', 'SUSP', 'BEN', 'COMM']) {
      expect(byKey.get(key), `readiness ${key} not READY`).toBe('READY');
    }
    for (const w of v!.warnings) {
      expect(w.key.startsWith('MISSING_')).toBe(false);
      expect(w.key).not.toBe('INCOMPLETE_COMM');
      expect(w.key).not.toBe('PRODUCT_VERSION_MISMATCH');
      expect(w.key).not.toBe('VERSION_NOT_PUBLISHED');
      expect(w.key).not.toBe('OUTSIDE_EFFECTIVE');
    }

    // Exact scope / filter / count / head contracts on readiness sources.
    const fbQ = recorder.queries.find((q) => q.table === 'bn_product_formula_binding')!;
    expect(fbQ.filters.some((f) => f.method === 'eq' && f.column === 'product_version_id' && f.value === PV_ID)).toBe(true);

    const eligQ = recorder.queries.find((q) => q.table === 'bn_eligibility_rule')!;
    expect(eligQ.filters.some((f) => f.method === 'eq' && f.column === 'product_version_id' && f.value === PV_ID)).toBe(true);
    expect(eligQ.filters.some((f) => f.method === 'eq' && f.column === 'is_active' && f.value === true)).toBe(true);
    expect(eligQ.countMode).toBe('exact');
    expect(eligQ.head).toBe(true);

    const apQ = recorder.queries.find((q) => q.table === 'bn_approval_policy')!;
    expect(apQ.filters.some((f) => f.method === 'eq' && f.column === 'product_version_id' && f.value === PV_ID)).toBe(true);
    expect(apQ.filters.some((f) => f.method === 'eq' && f.column === 'is_enabled' && f.value === true)).toBe(true);
    expect(apQ.countMode).toBe('exact');
    expect(apQ.head).toBe(true);

    const commQ = recorder.queries.find((q) => q.table === 'bn_comm_mapping')!;
    expect(commQ.filters.some((f) => f.method === 'eq' && f.column === 'bn_product_version_id' && f.value === PV_ID)).toBe(true);
    expect(commQ.filters.some((f) => f.method === 'eq' && f.column === 'active' && f.value === true)).toBe(true);
    expect(commQ.countMode).toBe('exact');
    expect(commQ.head).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('AW360 B2-c.2 · getAwardProductDeep — consistency and date warnings', () => {
  it('scenario `product-deep-version-product-mismatch` emits PRODUCT_VERSION_MISMATCH', async () => {
    setResponses({
      bn_award: AWARD_ROW,
      bn_product: PRODUCT_ROW,
      bn_claim: { product_version_id: PV_ID },
      bn_product_version: versionRow({ product_id: 'p-OTHER' }),
      bn_product_formula_binding: [],
      bn_eligibility_rule: [],
      bn_approval_policy: [],
      bn_comm_mapping: [],
    });
    const v = await recorder.runAs('getAwardProductDeep', 'product-deep-version-product-mismatch', () =>
      getAwardProductDeep(A_ID, FULL_ACCESS),
    );
    expect(v).not.toBeNull();
    expect(v!.version.productMatchesAward).toBe(false);
    expect(v!.warnings.some((w) => w.key === 'PRODUCT_VERSION_MISMATCH')).toBe(true);
    expect(v!.identity.productId).toBe(P_ID);
  });

  it('scenario `product-deep-version-not-published` emits VERSION_NOT_PUBLISHED', async () => {
    setResponses({
      bn_award: AWARD_ROW,
      bn_product: PRODUCT_ROW,
      bn_claim: { product_version_id: PV_ID },
      bn_product_version: versionRow({ status: 'DRAFT' }),
      bn_product_formula_binding: [],
      bn_eligibility_rule: [],
      bn_approval_policy: [],
      bn_comm_mapping: [],
    });
    const v = await recorder.runAs('getAwardProductDeep', 'product-deep-version-not-published', () =>
      getAwardProductDeep(A_ID, FULL_ACCESS),
    );
    expect(v!.version.published).toBe(false);
    expect(v!.warnings.some((w) => w.key === 'VERSION_NOT_PUBLISHED')).toBe(true);
  });

  it('scenario `product-deep-award-outside-effective-period` emits OUTSIDE_EFFECTIVE', async () => {
    setResponses({
      bn_award: { ...AWARD_ROW, start_date: '2026-01-15' },
      bn_product: PRODUCT_ROW,
      bn_claim: { product_version_id: PV_ID },
      bn_product_version: versionRow(),
      bn_product_formula_binding: [],
      bn_eligibility_rule: [],
      bn_approval_policy: [],
      bn_comm_mapping: [],
    });
    const v = await recorder.runAs('getAwardProductDeep', 'product-deep-award-outside-effective-period', () =>
      getAwardProductDeep(A_ID, FULL_ACCESS),
    );
    expect(v!.version.awardWithinEffective).toBe(false);
    expect(v!.warnings.some((w) => w.key === 'OUTSIDE_EFFECTIVE')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('AW360 B2-c.2 · getAwardProductDeep — missing configuration semantics', () => {
  it('scenario `product-deep-missing-configuration` maps missing readiness exactly', async () => {
    setResponses({
      bn_award: AWARD_ROW,
      bn_product: PRODUCT_ROW,
      bn_claim: { product_version_id: PV_ID },
      bn_product_version: versionRow({
        formula_template_id: null,
        workflow_template_id: null,
        document_profile_id: null,
        screen_template_id: null,
        payment_frequency: null,
        life_certificate_policy: null,
        medical_review_policy: null,
        review_policy: null,
        survivor_beneficiary_policy: null,
      }),
      bn_product_formula_binding: [],
      bn_eligibility_rule: [],
      bn_approval_policy: [],
      bn_comm_mapping: [],
    });
    const v = await recorder.runAs('getAwardProductDeep', 'product-deep-missing-configuration', () =>
      getAwardProductDeep(A_ID, FULL_ACCESS),
    );
    expect(v).not.toBeNull();
    const byKey = new Map(v!.readiness.map((r) => [r.key, r.state]));
    expect(byKey.get('FORMULA')).toBe('MISSING');
    expect(byKey.get('ELIG')).toBe('MISSING');
    expect(byKey.get('WF')).toBe('MISSING');
    expect(byKey.get('APPROVAL')).toBe('MISSING');
    expect(byKey.get('DOC')).toBe('MISSING');
    expect(byKey.get('SCREEN')).toBe('MISSING');
    expect(byKey.get('PAY')).toBe('MISSING');
    expect(byKey.get('COMM')).toBe('MISSING');
    expect(byKey.get('LC')).toBe('NOT_APPLICABLE');
    expect(byKey.get('MR')).toBe('NOT_APPLICABLE');
    expect(byKey.get('SUSP')).toBe('NOT_APPLICABLE');
    expect(byKey.get('BEN')).toBe('NOT_APPLICABLE');
    const wkeys = new Set(v!.warnings.map((w) => w.key));
    for (const key of ['MISSING_FORMULA', 'MISSING_ELIG', 'MISSING_WF', 'MISSING_DOC', 'MISSING_PAY']) {
      expect(wkeys.has(key), `expected ${key} warning`).toBe(true);
    }
    expect(wkeys.has('INCOMPLETE_COMM')).toBe(false);
  });

  it('scenario `product-deep-formula-partial` — formula_template_id present with zero bindings yields PARTIAL', async () => {
    setResponses({
      bn_award: AWARD_ROW,
      bn_product: PRODUCT_ROW,
      bn_claim: { product_version_id: PV_ID },
      bn_product_version: versionRow({ formula_template_id: 'ft-1' }),
      bn_product_formula_binding: [],
      bn_eligibility_rule: [],
      bn_approval_policy: [],
      bn_comm_mapping: [],
    });
    const v = await recorder.runAs('getAwardProductDeep', 'product-deep-formula-partial', () =>
      getAwardProductDeep(A_ID, FULL_ACCESS),
    );
    const byKey = new Map(v!.readiness.map((r) => [r.key, r.state]));
    expect(byKey.get('FORMULA')).toBe('PARTIAL');
    // Distinguishes a successful zero-binding result from an unavailable
    // source: there is NO partialWarning entry for Formula binding here.
    expect(v!.partialWarnings.some((w) => w.startsWith('Formula binding'))).toBe(false);
  });

  it('scenario `product-deep-comm-partial` — 1–2 active comm mappings → PARTIAL + INCOMPLETE_COMM warning', async () => {
    setResponses({
      bn_award: AWARD_ROW,
      bn_product: PRODUCT_ROW,
      bn_claim: { product_version_id: PV_ID },
      bn_product_version: versionRow(),
      bn_product_formula_binding: [{ id: 'fb-1' }],
      bn_eligibility_rule: [{ id: 'er-1' }],
      bn_approval_policy: [{ id: 'ap-1' }],
      bn_comm_mapping: [{ id: 'cm-1' }, { id: 'cm-2' }],
    });
    const v = await recorder.runAs('getAwardProductDeep', 'product-deep-comm-partial', () =>
      getAwardProductDeep(A_ID, FULL_ACCESS),
    );
    const byKey = new Map(v!.readiness.map((r) => [r.key, r.state]));
    expect(byKey.get('COMM')).toBe('PARTIAL');
    expect(v!.warnings.some((w) => w.key === 'INCOMPLETE_COMM')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Optional-source failure certification — independent isolation matrix.
// Each scenario injects exactly ONE failure and proves the remaining
// readiness surface stays intact.
// ═════════════════════════════════════════════════════════════════════════
describe('AW360 B2-c.2 · getAwardProductDeep — optional-source failure isolation', () => {
  it('scenario `product-deep-claim-query-error` — bn_claim failure isolates to Product Version partial', async () => {
    setResponses(FULL_READY_RESPONSES());
    setScenarioErrors([{ table: 'bn_claim', error: { message: 'claim unavailable' } }]);
    const v = await recorder.runAs('getAwardProductDeep', 'product-deep-claim-query-error', () =>
      getAwardProductDeep(A_ID, FULL_ACCESS),
    );
    expect(v).not.toBeNull();
    expect(v!.identity.productId).toBe(P_ID);
    expect(v!.version.present).toBe(false);
    expect(v!.partialWarnings.some((w) => /Product version/i.test(w))).toBe(true);
    expect(v!.warnings.some((w) => w.key === 'MISSING_VERSION')).toBe(true);
    const tables = new Set(recorder.queries.map((q) => q.table));
    expect(tables.has('bn_product_version')).toBe(false);
    for (const t of ['bn_product_formula_binding', 'bn_eligibility_rule', 'bn_approval_policy', 'bn_comm_mapping']) {
      expect(tables.has(t), `${t} must not be queried when version is unresolved`).toBe(false);
    }
  });

  it('scenario `product-deep-version-query-error` — bn_product_version failure isolates to Product Version partial', async () => {
    setResponses(FULL_READY_RESPONSES());
    setScenarioErrors([{ table: 'bn_product_version', error: { message: 'version unavailable' } }]);
    const v = await recorder.runAs('getAwardProductDeep', 'product-deep-version-query-error', () =>
      getAwardProductDeep(A_ID, FULL_ACCESS),
    );
    expect(v).not.toBeNull();
    expect(v!.identity.productId).toBe(P_ID);
    expect(v!.version.present).toBe(false);
    expect(v!.partialWarnings.some((w) => /Product version/i.test(w))).toBe(true);
    expect(v!.warnings.some((w) => w.key === 'MISSING_VERSION')).toBe(true);
    // Claim query succeeded; configuration queries never issued.
    const tables = recorder.queries.map((q) => q.table);
    expect(tables).toContain('bn_claim');
    const set = new Set(tables);
    for (const t of ['bn_product_formula_binding', 'bn_eligibility_rule', 'bn_approval_policy', 'bn_comm_mapping']) {
      expect(set.has(t), `${t} must not be queried when version is unresolved`).toBe(false);
    }
  });

  it('scenario `product-deep-formula-binding-error` — Formula PARTIAL; neighbours unaffected', async () => {
    setResponses(FULL_READY_RESPONSES());
    setScenarioErrors([{ table: 'bn_product_formula_binding', error: { message: 'formula binding unavailable' } }]);
    const v = await recorder.runAs('getAwardProductDeep', 'product-deep-formula-binding-error', () =>
      getAwardProductDeep(A_ID, FULL_ACCESS),
    );
    expect(v).not.toBeNull();
    const byKey = new Map(v!.readiness.map((r) => [r.key, r.state]));
    // formula_template_id present → PARTIAL under source failure.
    expect(byKey.get('FORMULA')).toBe('PARTIAL');
    expect(v!.partialWarnings.some((w) => /Formula binding/i.test(w))).toBe(true);
    // Neighbouring configuration readiness rows retain their configured states.
    expect(byKey.get('ELIG')).toBe('READY');
    expect(byKey.get('APPROVAL')).toBe('READY');
    expect(byKey.get('COMM')).toBe('READY');
    expect(byKey.get('WF')).toBe('READY');
    expect(byKey.get('DOC')).toBe('READY');
    expect(byKey.get('PAY')).toBe('READY');
    // Distinguish source unavailability from successful zero-binding.
    // (Zero-binding produces PARTIAL without a Formula partialWarning.)
  });

  it('scenario `product-deep-eligibility-error` — Eligibility MISSING; scope, is_active, count, head still proven', async () => {
    setResponses(FULL_READY_RESPONSES());
    setScenarioErrors([{ table: 'bn_eligibility_rule', error: { message: 'eligibility unavailable' } }]);
    const v = await recorder.runAs('getAwardProductDeep', 'product-deep-eligibility-error', () =>
      getAwardProductDeep(A_ID, FULL_ACCESS),
    );
    expect(v).not.toBeNull();
    const byKey = new Map(v!.readiness.map((r) => [r.key, r.state]));
    expect(byKey.get('ELIG')).toBe('MISSING');
    expect(v!.partialWarnings.some((w) => /Eligibility rules/i.test(w))).toBe(true);
    expect(byKey.get('FORMULA')).toBe('READY');
    expect(byKey.get('APPROVAL')).toBe('READY');
    expect(byKey.get('COMM')).toBe('READY');
    const eligQ = recorder.queries.find((q) => q.table === 'bn_eligibility_rule')!;
    expect(eligQ.filters.some((f) => f.method === 'eq' && f.column === 'product_version_id' && f.value === PV_ID)).toBe(true);
    expect(eligQ.filters.some((f) => f.method === 'eq' && f.column === 'is_active' && f.value === true)).toBe(true);
    expect(eligQ.countMode).toBe('exact');
    expect(eligQ.head).toBe(true);
  });

  it('scenario `product-deep-approval-policy-error` — Approval MISSING; scope, is_enabled, count, head still proven', async () => {
    setResponses(FULL_READY_RESPONSES());
    setScenarioErrors([{ table: 'bn_approval_policy', error: { message: 'approval unavailable' } }]);
    const v = await recorder.runAs('getAwardProductDeep', 'product-deep-approval-policy-error', () =>
      getAwardProductDeep(A_ID, FULL_ACCESS),
    );
    expect(v).not.toBeNull();
    const byKey = new Map(v!.readiness.map((r) => [r.key, r.state]));
    expect(byKey.get('APPROVAL')).toBe('MISSING');
    expect(v!.partialWarnings.some((w) => /Approval policy/i.test(w))).toBe(true);
    expect(byKey.get('FORMULA')).toBe('READY');
    expect(byKey.get('ELIG')).toBe('READY');
    expect(byKey.get('COMM')).toBe('READY');
    const apQ = recorder.queries.find((q) => q.table === 'bn_approval_policy')!;
    expect(apQ.filters.some((f) => f.method === 'eq' && f.column === 'product_version_id' && f.value === PV_ID)).toBe(true);
    expect(apQ.filters.some((f) => f.method === 'eq' && f.column === 'is_enabled' && f.value === true)).toBe(true);
    expect(apQ.countMode).toBe('exact');
    expect(apQ.head).toBe(true);
  });

  it('scenario `product-deep-comm-mapping-error` — Communication MISSING; INCOMPLETE_COMM not emitted; scope, active, count, head still proven', async () => {
    setResponses(FULL_READY_RESPONSES());
    setScenarioErrors([{ table: 'bn_comm_mapping', error: { message: 'comm unavailable' } }]);
    const v = await recorder.runAs('getAwardProductDeep', 'product-deep-comm-mapping-error', () =>
      getAwardProductDeep(A_ID, FULL_ACCESS),
    );
    expect(v).not.toBeNull();
    const byKey = new Map(v!.readiness.map((r) => [r.key, r.state]));
    expect(byKey.get('COMM')).toBe('MISSING');
    expect(v!.partialWarnings.some((w) => /Communication mappings/i.test(w))).toBe(true);
    expect(v!.warnings.some((w) => w.key === 'INCOMPLETE_COMM')).toBe(false);
    expect(byKey.get('FORMULA')).toBe('READY');
    expect(byKey.get('ELIG')).toBe('READY');
    expect(byKey.get('APPROVAL')).toBe('READY');
    const commQ = recorder.queries.find((q) => q.table === 'bn_comm_mapping')!;
    expect(commQ.filters.some((f) => f.method === 'eq' && f.column === 'bn_product_version_id' && f.value === PV_ID)).toBe(true);
    expect(commQ.filters.some((f) => f.method === 'eq' && f.column === 'active' && f.value === true)).toBe(true);
    expect(commQ.countMode).toBe('exact');
    expect(commQ.head).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Contract-only negative guards — use a SEPARATE recorder (no evidence
// sink) and a non-certified `contract:getAwardProductDeep` tag so they
// never contaminate the certification evidence collector.
// ═════════════════════════════════════════════════════════════════════════
describe('AW360 B2-c.2 · getAwardProductDeep — scope / contract guards (negative)', () => {
  it('bn_claim scoped only by ssn fails under this loader (loader-specific eq(id) required)', async () => {
    const rec = new AwardQueryRecorder({ responses: { bn_claim: [] } });
    await expect(
      rec.runAs('getAwardProductDeep', 'neg-scope-ssn', async () => {
        await rec.client().from('bn_claim').select('id, ssn').eq('ssn', 'SSN-1');
      }),
    ).rejects.toThrow(/required scope/);
  });

  it('bn_eligibility_rule missing required product_version_id scope fails with loader/scenario diagnostic', async () => {
    const rec = new AwardQueryRecorder({ responses: { bn_eligibility_rule: [] } });
    let msg = '';
    try {
      await rec.runAs('getAwardProductDeep', 'neg-scope-elig-missing-pv', async () => {
        await rec.client()
          .from('bn_eligibility_rule')
          .select('id', { count: 'exact', head: true })
          .eq('id', 'rule-1'); // valid column, wrong scope
      });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('bn_eligibility_rule');
    expect(msg).toContain('getAwardProductDeep');
    expect(msg).toContain('neg-scope-elig-missing-pv');
    expect(msg).toContain('product_version_id');
    expect(msg).toContain('eq(id='); // actual filters trace
  });

  it('configuration query referencing an unapproved column fails', async () => {
    const rec = new AwardQueryRecorder();
    await expect(
      rec.runAs('getAwardProductDeep', 'neg-scope-unknown-col', async () => {
        await rec.client().from('bn_approval_policy')
          .select('id, nonexistent_column' as any)
          .eq('product_version_id', 'pv-1');
      }),
    ).rejects.toThrow(/unknown column/);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// B2-c.2 — Promotion + suite reconciliation.
// ═════════════════════════════════════════════════════════════════════════
describe('AW360 B2-c.2 · Product Deep promotion + suite reconciliation', () => {
  it('manifest promotes getAwardProductDeep (no pendingExecution) with 10 expected tables', async () => {
    const { AWARD360_LOADER_MANIFEST } = await import(
      '@/services/bn/awards/award360LoaderManifest'
    );
    const entry = AWARD360_LOADER_MANIFEST.find((e) => e.name === 'getAwardProductDeep')!;
    expect(entry.pendingExecution).not.toBe(true);
    expect([...(entry.expectedTables ?? [])].sort()).toEqual(
      [
        'bn_approval_policy',
        'bn_award',
        'bn_branch',
        'bn_claim',
        'bn_comm_mapping',
        'bn_eligibility_rule',
        'bn_product',
        'bn_product_formula_binding',
        'bn_product_version',
        'bn_scheme',
      ].sort(),
    );
    expect([...(entry.scenarioIds ?? [])].length).toBe(22);
  });

  it('registry entry has suiteId = product-deep-certification and 22 scenarios', async () => {
    const { AWARD360_CERTIFICATION_REGISTRY } = await import(
      '@/services/bn/awards/award360CertificationRegistry'
    );
    const cert = AWARD360_CERTIFICATION_REGISTRY.getAwardProductDeep;
    expect(cert).toBeTruthy();
    expect(cert.suiteId).toBe('product-deep-certification');
    expect(cert.scenarios).toHaveLength(22);
  });

  it('every certified loader belongs to exactly one recognised suite', async () => {
    await assertSuiteOwnershipIsPartitioned();
  });

  it('runtime evidence reconciles for the product-deep-certification suite', () => {
    // Only production-loader executions must appear in this collector —
    // the contract-only tests above used a separate recorder.
    for (const e of capturedExecutions) {
      expect(
        e.loaderName,
        `contract-only executions must not leak into the certification collector`,
      ).toBe('getAwardProductDeep');
    }
    assertLoaderCertificationEvidence({
      suiteId: 'product-deep-certification',
      capturedExecutions,
    });
  });

  it('observed table union for getAwardProductDeep equals all 10 expected tables', () => {
    const observed = new Set<string>();
    for (const e of capturedExecutions) {
      for (const t of e.tables) observed.add(t);
    }
    expect([...observed].sort()).toEqual(
      [
        'bn_approval_policy',
        'bn_award',
        'bn_branch',
        'bn_claim',
        'bn_comm_mapping',
        'bn_eligibility_rule',
        'bn_product',
        'bn_product_formula_binding',
        'bn_product_version',
        'bn_scheme',
      ].sort(),
    );
  });
});
