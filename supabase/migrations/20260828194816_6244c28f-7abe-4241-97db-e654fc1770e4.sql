REVOKE EXECUTE ON FUNCTION public.ia_comms_emit(text, text, text, text, jsonb, jsonb, text, uuid) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.ia_comms_emit(text, text, text, text, jsonb, jsonb, text, uuid) TO service_role;
DROP FUNCTION IF EXISTS public.ia_comms_emit(text, text, text, text, jsonb, jsonb, text);