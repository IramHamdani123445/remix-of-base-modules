CREATE OR REPLACE FUNCTION public.get_comm_hub_request_auth_context()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  RETURN jsonb_build_object(
    'auth_uid', v_uid,
    'authenticated', v_uid IS NOT NULL,
    'comm_hub_admin',
      CASE
        WHEN v_uid IS NULL THEN false
        ELSE public.is_comm_hub_admin(v_uid)
      END,
    'evaluated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_comm_hub_request_auth_context() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_comm_hub_request_auth_context() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_comm_hub_request_auth_context() TO authenticated;