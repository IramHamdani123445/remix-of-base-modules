/**
 * Compliance → Legal forwarding service
 * --------------------------------------
 * The controlled two-phase hand-off (no uncontrolled shortcut exists):
 *
 *   PHASE 1 — createComplianceLegalReferral()
 *     1. Generate Compliance Legal Referral No (CMP-LR-SKN-{YYYY}-{SEQ}).
 *     2. Insert the source-of-truth record into `ce_legal_referrals` as DRAFT.
 *     3. Attach selected referral items + supporting documents.
 *     4. Stamp `ce_cases.lg_referral_no` only — the case is NOT escalated yet.
 *
 *   (legal pack checklist + `legal.escalation_approval` approval happen in
 *    src/services/compliance/legalEscalationFlow.ts)
 *
 *   PHASE 2 — submitReferralToLegal()
 *     5. Requires status APPROVED_FOR_SUBMISSION.
 *     6. Generate Legal Intake No (LG-INT-SKN-{YYYY}-{SEQ}) and create the
 *        `lg_case_intake` row (status = PENDING_REVIEW).
 *     7. Stamp `ce_cases` with intake ids and set status ESCALATED_LEGAL.
 *     8. Legal case is created later, when Legal accepts the intake via
 *        `lgIntakeService.acceptAndCreateCase`.
 */

import { supabase } from "@/integrations/supabase/client";
import { generateNumber } from "@/services/core/coreNumberingService";
import { createIntake } from "@/services/legal/lgIntakeService";
import {
  insertReferralItems,
  type ReferralItemDraft,
} from "@/services/legal/coreLegalReferralItemService";
import {
  insertReferralDocuments,
  type ReferralDocumentDraft,
} from "@/services/legal/coreLegalReferralDocumentService";
import {
  triggerLgWorkflow,
  LG_WORKFLOW_MODULES,
} from "@/services/legal/lgWorkflowIntegrationService";
import {
  REFERRAL_STATUS,
  ACTIVE_REFERRAL_STATUSES,
} from "@/services/compliance/legalEscalationFlow";

const sb = supabase as any;

export interface ForwardComplianceCaseInput {
  ce_case_id: string;
  referral_reason: string;
  referral_reason_code?: string | null;
  priority_code?: string;
  payment_arrangement_id?: string | null;
  user_code?: string | null;
  notify_team_code?: string | null;
  /** Where the referral was raised from, for traceability. */
  created_via?: string | null;
  /** Selected items to refer — empty array means "refer entire case balance". */
  items?: ReferralItemDraft[];
  /** Selected/uploaded documents to attach to the referral packet. */
  documents?: ReferralDocumentDraft[];
}


export interface CreateComplianceReferralResult {
  /**
   * PENDING_APPROVAL — a recommendation was submitted and is waiting for
   * management; no referral exists yet. PREPARED — the approved referral
   * packet was populated and is now in Legal Pack Preparation.
   */
  stage: "PENDING_APPROVAL" | "PREPARED";
  recommendation_id?: string;
  referral_id: string | null;
  referral_no: string | null;
  items_count: number;
  documents_count: number;
  total_referred_amount: number;
  status: string;
}

export interface SubmitReferralResult {
  referral_id: string;
  referral_no: string;
  lg_intake_id: string;
  lg_intake_no: string;
}

/**
 * PHASE 1 — prepare a referral through the governed lifecycle.
 *
 * "Refer to Legal" can no longer create a referral: when the case has no
 * management-approved recommendation this submits one (ce_recommend_legal_v1)
 * and stops. Only once management approves does a referral exist, and this
 * function then fills its pack (items + documents).
 */
