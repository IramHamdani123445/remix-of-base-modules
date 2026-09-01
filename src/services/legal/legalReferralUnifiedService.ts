import { supabase } from "@/integrations/supabase/client";
import { resolveLegalEnterprise } from "@/lib/enterprise/legalEnterpriseMetadata";
import {
  emitLegalInfoRequested,
  emitLegalInfoResponded,
} from "@/platform/omni-comms/integrations/business/legalCommunicationProducer";

const sb = supabase as any;

export type ReferralStatus =
  | "DRAFT" | "SUBMITTED_TO_LEGAL" | "RECEIVED_BY_LEGAL"
  | "INFO_REQUESTED" | "INFO_RESPONDED" | "UNDER_LEGAL_REVIEW"
  | "ACCEPTED" | "LEGAL_CASE_CREATED" | "REJECTED" | "CLOSED";

export type SourceModule = "BENEFITS" | "COMPLIANCE";

export interface LegalReferralRow {
  id: string;
  referral_no: string;
  source_module: SourceModule;
  source_record_type: string | null;
  source_record_id: string | null;
  source_reference_no: string | null;
  primary_entity_type: string | null;
  primary_entity_id: string | null;
  submitted_by: string | null;
  submitted_workbasket_code: string | null;
  submitted_team_code: string | null;
  legal_workbasket_code: string | null;
  legal_team_code: string | null;
  status: ReferralStatus;
  legal_case_id: string | null;
  lg_intake_id: string | null;
  summary: string | null;
  priority_code: string | null;
  exposure_amount: number | null;
  pending_info_request_count: number;
  last_status_at: string;
  created_at: string;
  updated_at: string;
}

export interface InfoRequestRow {
  id: string;
  legal_referral_id: string;
  request_no: string;
  requested_by: string;
  requested_to_module: SourceModule;
  requested_to_workbasket_code: string | null;
  requested_to_team_code: string | null;
  requested_to_user: string | null;
  request_reason: string;
  requested_items: Array<{ key: string; label: string; completed?: boolean }>;
  due_date: string | null;
  status: "PENDING_SOURCE_RESPONSE" | "RESPONDED" | "CANCELLED";
  responded_by: string | null;
  responded_at: string | null;
  response_notes: string | null;
  completion_items: any;
  created_at: string;
  updated_at: string;
}

export interface SourceTaskRow {
  id: string;
  legal_referral_id: string;
  info_request_id: string;
  task_type: string;
  source_module: SourceModule;
  assigned_workbasket_code: string | null;
  assigned_team_code: string | null;
  assigned_user: string | null;
  priority: string | null;
  due_date: string | null;
  status: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  claim_id: string | null;
  insured_person_id: string | null;
  employer_id: string | null;
  compliance_case_id: string | null;
  created_at: string;
}

// -------------------- LIST APIS --------------------

export interface ListReferralFilter {
  source_module?: SourceModule;
  statuses?: ReferralStatus[];
  legal_team_code?: string | null;
  legal_workbasket_code?: string | null;
  submitted_by?: string | null;
  has_pending_info_request?: boolean;
  search?: string;
}

