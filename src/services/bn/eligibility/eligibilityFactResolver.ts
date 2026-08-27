/**
 * Eligibility Fact Resolver — the single runtime entry point for evaluating
 * eligibility facts.
 *
 *   const value = await resolveFact('contribution.paid_weeks', ctx);
 *
 * All rule evaluation MUST go through this resolver so that:
 *   • every fact has a known, registered source,
 *   • the source table is recorded for explainability,
 *   • free-text JSON keys never reach the database layer.
 *
 * Unknown fact keys throw.
 */

import { supabase } from '@/integrations/supabase/client';
import { getFact } from './eligibilityFactRegistry';

const db = supabase as any;

export interface EligibilityContext {
  ssn?: string | null;
  claimId?: string | null;
  productCode?: string | null;
  /** ISO date string (yyyy-MM-dd) — the claim date used for age / windows. */
  claimDate?: string | null;
  /** Optional employer to scope employer-related facts to. */
  employerRegno?: string | null;
  /** Free-form extras the runtime can stash (e.g. injury date overrides). */
  extras?: Record<string, unknown>;
}

export interface FactResolution {
  fact_key: string;
  value: unknown;
  source_table: string;
  source_column: string;
  resolved_at: string;
  /** If a resolver could not run (missing context, etc.) it sets reason here. */
  reason?: string;
}

type ResolverFn = (ctx: EligibilityContext) => Promise<unknown>;

// ───────────────────────── helpers ─────────────────────────

function yearsBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  let years = to.getFullYear() - from.getFullYear();
  const m = to.getMonth() - from.getMonth();
  if (m < 0 || (m === 0 && to.getDate() < from.getDate())) years--;
  return years;
}

async function loadIpMaster(ssn: string) {
  const { data } = await db
    .from('ip_master')
    .select('ssn, dob, sex, status, date_died, registration_date, spouse_ssn')
    .eq('ssn', ssn)
    .maybeSingle();
  return data ?? null;
}

async function loadClaim(claimId: string) {
  const { data } = await db
    .from('bn_claim')
    .select('id, ssn, product_id, claim_date, submission_date, employer_regno, application_channel, channel_code')
    .eq('id', claimId)
    .maybeSingle();
  return data ?? null;
}

