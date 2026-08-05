REVOKE ALL ON TABLE public.platform_environment_marker FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON TABLE public.platform_environment_marker FROM authenticated;
GRANT SELECT ON TABLE public.platform_environment_marker TO authenticated;
GRANT ALL ON TABLE public.platform_environment_marker TO service_role;