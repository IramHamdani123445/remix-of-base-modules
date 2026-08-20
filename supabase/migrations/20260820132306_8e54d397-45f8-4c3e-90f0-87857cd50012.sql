CREATE OR REPLACE FUNCTION public.omni_comms_channel_test_delivery_set_approval(p_organization_id uuid, p_department_id uuid DEFAULT NULL::uuid, p_channel text DEFAULT 'email'::text, p_enabled boolean DEFAULT false, p_recipients text[] DEFAULT '{}'::text[], p_expires_in_hours integer DEFAULT 4, p_max_deliveries integer DEFAULT 5, p_min_interval_seconds integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_ch text := btrim(coalesce(p_channel,''));
  v_clean text[] := '{}'::text[];
  v_item text;
  v_norm jsonb;
  v_policy public.omni_comms_channel_setting%ROWTYPE;
  v_before jsonb;
  v_hours integer := coalesce(p_expires_in_hours,4);
  v_max integer := coalesce(p_max_deliveries,5);
  v_interval integer := coalesce(p_min_interval_seconds,60);
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_required'; END IF;
  IF v_ch NOT IN ('email','sms','whatsapp') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='controlled_delivery_channel_unsupported'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);

  IF v_hours < 1 OR v_hours > 24 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='approval_window_out_of_range'; END IF;
  IF v_max < 1 OR v_max > 20 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='max_deliveries_out_of_range'; END IF;
  IF v_interval < 30 OR v_interval > 3600 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='min_interval_out_of_range'; END IF;

  FOREACH v_item IN ARRAY coalesce(p_recipients, '{}'::text[]) LOOP
    CONTINUE WHEN btrim(coalesce(v_item,'')) = '';
    v_norm := public.omni_comms_priv_channel_test_normalize_target(v_ch, v_item);
    IF (v_norm->>'valid')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_test_recipient'; END IF;
    v_item := lower(btrim(v_item));
    IF NOT (v_item = ANY(v_clean)) THEN v_clean := array_append(v_clean, v_item); END IF;
  END LOOP;

  IF coalesce(array_length(v_clean,1),0) > 5 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='too_many_test_recipients'; END IF;
  IF p_enabled AND coalesce(array_length(v_clean,1),0) = 0 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='approved_recipient_required'; END IF;

  SELECT * INTO v_policy FROM public.omni_comms_channel_setting
   WHERE organization_id = p_organization_id AND channel = v_ch
     AND department_id IS NOT DISTINCT FROM p_department_id
     AND coalesce(data_origin,'') <> 'reference_seed' LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='effective_policy_missing'; END IF;

  v_before := jsonb_build_object(
    'controlled_test_delivery_enabled', v_policy.controlled_test_delivery_enabled,
    'controlled_test_recipients', to_jsonb(coalesce(v_policy.controlled_test_recipients,'{}'::text[])),
    'controlled_test_approval_expires_at', v_policy.controlled_test_approval_expires_at,
    'controlled_test_max_deliveries', v_policy.controlled_test_max_deliveries,
    'controlled_test_min_interval_seconds', v_policy.controlled_test_min_interval_seconds);

  UPDATE public.omni_comms_channel_setting
     SET controlled_test_delivery_enabled = coalesce(p_enabled,false),
         controlled_test_recipients = v_clean,
         controlled_test_approved_at = CASE WHEN coalesce(p_enabled,false) THEN now() ELSE NULL END,
         controlled_test_approved_by = CASE WHEN coalesce(p_enabled,false) THEN v_uid ELSE NULL END,
         controlled_test_approval_expires_at =
           CASE WHEN coalesce(p_enabled,false) THEN now() + make_interval(hours => v_hours) ELSE NULL END,
         controlled_test_max_deliveries = v_max,
         controlled_test_min_interval_seconds = v_interval,
         live_delivery_enabled = false,
         updated_at = now(),
         updated_by = v_uid
   WHERE id = v_policy.id
   RETURNING * INTO v_policy;

  PERFORM public.omni_comms_priv_write_channel_audit(
    v_uid, 'set_controlled_test_approval', 'channel_test_delivery_approval',
    v_policy.id, v_ch, v_before,
    jsonb_build_object(
      'controlled_test_delivery_enabled', v_policy.controlled_test_delivery_enabled,
      'controlled_test_recipients', to_jsonb(coalesce(v_policy.controlled_test_recipients,'{}'::text[])),
      'controlled_test_approval_expires_at', v_policy.controlled_test_approval_expires_at,
      'controlled_test_max_deliveries', v_policy.controlled_test_max_deliveries,
      'controlled_test_min_interval_seconds', v_policy.controlled_test_min_interval_seconds));

  RETURN jsonb_build_object(
    'organization_id', v_policy.organization_id,
    'department_id', v_policy.department_id,
    'channel', v_policy.channel,
    'controlled_test_delivery_enabled', v_policy.controlled_test_delivery_enabled,
    'controlled_test_recipients', to_jsonb(coalesce(v_policy.controlled_test_recipients,'{}'::text[])),
    'controlled_test_approval_expires_at', v_policy.controlled_test_approval_expires_at,
    'controlled_test_max_deliveries', v_policy.controlled_test_max_deliveries,
    'controlled_test_min_interval_seconds', v_policy.controlled_test_min_interval_seconds);
END;
$function$;