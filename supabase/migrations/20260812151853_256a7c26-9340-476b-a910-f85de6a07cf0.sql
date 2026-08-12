CREATE OR REPLACE FUNCTION public.omni_comms_priv_business_dispatch_installed()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'omni_comms_priv_dispatch_claim_email'
        AND p.prosrc LIKE '%omni_comms_provider_credential_send_ready%'
    )
    AND EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'omni_comms_priv_dispatch_attempt_complete'
    )
    AND EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'omni_comms_priv_dispatch_record_callback'
    );
$function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_priv_business_dispatch_installed() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_channel_release_control_summary(p_organization_id uuid, p_department_id uuid DEFAULT NULL::uuid, p_channel text DEFAULT 'email'::text, p_history_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_rel public.omni_comms_channel_release_control;
  v_can_configure boolean := false;
  v_can_operate boolean := false;
  v_cert jsonb;
  v_policy public.omni_comms_channel_setting;
BEGIN
  v_actor := public.omni_comms_priv_require_capability('view');
  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, p_organization_id, p_department_id);
  IF p_channel <> 'email' THEN RAISE EXCEPTION 'release_channel_not_supported' USING ERRCODE='22023'; END IF;

  BEGIN PERFORM public.omni_comms_priv_require_capability('configure'); v_can_configure := true;
  EXCEPTION WHEN OTHERS THEN v_can_configure := false; END;
  BEGIN PERFORM public.omni_comms_priv_require_capability('operate'); v_can_operate := true;
  EXCEPTION WHEN OTHERS THEN v_can_operate := false; END;

  v_rel := public.omni_comms_priv_channel_release_effective(p_organization_id, p_department_id, p_channel);
  v_cert := public.omni_comms_priv_runtime_certification();
  v_policy := public.omni_comms_priv_channel_test_effective_policy(p_organization_id, p_department_id, p_channel);

  RETURN jsonb_build_object(
    'release', CASE WHEN v_rel.id IS NULL THEN NULL
                    ELSE public.omni_comms_priv_channel_release_json(v_rel) END,
    'scope', jsonb_build_object('organization_id', p_organization_id,
                                'department_id', p_department_id,
                                'channel', p_channel),
    'certification', v_cert,
    'runtime_environment', public.omni_comms_priv_runtime_environment(),
    'live_delivery_enabled', coalesce(v_policy.live_delivery_enabled, false),
    'prerequisites', CASE WHEN v_rel.id IS NULL THEN '[]'::jsonb
      ELSE public.omni_comms_priv_channel_release_prerequisites(
        p_organization_id, p_department_id, p_channel, v_rel.id, NULL) END,
    'usage', CASE WHEN v_rel.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
        'hourly', (SELECT count(*) FROM public.omni_comms_dispatch_job j WHERE j.release_control_id=v_rel.id AND j.created_at > now() - interval '1 hour'),
        'daily', (SELECT count(*) FROM public.omni_comms_dispatch_job j WHERE j.release_control_id=v_rel.id AND j.created_at > now() - interval '1 day'),
        'total', (SELECT count(*) FROM public.omni_comms_dispatch_job j WHERE j.release_control_id=v_rel.id)) END,
    'history', CASE WHEN v_rel.id IS NULL THEN '[]'::jsonb ELSE (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'event_type', e.event_type, 'from_state', e.from_state,
        'to_state', e.to_state, 'reason', e.reason, 'actor_id', e.actor_id,
        'release_version', e.release_version,
        'release_fingerprint', left(e.release_fingerprint, 12),
        'certified_commit', e.certified_commit,
        'occurred_at', e.occurred_at) ORDER BY e.occurred_at DESC), '[]'::jsonb)
      FROM (SELECT * FROM public.omni_comms_channel_release_event
            WHERE release_control_id = v_rel.id
            ORDER BY occurred_at DESC
            LIMIT greatest(1, least(coalesce(p_history_limit,25), 200))) e) END,
    'capabilities', jsonb_build_object(
      'can_configure', v_can_configure,
      'can_operate', v_can_operate,
      'can_approve', v_can_operate AND v_rel.id IS NOT NULL
                     AND v_rel.proposed_state = 'controlled_pilot'
                     AND v_rel.proposed_by IS DISTINCT FROM v_actor,
      'can_suspend', v_can_operate AND v_rel.release_state = 'controlled_pilot'),
    'actor_id', v_actor,
    'business_dispatch_implemented', public.omni_comms_priv_business_dispatch_installed(),
    'generated_at', now()
  );
END;
$function$;