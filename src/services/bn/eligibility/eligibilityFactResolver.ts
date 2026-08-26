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

async function hasClaimDocument(claimId: string, codes: string[]): Promise<boolean> {
  const { data } = await db
    .from('bn_claim_document')
    .select('id, document_type_code')
    .eq('claim_id', claimId)
    .in('document_type_code', codes)
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

/* ─────── window / deceased helpers used by the new resolvers ─────── */
function isoMinusDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function countPaidWeeksForSsn(ssn: string, fromIso: string | null, toIso: string | null): Promise<number> {
  let q = db.from('ip_wages').select('id, period', { count: 'exact', head: false }).eq('ssn', ssn);
  if (fromIso) q = q.gte('period', fromIso);
  if (toIso) q = q.lte('period', toIso);
  q = q.limit(2000);
  const { data } = await q;
  return Array.isArray(data) ? data.length : 0;
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
  // Live compute from ip_wages
  if (!ctx.ssn || !ctx.claimDate) return null;
  const from = isoMinusDays(ctx.claimDate, windowDays);
  return countPaidWeeksForSsn(ctx.ssn, from, ctx.claimDate);
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
  const from = windowDays ? isoMinusDays(to, windowDays) : null;
  const weeks = await countPaidWeeksForSsn(ssn, from, to);
  // For `total` with no window we already returned all rows; that equals total weeks.
  // For `paid` we also return distinct weeks (live computation = paid-only periods).
  void kind;
  return weeks;
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

  // Contribution (snapshot-first, falls back to null when no snapshot yet)
  resolveContribTotalWeeks: async (ctx) => {
    if (!ctx.claimId) return null;
    const s = await loadContributionSnapshot(ctx.claimId);
    return s?.total_weeks ?? null;
  },
  resolveContribPaidWeeks: async (ctx) => {
    if (!ctx.claimId) return null;
    const s = await loadContributionSnapshot(ctx.claimId);
    return s?.paid_weeks ?? null;
  },
  resolveContribRecentWeeks: async (ctx) => {
    if (!ctx.claimId) return null;
    const s = await loadContributionSnapshot(ctx.claimId);
    // Prefer an explicit `recent_weeks` key in contribution_json; otherwise null.
    const j = (s?.contribution_json as Record<string, unknown> | null) ?? null;
    if (j && typeof j['recent_weeks'] === 'number') return j['recent_weeks'];
    return null;
  },
  resolveContribCreditedWeeks: async (ctx) => {
    if (!ctx.claimId) return null;
    const s = await loadContributionSnapshot(ctx.claimId);
    return s?.credited_weeks ?? null;
  },
  resolveContribWeeksLast13: async (ctx) => readWindow(ctx, 'window_13', 13 * 7),
  resolveContribWeeksLast26: async (ctx) => readWindow(ctx, 'window_26', 26 * 7),
  resolveContribWeeksLast39: async (ctx) => readWindow(ctx, 'window_39', 39 * 7),
  resolveContribWeeksLast52: async (ctx) => readWindow(ctx, 'window_52', 52 * 7),
  resolveContribWeeksLast12Months: async (ctx) => readWindow(ctx, 'window_12m', 365),
  resolveContribAvgWage: async (ctx) => {
    if (!ctx.claimId) return null;
    const s = await loadContributionSnapshot(ctx.claimId);
    return s?.average_weekly_wage ?? null;
  },
  resolveContribLastDate: async (ctx) => {
    if (!ctx.claimId) return null;
    const s = await loadContributionSnapshot(ctx.claimId);
    return s?.period_to ?? null;
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
    const make = (codes: string[]) => async (ctx: EligibilityContext) => {
      if (!ctx.claimId) return null;
      const { data } = await db
        .from('bn_claim_document')
        .select('id, document_type_code, verification_status, uploaded_at')
        .eq('claim_id', ctx.claimId)
        .in('document_type_code', codes)
        .order('uploaded_at', { ascending: false })
        .limit(1);
      if (!Array.isArray(data) || data.length === 0) return 'PENDING';
      const s = String((data[0] as any).verification_status ?? '').toUpperCase();
      return s || 'RECEIVED';
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
    const { data } = await db
      .from('bn_payment_profile')
      .select('id, is_verified, is_active')
      .eq('ssn', ctx.ssn)
      .eq('is_active', true)
      .limit(5);
    if (!Array.isArray(data)) return false;
    return data.some((r: any) => r.is_verified === true);
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
    const { data } = await db
      .from('bn_claim_document')
      .select('id, document_type_code, metadata, uploaded_at')
      .eq('claim_id', ctx.claimId)
      .in('document_type_code', ['FUNERAL_INVOICE', 'FUN_INVOICE'])
      .order('uploaded_at', { ascending: false })
      .limit(1);
    if (!Array.isArray(data) || data.length === 0) return null;
    const meta = (data[0] as any).metadata ?? {};
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
      source_table: 'bn_claim_document',
      source_column: 'verification_status',
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
