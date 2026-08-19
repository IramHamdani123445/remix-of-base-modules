
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
      'action_code', a.code,
      'action_name', a.name,
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

CREATE OR REPLACE FUNCTION public.omni_comms_communication_action_list(
  p_organization_id uuid, p_department_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v jsonb;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'code', a.code, 'name', a.name,
      'recipient_role', a.recipient_role, 'status', a.status,
      'department_id', a.department_id
    ) ORDER BY a.code), '[]'::jsonb) INTO v
  FROM public.omni_comms_communication_action a
  WHERE a.organization_id = p_organization_id
    AND a.status <> 'retired'
    AND (p_department_id IS NULL OR a.department_id IS NULL OR a.department_id = p_department_id);
  RETURN v;
END; $$;

GRANT EXECUTE ON FUNCTION public.omni_comms_communication_action_list(uuid, uuid) TO authenticated;
