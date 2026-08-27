// Central Payment Arrangement service — cross-module (Compliance / Legal / Benefits / Finance).
// Uses core_* tables and central numbering (no hardcoded PA-year-count).

import { supabase } from "@/integrations/supabase/client";
import { generateNumber } from "@/services/core/coreNumberingService";
import { getCurrentUserCode } from "@/hooks/useUserCode";
import type {
  CorePaymentArrangement,
  CorePaymentArrangementItem,
  CorePaymentInstallment,
  CorePaymentAllocation,
  ArrangementStatusHistoryRow,
  ArrangementStatus,
  ArrangementSourceModule,
  ArrangementFrequency,
  CreateCoreArrangementInput,
} from "@/types/corePaymentArrangement";

const sb = supabase as any;

function addPeriod(start: string, n: number, freq: ArrangementFrequency): string {
  const d = new Date(start);
  if (freq === "WEEKLY") d.setDate(d.getDate() + n * 7);
  else if (freq === "BIWEEKLY") d.setDate(d.getDate() + n * 14);
  else d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function userCode(): Promise<string> {
  const c = await getCurrentUserCode();
  if (!c) throw new Error("User identity required.");
  return c;
}

// ---------------------------------------------------------------- Reads

export async function listArrangementsByDebtor(
  debtorId: string,
  debtorType: string = "EMPLOYER",
): Promise<CorePaymentArrangement[]> {
  const { data, error } = await sb
    .from("core_payment_arrangement")
    .select("*")
    .eq("debtor_id", debtorId)
    .eq("debtor_type", debtorType)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CorePaymentArrangement[];
}

export async function listArrangementsByLegalCase(legalCaseId: string): Promise<CorePaymentArrangement[]> {
  const { data: items, error } = await sb
    .from("core_payment_arrangement_item")
    .select("arrangement_id")
    .eq("legal_case_id", legalCaseId);
  if (error) throw error;
  const ids = Array.from(new Set((items ?? []).map((r: any) => r.arrangement_id)));
  if (ids.length === 0) return [];
  const { data, error: e2 } = await sb
    .from("core_payment_arrangement")
    .select("*")
    .in("id", ids)
    .order("created_at", { ascending: false });
  if (e2) throw e2;
  return (data ?? []) as CorePaymentArrangement[];
}

export async function listArrangementsByComplianceCase(complianceCaseId: string): Promise<CorePaymentArrangement[]> {
  const { data: items, error } = await sb
    .from("core_payment_arrangement_item")
    .select("arrangement_id")
    .eq("compliance_case_id", complianceCaseId);
  if (error) throw error;
  const ids = Array.from(new Set((items ?? []).map((r: any) => r.arrangement_id)));
  if (ids.length === 0) return [];
  const { data, error: e2 } = await sb
    .from("core_payment_arrangement")
    .select("*")
    .in("id", ids)
    .order("created_at", { ascending: false });
  if (e2) throw e2;
  return (data ?? []) as CorePaymentArrangement[];
}

export async function getArrangement(id: string): Promise<{
  arrangement: CorePaymentArrangement;
  items: CorePaymentArrangementItem[];
  installments: CorePaymentInstallment[];
  allocations: CorePaymentAllocation[];
  history: ArrangementStatusHistoryRow[];
}> {
  const [a, items, inst, alloc, hist] = await Promise.all([
    sb.from("core_payment_arrangement").select("*").eq("id", id).maybeSingle(),
    sb.from("core_payment_arrangement_item").select("*").eq("arrangement_id", id).order("created_at"),
    sb.from("core_payment_schedule_installment").select("*").eq("arrangement_id", id).order("installment_no"),
    sb.from("core_payment_allocation").select("*").eq("arrangement_id", id).order("payment_date"),
    sb.from("core_payment_arrangement_status_history").select("*").eq("arrangement_id", id).order("performed_at"),
  ]);
  if (a.error) throw a.error;
  if (!a.data) throw new Error("Arrangement not found");
  return {
    arrangement: a.data as CorePaymentArrangement,
    items: (items.data ?? []) as CorePaymentArrangementItem[],
    installments: (inst.data ?? []) as CorePaymentInstallment[],
    allocations: (alloc.data ?? []) as CorePaymentAllocation[],
    history: (hist.data ?? []) as ArrangementStatusHistoryRow[],
  };
}

// ---------------------------------------------------------------- Create

export async function createArrangement(input: CreateCoreArrangementInput): Promise<CorePaymentArrangement> {
  const uc = await userCode();

  // Validation: must have at least one item
  if (!input.items?.length) throw new Error("At least one liability item is required.");
  // Validation: legal arrangements must link to legal case or action
  if (
    (input.source_module_created_by === "LEGAL" || String(input.arrangement_type).startsWith("LEGAL_")) &&
    !input.items.some((it) => it.legal_case_id || it.legal_action_id)
  ) {
    throw new Error("Legal arrangements must link to a legal case or legal action.");
  }

  const totalArranged = round2(input.items.reduce((s, it) => s + Number(it.arranged_amount || 0), 0));
  if (totalArranged <= 0) throw new Error("Total arranged amount must be greater than zero.");

  // Block any non-completed arrangement for the same debtor unless superseding.
  // The database trigger trg_core_single_open_arrangement is authoritative; this is pre-flight UX.
  if (!input.superseded_from_arrangement_id) {
    const { data: terminal } = await sb.rpc("ce_arrangement_terminal_statuses");
    const terminalStatuses: string[] = (terminal as string[]) ?? ["COMPLETED", "CANCELLED", "SUPERSEDED"];
    const { data: existingOpen } = await sb
      .from("core_payment_arrangement")
      .select("id, arrangement_no, status")
      .eq("debtor_id", input.debtor_id)
      .eq("debtor_type", input.debtor_type ?? "EMPLOYER")
      .not("status", "in", `(${terminalStatuses.join(",")})`)
      .limit(1)
      .maybeSingle();
    if (existingOpen) {
      throw new Error(
        `Debtor already has a non-completed arrangement (${existingOpen.arrangement_no} — ${existingOpen.status}). Complete, cancel or supersede it before creating a new one.`,
      );
    }
  }

  // Number via central numbering service
  const moduleCode = input.source_module_created_by; // CORE numbering may also be used; we use module-specific.
  const num = await generateNumber({
    moduleCode,
    entityType: "PAYMENT_ARRANGEMENT",
    userCode: uc,
  });

  const numInst = Math.max(1, Number(input.number_of_installments || 1));
  const downPayment = round2(Number(input.down_payment_amount || 0));
  const financeable = round2(totalArranged - downPayment);
  const installmentAmount = round2(financeable / numInst);
  const endDate = addPeriod(input.start_date, numInst - 1, input.frequency);

  // Insert header
  const headerPayload = {
    arrangement_no: num.generatedNumber,
    debtor_type: input.debtor_type ?? "EMPLOYER",
    debtor_id: input.debtor_id,
    debtor_name: input.debtor_name ?? null,
    source_module_created_by: input.source_module_created_by,
    arrangement_type: input.arrangement_type,
    status: "DRAFT" as ArrangementStatus,
    frequency: input.frequency,
    start_date: input.start_date,
    end_date: endDate,
    total_arranged_amount: totalArranged,
    down_payment_amount: downPayment,
    installment_amount: installmentAmount,
    number_of_installments: numInst,
    total_paid: 0,
    outstanding_balance: totalArranged,
    terms_text: input.terms_text ?? null,
    legacy_ce_arrangement_id: input.legacy_ce_arrangement_id ?? null,
    superseded_from_arrangement_id: input.superseded_from_arrangement_id ?? null,
    created_by: uc,
  };

  const { data: head, error: hErr } = await sb
    .from("core_payment_arrangement")
    .insert(headerPayload)
    .select("*")
    .single();
  if (hErr) throw hErr;
  const arrangement = head as CorePaymentArrangement;

  // Items
  const itemRows = input.items.map((it) => ({
    arrangement_id: arrangement.id,
    source_module: it.source_module,
    source_record_type: it.source_record_type,
    source_record_id: it.source_record_id,
    source_reference_no: it.source_reference_no ?? null,
    compliance_case_id: it.compliance_case_id ?? null,
    legal_case_id: it.legal_case_id ?? null,
    legal_action_id: it.legal_action_id ?? null,
    court_proceeding_id: it.court_proceeding_id ?? null,
    benefit_claim_id: it.benefit_claim_id ?? null,
    finance_debt_id: it.finance_debt_id ?? null,
    liability_type: it.liability_type ?? "SS",
    period_from: it.period_from ?? null,
    period_to: it.period_to ?? null,
    principal_amount: it.principal_amount ?? 0,
    penalty_amount: it.penalty_amount ?? 0,
    cost_amount: it.cost_amount ?? 0,
    arranged_amount: it.arranged_amount ?? 0,
    paid_amount: it.paid_amount ?? 0,
    outstanding_amount: (it.outstanding_amount ?? (it.arranged_amount ?? 0)),
    status: it.status ?? "OPEN",
    notes: it.notes ?? null,
    created_by: uc,
  }));
  const { error: iErr } = await sb.from("core_payment_arrangement_item").insert(itemRows);
  if (iErr) {
    await sb.from("core_payment_arrangement").delete().eq("id", arrangement.id);
    throw iErr;
  }

  // Installments
  const instRows: any[] = [];
  for (let i = 0; i < numInst; i++) {
    const amt =
      i === numInst - 1
        ? round2(financeable - installmentAmount * (numInst - 1))
        : installmentAmount;
    instRows.push({
      arrangement_id: arrangement.id,
      installment_no: i + 1,
      due_date: addPeriod(input.start_date, i, input.frequency),
      due_amount: amt,
      paid_amount: 0,
      status: "PLANNED",
    });
  }
  const { error: sErr } = await sb.from("core_payment_schedule_installment").insert(instRows);
  if (sErr) {
    await sb.from("core_payment_arrangement").delete().eq("id", arrangement.id);
    throw sErr;
  }

  // History
  await sb.from("core_payment_arrangement_status_history").insert({
    arrangement_id: arrangement.id,
    from_status: null,
    to_status: "DRAFT",
    source_module: input.source_module_created_by,
    reason: "Arrangement created",
    performed_by: uc,
  });

  return arrangement;
}

// ---------------------------------------------------------------- Lifecycle

export async function setArrangementStatus(
  id: string,
  to: ArrangementStatus,
  reason?: string,
  sourceModule?: ArrangementSourceModule,
): Promise<CorePaymentArrangement> {
  const uc = await userCode();
  const { data: cur, error: cErr } = await sb
    .from("core_payment_arrangement").select("status").eq("id", id).maybeSingle();
  if (cErr) throw cErr;
  if (!cur) throw new Error("Arrangement not found");

  const updates: any = { status: to };
  if (to === "DEFAULTED") updates.default_date = new Date().toISOString().slice(0, 10);
  if (to === "DEFAULTED" && reason) updates.default_reason = reason;
  if (to === "ACTIVE") updates.approved_by = uc;
  if (to === "ACTIVE") updates.approved_at = new Date().toISOString();

  const { data, error } = await sb
    .from("core_payment_arrangement").update(updates).eq("id", id).select("*").single();
  if (error) throw error;

  await sb.from("core_payment_arrangement_status_history").insert({
    arrangement_id: id,
    from_status: cur.status,
    to_status: to,
    source_module: sourceModule ?? null,
    reason: reason ?? null,
    performed_by: uc,
  });
  return data as CorePaymentArrangement;
}

export async function activateArrangement(id: string, reason?: string) {
  return setArrangementStatus(id, "ACTIVE", reason ?? "Approved & activated");
}
export async function markDefault(id: string, reason: string, sourceModule?: ArrangementSourceModule) {
  return setArrangementStatus(id, "DEFAULTED", reason, sourceModule);
}
export async function cancelArrangement(id: string, reason: string) {
  return setArrangementStatus(id, "CANCELLED", reason);
}

/**
 * Create a new arrangement that supersedes an existing one.
 * Old arrangement is marked SUPERSEDED and linked via superseded_by_arrangement_id.
 */
export async function supersedeArrangement(
  oldArrangementId: string,
  newInput: Omit<CreateCoreArrangementInput, "superseded_from_arrangement_id">,
  reason: string,
): Promise<CorePaymentArrangement> {
  const created = await createArrangement({
    ...newInput,
    superseded_from_arrangement_id: oldArrangementId,
  });
  const uc = await userCode();
  await sb
    .from("core_payment_arrangement")
    .update({ status: "SUPERSEDED", superseded_by_arrangement_id: created.id })
    .eq("id", oldArrangementId);
  await sb.from("core_payment_arrangement_status_history").insert({
    arrangement_id: oldArrangementId,
    to_status: "SUPERSEDED",
    source_module: newInput.source_module_created_by,
    reason: `Superseded by ${created.arrangement_no}: ${reason}`,
    performed_by: uc,
  });
  return created;
}

// ---------------------------------------------------------------- Allocation

export async function allocateReceipt(args: {
  arrangementId: string;
  installmentId?: string | null;
  receiptId?: string | null;
  paymentDate: string;
  amountReceived: number;
  allocations: Array<{ itemId: string; amount: number; order?: number }>;
  sourceModule?: ArrangementSourceModule;
  sourceRecordId?: string;
}): Promise<void> {
  const uc = await userCode();
  const totalAlloc = round2(args.allocations.reduce((s, a) => s + Number(a.amount || 0), 0));
  if (round2(totalAlloc) > round2(args.amountReceived)) {
    throw new Error("Allocation total exceeds amount received.");
  }

  // Check outstanding totals for guard
  const { data: items } = await sb
    .from("core_payment_arrangement_item")
    .select("id, outstanding_amount")
    .eq("arrangement_id", args.arrangementId);
  const outstandingByItem = new Map<string, number>(
    (items ?? []).map((i: any) => [i.id, Number(i.outstanding_amount ?? 0)]),
  );
  for (const a of args.allocations) {
    const remaining = outstandingByItem.get(a.itemId) ?? 0;
    if (round2(a.amount) > round2(remaining) + 0.005) {
      throw new Error(`Allocation to item exceeds its outstanding balance (${remaining.toFixed(2)}).`);
    }
  }

  // Insert allocation rows
  const allocRows = args.allocations.map((a, idx) => ({
    arrangement_id: args.arrangementId,
    installment_id: args.installmentId ?? null,
    receipt_id: args.receiptId ?? null,
    payment_date: args.paymentDate,
    amount_received: args.amountReceived,
    allocated_to_item_id: a.itemId,
    allocation_amount: a.amount,
    allocation_order: a.order ?? idx + 1,
    source_module: args.sourceModule ?? null,
    source_record_id: args.sourceRecordId ?? null,
    created_by: uc,
  }));
  const { error: aErr } = await sb.from("core_payment_allocation").insert(allocRows);
  if (aErr) throw aErr;

  // Update item paid/outstanding
  for (const a of args.allocations) {
    const cur = outstandingByItem.get(a.itemId) ?? 0;
    const newOutstanding = round2(cur - a.amount);
    await sb
      .from("core_payment_arrangement_item")
      .update({
        paid_amount: undefined, // computed below via RPC-free upsert
      })
      .eq("id", a.itemId);
    // We don't have a single-update increment; fetch current then write
    const { data: row } = await sb
      .from("core_payment_arrangement_item")
      .select("paid_amount, arranged_amount")
      .eq("id", a.itemId)
      .maybeSingle();
    const newPaid = round2(Number(row?.paid_amount ?? 0) + a.amount);
    const status =
      newOutstanding <= 0.005 ? "PAID" : newPaid > 0 ? "PARTIAL" : "OPEN";
    await sb
      .from("core_payment_arrangement_item")
      .update({ paid_amount: newPaid, outstanding_amount: Math.max(0, newOutstanding), status })
      .eq("id", a.itemId);
  }

  // Update installment paid totals
  if (args.installmentId) {
    const { data: inst } = await sb
      .from("core_payment_schedule_installment")
      .select("paid_amount, due_amount")
      .eq("id", args.installmentId)
      .maybeSingle();
    const newPaid = round2(Number(inst?.paid_amount ?? 0) + totalAlloc);
    const due = Number(inst?.due_amount ?? 0);
    const status = newPaid + 0.005 >= due ? "PAID" : newPaid > 0 ? "PARTIAL" : "DUE";
    await sb
      .from("core_payment_schedule_installment")
      .update({
        paid_amount: newPaid,
        paid_date: status === "PAID" ? args.paymentDate : null,
        status,
      })
      .eq("id", args.installmentId);
  }

  // Update arrangement totals
  const { data: head } = await sb
    .from("core_payment_arrangement")
    .select("total_paid, total_arranged_amount")
    .eq("id", args.arrangementId)
    .maybeSingle();
  const newTotalPaid = round2(Number(head?.total_paid ?? 0) + totalAlloc);
  const newOutstanding = Math.max(0, round2(Number(head?.total_arranged_amount ?? 0) - newTotalPaid));
  const completed = newOutstanding <= 0.005;
  await sb
    .from("core_payment_arrangement")
    .update({
      total_paid: newTotalPaid,
      outstanding_balance: newOutstanding,
      ...(completed ? { status: "COMPLETED" } : {}),
    })
    .eq("id", args.arrangementId);
  if (completed) {
    await sb.from("core_payment_arrangement_status_history").insert({
      arrangement_id: args.arrangementId,
      to_status: "COMPLETED",
      reason: "Outstanding fully paid",
      performed_by: uc,
    });
  }
}

// ---------------------------------------------------------------- Default detection

export function isDefaulted(installments: CorePaymentInstallment[], maxMissed = 2): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const missed = installments.filter(
    (i) => i.status !== "PAID" && i.status !== "WAIVED" && i.due_date < today && (i.paid_amount ?? 0) < i.due_amount,
  ).length;
  return missed >= maxMissed;
}

