/**
 * Epic 2 — Story 3: bound Omni-Comms RPC client hook.
 *
 * Returns a stable adapter conforming to the OmniCommsRpcClient structural
 * type used by src/platform/omni-comms/application/eventCatalogueService.ts.
 * Views MUST consume this hook and MUST NOT touch the browser Supabase
 * client directly for Omni-Comms RPCs.
 */
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { OmniCommsRpcClient } from "@/platform/omni-comms/application/eventCatalogueService";

export function useOmniCommsRpcClient(): OmniCommsRpcClient {
  return useMemo<OmniCommsRpcClient>(
    () => ({
      rpc: async (fn, args) => {
        // Cast is required because the browser client's typed RPC surface
        // only knows generated function names.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (supabase as any).rpc(fn, args ?? {});
        return { data: res.data, error: res.error };
      },
    }),
    [],
  );
}
