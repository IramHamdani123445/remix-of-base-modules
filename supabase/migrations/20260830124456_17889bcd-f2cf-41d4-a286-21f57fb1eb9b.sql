CREATE OR REPLACE FUNCTION public.omni_comms_priv_reevaluate_held_jobs(
  p_worker            text DEFAULT 'omni-comms-hold-reevaluation',
  p_batch_limit       integer DEFAULT 25,
  p_deployed_revision text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_limit   integer := least(greatest(coalesce(p_batch_limit, 25), 1), 100);
  v_rev     text    := lower(btrim(coalesce(nullif(p_deployed_revision, ''),
                                            public.omni_comms_priv_observed_deployed_revision(),
                                            '')));
  j          record;
  v_rel      public.omni_comms_channel_release_control;
  v_deny     text;
  v_hash     text;
  v_target   text;
  v_user     uuid;
  v_scanned  integer := 0;
  v_released integer := 0;
  v_still    integer := 0;
  v_results  jsonb := '[]'::jsonb;
BEGIN
  PERFORM set_config('omni_comms.dispatch_worker', 'on', true);

  FOR j IN
    SELECT d.id, d.channel, d.organization_id, d.message_id, d.request_id,
           d.release_control_id, d.release_decision_at, d.hold_reason,
           m.department_id, m.recipient_id,
           r.caller_module_code, r.created_at AS request_created_at
      FROM public.omni_comms_dispatch_job d
      JOIN public.omni_comms_message m ON m.id = d.message_id
      JOIN public.omni_comms_request r ON r.id = d.request_id
     WHERE d.status = 'held'
       AND d.mode = 'queued'
       AND d.channel IN ('email', 'in_app')
     ORDER BY d.created_at
     LIMIT v_limit
     FOR UPDATE OF d SKIP LOCKED
  LOOP
    v_scanned := v_scanned + 1;
    v_deny := NULL;
    v_hash := NULL;

    v_rel := public.omni_comms_priv_channel_release_effective(
               j.organization_id, j.department_id, j.channel);

    IF v_rel.id IS NULL THEN
      v_deny := 'release_control_missing';
    ELSE
      IF j.channel = 'in_app' THEN
        v_user := public.omni_comms_priv_resolve_in_app_user(j.recipient_id);
        v_target := coalesce(v_user::text, '');
      ELSE
        SELECT coalesce(rc.email_destination, '') INTO v_target
          FROM public.omni_comms_recipient rc WHERE rc.id = j.recipient_id;
      END IF;

      v_hash := lower(coalesce(
        public.omni_comms_priv_channel_test_normalize_target(
          j.channel, coalesce(v_target, '')) ->> 'target_hash', ''));

      v_deny := public.omni_comms_priv_evaluate_dispatch_authorization(
        j.organization_id, j.department_id, j.channel,
        j.caller_module_code, 'queued', nullif(v_hash, ''), NULL,
        j.request_created_at, nullif(v_rev, ''));
    END IF;

    IF v_deny IS NOT NULL THEN
      v_still := v_still + 1;
      IF j.hold_reason IS DISTINCT FROM v_deny THEN
        UPDATE public.omni_comms_dispatch_job
           SET hold_reason = v_deny, updated_at = now()
         WHERE id = j.id;
      END IF;
      v_results := v_results || jsonb_build_object(
        'job_id', j.id, 'channel', j.channel,
        'outcome', 'still_held', 'reason', v_deny);
      CONTINUE;
    END IF;

    IF j.release_decision_at IS NULL THEN
      UPDATE public.omni_comms_dispatch_job
         SET release_control_id               = v_rel.id,
             release_version_at_decision      = v_rel.release_version,
             release_state_at_decision        = v_rel.release_state,
             release_fingerprint_at_decision  = v_rel.release_fingerprint,
             release_expires_at_decision      = v_rel.release_expires_at,
             release_decision_at              = now(),
             release_decision_snapshot        = jsonb_build_object(
               'event_matched', true, 'caller_matched', true, 'mode_matched', true,
               'recipient_source', 'business_request',
               'release_state', v_rel.release_state,
               'certified_commit', v_rel.approved_commit,
               'authorized_by', 'hold_reevaluation',
               'authorized_at', now()),
             hold_reason = NULL,
             updated_at  = now()
       WHERE id = j.id;
    ELSE
      UPDATE public.omni_comms_dispatch_job
         SET hold_reason = NULL, updated_at = now()
       WHERE id = j.id;
    END IF;

    IF j.channel = 'in_app' THEN
      UPDATE public.omni_comms_dispatch_job
         SET status = 'ready', is_runnable = true, updated_at = now()
       WHERE id = j.id AND status = 'held';
    END IF;

    v_released := v_released + 1;
    v_results := v_results || jsonb_build_object(
      'job_id', j.id, 'channel', j.channel, 'outcome', 'authorized');
  END LOOP;

  RETURN jsonb_build_object(
    'worker', coalesce(p_worker, 'omni-comms-hold-reevaluation'),
    'deployed_revision_used', nullif(v_rev, ''),
    'scanned', v_scanned,
    'authorized', v_released,
    'still_held', v_still,
    'results', v_results);
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_reevaluate_held_jobs(text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_reevaluate_held_jobs(text, integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_reevaluate_held_jobs(text, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_reevaluate_held_jobs(text, integer, text) TO service_role;