import { supabase } from '@/integrations/supabase/client';
import type { AuditBucket } from './auditFileAccess';

/**
 * Internal Audit — IA-POST-UAT-04 canonical attachment upload helper.
 *
 * This is the ONE upload path for Internal Audit attachments. It reuses the
 * existing private bucket (`audit-attachments`) and the existing convention of
 * persisting an OBJECT PATH (never a public URL, never a signed URL) alongside
 * the file metadata. Reads go through `auditFileAccess`.
 */

export const AUDIT_ATTACHMENT_BUCKET: AuditBucket = 'audit-attachments';

/** Canonical allowed MIME families for Internal Audit attachments. */
export const AUDIT_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
] as const;

export const AUDIT_ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg'] as const;

/** Canonical UI accept attribute — keep UI and validation from drifting. */
export const AUDIT_ACCEPT_ATTRIBUTE = '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg';

/** Canonical size ceiling (20 MB) shared by every audit attachment surface. */
export const AUDIT_MAX_FILE_SIZE = 20 * 1024 * 1024;

export function formatFileSize(bytes?: number | null): string {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extensionOf(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx === -1 ? '' : name.slice(idx + 1).toLowerCase();
}

/** Strip directory traversal and unsafe characters from a user-supplied file name. */
export function sanitizeAuditFileName(name: string): string {
  const base = (name || 'file').split(/[\\/]/).pop() || 'file';
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 120);
  return cleaned || 'file';
}

export interface AuditFileValidation {
  ok: boolean;
  reason?: string;
}

/** Validate a candidate attachment against the canonical audit policy. */
export function validateAuditFile(file: File): AuditFileValidation {
  if (!file) return { ok: false, reason: 'No file selected' };
  if (file.size === 0) return { ok: false, reason: 'The selected file is empty (0 bytes)' };
  if (file.size > AUDIT_MAX_FILE_SIZE) {
    return { ok: false, reason: `File exceeds the ${AUDIT_MAX_FILE_SIZE / (1024 * 1024)} MB limit` };
  }
  const ext = extensionOf(file.name);
  if (!(AUDIT_ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return { ok: false, reason: `Unsupported file type ".${ext || 'unknown'}"` };
  }
  if (file.type && !(AUDIT_ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, reason: `Unsupported content type "${file.type}"` };
  }
  return { ok: true };
}

/** Collision-safe, engagement-scoped object path inside the private bucket. */
export function buildAuditObjectPath(prefix: string, engagementId: string, ownerId: string, fileName: string): string {
  const safe = sanitizeAuditFileName(fileName);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}/${engagementId}/${ownerId}/${stamp}_${safe}`;
}

export interface UploadedAuditObject {
  path: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
}

/** Upload one validated file into the private audit bucket. Throws on failure. */
export async function uploadAuditAttachment(
  prefix: string,
  engagementId: string,
  ownerId: string,
  file: File,
): Promise<UploadedAuditObject> {
  const check = validateAuditFile(file);
  if (!check.ok) throw new Error(check.reason);
  const path = buildAuditObjectPath(prefix, engagementId, ownerId, file.name);
  const { error } = await supabase.storage
    .from(AUDIT_ATTACHMENT_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error(`Upload failed for "${file.name}": ${error.message}`);
  return {
    path,
    originalName: file.name,
    storedName: path.split('/').pop() || sanitizeAuditFileName(file.name),
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
  };
}

/** Best-effort orphan cleanup after a failed metadata write. Never throws. */
export async function removeAuditObjects(paths: string[]): Promise<void> {
  if (!paths.length) return;
  try {
    await supabase.storage.from(AUDIT_ATTACHMENT_BUCKET).remove(paths);
  } catch (err) {
    console.error('[auditAttachmentUpload] orphan cleanup failed', paths, err);
  }
}
