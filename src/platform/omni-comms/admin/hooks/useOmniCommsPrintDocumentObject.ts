/**
 * Omni-Comms Print — local object URL for the archived PDF.
 *
 * The signed storage URL points at the backend origin. Ad/tracker blockers
 * (Opera, uBlock, Brave shields) frequently block third-party document frames,
 * which shows the operator "ERR_BLOCKED_BY_CLIENT" instead of the letter. We
 * therefore fetch the bytes once and hand the viewer a same-origin `blob:` URL,
 * which no blocker interferes with. If even the fetch is blocked we surface a
 * clear, actionable message rather than a silent blank frame.
 */
import { useEffect, useState } from 'react';

export interface PrintDocumentObject {
  objectUrl: string | null;
  loading: boolean;
  /** True when the browser (extension/shield) prevented the download. */
  blocked: boolean;
}

export function useOmniCommsPrintDocumentObject(
  signedUrl: string | null | undefined,
): PrintDocumentObject {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!signedUrl) {
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
        const response = await fetch(signedUrl, { credentials: 'omit' });
        if (!response.ok) throw new Error(`status_${response.status}`);
        const blob = await response.blob();
        if (cancelled) return;
        created = URL.createObjectURL(
          blob.type === 'application/pdf'
            ? blob
            : new Blob([blob], { type: 'application/pdf' }),
        );
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
  }, [signedUrl]);

  return { objectUrl, loading, blocked };
}
