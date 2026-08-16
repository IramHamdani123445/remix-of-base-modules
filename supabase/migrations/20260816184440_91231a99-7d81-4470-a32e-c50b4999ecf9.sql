CREATE OR REPLACE FUNCTION public.omni_comms_priv_print_production_claim(
  p_worker text, p_batch_limit integer, p_correlation_id text, p_deployed_revision text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $function$
DECLARE
  v_limit integer;
  v_worker text := left(coalesce(nullif(btrim(p_worker),''),'omni-comms-print-production'),120);
  v_corr text := left(coalesce(p_correlation_id,''),120);
  v_job record;
  v_rel public.omni_comms_channel_release_control;
  v_claims jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_scanned integer := 0;
  v_claimed integer := 0;
  v_token text; v_attempt_id uuid; v_attempt_no integer; v_deny text;
  v_lines jsonb; v_account uuid; v_letter text;
BEGIN
  IF p_batch_limit IS NULL THEN v_limit := 1;
  ELSIF p_batch_limit < 1 OR p_batch_limit > 25 THEN
    RAISE EXCEPTION 'OC422 invalid_batch_limit' USING ERRCODE='P0001';
  ELSE v_limit := p_batch_limit; END IF;

  FOR v_job IN
    SELECT j.*, m.rendered_subject, m.rendered_text, m.rendered_html,
           m.destination_snapshot, m.channel_setting_snapshot,
           m.department_id AS msg_department_id, m.status AS message_status,
           r.caller_module_code, ed.code AS event_code,
           rc.display_name AS recipient_display, rc.recipient_reference
      FROM public.omni_comms_dispatch_job j
      JOIN public.omni_comms_message m ON m.id = j.message_id
      JOIN public.omni_comms_request r ON r.id = j.request_id
      JOIN public.omni_comms_event_definition ed ON ed.id = r.event_definition_id
      LEFT JOIN public.omni_comms_recipient rc ON rc.id = m.recipient_id
     WHERE j.channel = 'print'
       AND j.mode = 'queued'
       AND j.attempt_count < 3
       AND coalesce(j.next_attempt_at, now()) <= now()
       AND ((j.status = 'held' AND m.status IN ('held','queued'))
            OR (j.status = 'retry_wait' AND m.status = 'dispatching'))
     ORDER BY j.priority, j.created_at
     LIMIT greatest(v_limit * 5, 25)
     FOR UPDATE OF j SKIP LOCKED
  LOOP
    EXIT WHEN v_claimed >= v_limit;
    v_scanned := v_scanned + 1;
    v_deny := NULL;

    v_rel := public.omni_comms_priv_channel_release_effective(
               v_job.organization_id, v_job.msg_department_id, 'print');
    IF v_rel.id IS NULL OR v_rel.release_state <> 'live' THEN
      v_deny := 'print_release_disabled';
    ELSIF coalesce(btrim(v_job.rendered_text),'') = ''
          AND coalesce(btrim(v_job.rendered_html),'') = '' THEN
      v_deny := 'print_content_not_rendered';
    END IF;

    v_lines := public.omni_comms_priv_print_postal_lines(
                 coalesce(v_job.destination_snapshot, '{}'::jsonb));
    IF v_deny IS NULL AND jsonb_array_length(v_lines) = 0 THEN
      v_deny := 'postal_destination_missing';
    END IF;

    IF v_deny IS NOT NULL THEN
      UPDATE public.omni_comms_dispatch_job
         SET hold_reason = left(v_deny,200), is_runnable = false,
             next_attempt_at = now() + interval '5 minutes', updated_at = now()
       WHERE id = v_job.id;
      v_blockers := v_blockers || jsonb_build_object('job_id', v_job.id, 'code', v_deny);
      CONTINUE;
    END IF;

    SELECT pa.id INTO v_account
      FROM public.omni_comms_provider_account pa
      JOIN public.omni_comms_provider p ON p.id = pa.provider_id
     WHERE pa.organization_id = v_job.organization_id
       AND p.channel = 'print' AND pa.status = 'active'
     ORDER BY pa.created_at LIMIT 1;

    v_token := encode(extensions.gen_random_bytes(24),'hex');
    v_attempt_no := v_job.attempt_count + 1;
    v_letter := 'LTR-' || upper(substr(replace(v_job.message_id::text,'-',''),1,12));

    UPDATE public.omni_comms_dispatch_job
       SET status = 'processing', is_runnable = true, hold_reason = NULL,
           lock_token = v_token, locked_at = now(), locked_by = v_worker,
           lease_expires_at = now() + interval '2 minutes',
           attempt_count = v_attempt_no, updated_at = now()
     WHERE id = v_job.id;

    IF v_job.message_status IN ('held','queued') THEN
      UPDATE public.omni_comms_message SET status = 'dispatching', updated_at = now()
       WHERE id = v_job.message_id;
    END IF;

    INSERT INTO public.omni_comms_delivery_attempt (
      dispatch_job_id, message_id, organization_id, provider_account_id,
      provider_id, attempt_number, status, started_at, claim_token, claimed_at,
      lease_expires_at, worker_id, provider_idempotency_key, release_control_id,
      release_version_at_claim, release_state_at_claim, execution_context,
      deployed_revision_at_claim, safe_request_metadata)
    VALUES (
      v_job.id, v_job.message_id, v_job.organization_id, v_account,
      (SELECT provider_id FROM public.omni_comms_provider_account WHERE id = v_account),
      v_attempt_no, 'dispatching', now(), v_token, now(),
      now() + interval '2 minutes', v_worker,
      'omni-comms/print/' || v_job.message_id::text, v_rel.id,
      v_rel.release_version, v_rel.release_state, 'scheduler',
      lower(coalesce(p_deployed_revision,'')),
      jsonb_build_object('channel','print','mode','queued',
                         'event_code', v_job.event_code,
                         'caller_module_code', v_job.caller_module_code,
                         'correlation_id', nullif(v_corr,'')))
    RETURNING id INTO v_attempt_id;

    v_claimed := v_claimed + 1;
    v_claims := v_claims || jsonb_build_object(
      'attempt_id', v_attempt_id,
      'claim_token', v_token,
      'attempt_number', v_attempt_no,
      'message_id', v_job.message_id,
      'organization_id', v_job.organization_id,
      'letter_reference', v_letter,
      'subject', v_job.rendered_subject,
      'text_body', v_job.rendered_text,
      'html_body', v_job.rendered_html,
      'recipient_display', v_job.recipient_display,
      'recipient_reference', v_job.recipient_reference,
      'postal_address_lines', v_lines,
      'issuing_authority', v_job.channel_setting_snapshot->>'issuing_authority',
      'production_account_id', v_account,
      'event_code', v_job.event_code);
  END LOOP;

  RETURN jsonb_build_object(
    'scanned_jobs', v_scanned, 'claimed_jobs', v_claimed,
    'claims', v_claims, 'blockers', v_blockers,
    'blocker', CASE WHEN v_claimed = 0 AND v_scanned = 0 THEN 'no_print_work' ELSE NULL END);
END;
$function$;