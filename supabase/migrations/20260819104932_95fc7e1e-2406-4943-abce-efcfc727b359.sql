
-- ── Webhook subscription administration ────────────────────────────────
CREATE OR REPLACE FUNCTION public.omni_comms_priv_webhook_subscription_list(
  p_actor_id uuid, p_organization_id uuid, p_department_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  PERFORM public.omni_comms_priv_require_tenant_access(p_actor_id, p_organization_id, p_department_id);
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'display_name'), '[]'::jsonb) INTO v
  FROM (
    SELECT jsonb_build_object(
      'id', s.id,
      'organization_id', s.organization_id,
      'department_id', s.department_id,
      'action_id', s.action_id,
      'action_code', a.action_code,
      'endpoint_id', s.endpoint_id,
      'endpoint_code', e.code,
      'display_name', coalesce(e.display_name, e.code),
      'endpoint_status', e.status,
      'payload_template_family_id', s.payload_template_family_id,
      'signing_secret_ref', s.signing_secret_ref,
      'endpoint_config_checksum', s.endpoint_config_checksum,
      'endpoint_current_checksum', public.omni_comms_priv_webhook_endpoint_checksum(s.endpoint_id),
      'status', s.status,
      'data_origin', s.data_origin,
      'updated_at', s.updated_at
    ) AS x
    FROM public.omni_comms_webhook_subscription s
    JOIN public.omni_comms_channel_endpoint e ON e.id = s.endpoint_id
    LEFT JOIN public.omni_comms_communication_action a ON a.id = s.action_id
    WHERE s.organization_id = p_organization_id
      AND (p_department_id IS NULL OR s.department_id IS NOT DISTINCT FROM p_department_id)
  ) q;
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.omni_comms_webhook_subscription_list(
  p_organization_id uuid, p_department_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  RETURN public.omni_comms_priv_webhook_subscription_list(v_uid, p_organization_id, p_department_id);
END; $$;

CREATE OR REPLACE FUNCTION public.omni_comms_webhook_subscription_upsert(
  p_id uuid,
  p_expected_updated_at timestamptz,
  p_organization_id uuid,
  p_department_id uuid,
  p_action_id uuid,
  p_endpoint_id uuid,
  p_payload_template_family_id uuid DEFAULT NULL,
  p_signing_secret_ref text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_id uuid; v_prev timestamptz; v_channel text; v_checksum text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);

  IF p_action_id IS NULL OR p_endpoint_id IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING DETAIL = 'action_and_endpoint_required';
  END IF;

  SELECT channel INTO v_channel FROM public.omni_comms_channel_endpoint
   WHERE id = p_endpoint_id AND organization_id = p_organization_id;
  IF v_channel IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING DETAIL = 'endpoint_not_found';
  END IF;
  IF v_channel <> 'webhook' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING DETAIL = 'endpoint_not_webhook';
  END IF;
  IF p_signing_secret_ref IS NOT NULL
     AND p_signing_secret_ref !~ '^OMNI_COMMS_WEBHOOK_[A-Z0-9]+(_[A-Z0-9]+)*$' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING DETAIL = 'signing_secret_ref_invalid';
  END IF;

  v_checksum := public.omni_comms_priv_webhook_endpoint_checksum(p_endpoint_id);

  IF p_id IS NULL THEN
    INSERT INTO public.omni_comms_webhook_subscription(
      organization_id, department_id, action_id, endpoint_id,
      payload_template_family_id, signing_secret_ref, endpoint_config_checksum,
      status, data_origin, created_by, updated_by)
    VALUES (p_organization_id, p_department_id, p_action_id, p_endpoint_id,
      p_payload_template_family_id, p_signing_secret_ref, v_checksum,
      'active', 'operator', v_uid, v_uid)
    RETURNING id INTO v_id;
  ELSE
    SELECT updated_at INTO v_prev FROM public.omni_comms_webhook_subscription
      WHERE id = p_id AND organization_id = p_organization_id;
    IF v_prev IS NULL THEN
      RAISE EXCEPTION 'OC404 not_found' USING DETAIL = 'subscription_not_found';
    END IF;
    IF p_expected_updated_at IS NULL OR v_prev <> p_expected_updated_at THEN
      RAISE EXCEPTION 'OC413 concurrent_update' USING DETAIL = 'subscription_changed';
    END IF;
    UPDATE public.omni_comms_webhook_subscription
       SET action_id = p_action_id,
           endpoint_id = p_endpoint_id,
           payload_template_family_id = p_payload_template_family_id,
           signing_secret_ref = p_signing_secret_ref,
           endpoint_config_checksum = v_checksum,
           updated_at = now(),
           updated_by = v_uid
     WHERE id = p_id
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.omni_comms_webhook_subscription_set_lifecycle(
  p_id uuid, p_expected_updated_at timestamptz, p_action text, p_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_prev timestamptz; v_org uuid; v_dept uuid; v_status text; v_next text;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  SELECT updated_at, organization_id, department_id, status
    INTO v_prev, v_org, v_dept, v_status
    FROM public.omni_comms_webhook_subscription WHERE id = p_id;
  IF v_prev IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING DETAIL = 'subscription_not_found';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_org, v_dept);
  IF p_expected_updated_at IS NULL OR v_prev <> p_expected_updated_at THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING DETAIL = 'subscription_changed';
  END IF;

  v_next := CASE p_action
    WHEN 'activate' THEN 'active'
    WHEN 'suspend' THEN 'suspended'
    WHEN 'retire' THEN 'retired'
    ELSE NULL END;
  IF v_next IS NULL THEN
    RAISE EXCEPTION 'OC422 validation_error' USING DETAIL = 'action_invalid';
  END IF;
  IF v_status = 'retired' THEN
    RAISE EXCEPTION 'OC412 invalid_state' USING DETAIL = 'subscription_retired';
  END IF;

  UPDATE public.omni_comms_webhook_subscription
     SET status = v_next,
         endpoint_config_checksum = CASE WHEN v_next = 'active'
            THEN public.omni_comms_priv_webhook_endpoint_checksum(endpoint_id)
            ELSE endpoint_config_checksum END,
         updated_at = now(), updated_by = v_uid
   WHERE id = p_id;
  RETURN p_id;
END; $$;

-- ── Push registration administration (never returns a device token) ────
CREATE OR REPLACE FUNCTION public.omni_comms_push_device_admin_list(
  p_organization_id uuid, p_include_retired boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v jsonb;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'last_seen_at' DESC), '[]'::jsonb) INTO v
  FROM (
    SELECT jsonb_build_object(
      'id', d.id,
      'platform', d.platform,
      'state', d.state,
      'recipient_reference', d.recipient_reference,
      'recipient_reference_verified', d.recipient_reference_verified,
      'token_fingerprint', left(encode(digest(d.device_token, 'sha256'), 'hex'), 12),
      'app_identifier', d.app_identifier,
      'app_version', d.app_version,
      'device_model', d.device_model,
      'locale', d.locale,
      'failure_count', d.failure_count,
      'revoked_reason', d.revoked_reason,
      'last_seen_at', d.last_seen_at,
      'last_success_at', d.last_success_at,
      'updated_at', d.updated_at
    ) AS x
    FROM public.omni_comms_push_device d
    WHERE d.organization_id = p_organization_id
      AND (p_include_retired OR d.state = 'active')
  ) q;
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.omni_comms_push_device_admin_retire(
  p_id uuid, p_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_org uuid;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  SELECT organization_id INTO v_org FROM public.omni_comms_push_device WHERE id = p_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING DETAIL = 'registration_not_found';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_org, NULL);
  UPDATE public.omni_comms_push_device
     SET state = 'retired',
         revoked_reason = coalesce(p_reason, 'retired_by_operator'),
         updated_at = now()
   WHERE id = p_id;
  RETURN p_id;
