/**
 * Partial Payment Service (DR-004)
 *
 * Every write goes through a governed SECURITY DEFINER routine — the client
 * has no insert/update rights on the partial payment tables. Approval
 * authority, separation of duties, allocation policy, payment-authority
 * generation and the audit trail are all enforced in the database.
 */
import { supabase } from '@/integrations/supabase/client';
import type {
  CePartialPaymentAllocationLine,
  CePartialPaymentLiability,
} from '@/lib/compliance/partialPaymentAllocation';

/**
 * The governed partial-payment routines are newer than the generated type
 * surface, so they are invoked through a narrow, explicitly-typed shim
 * rather than by loosening the whole client.
 */
type RpcArgs = Record<string, unknown>;
const callRpc = async <T>(fn: string, args: RpcArgs): Promise<T> => {
  const client = supabase as unknown as {
    rpc: (fn: string, args: RpcArgs) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
};

export type PartialPaymentStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'SETTLED'
  | 'EXPIRED';

export type PartialPaymentSource = 'EMPLOYER' | 'CASHIER' | 'COMPLIANCE';

export interface PartialPaymentPolicy {
  id: string;
  policy_code: string;
  policy_name: string;
  scope_key: string;
  is_active: boolean;
  allocation_order: string[];
  allow_allocation_override: boolean;
  minimum_acceptable_percent: number;
  minimum_acceptable_amount: number;
  authority_validity_days: number;
  required_approval_role: 'inspector' | 'senior' | 'head';
  escalated_approval_role: 'inspector' | 'senior' | 'head';
  escalation_threshold_amount: number | null;
  require_separate_approver: boolean;
  block_when_arrangement_active: boolean;
  notes: string | null;
}

export interface PartialPaymentAllocationRow {
  id: string;
  request_id: string;
  payment_code: string;
  fund_code: string | null;
  bucket_label: string | null;
  outstanding_amount: number;
  requested_amount: number;
  approved_amount: number | null;
  allocation_sequence: number;
}

export interface PartialPaymentRequest {
  id: string;
  request_number: string;
  employer_id: string;
  employer_name: string | null;
  wage_period: string;
  obligation_type: string;
  source: PartialPaymentSource;
  status: PartialPaymentStatus;
  total_liability: number;
  requested_amount: number;
  approved_amount: number | null;
  settled_amount: number;
  reason_code: string | null;
  justification: string;
  authority_number: string | null;
  authority_invoice_id: number | null;
  authority_expires_on: string | null;
  requested_by: string | null;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_comments: string | null;
  payment_reference: string | null;
  row_version: number;
  ce_partial_payment_allocations?: PartialPaymentAllocationRow[];
}

export interface PartialPaymentEvent {
  id: string;
  request_id: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  amount: number | null;
  reason: string | null;
  comments: string | null;
  acted_by: string | null;
  acted_at: string;
}

export interface PaymentCategory {
  payment_code: string;
  payment_type_description: string;
  fund_code: string | null;
}

/* ------------------------------- reads ------------------------------- */

export async function getActivePartialPaymentPolicy(
  scopeKey = 'DEFAULT',
): Promise<PartialPaymentPolicy | null> {
  const { data, error } = await supabase
    .from('ce_partial_payment_policies')
    .select('*')
    .eq('is_active', true)
    .in('scope_key', [scopeKey, 'DEFAULT'])
    .order('scope_key', { ascending: scopeKey === 'DEFAULT' })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as PartialPaymentPolicy) ?? null;
}

export async function updatePartialPaymentPolicy(
  id: string,
  patch: Partial<PartialPaymentPolicy>,
): Promise<void> {
  const { error } = await supabase
    .from('ce_partial_payment_policies')
    .update(patch as never)
    .eq('id', id);
  if (error) throw error;
}

export async function listPaymentCategories(): Promise<PaymentCategory[]> {
  const { data, error } = await supabase
    .from('tb_payment_type')
    .select('payment_code, payment_type_description, fund_code')
    .order('payment_code');
  if (error) throw error;
  return (data ?? []) as PaymentCategory[];
}

