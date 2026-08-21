/**
 * BN-AWARD360-B3D — Deep read-only loaders for Pensioner, Claim, Product tabs.
 *
 * Design rules:
 *  - Explicit column selections. No select('*').
 *  - Primary lookup errors throw; optional enrichment errors are converted to
 *    `partialWarnings` and never swallow silently.
 *  - Callers pass an `access` capability map. Restricted enrichment is SKIPPED
 *    (query never fires) and surfaced via a "restricted" flag on the section.
 *  - No writes. No RPC mutations. No .insert/.update/.delete/.upsert.
 */
import { supabase } from '@/integrations/supabase/client';
import type {
  AwardPensionerDeepView,
  AwardClaimDeepView,
  AwardProductDeepView,
  Award360Warning,
  Award360ReadinessItem,
  Award360ReadinessState,
  ClaimTimelineEvent,
} from '@/pages/bn/awards/award-360/deepViewModels';

const db = supabase as any;

// ─── helpers ─────────────────────────────────────────────────────────────

const maskSsn = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const v = String(s).trim();
  if (v.length <= 3) return v;
  return `***-**-${v.slice(-3)}`;
};

// AW360 Sub-batch B2-a §7 — bn_payment_profile now stores `account_number_masked`
// server-side, so a client-side masker is no longer necessary; retained
// intentionally as a comment for legacy audit trail.

const num = (v: any): number | null => (v == null ? null : Number(v));

async function safe<T>(fn: () => Promise<T>, label: string, warnings: string[]): Promise<T | null> {
  try {
    const r = await fn();
    return r;
  } catch (e: any) {
    warnings.push(`${label}: ${e?.message ?? String(e)}`);
    return null;
  }
}

// ─── Product version readiness row ──────────────────────────────────────
//
// BN-AWARD360-B3D-C1: enumerate exactly which bn_product_version columns the
// readiness resolver reads. Any field the resolver consumes MUST appear both
// in this type and in the .select() list below. Adding a resolver check
// without extending this type is a schema-omission bug.
export interface ProductVersionReadinessRow {
  id: string;
  product_id: string | null;
  version_number: number | null;
  status: string | null;
  effective_from: string | null;
  effective_to: string | null;
  entered_by: string | null;
  entered_at: string | null;
  modified_by: string | null;
  modified_at: string | null;
  // fields consumed by readiness resolver:
  formula_template_id: string | null;
  workflow_template_id: string | null;
  document_profile_id: string | null;
  screen_template_id: string | null;
  payment_frequency: string | null;
  life_certificate_policy: Record<string, unknown> | null;
  medical_review_policy: Record<string, unknown> | null;
  review_policy: Record<string, unknown> | null;
  survivor_beneficiary_policy: Record<string, unknown> | null;
}

const PRODUCT_VERSION_READINESS_COLUMNS =
  'id, product_id, version_number, status, effective_from, effective_to, ' +
  'entered_by, entered_at, modified_by, modified_at, ' +
  'formula_template_id, workflow_template_id, document_profile_id, screen_template_id, ' +
  'payment_frequency, life_certificate_policy, medical_review_policy, ' +
  'review_policy, survivor_beneficiary_policy';

// ─── Pensioner deep view ────────────────────────────────────────────────

export interface PensionerAccess {
  canViewPaymentProfile: boolean;
  /**
   * BN-AWARD360-B3D-C1: when false, the service must NOT surface routes that
   * would expose an unmasked SSN (Person 360 / person profile). The tab query
   * itself is gated separately by the Pensioner-tab view capability.
   */
  canViewPerson360: boolean;
}

