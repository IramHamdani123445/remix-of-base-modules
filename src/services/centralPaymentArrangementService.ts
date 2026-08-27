// ============================================
// CENTRAL PAYMENT ARRANGEMENT SERVICE - DB-BACKED
// ============================================

import { supabase } from '@/integrations/supabase/client';
import {
  PaymentArrangement,
  PaymentArrangementItem,
  PaymentScheduleInstallment,
  CreateArrangementRequest,
  ArrangementStatus,
  InstallmentStatus,
  EmployerDuesSummary,
  ArrangementSummary,
  ArrangementSourceModule
} from '@/types/centralPaymentArrangement';
import { getCurrentUserCode } from '@/hooks/useUserCode';
import { isComplianceDbFlagEnabled } from '@/lib/compliance/featureToggles';
import { assertNoOpenArrangement, translateArrangementCreationError } from '@/services/compliance/arrangementConcurrencyService';

function assertArrangementEnabled() {
  if (!isComplianceDbFlagEnabled('compliance.payment.arrangement')) {
    throw new Error('Payment Arrangement is disabled in Setup → Feature Toggles.');
  }
}

async function requireUserCode(): Promise<string> {
  const code = await getCurrentUserCode();
  if (!code) throw new Error('User identity required: no user_code resolved for the current session.');
  return code;
}

function calculateDueDate(startDate: string, periodOffset: number, frequency: string): string {
  const date = new Date(startDate);
  switch (frequency) {
    case 'WEEKLY': date.setDate(date.getDate() + (periodOffset * 7)); break;
    case 'BIWEEKLY': date.setDate(date.getDate() + (periodOffset * 14)); break;
    case 'MONTHLY': date.setMonth(date.getMonth() + periodOffset); break;
  }
  return date.toISOString().split('T')[0];
}

function mapRow(row: any): PaymentArrangement {
  return {
    id: row.id,
    arrangementNumber: row.arrangement_number,
    employerId: row.employer_id,
    employerName: row.employer_name ?? '',
    versionNumber: 1,
    status: (row.status ?? 'DRAFT') as ArrangementStatus,
    arrangementSourceModule: ArrangementSourceModule.COMPLIANCE,
    arrangementType: 'VOLUNTARY_PLAN' as any,
    startDate: row.start_date,
    plannedEndDate: row.end_date ?? undefined,
    totalArrangedAmount: Number(row.total_debt ?? 0),
    totalPaidAmount: Number(row.total_paid ?? 0),
    outstandingBalance: Number(row.total_debt ?? 0) - Number(row.total_paid ?? 0),
    createdByUserId: row.created_by ?? '',
    createdByName: row.created_by ?? '',
    createdAt: row.created_at,
    approvedByUserId: row.approved_by ?? undefined,
    approvedByName: row.approved_by ?? undefined,
    approvedAt: row.approved_at ?? undefined,
    notes: row.terms_text ?? undefined,
    items: [],
    installments: [],
  };
}

// ============================================
// Case-Driven Arrangement Creation Request
// ============================================
export interface CreateArrangementFromCaseRequest {
  caseId: string;
  caseNumber: string;
  employerId: string;
  employerName: string;
  totalDebtFromCase: number;
  downPayment: number;
  numberOfInstallments: number;
  frequency: string;
  startDate: string;
  terms?: string;
  notes?: string;
}

