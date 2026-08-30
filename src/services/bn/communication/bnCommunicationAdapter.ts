/**
 * BN Communication Adapter
 *
 * BN does NOT own a separate communication module. It delegates to the
 * existing platform notification + notice infrastructure
 * (notification_templates, notification_queue, in_app_notifications)
 * and to the BN-scoped letter lifecycle (bn_letter).
 *
 * Flow:
 *   triggerClaimCommunication(eventCode, claimId, ctx?)
 *     → resolve bn_comm_mapping rows for event (+ optional product version / step)
 *     → resolve recipient address per recipient_type
 *     → for EMAIL/SMS/IN_APP/INTERNAL_EMAIL → enqueue via notification_queue / in_app_notifications
 *     → for LETTER → create bn_letter row (DRAFT) ready for generation/approval/print
 *     → always write bn_communication_log + bn_claim_event for the timeline
 *     → fallback: if no email/phone for digital channels, auto-promote to LETTER
 */
import { supabase } from '@/integrations/supabase/client';
import { bnDocumentTypeFor } from '@/services/reference/referenceNumberService';
import { ensureBnLetterSnapshot, mergePlaceholders } from './bnLetterRenderer';
import type { BnCommContext } from './bnCommunicationTypes';
export type { BnCommContext } from './bnCommunicationTypes';

const db = supabase as any;

export type BnChannel = 'EMAIL' | 'SMS' | 'LETTER' | 'IN_APP' | 'INTERNAL_EMAIL';
export type BnRecipientType =
  | 'CLAIMANT' | 'PAYEE' | 'EMPLOYER' | 'ASSIGNED_OFFICER'
  | 'SUPERVISOR' | 'FINANCE' | 'MEDICAL_BOARD' | 'AUDITOR';

export interface BnCommDispatchResult {
  eventCode: string;
  dispatched: number;
  skipped: number;
  failed: number;
  blocked: number;
  letters: string[];
  logIds: string[];
  warnings: string[];
}

export interface RecipientDiagnosis {
  resolvable: boolean;
  recipient?: { name?: string; email?: string; phone?: string; address?: any; userId?: string };
  missing: string[];
  reason?: string;
}

/**
 * Recipient diagnostics — single source of truth for "can this comm actually go out?".
 * Returns structured missing-data reasons used to set BLOCKED status with actionable details.
 */
export async function diagnoseRecipient(
  claimId: string,
  recipientType: BnRecipientType,
  channel: BnChannel,
  ctx?: BnCommContext,
): Promise<RecipientDiagnosis> {
  const recipient = await resolveRecipient(claimId, recipientType, channel, ctx);
  if (!recipient) {
    return { resolvable: false, missing: ['recipient'], reason: `${recipientType} record not found on claim` };
  }
  const missing: string[] = [];
  if ((channel === 'EMAIL' || channel === 'INTERNAL_EMAIL') && !recipient.email) missing.push('email');
  if (channel === 'SMS' && !recipient.phone) missing.push('phone');
  if (channel === 'LETTER') {
    const a: any = recipient.address || {};
    if (!a.line1 && !a.city) missing.push('postal address');
  }
  if (channel === 'IN_APP' && !recipient.userId) missing.push('internal user account');
  if (missing.length) {
    return { resolvable: false, recipient, missing, reason: `${recipientType} is missing: ${missing.join(', ')}` };
  }
  return { resolvable: true, recipient, missing: [] };
}

// ─── Merge context ────────────────────────────────────────────────
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

// ─── Channel dispatchers ──────────────────────────────────────────
async function queueNotificationQueue(channel: 'EMAIL' | 'SMS', recipient: any, templateId: string | null, subject: string | null, mergeContext: Record<string, any>, claimId: string, eventCode: string) {
  const template = templateId ? await loadTemplateForChannel(templateId, channel) : null;
  const renderedSubject = template?.subject ? mergePlaceholders(template.subject, mergeContext) : subject;
  const renderedBody = template?.body ? mergePlaceholders(template.body, mergeContext) : '';
  const row = {
    template_id: templateId,
    channel: channel.toLowerCase(),
    recipient_address: channel === 'EMAIL' ? recipient?.email : recipient?.phone,
    subject: renderedSubject,
    title: renderedSubject,
    body: renderedBody,
    status: 'queued',
    trigger_source: 'benefit_management',
    metadata: { ...mergeContext, claimId, eventCode, recipientName: recipient?.name || '' },
    created_at: new Date().toISOString(),
  };
  const { data, error } = await db.from('notification_logs').insert(row).select('id').single();
  if (error) throw error;
  return data?.id as string;
}

