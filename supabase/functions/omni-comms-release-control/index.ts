/**
 * Omni-Comms C6 — trusted Release Control Edge boundary.
 *
 * Purpose:
 *   - second-person approval and activation of a controlled pilot, using the
 *     deployed revision that only the server can observe;
 *   - trusted confirmation of the authoritative runtime environment;
 *   - a bounded read of the deployment identity (runtime + dispatcher).
 *
 * Hard boundaries (permanent):
 *   - Sends no Email. Contacts no provider. Imports no provider SDK.
 *   - Reads no provider credential.
 *   - Performs no runtime delivery write (no request, message, dispatch job,
 *     delivery attempt or message event).
 *   - Never enables live delivery and never certifies a commit automatically.
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

  const serviceClient = () =>
    createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

  /**
   * Bounded deployment identity. The revisions are read server-side only; the
   * browser cannot supply or influence them.
   */
  if (body.action === 'deployment_status') {
    const runtimeRevision = deployedRevision();
    let dispatcherRevision: string | null = null;
    try {
      const res = await fetch(
        `${Deno.env.get('SUPABASE_URL')}/functions/v1/omni-comms-dispatch/health`,
        { headers: { Authorization: `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}` } },
      );
      if (res.ok) {
        const health = await res.json();
        const raw = String(health?.revision ?? '').trim().toLowerCase();
        dispatcherRevision = /^[0-9a-f]{40}$/.test(raw) ? raw : null;
      }
    } catch {
      dispatcherRevision = null;
    }

    const svc = serviceClient();
    const { data: cert } = await svc.rpc('omni_comms_priv_runtime_certification');
    const { data: env } = await svc.rpc('omni_comms_priv_runtime_environment');

    const revisionMismatch =
      runtimeRevision !== null && dispatcherRevision !== null
      && runtimeRevision !== dispatcherRevision;

    return json({
      environment: env ?? 'unknown',
      runtime_revision: runtimeRevision,
      dispatcher_revision: dispatcherRevision,
      release_identity: revisionMismatch ? null : (runtimeRevision ?? dispatcherRevision),
      deployment_revision_mismatch: revisionMismatch,
      certification: cert ?? null,
    });
  }

  /**
   * Trusted confirmation of the authoritative runtime environment.
   *
   * A browser cannot classify itself: `non_production` is accepted only when
   * trusted deployment metadata already declares it. Confirming the
   * environment never enables delivery, never certifies a commit and never
   * contacts a provider.
   */
  if (body.action === 'confirm_environment') {
    const requested = String(body.environment ?? '').trim().toLowerCase();
    if (requested !== 'production' && requested !== 'non_production') {
      return json({ error: 'invalid_environment' }, 400);
    }
    const deploymentHint = (Deno.env.get('OMNI_COMMS_ENVIRONMENT_HINT') ?? '')
      .trim()
      .toLowerCase();
    if (requested === 'non_production' && deploymentHint !== 'non_production') {
      return json(
        {
          error: 'non_production_classification_unverified',
          detail:
            'Trusted deployment metadata does not declare this deployment as '
            + 'non-production, so it cannot be classified as non-production.',
        },
        409,
      );
    }

    const svc = serviceClient();
    const { data, error: envError } = await svc.rpc(
      'omni_comms_priv_confirm_runtime_environment',
      {
        p_actor_id: actorId,
        p_environment: requested,
        p_reason: typeof body.reason === 'string' ? body.reason : null,
        p_evidence: {
          source: 'release_control_edge',
          deployment_hint: deploymentHint || 'absent',
          runtime_revision: deployedRevision(),
        },
        p_correlation_id: typeof body.correlationId === 'string' ? body.correlationId : null,
      },
    );
    if (envError) return json({ error: envError.message ?? 'environment_confirmation_failed' }, 400);
    return json({ environment: data, live_delivery_enabled: false });
  }

  /**
   * Trusted deployment certification.
   *
   * The browser supplies NOTHING. Both revisions are resolved server-side and
   * must be identical full 40-character SHAs. The database refuses the record
   * unless the runtime environment is already resolved. Certifying a
   * deployment enables no delivery, contacts no provider and sends nothing.
   */
  if (body.action === 'certify_deployment') {
    const auth = await anon.rpc('omni_comms_dispatch_tick_authorize');
    if (auth.error || (auth.data as Record<string, unknown> | null)?.allowed !== true) {
      return json({ error: 'certification_not_permitted' }, 403);
    }

    const runtimeRevision = deployedRevision();
    let dispatcherRevision: string | null = null;
    try {
      const res = await fetch(
        `${Deno.env.get('SUPABASE_URL')}/functions/v1/omni-comms-dispatch/health`,
        { headers: { Authorization: `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}` } },
      );
      if (res.ok) {
        const health = await res.json();
        const raw = String(health?.revision ?? '').trim().toLowerCase();
        dispatcherRevision = /^[0-9a-f]{40}$/.test(raw) ? raw : null;
      }
    } catch {
      dispatcherRevision = null;
    }

    if (!runtimeRevision || !dispatcherRevision) {
      return json(
        {
          error: 'deployed_revision_unavailable',
          detail:
            'A full 40-character deployed revision could not be read from both the '
            + 'runtime and the dispatcher, so a release identity cannot be proven.',
        },
        409,
      );
    }
    if (runtimeRevision !== dispatcherRevision) {
      return json(
        {
          error: 'deployment_revision_mismatch',
          detail:
            'The runtime and the dispatcher report different deployed revisions. '
            + 'Certification is refused until both report the same revision.',
        },
        409,
      );
    }

    const svc = serviceClient();
    const { data, error: certError } = await svc.rpc(
      'omni_comms_priv_record_runtime_certification',
      {
        p_certification_state: 'certified',
        p_certified_commit: runtimeRevision,
        p_workflow_run_id: `release-control-edge:${actorId}:${new Date().toISOString()}`,
        p_certified_at: new Date().toISOString(),
        p_deployed_revision: dispatcherRevision,
      },
    );
    if (certError) return json({ error: certError.message ?? 'certification_failed' }, 400);
    return json({
      certification: data,
      runtime_revision: runtimeRevision,
      dispatcher_revision: dispatcherRevision,
      live_delivery_enabled: false,
    });
  }

  /**
   * Bounded, read-only prefill source for the controlled pilot.
   *
   * Returns the governing facts of the single held business job so the
   * administrator never has to retype an event code, module code or recipient.
   * It claims nothing, mutates nothing and creates no delivery.
   */
  if (body.action === 'held_pilot_candidate') {
    const auth = await anon.rpc('omni_comms_dispatch_tick_authorize');
    if (auth.error || (auth.data as Record<string, unknown> | null)?.allowed !== true) {
      return json({ error: 'not_permitted' }, 403);
    }
    const organizationId = typeof body.organizationId === 'string' ? body.organizationId : '';
    if (!organizationId) return json({ error: 'invalid_body' }, 400);

    const svc = serviceClient();
    const { data: jobs, error: jobError } = await svc
      .from('omni_comms_dispatch_job')
      .select(
        'id, status, hold_reason, mode, attempt_count, is_runnable, created_at, '
        + 'organization_id, '
        + 'omni_comms_request!inner(caller_module_code, event_definition_id), '
        + 'omni_comms_message!inner(department_id, destination_snapshot)',
      )
      .eq('organization_id', organizationId)
      .eq('status', 'held')
      .order('created_at', { ascending: true })
      .limit(5);
    if (jobError) return json({ error: 'held_candidate_unavailable' }, 400);

    const rows = (jobs ?? []) as Record<string, unknown>[];
    if (rows.length !== 1) {
      return json({ candidate: null, held_job_count: rows.length });
    }
    const row = rows[0];
    const request = (row.omni_comms_request ?? {}) as Record<string, unknown>;
    const message = (row.omni_comms_message ?? {}) as Record<string, unknown>;
    const destination = (message.destination_snapshot ?? {}) as Record<string, unknown>;

    let eventCode: string | null = null;
    if (typeof request.event_definition_id === 'string') {
      const { data: ev } = await svc
        .from('omni_comms_event_definition')
        .select('code')
        .eq('id', request.event_definition_id)
        .maybeSingle();
      eventCode = typeof ev?.code === 'string' ? ev.code : null;
    }

    return json({
      held_job_count: 1,
      candidate: {
        job_id: row.id,
        hold_reason: row.hold_reason ?? null,
        mode: row.mode ?? null,
        attempt_count: row.attempt_count ?? 0,
        is_runnable: row.is_runnable === true,
        event_code: eventCode,
        caller_module_code: request.caller_module_code ?? null,
        department_id: message.department_id ?? null,
        recipient: typeof destination.email === 'string' ? destination.email : null,
      },
    });
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