export async function createComplianceLegalReferral(
  input: ForwardComplianceCaseInput,
): Promise<CreateComplianceReferralResult> {
  const { data: ceCase, error: ceErr } = await sb
    .from("ce_cases")
    .select("*")
    .eq("id", input.ce_case_id)
    .maybeSingle();
  if (ceErr) throw ceErr;
  if (!ceCase) throw new Error("Compliance case not found");
  if (ceCase.lg_intake_id || ceCase.legal_case_id) {
    throw new Error("This compliance case has already been forwarded to Legal");
  }

  // Guard against uq_ce_legal_ref_source_active: an active referral on the same
  // source case would raise a raw unique-violation. Surface it early.
  const { data: existingActive } = await sb
    .from("ce_legal_referrals")
    .select("id, referral_number, status")
    .eq("source_case_id", input.ce_case_id)
    .in("status", ACTIVE_REFERRAL_STATUSES as unknown as string[])
    .maybeSingle();

  const outstanding =
    Number((ceCase as any).total_amount ?? 0) -
    Number((ceCase as any).amount_collected ?? 0) -
    Number((ceCase as any).amount_waived ?? 0);

  // 1. Governance gate — a referral must originate from an approved
  //    recommendation. Without one we submit the recommendation and stop.
  const approved = await findApprovedRecommendation(input.ce_case_id);
  if (!approved) {
    const rec = await recommendLegal({
      employerId: ceCase.employer_id ?? "UNKNOWN",
      caseId: input.ce_case_id,
      reason: input.referral_reason,
      entryPath: (input.created_via as any) === "QUICK_FORWARD" ? "QUICK_FORWARD" : "REFER_TO_LEGAL",
    });
    return {
      stage: "PENDING_APPROVAL",
      recommendation_id: rec.recommendation_id,
      referral_id: null,
      referral_no: null,
      items_count: 0,
      documents_count: 0,
      total_referred_amount: outstanding,
      status: "PENDING_APPROVAL",
    };
  }

  // 2. The approved recommendation already carries its referral shell, created
  //    by ce_approve_legal_referral_v1 in DRAFT (Legal Pack Preparation).
  const ref = existingActive?.id
    ? { id: existingActive.id, referral_number: existingActive.referral_number }
    : approved.legal_referral_id
      ? await (async () => {
          const { data, error } = await sb
            .from("ce_legal_referrals")
            .select("id, referral_number")
            .eq("id", approved.legal_referral_id)
            .single();
          if (error) throw error;
          return data;
        })()
      : null;
  if (!ref) {
    throw new Error(
      "The approved recommendation has no referral packet. Re-approve it from the Legal Recommendation Queue.",
    );
  }
  const refNo = { generatedNumber: ref.referral_number as string };


  // 3. Referral items. Header totals are auto-synced by core_lri_sync_header_totals.
  const insertedItems = await insertReferralItems(
    ref.id,
    "COMPLIANCE",
    (input.items ?? []).map((it) => ({
      ...it,
      debtor_type: it.debtor_type ?? "EMPLOYER",
      debtor_id: it.debtor_id ?? ceCase.employer_id ?? null,
      debtor_name: it.debtor_name ?? ceCase.employer_name ?? null,
      referral_reason_code: it.referral_reason_code ?? input.referral_reason_code ?? null,
    })),
    input.user_code ?? null,
  );

  const totalReferred = insertedItems.reduce((s, x) => s + Number(x.amount_referred ?? 0), 0);
  const referredSnapshot = insertedItems.length ? totalReferred : outstanding;

  // 4. Supporting documentation (inspector notes, notices, arrangements, etc.)
  const insertedDocs = await insertReferralDocuments(
    ref.id,
    (input.documents ?? []).map((d) => ({ ...d, source_module: "COMPLIANCE" })),
    input.user_code ?? null,
  );

  // 5. Stamp the case with the referral number only — no escalation yet.
  await sb
    .from("ce_cases")
    .update({ lg_referral_no: refNo.generatedNumber, updated_by: input.user_code ?? null })
    .eq("id", input.ce_case_id);

  sb.from("system_audit_trail")
    .insert({
      module: "COMPLIANCE_TO_LEGAL",
      action: "LEGAL_REFERRAL_CREATED",
      entity_type: "ce_legal_referral",
      entity_id: ref.id,
      severity: "info",
      user_name: input.user_code ?? null,
      payload_json: {
        ce_case_id: input.ce_case_id,
        ce_case_number: ceCase.case_number,
        referral_no: refNo.generatedNumber,
        created_via: input.created_via ?? "REFERRAL_WIZARD",
        outstanding_snapshot: outstanding,
        referred_snapshot: referredSnapshot,
        items_count: insertedItems.length,
        documents_count: insertedDocs.length,
        referral_reason: input.referral_reason,
      },
    })
    .then(() => undefined, () => undefined);

  return {
    referral_id: ref.id,
    referral_no: refNo.generatedNumber,
    items_count: insertedItems.length,
    documents_count: insertedDocs.length,
    total_referred_amount: referredSnapshot,
    status: REFERRAL_STATUS.DRAFT,
  };
}

/**
 * PHASE 2 — hand an APPROVED referral over to Legal. This is the only code path
 * that creates a Legal intake and escalates the compliance case.
 */
