/**
 * BUG-47 — every document fact read a table nothing writes to.
 *
 * Reported from the screen: the claimant uploaded a medical certificate, the
 * Evidence & Documents panel said "All mandatory documents have been verified"
 * with MED-003 Fulfilled, and the Eligibility tab still reported
 * `document.medical_certificate_received = false` — "Medical certificate not
 * provided". Re-running eligibility changed nothing.
 *
 * Two independent causes, either alone enough:
 *
 *   1. Uploads are written to `bn_claim_evidence` (evidenceService.ts:214).
 *      Every document resolver read `bn_claim_document`, which is empty — no
 *      screen writes to it. The query was well formed and returned nothing, and
 *      "nothing" was reported as a finding against the claimant.
 *
 *   2. The resolvers hardcoded the catalogued spellings — MEDICAL_CERT,
 *      MED_CERT, MEDICAL_CERTIFICATE. The product demands `MED-003`, a code in
 *      no catalogue row, so no list of spellings could ever match it.
 *
 * The vocabulary gap is bridged from `bn_doc_requirement`, and only where it
 * exists: a product speaking the shared vocabulary is judged by that
 * vocabulary alone, so a bank mandate can never satisfy a medical certificate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Rows keyed by table, served to the mocked query builder. */
const tables: Record<string, any[]> = {};
/** Tables that should fail the read, to prove an error is never a false 'no'. */
const failing = new Set<string>();

vi.mock('@/integrations/supabase/client', () => {
  const build = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const api: any = {
      select: () => api,
      eq: (col: string, val: unknown) => {
        rows = rows.filter((r) => r[col] === val);
        return api;
      },
      in: (col: string, vals: unknown[]) => {
        rows = rows.filter((r) => vals.includes(r[col]));
        return api;
      },
      order: () => api,
      limit: () => api,
      maybeSingle: () =>
        Promise.resolve(
          failing.has(table)
            ? { data: null, error: { message: `${table} unreadable` } }
            : { data: rows[0] ?? null, error: null },
        ),
      then: (resolve: any) =>
        resolve(
          failing.has(table)
            ? { data: null, error: { message: `${table} unreadable` } }
            : { data: rows, error: null },
        ),
    };
    return api;
  };
  return { supabase: { from: (t: string) => build(t) } };
});

const { resolveFact } = await import('../eligibilityFactResolver');

const CLAIM = 'claim-1';
const VERSION = 'version-1';
const ctx = { claimId: CLAIM, ssn: '900004', claimDate: '2026-08-27' };

/** The catalogue: the shared vocabulary. MED-003 is deliberately absent. */
const CATALOGUE = [
  { type_code: 'MEDICAL_CERT' },
  { type_code: 'DEATH_CERT' },
  { type_code: 'BIRTH_CERT' },
  { type_code: 'BANK_EFT' },
];

beforeEach(() => {
  failing.clear();
  for (const k of Object.keys(tables)) delete tables[k];
  tables.bn_claim = [{ id: CLAIM, product_version_id: VERSION }];
  tables.bn_service_doc_type = CATALOGUE;
  tables.bn_doc_requirement = [];
  tables.bn_claim_evidence = [];
});

const received = (code: string, over: Record<string, unknown> = {}) => ({
  document_type_code: code,
  status: 'RECEIVED',
  requirement_id: null,
  rejected_at: null,
  waived_at: null,
  verified_at: null,
  metadata: {},
  entered_at: '2026-08-27T00:00:00Z',
  claim_id: CLAIM,
  ...over,
});

describe('the certificate is found where it is actually stored', () => {
  it('a catalogued upload on bn_claim_evidence is seen', async () => {
    tables.bn_claim_evidence = [received('MEDICAL_CERT')];
    const r = await resolveFact('document.medical_certificate_received', ctx);
    expect(r.value).toBe(true);
  });

  it('names bn_claim_evidence as the source, not the empty table', async () => {
    tables.bn_claim_evidence = [received('MEDICAL_CERT')];
    const r = await resolveFact('document.medical_certificate_received', ctx);
    expect(r.source_table).toBe('bn_claim_evidence');
  });

  it('a row on the old bn_claim_document table is NOT consulted', async () => {
    // Proving the read moved, rather than merely widening.
    tables.bn_claim_document = [received('MEDICAL_CERT')];
    const r = await resolveFact('document.medical_certificate_received', ctx);
    expect(r.value).toBe(false);
  });

  it('no evidence at all is still false', async () => {
    const r = await resolveFact('document.medical_certificate_received', ctx);
    expect(r.value).toBe(false);
  });
});