// ================================================================
// Cross-module standardized API (Compliance / Legal / Benefits / Finance / Employer)
// Wraps primitives with consistent names per the CentralPaymentArrangementPanel
// contract. No method below requires ce_cases unless contextModule = COMPLIANCE.
// ================================================================

export type ContextModule = "COMPLIANCE" | "LEGAL" | "BENEFITS" | "FINANCE" | "EMPLOYER";

export interface SourceRecordRef {
  module: ArrangementSourceModule;
  recordType: "CASE" | "LEGAL_ACTION" | "COURT_PROCEEDING" | "CLAIM" | "OVERPAYMENT" | "DEBT" | "VIOLATION" | "OTHER";
  recordId: string;
  referenceNo?: string | null;
  complianceCaseId?: string | null;
  legalCaseId?: string | null;
  legalActionId?: string | null;
  courtProceedingId?: string | null;
  benefitClaimId?: string | null;
  financeDebtId?: string | null;
}

import type { LiabilityType, ArrangementDebtorType, ArrangementType } from "@/types/corePaymentArrangement";

function ctxToSourceModule(ctx: ContextModule): ArrangementSourceModule {
  if (ctx === "COMPLIANCE") return "COMPLIANCE";
  if (ctx === "LEGAL") return "LEGAL";
  if (ctx === "BENEFITS") return "BENEFITS";
  return "FINANCE";
}

