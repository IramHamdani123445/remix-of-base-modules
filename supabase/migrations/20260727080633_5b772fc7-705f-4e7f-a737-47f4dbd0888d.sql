
CREATE OR REPLACE FUNCTION public._comm_hub_fingerprint_evidence_core_v2(p_core jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public','extensions'
AS $function$
BEGIN
  IF p_core IS NULL THEN
    RAISE EXCEPTION 'FINGERPRINT_CORE_NULL';
  END IF;
  RETURN 'sha256-v2:' || encode(extensions.digest(p_core::text,'sha256'),'hex');
END;
$function$;