class CentralPaymentArrangementService {
  /**
   * Case-driven arrangement creation — the primary creation path.
   * Validates case ownership, creates arrangement + installments,
   * transitions case status, and records case history.
   */
  async createArrangementFromCase(request: CreateArrangementFromCaseRequest): Promise<PaymentArrangement> {
    assertArrangementEnabled();
    const userCode = await requireUserCode();

    // 1. Validate the case exists, belongs to the employer, and has an officer assigned
    const { data: caseRow, error: caseErr } = await supabase
      .from('ce_cases')
      .select('id, employer_id, employer_name, total_amount, amount_collected, status, case_number, assigned_officer_id, assigned_officer_name')
      .eq('id', request.caseId)
      .single();

    if (caseErr || !caseRow) throw new Error('Case not found');
    if (caseRow.employer_id !== request.employerId) {
      throw new Error('Employer does not match the selected case');
    }
    if (!caseRow.assigned_officer_id) {
      throw new Error('Assign an officer to this case before creating a payment arrangement. Arrangements must be negotiated by the assigned officer.');
    }

    const caseOutstanding = Number(caseRow.total_amount ?? 0) - Number(caseRow.amount_collected ?? 0);
    if (caseOutstanding <= 0) {
      throw new Error('Case has no outstanding balance to arrange');
    }
    if (request.totalDebtFromCase > caseOutstanding) {
      throw new Error(`Arranged amount (${request.totalDebtFromCase}) exceeds case outstanding balance (${caseOutstanding})`);
    }

    // 2. Concurrent-arrangement protection (pre-flight; database trigger is authoritative)
    await assertNoOpenArrangement(request.employerId);

    // 3. Generate arrangement number
    const year = new Date().getFullYear();
    const { count } = await supabase.from('ce_payment_arrangements').select('id', { count: 'exact', head: true });
    const arrangementNumber = `PA-${year}-${String((count ?? 0) + 1).padStart(4, '0')}`;

    // 4. Calculate installment schedule
    const financeableAmount = request.totalDebtFromCase - request.downPayment;
    const installmentAmount = financeableAmount / request.numberOfInstallments;
    const endDate = calculateDueDate(request.startDate, request.numberOfInstallments - 1, request.frequency);
    const nextDueDate = request.startDate;

    // 5. Insert arrangement
    const { data: arrData, error: arrErr } = await supabase
      .from('ce_payment_arrangements')
      .insert({
        arrangement_number: arrangementNumber,
        case_id: request.caseId,
        employer_id: request.employerId,
        employer_name: request.employerName,
        status: 'DRAFT',
        total_debt: request.totalDebtFromCase,
        down_payment: request.downPayment,
        installment_amount: Number(installmentAmount.toFixed(2)),
        number_of_installments: request.numberOfInstallments,
        frequency: request.frequency,
        start_date: request.startDate,
        end_date: endDate,
        next_due_date: nextDueDate,
        total_paid: 0,
        installments_paid: 0,
        terms_text: request.terms ?? null,
        created_by: userCode,
        updated_by: userCode,
      })
      .select('*')
      .single();

    if (arrErr) throw await translateArrangementCreationError(arrErr, request.employerId);

    // 6. Generate installment rows in ce_installments
    const installmentRows = [];
    for (let i = 0; i < request.numberOfInstallments; i++) {
      const dueDate = calculateDueDate(request.startDate, i, request.frequency);
      // Last installment absorbs rounding difference
      const amt = i === request.numberOfInstallments - 1
        ? Number((financeableAmount - installmentAmount * (request.numberOfInstallments - 1)).toFixed(2))
        : Number(installmentAmount.toFixed(2));

      installmentRows.push({
        arrangement_id: arrData.id,
        installment_number: i + 1,
        amount: amt,
        due_date: dueDate,
        status: 'PLANNED',
        paid_amount: 0,
      });
    }

    const { error: instErr } = await supabase
      .from('ce_installments')
      .insert(installmentRows);

    if (instErr) {
      console.error('Failed to create installments:', instErr);
      // Rollback arrangement
      await supabase.from('ce_payment_arrangements').delete().eq('id', arrData.id);
      throw new Error('Failed to create installment schedule');
    }

    // 7. Update case status to PAYMENT_ARRANGEMENT stage
    const previousStatus = caseRow.status;
    await supabase
      .from('ce_cases')
      .update({
        status: 'CSTG_PAYMENT_ARRANGEMENT_ACTIVE',
        updated_by: userCode,
        updated_at: new Date().toISOString(),
      })
      .eq('id', request.caseId);

    // 8. Insert case history record
    await supabase
      .from('ce_case_history')
      .insert({
        case_id: request.caseId,
        action: 'PAYMENT_ARRANGEMENT_CREATED',
        from_status: previousStatus,
        to_status: 'CSTG_PAYMENT_ARRANGEMENT_ACTIVE',
        performed_by: userCode,
        notes: `Payment arrangement ${arrangementNumber} created for ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'XCD' }).format(request.totalDebtFromCase)}. ${request.numberOfInstallments} ${request.frequency.toLowerCase()} installments of ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'XCD' }).format(installmentAmount)}.`,
        performed_at: new Date().toISOString(),
      });

    return mapRow(arrData);
  }

  /**
   * Supervisor approval — DRAFT → ACTIVE. Only DRAFT rows may be approved.
   * The caller's user_code is recorded as approved_by.
   */
  async approveArrangement(arrangementId: string): Promise<void> {
    assertArrangementEnabled();
    const userCode = await requireUserCode();

    const { data: arr, error } = await supabase
      .from('ce_payment_arrangements')
      .select('id, status, created_by, arrangement_number, case_id')
      .eq('id', arrangementId)
      .single();
    if (error || !arr) throw new Error('Arrangement not found');
    if (arr.status !== 'DRAFT') {
      throw new Error(`Only DRAFT arrangements may be approved (current status: ${arr.status}).`);
    }
    if (arr.created_by === userCode) {
      throw new Error('An arrangement cannot be approved by the same officer who created it. A supervisor must approve.');
    }

    const nowIso = new Date().toISOString();
    const { error: updErr } = await supabase
      .from('ce_payment_arrangements')
      .update({
        status: 'ACTIVE',
        approved_by: userCode,
        approved_at: nowIso,
        updated_by: userCode,
        updated_at: nowIso,
      })
      .eq('id', arrangementId);
    if (updErr) throw updErr;

    if (arr.case_id) {
      await supabase.from('ce_case_history').insert({
        case_id: arr.case_id,
        action: 'ARRANGEMENT_APPROVED',
        performed_by: userCode,
        performed_at: nowIso,
        notes: `Payment arrangement ${arr.arrangement_number} approved by supervisor.`,
      });
    }
  }

