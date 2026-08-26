// ============================================
// INSPECTION SERVICE - DEPRECATED WRAPPERS
// All evidence + findings + violation reads/writes now delegate to fieldAuditService.
// Plan-item and inspection lifecycle methods (checkIn / checkOut / createWeeklyPlanItem)
// remain here but use the canonical user code and ensure plan_item_id is set on inspections.
// ============================================

import { supabase } from '@/integrations/supabase/client';
import { getCurrentUserCode } from '@/hooks/useUserCode';
import {
  WeeklyPlanItem,
  InspectionVisit,
  InspectionEvidence,
  InspectionFinding,
  InspectionVisitStatus,
  CreateWeeklyPlanItemRequest,
  CheckInRequest,
  CheckOutRequest,
  CreateEvidenceRequest,
  CreateFindingRequest,
} from '@/types/inspectionTypes';
import { fieldAuditService } from './fieldAuditService';

async function whoami(): Promise<string> {
  return (await getCurrentUserCode()) ?? 'SYSTEM';
}

function mapPlanItem(row: any): WeeklyPlanItem {
  return {
    id: row.id,
    inspectorUserId: row.created_by ?? '',
    inspectorName: '',
    itemType: row.item_type ?? 'EMPLOYER_VISIT',
    employerId: row.employer_id ?? undefined,
    employerName: row.employer_name ?? undefined,
    territory: row.territory ?? 'St Kitts',
    plannedDate: row.scheduled_date?.slice(0, 10) ?? '',
    plannedStartTime: row.scheduled_start_time ?? undefined,
    plannedEndTime: row.scheduled_end_time ?? undefined,
    areaName: row.area_name ?? undefined,
    focusNotes: row.purpose ?? undefined,
    status: (row.execution_status ?? 'NOT_STARTED') as InspectionVisitStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapInspection(row: any): InspectionVisit {
  return {
    id: row.id,
    weeklyPlanItemId: row.plan_item_id ?? row.id,
    employerId: row.employer_id ?? undefined,
    employerName: row.employer_name ?? undefined,
    inspectorUserId: row.inspector_id ?? '',
    inspectorName: row.inspector_name ?? '',
    territory: row.territory ?? 'St Kitts',
    checkInTime: row.check_in_time ?? row.actual_start ?? undefined,
    checkInLocation: row.location_address ?? undefined,
    checkOutTime: row.check_out_time ?? row.actual_end ?? undefined,
    checkOutLocation: row.location_address ?? undefined,
    notes: row.findings_summary ?? undefined,
    visitStatus: (row.status ?? 'IN_PROGRESS') as InspectionVisitStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class InspectionService {
  async getWeeklyPlanItems(inspectorId: string, weekStartDate?: string): Promise<WeeklyPlanItem[]> {
    let query = supabase
      .from('ce_weekly_plan_items')
      .select('*')
      .order('scheduled_date', { ascending: true });
    if (weekStartDate) query = query.gte('scheduled_date', weekStartDate);
    const { data, error } = await query.limit(2000);
    if (error) throw error;
    return (data ?? []).map(mapPlanItem);
  }

  async createWeeklyPlanItem(request: CreateWeeklyPlanItemRequest): Promise<WeeklyPlanItem> {
    const userCode = await whoami();
    let employerName: string | undefined;
    if (request.employerId) {
      const { data: emp } = await supabase
        .from('er_master')
        .select('name')
        .eq('regno', request.employerId)
        .maybeSingle();
      employerName = (emp as any)?.name ?? request.employerId;
    }

    const today = new Date();
    const dayOfWeek = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const weekStart = monday.toISOString().slice(0, 10);

    let { data: existingPlan } = await supabase
      .from('ce_weekly_plans')
      .select('id')
      .eq('week_start_date', weekStart)
      .in('status', ['DRAFT', 'APPROVED', 'IN_EXECUTION'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let planId = existingPlan?.id;
    if (!planId) {
      const friday = new Date(monday);
      friday.setDate(monday.getDate() + 4);
      const { data: newPlan, error: planErr } = await supabase
        .from('ce_weekly_plans')
        .insert({
          plan_number: `WP-${today.getFullYear()}-W${String(
            Math.ceil((today.getTime() - new Date(today.getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000))
          ).padStart(2, '0')}`,
          week_start_date: weekStart,
          week_end_date: friday.toISOString().slice(0, 10),
          status: 'DRAFT',
          total_planned_visits: 0,
          completed_visits: 0,
          created_by: userCode,
        })
        .select('id')
        .single();
      if (planErr) throw planErr;
      planId = newPlan.id;
    }

    const { data, error } = await supabase
      .from('ce_weekly_plan_items')
      .insert({
        plan_id: planId,
        item_type: request.itemType,
        employer_id: request.employerId ?? null,
        employer_name: employerName ?? null,
        territory: request.territory,
        scheduled_date: request.plannedDate,
        scheduled_start_time: request.plannedStartTime || null,
        scheduled_end_time: request.plannedEndTime || null,
        area_name: request.areaName ?? null,
        purpose: request.focusNotes ?? null,
        execution_status: 'NOT_STARTED',
        created_by: userCode,
      } as any)
      .select('*')
      .single();
    if (error) throw error;
    return mapPlanItem(data);
  }

  async getVisitByPlanItemId(planItemId: string): Promise<InspectionVisit | undefined> {
    const { data, error } = await supabase
      .from('ce_inspections')
      .select('*')
      .eq('plan_item_id', planItemId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return undefined;
    return mapInspection(data);
  }

  async checkIn(planItemId: string, request: CheckInRequest): Promise<InspectionVisit> {
    const { inspectionId } = await fieldAuditService.startAuditSession({
      planItemId,
      executionMode: 'ONSITE',
      startNotes: request.location ? `Check-in location: ${request.location}` : undefined,
    });

    const { data, error } = await supabase
      .from('ce_inspections')
      .select('*')
      .eq('id', inspectionId)
      .single();
    if (error) throw error;

    if (request.location) {
      const userCode = await whoami();
      await supabase
        .from('ce_inspections')
        .update({
          location_address: request.location,
          updated_at: new Date().toISOString(),
          updated_by: userCode,
        } as any)
        .eq('id', inspectionId);
      data.location_address = request.location;
    }

    return mapInspection(data);
  }

  async checkOut(visitId: string, request: CheckOutRequest): Promise<InspectionVisit> {
    const userCode = await whoami();
    await fieldAuditService.closeAuditSession({
      inspectionId: visitId,
      closeNotes: request.notes,
    });

    if (request.location) {
      await supabase
        .from('ce_inspections')
        .update({
          location_address: request.location,
          updated_at: new Date().toISOString(),
          updated_by: userCode,
        } as any)
        .eq('id', visitId);
    }

    const { data, error } = await supabase
      .from('ce_inspections')
      .select('*')
      .eq('id', visitId)
      .single();
    if (error) throw error;
    return mapInspection(data);
  }

  // ── Delegated to fieldAuditService (single source of truth) ──

  async getEvidenceForVisit(visitId: string): Promise<InspectionEvidence[]> {
    return fieldAuditService.getEvidenceForVisit(visitId);
  }

  async uploadEvidence(visitId: string, request: CreateEvidenceRequest): Promise<InspectionEvidence> {
    return fieldAuditService.uploadEvidence({
      inspectionId: visitId,
      file: request.file,
      evidenceType: request.evidenceType,
      description: request.description,
    });
  }

  async getFindingsForVisit(visitId: string): Promise<InspectionFinding[]> {
    if (visitId === 'all') {
      const { data, error } = await supabase
        .from('ce_inspection_findings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
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
        disposition: row.disposition ?? 'PENDING_REVIEW',
        reviewNotes: row.review_notes ?? undefined,
        reviewedBy: row.reviewed_by ?? undefined,
        evidenceIds: [],
        createdAt: row.created_at,
        createdByUserId: row.created_by ?? '',
        createdByName: row.created_by ?? '',
      }));
    }
    return fieldAuditService.getFindingsForVisit(visitId);
  }

  async createFinding(visitId: string, request: CreateFindingRequest): Promise<InspectionFinding> {
    const result = await fieldAuditService.createStructuredFinding({
      inspectionId: visitId,
      findingType: request.findingType,
      title: request.title,
      category: (request as any).category ?? request.findingType,
      description: request.description,
      severity: request.severity as any,
      recommendedAction: (request as any).recommendedAction,
      followUpRequired: (request as any).followUpRequired,
      evidenceIds: (request as any).evidenceIds,
    });
    const findings = await fieldAuditService.getFindingsForVisit(visitId);
    return findings.find((f) => f.id === result.id) ?? findings[0];
  }

  async markFindingAsViolationCreated(findingId: string, violationId: string): Promise<void> {
    const userCode = await whoami();
    const { error } = await supabase
      .from('ce_inspection_findings')
      .update({
        violation_created: true,
        violation_id: violationId,
        converted_by: userCode,
        converted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by: userCode,
      } as any)
      .eq('id', findingId);
    if (error) throw error;
  }

  /**
   * Organisation-wide recent findings (all employers), used by the Inspection
   * Findings screen when no employer context has been selected yet.
   */
  async getRecentFindings(limit = 200): Promise<
    (InspectionFinding & { employerName?: string; inspectionNumber?: string })[]
  > {
    const { data, error } = await supabase
      .from('ce_inspection_findings')
      .select(
        'id, inspection_id, finding_type, title, category, description, severity, ' +
          'recommended_action, follow_up_required, violation_created, violation_id, ' +
          'disposition, review_notes, reviewed_by, ' +
          'created_at, created_by, ce_inspections(inspection_number, employer_id, employer_name)',
      )
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      id: row.id,
      inspectionVisitId: row.inspection_id ?? '',
      employerId: row.ce_inspections?.employer_id ?? '',
      employerName: row.ce_inspections?.employer_name ?? undefined,
      inspectionNumber: row.ce_inspections?.inspection_number ?? undefined,
      findingType: row.finding_type ?? 'INFORMATION_ONLY',
      title: row.title ?? '',
      category: row.category ?? '',
      description: row.description ?? '',
      severity: row.severity ?? 'Medium',
      recommendedAction: row.recommended_action ?? undefined,
      followUpRequired: !!row.follow_up_required,
      isViolationCreated: !!row.violation_created,
      violationId: row.violation_id ?? undefined,
      disposition: row.disposition ?? 'PENDING_REVIEW',
      reviewNotes: row.review_notes ?? undefined,
      reviewedBy: row.reviewed_by ?? undefined,
      evidenceIds: [],
      createdAt: row.created_at,
      createdByUserId: row.created_by ?? '',
      createdByName: row.created_by ?? '',
    })) as any;
  }

  async getFindingsByEmployer(employerId: string): Promise<InspectionFinding[]> {
    const { data: inspections } = await supabase
      .from('ce_inspections')
      .select('id')
      .eq('employer_id', employerId);
    if (!inspections || inspections.length === 0) return [];
    const inspectionIds = inspections.map((i: any) => i.id);
    const { data, error } = await supabase
      .from('ce_inspection_findings')
      .select('*')
      .in('inspection_id', inspectionIds)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      id: row.id,
      inspectionVisitId: row.inspection_id ?? '',
      employerId,
      findingType: row.finding_type ?? 'INFORMATION_ONLY',
      title: row.title ?? '',
      category: row.category ?? '',
      description: row.description ?? '',
      severity: row.severity ?? 'Medium',
      recommendedAction: row.recommended_action ?? undefined,
      followUpRequired: !!row.follow_up_required,
      isViolationCreated: !!row.violation_created,
      violationId: row.violation_id ?? undefined,
      disposition: row.disposition ?? 'PENDING_REVIEW',
      reviewNotes: row.review_notes ?? undefined,
      reviewedBy: row.reviewed_by ?? undefined,
      evidenceIds: [],
      createdAt: row.created_at,
      createdByUserId: row.created_by ?? '',
      createdByName: row.created_by ?? '',
    }));
  }
}

export const inspectionService = new InspectionService();
