/**
 * ce-risk-recalculation — scheduled / on-demand Compliance risk recalculation.
 *
 * Checkpoint E: this function contains NO scoring logic. All scoring is
 * delegated to the canonical database engine `ce_run_risk_recalculation_v1`
 * (which calls `ce_score_employer_risk_v1` per employer), so the scheduled run,
 * the manual UI run and the configuration preview are mathematically identical.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  employer_id?: string | null;
  limit?: number;
  dry_run?: boolean;
  triggered_by?: string;
  as_of?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const started = Date.now();
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    let body: RequestBody = {};
    try {
      body = (await req.json()) as RequestBody;
    } catch {
      body = {};
    }

    const { data, error } = await supabase.rpc('ce_run_risk_recalculation_v1', {
      p_employer_id: body.employer_id ?? null,
      p_limit: body.limit ?? 1000,
      p_dry_run: body.dry_run ?? false,
      p_triggered_by: body.triggered_by ?? 'SCHEDULED',
      p_as_of: body.as_of ?? new Date().toISOString().slice(0, 10),
    });

    if (error) {
      console.error('[ce-risk-recalculation] engine error', error.message);
      return new Response(
        JSON.stringify({ ok: false, error: 'Risk recalculation failed', detail: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const result = data as Record<string, unknown>;
    console.log('[ce-risk-recalculation] complete', {
      ok: result?.ok,
      processed: result?.processed,
      scored: result?.scored,
      errors: result?.errors,
      duration_ms: Date.now() - started,
    });

    return new Response(JSON.stringify({ ...result, duration_ms: Date.now() - started }), {
      status: result?.ok === false ? 409 : 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[ce-risk-recalculation] unexpected error', err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ ok: false, error: 'Unexpected error during risk recalculation' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
