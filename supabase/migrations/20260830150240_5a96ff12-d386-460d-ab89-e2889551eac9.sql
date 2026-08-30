DO $$
DECLARE r record; v_seq int;
BEGIN
  PERFORM set_config('omni_comms.dispatch_worker','on', true);

  FOR r IN
    SELECT j.id, j.request_id, j.message_id, j.organization_id, j.correlation_id, j.channel
      FROM public.omni_comms_dispatch_job j
     WHERE j.status = 'held'
       AND j.hold_reason IN ('release_snapshot_missing','recipient_not_allowlisted')
       AND j.created_at < now() - interval '6 hours'
  LOOP
    UPDATE public.omni_comms_dispatch_job
       SET status = 'cancelled', is_runnable = false, cancelled_at = now(),
           completed_at = now(), hold_reason = 'superseded_pre_production_pilot_job',
           updated_at = now()
     WHERE id = r.id;

    UPDATE public.omni_comms_message SET status = 'cancelled'
     WHERE id = r.message_id AND status IN ('held','queued','rendered');

    SELECT coalesce(max(event_sequence),0) + 1 INTO v_seq
      FROM public.omni_comms_message_event WHERE request_id = r.request_id;

    INSERT INTO public.omni_comms_message_event(
      request_id, message_id, organization_id, event_sequence, event_type,
      status_before, status_after, actor_type, correlation_id, summary, safe_metadata)
    VALUES (
      r.request_id, r.message_id, r.organization_id, v_seq, 'dispatch_cancelled',
      'held', 'cancelled', 'system', r.correlation_id,
      'Pre-production pilot job superseded and cancelled during the production remediation wave; it can never be released by a future production activation.',
      jsonb_build_object('channel', r.channel, 'disposition', 'CANCEL_BEFORE_PRODUCTION_CUTOVER',
                         'remediation_wave', 'omni_production_remediation_2026-08-30'));
  END LOOP;
END $$;