export async function getArrangementsByDebtor(
  debtorId: string,
  debtorType: ArrangementDebtorType = "EMPLOYER",
) {
  return listArrangementsByDebtor(debtorId, debtorType);
}

export async function getArrangementsBySourceRecord(ref: {
  legalCaseId?: string | null;
  legalActionId?: string | null;
  complianceCaseId?: string | null;
  benefitClaimId?: string | null;
  financeDebtId?: string | null;
  courtProceedingId?: string | null;
}): Promise<CorePaymentArrangement[]> {
  let r: any = sb.from("core_payment_arrangement_item").select("arrangement_id");
  if (ref.legalCaseId) r = r.eq("legal_case_id", ref.legalCaseId);
  else if (ref.legalActionId) r = r.eq("legal_action_id", ref.legalActionId);
  else if (ref.complianceCaseId) r = r.eq("compliance_case_id", ref.complianceCaseId);
  else if (ref.benefitClaimId) r = r.eq("benefit_claim_id", ref.benefitClaimId);
  else if (ref.financeDebtId) r = r.eq("finance_debt_id", ref.financeDebtId);
  else if (ref.courtProceedingId) r = r.eq("court_proceeding_id", ref.courtProceedingId);
  else return [];
  const { data: items, error } = await r;
  if (error) throw error;
  const ids = Array.from(new Set((items ?? []).map((x: any) => x.arrangement_id)));
  if (ids.length === 0) return [];
  const { data, error: e2 } = await sb
    .from("core_payment_arrangement").select("*").in("id", ids).order("created_at", { ascending: false });
  if (e2) throw e2;
  return (data ?? []) as CorePaymentArrangement[];
}

