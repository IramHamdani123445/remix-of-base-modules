import { supabase } from '@/integrations/supabase/client';

/**
 * Internal Audit — Wave 1 secure file access.
 *
 * Audit evidence, working papers, board packs and query attachments are held in
 * PRIVATE storage buckets (`ia-artifacts`, `ia-evidence`, `audit-attachments`).
 * They must never be reached through `getPublicUrl()`: on a private bucket that
 * call still returns a URL string, it simply 400s — which historically produced
 * dead "View" links — and on a public bucket it exposes audit evidence to
 * unauthenticated users (Wave 1 GAP-21-STORAGE).
 *
 * Always resolve a short-lived signed URL, or stream the object through the
 * authenticated SDK download path.
 */
export type AuditBucket = 'ia-artifacts' | 'ia-evidence' | 'audit-attachments';

const SIGNED_URL_TTL_SECONDS = 300;

/** Strip a legacy stored absolute URL back down to an object path. */
export function normaliseAuditFilePath(bucket: AuditBucket, value: string): string {
  if (!value) return value;
  const marker = `/${bucket}/`;
  const idx = value.indexOf(marker);
  if (idx === -1) return value;
  return value.slice(idx + marker.length).split('?')[0];
}

/** Resolve a short-lived signed URL for an audit file, or null when denied. */
export async function getAuditFileUrl(
  bucket: AuditBucket,
  path: string,
  expiresIn: number = SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  if (!path) return null;
  const objectPath = normaliseAuditFilePath(bucket, path);
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(objectPath, expiresIn);
  if (error) {
    console.error('[auditFileAccess] signed url failed', bucket, objectPath, error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

/** Open an audit file in a new tab using a signed URL. Returns false when denied. */
export async function openAuditFile(bucket: AuditBucket, path: string): Promise<boolean> {
  const url = await getAuditFileUrl(bucket, path);
  if (!url) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

/** Download an audit file through the authenticated SDK path. */
export async function downloadAuditFile(
  bucket: AuditBucket,
  path: string,
  fileName: string,
): Promise<void> {
  const objectPath = normaliseAuditFilePath(bucket, path);
  const { data, error } = await supabase.storage.from(bucket).download(objectPath);
  if (error) throw error;
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
