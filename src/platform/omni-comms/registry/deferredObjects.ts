/**
 * Omni-Comms — Deferred objects.
 *
 * Two objects were proposed during the audit but are NOT part of the
 * approved 19-object catalogue because they are satisfied by existing
 * shared platform infrastructure.
 */
import type { DeferredObjectEntry } from './registry.types';

export const OMNI_COMMS_DEFERRED_OBJECTS: readonly DeferredObjectEntry[] = [
  {
    proposedName: 'omni_comms_audit',
    reason: 'reuses_shared_infrastructure',
    replacedBy: 'public.core_audit_log',
    note: 'Runtime writes will emit audit entries via the shared audit log; a dedicated Omni-Comms audit table is not required.',
  },
  {
    proposedName: 'omni_comms_document',
    reason: 'reuses_shared_infrastructure',
    replacedBy: 'public.core_generated_document + core-documents storage bucket',
    note: 'Rendered letters and PDFs are archived through the shared generated-documents infrastructure.',
  },
] as const;

export const OMNI_COMMS_DEFERRED_OBJECT_COUNT = OMNI_COMMS_DEFERRED_OBJECTS.length;
