-- Omni-Comms — Push / Webhook / Voice schema enablement (Stage 1).
DO $$
DECLARE
  r record;
  v_all text := $q$CHECK (channel = ANY (ARRAY['email'::text,'sms'::text,'whatsapp'::text,'push'::text,'in_app'::text,'print'::text,'webhook'::text,'voice'::text]))$q$;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, c.conname
      FROM pg_constraint c
     WHERE c.contype = 'c'
       AND c.conrelid::regclass::text LIKE 'omni_comms%'
       AND pg_get_constraintdef(c.oid) LIKE 'CHECK ((channel = ANY%'
       AND pg_get_constraintdef(c.oid) NOT LIKE '%voice%'
  LOOP
    EXECUTE format('ALTER TABLE public.%s DROP CONSTRAINT %I', r.tbl, r.conname);
    EXECUTE format('ALTER TABLE public.%s ADD CONSTRAINT %I %s', r.tbl, r.conname, v_all);
  END LOOP;
END $$;

ALTER TABLE public.omni_comms_channel_test_run
  DROP CONSTRAINT IF EXISTS omni_comms_ctr_target_type_chk;
ALTER TABLE public.omni_comms_channel_test_run
  ADD CONSTRAINT omni_comms_ctr_target_type_chk CHECK (target_type = ANY (ARRAY[
    'email_address','phone_number','whatsapp_number','device_token',
    'user_reference','recipient_reference','endpoint_url','voice_number']));

CREATE OR REPLACE FUNCTION public.omni_comms_priv_channel_test_normalize_target(p_channel text, p_target text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v text := btrim(coalesce(p_target,''));
  v_digits text;
  v_type text;
  v_masked text;
  v_host text;
BEGIN
  IF v = '' THEN
    RETURN jsonb_build_object('valid', false, 'code', 'target_missing');
  END IF;

  IF p_channel = 'email' THEN
    v_type := 'email_address';
    v := lower(v);
    IF length(v) > 254 OR v !~ '^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$' THEN
      RETURN jsonb_build_object('valid', false, 'code', 'target_invalid_email');
    END IF;
    v_masked := public.omni_comms_priv_mask_email(v);

  ELSIF p_channel IN ('sms','whatsapp','voice') THEN
    v_type := CASE p_channel WHEN 'sms' THEN 'phone_number'
                             WHEN 'whatsapp' THEN 'whatsapp_number'
                             ELSE 'voice_number' END;
    v := regexp_replace(v, '[\s()\-\.]', '', 'g');
    IF v !~ '^\+[1-9][0-9]{6,14}$' THEN
      RETURN jsonb_build_object('valid', false, 'code', 'target_invalid_phone');
    END IF;
    v_digits := regexp_replace(v, '\D', '', 'g');
    v_masked := '+' || left(v_digits, 1)
                || repeat('*', greatest(length(v_digits) - 5, 1))
                || right(v_digits, 4);

  ELSIF p_channel = 'push' THEN
    v_type := 'device_token';
    IF length(v) < 8 OR length(v) > 512 OR v ~ '\s' THEN
      RETURN jsonb_build_object('valid', false, 'code', 'target_invalid_device_token');
    END IF;
    v_masked := 'tok_' || repeat('*', 6) || right(v, 4);

  ELSIF p_channel = 'webhook' THEN
    v_type := 'endpoint_url';
    IF length(v) > 2048 OR v !~ '^https://[A-Za-z0-9._~:/?#%@!$&''()*+,;=\-]+$' THEN
      RETURN jsonb_build_object('valid', false, 'code', 'target_invalid_endpoint_url');
    END IF;
    v_host := lower(split_part(split_part(regexp_replace(v, '^https://', ''), '/', 1), ':', 1));
    IF v_host = '' OR v_host IN ('localhost','metadata.google.internal','169.254.169.254')
       OR v_host ~ '^127\.' OR v_host ~ '^10\.' OR v_host ~ '^192\.168\.'
       OR v_host ~ '^172\.(1[6-9]|2[0-9]|3[01])\.' OR v_host ~ '^169\.254\.'
       OR v_host ~ '\.local$' OR v_host ~ '\.internal$' OR v_host = '0.0.0.0'
       OR v_host LIKE '[%' THEN
      RETURN jsonb_build_object('valid', false, 'code', 'target_endpoint_host_not_permitted');
    END IF;
    v_masked := 'https://' || v_host || '/***';

  ELSIF p_channel = 'in_app' THEN
    v_type := 'user_reference';
    IF length(v) < 3 OR length(v) > 128 OR v !~ '^[A-Za-z0-9._:@-]+$' THEN
      RETURN jsonb_build_object('valid', false, 'code', 'target_invalid_user_reference');
    END IF;
    v_masked := public.omni_comms_priv_mask_reference(v);

  ELSIF p_channel = 'print' THEN
    v_type := 'recipient_reference';
    IF length(v) < 3 OR length(v) > 160 OR v !~ '^[A-Za-z0-9 .,''\-/#&()]+$' THEN
      RETURN jsonb_build_object('valid', false, 'code', 'target_invalid_recipient_reference');
    END IF;
    v_masked := public.omni_comms_priv_mask_reference(v);

  ELSE
    RETURN jsonb_build_object('valid', false, 'code', 'target_channel_unsupported');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'code', 'target_valid',
    'target_type', v_type,
    'target_masked', coalesce(v_masked, 'masked'),
    'target_hash', public.omni_comms_priv_channel_test_sha256(p_channel || '|' || v)
  );