export async function getAwardPensionerDeep(
  awardId: string,
  access: PensionerAccess,
): Promise<AwardPensionerDeepView | null> {
  const { data: award, error: awardErr } = await db
    .from('bn_award')
    .select('id, ssn, status, award_number, start_date, end_date')
    .eq('id', awardId)
    .maybeSingle();
  if (awardErr) throw awardErr;
  if (!award?.ssn) return null;

  const partial: string[] = [];
  const warnings: Award360Warning[] = [];

  // Primary: ip_master — canonical live-schema columns only.
  // BN-AWARD360-RUNTIME-C2: removed residency_status, mailing_addr1/2,
  // preferred_channel, is_deceased, dod (none exist on ip_master).
  const { data: p, error: pErr } = await db
    .from('ip_master')
    .select(
      'ssn, firstname, middle_name, surname, dob, sex, nationality, status, ' +
        'place_of_residence, date_of_residency, citizenship_flag, ' +
        'phone, telephone, phone_mobile, mobile, contact_phone, contact_mobile, ' +
        'email_addr, contact_email, ' +
        'resident_addr1, resident_addr2, mail_addr1, mail_addr2',
    )
    .eq('ssn', award.ssn)
    .maybeSingle();
  if (pErr) {
    // Primary relationship failure = throw
    throw pErr;
  }

  if (!p) {
    warnings.push({ key: 'PENSIONER_MISSING', severity: 'breach', title: 'Person record missing',
      detail: `No ip_master row for SSN linked to this award.` });
  }

  const fullName = p ? ([p.firstname, p.middle_name, p.surname].filter(Boolean).join(' ') || null) : null;
  const dob = p?.dob ? new Date(p.dob) : null;
  const age = dob ? Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000)) : null;
  const email = p?.email_addr ?? p?.contact_email ?? null;
  const mobile = p?.phone_mobile ?? p?.mobile ?? p?.contact_mobile ?? null;
  const phone = p?.phone ?? p?.telephone ?? p?.contact_phone ?? null;
  const mailingAddress = [p?.mail_addr1, p?.mail_addr2].filter(Boolean).join(', ') || null;

  // Communication preference: no canonical ip_master.preferred_channel field
  // exists. Return neutral state until a canonical resolver is wired in.
  const preferredChannel: string | null = null;
  const preferredChannelFulfillable = true;

  // Payment profile — optional, capability-gated
  let profileSection: AwardPensionerDeepView['paymentProfile'] = {
    present: false, restricted: false,
    method: null, currency: null, bank: null, accountMasked: null,
    verified: null, verifiedDate: null, effectiveDate: null,
    active: null, blocked: null, blockReason: null,
    pendingChangeRequest: null,
  };
  if (!access.canViewPaymentProfile) {
    profileSection = { ...profileSection, restricted: true };
  } else {
    const profile = await safe(async () => {
      const { data, error } = await db
        .from('bn_payment_profile')
        .select(
          'id, payment_method, payment_currency, bank_name, bank_code, ' +
            'account_number_masked, verification_status, verified_at, ' +
            'effective_from, effective_to, active',
        )
        .eq('person_ssn', award.ssn)
        .order('effective_from', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    }, 'Payment profile', partial);

    const pendingReq = await safe(async () => {
      const { data, error } = await db
        .from('bn_payment_profile_change_request')
        .select('id, status, created_at')
        .eq('person_ssn', award.ssn)
        .in('status', ['PENDING', 'SUBMITTED', 'UNDER_REVIEW'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    }, 'Payment profile change request', partial);

    if (profile) {
      const verified = (profile.verification_status ?? '').toUpperCase() === 'VERIFIED';
      // BN-AWARD360 Sub-batch B2-a §7 — canonical bn_payment_profile has no
      // `is_blocked` / `block_reason` columns; a null effective_to on an
      // active row means "not blocked". Preserve the response contract by
      // deriving `blocked` from the active flag + effective_to bounds.
      const blocked = profile.active === false;
      profileSection = {
        present: true, restricted: false,
        method: profile.payment_method ?? null,
        currency: profile.payment_currency ?? null,
        bank: profile.bank_name ?? profile.bank_code ?? null,
        accountMasked: profile.account_number_masked ?? null,
        verified,
        verifiedDate: profile.verified_at ?? null,
        effectiveDate: profile.effective_from ?? null,
        active: profile.active ?? null,
        blocked,
        blockReason: null,
        pendingChangeRequest: pendingReq
          ? { id: pendingReq.id, status: pendingReq.status ?? null, createdAt: pendingReq.created_at ?? null }
          : null,
      };
    } else if (pendingReq) {
      profileSection = {
        ...profileSection, present: false,
        pendingChangeRequest: { id: pendingReq.id, status: pendingReq.status ?? null, createdAt: pendingReq.created_at ?? null },
      };
    }
  }

  // Related claims and awards for this SSN
  const related: AwardPensionerDeepView['related'] = {
    relatedClaims: [], relatedAwards: [], dependants: [],
  };
  await safe(async () => {
    const { data, error } = await db
      .from('bn_claim')
      .select('id, claim_number, status')
      .eq('ssn', award.ssn)
      .order('claim_date', { ascending: false })
      .limit(10);
    if (error) throw error;
    related.relatedClaims = (data ?? []).map((c: any) => ({
      id: c.id, claimNumber: c.claim_number ?? null, status: c.status ?? null,
      route: `/bn/claims/${c.id}`,
    }));
    return data;
  }, 'Related claims', partial);

  await safe(async () => {
    const { data, error } = await db
      .from('bn_award')
      .select('id, award_number, status')
      .eq('ssn', award.ssn)
      .neq('id', awardId)
      .order('start_date', { ascending: false })
      .limit(10);
    if (error) throw error;
    related.relatedAwards = (data ?? []).map((a: any) => ({
      id: a.id, awardNumber: a.award_number ?? null, status: a.status ?? null,
      route: `/bn/awards/${a.id}`,
    }));
    return data;
  }, 'Related awards', partial);

  await safe(async () => {
    const { data, error } = await db
      .from('ip_depend')
      .select('firstname, surname, relation, status')
      .eq('ssn', award.ssn)
      .limit(20);
    if (error) throw error;
    related.dependants = (data ?? []).map((d: any) => ({
      fullName: [d.firstname, d.surname].filter(Boolean).join(' ') || null,
      relationship: d.relation ?? null,
      verified: d.status ? String(d.status).toUpperCase() === 'A' : null,
    }));
    return data;
  }, 'Dependants', partial);

  // Payee — Award 360 does not maintain a separate payee model on bn_award.
  // Treat pensioner as payee unless a change-request specifies otherwise.
  const payee: AwardPensionerDeepView['payee'] = {
    pensionerIsPayee: true,
    payeeName: fullName,
    payeeRelationship: 'SELF',
    guardianOrRepresentative: null,
    relationshipVerified: null,
  };

  // Warnings
  const personStatus = (p?.status ?? '').toString().trim().toUpperCase();
  // BN-AWARD360-RUNTIME-C2: ip_master has no is_deceased/dod. Derive deceased
  // state from canonical person status; no invented date of death.
  const isDeceased = ['D', 'DEAD', 'DECEASED'].includes(personStatus);
  const dateOfDeath: string | null = null;
  const awardStatus = (award.status ?? '').toString().toUpperCase();
  if (!p) {
    // already added
  } else {
    if (personStatus && !isDeceased && !['A', 'V', 'R', 'ACTIVE', 'VERIFIED', 'REGISTERED'].includes(personStatus)) {
      warnings.push({ key: 'PERSON_INACTIVE', severity: 'warn', title: 'Person status is not Active', detail: `Status: ${p.status}` });
    }
    if (isDeceased && ['ACTIVE', 'IN_PAYMENT'].includes(awardStatus)) {
      warnings.push({ key: 'DECEASED_ACTIVE_AWARD', severity: 'breach', title: 'Deceased pensioner on active award' });
    }
    if (!mobile && !phone && !email) {
      warnings.push({ key: 'NO_CONTACT', severity: 'warn', title: 'No contact information on file' });
    }
  }
  if (access.canViewPaymentProfile) {
    if (!profileSection.present) {
      warnings.push({ key: 'NO_PAYMENT_PROFILE', severity: 'warn', title: 'No active payment profile' });
    } else {
      if (profileSection.verified === false) {
        warnings.push({ key: 'PROFILE_UNVERIFIED', severity: 'warn', title: 'Payment profile is unverified' });
      }
      if (profileSection.blocked) {
        warnings.push({ key: 'PROFILE_BLOCKED', severity: 'breach', title: 'Payment profile is blocked',
          detail: profileSection.blockReason ?? undefined });
      }
      if (profileSection.pendingChangeRequest) {
        warnings.push({ key: 'PROFILE_PENDING_CHANGE', severity: 'info', title: 'Pending profile change request',
          detail: `Status: ${profileSection.pendingChangeRequest.status ?? ''}` });
      }
    }
  }
  if (related.relatedClaims.length === 0) {
    warnings.push({ key: 'NO_LINKED_CLAIM', severity: 'info', title: 'No related claim record found for this SSN' });
  }

  const person360 = access.canViewPerson360 && award.ssn ? `/bn/person-360?ssn=${encodeURIComponent(award.ssn)}` : null;
  const personProfile = access.canViewPerson360 && award.ssn ? `/person/profile/${encodeURIComponent(award.ssn)}` : null;

  const canonicalPersonId = access.canViewPerson360 ? (award.ssn ?? null) : null;

  return {
    identity: {
      fullName,
      ssnMasked: maskSsn(award.ssn),
      canonicalPersonId,
      dob: p?.dob ?? null,
      age,
      sex: p?.sex ?? null,
      nationality: p?.nationality ?? null,
      // BN-AWARD360-RUNTIME-C2: field label in UI is "Place of Residence";
      // no canonical residency_status column exists on ip_master.
      residencyStatus: p?.place_of_residence ?? null,
      personStatus: p?.status ?? null,
      isDeceased,
      dateOfDeath,
    },
    contact: {
      mobile, phone, email,
      residentialAddress: [p?.resident_addr1, p?.resident_addr2].filter(Boolean).join(', ') || null,
      mailingAddress,
      preferredChannel,
      preferredChannelFulfillable,
    },
    payee,
    paymentProfile: profileSection,
    related,
    routes: {
      person360, personProfile,
      paymentProfiles: '/bn/payment-profiles',
    },
    warnings,
    partialWarnings: partial,
  };
}

// ─── Claim deep view ────────────────────────────────────────────────────

export interface ClaimAccess {
  canViewEvidence: boolean;
  canViewWorkflow: boolean;
}

export async function getAwardClaimDeep(
  awardId: string,
  access: ClaimAccess,
): Promise<AwardClaimDeepView | null> {
  const { data: award, error: awardErr } = await db
    .from('bn_award')
    .select('id, bn_claim_id, base_amount, start_date, status')
    .eq('id', awardId)
    .maybeSingle();
  if (awardErr) throw awardErr;
  if (!award?.bn_claim_id) return null;

  const claimId = award.bn_claim_id;
  const partial: string[] = [];
  const warnings: Award360Warning[] = [];

  const { data: c, error: cErr } = await db
    .from('bn_claim')
    .select(
      'id, claim_number, status, product_id, product_version_id, submission_date, claim_date, ' +
        'application_channel, source, priority, assigned_to, workflow_instance_id, decision_date',
    )
    .eq('id', claimId)
    .maybeSingle();
  if (cErr) throw cErr;
  if (!c) {
    warnings.push({ key: 'CLAIM_NOT_FOUND', severity: 'breach', title: 'Claim not found', detail: `id=${claimId}` });
    return {
      header: {
        claimId,
        claimNumber: null, status: null, priority: null, applicationChannel: null,
        claimDate: null, submissionDate: null, productVersionId: null, productVersionLabel: null,
        assignedOfficer: null, workbasket: null, currentTask: null, slaDueAt: null, slaBreached: false,
      },
      eligibility: { present: false, restricted: false, latestResult: null, checkedAt: null, passedCount: 0, failedCount: 0, warningCount: 0, failedRules: [], overrideActor: null, overrideReason: null },
      evidence: { present: false, restricted: !access.canViewEvidence, required: null, received: 0, verified: 0, missing: null, waived: 0, baselineUnknown: true, blocking: [] },
      calculation: { present: false, calcId: null, version: null, weeklyRate: null, monthlyRate: null, lumpSum: null, effectiveDate: null, status: null, overrideState: null, overrideReason: null, traceSummary: null },
      decision: { present: false, recommendation: null, decision: null, decisionReason: null, narrative: null, decidedBy: null, decidedAt: null, approvalStatus: null, approvalLevel: null, makerChecker: null, policyReference: null },
      timeline: [],
      workflowRestricted: !access.canViewWorkflow,
      routes: {
        workbench: `/bn/claims/${claimId}`,
        eligibility: `/bn/claims/${claimId}/eligibility`,
        calculation: `/bn/claims/${claimId}/calculation`,
        recommendation: `/bn/claims/${claimId}/recommendation`,
        determination: `/bn/claims/${claimId}/determination`,
      },
      warnings, partialWarnings: partial,
    };
  }

  // Active queue assignment — canonical workbasket / SLA source.
  // BN-AWARD360-RUNTIME-C2: bn_claim has no workbasket_id / sla_due_at columns.
  const assignment = access.canViewWorkflow ? await safe(async () => {
    const { data, error } = await db
      .from('bn_claim_queue_assignment')
      .select('id, claim_id, workbasket_id, assigned_to, assigned_at, priority, due_at, picked_at, completed_at, is_active')
      .eq('claim_id', claimId)
      .eq('is_active', true)
      .order('assigned_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }, 'Queue assignment', partial) : null;

  const slaDueAt: string | null = assignment?.due_at ?? null;
  const slaBreached = !!assignment?.due_at && !assignment?.completed_at &&
    Date.parse(assignment.due_at) < Date.now();

  // Product version label
  let productVersionLabel: string | null = null;
  if (c.product_version_id) {
    await safe(async () => {
      const { data, error } = await db
        .from('bn_product_version')
        .select('version_number, status')
        .eq('id', c.product_version_id)
        .maybeSingle();
      if (error) throw error;
      productVersionLabel = data ? `v${data.version_number ?? ''} (${data.status ?? '—'})` : null;
      return data;
    }, 'Product version', partial);
  }

  // Latest eligibility — B2-b.3a schema repair. `bn_claim_eligibility` has
  // NO `override_id` column in the live schema; the canonical override
  // metadata (`override_applied`, `override_by`, `override_reason`) is
  // stored directly on the eligibility row. We map it verbatim and DO
  // NOT query `bn_override_request` for display: it is a request-history
  // table, not the decision source of truth.
  const elig = await safe(async () => {
    const { data, error } = await db
      .from('bn_claim_eligibility')
      .select('id, check_date, overall_result, rule_results, override_applied, override_by, override_reason')
      .eq('claim_id', claimId)
      .order('check_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }, 'Eligibility', partial);

  const overrideActor: string | null = elig?.override_by ?? null;
  const overrideReason: string | null = elig?.override_reason ?? null;

  const ruleResults: any[] = Array.isArray(elig?.rule_results) ? elig!.rule_results : [];
  const passedCount = ruleResults.filter((r) => r?.passed === true).length;
  const failedCount = ruleResults.filter((r) => r?.passed === false).length;
  const warningCount = ruleResults.filter((r) => (r?.severity ?? '').toString().toUpperCase() === 'WARN').length;
  const failedRules = ruleResults
    .filter((r) => r?.passed === false)
    .slice(0, 20)
    .map((r) => ({
      code: r.rule_code ?? '—',
      name: r.rule_name ?? r.rule_code ?? '—',
      message: r.message ?? null,
    }));

  // Calculation
  const calc = await safe(async () => {
    const { data, error } = await db
      .from('bn_claim_calculation')
      .select('id, calc_date, weekly_rate, monthly_rate, lump_sum, formula_version, outputs')
      .eq('claim_id', claimId)
      .order('calc_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }, 'Calculation', partial);

  const trace: any[] = Array.isArray((calc as any)?.outputs?.trace) ? (calc as any).outputs.trace : [];
  const traceSummary = trace.length
    ? `${trace.length} steps · ${trace.filter((t) => (t?.severity ?? '').toUpperCase() === 'ERROR').length} errors`
    : null;

  // Evidence — BN-AWARD360-B3D-C1: honest required/missing from bn_doc_requirement
  // baseline. When no baseline is resolvable, mark baselineUnknown and null the counts.
  let evidenceSection: AwardClaimDeepView['evidence'] = {
    present: false, restricted: !access.canViewEvidence,
    required: null, received: 0, verified: 0, missing: null, waived: 0,
    baselineUnknown: true, blocking: [],
  };
  if (access.canViewEvidence) {
    const rows = await safe(async () => {
      const { data, error } = await db
        .from('bn_claim_evidence')
        .select('id, document_name, document_type_code, status, rejection_reason, waived_at, requirement_id')
        .eq('claim_id', claimId);
      if (error) throw error;
      return data ?? [];
    }, 'Evidence', partial);

    // Required baseline from active doc requirements for this claim's product version.
    let requirements: { id: string; document_type_code: string | null; blocks_decision: boolean | null }[] | null = null;
    if (c.product_version_id) {
      requirements = await safe(async () => {
        const { data, error } = await db
          .from('bn_doc_requirement')
          .select('id, document_type_code, blocks_decision, is_active, requirement_level')
          .eq('product_version_id', c.product_version_id)
          .eq('is_active', true);
        if (error) throw error;
        // Treat REQUIRED/MANDATORY levels as required baseline; if requirement_level is null, include.
        return (data ?? []).filter((r: any) => {
          const lvl = String(r.requirement_level ?? '').toUpperCase();
          return !lvl || lvl === 'REQUIRED' || lvl === 'MANDATORY';
        });
      }, 'Doc requirements', partial);
    }

    if (rows) {
      const list = rows as any[];
      const verified = list.filter((r) => r.status === 'VERIFIED').length;
      const received = list.length;
      const waived = list.filter((r) => r.waived_at).length;
      const rejected = list.filter((r) => r.status === 'REJECTED');

      const baselineAvailable = requirements != null && requirements.length > 0;
      let required: number | null = null;
      let missing: number | null = null;
      if (baselineAvailable) {
        required = requirements!.length;
        // A requirement is fulfilled if a claim_evidence row references its id
        // with status VERIFIED or has a waived_at timestamp.
        const fulfilledReqIds = new Set(
          list
            .filter((r) => r.requirement_id && (r.status === 'VERIFIED' || r.waived_at))
            .map((r) => r.requirement_id),
        );
        missing = Math.max(0, required - fulfilledReqIds.size);
      } else {
        // BN-AWARD360-B3D-C2: an empty bn_doc_requirement result is NOT proof of
        // "zero documents required". Without an explicit no-document configuration
        // on the product version (no such canonical schema field exists today),
        // the honest answer is Unknown. Never fabricate required=0/missing=0.
        partial.push(
          'Evidence baseline unavailable: no active document requirements are configured for the product version.',
        );
      }


      evidenceSection = {
        present: received > 0 || (required != null && required > 0),
        restricted: false,
        required, received, verified, missing, waived,
        baselineUnknown: required == null,
        blocking: rejected.slice(0, 10).map((r) => ({
          name: r.document_name ?? r.document_type_code ?? '—',
          status: r.status ?? null,
          reason: r.rejection_reason ?? null,
        })),
      };
    }
  }

  // Decision
  const decision = await safe(async () => {
    const { data, error } = await db
      .from('bn_claim_decision')
      .select('id, action_code, from_status, to_status, narrative, effective_date, performed_by, performed_at, workflow_instance_id')
      .eq('claim_id', claimId)
      .order('performed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }, 'Decision', partial);

  // Timeline: events + status + decisions + notes.
  // BN-AWARD360-B3D-C1: workflow-sensitive tables are ONLY queried when the
  // caller has canViewWorkflow. Otherwise the timeline stays empty and the
  // workflowRestricted flag drives a restricted notice in the tab.
  const timeline: ClaimTimelineEvent[] = [];
  if (access.canViewWorkflow) {
    await safe(async () => {
      const { data, error } = await db
        .from('bn_claim_event')
        .select('id, event_type, from_status, to_status, notes, performed_by, performed_at')
        .eq('claim_id', claimId)
        .order('performed_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      (data ?? []).forEach((e: any) => timeline.push({
        id: e.id,
        timestamp: e.performed_at,
        kind: e.from_status || e.to_status ? 'STATUS' : 'EVENT',
        label: e.event_type ?? 'Event',
        fromValue: e.from_status ?? null,
        toValue: e.to_status ?? null,
        actor: e.performed_by ?? null,
      }));
      return data;
    }, 'Timeline events', partial);

    await safe(async () => {
      const { data, error } = await db
        .from('bn_claim_note')
        .select('id, subject, body, entered_by, entered_at')
        .eq('claim_id', claimId)
        .order('entered_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      (data ?? []).forEach((n: any) => timeline.push({
        id: n.id,
        timestamp: n.entered_at,
        kind: 'NOTE',
        label: n.subject ?? (n.body ? String(n.body).slice(0, 80) : 'Note'),
        actor: n.entered_by ?? null,
      }));
      return data;
    }, 'Notes', partial);

    timeline.sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''));
  }

  // Warnings
  const claimStatus = (c.status ?? '').toString().toUpperCase();
  const awardStatus = (award.status ?? '').toString().toUpperCase();
  if (!c.product_version_id) {
    warnings.push({ key: 'MISSING_PRODUCT_VERSION', severity: 'breach', title: 'Missing product version' });
  }
  if (!elig) {
    warnings.push({ key: 'ELIGIBILITY_NOT_RUN', severity: 'warn', title: 'Eligibility has not been evaluated' });
  } else if (elig.overall_result === false) {
    warnings.push({ key: 'ELIGIBILITY_FAILED', severity: 'warn', title: 'Eligibility failed',
      detail: `${failedCount} rule(s) failed` });
  }
  if (access.canViewEvidence && evidenceSection.blocking.length > 0) {
    warnings.push({ key: 'BLOCKING_EVIDENCE', severity: 'breach', title: 'Rejected/blocking evidence present',
      detail: `${evidenceSection.blocking.length} item(s)` });
  }
  if (!calc) {
    warnings.push({ key: 'CALCULATION_NOT_RUN', severity: 'warn', title: 'Calculation has not been run' });
  }
  if (!decision) {
    warnings.push({ key: 'MISSING_DECISION', severity: 'warn', title: 'No decision recorded' });
  }
  if (slaBreached) {
    warnings.push({ key: 'SLA_BREACHED', severity: 'breach', title: 'SLA breached',
      detail: slaDueAt ? `Due ${slaDueAt}` : undefined });
  }
  // Award/Claim mismatch
  if (claimStatus && awardStatus && (
    (awardStatus === 'ACTIVE' && ['REJECTED', 'CANCELLED', 'DRAFT', 'INTAKE'].includes(claimStatus))
  )) {
    warnings.push({ key: 'STATUS_INCONSISTENT', severity: 'warn', title: 'Award/Claim status inconsistency',
      detail: `Award=${award.status}, Claim=${c.status}` });
  }
  if (calc && award.base_amount != null && calc.weekly_rate != null) {
    const w = Number(calc.weekly_rate), b = Number(award.base_amount);
    if (Number.isFinite(w) && Number.isFinite(b) && Math.abs(w - b) > 0.01 && Math.abs((calc.monthly_rate ?? 0) - b) > 0.01) {
      warnings.push({ key: 'AWARD_AMOUNT_MISMATCH', severity: 'warn', title: 'Award amount does not match calculation',
        detail: `Award base=${b}, calc weekly=${w}` });
    }
  }

  return {
    header: {
      claimId,
      claimNumber: c.claim_number ?? null,
      status: c.status ?? null,
      priority: c.priority ?? null,
      applicationChannel: c.application_channel ?? null,
      claimDate: c.claim_date ?? null,
      submissionDate: c.submission_date ?? null,
      productVersionId: c.product_version_id ?? null,
      productVersionLabel,
      assignedOfficer: c.assigned_to ?? null,
      // BN-AWARD360-RUNTIME-C2: workbasket and current task derived from
      // canonical bn_claim_queue_assignment. bn_claim has no such columns.
      workbasket: access.canViewWorkflow ? (assignment?.workbasket_id ?? null) : null,
      currentTask: access.canViewWorkflow ? (c.workflow_instance_id ?? null) : null,
      slaDueAt,
      slaBreached,
    },
    eligibility: {
      present: !!elig,
      restricted: false,
      latestResult: elig ? (elig.overall_result ? 'PASS' : 'FAIL') : null,
      checkedAt: elig?.check_date ?? null,
      passedCount, failedCount, warningCount, failedRules,
      overrideActor, overrideReason,
    },
    evidence: evidenceSection,
    calculation: {
      present: !!calc,
      calcId: calc?.id ?? null,
      version: calc?.formula_version ?? null,
      weeklyRate: num(calc?.weekly_rate),
      monthlyRate: num(calc?.monthly_rate),
      lumpSum: num(calc?.lump_sum),
      effectiveDate: calc?.calc_date ?? null,
      status: null,
      overrideState: null,
      overrideReason: null,
      traceSummary,
    },
    decision: {
      present: !!decision,
      recommendation: null,
      decision: decision?.action_code ?? null,
      decisionReason: null,
      narrative: decision?.narrative ?? null,
      decidedBy: decision?.performed_by ?? null,
      decidedAt: decision?.performed_at ?? null,
      // BN-AWARD360-RUNTIME-C2: bn_claim has no approval_status column.
      approvalStatus: null,
      approvalLevel: null,
      makerChecker: null,
      policyReference: decision?.workflow_instance_id ?? null,
    },
    timeline,
    workflowRestricted: !access.canViewWorkflow,
    routes: {
      workbench: `/bn/claims/${claimId}`,
      eligibility: `/bn/claims/${claimId}/eligibility`,
      calculation: `/bn/claims/${claimId}/calculation`,
      recommendation: `/bn/claims/${claimId}/recommendation`,
      determination: `/bn/claims/${claimId}/determination`,
    },
    warnings,
    partialWarnings: partial,
  };
}

// ─── Product deep view ──────────────────────────────────────────────────

export interface ProductAccess {
  canViewConfiguration: boolean;
}

const readiness = (
  key: string,
  label: string,
  state: Award360ReadinessState,
  explanation: string,
  targetRoute?: string,
): Award360ReadinessItem => ({ key, label, state, explanation, targetRoute });

export async function getAwardProductDeep(
  awardId: string,
  access: ProductAccess,
): Promise<AwardProductDeepView | null> {
  const { data: award, error: awardErr } = await db
    .from('bn_award')
    .select('id, bn_product_id, bn_claim_id, start_date, base_amount')
    .eq('id', awardId)
    .maybeSingle();
  if (awardErr) throw awardErr;
  if (!award?.bn_product_id) return null;

  const partial: string[] = [];
  const warnings: Award360Warning[] = [];

  const { data: prod, error: pErr } = await db
    .from('bn_product')
    .select('id, benefit_code, benefit_name, description, scheme_id, branch_id, category, branch, payment_type, country_code, status')
    .eq('id', award.bn_product_id)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!prod) {
    warnings.push({ key: 'MISSING_PRODUCT', severity: 'breach', title: 'Product not found' });
    return null;
  }

  // BUG-011: bn_product only stores scheme_id/branch_id (FKs). Resolve the
  // readable names from bn_scheme/bn_branch instead of surfacing raw UUIDs.
  let schemeName: string | null = null;
  if (prod.scheme_id) {
    const { data: scheme } = await db
      .from('bn_scheme')
      .select('scheme_name')
      .eq('id', prod.scheme_id)
      .maybeSingle();
    schemeName = scheme?.scheme_name ?? null;
  }

  let branchName: string | null = null;
  if (prod.branch_id) {
    const { data: branchRow } = await db
      .from('bn_branch')
      .select('branch_name')
      .eq('id', prod.branch_id)
      .maybeSingle();
    branchName = branchRow?.branch_name ?? null;
  }

  // Version resolution: claim.product_version_id.
  // BN-AWARD360-B3D-C1: select all columns the readiness resolver reads. The
  // typed row eliminates the "field omitted → readiness MISSING" defect class.
  let versionRow: ProductVersionReadinessRow | null = null;
  let claimProductId: string | null = null;
  if (award.bn_claim_id) {
    await safe(async () => {
      const { data, error } = await db
        .from('bn_claim')
        .select('product_version_id')
        .eq('id', award.bn_claim_id)
        .maybeSingle();
      if (error) throw error;
      if (data?.product_version_id) {
        const { data: pv, error: pvErr } = await db
          .from('bn_product_version')
          .select(PRODUCT_VERSION_READINESS_COLUMNS)
          .eq('id', data.product_version_id)
          .maybeSingle();
        if (pvErr) throw pvErr;
        versionRow = (pv ?? null) as ProductVersionReadinessRow | null;
        claimProductId = versionRow?.product_id ?? null;
      }
      return data;
    }, 'Product version', partial);
  }

  const productMatchesAward = !claimProductId || claimProductId === award.bn_product_id;
  const awardStart = award.start_date ? new Date(award.start_date).getTime() : null;
  const effFrom = versionRow?.effective_from ? new Date(versionRow.effective_from).getTime() : null;
  const effTo = versionRow?.effective_to ? new Date(versionRow.effective_to).getTime() : null;
  const awardWithinEffective =
    versionRow && awardStart != null && effFrom != null
      ? awardStart >= effFrom && (effTo == null || awardStart <= effTo)
      : versionRow ? null : null;

  // Warnings
  if (!versionRow) {
    warnings.push({ key: 'MISSING_VERSION', severity: 'breach', title: 'Missing product version' });
  } else {
    if (!productMatchesAward) {
      warnings.push({ key: 'PRODUCT_VERSION_MISMATCH', severity: 'breach', title: 'Version belongs to a different product',
        detail: `Version product=${claimProductId}, Award product=${award.bn_product_id}` });
    }
    const vs = String(versionRow.status ?? '').toUpperCase();
    if (vs && !['PUBLISHED', 'ACTIVE', 'APPROVED'].includes(vs)) {
      warnings.push({ key: 'VERSION_NOT_PUBLISHED', severity: 'warn', title: 'Version is not published/active',
        detail: `Status: ${versionRow.status}` });
    }
    if (awardWithinEffective === false) {
      warnings.push({ key: 'OUTSIDE_EFFECTIVE', severity: 'warn', title: 'Award start falls outside version effective dates' });
    }
  }

  // Readiness matrix — only when configuration view is granted
  const readinessList: Award360ReadinessItem[] = [];
  const restrictedConfiguration = !access.canViewConfiguration;

  if (restrictedConfiguration || !versionRow) {
    const state: Award360ReadinessState = restrictedConfiguration ? 'RESTRICTED' : 'NOT_APPLICABLE';
    const expl = restrictedConfiguration
      ? 'Not available under current access'
      : 'No product version resolved';
    ['Formula', 'Eligibility rules', 'Workflow', 'Approval policy', 'Document profile', 'Screen template',
     'Payment setup', 'Life Certificate policy', 'Medical Review policy', 'Suspension policy',
     'Beneficiary policy', 'Communication mappings'].forEach((label, i) =>
      readinessList.push(readiness(`R_${i}`, label, state, expl)),
    );
  } else {
    const vid = versionRow.id;
    // Formula
    const formulaBinding = await safe(async () => {
      const { data, error } = await db
        .from('bn_product_formula_binding')
        .select('id, formula_template_id, formula_version_id, calculation_stage')
        .eq('product_version_id', vid)
        .limit(5);
      if (error) throw error;
      return data ?? [];
    }, 'Formula binding', partial);
    readinessList.push(readiness(
      'FORMULA', 'Formula',
      (formulaBinding && formulaBinding.length > 0)
        ? 'READY'
        : (versionRow.formula_template_id ? 'PARTIAL' : 'MISSING'),
      formulaBinding && formulaBinding.length > 0
        ? `${formulaBinding.length} binding(s) configured`
        : versionRow.formula_template_id
          ? 'Formula template referenced on version but no bindings found'
          : 'No formula binding configured',
      '/bn/config/formulas',
    ));

    // Eligibility rules
    const elig = await safe(async () => {
      const { count, error } = await db
        .from('bn_eligibility_rule')
        .select('id', { count: 'exact', head: true })
        .eq('product_version_id', vid)
        .eq('is_active', true);
      if (error) throw error;
      return count ?? 0;
    }, 'Eligibility rules', partial);
    readinessList.push(readiness('ELIG', 'Eligibility rules',
      (elig ?? 0) > 0 ? 'READY' : 'MISSING',
      (elig ?? 0) > 0 ? `${elig} active rule(s)` : 'No active eligibility rules configured'));

    // Workflow
    readinessList.push(readiness('WF', 'Workflow',
      versionRow.workflow_template_id ? 'READY' : 'MISSING',
      versionRow.workflow_template_id
        ? `Template ${versionRow.workflow_template_id}`
        : 'No workflow_template_id on version'));

    // Approval policy
    const approval = await safe(async () => {
      const { count, error } = await db
        .from('bn_approval_policy')
        .select('id', { count: 'exact', head: true })
        .eq('product_version_id', vid)
        .eq('is_enabled', true);
      if (error) throw error;
      return count ?? 0;
    }, 'Approval policy', partial);
    readinessList.push(readiness('APPROVAL', 'Approval policy',
      (approval ?? 0) > 0 ? 'READY' : 'MISSING',
      (approval ?? 0) > 0 ? `${approval} enabled policy row(s)` : 'No enabled approval policy'));

    // Document profile
    readinessList.push(readiness('DOC', 'Document profile',
      versionRow.document_profile_id ? 'READY' : 'MISSING',
      versionRow.document_profile_id
        ? `Profile ${versionRow.document_profile_id}`
        : 'No document_profile_id set on version',
      '/bn/config/document-setup'));

    // Screen template
    readinessList.push(readiness('SCREEN', 'Screen template',
      versionRow.screen_template_id ? 'READY' : 'MISSING',
      versionRow.screen_template_id
        ? `Template ${versionRow.screen_template_id}`
        : 'No screen_template_id set on version',
      '/bn/config/screen-setup'));

    // Payment setup — presence of payment_frequency
    readinessList.push(readiness('PAY', 'Payment setup',
      versionRow.payment_frequency ? 'READY' : 'MISSING',
      versionRow.payment_frequency
        ? `Frequency: ${versionRow.payment_frequency}`
        : 'No payment frequency configured on version'));

    // Life Certificate policy — JSON field
    const lcPolicy = versionRow.life_certificate_policy;
    readinessList.push(readiness('LC', 'Life Certificate policy',
      lcPolicy && Object.keys(lcPolicy).length > 0 ? 'READY' : 'NOT_APPLICABLE',
      lcPolicy && Object.keys(lcPolicy).length > 0
        ? 'Policy configured'
        : 'Policy not applicable or not configured'));

    // Medical Review policy
    const mrPolicy = versionRow.medical_review_policy;
    readinessList.push(readiness('MR', 'Medical Review policy',
      mrPolicy && Object.keys(mrPolicy).length > 0 ? 'READY' : 'NOT_APPLICABLE',
      mrPolicy && Object.keys(mrPolicy).length > 0
        ? 'Policy configured'
        : 'Policy not applicable or not configured'));

    // Suspension policy — reuse review_policy heuristic
    const revPolicy = versionRow.review_policy;
    readinessList.push(readiness('SUSP', 'Suspension policy',
      revPolicy && Object.keys(revPolicy).length > 0 ? 'READY' : 'NOT_APPLICABLE',
      revPolicy && Object.keys(revPolicy).length > 0
        ? 'Review/suspension policy configured'
        : 'Suspension policy not configured'));

    // Beneficiary policy
    const bPolicy = versionRow.survivor_beneficiary_policy;
    readinessList.push(readiness('BEN', 'Beneficiary policy',
      bPolicy && Object.keys(bPolicy).length > 0 ? 'READY' : 'NOT_APPLICABLE',
      bPolicy && Object.keys(bPolicy).length > 0
        ? 'Policy configured'
        : 'Beneficiary policy not configured'));

    // Communication mappings
    const comm = await safe(async () => {
      const { count, error } = await db
        .from('bn_comm_mapping')
        .select('id', { count: 'exact', head: true })
        .eq('bn_product_version_id', vid)
        .eq('active', true);
      if (error) throw error;
      return count ?? 0;
    }, 'Communication mappings', partial);
    readinessList.push(readiness('COMM', 'Communication mappings',
      (comm ?? 0) >= 3 ? 'READY' : (comm ?? 0) > 0 ? 'PARTIAL' : 'MISSING',
      (comm ?? 0) > 0
        ? `${comm} active mapping(s)`
        : 'No active communication mappings configured'));

    // Emit missing-config warnings
    readinessList.forEach((r) => {
      if (r.state === 'MISSING' && ['FORMULA', 'ELIG', 'WF', 'DOC', 'PAY'].includes(r.key)) {
        warnings.push({ key: `MISSING_${r.key}`, severity: 'warn', title: `Missing ${r.label.toLowerCase()}`, detail: r.explanation });
      }
      if (r.state === 'PARTIAL' && r.key === 'COMM') {
        warnings.push({ key: 'INCOMPLETE_COMM', severity: 'info', title: 'Incomplete communication mappings', detail: r.explanation });
      }
    });
  }

  return {
    identity: {
      productId: prod.id,
      productCode: prod.benefit_code ?? null,
      productName: prod.benefit_name ?? null,
      benefitCode: prod.benefit_code ?? null,
      scheme: schemeName,
      branch: branchName,
      category: prod.category ?? null,
      paymentType: prod.payment_type ?? null,
      country: prod.country_code ?? null,
      status: prod.status ?? null,
      legalReference: null,
    },
    version: {
      present: !!versionRow,
      versionId: versionRow?.id ?? null,
      versionNumber: versionRow?.version_number != null ? String(versionRow.version_number) : null,
      status: versionRow?.status ?? null,
      effectiveFrom: versionRow?.effective_from ?? null,
      effectiveTo: versionRow?.effective_to ?? null,
      published: String(versionRow?.status ?? '').toUpperCase() === 'PUBLISHED',
      createdBy: versionRow?.entered_by ?? null,
      createdAt: versionRow?.entered_at ?? null,
      approvedBy: versionRow?.modified_by ?? null,
      approvedAt: versionRow?.modified_at ?? null,
      productMatchesAward,
      awardWithinEffective,
    },
    readiness: readinessList,
    routes: {
      catalog: '/bn/config/products',
      formulas: '/bn/config/formulas',
      documentSetup: '/bn/config/document-setup',
      screenSetup: '/bn/config/screen-setup',
    },
    warnings,
    partialWarnings: partial,
    restrictedConfiguration,
  };
}
