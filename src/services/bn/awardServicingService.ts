/**
 * BN Award Servicing Service
 *
 * Single entry point for the award-servicing screens:
 *  - AwardSuspensionConsole
 *  - LifeCertificateManagement
 *  - MedicalReviewScheduler
 *  - OverpaymentRecovery
 *  - SurvivorsBenefitProcessing
 *
 * Wraps the bn_award* tables and resolves claimant names from ip_master.
 * All writes go through here — pages must not call supabase directly.
 */
import { supabase } from '@/integrations/supabase/client';

const db = supabase as any;

// ---------- Types ----------
export interface BnAwardRow {
  id: string;
  award_number: string | null;
  bn_claim_id: string | null;
  bn_product_id: string | null;
  ssn: string;
  benefit_code: string | null;
  award_type: string | null;
  status: string;
  start_date: string;
  end_date: string | null;
  base_amount: number | null;
  currency: string | null;
  frequency: string | null;
  next_review_date: string | null;
  notes: string | null;
  entered_by: string | null;
  entered_at: string;
  modified_by: string | null;
  modified_at: string;
}

export interface BnAwardBeneficiaryRow {
  id: string;
  bn_award_id: string;
  beneficiary_ssn: string | null;
  full_name: string;
  relationship: string | null;
  share_percent: number | null;
  share_amount: number | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  bank_acct: string | null;
  bank_code: string | null;
  notes: string | null;
  entered_at: string;
}

export interface BnLifeCertificateRow {
  id: string;
  bn_award_id: string;
  required_for_period: string | null;
  due_date: string;
  submitted_date: string | null;
  verified_date: string | null;
  verified_by: string | null;
  status: string;
  document_ref: string | null;
  verification_method: string | null;
  remarks: string | null;
  entered_at: string;
}

export interface BnOverpaymentRow {
  id: string;
  bn_award_id: string;
  detected_date: string;
  period_from: string | null;
  period_to: string | null;
  original_amount: number;
  recovered_amount: number | null;
  outstanding_amount: number | null;
  recovery_method: string | null;
  recovery_status: string;
  reason_code: string | null;
  remarks: string | null;
  entered_at: string;
}

export interface BnMedicalReviewRow {
  id: string;
  bn_award_id: string;
  review_type: string | null;
  scheduled_date: string;
  completed_date: string | null;
  outcome: string | null;
  examining_provider: string | null;
  next_review_date: string | null;
  status: string;
  remarks: string | null;
  entered_at: string;
  /** Optimistic-concurrency token required by the governed legacy commands. */
  row_version: number;
}

export interface BnAwardSuspensionEventRow {
  id: string;
  bn_award_id: string;
  suspension_type: string | null;
  suspended_from: string;
  suspended_to: string | null;
  reason_code: string | null;
  reason_text: string | null;
  resumed_at: string | null;
  resumed_by: string | null;
  status: string;
  entered_at: string;
}

export interface ClaimantInfo {
  ssn: string;
  full_name: string;
  dob: string | null;
  date_died: string | null;
}

// ---------- Claimant name resolution ----------
export async function fetchClaimantsBySsns(ssns: string[]): Promise<Record<string, ClaimantInfo>> {
  const unique = Array.from(new Set(ssns.filter(Boolean)));
  if (unique.length === 0) return {};
  const { data, error } = await db
    .from('ip_master')
    .select('ssn, firstname, surname, middle_name, dob, date_died')
    .in('ssn', unique);
  if (error) throw error;
  const map: Record<string, ClaimantInfo> = {};
  (data ?? []).forEach((r: any) => {
    const parts = [r.firstname, r.middle_name, r.surname].filter(Boolean).join(' ').trim();
    map[r.ssn] = {
      ssn: r.ssn,
      full_name: parts || r.ssn,
      dob: r.dob ?? null,
      date_died: r.date_died ?? null,
    };
  });
  return map;
}

// ---------- Awards ----------
export async function fetchAwards(filters?: { status?: string; award_type?: string }): Promise<BnAwardRow[]> {
  let q = db.from('bn_award').select('*').order('entered_at', { ascending: false });
  if (filters?.status) q = q.eq('status', filters.status);
  if (filters?.award_type) q = q.eq('award_type', filters.award_type);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as BnAwardRow[];
}

export async function fetchAwardById(id: string): Promise<BnAwardRow | null> {
  const { data, error } = await db.from('bn_award').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as BnAwardRow | null;
}