END; $$;

-- ── Per-installation push delivery evidence for Communication 360 ──────
CREATE OR REPLACE FUNCTION public.omni_comms_push_delivery_target_list(
  p_message_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_org uuid; v jsonb;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('read');
  SELECT organization_id INTO v_org FROM public.omni_comms_push_delivery_target
   WHERE message_id = p_message_id LIMIT 1;
  IF v_org IS NULL THEN RETURN '[]'::jsonb; END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_org, NULL);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id,
      'push_device_id', t.push_device_id,
      'platform', t.platform,
      'attempt_status', t.attempt_status,
      'provider_message_id', t.provider_message_id,
      'rejection_classification', t.rejection_classification,
      'error_code', t.error_code,
      'attempted_at', t.attempted_at,
      'settled_at', t.settled_at
    ) ORDER BY t.attempted_at), '[]'::jsonb) INTO v
  FROM public.omni_comms_push_delivery_target t
  WHERE t.message_id = p_message_id;
  RETURN v;
END; $$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_webhook_subscription_list(uuid, uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_webhook_subscription_list(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_webhook_subscription_upsert(uuid, timestamptz, uuid, uuid, uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_webhook_subscription_set_lifecycle(uuid, timestamptz, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_push_device_admin_list(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_push_device_admin_retire(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_push_delivery_target_list(uuid) TO authenticated;
