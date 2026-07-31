REVOKE ALL ON FUNCTION public.omni_comms_priv_dry_run_gate_state() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_dry_run_gate_state() TO service_role;