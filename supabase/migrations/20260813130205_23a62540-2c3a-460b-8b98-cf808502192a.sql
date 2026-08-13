DROP FUNCTION IF EXISTS public.omni_comms_priv_scheduler_consume_ticket(text);

REVOKE ALL ON FUNCTION public.omni_comms_priv_scheduler_consume_ticket(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_scheduler_consume_ticket(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.omni_comms_priv_scheduler_consume_ticket(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_scheduler_consume_ticket(text, text) TO service_role;