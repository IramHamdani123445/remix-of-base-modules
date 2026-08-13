/**
 * Omni-Comms — read-only automation status poll.
 *
 * Polls the trusted server projection while the Activity surface is visible.
 * Polling is a CLIENT read only: it schedules nothing, mints no tickets and
 * never triggers a worker run.
 *
 * Resilience rules:
 *  - A transient refresh failure MUST NOT erase the last known good status.
 *    We keep the previous projection and raise a bounded warning flag instead.
 *  - Raw RPC errors are never surfaced.
 *  - Polling suspends while the document is hidden (browser optimisation only;
 *    no scheduler behaviour changes) and resumes on visibility.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AUTOMATION_REFRESH_MS,
  getAutomationStatus,
  type AutomationStatus,
} from '@/platform/omni-comms/application/automationStatusService';
import { useOmniCommsRpcClient } from './useOmniCommsRpcClient';

export const AUTOMATION_REFRESH_ERROR_MESSAGE = 'Unable to refresh automation status.';

export interface UseAutomationStatusResult {
  status: AutomationStatus | null;
  loading: boolean;
  /** Bounded, non-technical warning shown when the last refresh failed. */
  refreshError: string | null;
  refresh: () => void;
}

export function useAutomationStatus(
  organizationId: string | null,
  enabled: boolean,
): UseAutomationStatusResult {
  const client = useOmniCommsRpcClient();
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (!enabled || !organizationId || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      setStatus(await getAutomationStatus(client, { organizationId }));
      setRefreshError(null);
    } catch {
      // Observability only — retain the last known good state.
      setRefreshError(AUTOMATION_REFRESH_ERROR_MESSAGE);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [client, enabled, organizationId]);

  useEffect(() => {
    if (!enabled || !organizationId) return;

    let timer: number | null = null;
    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const start = () => {
      if (timer !== null) return;
      timer = window.setInterval(() => void load(), AUTOMATION_REFRESH_MS);
    };
    const visible = () =>
      typeof document === 'undefined' || document.visibilityState === 'visible';

    const onVisibility = () => {
      if (visible()) {
        void load();
        start();
      } else {
        stop();
      }
    };

    if (visible()) {
      void load();
      start();
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, organizationId, load]);

  return { status, loading, refreshError, refresh: () => void load() };
}
