-- 1. Product communication config: allow all channels
ALTER TABLE public.omni_comms_product_communication_config
  DROP CONSTRAINT IF EXISTS omni_comms_product_comm_channel_chk;
ALTER TABLE public.omni_comms_product_communication_config
  ADD CONSTRAINT omni_comms_product_comm_channel_chk
  CHECK (channel = ANY (ARRAY['email','sms','whatsapp','push','in_app','print','webhook','voice']));

-- 2. Product-scoped communication actions
ALTER TABLE public.omni_comms_communication_action
  ADD COLUMN IF NOT EXISTS product_id uuid;

DROP INDEX IF EXISTS public.omni_comms_communication_action_unique;
DROP INDEX IF EXISTS public.omni_comms_communication_action_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS omni_comms_communication_action_uniq_v2
  ON public.omni_comms_communication_action (
    organization_id,
    coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid),
    event_definition_id,
    code,
    coalesce(recipient_role, '*')
  );

CREATE INDEX IF NOT EXISTS omni_comms_communication_action_product_idx
  ON public.omni_comms_communication_action (product_id)
  WHERE product_id IS NOT NULL;

-- 3. Governed upsert accepts a product scope
CREATE OR REPLACE FUNCTION public.omni_comms_communication_action_upsert(
  p_organization_id uuid, p_event_code text, p_code text, p_name text,
  p_recipient_role text DEFAULT NULL, p_obligation text DEFAULT 'required',
  p_satisfaction_rule text DEFAULT 'one_of', p_legal_basis text DEFAULT NULL,
  p_priority integer DEFAULT 100, p_status text DEFAULT 'active',
  p_department_id uuid DEFAULT NULL, p_description text DEFAULT NULL,
  p_product_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
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
    organization_id, department_id, product_id, event_definition_id, code, name, description,
    recipient_role, obligation, satisfaction_rule, legal_basis, priority, status,
    created_by, updated_by
  ) VALUES (
    p_organization_id, p_department_id, p_product_id, v_event_id, p_code, p_name, p_description,
    p_recipient_role, p_obligation, p_satisfaction_rule, p_legal_basis, p_priority, p_status,
    v_uid, v_uid
  )
  ON CONFLICT (organization_id,
               coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
               coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid),
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
                             'rule', p_satisfaction_rule, 'status', p_status,
                             'product_id', p_product_id));

  RETURN v_id;
END
$function$;

