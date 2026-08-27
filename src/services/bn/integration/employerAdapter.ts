/**
 * BN Employer Adapter — Reads from er_master for employer verification
 */
import { supabase } from '@/integrations/supabase/client';
import type { IBnEmployerAdapter, EmployerSummary, EmploymentVerification } from './contracts';

const db = supabase as any;

/**
 * Normalize raw er_master.status codes into a canonical token used by
 * eligibility rules. Legacy codes: A=Active, V=Verified/Registered,
 * R=Registered, T=Terminated, C=Ceased, I=Inactive, S=Suspended.
 */
function normalizeEmployerStatus(raw: string | null | undefined): string {
  if (!raw) return 'unknown';
  const s = String(raw).trim().toUpperCase();
  if (['A', 'V', 'R', 'ACTIVE', 'VERIFIED', 'REGISTERED'].includes(s)) return 'A';
  if (['T', 'C', 'CEASED', 'TERMINATED', 'CLOSED'].includes(s)) return 'C';
  if (['S', 'SUSPENDED', 'BLOCKED'].includes(s)) return 'S';
  if (['I', 'INACTIVE'].includes(s)) return 'I';
  return s; // preserve unknown raw value
}

export const bnEmployerAdapter: IBnEmployerAdapter = {
  async lookupEmployer(regNo): Promise<EmployerSummary | null> {
    const { data, error } = await db
      .from('er_master')
      .select('regno, name, status, address_1, industrial_code')
      .eq('regno', regNo.trim())
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
      regNo: data.regno,
      name: data.name,
      status: normalizeEmployerStatus(data.status),
      address: data.address_1,
      industry: data.industrial_code,
    };
  },

  async getEmployerStatus(regNo): Promise<string> {
    const { data, error } = await db
      .from('er_master')
      .select('status')
      .eq('regno', regNo.trim())
      .maybeSingle();
    if (error) throw error;
    return normalizeEmployerStatus(data?.status);
  },

  async verifyEmployment(ssn, regNo, asOfDate): Promise<EmploymentVerification> {
    // ip_wages uses payer_id (not employer_reg_no) for the employer linkage.
    const { data, error } = await db
      .from('ip_wages')
      // BUG-48 — `total_wages` does not exist on ip_wages; the wage figure is
      // seven weekly columns. Naming it failed the whole query with 42703, so
      // employment could never be verified.
      .select(['period', 'payer_id', ...[1, 2, 3, 4, 5, 6, 7].map((i) => `wages_paid${i}`)].join(', '))
      .eq('ssn', ssn.trim())
      .eq('payer_id', regNo.trim())
      .order('period', { ascending: false })
      .limit(1);

    if (error) throw error;

    const employer = await this.lookupEmployer(regNo);
    const hasRecords = !!data && data.length > 0;

    return {
      verified: hasRecords,
      employerRegNo: regNo,
      employerName: employer?.name || 'Unknown',
      lastContributionPeriod: hasRecords ? data[0].period : undefined,
    };
  },
};
