/**
 * Omni-Comms C6 — trusted Release Control Edge boundary.
 *
 * The ONLY purpose of this function is second-person approval and activation
 * of a controlled pilot, using the deployed revision that only the server can
 * observe.
 *
 * Hard boundaries (permanent):
 *   - Sends no Email. Contacts no provider. Imports no provider SDK.
 *   - Reads no provider credential.
 *   - Performs no runtime delivery write (no request, message, dispatch job,
 *     delivery attempt or message event).
 *   - Returns only bounded release-control projections.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * The deployed revision of this runtime. Injected at deploy time. It is never
 * accepted from the caller — the browser must not be able to influence the
 * certification match.
 */
function deployedRevision(): string | null {
  const raw = (Deno.env.get('OMNI_COMMS_DEPLOYED_REVISION') ?? '').trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(raw) ? raw : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);

  const anon = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const token = authHeader.replace('Bearer ', '');
  const { data: claimsData, error: claimsError } = await anon.auth.getClaims(token);
  if (claimsError || !claimsData?.claims?.sub) return json({ error: 'unauthorized' }, 401);
  const actorId = claimsData.claims.sub as string;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  if (body.action !== 'approve_activate') return json({ error: 'unsupported_action' }, 400);

  const releaseControlId = typeof body.releaseControlId === 'string' ? body.releaseControlId : '';
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : '';
  const expectedFingerprint =
    typeof body.expectedFingerprint === 'string' ? body.expectedFingerprint : '';
  if (!releaseControlId || !expectedUpdatedAt || !expectedFingerprint) {
    return json({ error: 'invalid_body' }, 400);
  }

  const revision = deployedRevision();
  if (!revision) {
    return json(
      {
        error: 'deployed_revision_unavailable',
        detail:
          'The deployed Edge revision is not a full 40-character SHA, so it cannot be '
          + 'matched against the certified commit. Activation fails closed.',
      },
      409,
    );
  }

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data, error } = await service.rpc(
    'omni_comms_priv_channel_release_approve_activate',
    {
      p_actor_id: actorId,
      p_release_control_id: releaseControlId,
      p_expected_updated_at: expectedUpdatedAt,
      p_expected_fingerprint: expectedFingerprint,
      p_deployed_revision: revision,
      p_approval_note: typeof body.approvalNote === 'string' ? body.approvalNote : null,
      p_correlation_id: typeof body.correlationId === 'string' ? body.correlationId : null,
    },
  );

  if (error) {
    return json({ error: error.message ?? 'release_activation_failed' }, 400);
  }

  return json({ release: data, deployed_revision: revision, business_dispatch_implemented: false });
});