async function loadTemplateForChannel(templateId: string, channel: BnChannel) {
  const expected = channel === 'INTERNAL_EMAIL' ? 'email' : channel.toLowerCase();
  const { data, error } = await db
    .from('notification_templates')
    .select('id, template_code, name, channel, subject, body, html_body, is_enabled')
    .eq('id', templateId)
    .maybeSingle();
  if (error) throw error;
  if (!data || String(data.channel || '').toLowerCase() !== expected) {
    if (channel === 'LETTER') throw new Error('No letter template configured for this event/product.');
    throw new Error(`Template channel mismatch: ${channel} mapping must use a ${expected.toUpperCase()} template.`);
  }
  return data;
}

async function resolveTemplateForEventChannel(eventCode: string, channel: BnChannel, templateId?: string | null) {
  if (templateId) {
    try {
      const template = await loadTemplateForChannel(templateId, channel);
      return template.id as string;
    } catch (error) {
      if (channel !== 'LETTER') throw error;
      // Digital-to-letter fallback may pass the original EMAIL/SMS/IN_APP template.
      // Ignore it and resolve the proper LETTER template by event below.
    }
  }
  const expected = channel === 'INTERNAL_EMAIL' ? 'email' : channel.toLowerCase();
  const { data, error } = await db
    .from('notification_templates')
    .select('id')
    .eq('trigger_event', eventCode)
    .eq('channel', expected)
    .eq('is_enabled', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id && channel === 'LETTER') throw new Error('No letter template configured for this event/product.');
  if (!data?.id) throw new Error(`No ${expected.toUpperCase()} template configured for this event/product.`);
  return data.id as string;
}

async function createInAppNotification(userIdOrCode: string | undefined, subject: string, body: string, claimId: string, eventCode: string) {
  if (!userIdOrCode) return null;
  const { data, error } = await db.from('in_app_notifications').insert({
    user_id: userIdOrCode,
    title: subject,
    body,
    category: 'benefit_management',
    entity_type: 'bn_claim',
    entity_id: claimId,
    metadata: { eventCode },
    is_read: false,
  }).select('id').single();
  if (error) return null;
  return data?.id as string;
}

// ─── Letter creation (DRAFT state — print/dispatch happens via UI) ──
async function createLetter(params: {
  claimId: string; eventCode: string; templateId: string | null;
  recipientType: BnRecipientType; recipient: any; subject: string;
  mergeContext: Record<string, any>; isMandatoryLetter: boolean; userCode?: string;
}) {
  const letterTemplateId = await resolveTemplateForEventChannel(params.eventCode, 'LETTER', params.templateId);

  const { data, error } = await db.from('bn_letter').insert({
    claim_id: params.claimId,
    event_code: params.eventCode,
    template_id: letterTemplateId,
    recipient_type: params.recipientType,
    recipient_name: params.recipient?.name || '',
    recipient_address_snapshot: params.recipient?.address || null,
    subject: params.subject,
    merge_context: params.mergeContext,
    department_code: 'BENEFITS',
    issued_department_code: 'BENEFITS',
    document_type: bnDocumentTypeFor(params.eventCode),
    status: params.isMandatoryLetter ? 'PENDING_APPROVAL' : 'GENERATED',
    generated_at: new Date().toISOString(),
    created_by: params.userCode || null,
  }).select('id').single();
  if (error) throw error;
  try {
    await ensureBnLetterSnapshot(data.id);
  } catch (snapshotError: any) {
    await db.from('bn_letter').update({ status: 'FAILED', notes: snapshotError?.message || 'Letter rendering failed' }).eq('id', data.id);
    throw snapshotError;
  }
  return data?.id as string;
}

