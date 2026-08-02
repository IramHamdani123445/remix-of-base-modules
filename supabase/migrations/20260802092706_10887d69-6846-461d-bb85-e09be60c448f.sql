CREATE OR REPLACE FUNCTION public.omni_comms_channel_identity_summary(p_organization_id uuid, p_department_id uuid DEFAULT NULL::uuid, p_channel text DEFAULT 'email'::text, p_include_reference boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_uid uuid; v_ch text; v_allow_ref boolean;
        v_rows jsonb; v_ref_rows jsonb;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  v_ch := btrim(coalesce(p_channel,''));
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_required'; END IF;
  IF v_ch NOT IN ('email','sms','whatsapp','push','in_app','print') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_channel'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);

  v_allow_ref := COALESCE(p_include_reference,false)
                 AND public.has_permission(v_uid,'omni_comms','configure');

  WITH ident AS (
    SELECT s.* FROM public.omni_comms_sender_identity s
     WHERE s.organization_id = p_organization_id
       AND s.channel = v_ch
       AND (p_department_id IS NULL
            OR s.department_id IS NULL
            OR s.department_id = p_department_id)
  ), shaped AS (
    SELECT i.data_origin AS origin, i.created_at, jsonb_build_object(
      'id',i.id,'code',i.code,'display_name',i.display_name,'channel',i.channel,
      'identity_type',i.identity_type,'identity_config',i.identity_config,
      'department_id',i.department_id,
      'department_name', d.name,
      'event_definition_id',i.event_definition_id,
      'status',i.status,'data_origin',i.data_origin,
      'from_address',i.from_address,'from_name',i.from_name,
      'reply_to_address',i.reply_to_address,
      'updated_at',i.updated_at,'activated_at',i.activated_at,
      'retired_at',i.retired_at,'retirement_reason',i.retirement_reason) AS row_json
      FROM ident i
      LEFT JOIN public.core_department d
        ON d.id = i.department_id
       AND d.organization_id = p_organization_id
  )
  SELECT
    COALESCE(jsonb_agg(row_json ORDER BY created_at) FILTER (WHERE origin <> 'reference_seed'),'[]'::jsonb),
    COALESCE(jsonb_agg(row_json ORDER BY created_at) FILTER (WHERE origin = 'reference_seed'),'[]'::jsonb)
    INTO v_rows, v_ref_rows
  FROM shaped;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'department_id', p_department_id,
    'channel', v_ch,
    'identities', v_rows,
    'reference_identities', CASE WHEN v_allow_ref THEN v_ref_rows ELSE '[]'::jsonb END,
    'reference_identity_count', CASE WHEN v_allow_ref THEN jsonb_array_length(v_ref_rows) ELSE 0 END,
    'generated_at', now());
END; $function$;

CREATE OR REPLACE FUNCTION public.omni_comms_email_config_summary(p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'extensions'
AS $function$
DECLARE v_uid uuid; v_pid uuid; v_provider jsonb; v_accounts jsonb; v_senders jsonb;
        v_bindings jsonb; v_setting jsonb; v_ready boolean;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001',DETAIL='organization_required'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);
  v_pid := public.omni_comms_priv_email_provider_id();
  IF v_pid IS NULL THEN v_provider := NULL;
  ELSE
    SELECT jsonb_build_object('id',id,'code',code,'status',status,'updated_at',updated_at,'activated_at',activated_at)
      INTO v_provider FROM public.omni_comms_provider WHERE id=v_pid;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',a.id,'code',a.code,'display_name',a.display_name,'secret_ref',a.secret_ref,
      'region',a.region,'sandbox_mode',a.sandbox_mode,'status',a.status,
      'environment',a.environment,'data_origin',a.data_origin,
      'provider_account_reference',a.provider_account_reference,
      'health_state',a.health_state,'health_checked_at',a.health_checked_at,'updated_at',a.updated_at,
      'verification_status',a.verification_status,
      'verification_result_code',a.verification_result_code,
      'verification_detail',a.verification_detail,
      'verification_checked_at',a.verification_checked_at
    ) ORDER BY a.created_at),'[]'::jsonb) INTO v_accounts
    FROM public.omni_comms_provider_account a
   WHERE a.organization_id=p_organization_id AND a.provider_id=v_pid;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',id,'code',code,'display_name',display_name,
      'from_address',from_address,'from_name',from_name,'reply_to_address',reply_to_address,
      'status',status,'department_id',department_id,'event_definition_id',event_definition_id,
      'data_origin',data_origin,'identity_type',identity_type,'identity_config',identity_config,
      'updated_at',updated_at
    ) ORDER BY created_at),'[]'::jsonb) INTO v_senders
    FROM public.omni_comms_sender_identity
   WHERE organization_id=p_organization_id AND channel='email';
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',b.id,'sender_identity_id',b.sender_identity_id,
      'provider_account_id',b.provider_account_id,'priority',b.priority,
      'external_sender_ref',b.external_sender_ref,
      'verification_status',b.verification_status,'verified_at',b.verified_at,
      'status',b.status,'updated_at',b.updated_at
    ) ORDER BY b.created_at),'[]'::jsonb) INTO v_bindings
    FROM public.omni_comms_sender_provider_binding b
    JOIN public.omni_comms_sender_identity s ON s.id=b.sender_identity_id
   WHERE s.organization_id=p_organization_id AND s.channel='email';
  SELECT jsonb_build_object(
      'id',id,'department_id',department_id,'enabled',enabled,
      'live_delivery_enabled',live_delivery_enabled,
      'quiet_hours_start',quiet_hours_start,'quiet_hours_end',quiet_hours_end,
      'quiet_hours_timezone',quiet_hours_timezone,'per_minute_limit',per_minute_limit,
      'updated_at',updated_at) INTO v_setting
    FROM public.omni_comms_channel_setting
   WHERE organization_id=p_organization_id AND department_id IS NULL AND channel='email' LIMIT 1;
  v_ready :=
      v_provider IS NOT NULL AND (v_provider->>'status')='active'
      AND EXISTS(SELECT 1 FROM public.omni_comms_provider_account
                  WHERE organization_id=p_organization_id AND provider_id=v_pid
                    AND status='active' AND verification_status='verified'
                    AND data_origin <> 'reference_seed')
      AND EXISTS(SELECT 1 FROM public.omni_comms_sender_identity
                  WHERE organization_id=p_organization_id AND channel='email' AND status='active'
                    AND data_origin <> 'reference_seed')
      AND EXISTS(SELECT 1 FROM public.omni_comms_sender_provider_binding b
                  JOIN public.omni_comms_sender_identity s ON s.id=b.sender_identity_id
                 WHERE s.organization_id=p_organization_id AND s.channel='email'
                   AND b.status='active' AND b.verification_status='verified')
      AND v_setting IS NOT NULL AND (v_setting->>'enabled')::boolean=true;
  RETURN jsonb_build_object(
    'organization_id',p_organization_id,'provider',v_provider,
    'provider_accounts',v_accounts,'sender_identities',v_senders,
    'bindings',v_bindings,'channel_setting',v_setting,
    'email_send_ready',v_ready,'generated_at',now());
END; $function$;