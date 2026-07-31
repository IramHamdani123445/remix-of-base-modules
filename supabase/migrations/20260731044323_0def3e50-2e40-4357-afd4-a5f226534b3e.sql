DROP FUNCTION IF EXISTS public.omni_comms_priv_verify_department_ownership(uuid, uuid);

CREATE FUNCTION public.omni_comms_priv_verify_department_ownership(
  p_department_id uuid,
  p_organization_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_org uuid;
BEGIN
  IF p_department_id IS NULL THEN
    RETURN true;
  END IF;
  SELECT organization_id INTO v_org FROM public.core_department WHERE id = p_department_id;
  IF v_org IS NULL THEN
    RETURN false;
  END IF;
  RETURN v_org IS NOT DISTINCT FROM p_organization_id;
END;
$function$;