REVOKE ALL ON FUNCTION public.ia_sensitive_capability_policy() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ia_sensitive_capability_policy() FROM anon;
REVOKE ALL ON FUNCTION public.ia_sensitive_capability_policy() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ia_sensitive_capability_policy() TO service_role;