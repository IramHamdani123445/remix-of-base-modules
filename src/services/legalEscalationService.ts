// ============================================
// LEGAL ESCALATION SERVICE — DB-BACKED
// ============================================

import { supabase } from '@/integrations/supabase/client';
import {
  LegalRecommendation,
  LegalReferralHeader,
  LegalRecommendationQueueStats,
  LegalReferralStatus,
} from '@/types/legalEscalation';

// ── Row type from DB ───────────────────────────────────────
interface RecommendationRow {
  id: string;
  employer_id: string;
  employer_name: string;
  employer_zone: string | null;
  risk_band: string | null;
  risk_score: number;
  qualifying_case_ids: any;
  subcase_summary: any;
  total_principal: number;
  total_penalties: number;
  total_interest: number;
  grand_total: number;
  triggered_rules: any;
  recommended_date: string;
  status: string;
  reviewed_by: string | null;
  reviewed_date: string | null;
  review_notes: string | null;
  legal_referral_id: string | null;
  created_at: string;
}

interface ReferralRow {
  id: string;
  referral_number: string;
  recommendation_id: string | null;
  employer_id: string;
  employer_name: string;
  employer_zone: string | null;
  total_principal: number;
  total_penalties: number;
  total_interest: number;
  grand_total: number;
  period_from: string | null;
  period_to: string | null;
  periods_count: number;
  compliance_history: string | null;
  notices_sent: number;
  last_notice_date: string | null;
  payment_plan_history: string | null;
  audit_findings: string | null;
  contact_attempts: string | null;
  status: string;
  submitted_date: string | null;
  accepted_date: string | null;
  accepted_by: string | null;
  rejected_date: string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  legal_case_id: string | null;
  court_case_number: string | null;
  legal_officer_assigned: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
}

// ── Mappers ────────────────────────────────────────────────

function mapRowToRecommendation(row: RecommendationRow): LegalRecommendation {
  const subcaseSummary = Array.isArray(row.subcase_summary) ? row.subcase_summary : [];
  const triggeredRules = Array.isArray(row.triggered_rules) ? row.triggered_rules : [];
  const caseIds = Array.isArray(row.qualifying_case_ids) ? row.qualifying_case_ids : [];

  return {
    id: row.id,
    employerId: row.employer_id,
    employerName: row.employer_name,
    employerZone: row.employer_zone || 'Unassigned',
    riskBand: row.risk_band || 'Low',
    riskScore: Number(row.risk_score || 0),
    qualifyingSubcaseIds: caseIds,
    subcaseSummary: subcaseSummary.map((s: any) => ({
      subcaseId: s.subcaseId || '',
      caseNumber: s.caseNumber || '',
      caseType: s.caseType || '',
      periodFrom: s.periodFrom || '',
      periodTo: s.periodTo || '',
      principalAmount: Number(s.principalAmount || 0),
      penaltyAmount: Number(s.penaltyAmount || 0),
      interestAmount: Number(s.interestAmount || 0),
      totalAmount: Number(s.totalAmount || 0),
    })),
    totalPrincipal: Number(row.total_principal || 0),
    totalPenalties: Number(row.total_penalties || 0),
    totalInterest: Number(row.total_interest || 0),
    grandTotal: Number(row.grand_total || 0),
    triggeredRules: triggeredRules.map((r: any) => ({
      ruleId: r.ruleId || '',
      ruleName: r.ruleName || '',
      reason: r.reason || '',
    })),
    recommendedDate: row.recommended_date,
    status: row.status as LegalRecommendation['status'],
    reviewedBy: row.reviewed_by || undefined,
    reviewedDate: row.reviewed_date || undefined,
    reviewNotes: row.review_notes || undefined,
    legalReferralId: row.legal_referral_id || undefined,
  };
}

