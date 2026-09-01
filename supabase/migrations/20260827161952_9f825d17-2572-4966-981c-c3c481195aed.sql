REVOKE ALL ON FUNCTION public.ia_evaluate_engagement_completeness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_evaluate_engagement_completeness(uuid) TO authenticated, service_role;