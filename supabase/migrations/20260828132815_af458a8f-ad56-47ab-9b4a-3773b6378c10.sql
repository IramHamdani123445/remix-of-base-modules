CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_certification_snapshot(
  p_actor_id uuid,
  p_request_id uuid,
  p_organization_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_req    public.omni_comms_request%ROWTYPE;
  v_marker public.platform_environment_marker%ROWTYPE;
  v_act    public.omni_comms_dispatch_activation%ROWTYPE;
  v_channels jsonb := '[]'::jsonb;
  v_channel text;
  v_rel    public.omni_comms_channel_release_control%ROWTYPE;
  v_rules  jsonb;
  v_allow  boolean;
  v_any    boolean;
  v_target text;
  v_hash   text;
  v_adapter text;
  r_rec    record;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'OC401 authentication_required' USING ERRCODE='P0001';
  END IF;
  IF p_request_id IS NULL OR p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_req FROM public.omni_comms_request
   WHERE id = p_request_id AND organization_id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 request_not_found' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_marker FROM public.platform_environment_marker LIMIT 1;
  SELECT * INTO v_act FROM public.omni_comms_dispatch_activation WHERE singleton;

  FOR v_channel IN
    SELECT DISTINCT ch
    FROM public.omni_comms_recipient rc,
         LATERAL unnest(coalesce(rc.resolved_channels, ARRAY[]::text[])) AS ch
    WHERE rc.request_id = p_request_id
  LOOP
    v_rel := public.omni_comms_priv_channel_release_effective(
               p_organization_id, v_req.department_id, v_channel);
    v_rules := coalesce(v_rel.pilot_recipient_rules, '[]'::jsonb);

    v_allow := true;
    v_any := false;
    FOR r_rec IN
      SELECT rc.recipient_reference, rc.destination_snapshot
      FROM public.omni_comms_recipient rc
      WHERE rc.request_id = p_request_id
        AND v_channel = ANY (coalesce(rc.resolved_channels, ARRAY[]::text[]))
    LOOP
      v_any := true;
      v_target := CASE lower(v_channel)
        WHEN 'email'    THEN r_rec.destination_snapshot->>'email'
        WHEN 'sms'      THEN r_rec.destination_snapshot->>'phone'
        WHEN 'whatsapp' THEN r_rec.destination_snapshot->>'phone'
        WHEN 'voice'    THEN r_rec.destination_snapshot->>'phone'
        ELSE r_rec.recipient_reference
      END;
      IF nullif(btrim(coalesce(v_target,'')),'') IS NULL THEN
        v_allow := false;
      ELSE
        BEGIN
          v_hash := public.omni_comms_priv_channel_test_normalize_target(
                      CASE WHEN lower(v_channel) IN ('email','sms','whatsapp','voice')
                           THEN v_channel ELSE 'in_app' END,
                      v_target)->>'target_hash';
        EXCEPTION WHEN OTHERS THEN
          v_hash := NULL;
        END;
        IF v_hash IS NULL OR NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(v_rules) AS rule
             WHERE lower(coalesce(rule->>'target_hash','')) = lower(v_hash)
           ) THEN
          v_allow := false;
        END IF;
      END IF;
    END LOOP;
    IF NOT v_any THEN v_allow := false; END IF;

    -- Resolved adapter for this channel: the provider account actually bound
    -- by resolution, else the internal (credential-free) adapter for internal
    -- delivery channels. Absence stays NULL and therefore denies downstream.
    v_adapter := NULL;
    SELECT p.adapter_key INTO v_adapter
      FROM public.omni_comms_recipient rc
      CROSS JOIN LATERAL jsonb_array_elements(
             coalesce(rc.resolution_snapshot->'channel_resolutions', '[]'::jsonb)) cr
      JOIN public.omni_comms_provider_account pa
        ON pa.id = nullif(cr->>'provider_account_id','')::uuid
      JOIN public.omni_comms_provider p ON p.id = pa.provider_id
     WHERE rc.request_id = p_request_id
       AND lower(coalesce(cr->>'channel','')) = lower(v_channel)
     LIMIT 1;

    IF v_adapter IS NULL AND lower(v_channel) = 'in_app' THEN
      v_adapter := 'internal_in_app';
    END IF;

    v_channels := v_channels || jsonb_build_array(jsonb_build_object(
      'channel', v_channel,
      'release_state', v_rel.release_state,
      'release_expires_at', v_rel.release_expires_at,
      'approved_commit', v_rel.approved_commit,
      'permitted_caller_modules', to_jsonb(v_rel.permitted_caller_modules),
      'permitted_modes', to_jsonb(v_rel.permitted_modes),
      'recipient_allowlisted', v_allow,
      'provider_adapter_key', v_adapter
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'runtime_environment', public.omni_comms_priv_runtime_environment(),
    'marker_environment_kind', v_marker.environment_kind,
    'marker_allows_controlled_test_activation', v_marker.allows_controlled_test_activation,
    'marker_project_ref', v_marker.project_ref,
    'caller_module_code', v_req.caller_module_code,
    'dispatch_certified_from', v_act.certified_from,
    'request_created_at', v_req.created_at,
    'quarantined', EXISTS (
      SELECT 1 FROM public.ia_comms_pre_release_quarantine q
      WHERE q.correlation_id IS NOT DISTINCT FROM v_req.correlation_id
    ),
    'as_of', now(),
    'channels', v_channels
  );
END;
$function$;