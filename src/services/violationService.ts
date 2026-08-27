import { supabase } from '@/integrations/supabase/client';
import { fieldAuditService } from './fieldAuditService';
import {
  Violation,
  ViolationStatus,
  ViolationType,
  CreateViolationRequest,
  UpdateViolationRequest,
  LinkViolationToEmployerRequest
} from '@/types/violation';

/**
 * Best-effort canonical refresh of audit report counts after a violation mutation.
 * Never throws — count refresh failures must not block the violation operation itself.
 */
async function safeRefreshReportCounts(inspectionId?: string | null) {
  if (!inspectionId) return;
  try {
    await fieldAuditService.recomputeReportMetrics(inspectionId);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[violationService] recomputeReportMetrics failed', e);
  }
}

// ── Helper: map DB row to Violation type ──────────────────
function mapRow(row: any): Violation {
  return {
    id: row.id,
    violationNumber: row.violation_number ?? '',
    employerId: row.employer_id,
    employerName: row.employer_name,
    territory: row.territory ?? 'St Kitts',
    violationType: (row.ce_violation_types?.code ?? row.violation_type_id ?? 'OTHER') as ViolationType,
    status: (row.status ?? 'OPEN') as ViolationStatus,
    priority: row.priority ?? 'Medium',
    severity: row.severity,
    summary: row.summary ?? '',
    description: row.description,
    inspectionVisitId: row.inspection_id,
    inspectionFindingId: undefined,
    isUnlinked: row.is_unlinked ?? false,
    candidateBusinessName: row.candidate_business_name,
    candidateLocation: row.candidate_location,
    candidateActivityType: row.candidate_activity_type,
    estimatedEmployees: row.estimated_employees,
    assignedToUserId: row.assigned_to_user_id,
    assignedToName: row.assigned_to_name,
    discoveredDate: row.discovered_date ?? row.created_at?.slice(0, 10) ?? '',
    discoveredBy: row.discovered_by ?? 'SYSTEM',
    dueDate: row.due_date,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    resolutionNotes: row.resolution_notes,
    escalatedAt: row.escalated_at,
    escalatedTo: row.escalated_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Violation type code → ID resolution ───────────────────
async function resolveViolationTypeId(code: string): Promise<string | null> {
  const { data } = await supabase
    .from('ce_violation_types')
    .select('id')
    .eq('code', code)
    .maybeSingle();
  return data?.id ?? null;
}

const BASE_SELECT = '*, ce_violation_types(code, name, category)';

class ViolationService {
  async getAll(): Promise<Violation[]> {
    const { data, error } = await supabase
      .from('ce_violations')
      .select(BASE_SELECT)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) throw error;
    return (data || []).map(mapRow);
  }

  /**
   * Employer-scoped violation list. Used by employer-context screens so they
   * never have to pull the full (very large) violation table client-side.
   */
  async getByEmployerId(employerId: string): Promise<Violation[]> {
    const { data, error } = await supabase
      .from('ce_violations')
      .select(BASE_SELECT)
      .eq('is_deleted', false)
      .eq('employer_id', employerId)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    return (data || []).map(mapRow);
  }

  async getById(id: string): Promise<Violation | undefined> {
    const { data, error } = await supabase
      .from('ce_violations')
      .select(BASE_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapRow(data) : undefined;
  }

  async getByInspectorId(inspectorId: string): Promise<Violation[]> {
    const { data, error } = await supabase
      .from('ce_violations')
      .select(BASE_SELECT)
      .eq('is_deleted', false)
      .eq('assigned_to_user_id', inspectorId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapRow);
  }

  async getActiveByInspectorId(inspectorId: string): Promise<Violation[]> {
    const activeStatuses = ['OPEN', 'IN_PROGRESS', 'ESCALATED', 'UNDER_REVIEW'];
    const { data, error } = await supabase
      .from('ce_violations')
      .select(BASE_SELECT)
      .eq('is_deleted', false)
      .eq('assigned_to_user_id', inspectorId)
      .in('status', activeStatuses)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapRow);
  }

  async getUnlinkedViolations(): Promise<Violation[]> {
    const { data, error } = await supabase
      .from('ce_violations')
      .select(BASE_SELECT)
      .eq('is_deleted', false)
      .eq('is_unlinked', true)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapRow);
  }

  async getByVisitId(visitId: string): Promise<Violation[]> {
    const { data, error } = await supabase
      .from('ce_violations')
      .select(BASE_SELECT)
      .eq('is_deleted', false)
      .eq('inspection_id', visitId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapRow);
  }

  async create(request: CreateViolationRequest): Promise<Violation> {
    // Generate violation number
    const violationNumber = `VIO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;

    // Resolve violation type code to ID
    const violationTypeId = await resolveViolationTypeId(request.violationType);

    // Resolve employer name if ID provided
    let employerName: string | undefined;
    if (request.employerId) {
      const { data: emp } = await supabase
        .from('er_master')
        .select('name')
        .eq('regno', request.employerId)
        .maybeSingle();
      employerName = emp?.name ?? undefined;
    }

    const { data, error } = await supabase
      .from('ce_violations')
      .insert({
        violation_number: violationNumber,
        employer_id: request.employerId,
        employer_name: employerName ?? request.candidateBusinessName,
        violation_type_id: violationTypeId,
        status: 'OPEN',
        priority: request.priority,
        summary: request.summary,
        description: request.description,
        inspection_id: request.inspectionVisitId,
        is_unlinked: request.isUnlinked ?? false,
        candidate_business_name: request.candidateBusinessName,
        candidate_location: request.candidateLocation,
        candidate_activity_type: request.candidateActivityType,
        estimated_employees: request.estimatedEmployees,
        assigned_to_user_id: request.assignedToUserId,
        due_date: request.dueDate,
        discovered_date: new Date().toISOString().slice(0, 10),
        discovered_by: request.inspectionFindingId ? 'INSPECTION' : 'MANUAL',
        source_type: request.inspectionFindingId ? 'INSPECTION_FINDING' : 'MANUAL',
        source_finding_id: request.inspectionFindingId ?? null,
        created_by: 'SYSTEM',
        // Strong linkage (Phase 4)
        linked_evidence_ids: request.linkedEvidenceIds && request.linkedEvidenceIds.length
          ? request.linkedEvidenceIds
          : null,
        linked_checklist_response_id: request.linkedChecklistResponseId ?? null,
        linked_working_paper_id: request.linkedWorkingPaperId ?? null,
        related_prior_violation_id: request.relatedPriorViolationId ?? null,
        related_arrangement_id: request.relatedArrangementId ?? null,
        linkage_metadata: request.linkageMetadata ?? null,
      } as any)
      .select(BASE_SELECT)
      .single();

    if (error) throw error;
    // Refresh report snapshot counts so viewer/print/PDF stay in sync
    await safeRefreshReportCounts(request.inspectionVisitId);
    return mapRow(data);
  }

  async update(id: string, request: UpdateViolationRequest): Promise<Violation> {
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (request.status) updates.status = request.status;
    if (request.priority) updates.priority = request.priority;
    if (request.assignedToUserId) updates.assigned_to_user_id = request.assignedToUserId;
    if (request.dueDate) updates.due_date = request.dueDate;
    if (request.resolutionNotes) {
      updates.resolution_notes = request.resolutionNotes;
      if (request.status === ViolationStatus.RESOLVED || request.status === ViolationStatus.CLOSED) {
        updates.resolved_at = new Date().toISOString();
        updates.resolved_by = 'SYSTEM';
      }
    }

    const { data, error } = await supabase
      .from('ce_violations')
      .update(updates)
      .eq('id', id)
      .select(BASE_SELECT)
      .single();

    if (error) throw error;
    // Status changes (resolved/closed) flip canonical counts via the
    // is_deleted-aware filter — refresh to keep report snapshot in sync.
    await safeRefreshReportCounts((data as any)?.inspection_id);
    return mapRow(data);
  }

  async linkToEmployer(request: LinkViolationToEmployerRequest): Promise<Violation> {
    // Resolve employer name
    const { data: emp } = await supabase
      .from('er_master')
      .select('name')
      .eq('regno', request.employerId)
      .maybeSingle();

    const { data, error } = await supabase
      .from('ce_violations')
      .update({
        employer_id: request.employerId,
        employer_name: emp?.name ?? 'Unknown',
        is_unlinked: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', request.violationId)
      .select(BASE_SELECT)
      .single();

    if (error) throw error;
    return mapRow(data);
  }

  async searchPotentialMatches(territory: string, businessName?: string): Promise<Violation[]> {
    let query = supabase
      .from('ce_violations')
      .select(BASE_SELECT)
      .eq('is_deleted', false)
      .eq('is_unlinked', true)
      .eq('territory', territory);

    if (businessName) {
      query = query.ilike('candidate_business_name', `%${businessName}%`);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapRow);
  }
}

export const violationService = new ViolationService();
