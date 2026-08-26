/**
 * BN Gap Modules — Server-authorised command boundary (edge function).
 *
 * Responsibilities:
 *   1. Enforce JWT authentication (fail closed).
 *   2. Reconstruct the `actorUserId` from `getClaims(jwt).sub`; ignore what
 *      the wire claimed.
 *   3. Delegate to the transport-neutral gap command pipeline with Supabase-
 *      backed store implementations.
 *
 * This is the ONLY place today that materialises the server boundary. It
 * mirrors the shape of a future ASP.NET Core controller: request in →
 * pipeline → JSON response out.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  createBenefitsCommandPipeline,
  benefitsCommandHandlerRegistry,
  type BnGapCommandEnvelope,
} from './_shared.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...CORS, 'content-type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace('Bearer ', '');
  const { data: claimsRes, error: claimsErr } = await supabase.auth.getClaims(token);
  if (claimsErr || !claimsRes?.claims?.sub) return json({ error: 'Unauthorized' }, 401);
  const jwtSub = claimsRes.claims.sub;

  let envelope: BnGapCommandEnvelope;
  try {
    envelope = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  // Force actorUserId to match JWT — never trust the wire.
  envelope = { ...envelope, actorUserId: jwtSub };

  const pipeline = createBenefitsCommandPipeline({
    handlers: benefitsCommandHandlerRegistry,
    modules: {
      async load(moduleCode) {
        const { data } = await supabase
          .from('app_modules')
          .select('is_enabled,routes_enabled,actions_enabled')
          .eq('name', moduleCode)
          .maybeSingle();
        if (!data) return { exists: false, isEnabled: false, routesEnabled: false, actionsEnabled: false };
        return {
          exists: true,
          isEnabled: !!data.is_enabled,
          routesEnabled: !!data.routes_enabled,
          actionsEnabled: !!data.actions_enabled,
        };
      },
    },
    roles: {
      async actorHas(userId, capability) {
        // Fail-closed capability check via existing role_permissions.
        const { data, error } = await supabase.rpc('bn_actor_has_capability', {
          p_user_id: userId,
          p_capability: capability,
        });
        if (error) return false;
        return Boolean(data);
      },
    },
    idempotency: {
      async find(key) {
        const { data } = await supabase
          .from('bn_gap_idempotency')
          .select('result_json')
          .eq('idempotency_key', key)
          .maybeSingle();
        return (data?.result_json as any) ?? null;
      },
      async save(key, result) {
        await supabase.from('bn_gap_idempotency').insert({
          idempotency_key: key,
          command_name: result.data ? (envelope.commandName) : envelope.commandName,
          correlation_id: envelope.correlationId,
          result_json: result,
        });
      },
    },
    versions: {
      async currentVersion() { return null; },
    },
    audit: {
      async write(row) {
        const { data, error } = await supabase
          .from('bn_gap_command_log')
          .insert({
            command_id: row.commandId,
            command_name: row.envelope.commandName,
            command_version: row.envelope.commandVersion,
            module_code: row.envelope.moduleCode,
            entity_type: row.envelope.entityType,
            entity_id: row.envelope.entityId,
            correlation_id: row.envelope.correlationId,
            causation_id: row.envelope.causationId ?? null,
            actor_user_id: row.envelope.actorUserId,
            actor_user_code: row.envelope.actorUserCode,
            reason_code: row.reasonCode,
            justification: row.envelope.justification ?? null,
            outcome: row.outcome,
            before_value: row.before,
            after_value: row.after,
            requested_at: row.envelope.requestedAtUtc,
          })
          .select('command_id')
          .maybeSingle();
        if (error) throw error;
        return data?.command_id ?? row.commandId;
      },
    },
    transaction: {
      // Supabase Edge Functions have no cross-statement transaction primitive
      // via the JS client. Handlers MUST implement their mutations as a
      // single RPC per aggregate so PostgreSQL provides atomicity. The PING
      // command performs no writes, satisfying the boundary end-to-end today.
      async run(work) { return await work(); },
    },
    telemetry: {
      event(name, fields) { console.log(JSON.stringify({ evt: name, ...fields })); },
    },
  });

  const result = await pipeline.execute(envelope);
  return json(result, 200);

  function json(body: unknown, status: number) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  }
});