// ─── Communication log ────────────────────────────────────────────
async function writeCommLog(row: {
  claimId: string; eventCode: string; channel: BnChannel; recipientType: BnRecipientType;
  recipientAddress?: string; templateId?: string | null; subject?: string;
  status: 'QUEUED' | 'SENT' | 'FAILED' | 'SKIPPED' | 'BLOCKED' | 'GENERATED' | 'PRINT_PENDING' | 'PRINTED' | 'DISPATCHED' | 'RETRYING' | 'DELIVERED';
  providerId?: string | null;
  letterId?: string | null; workflowStepId?: string; error?: string;
  context?: Record<string, any>; userCode?: string;
}) {
  const { data, error } = await db.from('bn_communication_log').insert({
    claim_id: row.claimId,
    event_code: row.eventCode,
    channel: row.channel, // legacy
    delivery_method: row.channel,
    recipient_type: row.recipientType,
    recipient_address: row.recipientAddress,
    template_id: row.templateId || null,
    subject: row.subject,
    status: row.status,
    provider_message_id: row.providerId || null,
    letter_id: row.letterId || null,
    workflow_step_id: row.workflowStepId || null,
    error_message: row.error || null,
    context: row.context || null,
    created_by: row.userCode || null,
  }).select('id').single();
  if (error) return null;
  return data?.id as string;
}

// ─── Diagnostics suggested-fix builder ─────────────────────────────
function buildSuggestedFix(channel: string, recipientType: string, missing: string[]): string {
  if (missing.includes('mapping')) return 'Configure mapping in Product Catalog → Communications';
  if (missing.includes('recipient')) {
    if (recipientType === 'ASSIGNED_OFFICER') return 'Assign claim to an officer (or log in as the officer triggering the action).';
    if (recipientType === 'CLAIMANT' || recipientType === 'PAYEE') return 'Open the claimant record and verify SSN/contact details exist.';
    return `Verify the ${recipientType} master record exists for this claim.`;
  }
  if (missing.includes('email')) return `Add an email address to the ${recipientType.toLowerCase()} record.`;
  if (missing.includes('phone')) return `Add a mobile number to the ${recipientType.toLowerCase()} record (ip_master.mobile / phone_mobile).`;
  if (missing.includes('postal address')) return `Add a mailing address (mail_addr1 / city) to the ${recipientType.toLowerCase()} record.`;
  if (missing.includes('internal user account')) {
    if (recipientType === 'CLAIMANT') return 'Claimant has no linked portal account; in-app delivery requires external_user_person_link.';
    if (recipientType === 'ASSIGNED_OFFICER') return 'Claim has no assigned officer and no current logged-in user available; assign the claim or trigger as a logged-in officer.';
    return `No internal user resolved for ${recipientType}; configure assignment or fallback.`;
  }
  return 'Review communication mapping, template and recipient configuration.';
}

