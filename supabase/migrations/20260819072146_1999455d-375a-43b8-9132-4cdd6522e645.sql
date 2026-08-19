-- see /tmp/mig1.sql
CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_kind(p_channel text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE lower(coalesce(btrim(p_channel), ''))
    WHEN 'email' THEN 'addressed'
    WHEN 'sms' THEN 'addressed'
    WHEN 'whatsapp' THEN 'addressed'
    WHEN 'voice' THEN 'addressed'
    WHEN 'push' THEN 'device'
    WHEN 'in_app' THEN 'internal'
    WHEN 'webhook' THEN 'endpoint'
    WHEN 'print' THEN 'physical'
    ELSE 'unsupported'
  END
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_channel_kind(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_channel_kind(text) TO authenticated, service_role;

ALTER TABLE public.omni_comms_push_device
  ADD COLUMN IF NOT EXISTS recipient_reference_verified boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.omni_comms_push_device_register(
  p_organization_id uuid,
  p_platform text,
  p_device_token text,
  p_app_identifier text DEFAULT NULL,
  p_app_version text DEFAULT NULL,
  p_device_model text DEFAULT NULL,
  p_locale text DEFAULT NULL,
  p_timezone text DEFAULT NULL,
  p_recipient_reference text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_platform text := lower(btrim(coalesce(p_platform,'')));
  v_token text := btrim(coalesce(p_device_token,''));
  v_norm jsonb;
  v_ref text;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'OC401 unauthenticated' USING ERRCODE='P0001';
  END IF;
  IF v_platform NOT IN ('ios','android','web') THEN
    RAISE EXCEPTION 'OC422 invalid_platform' USING ERRCODE='P0001';
  END IF;
  v_norm := public.omni_comms_priv_channel_test_normalize_target('push', v_token);
  IF coalesce((v_norm->>'valid')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'OC422 invalid_device_token' USING ERRCODE='P0001';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_user, p_organization_id, NULL);

  SELECT r.recipient_reference INTO v_ref
    FROM public.omni_comms_recipient r
   WHERE r.organization_id = p_organization_id
     AND r.recipient_reference IS NOT NULL
     AND public.omni_comms_priv_resolve_in_app_user(r.id) = v_user
   ORDER BY r.created_at DESC
   LIMIT 1;

  IF nullif(btrim(coalesce(p_recipient_reference,'')),'') IS NOT NULL
     AND coalesce(v_ref,'') <> btrim(p_recipient_reference) THEN
    RAISE EXCEPTION 'OC403 push_recipient_assertion_forbidden' USING ERRCODE='P0001';
  END IF;

  UPDATE public.omni_comms_push_device
     SET state = 'revoked', revoked_reason = 'token_reassigned', updated_at = now()
   WHERE device_token = v_token AND user_id <> v_user;

  INSERT INTO public.omni_comms_push_device (
    organization_id, user_id, recipient_reference, recipient_reference_verified,
    platform, device_token, app_identifier, app_version, device_model, locale, timezone,
    state, failure_count, last_seen_at)
  VALUES (
    p_organization_id, v_user, v_ref, v_ref IS NOT NULL,
    v_platform, v_token,
    nullif(btrim(coalesce(p_app_identifier,'')),''),
    nullif(btrim(coalesce(p_app_version,'')),''),
    nullif(btrim(coalesce(p_device_model,'')),''),
    nullif(btrim(coalesce(p_locale,'')),''),
    nullif(btrim(coalesce(p_timezone,'')),''),
    'active', 0, now())
  ON CONFLICT (device_token) DO UPDATE
    SET organization_id = EXCLUDED.organization_id,
        user_id = EXCLUDED.user_id,
        recipient_reference = EXCLUDED.recipient_reference,
        recipient_reference_verified = EXCLUDED.recipient_reference_verified,
        platform = EXCLUDED.platform,
        app_identifier = coalesce(EXCLUDED.app_identifier, public.omni_comms_push_device.app_identifier),
        app_version = coalesce(EXCLUDED.app_version, public.omni_comms_push_device.app_version),
        device_model = coalesce(EXCLUDED.device_model, public.omni_comms_push_device.device_model),
        locale = coalesce(EXCLUDED.locale, public.omni_comms_push_device.locale),
        timezone = coalesce(EXCLUDED.timezone, public.omni_comms_push_device.timezone),
        state = 'active', revoked_reason = NULL, failure_count = 0,
        last_seen_at = now(), updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_resolve_push_devices(
  p_organization_id uuid,
  p_recipient_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec public.omni_comms_recipient%ROWTYPE;
  v_user uuid;
  v_devices jsonb;
BEGIN
  SELECT * INTO v_rec FROM public.omni_comms_recipient WHERE id = p_recipient_id;
  IF v_rec.id IS NULL THEN
    RETURN jsonb_build_object('resolved', false, 'code', 'recipient_missing', 'devices', '[]'::jsonb);
  END IF;

  v_user := public.omni_comms_priv_resolve_in_app_user(p_recipient_id);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'device_id', d.id, 'platform', d.platform, 'token', d.device_token)
           ORDER BY d.last_seen_at DESC), '[]'::jsonb)
    INTO v_devices
    FROM public.omni_comms_push_device d
   WHERE d.organization_id = p_organization_id
     AND d.state = 'active'
     AND (
       (v_user IS NOT NULL AND d.user_id = v_user)
       OR (v_rec.recipient_reference IS NOT NULL
           AND d.recipient_reference_verified
           AND d.recipient_reference = v_rec.recipient_reference)
     );

  IF jsonb_array_length(v_devices) = 0 THEN
    RETURN jsonb_build_object('resolved', false, 'code', 'push_no_active_device', 'devices', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object('resolved', true, 'code', 'push_devices_resolved',
                            'device_count', jsonb_array_length(v_devices),
                            'devices', v_devices);
END;
$$;

CREATE TABLE IF NOT EXISTS public.omni_comms_push_delivery_target (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  message_id uuid NOT NULL REFERENCES public.omni_comms_message(id) ON DELETE CASCADE,
  push_device_id uuid NOT NULL REFERENCES public.omni_comms_push_device(id) ON DELETE CASCADE,
  platform text NOT NULL,
  attempt_status text NOT NULL DEFAULT 'pending',
  provider_message_id text,
  rejection_classification text,
  error_code text,
  attempted_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT omni_comms_push_delivery_target_status_chk
    CHECK (attempt_status IN ('pending','accepted','rejected','uncertain')),
  CONSTRAINT omni_comms_push_delivery_target_identity UNIQUE (message_id, push_device_id)
);

GRANT ALL ON public.omni_comms_push_delivery_target TO service_role;
ALTER TABLE public.omni_comms_push_delivery_target ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS omni_comms_push_delivery_target_message_idx
  ON public.omni_comms_push_delivery_target (message_id);

CREATE OR REPLACE FUNCTION public.omni_comms_priv_push_target_record(
  p_message_id uuid,
  p_push_device_id uuid,
  p_attempt_status text,
  p_provider_message_id text DEFAULT NULL,
  p_rejection_classification text DEFAULT NULL,
  p_error_code text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_platform text;
  v_status text := lower(coalesce(btrim(p_attempt_status),''));
  v_id uuid;
BEGIN
  IF v_status NOT IN ('pending','accepted','rejected','uncertain') THEN
    RAISE EXCEPTION 'OC422 push_target_status_invalid' USING ERRCODE='P0001';
  END IF;
  SELECT m.organization_id INTO v_org FROM public.omni_comms_message m WHERE m.id = p_message_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'OC404 push_target_message_missing' USING ERRCODE='P0001';
  END IF;
  SELECT d.platform INTO v_platform
    FROM public.omni_comms_push_device d
   WHERE d.id = p_push_device_id AND d.organization_id = v_org;
  IF v_platform IS NULL THEN
    RAISE EXCEPTION 'OC404 push_target_device_missing' USING ERRCODE='P0001';
  END IF;

  INSERT INTO public.omni_comms_push_delivery_target (
    organization_id, message_id, push_device_id, platform, attempt_status,
    provider_message_id, rejection_classification, error_code, attempted_at,
    settled_at)
  VALUES (v_org, p_message_id, p_push_device_id, v_platform, v_status,
    left(nullif(btrim(coalesce(p_provider_message_id,'')),''),200),
    left(nullif(btrim(coalesce(p_rejection_classification,'')),''),80),
    left(nullif(btrim(coalesce(p_error_code,'')),''),80),
    now(),
    CASE WHEN v_status IN ('accepted','rejected') THEN now() ELSE NULL END)
  ON CONFLICT (message_id, push_device_id) DO UPDATE
    SET attempt_status = EXCLUDED.attempt_status,
        provider_message_id = coalesce(EXCLUDED.provider_message_id, public.omni_comms_push_delivery_target.provider_message_id),
        rejection_classification = EXCLUDED.rejection_classification,
        error_code = EXCLUDED.error_code,
        attempted_at = now(),
        settled_at = EXCLUDED.settled_at,
        updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_push_target_record(uuid,uuid,text,text,text,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_push_target_record(uuid,uuid,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.omni_comms_push_delivery_targets(p_message_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_rows jsonb;
  v_derived text;
BEGIN
  SELECT m.organization_id INTO v_org FROM public.omni_comms_message m WHERE m.id = p_message_id;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('found', false, 'targets', '[]'::jsonb);
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(auth.uid(), v_org, NULL);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'target_id', t.id,
           'platform', t.platform,
           'push_registration_id', t.push_device_id,
           'attempt_status', t.attempt_status,
           'provider_message_id', t.provider_message_id,
           'rejection_classification', t.rejection_classification,
           'attempted_at', t.attempted_at,
           'settled_at', t.settled_at) ORDER BY t.created_at), '[]'::jsonb)
    INTO v_rows
    FROM public.omni_comms_push_delivery_target t
   WHERE t.message_id = p_message_id;

  SELECT CASE
    WHEN count(*) = 0 THEN 'pending'
    WHEN count(*) FILTER (WHERE attempt_status = 'accepted') > 0 THEN 'accepted'
    WHEN count(*) FILTER (WHERE attempt_status = 'uncertain') > 0 THEN 'uncertain'
    WHEN count(*) FILTER (WHERE attempt_status = 'rejected') = count(*) THEN 'rejected'
    ELSE 'pending' END
    INTO v_derived
    FROM public.omni_comms_push_delivery_target WHERE message_id = p_message_id;

  RETURN jsonb_build_object('found', true, 'derived_status', v_derived, 'targets', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.omni_comms_push_delivery_targets(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_push_delivery_targets(uuid) TO authenticated, service_role;