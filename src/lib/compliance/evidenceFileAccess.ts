/**
 * Compliance — Inspection Evidence secure file access.
 *
 * Inspection evidence (payroll extracts, employee photographs, signed visit
 * sheets) lives in the PRIVATE `ce-field-evidence` bucket. It must never be
 * reached through `getPublicUrl()` or a persisted absolute URL: the historic
 * register stored browser `blob:` URLs and public URLs for a bucket that does
 * not exist, which is why "Open File" silently failed.
 *
 * Access is always resolved as a short-lived signed URL, or streamed through
 * the authenticated SDK download path, so storage RLS decides the outcome.
 */
import { supabase } from '@/integrations/supabase/client';

export const EVIDENCE_BUCKET = 'ce-field-evidence';
const SIGNED_URL_TTL_SECONDS = 300;

export type EvidenceAccessFailure = {
  ok: false;
  reason: 'NO_FILE' | 'MISSING' | 'DENIED' | 'ERROR';
  message: string;
};

export type EvidenceAccessResult = { ok: true; url: string } | EvidenceAccessFailure;

/** Message for a failed access attempt (safe regardless of union narrowing). */
export function evidenceAccessMessage(res: EvidenceAccessResult): string {
  return res.ok ? '' : res.message;
}

export interface EvidenceFileRef {
  id: string;
  storage_bucket: string | null;
  storage_path: string | null;
  file_name: string;
  file_state: string | null;
}

/** Strip a legacy absolute URL back down to an object path. */
export function normaliseEvidencePath(bucket: string, value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith('blob:')) return null;
  const marker = `/${bucket}/`;
  const idx = value.indexOf(marker);
  if (idx === -1) return value.includes('://') ? null : value;
  return decodeURIComponent(value.slice(idx + marker.length).split('?')[0]);
}

async function logAccess(id: string, action: 'VIEW' | 'DOWNLOAD') {
  try {
    await (supabase.rpc as any)('ce_evidence_log_access_v1', { p_id: id, p_action: action });
  } catch {
    /* access logging must never block the user */
  }
}

async function flagState(id: string, state: 'AVAILABLE' | 'MISSING') {
  try {
    await (supabase.rpc as any)('ce_evidence_flag_file_state_v1', { p_id: id, p_state: state });
  } catch {
    /* best effort */
  }
}

/** Resolve a short-lived signed URL for an evidence file. */
export async function resolveEvidenceUrl(
  row: EvidenceFileRef,
  action: 'VIEW' | 'DOWNLOAD' = 'VIEW',
): Promise<EvidenceAccessResult> {
  const bucket = row.storage_bucket || EVIDENCE_BUCKET;
  const path = normaliseEvidencePath(bucket, row.storage_path);

  if (!path) {
    return {
      ok: false,
      reason: 'MISSING',
      message:
        'This evidence record has no stored file. The original capture was never uploaded to secure storage.',
    };
  }

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('not found') || msg.includes('object')) {
      await flagState(row.id, 'MISSING');
      return { ok: false, reason: 'MISSING', message: 'File unavailable — the stored object no longer exists.' };
    }
    if (msg.includes('unauthorized') || msg.includes('denied') || msg.includes('row-level')) {
      return { ok: false, reason: 'DENIED', message: 'You do not have permission to access this evidence.' };
    }
    return { ok: false, reason: 'ERROR', message: error.message };
  }

  if (!data?.signedUrl) {
    return { ok: false, reason: 'ERROR', message: 'Unable to resolve a secure link for this file.' };
  }

  await flagState(row.id, 'AVAILABLE');
  await logAccess(row.id, action);
  return { ok: true, url: data.signedUrl };
}

/** Download an evidence file through the authenticated SDK path. */
export async function downloadEvidenceFile(row: EvidenceFileRef): Promise<EvidenceAccessResult> {
  const bucket = row.storage_bucket || EVIDENCE_BUCKET;
  const path = normaliseEvidencePath(bucket, row.storage_path);
  if (!path) {
    return { ok: false, reason: 'MISSING', message: 'This evidence record has no stored file.' };
  }
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) {
    const msg = (error?.message || '').toLowerCase();
    if (msg.includes('unauthorized') || msg.includes('denied')) {
      return { ok: false, reason: 'DENIED', message: 'You do not have permission to access this evidence.' };
    }
    await flagState(row.id, 'MISSING');
    return { ok: false, reason: 'MISSING', message: 'File unavailable — the stored object could not be retrieved.' };
  }
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = row.file_name || 'evidence';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  await logAccess(row.id, 'DOWNLOAD');
  return { ok: true, url };
}

// ── Upload standards ────────────────────────────────────────────────
export const EVIDENCE_MAX_BYTES = 25 * 1024 * 1024;
export const EVIDENCE_ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
  'application/pdf', 'text/plain', 'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

export function sanitiseFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
}

export function validateEvidenceFile(file: File): string | null {
  if (file.size === 0) return 'The selected file is empty.';
  if (file.size > EVIDENCE_MAX_BYTES) return 'File exceeds the 25 MB evidence limit.';
  const type = file.type || '';
  if (type && !EVIDENCE_ALLOWED_MIME.includes(type)) {
    return `File type "${type}" is not an accepted evidence format.`;
  }
  return null;
}

/** Upload an evidence binary into the private bucket. Returns the object path. */
export async function uploadEvidenceObject(inspectionId: string, file: File): Promise<string> {
  const path = `${inspectionId}/${Date.now()}-${sanitiseFileName(file.name)}`;
  const { error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
  if (error) throw error;
  return path;
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const EVIDENCE_TYPE_LABELS: Record<string, string> = {
  DOCUMENT: 'Document',
  PHOTO: 'Photo',
  PAYROLL: 'Payroll',
  SIGNED_SHEET: 'Signed Sheet',
  NOTE: 'Note',
  AUDIO: 'Audio',
  OTHER: 'Other',
};

export function evidenceTypeLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return EVIDENCE_TYPE_LABELS[code.toUpperCase()] ?? code;
}

export function isPreviewable(row: { mime_type?: string | null; file_ext?: string | null }): 'image' | 'pdf' | null {
  const mime = (row.mime_type || '').toLowerCase();
  const ext = (row.file_ext || '').toLowerCase();
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  return null;
}
