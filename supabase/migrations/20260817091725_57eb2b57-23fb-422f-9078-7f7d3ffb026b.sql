DO $migration$
DECLARE
  v_definition text;
  v_old text := $old$IF v_job.message_status IN ('held','queued') THEN
      UPDATE public.omni_comms_message SET status = 'dispatching', updated_at = now()
       WHERE id = v_job.message_id;
    END IF;$old$;
  v_new text := $new$IF v_job.message_status = 'held' THEN
      UPDATE public.omni_comms_message SET status = 'queued', updated_at = now()
       WHERE id = v_job.message_id;
    END IF;
    IF v_job.message_status IN ('held','queued') THEN
      UPDATE public.omni_comms_message SET status = 'dispatching', updated_at = now()
       WHERE id = v_job.message_id;
    END IF;$new$;
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
    RAISE EXCEPTION 'print_production_claim_message_block_missing';
  END IF;

  EXECUTE replace(v_definition, v_old, v_new);
END;
$migration$;