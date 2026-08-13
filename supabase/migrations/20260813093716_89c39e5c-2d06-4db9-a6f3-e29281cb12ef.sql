-- 1) Remove the ambiguous legacy overload (PostgREST PGRST203).
DROP FUNCTION IF EXISTS public.omni_comms_priv_send_communication(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb, text[], uuid
);

-- 2) Strict allowlist validation for business_context_snapshot.
CREATE OR REPLACE FUNCTION public.omni_comms_priv_business_context_valid(p_ctx jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_role jsonb;
  v_roles jsonb;
  v_count int := 0;
BEGIN
  IF p_ctx IS NULL THEN
    RETURN true;
  END IF;

  IF jsonb_typeof(p_ctx) <> 'object' THEN
    RETURN false;
  END IF;

  IF octet_length(p_ctx::text) > 4096 THEN
    RETURN false;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_ctx) LOOP
    IF v_key NOT IN ('product_id', 'recipient_roles', 'context_version') THEN
      RETURN false;
    END IF;
  END LOOP;

  -- product_id: null or UUID text
  IF p_ctx ? 'product_id' THEN
    IF jsonb_typeof(p_ctx -> 'product_id') = 'string' THEN
      IF (p_ctx ->> 'product_id') !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN false;
      END IF;
    ELSIF jsonb_typeof(p_ctx -> 'product_id') <> 'null' THEN
      RETURN false;
    END IF;
  END IF;

  -- context_version: bounded integer
  IF p_ctx ? 'context_version' THEN
    IF jsonb_typeof(p_ctx -> 'context_version') <> 'number' THEN
      RETURN false;
    END IF;
    IF (p_ctx ->> 'context_version')::numeric NOT BETWEEN 1 AND 99 THEN
      RETURN false;
    END IF;
  END IF;

  -- recipient_roles: bounded array of role slugs
  IF p_ctx ? 'recipient_roles' THEN
    v_roles := p_ctx -> 'recipient_roles';
    IF jsonb_typeof(v_roles) <> 'array' THEN
      RETURN false;
    END IF;
    IF jsonb_array_length(v_roles) > 8 THEN
      RETURN false;
    END IF;
    FOR v_role IN SELECT jsonb_array_elements(v_roles) LOOP
      v_count := v_count + 1;
      IF jsonb_typeof(v_role) <> 'string' THEN
        RETURN false;
      END IF;
      IF (v_role #>> '{}') !~ '^[a-z][a-z0-9_]{0,63}$' THEN
        RETURN false;
      END IF;
    END LOOP;
  END IF;

  RETURN true;
END;
$$;

ALTER TABLE public.omni_comms_request
  DROP CONSTRAINT IF EXISTS omni_comms_request_business_context_snapshot_check;

ALTER TABLE public.omni_comms_request
  ADD CONSTRAINT omni_comms_request_business_context_snapshot_check
  CHECK (public.omni_comms_priv_business_context_valid(business_context_snapshot));