// ─── Top-level event dispatcher (QUARANTINED LEGACY PATH) ─────────
//
// Omni-Comms convergence: this dispatcher is NOT a permitted producer path.
// New Benefits business communications must be raised through
// `triggerClaimCommunicationViaOmniComms()` → the single `sendCommunication`
// façade. It survives only so that a pre-existing `bn_communication_log`
// entry can still be serviced (retry) by an operator, and it refuses any
// other caller.
export async function triggerClaimCommunication(
  eventCode: string,
  claimId: string,
  ctx?: BnCommContext,
  servicing?: { legacyLogId: string },
): Promise<BnCommDispatchResult> {
  if (!servicing?.legacyLogId) {
    throw new Error(
      'Benefits communications must be raised through Omni-Comms (triggerClaimCommunicationViaOmniComms). ' +
        'The legacy dispatcher is quarantined and only services historical bn_communication_log entries.',
    );
  }

  const result: BnCommDispatchResult = { eventCode, dispatched: 0, skipped: 0, failed: 0, blocked: 0, letters: [], logIds: [], warnings: [] };

  // 1. Resolve event metadata
  const { data: event } = await db.from('bn_comm_event').select('*').eq('event_code', eventCode).maybeSingle();
  if (!event || !event.active) {
    result.warnings.push(`Event ${eventCode} not registered or inactive.`);
    return result;
  }

  // 2. Resolve mappings (product-scoped first, then global)
  let mappingQuery = db.from('bn_comm_mapping').select('*').eq('event_code', eventCode).eq('active', true);
  const { data: allMappings } = await mappingQuery;
  let mappings: any[] = (allMappings || []).map((m: any) => ({
    ...m,
    // Normalize: prefer delivery_method, fall back to legacy channel
    channel: m.delivery_method || m.channel,
    delivery_method: m.delivery_method || m.channel,
  }));
  if (ctx?.productVersionId) {
    const scoped = mappings.filter(m => m.bn_product_version_id === ctx.productVersionId);
    if (scoped.length > 0) mappings = scoped;
    else mappings = mappings.filter(m => !m.bn_product_version_id);
  } else {
    mappings = mappings.filter(m => !m.bn_product_version_id);
  }

  // 3. Build merge context once
  const mergeContext = await buildBnMergeContext(claimId, {
    reasonCode: ctx?.reasonCode,
    reasonDescription: ctx?.reasonDescription,
    appealDeadline: ctx?.appealDeadline,
    ...(ctx?.extra || {}),
  });

  // 4. Ensure mandatory letter even if no mapping exists yet
  const hasLetterMapping = mappings.some(m => m.channel === 'LETTER');
  if (event.is_mandatory_letter && !hasLetterMapping) {
    mappings.push({
      event_code: eventCode,
      channel: 'LETTER',
      delivery_method: 'LETTER',
      recipient_type: 'CLAIMANT',
      template_id: null,
      is_required: true,
      fallback_priority: 999,
    });
  }

  // 5. If no mappings at all, log a BLOCKED entry — required event with no configured mapping.
  if (mappings.length === 0) {
    const id = await writeCommLog({
      claimId, eventCode, channel: 'IN_APP', recipientType: 'ASSIGNED_OFFICER',
      status: 'BLOCKED', error: 'No communication mapping configured for this event in Product Catalog',
      userCode: ctx?.userCode, workflowStepId: ctx?.workflowStepId,
      context: { missing: ['mapping'], action: 'Configure mapping in Product Catalog → Communications' },
    });
    if (id) result.logIds.push(id);
    result.blocked += 1;
    return result;
  }

  // 6. Dispatch each mapping
  for (const m of mappings) {
    const isRequired = m.is_required === true || event.is_mandatory_letter === true;
    try {
      const diag = await diagnoseRecipient(claimId, m.recipient_type as BnRecipientType, m.channel as BnChannel, ctx);
      const recipient = diag.recipient;
      const subject = `${event.event_name}${mergeContext.ClaimNumber ? ` — ${mergeContext.ClaimNumber}` : ''}`;

      if (!diag.resolvable) {
        // If channel is digital but event mandates a letter, fall back to letter generation
        const canFallbackToLetter = event.is_mandatory_letter && m.channel !== 'LETTER';
        if (canFallbackToLetter) {
          const letterId = await createLetter({
            claimId, eventCode, templateId: m.template_id, recipientType: m.recipient_type,
            recipient: recipient || { name: m.recipient_type }, subject, mergeContext,
            isMandatoryLetter: true, userCode: ctx?.userCode,
          });
          result.letters.push(letterId);
          const id = await writeCommLog({
            claimId, eventCode, channel: 'LETTER', recipientType: m.recipient_type,
            recipientAddress: recipient?.name, templateId: m.template_id, subject,
            status: 'GENERATED', letterId, userCode: ctx?.userCode,
            workflowStepId: ctx?.workflowStepId,
            context: { fallbackFrom: m.channel, missing: diag.missing, reason: diag.reason },
          });
          if (id) result.logIds.push(id);
          result.dispatched += 1;
          continue;
        }

        const status: 'BLOCKED' | 'SKIPPED' = isRequired ? 'BLOCKED' : 'SKIPPED';
        if (status === 'BLOCKED') result.blocked += 1; else result.skipped += 1;
        const suggestedFix = buildSuggestedFix(m.channel, m.recipient_type, diag.missing);
        const id = await writeCommLog({
          claimId, eventCode, channel: m.channel, recipientType: m.recipient_type,
          status, error: diag.reason || 'Recipient not resolved',
          templateId: m.template_id, workflowStepId: ctx?.workflowStepId, userCode: ctx?.userCode,
          context: {
            missing: diag.missing, required: isRequired, suggestedFix,
            resolvedRecipient: diag.recipient ? { name: diag.recipient.name, email: diag.recipient.email, phone: diag.recipient.phone, userId: diag.recipient.userId } : null,
          },
        });
        if (id) result.logIds.push(id);
        continue;
      }

      const fallbackNote = (recipient as any)?.fallbackUsed === 'current-user'
        ? 'Assigned officer fallback used: current user'
        : undefined;

      // Channel-specific dispatch
      if (m.channel === 'EMAIL' || m.channel === 'INTERNAL_EMAIL') {
        const providerId = await queueNotificationQueue('EMAIL', recipient, m.template_id, subject, mergeContext, claimId, eventCode);
        const id = await writeCommLog({
          claimId, eventCode, channel: m.channel, recipientType: m.recipient_type, recipientAddress: recipient!.email,
          templateId: m.template_id, subject, status: 'QUEUED', providerId, userCode: ctx?.userCode,
          workflowStepId: ctx?.workflowStepId,
          context: fallbackNote ? { fallbackNote } : undefined,
        });
        if (id) result.logIds.push(id);
        result.dispatched += 1;
      } else if (m.channel === 'SMS') {
        const providerId = await queueNotificationQueue('SMS', recipient, m.template_id, subject, mergeContext, claimId, eventCode);
        const id = await writeCommLog({
          claimId, eventCode, channel: 'SMS', recipientType: m.recipient_type, recipientAddress: recipient!.phone,
          templateId: m.template_id, subject, status: 'QUEUED', providerId, userCode: ctx?.userCode,
          workflowStepId: ctx?.workflowStepId,
          context: fallbackNote ? { fallbackNote } : undefined,
        });
        if (id) result.logIds.push(id);
        result.dispatched += 1;
      } else if (m.channel === 'IN_APP') {
        const inAppId = await createInAppNotification(recipient!.userId, subject, mergeContext.ReasonDescription || event.description || '', claimId, eventCode);
        const id = await writeCommLog({
          claimId, eventCode, channel: 'IN_APP', recipientType: m.recipient_type, recipientAddress: recipient!.userId,
          templateId: m.template_id, subject, status: inAppId ? 'SENT' : (isRequired ? 'BLOCKED' : 'SKIPPED'),
          providerId: inAppId, userCode: ctx?.userCode, workflowStepId: ctx?.workflowStepId,
          error: inAppId ? undefined : 'No internal user account resolved for in-app delivery',
          context: inAppId
            ? (fallbackNote ? { fallbackNote } : undefined)
            : { missing: ['internal user account'], suggestedFix: buildSuggestedFix('IN_APP', m.recipient_type, ['internal user account']) },
        });
        if (id) result.logIds.push(id);
        if (inAppId) result.dispatched += 1;
        else if (isRequired) result.blocked += 1;
        else result.skipped += 1;
      } else if (m.channel === 'LETTER') {
        const letterId = await createLetter({
          claimId, eventCode, templateId: m.template_id, recipientType: m.recipient_type,
          recipient: recipient!, subject, mergeContext, isMandatoryLetter: !!event.is_mandatory_letter, userCode: ctx?.userCode,
        });
        result.letters.push(letterId);
        const id = await writeCommLog({
          claimId, eventCode, channel: 'LETTER', recipientType: m.recipient_type, recipientAddress: recipient!.name,
          templateId: m.template_id, subject, status: 'GENERATED', letterId, userCode: ctx?.userCode,
          workflowStepId: ctx?.workflowStepId,
          context: fallbackNote ? { fallbackNote } : undefined,
        });
        if (id) result.logIds.push(id);
        result.dispatched += 1;
      }
    } catch (err: any) {
      result.failed += 1;
      const msg = err?.message || 'Unknown error';
      const isMissingTable = /notification_queue|schema cache|relation .* does not exist/i.test(msg);
      const isTemplateIssue = /template/i.test(msg);
      const suggestedFix = isMissingTable
        ? 'notification_queue table missing or stale schema cache: apply latest migrations.'
        : isTemplateIssue
          ? 'Check the Communication template (channel match, enabled, body present).'
          : 'Review server logs and retry; if persistent, contact admin.';
      const id = await writeCommLog({
        claimId, eventCode, channel: m.channel, recipientType: m.recipient_type,
        status: 'FAILED', error: msg,
        templateId: m.template_id, workflowStepId: ctx?.workflowStepId, userCode: ctx?.userCode,
        context: { suggestedFix, technicalError: msg },
      });
      if (id) result.logIds.push(id);
    }
  }

  // 7. Mirror to claim timeline (non-blocking)
  try {
    await db.from('bn_claim_event').insert({
      claim_id: claimId,
      event_type: `COMM_${eventCode}`,
      notes: `Dispatched ${result.dispatched} • Skipped ${result.skipped} • Blocked ${result.blocked} • Failed ${result.failed}`,
      performed_by: ctx?.userCode || 'SYSTEM',
      performed_at: new Date().toISOString(),
      metadata: { eventCode, ...result },
    });
  } catch { /* non-blocking */ }

  return result;
}

