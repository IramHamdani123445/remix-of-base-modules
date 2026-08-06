/**
 * BN Benefits — Secure Query Edge Function.
 *
 * Sole server-side read path for the browser into the benefits domain.
 *
 * BN-MORT-UI-1B fail-closed authorisation contract:
 *   - JWT presence + valid subject required.
 *   - app_modules.name = descriptor.moduleCode is loaded.
 *   - app_modules.is_enabled = true.
 *   - app_modules.routes_enabled = true.
 *   - Caller has at least one of descriptor.anyOfCapabilities, resolved via
 *     user_roles -> roles -> role_permissions (is_granted = true) ->
 *     module_actions (is_enabled = true). Merely finding a capability row is
 *     not sufficient — every gate must pass.
 *
 * Every response conforms to BnBenefitsQueryResult exactly:
 *   { status, correlationId, queryCode, queryVersion, data, page,
 *     errors, maskedFields, warnings }
 *
 * Statuses:
 *   OK        — handler succeeded
 *   DENIED    — auth/module/action/routes/capability gate failed
 *   INVALID   — parameter validation rejected the request
 *   NOT_FOUND — handler completed but the resource does not exist
 *   FAILED    — server error while running the handler
 *
 * The edge function ALWAYS returns HTTP 200 with the envelope so the browser
 * adapter preserves structured DENIED/INVALID/NOT_FOUND/FAILED results and
 * does not misrender them as empty datasets.
 */
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  calculateActionAvailability,
  aggregateAwardImpacts,
  validateListEventsParams,
  buildListEventsFilters,
} from './_shared.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const SAFE_TEXT_RE = /^[\p{L}\p{N}\s._@,'()\-\/]+$/u;

const ALLOWED_STATUSES = new Set([
  'DRAFT','REPORTED','VERIFICATION_PENDING','PROVISIONALLY_HELD','CONFLICT',
  'VERIFIED','REJECTED','CANCELLED','DUPLICATE','IMPACT_REVIEW','APPROVAL_PENDING',
  'CONFIRMED','FOLLOW_ON_PROCESSING','COMPLETED','CLOSED','REVERSED',
]);

const ALLOWED_SOURCES = new Set([
  'REGISTRAR_FEED','IP_MODULE','FAMILY_NOTIFICATION','HOSPITAL_NOTICE','STAFF_ENTRY','OTHER',
]);

const ALLOWED_SORT_COLUMNS = new Set([
  'reported_at','updated_at','sla_due_at','status','death_date',
]);

// PostgREST ilike wildcard escaping — %, _, and \ are wildcards/escape.
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

class QueryError extends Error {
  constructor(public status: 'INVALID' | 'NOT_FOUND' | 'FAILED', public code: string, message: string, public field?: string) {
    super(message);
  }
}

const invalid = (msg: string, field?: string) => new QueryError('INVALID', 'INVALID_PARAMS', msg, field);

interface QueryDescriptor {
  moduleCode: string;
  anyOfCapabilities: string[];
  sensitiveFields: string[];
  maxPageSize: number;
  handler: (
    admin: any,
    params: any,
    ctx: { limit: number; offset: number; userId: string },
  ) => Promise<{ data: any; totalCount: number | null; notFound?: boolean }>;
}

// -- Handlers ---------------------------------------------------------------

function firstOfMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function listEvents(
  admin: any,
  params: any,
  page: { limit: number; offset: number },
) {
  // BN-MORT-UX-2A §4 — Validation and filter-building are now pure helpers
  // in `_shared.ts` so the Deno list-handler test suite exercises the same
  // code path that runs in production.
  const spec = validateListEventsParams(params);
  const ops = buildListEventsFilters(spec);

  let q = admin
    .from('bn_mortality_event')
    .select(
      'id,event_reference,status,source,deceased_full_name,death_date,reported_at,assigned_to,sla_due_at,row_version,updated_at',
      { count: 'exact' },
    )
    .order(spec.sortBy, { ascending: spec.sortDir === 'asc' })
    .range(page.offset, page.offset + page.limit - 1);

  for (const op of ops) {
    switch (op.kind) {
      case 'eq':      q = q.eq(op.column, op.value); break;
      case 'is_null': q = q.is(op.column, null); break;
      case 'lt':      q = q.lt(op.column, op.value); break;
      case 'gte':     q = q.gte(op.column, op.value); break;
      case 'lte':     q = q.lte(op.column, op.value); break;
      case 'not_in':  q = q.not(op.column, 'in', `(${op.value.join(',')})`); break;
      case 'or_ilike': {
        const parts = op.columns.map((c) => `${c}.ilike.%${op.term}%`).join(',');
        q = q.or(parts);
        break;
      }
    }
  }

  const { data, error, count } = await q;
  if (error) throw new QueryError('FAILED', 'LIST_EVENTS_FAILED', error.message);
  return { data: data ?? [], totalCount: typeof count === 'number' ? count : null };
}


// Explicit allow-list of columns the getEvent DTO exposes. Never `select('*')`.
const EVENT_COLUMNS = [
  'id','event_reference','status','source',
  'deceased_full_name','deceased_dob','deceased_gender','deceased_national_id',
  'death_date','death_time','death_place','death_cause',
  'matched_ip_id','match_confidence','matched_at',
  'verification_source','verification_reference','verification_confidence','verified_at',
  'assigned_to','created_by','sla_due_at','row_version',
  'reported_at','submitted_for_verification_at','submitted_for_verification_by',
  'confirmed_at','confirmed_by','completed_at','closed_at','reversed_at',
  'correlation_id','created_at','updated_at',
  // Admin-only fields — intentionally selected so the masking layer can null them.
  'metadata_json','registrar_reference',
  'match_score','rejected_reason','conflict_reason','reversal_reason','verification_notes',
].join(',');

async function getEvent(admin: any, params: any) {
  if (!params?.eventId || !UUID_RE.test(String(params.eventId))) throw invalid('eventId must be UUID', 'eventId');
  const { data, error } = await admin
    .from('bn_mortality_event')
    .select(EVENT_COLUMNS)
    .eq('id', params.eventId)
    .maybeSingle();
  if (error) throw new QueryError('FAILED', 'GET_EVENT_FAILED', error.message);
  if (!data) return { data: null, totalCount: 0, notFound: true };
  const dto = {
    id: data.id,
    eventReference: data.event_reference,
    status: data.status,
    source: data.source,
    deceased: {
      fullName: data.deceased_full_name,
      dateOfBirth: data.deceased_dob,
      gender: data.deceased_gender,
      nationalIdMasked: maskNationalId(data.deceased_national_id),
    },
    death: {
      date: data.death_date,
      time: data.death_time,
      place: data.death_place,
      cause: data.death_cause,
    },
    matched: {
      ipId: data.matched_ip_id,
      confidence: data.match_confidence,
      matchedAt: data.matched_at,
    },
    verification: {
      source: data.verification_source,
      reference: data.verification_reference,
      confidence: data.verification_confidence,
      verifiedAt: data.verified_at,
    },
    assignedTo: data.assigned_to,
    createdBy: data.created_by,
    slaDueAt: data.sla_due_at,
    rowVersion: data.row_version,
    reportedAt: data.reported_at,
    submittedForVerificationAt: data.submitted_for_verification_at,
    submittedForVerificationBy: data.submitted_for_verification_by,
    confirmedAt: data.confirmed_at,
    confirmedBy: data.confirmed_by,
    completedAt: data.completed_at,
    closedAt: data.closed_at,
    reversedAt: data.reversed_at,
    correlationId: data.correlation_id,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    // Admin-only — masked unless caller holds bn_mortality:admin.
    sourcePayload: data.metadata_json,
    externalReferenceRaw: data.registrar_reference,
    diagnostics: {
      matchScore: data.match_score,
      rejectedReason: data.rejected_reason,
      conflictReason: data.conflict_reason,
      reversalReason: data.reversal_reason,
      verificationNotes: data.verification_notes,
    },
  };
  return { data: dto, totalCount: 1 };
}

