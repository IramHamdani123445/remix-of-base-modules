/**
 * Payment Profile Service
 * Single source of truth for reading and mutating bn_payment_profile across
 * every BN channel. Screens must NEVER write to bn_payment_profile directly.
 */
import { supabase } from '@/integrations/supabase/client';
import type {
  BnPaymentProfile,
  BnPaymentProfileDraft,
  BnPaymentProfileChangeRequest,
  BnPaymentChannel,
  BnPaymentPolicy,
  BnPaymentMethod,
} from '@/types/bnPaymentProfile';
import { DEFAULT_PAYMENT_POLICY, maskAccount } from '@/types/bnPaymentProfile';

const db = supabase as any;

function logShielded(action: string, err: unknown) {
  // fire-and-forget; do not block UI
  try {
    // eslint-disable-next-line no-console
    console.warn(`[paymentProfileService] ${action} failed`, err);
  } catch {}
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------
export async function getPaymentPolicy(productId?: string | null): Promise<BnPaymentPolicy> {
  if (!productId) return DEFAULT_PAYMENT_POLICY;
  try {
    const { data } = await db
      .from('bn_product_channel_config')
      .select(
        'allowed_payment_methods,default_payment_method,payment_required_at_application,payment_required_before_approval,payment_required_before_payment,allow_third_party_payee,allow_guardian_payee,require_bank_verification,require_supervisor_approval_for_change,require_proof_for_change,cheque_address_required,payment_details_visibility,allow_manual_workbasket_override',
      )
      .eq('product_id', productId)
      .order('entered_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return DEFAULT_PAYMENT_POLICY;
    return {
      ...DEFAULT_PAYMENT_POLICY,
      ...data,
      allowed_payment_methods:
        (data.allowed_payment_methods as BnPaymentMethod[]) ?? DEFAULT_PAYMENT_POLICY.allowed_payment_methods,
      default_payment_method:
        (data.default_payment_method as BnPaymentMethod) ?? DEFAULT_PAYMENT_POLICY.default_payment_method,
      payment_details_visibility:
        (data.payment_details_visibility as any) ?? DEFAULT_PAYMENT_POLICY.payment_details_visibility,
      allow_manual_workbasket_override:
        data.allow_manual_workbasket_override ?? DEFAULT_PAYMENT_POLICY.allow_manual_workbasket_override,
    };
  } catch (e) {
    logShielded('getPaymentPolicy', e);
    return DEFAULT_PAYMENT_POLICY;
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export async function getActiveProfile(
  personSsn: string,
  opts?: { payeeId?: string | null; method?: BnPaymentMethod; currency?: string },
): Promise<BnPaymentProfile | null> {
  let q = db
    .from('bn_payment_profile')
    .select('*')
    .eq('person_ssn', personSsn)
    .eq('active', true)
    .order('effective_from', { ascending: false })
    .limit(1);
  if (opts?.payeeId !== undefined) {
    if (opts.payeeId === null) q = q.is('payee_id', null);
    else q = q.eq('payee_id', opts.payeeId);
  }
  if (opts?.method) q = q.eq('payment_method', opts.method);
  if (opts?.currency) q = q.eq('payment_currency', opts.currency);
  const { data, error } = await q.maybeSingle();
  if (error) logShielded('getActiveProfile', error);
  return (data as BnPaymentProfile) ?? null;
}

export async function getProfileHistory(personSsn: string): Promise<BnPaymentProfile[]> {
  const { data, error } = await db
    .from('bn_payment_profile')
    .select('*')
    .eq('person_ssn', personSsn)
    .order('effective_from', { ascending: false });
  if (error) logShielded('getProfileHistory', error);
  return (data as BnPaymentProfile[]) ?? [];
}

export async function getPendingChangeRequest(
  personSsn: string,
  opts?: { claimId?: string | null },
): Promise<BnPaymentProfileChangeRequest | null> {
  let q = db
    .from('bn_payment_profile_change_request')
    .select('*')
    .eq('person_ssn', personSsn)
    .in('status', ['SUBMITTED', 'UNDER_REVIEW'])
    .order('created_at', { ascending: false })
    .limit(1);
  if (opts?.claimId) q = q.eq('claim_id', opts.claimId);
  const { data, error } = await q.maybeSingle();
  if (error) logShielded('getPendingChangeRequest', error);
  return (data as BnPaymentProfileChangeRequest) ?? null;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
function sanitizeDraft(draft: BnPaymentProfileDraft) {
  const masked = draft.account_number_masked ?? maskAccount((draft as any).account_number ?? null);
  // Never persist raw account number in profile snapshot (only masked + token).
  const { ...rest } = draft as any;
  delete rest.account_number;
  return { ...rest, account_number_masked: masked };
}

export interface SubmitChangeRequestInput {
  personSsn: string;
  payeeId?: string | null;
  channel: BnPaymentChannel;
  draft: BnPaymentProfileDraft;
  policy: BnPaymentPolicy;
  claimId?: string | null;
  entitlementId?: string | null;
  reason?: string;
  proofDocumentIds?: string[];
  userCode?: string;
}

/**
 * Channel-aware submission.
 * - Staff channels with no supervisor approval requirement apply the change immediately
 *   (deactivate old active profile + insert new active profile) and log an APPROVED request.
 * - All other paths insert a SUBMITTED request and leave the active profile untouched.
 */
export async function submitChangeRequest(input: SubmitChangeRequestInput) {
  const userCode = input.userCode || 'SYSTEM';
  const cleaned = sanitizeDraft(input.draft);

  const oldProfile = await getActiveProfile(input.personSsn, {
    payeeId: input.payeeId ?? null,
    method: cleaned.payment_method,
    currency: cleaned.payment_currency ?? 'XCD',
  });

  const staffChannels: BnPaymentChannel[] = ['STAFF_OFFLINE', 'ASSISTED_COUNTER', 'CLAIM_WORKBENCH'];
  const canAutoApply =
    staffChannels.includes(input.channel) && !input.policy.require_supervisor_approval_for_change;

  // Insert request row first (audit trail)
  const { data: req, error: reqErr } = await db
    .from('bn_payment_profile_change_request')
    .insert({
      profile_id: oldProfile?.id ?? null,
      person_ssn: input.personSsn,
      claim_id: input.claimId ?? null,
      entitlement_id: input.entitlementId ?? null,
      requested_by: userCode,
      channel: input.channel,
      old_profile_snapshot: oldProfile ?? null,
      new_profile_snapshot: cleaned,
      status: canAutoApply ? 'APPROVED' : 'SUBMITTED',
      reason: input.reason ?? null,
      proof_document_ids: input.proofDocumentIds ?? [],
      approved_by: canAutoApply ? userCode : null,
      approved_at: canAutoApply ? new Date().toISOString() : null,
    })
    .select('*')
    .single();
  if (reqErr) throw reqErr;

  if (canAutoApply) {
    await applyApprovedRequest(req.id, userCode);
  }
  return req as BnPaymentProfileChangeRequest;
}

async function applyApprovedRequest(requestId: string, userCode: string): Promise<BnPaymentProfile> {
  const { data: req, error } = await db
    .from('bn_payment_profile_change_request')
    .select('*')
    .eq('id', requestId)
    .single();
  if (error || !req) throw error || new Error('Change request not found');

  const draft = req.new_profile_snapshot as BnPaymentProfileDraft;
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);

  // Deactivate the current active profile with the same key, including the
  // one being edited — the unique index allows only one active row per
  // (person, payee, method, currency), so it must be cleared before insert.
  let deactivateQuery = db
    .from('bn_payment_profile')
    .update({ active: false, effective_to: today, modified_by: userCode, modified_at: nowIso })
    .eq('person_ssn', req.person_ssn)
    .eq('payment_method', draft.payment_method)
    .eq('payment_currency', draft.payment_currency ?? 'XCD')
    .eq('active', true);
  const payeeId = draft.payee_id ?? null;
  deactivateQuery = payeeId === null
    ? deactivateQuery.is('payee_id', null)
    : deactivateQuery.eq('payee_id', payeeId);
  const { data: deactivated, error: deactivateErr } = await deactivateQuery.select('id');
  if (deactivateErr) throw deactivateErr;

  // Insert new active profile
  const { data: created, error: insErr } = await db
    .from('bn_payment_profile')
    .insert({
      ...draft,
      person_ssn: req.person_ssn,
      active: true,
      effective_from: today,
      verification_status: draft.verification_status ?? 'UNVERIFIED',
      entered_by: userCode,
    })
    .select('*')
    .single();

  if (insErr) {
    // Insert failed after we deactivated the old profile — restore it so the
    // claimant is never left with zero active payment profiles.
    if (deactivated?.length) {
      try {
        await db
          .from('bn_payment_profile')
          .update({ active: true, effective_to: null, modified_by: userCode, modified_at: new Date().toISOString() })
          .in('id', deactivated.map((d: { id: string }) => d.id));
      } catch (rollbackErr) {
        logShielded('applyApprovedRequest:rollback', rollbackErr);
      }
    }
    if (insErr.code === '23505' || String(insErr.message ?? '').includes('ux_bn_pp_active')) {
      throw new Error('This claimant already has active bank details for this payment method and currency. Please try saving again.');
    }
    throw insErr;
  }

  return created as BnPaymentProfile;
}

export async function approveChangeRequest(requestId: string, userCode = 'SYSTEM') {
  const { error } = await db
    .from('bn_payment_profile_change_request')
    .update({ status: 'APPROVED', approved_by: userCode, approved_at: new Date().toISOString() })
    .eq('id', requestId)
    .in('status', ['SUBMITTED', 'UNDER_REVIEW']);
  if (error) throw error;
  return applyApprovedRequest(requestId, userCode);
}

export async function rejectChangeRequest(requestId: string, reason: string, userCode = 'SYSTEM') {
  const { error } = await db
    .from('bn_payment_profile_change_request')
    .update({ status: 'REJECTED', rejected_reason: reason, approved_by: userCode, approved_at: new Date().toISOString() })
    .eq('id', requestId)
    .in('status', ['SUBMITTED', 'UNDER_REVIEW']);
  if (error) throw error;
}

export async function verifyBank(profileId: string, userCode = 'SYSTEM') {
  const { error } = await db
    .from('bn_payment_profile')
    .update({
      verification_status: 'VERIFIED',
      verified_by: userCode,
      verified_at: new Date().toISOString(),
    })
    .eq('id', profileId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Payable resolution
// ---------------------------------------------------------------------------
export interface ResolvedPayableProfile {
  profile: BnPaymentProfile | null;
  blocked: boolean;
  reason?: string;
}

/**
 * Used by payableValidationService.
 * Returns the verified profile that should fund a payment, or BLOCKED with a reason.
 */
export async function resolveProfileForPayable(args: {
  personSsn: string;
  method: BnPaymentMethod;
  currency?: string;
  productId?: string | null;
  payeeId?: string | null;
}): Promise<ResolvedPayableProfile> {
  const policy = await getPaymentPolicy(args.productId ?? null);
  const profile = await getActiveProfile(args.personSsn, {
    payeeId: args.payeeId ?? null,
    method: args.method,
    currency: args.currency ?? 'XCD',
  });

  if (!profile) {
    return { profile: null, blocked: true, reason: `No active ${args.method} payment profile on file` };
  }

  if (args.method === 'EFT') {
    if (policy.require_bank_verification && profile.verification_status !== 'VERIFIED') {
      return { profile, blocked: true, reason: 'Bank details not verified' };
    }
    if (!profile.bank_code || !profile.account_number_masked) {
      return { profile, blocked: true, reason: 'Incomplete bank details on profile' };
    }
  }

  if (args.method === 'CHEQUE' && policy.cheque_address_required) {
    const addr = profile.postal_address_snapshot;
    if (!addr || !addr.line1) {
      return { profile, blocked: true, reason: 'Postal address required for cheque payment' };
    }
  }

  return { profile, blocked: false };
}
