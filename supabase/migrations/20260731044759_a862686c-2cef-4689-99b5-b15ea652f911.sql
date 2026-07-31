CREATE OR REPLACE FUNCTION public.omni_comms_priv_binding_verified_at_default()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.verification_status = 'verified' AND NEW.verified_at IS NULL THEN
    NEW.verified_at := now();
  END IF;
  IF NEW.verification_status IN ('unverified', 'pending') THEN
    NEW.verified_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS omni_comms_binding_verified_at_default
  ON public.omni_comms_sender_provider_binding;

CREATE TRIGGER omni_comms_binding_verified_at_default
BEFORE INSERT OR UPDATE ON public.omni_comms_sender_provider_binding
FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_binding_verified_at_default();