export async function createArrangementFromSource(args: {
  contextModule: ContextModule;
  debtorType?: ArrangementDebtorType;
  debtorId: string;
  debtorName?: string | null;
  arrangementType: ArrangementType;
  frequency: ArrangementFrequency;
  startDate: string;
  numberOfInstallments: number;
  downPayment?: number;
  termsText?: string | null;
  sourceRecords: SourceRecordRef[];
  amounts: { principal?: number; penalty?: number; cost?: number; arranged: number; liabilityType?: LiabilityType };
  supersedeFromArrangementId?: string | null;
}): Promise<CorePaymentArrangement> {
  const srcMod = ctxToSourceModule(args.contextModule);
  const sources = args.sourceRecords.length ? args.sourceRecords : [
    { module: srcMod, recordType: "OTHER" as const, recordId: args.debtorId },
  ];
  const items = sources.map((s, idx) => ({
    source_module: s.module,
    source_record_type: s.recordType,
    source_record_id: s.recordId,
    source_reference_no: s.referenceNo ?? null,
    compliance_case_id: s.complianceCaseId ?? null,
    legal_case_id: s.legalCaseId ?? null,
    legal_action_id: s.legalActionId ?? null,
    court_proceeding_id: s.courtProceedingId ?? null,
    benefit_claim_id: s.benefitClaimId ?? null,
    finance_debt_id: s.financeDebtId ?? null,
    liability_type: (args.amounts.liabilityType ?? "SS") as LiabilityType,
    period_from: null,
    period_to: null,
    principal_amount: idx === 0 ? (args.amounts.principal ?? 0) : 0,
    penalty_amount: idx === 0 ? (args.amounts.penalty ?? 0) : 0,
    cost_amount: idx === 0 ? (args.amounts.cost ?? 0) : 0,
    arranged_amount: idx === 0 ? args.amounts.arranged : 0,
    notes: idx === 0 ? null : "Additional source record covered by arrangement",
  }));

  const input: CreateCoreArrangementInput = {
    debtor_type: args.debtorType ?? "EMPLOYER",
    debtor_id: args.debtorId,
    debtor_name: args.debtorName ?? null,
    source_module_created_by: srcMod,
    arrangement_type: args.arrangementType,
    frequency: args.frequency,
    start_date: args.startDate,
    down_payment_amount: args.downPayment ?? 0,
    number_of_installments: args.numberOfInstallments,
    terms_text: args.termsText ?? null,
    superseded_from_arrangement_id: args.supersedeFromArrangementId ?? null,
    items,
  };
  return createArrangement(input);
}

