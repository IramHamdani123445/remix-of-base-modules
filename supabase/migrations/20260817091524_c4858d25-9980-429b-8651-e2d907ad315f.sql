DO $migration$
DECLARE
  v_definition text;
  v_old text := $old$UPDATE public.omni_comms_dispatch_job
       SET status = 'processing', is_runnable = false, hold_reason = NULL,
           lock_token = v_token, locked_at = now(), locked_by = v_worker,
           lease_expires_at = now() + interval '2 minutes',
           attempt_count = v_attempt_no, updated_at = now()
     WHERE id = v_job.id;$old$;
  v_new text := $new$UPDATE public.omni_comms_dispatch_job
       SET status = 'ready', is_runnable = true, hold_reason = NULL,
           next_attempt_at = now(), updated_at = now()
     WHERE id = v_job.id;

    UPDATE public.omni_comms_dispatch_job
       SET status = 'leased', is_runnable = false,
           lock_token = v_token, locked_at = now(), locked_by = v_worker,
           lease_expires_at = now() + interval '2 minutes',
           attempt_count = v_attempt_no, updated_at = now()
     WHERE id = v_job.id;

    UPDATE public.omni_comms_dispatch_job
       SET status = 'processing', is_runnable = false, updated_at = now()
     WHERE id = v_job.id;$new$;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'omni_comms_priv_print_production_claim'
     AND pg_get_function_identity_arguments(p.oid) = 'p_worker text, p_batch_limit integer, p_correlation_id text, p_deployed_revision text';

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'print_production_claim_function_missing';
  END IF;
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'print_production_claim_expected_block_missing';
  END IF;

  EXECUTE replace(v_definition, v_old, v_new);
END;
$migration$;