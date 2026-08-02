CREATE OR REPLACE FUNCTION public.omni_comms_channel_identity_summary(p_organization_id uuid, p_department_id uuid DEFAULT NULL::uuid, p_channel text DEFAULT 'email'::text, p_include_reference boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_uid uuid; v_ch text; v_can_configure boolean; v_allow_ref boolean;
        v_rows jsonb; v_ref_rows jsonb;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');
  v_ch := btrim(coalesce(p_channel,''));
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='organization_required'; END IF;
  IF v_ch NOT IN ('email','sms','whatsapp','push','in_app','print') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='invalid_channel'; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);

  v_can_configure := public.has_permission(v_uid,'omni_comms','configure');
  v_allow_ref := COALESCE(p_include_reference,false) AND v_can_configure;

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
    'reference_identity_count',
      CASE WHEN v_can_configure THEN jsonb_array_length(v_ref_rows) ELSE 0 END,
    'generated_at', now());
END; $function$;