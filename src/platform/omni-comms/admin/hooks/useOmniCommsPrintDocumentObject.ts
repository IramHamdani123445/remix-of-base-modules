/**
 * Omni-Comms Print — local object URL for the archived PDF.
 *
 * Privacy/ad blockers (Opera, uBlock, Brave shields) frequently block frames
 * and requests pointing at the backend storage origin, which showed operators
 * "ERR_BLOCKED_BY_CLIENT" instead of the letter. The print-document edge
 * function therefore returns the PDF bytes inline (base64); we turn those into
 * a same-origin `blob:` URL, which nothing can block. When bytes are absent
 * (very large artefacts) we fall back to fetching the short-lived signed URL,
 * and only if that is blocked too do we surface an actionable message.
 */
import { useEffect, useState } from 'react';

export interface PrintDocumentObject {
  objectUrl: string | null;
  loading: boolean;
  /** True when the browser (extension/shield) prevented the download. */
  blocked: boolean;
}

export interface PrintDocumentSource {
  signedUrl?: string | null;
  contentBase64?: string | null;
}

function base64ToBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'application/pdf' });
}

export function useOmniCommsPrintDocumentObject(
  source: PrintDocumentSource | string | null | undefined,
): PrintDocumentObject {
  const normalised: PrintDocumentSource =
    typeof source === 'string' ? { signedUrl: source } : (source ?? {});
  const signedUrl = normalised.signedUrl ?? null;
  const contentBase64 = normalised.contentBase64 ?? null;

  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!signedUrl && !contentBase64) {
      setObjectUrl(null);
      setBlocked(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let created: string | null = null;
    setLoading(true);
    setBlocked(false);

    void (async () => {
      try {
        let blob: Blob | null = null;

        if (contentBase64) {
          blob = base64ToBlob(contentBase64);
        } else if (signedUrl) {
          const response = await fetch(signedUrl, { credentials: 'omit' });
          if (!response.ok) throw new Error(`status_${response.status}`);
          const raw = await response.blob();
          blob =
            raw.type === 'application/pdf'
              ? raw
              : new Blob([raw], { type: 'application/pdf' });
        }

        if (cancelled || !blob) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      } catch {
        if (!cancelled) {
          setObjectUrl(null);
          setBlocked(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [signedUrl, contentBase64]);

  return { objectUrl, loading, blocked };
}
