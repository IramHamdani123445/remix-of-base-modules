/**
 * Omni-Comms — read-only automation status poll.
 *
 * Polls the trusted server projection while the Activity surface is visible.
 * Polling is a CLIENT read only: it schedules nothing, mints no tickets and
 * never triggers a worker run.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AUTOMATION_REFRESH_MS,
  getAutomationStatus,
  type AutomationStatus,
} from '@/platform/omni-comms/application/automationStatusService';
import { useOmniCommsRpcClient } from './useOmniCommsRpcClient';

export interface UseAutomationStatusResult {
  status: AutomationStatus | null;
  loading: boolean;
  refresh: () => void;
}

export function useAutomationStatus(
  organizationId: string | null,
  enabled: boolean,
): UseAutomationStatusResult {
  const client = useOmniCommsRpcClient();
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (!enabled || !organizationId || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      setStatus(await getAutomationStatus(client, { organizationId }));
    } catch {
      // Automation status is observability only — never break the surface.
      setStatus(null);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [client, enabled, organizationId]);

  useEffect(() => {
    if (!enabled || !organizationId) return;
    void load();
    const timer = window.setInterval(() => void load(), AUTOMATION_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [enabled, organizationId, load]);

  return { status, loading, refresh: () => void load() };
}