/**
 * Link an existing arrangement to a new source record without inflating totals.
 * Inserts a zero-amount marker item; preserves original source_module on header
 * so "Originated in <Module>" labelling stays accurate.
 */
export async function linkArrangementToSource(
  arrangementId: string,
  ref: SourceRecordRef,
  note?: string,
): Promise<void> {
  const uc = await userCode();
  const { error } = await sb.from("core_payment_arrangement_item").insert({
    arrangement_id: arrangementId,
    source_module: ref.module,
    source_record_type: ref.recordType,
    source_record_id: ref.recordId,
    source_reference_no: ref.referenceNo ?? null,
    compliance_case_id: ref.complianceCaseId ?? null,
    legal_case_id: ref.legalCaseId ?? null,
    legal_action_id: ref.legalActionId ?? null,
    court_proceeding_id: ref.courtProceedingId ?? null,
    benefit_claim_id: ref.benefitClaimId ?? null,
    finance_debt_id: ref.financeDebtId ?? null,
    liability_type: "OTHER",
    principal_amount: 0,
    penalty_amount: 0,
    cost_amount: 0,
    arranged_amount: 0,
    paid_amount: 0,
    outstanding_amount: 0,
    status: "OPEN",
    notes: note ?? "Linked for cross-module monitoring",
    created_by: uc,
  });
  if (error) throw error;
}

export async function recordDefault(
  id: string,
  reason: string,
  contextModule: ContextModule = "LEGAL",
) {
  return markDefault(id, reason, ctxToSourceModule(contextModule));
}

export const applyPaymentAllocation = allocateReceipt;

