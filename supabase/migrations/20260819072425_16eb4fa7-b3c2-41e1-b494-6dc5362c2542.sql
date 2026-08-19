CREATE TABLE IF NOT EXISTS public.omni_comms_webhook_subscription (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  department_id uuid,
  action_id uuid NOT NULL REFERENCES public.omni_comms_communication_action(id) ON DELETE CASCADE,
  endpoint_id uuid NOT NULL REFERENCES public.omni_comms_channel_endpoint(id) ON DELETE RESTRICT,
  payload_template_family_id uuid,
  signing_secret_ref text NOT NULL,
  endpoint_config_checksum text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  data_origin text NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT omni_comms_webhook_subscription_status_chk CHECK (status IN ('active','suspended','retired')),
  CONSTRAINT omni_comms_webhook_subscription_secret_chk
    CHECK (signing_secret_ref ~ '^OMNI_COMMS_WEBHOOK_[A-Z0-9]+(_[A-Z0-9]+)*$'),
  CONSTRAINT omni_comms_webhook_subscription_identity UNIQUE (organization_id, action_id, endpoint_id)
);

GRANT ALL ON public.omni_comms_webhook_subscription TO service_role;
ALTER TABLE public.omni_comms_webhook_subscription ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.omni_comms_message
  ADD COLUMN IF NOT EXISTS webhook_subscription_id uuid,
  ADD COLUMN IF NOT EXISTS webhook_endpoint_id uuid,
  ADD COLUMN IF NOT EXISTS webhook_endpoint_checksum text,
  ADD COLUMN IF NOT EXISTS webhook_payload_template_family_id uuid;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_webhook_endpoint_checksum(p_endpoint_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT encode(sha256(convert_to(coalesce(e.endpoint_config::text,'') || '|' || coalesce(e.status,''), 'UTF8')), 'hex')
    FROM public.omni_comms_channel_endpoint e WHERE e.id = p_endpoint_id
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_webhook_endpoint_checksum(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_webhook_endpoint_checksum(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_resolve_webhook_subscription(
  p_organization_id uuid,
  p_department_id uuid,
  p_message_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action uuid;
  v_sub public.omni_comms_webhook_subscription%ROWTYPE;
  v_count integer;
  v_checksum text;
BEGIN
  SELECT m.action_id INTO v_action FROM public.omni_comms_message m WHERE m.id = p_message_id;
  IF v_action IS NULL THEN
    RETURN jsonb_build_object('resolved', false, 'code', 'webhook_action_not_resolved');
  END IF;

  SELECT count(*) INTO v_count
    FROM public.omni_comms_webhook_subscription s
    JOIN public.omni_comms_channel_endpoint e ON e.id = s.endpoint_id
   WHERE s.organization_id = p_organization_id
     AND s.action_id = v_action
     AND s.status = 'active'
     AND coalesce(s.data_origin,'') <> 'reference_seed'
     AND (s.department_id IS NULL OR s.department_id IS NOT DISTINCT FROM p_department_id)
     AND e.channel = 'webhook' AND e.status = 'active';

  IF v_count = 0 THEN
    RETURN jsonb_build_object('resolved', false, 'code', 'webhook_subscription_not_configured');
  ELSIF v_count > 1 THEN
    RETURN jsonb_build_object('resolved', false, 'code', 'webhook_subscription_ambiguous');
  END IF;

  SELECT s.* INTO v_sub
    FROM public.omni_comms_webhook_subscription s
    JOIN public.omni_comms_channel_endpoint e ON e.id = s.endpoint_id
   WHERE s.organization_id = p_organization_id
     AND s.action_id = v_action
     AND s.status = 'active'
     AND coalesce(s.data_origin,'') <> 'reference_seed'
     AND (s.department_id IS NULL OR s.department_id IS NOT DISTINCT FROM p_department_id)
     AND e.channel = 'webhook' AND e.status = 'active';

  v_checksum := public.omni_comms_priv_webhook_endpoint_checksum(v_sub.endpoint_id);
  IF coalesce(v_sub.endpoint_config_checksum,'') <> '' AND v_sub.endpoint_config_checksum <> v_checksum THEN
    RETURN jsonb_build_object('resolved', false, 'code', 'webhook_endpoint_configuration_changed');
  END IF;

  UPDATE public.omni_comms_message
     SET webhook_subscription_id = v_sub.id,
         webhook_endpoint_id = v_sub.endpoint_id,
         webhook_endpoint_checksum = v_checksum,
         webhook_payload_template_family_id = v_sub.payload_template_family_id,
         updated_at = now()
   WHERE id = p_message_id;

  RETURN jsonb_build_object(
    'resolved', true, 'code', 'webhook_subscription_resolved',
    'subscription_id', v_sub.id, 'endpoint_id', v_sub.endpoint_id,
    'endpoint_checksum', v_checksum,
    'signing_secret_ref', v_sub.signing_secret_ref,
    'payload_template_family_id', v_sub.payload_template_family_id);
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_resolve_webhook_subscription(uuid,uuid,uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_resolve_webhook_subscription(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_webhook_subscription_list(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  PERFORM public.omni_comms_priv_require_tenant_access(auth.uid(), p_organization_id, p_department_id);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id,
           'action_id', s.action_id,
           'action_code', a.code,
           'action_name', a.name,
           'endpoint_id', s.endpoint_id,
           'endpoint_code', e.code,
           'endpoint_name', e.display_name,
           'endpoint_status', e.status,
           'payload_template_family_id', s.payload_template_family_id,
           'signing_secret_ref', s.signing_secret_ref,
           'endpoint_config_checksum', s.endpoint_config_checksum,
           'status', s.status,
           'department_id', s.department_id,
           'updated_at', s.updated_at) ORDER BY a.code), '[]'::jsonb)
    INTO v_rows
    FROM public.omni_comms_webhook_subscription s
    JOIN public.omni_comms_communication_action a ON a.id = s.action_id
    JOIN public.omni_comms_channel_endpoint e ON e.id = s.endpoint_id
   WHERE s.organization_id = p_organization_id
     AND (p_department_id IS NULL OR s.department_id IS NOT DISTINCT FROM p_department_id);
  RETURN jsonb_build_object('subscriptions', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_webhook_subscription_list(uuid,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_webhook_subscription_list(uuid,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_webhook_subscription_upsert(
  p_organization_id uuid,
  p_action_id uuid,
  p_endpoint_id uuid,
  p_signing_secret_ref text,
  p_department_id uuid DEFAULT NULL,
  p_payload_template_family_id uuid DEFAULT NULL,
  p_status text DEFAULT 'active'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_id uuid;
  v_status text := lower(coalesce(nullif(btrim(p_status),''),'active'));
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'OC401 unauthenticated' USING ERRCODE='P0001';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_user, p_organization_id, p_department_id);
  IF NOT public.has_permission(v_user, 'omni_comms', 'configure') THEN
    RAISE EXCEPTION 'OC403 configure_permission_required' USING ERRCODE='P0001';
  END IF;
  IF v_status NOT IN ('active','suspended','retired') THEN
    RAISE EXCEPTION 'OC422 invalid_status' USING ERRCODE='P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_channel_endpoint e
                  WHERE e.id = p_endpoint_id AND e.organization_id = p_organization_id
                    AND e.channel = 'webhook') THEN
    RAISE EXCEPTION 'OC404 webhook_endpoint_missing' USING ERRCODE='P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.omni_comms_communication_action a
                  WHERE a.id = p_action_id AND a.organization_id = p_organization_id) THEN
    RAISE EXCEPTION 'OC404 communication_action_missing' USING ERRCODE='P0001';
  END IF;

  INSERT INTO public.omni_comms_webhook_subscription (
    organization_id, department_id, action_id, endpoint_id,
    payload_template_family_id, signing_secret_ref, endpoint_config_checksum,
    status, data_origin, created_by, updated_by)
  VALUES (p_organization_id, p_department_id, p_action_id, p_endpoint_id,
    p_payload_template_family_id, btrim(coalesce(p_signing_secret_ref,'')),
    coalesce(public.omni_comms_priv_webhook_endpoint_checksum(p_endpoint_id),''),
    v_status, 'user', v_user, v_user)
  ON CONFLICT (organization_id, action_id, endpoint_id) DO UPDATE
    SET department_id = EXCLUDED.department_id,
        payload_template_family_id = EXCLUDED.payload_template_family_id,
        signing_secret_ref = EXCLUDED.signing_secret_ref,
        endpoint_config_checksum = EXCLUDED.endpoint_config_checksum,
        status = EXCLUDED.status,
        updated_at = now(), updated_by = v_user
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_webhook_subscription_upsert(uuid,uuid,uuid,text,uuid,uuid,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_webhook_subscription_upsert(uuid,uuid,uuid,text,uuid,uuid,text) TO authenticated, service_role;

DO $do$
DECLARE
  v_src text;
  v_old text;
  v_new text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE proname = 'omni_comms_priv_dispatch_claim_generic';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'generic claim missing';
  END IF;

  v_old := '        SELECT * INTO v_endpoint
          FROM public.omni_comms_channel_endpoint e
         WHERE e.organization_id = v_job.organization_id
           AND e.channel = ''webhook''
           AND e.status = ''active''
           AND coalesce(e.data_origin,'''') <> ''reference_seed''
           AND (e.department_id IS NOT DISTINCT FROM v_job.msg_department_id
                OR e.department_id IS NULL)
         ORDER BY (e.department_id IS NOT NULL) DESC, e.created_at
         LIMIT 1;
        IF v_endpoint.id IS NULL THEN
          v_deny := ''webhook_endpoint_not_configured'';';

  v_new := '        v_sub := public.omni_comms_priv_resolve_webhook_subscription(
                   v_job.organization_id, v_job.msg_department_id, v_job.message_id);
        IF coalesce((v_sub->>''resolved'')::boolean,false) IS NOT TRUE THEN
          v_endpoint := NULL;
        ELSE
          SELECT * INTO v_endpoint FROM public.omni_comms_channel_endpoint e
           WHERE e.id = (v_sub->>''endpoint_id'')::uuid;
        END IF;
        IF v_endpoint.id IS NULL THEN
          v_deny := coalesce(v_sub->>''code'',''webhook_subscription_not_configured'');';

  IF position(v_old in v_src) = 0 THEN
    RAISE EXCEPTION 'generic claim webhook block not found - refusing to patch blindly';
  END IF;

  v_src := replace(v_src, v_old, v_new);
  v_src := replace(v_src, '  v_extra jsonb;', '  v_extra jsonb;' || chr(10) || '  v_sub jsonb;');

  EXECUTE format($f$
    CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_claim_generic(
      p_channel text, p_batch_limit integer, p_worker text, p_correlation_id text,
      p_execution_context text, p_deployed_revision text)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS %L
  $f$, v_src);
END
$do$;