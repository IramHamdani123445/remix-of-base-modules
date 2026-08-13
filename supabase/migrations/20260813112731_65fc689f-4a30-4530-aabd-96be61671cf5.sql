-- 1. Deterministic, fail-closed business organisation resolution.
DROP FUNCTION IF EXISTS public.omni_comms_priv_business_organization(text);

CREATE OR REPLACE FUNCTION public.omni_comms_priv_business_organization(
  p_module_code text,
  p_product_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_module text := upper(btrim(coalesce(p_module_code, '')));
  v_org uuid;
  v_count integer;
BEGIN
  IF v_module = '' THEN
    RAISE EXCEPTION 'OC422 module_code_required' USING ERRCODE = 'P0001';
  END IF;

  -- (a) Product ownership is authoritative when a product context exists.
  IF p_product_id IS NOT NULL THEN
    SELECT count(DISTINCT c.organization_id) INTO v_count
    FROM public.omni_comms_product_communication_config c
    WHERE c.product_id = p_product_id;

    IF v_count > 1 THEN
      RAISE EXCEPTION 'OC409 organization_ambiguous' USING ERRCODE = 'P0001';
    ELSIF v_count = 1 THEN
      SELECT DISTINCT c.organization_id INTO v_org
      FROM public.omni_comms_product_communication_config c
      WHERE c.product_id = p_product_id;
      RETURN v_org;
    END IF;
  END IF;

  -- (b) Registered module/department ownership.
  SELECT count(DISTINCT d.organization_id) INTO v_count
  FROM public.core_department_profile d
  WHERE upper(btrim(d.module_code)) = v_module
    AND d.status = 'ACTIVE'
    AND d.organization_id IS NOT NULL;

  IF v_count > 1 THEN
    RAISE EXCEPTION 'OC409 organization_ambiguous' USING ERRCODE = 'P0001';
  ELSIF v_count = 1 THEN
    SELECT DISTINCT d.organization_id INTO v_org
    FROM public.core_department_profile d
    WHERE upper(btrim(d.module_code)) = v_module
      AND d.status = 'ACTIVE'
      AND d.organization_id IS NOT NULL;
    RETURN v_org;
  END IF;

  -- (c) Fail closed. Never choose a tenant because it was created first.
  RAISE EXCEPTION 'OC422 organization_unresolved' USING ERRCODE = 'P0001';
END;
$function$;

-- 2. Immutable business facts now include department context and correlation.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_business_event_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.module_code IS DISTINCT FROM OLD.module_code
     OR NEW.event_code IS DISTINCT FROM OLD.event_code
     OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
     OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
     OR NEW.occurrence IS DISTINCT FROM OLD.occurrence
     OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.department_context_id IS DISTINCT FROM OLD.department_context_id
     OR NEW.recipient_facts IS DISTINCT FROM OLD.recipient_facts
     OR NEW.payload_snapshot IS DISTINCT FROM OLD.payload_snapshot
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'OC422 business_event_immutable' USING ERRCODE = 'P0001';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

-- 3. Hardened enqueue: module/event/tenant/product validation, bounded payload.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_enqueue_business_event(
  p_organization_id uuid,
  p_module_code text,
  p_event_code text,
  p_entity_type text,
  p_entity_id text,
  p_occurrence text,
  p_product_id uuid,
  p_department_context_id uuid,
  p_recipient_facts jsonb,
  p_payload jsonb,
  p_correlation_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid := p_organization_id;
  v_module text := upper(btrim(coalesce(p_module_code, '')));
  v_event text := upper(btrim(coalesce(p_event_code, '')));
  v_event_module text;
  v_event_status text;
  v_key text;
  v_id uuid;
  v_status text;
  v_role text;
  v_product_orgs integer;
  v_product_org uuid;
BEGIN
  IF v_module = '' OR v_event = '' THEN
    RAISE EXCEPTION 'OC422 invalid_input' USING ERRCODE = 'P0001';
  END IF;

  IF v_org IS NULL THEN
    v_org := public.omni_comms_priv_business_organization(v_module, p_product_id);
  END IF;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'OC422 organization_unresolved' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.core_organization o WHERE o.id = v_org) THEN
    RAISE EXCEPTION 'OC422 organization_unresolved' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.omni_comms_caller_module_registry m
    WHERE upper(m.module_code) = v_module AND m.is_active
  ) THEN
    RAISE EXCEPTION 'OC403 caller_module_not_registered' USING ERRCODE = 'P0001';
  END IF;

  SELECT upper(btrim(coalesce(e.module_code, ''))), e.status
    INTO v_event_module, v_event_status
  FROM public.omni_comms_event_definition e
  WHERE e.code = v_event;

  IF v_event_status IS NULL THEN
    RAISE EXCEPTION 'OC404 event_code_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_event_status <> 'active' THEN
    RAISE EXCEPTION 'OC409 event_not_active' USING ERRCODE = 'P0001';
  END IF;
  IF v_event_module <> '' AND v_event_module <> v_module THEN
    RAISE EXCEPTION 'OC403 event_module_mismatch' USING ERRCODE = 'P0001';
  END IF;

  IF p_entity_type IS NULL OR btrim(p_entity_type) = ''
     OR p_entity_id IS NULL OR btrim(p_entity_id) = '' THEN
    RAISE EXCEPTION 'OC422 entity_required' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'OC422 payload_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF octet_length(coalesce(p_payload, '{}'::jsonb)::text) > 262144 THEN
    RAISE EXCEPTION 'OC422 payload_too_large' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(coalesce(p_recipient_facts, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'OC422 recipient_facts_invalid' USING ERRCODE = 'P0001';
  END IF;
  FOR v_role IN SELECT jsonb_object_keys(coalesce(p_recipient_facts, '{}'::jsonb)) LOOP
    IF v_role !~ '^[a-z][a-z0-9_]{0,63}$' THEN
      RAISE EXCEPTION 'OC422 recipient_role_invalid' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- Product context must be tenant compatible where an authoritative
  -- relationship exists.
  IF p_product_id IS NOT NULL THEN
    SELECT count(DISTINCT c.organization_id) INTO v_product_orgs
    FROM public.omni_comms_product_communication_config c
    WHERE c.product_id = p_product_id;

    IF v_product_orgs > 1 THEN
      RAISE EXCEPTION 'OC409 organization_ambiguous' USING ERRCODE = 'P0001';
    ELSIF v_product_orgs = 1 THEN
      SELECT DISTINCT c.organization_id INTO v_product_org
      FROM public.omni_comms_product_communication_config c
      WHERE c.product_id = p_product_id;
      IF v_product_org IS DISTINCT FROM v_org THEN
        RAISE EXCEPTION 'OC403 product_tenant_mismatch' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  v_key := public.omni_comms_priv_business_event_key(
    v_org, v_module, v_event, p_entity_type, p_entity_id, p_occurrence);

  INSERT INTO public.omni_comms_business_event_outbox (
    organization_id, module_code, event_code, entity_type, entity_id, occurrence,
    product_id, department_context_id, recipient_facts, payload_snapshot,
    idempotency_key, correlation_id
  ) VALUES (
    v_org, v_module, v_event, btrim(p_entity_type), btrim(p_entity_id),
    coalesce(nullif(btrim(p_occurrence), ''), 'default'),
    p_product_id, p_department_context_id,
    coalesce(p_recipient_facts, '{}'::jsonb), coalesce(p_payload, '{}'::jsonb),
    v_key, nullif(btrim(coalesce(p_correlation_id, '')), '')
  )
  ON CONFLICT (organization_id, module_code, idempotency_key) DO NOTHING
  RETURNING id, status INTO v_id, v_status;

  IF v_id IS NULL THEN
    SELECT id, status INTO v_id, v_status
    FROM public.omni_comms_business_event_outbox
    WHERE organization_id = v_org AND module_code = v_module AND idempotency_key = v_key;
    RETURN jsonb_build_object(
      'event_outbox_id', v_id, 'idempotency_key', v_key,
      'organization_id', v_org,
      'status', v_status, 'deduplicated', true);
  END IF;

  RETURN jsonb_build_object(
    'event_outbox_id', v_id, 'idempotency_key', v_key,
    'organization_id', v_org,
    'status', v_status, 'deduplicated', false);
END;
$function$;

-- 4. Product-aware resolution snapshot (single resolution authority input).
CREATE OR REPLACE FUNCTION public.omni_comms_priv_product_communication_overrides(
  p_organization_id uuid,
  p_product_id uuid,
  p_event_code text
)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_agg(to_jsonb(c.*)), '[]'::jsonb)
  FROM public.omni_comms_product_communication_config c
  WHERE p_product_id IS NOT NULL
    AND c.organization_id = p_organization_id
    AND c.product_id = p_product_id
    AND upper(btrim(coalesce(c.event_code, ''))) = upper(btrim(coalesce(p_event_code, '')));
$function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_priv_product_communication_overrides(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_business_organization(text, uuid) TO service_role;