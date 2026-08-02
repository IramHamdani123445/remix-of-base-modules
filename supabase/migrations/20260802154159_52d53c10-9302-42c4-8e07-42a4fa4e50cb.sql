REVOKE ALL ON TABLE public.omni_comms_webhook_event FROM anon, authenticated;
GRANT ALL ON TABLE public.omni_comms_webhook_event TO service_role;