END; $function$;

CREATE TABLE IF NOT EXISTS public.omni_comms_push_device (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  recipient_reference text,
  platform text NOT NULL CHECK (platform IN ('ios','android','web')),
  device_token text NOT NULL,
  app_identifier text,
  app_version text,
  device_model text,
  locale text,
  timezone text,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','stale','revoked')),
  revoked_reason text,
  failure_count integer NOT NULL DEFAULT 0,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_push_device_token_uk
  ON public.omni_comms_push_device (device_token);
CREATE INDEX IF NOT EXISTS omni_comms_push_device_user_idx
  ON public.omni_comms_push_device (organization_id, user_id, state);
CREATE INDEX IF NOT EXISTS omni_comms_push_device_ref_idx
  ON public.omni_comms_push_device (organization_id, recipient_reference, state);

GRANT SELECT ON public.omni_comms_push_device TO authenticated;
GRANT ALL ON public.omni_comms_push_device TO service_role;

ALTER TABLE public.omni_comms_push_device ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS omni_comms_push_device_owner_select ON public.omni_comms_push_device;
CREATE POLICY omni_comms_push_device_owner_select
  ON public.omni_comms_push_device FOR SELECT TO authenticated
  USING (user_id = auth.uid());

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
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_platform text := lower(btrim(coalesce(p_platform,'')));
  v_token text := btrim(coalesce(p_device_token,''));
  v_norm jsonb;
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

  INSERT INTO public.omni_comms_push_device (
    organization_id, user_id, recipient_reference, platform, device_token,
    app_identifier, app_version, device_model, locale, timezone,
    state, failure_count, last_seen_at)
  VALUES (
    p_organization_id, v_user, nullif(btrim(coalesce(p_recipient_reference,'')),''),
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
        recipient_reference = coalesce(EXCLUDED.recipient_reference, public.omni_comms_push_device.recipient_reference),
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
END; $function$;

REVOKE ALL ON FUNCTION public.omni_comms_push_device_register(uuid,text,text,text,text,text,text,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.omni_comms_push_device_register(uuid,text,text,text,text,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_push_device_deregister(
  p_device_token text,
  p_reason text DEFAULT 'user_deregistered'
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'OC401 unauthenticated' USING ERRCODE='P0001';
  END IF;
  UPDATE public.omni_comms_push_device
     SET state = 'revoked',
         revoked_reason = left(coalesce(nullif(btrim(p_reason),''),'user_deregistered'),200),
         updated_at = now()
   WHERE device_token = btrim(coalesce(p_device_token,''))
     AND user_id = v_user
     AND state <> 'revoked';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $function$;

REVOKE ALL ON FUNCTION public.omni_comms_push_device_deregister(text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.omni_comms_push_device_deregister(text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_resolve_push_devices(
  p_organization_id uuid,
  p_recipient_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
           AND d.recipient_reference = v_rec.recipient_reference)
     );

  IF jsonb_array_length(v_devices) = 0 THEN
    RETURN jsonb_build_object('resolved', false, 'code', 'push_no_active_device', 'devices', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object('resolved', true, 'code', 'push_devices_resolved',
                            'device_count', jsonb_array_length(v_devices),
                            'devices', v_devices);
END; $function$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_push_device_feedback(
  p_device_token text,
  p_outcome text,
  p_provider_code text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_outcome text := lower(btrim(coalesce(p_outcome,'')));
BEGIN
  IF v_outcome = 'delivered' THEN
    UPDATE public.omni_comms_push_device
       SET last_success_at = now(), failure_count = 0, updated_at = now()
     WHERE device_token = btrim(coalesce(p_device_token,''));
  ELSIF v_outcome IN ('unregistered','invalid_token') THEN
    UPDATE public.omni_comms_push_device
       SET state = 'revoked',
           revoked_reason = left('provider_' || v_outcome || coalesce(' ('||p_provider_code||')',''), 200),
           updated_at = now()
     WHERE device_token = btrim(coalesce(p_device_token,''));
  ELSE
    UPDATE public.omni_comms_push_device
       SET failure_count = failure_count + 1,
           state = CASE WHEN failure_count + 1 >= 10 THEN 'stale' ELSE state END,
           updated_at = now()
     WHERE device_token = btrim(coalesce(p_device_token,''));
  END IF;
END; $function$;