  /**
   * Employer signature capture. Requires both a signed_at timestamp and
   * signature_data payload — the two must move together to prevent the
   * "agreement_signed=true but no signature" data anomaly.
   */
  async recordEmployerSignature(arrangementId: string, signatureData: string): Promise<void> {
    assertArrangementEnabled();
    const userCode = await requireUserCode();

    if (!signatureData || !signatureData.trim()) {
      throw new Error('Signature data is required to record employer acknowledgement.');
    }

    const { data: arr, error } = await supabase
      .from('ce_payment_arrangements')
      .select('id, status, arrangement_number, case_id, agreement_signed')
      .eq('id', arrangementId)
      .single();
    if (error || !arr) throw new Error('Arrangement not found');
    if (arr.agreement_signed) {
      throw new Error('Employer signature has already been recorded for this arrangement.');
    }

    const nowIso = new Date().toISOString();
    const { error: updErr } = await supabase
      .from('ce_payment_arrangements')
      .update({
        agreement_signed: true,
        signed_at: nowIso,
        signature_data: signatureData.trim(),
        updated_by: userCode,
        updated_at: nowIso,
      })
      .eq('id', arrangementId);
    if (updErr) throw updErr;

    if (arr.case_id) {
      await supabase.from('ce_case_history').insert({
        case_id: arr.case_id,
        action: 'ARRANGEMENT_SIGNED',
        performed_by: userCode,
        performed_at: nowIso,
        notes: `Employer signature recorded for payment arrangement ${arr.arrangement_number}.`,
      });
    }
  }


  /**
   * @deprecated Use createArrangementFromCase instead. Kept for backward compatibility.
   */
  async createArrangement(request: CreateArrangementRequest): Promise<PaymentArrangement> {
    assertArrangementEnabled();
    const userCode = await requireUserCode();
    const totalArrangedAmount = request.items.reduce((s, i) => s + i.arrangedAmount, 0);
    const numInstallments = request.numberOfInstallments ?? request.customInstallments?.length ?? 1;
    const installmentAmount = totalArrangedAmount / numInstallments;
    const endDate = request.plannedEndDate ?? calculateDueDate(request.startDate, numInstallments - 1, request.frequency ?? 'MONTHLY');

    // Concurrent-arrangement protection (pre-flight; database trigger is authoritative)
    await assertNoOpenArrangement(request.employerId);

    const year = new Date().getFullYear();
    const { count } = await supabase.from('ce_payment_arrangements').select('id', { count: 'exact', head: true });
    const arrangementNumber = `PA-${year}-${String((count ?? 0) + 1).padStart(4, '0')}`;

    const { data, error } = await supabase
      .from('ce_payment_arrangements')
      .insert({
        arrangement_number: arrangementNumber,
        employer_id: request.employerId,
        employer_name: '',
        status: 'DRAFT',
        total_debt: totalArrangedAmount,
        down_payment: 0,
        installment_amount: installmentAmount,
        number_of_installments: numInstallments,
        frequency: request.frequency ?? 'MONTHLY',
        start_date: request.startDate,
        end_date: endDate,
        total_paid: 0,
        installments_paid: 0,
        terms_text: request.notes ?? null,
        conditions: null,
        created_by: userCode,
      })
      .select('*')
      .single();

    if (error) throw error;
    return mapRow(data);
  }

  async activateArrangement(arrangementId: string): Promise<PaymentArrangement> {
    const { data, error } = await supabase
      .from('ce_payment_arrangements')
      .update({ status: 'ACTIVE' })
      .eq('id', arrangementId)
      .select('*')
      .single();
    if (error) throw error;
    return mapRow(data);
  }

  async getArrangementsByEmployer(employerId: string): Promise<PaymentArrangement[]> {
    const { data, error } = await supabase
      .from('ce_payment_arrangements')
      .select('*')
      .eq('employer_id', employerId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapRow);
  }

