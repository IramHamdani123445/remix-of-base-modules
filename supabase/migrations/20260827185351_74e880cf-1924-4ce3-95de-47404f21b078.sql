REVOKE ALL ON FUNCTION public.ia_comms_emit(text,text,text,text,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ia_comms_profile_fact(text,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ia_comms_generate_reminders(date,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ia_comms_emit(text,text,text,text,jsonb,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ia_comms_profile_fact(text,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ia_comms_generate_reminders(date,integer) TO service_role;