-- 4. Runtime action snapshot becomes product-aware: a product-specific action
--    of the same code fully replaces the generic one.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_runtime_action_snapshot(
  p_organization_id uuid, p_department_id uuid, p_event_definition_id uuid,
  p_recipient_references text[] DEFAULT '{}'::text[], p_product_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
  WITH candidate AS (
    SELECT a.id, a.organization_id, a.department_id, a.product_id, a.event_definition_id,
           a.code, a.name, a.recipient_role, a.obligation, a.satisfaction_rule,
           a.legal_basis, a.priority, a.status
    FROM public.omni_comms_communication_action a
    WHERE a.event_definition_id = p_event_definition_id
      AND a.organization_id = p_organization_id
      AND a.status = 'active'
      AND (a.department_id IS NULL OR a.department_id = p_department_id)
      AND (a.product_id IS NULL OR a.product_id = p_product_id)
  ),
  ranked AS (
    SELECT c.*, row_number() OVER (
      PARTITION BY c.code, coalesce(c.recipient_role, '*')
      ORDER BY (c.product_id IS NOT NULL) DESC, (c.department_id IS NOT NULL) DESC, c.priority
    ) AS rn
    FROM candidate c
  ),
  actions AS (
    SELECT id, organization_id, department_id, product_id, event_definition_id, code, name,
           recipient_role, obligation, satisfaction_rule, legal_basis, priority, status
    FROM ranked WHERE rn = 1
  ),
  options AS (
    SELECT o.id, o.action_id, o.channel, o.rank, o.template_family_id,
           o.is_fallback, o.condition, o.status
    FROM public.omni_comms_action_channel_option o
    WHERE o.action_id IN (SELECT id FROM actions)
      AND o.status = 'active'
  ),
  policies AS (
    SELECT p.id, p.organization_id, p.department_id, p.action_id, p.mode,
           p.print_when, p.version_number, p.effective_from, p.effective_to
    FROM public.omni_comms_delivery_policy p
    WHERE p.organization_id = p_organization_id
      AND p.status = 'active'
      AND (p.department_id IS NULL OR p.department_id = p_department_id)
      AND (p.action_id IS NULL OR p.action_id IN (SELECT id FROM actions))
      AND p.effective_from <= now()
      AND (p.effective_to IS NULL OR p.effective_to > now())
  ),
  prefs AS (
    SELECT r.id, r.organization_id, r.recipient_role, r.recipient_reference,
           r.channel, r.preference, r.source
    FROM public.omni_comms_recipient_channel_preference r
    WHERE r.organization_id = p_organization_id
      AND r.recipient_reference = ANY(coalesce(p_recipient_references, '{}'::text[]))
      AND r.effective_from <= now()
      AND (r.effective_to IS NULL OR r.effective_to > now())
  )
  SELECT jsonb_build_object(
    'communication_actions',
      coalesce((SELECT jsonb_agg(to_jsonb(a.*) ORDER BY a.priority, a.code) FROM actions a), '[]'::jsonb),
    'action_channel_options',
      coalesce((SELECT jsonb_agg(to_jsonb(o.*) ORDER BY o.rank) FROM options o), '[]'::jsonb),
    'delivery_policies',
      coalesce((SELECT jsonb_agg(to_jsonb(p.*) ORDER BY p.version_number DESC) FROM policies p), '[]'::jsonb),
    'recipient_channel_preferences',
      coalesce((SELECT jsonb_agg(to_jsonb(r.*)) FROM prefs r), '[]'::jsonb)
  );
$function$;

-- 5. Reference configuration: BENEFITS.CLAIM.APPROVED formal decision notice
DO $seed$
DECLARE
  v_org uuid := '69afc88b-da5c-4f41-a1e7-199e1ee1d416';
  v_event uuid := '957c5657-2014-4ac4-8199-72cdf2282190';
  v_email_family uuid := 'ed444dff-a5d1-4739-b141-d673cf57d4af';
  v_print_family uuid := '41e68a2c-bcd9-4f35-a3c5-d2b8f7433260';
  v_action uuid;
BEGIN
  INSERT INTO public.omni_comms_communication_action (
    organization_id, department_id, product_id, event_definition_id, code, name, description,
    recipient_role, obligation, satisfaction_rule, legal_basis, priority, status)
  VALUES (v_org, NULL, NULL, v_event, 'FORMAL_DECISION_NOTICE',
          'Formal claim decision notice',
          'Statutory notice of the claim decision. Satisfied by any one configured channel.',
          'claimant', 'required', 'one_of', 'Social Security Act - decision notification',
          10, 'active')
  ON CONFLICT (organization_id,
               coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
               coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid),
               event_definition_id, code, coalesce(recipient_role, '*'))
  DO UPDATE SET name = excluded.name, status = 'active', updated_at = now()
  RETURNING id INTO v_action;

  INSERT INTO public.omni_comms_action_channel_option
    (action_id, channel, rank, template_family_id, is_fallback, condition, status)
  VALUES (v_action, 'email', 1, v_email_family, false, '{}'::jsonb, 'active')
  ON CONFLICT (action_id, channel) DO UPDATE
    SET rank = excluded.rank, template_family_id = excluded.template_family_id,
        is_fallback = excluded.is_fallback, status = 'active', updated_at = now();

  INSERT INTO public.omni_comms_action_channel_option
    (action_id, channel, rank, template_family_id, is_fallback, condition, status)
  VALUES (v_action, 'print', 2, v_print_family, true, '{}'::jsonb, 'active')
  ON CONFLICT (action_id, channel) DO UPDATE
    SET rank = excluded.rank, template_family_id = excluded.template_family_id,
        is_fallback = excluded.is_fallback, status = 'active', updated_at = now();

  IF NOT EXISTS (
    SELECT 1 FROM public.omni_comms_delivery_policy
    WHERE organization_id = v_org AND action_id = v_action AND status = 'active'
  ) THEN
    INSERT INTO public.omni_comms_delivery_policy
      (organization_id, department_id, action_id, mode, print_when, version_number, status, notes)
    VALUES (v_org, NULL, v_action, 'digital_first',
            jsonb_build_object('no_digital_destination', true), 1, 'active',
            'Reference policy: email when a digital destination exists, otherwise print.');
  END IF;
END
$seed$;