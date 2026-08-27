REVOKE EXECUTE ON FUNCTION public.ia_f_bool(jsonb, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ia_f_txt(jsonb, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ia_f_uuid(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_f_bool(jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ia_f_txt(jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ia_f_uuid(jsonb, text) TO authenticated, service_role;