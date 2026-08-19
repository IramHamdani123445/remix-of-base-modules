DROP FUNCTION IF EXISTS public.omni_comms_priv_dispatch_claim_generic(
  p_channel text, p_worker text, p_batch_limit integer,
  p_correlation_id text, p_deployed_revision text, p_execution_context text);