describe('the product’s own code for the document — the MED-003 case', () => {
  beforeEach(() => {
    // Exactly the live configuration of MATERNITY_GRANT_TEST v1.
    tables.bn_doc_requirement = [
      { document_type_code: 'MED-003', requirement_level: 'MANDATORY', is_active: true, product_version_id: VERSION },
    ];
  });

  it('the screenshot case: MED-003 received satisfies the medical rule', async () => {
    tables.bn_claim_evidence = [received('MED-003')];
    const r = await resolveFact('document.medical_certificate_received', ctx);
    expect(r.value).toBe(true);
  });

  it('MED-003 not yet received leaves the rule unsatisfied', async () => {
    const r = await resolveFact('document.medical_certificate_received', ctx);
    expect(r.value).toBe(false);
  });

  it('every mandatory document must be in, not just one', async () => {
    tables.bn_doc_requirement.push({
      document_type_code: 'MED-777', requirement_level: 'MANDATORY', is_active: true, product_version_id: VERSION,
    });
    tables.bn_claim_evidence = [received('MED-003')];
    const r = await resolveFact('document.medical_certificate_received', ctx);
    expect(r.value).toBe(false);
  });

  it('an optional requirement is not demanded', async () => {
    tables.bn_doc_requirement.push({
      document_type_code: 'MED-999', requirement_level: 'OPTIONAL', is_active: true, product_version_id: VERSION,
    });
    tables.bn_claim_evidence = [received('MED-003')];
    const r = await resolveFact('document.medical_certificate_received', ctx);
    expect(r.value).toBe(true);
  });

  it('an inactive requirement is not demanded', async () => {
    tables.bn_doc_requirement.push({
      document_type_code: 'MED-888', requirement_level: 'MANDATORY', is_active: false, product_version_id: VERSION,
    });
    tables.bn_claim_evidence = [received('MED-003')];
    const r = await resolveFact('document.medical_certificate_received', ctx);
    expect(r.value).toBe(true);
  });
});

describe('the bridge cannot substitute one document for another', () => {
  it('a bank mandate does not satisfy a medical certificate', async () => {
    // The product speaks the shared vocabulary, so the bridge must stay shut:
    // BANK_EFT is catalogued, and it is not a medical certificate.
    tables.bn_doc_requirement = [
      { document_type_code: 'BANK_EFT', requirement_level: 'MANDATORY', is_active: true, product_version_id: VERSION },
    ];
    tables.bn_claim_evidence = [received('BANK_EFT')];
    const r = await resolveFact('document.medical_certificate_received', ctx);
    expect(r.value).toBe(false);
  });

  it('a catalogued mandatory set closes the bridge even when partly product-specific', async () => {
    tables.bn_doc_requirement = [
      { document_type_code: 'BANK_EFT', requirement_level: 'MANDATORY', is_active: true, product_version_id: VERSION },
      { document_type_code: 'XYZ-001', requirement_level: 'MANDATORY', is_active: true, product_version_id: VERSION },
    ];
    tables.bn_claim_evidence = [received('BANK_EFT'), received('XYZ-001')];
    const r = await resolveFact('document.medical_certificate_received', ctx);
    expect(r.value).toBe(false);
  });

  it('a product declaring no mandatory document proves nothing', async () => {
    tables.bn_doc_requirement = [];
    tables.bn_claim_evidence = [received('SOMETHING-ELSE')];
    const r = await resolveFact('document.medical_certificate_received', ctx);
    expect(r.value).toBe(false);
  });

  it('a medical certificate does not satisfy a death certificate rule', async () => {
    tables.bn_claim_evidence = [received('MEDICAL_CERT')];
    const r = await resolveFact('document.death_certificate_received', ctx);
    expect(r.value).toBe(false);
  });
});