  async getActiveArrangement(employerId: string): Promise<PaymentArrangement | null> {
    const { data, error } = await supabase
      .from('ce_payment_arrangements')
      .select('*')
      .eq('employer_id', employerId)
      .eq('status', 'ACTIVE')
      .maybeSingle();
    if (error) throw error;
    return data ? mapRow(data) : null;
  }

  async getArrangementById(id: string): Promise<PaymentArrangement | undefined> {
    const { data, error } = await supabase
      .from('ce_payment_arrangements')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapRow(data) : undefined;
  }

  async applyPaymentToInstallment(
    arrangementId: string,
    _installmentId: string,
    amount: number,
    _receiptId: string
  ): Promise<PaymentArrangement> {
    // Update arrangement totals in DB
    const { data: arr, error: fetchErr } = await supabase
      .from('ce_payment_arrangements')
      .select('*')
      .eq('id', arrangementId)
      .single();
    if (fetchErr) throw fetchErr;

    const newTotalPaid = Number(arr.total_paid ?? 0) + amount;
    const newInstallmentsPaid = (arr.installments_paid ?? 0) + 1;

    const updates: Record<string, any> = {
      total_paid: newTotalPaid,
      installments_paid: newInstallmentsPaid,
    };

    if (newTotalPaid >= Number(arr.total_debt ?? 0)) {
      updates.status = 'COMPLETED';
    }

    const { data, error } = await supabase
      .from('ce_payment_arrangements')
      .update(updates)
      .eq('id', arrangementId)
      .select('*')
      .single();
    if (error) throw error;
    return mapRow(data);
  }

  async getEmployerDuesSummary(employerId: string): Promise<EmployerDuesSummary> {
    // Aggregate from ce_violations for compliance dues
    const { data: violations } = await supabase
      .from('ce_violations')
      .select('id, violation_number, total_amount, status')
      .eq('employer_id', employerId)
      .in('status', ['OPEN', 'IN_PROGRESS', 'ESCALATED']);

    const complianceDues = (violations ?? []).map(v => ({
      sourceModule: ArrangementSourceModule.COMPLIANCE,
      sourceType: 'VIOLATION' as any,
      sourceReferenceId: v.id,
      description: `Violation ${v.violation_number}`,
      outstandingAmount: Number(v.total_amount ?? 0),
      isInActiveArrangement: false,
      canBeIncluded: true,
    }));

    return {
      employerId,
      employerName: '',
      complianceDues,
      legalDues: [],
      financeDues: [],
      benefitsDues: [],
      totalOutstanding: complianceDues.reduce((s, d) => s + d.outstandingAmount, 0),
    };
  }

  async getArrangementSummary(): Promise<ArrangementSummary> {
    const { data, error } = await supabase
      .from('ce_payment_arrangements')
      .select('status, total_debt, total_paid');
    if (error) throw error;

    const rows = data ?? [];
    const active = rows.filter(r => r.status === 'ACTIVE');
    const completed = rows.filter(r => r.status === 'COMPLETED');
    const superseded = rows.filter(r => r.status === 'SUPERSEDED');

    // On-time payment rate from installment-level data:
    // rate = paid installments where paid_date <= due_date, over all paid installments.
    let onTimePaymentRate = 0;
    const { data: paidInstallments, error: instErr } = await supabase
      .from('ce_installments')
      .select('due_date, paid_date, amount, paid_amount, status')
      .in('status', ['PAID', 'PARTIAL'])
      .not('paid_date', 'is', null);
    if (!instErr && paidInstallments && paidInstallments.length > 0) {
      const totalPaid = paidInstallments.length;
      const onTime = paidInstallments.filter(
        i => i.paid_date && i.due_date && new Date(i.paid_date) <= new Date(i.due_date),
      ).length;
      onTimePaymentRate = totalPaid > 0 ? Math.round((onTime / totalPaid) * 1000) / 10 : 0;
    }

    return {
      totalArrangements: rows.length,
      activeArrangements: active.length,
      completedArrangements: completed.length,
      supersededArrangements: superseded.length,
      totalArrangedValue: active.reduce((s, r) => s + Number(r.total_debt ?? 0), 0),
      totalPaidToDate: active.reduce((s, r) => s + Number(r.total_paid ?? 0), 0),
      totalOutstanding: active.reduce((s, r) => s + (Number(r.total_debt ?? 0) - Number(r.total_paid ?? 0)), 0),
      onTimePaymentRate,
    };
  }

  async supersedeArrangement(arrangementId: string): Promise<PaymentArrangement> {
    const { data, error } = await supabase
      .from('ce_payment_arrangements')
      .update({ status: 'SUPERSEDED' })
      .eq('id', arrangementId)
      .select('*')
      .single();
    if (error) throw error;
    return mapRow(data);
  }
}

export const centralPaymentArrangementService = new CentralPaymentArrangementService();
