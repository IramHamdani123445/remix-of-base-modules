import { supabase } from '@/integrations/supabase/client';
import type { BnServiceDocType, BnDocRequirement, BnClaimEvidence, BnEvidenceAudit, BnEvidenceChecklist } from '@/types/bn';

const db = supabase as any;

// ── Reference Data ──

export interface ServiceDocTypeListOptions {
  activeOnly?: boolean;
  withCounts?: boolean;
  withLibrary?: boolean;
}

export async function fetchServiceDocTypes(opts: ServiceDocTypeListOptions = {}): Promise<BnServiceDocType[]> {
  const { activeOnly = false, withCounts = true, withLibrary = true } = opts;
  let query = db.from('bn_service_doc_type').select('*').order('type_name');
  if (activeOnly) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data || []) as BnServiceDocType[];
  if (rows.length === 0) return rows;

  // Optional Document Library names
  if (withLibrary) {
    const libIds = Array.from(new Set(rows.map(r => r.document_library_id).filter(Boolean))) as string[];
    if (libIds.length > 0) {
      const { data: libs } = await db
        .from('module_doc_configs')
        .select('id, document_name')
        .in('id', libIds);
      const libMap = new Map<string, string>((libs || []).map((l: any) => [l.id, l.document_name]));
      rows.forEach(r => {
        r.document_library_name = r.document_library_id ? libMap.get(r.document_library_id) ?? null : null;
      });
    }
  }

  // Usage counts from bn_doc_requirement (Product Catalog)
  if (withCounts) {
    const codes = rows.map(r => r.type_code);
    const { data: reqs } = await db
      .from('bn_doc_requirement')
      .select('document_type_code, product_id, stage, is_active')
      .in('document_type_code', codes)
      .eq('is_active', true);
    const productsByCode = new Map<string, Set<string>>();
    const stagesByCode = new Map<string, Set<string>>();
    (reqs || []).forEach((r: any) => {
      if (!productsByCode.has(r.document_type_code)) productsByCode.set(r.document_type_code, new Set());
      if (!stagesByCode.has(r.document_type_code)) stagesByCode.set(r.document_type_code, new Set());
      if (r.product_id) productsByCode.get(r.document_type_code)!.add(r.product_id);
      if (r.stage) stagesByCode.get(r.document_type_code)!.add(r.stage);
    });
    rows.forEach(r => {
      r.used_by_products_count = productsByCode.get(r.type_code)?.size ?? 0;
      r.used_by_workflows_count = stagesByCode.get(r.type_code)?.size ?? 0;
    });
  }

  return rows;
}

