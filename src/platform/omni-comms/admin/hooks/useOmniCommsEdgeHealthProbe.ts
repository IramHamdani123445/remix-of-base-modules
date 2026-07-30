/**
 * Omni-Comms — safe Edge health probe hook (Phase 3 Live Diagnostics).
 *
 * Performs a GET request against the `omni-comms-runtime` function's
 * non-mutating `/health` path. It never posts a send request, never uses a
 * service-role credential, never reads environment values and never returns
 * credential material — only bounded availability facts.
 */
import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { EdgeHealthProbeResult } from "@/platform/omni-comms/application/healthDiagnosticsTypes";
import { mapHealthError } from "@/platform/omni-comms/application/healthDiagnosticsService";

const FUNCTION_NAME = "omni-comms-runtime";

function functionsBaseUrl(): string {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  return url ? `${url.replace(/\/$/, "")}/functions/v1` : "/functions/v1";
}

export interface UseEdgeHealthProbe {
  result: EdgeHealthProbeResult | null;
  probing: boolean;
  probe: () => Promise<EdgeHealthProbeResult>;
}

export function useOmniCommsEdgeHealthProbe(): UseEdgeHealthProbe {
  const [result, setResult] = useState<EdgeHealthProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const inflight = useRef<AbortController | null>(null);

  const probe = useCallback(async (): Promise<EdgeHealthProbeResult> => {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setProbing(true);
    const checkedAt = new Date().toISOString();
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
      const res = await fetch(`${functionsBaseUrl()}/${FUNCTION_NAME}/health`, {
        method: "GET",
        signal: controller.signal,
        headers: {
          ...(anon ? { apikey: anon } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        const out: EdgeHealthProbeResult = {
          available: false,
          functionName: FUNCTION_NAME,
          buildTag: null,
          runtimeVersion: null,
          certificationState: null,
          liveDeliveryEnabled: null,
          checkedAt,
          error: {
            kind: "edge_unavailable",
            message: "The runtime health probe did not respond successfully.",
            retryable: true,
          },
        };
        setResult(out);
        return out;
      }
      const body = (await res.json()) as Record<string, unknown>;
      const out: EdgeHealthProbeResult = {
        available: body.available === true,
        functionName: FUNCTION_NAME,
        buildTag: typeof body.buildTag === "string" ? body.buildTag : null,
        runtimeVersion: typeof body.runtimeVersion === "string" ? body.runtimeVersion : null,
        certificationState:
          typeof body.certificationState === "string" ? body.certificationState : null,
        liveDeliveryEnabled:
          typeof body.liveDeliveryEnabled === "boolean" ? body.liveDeliveryEnabled : null,
        checkedAt,
        error: null,
      };
      setResult(out);
      return out;
    } catch (err) {
      const out: EdgeHealthProbeResult = {
        available: false,
        functionName: FUNCTION_NAME,
        buildTag: null,
        runtimeVersion: null,
        certificationState: null,
        liveDeliveryEnabled: null,
        checkedAt,
        error: { ...mapHealthError(err), kind: "edge_unavailable" },
      };
      setResult(out);
      return out;
    } finally {
      setProbing(false);
      if (inflight.current === controller) inflight.current = null;
    }
  }, []);

  return { result, probing, probe };
}