export async function submitReferralToLegal(
  referralId: string,
  userCode: string | null,
): Promise<SubmitReferralResult> {
  const { data: ref, error: refErr } = await sb
    .from("ce_legal_referrals")
    .select("*")
    .eq("id", referralId)
    .single();
  if (refErr) throw refErr;
  if (ref.status !== REFERRAL_STATUS.APPROVED_FOR_SUBMISSION) {
    throw new Error(
      `Referral ${ref.referral_number} cannot be submitted from status ${ref.status}. It must be approved first.`,
    );
  }
  if (ref.lg_intake_id) {
    throw new Error(`Referral ${ref.referral_number} has already been submitted (intake ${ref.lg_intake_no}).`);
  }

  const { data: ceCase } = await sb
    .from("ce_cases")
    .select("*")
    .eq("id", ref.source_case_id)
    .maybeSingle();

  const outstanding =
    Number(ceCase?.total_amount ?? ref.grand_total ?? 0) -
    Number(ceCase?.amount_collected ?? 0) -
    Number((ceCase as any)?.amount_waived ?? 0);
  const referredSnapshot = Number(ref.total_referred_amount ?? 0) || outstanding;

  const { data: pa } = await sb
    .from("ce_payment_arrangements")
    .select("id")
    .eq("case_id", ref.source_case_id)
    .in("status", ["ACTIVE", "DRAFT", "DEFAULTED"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const intake = await createIntake({
    source_module: "COMPLIANCE",
    source_type: "COMPLIANCE_CASE",
    source_record_id: ref.source_case_id,
    source_reference_no: ref.referral_number,
    matter_type_code: "CONTRIBUTION_RECOVERY",
    recommended_case_type_code: "NON_COMPLIANCE",
    primary_entity_type: ref.employer_id ? "EMPLOYER" : "COMPLIANCE_CASE",
    primary_entity_id: ref.employer_id ? null : ref.source_case_id,
    legacy_primary_entity_name: ref.employer_name ?? null,
    summary: `Forwarded from Compliance case ${ceCase?.case_number ?? ref.source_reference_no}. ${
      ref.referral_reason_text ?? ""
    }`.slice(0, 2000),
    exposure_amount: Number.isFinite(referredSnapshot) ? referredSnapshot : null,
    priority_code: mapPriority(ceCase?.priority),
    intake_status: "PENDING_REVIEW",
    submitted_by: userCode ?? null,
    recommended_team_code: "LEGAL_INTAKE",
    payload: {
      ce_case_id: ref.source_case_id,
      ce_case_number: ceCase?.case_number ?? null,
      ce_referral_id: ref.id,
      ce_referral_no: ref.referral_number,
      payment_arrangement_id: pa?.id ?? null,
      outstanding_snapshot: outstanding,
      referred_amount: referredSnapshot,
      retained_amount: Math.max(0, outstanding - referredSnapshot),
      items_count: ref.items_count ?? 0,
      approved_by: ref.approved_by,
      approved_at: ref.approved_at,
      referral_reason: ref.referral_reason_text,
    },
  });

  await sb
    .from("ce_legal_referrals")
    .update({
      lg_intake_id: intake.id,
      lg_intake_no: intake.intake_no,
      status: REFERRAL_STATUS.SUBMITTED_TO_LEGAL,
      submitted_date: new Date().toISOString(),
      updated_by: userCode,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ref.id);

  await sb
    .from("ce_cases")
    .update({
      lg_intake_id: intake.id,
      lg_intake_no: intake.intake_no,
      lg_referral_no: ref.referral_number,
      status: "ESCALATED_LEGAL",
      updated_by: userCode,
    })
    .eq("id", ref.source_case_id);

  sb.from("system_audit_trail")
    .insert({
      module: "COMPLIANCE_TO_LEGAL",
      action: "LEGAL_REFERRAL_SUBMITTED",
      entity_type: "ce_legal_referral",
      entity_id: ref.id,
      severity: "info",
      user_name: userCode,
      payload_json: {
        ce_case_id: ref.source_case_id,
        referral_no: ref.referral_number,
        lg_intake_id: intake.id,
        lg_intake_no: intake.intake_no,
        approved_by: ref.approved_by,
      },
    })
    .then(() => undefined, () => undefined);

  triggerLgWorkflow({
    sourceModule: LG_WORKFLOW_MODULES.INTAKE,
    entityId: intake.id,
    entityName: intake.intake_no ?? intake.id,
    actionName: "submit",
    userId: userCode ?? "system",
    lgCaseId: null,
    metadata: { origin: "COMPLIANCE", ce_case_id: ref.source_case_id, ce_referral_id: ref.id },
  }).catch((err) => console.warn("[compliance-forwarding] workflow trigger failed", err));

  return {
    referral_id: ref.id,
    referral_no: ref.referral_number,
    lg_intake_id: intake.id,
    lg_intake_no: intake.intake_no,
  };
}



function mapPriority(p?: string | null): string {
  switch ((p ?? "").toUpperCase()) {
    case "URGENT":
    case "CRITICAL":
      return "URGENT";
    case "HIGH":
      return "HIGH";
    case "LOW":
      return "LOW";
    default:
      return "MEDIUM";
  }
}
