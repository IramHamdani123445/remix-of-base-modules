CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_deliver_in_app(p_worker text DEFAULT 'omni-comms-in-app'::text, p_batch_limit integer DEFAULT 5, p_correlation_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_batch_limit,5),1),25);
  v_scanned integer := 0;
  v_delivered integer := 0;
  v_blocked integer := 0;
  v_results jsonb := '[]'::jsonb;
  j record;
  m record;
  v_rel public.omni_comms_channel_release_control;
  v_user uuid;
  v_attempt uuid;
  v_notification uuid;
  v_seq bigint;
  v_severity text;
  v_action_url text;
  v_action_label text;
BEGIN
  PERFORM set_config('omni_comms.dispatch_worker','on', true);

  FOR j IN
    SELECT d.*
      FROM public.omni_comms_dispatch_job d
     WHERE d.channel = 'in_app'
       AND d.mode = 'queued'
       AND d.status = 'ready'
       AND d.is_runnable = true
       AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= now())
     ORDER BY d.priority, d.created_at
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    v_scanned := v_scanned + 1;
    v_notification := NULL;

    SELECT * INTO m FROM public.omni_comms_message WHERE id = j.message_id;

    v_rel := public.omni_comms_priv_channel_release_effective(
               j.organization_id, m.department_id, 'in_app');

    IF v_rel.id IS NULL
       OR COALESCE(v_rel.release_state,'disabled') NOT IN ('controlled_pilot','live') THEN
      v_blocked := v_blocked + 1;
      v_results := v_results || jsonb_build_object(
        'job_id', j.id, 'outcome', 'blocked',
        'result_code', CASE WHEN v_rel.id IS NULL
                            THEN 'in_app_release_control_missing'
                            ELSE 'in_app_channel_not_released' END);
      CONTINUE;
    END IF;

    v_user := public.omni_comms_priv_resolve_in_app_user(m.recipient_id);

    UPDATE public.omni_comms_dispatch_job
       SET status='leased',
           lock_token = gen_random_uuid(),
           locked_at = now(),
           locked_by = COALESCE(p_worker,'omni-comms-in-app'),
           lease_expires_at = now() + interval '5 minutes'
     WHERE id = j.id;
    UPDATE public.omni_comms_dispatch_job
       SET status='processing'
     WHERE id = j.id;

    v_attempt := gen_random_uuid();
    INSERT INTO public.omni_comms_delivery_attempt (
      id, dispatch_job_id, message_id, organization_id, attempt_number,
      status, started_at, worker_id, execution_context,
      release_control_id, release_version_at_claim, release_state_at_claim,
      release_fingerprint_at_claim, release_expires_at_claim
    ) VALUES (
      v_attempt, j.id, m.id, j.organization_id, j.attempt_count + 1,
      'started', now(), COALESCE(p_worker,'omni-comms-in-app'), 'scheduler',
      v_rel.id, v_rel.release_version, v_rel.release_state,
      v_rel.release_fingerprint, v_rel.release_expires_at
    );

    IF v_user IS NULL THEN
      UPDATE public.omni_comms_delivery_attempt
         SET status='rejected', completed_at=now(), response_category='pre_dispatch_guard',
             failure_category='destination', is_retriable=false,
             error_code='in_app_destination_unresolved',
             error_detail='No application user could be resolved for this recipient.'
       WHERE id = v_attempt;
      UPDATE public.omni_comms_dispatch_job
         SET status='failed', is_runnable=false, attempt_count = attempt_count + 1,
             completed_at = now(), hold_reason='in_app_destination_unresolved',
             lock_token = NULL, locked_at = NULL, locked_by = NULL, lease_expires_at = NULL
       WHERE id = j.id;
      UPDATE public.omni_comms_message SET status='failed' WHERE id = m.id;

      SELECT COALESCE(MAX(event_sequence),0)+1 INTO v_seq
        FROM public.omni_comms_message_event WHERE request_id = j.request_id;
      INSERT INTO public.omni_comms_message_event (
        request_id, message_id, organization_id, event_type, event_sequence,
        summary, correlation_id, actor_type, safe_metadata
      ) VALUES (
        j.request_id, m.id, j.organization_id, 'provider_rejected', v_seq,
        'In-app delivery refused: no application user resolved.',
        p_correlation_id, 'system', jsonb_build_object('channel','in_app'));

      v_blocked := v_blocked + 1;
      v_results := v_results || jsonb_build_object(
        'job_id', j.id, 'outcome', 'blocked', 'result_code', 'in_app_destination_unresolved');
      CONTINUE;
    END IF;

    v_severity := COALESCE(NULLIF(btrim(m.channel_setting_snapshot ->> 'severity'),''), 'info');
    v_action_url := NULLIF(btrim(COALESCE(m.destination_snapshot ->> 'action_url', '')), '');
    v_action_label := NULLIF(btrim(COALESCE(m.destination_snapshot ->> 'action_label', '')), '');

    INSERT INTO public.in_app_notifications (
      user_id, title, body, link, notification_type, priority, module,
      related_record_id, metadata, omni_comms_message_id, omni_comms_request_id,
      action_label, source
    ) VALUES (
      v_user,
      COALESCE(NULLIF(btrim(COALESCE(m.rendered_subject,'')),''), 'Notification'),
      COALESCE(NULLIF(btrim(COALESCE(m.rendered_text,'')),''), ''),
      v_action_url,
      'omni_comms',
      CASE v_severity WHEN 'critical' THEN 'high' WHEN 'warning' THEN 'high' ELSE 'normal' END,
      NULLIF(btrim(COALESCE(m.channel_setting_snapshot ->> 'module_code','')),''),
      m.id::text,
      jsonb_build_object('severity', v_severity, 'channel', 'in_app'),
      m.id, j.request_id, v_action_label, 'omni_comms'
    )
    ON CONFLICT (omni_comms_message_id) WHERE omni_comms_message_id IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_notification;

    IF v_notification IS NULL THEN
      SELECT id INTO v_notification FROM public.in_app_notifications
       WHERE omni_comms_message_id = m.id;
    END IF;

    UPDATE public.omni_comms_delivery_attempt
       SET status='accepted', completed_at=now(),
           response_category='internal_projection',
           provider_message_id = v_notification::text,
           safe_response_metadata = jsonb_build_object('surface','in_app_notifications')
     WHERE id = v_attempt;

    UPDATE public.omni_comms_dispatch_job
       SET status='completed', is_runnable=false, attempt_count = attempt_count + 1,
           completed_at = now(),
           lock_token = NULL, locked_at = NULL, locked_by = NULL, lease_expires_at = NULL
     WHERE id = j.id;
    UPDATE public.omni_comms_message SET status='delivered' WHERE id = m.id;

    SELECT COALESCE(MAX(event_sequence),0)+1 INTO v_seq
      FROM public.omni_comms_message_event WHERE request_id = j.request_id;
    INSERT INTO public.omni_comms_message_event (
      request_id, message_id, organization_id, event_type, event_sequence,
      summary, correlation_id, actor_type, safe_metadata
    ) VALUES (
      j.request_id, m.id, j.organization_id, 'provider_accepted', v_seq,
      'In-app notification delivered to the recipient inbox.',
      p_correlation_id, 'system',
      jsonb_build_object('channel','in_app','severity',v_severity));

    v_delivered := v_delivered + 1;
    v_results := v_results || jsonb_build_object(
      'job_id', j.id, 'outcome', 'delivered', 'notification_id', v_notification);
  END LOOP;

  RETURN jsonb_build_object(
    'channel','in_app', 'scanned_jobs', v_scanned,
    'delivered', v_delivered, 'blocked', v_blocked, 'results', v_results);
END;
$function$;