export async function listPartialPaymentRequests(filters: {
  status?: PartialPaymentStatus | 'ALL';
  employerId?: string;
} = {}): Promise<PartialPaymentRequest[]> {
  let query = supabase
    .from('ce_partial_payment_requests')
    .select('*, ce_partial_payment_allocations(*)')
    .order('requested_at', { ascending: false })
    .limit(500);
  if (filters.status && filters.status !== 'ALL') query = query.eq('status', filters.status);
  if (filters.employerId) query = query.eq('employer_id', filters.employerId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as PartialPaymentRequest[];
}

export async function getPartialPaymentEvents(requestId: string): Promise<PartialPaymentEvent[]> {
  const { data, error } = await supabase
    .from('ce_partial_payment_events')
    .select('*')
    .eq('request_id', requestId)
    .order('acted_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PartialPaymentEvent[];
}

export async function getOutstandingLiability(
  employerId: string,
  wagePeriod: string,
  obligationType = 'CONTRIBUTION_PAYMENT',
): Promise<CePartialPaymentLiability> {
  const data = await callRpc<CePartialPaymentLiability>('ce_pp_liability', {
    p_employer_id: employerId,
    p_wage_period: wagePeriod,
    p_obligation_type: obligationType,
  });
  const parsed = (data ?? {}) as CePartialPaymentLiability;
  return {
    total_outstanding: Number(parsed.total_outstanding ?? 0),
    buckets: (parsed.buckets ?? []).map((b) => ({
      ...b,
      outstanding_amount: Number(b.outstanding_amount ?? 0),
    })),
  };
}

/* ------------------------------ commands ------------------------------ */

export async function requestPartialPayment(input: {
  employerId: string;
  wagePeriod: string;
  requestedAmount: number;
  justification: string;
  allocations: CePartialPaymentAllocationLine[];
  source: PartialPaymentSource;
  reasonCode?: string | null;
  obligationType?: string;
  caseId?: string | null;
  violationId?: string | null;
}): Promise<string> {
  return await callRpc<string>('ce_request_partial_payment_v1', {
    p_employer_id: input.employerId,
    p_wage_period: input.wagePeriod,
    p_requested_amount: input.requestedAmount,
    p_justification: input.justification,
    p_allocations: input.allocations,
    p_source: input.source,
    p_reason_code: input.reasonCode ?? null,
    p_obligation_type: input.obligationType ?? 'CONTRIBUTION_PAYMENT',
    p_case_id: input.caseId ?? null,
    p_violation_id: input.violationId ?? null,
  });
}

export async function reviewPartialPayment(input: {
  requestId: string;
  allocations: CePartialPaymentAllocationLine[];
  comments?: string;
}): Promise<void> {
  await callRpc<void>('ce_review_partial_payment_v1', {
    p_request_id: input.requestId,
    p_allocations: input.allocations,
    p_comments: input.comments ?? null,
  });
}

export interface ApprovalResult {
  request_id: string;
  status: string;
  approved_amount: number;
  authority_number: string;
  authority_invoice_id: number;
  authority_expires_on: string;
  /** Always false — approval never moves the statutory payment deadline. */
  extends_statutory_deadline: false;
}

export async function approvePartialPayment(input: {
  requestId: string;
  approvedAmount: number;
  allocations?: CePartialPaymentAllocationLine[] | null;
  comments?: string;
  expectedVersion?: number;
}): Promise<ApprovalResult> {
  return await callRpc<ApprovalResult>('ce_approve_partial_payment_v1', {
    p_request_id: input.requestId,
    p_approved_amount: input.approvedAmount,
    p_allocations: input.allocations ?? null,
    p_comments: input.comments ?? null,
    p_expected_version: input.expectedVersion ?? null,
  });
}

export async function rejectPartialPayment(input: {
  requestId: string;
  reason: string;
  comments?: string;
  expectedVersion?: number;
}): Promise<void> {
  await callRpc<void>('ce_reject_partial_payment_v1', {
    p_request_id: input.requestId,
    p_reason: input.reason,
    p_comments: input.comments ?? null,
    p_expected_version: input.expectedVersion ?? null,
  });
}

export async function cancelPartialPayment(requestId: string, reason?: string): Promise<void> {
  await callRpc<void>('ce_cancel_partial_payment_v1', {
    p_request_id: requestId,
    p_reason: reason ?? null,
  });
}

export async function settlePartialPayment(input: {
  requestId: string;
  amount: number;
  paymentReference?: string;
}): Promise<void> {
  await callRpc<void>('ce_settle_partial_payment_v1', {
    p_request_id: input.requestId,
    p_amount: input.amount,
    p_payment_reference: input.paymentReference ?? null,
  });
}
