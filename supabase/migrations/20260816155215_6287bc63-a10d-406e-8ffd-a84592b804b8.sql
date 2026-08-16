CREATE OR REPLACE FUNCTION public.omni_comms_communication_action_list(
  p_organization_id uuid,
  p_event_code text DEFAULT NULL,
  p_department_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'OC401 authentication_required' USING ERRCODE='P0001';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);

  WITH actions AS (
    SELECT a.*, e.code AS event_code
    FROM public.omni_comms_communication_action a
    JOIN public.omni_comms_event_definition e ON e.id = a.event_definition_id
    WHERE a.organization_id = p_organization_id
      AND (p_event_code IS NULL OR e.code = p_event_code)
      AND (p_department_id IS NULL OR a.department_id IS NULL OR a.department_id = p_department_id)
  ),
  options AS (
    SELECT o.* FROM public.omni_comms_action_channel_option o
    WHERE o.action_id IN (SELECT id FROM actions)
  ),
  policies AS (
    SELECT p.* FROM public.omni_comms_delivery_policy p
    WHERE p.organization_id = p_organization_id
      AND (p.action_id IS NULL OR p.action_id IN (SELECT id FROM actions))
  )
  SELECT jsonb_build_object(
    'actions', coalesce((SELECT jsonb_agg(to_jsonb(a.*) ORDER BY a.priority, a.code) FROM actions a), '[]'::jsonb),
    'channel_options', coalesce((SELECT jsonb_agg(to_jsonb(o.*) ORDER BY o.rank) FROM options o), '[]'::jsonb),
    'delivery_policies', coalesce((SELECT jsonb_agg(to_jsonb(p.*) ORDER BY p.version_number DESC) FROM policies p), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END
$$;

CREATE OR REPLACE FUNCTION public.omni_comms_communication_action_upsert(
  p_organization_id uuid,
  p_event_code text,
  p_code text,
  p_name text,
  p_recipient_role text DEFAULT NULL,
  p_obligation text DEFAULT 'required',
  p_satisfaction_rule text DEFAULT 'one_of',
  p_legal_basis text DEFAULT NULL,
  p_priority integer DEFAULT 100,
  p_status text DEFAULT 'active',
  p_department_id uuid DEFAULT NULL,
  p_description text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_event_id uuid;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'OC401 authentication_required' USING ERRCODE='P0001';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);

  SELECT id INTO v_event_id FROM public.omni_comms_event_definition WHERE code = p_event_code;
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'OC404 event_not_found' USING ERRCODE='P0001';
  END IF;

  INSERT INTO public.omni_comms_communication_action (
    organization_id, department_id, event_definition_id, code, name, description,
    recipient_role, obligation, satisfaction_rule, legal_basis, priority, status,
    created_by, updated_by
  ) VALUES (
    p_organization_id, p_department_id, v_event_id, p_code, p_name, p_description,
    p_recipient_role, p_obligation, p_satisfaction_rule, p_legal_basis, p_priority, p_status,
    v_uid, v_uid
  )
  ON CONFLICT (organization_id, coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
               event_definition_id, code, coalesce(recipient_role, '*'))
  DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    obligation = excluded.obligation,
    satisfaction_rule = excluded.satisfaction_rule,
    legal_basis = excluded.legal_basis,
    priority = excluded.priority,
    status = excluded.status,
    updated_at = now(),
    updated_by = v_uid
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (user_id, action, module, entity_type, entity_id, new_values)
  VALUES (v_uid, 'omni_comms.communication_action.upsert', 'omni_comms',
          'omni_comms_communication_action', v_id::text,
          jsonb_build_object('code', p_code, 'obligation', p_obligation,
                             'rule', p_satisfaction_rule, 'status', p_status));

  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.omni_comms_action_channel_option_upsert(
  p_action_id uuid,
  p_channel text,
  p_rank integer DEFAULT 100,
  p_template_family_id uuid DEFAULT NULL,
  p_is_fallback boolean DEFAULT false,
  p_condition jsonb DEFAULT '{}'::jsonb,
  p_status text DEFAULT 'active'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'OC401 authentication_required' USING ERRCODE='P0001';
  END IF;
  SELECT organization_id INTO v_org FROM public.omni_comms_communication_action WHERE id = p_action_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'OC404 action_not_found' USING ERRCODE='P0001';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_org, NULL);

  INSERT INTO public.omni_comms_action_channel_option (
    action_id, channel, rank, template_family_id, is_fallback, condition, status,
    created_by, updated_by
  ) VALUES (
    p_action_id, p_channel, p_rank, p_template_family_id, p_is_fallback,
    coalesce(p_condition, '{}'::jsonb), p_status, v_uid, v_uid
  )
  ON CONFLICT (action_id, channel) DO UPDATE SET
    rank = excluded.rank,
    template_family_id = excluded.template_family_id,
    is_fallback = excluded.is_fallback,
    condition = excluded.condition,
    status = excluded.status,
    updated_at = now(),
    updated_by = v_uid
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (user_id, action, module, entity_type, entity_id, new_values)
  VALUES (v_uid, 'omni_comms.action_channel_option.upsert', 'omni_comms',
          'omni_comms_action_channel_option', v_id::text,
          jsonb_build_object('channel', p_channel, 'rank', p_rank, 'fallback', p_is_fallback));

  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.omni_comms_delivery_policy_publish(
  p_organization_id uuid,
  p_mode text,
  p_print_when jsonb DEFAULT NULL,
  p_action_id uuid DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_next integer;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'OC401 authentication_required' USING ERRCODE='P0001';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);

  UPDATE public.omni_comms_delivery_policy
     SET status = 'retired', effective_to = now(), updated_at = now(), updated_by = v_uid
   WHERE organization_id = p_organization_id
     AND status = 'active'
     AND coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_department_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND coalesce(action_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_action_id, '00000000-0000-0000-0000-000000000000'::uuid);

  SELECT coalesce(max(version_number), 0) + 1 INTO v_next
    FROM public.omni_comms_delivery_policy
   WHERE organization_id = p_organization_id
     AND coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_department_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND coalesce(action_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_action_id, '00000000-0000-0000-0000-000000000000'::uuid);

  INSERT INTO public.omni_comms_delivery_policy (
    organization_id, department_id, action_id, mode, print_when, version_number,
    status, notes, created_by, updated_by
  ) VALUES (
    p_organization_id, p_department_id, p_action_id, p_mode,
    coalesce(p_print_when, jsonb_build_object(
      'legally_required', true, 'recipient_requested', true,
      'digital_unavailable', true, 'policy_exception', false)),
    v_next, 'active', p_notes, v_uid, v_uid
  ) RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (user_id, action, module, entity_type, entity_id, new_values)
  VALUES (v_uid, 'omni_comms.delivery_policy.publish', 'omni_comms',
          'omni_comms_delivery_policy', v_id::text,
          jsonb_build_object('mode', p_mode, 'version', v_next, 'action_id', p_action_id));

  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.omni_comms_recipient_channel_preference_set(
  p_organization_id uuid,
  p_recipient_reference text,
  p_channel text,
  p_preference text,
  p_recipient_role text DEFAULT NULL,
  p_source text DEFAULT 'operator',
  p_evidence jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'OC401 authentication_required' USING ERRCODE='P0001';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);

  INSERT INTO public.omni_comms_recipient_channel_preference (
    organization_id, recipient_role, recipient_reference, channel, preference,
    source, evidence, created_by, updated_by
  ) VALUES (
    p_organization_id, p_recipient_role, p_recipient_reference, p_channel, p_preference,
    p_source, coalesce(p_evidence, '{}'::jsonb), v_uid, v_uid
  )
  ON CONFLICT (organization_id, recipient_reference, channel, coalesce(recipient_role, '*'))
  DO UPDATE SET
    preference = excluded.preference,
    source = excluded.source,
    evidence = excluded.evidence,
    effective_to = NULL,
    updated_at = now(),
    updated_by = v_uid
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (user_id, action, module, entity_type, entity_id, new_values)
  VALUES (v_uid, 'omni_comms.recipient_preference.set', 'omni_comms',
          'omni_comms_recipient_channel_preference', v_id::text,
          jsonb_build_object('channel', p_channel, 'preference', p_preference, 'source', p_source));

  RETURN v_id;
END
$$;