async function getSummary(admin: any, params: any) {
  if (params?.eventId) {
    if (!UUID_RE.test(String(params.eventId))) throw invalid('eventId must be UUID', 'eventId');
    const { data, error } = await admin
      .from('bn_mortality_event')
      .select('id,event_reference,status,deceased_full_name,death_date,sla_due_at,assigned_to,row_version,updated_at')
      .eq('id', params.eventId)
      .maybeSingle();
    if (error) throw new QueryError('FAILED', 'GET_SUMMARY_FAILED', error.message);
    return { data: data ?? null, totalCount: data ? 1 : 0, notFound: !data };
  }

  const now = new Date().toISOString();
  const monthStart = firstOfMonthIso();

  const [statusResp, overdueResp, unassignedResp, closedThisMonthResp, recentResp] = await Promise.all([
    admin.from('bn_mortality_event').select('status'),
    admin.from('bn_mortality_event').select('id', { count: 'exact', head: true })
      .lt('sla_due_at', now)
      .not('status', 'in', '(CLOSED,CANCELLED,DUPLICATE,REVERSED)'),
    admin.from('bn_mortality_event').select('id', { count: 'exact', head: true })
      .is('assigned_to', null)
      .not('status', 'in', '(CLOSED,CANCELLED,DUPLICATE,REVERSED)'),
    admin.from('bn_mortality_event').select('id', { count: 'exact', head: true })
      .eq('status', 'CLOSED').gte('closed_at', monthStart),
    admin.from('bn_mortality_event')
      .select('id,event_reference,status,deceased_full_name,death_date,reported_at,assigned_to,sla_due_at')
      .order('reported_at', { ascending: false }).limit(10),
  ]);

  if (statusResp.error) throw new QueryError('FAILED', 'GET_SUMMARY_FAILED', statusResp.error.message);
  if (recentResp.error) throw new QueryError('FAILED', 'GET_SUMMARY_FAILED', recentResp.error.message);

  const statusRows = (statusResp.data ?? []) as any[];
  const byStatus: Record<string, number> = {};
  for (const r of statusRows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const openNonTerminal = statusRows.filter(
    (r: any) => !['CLOSED','CANCELLED','DUPLICATE','REVERSED'].includes(r.status),
  ).length;

  const dto = {
    totals: {
      all: statusRows.length,
      byStatus,
      totalOpen: openNonTerminal,
      openNonTerminal,
      unassigned: typeof unassignedResp.count === 'number' ? unassignedResp.count : 0,
      verificationPending: byStatus['VERIFICATION_PENDING'] ?? 0,
      provisionallyHeld: byStatus['PROVISIONALLY_HELD'] ?? 0,
      conflicts: byStatus['CONFLICT'] ?? 0,
      impactReview: byStatus['IMPACT_REVIEW'] ?? 0,
      approvalPending: byStatus['APPROVAL_PENDING'] ?? 0,
      followOnProcessing: byStatus['FOLLOW_ON_PROCESSING'] ?? 0,
      overdue: typeof overdueResp.count === 'number' ? overdueResp.count : 0,
      closedThisMonth: typeof closedThisMonthResp.count === 'number' ? closedThisMonthResp.count : 0,
    },
    recent: recentResp.data ?? [],
    generatedAt: now,
  };
  return { data: dto, totalCount: 1 };
}

function requireEventId(params: any): string {
  const id = params?.eventId;
  if (!id || typeof id !== 'string' || !UUID_RE.test(id)) throw invalid('eventId must be UUID', 'eventId');
  return id;
}

async function getEventHistory(admin: any, params: any, page: { limit: number; offset: number }) {
  const eventId = requireEventId(params);
  const { data, error, count } = await admin
    .from('bn_mortality_event_history')
    .select(
      'id,event_id,command_name,from_status,to_status,actor_user_id,actor_user_code,occurred_at,correlation_id,reason_code,justification',
      { count: 'exact' },
    )
    .eq('event_id', eventId)
    .order('occurred_at', { ascending: false })
    .range(page.offset, page.offset + page.limit - 1);
  if (error) throw new QueryError('FAILED', 'GET_EVENT_HISTORY_FAILED', error.message);
  const dto = (data ?? []).map((r: any) => ({
    id: r.id,
    eventId: r.event_id,
    commandName: r.command_name,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    actorUserId: r.actor_user_id,
    actorUserCode: r.actor_user_code,
    occurredAt: r.occurred_at,
    correlationId: r.correlation_id,
    reasonCode: r.reason_code,
    justification: r.justification,
  }));
  return { data: dto, totalCount: typeof count === 'number' ? count : null };
}

async function getAwardImpacts(admin: any, params: any, page: { limit: number; offset: number }) {
  const eventId = requireEventId(params);
  const { data, error, count } = await admin
    .from('bn_mortality_award_impact')
    .select(
      'id,event_id,bn_award_id,bn_claim_id,award_reference,action,impact_decision,impact_status,approval_state,' +
        'hold_required,hold_status,hold_date,hold_servicing_event_id,hold_reference,' +
        'release_servicing_event_id,release_reference,' +
        'termination_required,termination_status,termination_effective_date,termination_servicing_event_id,termination_reference,' +
        'original_award_status,original_award_amount,payment_frequency,' +
        'estimated_pad_minor,future_schedule_count,beneficiary_link,last_valid_payment_date,' +
        'integration_status,integration_failure_code,integration_failure_message,integration_attempted_at,' +
        'payment_after_death_minor,currency_code,overpayment_id,overpayment_reference,' +
        'approved_at,approved_by,applied_at,row_version,created_at,updated_at',
      { count: 'exact' },
    )
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .range(page.offset, page.offset + page.limit - 1);
  if (error) throw new QueryError('FAILED', 'GET_AWARD_IMPACTS_FAILED', error.message);
  const awardIds = (data ?? []).map((r: any) => r.bn_award_id).filter(Boolean);
  const awardStatus: Record<string, string> = {};
  if (awardIds.length) {
    const { data: aRows, error: aErr } = await admin.from('bn_award').select('id,status,end_date').in('id', awardIds);
    if (aErr) throw new QueryError('FAILED', 'GET_AWARD_IMPACTS_FAILED', aErr.message);
    for (const a of (aRows ?? []) as any[]) awardStatus[a.id] = a.status;
  }
  const dto = (data ?? []).map((r: any) => ({
    id: r.id,
    eventId: r.event_id,
    awardId: r.bn_award_id,
    claimId: r.bn_claim_id,
    awardReference: r.award_reference,
    action: r.action,
    impactDecision: r.impact_decision,
    impactStatus: r.impact_status,
    approvalState: r.approval_state,
    currentAwardStatus: r.bn_award_id ? (awardStatus[r.bn_award_id] ?? null) : null,
    originalAwardStatus: r.original_award_status,
    originalAwardAmountMinor: r.original_award_amount,
    paymentFrequency: r.payment_frequency,
    holdRequired: r.hold_required,
    holdStatus: r.hold_status,
    holdDate: r.hold_date,
    holdServicingReference: r.hold_reference,
    releaseServicingReference: r.release_reference,
    terminationRequired: r.termination_required,
    terminationStatus: r.termination_status,
    terminationEffectiveDate: r.termination_effective_date,
    terminationServicingReference: r.termination_reference,
    futureScheduleCount: r.future_schedule_count ?? 0,
    beneficiaryLink: r.beneficiary_link === true,
    lastValidPaymentDate: r.last_valid_payment_date,
    estimatedPadMinor: r.estimated_pad_minor ?? r.payment_after_death_minor ?? 0,
    currencyCode: r.currency_code,
    integrationStatus: r.integration_status ?? 'NONE',
    integrationFailure:
      r.integration_status && String(r.integration_status).endsWith('_FAILED')
        ? { code: r.integration_failure_code ?? 'INTEGRATION_FAILURE',
            summary: 'Servicing integration failed — see servicing audit for details.' }
        : null,
    integrationAttemptedAt: r.integration_attempted_at,
    overpaymentId: r.overpayment_id,
    overpaymentReference: r.overpayment_reference,
    approvedAt: r.approved_at,
    approvedBy: r.approved_by,
    appliedAt: r.applied_at,
    rowVersion: r.row_version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    award360Route: r.bn_award_id ? `/bn/awards/${r.bn_award_id}` : null,
  }));
  return { data: dto, totalCount: typeof count === 'number' ? count : null };
}

async function getAffectedAwards(admin: any, params: any, page: { limit: number; offset: number }) {
  const eventId = requireEventId(params);
  const { data: impacts, error } = await admin
    .from('bn_mortality_award_impact')
    .select('id,bn_award_id,bn_claim_id,award_reference,action,effective_date,payment_after_death_minor,estimated_pad_minor,currency_code,overpayment_id,overpayment_reference,approval_state,hold_status,termination_status,impact_decision,impact_status,integration_status,created_at')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .range(page.offset, page.offset + page.limit - 1);
  if (error) throw new QueryError('FAILED', 'GET_AFFECTED_AWARDS_FAILED', error.message);

  let rows: any[] = impacts ?? [];
  if (rows.length === 0) {
    const { data: ev, error: evErr } = await admin
      .from('bn_mortality_event')
      .select('matched_ip_id').eq('id', eventId).maybeSingle();
    if (evErr) throw new QueryError('FAILED', 'GET_AFFECTED_AWARDS_FAILED', evErr.message);
    if (ev?.matched_ip_id) {
      const { data: claims, error: cErr } = await admin.from('bn_claim').select('id').eq('ip_id', ev.matched_ip_id);
      if (cErr) throw new QueryError('FAILED', 'GET_AFFECTED_AWARDS_FAILED', cErr.message);
      const claimIds = (claims ?? []).map((c: any) => c.id);
      if (claimIds.length) {
        const { data: awards, error: aErr } = await admin
          .from('bn_award')
          .select('id,award_reference,status,award_amount,frequency,start_date,end_date,bn_claim_id')
          .in('bn_claim_id', claimIds);
        if (aErr) throw new QueryError('FAILED', 'GET_AFFECTED_AWARDS_FAILED', aErr.message);
        rows = (awards ?? []).map((a: any) => ({
          id: null,
          bn_award_id: a.id,
          bn_claim_id: a.bn_claim_id,
          award_reference: a.award_reference,
          action: 'NONE',
          approval_state: 'PENDING',
          hold_status: 'NOT_REQUIRED',
          termination_status: 'NOT_REQUIRED',
          impact_decision: 'PENDING',
          impact_status: 'PENDING',
          integration_status: 'NONE',
          _award_shape: a,
        }));
      }
    }
  }
  const awardIds = rows.map((r: any) => r.bn_award_id).filter(Boolean);
  let awards: any[] = [];
  if (awardIds.length) {
    const { data: aRows, error: aErr } = await admin.from('bn_award')
      .select('id,award_reference,status,award_amount,frequency,start_date,end_date').in('id', awardIds);
    if (aErr) throw new QueryError('FAILED', 'GET_AFFECTED_AWARDS_FAILED', aErr.message);
    awards = aRows ?? [];
  }
  const awardsById: Record<string, any> = Object.fromEntries(awards.map((a: any) => [a.id, a]));
  const dto = rows.map((i: any, idx: number) => ({
    id: i.id ?? (i.bn_award_id ? `preview:${eventId}:${i.bn_award_id}` : `preview:${eventId}:row:${idx}`),
    impactId: i.id,
    eventId,
    awardId: i.bn_award_id,
    claimId: i.bn_claim_id,
    awardReference: i.award_reference ?? awardsById[i.bn_award_id]?.award_reference ?? null,
    action: i.action ?? 'NONE',
    currentAwardStatus: awardsById[i.bn_award_id]?.status ?? i._award_shape?.status ?? null,
    approvalState: i.approval_state ?? null,
    holdStatus: i.hold_status ?? null,
    terminationStatus: i.termination_status ?? null,
    impactDecision: i.impact_decision ?? null,
    impactStatus: i.impact_status ?? null,
    integrationStatus: i.integration_status ?? 'NONE',
    estimatedPadMinor: i.estimated_pad_minor ?? i.payment_after_death_minor ?? 0,
    currencyCode: i.currency_code ?? null,
    overpaymentId: i.overpayment_id ?? null,
    overpaymentReference: i.overpayment_reference ?? null,
    sourceIsFallbackScan: i.id === null || i.id === undefined,
    award360Route: i.bn_award_id ? `/bn/awards/${i.bn_award_id}` : null,
    holdRequired: false, terminationRequired: false, originalAwardStatus: null, paymentFrequency: null,
    holdDate: null, terminationEffectiveDate: null, holdServicingReference: null,
    releaseServicingReference: null, terminationServicingReference: null, futureScheduleCount: 0,
    beneficiaryLink: false, lastValidPaymentDate: null, integrationFailure: null,
    integrationAttemptedAt: null, approvedAt: null, approvedBy: null, appliedAt: null,
    rowVersion: 0, createdAt: null, updatedAt: null,
  }));
  return { data: dto, totalCount: dto.length };
}

async function previewRegistrationImpact(admin: any, params: any) {
  const matchedIpId = params?.matchedIpId;
  const deathDate = params?.deathDate;
  const source = params?.source;
  const externalReference = params?.externalReference;

  if (matchedIpId != null && (typeof matchedIpId !== 'string' || matchedIpId.length > 64)) {
    throw invalid('matchedIpId must be string ≤ 64 chars', 'matchedIpId');
  }
  if (matchedIpId != null && !SAFE_TEXT_RE.test(matchedIpId)) {
    throw invalid('matchedIpId contains unsafe characters', 'matchedIpId');
  }
  if (!deathDate || !ISO_DATE_RE.test(String(deathDate))) {
    throw invalid('deathDate must be ISO date', 'deathDate');
  }
  const dd = new Date(String(deathDate));
  const nowMs = Date.now();
  if (isNaN(dd.getTime())) throw invalid('deathDate is not parseable', 'deathDate');
  // Reject future dates outside a small clock-skew window (24h).
  if (dd.getTime() > nowMs + 24 * 3600 * 1000) {
    throw invalid('deathDate cannot be in the future', 'deathDate');
  }
  if (source && !ALLOWED_SOURCES.has(String(source))) {
    throw invalid('source not allowed', 'source');
  }
  if (externalReference != null) {
    const er = String(externalReference);
    if (er.length > 100) throw invalid('externalReference too long', 'externalReference');
    if (er.length > 0 && !SAFE_TEXT_RE.test(er)) {
      throw invalid('externalReference contains unsafe characters', 'externalReference');
    }
  }

  const warnings: Array<{ code: string; message: string; severity: 'INFO' | 'WARN' | 'CRIT' }> = [];

  if (!matchedIpId) {
    warnings.push({
      code: 'NO_MATCH_SELECTED',
      message: 'No canonical person selected — affected-award preview is unavailable until a match or explicit "no match" decision is recorded.',
      severity: 'INFO',
    });
    return { data: { matchedIpId: null, deathDate, source: source ?? null, externalReference: externalReference ?? null, awards: [], warnings, duplicates: [], generatedAt: new Date().toISOString() }, totalCount: 0 };
  }

  // Verify matchedIpId exists in ip_master before any Awards lookup.
  const { data: ipRow, error: ipErr } = await admin
    .from('ip_master').select('id').eq('id', matchedIpId).maybeSingle();
  if (ipErr) throw new QueryError('FAILED', 'PREVIEW_FAILED', ipErr.message);
  if (!ipRow) {
    throw new QueryError('INVALID', 'MATCHED_IP_NOT_FOUND', 'matchedIpId does not exist in ip_master', 'matchedIpId');
  }

  const { data: dups, error: dErr } = await admin
    .from('bn_mortality_event')
    .select('id,event_reference,status,death_date')
    .eq('matched_ip_id', matchedIpId)
    .eq('death_date', deathDate)
    .not('status', 'in', '(CANCELLED,DUPLICATE,REVERSED)');
  if (dErr) throw new QueryError('FAILED', 'PREVIEW_FAILED', dErr.message);
  const duplicates = (dups ?? []) as any[];
  if (duplicates.length > 0) {
    warnings.push({
      code: 'DUPLICATE_EVENT_SUSPECTED',
      message: `An existing mortality event already exists for this person and death date (${duplicates.length} match${duplicates.length === 1 ? '' : 'es'}).`,
      severity: 'CRIT',
    });
  }

  const { data: claims, error: cErr } = await admin.from('bn_claim').select('id').eq('ip_id', matchedIpId);
  if (cErr) throw new QueryError('FAILED', 'PREVIEW_FAILED', cErr.message);
  const claimIds = (claims ?? []).map((c: any) => c.id);
  let awards: any[] = [];
  if (claimIds.length === 0) {
    warnings.push({ code: 'NO_CLAIMS_FOR_IP', message: 'This person has no claims in the benefits system.', severity: 'INFO' });
  } else {
    const { data: rows, error: aErr } = await admin
      .from('bn_award')
      .select('id,award_reference,status,award_amount,frequency,start_date,end_date,bn_claim_id')
      .in('bn_claim_id', claimIds);
    if (aErr) throw new QueryError('FAILED', 'PREVIEW_FAILED', aErr.message);
    awards = rows ?? [];
  }

  const preview = awards.map((a: any) => {
    const isActive = a.status === 'ACTIVE' || a.status === 'IN_PAYMENT';
    let likelyAction: 'NONE' | 'HOLD' | 'TERMINATE' | 'PAD_RECOVERY' | 'PRORATE' = 'NONE';
    const flags: string[] = [];
    if (isActive) {
      likelyAction = 'HOLD';
      flags.push('LIKELY_HOLD');
      if (a.end_date == null || new Date(a.end_date) > new Date(deathDate)) {
        flags.push('LIKELY_TERMINATE');
        likelyAction = 'TERMINATE';
      }
      flags.push('POTENTIAL_PAD_IF_PAID_AFTER_DEATH');
    }
    return {
      id: `preview:${matchedIpId}:${a.id}`,
      awardId: a.id, awardReference: a.award_reference, currentAwardStatus: a.status,
      awardAmount: a.award_amount, frequency: a.frequency,
      startDate: a.start_date, endDate: a.end_date, likelyAction, flags,
    };
  });

  if (preview.length === 0 && claimIds.length > 0) {
    warnings.push({ code: 'NO_AWARDS_FOUND', message: 'Claims exist but no awards were discovered for this person.', severity: 'INFO' });
  }

  return {
    data: {
      matchedIpId, deathDate, source: source ?? null, externalReference: externalReference ?? null,
      awards: preview, warnings,
      duplicates: duplicates.map((d) => ({ id: d.id, eventReference: d.event_reference, status: d.status, deathDate: d.death_date })),
      generatedAt: new Date().toISOString(),
    },
    totalCount: preview.length,
  };
}

async function getReferrals(admin: any, params: any, page: { limit: number; offset: number }) {
  const eventId = requireEventId(params);
  const { data, error, count } = await admin
    .from('bn_mortality_referral')
    .select('id,event_id,referral_type,target_module,target_ref_type,target_ref_id,target_reference,status,raised_at,raised_by,correlation_id,accepted_at,completed_at,failure_reason', { count: 'exact' })
    .eq('event_id', eventId)
    .order('raised_at', { ascending: false })
    .range(page.offset, page.offset + page.limit - 1);
  if (error) throw new QueryError('FAILED', 'GET_REFERRALS_FAILED', error.message);
  const dto = (data ?? []).map((r: any) => ({
    id: r.id, eventId: r.event_id, referralType: r.referral_type, targetModule: r.target_module,
    targetRefType: r.target_ref_type, targetRefId: r.target_ref_id, targetReference: r.target_reference,
    status: r.status, raisedAt: r.raised_at, raisedBy: r.raised_by, correlationId: r.correlation_id,
    acceptedAt: r.accepted_at, completedAt: r.completed_at, failureReason: r.failure_reason,
  }));
  return { data: dto, totalCount: typeof count === 'number' ? count : null };
}

async function getEvidenceLinks(admin: any, params: any, page: { limit: number; offset: number }) {
  const eventId = requireEventId(params);
  const { data, error, count } = await admin
    .from('core_generated_document')
    .select('id,document_type,title,file_reference,generated_at,generated_by,status', { count: 'exact' })
    .eq('module_code', 'bn_mortality')
    .eq('reference_id', eventId)
    .order('generated_at', { ascending: false })
    .range(page.offset, page.offset + page.limit - 1);
  if (error) throw new QueryError('FAILED', 'GET_EVIDENCE_LINKS_FAILED', error.message);
  const dto = (data ?? []).map((r: any) => ({
    id: r.id, documentType: r.document_type ?? null, title: r.title ?? null,
    fileReference: r.file_reference ?? null, generatedAt: r.generated_at ?? null,
    generatedBy: r.generated_by ?? null, status: r.status ?? null,
  }));
  return { data: dto, totalCount: typeof count === 'number' ? count : null };
}

async function getCommunications(admin: any, params: any, page: { limit: number; offset: number }) {
  const eventId = requireEventId(params);
  const { data, error, count } = await admin
    .from('communication_hub_trace')
    .select('id,event_code,module_code,status,recipient_summary,sent_at,created_at', { count: 'exact' })
    .eq('module_code', 'bn_mortality')
    .eq('external_reference', eventId)
    .order('created_at', { ascending: false })
    .range(page.offset, page.offset + page.limit - 1);
  if (error) throw new QueryError('FAILED', 'GET_COMMUNICATIONS_FAILED', error.message);
  const dto = (data ?? []).map((r: any) => ({
    id: r.id, eventCode: r.event_code ?? null, moduleCode: r.module_code ?? null,
    status: r.status ?? null, recipientSummary: r.recipient_summary ?? null,
    sentAt: r.sent_at ?? null, createdAt: r.created_at ?? null,
  }));
  return { data: dto, totalCount: typeof count === 'number' ? count : null };
}

/**
 * BN-MORT-M3 — Canonical evidence register (`bn_mortality_evidence`).
 *
 * Distinct from BN_MORTALITY_GET_EVIDENCE_LINKS, which lists officially
 * generated documents. This handler exposes the operational evidence
 * register: type, DMS reference, receipt date, status, and provenance.
 */
async function getEvidenceRegister(admin: any, params: any, page: { limit: number; offset: number }) {
  const eventId = requireEventId(params);
  const { data, error, count } = await admin
    .from('bn_mortality_evidence')
    .select('id,event_id,evidence_type,dms_document_id,dms_reference,received_at,status,notes,correlation_id,created_at,created_by', { count: 'exact' })
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .range(page.offset, page.offset + page.limit - 1);
  if (error) throw new QueryError('FAILED', 'GET_EVIDENCE_FAILED', error.message);
  const dto = (data ?? []).map((r: any) => ({
    id: r.id,
    eventId: r.event_id,
    evidenceType: r.evidence_type,
    dmsDocumentId: r.dms_document_id ?? null,
    dmsReference: r.dms_reference ?? null,
    receivedAt: r.received_at ?? null,
    status: r.status,
    notes: r.notes ?? null,
    correlationId: r.correlation_id ?? null,
    createdAt: r.created_at,
    createdBy: r.created_by ?? null,
  }));
  return { data: dto, totalCount: typeof count === 'number' ? count : null };
}

/** BN-MORT-M3 — Required follow-on actions (closure gate). */
async function getRequiredActions(admin: any, params: any, page: { limit: number; offset: number }) {
  const eventId = requireEventId(params);
  const { data, error, count } = await admin
    .from('bn_mortality_required_action')
    .select('id,event_id,action_code,is_mandatory,status,handoff_id,resolved_at,resolved_by,created_at', { count: 'exact' })
    .eq('event_id', eventId)
    .order('created_at', { ascending: true })
    .range(page.offset, page.offset + page.limit - 1);
  if (error) throw new QueryError('FAILED', 'GET_REQUIRED_ACTIONS_FAILED', error.message);
  const dto = (data ?? []).map((r: any) => ({
    id: r.id,
    eventId: r.event_id,
    actionCode: r.action_code,
    isMandatory: r.is_mandatory === true,
    status: r.status,
    handoffId: r.handoff_id ?? null,
    resolvedAt: r.resolved_at ?? null,
    resolvedBy: r.resolved_by ?? null,
    createdAt: r.created_at,
    blocksClosure: r.is_mandatory === true && r.status === 'OPEN',
  }));
  return { data: dto, totalCount: typeof count === 'number' ? count : null };
}

/** BN-MORT-M5 — Governed cross-module handoffs raised by this event. */
async function getHandoffs(admin: any, params: any, page: { limit: number; offset: number }) {
  const eventId = requireEventId(params);
  const { data, error, count } = await admin
    .from('bn_cross_module_handoff')
    .select(
      'handoff_id,source_module,source_record_id,target_module,handoff_type,reason_code,status,' +
        'award_id,claim_id,target_record_id,target_reference,correlation_id,created_at,created_by,accepted_at,accepted_by,updated_at,row_version',
      { count: 'exact' },
    )
    .eq('source_module', 'bn_mortality')
    .eq('source_record_id', eventId)
    .order('created_at', { ascending: false })
    .range(page.offset, page.offset + page.limit - 1);
  if (error) throw new QueryError('FAILED', 'GET_HANDOFFS_FAILED', error.message);
  const dto = (data ?? []).map((r: any) => ({
    handoffId: r.handoff_id,
    sourceModule: r.source_module,
    sourceRecordId: r.source_record_id,
    targetModule: r.target_module,
    handoffType: r.handoff_type,
    reasonCode: r.reason_code ?? null,
    status: r.status,
    awardId: r.award_id ?? null,
    claimId: r.claim_id ?? null,
    targetRecordId: r.target_record_id ?? null,
    targetReference: r.target_reference ?? null,
    correlationId: r.correlation_id ?? null,
    createdAt: r.created_at,
    createdBy: r.created_by ?? null,
    acceptedAt: r.accepted_at ?? null,
    acceptedBy: r.accepted_by ?? null,
    updatedAt: r.updated_at,
    rowVersion: r.row_version,
    isOutstanding: ['PENDING', 'RAISED', 'ACCEPTED'].includes(String(r.status)),
  }));
  return { data: dto, totalCount: typeof count === 'number' ? count : null };
}

const PENDING_HANDOFF_STATUSES = ['PENDING', 'RAISED', 'ACCEPTED'];

/**
 * BN-MORT-M3 — Worklist operational indicators for a page of events.
 *
 * The dashboard renders one row per event; this handler returns the
 * per-event operational signals (open mandatory actions, outstanding
 * handoffs, PAD exposure, active holds, evidence count) in a single
 * round trip so the worklist never issues N queries.
 */
async function getWorklistIndicators(admin: any, params: any) {
  const raw = params?.eventIds;
  if (!Array.isArray(raw) || raw.length === 0) throw invalid('eventIds must be a non-empty array', 'eventIds');
  if (raw.length > 100) throw invalid('eventIds accepts at most 100 ids', 'eventIds');
  const eventIds = raw.map((v: any) => String(v));
  for (const id of eventIds) {
    if (!UUID_RE.test(id)) throw invalid('eventIds must contain UUIDs only', 'eventIds');
  }

  const base: Record<string, any> = {};
  for (const id of eventIds) {
    base[id] = {
      eventId: id,
      openMandatoryActions: 0,
      outstandingHandoffs: 0,
      failedHandoffs: 0,
      evidenceCount: 0,
      impactCount: 0,
      awaitingApprovalImpacts: 0,
      activeHolds: 0,
      padExposureMinor: 0,
      currencyCode: null as string | null,
    };
  }

  const [actions, handoffs, evidence, impacts] = await Promise.all([
    admin.from('bn_mortality_required_action').select('event_id,is_mandatory,status').in('event_id', eventIds),
    admin.from('bn_cross_module_handoff').select('source_record_id,status')
      .eq('source_module', 'bn_mortality').in('source_record_id', eventIds),
    admin.from('bn_mortality_evidence').select('event_id,status').in('event_id', eventIds),
    admin.from('bn_mortality_award_impact')
      .select('event_id,approval_state,hold_status,estimated_pad_minor,payment_after_death_minor,currency_code')
      .in('event_id', eventIds),
  ]);

  for (const r of [actions, handoffs, evidence, impacts]) {
    if (r.error) throw new QueryError('FAILED', 'GET_WORKLIST_INDICATORS_FAILED', r.error.message);
  }

  for (const a of (actions.data ?? []) as any[]) {
    const t = base[a.event_id];
    if (t && a.is_mandatory === true && a.status === 'OPEN') t.openMandatoryActions += 1;
  }
  for (const h of (handoffs.data ?? []) as any[]) {
    const t = base[h.source_record_id];
    if (!t) continue;
    if (PENDING_HANDOFF_STATUSES.includes(String(h.status))) t.outstandingHandoffs += 1;
    if (String(h.status) === 'FAILED') t.failedHandoffs += 1;
  }
  for (const e of (evidence.data ?? []) as any[]) {
    const t = base[e.event_id];
    if (t && ['ATTACHED', 'RECEIVED'].includes(String(e.status))) t.evidenceCount += 1;
  }
  for (const i of (impacts.data ?? []) as any[]) {
    const t = base[i.event_id];
    if (!t) continue;
    t.impactCount += 1;
    if (['PENDING', 'AWAITING_APPROVAL', 'SUBMITTED'].includes(String(i.approval_state))) t.awaitingApprovalImpacts += 1;
    if (['APPLIED', 'ACTIVE', 'HELD'].includes(String(i.hold_status))) t.activeHolds += 1;
    t.padExposureMinor += Number(i.estimated_pad_minor ?? i.payment_after_death_minor ?? 0) || 0;
    if (!t.currencyCode && i.currency_code) t.currencyCode = i.currency_code;
  }

  const dto = eventIds.map((id) => base[id]);
  return { data: dto, totalCount: dto.length };
}

/**
 * BN-MORT-M4 — Benefit 360 integration.
 *
 * Returns the mortality posture for a single award: the governing event,
 * the recorded impact, and the payment-after-death exposure. Award 360
 * renders this read-only; it never mutates mortality state.
 */
async function getAwardMortalitySnapshot(admin: any, params: any) {
  const awardId = params?.awardId;
  if (!awardId || !UUID_RE.test(String(awardId))) throw invalid('awardId must be UUID', 'awardId');

  const { data: impacts, error } = await admin
    .from('bn_mortality_award_impact')
    .select('id,event_id,award_reference,action,impact_status,approval_state,hold_status,termination_status,' +
      'estimated_pad_minor,payment_after_death_minor,currency_code,overpayment_reference,last_valid_payment_date,updated_at')
    .eq('bn_award_id', awardId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new QueryError('FAILED', 'GET_AWARD_MORTALITY_FAILED', error.message);

  const impact = (impacts ?? [])[0] ?? null;
  if (!impact) {
    return { data: { awardId, hasMortalityEvent: false, event: null, impact: null }, totalCount: 0 };
  }

  const { data: ev, error: evErr } = await admin
    .from('bn_mortality_event')
    .select('id,event_reference,status,death_date,deceased_full_name,reported_at,confirmed_at')
    .eq('id', impact.event_id)
    .maybeSingle();
  if (evErr) throw new QueryError('FAILED', 'GET_AWARD_MORTALITY_FAILED', evErr.message);

  return {
    data: {
      awardId,
      hasMortalityEvent: true,
      event: ev
        ? {
            id: ev.id,
            eventReference: ev.event_reference,
            status: ev.status,
            deathDate: ev.death_date,
            deceasedFullName: ev.deceased_full_name,
            reportedAt: ev.reported_at,
            confirmedAt: ev.confirmed_at,
            route: `/bn/mortality/${ev.id}`,
          }
        : null,
      impact: {
        id: impact.id,
        action: impact.action,
        impactStatus: impact.impact_status,
        approvalState: impact.approval_state,
        holdStatus: impact.hold_status,
        terminationStatus: impact.termination_status,
        estimatedPadMinor: impact.estimated_pad_minor ?? impact.payment_after_death_minor ?? 0,
        currencyCode: impact.currency_code ?? 'XCD',
        overpaymentReference: impact.overpayment_reference ?? null,
        lastValidPaymentDate: impact.last_valid_payment_date ?? null,
        updatedAt: impact.updated_at,
      },
    },
    totalCount: 1,
  };
}

async function searchPersonMatches(admin: any, params: any, page: { limit: number; offset: number }) {
  if (params?.nationalId != null) {
    const n = String(params.nationalId);
    if (n.length > 64 || !SAFE_TEXT_RE.test(n)) throw invalid('nationalId is invalid', 'nationalId');
  }
  if (params?.fullName != null) {
    const n = String(params.fullName);
    if (n.length > 100) throw invalid('fullName too long', 'fullName');
  }
  let q = admin
    .from('ip_master')
    .select('id,ssn,first_name,last_name,dob,gender', { count: 'exact' })
    .range(page.offset, page.offset + page.limit - 1);
  if (params?.nationalId) q = q.eq('ssn', params.nationalId);
  else if (params?.fullName) q = q.ilike('last_name', `%${escapeLike(String(params.fullName))}%`);
  const { data, error, count } = await q;
  if (error) throw new QueryError('FAILED', 'SEARCH_PERSON_MATCHES_FAILED', error.message);
  const rows = (data ?? []).map((r: any) => ({
    ipId: r.id,
    fullName: [r.first_name, r.last_name].filter(Boolean).join(' '),
    nationalIdMasked: maskNationalId(r.ssn),
    dateOfBirth: r.dob, gender: r.gender, confidenceInternals: null,
  }));
  return { data: rows, totalCount: typeof count === 'number' ? count : null };
}

// ==== BN-AP-00 — Appeals handlers ==========================================
//
// Ownership derivation: `bn_appeal.claimant_person_id` is authoritative but
// the trusted linkage from a JWT is `external_user_person_link.user_id -> ssn`
// (mirrors the pattern used by `bn_appeal_submit_claimant`). We therefore
// resolve the caller's verified SSN set and constrain reads to `bn_claim`
// rows whose SSN matches. The client CANNOT supply a claim id list.

async function resolveCallerLinkedSsns(admin: any, userId: string): Promise<string[]> {
  const { data, error } = await admin
    .from('external_user_person_link')
    .select('ssn')
    .eq('user_id', userId);
  if (error) throw new QueryError('FAILED', 'CALLER_LINK_LOOKUP_FAILED', error.message);
  const set = new Set<string>();
  for (const r of data ?? []) if (r?.ssn) set.add(String(r.ssn));
  return Array.from(set);
}

async function resolveCallerClaimIds(admin: any, userId: string): Promise<string[]> {
  const ssns = await resolveCallerLinkedSsns(admin, userId);
  if (ssns.length === 0) return [];
  const { data, error } = await admin
    .from('bn_claim')
    .select('id')
    .in('ssn', ssns);
  if (error) throw new QueryError('FAILED', 'CALLER_CLAIMS_LOOKUP_FAILED', error.message);
  return (data ?? []).map((r: any) => String(r.id));
}

async function getMyAppeals(admin: any, _params: any, ctx: { limit: number; offset: number; userId: string }) {
  const claimIds = await resolveCallerClaimIds(admin, ctx.userId);
  if (claimIds.length === 0) return { data: [], totalCount: 0 };
  const { data, error, count } = await admin
    .from('bn_appeal')
    .select(
      'id, appeal_number, bn_claim_id, appeal_type_code, status, outcome, submitted_at, filing_deadline_date, reason_summary, decided_at',
      { count: 'exact' },
    )
    .in('bn_claim_id', claimIds)
    .order('submitted_at', { ascending: false })
    .range(ctx.offset, ctx.offset + ctx.limit - 1);
  if (error) throw new QueryError('FAILED', 'APPEAL_LIST_QUERY_FAILED', error.message);
  const rows = (data ?? []).map((r: any) => ({
    id: r.id,
    appealNumber: r.appeal_number,
    bnClaimId: r.bn_claim_id,
    appealTypeCode: r.appeal_type_code,
    status: r.status,
    outcome: r.outcome,
    submittedAt: r.submitted_at,
    filingDeadlineDate: r.filing_deadline_date,
    reasonSummary: r.reason_summary,
    decidedAt: r.decided_at,
  }));
  return { data: rows, totalCount: typeof count === 'number' ? count : null };
}

async function getMyAppealDetail(admin: any, params: any, ctx: { limit: number; offset: number; userId: string }) {
  const appealId = params?.appealId ? String(params.appealId) : null;
  if (!appealId || !UUID_RE.test(appealId)) throw invalid('appealId must be UUID', 'appealId');
  const claimIds = await resolveCallerClaimIds(admin, ctx.userId);
  if (claimIds.length === 0) return { data: null, totalCount: 0, notFound: true };
  const { data, error } = await admin
    .from('bn_appeal')
    .select(
      'id, appeal_number, bn_claim_id, appeal_type_code, status, outcome, submitted_at, filing_deadline_date, reason_summary, acknowledged_at, decided_at, implemented_at, closed_at',
    )
    .eq('id', appealId)
    .in('bn_claim_id', claimIds)
    .maybeSingle();
  if (error) throw new QueryError('FAILED', 'APPEAL_DETAIL_QUERY_FAILED', error.message);
  if (!data) return { data: null, totalCount: 0, notFound: true };
  return {
    data: {
      id: data.id,
      appealNumber: data.appeal_number,
      bnClaimId: data.bn_claim_id,
      appealTypeCode: data.appeal_type_code,
      status: data.status,
      outcome: data.outcome,
      submittedAt: data.submitted_at,
      acknowledgedAt: data.acknowledged_at,
      decidedAt: data.decided_at,
      implementedAt: data.implemented_at,
      closedAt: data.closed_at,
      filingDeadlineDate: data.filing_deadline_date,
      reasonSummary: data.reason_summary,
    },
    totalCount: 1,
  };
}

// ── BN-AP-01 §C — Real staff Appeals query handlers ──────────────────────
const APPEAL_OPEN_STATES = [
  'DRAFT','SUBMITTED','ACKNOWLEDGED','ADMISSIBILITY_REVIEW','ADMISSIBLE',
  'CASE_PREPARATION','HEARING_SCHEDULED','HEARING_HELD','RECOMMENDED','DECIDED',
  'IMPLEMENTATION_PENDING','PARTIALLY_IMPLEMENTED','REFERRED_TO_LEGAL',
];

/**
 * Canonical appeals command catalogue mirrored server-side.
 * Kept in lock-step with `src/types/bn/appeals/appealCommands.ts` — the
 * parity test asserts these two lists agree.
 */
const APPEAL_COMMAND_CATALOG: {
  command: string;
  displayName: string;
  capability: string;
  implemented: boolean;
  validFrom: string[];
  blocker?: string;
}[] = [
  { command: 'BN_APPEAL_SUBMIT_CLAIMANT', displayName: 'Submit appeal (claimant portal)', capability: 'bn_appeals:claimant_submit', implemented: true, validFrom: [] },
  { command: 'BN_APPEAL_REGISTER_RECEIVED_APPEAL', displayName: 'Register Received Appeal (staff-assisted intake)', capability: 'bn_appeals:write', implemented: false, validFrom: [], blocker: 'Handler not yet delivered (AP-01 Slice 2).' },
  { command: 'BN_APPEAL_ACKNOWLEDGE', displayName: 'Acknowledge submission', capability: 'bn_appeals:write', implemented: false, validFrom: ['SUBMITTED'], blocker: 'Handler not yet delivered (AP-01 Slice 2).' },
  { command: 'BN_APPEAL_REVIEW_ADMISSIBILITY', displayName: 'Review admissibility', capability: 'bn_appeals:admissibility_review', implemented: false, validFrom: ['ACKNOWLEDGED','ADMISSIBILITY_REVIEW','RECOMMENDED'], blocker: 'Handler not yet delivered (AP-01 Slice 2).' },
  { command: 'BN_APPEAL_ASSIGN', displayName: 'Assign to officer / workbasket', capability: 'bn_appeals:assign', implemented: false, validFrom: ['SUBMITTED','ACKNOWLEDGED','ADMISSIBILITY_REVIEW','ADMISSIBLE','CASE_PREPARATION','HEARING_SCHEDULED','HEARING_HELD','RECOMMENDED','DECIDED','IMPLEMENTATION_PENDING'], blocker: 'Handler not yet delivered (AP-01 Slice 2).' },
  { command: 'BN_APPEAL_ATTACH_EVIDENCE', displayName: 'Attach evidence', capability: 'bn_appeals:write', implemented: false, validFrom: ['SUBMITTED','ACKNOWLEDGED','ADMISSIBILITY_REVIEW','ADMISSIBLE','CASE_PREPARATION','HEARING_SCHEDULED','HEARING_HELD'], blocker: 'Handler not yet delivered (AP-01 Slice 2).' },
  { command: 'BN_APPEAL_START_CASE_PREPARATION', displayName: 'Start case preparation', capability: 'bn_appeals:write', implemented: false, validFrom: ['ADMISSIBLE','HEARING_HELD'], blocker: 'Handler not yet delivered (AP-01 Slice 2).' },
  { command: 'BN_APPEAL_SCHEDULE_HEARING', displayName: 'Schedule hearing', capability: 'bn_appeals:write', implemented: false, validFrom: ['ADMISSIBLE','CASE_PREPARATION'], blocker: 'Handler not yet delivered (AP-01 Slice 2).' },
  { command: 'BN_APPEAL_RECORD_HEARING_OUTCOME', displayName: 'Record hearing outcome', capability: 'bn_appeals:write', implemented: false, validFrom: ['HEARING_SCHEDULED'], blocker: 'Handler not yet delivered (AP-01 Slice 2).' },
  { command: 'BN_APPEAL_RECOMMEND_OUTCOME', displayName: 'Recommend outcome', capability: 'bn_appeals:recommend', implemented: false, validFrom: ['ADMISSIBLE','CASE_PREPARATION','HEARING_HELD'], blocker: 'Handler not yet delivered (AP-01 Slice 2).' },
  { command: 'BN_APPEAL_DECIDE', displayName: 'Record decision', capability: 'bn_appeals:decide', implemented: false, validFrom: ['RECOMMENDED','HEARING_HELD'], blocker: 'Handler not yet delivered (AP-01 Slice 2).' },
  { command: 'BN_APPEAL_IMPLEMENT', displayName: 'Mark implementation complete', capability: 'bn_appeals:implement', implemented: false, validFrom: ['IMPLEMENTATION_PENDING','PARTIALLY_IMPLEMENTED'], blocker: 'Handler not yet delivered (AP-01 Slice 2).' },
  { command: 'BN_APPEAL_MARK_PARTIALLY_IMPLEMENTED', displayName: 'Mark partially implemented', capability: 'bn_appeals:implement', implemented: false, validFrom: ['IMPLEMENTATION_PENDING'], blocker: 'Handler not yet delivered (AP-01 Slice 2).' },
  { command: 'BN_APPEAL_WITHDRAW', displayName: 'Withdraw appeal', capability: 'bn_appeals:claimant_submit', implemented: false, validFrom: ['DRAFT','SUBMITTED','ACKNOWLEDGED','ADMISSIBILITY_REVIEW','ADMISSIBLE','CASE_PREPARATION','HEARING_SCHEDULED'], blocker: 'Handler not yet delivered (AP-01 Slice 2).' },
  { command: 'BN_APPEAL_CANCEL', displayName: 'Cancel (administrative)', capability: 'bn_appeals:admin', implemented: false, validFrom: ['DRAFT','SUBMITTED','ACKNOWLEDGED','ADMISSIBILITY_REVIEW'], blocker: 'Handler not yet delivered (AP-01 Slice 2).' },
  { command: 'BN_APPEAL_REFER_LEGAL', displayName: 'Refer to Legal', capability: 'bn_appeals:refer_legal', implemented: false, validFrom: ['ADMISSIBLE','CASE_PREPARATION','DECIDED','INADMISSIBLE'], blocker: 'Handler not yet delivered (AP-01 Slice 2).' },
  { command: 'BN_APPEAL_CLOSE', displayName: 'Close', capability: 'bn_appeals:decide', implemented: false, validFrom: ['DECIDED','IMPLEMENTED','PARTIALLY_IMPLEMENTED','WITHDRAWN','INADMISSIBLE','REFERRED_TO_LEGAL'], blocker: 'Handler not yet delivered (AP-01 Slice 2).' },
  { command: 'BN_APPEAL_REOPEN', displayName: 'Reopen (admin)', capability: 'bn_appeals:admin', implemented: false, validFrom: ['CLOSED','CANCELLED','WITHDRAWN'], blocker: 'Handler not yet delivered (AP-01 Slice 2).' },
];

/** Small helper — count rows matching a filter without hydrating them. */
async function countAppeal(admin: any, apply: (q: any) => any): Promise<number> {
  const base = admin.from('bn_appeal').select('id', { count: 'exact', head: true });
  const { count, error } = await apply(base);
  if (error) throw new QueryError('FAILED', 'APPEAL_SUMMARY_COUNT_FAILED', error.message);
  return typeof count === 'number' ? count : 0;
}

async function getAppealSummary(admin: any, _params: any, _ctx: any) {
  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000).toISOString();

  const [
    newSubmissions,
    acknowledgementOverdue,
    lateFilingReview,
    admissibilityReview,
    unassigned,
    hearingToSchedule,
    recommendationPending,
    decisionPending,
    implementationPending,
    legalReferrals,
    slaBreached,
    totalOpen,
  ] = await Promise.all([
    countAppeal(admin, (q) => q.gte('submitted_at', sevenDaysAgo)),
    countAppeal(admin, (q) => q.eq('status', 'SUBMITTED').lt('submitted_at', fiveDaysAgo)),
    countAppeal(admin, (q) => q.or('is_late_submission.eq.true,late_filing_status.eq.PENDING').in('late_filing_status', ['PENDING'])),
    countAppeal(admin, (q) => q.in('status', ['ADMISSIBILITY_REVIEW'])),
    countAppeal(admin, (q) => q.in('status', APPEAL_OPEN_STATES).is('assigned_to_user_id', null)),
    countAppeal(admin, (q) => q.eq('status', 'ADMISSIBLE').eq('requires_hearing', true).eq('hearing_waived', false)),
    countAppeal(admin, (q) => q.in('status', ['ADMISSIBLE','CASE_PREPARATION','HEARING_HELD'])),
    countAppeal(admin, (q) => q.eq('status', 'RECOMMENDED')),
    countAppeal(admin, (q) => q.in('status', ['IMPLEMENTATION_PENDING','PARTIALLY_IMPLEMENTED'])),
    countAppeal(admin, (q) => q.eq('status', 'REFERRED_TO_LEGAL')),
    countAppeal(admin, (q) => q.in('status', APPEAL_OPEN_STATES).lt('filing_deadline_date', today)),
    countAppeal(admin, (q) => q.in('status', APPEAL_OPEN_STATES)),
  ]);

  // Evidence outstanding: appeals in the work-up band with zero evidence rows.
  // Two-step because Postgrest lacks a first-class NOT EXISTS join here.
  const { data: openIds } = await admin
    .from('bn_appeal')
    .select('id')
    .in('status', ['ADMISSIBILITY_REVIEW','ADMISSIBLE','CASE_PREPARATION']);
  const ids = (openIds ?? []).map((r: any) => r.id);
  let evidenceOutstanding = 0;
  if (ids.length > 0) {
    const { data: withEvidence } = await admin
      .from('bn_appeal_evidence')
      .select('bn_appeal_id')
      .in('bn_appeal_id', ids);
    const hasEvidence = new Set((withEvidence ?? []).map((r: any) => r.bn_appeal_id));
    evidenceOutstanding = ids.filter((id: string) => !hasEvidence.has(id)).length;
  }

  return {
    data: {
      newSubmissions,
      acknowledgementOverdue,
      lateFilingReview,
      admissibilityReview,
      unassigned,
      evidenceOutstanding,
      hearingToSchedule,
      recommendationPending,
      decisionPending,
      implementationPending,
      legalReferrals,
      slaBreached,
      totalOpen,
    },
    totalCount: 1,
  };
}

async function listAppeals(admin: any, params: any, ctx: { limit: number; offset: number; userId: string }) {
  const f = params?.filters ?? {};
  const sort = (params?.sort ?? {}) as { field?: string; direction?: 'asc' | 'desc' };
  let q = admin
    .from('bn_appeal')
    .select(
      'id, appeal_number, bn_claim_id, source_module_code, appeal_type_code, appeal_channel, case_kind, review_level_code, submitted_at, filing_deadline_date, late_filing_status, status, outcome, assigned_to_user_id, assigned_workbasket, requires_hearing, hearing_waived, claimant_person_id, current_stage_code',
      { count: 'exact' },
    );

  if (typeof f.status === 'string') q = q.eq('status', f.status);
  else if (Array.isArray(f.status) && f.status.length > 0) q = q.in('status', f.status);

  if (typeof f.sourceModule === 'string') q = q.eq('source_module_code', f.sourceModule);
  if (typeof f.appealType === 'string') q = q.eq('appeal_type_code', f.appealType);
  if (typeof f.caseKind === 'string') q = q.eq('case_kind', f.caseKind);
  if (typeof f.reviewLevel === 'string') q = q.eq('review_level_code', f.reviewLevel);
  if (typeof f.assignedUser === 'string' && UUID_RE.test(f.assignedUser)) q = q.eq('assigned_to_user_id', f.assignedUser);
  if (typeof f.workbasket === 'string') q = q.eq('assigned_workbasket', f.workbasket);
  if (f.unassignedOnly === true) q = q.is('assigned_to_user_id', null);
  if (typeof f.lateFilingStatus === 'string') q = q.eq('late_filing_status', f.lateFilingStatus);
  if (typeof f.hearingRequired === 'boolean') q = q.eq('requires_hearing', f.hearingRequired);
  if (typeof f.submittedFrom === 'string') q = q.gte('submitted_at', f.submittedFrom);
  if (typeof f.submittedTo === 'string') q = q.lte('submitted_at', f.submittedTo);
  if (typeof f.decisionFrom === 'string') q = q.gte('decided_at', f.decisionFrom);
  if (typeof f.decisionTo === 'string') q = q.lte('decided_at', f.decisionTo);
  if (typeof f.search === 'string' && f.search.trim().length > 0) {
    q = q.ilike('appeal_number', `%${escapeLike(f.search.trim())}%`);
  }
  if (f.slaStatus === 'BREACHED') {
    const today = new Date().toISOString().slice(0, 10);
    q = q.in('status', APPEAL_OPEN_STATES).lt('filing_deadline_date', today);
  }

  const sortField = ({
    submittedAt: 'submitted_at',
    filingDeadlineDate: 'filing_deadline_date',
    status: 'status',
    appealNumber: 'appeal_number',
  } as Record<string, string>)[sort.field ?? 'submittedAt'] ?? 'submitted_at';
  q = q.order(sortField, { ascending: sort.direction === 'asc' });
  q = q.range(ctx.offset, ctx.offset + ctx.limit - 1);

  const { data, error, count } = await q;
  if (error) throw new QueryError('FAILED', 'APPEAL_LIST_QUERY_FAILED', error.message);

  // Enrich with appellant names via claim → ssn → ip_master (best-effort).
  const rows = data ?? [];
  const claimIds = [...new Set(rows.map((r: any) => r.bn_claim_id).filter(Boolean))];
  const ssnByClaim = new Map<string, string>();
  if (claimIds.length > 0) {
    const { data: claims } = await admin
      .from('bn_claim')
      .select('id, ssn, claim_number')
      .in('id', claimIds);
    for (const c of (claims ?? [])) ssnByClaim.set(String(c.id), c.ssn);
  }
  const claimNumberByClaim = new Map<string, string>();
  if (claimIds.length > 0) {
    const { data: claims } = await admin
      .from('bn_claim')
      .select('id, claim_number')
      .in('id', claimIds);
    for (const c of (claims ?? [])) claimNumberByClaim.set(String(c.id), c.claim_number);
  }
  const ssns = [...new Set([...ssnByClaim.values()].filter(Boolean))];
  const nameBySsn = new Map<string, string>();
  if (ssns.length > 0) {
    const { data: persons } = await admin
      .from('ip_master')
      .select('ssn, first_name, last_name')
      .in('ssn', ssns);
    for (const p of (persons ?? [])) {
      nameBySsn.set(String(p.ssn), `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Unknown');
    }
  }
  const today = new Date().toISOString().slice(0, 10);

  const nextActionForStatus = (s: string) => ({
    SUBMITTED: 'Acknowledge submission',
    ACKNOWLEDGED: 'Start admissibility review',
    ADMISSIBILITY_REVIEW: 'Decide admissibility',
    ADMISSIBLE: 'Prepare case / schedule hearing',
    CASE_PREPARATION: 'Recommend outcome',
    HEARING_SCHEDULED: 'Record hearing outcome',
    HEARING_HELD: 'Recommend outcome',
    RECOMMENDED: 'Record decision',
    DECIDED: 'Trigger implementation',
    IMPLEMENTATION_PENDING: 'Complete implementation',
    PARTIALLY_IMPLEMENTED: 'Complete remaining implementation',
    REFERRED_TO_LEGAL: 'Monitor legal referral',
  } as Record<string, string>)[s] ?? 'Review';

  const mapped = rows.map((r: any) => {
    const ssn = ssnByClaim.get(String(r.bn_claim_id));
    const appellantName = ssn ? nameBySsn.get(ssn) ?? null : null;
    return {
      id: r.id,
      appealNumber: r.appeal_number,
      appellantName,
      claimantSsnMasked: ssn ? maskNationalId(ssn) : null,
      sourceReference: claimNumberByClaim.get(String(r.bn_claim_id)) ?? null,
      sourceModule: r.source_module_code,
      appealType: r.appeal_type_code,
      caseKind: r.case_kind,
      reviewLevel: r.review_level_code,
      channel: r.appeal_channel,
      submittedAt: r.submitted_at,
      filingDeadlineDate: r.filing_deadline_date,
      lateFilingStatus: r.late_filing_status,
      status: r.status,
      outcome: r.outcome,
      assignedToUserId: r.assigned_to_user_id,
      assignedWorkbasket: r.assigned_workbasket,
      hearingRequired: !!r.requires_hearing && !r.hearing_waived,
      slaStatus: (r.filing_deadline_date && r.filing_deadline_date < today && APPEAL_OPEN_STATES.includes(r.status)) ? 'BREACHED' : 'OK',
      nextAction: nextActionForStatus(r.status),
    };
  });

  return { data: mapped, totalCount: typeof count === 'number' ? count : null };
}

// ── BN-AP-01 Slice 2A.3 — Appeal parent gate ────────────────────────────
// All Appeal child readers must return a canonical NOT_FOUND envelope when
// the parent Appeal is missing, rather than returning an empty page that the
// UI cannot distinguish from "no rows recorded". This helper is the single
// source of truth used by every appeal child handler below.
type AppealParent = {
  id: string;
  status: string;
  claimant_person_id: string | null;
  workflow_instance_id: string | null;
  appeal_number: string | null;
  bn_claim_id: string | null;
};
async function requireAppealParent(admin: any, params: any): Promise<AppealParent> {
  const id = params?.appealId ? String(params.appealId) : null;
  if (!id || !UUID_RE.test(id)) throw invalid('appealId must be UUID', 'appealId');
  const { data, error } = await admin
    .from('bn_appeal')
    .select('id, status, claimant_person_id, workflow_instance_id, appeal_number, bn_claim_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new QueryError('FAILED', 'APPEAL_PARENT_LOOKUP_FAILED', error.message);
  if (!data) throw new QueryError('NOT_FOUND', 'APPEAL_NOT_FOUND', `No appeal with id ${id}`);
  return data as AppealParent;
}

// Resolve display name from ip_master for a claimant_person_id. Never leaks SSN.
async function resolveAppellantName(admin: any, personId: string | null): Promise<string | null> {
  if (!personId) return null;
  const { data } = await admin
    .from('ip_master')
    .select('firstname, middle_name, surname')
    .eq('id', personId)
    .maybeSingle();
  if (!data) return null;
  const parts = [data.firstname, data.middle_name, data.surname]
    .filter((v: any) => typeof v === 'string' && v.trim().length > 0)
    .map((v: string) => v.trim());
  return parts.length ? parts.join(' ') : null;
}

async function getAppeal(admin: any, params: any, _ctx: any) {
  const parent = await requireAppealParent(admin, params);
  const { data, error } = await admin
    .from('bn_appeal')
    .select(
      'id, appeal_number, bn_claim_id, bn_award_id, bn_overpayment_id, source_module_code, source_decision_id, source_decision_date, appeal_type_code, appeal_channel, case_kind, review_level_code, is_late_submission, late_reason, late_filing_status, admissibility_status, submitted_at, acknowledged_at, decided_at, implemented_at, closed_at, filing_deadline_date, statutory_filing_days, requires_hearing, hearing_waived, status, outcome, outcome_effective_date, assigned_to_user_id, assigned_workbasket, current_stage_code, priority_code, reason_summary, row_version, entered_at, entered_by, claimant_person_id',
    )
    .eq('id', parent.id)
    .single();
  if (error) throw new QueryError('FAILED', 'APPEAL_GET_FAILED', error.message);

  // Enrich with appellant display name; header uses this rather than raw person id.
  const appellantName = await resolveAppellantName(admin, data.claimant_person_id);

  // Canonical camelCase DTO. SSN is never returned raw — the ip_master ssn is
  // deliberately not selected and no masked variant is emitted here; the
  // dashboard-side listAppeals continues to surface the masked identifier
  // separately when appropriate.
  const dto = {
    id: data.id,
    appealNumber: data.appeal_number,
    bnClaimId: data.bn_claim_id,
    bnAwardId: data.bn_award_id,
    bnOverpaymentId: data.bn_overpayment_id,
    sourceModuleCode: data.source_module_code,
    sourceDecisionId: data.source_decision_id,
    sourceDecisionDate: data.source_decision_date,
    sourceReference: data.source_module_code
      ? `${data.source_module_code}${data.source_decision_id ? `:${String(data.source_decision_id).slice(0, 8)}…` : ''}`
      : null,
    appealType: data.appeal_type_code,
    appealChannel: data.appeal_channel,
    caseKind: data.case_kind,
    reviewLevelCode: data.review_level_code,
    isLateSubmission: data.is_late_submission,
    lateReason: data.late_reason,
    lateFilingStatus: data.late_filing_status,
    admissibilityStatus: data.admissibility_status,
    submittedAt: data.submitted_at,
    acknowledgedAt: data.acknowledged_at,
    decidedAt: data.decided_at,
    implementedAt: data.implemented_at,
    closedAt: data.closed_at,
    filingDeadlineDate: data.filing_deadline_date,
    statutoryFilingDays: data.statutory_filing_days,
    requiresHearing: data.requires_hearing,
    hearingWaived: data.hearing_waived,
    status: data.status,
    outcome: data.outcome,
    outcomeEffectiveDate: data.outcome_effective_date,
    assignedToUserId: data.assigned_to_user_id,
    assignedWorkbasket: data.assigned_workbasket,
    currentStageCode: data.current_stage_code,
    priorityCode: data.priority_code,
    reasonSummary: data.reason_summary,
    rowVersion: data.row_version,
    enteredAt: data.entered_at,
    enteredBy: data.entered_by,
    appellantName,
    claimantSsnMasked: null,
    slaStatus:
      data.filing_deadline_date && data.submitted_at
        ? new Date(data.submitted_at) > new Date(data.filing_deadline_date)
          ? 'BREACHED'
          : 'OK'
        : null,
  };
  return { data: dto, totalCount: 1 };
}

async function getAppealSourceDecision(admin: any, params: any, _ctx: any) {
  const parent = await requireAppealParent(admin, params);
  const { data, error } = await admin
    .from('bn_appeal_source_decision')
    .select(
      'id, appeal_id, source_module_code, source_entity_id, source_entity_type, source_decision_id, source_decision_date, is_primary, relationship_type, snapshot_hash, captured_at, created_at',
    )
    .eq('appeal_id', parent.id)
    .eq('is_primary', true)
    .maybeSingle();
  if (error) throw new QueryError('FAILED', 'APPEAL_SOURCE_DECISION_FAILED', error.message);
  if (!data) throw new QueryError('NOT_FOUND', 'APPEAL_SOURCE_DECISION_NOT_FOUND', 'No primary source decision snapshotted');

  let sourceSummary: Record<string, any> | null = null;
  if (data.source_module_code === 'bn_claim' && data.source_entity_id) {
    const { data: claim } = await admin
      .from('bn_claim')
      .select('claim_number, status, decision_status, decided_at, benefit_type_code')
      .eq('id', data.source_entity_id)
      .maybeSingle();
    if (claim) {
      sourceSummary = {
        claimNumber: claim.claim_number,
        status: claim.status,
        decisionStatus: claim.decision_status,
        decidedAt: claim.decided_at,
        benefitTypeCode: claim.benefit_type_code,
      };
    }
  }
  const dto = {
    id: data.id,
    appealId: data.appeal_id,
    sourceModuleCode: data.source_module_code,
    sourceEntityType: data.source_entity_type,
    sourceEntityId: data.source_entity_id,
    sourceDecisionId: data.source_decision_id,
    sourceDecisionDate: data.source_decision_date,
    relationshipType: data.relationship_type,
    isPrimary: data.is_primary,
    snapshotHash: data.snapshot_hash,
    capturedAt: data.captured_at,
    createdAt: data.created_at,
    sourceSummary,
  };
  return { data: dto, totalCount: 1 };
}

async function getAppealActionAvailability(admin: any, params: any, ctx: { userId: string; limit: number; offset: number }) {
  // AP-01 Slice 2B §L — 18-row / 12-field canonical availability DTO.
  // Fail-closed: if the appealId is present, the parent must exist.
  let currentStatus: string | null = null;
  let sourceModule: string | null = null;
  if (params?.appealId) {
    const parent = await requireAppealParent(admin, params);
    currentStatus = parent.status;
    const { data: appealRow } = await admin
      .from('bn_appeal').select('source_module_code').eq('id', parent.id).maybeSingle();
    sourceModule = appealRow?.source_module_code ?? null;
  }

  const { data: mod } = await admin
    .from('app_modules')
    .select('is_enabled, routes_enabled, actions_enabled, rollout_state')
    .eq('name', 'bn_appeals')
    .maybeSingle();
  const staffActionsEnabled = !!mod?.actions_enabled;

  // Load enabled module_actions + granted role_permissions for this user, once.
  const { data: actionsRows } = await admin
    .from('module_actions')
    .select('id, action_code, is_enabled, app_modules!inner(name)')
    .eq('app_modules.name', 'bn_appeals');
  const enabledActions = new Set<string>(
    (actionsRows ?? []).filter((r: any) => r.is_enabled).map((r: any) => `bn_appeals:${r.action_code}`),
  );

  let grantedCaps = new Set<string>();
  if (ctx.userId) {
    const { data: ur } = await admin.from('user_roles').select('role').eq('user_id', ctx.userId);
    const roleNames = (ur ?? []).map((r: any) => r.role);
    if (roleNames.length) {
      const { data: rp } = await admin
        .from('role_permissions')
        .select('capability, is_granted, role_name')
        .eq('is_granted', true)
        .in('role_name', roleNames);
      grantedCaps = new Set((rp ?? []).map((r: any) => r.capability));
    }
  }

  // Integration readiness by source module (Slice 2B: CLAIM only).
  const READY_SOURCES = new Set(['bn_claim']);
  const integrationReady = !sourceModule || READY_SOURCES.has(sourceModule);

  const seen = new Set<string>();
  const rows = APPEAL_COMMAND_CATALOG.map((cmd) => {
    if (seen.has(cmd.command)) throw new QueryError('FAILED', 'DUPLICATE_COMMAND', `Duplicate ${cmd.command}`);
    seen.add(cmd.command);

    const requiredCapability = cmd.capability;
    const permissionReady = grantedCaps.has(requiredCapability);
    const moduleActionEnabled = enabledActions.has(requiredCapability);
    const lifecycleReady = !currentStatus || cmd.validFrom.length === 0 || cmd.validFrom.includes(currentStatus);
    const dataReady = true; // Slice 2B: no per-command data-readiness predicate yet.
    const isClaimant = cmd.command === 'BN_APPEAL_SUBMIT_CLAIMANT' || cmd.command === 'BN_APPEAL_WITHDRAW';

    const disabledReasons: string[] = [];
    if (!cmd.implemented) disabledReasons.push(cmd.blocker ?? 'Handler not yet implemented.');
    if (!isClaimant && !staffActionsEnabled) disabledReasons.push('Staff actions disabled for the internal pilot.');
    if (!moduleActionEnabled && !isClaimant) disabledReasons.push(`Module action ${requiredCapability} is not enabled.`);
    if (!permissionReady && !isClaimant) disabledReasons.push(`Missing capability ${requiredCapability}.`);
    if (!lifecycleReady && currentStatus) disabledReasons.push(`Current status ${currentStatus} does not permit this action.`);
    if (!integrationReady && !isClaimant) disabledReasons.push(`Source module ${sourceModule} integration is not yet ready.`);
    if (isClaimant && cmd.command === 'BN_APPEAL_SUBMIT_CLAIMANT') disabledReasons.push('Claimant-portal command; not surfaced in staff actions.');

    return {
      command: cmd.command,
      displayName: cmd.displayName,
      implemented: cmd.implemented,
      available: disabledReasons.length === 0 && cmd.implemented,
      requiredCapability,
      moduleActionEnabled,
      permissionReady,
      lifecycleReady,
      dataReady,
      integrationReady: isClaimant ? true : integrationReady,
      makerCheckerRequired: false,
      validFrom: cmd.validFrom,
      disabledReasons,
    };
  });

  if (rows.length !== 18) {
    throw new QueryError('FAILED', 'ACTION_CATALOG_SIZE', `Expected 18 command rows, got ${rows.length}`);
  }

  return {
    data: {
      actionsEnabled: staffActionsEnabled,
      rolloutState: mod?.rollout_state ?? null,
      currentUserId: ctx.userId,
      currentStatus,
      sourceModule,
      integrationReady,
      rows,
    },
    totalCount: 1,
  };
}

// ── BN-AP-01 Slice 2A.3 — Enterprise child readers ──────────────────────
// Each handler enforces the parent gate, uses explicit column selects, and
// returns a camelCase DTO shape. Where a boundary table is not linked to the
// appeal (workflow_instance_id null, no communication_request references,
// etc.) the handler returns an empty page rather than throwing.

async function getAppealParties(admin: any, params: any) {
  const parent = await requireAppealParent(admin, params);
  const { data, error, count } = await admin
    .from('bn_appeal_party')
    .select(
      'id, party_role, party_type, identifier_type_code, masked_identifier, display_name, contact_channel_code, contact_reference, is_primary, effective_from, effective_to, external_reference, notes, row_version, created_at',
      { count: 'exact' },
    )
    .eq('appeal_id', parent.id)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) throw new QueryError('FAILED', 'APPEAL_PARTIES_FAILED', error.message);
  const rows = (data ?? []).map((r: any) => ({
    id: r.id,
    partyRole: r.party_role,
    partyType: r.party_type,
    identifierTypeCode: r.identifier_type_code,
    maskedIdentifier: r.masked_identifier,
    displayName: r.display_name,
    contactChannelCode: r.contact_channel_code,
    contactReference: r.contact_reference,
    isPrimary: r.is_primary,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    externalReference: r.external_reference,
    notes: r.notes,
    rowVersion: r.row_version,
    createdAt: r.created_at,
  }));
  return { data: rows, totalCount: count ?? rows.length };
}

async function getAppealIssues(admin: any, params: any) {
  const parent = await requireAppealParent(admin, params);
  const { data, error, count } = await admin
    .from('bn_appeal_issue')
    .select('id, issue_seq, issue_code, issue_summary, issue_detail, status, resolution_summary, resolved_at, created_at', { count: 'exact' })
    .eq('appeal_id', parent.id)
    .order('issue_seq', { ascending: true });
  if (error) throw new QueryError('FAILED', 'APPEAL_ISSUES_FAILED', error.message);
  const rows = (data ?? []).map((r: any) => ({
    id: r.id, issueSeq: r.issue_seq, issueCode: r.issue_code,
    issueSummary: r.issue_summary, issueDetail: r.issue_detail, status: r.status,
    resolutionSummary: r.resolution_summary, resolvedAt: r.resolved_at, createdAt: r.created_at,
  }));
  return { data: rows, totalCount: count ?? rows.length };
}

async function getAppealGrounds(admin: any, params: any) {
  const parent = await requireAppealParent(admin, params);
  const { data, error, count } = await admin
    .from('bn_appeal_ground')
    .select('id, ground_code, ground_text, entered_at, entered_by', { count: 'exact' })
    .eq('appeal_id', parent.id)
    .order('entered_at', { ascending: true });
  if (error) throw new QueryError('FAILED', 'APPEAL_GROUNDS_FAILED', error.message);
  const rows = (data ?? []).map((r: any) => ({
    id: r.id, groundCode: r.ground_code, groundText: r.ground_text, detail: r.ground_text,
    enteredAt: r.entered_at, enteredBy: r.entered_by,
  }));
  return { data: rows, totalCount: count ?? rows.length };
}

async function getAppealDeadlines(admin: any, params: any) {
  const parent = await requireAppealParent(admin, params);
  const { data, error, count } = await admin
    .from('bn_appeal_deadline')
    .select('id, deadline_code, deadline_kind, due_at, status, met_at, waiver_reason, created_at', { count: 'exact' })
    .eq('appeal_id', parent.id)
    .order('due_at', { ascending: true, nullsFirst: false });
  if (error) throw new QueryError('FAILED', 'APPEAL_DEADLINES_FAILED', error.message);
  const rows = (data ?? []).map((r: any) => ({
    id: r.id, deadlineCode: r.deadline_code, deadlineKind: r.deadline_kind,
    dueAt: r.due_at, status: r.status, metAt: r.met_at,
    waiverReason: r.waiver_reason, createdAt: r.created_at,
  }));
  return { data: rows, totalCount: count ?? rows.length };
}

async function getAppealEvidence(admin: any, params: any) {
  const parent = await requireAppealParent(admin, params);
  const { data, error, count } = await admin
    .from('bn_appeal_evidence')
    .select('id, dms_document_id, document_type, file_name, content_type, size_bytes, entered_by, entered_at', { count: 'exact' })
    .eq('appeal_id', parent.id)
    .order('entered_at', { ascending: false });
  if (error) throw new QueryError('FAILED', 'APPEAL_EVIDENCE_FAILED', error.message);
  const rows = (data ?? []).map((r: any) => ({
    id: r.id,
    dmsDocumentId: r.dms_document_id,
    documentType: r.document_type,
    fileName: r.file_name,
    contentType: r.content_type,
    sizeBytes: r.size_bytes,
    enteredBy: r.entered_by,
    enteredAt: r.entered_at,
    fileReference: r.dms_document_id ? `dms:${String(r.dms_document_id).slice(0, 8)}…` : null,
  }));
  return { data: rows, totalCount: count ?? rows.length };
}

async function getAppealEvidenceRequests(admin: any, params: any) {
  const parent = await requireAppealParent(admin, params);
  const { data, error, count } = await admin
    .from('bn_appeal_evidence_request')
    .select('id, request_reference, requested_from_party_id, requested_at, due_at, status, subject, description, fulfilled_at, fulfilled_evidence_id, created_at', { count: 'exact' })
    .eq('appeal_id', parent.id)
    .order('requested_at', { ascending: false });
  if (error) throw new QueryError('FAILED', 'APPEAL_EVIDENCE_REQUESTS_FAILED', error.message);
  const rows = (data ?? []).map((r: any) => ({
    id: r.id, requestReference: r.request_reference, requestedFromPartyId: r.requested_from_party_id,
    requestedAt: r.requested_at, dueAt: r.due_at, status: r.status,
    subject: r.subject, description: r.description,
    fulfilledAt: r.fulfilled_at, fulfilledEvidenceId: r.fulfilled_evidence_id,
    createdAt: r.created_at,
  }));
  return { data: rows, totalCount: count ?? rows.length };
}

async function getAppealStays(admin: any, params: any) {
  const parent = await requireAppealParent(admin, params);
  const { data, error, count } = await admin
    .from('bn_appeal_stay')
    .select('id, stay_type, granted_at, effective_from, effective_to, status, reason, lifted_at, created_at', { count: 'exact' })
    .eq('appeal_id', parent.id)
    .order('granted_at', { ascending: false, nullsFirst: false });
  if (error) throw new QueryError('FAILED', 'APPEAL_STAYS_FAILED', error.message);
  const rows = (data ?? []).map((r: any) => ({
    id: r.id, stayType: r.stay_type, grantedAt: r.granted_at,
    effectiveFrom: r.effective_from, effectiveTo: r.effective_to,
    status: r.status, reason: r.reason, liftedAt: r.lifted_at, createdAt: r.created_at,
  }));
  return { data: rows, totalCount: count ?? rows.length };
}

async function getAppealHearing(admin: any, params: any) {
  const parent = await requireAppealParent(admin, params);
  const { data: hearings, error, count } = await admin
    .from('bn_appeal_hearing')
    .select('id, hearing_seq, scheduled_at, venue_code, venue_detail, hearing_mode, status, panel_reference, outcome_summary, external_hearing_ref, created_at', { count: 'exact' })
    .eq('appeal_id', parent.id)
    .order('hearing_seq', { ascending: true });
  if (error) throw new QueryError('FAILED', 'APPEAL_HEARING_FAILED', error.message);

  // Enrich each hearing with its participants.
  const rows: any[] = [];
  for (const h of hearings ?? []) {
    const { data: participants } = await admin
      .from('bn_appeal_hearing_participant')
      .select('id, party_id, participant_role, display_name, attendance_status')
      .eq('hearing_id', h.id);
    rows.push({
      id: h.id, hearingSeq: h.hearing_seq, scheduledAt: h.scheduled_at,
      venueCode: h.venue_code, venueDetail: h.venue_detail, hearingMode: h.hearing_mode,
      status: h.status, panelReference: h.panel_reference,
      outcomeSummary: h.outcome_summary, externalHearingRef: h.external_hearing_ref,
      createdAt: h.created_at,
      participants: (participants ?? []).map((p: any) => ({
        id: p.id, partyId: p.party_id, participantRole: p.participant_role,
        displayName: p.display_name, attendanceStatus: p.attendance_status,
      })),
    });
  }
  return { data: rows, totalCount: count ?? rows.length };
}

async function getAppealRecommendations(admin: any, params: any) {
  const parent = await requireAppealParent(admin, params);
  const { data, error, count } = await admin
    .from('bn_appeal_recommendation')
    .select('id, recommendation_seq, recommended_outcome, rationale, recommended_by, recommended_at, superseded_at, superseded_by_id, supporting_evidence, created_at', { count: 'exact' })
    .eq('appeal_id', parent.id)
    .order('recommendation_seq', { ascending: true });
  if (error) throw new QueryError('FAILED', 'APPEAL_RECOMMENDATIONS_FAILED', error.message);
  const rows = (data ?? []).map((r: any) => ({
    id: r.id, recommendationSeq: r.recommendation_seq,
    recommendedOutcome: r.recommended_outcome, rationale: r.rationale,
    recommendedBy: r.recommended_by, recommendedAt: r.recommended_at,
    supersededAt: r.superseded_at, supersededById: r.superseded_by_id,
    supportingEvidence: r.supporting_evidence, createdAt: r.created_at,
  }));
  return { data: rows, totalCount: count ?? rows.length };
}

async function getAppealDecisions(admin: any, params: any) {
  const parent = await requireAppealParent(admin, params);
  const { data: decisions, error, count } = await admin
    .from('bn_appeal_decision')
    .select('id, decision_seq, outcome_code, decision_summary, decided_by, decided_at, approved_by, approved_at, effective_from, superseded_at, superseded_by_id, legal_reference, created_at', { count: 'exact' })
    .eq('appeal_id', parent.id)
    .order('decision_seq', { ascending: true });
  if (error) throw new QueryError('FAILED', 'APPEAL_DECISIONS_FAILED', error.message);
  const rows: any[] = [];
  for (const d of decisions ?? []) {
    const { data: items } = await admin
      .from('bn_appeal_decision_item')
      .select('id, item_seq, item_kind, target_module, target_entity_type, target_entity_id, remedy_code, amount, currency_code, instruction')
      .eq('decision_id', d.id)
      .order('item_seq', { ascending: true });
    rows.push({
      id: d.id, decisionSeq: d.decision_seq, outcomeCode: d.outcome_code,
      decisionSummary: d.decision_summary, decidedBy: d.decided_by, decidedAt: d.decided_at,
      approvedBy: d.approved_by, approvedAt: d.approved_at,
      effectiveFrom: d.effective_from, supersededAt: d.superseded_at,
      supersededById: d.superseded_by_id, legalReference: d.legal_reference,
      createdAt: d.created_at,
      items: (items ?? []).map((it: any) => ({
        id: it.id, itemSeq: it.item_seq, itemKind: it.item_kind,
        targetModule: it.target_module, targetEntityType: it.target_entity_type,
        targetEntityId: it.target_entity_id, remedyCode: it.remedy_code,
        amount: it.amount, currencyCode: it.currency_code, instruction: it.instruction,
      })),
    });
  }
  return { data: rows, totalCount: count ?? rows.length };
}

async function getAppealDecisionSnapshot(admin: any, params: any) {
  const parent = await requireAppealParent(admin, params);
  const { data, error } = await admin
    .from('bn_appeal_decision_snapshot')
    .select('id, captured_at, source_module_code, source_decision_id, source_decision_date, snapshot_hash')
    .eq('appeal_id', parent.id)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new QueryError('FAILED', 'APPEAL_DECISION_SNAPSHOT_FAILED', error.message);
  if (!data) return { data: null, totalCount: 0 };
  // snapshot_json intentionally omitted from the wire response: raw payloads
  // remain server-side and are surfaced through a separate audited endpoint.
  const dto = {
    id: data.id,
    capturedAt: data.captured_at,
    sourceModuleCode: data.source_module_code,
    sourceDecisionId: data.source_decision_id,
    sourceDecisionDate: data.source_decision_date,
    snapshotHash: data.snapshot_hash,
  };
  return { data: dto, totalCount: 1 };
}

async function getAppealImplementation(admin: any, params: any) {
  const parent = await requireAppealParent(admin, params);
  const { data, error, count } = await admin
    .from('bn_appeal_implementation_action')
    .select('id, decision_id, decision_item_id, action_seq, action_kind, target_module, target_reference, status, scheduled_at, completed_at, failure_reason, correlation_id, created_at', { count: 'exact' })
    .eq('appeal_id', parent.id)
    .order('action_seq', { ascending: true });
  if (error) throw new QueryError('FAILED', 'APPEAL_IMPLEMENTATION_FAILED', error.message);
  const rows = (data ?? []).map((r: any) => ({
    id: r.id, decisionId: r.decision_id, decisionItemId: r.decision_item_id,
    actionSeq: r.action_seq, actionKind: r.action_kind, targetModule: r.target_module,
    targetReference: r.target_reference, status: r.status,
    scheduledAt: r.scheduled_at, completedAt: r.completed_at,
    failureReason: r.failure_reason, correlationId: r.correlation_id, createdAt: r.created_at,
  }));
  return { data: rows, totalCount: count ?? rows.length };
}

async function getAppealNotes(admin: any, params: any) {
  const parent = await requireAppealParent(admin, params);
  const { data, error, count } = await admin
    .from('bn_appeal_note')
    .select('id, note_kind, visibility, body, created_at, created_by', { count: 'exact' })
    .eq('appeal_id', parent.id)
    .order('created_at', { ascending: false });
  if (error) throw new QueryError('FAILED', 'APPEAL_NOTES_FAILED', error.message);
  const rows = (data ?? []).map((r: any) => ({
    id: r.id, noteKind: r.note_kind, visibility: r.visibility,
    body: r.body, createdAt: r.created_at, createdBy: r.created_by,
  }));
  return { data: rows, totalCount: count ?? rows.length };
}

async function getAppealLinks(admin: any, params: any) {
  const parent = await requireAppealParent(admin, params);
  const { data, error, count } = await admin
    .from('bn_appeal_link')
    .select('id, link_kind, target_module, target_entity_type, target_entity_id, target_reference, relationship_summary, created_at, created_by', { count: 'exact' })
    .eq('appeal_id', parent.id)
    .order('created_at', { ascending: true });
  if (error) throw new QueryError('FAILED', 'APPEAL_LINKS_FAILED', error.message);
  const rows = (data ?? []).map((r: any) => ({
    id: r.id, linkKind: r.link_kind, targetModule: r.target_module,
    targetEntityType: r.target_entity_type, targetEntityId: r.target_entity_id,
    targetReference: r.target_reference, relationshipSummary: r.relationship_summary,
    createdAt: r.created_at, createdBy: r.created_by,
  }));
  return { data: rows, totalCount: count ?? rows.length };
}

async function getAppealEvents(admin: any, params: any) {
  const parent = await requireAppealParent(admin, params);
  const { data, error, count } = await admin
    .from('bn_appeal_event')
    .select('id, event_code, from_status, to_status, outcome, reason_code, notes, correlation_id, command_id, actor_user_id, actor_user_code, occurred_at', { count: 'exact' })
    .eq('appeal_id', parent.id)
    .order('occurred_at', { ascending: false });
  if (error) throw new QueryError('FAILED', 'APPEAL_EVENTS_FAILED', error.message);
  const rows = (data ?? []).map((r: any) => ({
    id: r.id, eventCode: r.event_code,
    fromStatus: r.from_status, toStatus: r.to_status,
    outcome: r.outcome, reasonCode: r.reason_code, notes: r.notes,
    correlationId: r.correlation_id, commandId: r.command_id,
    actorUserId: r.actor_user_id, actorUserCode: r.actor_user_code,
    occurredAt: r.occurred_at,
  }));
  return { data: rows, totalCount: count ?? rows.length };
}

async function getAppealWorkflow(admin: any, params: any) {
  const parent = await requireAppealParent(admin, params);
  // The appeal may not yet be attached to a workflow instance — that is a
  // valid state (empty page, not an error).
  if (!parent.workflow_instance_id) return { data: [], totalCount: 0 };
  const { data, error, count } = await admin
    .from('core_workflow_task')
    .select('id, task_code, task_name, step_code, step_name, task_status, priority, due_at, assigned_to_user_id, assigned_to_role_key, claimed_at, completed_at, outcome, created_at', { count: 'exact' })
    .eq('workflow_instance_id', parent.workflow_instance_id)
    .order('created_at', { ascending: true });
  if (error) throw new QueryError('FAILED', 'APPEAL_WORKFLOW_FAILED', error.message);
  const rows = (data ?? []).map((r: any) => ({
    id: r.id, taskCode: r.task_code, taskName: r.task_name,
    stepCode: r.step_code, stepName: r.step_name, status: r.task_status,
    priority: r.priority, dueAt: r.due_at,
    assignedToUserId: r.assigned_to_user_id, assignedToRoleKey: r.assigned_to_role_key,
    claimedAt: r.claimed_at, completedAt: r.completed_at,
    outcome: r.outcome, createdAt: r.created_at,
  }));
  return { data: rows, totalCount: count ?? rows.length };
}

async function getAppealCommunications(admin: any, params: any) {
  const parent = await requireAppealParent(admin, params);
  // Communication Hub owns dispatch. We surface only the request-level record
  // filtered to this appeal. No provider payloads, no raw recipient contacts.
  const { data, error, count } = await admin
    .from('communication_request')
    .select('id, request_no, module_code, event_code, entity_type, entity_id, reference_no, channels, priority, scheduled_at, status, created_at', { count: 'exact' })
    .eq('module_code', 'bn_appeals')
    .eq('entity_type', 'bn_appeal')
    .eq('entity_id', parent.id)
    .order('created_at', { ascending: false });
  if (error) throw new QueryError('FAILED', 'APPEAL_COMMUNICATIONS_FAILED', error.message);
  const rows = (data ?? []).map((r: any) => ({
    id: r.id, requestNo: r.request_no, moduleCode: r.module_code, eventCode: r.event_code,
    entityType: r.entity_type, entityId: r.entity_id, referenceNo: r.reference_no,
    channels: r.channels, channel: Array.isArray(r.channels) ? r.channels.join(', ') : r.channels,
    priority: r.priority, scheduledAt: r.scheduled_at,
    status: r.status, subject: r.event_code, createdAt: r.created_at,
    recipientContact: null,
  }));

  // AP-01 Slice 2B §K — surface Legal intakes & cases that reference this appeal.
  // Legal owns the tables; we filter by source_module='bn_appeals' + source_record_id.
  let legalIntakes: any[] = [];
  let legalCases: any[] = [];
  try {
    const { data: ins } = await admin
      .from('lg_case_intake')
      .select('id, intake_no, matter_type_code, intake_status, priority_code, submitted_at, lg_case_id, source_module, source_record_id, summary')
      .eq('source_module', 'bn_appeals')
      .eq('source_record_id', parent.id)
      .order('submitted_at', { ascending: false });
    legalIntakes = (ins ?? []).map((r: any) => ({
      id: r.id, intakeNo: r.intake_no, matterTypeCode: r.matter_type_code,
      intakeStatus: r.intake_status, priorityCode: r.priority_code,
      submittedAt: r.submitted_at, lgCaseId: r.lg_case_id, summary: r.summary,
    }));
    const { data: cs } = await admin
      .from('lg_case')
      .select('id, case_no, case_type_code, case_status, priority_code, opened_date, closed_date, source_module, source_record_id, summary')
      .eq('source_module', 'bn_appeals')
      .eq('source_record_id', parent.id)
      .order('opened_date', { ascending: false });
    legalCases = (cs ?? []).map((r: any) => ({
      id: r.id, caseNo: r.case_no, caseTypeCode: r.case_type_code,
      caseStatus: r.case_status, priorityCode: r.priority_code,
      openedDate: r.opened_date, closedDate: r.closed_date, summary: r.summary,
    }));
  } catch (_) {
    // Non-fatal: Legal is a separate module; surface empty lists rather than fail communications tab.
  }

  return {
    data: { communications: rows, legalIntakes, legalCases },
    totalCount: (count ?? rows.length) + legalIntakes.length + legalCases.length,
  };
}

// ── AP-01 Slice 2B — Source-lookup / registration-config surfaces ─────────
// Reference: docs/bn/gap-modules/APPEALS_MODULE.md §Slice 2B.
//
// Canonical AppealSourceAdapter contract (implemented inline; see the
// per-source branches). Slice 2B ships ClaimAppealSourceAdapter as the only
// certified implementation. AWARD / OVERPAYMENT / MEDICAL / MEANS-TEST paths
// return INTEGRATION_NOT_READY via a warnings envelope + readiness=false so
// the wizard can honestly gate them without falling back to Claim.

const READY_SOURCE_MODULES = new Set(['bn_claim']);
const APPEAL_SOURCE_MODULES = new Set(['bn_claim', 'bn_award', 'bn_overpayment', 'bn_medical', 'bn_means_test']);

function ensureAppealSourceModule(m: unknown): string {
  const s = typeof m === 'string' ? m.toLowerCase() : '';
  if (!APPEAL_SOURCE_MODULES.has(s)) throw invalid('sourceModule must be one of bn_claim,bn_award,bn_overpayment,bn_medical,bn_means_test', 'sourceModule');
  return s;
}

function notReadyEnvelope(sourceModule: string, extra?: Record<string, unknown>) {
  return {
    data: {
      readiness: false,
      sourceModule,
      reason: 'INTEGRATION_NOT_READY',
      message: `Appeal source adapter for ${sourceModule} is not yet certified. Only bn_claim is available in the AP-01 Slice 2B internal pilot.`,
      results: [] as any[],
      ...(extra ?? {}),
    },
    totalCount: 0,
  };
}

// Resolve claimant display + person id via bn_claim.ssn -> ip_master.
async function resolveClaimantFromSsn(admin: any, ssns: (string | null | undefined)[]): Promise<Map<string, { personId: string; displayName: string | null }>> {
  const clean = Array.from(new Set(ssns.filter((s) => typeof s === 'string' && s.trim().length > 0))) as string[];
  const map = new Map<string, { personId: string; displayName: string | null }>();
  if (clean.length === 0) return map;
  const { data } = await admin
    .from('ip_master').select('id, ssn, firstname, middle_name, surname').in('ssn', clean);
  for (const p of data ?? []) {
    const parts = [p.firstname, p.middle_name, p.surname].filter((v: any) => typeof v === 'string' && v.trim()).map((v: string) => v.trim());
    map.set(String(p.ssn), { personId: p.id, displayName: parts.length ? parts.join(' ') : null });
  }
  return map;
}

async function searchAppealSourceDecisions(admin: any, params: any, page: { limit: number; offset: number }) {
  const sourceModule = ensureAppealSourceModule(params?.sourceModule);
  if (!READY_SOURCE_MODULES.has(sourceModule)) return notReadyEnvelope(sourceModule);

  const q = typeof params?.search === 'string' ? params.search.trim() : '';
  if (q.length > 0 && !SAFE_TEXT_RE.test(q)) throw invalid('search contains unsupported characters', 'search');

  // Claim adapter: appealable decisions are claims that reached a decided
  // status (bn_claim.decision_date is not null) and are not already under an
  // active appeal for the same source decision.
  let query = admin
    .from('bn_claim')
    .select('id, claim_number, status, decision_date, submission_date, product_id, ssn, legacy_benefit_type', { count: 'exact' })
    .not('decision_date', 'is', null)
    .order('decision_date', { ascending: false, nullsFirst: false })
    .range(page.offset, page.offset + page.limit - 1);
  if (q.length > 0) query = query.ilike('claim_number', `%${escapeLike(q)}%`);

  const { data: claims, error, count } = await query;
  if (error) throw new QueryError('FAILED', 'CLAIM_SEARCH_FAILED', error.message);

  const ids = (claims ?? []).map((c: any) => c.id);
  const activeAppeals = new Map<string, { id: string; appealNumber: string; status: string }>();
  if (ids.length > 0) {
    const { data: exist } = await admin
      .from('bn_appeal')
      .select('id, appeal_number, status, bn_claim_id')
      .in('bn_claim_id', ids)
      .not('status', 'in', '(CLOSED,CANCELLED,WITHDRAWN,INADMISSIBLE)');
    for (const a of exist ?? []) {
      if (!activeAppeals.has(a.bn_claim_id)) {
        activeAppeals.set(a.bn_claim_id, { id: a.id, appealNumber: a.appeal_number, status: a.status });
      }
    }
  }

  const bySsn = await resolveClaimantFromSsn(admin, (claims ?? []).map((c: any) => c.ssn));

  const results = (claims ?? []).map((c: any) => {
    const person = c.ssn ? bySsn.get(String(c.ssn)) ?? null : null;
    return {
      sourceModule: 'bn_claim',
      sourceEntityType: 'CLAIM',
      sourceEntityId: c.id,
      sourceDecisionId: c.id,
      displayReference: c.claim_number,
      decisionType: c.status, // Claim status stands in for decision outcome.
      decisionDate: c.decision_date,
      benefitTypeCode: c.legacy_benefit_type ?? null,
      claimantPersonId: person?.personId ?? null,
      claimantDisplayName: person?.displayName ?? null,
      claimantSsnMasked: c.ssn ? `••••${String(c.ssn).slice(-4)}` : null,
      rowVersion: null,
      existingActiveAppeal: activeAppeals.get(c.id) ?? null,
      appealable: !activeAppeals.has(c.id) && !!c.decision_date,
    };
  });

  return { data: { readiness: true, sourceModule, results }, totalCount: count ?? results.length };
}

async function getAppealSourceCandidate(admin: any, params: any) {
  const sourceModule = ensureAppealSourceModule(params?.sourceModule);
  if (!READY_SOURCE_MODULES.has(sourceModule)) return notReadyEnvelope(sourceModule);
  const id = typeof params?.sourceEntityId === 'string' ? params.sourceEntityId : '';
  if (!UUID_RE.test(id)) throw invalid('sourceEntityId must be UUID', 'sourceEntityId');

  const { data: claim, error } = await admin
    .from('bn_claim')
    .select('id, claim_number, status, decision_date, submission_date, ssn, legacy_benefit_type')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new QueryError('FAILED', 'CANDIDATE_LOOKUP_FAILED', error.message);
  if (!claim) throw new QueryError('NOT_FOUND', 'CANDIDATE_NOT_FOUND', 'Claim not found');

  const bySsn = await resolveClaimantFromSsn(admin, [claim.ssn]);
  const person = claim.ssn ? bySsn.get(String(claim.ssn)) ?? null : null;
  return {
    data: {
      readiness: true,
      sourceModule,
      sourceEntityType: 'CLAIM',
      sourceEntityId: claim.id,
      sourceDecisionId: claim.id,
      displayReference: claim.claim_number,
      decisionType: claim.status,
      decisionDate: claim.decision_date,
      notifiedAt: null,
      benefitTypeCode: claim.legacy_benefit_type ?? null,
      claimantPersonId: person?.personId ?? null,
      claimantDisplayName: person?.displayName ?? null,
      claimantSsnMasked: claim.ssn ? `••••${String(claim.ssn).slice(-4)}` : null,
      rowVersion: null,
    },
    totalCount: 1,
  };
}

async function getAppealSourceContext(admin: any, params: any) {
  const sourceModule = ensureAppealSourceModule(params?.sourceModule);
  if (!READY_SOURCE_MODULES.has(sourceModule)) return notReadyEnvelope(sourceModule);
  const id = typeof params?.sourceEntityId === 'string' ? params.sourceEntityId : '';
  if (!UUID_RE.test(id)) throw invalid('sourceEntityId must be UUID', 'sourceEntityId');

  const [{ data: claim }, elig, calc, events, decisions] = await Promise.all([
    admin.from('bn_claim').select('id, claim_number, status, decision_date, submission_date, ssn, legacy_benefit_type').eq('id', id).maybeSingle(),
    admin.from('bn_claim_eligibility').select('id, check_date, overall_result').eq('claim_id', id).order('check_date', { ascending: false }).limit(5),
    admin.from('bn_claim_calculation').select('id, calc_date, weekly_rate, monthly_rate, lump_sum, formula_code').eq('claim_id', id).order('calc_date', { ascending: false }).limit(5),
    admin.from('bn_claim_event').select('id, event_type, from_status, to_status, performed_at, notes').eq('claim_id', id).order('performed_at', { ascending: false }).limit(20),
    admin.from('bn_claim_decision').select('id, action_code, from_status, to_status, effective_date, narrative, performed_at').eq('claim_id', id).order('performed_at', { ascending: false }).limit(10),
  ]);
  if (!claim) throw new QueryError('NOT_FOUND', 'CANDIDATE_NOT_FOUND', 'Claim not found');
  return {
    data: {
      readiness: true,
      sourceModule,
      claim: {
        id: claim.id, claimNumber: claim.claim_number, status: claim.status,
        decisionDate: claim.decision_date, submissionDate: claim.submission_date,
        benefitTypeCode: claim.legacy_benefit_type ?? null,
      },
      decisions: (decisions.data ?? []).map((r: any) => ({ id: r.id, actionCode: r.action_code, fromStatus: r.from_status, toStatus: r.to_status, effectiveDate: r.effective_date, narrative: r.narrative, performedAt: r.performed_at })),
      eligibility: (elig.data ?? []).map((r: any) => ({ id: r.id, checkDate: r.check_date, overallResult: r.overall_result })),
      calculations: (calc.data ?? []).map((r: any) => ({ id: r.id, calcDate: r.calc_date, weeklyRate: r.weekly_rate, monthlyRate: r.monthly_rate, lumpSum: r.lump_sum, formulaCode: r.formula_code })),
      events: (events.data ?? []).map((r: any) => ({ id: r.id, eventType: r.event_type, fromStatus: r.from_status, toStatus: r.to_status, occurredAt: r.performed_at, note: r.notes })),
    },
    totalCount: 1,
  };
}

async function getAppealRepresentativeOptions(admin: any, params: any) {
  const personId = typeof params?.claimantPersonId === 'string' ? params.claimantPersonId : '';
  if (!UUID_RE.test(personId)) throw invalid('claimantPersonId must be UUID', 'claimantPersonId');
  // Authority derives from external_user_person_link, keyed by ip_master.ssn.
  const { data: person } = await admin.from('ip_master').select('id, ssn').eq('id', personId).maybeSingle();
  if (!person || !person.ssn) return { data: { options: [], selfAlwaysAvailable: true }, totalCount: 0 };
  const { data, error } = await admin
    .from('external_user_person_link')
    .select('id, user_id, ssn, relationship_type, is_primary, verification_status, verified_at')
    .eq('ssn', person.ssn)
    .eq('verification_status', 'VERIFIED');
  if (error) throw new QueryError('FAILED', 'REPRESENTATIVE_LOOKUP_FAILED', error.message);
  const rows = (data ?? []).map((r: any) => ({
    id: r.id,
    externalUserId: r.user_id,
    relationshipType: r.relationship_type,
    isPrimary: r.is_primary,
    verificationStatus: r.verification_status,
    verifiedAt: r.verified_at,
    validFrom: r.verified_at,
    validTo: null,
    status: r.verification_status,
    contactReference: null,
  }));
  return { data: { options: rows, selfAlwaysAvailable: true }, totalCount: rows.length };
}

async function calculateAppealFilingDeadline(admin: any, params: any) {
  const appealTypeCode = typeof params?.appealTypeCode === 'string' ? params.appealTypeCode : '';
  if (!appealTypeCode) throw invalid('appealTypeCode is required', 'appealTypeCode');
  const decisionDate = typeof params?.decisionDate === 'string' ? params.decisionDate : null;
  const notifiedAt = typeof params?.notifiedAt === 'string' ? params.notifiedAt : null;
  const submissionDate = typeof params?.submissionDate === 'string' ? params.submissionDate : null;
  if (decisionDate && !ISO_DATE_RE.test(decisionDate)) throw invalid('decisionDate must be ISO', 'decisionDate');
  if (notifiedAt && !ISO_DATE_RE.test(notifiedAt)) throw invalid('notifiedAt must be ISO', 'notifiedAt');
  if (submissionDate && !ISO_DATE_RE.test(submissionDate)) throw invalid('submissionDate must be ISO', 'submissionDate');

  const { data: cfg, error } = await admin
    .from('bn_appeal_type_config')
    .select('appeal_type_code, statutory_filing_days, deadline_basis, allows_late_filing')
    .eq('appeal_type_code', appealTypeCode)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw new QueryError('FAILED', 'DEADLINE_CFG_FAILED', error.message);
  if (!cfg) throw new QueryError('NOT_FOUND', 'DEADLINE_CFG_NOT_FOUND', `No active config for ${appealTypeCode}`);

  const basis = (cfg.deadline_basis ?? 'NOTIFIED_AT') as string;
  const anchorIso = basis === 'DECISION_DATE' ? decisionDate : (notifiedAt ?? decisionDate);
  let deadline: string | null = null;
  let daysRemaining: number | null = null;
  let lateFiling = false;
  if (anchorIso) {
    const anchor = new Date(anchorIso);
    if (!Number.isNaN(anchor.getTime()) && typeof cfg.statutory_filing_days === 'number') {
      const dl = new Date(anchor);
      dl.setUTCDate(dl.getUTCDate() + cfg.statutory_filing_days);
      deadline = dl.toISOString().slice(0, 10);
      const submissionAnchor = submissionDate ? new Date(submissionDate) : new Date();
      daysRemaining = Math.ceil((dl.getTime() - submissionAnchor.getTime()) / 86_400_000);
      lateFiling = daysRemaining < 0;
    }
  }

  return {
    data: {
      appealTypeCode,
      statutoryFilingDays: cfg.statutory_filing_days,
      deadlineBasis: basis,
      anchorDate: anchorIso,
      filingDeadlineDate: deadline,
      daysRemaining,
      lateFiling,
      allowsLateFiling: !!cfg.allows_late_filing,
    },
    totalCount: 1,
  };
}

async function checkAppealDuplicate(admin: any, params: any) {
  const sourceModule = ensureAppealSourceModule(params?.sourceModule);
  const sourceEntityId = typeof params?.sourceEntityId === 'string' ? params.sourceEntityId : '';
  if (!UUID_RE.test(sourceEntityId)) throw invalid('sourceEntityId must be UUID', 'sourceEntityId');
  let query = admin
    .from('bn_appeal')
    .select('id, appeal_number, status, source_decision_id')
    .eq('source_module_code', sourceModule)
    .not('status', 'in', '(CLOSED,CANCELLED,WITHDRAWN,INADMISSIBLE)');
  if (sourceModule === 'bn_claim') query = query.eq('bn_claim_id', sourceEntityId);
  else if (sourceModule === 'bn_award') query = query.eq('bn_award_id', sourceEntityId);
  else if (sourceModule === 'bn_overpayment') query = query.eq('bn_overpayment_id', sourceEntityId);
  const { data, error } = await query.limit(5);
  if (error) throw new QueryError('FAILED', 'DUPLICATE_CHECK_FAILED', error.message);
  const rows = (data ?? []).map((r: any) => ({ id: r.id, appealNumber: r.appeal_number, status: r.status, sourceDecisionId: r.source_decision_id }));
  return {
    data: { hasDuplicate: rows.length > 0, existingAppeals: rows },
    totalCount: rows.length,
  };
}

async function getAppealRegistrationConfig(admin: any, params: any) {
  const sourceModule = params?.sourceModule ? String(params.sourceModule).toLowerCase() : null;
  const [types, grounds, remedies] = await Promise.all([
    admin.from('bn_appeal_type_config')
      .select('appeal_type_code, display_name, case_kind, review_level_code, source_module_code, source_entity_type, statutory_filing_days, deadline_basis, requires_hearing, allows_hearing_waiver, allows_late_filing, workflow_code, country_code')
      .eq('is_active', true),
    admin.from('bn_appeal_ground_config')
      .select('ground_code, ground_name, description, applies_to_types, sort_order')
      .eq('is_active', true).order('sort_order', { ascending: true }),
    admin.from('bn_appeal_remedy_config')
      .select('remedy_code, remedy_name, description, applies_to_types, requires_amount, sort_order')
      .eq('is_active', true).order('sort_order', { ascending: true }),
  ]);

  const filterByModule = <T extends { source_module_code?: string | null }>(rows: T[]) =>
    sourceModule ? rows.filter((r) => !r.source_module_code || r.source_module_code === sourceModule) : rows;

  const appealTypes = filterByModule(types.data ?? []).map((r: any) => ({
    appealTypeCode: r.appeal_type_code, displayName: r.display_name, caseKind: r.case_kind,
    reviewLevelCode: r.review_level_code, sourceModuleCode: r.source_module_code, sourceEntityType: r.source_entity_type,
    statutoryFilingDays: r.statutory_filing_days, deadlineBasis: r.deadline_basis,
    requiresHearing: r.requires_hearing, allowsHearingWaiver: r.allows_hearing_waiver, allowsLateFiling: r.allows_late_filing,
    workflowCode: r.workflow_code, countryCode: r.country_code,
  }));

  return {
    data: {
      readiness: sourceModule ? READY_SOURCE_MODULES.has(sourceModule) : true,
      sourceModule,
      appealTypes,
      grounds: (grounds.data ?? []).map((r: any) => ({ groundCode: r.ground_code, groundName: r.ground_name, description: r.description, appliesToTypes: r.applies_to_types, sortOrder: r.sort_order })),
      remedies: (remedies.data ?? []).map((r: any) => ({ remedyCode: r.remedy_code, remedyName: r.remedy_name, description: r.description, appliesToTypes: r.applies_to_types, requiresAmount: r.requires_amount, sortOrder: r.sort_order })),
      caseKinds: ['ADMINISTRATIVE_REVIEW', 'STATUTORY_APPEAL', 'JUDICIAL_REVIEW'],
      reviewLevels: ['FIRST_LEVEL', 'SECOND_LEVEL', 'TRIBUNAL'],
      priorities: ['LOW', 'NORMAL', 'HIGH', 'URGENT'],
      confidentiality: ['STANDARD', 'RESTRICTED', 'HIGHLY_RESTRICTED'],
      languages: ['en-KN'],
      countries: ['KN'],
    },
    totalCount: 1,
  };
}



// BN-MORT-UX-1 §1 — Assignable Benefits users for the worklist filter.
const MORTALITY_ASSIGNABLE_ROLES = [
  'BN_INTAKE_OFFICER',
  'BN_DOCUMENT_OFFICER',
  'BN_BENEFIT_OFFICER_GENERALIST',
  'BN_SUPERVISOR',
  'BN_MANAGER',
  'BN_FINANCE_SUPERVISOR',
] as const;

async function getAssignableUsers(admin: any) {
  // 1) Active roles from the approved list.
  const { data: activeRoles, error: rErr } = await admin
    .from('roles')
    .select('role_name')
    .eq('is_active', true)
    .in('role_name', MORTALITY_ASSIGNABLE_ROLES as unknown as string[]);
  if (rErr) throw new QueryError('FAILED', 'ASSIGNABLE_ROLES_QUERY_FAILED', rErr.message);
  const activeRoleNames = new Set<string>((activeRoles ?? []).map((r: any) => String(r.role_name)));
  if (activeRoleNames.size === 0) {
    return { data: [], totalCount: 0 };
  }

  // 2) user_roles rows pointing at those roles.
  const { data: urRows, error: urErr } = await admin
    .from('user_roles')
    .select('user_id, role')
    .in('role', Array.from(activeRoleNames));
  if (urErr) throw new QueryError('FAILED', 'ASSIGNABLE_USER_ROLES_QUERY_FAILED', urErr.message);
  const rolesByUser = new Map<string, Set<string>>();
  for (const r of urRows ?? []) {
    const uid = String((r as any).user_id);
    const role = String((r as any).role);
    if (!rolesByUser.has(uid)) rolesByUser.set(uid, new Set());
    rolesByUser.get(uid)!.add(role);
  }
  const userIds = Array.from(rolesByUser.keys());
  if (userIds.length === 0) return { data: [], totalCount: 0 };

  // 3) Active profiles only. No email, no auth, no tokens.
  const { data: profs, error: pErr } = await admin
    .from('profiles')
    .select('id, full_name, user_code, is_active')
    .in('id', userIds)
    .eq('is_active', true);
  if (pErr) throw new QueryError('FAILED', 'ASSIGNABLE_PROFILES_QUERY_FAILED', pErr.message);

  const rows = (profs ?? []).map((p: any) => {
    const roleNames = Array.from(rolesByUser.get(String(p.id)) ?? []).sort();
    const displayName = (typeof p.full_name === 'string' && p.full_name.trim())
      ? String(p.full_name).trim()
      : (typeof p.user_code === 'string' && p.user_code.trim())
        ? String(p.user_code).trim()
        : 'Benefits user';
    return {
      userId: String(p.id),
      displayName,
      userCode: p.user_code ? String(p.user_code) : null,
      roleNames,
    };
  });

  rows.sort((a: any, b: any) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
  );
  return { data: rows, totalCount: rows.length };
}


// ── BN-AP-01 Turn 2 — operational read handlers ─────────────────────────

async function getAppealMyWorkSummary(admin: any, _params: any, ctx: { userId: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const userId = ctx.userId;

  const countMine = (apply: (q: any) => any) =>
    countAppeal(admin, (q) => apply(q.eq('assigned_to_user_id', userId)));

  const [
    assignedToMe, dueToday, slaBreached, evidenceOwners,
    casePreparation, hearingPreparation, recommendationPending, decisionPending,
  ] = await Promise.all([
    countMine((q) => q.in('status', APPEAL_OPEN_STATES)),
    countMine((q) => q.eq('filing_deadline_date', today).in('status', APPEAL_OPEN_STATES)),
    countMine((q) => q.lt('filing_deadline_date', today).in('status', APPEAL_OPEN_STATES)),
    countMine((q) => q.in('status', ['ADMISSIBILITY_REVIEW','ADMISSIBLE','CASE_PREPARATION'])),
    countMine((q) => q.in('status', ['ADMISSIBLE','CASE_PREPARATION'])),
    countMine((q) => q.eq('status', 'HEARING_SCHEDULED')),
    countMine((q) => q.in('status', ['CASE_PREPARATION','HEARING_HELD'])),
    countMine((q) => q.eq('status', 'RECOMMENDED')),
  ]);

  // Evidence awaiting = my open appeals with zero evidence rows.
  const { data: myOpen } = await admin
    .from('bn_appeal')
    .select('id')
    .eq('assigned_to_user_id', userId)
    .in('status', ['ADMISSIBILITY_REVIEW','ADMISSIBLE','CASE_PREPARATION']);
  const openIds = (myOpen ?? []).map((r: any) => r.id);
  let evidenceAwaiting = evidenceOwners;
  if (openIds.length > 0) {
    const { data: withEv } = await admin
      .from('bn_appeal_evidence').select('bn_appeal_id').in('bn_appeal_id', openIds);
    const hasEv = new Set((withEv ?? []).map((r: any) => r.bn_appeal_id));
    evidenceAwaiting = openIds.filter((id: string) => !hasEv.has(id)).length;
  }

  return {
    data: {
      assignedToMe, dueToday, slaBreached, evidenceAwaiting,
      casePreparation, hearingPreparation, recommendationPending, decisionPending,
    },
    totalCount: 1,
  };
}

async function listAppealMyWork(admin: any, params: any, ctx: { limit: number; offset: number; userId: string }) {
  const f = params?.filters ?? {};
  const view = String(params?.view ?? 'ALL_OPEN');
  let q = admin
    .from('bn_appeal')
    .select(
      'id, appeal_number, bn_claim_id, source_module_code, appeal_type_code, status, current_stage_code, ' +
      'assigned_workbasket, filing_deadline_date, submitted_at, requires_hearing, hearing_waived, ' +
      'claimant_person_id',
      { count: 'exact' },
    )
    .eq('assigned_to_user_id', ctx.userId);

  const viewFilter: Record<string, (qb: any) => any> = {
    ALL_OPEN: (qb) => qb.in('status', APPEAL_OPEN_STATES),
    CASE_PREP: (qb) => qb.in('status', ['ADMISSIBLE','CASE_PREPARATION']),
    EVIDENCE:  (qb) => qb.in('status', ['ADMISSIBILITY_REVIEW','ADMISSIBLE','CASE_PREPARATION']),
    HEARING:   (qb) => qb.eq('status', 'HEARING_SCHEDULED'),
    RECOMMEND: (qb) => qb.in('status', ['CASE_PREPARATION','HEARING_HELD']),
    DECISION:  (qb) => qb.eq('status', 'RECOMMENDED'),
  };
  q = (viewFilter[view] ?? viewFilter.ALL_OPEN)(q);
  if (typeof f.search === 'string' && f.search.trim()) {
    q = q.ilike('appeal_number', `%${escapeLike(f.search.trim())}%`);
  }
  q = q.order('filing_deadline_date', { ascending: true, nullsFirst: false });
  q = q.range(ctx.offset, ctx.offset + ctx.limit - 1);

  const { data, error, count } = await q;
  if (error) throw new QueryError('FAILED', 'APPEAL_MY_WORK_QUERY_FAILED', error.message);
  const rows = data ?? [];
  const today = new Date().toISOString().slice(0, 10);

  // Enrich appellant names via claim -> ssn -> ip_master (best-effort).
  const claimIds = [...new Set(rows.map((r: any) => r.bn_claim_id).filter(Boolean))];
  const claimMap = new Map<string, { ssn: string | null; claim_number: string | null }>();
  if (claimIds.length > 0) {
    const { data: cs } = await admin.from('bn_claim').select('id, ssn, claim_number').in('id', claimIds);
    for (const c of (cs ?? [])) claimMap.set(String(c.id), { ssn: c.ssn, claim_number: c.claim_number });
  }
  const ssns = [...new Set([...claimMap.values()].map((c) => c.ssn).filter(Boolean))] as string[];
  const nameBySsn = new Map<string, string>();
  if (ssns.length > 0) {
    const { data: ps } = await admin.from('ip_master').select('ssn, first_name, last_name').in('ssn', ssns);
    for (const p of (ps ?? [])) nameBySsn.set(String(p.ssn), `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Unknown');
  }

  const mapped = rows.map((r: any) => {
    const cm = claimMap.get(String(r.bn_claim_id));
    return {
      id: r.id,
      appealNumber: r.appeal_number,
      appellantName: cm?.ssn ? (nameBySsn.get(cm.ssn) ?? null) : null,
      claimantSsnMasked: cm?.ssn ? maskNationalId(cm.ssn) : null,
      sourceReference: cm?.claim_number ?? null,
      sourceModule: r.source_module_code,
      appealType: r.appeal_type_code,
      currentStage: r.current_stage_code,
      status: r.status,
      assignedWorkbasket: r.assigned_workbasket,
      filingDeadlineDate: r.filing_deadline_date,
      slaStatus: (r.filing_deadline_date && r.filing_deadline_date < today && APPEAL_OPEN_STATES.includes(r.status)) ? 'BREACHED' : 'OK',
      hearingRequired: !!r.requires_hearing && !r.hearing_waived,
      nextAction: 'Review',
    };
  });
  return { data: mapped, totalCount: count ?? mapped.length };
}

async function listAppealHearings(admin: any, params: any, ctx: { limit: number; offset: number }) {
  const view = String(params?.view ?? 'UPCOMING');
  const today = new Date().toISOString();
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString();

  let q = admin
    .from('bn_appeal_hearing')
    .select(
      'id, bn_appeal_id, hearing_reference, scheduled_start, scheduled_end, time_zone, ' +
      'hearing_mode, location_text, is_virtual, chair_user_id, notice_status, status, outcome',
      { count: 'exact' },
    );

  const viewFilter: Record<string, (qb: any) => any> = {
    UNSCHEDULED: (qb) => qb.is('scheduled_start', null),
    UPCOMING:    (qb) => qb.gte('scheduled_start', today).not('status','in','("COMPLETED","CANCELLED")'),
    TODAY:       (qb) => qb.gte('scheduled_start', today).lt('scheduled_start', tomorrow),
    AWAITING_NOTICE: (qb) => qb.eq('notice_status', 'PENDING'),
    ADJOURNED:   (qb) => qb.eq('status', 'ADJOURNED'),
    OUTCOME_PENDING: (qb) => qb.eq('status', 'HELD').is('outcome', null),
    COMPLETED:   (qb) => qb.eq('status', 'COMPLETED'),
  };
  q = (viewFilter[view] ?? viewFilter.UPCOMING)(q);
  q = q.order('scheduled_start', { ascending: true, nullsFirst: true });
  q = q.range(ctx.offset, ctx.offset + ctx.limit - 1);

  const { data, error, count } = await q;
  if (error) throw new QueryError('FAILED', 'APPEAL_HEARINGS_QUERY_FAILED', error.message);
  const rows = data ?? [];

  const appealIds = [...new Set(rows.map((r: any) => r.bn_appeal_id).filter(Boolean))];
  const appealById = new Map<string, any>();
  if (appealIds.length > 0) {
    const { data: as } = await admin.from('bn_appeal')
      .select('id, appeal_number, appeal_type_code, bn_claim_id').in('id', appealIds);
    for (const a of (as ?? [])) appealById.set(String(a.id), a);
  }
  // participant counts
  const partCounts = new Map<string, number>();
  if (rows.length > 0) {
    const hearingIds = rows.map((r: any) => r.id);
    const { data: parts } = await admin.from('bn_appeal_hearing_participant')
      .select('bn_appeal_hearing_id').in('bn_appeal_hearing_id', hearingIds);
    for (const p of (parts ?? [])) {
      const k = String(p.bn_appeal_hearing_id);
      partCounts.set(k, (partCounts.get(k) ?? 0) + 1);
    }
  }

  const mapped = rows.map((r: any) => {
    const a = appealById.get(String(r.bn_appeal_id));
    return {
      id: r.id,
      appealId: r.bn_appeal_id,
      hearingReference: r.hearing_reference,
      appealNumber: a?.appeal_number ?? null,
      appealType: a?.appeal_type_code ?? null,
      hearingMode: r.hearing_mode,
      scheduledStart: r.scheduled_start,
      scheduledEnd: r.scheduled_end,
      timeZone: r.time_zone,
      location: r.is_virtual ? 'Virtual' : (r.location_text ?? '—'),
      chairUserId: r.chair_user_id,
      participantCount: partCounts.get(String(r.id)) ?? 0,
      noticeStatus: r.notice_status,
      status: r.status,
      outcome: r.outcome,
      nextAction: r.outcome ? 'Complete' : 'Prepare hearing',
    };
  });
  return { data: mapped, totalCount: count ?? mapped.length };
}

async function listAppealImplementation(admin: any, params: any, ctx: { limit: number; offset: number }) {
  const view = String(params?.view ?? 'READY');
  let q = admin
    .from('bn_appeal_implementation_action')
    .select(
      'id, bn_appeal_id, bn_appeal_decision_id, action_type, target_module, target_entity_id, ' +
      'action_status, attempt_count, failure_code, requested_at, completed_at, reconciliation_status',
      { count: 'exact' },
    );
  const viewFilter: Record<string, (qb: any) => any> = {
    AWAITING_PLAN: (qb) => qb.eq('action_status', 'AWAITING_PLAN'),
    READY:         (qb) => qb.eq('action_status', 'READY'),
    IN_PROGRESS:   (qb) => qb.eq('action_status', 'IN_PROGRESS'),
    FAILED:        (qb) => qb.eq('action_status', 'FAILED'),
    AWAITING_RECON:(qb) => qb.eq('reconciliation_status', 'PENDING'),
    PARTIAL:       (qb) => qb.eq('action_status', 'PARTIAL'),
    COMPLETED:     (qb) => qb.eq('action_status', 'COMPLETED'),
  };
  q = (viewFilter[view] ?? viewFilter.READY)(q);
  q = q.order('requested_at', { ascending: true, nullsFirst: false });
  q = q.range(ctx.offset, ctx.offset + ctx.limit - 1);

  const { data, error, count } = await q;
  if (error) throw new QueryError('FAILED', 'APPEAL_IMPL_QUERY_FAILED', error.message);
  const rows = data ?? [];

  const appealIds = [...new Set(rows.map((r: any) => r.bn_appeal_id).filter(Boolean))];
  const appealById = new Map<string, any>();
  if (appealIds.length > 0) {
    const { data: as } = await admin.from('bn_appeal')
      .select('id, appeal_number, source_module_code, bn_claim_id').in('id', appealIds);
    for (const a of (as ?? [])) appealById.set(String(a.id), a);
  }
  const decisionIds = [...new Set(rows.map((r: any) => r.bn_appeal_decision_id).filter(Boolean))];
  const decisionById = new Map<string, any>();
  if (decisionIds.length > 0) {
    const { data: ds } = await admin.from('bn_appeal_decision')
      .select('id, decision_number, outcome_code, remedy_code').in('id', decisionIds);
    for (const d of (ds ?? [])) decisionById.set(String(d.id), d);
  }

  const mapped = rows.map((r: any) => {
    const a = appealById.get(String(r.bn_appeal_id));
    const d = decisionById.get(String(r.bn_appeal_decision_id));
    return {
      id: r.id,
      appealId: r.bn_appeal_id,
      appealNumber: a?.appeal_number ?? null,
      decisionNumber: d?.decision_number ?? null,
      decisionOutcome: d?.outcome_code ?? null,
      remedy: d?.remedy_code ?? null,
      sourceModule: a?.source_module_code ?? null,
      targetModule: r.target_module,
      targetEntity: r.target_entity_id,
      actionType: r.action_type,
      actionStatus: r.action_status,
      attemptCount: r.attempt_count,
      failureCode: r.failure_code,
      requestedDate: r.requested_at,
      completedDate: r.completed_at,
      reconciliationStatus: r.reconciliation_status,
      nextAction: r.action_status === 'FAILED' ? 'Investigate' : 'Awaiting execution',
    };
  });
  return { data: mapped, totalCount: count ?? mapped.length };
}

async function getAppealConfiguration(admin: any, _params: any, _ctx: any) {
  const [types, grounds, remedies] = await Promise.all([
    admin.from('bn_appeal_type_config').select('*').order('appeal_type_code'),
    admin.from('bn_appeal_ground_config').select('*').order('ground_code'),
    admin.from('bn_appeal_remedy_config').select('*').order('remedy_code'),
  ]);
  return {
    data: {
      appealTypes: types.data ?? [],
      grounds: grounds.data ?? [],
      remedies: remedies.data ?? [],
      filingPolicies: [],
      hearingPolicies: [],
      workflowMappings: [],
      communicationTemplates: [],
      integrationReadiness: [
        { sourceModule: 'bn_claim', ready: true },
        { sourceModule: 'bn_award', ready: false, reason: 'Source adapter pending certification' },
        { sourceModule: 'bn_overpayment', ready: false, reason: 'Source adapter pending certification' },
        { sourceModule: 'bn_medical', ready: false, reason: 'Source adapter pending certification' },
        { sourceModule: 'bn_means_test', ready: false, reason: 'Source adapter pending certification' },
      ],
    },
    totalCount: 1,
  };
}

const QUERY_REGISTRY: Record<string, QueryDescriptor> = {
  BN_MORTALITY_GET_SUMMARY: { moduleCode: 'bn_mortality', anyOfCapabilities: ['bn_mortality:view', 'bn_mortality:read'], sensitiveFields: [], maxPageSize: 1, handler: (admin, params) => getSummary(admin, params) },
  BN_MORTALITY_LIST_EVENTS: { moduleCode: 'bn_mortality', anyOfCapabilities: ['bn_mortality:view', 'bn_mortality:read'], sensitiveFields: ['nationalIdMasked', 'sourcePayload'], maxPageSize: 100, handler: listEvents },
  BN_MORTALITY_GET_EVENT: { moduleCode: 'bn_mortality', anyOfCapabilities: ['bn_mortality:view', 'bn_mortality:read'], sensitiveFields: ['sourcePayload', 'externalReferenceRaw', 'diagnostics'], maxPageSize: 1, handler: (admin, params) => getEvent(admin, params) },
  BN_MORTALITY_SEARCH_PERSON_MATCHES: { moduleCode: 'bn_mortality', anyOfCapabilities: ['bn_mortality:read'], sensitiveFields: ['nationalIdMasked', 'dateOfBirth', 'confidenceInternals'], maxPageSize: 50, handler: searchPersonMatches },
  BN_MORTALITY_GET_AFFECTED_AWARDS: { moduleCode: 'bn_mortality', anyOfCapabilities: ['bn_mortality:read'], sensitiveFields: ['overpaymentAmountMinor', 'holdReasonInternal'], maxPageSize: 100, handler: getAffectedAwards },
  BN_MORTALITY_GET_EVENT_HISTORY: { moduleCode: 'bn_mortality', anyOfCapabilities: ['bn_mortality:read'], sensitiveFields: ['justification'], maxPageSize: 200, handler: getEventHistory },
  BN_MORTALITY_GET_REFERRALS: { moduleCode: 'bn_mortality', anyOfCapabilities: ['bn_mortality:read'], sensitiveFields: [], maxPageSize: 100, handler: getReferrals },
  BN_MORTALITY_GET_AWARD_IMPACTS: { moduleCode: 'bn_mortality', anyOfCapabilities: ['bn_mortality:read'], sensitiveFields: ['overpaymentAmountMinor', 'ledgerDetail'], maxPageSize: 100, handler: getAwardImpacts },
  BN_MORTALITY_GET_EVIDENCE_LINKS: { moduleCode: 'bn_mortality', anyOfCapabilities: ['bn_mortality:read'], sensitiveFields: ['fileReference'], maxPageSize: 100, handler: getEvidenceLinks },
  BN_MORTALITY_GET_COMMUNICATIONS: { moduleCode: 'bn_mortality', anyOfCapabilities: ['bn_mortality:read'], sensitiveFields: ['recipientSummary'], maxPageSize: 100, handler: getCommunications },
  BN_MORTALITY_PREVIEW_REGISTRATION_IMPACT: { moduleCode: 'bn_mortality', anyOfCapabilities: ['bn_mortality:read', 'bn_mortality:write'], sensitiveFields: [], maxPageSize: 100, handler: (admin, params) => previewRegistrationImpact(admin, params) },
  BN_MORTALITY_GET_ACTION_AVAILABILITY: { moduleCode: 'bn_mortality', anyOfCapabilities: ['bn_mortality:view', 'bn_mortality:read'], sensitiveFields: [], maxPageSize: 1, handler: async () => ({ data: null, totalCount: 0 }) },
  BN_MORTALITY_GET_ASSIGNABLE_USERS: { moduleCode: 'bn_mortality', anyOfCapabilities: ['bn_mortality:view', 'bn_mortality:read'], sensitiveFields: [], maxPageSize: 500, handler: (admin) => getAssignableUsers(admin) },

  // BN-AP-00 — Appeals & Disputes
  BN_APPEAL_GET_MY_APPEALS: { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:claimant_submit', 'bn_appeals:view'], sensitiveFields: [], maxPageSize: 100, handler: getMyAppeals },
  BN_APPEAL_GET_MY_APPEAL_DETAIL: { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:claimant_submit', 'bn_appeals:view'], sensitiveFields: ['assignedToUserId', 'assignedWorkbasket', 'internalNotes'], maxPageSize: 1, handler: getMyAppealDetail },
  BN_APPEAL_GET_SUMMARY: { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:view', 'bn_appeals:read'], sensitiveFields: [], maxPageSize: 1, handler: getAppealSummary },
  BN_APPEAL_LIST: { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:view', 'bn_appeals:read'], sensitiveFields: ['claimantSsnMasked', 'reasonSummary'], maxPageSize: 100, handler: listAppeals },
  BN_APPEAL_GET: { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: ['claimantSsnMasked', 'internalNotes'], maxPageSize: 1, handler: getAppeal },
  BN_APPEAL_GET_GROUNDS: { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: [], maxPageSize: 100, handler: getAppealGrounds },
  BN_APPEAL_GET_EVIDENCE: { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: ['fileReference'], maxPageSize: 100, handler: getAppealEvidence },
  BN_APPEAL_GET_EVENTS: { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: ['diagnostics'], maxPageSize: 200, handler: getAppealEvents },
  BN_APPEAL_GET_HEARINGS: { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: [], maxPageSize: 100, handler: getAppealHearing },
  BN_APPEAL_GET_DECISION_SNAPSHOT: { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: [], maxPageSize: 1, handler: getAppealDecisionSnapshot },
  BN_APPEAL_GET_SOURCE_DECISION: { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:read', 'bn_appeals:view'], sensitiveFields: ['sourceDecisionInternalNotes'], maxPageSize: 1, handler: getAppealSourceDecision },
  BN_APPEAL_GET_ACTION_AVAILABILITY: { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:view', 'bn_appeals:read'], sensitiveFields: [], maxPageSize: 1, handler: getAppealActionAvailability },

  // AP-01 Slice 2A.3 — 14-tab enterprise child surfaces, real handlers.
  BN_APPEAL_GET_PARTIES:            { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: ['maskedIdentifier','contactReference'], maxPageSize: 50,  handler: getAppealParties },
  BN_APPEAL_GET_ISSUES:             { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: [], maxPageSize: 100, handler: getAppealIssues },
  BN_APPEAL_GET_DEADLINES:          { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: [], maxPageSize: 100, handler: getAppealDeadlines },
  BN_APPEAL_GET_EVIDENCE_REQUESTS:  { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: [], maxPageSize: 100, handler: getAppealEvidenceRequests },
  BN_APPEAL_GET_STAYS:              { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: [], maxPageSize: 50,  handler: getAppealStays },
  BN_APPEAL_GET_NOTES:              { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: ['body'], maxPageSize: 200, handler: getAppealNotes },
  BN_APPEAL_GET_HEARING:            { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: [], maxPageSize: 50,  handler: getAppealHearing },
  BN_APPEAL_GET_RECOMMENDATIONS:    { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: [], maxPageSize: 50,  handler: getAppealRecommendations },
  BN_APPEAL_GET_DECISIONS:          { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: [], maxPageSize: 50,  handler: getAppealDecisions },
  BN_APPEAL_GET_IMPLEMENTATION:     { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: [], maxPageSize: 100, handler: getAppealImplementation },
  BN_APPEAL_GET_LINKS:              { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: [], maxPageSize: 100, handler: getAppealLinks },
  BN_APPEAL_GET_WORKFLOW:           { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: [], maxPageSize: 100, handler: getAppealWorkflow },
  BN_APPEAL_GET_COMMUNICATIONS:     { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: ['recipientContact'], maxPageSize: 100, handler: getAppealCommunications },

  // AP-01 Turn 2 — operational read screens
  BN_APPEAL_GET_MY_WORK_SUMMARY: { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:view','bn_appeals:read'], sensitiveFields: [], maxPageSize: 1, handler: getAppealMyWorkSummary },
  BN_APPEAL_LIST_MY_WORK:        { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:view','bn_appeals:read'], sensitiveFields: ['claimantSsnMasked'], maxPageSize: 100, handler: listAppealMyWork },
  BN_APPEAL_LIST_HEARINGS:       { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:view','bn_appeals:read'], sensitiveFields: [], maxPageSize: 100, handler: listAppealHearings },
  BN_APPEAL_LIST_IMPLEMENTATION: { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:view','bn_appeals:read'], sensitiveFields: [], maxPageSize: 100, handler: listAppealImplementation },
  BN_APPEAL_GET_CONFIGURATION:   { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:view','bn_appeals:read'], sensitiveFields: [], maxPageSize: 1, handler: getAppealConfiguration },

  // AP-01 Slice 2B — Source-lookup / registration-config surfaces
  BN_APPEAL_SEARCH_SOURCE_DECISIONS:  { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:view','bn_appeals:read','bn_appeals:write'], sensitiveFields: ['claimantSsnMasked'], maxPageSize: 50, handler: (a, p, ctx) => searchAppealSourceDecisions(a, p, { limit: ctx.limit, offset: ctx.offset }) },
  BN_APPEAL_GET_SOURCE_CANDIDATE:     { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:view','bn_appeals:read','bn_appeals:write'], sensitiveFields: ['claimantSsnMasked'], maxPageSize: 1,  handler: getAppealSourceCandidate },
  BN_APPEAL_GET_SOURCE_CONTEXT:       { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:view','bn_appeals:read','bn_appeals:write'], sensitiveFields: ['claimantSsnMasked','internalNotes'], maxPageSize: 1,  handler: getAppealSourceContext },
  BN_APPEAL_GET_REPRESENTATIVE_OPTIONS:{ moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:view','bn_appeals:read','bn_appeals:write'], sensitiveFields: ['contactReference'], maxPageSize: 20, handler: getAppealRepresentativeOptions },
  BN_APPEAL_CALCULATE_FILING_DEADLINE:{ moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:view','bn_appeals:read','bn_appeals:write'], sensitiveFields: [], maxPageSize: 1, handler: calculateAppealFilingDeadline },
  BN_APPEAL_CHECK_DUPLICATE:          { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:view','bn_appeals:read','bn_appeals:write'], sensitiveFields: [], maxPageSize: 1, handler: checkAppealDuplicate },
  BN_APPEAL_GET_REGISTRATION_CONFIG:  { moduleCode: 'bn_appeals', anyOfCapabilities: ['bn_appeals:view','bn_appeals:read','bn_appeals:write'], sensitiveFields: [], maxPageSize: 1, handler: getAppealRegistrationConfig },
};

function maskNationalId(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = String(value);
  if (s.length <= 4) return '••••';
  return `••••${s.slice(-4)}`;
}

function maskField(obj: any, field: string): boolean {
  if (obj == null || typeof obj !== 'object') return false;
  if (field in obj) { obj[field] = null; return true; }
  return false;
}

function applyMasking(payload: any, sensitiveFields: string[], isAdmin: boolean): string[] {
  if (isAdmin || sensitiveFields.length === 0) return [];
  const applied = new Set<string>();
  if (Array.isArray(payload)) {
    for (const row of payload) for (const f of sensitiveFields) { if (maskField(row, f)) applied.add(f); }
  } else if (payload && typeof payload === 'object') {
    for (const f of sensitiveFields) if (maskField(payload, f)) applied.add(f);
  }
  return Array.from(applied);
}

/**
 * Fail-closed capability resolution. Returns the set of verbs the caller
 * actually holds for `moduleName`, but only after confirming the module is
 * enabled and routes are enabled. Missing rows at any join produce an empty
 * set — never an implicit grant.
 */
async function resolveModuleAccess(
  admin: any,
  userId: string,
  moduleName: string,
): Promise<{ moduleFound: boolean; moduleEnabled: boolean; routesEnabled: boolean; grantedVerbs: Set<string> }> {
  const empty = { moduleFound: false, moduleEnabled: false, routesEnabled: false, grantedVerbs: new Set<string>() };
  const { data: mod, error: mErr } = await admin
    .from('app_modules').select('id, is_enabled, routes_enabled').eq('name', moduleName).maybeSingle();
  if (mErr) throw new QueryError('FAILED', 'MODULE_LOOKUP_FAILED', mErr.message);
  if (!mod) return empty;
  if (!mod.is_enabled) return { moduleFound: true, moduleEnabled: false, routesEnabled: !!mod.routes_enabled, grantedVerbs: new Set() };
  if (!mod.routes_enabled) return { moduleFound: true, moduleEnabled: true, routesEnabled: false, grantedVerbs: new Set() };

  const { data: userRoles, error: urErr } = await admin.from('user_roles').select('role').eq('user_id', userId);
  if (urErr) throw new QueryError('FAILED', 'USER_ROLES_LOOKUP_FAILED', urErr.message);
  const roleNames = Array.from(new Set((userRoles ?? []).map((r: any) => String(r.role))));
  if (roleNames.length === 0) return { moduleFound: true, moduleEnabled: true, routesEnabled: true, grantedVerbs: new Set() };

  const { data: roleRows, error: rErr } = await admin.from('roles').select('id').in('role_name', roleNames);
  if (rErr) throw new QueryError('FAILED', 'ROLES_LOOKUP_FAILED', rErr.message);
  const roleIds = (roleRows ?? []).map((r: any) => r.id);
  if (roleIds.length === 0) return { moduleFound: true, moduleEnabled: true, routesEnabled: true, grantedVerbs: new Set() };

  const { data: perms, error: pErr } = await admin
    .from('role_permissions')
    .select('action_id')
    .in('role_id', roleIds)
    .eq('module_id', mod.id)
    .eq('is_granted', true);
  if (pErr) throw new QueryError('FAILED', 'PERMISSIONS_LOOKUP_FAILED', pErr.message);
  const actionIds = Array.from(new Set((perms ?? []).map((p: any) => p.action_id)));
  if (actionIds.length === 0) return { moduleFound: true, moduleEnabled: true, routesEnabled: true, grantedVerbs: new Set() };

  const { data: actions, error: aErr } = await admin
    .from('module_actions').select('action_name')
    .eq('module_id', mod.id).eq('is_enabled', true).in('id', actionIds);
  if (aErr) throw new QueryError('FAILED', 'ACTIONS_LOOKUP_FAILED', aErr.message);
  const grantedVerbs = new Set<string>((actions ?? []).map((a: any) => String(a.action_name)));
  return { moduleFound: true, moduleEnabled: true, routesEnabled: true, grantedVerbs };
}

// -- Server ------------------------------------------------------------------

function envelope(
  status: 'OK' | 'DENIED' | 'INVALID' | 'NOT_FOUND' | 'FAILED',
  correlationId: string,
  queryCode: string,
  queryVersion: number,
  overrides: Partial<{ data: unknown; page: { pageSize: number; nextPageToken: string | null; totalCount: number | null }; errors: Array<{ code: string; message: string; field?: string }>; maskedFields: string[]; warnings: string[] }> = {},
) {
  return {
    status, correlationId, queryCode, queryVersion,
    data: overrides.data ?? null,
    page: overrides.page,
    errors: overrides.errors ?? [],
    maskedFields: overrides.maskedFields ?? [],
    warnings: overrides.warnings ?? [],
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return json(envelope('FAILED', 'unknown', 'unknown', 0, {
      errors: [{ code: 'METHOD_NOT_ALLOWED', message: 'Only POST is accepted.' }],
    }));
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const body = await req.json().catch(() => ({}));
  const queryCode: string = body?.queryCode ?? 'unknown';
  const queryVersion: number = Number(body?.queryVersion ?? 1);
  const correlationId: string = body?.correlationId ?? crypto.randomUUID();
  const params = body?.params ?? {};
  const rawLimit = Number(body?.page?.pageSize ?? body?.pageSize ?? 25);
  const rawOffset = Number(body?.page?.pageToken ?? body?.pageToken ?? 0);

  try {
    const auth = req.headers.get('Authorization');
    if (!auth) {
      return json(envelope('DENIED', correlationId, queryCode, queryVersion, {
        errors: [{ code: 'UNAUTHENTICATED', message: 'Bearer JWT required.' }],
      }));
    }
    const token = auth.replace(/^Bearer\s+/i, '');
    const { data: claimsData, error: claimsErr } = await (admin.auth as any).getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      return json(envelope('DENIED', correlationId, queryCode, queryVersion, {
        errors: [{ code: 'UNAUTHENTICATED', message: 'Invalid or expired JWT.' }],
      }));
    }
    const userId: string = claimsData.claims.sub;

    const descriptor = QUERY_REGISTRY[queryCode];
    if (!descriptor) {
      return json(envelope('INVALID', correlationId, queryCode, queryVersion, {
        errors: [{ code: 'QUERY_CODE_UNKNOWN', message: `Unknown query code: ${queryCode}` }],
      }));
    }

    const limit = Math.min(Math.max(1, isFinite(rawLimit) ? rawLimit : 25), descriptor.maxPageSize);
    const offset = Math.max(0, isFinite(rawOffset) ? rawOffset : 0);

    // Fail-closed capability walk.
    const access = await resolveModuleAccess(admin, userId, descriptor.moduleCode);
    if (!access.moduleFound) {
      return json(envelope('DENIED', correlationId, queryCode, queryVersion, {
        errors: [{ code: 'MODULE_NOT_REGISTERED', message: `Module ${descriptor.moduleCode} is not registered.` }],
      }));
    }
    if (!access.moduleEnabled) {
      return json(envelope('DENIED', correlationId, queryCode, queryVersion, {
        errors: [{ code: 'MODULE_DISABLED', message: `Module ${descriptor.moduleCode} is disabled.` }],
      }));
    }
    if (!access.routesEnabled) {
      return json(envelope('DENIED', correlationId, queryCode, queryVersion, {
        errors: [{ code: 'ROUTES_DISABLED', message: `Routes for ${descriptor.moduleCode} are disabled.` }],
      }));
    }
    const requiredVerbs = descriptor.anyOfCapabilities
      .filter((c) => c.startsWith(`${descriptor.moduleCode}:`))
      .map((c) => c.split(':')[1]);
    const hasAny = requiredVerbs.some((v) => access.grantedVerbs.has(v));
    if (!hasAny) {
      return json(envelope('DENIED', correlationId, queryCode, queryVersion, {
        errors: [{
          code: 'FORBIDDEN',
          message: `Missing capability. One of: ${descriptor.anyOfCapabilities.join(', ')}`,
        }],
      }));
    }
    const isAdmin = access.grantedVerbs.has('admin');

    // Special-case: action availability calculator needs userId + granted verbs.
    if (queryCode === 'BN_MORTALITY_GET_ACTION_AVAILABILITY') {
      // NOTE: computeActionAvailability throws QueryError on DB failure
      // (ACTION_*_QUERY_FAILED) or missing event (EVENT_NOT_FOUND).
      const availability = await computeActionAvailability(admin, userId, access.grantedVerbs, params);
      if (availability.rows.length !== 26) {
        return json(envelope('FAILED', correlationId, queryCode, queryVersion, {
          errors: [{
            code: 'ACTION_MATRIX_INVARIANT_VIOLATION',
            message: `Expected 26 canonical commands, got ${availability.rows.length}.`,
          }],
        }));
      }
      return json(envelope('OK', correlationId, queryCode, queryVersion, {
        data: availability,
        page: { pageSize: 1, nextPageToken: null, totalCount: 1 },
      }));
    }

    const result = await descriptor.handler(admin, params, { limit, offset, userId });
    const masked = applyMasking(result.data, descriptor.sensitiveFields, isAdmin);

    // Audit — best-effort.
    admin.from('bn_module_events').insert({
      module_code: descriptor.moduleCode,
      event_type: 'QUERY_EXECUTED',
      actor_user_id: userId,
      payload_json: {
        queryCode, correlationId, params,
        resultCount: Array.isArray(result.data) ? result.data.length : (result.data ? 1 : 0),
        maskedFields: masked,
      },
    }).then(() => {}).catch(() => {});

    if (result.notFound) {
      return json(envelope('NOT_FOUND', correlationId, queryCode, queryVersion, {
        data: null, maskedFields: masked,
        page: { pageSize: limit, nextPageToken: null, totalCount: 0 },
      }));
    }

    const totalCount = result.totalCount;
    const nextOffset = offset + limit;
    const nextPageToken =
      typeof totalCount === 'number' && nextOffset < totalCount ? String(nextOffset) : null;

    return json(envelope('OK', correlationId, queryCode, queryVersion, {
      data: result.data,
      maskedFields: masked,
      page: { pageSize: limit, nextPageToken, totalCount: typeof totalCount === 'number' ? totalCount : null },
    }));
  } catch (err: any) {
    if (err instanceof QueryError) {
      return json(envelope(err.status, correlationId, queryCode, queryVersion, {
        errors: [{ code: err.code, message: err.message, field: err.field }],
      }));
    }
    return json(envelope('FAILED', correlationId, queryCode, queryVersion, {
      errors: [{ code: 'INTERNAL_ERROR', message: String(err?.message ?? err) }],
    }));
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// -- BN-MORT-UI-1D: action availability -------------------------------------

/**
 * Fail-closed action availability computation.
 *
 * Every DB error surfaces as a typed `QueryError('FAILED', 'ACTION_*_QUERY_FAILED')`
 * — the browser never sees a stale or fabricated "available" row when
 * infrastructure is misbehaving. Missing events produce NOT_FOUND.
 *
 * Multi-award readiness is aggregated across every row of
 * `bn_mortality_award_impact` via `aggregateAwardImpacts`; maker identity
 * is derived from the immutable `bn_mortality_event_history` log rather
 * than from mutable event columns.
 */
async function computeActionAvailability(
  admin: any,
  userId: string,
  grantedVerbs: Set<string>,
  params: any,
) {
  const eventId = params?.eventId ? String(params.eventId) : null;
  let snapshot: any = null;

  if (eventId) {
    if (!UUID_RE.test(eventId)) throw new QueryError('INVALID', 'INVALID_PARAMS', 'eventId must be UUID', 'eventId');

    // 1) Event row.
    const evRes = await admin
      .from('bn_mortality_event')
      .select('id,status,row_version,created_by,matched_ip_id,verified_at')
      .eq('id', eventId)
      .maybeSingle();
    if (evRes.error) {
      throw new QueryError('FAILED', 'ACTION_EVENT_QUERY_FAILED', `Failed to load event: ${evRes.error.message ?? evRes.error}`);
    }
    const ev = evRes.data;
    if (!ev) throw new QueryError('NOT_FOUND', 'EVENT_NOT_FOUND', `Mortality event ${eventId} does not exist.`, 'eventId');

    // 2) Immutable history — drives maker identities.
    const histRes = await admin
      .from('bn_mortality_event_history')
      .select('command_name,actor_user_id,occurred_at')
      .eq('event_id', eventId)
      .order('occurred_at', { ascending: true });
    if (histRes.error) {
      throw new QueryError('FAILED', 'ACTION_HISTORY_QUERY_FAILED', `Failed to load event history: ${histRes.error.message ?? histRes.error}`);
    }
    const hist: Array<{ command_name: string; actor_user_id: string; occurred_at: string }> = histRes.data ?? [];

    // Build maker map: latest actor per source command.
    const makers: Record<string, { userId: string; occurredAt: string }> = {};
    for (const h of hist) {
      if (h.command_name && h.actor_user_id) {
        makers[h.command_name] = { userId: h.actor_user_id, occurredAt: h.occurred_at };
      }
    }

    // 3) ALL award-impact rows (aggregate readiness).
    const impactRes = await admin
      .from('bn_mortality_award_impact')
      .select('created_at,approved_at,termination_effective_date')
      .eq('event_id', eventId);
    if (impactRes.error) {
      throw new QueryError('FAILED', 'ACTION_IMPACT_QUERY_FAILED', `Failed to load award impacts: ${impactRes.error.message ?? impactRes.error}`);
    }
    const awardImpact = aggregateAwardImpacts(impactRes.data ?? []);

    // 4) Referrals presence.
    const refRes = await admin
      .from('bn_mortality_referral')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId);
    if (refRes.error) {
      throw new QueryError('FAILED', 'ACTION_REFERRAL_QUERY_FAILED', `Failed to load referrals: ${refRes.error.message ?? refRes.error}`);
    }
    const refCount = refRes.count ?? 0;

    snapshot = {
      eventId: ev.id,
      status: ev.status,
      rowVersion: ev.row_version ?? null,
      createdBy: ev.created_by ?? null,
      makers,
      matchedIpId: ev.matched_ip_id ?? null,
      verifiedAt: ev.verified_at ?? null,
      awardImpact,
      hasReferrals: refCount > 0,
    };
  }

  // 5) actions_enabled flag on app_modules — internal-pilot gate.
  const modRes = await admin
    .from('app_modules').select('actions_enabled').eq('name', 'bn_mortality').maybeSingle();
  if (modRes.error) {
    throw new QueryError('FAILED', 'ACTION_MODULE_QUERY_FAILED', `Failed to load module rollout: ${modRes.error.message ?? modRes.error}`);
  }
  const actionsEnabled = modRes.data?.actions_enabled === true;

  // 6) DB-driven integration readiness — every gap module gets its own row.
  //    A missing row means "not certified" (fail-closed).
  const readinessRes = await admin
    .from('bn_mortality_integration_readiness')
    .select('integration_code,certification_status,is_ready');
  if (readinessRes.error) {
    throw new QueryError('FAILED', 'ACTION_READINESS_QUERY_FAILED', `Failed to load integration readiness: ${readinessRes.error.message ?? readinessRes.error}`);
  }
  const integrationReadiness: Record<string, boolean> = {
    awards: false, dms: false, overpayments: false, survivor: false, funeral: false, legal: false,
  };
  for (const r of readinessRes.data ?? []) {
    integrationReadiness[r.integration_code] =
      r.certification_status === 'CERTIFIED' && r.is_ready === true;
  }

  const rows = calculateActionAvailability({
    actionsEnabled,
    event: snapshot,
    grantedVerbs,
    currentUserId: userId,
    integrationReadiness,
  });

  return {
    eventId,
    currentUserId: userId,
    actionsEnabled,
    rows,
  };
}


