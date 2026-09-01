// ============================================
// FIELD AUDIT SERVICE — Unified Compliance Field Audit
// Consolidates: weeklyAuditPlanService, inspectionService, weeklyReportService
// Persists: checklist responses, evidence, structured findings, audit reports
// ============================================

import { supabase } from '@/integrations/supabase/client';
import { getCurrentUserCode } from '@/hooks/useUserCode';
import { formatDateForStorage } from '@/lib/dateFormat';
import {
  InspectionEvidence,
  InspectionFinding,
  EvidenceType,
  FindingType,
} from '@/types/inspectionTypes';
import { Violation } from '@/types/violation';
import type { ChecklistItem } from '@/types/auditChecklist';

// ── Types ──────────────────────────────────────────

export interface ChecklistResponse {
  id?: string;
  inspectionId: string;
  planItemId?: string;
  templateKey: string;
  category: string;
  questionId: string;
  questionText: string;
  response?: 'Yes' | 'No' | 'Partial' | 'N/A';
  notes?: string;
  evidenceRequired: boolean;
}

export interface StructuredFindingRequest {
  inspectionId: string;
  findingType: FindingType;
  title: string;
  category: string;
  description: string;
  severity: 'Low' | 'Medium' | 'High' | 'Critical';
  recommendedAction?: string;
  followUpRequired?: boolean;
  followUpNotes?: string;
  evidenceIds?: string[];
}

export interface PlanExecutionVisitRow {
  planItemId: string;
  inspectionId?: string;
  visitDate: string;
  employerId?: string;
  employerName?: string;
  areaName?: string;
  visitType: string;
  executionStatus: string;
  checklistTotal: number;
  checklistAnswered: number;
  checklistPct: number;
  evidenceCount: number;
  findingsCount: number;
  hasReport: boolean;
  reportStatus?: string;
  followUpCount: number;
}

export interface PlanExecutionDashboard {
  planId: string;
  planNumber: string;
  weekStartDate: string;
  weekEndDate: string;
  status: string;
  inspectorName?: string;
  visits: PlanExecutionVisitRow[];
  kpis: {
    planned: number;
    inProgress: number;
    completed: number;
    rescheduled: number;
    notDone: number;
    totalEvidence: number;
    totalFindings: number;
    totalReports: number;
  };
}

export interface EmployerAuditReportRow {
  id: string;
  reportNumber: string;
  inspectionId: string;
  employerId?: string;
  employerName?: string;
  inspectorId?: string;
  inspectorName?: string;
  reportDate: string;
  executiveSummary?: string;
  scope?: string;
  conclusions?: string;
  recommendations?: string;
  totalFindings: number;
  totalEvidence: number;
  totalViolations: number;
  checklistCompletionPct: number;
  status: 'DRAFT' | 'FINAL' | 'SHARED';
  pdfUrl?: string;
  generatedAt?: string;
  finalizedAt?: string;
}

export type ExecutionMode = 'ONSITE' | 'DESKTOP_REVIEW' | 'DOCUMENT_REVIEW';
export type EnforcementMode = 'STRICT' | 'SELF_SERVICE' | 'SOFT_WARNING';

export interface StartAuditSessionRequest {
  planItemId: string;
  executionMode: ExecutionMode;
  gpsLat?: number;
  gpsLng?: number;
  gpsUnavailableReason?: string;
  startNotes?: string;
}

export interface CompletionGateConfig {
  id: string;
  scope: string;
  enforcementMode: EnforcementMode;
  requireChecklistComplete: boolean;
  requireFindingsRecorded: boolean;
  requireReportSaved: boolean;
  requireFollowupsForSeverity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
  requireEvidenceMinCount: number;
  overrideRequiresRole: string | null;
  isActive: boolean;
}

export interface CompletionGateResult {
  ready: boolean;
  enforcementMode: EnforcementMode;
  checks: {
    key: string;
    label: string;
    passed: boolean;
    required: boolean;
    detail?: string;
  }[];
  missingRequired: string[];
}

export interface CloseAuditSessionRequest {
  inspectionId: string;
  closeNotes?: string;
  gpsLat?: number;
  gpsLng?: number;
  overrideReason?: string;
}

export interface AccurateWeeklySummary {
  planId: string;
  plannedVisits: number;
  completedVisits: number;
  inProgressVisits: number;
  rescheduledVisits: number;
  notDoneVisits: number;
  totalHoursSpent: number;
  evidenceCollected: number;
  findingsByseverity: { Low: number; Medium: number; High: number; Critical: number };
  totalFindings: number;
  reportsGenerated: number;
  violationsOpened: number;
  violationsUpdated: number;
  followUpsCreated: number;
  inspectorNarrative: string;
  generatedAt: string;
}

// ── Helpers ────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

async function whoami(): Promise<string> {
  return (await getCurrentUserCode()) ?? 'SYSTEM';
}

// ── Service ────────────────────────────────────────

