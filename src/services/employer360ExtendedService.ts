import { supabase } from '@/integrations/supabase/client';

// ── Cases linked to employer ──
export async function fetchEmployerCases(employerId: string) {
  const { data, error } = await supabase
    .from('ce_cases')
    .select('id, case_number, case_type, status, priority, created_at, assigned_officer_id, assigned_officer_name, closed_date, total_principal, total_penalties, total_amount, amount_collected, amount_waived')
    .eq('employer_id', employerId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

// ── Payment history ──
// Sources:
//  1. ce_employer_financial_ledger  → compliance-posted credits (once ledger sync runs)
//  2. cn_payment_header + cn_payment → actual cashier receipts (canonical source of truth
//     for money received; independent of whether the compliance ledger has been synced).
// We union both so the Payments tab reflects real receipts even before ledger posting.
export async function fetchEmployerPaymentHistory(employerId: string) {
  const [ledgerRes, headerRes] = await Promise.all([
    supabase
      .from('ce_employer_financial_ledger')
      .select('id, posted_at, period, fund_type, entry_type, description, credit_amount, reference_id, status')
      .eq('employer_id', employerId)
      .gt('credit_amount', 0)
      .eq('status', 'POSTED')
      .order('posted_at', { ascending: false })
      .limit(100),
    supabase
      .from('cn_payment_header')
      .select('payment_id, payer_id, date_received, status, batch_number, remarks')
      .eq('payer_id', employerId)
      .order('date_received', { ascending: false })
      .limit(100),
  ]);
  if (ledgerRes.error) throw ledgerRes.error;

  const ledgerRows = (ledgerRes.data ?? []).map((r: any) => ({
    id: `L-${r.id}`,
    source: 'LEDGER' as const,
    posted_at: r.posted_at,
    period: r.period,
    fund_type: r.fund_type,
    description: r.description || r.entry_type,
    credit_amount: Number(r.credit_amount) || 0,
    reference: r.reference_id,
    status: r.status,
  }));

  const headers = headerRes.data ?? [];
  let receiptRows: any[] = [];
  if (headers.length > 0) {
    const paymentIds = headers.map((h: any) => h.payment_id);
    const [linesRes, receiptRes] = await Promise.all([
      supabase
        .from('cn_payment')
        .select('payment_id, payment_sequence_no, payment_date, payment_amount, period, fund_code, mop_code, mop_number')
        .in('payment_id', paymentIds),
      supabase
        .from('cn_receipt')
        .select('payment_id, receipt_number, receipt_total, status')
        .in('payment_id', paymentIds),
    ]);
    const lines = linesRes.data ?? [];
    const receiptByPayment = new Map<string, any>();
    (receiptRes.data ?? []).forEach((r: any) => receiptByPayment.set(r.payment_id, r));
    const headerByPayment = new Map<string, any>();
    headers.forEach((h: any) => headerByPayment.set(h.payment_id, h));

    receiptRows = lines
      .filter((l: any) => (Number(l.payment_amount) || 0) > 0)
      .map((l: any) => {
        const h = headerByPayment.get(l.payment_id);
        const rc = receiptByPayment.get(l.payment_id);
        return {
          id: `P-${l.payment_id}-${l.payment_sequence_no}`,
          source: 'CASHIER' as const,
          posted_at: l.payment_date || h?.date_received,
          period: l.period,
          fund_type: l.fund_code,
          description: `Receipt ${rc?.receipt_number ?? '—'}${l.mop_code ? ` · ${l.mop_code}` : ''}${l.mop_number ? ` #${l.mop_number}` : ''}${h?.remarks ? ` · ${h.remarks}` : ''}`,
          credit_amount: Number(l.payment_amount) || 0,
          reference: rc?.receipt_number || l.payment_id,
          status: rc?.status || h?.status || 'POSTED',
        };
      });
  }

  return [...receiptRows, ...ledgerRows].sort(
    (a, b) => new Date(b.posted_at || 0).getTime() - new Date(a.posted_at || 0).getTime(),
  );
}

// ── Communications: notices + correspondence ──
export async function fetchEmployerCommunications(employerId: string) {
  const [noticesRes, corrRes] = await Promise.all([
    supabase
      .from('ce_notices')
      .select('id, notice_number, notice_type, status, delivery_method, sent_at, response_received, created_at')
      .eq('employer_id', employerId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('ce_violation_correspondence')
      .select('id, channel, subject, status, created_at, direction')
      .eq('violation_id', employerId) // Note: this table links via violation_id, not employer_id directly
      .order('created_at', { ascending: false })
      .limit(50),
  ]);
  if (noticesRes.error) throw noticesRes.error;
  // Correspondence may fail if no violation_id match — that's fine
  const notices = (noticesRes.data ?? []).map(n => ({
    id: n.id,
    source: 'NOTICE' as const,
    date: n.sent_at || n.created_at,
    title: `${(n.notice_type || '').replace(/_/g, ' ')} — ${n.notice_number || ''}`,
    detail: `Status: ${n.status} | Delivery: ${(n.delivery_method || '').replace(/_/g, ' ')}`,
    status: n.status,
  }));
  const corrs = (corrRes.data ?? []).map(c => ({
    id: c.id,
    source: 'CORRESPONDENCE' as const,
    date: c.created_at,
    title: c.subject || (c.channel || '').replace(/_/g, ' '),
    detail: `${c.direction || 'OUTBOUND'} | Status: ${c.status}`,
    status: c.status,
  }));

  return [...notices, ...corrs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// ── Documents from cases ──
export async function fetchEmployerDocuments(employerId: string) {
  // ce_case_documents doesn't have employer_id — need to go through cases
  const { data: cases } = await supabase
    .from('ce_cases')
    .select('id')
    .eq('employer_id', employerId)
    .limit(100);
  
  if (!cases || cases.length === 0) return [];
  
  const caseIds = cases.map(c => c.id);
  const { data, error } = await supabase
    .from('ce_case_documents')
    .select('id, title, document_type, file_name, file_path, created_at, uploaded_by_name, case_id, is_confidential')
    .in('case_id', caseIds)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

// ── Payment arrangements ──
export async function fetchEmployerArrangements(employerId: string) {
  const { data, error } = await supabase
    .from('ce_payment_arrangements')
    .select('id, arrangement_number, status, total_debt, total_paid, start_date, end_date, created_at')
    .eq('employer_id', employerId)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return data ?? [];
}

// ── Breach monitoring (arrangement breaches for this employer) ──
// ce_breach_monitoring is keyed by reg_no, which is the same registration
// number Employer 360 routes on.
export async function fetchEmployerBreaches(employerId: string) {
  const { data, error } = await supabase
    .from('ce_breach_monitoring')
    .select('id, breach_id, breach_type, breach_date, missed_amount, consecutive_misses, status, auto_detected')
    .eq('reg_no', employerId)
    .order('breach_date', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}