export async function upsertServiceDocType(record: Partial<BnServiceDocType>): Promise<BnServiceDocType> {
  // Validation: cannot link an inactive Document Library entry on a new record
  if (record.document_library_id) {
    const { data: lib } = await db
      .from('module_doc_configs')
      .select('id, is_active')
      .eq('id', record.document_library_id)
      .maybeSingle();
    if (lib && lib.is_active === false && !record.id) {
      throw new Error('Cannot link an inactive Document Library entry to a new Service Document Type.');
    }
  }
  // Strip computed fields before persisting
  const { document_library_name, used_by_products_count, used_by_workflows_count, ...persistable } = record as any;
  const { data, error } = await db
    .from('bn_service_doc_type')
    .upsert(persistable, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return data as BnServiceDocType;
}

export async function deleteServiceDocType(id: string): Promise<void> {
  const { error } = await db.from('bn_service_doc_type').delete().eq('id', id);
  if (error) throw error;
}

// Flat Document Library list for the Service Doc Type linkage dropdown
export async function fetchDocumentLibraryOptions(): Promise<Array<{ id: string; document_name: string; is_active: boolean }>> {
  const { data, error } = await db
    .from('module_doc_configs')
    .select('id, document_name, is_active')
    .order('document_name');
  if (error) throw error;
  return (data || []) as Array<{ id: string; document_name: string; is_active: boolean }>;
}

// ── Doc Requirements ──

export async function fetchDocRequirements(productId?: string, stage?: string): Promise<BnDocRequirement[]> {
  let query = db.from('bn_doc_requirement').select('*').eq('is_active', true).order('sort_order');
  if (productId) query = query.eq('product_id', productId);
  if (stage) query = query.eq('stage', stage);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as BnDocRequirement[];
}

export async function upsertDocRequirement(record: Partial<BnDocRequirement>): Promise<BnDocRequirement> {
  const { data, error } = await db
    .from('bn_doc_requirement')
    .upsert(record, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return data as BnDocRequirement;
}

export async function deleteDocRequirement(id: string): Promise<void> {
  const { error } = await db.from('bn_doc_requirement').delete().eq('id', id);
  if (error) throw error;
}

// ── Claim Evidence ──

export async function fetchClaimEvidence(claimId: string): Promise<BnClaimEvidence[]> {
  const { data, error } = await db
    .from('bn_claim_evidence')
    .select('*')
    .eq('claim_id', claimId)
    .order('entered_at', { ascending: false });
  if (error) throw error;
  return (data || []) as BnClaimEvidence[];
}

// Client-side SHA-256
async function computeSHA256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Placeholder virus scan
async function scanFile(_file: File): Promise<{ clean: boolean }> {
  return { clean: true };
}

export interface UploadEvidenceParams {
  claimId: string;
  file: File;
  documentTypeCode: string;
  documentName: string;
  requirementId?: string | null;
  source?: string;
  notes?: string;
  enteredBy: string;
}

export async function uploadEvidence(params: UploadEvidenceParams): Promise<BnClaimEvidence> {
  const { claimId, file, documentTypeCode, documentName, requirementId, source, notes, enteredBy } = params;

  // Virus scan placeholder
  const scanResult = await scanFile(file);
  if (!scanResult.clean) throw new Error('File failed security scan');

  // Compute checksum
  const checksum = await computeSHA256(file);

  // Generate unique path
  const evidenceId = crypto.randomUUID();
  const filePath = `${claimId}/${evidenceId}/${file.name}`;

  // Upload to storage
  const { error: uploadErr } = await supabase.storage
    .from('bn-evidence')
    .upload(filePath, file, { contentType: file.type });
  if (uploadErr) throw uploadErr;

  // Compute expiry if requirement has expiry_days
  let expiresAt: string | null = null;
  if (requirementId) {
    const { data: req } = await db.from('bn_doc_requirement').select('expiry_days').eq('id', requirementId).single();
    if (req?.expiry_days) {
      const d = new Date();
      d.setDate(d.getDate() + req.expiry_days);
      expiresAt = d.toISOString().split('T')[0];
    }
  }

  // Insert evidence record
  const record = {
    id: evidenceId,
    claim_id: claimId,
    requirement_id: requirementId || null,
    document_type_code: documentTypeCode,
    document_name: documentName,
    file_name: file.name,
    file_path: filePath,
    file_size: file.size,
    mime_type: file.type,
    storage_bucket: 'bn-evidence',
    checksum_sha256: checksum,
    source: source || 'UPLOAD',
    status: 'RECEIVED',
    expires_at: expiresAt,
    metadata: notes ? { notes } : {},
    entered_by: enteredBy,
  };

  const { data, error } = await db.from('bn_claim_evidence').insert(record).select().single();
  if (error) throw error;

  // Write audit
  await db.from('bn_evidence_audit').insert({
    evidence_id: evidenceId,
    claim_id: claimId,
    action: 'UPLOAD',
    from_status: null,
    to_status: 'RECEIVED',
    reason: notes || null,
    performed_by: enteredBy,
  });

  // Update checklist if linked to requirement
  if (requirementId) {
    await db.from('bn_evidence_checklist')
      .update({ evidence_id: evidenceId, status: 'FULFILLED', is_blocking: false, modified_at: new Date().toISOString() })
      .eq('claim_id', claimId)
      .eq('requirement_id', requirementId)
      .eq('status', 'OUTSTANDING');
  }

  return data as BnClaimEvidence;
}

// ── Status Transitions ──

async function transitionEvidence(
  evidenceId: string,
  action: string,
  toStatus: string,
  updates: Record<string, unknown>,
  reason: string | null,
  performedBy: string
): Promise<BnClaimEvidence> {
  // Get current
  const { data: current, error: getErr } = await db.from('bn_claim_evidence').select('*').eq('id', evidenceId).single();
  if (getErr || !current) throw new Error('Evidence record not found');

  const fromStatus = current.status;

  // Update
  const { data, error } = await db
    .from('bn_claim_evidence')
    .update({ ...updates, status: toStatus, modified_by: performedBy, modified_at: new Date().toISOString() })
    .eq('id', evidenceId)
    .select()
    .single();
  if (error) throw error;

  // Audit
  await db.from('bn_evidence_audit').insert({
    evidence_id: evidenceId,
    claim_id: current.claim_id,
    action,
    from_status: fromStatus,
    to_status: toStatus,
    reason,
    performed_by: performedBy,
  });

  // Update checklist
  if (current.requirement_id) {
    const checklistStatus = toStatus === 'VERIFIED' ? 'FULFILLED' : toStatus === 'WAIVED' ? 'WAIVED' : toStatus === 'REJECTED' ? 'REJECTED' : toStatus === 'EXPIRED' ? 'EXPIRED' : null;
    if (checklistStatus) {
      const isBlocking = checklistStatus !== 'FULFILLED' && checklistStatus !== 'WAIVED';
      await db.from('bn_evidence_checklist')
        .update({ status: checklistStatus, is_blocking: isBlocking, modified_at: new Date().toISOString() })
        .eq('claim_id', current.claim_id)
        .eq('requirement_id', current.requirement_id);
    }
  }

  return data as BnClaimEvidence;
}

export async function verifyEvidence(evidenceId: string, userCode: string): Promise<BnClaimEvidence> {
  return transitionEvidence(evidenceId, 'VERIFY', 'VERIFIED', {
    verified_by: userCode, verified_at: new Date().toISOString(),
  }, null, userCode);
}

export async function rejectEvidence(evidenceId: string, reason: string, userCode: string): Promise<BnClaimEvidence> {
  return transitionEvidence(evidenceId, 'REJECT', 'REJECTED', {
    rejected_by: userCode, rejected_at: new Date().toISOString(), rejection_reason: reason,
  }, reason, userCode);
}

export async function waiveEvidence(evidenceId: string, reason: string, authorityLevel: number, userCode: string): Promise<BnClaimEvidence> {
  return transitionEvidence(evidenceId, 'WAIVE', 'WAIVED', {
    waived_by: userCode, waived_at: new Date().toISOString(), waiver_reason: reason, waiver_authority_level: authorityLevel,
  }, reason, userCode);
}

export async function requestMoreInfo(evidenceId: string, reason: string, userCode: string): Promise<BnClaimEvidence> {
  return transitionEvidence(evidenceId, 'REQUEST_INFO', 'PENDING_INFO', {
    status_reason: reason,
  }, reason, userCode);
}

// ── Checklist ──

export async function getEvidenceChecklist(claimId: string): Promise<BnEvidenceChecklist[]> {
  const { data, error } = await db
    .from('bn_evidence_checklist')
    .select('*, bn_doc_requirement(*), bn_claim_evidence(*)')
    .eq('claim_id', claimId)
    .order('entered_at');
  if (error) throw error;
  return (data || []) as BnEvidenceChecklist[];
}

export async function isEvidenceComplete(claimId: string): Promise<boolean> {
  // `is_blocking` alone is not trustworthy (legacy rows derived it from
  // `blocks_submission` only). A MANDATORY or decision-blocking requirement
  // is incomplete until it is verified/fulfilled/waived, whatever the flag.
  const { data, error } = await db
    .from('bn_evidence_checklist')
    .select('id, status, is_blocking, bn_doc_requirement(requirement_level, blocks_decision)')
    .eq('claim_id', claimId);
  if (error) throw error;
  const satisfied = ['FULFILLED', 'VERIFIED', 'WAIVED'];
  const incomplete = (data || []).filter((r: any) => {
    const blocking = r.is_blocking === true ||
      r.bn_doc_requirement?.requirement_level === 'MANDATORY' ||
      r.bn_doc_requirement?.blocks_decision === true;
    return blocking && !satisfied.includes(String(r.status ?? '').toUpperCase());
  });
  return incomplete.length === 0;
}

export async function generateEvidenceChecklist(claimId: string, productId: string, stage?: string): Promise<void> {
  // Fetch requirements for this product
  const requirements = await fetchDocRequirements(productId, stage);
  if (requirements.length === 0) return;

  // Build checklist rows
  const rows = requirements.map(req => ({
    claim_id: claimId,
    requirement_id: req.id,
    status: 'OUTSTANDING',
    is_blocking: req.requirement_level === 'MANDATORY',
  }));

  const { error } = await db.from('bn_evidence_checklist').insert(rows);
  if (error) throw error;
}

/**
 * Officer-only: mark a checklist row as pending (document not yet provided
 * but intake may proceed). Writes an audit row.
 */
export async function markChecklistPending(
  claimId: string,
  checklistId: string,
  reason: string,
  userCode: string,
): Promise<void> {
  if (!reason?.trim()) throw new Error('A reason is required to mark a document pending.');
  const { error } = await db
    .from('bn_evidence_checklist')
    .update({
      status: 'PENDING',
      is_blocking: false,
      modified_by: userCode,
      modified_at: new Date().toISOString(),
    })
    .eq('id', checklistId);
  if (error) throw error;
  await db.from('bn_evidence_audit').insert({
    claim_id: claimId,
    evidence_id: null,
    action: 'MARK_PENDING',
    from_status: 'OUTSTANDING',
    to_status: 'PENDING',
    reason,
    performed_by: userCode,
  });
}

/**
 * Officer-only: waive a checklist row directly (when no evidence record
 * exists yet). Requires reason + permission check at the call site.
 */
export async function waiveChecklistItem(
  claimId: string,
  checklistId: string,
  reason: string,
  userCode: string,
): Promise<void> {
  if (!reason?.trim()) throw new Error('A reason is required to waive a document.');
  const { error } = await db
    .from('bn_evidence_checklist')
    .update({
      status: 'WAIVED',
      is_blocking: false,
      modified_by: userCode,
      modified_at: new Date().toISOString(),
    })
    .eq('id', checklistId);
  if (error) throw error;
  await db.from('bn_evidence_audit').insert({
    claim_id: claimId,
    evidence_id: null,
    action: 'WAIVE_CHECKLIST',
    from_status: 'OUTSTANDING',
    to_status: 'WAIVED',
    reason,
    performed_by: userCode,
  });
}

// ── Audit ──

export async function fetchEvidenceAudit(claimId: string): Promise<BnEvidenceAudit[]> {
  const { data, error } = await db
    .from('bn_evidence_audit')
    .select('*, bn_claim_evidence(document_name, document_type_code)')
    .eq('claim_id', claimId)
    .order('performed_at', { ascending: false });
  if (error) throw error;
  return (data || []) as BnEvidenceAudit[];
}