async function loadContributionSnapshot(claimId: string) {
  const { data } = await db
    .from('bn_claim_contribution_snapshot')
    .select('claim_id, total_weeks, paid_weeks, credited_weeks, total_wages, average_weekly_wage, contribution_json, captured_at, period_from, period_to')
    .eq('claim_id', claimId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function loadEmployer(regno: string) {
  const { data } = await db
    .from('er_master')
    .select('regno, status, registration_date, date_of_closure')
    .eq('regno', regno)
    .maybeSingle();
  return data ?? null;
}

/* ─────────────── claim evidence (BUG-47) ───────────────
 *
 * Every document fact used to read `bn_claim_document`. Nothing writes to that
 * table -- uploads go to `bn_claim_evidence` (evidenceService.ts:214), and
 * `bn_claim_document` is empty. So a claimant could upload a certificate,
 * the screen would say "Evidence Complete", and eligibility would still report
 * "Medical certificate received: no", because the query looked somewhere else.
 *
 * The query was well formed and returned nothing, and "nothing" was reported
 * as fact rather than as "I looked in the wrong place" -- the same defect as
 * BUG-02/03/13/22/29/30, and the reason a query error now throws instead of
 * resolving to false. The evaluator turns a throw into UNEVALUATED, which is
 * blocking and visible; false would have been a silent finding against the
 * claimant.
 */

/** Statuses on bn_claim_evidence that mean the document is on the claim. */
const EVIDENCE_PRESENT_STATUS = new Set([
  'RECEIVED', 'VERIFIED', 'ACCEPTED', 'FULFILLED', 'APPROVED',
]);

interface ClaimEvidenceRow {
  document_type_code: string | null;
  status: string | null;
  requirement_id: string | null;
  rejected_at: string | null;
  waived_at: string | null;
  verified_at: string | null;
}

/** Is this row evidence that the document is present? */
function evidenceIsPresent(row: ClaimEvidenceRow): boolean {
  // A rejected upload is not evidence of anything, whatever its status says.
  if (row.rejected_at) return false;
  // A waiver is a deliberate decision that the document is not required of
  // this claimant, recorded by someone with the authority to make it.
  if (row.waived_at) return true;
  if (row.verified_at) return true;
  const status = String(row.status ?? '').trim().toUpperCase();
  return status !== '' && EVIDENCE_PRESENT_STATUS.has(status);
}

/**
 * Every evidence row on the claim. Throws rather than returning [] on error,
 * so a failed read can never be mistaken for "no documents".
 */
async function claimEvidenceRows(claimId: string): Promise<ClaimEvidenceRow[]> {
  const { data, error } = await db
    .from('bn_claim_evidence')
    .select('document_type_code, status, requirement_id, rejected_at, waived_at, verified_at')
    .eq('claim_id', claimId);
  if (error) {
    throw new Error(`bn_claim_evidence could not be read: ${error.message}`);
  }
  return Array.isArray(data) ? (data as ClaimEvidenceRow[]) : [];
}

/**
 * Does the product name this document with its own code?
 *
 * The document catalogue (`bn_service_doc_type`) is the shared vocabulary --
 * MEDICAL_CERT, DEATH_CERT, BIRTH_CERT. But a product may configure a
 * requirement under a code of its own: MATERNITY_GRANT_TEST demands `MED-003`,
 * which appears in no catalogue row, so no list of standard spellings can ever
 * recognise it.
 *
 * Where that gap exists, the only statement the configuration supports is the
 * stronger one: every mandatory document the product declares has been
 * received. That can never let one document stand in for another -- a bank
 * mandate cannot satisfy a medical certificate, because the medical
 * certificate is itself one of the mandatory requirements that must be met.
 *
 * Applies ONLY when no mandatory requirement uses a catalogued code. A product
 * speaking the shared vocabulary is judged by that vocabulary alone.
 */
async function productMandatoryEvidenceComplete(
  claimId: string,
  present: ClaimEvidenceRow[],
): Promise<boolean> {
  const { data: claim, error: claimErr } = await db
    .from('bn_claim')
    .select('product_version_id')
    .eq('id', claimId)
    .maybeSingle();
  if (claimErr) throw new Error(`bn_claim could not be read: ${claimErr.message}`);
  const versionId = (claim as any)?.product_version_id;
  if (!versionId) return false;

  const { data: reqs, error: reqErr } = await db
    .from('bn_doc_requirement')
    .select('document_type_code, requirement_level, is_active')
    .eq('product_version_id', versionId)
    .eq('is_active', true);
  if (reqErr) throw new Error(`bn_doc_requirement could not be read: ${reqErr.message}`);

  const mandatory = (Array.isArray(reqs) ? reqs : [])
    .filter((r: any) => String(r.requirement_level ?? '').toUpperCase() === 'MANDATORY')
    .map((r: any) => String(r.document_type_code ?? '').trim().toUpperCase())
    .filter((c: string) => c !== '');
  if (mandatory.length === 0) return false;

  const { data: catalogue, error: catErr } = await db
    .from('bn_service_doc_type')
    .select('type_code');
  if (catErr) throw new Error(`bn_service_doc_type could not be read: ${catErr.message}`);
  const known = new Set(
    (Array.isArray(catalogue) ? catalogue : [])
      .map((r: any) => String(r.type_code ?? '').trim().toUpperCase()),
  );
  // No vocabulary gap -- the standard spellings govern, and this bridge is not
  // the right instrument.
  if (mandatory.some((c: string) => known.has(c))) return false;

  const held = new Set(
    present.map((r) => String(r.document_type_code ?? '').trim().toUpperCase()),
  );
  return mandatory.every((c: string) => held.has(c));
}

/**
 * Is a document of one of these types present on the claim?
 *
 * `codes` are the catalogued spellings of one document. The product's own
 * vocabulary is bridged separately, and only where it must be.
 */
async function hasClaimDocument(claimId: string, codes: string[]): Promise<boolean> {
  const present = (await claimEvidenceRows(claimId)).filter(evidenceIsPresent);
  const wanted = new Set(codes.map((c) => c.trim().toUpperCase()));
  if (present.some((r) => wanted.has(String(r.document_type_code ?? '').trim().toUpperCase()))) {
    return true;
  }
  return productMandatoryEvidenceComplete(claimId, present);
}

/* ─────── window / deceased helpers used by the new resolvers ─────── */
function isoMinusDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Paid contribution weeks for an SSN, from a window cutoff to a date.
 *
 * BUG-48 — this used to run its own query, `select('id, period')`. ip_wages has
 * no `id` column (its key is `audit_id`), so the query failed with 42703 every
 * time; the error was discarded and 0 returned. Every window rule — "at least
 * 26 paid weeks in the last 52" — was therefore judged against a phantom zero
 * and failed against every claimant who had no snapshot.
 *
 * It also counted rows rather than paid weeks, so a credited week would have
 * counted as paid even had the query worked. Both are avoided by using the one
 * implementation that reads the real columns.
 */
async function paidWeeksForSsn(
  ssn: string,
  windowKey: string | null,
  asOf: string,
): Promise<number | null> {
  const { computeContributionTotals } = await import('./contributionSnapshotService');
  const totals = await computeContributionTotals(ssn, asOf);
  if (!windowKey) return totals.paid;
  const count = totals.windowCounts[windowKey];
  return typeof count === 'number' ? count : null;
}

/**
 * The claimant's contribution record, by SSN (BUG-48).
 *
 * Delegates to `computeContributionTotals` — the same arithmetic the claim
 * snapshot is built from, over the same ip_wages columns. Two implementations
 * of "how many weeks has she paid" is how the wizard came to show 9 paid weeks
 * on its panel while the rule demanding 26 reported that it could not be
 * evaluated at all.
 *
 * Returns null when there is nothing to ask about. A failed read throws, and
 * the evaluator records UNEVALUATED — never 0, because "I could not look" and
 * "she has none" are different answers and only one is a finding against her.
 */
async function contributionsBySsn(ctx: EligibilityContext) {
  const ssn = (ctx.ssn ?? '').trim();
  const asOf = ctx.claimDate ?? null;
  if (!ssn || !asOf) return null;
  const { computeContributionTotals } = await import('./contributionSnapshotService');
  const totals = await computeContributionTotals(ssn, asOf);
  return {
    totalWeeks: totals.total,
    paidWeeks: totals.paid,
    creditedWeeks: totals.credited,
    averageWeeklyWage: totals.avg,
    lastPeriod: totals.maxP,
    windowCounts: totals.windowCounts,
  };
}

async function readWindow(
  ctx: EligibilityContext,
  jsonKey: string,
  windowDays: number,
): Promise<number | null> {
  // Snapshot first
  if (ctx.claimId) {
    const s = await loadContributionSnapshot(ctx.claimId);
    const j = (s?.contribution_json as Record<string, unknown> | null) ?? null;
    if (j && typeof j[jsonKey] === 'number') return j[jsonKey] as number;
  }
  // Live compute from ip_wages, through the same arithmetic the snapshot uses.
  if (!ctx.ssn || !ctx.claimDate) return null;
  void windowDays; // the window is named by jsonKey; the day count is its mirror
  return paidWeeksForSsn(ctx.ssn, jsonKey, ctx.claimDate);
}

async function resolveDeceasedSsn(ctx: EligibilityContext): Promise<string | null> {
  const fromExtras = ctx.extras?.['deceased_ssn'];
  if (typeof fromExtras === 'string' && fromExtras) return fromExtras;
  if (!ctx.claimId) return null;
  const { data } = await db
    .from('bn_claim_participant')
    .select('ssn, participant_type, participant_role')
    .eq('claim_id', ctx.claimId)
    .limit(20);
  if (!Array.isArray(data)) return null;
  const match = data.find((r: any) => {
    const t = String(r.participant_type ?? r.participant_role ?? '').toUpperCase();
    return t.includes('DECEAS') || t === 'INSURED_DECEASED';
  });
  return match?.ssn ?? null;
}

async function deceasedWindowOrSnapshot(
  ctx: EligibilityContext,
  kind: 'total' | 'paid',
  windowDays: number | null,
): Promise<number | null> {
  const ssn = await resolveDeceasedSsn(ctx);
  if (!ssn) return null;
  // No deceased snapshot table — compute live from ip_wages keyed by deceased SSN.
  const to = ctx.claimDate ?? new Date().toISOString().slice(0, 10);
  const { computeContributionTotals } = await import('./contributionSnapshotService');
  const totals = await computeContributionTotals(ssn, to);
  if (windowDays === null) {
    // Unwindowed: the whole record. `total` counts every week on record,
    // `paid` only the weeks actually paid -- a distinction the previous
    // implementation collapsed by counting rows for both.
    return kind === 'total' ? totals.total : totals.paid;
  }
  // Name the window the snapshot already counted rather than recounting it.
  // SNAPSHOT_WINDOW_DAYS is the one definition of what each key spans.
  const { SNAPSHOT_WINDOW_DAYS } = await import('./contributionSnapshotService');
  const key = Object.keys(totals.windowCounts).find(
    (k) => SNAPSHOT_WINDOW_DAYS[k] === windowDays,
  );
  return key ? totals.windowCounts[key] : null;
}



const RESOLVERS: Record<string, ResolverFn> = {
  // Person
  resolvePersonAge: async (ctx) => {
    if (!ctx.ssn || !ctx.claimDate) return null;
    const ip = await loadIpMaster(ctx.ssn);
    if (!ip?.dob) return null;
    return yearsBetween(ip.dob, ctx.claimDate);
  },
  resolvePersonGender: async (ctx) => {
    if (!ctx.ssn) return null;
    const ip = await loadIpMaster(ctx.ssn);
    return ip?.sex ?? null;
  },
  resolvePersonAlive: async (ctx) => {
    if (!ctx.ssn) return null;
    const ip = await loadIpMaster(ctx.ssn);
    if (!ip) return null;
    if (ip.date_died) return 'DECEASED';
    const status = (ip.status ?? '').toString().toUpperCase();
    if (status.includes('DECEAS')) return 'DECEASED';
    return 'ALIVE';
  },

  // Contribution — snapshot first, then the claimant's own record by SSN.
  //
  // BUG-48 — each of these used to give up on `!ctx.claimId` and return null.
  // At intake the claim does not exist yet, so the guard fired on every
  // registration: every contribution rule came back UNEVALUATED, the verdict
  // was NOT_DETERMINED, and no product carrying a contribution rule could be
  // registered at all. The wizard was meanwhile displaying those very numbers
  // in its own Contribution Window panel, read by SSN.
  //
  // Contributions belong to the person, not to the claim. The snapshot is
  // preferred once it exists — it is what the claim was decided on and must not
  // drift — but its absence is not ignorance.
  resolveContribTotalWeeks: async (ctx) => {
    const s = ctx.claimId ? await loadContributionSnapshot(ctx.claimId) : null;
    if (s?.total_weeks != null) return s.total_weeks;
    const live = await contributionsBySsn(ctx);
    return live ? live.totalWeeks : null;
  },
  resolveContribPaidWeeks: async (ctx) => {
    const s = ctx.claimId ? await loadContributionSnapshot(ctx.claimId) : null;
    if (s?.paid_weeks != null) return s.paid_weeks;
    const live = await contributionsBySsn(ctx);
    return live ? live.paidWeeks : null;
  },
  resolveContribRecentWeeks: async (ctx) => {
    const s = ctx.claimId ? await loadContributionSnapshot(ctx.claimId) : null;
    const j = (s?.contribution_json as Record<string, unknown> | null) ?? null;
    if (j && typeof j['recent_weeks'] === 'number') return j['recent_weeks'];
    // "Recent" is the product's own window; 52 weeks is the registry default
    // the wizard's panel also uses.
    const live = await contributionsBySsn(ctx);
    return live ? live.totalWeeks : null;
  },
  resolveContribCreditedWeeks: async (ctx) => {
    const s = ctx.claimId ? await loadContributionSnapshot(ctx.claimId) : null;
    if (s?.credited_weeks != null) return s.credited_weeks;
    const live = await contributionsBySsn(ctx);
    return live ? live.creditedWeeks : null;
  },
  resolveContribWeeksLast13: async (ctx) => readWindow(ctx, 'window_13', 13 * 7),
  resolveContribWeeksLast26: async (ctx) => readWindow(ctx, 'window_26', 26 * 7),
  resolveContribWeeksLast39: async (ctx) => readWindow(ctx, 'window_39', 39 * 7),
  resolveContribWeeksLast52: async (ctx) => readWindow(ctx, 'window_52', 52 * 7),
  resolveContribWeeksLast12Months: async (ctx) => readWindow(ctx, 'window_12m', 365),
  resolveContribAvgWage: async (ctx) => {
    const s = ctx.claimId ? await loadContributionSnapshot(ctx.claimId) : null;
    if (s?.average_weekly_wage != null) return s.average_weekly_wage;
    const live = await contributionsBySsn(ctx);
    return live ? live.averageWeeklyWage : null;
  },
  resolveContribLastDate: async (ctx) => {
    const s = ctx.claimId ? await loadContributionSnapshot(ctx.claimId) : null;
    if (s?.period_to != null) return s.period_to;
    const live = await contributionsBySsn(ctx);
    return live ? live.lastPeriod : null;
  },

  // Deceased contributor (Funeral / Survivors). Snapshot is keyed by deceased SSN
  // when context.extras.deceased_ssn is set; otherwise we compute live from ip_wages.
  resolveDeceasedContribTotalWeeks: async (ctx) => deceasedWindowOrSnapshot(ctx, 'total', null),
  resolveDeceasedContribPaidWeeks: async (ctx) => deceasedWindowOrSnapshot(ctx, 'paid', null),
  resolveDeceasedContribRecentWeeks: async (ctx) => deceasedWindowOrSnapshot(ctx, 'paid', 13 * 7),
  resolveDeceasedContribWeeksLast12Months: async (ctx) => deceasedWindowOrSnapshot(ctx, 'paid', 365),


  // Employer
  resolveEmployerExists: async (ctx) => {
    if (ctx.employerRegno) {
      const er = await loadEmployer(ctx.employerRegno);
      return Boolean(er);
    }
    if (!ctx.claimId) return false;
    const c = await loadClaim(ctx.claimId);
    if (!c?.employer_regno) return false;
    const er = await loadEmployer(c.employer_regno);
    return Boolean(er);
  },
  resolveEmployerStatus: async (ctx) => {
    let regno = ctx.employerRegno ?? null;
    if (!regno && ctx.claimId) {
      const c = await loadClaim(ctx.claimId);
      regno = c?.employer_regno ?? null;
    }
    if (!regno) return null;
    const er = await loadEmployer(regno);
    if (!er?.status) return null;
    const s = String(er.status).toUpperCase();
    if (s.startsWith('A')) return 'ACTIVE';
    if (s.startsWith('C')) return 'CEASED';
    return 'PENDING';
  },
  resolveEmployerActiveOnInjuryDate: async (ctx) => {
    if (!ctx.claimId) return false;
    const c = await loadClaim(ctx.claimId);
    const regno = ctx.employerRegno ?? c?.employer_regno ?? null;
    const injuryDate = (ctx.extras?.['injury_date'] as string | undefined) ?? c?.claim_date ?? null;
    if (!regno || !injuryDate) return false;
    const er = await loadEmployer(regno);
    if (!er) return false;
    if (er.date_of_closure && er.date_of_closure < injuryDate) return false;
    if (er.registration_date && er.registration_date > injuryDate) return false;
    return String(er.status ?? '').toUpperCase().startsWith('A');
  },

  // Claim event
  resolveClaimInjuryDate: async (ctx) => {
    if (ctx.extras && typeof ctx.extras['injury_date'] === 'string') {
      return ctx.extras['injury_date'];
    }
    if (!ctx.claimId) return null;
    const c = await loadClaim(ctx.claimId);
    return c?.claim_date ?? null;
  },
  resolveClaimSubmissionDate: async (ctx) => {
    if (!ctx.claimId) return null;
    const c = await loadClaim(ctx.claimId);
    return c?.submission_date ?? null;
  },
  resolveClaimDaysSinceEvent: async (ctx) => {
    if (!ctx.claimId) return null;
    const c = await loadClaim(ctx.claimId);
    const evt = (ctx.extras?.['injury_date'] as string | undefined) ?? c?.claim_date ?? null;
    const sub = c?.submission_date ?? ctx.claimDate ?? new Date().toISOString().slice(0, 10);
    if (!evt) return null;
    const ms = Date.parse(sub) - Date.parse(evt);
    if (!Number.isFinite(ms)) return null;
    return Math.floor(ms / 86_400_000);
  },
  resolveClaimChannel: async (ctx) => {
    if (!ctx.claimId) return null;
    const c = await loadClaim(ctx.claimId);
    return c?.application_channel ?? c?.channel_code ?? null;
  },

  // Documents
  resolveDocMedicalCert: async (ctx) => {
    if (!ctx.claimId) return false;
    return hasClaimDocument(ctx.claimId, ['MEDICAL_CERT', 'MED_CERT', 'MEDICAL_CERTIFICATE']);
  },
  resolveDocDeathCert: async (ctx) => {
    if (!ctx.claimId) return false;
    return hasClaimDocument(ctx.claimId, ['DEATH_CERT', 'DEATH_CERTIFICATE']);
  },
  resolveDocBirthCert: async (ctx) => {
    if (!ctx.claimId) return false;
    return hasClaimDocument(ctx.claimId, ['BIRTH_CERT', 'BIRTH_CERTIFICATE']);
  },
  resolveDocEmployerReport: async (ctx) => {
    if (!ctx.claimId) return false;
    return hasClaimDocument(ctx.claimId, ['EMPLOYER_RPT', 'EMPLOYER_REPORT', 'ACCIDENT_REPORT']);
  },

  // Existing benefits
  resolveActiveAward: async (ctx) => {
    if (!ctx.ssn) return false;
    const { data } = await db
      .from('bn_award')
      .select('id, status')
      .eq('ssn', ctx.ssn)
      .eq('status', 'ACTIVE')
      .limit(1);
    return Array.isArray(data) && data.length > 0;
  },
  resolveDuplicateClaim: async (ctx) => {
    if (!ctx.ssn || !ctx.productCode) return false;
    const { data } = await db
      .from('bn_claim')
      .select('id, status, product:bn_product(benefit_code, code)')
      .eq('ssn', ctx.ssn)
      .neq('id', ctx.claimId ?? '')
      .in('status', ['OPEN', 'IN_REVIEW', 'APPROVED', 'PENDING'])
      .limit(50);
    if (!Array.isArray(data)) return false;
    return data.some((r: any) => {
      const code = r.product?.benefit_code ?? r.product?.code ?? null;
      return code === ctx.productCode;
    });
  },
  resolvePreviousMaternity: async (ctx) => {
    if (!ctx.ssn) return false;
    const { data } = await db
      .from('bn_claim')
      .select('id, product:bn_product(benefit_code, code)')
      .eq('ssn', ctx.ssn)
      .neq('id', ctx.claimId ?? '')
      .order('claim_date', { ascending: false })
      .limit(50);
    if (!Array.isArray(data)) return false;
    return data.some((r: any) => {
      const code = String(r.product?.benefit_code ?? r.product?.code ?? '').toUpperCase();
      return code.includes('MAT');
    });
  },

  // ───────── Phase 3 additions ─────────
  // Claim date facts (fall back to context.extras / claim columns when present)
  resolveClaimReportedDate: async (ctx) => {
    if (typeof ctx.extras?.['reported_date'] === 'string') return ctx.extras['reported_date'];
    if (!ctx.claimId) return null;
    const { data } = await db.from('bn_claim').select('id, reported_date, submission_date').eq('id', ctx.claimId).maybeSingle();
    return (data as any)?.reported_date ?? null;
  },
  resolveClaimSicknessStartDate: async (ctx) => {
    if (typeof ctx.extras?.['sickness_start_date'] === 'string') return ctx.extras['sickness_start_date'];
    if (!ctx.claimId) return null;
    const { data } = await db.from('bn_claim').select('id, sickness_start_date, claim_date').eq('id', ctx.claimId).maybeSingle();
    return (data as any)?.sickness_start_date ?? (data as any)?.claim_date ?? null;
  },
  resolveClaimMaternityExpectedDate: async (ctx) => {
    if (typeof ctx.extras?.['expected_confinement_date'] === 'string') return ctx.extras['expected_confinement_date'];
    if (!ctx.claimId) return null;
    const { data } = await db.from('bn_claim').select('id, expected_confinement_date').eq('id', ctx.claimId).maybeSingle();
    return (data as any)?.expected_confinement_date ?? null;
  },
  resolveClaimDeathDate: async (ctx) => {
    if (typeof ctx.extras?.['death_date'] === 'string') return ctx.extras['death_date'];
    if (!ctx.claimId) return null;
    const { data } = await db.from('bn_claim').select('id, death_date').eq('id', ctx.claimId).maybeSingle();
    return (data as any)?.death_date ?? null;
  },
  resolveClaimLastWorkedDate: async (ctx) => {
    if (typeof ctx.extras?.['last_worked_date'] === 'string') return ctx.extras['last_worked_date'];
    if (!ctx.claimId) return null;
    const { data } = await db.from('bn_claim').select('id, last_worked_date').eq('id', ctx.claimId).maybeSingle();
    return (data as any)?.last_worked_date ?? null;
  },

  // Document status (vs existence). Returns the verification_status of the most recent document of the type.
  ...(() => {
    // BUG-47 — this read `bn_claim_document` too, and its column names differ:
    // bn_claim_evidence carries `status` / `entered_at`, not
    // `verification_status` / `uploaded_at`. Selecting the absent columns would
    // have failed the whole query (42703) even after the table was corrected.
    const make = (codes: string[]) => async (ctx: EligibilityContext) => {
      if (!ctx.claimId) return null;
      const wanted = new Set(codes.map((c) => c.trim().toUpperCase()));
      const rows = await claimEvidenceRows(ctx.claimId);
      const mine = rows.filter(
        (r) => wanted.has(String(r.document_type_code ?? '').trim().toUpperCase()) && !r.rejected_at,
      );
      if (mine.length === 0) {
        // The product may name the document with a code of its own (MED-003).
        // Only when its whole mandatory set is in can a status be asserted.
        const complete = await productMandatoryEvidenceComplete(
          ctx.claimId,
          rows.filter(evidenceIsPresent),
        );
        return complete ? 'VERIFIED' : 'PENDING';
      }
      // Verified beats received: a claim holding both an accepted copy and a
      // superseded one has a verified document.
      const verified = mine.find((r) => r.verified_at || r.waived_at);
      const chosen = verified ?? mine[0];
      const status = String(chosen.status ?? '').trim().toUpperCase();
      if (chosen.waived_at) return 'WAIVED';
      if (chosen.verified_at) return 'VERIFIED';
      return status || 'RECEIVED';
    };
    return {
      resolveDocStatusMedicalCert: make(['MEDICAL_CERT', 'MED_CERT', 'MEDICAL_CERTIFICATE']),
      resolveDocStatusDeathCert: make(['DEATH_CERT', 'DEATH_CERTIFICATE']),
      resolveDocStatusEmployerReport: make(['EMPLOYER_RPT', 'EMPLOYER_REPORT', 'ACCIDENT_REPORT']),
      resolveDocStatusFuneralInvoice: make(['FUNERAL_INVOICE', 'FUN_INVOICE']),
      resolveDocStatusSchoolCert: make(['SCHOOL_CERT', 'SCHOOL_CERTIFICATE']),
      resolveDocStatusLifeCert: make(['LIFE_CERT', 'LIFE_CERTIFICATE']),
      resolveDocStatusBirthCert: make(['BIRTH_CERT', 'BIRTH_CERTIFICATE']),
      /**
       * BUG-31 — any `document.<code>.status` fact, not only the seven named
       * above. Products attach document rules faster than the registry gains
       * named entries, and an unregistered one used to block every claim on
       * that product. The document type code is derived from the fact key.
       */
      resolveDocStatusByPattern: async (ctx: EligibilityContext) => {
        const factKey = String(ctx.extras?.['__fact_key'] ?? '');
        const m = /^document\.(.+)\.status$/.exec(factKey);
        if (!m) return null;
        const base = m[1].toUpperCase();
        const codes = Array.from(new Set([
          base,
          base.replace(/_CERTIFICATE$/, '_CERT'),
          base.replace(/_CERT$/, '_CERTIFICATE'),
          base.replace(/_REPORT$/, '_RPT'),
          base.replace(/_RPT$/, '_REPORT'),
        ]));
        return make(codes)(ctx);
      },
    };
  })(),

  // Existing benefits — extended
  resolvePriorEmploymentInjury: async (ctx) => {
    if (!ctx.ssn) return false;
    const { data } = await db
      .from('bn_claim')
      .select('id, product:bn_product(benefit_code, code)')
      .eq('ssn', ctx.ssn)
      .neq('id', ctx.claimId ?? '')
      .limit(50);
    if (!Array.isArray(data)) return false;
    return data.some((r: any) => {
      const code = String(r.product?.benefit_code ?? r.product?.code ?? '').toUpperCase();
      return code === 'SKN-EI' || code.startsWith('SKN-EI');
    });
  },
  resolveContributoryPensionExists: async (ctx) => {
    if (!ctx.ssn) return false;
    const { data } = await db
      .from('bn_award')
      .select('id, status, product:bn_product(benefit_code, code)')
      .eq('ssn', ctx.ssn)
      .eq('status', 'ACTIVE')
      .limit(50);
    if (!Array.isArray(data)) return false;
    return data.some((r: any) => {
      const code = String(r.product?.benefit_code ?? r.product?.code ?? '').toUpperCase();
      return code === 'SKN-AGE' || code === 'SKN-INV' || code === 'SKN-SURV';
    });
  },
  resolveActiveSurvivorChildAward: async (ctx) => {
    if (!ctx.ssn) return false;
    const { data } = await db
      .from('bn_award_beneficiary')
      .select('id, relationship, is_active')
      .eq('beneficiary_ssn', ctx.ssn)
      .limit(10);
    if (!Array.isArray(data)) return false;
    return data.some((r: any) => String(r.relationship ?? '').toUpperCase().includes('CHILD') && r.is_active !== false);
  },

  // Medical / Medical Board — try real table, fall back to notImplemented signal
  resolveMedicalDisablementPct: async (ctx) => {
    if (!ctx.claimId) return null;
    const { data, error } = await db
      .from('bn_medical_recommendation')
      .select('disablement_pct')
      .eq('claim_id', ctx.claimId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return (data as any)?.disablement_pct ?? null;
  },
  resolveMedicalBoardDecision: async (ctx) => {
    if (!ctx.claimId) return null;
    // bn_medical_recommendation has no `decision` column — it is `board_decision`.
    // Selecting the wrong name made PostgREST return 42703, so this resolver
    // returned null for every claim and the rule could never be evaluated.
    const { data, error } = await db
      .from('bn_medical_recommendation')
      .select('board_decision')
      .eq('claim_id', ctx.claimId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return (data as any)?.board_decision ?? null;
  },
  resolveMedicalInvalidityConfirmed: async (ctx) => {
    if (!ctx.claimId) return false;
    const { data, error } = await db
      .from('bn_medical_recommendation')
      .select('board_decision')
      .eq('claim_id', ctx.claimId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return false;
    return String((data as any)?.board_decision ?? '').toUpperCase() === 'APPROVED';
  },

  /**
   * BUG-32 — the Maternity Grant may be established on the contributions of the
   * insured husband rather than the claimant's own. SSB's own claim form asks
   * "Are you the wife of an insured man?", and its guidance states the grant can
   * be paid on the husband's record where the mother does not qualify herself.
   *
   * The claimant is still the woman; only the CONTRIBUTION BASIS moves. These
   * facts therefore resolve the spouse's contribution record, leaving every
   * claimant-identity fact (gender, age, status) pointed at the claimant.
   */
  ...(() => {
    const spouseSummary = async (ctx: EligibilityContext, field: string) => {
      if (!ctx.ssn || !ctx.claimDate) return null;
      const ip = await loadIpMaster(ctx.ssn);
      const spouseSsn = (ip as any)?.spouse_ssn ?? null;
      // No spouse recorded is not "zero contributions" — it is unknown, and a
      // rule on this basis must not be judged against a value we do not have.
      if (!spouseSsn) return null;
      const { data, error } = await db.rpc('bn_get_contribution_summary', {
        p_ssn: spouseSsn,
        p_from_date: '1900-01-01',
        p_to_date: ctx.claimDate,
      });
      if (error) return null;
      const row = (Array.isArray(data) ? data[0] : data) ?? null;
      if (!row) return null;
      const v = (row as any)[field];
      return v === null || v === undefined ? null : Number(v);
    };
    return {
      resolveSpouseContributionTotalWeeks: (ctx: EligibilityContext) =>
        spouseSummary(ctx, 'total_weeks'),
      resolveSpouseContributionPaidWeeks: (ctx: EligibilityContext) =>
        spouseSummary(ctx, 'paid_weeks'),
      resolveSpouseIsInsured: async (ctx: EligibilityContext) => {
        if (!ctx.ssn) return null;
        const ip = await loadIpMaster(ctx.ssn);
        const spouseSsn = (ip as any)?.spouse_ssn ?? null;
        if (!spouseSsn) return null;
        const spouse = await loadIpMaster(spouseSsn);
        if (!spouse) return false;
        return String((spouse as any).status ?? '').toUpperCase() === 'A'
          || String((spouse as any).status ?? '').toUpperCase() === 'ACTIVE';
      },
    };
  })(),

  /**
   * Facts whose rules were already configured but had no resolver, so every
   * claim on those products was held for manual review. Each reads a column
   * that already exists — nothing here is derived from a table that had to be
   * created, and none of them returns a value it cannot substantiate.
   */
  resolveMedicalBoardDecisionPresent: async (ctx) => {
    if (!ctx.claimId) return false;
    const { data, error } = await db
      .from('bn_medical_recommendation')
      .select('id, board_decision')
      .eq('claim_id', ctx.claimId)
      .limit(1);
    if (error) return false;
    return Array.isArray(data) && data.length > 0 && !!(data[0] as any).board_decision;
  },

  resolvePersonAgeAtFirstRegistration: async (ctx) => {
    if (!ctx.ssn) return null;
    const ip = await loadIpMaster(ctx.ssn);
    if (!ip?.dob || !(ip as any).registration_date) return null;
    return yearsBetween(ip.dob, (ip as any).registration_date);
  },

  resolveDeathConfirmed: async (ctx) => {
    // The claim records the death date for a survivors/funeral claim; the
    // insured person's own record is the fallback.
    if (ctx.claimId) {
      const { data } = await db
        .from('bn_claim')
        .select('id, death_date')
        .eq('id', ctx.claimId)
        .maybeSingle();
      if ((data as any)?.death_date) return true;
    }
    if (!ctx.ssn) return null;
    const ip = await loadIpMaster(ctx.ssn);
    if (!ip) return null;
    return !!(ip as any).date_died;
  },

  resolveWeeksToExpectedConfinement: async (ctx) => {
    if (!ctx.claimId) return null;
    const { data } = await db
      .from('bn_claim')
      .select('id, claim_date, expected_confinement_date')
      .eq('id', ctx.claimId)
      .maybeSingle();
    const row = data as any;
    if (!row?.expected_confinement_date || !row?.claim_date) return null;
    const days = Math.floor(
      (Date.parse(row.expected_confinement_date) - Date.parse(row.claim_date)) / 86_400_000,
    );
    return Number.isFinite(days) ? days / 7 : null;
  },

  resolveContinuousIllnessDays: async (ctx) => {
    if (!ctx.claimId) return null;
    const { data } = await db
      .from('bn_claim')
      .select('id, claim_date, sickness_start_date')
      .eq('id', ctx.claimId)
      .maybeSingle();
    const row = data as any;
    if (!row?.sickness_start_date) return null;
    const to = row.claim_date ?? ctx.claimDate;
    if (!to) return null;
    const days = Math.floor((Date.parse(to) - Date.parse(row.sickness_start_date)) / 86_400_000);
    return Number.isFinite(days) ? days : null;
  },

  resolveApprovedExpenseAmount: async (ctx) => {
    if (!ctx.claimId) return null;
    const { data, error } = await db
      .from('bn_medical_claim_expense')
      .select('approved_amount')
      .eq('claim_id', ctx.claimId);
    if (error || !Array.isArray(data)) return null;
    // No expense rows means nothing has been approved yet — a real zero, not
    // an unknown, so the rule can be compared against its threshold.
    return data.reduce((sum: number, r: any) => sum + Number(r.approved_amount ?? 0), 0);
  },

  resolveWeeksSincePriorSickness: async (ctx) => {
    if (!ctx.ssn || !ctx.claimDate) return null;
    const { data } = await db
      .from('bn_claim')
      .select('id, ssn, claim_date, sickness_start_date')
      .eq('ssn', ctx.ssn)
      .neq('id', ctx.claimId ?? '')
      .not('sickness_start_date', 'is', null)
      .lt('claim_date', ctx.claimDate)
      .order('claim_date', { ascending: false })
      .limit(1);
    const prior = Array.isArray(data) ? (data[0] as any) : null;
    if (!prior?.claim_date) return null;
    const days = Math.floor((Date.parse(ctx.claimDate) - Date.parse(prior.claim_date)) / 86_400_000);
    return Number.isFinite(days) ? days / 7 : null;
  },

  resolveQualifyingSurvivor: async (ctx) => {
    if (!ctx.claimId) return null;
    const { data } = await db
      .from('bn_claim_participant')
      .select('id, relationship_to_insured, participant_role')
      .eq('claim_id', ctx.claimId)
      .limit(50);
    if (!Array.isArray(data) || data.length === 0) return null;
    const QUALIFYING = new Set([
      'SPOUSE', 'WIDOW', 'WIDOWER', 'CHILD', 'DEPENDENT_CHILD',
      'PARENT', 'DEPENDENT_PARENT',
    ]);
    const relationships = data
      .map((r: any) => String(r.relationship_to_insured ?? '').trim().toUpperCase())
      .filter(Boolean);
    // Relationship not captured on any participant — unknown, not "false".
    if (relationships.length === 0) return null;
    return relationships.some((r) => QUALIFYING.has(r));
  },

  resolveSpouseRelationshipValid: async (ctx) => {
    if (!ctx.claimId) return null;
    const { data } = await db
      .from('bn_claim_participant')
      .select('id, relationship_to_insured')
      .eq('claim_id', ctx.claimId)
      .limit(50);
    if (!Array.isArray(data)) return null;
    const relationships = data
      .map((r: any) => String(r.relationship_to_insured ?? '').trim().toUpperCase())
      .filter(Boolean);
    if (relationships.length === 0) return null;
    return relationships.some((r) => ['SPOUSE', 'WIDOW', 'WIDOWER'].includes(r));
  },

  resolveBeneficiaryChildAge: async (ctx) => {
    if (!ctx.claimId || !ctx.claimDate) return null;
    const { data } = await db
      .from('bn_claim_participant')
      .select('id, ssn, relationship_to_insured, participant_role')
      .eq('claim_id', ctx.claimId)
      .limit(50);
    if (!Array.isArray(data)) return null;
    const children = data.filter((r: any) => {
      const rel = String(r.relationship_to_insured ?? '').trim().toUpperCase();
      const role = String(r.participant_role ?? '').trim().toUpperCase();
      return rel.includes('CHILD') || role.includes('CHILD');
    });
    if (children.length === 0) return null;
    // The youngest child governs a child-age ceiling rule.
    const ages: number[] = [];
    for (const child of children as any[]) {
      if (!child.ssn) continue;
      const ip = await loadIpMaster(child.ssn);
      if (ip?.dob) ages.push(yearsBetween(ip.dob, ctx.claimDate));
    }
    return ages.length > 0 ? Math.min(...ages) : null;
  },

  // Beneficiary / Applicant / Payment / Means test — pragmatic implementations
  resolveBeneficiaryRelationshipValid: async (ctx) => {
    if (!ctx.claimId) return false;
    const { data } = await db
      .from('bn_award_beneficiary')
      .select('id, relationship')
      .eq('claim_id', ctx.claimId)
      .limit(10);
    if (!Array.isArray(data)) return false;
    const allowed = ['SPOUSE', 'CHILD', 'PARENT', 'DEPENDENT'];
    return data.some((r: any) => allowed.includes(String(r.relationship ?? '').toUpperCase()));
  },
  resolveBeneficiaryStudentStatus: async (ctx) => {
    if (!ctx.claimId) return 'PENDING';
    const { data } = await db
      .from('bn_award_beneficiary')
      .select('id, is_student, student_verification_status')
      .eq('claim_id', ctx.claimId)
      .limit(10);
    if (!Array.isArray(data) || data.length === 0) return 'PENDING';
    const row = data[0] as any;
    return row.student_verification_status ?? (row.is_student ? 'VERIFIED' : 'PENDING');
  },
  resolveFuneralResponsibilityConfirmed: async (ctx) => {
    if (!ctx.claimId) return false;
    const { data } = await db.from('bn_claim').select('id, applicant_attestation').eq('id', ctx.claimId).maybeSingle();
    return Boolean((data as any)?.applicant_attestation);
  },
  resolvePaymentBankDetailsValid: async (ctx) => {
    if (!ctx.ssn) return false;
    // BUG-54: named `is_verified` and `is_active`. bn_payment_profile carries
    // `verification_status` and `active`, so the select failed with 42703, data
    // came back null, and the guard below returned false. This fact reported
    // "bank details are not valid" for every claimant, including those with a
    // verified profile. award360SummaryService already uses the right spelling.
    const { data, error } = await db
      .from('bn_payment_profile')
      .select('id, verification_status, active')
      .eq('ssn', ctx.ssn)
      .eq('active', true)
      .limit(5);
    // A read that did not happen is not evidence that the details are invalid.
    if (error) throw new Error(`bn_payment_profile could not be read: ${error.message}`);
    if (!Array.isArray(data)) return false;
    return data.some(
      (r: any) => String(r.verification_status ?? '').toUpperCase() === 'VERIFIED',
    );
  },
  resolveMeansTestResult: async (_ctx) => {
    // NOT_IMPLEMENTED — backing table to be introduced
    return null;
  },

  // Injury — work-related flag sourced from claim detail / application JSON
  resolveInjuryWorkRelated: async (ctx) => {
    if (typeof ctx.extras?.['work_related'] === 'boolean') return ctx.extras['work_related'];
    if (!ctx.claimId) return null;
    const aliases = ['work_related', 'is_work_related', 'employment_injury_work_related'];
    const pick = (obj: any): boolean | null => {
      if (!obj || typeof obj !== 'object') return null;
      for (const k of aliases) {
        if (typeof obj[k] === 'boolean') return obj[k];
        if (typeof obj[k] === 'string') {
          const s = obj[k].toLowerCase();
          if (['true', 'yes', 'y', '1'].includes(s)) return true;
          if (['false', 'no', 'n', '0'].includes(s)) return false;
        }
      }
      return null;
    };
    const { data: detail } = await db
      .from('bn_claim_detail')
      .select('detail_json')
      .eq('claim_id', ctx.claimId)
      .maybeSingle();
    const dj = (detail as any)?.detail_json;
    const fromDetail = pick(dj) ?? pick(dj?.injury) ?? pick(dj?.benefit_facts);
    if (fromDetail !== null) return fromDetail;
    const { data: app } = await db
      .from('bn_claim_application')
      .select('raw_application_json')
      .eq('claim_id', ctx.claimId)
      .maybeSingle();
    const raw = (app as any)?.raw_application_json;
    return pick(raw?.benefit_facts) ?? pick(raw?.benefit_facts?.injury) ?? pick(raw) ?? null;
  },

  // Means test — income from claim detail / application
  resolveMeansTestIncome: async (ctx) => {
    if (typeof ctx.extras?.['means_test_income'] === 'number') return ctx.extras['means_test_income'];
    if (!ctx.claimId) return null;
    const aliases = ['income', 'monthly_income', 'household_income', 'total_income'];
    const pick = (obj: any): number | null => {
      if (!obj || typeof obj !== 'object') return null;
      for (const k of aliases) {
        const v = obj[k];
        if (typeof v === 'number' && Number.isFinite(v)) return v;
        if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
      }
      return null;
    };
    const { data: detail } = await db
      .from('bn_claim_detail')
      .select('detail_json')
      .eq('claim_id', ctx.claimId)
      .maybeSingle();
    const dj = (detail as any)?.detail_json;
    const fromDetail = pick(dj?.means_test) ?? pick(dj);
    if (fromDetail !== null) return fromDetail;
    const { data: app } = await db
      .from('bn_claim_application')
      .select('raw_application_json')
      .eq('claim_id', ctx.claimId)
      .maybeSingle();
    const raw = (app as any)?.raw_application_json;
    return pick(raw?.benefit_facts?.means_test) ?? pick(raw?.benefit_facts) ?? null;
  },

  // Funeral invoice received (document existence) and amount (from metadata)
  resolveDocFuneralInvoice: async (ctx) => {
    if (!ctx.claimId) return false;
    return hasClaimDocument(ctx.claimId, ['FUNERAL_INVOICE', 'FUN_INVOICE']);
  },
  resolveDocFuneralInvoiceAmount: async (ctx) => {
    if (typeof ctx.extras?.['funeral_invoice_amount'] === 'number') {
      return ctx.extras['funeral_invoice_amount'];
    }
    if (!ctx.claimId) return null;
    // BUG-47 — bn_claim_document is empty; the amount lives on the evidence row.
    const { data, error } = await db
      .from('bn_claim_evidence')
      .select('document_type_code, metadata, entered_at, rejected_at')
      .eq('claim_id', ctx.claimId)
      .in('document_type_code', ['FUNERAL_INVOICE', 'FUN_INVOICE'])
      .order('entered_at', { ascending: false })
      .limit(5);
    if (error) throw new Error(`bn_claim_evidence could not be read: ${error.message}`);
    const usable = (Array.isArray(data) ? data : []).filter((r: any) => !r.rejected_at);
    if (usable.length === 0) return null;
    const meta = (usable[0] as any).metadata ?? {};
    const candidates = [meta.amount, meta.invoice_amount, meta.total];
    for (const v of candidates) {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
    }
    return null;
  },
};

/** `document.<type_code>.status` facts resolve by pattern, without a registry entry. */
export const DOCUMENT_STATUS_FACT_PATTERN = /^document\.[a-z0-9_]+\.status$/;

/** Resolve a single fact. Throws on unknown fact keys. */
export async function resolveFact(
  factKey: string,
  ctx: EligibilityContext,
): Promise<FactResolution> {
  const def = getFact(factKey);

  // BUG-31 — an unregistered document-status fact is resolvable from its key
  // alone, so it must not be treated as unknown (which would block the claim).
  if (!def && DOCUMENT_STATUS_FACT_PATTERN.test(factKey)) {
    let value: unknown = null;
    let reason: string | undefined;
    try {
      value = await RESOLVERS.resolveDocStatusByPattern({
        ...ctx,
        extras: { ...(ctx.extras ?? {}), __fact_key: factKey },
      });
    } catch (e: any) {
      reason = e?.message ?? 'resolver failed';
    }
    return {
      fact_key: factKey,
      value,
      source_table: 'bn_claim_evidence',
      source_column: 'status',
      resolved_at: new Date().toISOString(),
      reason,
    };
  }

  if (!def) {
    throw new Error(`Unknown eligibility fact: "${factKey}". Add it to the registry first.`);
  }
  const fn = RESOLVERS[def.resolver_function];
  if (!fn) {
    throw new Error(
      `No resolver "${def.resolver_function}" registered for fact "${factKey}".`,
    );
  }
  let value: unknown = null;
  let reason: string | undefined;
  try {
    value = await fn(ctx);
  } catch (e: any) {
    reason = e?.message ?? 'resolver failed';
  }
  return {
    fact_key: factKey,
    value,
    source_table: def.source_table,
    source_column: def.source_column,
    resolved_at: new Date().toISOString(),
    reason,
  };
}

/** Convenience: resolve many facts in parallel, preserving order. */
export async function resolveFacts(
  factKeys: string[],
  ctx: EligibilityContext,
): Promise<FactResolution[]> {
  return Promise.all(factKeys.map((k) => resolveFact(k, ctx)));
}

/** List all registered resolver names — used by the validator. */
export function getRegisteredResolverNames(): string[] {
  return Object.keys(RESOLVERS);
}
