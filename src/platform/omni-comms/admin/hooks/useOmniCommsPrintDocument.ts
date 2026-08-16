/**
 * Bound "Open & Print" transport.
 *
 * Views MUST use this hook rather than touching the browser Supabase client:
 * the edge function is the only path to the archived PDF, and it authorises
 * server-side before minting a short-lived signed URL.
 */
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { PrintDocumentInvoker } from "@/platform/omni-comms/application/printDocumentService";

export function useOmniCommsPrintDocumentInvoker(): PrintDocumentInvoker {
  return useMemo<PrintDocumentInvoker>(
    () => ({
      invoke: async (fn, options) => {
        const res = await supabase.functions.invoke(fn, options);
        return { data: res.data, error: res.error };
      },
    }),
    [],
  );
}
