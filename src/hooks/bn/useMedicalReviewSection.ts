/**
 * BN Medical Reviews — per-section query state.
 *
 * A failed secondary query must NEVER be rendered as "no data". Each section
 * keeps its own independent status so a permission denial, a transport failure
 * and a genuinely empty result are visually distinct, and a failure in one
 * section never destroys the main review detail.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  describeMedicalReviewFailure,
  medicalReviewUiState,
  MedicalReviewError,
} from '@/features/bn/medical-reviews/model/errors';

export type SectionStatus =
  | 'loading'
  | 'loaded'
  | 'empty'
  | 'permission_denied'
  | 'failed'
  | 'not_applicable';

export interface SectionState<T> {
  status: SectionStatus;
  data: T | null;
  message: string | null;
  reload: () => void;
}

export interface UseSectionQueryOptions {
  /** When false the section reports `not_applicable` and issues no RPC. */
  enabled?: boolean;
  /** Reason shown for a `not_applicable` section. */
  notApplicableMessage?: string;
}

/**
 * @param key   changes to this value discard prior data and refetch
 * @param fetch the secured query RPC call
 * @param isEmpty decides whether a loaded result should read as "empty"
 */
export function useSectionQuery<T>(
  key: string | null,
  fetch: (() => Promise<T>) | null,
  isEmpty: (value: T) => boolean,
  options: UseSectionQueryOptions = {},
): SectionState<T> {
  const { enabled = true, notApplicableMessage = null } = options;

  const [status, setStatus] = useState<SectionStatus>('loading');
  const [data, setData] = useState<T | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const fetchRef = useRef(fetch);
  fetchRef.current = fetch;

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;

    if (!enabled || !key || !fetchRef.current) {
      setStatus('not_applicable');
      setData(null);
      setMessage(notApplicableMessage);
      return;
    }

    setStatus('loading');
    setData(null);
    setMessage(null);

    void (async () => {
      try {
        const value = await fetchRef.current!();
        if (cancelled) return;
        setData(value);
        setStatus(isEmpty(value) ? 'empty' : 'loaded');
      } catch (err) {
        if (cancelled) return;
        const uiState = medicalReviewUiState(err);
        const denied =
          err instanceof MedicalReviewError &&
          (err.code === 'E_FORBIDDEN' ||
            err.code === 'E_RECORD_FORBIDDEN' ||
            err.code === 'E_MEMBER_RECUSED');
        setData(null);
        setStatus(denied || uiState === 'PERMISSION_DENIED' ? 'permission_denied' : 'failed');
        setMessage(describeMedicalReviewFailure(err));
      }
    })();

    return () => {
      cancelled = true;
    };
    // `isEmpty` is intentionally excluded: callers pass inline predicates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, nonce, notApplicableMessage]);

  return { status, data, message, reload };
}