// ─── Convenience wrappers (named per spec §4) ─────────────────────
export const generateClaimLetter = (eventCode: string, claimId: string, ctx?: BnCommContext) =>
  triggerClaimCommunication(eventCode, claimId, ctx);
export const queueClaimEmail = generateClaimLetter;
export const queueClaimSms = generateClaimLetter;

// ─── History ──────────────────────────────────────────────────────
export async function getClaimCommunicationHistory(claimId: string) {
  const [{ data: logs }, { data: letters }] = await Promise.all([
    db.from('bn_communication_log').select('*').eq('claim_id', claimId).order('created_at', { ascending: false }).limit(500),
    db.from('bn_letter').select('*').eq('claim_id', claimId).order('created_at', { ascending: false }).limit(200),
  ]);
  return { logs: logs || [], letters: letters || [] };
}

// ─── Letter lifecycle actions (UI-triggered) ──────────────────────
export async function updateLetterStatus(letterId: string, newStatus: string, userCode: string, notes?: string) {
  const patch: any = { status: newStatus, notes };
  const now = new Date().toISOString();
  if (newStatus === 'APPROVED_TO_PRINT') { patch.approved_at = now; patch.approved_by = userCode; }
  if (newStatus === 'PRINTED') { patch.printed_at = now; patch.printed_by = userCode; }
  if (newStatus === 'DISPATCHED') { patch.dispatched_at = now; patch.dispatched_by = userCode; }
  if (newStatus === 'DELIVERED') { patch.delivered_at = now; }
  if (newStatus === 'RETURNED') { patch.returned_at = now; }
  if (newStatus === 'CANCELLED') { patch.cancelled_at = now; }
  const { error } = await db.from('bn_letter').update(patch).eq('id', letterId);
  if (error) throw error;
  return true;
}

