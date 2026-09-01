import { supabase } from '@/integrations/supabase/client';
import { removeAuditObjects, type CompensatingCleanupResult } from './auditAttachmentUpload';

/**
 * Internal Audit — COMPENSATING ROLLBACK (not a transaction).
 *
 * Storage objects, `ia_evidence` rows and the `ia_working_papers` row live in
 * three different systems/statements. When a later step fails we can only
 * COMPENSATE for the earlier ones. Every compensating step is checked; a failed
 * step produces a deterministic orphan-cleanup defect that is returned to the
 * caller and logged — it is never silently swallowed, and the UI must not claim
 * "nothing was stored" unless `cleanup_succeeded` is true.
 */
export interface WorkingPaperRollbackInput {
  uploadedPaths: string[];
  evidenceIds: string[];
  workingPaperRowId?: string | null;
}

export async function compensateWorkingPaperFailure(
  input: WorkingPaperRollbackInput,
): Promise<CompensatingCleanupResult> {
  const errors: string[] = [];
  let attempted = false;

  const storage = await removeAuditObjects(input.uploadedPaths);
  attempted = attempted || storage.cleanup_attempted;
  errors.push(...storage.cleanup_errors);

  if (input.evidenceIds.length) {
    attempted = true;
    const { error } = await supabase.from('ia_evidence').delete().in('id', input.evidenceIds);
    if (error) errors.push(`ia_evidence cleanup failed (${input.evidenceIds.join(', ')}): ${error.message}`);
  }

  if (input.workingPaperRowId) {
    attempted = true;
    const { error } = await supabase.from('ia_working_papers').delete().eq('id', input.workingPaperRowId);
    if (error) errors.push(`ia_working_papers cleanup failed (${input.workingPaperRowId}): ${error.message}`);
  }

  if (errors.length) {
    console.error('[auditCompensatingRollback] ORPHAN-CLEANUP-DEFECT', { input, errors });
  }

  return {
    cleanup_attempted: attempted,
    cleanup_succeeded: errors.length === 0,
    cleanup_errors: errors,
  };
}

/** Deterministic user-facing wording for a compensating rollback outcome. */
export function describeRollback(result: CompensatingCleanupResult, message: string): string {
  if (!result.cleanup_attempted || result.cleanup_succeeded) {
    return `${message} Compensating rollback complete — nothing was retained.`;
  }
  return `${message} COMPENSATING ROLLBACK INCOMPLETE — orphaned records remain and were logged: ${result.cleanup_errors.join('; ')}`;
}
