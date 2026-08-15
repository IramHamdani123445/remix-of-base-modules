/** Read-only claim facts and recipient resolution for canonical Benefits communications. */
import { supabase } from '@/integrations/supabase/client';
import type { BnCommContext } from './bnCommunicationTypes';

const db = supabase as any;
export type BnChannel = 'EMAIL' | 'SMS' | 'LETTER' | 'IN_APP' | 'INTERNAL_EMAIL';
export type BnRecipientType =
  | 'CLAIMANT' | 'PAYEE' | 'EMPLOYER' | 'ASSIGNED_OFFICER'
  | 'SUPERVISOR' | 'FINANCE' | 'MEDICAL_BOARD' | 'AUDITOR';

export async function buildBnMergeContext(claimId: string, extra?: Record<string, any>): Promise<Record<string, any>> {
  const { data: claim, error: claimErr } = await db
    .from('bn_claim')
    .select('id, claim_number, ssn, employer_regno, product_id, status, submission_date, claim_date, entered_at')
    .eq('id', claimId)
    .maybeSingle();
  if (claimErr) console.warn('[buildBnMergeContext] claim query failed', claimId, claimErr);
  if (!claim) return { ClaimNumber: '', ClaimantName: '', ...(extra || {}) };

  const [{ data: person }, { data: product }, { data: latestDecision }, { data: latestCalc }, { data: missingDocs }, { data: latestEligArr }] = await Promise.all([
    claim.ssn
      ? db.from('ip_master').select('firstname, surname, email_addr, contact_email, phone_mobile, phone, mail_addr1, mail_addr2').eq('ssn', String(claim.ssn).trim()).maybeSingle()
      : Promise.resolve({ data: null }),
    claim.product_id
      ? db.from('bn_product').select('benefit_name, benefit_code').eq('id', claim.product_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('bn_claim_decision').select('decision_type, reason_code, narrative, decided_at').eq('claim_id', claimId).order('decided_at', { ascending: false }).limit(1),
    db.from('bn_claim_calculation').select('weekly_rate, monthly_rate, lump_sum, effective_date').eq('claim_id', claimId).order('calculated_at', { ascending: false }).limit(1),
    db.from('bn_evidence_checklist').select('document_label').eq('claim_id', claimId).neq('status', 'VERIFIED').neq('status', 'WAIVED'),
    db.from('bn_claim_eligibility').select('id, overall_result, override_applied, rule_results, check_date').eq('claim_id', claimId).order('check_date', { ascending: false }).limit(1),
  ]);

  const ssnRaw = String(claim.ssn || '');
  const maskedSsn = ssnRaw ? ssnRaw.replace(/.(?=.{2})/g, '*') : '';
  const dec = latestDecision?.[0];
  const calc = latestCalc?.[0];
  const latestElig = (extra?.latestEligibility as any) ?? (Array.isArray(latestEligArr) ? latestEligArr[0] : null);

  // Build failed rules summary from extra.failedRules (preferred) or latest eligibility snapshot
  const failedRulesArr: any[] = Array.isArray(extra?.failedRules)
    ? (extra!.failedRules as any[])
    : Array.isArray(latestElig?.rule_results)
      ? (latestElig!.rule_results as any[]).filter((r: any) => !r.passed && r.result_state !== 'OVERRIDDEN')
      : [];
  const failedRulesText = failedRulesArr
    .map((r: any) => `• ${r.rule_name || r.rule_code || 'Rule'}${r.message ? ` — ${r.message}` : ''}`)
    .join('\n');
  const failedRulesHtml = failedRulesArr.length
    ? `<ul style="margin:8px 0 8px 18px;padding:0">${failedRulesArr.map((r: any) => `<li><strong>${r.rule_name || r.rule_code || 'Rule'}</strong>${r.message ? ` — ${r.message}` : ''}</li>`).join('')}</ul>`
    : '<em>None</em>';
  const failedReasonSummary = failedRulesArr.length
    ? `${failedRulesArr.length} eligibility check${failedRulesArr.length === 1 ? '' : 's'} did not pass.`
    : '';

  const missingDocsText = (missingDocs || []).map((d: any) => d.document_label).join(', ');
  const product_name = (product as any)?.benefit_name || '';
  const product_code = (product as any)?.benefit_code || '';
  const claim_number = claim.claim_number || claim.id;
  const claimant_name = person ? `${person.firstname || ''} ${person.surname || ''}`.trim() : '';
  const today = new Date().toISOString().slice(0, 10);
  const submission_date = claim.submission_date || claim.claim_date || claim.entered_at || '';
  const decision_date = dec?.decided_at || today;

  return {
    // Camel-case keys (used by notification_queue/template_data)
    ClaimNumber: claim_number,
    ClaimantName: claimant_name,
    SSN: ssnRaw,
    SSNMasked: maskedSsn,
    BenefitType: product_name,
    BenefitName: product_name,
    SubmissionDate: submission_date,
    DecisionDate: decision_date,
    ReasonCode: dec?.reason_code || extra?.reasonCode || '',
    ReasonDescription: dec?.narrative || extra?.reasonDescription || '',
    AppealDeadline: extra?.appealDeadline || '',
    AppealInstructions: extra?.appealInstructions || 'You may appeal this decision in writing within 30 days of receipt.',
    WeeklyRate: calc?.weekly_rate ?? '',
    MonthlyRate: calc?.monthly_rate ?? '',
    LumpSum: calc?.lump_sum ?? '',
    EffectiveDate: calc?.effective_date || '',
    PaymentMethod: '',
    MissingDocuments: missingDocsText,
    FailedRules: failedRulesText,
    FailedRulesHtml: failedRulesHtml,
    FailedReasonSummary: failedReasonSummary,
    NextSteps: extra?.nextSteps || 'Please review the listed checks and contact the claims office to discuss next steps.',
    OfficePhone: extra?.officePhone || extra?.officeContact || '',
    OfficeEmail: extra?.officeEmail || '',
    DueDate: extra?.dueDate || '',
    OfficerName: extra?.officerName || '',
    OfficeContact: extra?.officeContact || '',
    EmployerName: '',
    Today: today,
    // Snake/upper-case duplicates for {{PLACEHOLDER}}-style templates
    CLAIM_NUMBER: claim_number,
    CLAIMANT_NAME: claimant_name,
    SSN_MASKED: maskedSsn,
    BENEFIT_NAME: product_name,
    BENEFIT_TYPE: product_name,
    BENEFIT_CODE: product_code,
    APPLICATION_DATE: submission_date,
    SUBMISSION_DATE: submission_date,
    DECISION_DATE: decision_date,
    FAILED_RULES: failedRulesText || '—',
    FAILED_RULES_HTML: failedRulesHtml,
    FAILED_REASON_SUMMARY: failedReasonSummary || '—',
    MISSING_DOCUMENTS: missingDocsText || '—',
    NEXT_STEPS: extra?.nextSteps || 'Please contact the claims office to discuss next steps.',
    APPEAL_INSTRUCTIONS: extra?.appealInstructions || 'You may appeal this decision in writing within 30 days of receipt.',
    APPEAL_DEADLINE: extra?.appealDeadline || '',
    OFFICE_PHONE: extra?.officePhone || extra?.officeContact || '',
    OFFICE_EMAIL: extra?.officeEmail || '',
    TODAY: today,
    ...(extra || {}),
  };
}


// ─── Recipient resolution ─────────────────────────────────────────
export async function resolveRecipient(claimId: string, recipientType: BnRecipientType, channel: BnChannel, ctx?: BnCommContext): Promise<{ name?: string; email?: string; phone?: string; address?: any; userId?: string; fallbackUsed?: string } | null> {
  const { data: claim } = await db.from('bn_claim').select('ssn, employer_regno, assigned_to').eq('id', claimId).maybeSingle();
  if (!claim) return null;

  if (recipientType === 'CLAIMANT' || recipientType === 'PAYEE') {
    const ssn = claim.ssn ? String(claim.ssn).trim() : null;
    if (!ssn) return null;
    const { data: p } = await db.from('ip_master')
      .select('firstname, surname, email_addr, contact_email, mobile, phone_mobile, contact_mobile, phone, telephone, mail_addr1, mail_addr2')
      .eq('ssn', ssn).maybeSingle();
    const { data: appSnap } = await db.from('bn_claim_application')
      .select('raw_application_json')
      .eq('claim_id', claimId)
      .order('submitted_at', { ascending: false, nullsFirst: false })
      .limit(1).maybeSingle();
    const raw = appSnap?.raw_application_json || {};
    const contact = raw.contact || raw.claimant || raw.applicant || {};
    const addrSrc = raw.address || raw.mailing_address || contact.address || {};

    // Resolve linked external (claimant portal) user, plus fallback phone via verified link
    let userId: string | undefined;
    let linkedPhone: string | undefined;
    const { data: link } = await db.from('external_user_person_link')
      .select('user_id, is_primary, verification_status')
      .eq('ssn', ssn)
      .order('is_primary', { ascending: false })
      .limit(1).maybeSingle();
    if (link?.user_id) {
      if (channel === 'IN_APP') userId = link.user_id;
      // best-effort: pull verified phone from profile if present
      const { data: extProf } = await db.from('profiles')
        .select('phone, mobile, contact_phone')
        .eq('id', link.user_id)
        .maybeSingle();
      linkedPhone = (extProf as any)?.phone || (extProf as any)?.mobile || (extProf as any)?.contact_phone || undefined;
    }
    const name = `${p?.firstname || contact.firstname || contact.first_name || ''} ${p?.surname || contact.surname || contact.last_name || ''}`.trim();
    return {
      name: name || recipientType,
      email: p?.email_addr || p?.contact_email || contact.email || contact.email_addr || undefined,
      // phone_cell-equivalent → mobile first, then phone_mobile, contact_mobile, phone, telephone, linked, snapshot
      phone: p?.mobile || p?.phone_mobile || p?.contact_mobile || p?.phone || p?.telephone || contact.phone || contact.phone_mobile || linkedPhone || undefined,
      address: {
        line1: p?.mail_addr1 || addrSrc.line1 || addrSrc.address_line1 || addrSrc.street || undefined,
        line2: p?.mail_addr2 || addrSrc.line2 || addrSrc.address_line2 || undefined,
        city: addrSrc.city || undefined,
        state: addrSrc.state || addrSrc.parish || undefined,
        postal: addrSrc.postal || addrSrc.postal_code || addrSrc.zip || undefined,
        country: addrSrc.country || undefined,
      },
      userId,
    };
  }

  if (recipientType === 'EMPLOYER' && claim.employer_regno) {
    const { data: e } = await db.from('er_master').select('legal_name, email, phone, mail_address, mail_city, mail_country, mail_postal_code').eq('regno', claim.employer_regno).maybeSingle();
    if (!e) return null;
    return {
      name: e.legal_name,
      email: e.email || undefined,
      phone: e.phone || undefined,
      address: { line1: e.mail_address, city: e.mail_city, postal: e.mail_postal_code, country: e.mail_country },
    };
  }

  // Internal recipients (ASSIGNED_OFFICER / SUPERVISOR / FINANCE / etc.)
  let officerId: string | undefined = claim.assigned_to || undefined;
  let fallbackUsed: string | undefined;
  if (!officerId) {
    const { data: q } = await db.from('bn_claim_queue_assignment')
      .select('assigned_to')
      .eq('claim_id', claimId)
      .eq('is_active', true)
      .order('assigned_at', { ascending: false })
      .limit(1).maybeSingle();
    officerId = q?.assigned_to || undefined;
  }
  // Fallback: current logged-in user (officer-initiated comms)
  if (!officerId && ctx?.currentUserId) {
    officerId = ctx.currentUserId;
    fallbackUsed = 'current-user';
  }

  if (officerId) {
    const { data: prof } = await db.from('profiles')
      .select('id, email, full_name, user_code')
      .or(`id.eq.${officerId},user_code.eq.${officerId}`)
      .limit(1).maybeSingle();
    const resolvedUserId = (prof as any)?.id || officerId;
    return {
      name: prof?.full_name || ctx?.currentUserName || recipientType,
      email: prof?.email || ctx?.currentUserEmail || undefined,
      userId: resolvedUserId,
      fallbackUsed,
    };
  }
  return { name: ctx?.currentUserName || recipientType, email: ctx?.currentUserEmail, userId: undefined };
}
