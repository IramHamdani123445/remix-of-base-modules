DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ia_comms_contract_project(text, jsonb) TO sandbox_exec';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ia_comms_ctx(uuid) TO sandbox_exec';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ia_comms_policy_days(text, integer) TO sandbox_exec';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ia_comms_auditee_fact(uuid) TO sandbox_exec';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ia_comms_generate_request_reminders(date) TO sandbox_exec';
  END IF;
END $$;