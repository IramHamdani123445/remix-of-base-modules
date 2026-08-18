-- Omni-Comms — In-App as a genuine production delivery channel.
--
-- Boundaries: business modules keep calling sendCommunication() only. In-App is
-- an INTERNAL adapter: there is no external provider, no credential and no
-- outbound network call. Delivery is a governed projection of an already
-- rendered, already authorised Omni-Comms message into in_app_notifications.

CREATE OR REPLACE FUNCTION public.omni_comms_priv_validate_channel_content(
  p_channel text, p_content jsonb
) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_allowed text[];
  v_required text[];
  v_key text;
  v_val jsonb;
  v_bytes integer;
  v_html text;
  v_text text;
  v_severity text;
  v_action text;
BEGIN
  IF p_content IS NULL OR jsonb_typeof(p_content) <> 'object' THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_not_object';
  END IF;
  v_bytes := octet_length(convert_to(p_content::text, 'UTF8'));
  IF v_bytes > 262144 THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_too_large';
  END IF;

  CASE p_channel
    WHEN 'email'    THEN v_allowed := ARRAY['subject','html','text','preheader'];
                         v_required := ARRAY['subject'];
    WHEN 'sms'      THEN v_allowed := ARRAY['body'];                v_required := ARRAY['body'];
    WHEN 'in_app'   THEN v_allowed := ARRAY['title','body','severity','category','action_label','action_url'];
                         v_required := ARRAY['title','body'];
    WHEN 'push'     THEN v_allowed := ARRAY['title','body'];        v_required := ARRAY['title','body'];
    WHEN 'whatsapp' THEN v_allowed := ARRAY['body'];                v_required := ARRAY['body'];
    WHEN 'print'    THEN v_allowed := ARRAY['subject','html','text'];v_required := ARRAY['subject'];
    ELSE
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='channel_unknown';
  END CASE;

  FOR v_key IN SELECT k FROM jsonb_object_keys(p_content) k LOOP
    IF NOT (v_key = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_unknown_key';
    END IF;
    v_val := p_content -> v_key;
    IF v_val IS NULL OR jsonb_typeof(v_val) = 'null' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_null_value';
    END IF;
    IF jsonb_typeof(v_val) <> 'string' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_non_string_value';
    END IF;
    IF btrim(v_val #>> '{}') = '' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_empty_value';
    END IF;
    PERFORM public.omni_comms_priv_extract_tokens(v_val #>> '{}');
  END LOOP;

  FOR v_key IN SELECT unnest(v_required) LOOP
    IF NOT (p_content ? v_key) THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_missing_required_key';
    END IF;
  END LOOP;

  IF p_channel = 'email' THEN
    v_html := p_content ->> 'html';
    v_text := p_content ->> 'text';
    IF COALESCE(btrim(v_html), '') = '' AND COALESCE(btrim(v_text), '') = '' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_email_body_required';
    END IF;
  END IF;

  IF p_channel = 'in_app' THEN
    v_severity := btrim(COALESCE(p_content ->> 'severity', 'info'));
    IF v_severity NOT IN ('info','success','warning','critical') THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_in_app_severity_invalid';
    END IF;
    v_action := btrim(COALESCE(p_content ->> 'action_url', ''));
    IF v_action <> '' AND v_action !~ '^/[A-Za-z0-9_\-/{}\.\?=&%:]*$' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_in_app_action_url_invalid';
    END IF;
    IF (p_content ? 'action_label') AND v_action = '' THEN
      RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='content_in_app_action_url_required';
    END IF;
  END IF;
END;
$function$;

ALTER TABLE public.in_app_notifications
  ADD COLUMN IF NOT EXISTS omni_comms_message_id uuid,
  ADD COLUMN IF NOT EXISTS omni_comms_request_id uuid,
  ADD COLUMN IF NOT EXISTS action_label text,
  ADD COLUMN IF NOT EXISTS acted_at timestamptz,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'legacy';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'in_app_notifications_source_chk') THEN
    ALTER TABLE public.in_app_notifications
      ADD CONSTRAINT in_app_notifications_source_chk CHECK (source IN ('legacy','omni_comms'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'in_app_notifications_omni_message_fk') THEN
    ALTER TABLE public.in_app_notifications
      ADD CONSTRAINT in_app_notifications_omni_message_fk
      FOREIGN KEY (omni_comms_message_id) REFERENCES public.omni_comms_message(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS in_app_notifications_omni_message_uk
  ON public.in_app_notifications (omni_comms_message_id)
  WHERE omni_comms_message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_resolve_in_app_user(p_recipient_id uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  r record;
  v_candidate text;
  v_user uuid;
BEGIN
  SELECT recipient_type, recipient_reference, destination_snapshot, email_destination
    INTO r
    FROM public.omni_comms_recipient WHERE id = p_recipient_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_candidate := NULLIF(btrim(COALESCE(r.destination_snapshot ->> 'in_app_user_id',
                                       r.destination_snapshot ->> 'user_id', '')), '');
  IF v_candidate IS NOT NULL THEN
    BEGIN v_user := v_candidate::uuid; EXCEPTION WHEN others THEN v_user := NULL; END;
  END IF;

  IF v_user IS NULL AND r.recipient_type = 'user' THEN
    BEGIN v_user := NULLIF(btrim(COALESCE(r.recipient_reference,'')),'')::uuid;
    EXCEPTION WHEN others THEN v_user := NULL; END;
  END IF;

  IF v_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_user) THEN
    v_user := NULL;
  END IF;

  IF v_user IS NULL THEN
    v_candidate := lower(NULLIF(btrim(COALESCE(r.email_destination,'')),''));
    IF v_candidate IS NOT NULL THEN
      SELECT u.id INTO v_user FROM auth.users u WHERE lower(u.email) = v_candidate LIMIT 1;
    END IF;
  END IF;

  RETURN v_user;
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_resolve_in_app_user(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_dispatch_deliver_in_app(
  p_worker text DEFAULT 'omni-comms-in-app',
  p_batch_limit integer DEFAULT 5,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_batch_limit,5),1),25);
  v_scanned integer := 0;
  v_delivered integer := 0;
  v_blocked integer := 0;
  v_results jsonb := '[]'::jsonb;
  j record;
  m record;
  v_state text;
  v_user uuid;
  v_attempt uuid;
  v_notification uuid;
  v_seq bigint;
  v_severity text;
  v_action_url text;
  v_action_label text;
BEGIN
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

    SELECT release_state INTO v_state
      FROM public.omni_comms_channel_release_control
     WHERE organization_id = j.organization_id AND channel = 'in_app'
     ORDER BY (department_id IS NULL) LIMIT 1;

    IF COALESCE(v_state,'disabled') NOT IN ('controlled_pilot','live') THEN
      v_blocked := v_blocked + 1;
      v_results := v_results || jsonb_build_object(
        'job_id', j.id, 'outcome', 'blocked', 'result_code', 'in_app_channel_not_released');
      CONTINUE;
    END IF;

    v_user := public.omni_comms_priv_resolve_in_app_user(m.recipient_id);

    v_attempt := gen_random_uuid();
    INSERT INTO public.omni_comms_delivery_attempt (
      id, dispatch_job_id, message_id, organization_id, attempt_number,
      status, started_at, worker_id, execution_context
    ) VALUES (
      v_attempt, j.id, m.id, j.organization_id, j.attempt_count + 1,
      'started', now(), COALESCE(p_worker,'omni-comms-in-app'), 'system'
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
             completed_at = now(), hold_reason='in_app_destination_unresolved'
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
           completed_at = now()
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

REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_deliver_in_app(text,integer,text)
  FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_in_app_record_engagement(
  p_notification_id uuid,
  p_engagement text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  n record;
  v_seq bigint;
  v_org uuid;
BEGIN
  IF p_engagement NOT IN ('read','action') THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='engagement_invalid';
  END IF;

  SELECT * INTO n FROM public.in_app_notifications
   WHERE id = p_notification_id AND user_id = auth.uid();
  IF NOT FOUND THEN RETURN false; END IF;

  IF p_engagement = 'read' THEN
    UPDATE public.in_app_notifications
       SET is_read = true, read_at = COALESCE(read_at, now())
     WHERE id = n.id;
  ELSE
    UPDATE public.in_app_notifications
       SET is_read = true, read_at = COALESCE(read_at, now()), acted_at = COALESCE(acted_at, now())
     WHERE id = n.id;
  END IF;

  IF n.omni_comms_message_id IS NOT NULL AND n.omni_comms_request_id IS NOT NULL THEN
    SELECT organization_id INTO v_org FROM public.omni_comms_message WHERE id = n.omni_comms_message_id;
    SELECT COALESCE(MAX(event_sequence),0)+1 INTO v_seq
      FROM public.omni_comms_message_event WHERE request_id = n.omni_comms_request_id;
    INSERT INTO public.omni_comms_message_event (
      request_id, message_id, organization_id, event_type, event_sequence,
      summary, actor_type, safe_metadata
    ) VALUES (
      n.omni_comms_request_id, n.omni_comms_message_id, v_org,
      CASE WHEN p_engagement = 'read' THEN 'callback_opened' ELSE 'callback_clicked' END,
      v_seq,
      CASE WHEN p_engagement = 'read'
        THEN 'Recipient opened the in-app notification.'
        ELSE 'Recipient followed the in-app notification action.' END,
      'recipient', jsonb_build_object('channel','in_app'));
  END IF;

  RETURN true;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_in_app_record_engagement(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.omni_comms_in_app_record_engagement(uuid,text) FROM public, anon;