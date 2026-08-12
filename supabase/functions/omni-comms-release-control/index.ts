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
    // Record the SERVER-observed deployment identity so database-side
    // prerequisite checks can compare it with the certified commit. The
    // browser supplies nothing here.
    await svc.rpc('omni_comms_priv_record_runtime_deployment', {
      p_runtime_revision: runtimeRevision,
      p_dispatcher_revision: dispatcherRevision,
    });
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
    // Certification mutates PROTECTED GLOBAL runtime state, so an operate-only
    // departmental user may never perform it. Authority is decided server-side.
    const svcAuth = serviceClient();
    const { data: authority } = await svcAuth.rpc('omni_comms_priv_certification_authority', {
      p_actor: actorId,
    });
    if ((authority as Record<string, unknown> | null)?.allowed !== true) {
      return json(
        {
          error: 'certification_authority_required',
          detail:
            'Deployment certification changes protected global runtime state and '
            + 'requires a platform administrator.',
        },
        403,
      );
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
   * The SERVER decides whether the requested tenant scope is one this actor
   * may actually see, and the projection carries a masked recipient plus a
   * one-way hash only — never a raw address. It claims nothing, mutates
   * nothing and creates no delivery.
   */
  if (body.action === 'held_pilot_candidate') {
    const organizationId = typeof body.organizationId === 'string' ? body.organizationId : '';
    if (!organizationId) return json({ error: 'invalid_body' }, 400);
    const departmentId = typeof body.departmentId === 'string' && body.departmentId
      ? body.departmentId
      : null;

    const svc = serviceClient();
    const { data, error: candidateError } = await svc.rpc(
      'omni_comms_priv_held_pilot_candidate',
      {
        p_actor: actorId,
        p_organization_id: organizationId,
        p_department_id: departmentId,
      },
    );
    if (candidateError) return json({ error: 'held_candidate_unavailable' }, 400);
    const result = (data ?? {}) as Record<string, unknown>;
    if (result.allowed !== true) {
      return json({ error: String(result.code ?? 'held_candidate_scope_not_permitted') }, 403);
    }
    return json({
      held_job_count: result.held_job_count ?? 0,
      candidate: result.candidate ?? null,
    });
  }

  /**
   * Bounded review of the held (never-attempted) Email jobs in the caller's
   * own tenant scope. Masked recipients only; mutates nothing.
   */
  if (body.action === 'held_job_review') {
    const organizationId = typeof body.organizationId === 'string' ? body.organizationId : '';
    if (!organizationId) return json({ error: 'invalid_body' }, 400);
    const departmentId = typeof body.departmentId === 'string' && body.departmentId
      ? body.departmentId
      : null;

    const svc = serviceClient();
    const { data, error: reviewError } = await svc.rpc('omni_comms_priv_held_job_review', {
      p_actor: actorId,
      p_organization_id: organizationId,
      p_department_id: departmentId,
    });
    if (reviewError) return json({ error: 'held_review_unavailable' }, 400);
    const result = (data ?? {}) as Record<string, unknown>;
    if (result.allowed !== true) {
      return json({ error: String(result.code ?? 'held_review_scope_not_permitted') }, 403);
    }
    return json({
      held_job_count: result.held_job_count ?? 0,
      jobs: result.jobs ?? [],
    });
  }

  /**
   * Retire exactly ONE obsolete held Email job that was never attempted and
   * for which no provider was ever contacted. Nothing is deleted: the request,
   * message and history remain, and an immutable cancellation event is
   * appended. No provider is contacted here.
   */
  if (body.action === 'retire_held_job') {
    const organizationId = typeof body.organizationId === 'string' ? body.organizationId : '';
    const jobId = typeof body.jobId === 'string' ? body.jobId : '';
    if (!organizationId || !jobId) return json({ error: 'invalid_body' }, 400);
    const departmentId = typeof body.departmentId === 'string' && body.departmentId
      ? body.departmentId
      : null;
    const reason = typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim()
      : 'superseded_pre_production_pilot_job';

    const svc = serviceClient();
    const { data, error: retireError } = await svc.rpc('omni_comms_priv_retire_held_job', {
      p_actor: actorId,
      p_organization_id: organizationId,
      p_department_id: departmentId,
      p_job_id: jobId,
      p_reason: reason,
    });
    if (retireError) return json({ error: 'held_retire_unavailable' }, 400);
    const result = (data ?? {}) as Record<string, unknown>;
    if (result.ok !== true) {
      return json({ error: String(result.code ?? 'held_retire_refused') }, 409);
    }
    return json({
      retired: true,
      job_id: result.job_id ?? null,
      message_id: result.message_id ?? null,
      reason: result.reason ?? reason,
      live_delivery_enabled: false,
    });
  }



  /**
   * FINAL controlled business send.
   *
   * The browser names ONLY the Release Control it is looking at. The server
   * revalidates the entire release, resolves EXACTLY ONE authorised held job,
   * and hands the dispatcher a trusted internal ticket bound to that exact
   * release and job. The browser never selects a job, a recipient, a message
   * or a provider.
   */
  if (body.action === 'release_one_controlled_message') {
    const auth = await anon.rpc('omni_comms_dispatch_tick_authorize');
    if (auth.error || (auth.data as Record<string, unknown> | null)?.allowed !== true) {
      return json({ error: 'controlled_send_not_permitted' }, 403);
    }
    const releaseId = typeof body.releaseControlId === 'string' ? body.releaseControlId : '';
    if (!releaseId) return json({ error: 'invalid_body' }, 400);

    const revision = deployedRevision();
    if (!revision) {
      return json({ error: 'deployed_revision_unavailable' }, 409);
    }

    const svc = serviceClient();
    const { data: pre, error: preError } = await svc.rpc(
      'omni_comms_priv_release_controlled_send_preflight',
      {
        p_actor: actorId,
        p_release_control_id: releaseId,
        p_deployed_revision: revision,
      },
    );
    if (preError) return json({ error: 'controlled_send_preflight_failed' }, 400);
    const preflight = (pre ?? {}) as Record<string, unknown>;

    // A confirmation-only probe never dispatches; it renders the final
    // pre-send confirmation card from server-derived facts.
    if (body.confirmOnly === true || preflight.ok !== true) {
      return json({
        ok: preflight.ok === true,
        code: preflight.code ?? 'controlled_send_blocked',
        confirmation: preflight.confirmation ?? null,
        live_delivery_enabled: false,
        dispatched: false,
      }, preflight.ok === true ? 200 : 409);
    }

    const dispatchRes = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/omni-comms-dispatch`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'Content-Type': 'application/json',
          'x-omni-comms-dispatch-ticket': 'release-control',
        },
        body: JSON.stringify({
          batchLimit: 1,
          correlationId: typeof body.correlationId === 'string' ? body.correlationId : null,
          releaseControlId: preflight.release_control_id,
          expectedJobId: preflight.job_id,
          scopes: [{
            organization_id: preflight.organization_id,
            department_id: preflight.department_id ?? null,
          }],
        }),
      },
    );
    const dispatch = await dispatchRes.json().catch(() => ({}));

    return json({
      ok: dispatchRes.ok,
      code: 'controlled_release_dispatched',
      confirmation: preflight.confirmation ?? null,
      dispatched: true,
      dispatch: {
        claimed_jobs: dispatch?.claimed_jobs ?? 0,
        blocker: dispatch?.blocker ?? null,
        blockers: dispatch?.blockers ?? [],
        results: dispatch?.results ?? [],
        error: dispatch?.error ?? null,
        detail: dispatch?.detail ?? null,
      },
      live_delivery_enabled: false,
    }, dispatchRes.ok ? 200 : 409);
  }


  // `approve_activate_live` promotes the release to genuine production LIVE.
  // It is a second-person decision: the database refuses it when the approver
  // is the proposer, when the fingerprint moved, or when any prerequisite
  // fails. This boundary contacts no provider and sends nothing itself.
  const isLiveApproval = body.action === 'approve_activate_live';
  if (body.action !== 'approve_activate' && !isLiveApproval) {
    return json({ error: 'unsupported_action' }, 400);
  }


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

  // Never hard-code dispatch readiness: the database reports whether the
  // canonical controlled business dispatcher is actually installed.
  const { data: dispatchInstalled } = await service.rpc(
    'omni_comms_priv_business_dispatch_installed',
  );

  return json({
    release: data,
    deployed_revision: revision,
    business_dispatch_implemented: dispatchInstalled === true,
  });
});
