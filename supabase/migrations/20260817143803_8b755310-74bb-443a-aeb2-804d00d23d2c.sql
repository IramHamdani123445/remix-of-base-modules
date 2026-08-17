DO $do$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='omni_comms_priv_print_production_claim';

  v_def := replace(v_def,
$old$    IF v_job.message_status IN ('held','queued') THEN
      UPDATE public.omni_comms_message SET status = 'dispatching', updated_at = now()
       WHERE id = v_job.message_id;
    END IF;$old$,
$new$    IF v_job.message_status = 'held' THEN
      UPDATE public.omni_comms_message SET status = 'queued', updated_at = now()
       WHERE id = v_job.message_id;
    END IF;
    IF v_job.message_status IN ('held','queued') THEN
      UPDATE public.omni_comms_message SET status = 'dispatching', updated_at = now()
       WHERE id = v_job.message_id;
    END IF;$new$);

  EXECUTE v_def;
END
$do$;