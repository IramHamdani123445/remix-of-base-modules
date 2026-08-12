CREATE OR REPLACE FUNCTION public.omni_comms_dispatch_diagnostics(p_organization_id uuid, p_department_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rel public.omni_comms_channel_release_control;
  v_queued_bindings integer := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.has_permission(v_uid, 'omni_comms', 'operate') THEN
    RAISE EXCEPTION 'OC403 permission_denied' USING ERRCODE='P0001';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);

  v_rel := public.omni_comms_priv_channel_release_effective(
             p_organization_id, p_department_id, 'email');

  SELECT count(*) INTO v_queued_bindings
    FROM public.omni_comms_producer_event_binding b
    JOIN public.omni_comms_event_definition ed ON ed.id = b.event_definition_id
   WHERE b.status = 'active'
     AND 'queued' = ANY (b.allowed_modes)
     AND b.organization_id = p_organization_id
     AND (
       (p_department_id IS NULL AND b.department_id IS NULL)
       OR (p_department_id IS NOT NULL
           AND (b.department_id IS NULL OR b.department_id = p_department_id))
     )
     AND v_rel.id IS NOT NULL
     AND (v_rel.permitted_event_codes IS NOT NULL
          AND ed.code = ANY (v_rel.permitted_event_codes))
     AND (v_rel.permitted_caller_modules IS NOT NULL
          AND b.caller_module_code = ANY (v_rel.permitted_caller_modules));

  RETURN jsonb_build_object(
    'dispatcher_implemented', true,
    'live_delivery_enabled', false,
    'release_live_state_available', false,
    'dispatchable_channels', jsonb_build_array('email'),
    'organization_id', p_organization_id,
    'department_id', p_department_id,
    'held_jobs', (
      SELECT count(*) FROM public.omni_comms_dispatch_job j
        JOIN public.omni_comms_message m ON m.id = j.message_id
       WHERE j.channel='email' AND j.mode='queued'
         AND j.is_runnable IS NOT TRUE
         AND j.status IN ('pending','held','retry_wait')
         AND j.organization_id = p_organization_id
         AND (p_department_id IS NULL OR m.department_id = p_department_id)),
    'eligible_jobs', (
      SELECT count(*) FROM public.omni_comms_dispatch_job j
        JOIN public.omni_comms_message m ON m.id = j.message_id
       WHERE j.channel='email' AND j.mode='queued'
         AND j.is_runnable IS TRUE
         AND j.status = 'ready'
         AND j.organization_id = p_organization_id
         AND (p_department_id IS NULL OR m.department_id = p_department_id)),
    'unrelated_eligible_jobs', (
      SELECT count(*) FROM public.omni_comms_dispatch_job j
       WHERE j.is_runnable IS TRUE
         AND j.status = 'ready'
         AND j.organization_id = p_organization_id),
    'in_flight_attempts', (
      SELECT count(*) FROM public.omni_comms_delivery_attempt a
        JOIN public.omni_comms_message m ON m.id = a.message_id
       WHERE a.organization_id = p_organization_id
         AND (p_department_id IS NULL OR m.department_id = p_department_id)
         AND a.status IN ('started','dispatching')),
    'reconciliation_required_count', (
      SELECT count(*) FROM public.omni_comms_delivery_attempt a
        JOIN public.omni_comms_message m ON m.id = a.message_id
       WHERE a.organization_id = p_organization_id
         AND (p_department_id IS NULL OR m.department_id = p_department_id)
         AND a.reconciliation_state = 'required'),
    'business_attempts_total', (
      SELECT count(*) FROM public.omni_comms_delivery_attempt a
        JOIN public.omni_comms_message m ON m.id = a.message_id
       WHERE a.organization_id = p_organization_id
         AND (p_department_id IS NULL OR m.department_id = p_department_id)),
    'business_accepted_total', (
      SELECT count(*) FROM public.omni_comms_delivery_attempt a
        JOIN public.omni_comms_message m ON m.id = a.message_id
       WHERE a.organization_id = p_organization_id
         AND (p_department_id IS NULL OR m.department_id = p_department_id)
         AND a.status = 'accepted'),
    'business_outcome_unknown_total', (
      SELECT count(*) FROM public.omni_comms_delivery_attempt a
        JOIN public.omni_comms_message m ON m.id = a.message_id
       WHERE a.organization_id = p_organization_id
         AND (p_department_id IS NULL OR m.department_id = p_department_id)
         AND a.status = 'outcome_unknown'),
    'business_delivered_total', (
      SELECT count(*) FROM public.omni_comms_webhook_event w
        JOIN public.omni_comms_message m ON m.id = w.message_id
       WHERE w.organization_id = p_organization_id
         AND m.organization_id = p_organization_id
         AND (p_department_id IS NULL OR m.department_id = p_department_id)
         AND w.normalized_event_type = 'delivered'),
    'harmful_callback_count', (
      SELECT count(*) FROM public.omni_comms_webhook_event w
        JOIN public.omni_comms_message m ON m.id = w.message_id
       WHERE w.organization_id = p_organization_id
         AND m.organization_id = p_organization_id
         AND (p_department_id IS NULL OR m.department_id = p_department_id)
         AND w.scope = 'business'
         AND w.normalized_event_type IN ('bounced','complained')),
    'ambiguous_callback_count', (
      SELECT count(*) FROM public.omni_comms_webhook_event w
       WHERE w.processing_result = 'ambiguous'
         AND EXISTS (
           SELECT 1 FROM public.omni_comms_delivery_attempt a
             JOIN public.omni_comms_message m2 ON m2.id = a.message_id
            WHERE a.provider_message_id = w.provider_message_id
              AND a.organization_id = p_organization_id
              AND (p_department_id IS NULL OR m2.department_id = p_department_id))),
    'queued_producer_binding_count', v_queued_bindings,
    'release_state', v_rel.release_state,
    'release_control_id', v_rel.id,
    'pilot_suspended', COALESCE(v_rel.release_state = 'suspended', false),
    'blocker', CASE WHEN v_queued_bindings = 0
      THEN 'pilot_business_producer_not_selected' ELSE NULL END);
END; $function$;