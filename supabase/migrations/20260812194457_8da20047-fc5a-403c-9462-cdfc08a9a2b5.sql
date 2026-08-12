CREATE OR REPLACE FUNCTION public.omni_comms_live_operations_summary(p_organization_id uuid, p_department_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_rel public.omni_comms_channel_release_control;
  v_cert jsonb; v_env text;
  v_health jsonb;
  v_scheduler_ready boolean := false;
  v_callback_ready boolean := false;
  v_safety_ready boolean := false;
  v_live boolean := false;
  v_checks jsonb;
  v_ready integer := 0;
  v_attempts int; v_accepted int; v_delivered int;
  v_last_attempt timestamptz; v_last_accepted timestamptz; v_last_delivered timestamptz;
  v_last_bounce timestamptz; v_last_complaint timestamptz; v_last_unknown timestamptz;
  v_queue_depth int;
BEGIN
  v_actor := public.omni_comms_priv_require_capability('view');
  PERFORM public.omni_comms_priv_require_tenant_access(v_actor, p_organization_id, p_department_id);

  v_rel := public.omni_comms_priv_channel_release_effective(p_organization_id, p_department_id, 'email');
  v_cert := public.omni_comms_priv_runtime_certification();
  v_env := public.omni_comms_priv_runtime_environment();
  v_live := v_rel.id IS NOT NULL AND v_rel.release_state = 'live';

  v_health := public.omni_comms_priv_scheduler_health();
  v_scheduler_ready := coalesce((v_health->>'ready')::boolean, false);

  v_callback_ready := EXISTS (
    SELECT 1 FROM public.omni_comms_channel_endpoint e
    WHERE e.organization_id = p_organization_id AND e.channel='email'
      AND e.endpoint_type='event_callback' AND e.status='active');

  v_safety_ready := v_rel.id IS NOT NULL
    AND coalesce(v_rel.release_state,'') <> 'suspended'
    AND v_rel.max_messages_per_hour IS NOT NULL
    AND v_rel.max_messages_per_day IS NOT NULL
    AND v_rel.max_recipients_per_request = 1;

  SELECT count(*), count(*) FILTER (WHERE a.status='accepted'),
         max(a.created_at), max(a.created_at) FILTER (WHERE a.status='accepted'),
         max(a.created_at) FILTER (WHERE a.status='outcome_unknown')
    INTO v_attempts, v_accepted, v_last_attempt, v_last_accepted, v_last_unknown
  FROM public.omni_comms_delivery_attempt a
  WHERE a.organization_id = p_organization_id
    AND (v_rel.id IS NULL OR a.release_control_id = v_rel.id);

  SELECT count(*) FILTER (WHERE e.event_type='delivered'),
         max(e.created_at) FILTER (WHERE e.event_type='delivered'),
         max(e.created_at) FILTER (WHERE e.event_type='bounced'),
         max(e.created_at) FILTER (WHERE e.event_type='complained')
    INTO v_delivered, v_last_delivered, v_last_bounce, v_last_complaint
  FROM public.omni_comms_message_event e
  WHERE e.organization_id = p_organization_id;

  SELECT count(*) INTO v_queue_depth FROM public.omni_comms_dispatch_job j
  WHERE j.organization_id = p_organization_id AND j.channel='email' AND j.mode='queued'
    AND j.status IN ('held','ready','retry_wait');

  v_checks := jsonb_build_array(
    jsonb_build_object('key','production_environment','ready', v_env = 'production',
      'detail', CASE WHEN v_env='production' THEN 'Runtime environment confirmed as production.'
                     ELSE 'Confirm the production runtime environment.' END),
    jsonb_build_object('key','deployment_certified',
      'ready', v_cert->>'certification_state' = 'certified',
      'detail', CASE WHEN v_cert->>'certification_state'='certified'
                     THEN 'The deployed revision is certified.'
                     ELSE 'Certify the deployed revision.' END),
    jsonb_build_object('key','benefits_live_release_active','ready', v_live,
      'detail', CASE WHEN v_live THEN 'A production live Email release governs Benefits sending.'
                     ELSE 'Propose and approve the Benefits production live release.' END),
    jsonb_build_object('key','business_dispatcher_ready',
      'ready', public.omni_comms_priv_business_dispatch_installed(),
      'detail','Canonical business dispatcher installed.'),
    jsonb_build_object('key','automatic_scheduler_ready','ready', v_scheduler_ready,
      'detail', CASE
        WHEN v_scheduler_ready THEN 'The automatic dispatcher ran within the last 3 minutes.'
        WHEN NOT coalesce((v_health->>'installed')::boolean,false)
          THEN 'The automatic dispatcher schedule is not installed.'
        WHEN NOT coalesce((v_health->>'active')::boolean,false)
          THEN 'The automatic dispatcher schedule is inactive.'
        WHEN NOT coalesce((v_health->>'run_fresh')::boolean,false)
          THEN 'No automatic dispatcher run in the last 3 minutes.'
        WHEN v_cert->>'certification_state' <> 'certified'
          THEN 'Certify the deployed revision before the dispatcher is trusted.'
        ELSE 'The last automatic dispatcher run reported a blocker.' END),
    jsonb_build_object('key','callback_receiver_ready','ready', v_callback_ready,
      'detail','Signed provider callback endpoint active.'),
    jsonb_build_object('key','live_safety_ready','ready', v_safety_ready,
      'detail', CASE WHEN v_safety_ready THEN 'Production quotas and safety suspension are in force.'
                     ELSE 'Production quotas are not complete.' END)
  );
  SELECT count(*) INTO v_ready FROM jsonb_array_elements(v_checks) c
   WHERE (c->>'ready')::boolean;

  RETURN jsonb_build_object(
    'release_state', v_rel.release_state,
    'live', v_live,
    'automatic_dispatch', v_live AND v_scheduler_ready,
    'readiness', jsonb_build_object('checks', v_checks, 'ready_count', v_ready, 'total', 7),
    'scheduler', v_health,
    'quotas', jsonb_build_object(
      'max_recipients_per_request', v_rel.max_recipients_per_request,
      'max_messages_per_hour', v_rel.max_messages_per_hour,
      'max_messages_per_day', v_rel.max_messages_per_day,
      'max_messages_total', v_rel.max_messages_total),
    'scope', jsonb_build_object(
      'department_id', v_rel.department_id,
      'permitted_event_codes', to_jsonb(coalesce(v_rel.permitted_event_codes,'{}')),
      'permitted_caller_modules', to_jsonb(coalesce(v_rel.permitted_caller_modules,'{}')),
      'permitted_modes', to_jsonb(coalesce(v_rel.permitted_modes,'{}'))),
    'delivery_evidence', jsonb_build_object(
      'attempts', coalesce(v_attempts,0),
      'accepted', coalesce(v_accepted,0),
      'delivered', coalesce(v_delivered,0),
      'last_attempt_at', v_last_attempt,
      'last_accepted_at', v_last_accepted,
      'last_delivered_at', v_last_delivered,
      'last_bounce_at', v_last_bounce,
      'last_complaint_at', v_last_complaint,
      'last_outcome_unknown_at', v_last_unknown,
      'queue_depth', coalesce(v_queue_depth,0),
      'has_production_delivery', coalesce(v_attempts,0) > 0),
    'generated_at', now());
END;
$function$;