export async function updateAwardStatus(
  awardId: string,
  toStatus: string,
  reason: string,
  effectiveDate: string,
  notes: string | null,
  userCode: string | null
): Promise<void> {
  const current = await fetchAwardById(awardId);
  if (!current) throw new Error('Award not found');
  const { error: updErr } = await db
    .from('bn_award')
    .update({ status: toStatus, modified_by: userCode, modified_at: new Date().toISOString() })
    .eq('id', awardId);
  if (updErr) throw updErr;
  const { error: evtErr } = await db.from('bn_award_status_event').insert({
    bn_award_id: awardId,
    from_status: current.status,
    to_status: toStatus,
    event_date: new Date().toISOString(),
    reason_code: reason,
    remarks: notes,
    entered_by: userCode,
  });
  if (evtErr) throw evtErr;

  // Suspension/Resume side-effects
  if (toStatus === 'SUSPENDED') {
    const { error } = await db.from('bn_award_suspension_event').insert({
      bn_award_id: awardId,
      suspension_type: 'MANUAL',
      suspended_from: effectiveDate,
      reason_code: reason,
      reason_text: notes,
      status: 'ACTIVE',
      entered_by: userCode,
    });
    if (error) throw error;
  } else if (toStatus === 'ACTIVE' && current.status === 'SUSPENDED') {
    const { data: open, error: fetchErr } = await db
      .from('bn_award_suspension_event')
      .select('id')
      .eq('bn_award_id', awardId)
      .eq('status', 'ACTIVE')
      .order('entered_at', { ascending: false })
      .limit(1);
    if (fetchErr) throw fetchErr;
    if (open && open.length > 0) {
      const { error } = await db
        .from('bn_award_suspension_event')
        .update({
          status: 'RESUMED',
          resumed_at: new Date().toISOString(),
          resumed_by: userCode,
          suspended_to: effectiveDate,
        })
        .eq('id', open[0].id);
      if (error) throw error;
    }
  }
}

// ---------- Life certificates ----------
// Retired: direct `bn_life_certificate` selects are denied at the database
// boundary. Use `@/services/bn/lifeCertificateViewService` (worklist/detail
// query RPCs) or the award-scoped loaders in `award360Service`.

// Life Certificate mutations were retired from the browser boundary.
// All Life Certificate state changes now run through the versioned server
// commands in `@/services/bn/lifeCertificateCommandService` (receive, verify,
// reject, resubmission, waive, defer, escalate, reinstate). Do not reintroduce
// direct `bn_life_certificate` writes here.

// ---------- Medical reviews ----------
export async function fetchMedicalReviews(): Promise<BnMedicalReviewRow[]> {
  const { data, error } = await db
    .from('bn_medical_review_schedule')
    .select('*')
    .order('scheduled_date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as BnMedicalReviewRow[];
}

// Medical Review mutations were retired from the browser boundary.
// `scheduleMedicalReview` and `recordMedicalReviewOutcome` used to UPDATE
// `bn_medical_review_schedule` directly. `authenticated` no longer holds
// INSERT/UPDATE/DELETE on that table; every state change now runs through the
// versioned server commands exposed by
// `@/services/bn/medicalReviewLegacyScheduleCommands`
// (`bn_medical_review_legacy_schedule_v1`,
//  `bn_medical_review_legacy_record_outcome_v1`,
//  `bn_medical_review_legacy_provision_v1`).
// Do not reintroduce direct `bn_medical_review_schedule` writes here.

// ---------- Overpayments ----------
export async function fetchOverpayments(): Promise<BnOverpaymentRow[]> {
  const { data, error } = await db
    .from('bn_overpayment')
    .select('*')
    .order('detected_date', { ascending: false });
  if (error) throw error;
  return (data ?? []) as BnOverpaymentRow[];
}

// RETIRED (Phase B5): `setOverpaymentRecoveryPlan` performed a direct browser
// UPDATE on `bn_overpayment`. Overpayment state changes now flow exclusively
// through the secured versioned command boundary in
// `@/services/bn/overpayments/overpaymentCommandService`
// (`bn_overpayment_propose_recovery_plan_v1`,
//  `bn_overpayment_approve_recovery_plan_v1`,
//  `bn_overpayment_activate_benefit_deduction_v1`,
//  `bn_overpayment_approve_writeoff_v1`, ...).
// Do not reintroduce direct `bn_overpayment` writes here.

// ---------- Beneficiaries (survivors) ----------
export async function fetchBeneficiariesByAward(awardId: string): Promise<BnAwardBeneficiaryRow[]> {
  const { data, error } = await db
    .from('bn_award_beneficiary')
    .select('*')
    .eq('bn_award_id', awardId)
    .order('share_percent', { ascending: false });
  if (error) throw error;
  return (data ?? []) as BnAwardBeneficiaryRow[];
}

export async function advanceSurvivorAward(
  awardId: string,
  toStatus: string,
  userCode: string | null
): Promise<void> {
  await updateAwardStatus(awardId, toStatus, 'STAGE_ADVANCE', new Date().toISOString().slice(0, 10), null, userCode);
}