function mapRowToReferral(row: ReferralRow): LegalReferralHeader {
  return {
    id: row.id,
    referralNumber: row.referral_number,
    employerId: row.employer_id,
    employerName: row.employer_name,
    employerZone: row.employer_zone || 'Unassigned',
    totalPrincipal: Number(row.total_principal || 0),
    totalPenalties: Number(row.total_penalties || 0),
    totalInterest: Number(row.total_interest || 0),
    grandTotal: Number(row.grand_total || 0),
    periodFrom: row.period_from || '',
    periodTo: row.period_to || '',
    periodsCount: row.periods_count || 0,
    complianceHistory: row.compliance_history || '',
    noticesSent: row.notices_sent || 0,
    lastNoticeDate: row.last_notice_date || undefined,
    paymentPlanHistory: row.payment_plan_history || undefined,
    auditFindings: row.audit_findings || undefined,
    contactAttempts: row.contact_attempts || undefined,
    status: row.status as LegalReferralStatus,
    createdDate: row.created_at,
    createdBy: row.created_by,
    createdByName: row.created_by_name || '',
    submittedDate: row.submitted_date || undefined,
    acceptedDate: row.accepted_date || undefined,
    acceptedBy: row.accepted_by || undefined,
    rejectedDate: row.rejected_date || undefined,
    rejectedBy: row.rejected_by || undefined,
    rejectionReason: row.rejection_reason || undefined,
    legalCaseId: row.legal_case_id || undefined,
    courtCaseNumber: row.court_case_number || undefined,
    legalOfficerAssigned: row.legal_officer_assigned || undefined,
    attachments: [],
  };
}

// ── Service ────────────────────────────────────────────────

