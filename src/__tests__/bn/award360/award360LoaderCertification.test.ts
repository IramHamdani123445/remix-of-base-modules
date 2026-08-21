/**
 * AW360-WAVE-1-C1 Slice B.1a — Executable loader certification.
 *
 * This test suite imports the REAL production Award 360 loaders and runs
 * them through the table-aware `AwardQueryRecorder`. Every recorded query
 * is validated against `AWARD360_SCHEMA_CONTRACT` — unknown columns,
 * missing scope, disallowed order columns, disallowed containment
 * operations, and unsupported query-builder verbs all fail here.
 *
 * Six checkpoint loaders are certified in this slice:
 *   • getAward360Header
 *   • getAwardClaim
 *   • getAwardProduct
 *   • listAwardCommunications
 *   • loadAwardAuditSources / listAwardAudit
 *   • getAward360Summary
 *
 * The remaining query loaders are enumerated in
 * `award360LoaderManifest.ts` with `pendingExecution: true` and will be
 * exercised in Slice B.1b.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AwardQueryRecorder,
  type RecordedScenarioExecution,
} from '@/test/mocks/award360QueryRecorder';
import {
  AWARD360_CERTIFICATION_REGISTRY,
  certifiedLoaderNames,
} from '@/services/bn/awards/award360CertificationRegistry';
import { AWARD360_LOADER_MANIFEST } from '@/services/bn/awards/award360LoaderManifest';

// B2-b.1b — module-level evidence sink. Every `runAs()` in this suite
// pushes its execution here; reconciliation asserts against it at the end.
const capturedExecutions: RecordedScenarioExecution[] = [];

// Hoisted holder so the vi.mock factory can reach the same recorder
// instance the test body operates on. Vitest hoists both `vi.hoisted`
// and `vi.mock` above ES imports; the recorder is therefore initialised
// before the production loader modules request the Supabase client.
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

// Initialised synchronously below (before any production import that
// destructures `supabase` at module top level).
holder.recorder = new AwardQueryRecorder({
  onExecutionComplete: (evidence) => capturedExecutions.push(evidence),
});
const recorder = holder.recorder;

// Import the real production loaders AFTER the mock is registered.
import {
  getAward360Header,
  getAwardPensioner,
  getAwardClaim,
  getAwardProduct,
  listAwardCommunications,
  loadAwardAuditSources,
  listAwardAudit,
} from '@/services/bn/awards/award360Service';
import { getAwardPensionerDeep, getAwardClaimDeep } from '@/services/bn/awards/award360DeepService';
import { getAward360Summary } from '@/services/bn/awards/award360SummaryService';

// ─── helpers ──────────────────────────────────────────────────────────────
function setResponses(map: Record<string, unknown>) {
  (recorder as any).opts.responses = map;
}
function setErrors(map: Record<string, { message: string; code?: string }>) {
  (recorder as any).opts.errors = map;
}

beforeEach(() => {
  recorder.reset();
  (recorder as any).opts.responses = {};
  (recorder as any).opts.errors = {};
  (recorder as any).opts.scenarioErrors = [];
  (recorder as any).opts.scenarioResponses = [];
});

// ─── getAward360Header ────────────────────────────────────────────────────
describe('AW360 Slice B.1a · getAward360Header', () => {
  it('scenario `header-with-ssn-claim-and-version` queries award → ip_master → bn_product → bn_claim → bn_product_version', async () => {
    setResponses({
      bn_award: {
        id: 'a-1',
        award_number: 'AW-1',
        ssn: 'SSN-1',
        benefit_code: 'B',
        award_type: 'RET',
        status: 'ACTIVE',
        base_amount: 100,
        currency: 'USD',
        frequency: 'MONTHLY',
        start_date: '2024-01-01',
        end_date: null,
        bn_claim_id: 'c-1',
        bn_product_id: 'p-1',
      },
      ip_master: { firstname: 'A', middle_name: 'B', surname: 'C' },
      bn_product: { benefit_name: 'Retirement', benefit_code: 'RET' },
      bn_claim: { product_version_id: 'pv-1' },
      bn_product_version: { version_number: 3 },
    });
    const h = await recorder.runAs('getAward360Header', 'header-with-ssn-claim-and-version', () =>
      getAward360Header('a-1'),
    );
    expect(h.payeeName).toBe('A B C');
    expect(h.benefitName).toBe('Retirement');
    expect(h.productVersion).toBe('3');
    expect(h.claimId).toBe('c-1');
    const tables = recorder.queries.map((q) => q.table);
    expect(tables).toEqual([
      'bn_award',
      'ip_master',
      'bn_product',
      'bn_claim',
      'bn_product_version',
    ]);
  });

  it('scenario `header-without-ssn` skips ip_master', async () => {
    setResponses({
      bn_award: { id: 'a-1', award_number: 'AW', ssn: null, bn_claim_id: null, bn_product_id: null },
    });
    await recorder.runAs('getAward360Header', 'header-without-ssn', () => getAward360Header('a-1'));
    expect(recorder.queries.map((q) => q.table)).toEqual(['bn_award']);
  });

  it('scenario `header-without-claim` skips bn_claim + bn_product_version', async () => {
    setResponses({
      bn_award: {
        id: 'a-1', award_number: 'AW', ssn: 'S', bn_claim_id: null, bn_product_id: 'p-1',
      },
      ip_master: { firstname: 'A', middle_name: null, surname: 'C' },
      bn_product: { benefit_name: 'R', benefit_code: null },
    });
    await recorder.runAs('getAward360Header', 'header-without-claim', () => getAward360Header('a-1'));
    const tables = recorder.queries.map((q) => q.table);
    expect(tables).toContain('ip_master');
    expect(tables).toContain('bn_product');
    expect(tables).not.toContain('bn_claim');
    expect(tables).not.toContain('bn_product_version');
  });

  it('scenario `header-with-claim-no-version` skips bn_product_version', async () => {
    setResponses({
      bn_award: {
        id: 'a-1', award_number: 'AW', ssn: null, bn_claim_id: 'c-1', bn_product_id: null,
      },
      bn_claim: { product_version_id: null },
    });
    await recorder.runAs('getAward360Header', 'header-with-claim-no-version', () =>
      getAward360Header('a-1'),
    );
    const tables = recorder.queries.map((q) => q.table);
    expect(tables).toContain('bn_claim');
    expect(tables).not.toContain('bn_product_version');
  });
});

// ─── getAwardClaim ────────────────────────────────────────────────────────
describe('AW360 Slice B.1a · getAwardClaim', () => {
  it('scenario `claim-linked` reads bn_award then bn_claim scoped by claim id', async () => {
    setResponses({
      bn_award: { bn_claim_id: 'c-1' },
      bn_claim: {
        id: 'c-1', claim_number: 'CL-1', status: 'DECIDED', product_version_id: 'pv-1',
        submission_date: null, claim_date: null, application_channel: null, priority: null,
        assigned_to: 'user-1', decision_date: null,
      },
    });
    const c = await recorder.runAs('getAwardClaim', 'claim-linked', () => getAwardClaim('a-1'));
    expect(c?.claimId).toBe('c-1');
    expect(c?.assignedOfficer).toBe('user-1');
    const q = recorder.queriesFor('getAwardClaim');
    expect(q.map((r) => r.table)).toEqual(['bn_award', 'bn_claim']);
    expect(q[1].filters.some((f) => f.method === 'eq' && f.column === 'id' && f.value === 'c-1')).toBe(true);
  });

  it('scenario `claim-not-linked` returns null and skips bn_claim', async () => {
    setResponses({ bn_award: { bn_claim_id: null } });
    const c = await recorder.runAs('getAwardClaim', 'claim-not-linked', () => getAwardClaim('a-1'));
    expect(c).toBeNull();
    expect(recorder.queries.map((q) => q.table)).toEqual(['bn_award']);
  });

  it('scenario `claim-missing` returns null when bn_claim row absent', async () => {
    setResponses({ bn_award: { bn_claim_id: 'c-1' }, bn_claim: null });
    const c = await recorder.runAs('getAwardClaim', 'claim-missing', () => getAwardClaim('a-1'));
    expect(c).toBeNull();
  });
});

// ─── getAwardProduct ──────────────────────────────────────────────────────
describe('AW360 Slice B.1a · getAwardProduct', () => {
  it('scenario `product-with-version` reads bn_award → bn_product → bn_scheme → bn_branch → bn_claim → bn_product_version', async () => {
    setResponses({
      bn_award: { bn_product_id: 'p-1', bn_claim_id: 'c-1' },
      bn_product: {
        id: 'p-1', benefit_code: 'RET', benefit_name: 'Retirement',
        scheme_id: 'sch', branch_id: 'br', category: 'cat', branch: null,
        payment_type: 'PT', status: 'ACTIVE', country_code: 'US',
      },
      // BUG-011 — scheme_id/branch_id are resolved to readable names.
      bn_scheme: { scheme_name: 'Short-Term Benefits' },
      bn_branch: { branch_name: 'Main Branch' },
      bn_claim: { product_version_id: 'pv-1' },
      bn_product_version: {
        id: 'pv-1', version_number: 2, status: 'ACTIVE',
        effective_from: '2024-01-01', effective_to: null,
        benefit_duration_type: 'LIFETIME',
      },
    });
    const p = await recorder.runAs('getAwardProduct', 'product-with-version', () =>
      getAwardProduct('a-1'),
    );
    expect(p?.versionNumber).toBe('2');
    expect(p?.benefitDurationType).toBe('LIFETIME');
    expect(p?.scheme).toBe('Short-Term Benefits');
    expect(p?.branch).toBe('Main Branch');
    expect(recorder.queries.map((q) => q.table)).toEqual([
      'bn_award', 'bn_product', 'bn_scheme', 'bn_branch', 'bn_claim', 'bn_product_version',
    ]);
  });

  it('scenario `product-without-claim` skips bn_claim + bn_product_version', async () => {
    setResponses({
      bn_award: { bn_product_id: 'p-1', bn_claim_id: null },
      bn_product: { id: 'p-1', benefit_code: 'C', benefit_name: 'N' },
    });
    await recorder.runAs('getAwardProduct', 'product-without-claim', () => getAwardProduct('a-1'));
    const tables = recorder.queries.map((q) => q.table);
    expect(tables).toEqual(['bn_award', 'bn_product']);
  });

  it('scenario `product-with-claim-no-version` skips bn_product_version', async () => {
    setResponses({
      bn_award: { bn_product_id: 'p-1', bn_claim_id: 'c-1' },
      bn_product: { id: 'p-1', benefit_code: 'C', benefit_name: 'N' },
      bn_claim: { product_version_id: null },
    });
    await recorder.runAs('getAwardProduct', 'product-with-claim-no-version', () =>
      getAwardProduct('a-1'),
    );
    const tables = recorder.queries.map((q) => q.table);
    expect(tables).toEqual(['bn_award', 'bn_product', 'bn_claim']);
  });

  it('scenario `product-missing` returns null when no product id on award', async () => {
    setResponses({ bn_award: { bn_product_id: null, bn_claim_id: null } });
    const p = await recorder.runAs('getAwardProduct', 'product-missing', () => getAwardProduct('a-1'));
    expect(p).toBeNull();
  });
});

// ─── listAwardCommunications ──────────────────────────────────────────────
describe('AW360 Slice B.1a · listAwardCommunications', () => {
  it('scenario `comm-claim-and-context` issues both claim_id and context queries', async () => {
    setResponses({
      bn_award: { bn_claim_id: 'c-1' },
      bn_communication_log: [
        { id: 'x1', event_code: 'E', channel: 'EMAIL', created_at: '2026-01-01' },
      ],
    });
    const list = await recorder.runAs('listAwardCommunications', 'comm-claim-and-context', () =>
      listAwardCommunications('a-1'),
    );
    expect(list).toHaveLength(1);
    const logs = recorder.queries.filter((q) => q.table === 'bn_communication_log');
    expect(logs.length).toBe(2);
    // one query uses eq(claim_id), one uses contains(context)
    expect(logs.some((l) => l.filters.some((f) => f.method === 'eq' && f.column === 'claim_id'))).toBe(true);
    expect(logs.some((l) => l.filters.some((f) => f.method === 'contains' && f.column === 'context'))).toBe(true);
    // both are scoped, contract enforces anyOf → no throw
  });

  it('scenario `comm-context-only` runs a single contains query when award has no claim', async () => {
    setResponses({ bn_award: { bn_claim_id: null }, bn_communication_log: [] });
    await recorder.runAs('listAwardCommunications', 'comm-context-only', () =>
      listAwardCommunications('a-1'),
    );
    const logs = recorder.queries.filter((q) => q.table === 'bn_communication_log');
    expect(logs.length).toBe(1);
    expect(logs[0].filters[0]).toMatchObject({ method: 'contains', column: 'context' });
  });

  it('scenario `comm-empty` returns [] and still runs the context query', async () => {
    setResponses({ bn_award: { bn_claim_id: null }, bn_communication_log: [] });
    const list = await recorder.runAs('listAwardCommunications', 'comm-empty', () =>
      listAwardCommunications('a-1'),
    );
    expect(list).toEqual([]);
  });

  it('scenario `comm-query-error` — table error is isolated (loader still resolves)', async () => {
    setResponses({ bn_award: { bn_claim_id: 'c-1' } });
    setErrors({ bn_communication_log: { message: 'boom' } });
    const list = await recorder.runAs('listAwardCommunications', 'comm-query-error', () =>
      listAwardCommunications('a-1'),
    );
    // Promise.allSettled swallows the error → empty list, no throw.
    expect(list).toEqual([]);
  });
});

// ─── loadAwardAuditSources / listAwardAudit ───────────────────────────────
describe('AW360 Slice B.1a · loadAwardAuditSources', () => {
  it('scenario `audit-without-central` never queries core_audit_log', async () => {
    setResponses({
      bn_award_status_event: [],
      bn_award_rate_history: [],
      bn_award_suspension_event: [],
    });
    const res = await recorder.runAs('loadAwardAuditSources', 'audit-without-central', () =>
      loadAwardAuditSources('a-1', { includeCentralAudit: false }),
    );
    expect(res.items).toEqual([]);
    const tables = recorder.queries.map((q) => q.table);
    expect(tables).toContain('bn_award_status_event');
    expect(tables).toContain('bn_award_rate_history');
    expect(tables).toContain('bn_award_suspension_event');
    expect(tables).not.toContain('core_audit_log');
    // 'central' section should report restricted
    expect(res.sources.find((s) => s.key === 'central')?.restricted).toBe(true);
  });

  it('scenario `audit-with-central` uses composite entity_type=bn_award scope', async () => {
    setResponses({
      bn_award_status_event: [],
      bn_award_rate_history: [],
      bn_award_suspension_event: [],
      core_audit_log: [
        { id: 'a1', event_time: '2026-01-01', action: 'UPDATE', entity_type: 'bn_award', entity_id: 'a-1' },
      ],
    });
    await recorder.runAs('loadAwardAuditSources', 'audit-with-central', () =>
      loadAwardAuditSources('a-1', { includeCentralAudit: true }),
    );
    const central = recorder.queries.find((q) => q.table === 'core_audit_log');
    expect(central).toBeDefined();
    // Composite scope: entity_type=bn_award AND entity_id=a-1
    expect(
      central!.filters.some((f) => f.column === 'entity_type' && f.value === 'bn_award'),
    ).toBe(true);
    expect(central!.filters.some((f) => f.column === 'entity_id' && f.value === 'a-1')).toBe(true);
  });

  it('composite scope: filtering only on entity_id is NOT sufficient (contract enforcement)', async () => {
    // The recorder rejects a completed core_audit_log query that omits
    // entity_type='bn_award'. Prove it independently of the loader.
    const rec = new AwardQueryRecorder({ responses: { core_audit_log: [] } });
    await expect(async () => {
      await rec.client().from('core_audit_log').select('id').eq('entity_id', 'a-1');
    }).rejects.toThrow(/required scope.*entity_type.*bn_award/);
  });

  it('composite scope: wrong fixed value (entity_type=bn_claim) fails', async () => {
    const rec = new AwardQueryRecorder({ responses: { core_audit_log: [] } });
    await expect(async () => {
      await rec
        .client()
        .from('core_audit_log')
        .select('id')
        .eq('entity_type', 'bn_claim')
        .eq('entity_id', 'a-1');
    }).rejects.toThrow(/required scope/);
  });

  it('scenario `audit-source-failure` isolates a failing source', async () => {
    setResponses({ bn_award_status_event: [], bn_award_rate_history: [], bn_award_suspension_event: [] });
    setErrors({ bn_award_rate_history: { message: 'boom' } });
    const res = await recorder.runAs('loadAwardAuditSources', 'audit-source-failure', () =>
      loadAwardAuditSources('a-1', { includeCentralAudit: false }),
    );
    expect(res.warnings.some((w) => w.includes('Rate history unavailable'))).toBe(true);
    expect(res.items).toEqual([]); // other sources succeeded but empty
  });

  it('listAwardAudit (compat wrapper) executes the same three sources without central', async () => {
    setResponses({ bn_award_status_event: [], bn_award_rate_history: [], bn_award_suspension_event: [] });
    await recorder.runAs('listAwardAudit', 'audit-flat-without-central', () =>
      listAwardAudit('a-1'),
    );
    const tables = new Set(recorder.queries.map((q) => q.table));
    expect(tables.has('core_audit_log')).toBe(false);
  });
});

// ─── getAward360Summary ───────────────────────────────────────────────────
describe('AW360 Slice B.1a · getAward360Summary', () => {
  it('scenario `summary-all-restricted` issues no queries when every include flag is false', async () => {
    const s = await recorder.runAs('getAward360Summary', 'summary-all-restricted', () =>
      getAward360Summary('a-1', {}),
    );
    expect(recorder.queries).toHaveLength(0);
    expect(s.beneficiaries.status).toBe('restricted');
    expect(s.schedule.status).toBe('restricted');
    expect(s.payments.status).toBe('restricted');
    expect(s.lifeCertificates.status).toBe('restricted');
    expect(s.medical.status).toBe('restricted');
    expect(s.suspensions.status).toBe('restricted');
    expect(s.overpayments.status).toBe('restricted');
    expect(s.communications.status).toBe('restricted');
    expect(s.pensionerAlert.status).toBe('restricted');
  });

  it('scenario `summary-all-includes` queries every operational table with contract-approved columns', async () => {
    setResponses({
      bn_award_beneficiary: [],
      bn_payment_schedule: [],
      bn_payment_instruction: [],
      bn_life_certificate: [],
      bn_medical_review_schedule: [],
      bn_award_suspension_event: [],
      bn_overpayment: [],
      bn_award: { bn_claim_id: 'c-1', ssn: 'S1' },
      bn_communication_log: [],
      ip_master: { status: 'ACTIVE' },
      bn_payment_profile: [],
    });
    await recorder.runAs('getAward360Summary', 'summary-all-includes', () =>
      getAward360Summary('a-1', {
        includeBeneficiaries: true,
        includeSchedule: true,
        includePayments: true,
        includeLifeCertificates: true,
        includeMedical: true,
        includeSuspensions: true,
        includeOverpayments: true,
        includeCommunications: true,
        includePensionerAlert: true,
        canViewPerson360: true,
        canViewPaymentProfile: true,
      }),
    );
    const tables = new Set(recorder.queries.map((q) => q.table));
    for (const t of [
      'bn_award_beneficiary', 'bn_payment_schedule', 'bn_payment_instruction',
      'bn_life_certificate', 'bn_medical_review_schedule', 'bn_award_suspension_event',
      'bn_overpayment', 'bn_communication_log', 'ip_master', 'bn_payment_profile',
    ]) {
      expect(tables.has(t), `${t} was not queried`).toBe(true);
    }
  });

  it('scenario `summary-medical-error` isolates a failing medical source', async () => {
    setErrors({ bn_medical_review_schedule: { message: 'medical unavailable' } });
    const s = await recorder.runAs('getAward360Summary', 'summary-medical-error', () =>
      getAward360Summary('a-1', { includeMedical: true }),
    );
    expect(s.medical.status).toBe('unavailable');
    expect(s.warnings.some((w) => w.includes('Medical review summary unavailable'))).toBe(true);
  });

  it('scenario `summary-communications-error` isolates a failing communications source', async () => {
    setResponses({ bn_award: { bn_claim_id: null } });
    setErrors({ bn_communication_log: { message: 'comm down' } });
    const s = await recorder.runAs('getAward360Summary', 'summary-communications-error', () =>
      getAward360Summary('a-1', { includeCommunications: true }),
    );
    expect(s.communications.status).toBe('unavailable');
  });

  it('scenario `summary-pensioner-alert-restricted` skips ip_master when permission absent', async () => {
    await recorder.runAs('getAward360Summary', 'summary-pensioner-alert-restricted', () =>
      getAward360Summary('a-1', {
        includePensionerAlert: true,
        canViewPerson360: false,
        canViewPaymentProfile: false,
      }),
    );
    const tables = recorder.queries.map((q) => q.table);
    expect(tables).not.toContain('ip_master');
    expect(tables).not.toContain('bn_payment_profile');
  });
});

// ─── Sub-batch B2-a · getAwardPensioner ───────────────────────────────────
describe('AW360 Sub-batch B2-a · getAwardPensioner', () => {
  it('scenario `pensioner-with-person` queries bn_award → ip_master and maps canonical contact fallbacks', async () => {
    setResponses({
      bn_award: { ssn: 'SSN-1' },
      ip_master: {
        ssn: 'SSN-1', firstname: 'A', middle_name: 'B', surname: 'C',
        dob: '1960-05-10', sex: 'M', nationality: 'KN', status: 'A',
        place_of_residence: 'St. Kitts',
        phone: null, telephone: '+1-869-000', phone_mobile: null,
        mobile: '+1-869-111', contact_phone: null, contact_mobile: null,
        email_addr: null, contact_email: 'p@example.com',
        resident_addr1: 'R1', resident_addr2: null,
        mail_addr1: 'M1', mail_addr2: null,
      },
    });
    const r = await recorder.runAs('getAwardPensioner', 'pensioner-with-person', () =>
      getAwardPensioner('a-1'),
    );
    expect(r?.fullName).toBe('A B C');
    expect(r?.phone).toBe('+1-869-000');   // telephone fallback
    expect(r?.mobile).toBe('+1-869-111');  // mobile fallback
    expect(r?.email).toBe('p@example.com'); // contact_email fallback
    expect(r?.isDeceased).toBe(false);
    const tables = new Set(recorder.queries.map((q) => q.table));
    expect(tables.has('bn_award')).toBe(true);
    expect(tables.has('ip_master')).toBe(true);
  });

  it('scenario `pensioner-award-without-ssn` short-circuits before ip_master', async () => {
    setResponses({ bn_award: { ssn: null } });
    const r = await recorder.runAs('getAwardPensioner', 'pensioner-award-without-ssn', () =>
      getAwardPensioner('a-1'),
    );
    expect(r).toBeNull();
    expect(recorder.queries.map((q) => q.table)).toEqual(['bn_award']);
  });

  it('scenario `pensioner-person-missing` returns null when ip_master row absent', async () => {
    setResponses({ bn_award: { ssn: 'SSN-1' }, ip_master: null });
    const r = await recorder.runAs('getAwardPensioner', 'pensioner-person-missing', () =>
      getAwardPensioner('a-1'),
    );
    expect(r).toBeNull();
  });

  it('scenario `pensioner-award-query-error` throws when bn_award lookup fails', async () => {
    setErrors({ bn_award: { message: 'award unavailable' } });
    await expect(
      recorder.runAs('getAwardPensioner', 'pensioner-award-query-error', () =>
        getAwardPensioner('a-1'),
      ),
    ).rejects.toMatchObject({ message: 'award unavailable' });
  });

  it('scenario `pensioner-person-query-error` throws when ip_master lookup fails', async () => {
    setResponses({ bn_award: { ssn: 'SSN-1' } });
    setErrors({ ip_master: { message: 'person unavailable' } });
    await expect(
      recorder.runAs('getAwardPensioner', 'pensioner-person-query-error', () =>
        getAwardPensioner('a-1'),
      ),
    ).rejects.toMatchObject({ message: 'person unavailable' });
  });

  it('scenario `pensioner-deceased` flags deceased on canonical status', async () => {
    setResponses({
      bn_award: { ssn: 'SSN-1' },
      ip_master: { ssn: 'SSN-1', firstname: 'X', surname: 'Y', status: 'DECEASED' },
    });
    const r = await recorder.runAs('getAwardPensioner', 'pensioner-deceased', () =>
      getAwardPensioner('a-1'),
    );
    expect(r?.isDeceased).toBe(true);
  });

  it('scenario `pensioner-active-status` does not flag deceased for active persons', async () => {
    setResponses({
      bn_award: { ssn: 'SSN-1' },
      ip_master: { ssn: 'SSN-1', firstname: 'X', surname: 'Y', status: 'A' },
    });
    const r = await recorder.runAs('getAwardPensioner', 'pensioner-active-status', () =>
      getAwardPensioner('a-1'),
    );
    expect(r?.isDeceased).toBe(false);
  });

  it('scenario `pensioner-contact-fallbacks` prefers primary fields over legacy fallbacks', async () => {
    setResponses({
      bn_award: { ssn: 'SSN-1' },
      ip_master: {
        ssn: 'SSN-1', firstname: 'X', surname: 'Y', status: 'A',
        phone: '+PRIMARY', telephone: '+LEGACY',
        phone_mobile: '+MOB-PRIMARY', mobile: '+MOB-LEGACY',
        email_addr: 'primary@e', contact_email: 'legacy@e',
      },
    });
    const r = await recorder.runAs('getAwardPensioner', 'pensioner-contact-fallbacks', () =>
      getAwardPensioner('a-1'),
    );
    expect(r?.phone).toBe('+PRIMARY');
    expect(r?.mobile).toBe('+MOB-PRIMARY');
    expect(r?.email).toBe('primary@e');
  });
});

// ─── Sub-batch B2-a · getAwardPensionerDeep ───────────────────────────────
describe('AW360 Sub-batch B2-a · getAwardPensionerDeep', () => {
  const FULL_ACCESS = { canViewPaymentProfile: true, canViewPerson360: true };

  it('scenario `deep-full-access` queries every canonical table with correct scope', async () => {
    setResponses({
      bn_award: { id: 'a-1', ssn: 'SSN-1', status: 'ACTIVE', award_number: 'AW-1', start_date: null, end_date: null },
      ip_master: { ssn: 'SSN-1', firstname: 'A', surname: 'B', status: 'A',
        place_of_residence: 'St. Kitts', dob: '1960-01-01' },
      bn_payment_profile: {
        id: 'pp-1', payment_method: 'BANK', payment_currency: 'XCD',
        bank_name: 'RBC', bank_code: 'RBC01', account_number_masked: '••••1234',
        verification_status: 'VERIFIED', verified_at: '2024-01-01',
        effective_from: '2024-01-01', effective_to: null, active: true,
      },
      bn_payment_profile_change_request: null,
      bn_claim: [{ id: 'c-1', claim_number: 'CL-1', status: 'APPROVED' }],
      ip_depend: [{ firstname: 'K', surname: 'B', relation: 'CHILD', status: 'A' }],
    });
    const r = await recorder.runAs('getAwardPensionerDeep', 'deep-full-access', () =>
      getAwardPensionerDeep('a-1', FULL_ACCESS),
    );
    expect(r?.identity.residencyStatus).toBe('St. Kitts');
    expect(r?.identity.canonicalPersonId).toBe('SSN-1');
    expect(r?.paymentProfile.present).toBe(true);
    expect(r?.paymentProfile.currency).toBe('XCD');
    expect(r?.paymentProfile.accountMasked).toBe('••••1234');
    expect(r?.paymentProfile.effectiveDate).toBe('2024-01-01');
    expect(r?.related.dependants).toHaveLength(1);
    expect(r?.related.relatedClaims[0]?.id).toBe('c-1');
    expect(r?.routes.person360).toContain('/bn/person-360');
    const tables = new Set(recorder.queries.map((q) => q.table));
    for (const t of ['bn_award', 'ip_master', 'bn_payment_profile',
      'bn_payment_profile_change_request', 'bn_claim', 'ip_depend']) {
      expect(tables.has(t), `${t} was not queried`).toBe(true);
    }
  });

  it('scenario `deep-payment-profile-restricted` skips payment-profile queries', async () => {
    setResponses({
      bn_award: { id: 'a-1', ssn: 'SSN-1', status: 'ACTIVE' },
      ip_master: { ssn: 'SSN-1', firstname: 'A', surname: 'B', status: 'A' },
    });
    const r = await recorder.runAs('getAwardPensionerDeep', 'deep-payment-profile-restricted', () =>
      getAwardPensionerDeep('a-1', { canViewPaymentProfile: false, canViewPerson360: true }),
    );
    expect(r?.paymentProfile.restricted).toBe(true);
    const tables = recorder.queries.map((q) => q.table);
    expect(tables).not.toContain('bn_payment_profile');
    expect(tables).not.toContain('bn_payment_profile_change_request');
  });

  it('scenario `deep-person360-restricted` nulls person-360 route and canonicalPersonId', async () => {
    setResponses({
      bn_award: { id: 'a-1', ssn: 'SSN-1', status: 'ACTIVE' },
      ip_master: { ssn: 'SSN-1', firstname: 'A', surname: 'B', status: 'A' },
    });
    const r = await recorder.runAs('getAwardPensionerDeep', 'deep-person360-restricted', () =>
      getAwardPensionerDeep('a-1', { canViewPaymentProfile: true, canViewPerson360: false }),
    );
    expect(r?.identity.canonicalPersonId).toBeNull();
    expect(r?.routes.person360).toBeNull();
    expect(r?.routes.personProfile).toBeNull();
  });

  it('scenario `deep-award-not-found` returns null before any ip_master query', async () => {
    setResponses({ bn_award: { ssn: null } });
    const r = await recorder.runAs('getAwardPensionerDeep', 'deep-award-not-found', () =>
      getAwardPensionerDeep('a-1', FULL_ACCESS),
    );
    expect(r).toBeNull();
    expect(recorder.queries.map((q) => q.table)).toEqual(['bn_award']);
  });

  it('scenario `deep-person-missing` records a PENSIONER_MISSING warning', async () => {
    setResponses({ bn_award: { id: 'a-1', ssn: 'SSN-1', status: 'ACTIVE' }, ip_master: null });
    const r = await recorder.runAs('getAwardPensionerDeep', 'deep-person-missing', () =>
      getAwardPensionerDeep('a-1', FULL_ACCESS),
    );
    expect(r?.warnings.some((w) => w.key === 'PENSIONER_MISSING')).toBe(true);
  });

  // NOTE: `deep-empty-related` was removed in Sub-batch B2-b.3b — the
  // scenario injected an error into the second `bn_award` query, so it is
  // already covered by `deep-related-awards-error` and cannot honestly
  // describe an "empty-success" path.



  it('scenario `deep-payment-profile-error` isolates payment-profile failure to partialWarnings', async () => {
    setResponses({
      bn_award: { id: 'a-1', ssn: 'SSN-1', status: 'ACTIVE' },
      ip_master: { ssn: 'SSN-1', firstname: 'A', surname: 'B', status: 'A' },
    });
    setErrors({ bn_payment_profile: { message: 'profile unavailable' } });
    const r = await recorder.runAs('getAwardPensionerDeep', 'deep-payment-profile-error', () =>
      getAwardPensionerDeep('a-1', FULL_ACCESS),
    );
    expect(r?.partialWarnings.some((w) => w.includes('Payment profile'))).toBe(true);
    expect(r?.paymentProfile.present).toBe(false);
  });

  it('scenario `deep-related-claims-error` isolates related-claims failure', async () => {
    setResponses({
      bn_award: { id: 'a-1', ssn: 'SSN-1', status: 'ACTIVE' },
      ip_master: { ssn: 'SSN-1', firstname: 'A', surname: 'B', status: 'A' },
    });
    setErrors({ bn_claim: { message: 'claims unavailable' } });
    const r = await recorder.runAs('getAwardPensionerDeep', 'deep-related-claims-error', () =>
      getAwardPensionerDeep('a-1', FULL_ACCESS),
    );
    expect(r?.partialWarnings.some((w) => w.includes('Related claims'))).toBe(true);
    expect(r?.related.relatedClaims).toEqual([]);
  });

  it('scenario `deep-pending-change-only` surfaces a pending change request without a live profile', async () => {
    setResponses({
      bn_award: { id: 'a-1', ssn: 'SSN-1', status: 'ACTIVE' },
      ip_master: { ssn: 'SSN-1', firstname: 'A', surname: 'B', status: 'A' },
      bn_payment_profile: null,
      bn_payment_profile_change_request: { id: 'cr-1', status: 'PENDING', created_at: '2024-06-01' },
    });
    const r = await recorder.runAs('getAwardPensionerDeep', 'deep-pending-change-only', () =>
      getAwardPensionerDeep('a-1', FULL_ACCESS),
    );
    expect(r?.paymentProfile.present).toBe(false);
    expect(r?.paymentProfile.pendingChangeRequest?.id).toBe('cr-1');
  });

  // ─── Sub-batch B2-b.2 · Primary & optional-source failure scenarios ────
  it('scenario `deep-person-query-error` rejects — no optional-source substitution', async () => {
    setResponses({ bn_award: { id: 'a-1', ssn: 'SSN-1', status: 'ACTIVE' } });
    setErrors({ ip_master: { message: 'person unavailable' } });
    await expect(
      recorder.runAs('getAwardPensionerDeep', 'deep-person-query-error', () =>
        getAwardPensionerDeep('a-1', FULL_ACCESS),
      ),
    ).rejects.toMatchObject({ message: 'person unavailable' });
    // Tables reached before rejection are honestly captured.
    const tables = recorder.queries.map((q) => q.table);
    expect(tables).toEqual(['bn_award', 'ip_master']);
    // Evidence records this scenario as rejected.
    const evs = capturedExecutions.filter(
      (e) => e.loaderName === 'getAwardPensionerDeep' && e.scenarioId === 'deep-person-query-error',
    );
    expect(evs.length).toBeGreaterThan(0);
    expect(evs.every((e) => e.outcome === 'rejected')).toBe(true);
  });

  it('scenario `deep-dependants-error` isolates dependants failure — identity + profile + claims + related awards preserved', async () => {
    setResponses({
      bn_award: { id: 'a-1', ssn: 'SSN-1', status: 'ACTIVE' },
      ip_master: { ssn: 'SSN-1', firstname: 'A', surname: 'B', status: 'A',
        place_of_residence: 'St. Kitts' },
      bn_payment_profile: {
        id: 'pp-1', payment_method: 'BANK', payment_currency: 'XCD',
        bank_name: 'RBC', account_number_masked: '••••1',
        verification_status: 'VERIFIED', effective_from: '2024-01-01', active: true,
      },
      bn_payment_profile_change_request: null,
      bn_claim: [{ id: 'c-9', claim_number: 'CL-9', status: 'APPROVED' }],
    });
    setErrors({ ip_depend: { message: 'dependants unavailable' } });
    const r = await recorder.runAs('getAwardPensionerDeep', 'deep-dependants-error', () =>
      getAwardPensionerDeep('a-1', FULL_ACCESS),
    );
    expect(r?.identity.canonicalPersonId).toBe('SSN-1');
    expect(r?.paymentProfile.present).toBe(true);
    expect(r?.related.relatedClaims).toHaveLength(1);
    expect(r?.related.relatedAwards.length).toBeGreaterThanOrEqual(0);
    expect(r?.related.dependants).toEqual([]);
    expect(r?.partialWarnings.some((w) => w.includes('Dependants'))).toBe(true);
  });

  it('scenario `deep-change-request-error` isolates change-request failure — valid payment profile preserved', async () => {
    setResponses({
      bn_award: { id: 'a-1', ssn: 'SSN-1', status: 'ACTIVE' },
      ip_master: { ssn: 'SSN-1', firstname: 'A', surname: 'B', status: 'A' },
      bn_payment_profile: {
        id: 'pp-1', payment_method: 'BANK', payment_currency: 'XCD',
        bank_name: 'RBC', account_number_masked: '••••4321',
        verification_status: 'VERIFIED', effective_from: '2024-01-01', active: true,
      },
    });
    setErrors({ bn_payment_profile_change_request: { message: 'cr unavailable' } });
    const r = await recorder.runAs('getAwardPensionerDeep', 'deep-change-request-error', () =>
      getAwardPensionerDeep('a-1', FULL_ACCESS),
    );
    expect(r?.paymentProfile.present).toBe(true);
    expect(r?.paymentProfile.accountMasked).toBe('••••4321');
    expect(r?.paymentProfile.pendingChangeRequest).toBeNull();
    expect(r?.partialWarnings.some((w) => w.includes('change request'))).toBe(true);
  });

  it('scenario `deep-related-awards-error` — occurrence-2 bn_award failure leaves primary award intact', async () => {
    setResponses({
      bn_award: { id: 'a-1', ssn: 'SSN-1', status: 'ACTIVE', award_number: 'AW-1' },
      ip_master: { ssn: 'SSN-1', firstname: 'A', surname: 'B', status: 'A' },
      bn_payment_profile: null,
      bn_payment_profile_change_request: null,
      bn_claim: [{ id: 'c-1', claim_number: 'CL-1', status: 'APPROVED' }],
      ip_depend: [{ firstname: 'K', surname: 'B', relation: 'CHILD', status: 'A' }],
    });
    (recorder as any).opts.scenarioErrors = [{
      loaderName: 'getAwardPensionerDeep',
      scenarioId: 'deep-related-awards-error',
      table: 'bn_award', occurrence: 2,
      error: { code: 'REL', message: 'related awards unavailable' },
    }];
    const r = await recorder.runAs('getAwardPensionerDeep', 'deep-related-awards-error', () =>
      getAwardPensionerDeep('a-1', FULL_ACCESS),
    );
    // Primary Award (occurrence 1) succeeded.
    expect(r).not.toBeNull();
    expect(r?.identity.canonicalPersonId).toBe('SSN-1');
    expect(r?.related.relatedAwards).toEqual([]);
    expect(r?.related.relatedClaims).toHaveLength(1);
    expect(r?.related.dependants).toHaveLength(1);
    expect(r?.partialWarnings.some((w) => w.includes('Related awards'))).toBe(true);
    // Two bn_award queries were issued in this run.
    const bnAwardQueries = recorder.queries.filter((q) => q.table === 'bn_award');
    expect(bnAwardQueries.length).toBe(2);
    expect(bnAwardQueries.map((q) => q.occurrence)).toEqual([1, 2]);
  });

  // ─── B2-b.3a §2 · Empty-success optional-source scenarios ───────────────
  it('scenario `deep-related-awards-empty-success` — related-awards resolves with [] and no partial warning', async () => {
    setResponses({
      ip_master: { ssn: 'SSN-1', firstname: 'A', surname: 'B', status: 'A' },
      bn_payment_profile: null,
      bn_payment_profile_change_request: null,
      bn_claim: [{ id: 'c-1', claim_number: 'CL-1', status: 'APPROVED' }],
      ip_depend: [{ firstname: 'K', surname: 'B', relation: 'CHILD', status: 'A' }],
    });
    (recorder as any).opts.scenarioResponses = [
      { loaderName: 'getAwardPensionerDeep', scenarioId: 'deep-related-awards-empty-success',
        table: 'bn_award', occurrence: 1, data: { id: 'a-1', ssn: 'SSN-1', status: 'ACTIVE', award_number: 'AW-1' } },
      { loaderName: 'getAwardPensionerDeep', scenarioId: 'deep-related-awards-empty-success',
        table: 'bn_award', occurrence: 2, data: [] },
    ];
    const r = await recorder.runAs('getAwardPensionerDeep', 'deep-related-awards-empty-success', () =>
      getAwardPensionerDeep('a-1', FULL_ACCESS),
    );
    (recorder as any).opts.scenarioResponses = [];
    expect(r).not.toBeNull();
    expect(r?.related.relatedAwards).toEqual([]);
    expect(r?.related.relatedClaims).toHaveLength(1);
    expect(r?.partialWarnings.some((w) => w.toLowerCase().includes('related awards'))).toBe(false);
    const bnAwardQueries = recorder.queries.filter((q) => q.table === 'bn_award');
    expect(bnAwardQueries.length).toBe(2);
  });

  it('scenario `deep-dependants-empty-success` — ip_depend resolves with [] and no partial warning', async () => {
    setResponses({
      bn_award: { id: 'a-1', ssn: 'SSN-1', status: 'ACTIVE' },
      ip_master: { ssn: 'SSN-1', firstname: 'A', surname: 'B', status: 'A' },
      bn_payment_profile: null,
      bn_payment_profile_change_request: null,
      bn_claim: [{ id: 'c-1', claim_number: 'CL-1', status: 'APPROVED' }],
      ip_depend: [],
    });
    const r = await recorder.runAs('getAwardPensionerDeep', 'deep-dependants-empty-success', () =>
      getAwardPensionerDeep('a-1', FULL_ACCESS),
    );
    expect(r?.related.dependants).toEqual([]);
    expect(r?.partialWarnings.some((w) => w.toLowerCase().includes('dependant'))).toBe(false);
  });

  it('scenario `deep-change-request-empty-success` — change-request maybeSingle=null and no partial warning', async () => {
    setResponses({
      bn_award: { id: 'a-1', ssn: 'SSN-1', status: 'ACTIVE' },
      ip_master: { ssn: 'SSN-1', firstname: 'A', surname: 'B', status: 'A' },
      bn_payment_profile: {
        id: 'pp-1', payment_method: 'BANK', payment_currency: 'XCD',
        bank_name: 'RBC', account_number_masked: '••••9', verification_status: 'VERIFIED',
        effective_from: '2024-01-01', active: true,
      },
      bn_payment_profile_change_request: null,
      bn_claim: [],
      ip_depend: [],
    });
    const r = await recorder.runAs('getAwardPensionerDeep', 'deep-change-request-empty-success', () =>
      getAwardPensionerDeep('a-1', FULL_ACCESS),
    );
    expect(r?.paymentProfile.pendingChangeRequest).toBeNull();
    expect(r?.paymentProfile.present).toBe(true);
    expect(r?.partialWarnings.some((w) => w.toLowerCase().includes('change request'))).toBe(false);
  });
});

// ─── Sub-batch B2-b.3a · getAwardClaimDeep · core-path certification ─────
describe('AW360 Sub-batch B2-b.3a · getAwardClaimDeep', () => {
  const FULL: import('@/services/bn/awards/award360DeepService').ClaimAccess = {
    canViewEvidence: true, canViewWorkflow: true,
  };

  const fullClaimResponses = () => ({
    bn_award: { id: 'a-1', bn_claim_id: 'c-1', base_amount: 100, start_date: '2024-01-01', status: 'ACTIVE' },
    bn_claim: {
      id: 'c-1', claim_number: 'CL-1', status: 'APPROVED', product_id: 'p-1', product_version_id: 'pv-1',
      submission_date: '2024-01-01', claim_date: '2024-01-01', application_channel: 'STAFF',
      source: 'STAFF', priority: 'NORMAL', assigned_to: 'Alice', workflow_instance_id: null,
      decision_date: '2024-01-02',
    },
    bn_claim_queue_assignment: {
      id: 'q-1', claim_id: 'c-1', workbasket_id: 'WB-A', assigned_to: 'Alice',
      assigned_at: '2024-01-01T00:00:00Z', priority: 'NORMAL',
      due_at: '2099-01-01T00:00:00Z', picked_at: null, completed_at: null, is_active: true,
    },
    bn_product_version: { version_number: 3, status: 'PUBLISHED' },
    bn_claim_eligibility: {
      id: 'e-1', check_date: '2024-01-01', overall_result: true,
      rule_results: [{ passed: true, rule_code: 'R1', rule_name: 'Rule 1' }],
      override_applied: false, override_by: null, override_reason: null,
    },
    bn_claim_calculation: {
      id: 'cc-1', calc_date: '2024-01-01', weekly_rate: 100, monthly_rate: 400,
      lump_sum: 0, formula_version: '1.0', outputs: { trace: [] },
    },
    bn_claim_decision: {
      id: 'd-1', action_code: 'APPROVE', from_status: 'REVIEW', to_status: 'APPROVED',
      narrative: 'ok', effective_date: '2024-01-01', performed_by: 'Bob',
      performed_at: '2024-01-02T00:00:00Z', workflow_instance_id: null,
    },
    bn_claim_evidence: [
      { id: 'ev-1', document_name: 'Doc A', document_type_code: 'DA',
        status: 'VERIFIED', rejection_reason: null, waived_at: null, requirement_id: 'rq-1' },
    ],
    bn_doc_requirement: [
      { id: 'rq-1', document_type_code: 'DA', blocks_decision: true, is_active: true, requirement_level: 'REQUIRED' },
    ],
    bn_claim_event: [
      { id: 'ev-e1', event_type: 'SUBMITTED', from_status: null, to_status: 'INTAKE',
        notes: null, performed_by: 'A', performed_at: '2024-01-01T00:00:00Z' },
    ],
    bn_claim_note: [
      { id: 'n-1', subject: 'note', body: 'ok', entered_by: 'A', entered_at: '2024-01-01T00:00:00Z' },
    ],
  });

  it('scenario `claim-deep-full-access` queries every canonical table with correct scope', async () => {
    setResponses(fullClaimResponses());
    const v = await recorder.runAs('getAwardClaimDeep', 'claim-deep-full-access', () =>
      getAwardClaimDeep('a-1', FULL),
    );
    expect(v).not.toBeNull();
    expect(v!.header.claimNumber).toBe('CL-1');
    expect(v!.header.assignedOfficer).toBe('Alice');
    expect(v!.eligibility.present).toBe(true);
    expect(v!.evidence.required).toBe(1);
    expect(v!.evidence.verified).toBe(1);
    expect(v!.evidence.baselineUnknown).toBe(false);
    expect(v!.calculation.present).toBe(true);
    expect(v!.decision.present).toBe(true);
    expect(v!.workflowRestricted).toBe(false);
    const tables = new Set(recorder.queries.map((q) => q.table));
    for (const t of [
      'bn_award', 'bn_claim', 'bn_claim_queue_assignment', 'bn_product_version',
      'bn_claim_eligibility', 'bn_claim_calculation', 'bn_claim_decision',
      'bn_claim_evidence', 'bn_doc_requirement', 'bn_claim_event', 'bn_claim_note',
    ]) {
      expect(tables.has(t), `${t} not queried`).toBe(true);
    }
    // Loader-specific scope: bn_claim scoped by id (not ssn).
    const claimQuery = recorder.queries.find((q) => q.table === 'bn_claim')!;
    expect(claimQuery.filters.some((f) => f.method === 'eq' && f.column === 'id')).toBe(true);
    // No bn_override_request query — override read from eligibility row.
    expect(tables.has('bn_override_request' as any)).toBe(false);
  });

  it('scenario `claim-deep-unlinked-award` returns null and skips Claim child queries', async () => {
    setResponses({ bn_award: { id: 'a-1', bn_claim_id: null, status: 'ACTIVE' } });
    const v = await recorder.runAs('getAwardClaimDeep', 'claim-deep-unlinked-award', () =>
      getAwardClaimDeep('a-1', FULL),
    );
    expect(v).toBeNull();
    expect(recorder.queries.map((q) => q.table)).toEqual(['bn_award']);
  });

  it('scenario `claim-deep-award-query-error` rejects when bn_award lookup fails', async () => {
    setErrors({ bn_award: { message: 'award unavailable' } });
    await expect(
      recorder.runAs('getAwardClaimDeep', 'claim-deep-award-query-error', () =>
        getAwardClaimDeep('a-1', FULL),
      ),
    ).rejects.toMatchObject({ message: 'award unavailable' });
  });

  it('scenario `claim-deep-claim-not-found` returns the CLAIM_NOT_FOUND view contract', async () => {
    setResponses({ bn_award: { id: 'a-1', bn_claim_id: 'c-missing', status: 'ACTIVE' }, bn_claim: null });
    const v = await recorder.runAs('getAwardClaimDeep', 'claim-deep-claim-not-found', () =>
      getAwardClaimDeep('a-1', FULL),
    );
    expect(v).not.toBeNull();
    expect(v!.header.claimId).toBe('c-missing');
    expect(v!.header.claimNumber).toBeNull();
    expect(v!.warnings.some((w) => w.key === 'CLAIM_NOT_FOUND')).toBe(true);
    expect(v!.timeline).toEqual([]);
    expect(v!.evidence.baselineUnknown).toBe(true);
  });

  it('scenario `claim-deep-claim-query-error` rejects when bn_claim lookup fails', async () => {
    setResponses({ bn_award: { id: 'a-1', bn_claim_id: 'c-1', status: 'ACTIVE' } });
    setErrors({ bn_claim: { message: 'claim unavailable' } });
    await expect(
      recorder.runAs('getAwardClaimDeep', 'claim-deep-claim-query-error', () =>
        getAwardClaimDeep('a-1', FULL),
      ),
    ).rejects.toMatchObject({ message: 'claim unavailable' });
  });

  it('scenario `claim-deep-workflow-restricted` skips queue, event and note tables', async () => {
    const r = fullClaimResponses();
    setResponses(r);
    const v = await recorder.runAs('getAwardClaimDeep', 'claim-deep-workflow-restricted', () =>
      getAwardClaimDeep('a-1', { canViewEvidence: true, canViewWorkflow: false }),
    );
    expect(v).not.toBeNull();
    expect(v!.workflowRestricted).toBe(true);
    expect(v!.timeline).toEqual([]);
    const tables = recorder.queries.map((q) => q.table);
    expect(tables).not.toContain('bn_claim_queue_assignment');
    expect(tables).not.toContain('bn_claim_event');
    expect(tables).not.toContain('bn_claim_note');
  });

  it('scenario `claim-deep-evidence-restricted` skips bn_claim_evidence and bn_doc_requirement', async () => {
    setResponses(fullClaimResponses());
    const v = await recorder.runAs('getAwardClaimDeep', 'claim-deep-evidence-restricted', () =>
      getAwardClaimDeep('a-1', { canViewEvidence: false, canViewWorkflow: true }),
    );
    expect(v!.evidence.restricted).toBe(true);
    const tables = recorder.queries.map((q) => q.table);
    expect(tables).not.toContain('bn_claim_evidence');
    expect(tables).not.toContain('bn_doc_requirement');
  });

  it('scenario `claim-deep-product-version-missing` skips bn_product_version', async () => {
    const r = fullClaimResponses();
    (r.bn_claim as any).product_version_id = null;
    setResponses(r);
    const v = await recorder.runAs('getAwardClaimDeep', 'claim-deep-product-version-missing', () =>
      getAwardClaimDeep('a-1', FULL),
    );
    expect(v!.header.productVersionLabel).toBeNull();
    expect(v!.warnings.some((w) => w.key === 'MISSING_PRODUCT_VERSION')).toBe(true);
    expect(recorder.queries.map((q) => q.table)).not.toContain('bn_product_version');
  });

  it('scenario `claim-deep-queue-empty` maps workbasket/slaDueAt to null with no partial warning', async () => {
    const r = fullClaimResponses();
    (r as any).bn_claim_queue_assignment = null;
    setResponses(r);
    const v = await recorder.runAs('getAwardClaimDeep', 'claim-deep-queue-empty', () =>
      getAwardClaimDeep('a-1', FULL),
    );
    expect(v!.header.workbasket).toBeNull();
    expect(v!.header.slaDueAt).toBeNull();
    expect(v!.partialWarnings.some((w) => w.toLowerCase().includes('queue'))).toBe(false);
  });

  it('scenario `claim-deep-evidence-empty` — empty evidence + empty requirements → baselineUnknown=true', async () => {
    const r = fullClaimResponses();
    (r as any).bn_claim_evidence = [];
    (r as any).bn_doc_requirement = [];
    setResponses(r);
    const v = await recorder.runAs('getAwardClaimDeep', 'claim-deep-evidence-empty', () =>
      getAwardClaimDeep('a-1', FULL),
    );
    expect(v!.evidence.required).toBeNull();
    expect(v!.evidence.missing).toBeNull();
    expect(v!.evidence.baselineUnknown).toBe(true);
  });

  it('scenario `claim-deep-document-baseline-empty` — bn_doc_requirement=[] with non-empty evidence → baselineUnknown=true', async () => {
    const r = fullClaimResponses();
    (r as any).bn_doc_requirement = [];
    setResponses(r);
    const v = await recorder.runAs('getAwardClaimDeep', 'claim-deep-document-baseline-empty', () =>
      getAwardClaimDeep('a-1', FULL),
    );
    expect(v!.evidence.required).toBeNull();
    expect(v!.evidence.missing).toBeNull();
    expect(v!.evidence.baselineUnknown).toBe(true);
    expect(v!.evidence.verified).toBe(1);
  });

  it('scenario `claim-deep-eligibility-with-override` maps override_by / override_reason from eligibility row', async () => {
    const r = fullClaimResponses();
    (r as any).bn_claim_eligibility = {
      id: 'e-1', check_date: '2024-01-01', overall_result: false,
      rule_results: [{ passed: false, rule_code: 'R1', rule_name: 'Rule 1', message: 'fail' }],
      override_applied: true, override_by: 'U-9', override_reason: 'Manager override',
    };
    setResponses(r);
    const v = await recorder.runAs('getAwardClaimDeep', 'claim-deep-eligibility-with-override', () =>
      getAwardClaimDeep('a-1', FULL),
    );
    expect(v!.eligibility.overrideActor).toBe('U-9');
    expect(v!.eligibility.overrideReason).toBe('Manager override');
    // Prove bn_override_request was NOT touched — override read from eligibility row only.
    expect(recorder.queries.some((q) => q.table === ('bn_override_request' as any))).toBe(false);
  });

  // NOTE: the negative-scope guard (`bn_claim` scoped by `ssn` only under
  // `getAwardClaimDeep`) is a contract-level scope test, not a production
  // loader scenario. It lives in `loaderSpecificScope.test.ts` from
  // Sub-batch B2-b.3b onward so it cannot inflate the Claim Deep scenario
  // count nor pollute the runtime reconciliation.

  // ─── Sub-batch B2-b.3b · Claim Deep optional-source failure certification ───
  //
  // For each optional source we inject an error into exactly one table
  // (via the top-level `errors` map — every non-target table succeeds via
  // the shared `fullClaimResponses()` fixture), execute the REAL loader,
  // and prove:
  //   • loader resolves (not null when Claim is linked),
  //   • the matching partial-warning label appears,
  //   • unrelated sections stay populated,
  //   • the observed table set never includes `bn_override_request`.

  it('scenario `claim-deep-queue-error` — queue failure isolated; unrelated sections survive', async () => {
    setResponses(fullClaimResponses());
    setErrors({ bn_claim_queue_assignment: { message: 'queue unavailable' } });
    const v = await recorder.runAs('getAwardClaimDeep', 'claim-deep-queue-error', () =>
      getAwardClaimDeep('a-1', FULL),
    );
    expect(v).not.toBeNull();
    expect(v!.header.workbasket).toBeNull();
    expect(v!.header.slaDueAt).toBeNull();
    expect(v!.partialWarnings.some((w) => w.toLowerCase().includes('queue'))).toBe(true);
    // Unrelated sections survive.
    expect(v!.eligibility.present).toBe(true);
    expect(v!.calculation.present).toBe(true);
    expect(v!.decision.present).toBe(true);
    expect(v!.evidence.verified).toBe(1);
    expect(v!.timeline.length).toBeGreaterThan(0);
    // No stray sources marked unavailable.
    expect(v!.partialWarnings.some((w) => /product version|eligibility|calculation|decision|evidence|doc requirements|timeline events|notes/i.test(w))).toBe(false);
    expect(recorder.queries.some((q) => q.table === ('bn_override_request' as any))).toBe(false);
  });

  it('scenario `claim-deep-product-version-error` — label null; productVersionId preserved', async () => {
    setResponses(fullClaimResponses());
    setErrors({ bn_product_version: { message: 'product version unavailable' } });
    const v = await recorder.runAs('getAwardClaimDeep', 'claim-deep-product-version-error', () =>
      getAwardClaimDeep('a-1', FULL),
    );
    expect(v).not.toBeNull();
    expect(v!.header.productVersionId).toBe('pv-1');
    expect(v!.header.productVersionLabel).toBeNull();
    expect(v!.partialWarnings.some((w) => w.toLowerCase().includes('product version'))).toBe(true);
    // MISSING_PRODUCT_VERSION must NOT fabricate when Claim still carries an id.
    expect(v!.warnings.some((w) => w.key === 'MISSING_PRODUCT_VERSION')).toBe(false);
    expect(v!.eligibility.present).toBe(true);
    expect(v!.calculation.present).toBe(true);
    expect(v!.decision.present).toBe(true);
    expect(v!.evidence.verified).toBe(1);
    expect(v!.workflowRestricted).toBe(false);
    expect(recorder.queries.some((q) => q.table === ('bn_override_request' as any))).toBe(false);
  });

  it('scenario `claim-deep-eligibility-error` — override null; other sections survive', async () => {
    setResponses(fullClaimResponses());
    setErrors({ bn_claim_eligibility: { message: 'eligibility unavailable' } });
    const v = await recorder.runAs('getAwardClaimDeep', 'claim-deep-eligibility-error', () =>
      getAwardClaimDeep('a-1', FULL),
    );
    expect(v).not.toBeNull();
    expect(v!.eligibility.present).toBe(false);
    expect(v!.eligibility.overrideActor).toBeNull();
    expect(v!.eligibility.overrideReason).toBeNull();
    expect(v!.partialWarnings.some((w) => w.toLowerCase().includes('eligibility'))).toBe(true);
    // ELIGIBILITY_NOT_RUN may appear per production behaviour.
    expect(v!.warnings.some((w) => w.key === 'ELIGIBILITY_NOT_RUN')).toBe(true);
    expect(v!.calculation.present).toBe(true);
    expect(v!.decision.present).toBe(true);
    expect(v!.evidence.verified).toBe(1);
    expect(v!.timeline.length).toBeGreaterThan(0);
    // No bn_override_request query occurred.
    expect(recorder.queries.some((q) => q.table === ('bn_override_request' as any))).toBe(false);
  });

  it('scenario `claim-deep-calculation-error` — no fabricated award/calc mismatch', async () => {
    setResponses(fullClaimResponses());
    setErrors({ bn_claim_calculation: { message: 'calc unavailable' } });
    const v = await recorder.runAs('getAwardClaimDeep', 'claim-deep-calculation-error', () =>
      getAwardClaimDeep('a-1', FULL),
    );
    expect(v).not.toBeNull();
    expect(v!.calculation.present).toBe(false);
    expect(v!.partialWarnings.some((w) => w.toLowerCase().includes('calculation'))).toBe(true);
    expect(v!.warnings.some((w) => w.key === 'CALCULATION_NOT_RUN')).toBe(true);
    // MUST NOT fabricate an amount mismatch when calculation is unavailable.
    expect(v!.warnings.some((w) => w.key === 'AWARD_AMOUNT_MISMATCH')).toBe(false);
    expect(v!.eligibility.present).toBe(true);
    expect(v!.decision.present).toBe(true);
    expect(v!.evidence.verified).toBe(1);
    expect(v!.timeline.length).toBeGreaterThan(0);
    expect(recorder.queries.some((q) => q.table === ('bn_override_request' as any))).toBe(false);
  });

  it('scenario `claim-deep-evidence-error` — evidence not represented as an empty list', async () => {
    setResponses(fullClaimResponses());
    setErrors({ bn_claim_evidence: { message: 'evidence unavailable' } });
    const v = await recorder.runAs('getAwardClaimDeep', 'claim-deep-evidence-error', () =>
      getAwardClaimDeep('a-1', FULL),
    );
    expect(v).not.toBeNull();
    expect(v!.evidence.restricted).toBe(false);
    expect(v!.evidence.present).toBe(false);
    expect(v!.partialWarnings.some((w) => w.toLowerCase().startsWith('evidence'))).toBe(true);
    // Requirements query still fires successfully.
    expect(recorder.queries.some((q) => q.table === 'bn_doc_requirement')).toBe(true);
    // Unrelated sections survive.
    expect(v!.eligibility.present).toBe(true);
    expect(v!.calculation.present).toBe(true);
    expect(v!.decision.present).toBe(true);
    expect(v!.timeline.length).toBeGreaterThan(0);
    expect(recorder.queries.some((q) => q.table === ('bn_override_request' as any))).toBe(false);
  });

  it('scenario `claim-deep-requirements-error` — evidence rows preserved; baselineUnknown=true', async () => {
    setResponses(fullClaimResponses());
    setErrors({ bn_doc_requirement: { message: 'doc requirements unavailable' } });
    const v = await recorder.runAs('getAwardClaimDeep', 'claim-deep-requirements-error', () =>
      getAwardClaimDeep('a-1', FULL),
    );
    expect(v).not.toBeNull();
    // Evidence rows are NOT discarded.
    expect(v!.evidence.received).toBe(1);
    expect(v!.evidence.verified).toBe(1);
    expect(v!.evidence.required).toBeNull();
    expect(v!.evidence.missing).toBeNull();
    expect(v!.evidence.baselineUnknown).toBe(true);
    expect(v!.partialWarnings.some((w) => w.toLowerCase().includes('doc requirements'))).toBe(true);
    expect(v!.eligibility.present).toBe(true);
    expect(v!.calculation.present).toBe(true);
    expect(v!.decision.present).toBe(true);
    expect(recorder.queries.some((q) => q.table === ('bn_override_request' as any))).toBe(false);
  });

  it('scenario `claim-deep-decision-error` — MISSING_DECISION warning; other sections survive', async () => {
    setResponses(fullClaimResponses());
    setErrors({ bn_claim_decision: { message: 'decision unavailable' } });
    const v = await recorder.runAs('getAwardClaimDeep', 'claim-deep-decision-error', () =>
      getAwardClaimDeep('a-1', FULL),
    );
    expect(v).not.toBeNull();
    expect(v!.decision.present).toBe(false);
    expect(v!.partialWarnings.some((w) => w.toLowerCase().startsWith('decision'))).toBe(true);
    expect(v!.warnings.some((w) => w.key === 'MISSING_DECISION')).toBe(true);
    expect(v!.eligibility.present).toBe(true);
    expect(v!.calculation.present).toBe(true);
    expect(v!.evidence.verified).toBe(1);
    expect(v!.timeline.length).toBeGreaterThan(0);
    expect(recorder.queries.some((q) => q.table === ('bn_override_request' as any))).toBe(false);
  });

  it('scenario `claim-deep-events-error` — Notes remain in timeline', async () => {
    setResponses(fullClaimResponses());
    setErrors({ bn_claim_event: { message: 'events unavailable' } });
    const v = await recorder.runAs('getAwardClaimDeep', 'claim-deep-events-error', () =>
      getAwardClaimDeep('a-1', FULL),
    );
    expect(v).not.toBeNull();
    expect(v!.workflowRestricted).toBe(false);
    expect(v!.partialWarnings.some((w) => w.toLowerCase().includes('timeline events'))).toBe(true);
    // Notes with deterministic timestamp survive.
    expect(v!.timeline.some((t) => t.kind === 'NOTE')).toBe(true);
    // Events are absent from timeline.
    expect(v!.timeline.some((t) => t.kind === 'STATUS' || t.kind === 'EVENT')).toBe(false);
    // Unrelated sections survive.
    expect(v!.eligibility.present).toBe(true);
    expect(v!.calculation.present).toBe(true);
    expect(v!.decision.present).toBe(true);
    expect(v!.evidence.verified).toBe(1);
    expect(recorder.queries.some((q) => q.table === ('bn_override_request' as any))).toBe(false);
  });

  it('scenario `claim-deep-notes-error` — Events remain in timeline', async () => {
    setResponses(fullClaimResponses());
    setErrors({ bn_claim_note: { message: 'notes unavailable' } });
    const v = await recorder.runAs('getAwardClaimDeep', 'claim-deep-notes-error', () =>
      getAwardClaimDeep('a-1', FULL),
    );
    expect(v).not.toBeNull();
    expect(v!.workflowRestricted).toBe(false);
    expect(v!.partialWarnings.some((w) => w.toLowerCase().startsWith('notes'))).toBe(true);
    // Events with deterministic timestamp survive.
    expect(v!.timeline.some((t) => t.kind === 'STATUS' || t.kind === 'EVENT')).toBe(true);
    expect(v!.timeline.some((t) => t.kind === 'NOTE')).toBe(false);
    expect(v!.eligibility.present).toBe(true);
    expect(v!.calculation.present).toBe(true);
    expect(v!.decision.present).toBe(true);
    expect(v!.evidence.verified).toBe(1);
    expect(recorder.queries.some((q) => q.table === ('bn_override_request' as any))).toBe(false);
  });

  // ─── Sub-batch B2-b.3b · aggregate registry / no-override-request guard ───
  it('every Claim Deep registry scenario invokes the real loader', async () => {
    // Nothing to execute here — the "every registered scenario was executed"
    // reconciliation test at the bottom of this file already proves this
    // by matching (loaderName, scenarioId) tags. This test simply pins the
    // count so future changes have to update both places.
    const { AWARD360_CERTIFICATION_REGISTRY } = await import(
      '@/services/bn/awards/award360CertificationRegistry'
    );
    expect(AWARD360_CERTIFICATION_REGISTRY.getAwardClaimDeep.scenarios.length).toBe(21);
  });

  it('no Claim Deep scenario ever queries bn_override_request', () => {
    // `capturedExecutions` accumulates across `beforeEach` resets (evidence
    // is written into a module-level sink) so this holds across every
    // Claim Deep scenario in the suite.
    const claimDeepTables = capturedExecutions
      .filter((e) => e.loaderName === 'getAwardClaimDeep')
      .flatMap((e) => e.tables);
    expect(claimDeepTables.some((t) => t === 'bn_override_request')).toBe(false);
  });

});


// ─── Sub-batch B2-a · Loader ↔ manifest table enforcement ────────────────
describe('AW360 Sub-batch B2-a · loader-to-table enforcement', () => {
  it('getAwardPensioner queries only its manifest tables', async () => {
    setResponses({
      bn_award: { ssn: 'SSN-1' },
      ip_master: { ssn: 'SSN-1', firstname: 'X', surname: 'Y', status: 'A' },
    });
    await recorder.runAs('getAwardPensioner', 'pensioner-with-person', () =>
      getAwardPensioner('a-1'),
    );
    const queried = new Set(recorder.queries.map((q) => q.table));
    for (const t of queried) {
      expect(['bn_award', 'ip_master']).toContain(t);
    }
  });

  it('getAwardPensionerDeep queries only its manifest tables', async () => {
    setResponses({
      bn_award: { id: 'a-1', ssn: 'SSN-1', status: 'ACTIVE' },
      ip_master: { ssn: 'SSN-1', firstname: 'X', surname: 'Y', status: 'A' },
    });
    await recorder.runAs('getAwardPensionerDeep', 'deep-full-access', () =>
      getAwardPensionerDeep('a-1', { canViewPaymentProfile: true, canViewPerson360: true }),
    );
    const allowed = new Set([
      'bn_award', 'ip_master', 'ip_depend',
      'bn_payment_profile', 'bn_payment_profile_change_request', 'bn_claim',
    ]);
    for (const t of recorder.queries.map((q) => q.table)) {
      expect(allowed.has(t), `${t} not in pensioner-deep manifest`).toBe(true);
    }
  });
});

// ─── Sub-batch B2-b.1b · Runtime evidence reconciliation ─────────────────
//
// This block runs LAST in this file. By the time these `it`s execute,
// every prior scenario has emitted a `RecordedScenarioExecution` into
// `capturedExecutions`, so we can prove:
//
//   • Zero-query scenarios are recorded (e.g. summary-all-restricted).
//   • Rejected scenarios are recorded with outcome:'rejected'.
//   • Every registry scenario executed at least once.
//   • Every executed scenario belongs to a registered loader.
//   • Observed table union per certified loader equals its
//     manifest.expectedTables (both directions).
//
describe('AW360 B2-b.1b · runtime evidence reconciliation (main-loader-certification suite)', () => {
  // B2-c.2 — scope reconciliation to only the loaders owned by this suite;
  // Product Deep evidence lives in a separate suite/file.
  const suiteLoaders = new Set(
    Object.entries(AWARD360_CERTIFICATION_REGISTRY)
      .filter(([, c]) => c.suiteId === 'main-loader-certification')
      .map(([name]) => name),
  );

  it('captured at least one execution', () => {
    expect(capturedExecutions.length).toBeGreaterThan(0);
  });

  it('records zero-query scenarios (summary-all-restricted has queryCount=0)', () => {
    const evs = capturedExecutions.filter(
      (e) => e.loaderName === 'getAward360Summary' && e.scenarioId === 'summary-all-restricted',
    );
    expect(evs.length).toBeGreaterThan(0);
    for (const e of evs) {
      expect(e.queryCount).toBe(0);
      expect(e.tables).toEqual([]);
      expect(e.outcome).toBe('resolved');
    }
  });

  it('records rejected scenarios with outcome:"rejected"', () => {
    const rejected = capturedExecutions.filter((e) => e.outcome === 'rejected');
    expect(rejected.length).toBeGreaterThan(0);
    const rejectedKeys = new Set(rejected.map((e) => `${e.loaderName}::${e.scenarioId}`));
    expect(rejectedKeys.has('getAwardPensioner::pensioner-award-query-error')).toBe(true);
    expect(rejectedKeys.has('getAwardPensioner::pensioner-person-query-error')).toBe(true);
  });

  it('every suite-owned scenario was executed at least once', () => {
    const executed = new Set(
      capturedExecutions.map((e) => `${e.loaderName}::${e.scenarioId}`),
    );
    const missing: string[] = [];
    for (const loader of suiteLoaders) {
      const cert = AWARD360_CERTIFICATION_REGISTRY[loader]!;
      for (const s of cert.scenarios) {
        const key = `${loader}::${s.id}`;
        if (!executed.has(key)) missing.push(key);
      }
    }
    expect(missing, `Registered but never executed: ${missing.join(', ')}`).toEqual([]);
  });

  it('every executed scenario tagged to a suite-owned loader is registered', () => {
    const registered = new Set<string>();
    for (const loader of suiteLoaders) {
      const cert = AWARD360_CERTIFICATION_REGISTRY[loader]!;
      for (const s of cert.scenarios) registered.add(`${loader}::${s.id}`);
    }
    const stray: string[] = [];
    for (const e of capturedExecutions) {
      if (!suiteLoaders.has(e.loaderName)) continue;
      const key = `${e.loaderName}::${e.scenarioId}`;
      if (!registered.has(key)) stray.push(key);
    }
    expect(stray, `Executed but unregistered: ${stray.join(', ')}`).toEqual([]);
  });

  it('per-suite-loader observed table union equals manifest.expectedTables', () => {
    const manifestByName = new Map(AWARD360_LOADER_MANIFEST.map((e) => [e.name, e]));
    for (const loader of suiteLoaders) {
      const observed = new Set<string>();
      for (const e of capturedExecutions) {
        if (e.loaderName !== loader) continue;
        for (const t of e.tables) observed.add(t);
      }
      const expected = new Set(manifestByName.get(loader)?.expectedTables ?? []);
      const missing = [...expected].filter((t) => !observed.has(t));
      const extra = [...observed].filter((t) => !expected.has(t));
      expect(
        { loader, missing, extra },
        `${loader} — observed ≠ manifest.expectedTables`,
      ).toEqual({ loader, missing: [], extra: [] });
    }
  });

  it('no observed table falls outside the schema contract', async () => {
    const { AWARD360_SCHEMA_CONTRACT } = await import(
      '@/services/bn/awards/award360SchemaContract'
    );
    for (const e of capturedExecutions) {
      for (const t of e.tables) {
        expect(
          Object.prototype.hasOwnProperty.call(AWARD360_SCHEMA_CONTRACT, t),
          `${e.loaderName}::${e.scenarioId} touched unknown table ${t}`,
        ).toBe(true);
      }
    }
  });

  it('no Product Deep execution leaked into the main-suite evidence collector', () => {
    const productDeep = capturedExecutions.filter(
      (e) => e.loaderName === 'getAwardProductDeep',
    );
    expect(productDeep, 'Product Deep must run in its own suite/file').toEqual([]);
  });
});