export async function listReferrals(f: ListReferralFilter = {}): Promise<LegalReferralRow[]> {
  let q = sb.from("legal_referral").select("*").order("last_status_at", { ascending: false }).limit(500);
  if (f.source_module) q = q.eq("source_module", f.source_module);
  if (f.statuses?.length) q = q.in("status", f.statuses);
  if (f.legal_team_code) q = q.eq("legal_team_code", f.legal_team_code);
  if (f.legal_workbasket_code) q = q.eq("legal_workbasket_code", f.legal_workbasket_code);
  if (f.submitted_by) q = q.eq("submitted_by", f.submitted_by);
  if (f.has_pending_info_request) q = q.gt("pending_info_request_count", 0);
  if (f.search) q = q.or(`referral_no.ilike.%${f.search}%,source_reference_no.ilike.%${f.search}%,summary.ilike.%${f.search}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as LegalReferralRow[];
}

export async function getReferral(id: string): Promise<LegalReferralRow | null> {
  const { data, error } = await sb.from("legal_referral").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as LegalReferralRow | null;
}

export async function getReferralBySourceId(
  source_module: SourceModule,
  source_id: string
): Promise<LegalReferralRow | null> {
  const col = source_module === "BENEFITS" ? "source_bn_referral_id" : "source_ce_referral_id";
  const { data, error } = await sb.from("legal_referral").select("*").eq(col, source_id).maybeSingle();
  if (error) throw error;
  return data as LegalReferralRow | null;
}

export async function listInfoRequests(legal_referral_id: string): Promise<InfoRequestRow[]> {
  const { data, error } = await sb
    .from("legal_referral_info_request")
    .select("*")
    .eq("legal_referral_id", legal_referral_id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as InfoRequestRow[];
}

export async function listSourceTasks(opts: {
  source_module: SourceModule;
  assigned_user?: string;
  workbasket_codes?: string[];
  statuses?: SourceTaskRow["status"][];
}): Promise<(SourceTaskRow & { referral: LegalReferralRow; info_request: InfoRequestRow })[]> {
  let q = sb
    .from("legal_referral_source_task")
    .select("*, referral:legal_referral(*), info_request:legal_referral_info_request(*)")
    .eq("source_module", opts.source_module)
    .order("created_at", { ascending: false });
  if (opts.assigned_user) q = q.eq("assigned_user", opts.assigned_user);
  if (opts.workbasket_codes?.length) q = q.in("assigned_workbasket_code", opts.workbasket_codes);
  if (opts.statuses?.length) q = q.in("status", opts.statuses);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as any;
}

export async function listAudit(legal_referral_id: string) {
  const { data, error } = await sb
    .from("legal_referral_audit")
    .select("*")
    .eq("legal_referral_id", legal_referral_id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// -------------------- CREATE INFO REQUEST (Legal -> Source) --------------------

export interface CreateInfoRequestInput {
  legal_referral_id: string;
  requested_by: string;
  request_reason: string;
  requested_items: Array<{ key: string; label: string }>;
  due_date?: string | null;
  requested_to_workbasket_code?: string | null;
  requested_to_team_code?: string | null;
  requested_to_user?: string | null;
}

async function resolveSourceRouting(referral: LegalReferralRow, override?: {
  requested_to_workbasket_code?: string | null;
  requested_to_team_code?: string | null;
  requested_to_user?: string | null;
}) {
  if (override?.requested_to_workbasket_code || override?.requested_to_user) {
    return {
      workbasket_code: override.requested_to_workbasket_code ?? referral.submitted_workbasket_code ?? null,
      team_code: override.requested_to_team_code ?? referral.submitted_team_code ?? null,
      user: override.requested_to_user ?? referral.submitted_by ?? null,
    };
  }
  // Prefer original submitter and their workbasket
  if (referral.source_module === "BENEFITS") {
    // try bn_workbasket lookup by basket_code or fallback to a default
    const { data } = await sb.from("bn_workbasket")
      .select("basket_code")
      .eq("is_active", true)
      .limit(1);
    return {
      workbasket_code: referral.submitted_workbasket_code ?? data?.[0]?.basket_code ?? "BN_LEGAL_FOLLOWUP",
      team_code: referral.submitted_team_code ?? null,
      user: referral.submitted_by ?? null,
    };
  } else {
    const { data } = await sb.from("ce_assignment_routing_rules")
      .select("queue_code")
      .eq("is_active", true)
      .limit(1);
    return {
      workbasket_code: referral.submitted_workbasket_code ?? data?.[0]?.queue_code ?? "CE_LEGAL_FOLLOWUP",
      team_code: referral.submitted_team_code ?? null,
      user: referral.submitted_by ?? null,
    };
  }
}

export async function createInfoRequest(input: CreateInfoRequestInput): Promise<InfoRequestRow> {
  // Atomic Postgres RPC: creates info_request + source_task + updates referral.status
  // + mirrors lg_case_intake.intake_status + writes Legal & Source audit. Rolls back on any failure.
  const { data: rpcRaw, error: rpcErr } = await sb.rpc("create_legal_info_request", {
    p_legal_referral_id: input.legal_referral_id,
    p_requested_by: input.requested_by,
    p_request_reason: input.request_reason,
    p_requested_items: input.requested_items ?? [],
    p_due_date: input.due_date ?? null,
    p_workbasket_code: input.requested_to_workbasket_code ?? null,
    p_team_code: input.requested_to_team_code ?? null,
    p_user: input.requested_to_user ?? null,
  });
  if (rpcErr) throw rpcErr;
  const row = Array.isArray(rpcRaw) ? rpcRaw[0] : rpcRaw;
  const infoRequestId: string = row?.info_request_id;
  if (!infoRequestId) throw new Error("Info request was not created");

  const { data: ir, error: irErr } = await sb
    .from("legal_referral_info_request")
    .select("*")
    .eq("id", infoRequestId)
    .single();
  if (irErr) throw irErr;

  // Best-effort fan-out (non-blocking)
  dispatchInfoRequestNotifications(infoRequestId).catch((e) =>
    console.warn("Notification dispatch failed (non-blocking):", e)
  );

  return ir as InfoRequestRow;
}

export async function dispatchInfoRequestNotifications(infoRequestId: string) {
  const { data: ir } = await sb
    .from("legal_referral_info_request")
    .select("*, referral:legal_referral(*)")
    .eq("id", infoRequestId)
    .maybeSingle();
  if (!ir) return;
  const referral = ir.referral as LegalReferralRow;
  const routing = {
    user: ir.requested_to_user as string | null,
    workbasket_code: ir.requested_to_workbasket_code as string | null,
  };
  try {
    // Resolve enterprise context once per dispatch so notification copy uses
    // the configured organization / department / sender / signature / footer.
    const enterprise = await resolveLegalEnterprise({
      matterId: referral.id,
      matterKind: "LEGAL_REFERRAL",
    });
    const ent = enterprise.notification;

    // Resolve target user_id (auth) by user_code if possible
    let userId: string | null = null;
    if (routing.user) {
      const { data: prof } = await sb.from("profiles")
        .select("user_id")
        .eq("user_code", routing.user)
        .maybeSingle();
      userId = prof?.user_id ?? null;
    }
    // Compatibility record ONLY — the governed Hub emission below is
    // evaluate-only until Legal is certified for live delivery. Retired as
    // soon as Legal in-app delivery goes live in the Hub.
    if (userId) {
      await sb.from("in_app_notifications").insert({
        user_id: userId,
        title: `${ent.department_name || "Legal"} info request: ${referral.referral_no}`,
        body: ir.request_reason + (ir.due_date ? ` (due ${ir.due_date})` : ""),
        notification_type: "action_required",
        priority: "high",
        module: referral.source_module,
        related_record_id: referral.id,
        link: referral.source_module === "BENEFITS"
          ? `/bn/legal-referrals/respond/${ir.id}`
          : `/compliance/legal-referrals/respond/${ir.id}`,
        metadata: {
          referral_no: referral.referral_no,
          info_request_no: ir.request_no,
          organization_id: enterprise.metadata.organization_id,
          organization_name: enterprise.metadata.organization_name,
          department_id: enterprise.metadata.department_id,
          department_code: enterprise.metadata.department_code,
          department_name: enterprise.metadata.department_name,
          module_code: enterprise.metadata.module_code,
        },
      });
    }
    // Governed leg: the Hub owns template, branding, sender and delivery.
    if (routing.user) {
      const { data: prof } = await sb.from("profiles")
        .select("email,full_name")
        .eq("user_code", routing.user)
        .maybeSingle();
      await emitLegalInfoRequested({
        infoRequestId: ir.id,
        legalReferralId: referral.id,
        referralNo: referral.referral_no,
        requestNo: ir.request_no,
        sourceModule: referral.source_module,
        sourceReferenceNo: referral.source_reference_no,
        requestReason: ir.request_reason,
        requestedItems: ir.requested_items.map((i) => i.label).join(", "),
        dueDate: ir.due_date ?? null,
        responseLink: `/${referral.source_module === "BENEFITS" ? "bn" : "compliance"}/legal-referrals/respond/${ir.id}`,
        recipient: {
          userId,
          displayName: prof?.full_name ?? null,
          email: prof?.email ?? null,
        },
        organizationId: enterprise.metadata.organization_id ?? null,
        departmentId: enterprise.metadata.department_id ?? null,
      });
    }
  } catch (e) {
    console.warn("Notification dispatch failed (non-blocking):", e);
  }
}

// -------------------- RESPOND TO INFO REQUEST (Source -> Legal) --------------------

export interface RespondInfoRequestInput {
  info_request_id: string;
  responded_by: string;
  response_notes: string;
  completion_items?: Array<{ key: string; completed: boolean; note?: string }>;
  document_links?: Array<{
    dms_document_id?: string | null;
    dms_file_id?: string | null;
    storage_bucket?: string | null;
    storage_path?: string | null;
    file_name?: string | null;
    mime_type?: string | null;
    document_source?: string;
  }>;
}

export async function respondInfoRequest(input: RespondInfoRequestInput) {
  const { data: ir, error: irErr } = await sb
    .from("legal_referral_info_request")
    .select("*, referral:legal_referral(*)")
    .eq("id", input.info_request_id)
    .single();
  if (irErr) throw irErr;
  if (ir.status !== "PENDING_SOURCE_RESPONSE") throw new Error("Info request is not pending");

  await sb.from("legal_referral_info_request")
    .update({
      status: "RESPONDED",
      responded_by: input.responded_by,
      responded_at: new Date().toISOString(),
      response_notes: input.response_notes,
      completion_items: input.completion_items ?? null,
    })
    .eq("id", input.info_request_id);

  if (input.document_links?.length) {
    await sb.from("legal_referral_document_link").insert(
      input.document_links.map((d) => ({
        legal_referral_id: ir.legal_referral_id,
        info_request_id: input.info_request_id,
        dms_document_id: d.dms_document_id ?? null,
        dms_file_id: d.dms_file_id ?? null,
        storage_bucket: d.storage_bucket ?? null,
        storage_path: d.storage_path ?? null,
        file_name: d.file_name ?? null,
        mime_type: d.mime_type ?? null,
        source_module: ir.referral.source_module,
        document_source: d.document_source ?? "NEW_UPLOAD",
        linked_by: input.responded_by,
      }))
    );
  }

  await sb.from("legal_referral")
    .update({ status: "INFO_RESPONDED", last_status_at: new Date().toISOString() })
    .eq("id", ir.legal_referral_id);

  await sb.from("legal_referral_source_task")
    .update({ status: "COMPLETED", completed_by: input.responded_by, completed_at: new Date().toISOString() })
    .eq("info_request_id", input.info_request_id);

  // Mirror response state to lg_case_intake so the Legal Matter Intake list
  // visibly switches from "INFO REQUESTED" -> "INFO RESPONDED".
  if (ir.referral.lg_intake_id) {
    await sb.from("lg_case_intake")
      .update({ intake_status: "INFO_RESPONDED" })
      .eq("id", ir.referral.lg_intake_id)
      .eq("intake_status", "INFO_REQUESTED");
  }

  await sb.from("legal_referral_audit").insert({
    legal_referral_id: ir.legal_referral_id,
    info_request_id: input.info_request_id,
    event_code: "INFO_RESPONDED",
    event_module: ir.referral.source_module,
    actor: input.responded_by,
    notes: input.response_notes,
    metadata: { document_count: input.document_links?.length ?? 0 },
  });

  // Notify legal user
  try {
    const enterprise = await resolveLegalEnterprise({
      matterId: ir.legal_referral_id,
      matterKind: "LEGAL_REFERRAL",
    });
    const ent = enterprise.notification;
    if (ir.requested_by) {
      const { data: prof } = await sb.from("profiles")
        .select("user_id,email")
        .eq("user_code", ir.requested_by)
        .maybeSingle();
      if (prof?.user_id) {
        await sb.from("in_app_notifications").insert({
          user_id: prof.user_id,
          title: `Response on ${ir.referral.referral_no}`,
          body: `${ir.referral.source_module} submitted requested information.`,
          notification_type: "informational",
          module: "LEGAL",
          related_record_id: ir.legal_referral_id,
          link: `/legal/intake/${ir.referral.lg_intake_id ?? ir.legal_referral_id}`,
          metadata: {
            organization_id: enterprise.metadata.organization_id,
            organization_name: enterprise.metadata.organization_name,
            department_id: enterprise.metadata.department_id,
            department_code: enterprise.metadata.department_code,
            department_name: enterprise.metadata.department_name,
            module_code: enterprise.metadata.module_code,
          },
        });
      }
      await emitLegalInfoResponded({
        infoRequestId: input.info_request_id,
        legalReferralId: ir.legal_referral_id,
        referralNo: ir.referral.referral_no,
        sourceModule: ir.referral.source_module,
        responseNotes: input.response_notes,
        reviewLink: `/legal/intake/${ir.referral.lg_intake_id ?? ir.legal_referral_id}`,
        recipient: {
          userId: prof?.user_id ?? null,
          email: prof?.email ?? null,
        },
        organizationId: enterprise.metadata.organization_id ?? null,
        departmentId: enterprise.metadata.department_id ?? null,
      });
    }
  } catch (e) {
    console.warn("Response notification failed:", e);
  }

  return { ok: true };
}

// -------------------- LEGAL DECISIONS --------------------

export async function updateReferralStatus(
  legal_referral_id: string,
  status: ReferralStatus,
  actor: string,
  notes?: string
) {
  await sb.from("legal_referral")
    .update({ status, last_status_at: new Date().toISOString() })
    .eq("id", legal_referral_id);
  await sb.from("legal_referral_audit").insert({
    legal_referral_id,
    event_code: `STATUS_${status}`,
    event_module: "LEGAL",
    actor,
    notes: notes ?? null,
  });
}

export async function listDocumentLinks(legal_referral_id: string) {
  const { data, error } = await sb
    .from("legal_referral_document_link")
    .select("*")
    .eq("legal_referral_id", legal_referral_id)
    .order("linked_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