export const legalEscalationService = {
  // Generate recommendations from real compliance data using DB RPC
  async generateRecommendations(createdBy: string = 'SYSTEM'): Promise<number> {
    const { data, error } = await supabase.rpc(
      'fn_ce_generate_legal_recommendations' as any,
      { p_created_by: createdBy }
    );
    if (error) throw error;
    return Number(data || 0);
  },

  // Get legal recommendations (queue)
  async getLegalRecommendations(filters?: {
    status?: string;
    zone?: string;
    riskBand?: string;
    minAmount?: number;
  }): Promise<LegalRecommendation[]> {
    let query = supabase
      .from('ce_legal_recommendations' as any)
      .select('*')
      .order('recommended_date', { ascending: false });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.zone) {
      query = query.eq('employer_zone', filters.zone);
    }
    if (filters?.riskBand) {
      query = query.eq('risk_band', filters.riskBand);
    }
    if (filters?.minAmount) {
      query = query.gte('grand_total', filters.minAmount);
    }

    const { data, error } = await query;
    if (error) throw error;
    return ((data as any[]) || []).map(mapRowToRecommendation);
  },

  // Get queue statistics
  async getQueueStats(): Promise<LegalRecommendationQueueStats> {
    const { data, error } = await supabase
      .from('ce_legal_recommendations' as any)
      .select('status, risk_band, employer_zone, grand_total, qualifying_case_ids');
    if (error) throw error;

    const rows = (data as any[]) || [];
    const totalSubcases = rows.reduce((sum, r) => {
      const ids = Array.isArray(r.qualifying_case_ids) ? r.qualifying_case_ids : [];
      return sum + ids.length;
    }, 0);

    // Zone aggregation
    const zoneMap: Record<string, number> = {};
    for (const r of rows) {
      const z = r.employer_zone || 'Unassigned';
      zoneMap[z] = (zoneMap[z] || 0) + 1;
    }

    return {
      totalEmployers: rows.length,
      totalSubcases,
      totalAmountAtRisk: rows.reduce((s, r) => s + Number(r.grand_total || 0), 0),
      byRiskBand: {
        critical: rows.filter(r => (r.risk_band || '').toUpperCase() === 'CRITICAL').length,
        high: rows.filter(r => (r.risk_band || '').toUpperCase() === 'HIGH').length,
        medium: rows.filter(r => (r.risk_band || '').toUpperCase() === 'MEDIUM').length,
        low: rows.filter(r => !['CRITICAL','HIGH','MEDIUM'].includes((r.risk_band || '').toUpperCase())).length,
      },
      byZone: Object.entries(zoneMap).map(([zoneName, count]) => ({ zoneName, count })),
      pendingReview: rows.filter(r => r.status === 'PENDING_REVIEW').length,
      approvedForReferral: rows.filter(r => r.status === 'APPROVED_FOR_REFERRAL').length,
      referralCreated: rows.filter(r => r.status === 'REFERRAL_CREATED').length,
    };
  },

  // Update recommendation status (approve / reject)
  async updateRecommendationStatus(
    recommendationId: string,
    status: LegalRecommendation['status'],
    notes?: string,
    reviewerCode?: string,
  ): Promise<LegalRecommendation> {
    const { data, error } = await supabase
      .from('ce_legal_recommendations' as any)
      .update({
        status,
        reviewed_by: reviewerCode || 'SYSTEM',
        reviewed_date: new Date().toISOString(),
        review_notes: notes || null,
        updated_by: reviewerCode || 'SYSTEM',
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', recommendationId)
      .select()
      .single();
    if (error) throw error;
    return mapRowToRecommendation(data as any);
  },

  // Create legal referral from approved recommendation
  async createLegalReferral(referralData: {
    recommendationId: string;
    selectedSubcaseIds: string[];
    complianceHistory: string;
    createdBy?: string;
    createdByName?: string;
  }): Promise<LegalReferralHeader> {
    // Fetch recommendation
    const { data: recData, error: recErr } = await supabase
      .from('ce_legal_recommendations' as any)
      .select('*')
      .eq('id', referralData.recommendationId)
      .single();
    if (recErr) throw recErr;
    const rec = recData as any;

    const subcases = (Array.isArray(rec.subcase_summary) ? rec.subcase_summary : [])
      .filter((s: any) => referralData.selectedSubcaseIds.includes(s.subcaseId));

    const totalPrincipal = subcases.reduce((s: number, c: any) => s + Number(c.principalAmount || 0), 0);
    const totalPenalties = subcases.reduce((s: number, c: any) => s + Number(c.penaltyAmount || 0), 0);
    const totalInterest = subcases.reduce((s: number, c: any) => s + Number(c.interestAmount || 0), 0);

    // Checkpoint D: the referral packet is created by
    // ce_approve_legal_referral_v1 when management approves. This path only
    // populates the approved packet — it can never mint a referral itself.
    if (rec.status !== 'APPROVED' && rec.status !== 'REFERRAL_CREATED') {
      throw new Error(
        'Management approval is required before a legal referral packet can be prepared.',
      );
    }
    if (!rec.legal_referral_id) {
      throw new Error(
        'The approved recommendation has no referral packet. Re-approve it from the Legal Recommendation Queue.',
      );
    }

    const { data: refData, error: refErr } = await supabase
      .from('ce_legal_referrals' as any)
      .update({
        total_principal: totalPrincipal,
        total_penalties: totalPenalties,
        total_interest: totalInterest,
        grand_total: totalPrincipal + totalPenalties + totalInterest,
        period_from: subcases[0]?.periodFrom || null,
        period_to: subcases[subcases.length - 1]?.periodTo || null,
        periods_count: subcases.length,
        compliance_history: referralData.complianceHistory,
        updated_by: referralData.createdBy || 'SYSTEM',
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', rec.legal_referral_id)
      .select()
      .single();
    if (refErr) throw refErr;

    const referral = refData as any;


    // Insert referral lines
    if (subcases.length > 0) {
      const lines = subcases.map((s: any) => ({
        referral_id: referral.id,
        case_id: s.subcaseId,
        case_number: s.caseNumber,
        case_type: s.caseType,
        period_from: s.periodFrom || null,
        period_to: s.periodTo || null,
        principal_amount: Number(s.principalAmount || 0),
        penalty_amount: Number(s.penaltyAmount || 0),
        interest_amount: Number(s.interestAmount || 0),
        total_amount: Number(s.totalAmount || 0),
      }));
      await supabase.from('ce_legal_referral_lines' as any).insert(lines as any);
    }

    // Update recommendation status
    await supabase
      .from('ce_legal_recommendations' as any)
      .update({
        status: 'REFERRAL_CREATED',
        legal_referral_id: referral.id,
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', referralData.recommendationId);

    return mapRowToReferral(referral);
  },

  // Get legal referrals
  async getLegalReferrals(filters?: {
    status?: LegalReferralStatus;
    employerId?: string;
  }): Promise<LegalReferralHeader[]> {
    let query = supabase
      .from('ce_legal_referrals' as any)
      .select('*')
      .order('created_at', { ascending: false });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.employerId) {
      query = query.eq('employer_id', filters.employerId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return ((data as any[]) || []).map(mapRowToReferral);
  },

  // Submit referral to legal
  async submitReferralToLegal(referralId: string, submittedBy?: string): Promise<LegalReferralHeader> {
    const { data, error } = await supabase
      .from('ce_legal_referrals' as any)
      .update({
        status: LegalReferralStatus.SUBMITTED_TO_LEGAL,
        submitted_date: new Date().toISOString(),
        updated_by: submittedBy || 'SYSTEM',
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', referralId)
      .select()
      .single();
    if (error) throw error;
    return mapRowToReferral(data as any);
  },
};
