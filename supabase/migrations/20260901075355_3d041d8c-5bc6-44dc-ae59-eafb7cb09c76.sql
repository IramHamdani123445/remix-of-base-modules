REVOKE EXECUTE ON FUNCTION public.ia_remove_plan_engagement(uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ia_remove_plan_engagement(uuid, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.ia_remove_plan_engagement(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_remove_plan_engagement(uuid, uuid, text, text) TO service_role;