export async function retryCommunication(logId: string, userCode: string) {
  const { data: log } = await db.from('bn_communication_log').select('*').eq('id', logId).maybeSingle();
  if (!log) throw new Error('Log entry not found');
  if (!['FAILED', 'SKIPPED', 'BLOCKED'].includes(log.status)) throw new Error('Only failed/skipped/blocked entries can be retried');
  await db.from('bn_communication_log').update({
    retry_count: (log.retry_count || 0) + 1,
    last_retry_at: new Date().toISOString(),
    status: 'RETRYING',
  }).eq('id', logId);
  return triggerClaimCommunication(log.event_code, log.claim_id, { userCode });
}

// ─── Manual / fallback actions ────────────────────────────────────

/**
 * "Generate Letter Instead" — used when a digital channel is BLOCKED but the
 * user still wants to dispatch via mail. Creates a bn_letter row and a
 * GENERATED comm log entry against the same event.
 */
export async function generateLetterFromBlocked(logId: string, userCode: string): Promise<string> {
  const { data: log } = await db.from('bn_communication_log').select('*').eq('id', logId).maybeSingle();
  if (!log) throw new Error('Communication entry not found');
  const diag = await diagnoseRecipient(log.claim_id, log.recipient_type, 'LETTER');
  const merge = await buildBnMergeContext(log.claim_id);
  const letterId = await createLetter({
    claimId: log.claim_id, eventCode: log.event_code, templateId: log.template_id || null,
    recipientType: log.recipient_type, recipient: diag.recipient || { name: log.recipient_type },
    subject: log.subject || log.event_code, mergeContext: merge, isMandatoryLetter: false, userCode,
  });
  await writeCommLog({
    claimId: log.claim_id, eventCode: log.event_code, channel: 'LETTER',
    recipientType: log.recipient_type, recipientAddress: diag.recipient?.name,
    templateId: log.template_id || null, subject: log.subject || undefined,
    status: 'GENERATED', letterId, userCode, context: { generatedFromBlockedLogId: logId },
  });
  // Resolve the original BLOCKED entry
  await db.from('bn_communication_log').update({
    status: 'SKIPPED',
    error_message: 'Replaced by manually generated letter',
    context: { ...(log.context || {}), replacedByLetterId: letterId },
  }).eq('id', logId);
  return letterId;
}

/**
 * "Mark Manually Dispatched" — operator confirms they delivered the message
 * outside the system (e.g. phone call, hand-delivered letter). Closes the
 * communication entry to DISPATCHED.
 */
export async function markCommunicationManuallyDispatched(logId: string, userCode: string, note?: string) {
  const { error } = await db.from('bn_communication_log').update({
    status: 'DISPATCHED',
    error_message: null,
    context: { manualDispatch: true, note: note || null, by: userCode, at: new Date().toISOString() },
  }).eq('id', logId);
  if (error) throw error;
  return true;
}