describe('which uploads count as evidence', () => {
  it('a rejected upload is not evidence', async () => {
    tables.bn_claim_evidence = [
      received('MEDICAL_CERT', { rejected_at: '2026-08-27T10:00:00Z', status: 'REJECTED' }),
    ];
    const r = await resolveFact('document.medical_certificate_received', ctx);
    expect(r.value).toBe(false);
  });

  it('a rejected upload does not count even while its status still reads RECEIVED', async () => {
    tables.bn_claim_evidence = [
      received('MEDICAL_CERT', { rejected_at: '2026-08-27T10:00:00Z' }),
    ];
    const r = await resolveFact('document.medical_certificate_received', ctx);
    expect(r.value).toBe(false);
  });

  it('a waived requirement counts — someone with authority decided so', async () => {
    tables.bn_claim_evidence = [
      received('MEDICAL_CERT', { status: 'WAIVED', waived_at: '2026-08-27T10:00:00Z' }),
    ];
    const r = await resolveFact('document.medical_certificate_received', ctx);
    expect(r.value).toBe(true);
  });

  it('a verified upload counts', async () => {
    tables.bn_claim_evidence = [
      received('MEDICAL_CERT', { status: 'VERIFIED', verified_at: '2026-08-27T10:00:00Z' }),
    ];
    const r = await resolveFact('document.medical_certificate_received', ctx);
    expect(r.value).toBe(true);
  });

  it('an unrecognised status does not count', async () => {
    tables.bn_claim_evidence = [received('MEDICAL_CERT', { status: 'DRAFT' })];
    const r = await resolveFact('document.medical_certificate_received', ctx);
    expect(r.value).toBe(false);
  });

  it('a blank status does not count', async () => {
    tables.bn_claim_evidence = [received('MEDICAL_CERT', { status: null })];
    const r = await resolveFact('document.medical_certificate_received', ctx);
    expect(r.value).toBe(false);
  });

  it('one rejected copy does not spoil a good one', async () => {
    tables.bn_claim_evidence = [
      received('MEDICAL_CERT', { rejected_at: '2026-08-26T10:00:00Z' }),
      received('MEDICAL_CERT'),
    ];
    const r = await resolveFact('document.medical_certificate_received', ctx);
    expect(r.value).toBe(true);
  });
});

describe('a failed read is never a finding against the claimant', () => {
  it('an unreadable evidence table reports a reason, not false', async () => {
    failing.add('bn_claim_evidence');
    const r = await resolveFact('document.medical_certificate_received', ctx);
    // The evaluator turns a stated reason into UNEVALUATED, which blocks
    // visibly. `false` would have read as "the claimant has no certificate".
    expect(r.reason).toBeTruthy();
    expect(r.value).not.toBe(true);
  });

  it('says which table could not be read', async () => {
    failing.add('bn_claim_evidence');
    const r = await resolveFact('document.medical_certificate_received', ctx);
    expect(String(r.reason)).toContain('bn_claim_evidence');
  });
});

describe('document status facts', () => {
  it('reports VERIFIED for a verified upload', async () => {
    tables.bn_claim_evidence = [
      received('MEDICAL_CERT', { status: 'VERIFIED', verified_at: '2026-08-27T10:00:00Z' }),
    ];
    const r = await resolveFact('document.medical_certificate.status', ctx);
    expect(r.value).toBe('VERIFIED');
  });

  it('reports RECEIVED for an upload awaiting verification', async () => {
    tables.bn_claim_evidence = [received('MEDICAL_CERT')];
    const r = await resolveFact('document.medical_certificate.status', ctx);
    expect(r.value).toBe('RECEIVED');
  });

  it('reports WAIVED for a waived requirement', async () => {
    tables.bn_claim_evidence = [
      received('MEDICAL_CERT', { status: 'WAIVED', waived_at: '2026-08-27T10:00:00Z' }),
    ];
    const r = await resolveFact('document.medical_certificate.status', ctx);
    expect(r.value).toBe('WAIVED');
  });

  it('reports PENDING when nothing has been uploaded', async () => {
    const r = await resolveFact('document.medical_certificate.status', ctx);
    expect(r.value).toBe('PENDING');
  });

  it('prefers the verified copy over a superseded one', async () => {
    tables.bn_claim_evidence = [
      received('MEDICAL_CERT'),
      received('MEDICAL_CERT', { status: 'VERIFIED', verified_at: '2026-08-27T10:00:00Z' }),
    ];
    const r = await resolveFact('document.medical_certificate.status', ctx);
    expect(r.value).toBe('VERIFIED');
  });
});