export const fieldAuditService = {
  // ── Checklist Responses ──────────────────────────

  async saveChecklistResponses(
    inspectionId: string,
    planItemId: string | undefined,
    templateKey: string,
    items: ChecklistItem[]
  ): Promise<void> {
    const userCode = await whoami();
    const rows = items.map((it) => ({
      inspection_id: inspectionId,
      plan_item_id: planItemId ?? null,
      template_key: templateKey,
      category: it.category,
      question_id: it.id,
      question_text: it.question,
      response: it.response ?? null,
      notes: it.notes ?? null,
      evidence_required: !!it.evidenceRequired,
      created_by: userCode,
      updated_by: userCode,
      updated_at: nowIso(),
    }));

    const { error } = await supabase
      .from('ce_audit_checklist_responses')
      .upsert(rows as any, { onConflict: 'inspection_id,question_id' });
    if (error) throw error;
  },

  async getChecklistResponses(inspectionId: string): Promise<ChecklistResponse[]> {
    const { data, error } = await supabase
      .from('ce_audit_checklist_responses')
      .select('*')
      .eq('inspection_id', inspectionId)
      .order('category', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      inspectionId: r.inspection_id,
      planItemId: r.plan_item_id ?? undefined,
      templateKey: r.template_key,
      category: r.category,
      questionId: r.question_id,
      questionText: r.question_text,
      response: r.response ?? undefined,
      notes: r.notes ?? undefined,
      evidenceRequired: !!r.evidence_required,
    }));
  },

  async getChecklistCompletionStats(
    inspectionId: string
  ): Promise<{ total: number; answered: number; pct: number }> {
    const { data, error } = await supabase
      .from('ce_audit_checklist_responses')
      .select('response')
      .eq('inspection_id', inspectionId);
    if (error) throw error;
    const total = data?.length ?? 0;
    const answered = (data ?? []).filter((r: any) => r.response).length;
    const pct = total === 0 ? 0 : Math.round((answered / total) * 1000) / 10;
    return { total, answered, pct };
  },

  // ── Evidence (FIXED: writes to ce_inspection_evidence) ──

  async uploadEvidence(params: {
    inspectionId: string;
    planItemId?: string;
    findingId?: string;
    file: File;
    evidenceType: EvidenceType;
    description?: string;
    gpsLat?: number;
    gpsLng?: number;
  }): Promise<InspectionEvidence> {
    const userCode = await whoami();
    const path = `inspections/${params.inspectionId}/${Date.now()}-${params.file.name}`;
    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(path, params.file, { upsert: false });

    let fileUrl = '';
    if (!upErr) {
      const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path);
      fileUrl = urlData.publicUrl;
    }

    const { data, error } = await supabase
      .from('ce_inspection_evidence')
      .insert({
        inspection_id: params.inspectionId,
        plan_item_id: params.planItemId ?? null,
        finding_id: params.findingId ?? null,
        evidence_type: params.evidenceType,
        file_name: params.file.name,
        file_url: fileUrl,
        file_size: params.file.size,
        description: params.description ?? null,
        gps_lat: params.gpsLat ?? null,
        gps_lng: params.gpsLng ?? null,
        captured_at: nowIso(),
        captured_by: userCode,
        created_by: userCode,
      } as any)
      .select('*')
      .single();
    if (error) throw error;

    // Canonical count refresh — keeps report.totalEvidence in sync
    try { await this.recomputeReportMetrics(params.inspectionId); } catch {}

    return {
      id: data.id,
      inspectionVisitId: data.inspection_id,
      employerId: '',
      evidenceType: data.evidence_type as EvidenceType,
      fileName: data.file_name,
      fileUrl: data.file_url,
      fileSize: data.file_size ?? 0,
      description: data.description ?? '',
      capturedAt: data.captured_at,
      capturedByUserId: data.captured_by ?? userCode,
      capturedByName: data.captured_by ?? userCode,
      gpsLat: data.gps_lat ?? undefined,
      gpsLng: data.gps_lng ?? undefined,
    };
  },

  async getEvidenceForVisit(inspectionId: string): Promise<InspectionEvidence[]> {
    const { data, error } = await supabase
      .from('ce_inspection_evidence')
      .select('*')
      .eq('inspection_id', inspectionId)
      .order('captured_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      inspectionVisitId: r.inspection_id,
      employerId: '',
      evidenceType: r.evidence_type,
      fileName: r.file_name,
      fileUrl: r.file_url,
      fileSize: r.file_size ?? 0,
      description: r.description ?? '',
      capturedAt: r.captured_at,
      capturedByUserId: r.captured_by ?? '',
      capturedByName: r.captured_by ?? '',
      gpsLat: r.gps_lat ?? undefined,
      gpsLng: r.gps_lng ?? undefined,
    }));
  },

  async linkEvidenceToFinding(evidenceId: string, findingId: string): Promise<void> {
    const userCode = await whoami();
    const { error } = await supabase
      .from('ce_inspection_evidence')
      .update({ finding_id: findingId, updated_by: userCode, updated_at: nowIso() } as any)
      .eq('id', evidenceId);
    if (error) throw error;
  },

  // ── Structured Findings ─────────────────────────

  async createStructuredFinding(req: StructuredFindingRequest): Promise<{ id: string }> {
    const userCode = await whoami();
    const { data, error } = await supabase
      .from('ce_inspection_findings')
      .insert({
        inspection_id: req.inspectionId,
        finding_type: req.findingType,
        title: req.title,
        category: req.category,
        description: req.description,
        severity: req.severity,
        recommended_action: req.recommendedAction ?? null,
        follow_up_required: req.followUpRequired ?? false,
        follow_up_notes: req.followUpNotes ?? null,
        violation_created: false,
        created_by: userCode,
      } as any)
      .select('id')
      .single();
    if (error) throw error;

    if (req.evidenceIds && req.evidenceIds.length > 0) {
      await Promise.all(
        req.evidenceIds.map((evId) => this.linkEvidenceToFinding(evId, data.id))
      );
    }
    // Canonical count refresh
    try { await this.recomputeReportMetrics(req.inspectionId); } catch {}
    return { id: data.id };
  },

  // ── Follow-up from Finding ──────────────────────

  async createFollowUpFromFinding(params: {
    findingId: string;
    employerId?: string;
    employerName?: string;
    actionType: string;
    description: string;
    priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
    dueDate: string;
    assignedToUserId?: string;
    assignedToName?: string;
    notes?: string;
  }): Promise<{ id: string }> {
    const userCode = await whoami();
    const { data, error } = await supabase
      .from('ce_follow_up_actions')
      .insert({
        finding_id: params.findingId,
        violation_id: null,
        employer_id: params.employerId ?? null,
        employer_name: params.employerName ?? null,
        action_type: params.actionType,
        description: params.description,
        priority: params.priority,
        status: 'OPEN',
        due_date: params.dueDate,
        assigned_to_user_id: params.assignedToUserId ?? null,
        assigned_to_name: params.assignedToName ?? null,
        notes: params.notes ?? null,
        source: 'FINDING',
        created_by: userCode,
      } as any)
      .select('id')
      .single();
    if (error) throw error;

    // Mark finding follow_up_required = true
    await supabase
      .from('ce_inspection_findings')
      .update({ follow_up_required: true, updated_by: userCode, updated_at: nowIso() } as any)
      .eq('id', params.findingId);

    return { id: data.id };
  },

  // ── Findings & Violations reads (canonical) ─────

  async getFindingsForVisit(inspectionId: string): Promise<InspectionFinding[]> {
    const { data, error } = await supabase
      .from('ce_inspection_findings')
      .select('*, ce_inspection_evidence(id)')
      .eq('inspection_id', inspectionId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      id: row.id,
      inspectionVisitId: row.inspection_id ?? '',
      employerId: '',
      findingType: row.finding_type ?? 'INFORMATION_ONLY',
      title: row.title ?? (row.description?.substring(0, 80) ?? ''),
      category: row.category ?? '',
      description: row.description ?? '',
      severity: row.severity ?? 'Medium',
      recommendedAction: row.recommended_action ?? undefined,
      followUpRequired: !!row.follow_up_required,
      isViolationCreated: !!row.violation_created,
      violationId: row.violation_id ?? undefined,
      evidenceIds: (row.ce_inspection_evidence ?? []).map((e: any) => e.id),
      createdAt: row.created_at,
      createdByUserId: row.created_by ?? '',
      createdByName: row.created_by ?? '',
    }));
  },

  async getViolationsForVisit(inspectionId: string): Promise<Violation[]> {
    const { data, error } = await supabase
      .from('ce_violations')
      .select('*')
      .eq('inspection_id', inspectionId)
      .or('is_deleted.is.null,is_deleted.eq.false')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row: any): Violation => ({
      id: row.id,
      violationNumber: row.violation_number ?? '',
      employerId: row.employer_id ?? '',
      employerName: row.employer_name ?? '',
      violationType: row.violation_type ?? 'OTHER',
      status: row.status ?? 'OPEN',
      severity: row.severity ?? 'Medium',
      priority: row.severity ?? 'Medium',
      description: row.description ?? '',
      summary: row.description ?? '',
      territory: row.territory ?? 'St Kitts',
      discoveredDate: row.detected_date ?? row.created_at,
      discoveredBy: row.detected_by ?? '',
      assignedToUserId: row.assigned_to_user_id ?? '',
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? row.created_at,
      inspectionVisitId: row.inspection_id,
      isUnlinked: false,
    }));
  },

  // ── Unified per-visit metrics (single source of truth) ──

  /**
   * Canonical recompute of report-level counts from source tables.
   * Call this after ANY mutation that affects findings, evidence, violations,
   * or checklist responses for an inspection. It updates the audit report row
   * (if one exists) so that viewer / print / PDF / snapshot all read the same
   * numbers from a single source of truth.
   *
   * Safe to call when no report exists yet — it becomes a no-op.
   * Never overwrites a FINAL report (those are locked).
   */
  async recomputeReportMetrics(inspectionId: string): Promise<{
    totalFindings: number;
    totalEvidence: number;
    totalViolations: number;
    checklistCompletionPct: number;
  }> {
    const userCode = await whoami();

    const [findingsRes, evidenceRes, violationsRes, checklistStats] = await Promise.all([
      supabase
        .from('ce_inspection_findings')
        .select('id', { count: 'exact', head: true })
        .eq('inspection_id', inspectionId),
      supabase
        .from('ce_inspection_evidence')
        .select('id', { count: 'exact', head: true })
        .eq('inspection_id', inspectionId),
      supabase
        .from('ce_violations')
        .select('id', { count: 'exact', head: true })
        .eq('inspection_id', inspectionId)
        .or('is_deleted.is.null,is_deleted.eq.false'),
      this.getChecklistCompletionStats(inspectionId),
    ]);

    const totals = {
      totalFindings: findingsRes.count ?? 0,
      totalEvidence: evidenceRes.count ?? 0,
      totalViolations: violationsRes.count ?? 0,
      checklistCompletionPct: checklistStats.pct,
    };

    // Update the report row only if one exists AND it's not finalized
    const { data: existing } = await supabase
      .from('ce_employer_audit_reports')
      .select('id, status')
      .eq('inspection_id', inspectionId)
      .maybeSingle();

    if (existing && existing.status !== 'FINAL') {
      await supabase
        .from('ce_employer_audit_reports')
        .update({
          total_findings: totals.totalFindings,
          total_evidence: totals.totalEvidence,
          total_violations: totals.totalViolations,
          checklist_completion_pct: totals.checklistCompletionPct,
          updated_by: userCode,
          updated_at: nowIso(),
        } as any)
        .eq('id', existing.id);
    }

    return totals;
  },

  async getVisitMetrics(inspectionId: string) {
    const { data, error } = await supabase
      .from('ce_v_visit_execution_metrics' as any)
      .select('*')
      .eq('inspection_id', inspectionId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async getVisitMetricsBatch(inspectionIds: string[]) {
    if (!inspectionIds.length) return [] as any[];
    const { data, error } = await supabase
      .from('ce_v_visit_execution_metrics' as any)
      .select('*')
      .in('inspection_id', inspectionIds);
    if (error) throw error;
    return data ?? [];
  },

  // ── Plan Execution Dashboard (refactored to use view) ──

  async getPlanExecutionDashboard(planId: string): Promise<PlanExecutionDashboard> {
    const { data: plan, error: planErr } = await supabase
      .from('ce_weekly_plans')
      .select('*')
      .eq('id', planId)
      .single();
    if (planErr) throw planErr;

    const { data: items, error: itemsErr } = await supabase
      .from('ce_weekly_plan_items')
      .select('*')
      .eq('plan_id', planId)
      .order('scheduled_date', { ascending: true });
    if (itemsErr) throw itemsErr;

    const planItemIds = (items ?? []).map((i: any) => i.id);

    // Pull metrics by plan_item_id (now linked via ce_inspections.plan_item_id)
    let metricsByPlanItem = new Map<string, any>();
    if (planItemIds.length) {
      const { data: metrics } = await supabase
        .from('ce_v_visit_execution_metrics' as any)
        .select('*')
        .in('plan_item_id', planItemIds);
      (metrics ?? []).forEach((m: any) => {
        if (m.plan_item_id) metricsByPlanItem.set(m.plan_item_id, m);
      });
    }

    // Follow-ups by employer (carry over count)
    const employerIds = Array.from(
      new Set((items ?? []).map((i: any) => i.employer_id).filter(Boolean))
    );
    const followUpByEmp = new Map<string, number>();
    if (employerIds.length) {
      const { data: fu } = await supabase
        .from('ce_follow_up_actions')
        .select('employer_id')
        .in('employer_id', employerIds)
        .eq('is_deleted', false);
      (fu ?? []).forEach((r: any) =>
        followUpByEmp.set(r.employer_id, (followUpByEmp.get(r.employer_id) ?? 0) + 1)
      );
    }

    const visits: PlanExecutionVisitRow[] = (items ?? []).map((it: any) => {
      const m = metricsByPlanItem.get(it.id);
      return {
        planItemId: it.id,
        inspectionId: m?.inspection_id,
        visitDate: it.scheduled_date,
        employerId: it.employer_id ?? undefined,
        employerName: it.employer_name ?? undefined,
        areaName: it.area_name ?? undefined,
        visitType: it.visit_type ?? it.item_type ?? 'AUDIT',
        executionStatus: it.execution_status ?? 'PLANNED',
        checklistTotal: m?.checklist_total ?? 0,
        checklistAnswered: m?.checklist_answered ?? 0,
        checklistPct: Number(m?.checklist_pct ?? 0),
        evidenceCount: m?.evidence_count ?? 0,
        findingsCount: m?.findings_count ?? 0,
        hasReport: !!m?.report_id,
        reportStatus: m?.report_status ?? undefined,
        followUpCount: it.employer_id ? followUpByEmp.get(it.employer_id) ?? 0 : 0,
      };
    });

    const kpis = {
      planned: visits.filter((v) => v.executionStatus === 'PLANNED' || v.executionStatus === 'NOT_STARTED').length,
      inProgress: visits.filter((v) => v.executionStatus === 'IN_PROGRESS').length,
      completed: visits.filter((v) => v.executionStatus === 'COMPLETED').length,
      rescheduled: visits.filter((v) => v.executionStatus === 'RESCHEDULED').length,
      notDone: visits.filter((v) => v.executionStatus === 'NOT_DONE' || v.executionStatus === 'CANCELLED').length,
      totalEvidence: visits.reduce((s, v) => s + v.evidenceCount, 0),
      totalFindings: visits.reduce((s, v) => s + v.findingsCount, 0),
      totalReports: visits.filter((v) => v.hasReport).length,
    };

    return {
      planId,
      planNumber: (plan as any).plan_number,
      weekStartDate: (plan as any).week_start_date,
      weekEndDate: (plan as any).week_end_date,
      status: (plan as any).status,
      inspectorName: (plan as any).inspector_name,
      visits,
      kpis,
    };
  },

  // ── Report Payload Aggregation (auto-derive) ────

  async getReportPayload(inspectionId: string) {
    const [
      { data: inspection },
      { data: checklist },
      { data: evidence },
      findings,
      violations,
      { data: interaction },
      { data: workingPapers },
      metrics,
    ] = await Promise.all([
      supabase.from('ce_inspections').select('*').eq('id', inspectionId).maybeSingle(),
      supabase.from('ce_audit_checklist_responses').select('*').eq('inspection_id', inspectionId).order('category'),
      supabase.from('ce_inspection_evidence').select('*').eq('inspection_id', inspectionId).order('captured_at'),
      this.getFindingsForVisit(inspectionId),
      this.getViolationsForVisit(inspectionId),
      supabase.from('ce_inspection_employer_interactions').select('*').eq('inspection_id', inspectionId).maybeSingle(),
      supabase.from('ce_inspection_working_papers').select('*').eq('inspection_id', inspectionId),
      this.getVisitMetrics(inspectionId),
    ]);

    return {
      inspection,
      checklist: checklist ?? [],
      evidence: evidence ?? [],
      findings,
      violations,
      interaction,
      workingPapers: workingPapers ?? [],
      metrics,
    };
  },

  // ── Employer Audit Report ───────────────────────

  async generateEmployerAuditReport(inspectionId: string): Promise<EmployerAuditReportRow> {
    const userCode = await whoami();
    const payload = await this.getReportPayload(inspectionId);
    if (!payload.inspection) throw new Error('Inspection not found');

    const insp: any = payload.inspection;
    const m: any = payload.metrics ?? {};
    const interaction: any = payload.interaction ?? {};

    // Fetch employer master for regno + HQ address fallback
    let employerMaster: any = null;
    if (insp.employer_id) {
      const { data: em } = await (supabase as any)
        .from('er_master')
        .select('regno, hq_addr1, hq_addr2, name')
        .eq('id', insp.employer_id)
        .maybeSingle();
      employerMaster = em;
    }

    const findingsCount = payload.findings.length || Number(m.findings_count ?? 0);
    const evidenceCount = payload.evidence.length || Number(m.evidence_count ?? 0);
    const violationsCount = payload.violations.length || Number(m.violations_count ?? 0);
    const checklistPct = Number(m.checklist_pct ?? 0);

    const pickLatestDateOnly = (values: Array<string | undefined | null>) => {
      const valid = values
        .filter(Boolean)
        .map((value) => ({ raw: value as string, ms: new Date(value as string).getTime() }))
        .filter((entry) => Number.isFinite(entry.ms))
        .sort((a, b) => b.ms - a.ms);

      return valid.length ? formatDateForStorage(valid[0].raw) : null;
    };

    const actualAuditActivityDates = [
      insp.session_closed_at,
      insp.check_out_time,
      insp.actual_end,
      interaction.updated_at,
      interaction.created_at,
      ...(payload.evidence ?? []).map((row: any) => row.captured_at ?? row.capturedAt),
      ...(payload.findings ?? []).map((row: any) => row.createdAt),
      ...(payload.workingPapers ?? []).flatMap((row: any) => [row.updated_at, row.created_at]),
      insp.session_started_at,
      insp.check_in_time,
      insp.actual_start,
    ];

    // Prefer the latest actual audit activity date; only fall back to planned dates when no real activity exists.
    const auditDate =
      pickLatestDateOnly(actualAuditActivityDates) ??
      pickLatestDateOnly([insp.visit_date, insp.scheduled_date]) ??
      null;
    const hqAddress = employerMaster
      ? [employerMaster.hq_addr1, employerMaster.hq_addr2].filter(Boolean).join(', ')
      : '';
    const auditLocation = insp.location_address ?? (hqAddress || null);
    const employerRegNumber = employerMaster?.regno ?? null;
    const employerName = insp.employer_name ?? employerMaster?.name ?? '';
    const auditDateDisplay = auditDate ?? 'the audit date';

    // Narrative seeds
    const purposeScopeSeed = employerName
      ? `Routine compliance audit of ${employerName} for the period under review. Scope covers wage records, contributions, and statutory filings.`
      : null;
    const executiveSummarySeed = employerName
      ? `On ${auditDateDisplay}, an on-site audit was conducted at ${employerName}. ${findingsCount} finding(s), ${violationsCount} violation(s), and ${evidenceCount} evidence item(s) were recorded. Checklist completion: ${checklistPct}%.`
      : null;

    const checklistCategories = Array.from(
      new Set((payload.checklist ?? []).map((c: any) => c.category).filter(Boolean))
    );
    const recordsReviewedSeed =
      checklistCategories.length > 0
        ? checklistCategories.join(', ')
        : 'Wage Books, Contribution Registers, Payroll, Employee Records';

    const recommendationsSeed =
      violationsCount > 0
        ? 'Address all findings within the statutory timeframe. Refer to Violations section for required corrective actions.'
        : null;

    // Helper: only fill empty/null on update; always fill on insert
    const isBlank = (value: any) =>
      value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

    const coalesceEmpty = (existingVal: any, derivedVal: any) => {
      if (isBlank(existingVal)) return derivedVal;
      return existingVal;
    };

    const autoSummaryPattern =
      /^On .* an on-site audit was conducted at .*\. \d+ finding\(s\), \d+ violation\(s\), and \d+ evidence item\(s\) were recorded\. Checklist completion: .*%\.?$/;

    const refreshAutoSummary = (existingVal: any, derivedVal: any) => {
      if (isBlank(existingVal)) return derivedVal;
      if (typeof existingVal === 'string' && autoSummaryPattern.test(existingVal.trim())) {
        return derivedVal;
      }
      return existingVal;
    };

    const refreshDerivedAuditDate = (existingVal: any, derivedVal: any) => {
      if (isBlank(existingVal)) return derivedVal;
      const normalizedExisting = formatDateForStorage(existingVal);
      const legacyPlannedDates = new Set(
        [insp.visit_date, insp.scheduled_date].filter(Boolean).map((value) => formatDateForStorage(value as string))
      );
      if (derivedVal && legacyPlannedDates.has(normalizedExisting) && normalizedExisting !== derivedVal) {
        return derivedVal;
      }
      return existingVal;
    };

    // Always-refresh fields (counts + identity)
    const baseFields = {
      inspection_id: inspectionId,
      plan_item_id: insp.plan_item_id ?? null,
      employer_id: insp.employer_id,
      employer_name: employerName,
      inspector_id: insp.inspector_id,
      inspector_name: insp.inspector_name,
      total_findings: findingsCount,
      total_evidence: evidenceCount,
      total_violations: violationsCount,
      checklist_completion_pct: checklistPct,
      generated_at: nowIso(),
      generated_by: userCode,
      updated_by: userCode,
      updated_at: nowIso(),
    };

    const { data: existing } = await supabase
      .from('ce_employer_audit_reports')
      .select('*')
      .eq('inspection_id', inspectionId)
      .maybeSingle();

    let row: any;
    if (existing && existing.status !== 'FINAL') {
      // Update: preserve manual edits, only fill empty narrative/derived fields
      const updateFields = {
        ...baseFields,
        audit_date: refreshDerivedAuditDate(existing.audit_date, auditDate),
        audit_location: coalesceEmpty(existing.audit_location, auditLocation),
        employer_reg_number: coalesceEmpty(existing.employer_reg_number, employerRegNumber),
        audit_contact_name: coalesceEmpty(existing.audit_contact_name, interaction.representative_name ?? null),
        audit_contact_designation: coalesceEmpty(existing.audit_contact_designation, interaction.representative_designation ?? null),
        audit_contact_present:
          existing.audit_contact_present === null || existing.audit_contact_present === undefined
            ? (interaction.employer_acknowledged ?? true)
            : existing.audit_contact_present,
        purpose_scope: coalesceEmpty(existing.purpose_scope, purposeScopeSeed),
        executive_summary: refreshAutoSummary(existing.executive_summary, executiveSummarySeed),
        records_reviewed: coalesceEmpty(existing.records_reviewed, recordsReviewedSeed),
        recommendations: coalesceEmpty(existing.recommendations, recommendationsSeed),
      };
      const { data, error } = await supabase
        .from('ce_employer_audit_reports')
        .update(updateFields as any)
        .eq('id', existing.id)
        .select('*')
        .single();
      if (error) throw error;
      row = data;
    } else if (!existing) {
      // Insert: pre-fill everything we know
      const insertFields = {
        ...baseFields,
        created_by: userCode,
        audit_date: auditDate,
        audit_location: auditLocation,
        employer_reg_number: employerRegNumber,
        audit_contact_name: interaction.representative_name ?? null,
        audit_contact_designation: interaction.representative_designation ?? null,
        audit_contact_present: interaction.employer_acknowledged ?? true,
        purpose_scope: purposeScopeSeed,
        executive_summary: executiveSummarySeed,
        records_reviewed: recordsReviewedSeed,
        recommendations: recommendationsSeed,
      };
      const { data, error } = await supabase
        .from('ce_employer_audit_reports')
        .insert(insertFields as any)
        .select('*')
        .single();
      if (error) throw error;
      row = data;
    } else {
      row = existing;
    }

    // Back-fill audit_report_id on violations of this inspection
    if (row?.id) {
      await supabase
        .from('ce_violations')
        .update({ audit_report_id: row.id, updated_by: userCode, updated_at: nowIso() } as any)
        .eq('inspection_id', inspectionId)
        .is('audit_report_id', null);
    }

    // Phase 7: fire AUTO_EVENT_DRIVEN comms when the audit report is first created
    // Only fire on initial creation (existing was null), not on re-fetch
    if (row?.id && !existing && insp.employer_id) {
      try {
        const { fireAuditCommunicationEvent } = await import('./auditCommunicationEventService');
        await fireAuditCommunicationEvent({
          event_type: 'audit_completed',
          employer_id: insp.employer_id,
          inspection_id: inspectionId,
          context_data: {
            employer: { id: insp.employer_id, name: employerName, regno: employerRegNumber },
            inspection: { id: inspectionId, audit_date: auditDate, location: auditLocation },
            report: { id: row.id, findings_count: findingsCount, violations_count: violationsCount, evidence_count: evidenceCount },
          },
          triggered_by: userCode,
        });
      } catch (e) {
        console.warn('[fieldAuditService] audit_completed event fire failed', e);
      }
    }

    return mapReport(row);
  },

  async getEmployerAuditReport(inspectionId: string): Promise<EmployerAuditReportRow | null> {
    const { data, error } = await supabase
      .from('ce_employer_audit_reports')
      .select('*')
      .eq('inspection_id', inspectionId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapReport(data) : null;
  },

  async updateAuditReportNarrative(
    reportId: string,
    fields: { executiveSummary?: string; scope?: string; conclusions?: string; recommendations?: string }
  ): Promise<void> {
    const userCode = await whoami();
    const { error } = await supabase
      .from('ce_employer_audit_reports')
      .update({
        executive_summary: fields.executiveSummary ?? null,
        scope: fields.scope ?? null,
        conclusions: fields.conclusions ?? null,
        recommendations: fields.recommendations ?? null,
        updated_by: userCode,
        updated_at: nowIso(),
      } as any)
      .eq('id', reportId);
    if (error) throw error;
  },

  async finalizeAuditReport(reportId: string, pdfUrl?: string): Promise<void> {
    const userCode = await whoami();
    const { error } = await supabase
      .from('ce_employer_audit_reports')
      .update({
        status: 'FINAL',
        pdf_url: pdfUrl ?? null,
        finalized_at: nowIso(),
        finalized_by: userCode,
        updated_by: userCode,
        updated_at: nowIso(),
      } as any)
      .eq('id', reportId);
    if (error) throw error;
  },

  // ── Violation creation from Finding ─────────────

  async createViolationFromFinding(params: {
    findingId: string;
    inspectionId: string;
    employerId: string;
    employerName?: string;
    violationType: string;
    description: string;
    severity?: 'Low' | 'Medium' | 'High' | 'Critical';
    territory?: string;
  }): Promise<{ id: string; violationNumber: string }> {
    const userCode = await whoami();
    const violationNumber = `V-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;

    // Look up existing report (if any) to back-link
    const { data: report } = await supabase
      .from('ce_employer_audit_reports')
      .select('id')
      .eq('inspection_id', params.inspectionId)
      .maybeSingle();

    const { data, error } = await supabase
      .from('ce_violations')
      .insert({
        violation_number: violationNumber,
        employer_id: params.employerId,
        employer_name: params.employerName ?? null,
        violation_type: params.violationType,
        description: params.description,
        severity: params.severity ?? 'Medium',
        status: 'OPEN',
        territory: params.territory ?? 'St Kitts',
        inspection_id: params.inspectionId,
        audit_report_id: report?.id ?? null,
        detected_date: new Date().toISOString().slice(0, 10),
        detected_by: userCode,
        created_by: userCode,
      } as any)
      .select('id, violation_number')
      .single();
    if (error) throw error;

    // Mark finding as violation-created
    await supabase
      .from('ce_inspection_findings')
      .update({
        violation_created: true,
        violation_id: data.id,
        updated_by: userCode,
        updated_at: nowIso(),
      } as any)
      .eq('id', params.findingId);

    // Refresh canonical counts on the audit report (if any) so viewer/print/PDF
    // immediately reflect the new violation. Best-effort — never blocks creation.
    try {
      await this.recomputeReportMetrics(params.inspectionId);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[fieldAuditService] post-violation count refresh failed', e);
    }

    // Phase 7: fire AUTO_EVENT_DRIVEN comms for violation_logged (best-effort)
    try {
      const { fireAuditCommunicationEvent } = await import('./auditCommunicationEventService');
      await fireAuditCommunicationEvent({
        event_type: 'violation_logged',
        employer_id: params.employerId,
        inspection_id: params.inspectionId,
        context_data: {
          violation: {
            id: data.id,
            number: data.violation_number,
            type: params.violationType,
            severity: params.severity ?? 'Medium',
            description: params.description,
          },
          employer: { id: params.employerId, name: params.employerName ?? null },
        },
        triggered_by: userCode,
      });
    } catch (e) {
      console.warn('[fieldAuditService] violation_logged event fire failed', e);
    }

    return { id: data.id, violationNumber: data.violation_number };
  },

  // ── Accurate Weekly Report Summary (uses view) ──

  async getAccurateWeeklySummary(planId: string): Promise<AccurateWeeklySummary> {
    const { data: plan } = await supabase
      .from('ce_weekly_plans')
      .select('*')
      .eq('id', planId)
      .single();

    const { data: items } = await supabase
      .from('ce_weekly_plan_items')
      .select('*')
      .eq('plan_id', planId);

    const allItems = items ?? [];
    const completed = allItems.filter((i: any) => i.execution_status === 'COMPLETED');
    const inProgress = allItems.filter((i: any) => i.execution_status === 'IN_PROGRESS');
    const rescheduled = allItems.filter((i: any) => i.execution_status === 'RESCHEDULED');
    const notDone = allItems.filter(
      (i: any) => i.execution_status === 'NOT_DONE' || i.execution_status === 'CANCELLED'
    );

    let totalHours = 0;
    completed.forEach((i: any) => {
      if (i.check_in_time && i.check_out_time) {
        totalHours += (new Date(i.check_out_time).getTime() - new Date(i.check_in_time).getTime()) / 3600000;
      }
    });

    // Pull all metrics by plan_item_id in one shot
    const planItemIds = allItems.map((i: any) => i.id);
    const metricsRows = await this.getVisitMetricsBatch(planItemIds.length ? [] : []);
    // Need fetch by plan_item_id, not inspection_id; use a direct query
    let metrics: any[] = [];
    if (planItemIds.length) {
      const { data } = await supabase
        .from('ce_v_visit_execution_metrics' as any)
        .select('*')
        .in('plan_item_id', planItemIds);
      metrics = data ?? [];
    }

    const sev = { Low: 0, Medium: 0, High: 0, Critical: 0 };
    let evidenceCollected = 0;
    let totalFindings = 0;
    let reportsGenerated = 0;
    let violationsOpened = 0;
    let followUpsCreated = 0;

    metrics.forEach((m: any) => {
      evidenceCollected += m.evidence_count ?? 0;
      totalFindings += m.findings_count ?? 0;
      sev.Critical += m.findings_critical ?? 0;
      sev.High += m.findings_high ?? 0;
      sev.Medium += m.findings_medium ?? 0;
      sev.Low += m.findings_low ?? 0;
      if (m.report_id) reportsGenerated += 1;
      violationsOpened += m.violations_count ?? 0;
      followUpsCreated += m.followup_count ?? 0;
    });

    return {
      planId,
      plannedVisits: allItems.length,
      completedVisits: completed.length,
      inProgressVisits: inProgress.length,
      rescheduledVisits: rescheduled.length,
      notDoneVisits: notDone.length,
      totalHoursSpent: Math.round(totalHours * 10) / 10,
      evidenceCollected,
      findingsByseverity: sev,
      totalFindings,
      reportsGenerated,
      violationsOpened,
      violationsUpdated: 0,
      followUpsCreated,
      inspectorNarrative: (plan as any)?.outcome_narrative ?? '',
      generatedAt: nowIso(),
    };
  },

  // ── Weekly Report Submission / Review ──────────

  async submitWeeklyReport(planId: string, narrative: string): Promise<void> {
    const userCode = await whoami();
    const { error } = await supabase
      .from('ce_weekly_plans')
      .update({
        outcome_narrative: narrative,
        outcome_submitted_at: nowIso(),
        status: 'SUBMITTED',
        updated_by: userCode,
        updated_at: nowIso(),
      } as any)
      .eq('id', planId);
    if (error) throw error;
  },

  async reviewWeeklyReport(planId: string, approve: boolean, comments: string): Promise<void> {
    const userCode = await whoami();
    const { error } = await supabase
      .from('ce_weekly_plans')
      .update({
        status: approve ? 'COMPLETED' : 'NEED_CHANGES',
        reviewer_comments: comments,
        approved_by: approve ? userCode : null,
        approved_date: approve ? nowIso() : null,
        updated_by: userCode,
        updated_at: nowIso(),
      } as any)
      .eq('id', planId);
    if (error) throw error;
  },

  async getSubmittedWeeklyReports(): Promise<any[]> {
    const { data, error } = await supabase
      .from('ce_weekly_plans')
      .select('*')
      .in('status', ['SUBMITTED'])
      // outcome_submitted_at is only stamped by the report flow; plans that
      // arrived via the plan workflow carry submitted_date, so order by the
      // effective submission timestamp instead of dropping them to the bottom.
      .order('outcome_submitted_at', { ascending: false, nullsFirst: false })
      .order('submitted_date', { ascending: false, nullsFirst: false });
    if (error) throw error;
    return data ?? [];
  },

  // ── Audit Session Lifecycle (P2) ───────────────

  /**
   * Start an audit session for a plan item.
   * - Creates a ce_inspections row if one doesn't already exist for this plan item.
   * - Records execution mode + optional GPS (non-blocking; never required).
   * - Idempotent: returns existing inspection if a session is already started.
   */
  async startAuditSession(req: StartAuditSessionRequest): Promise<{ inspectionId: string; resumed: boolean }> {
    const userCode = await whoami();

    const { data: planItem, error: piErr } = await supabase
      .from('ce_weekly_plan_items')
      .select('*')
      .eq('id', req.planItemId)
      .maybeSingle();
    if (piErr) throw piErr;
    if (!planItem) throw new Error('Plan item not found');

    const { data: existing } = await supabase
      .from('ce_inspections')
      .select('*')
      .eq('plan_item_id', req.planItemId)
      .maybeSingle();

    if (existing) {
      if (!(existing as any).session_started_at) {
        await supabase
          .from('ce_inspections')
          .update({
            execution_mode: req.executionMode,
            gps_unavailable_reason: req.gpsUnavailableReason ?? null,
            session_started_at: nowIso(),
            check_in_time: (existing as any).check_in_time ?? nowIso(),
            check_in_gps_lat: req.gpsLat ?? null,
            check_in_gps_lng: req.gpsLng ?? null,
            status: 'IN_PROGRESS',
            updated_by: userCode,
            updated_at: nowIso(),
          } as any)
          .eq('id', (existing as any).id);
      }
      return { inspectionId: (existing as any).id, resumed: true };
    }

    const { data: created, error } = await supabase
      .from('ce_inspections')
      .insert({
        plan_item_id: req.planItemId,
        employer_id: (planItem as any).employer_id ?? null,
        employer_name: (planItem as any).employer_name ?? null,
        inspector_id: (planItem as any).inspector_id ?? userCode,
        inspector_name: (planItem as any).inspector_name ?? null,
        territory: (planItem as any).territory ?? 'St Kitts',
        visit_date: (planItem as any).scheduled_date ?? new Date().toISOString().slice(0, 10),
        check_in_time: nowIso(),
        check_in_gps_lat: req.gpsLat ?? null,
        check_in_gps_lng: req.gpsLng ?? null,
        execution_mode: req.executionMode,
        gps_unavailable_reason: req.gpsUnavailableReason ?? null,
        session_started_at: nowIso(),
        status: 'IN_PROGRESS',
        notes: req.startNotes ?? null,
        created_by: userCode,
        updated_by: userCode,
      } as any)
      .select('id')
      .single();
    if (error) throw error;

    await supabase
      .from('ce_weekly_plan_items')
      .update({
        execution_status: 'IN_PROGRESS',
        updated_by: userCode,
        updated_at: nowIso(),
      } as any)
      .eq('id', req.planItemId);

    return { inspectionId: created.id, resumed: false };
  },

  // ── Completion Gate Configuration ──────────────

  async getCompletionGateConfig(scope: string = 'GLOBAL'): Promise<CompletionGateConfig> {
    const { data, error } = await supabase
      .from('ce_completion_gate_config' as any)
      .select('*')
      .eq('scope', scope)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;

    if (!data) {
      return {
        id: 'default',
        scope: 'GLOBAL',
        enforcementMode: 'STRICT',
        requireChecklistComplete: true,
        requireFindingsRecorded: true,
        requireReportSaved: true,
        requireFollowupsForSeverity: 'MEDIUM',
        requireEvidenceMinCount: 0,
        overrideRequiresRole: 'COMPLIANCE_SUPERVISOR',
        isActive: true,
      };
    }
    const r: any = data;
    return {
      id: r.id,
      scope: r.scope,
      enforcementMode: r.enforcement_mode,
      requireChecklistComplete: !!r.require_checklist_complete,
      requireFindingsRecorded: !!r.require_findings_recorded,
      requireReportSaved: !!r.require_report_saved,
      requireFollowupsForSeverity: r.require_followups_for_severity ?? null,
      requireEvidenceMinCount: r.require_evidence_min_count ?? 0,
      overrideRequiresRole: r.override_requires_role ?? null,
      isActive: !!r.is_active,
    };
  },

  async updateCompletionGateConfig(
    scope: string,
    patch: Partial<Omit<CompletionGateConfig, 'id' | 'scope'>>
  ): Promise<CompletionGateConfig> {
    const userCode = await whoami();
    const update: any = { updated_by: userCode };
    if (patch.enforcementMode !== undefined) update.enforcement_mode = patch.enforcementMode;
    if (patch.requireChecklistComplete !== undefined) update.require_checklist_complete = patch.requireChecklistComplete;
    if (patch.requireFindingsRecorded !== undefined) update.require_findings_recorded = patch.requireFindingsRecorded;
    if (patch.requireReportSaved !== undefined) update.require_report_saved = patch.requireReportSaved;
    if (patch.requireFollowupsForSeverity !== undefined) update.require_followups_for_severity = patch.requireFollowupsForSeverity;
    if (patch.requireEvidenceMinCount !== undefined) update.require_evidence_min_count = patch.requireEvidenceMinCount;
    if (patch.overrideRequiresRole !== undefined) update.override_requires_role = patch.overrideRequiresRole;
    if (patch.isActive !== undefined) update.is_active = patch.isActive;

    const { error } = await supabase
      .from('ce_completion_gate_config' as any)
      .update(update)
      .eq('scope', scope);
    if (error) throw error;
    return this.getCompletionGateConfig(scope);
  },

  // ── Completion Gate Evaluation ─────────────────

  async evaluateCompletionGate(inspectionId: string): Promise<CompletionGateResult> {
    const cfg = await this.getCompletionGateConfig('GLOBAL');
    const metrics: any = (await this.getVisitMetrics(inspectionId)) ?? {};
    const [findings, reportRes, interactionRes, wpRes] = await Promise.all([
      this.getFindingsForVisit(inspectionId),
      supabase
        .from('ce_employer_audit_reports')
        .select('id,status')
        .eq('inspection_id', inspectionId)
        .maybeSingle(),
      supabase
        .from('ce_inspection_employer_interactions')
        .select('id, representative_name, representative_designation, representative_contact, authorization_status, records_declaration')
        .eq('inspection_id', inspectionId)
        .maybeSingle(),
      supabase
        .from('ce_inspection_working_papers')
        .select('payroll_reviewed, contributions_reviewed, employee_sample_size, wage_book_reviewed, inspector_observations')
        .eq('inspection_id', inspectionId)
        .maybeSingle(),
    ]);

    const report = reportRes.data;
    const interaction = interactionRes.data as any;
    const wp = wpRes.data as any;

    // Working Papers (5 standardized review items) + template-driven checklist
    const WP_TOTAL = 5;
    const wpDone = wp
      ? [
          wp.payroll_reviewed,
          wp.contributions_reviewed,
          (wp.employee_sample_size ?? 0) > 0,
          wp.wage_book_reviewed,
          ((wp.inspector_observations ?? '') as string).trim().length > 0,
        ].filter(Boolean).length
      : 0;
    const tplTotal = Number(metrics.checklist_total ?? 0);
    const tplAnswered = Number(metrics.checklist_answered ?? 0);
    const checklistTotal = WP_TOTAL + tplTotal;
    const checklistAnswered = wpDone + tplAnswered;
    const checklistComplete = checklistTotal > 0 && checklistAnswered >= checklistTotal;

    const findingsCount = findings.length;
    const evidenceCount = metrics.evidence_count ?? 0;
    const interactionCaptured = !!interaction?.id;
    const interactionDetail = interactionCaptured
      ? [interaction?.representative_name, interaction?.representative_designation].filter(Boolean).join(' — ') || 'Recorded'
      : 'Not recorded';

    const sevOrder = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 } as const;
    const threshold = cfg.requireFollowupsForSeverity ? sevOrder[cfg.requireFollowupsForSeverity] : null;
    const findingsNeedingFollowup = threshold
      ? findings.filter((f) => {
          const sevKey = (f.severity ?? 'Medium').toUpperCase() as keyof typeof sevOrder;
          return (sevOrder[sevKey] ?? 0) >= threshold;
        })
      : [];
    const followupsCovered =
      findingsNeedingFollowup.length === 0 ||
      findingsNeedingFollowup.every((f) => f.followUpRequired);

    const checks: CompletionGateResult['checks'] = [
      {
        key: 'interaction',
        label: 'Employer interaction captured',
        required: true,
        passed: interactionCaptured,
        detail: interactionDetail,
      },
      {
        key: 'checklist',
        label: 'Checklist completed',
        required: cfg.requireChecklistComplete,
        passed: checklistComplete,
        detail: `${checklistAnswered}/${checklistTotal} answered (Working Papers + ${tplTotal} template item${tplTotal === 1 ? '' : 's'})`,
      },
      {
        key: 'findings',
        label: 'At least one finding recorded',
        required: cfg.requireFindingsRecorded,
        passed: findingsCount > 0,
        detail: `${findingsCount} finding(s)`,
      },
      {
        key: 'evidence',
        label: `Minimum evidence (${cfg.requireEvidenceMinCount})`,
        required: cfg.requireEvidenceMinCount > 0,
        passed: evidenceCount >= cfg.requireEvidenceMinCount,
        detail: `${evidenceCount} evidence item(s)`,
      },
      {
        key: 'report',
        label: 'Audit report saved',
        required: cfg.requireReportSaved,
        passed: !!report,
        detail: report ? `Status: ${(report as any).status}` : 'Not generated',
      },
      {
        key: 'followups',
        label: `Follow-ups for ${cfg.requireFollowupsForSeverity ?? 'N/A'}+ severity findings`,
        required: !!cfg.requireFollowupsForSeverity,
        passed: followupsCovered,
        detail:
          findingsNeedingFollowup.length === 0
            ? 'No qualifying findings'
            : `${findingsNeedingFollowup.filter((f) => f.followUpRequired).length}/${findingsNeedingFollowup.length} covered`,
      },
    ];

    const missingRequired = checks.filter((c) => c.required && !c.passed).map((c) => c.label);
    const ready = missingRequired.length === 0;

    return { ready, enforcementMode: cfg.enforcementMode, checks, missingRequired };
  },

  // ── Close Audit Session ────────────────────────

  /**
   * Close an audit session, honoring the configured enforcement mode:
   *   STRICT       — blocks if gate fails unless overrideReason is supplied
   *   SELF_SERVICE — allows close with overrideReason if gate fails
   *   SOFT_WARNING — never blocks
   */
  async closeAuditSession(
    req: CloseAuditSessionRequest
  ): Promise<{ closed: boolean; gate: CompletionGateResult }> {
    const userCode = await whoami();
    const gate = await this.evaluateCompletionGate(req.inspectionId);

    const needsOverride = !gate.ready && gate.enforcementMode !== 'SOFT_WARNING';
    if (needsOverride && !req.overrideReason) {
      return { closed: false, gate };
    }

    const update: any = {
      check_out_time: nowIso(),
      check_out_gps_lat: req.gpsLat ?? null,
      check_out_gps_lng: req.gpsLng ?? null,
      session_closed_at: nowIso(),
      status: 'COMPLETED',
      updated_by: userCode,
      updated_at: nowIso(),
    };
    if (req.closeNotes) update.notes = req.closeNotes;
    if (needsOverride && req.overrideReason) {
      update.completion_gate_overridden_by = userCode;
      update.completion_gate_override_reason = req.overrideReason;
      update.completion_gate_overridden_at = nowIso();
    }

    const { error } = await supabase
      .from('ce_inspections')
      .update(update)
      .eq('id', req.inspectionId);
    if (error) throw error;

    const { data: insp } = await supabase
      .from('ce_inspections')
      .select('plan_item_id')
      .eq('id', req.inspectionId)
      .maybeSingle();
    if ((insp as any)?.plan_item_id) {
      await supabase
        .from('ce_weekly_plan_items')
        .update({
          execution_status: 'COMPLETED',
          updated_by: userCode,
          updated_at: nowIso(),
        } as any)
        .eq('id', (insp as any).plan_item_id);
    }

    return { closed: true, gate };
  },

  // ── Visit Workspace Aggregator ─────────────────

  /**
   * Single call returning everything the Audit Visit Workspace screen needs.
   */
  async getVisitWorkspaceData(planItemId: string) {
    const { data: planItem, error: piErr } = await supabase
      .from('ce_weekly_plan_items')
      .select('*, ce_weekly_plans(*)')
      .eq('id', planItemId)
      .maybeSingle();
    if (piErr) throw piErr;

    const { data: inspection } = await supabase
      .from('ce_inspections')
      .select('*')
      .eq('plan_item_id', planItemId)
      .maybeSingle();

    const inspectionId = (inspection as any)?.id;

    let metricsRaw: any = null;
    let evidence: InspectionEvidence[] = [];
    let findings: InspectionFinding[] = [];
    let report: EmployerAuditReportRow | null = null;
    let gate: CompletionGateResult | null = null;

    let workingPapers: any = null;
    if (inspectionId) {
      [metricsRaw, evidence, findings, report, gate] = await Promise.all([
        this.getVisitMetrics(inspectionId),
        this.getEvidenceForVisit(inspectionId),
        this.getFindingsForVisit(inspectionId),
        this.getEmployerAuditReport(inspectionId),
        this.evaluateCompletionGate(inspectionId),
      ]);

      const wpRes = await supabase
        .from('ce_inspection_working_papers')
        .select('payroll_reviewed, contributions_reviewed, employee_sample_size, wage_book_reviewed, inspector_observations')
        .eq('inspection_id', inspectionId)
        .maybeSingle();
      workingPapers = wpRes.data ?? null;
    }

    // Follow-up count for this employer (carry-over indicator)
    let followUpCount = 0;
    const employerId = (inspection as any)?.employer_id;
    if (employerId) {
      const { count } = await (supabase as any)
        .from('ce_follow_ups')
        .select('id', { count: 'exact', head: true })
        .eq('employer_id', employerId)
        .eq('is_deleted', false);
      followUpCount = count ?? 0;
    }

    // Working Papers checklist (5 standardized review areas — the actual
    // checklist surfaced on the Working Papers tab of this screen).
    const WP_TOTAL = 5;
    const wpDone = workingPapers
      ? [
          workingPapers.payroll_reviewed,
          workingPapers.contributions_reviewed,
          (workingPapers.employee_sample_size ?? 0) > 0,
          workingPapers.wage_book_reviewed,
          ((workingPapers.inspector_observations ?? '') as string).trim().length > 0,
        ].filter(Boolean).length
      : 0;

    // Combine Working Papers (always-present) with any template-driven
    // checklist items (ia_audit_checklists, surfaced via the metrics view).
    // This keeps the KPI consistent with what the user actually sees on screen.
    const tplTotal = Number(metricsRaw?.checklist_total ?? 0);
    const tplAnswered = Number(metricsRaw?.checklist_answered ?? 0);
    const checklistTotal = WP_TOTAL + tplTotal;
    const checklistAnswered = wpDone + tplAnswered;
    const checklistPct = checklistTotal > 0
      ? Math.round((checklistAnswered * 100) / checklistTotal)
      : 0;

    // Normalize snake_case view row → camelCase shape consumed by KPI cards.
    // Fall back to actual array lengths so totals always match what's listed
    // in the Evidence / Findings tabs (single source of truth = the data itself).
    const metrics = metricsRaw
      ? {
          checklistTotal,
          checklistAnswered,
          checklistPct,
          evidenceCount: evidence.length || Number(metricsRaw.evidence_count ?? 0),
          findingsCount: findings.length || Number(metricsRaw.findings_count ?? 0),
          violationsCount: Number(metricsRaw.violations_count ?? 0),
          hasReport: !!report || !!metricsRaw.report_id,
          reportStatus: report?.status ?? metricsRaw.report_status ?? undefined,
          followUpCount,
        }
      : {
          checklistTotal,
          checklistAnswered,
          checklistPct,
          evidenceCount: evidence.length,
          findingsCount: findings.length,
          violationsCount: 0,
          hasReport: !!report,
          reportStatus: report?.status,
          followUpCount,
        };

    return {
      planItem,
      plan: (planItem as any)?.ce_weekly_plans ?? null,
      inspection,
      inspectionId,
      metrics,
      evidence,
      findings,
      report,
      gate,
    };
  },
};

function mapReport(r: any): EmployerAuditReportRow {
  return {
    id: r.id,
    reportNumber: r.report_number,
    inspectionId: r.inspection_id,
    employerId: r.employer_id ?? undefined,
    employerName: r.employer_name ?? undefined,
    inspectorId: r.inspector_id ?? undefined,
    inspectorName: r.inspector_name ?? undefined,
    reportDate: r.report_date,
    executiveSummary: r.executive_summary ?? undefined,
    scope: r.scope ?? undefined,
    conclusions: r.conclusions ?? undefined,
    recommendations: r.recommendations ?? undefined,
    totalFindings: r.total_findings ?? 0,
    totalEvidence: r.total_evidence ?? 0,
    totalViolations: r.total_violations ?? 0,
    checklistCompletionPct: Number(r.checklist_completion_pct ?? 0),
    status: r.status,
    pdfUrl: r.pdf_url ?? undefined,
    generatedAt: r.generated_at ?? undefined,
    finalizedAt: r.finalized_at ?? undefined,
  };
}
