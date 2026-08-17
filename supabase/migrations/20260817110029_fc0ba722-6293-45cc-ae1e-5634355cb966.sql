
ALTER TABLE public.omni_comms_message_event
  DROP CONSTRAINT IF EXISTS omni_comms_message_event_event_type_check;
ALTER TABLE public.omni_comms_message_event
  ADD CONSTRAINT omni_comms_message_event_event_type_check CHECK (event_type = ANY (ARRAY[
    'request_accepted','request_processing','recipient_resolved','recipient_blocked',
    'message_rendered','message_blocked','dry_run_completed','shadow_completed',
    'dispatch_queued','dispatch_held','request_completed','request_failed','dispatch_ready',
    'dispatch_claimed','dispatch_leased','dispatch_lease_expired','dispatch_cancelled',
    'provider_attempt_started','provider_accepted','provider_rejected','provider_outcome_unknown',
    'provider_retry_scheduled','provider_attempts_exhausted','callback_delivered','callback_delayed',
    'callback_bounced','callback_complained','callback_opened','callback_clicked','pilot_suspended',
    'reconciliation_required','reconciliation_resolved','callback_ambiguous','callback_ignored',
    'request_recovered','print_artefact_produced','print_production_failed'
  ]));

CREATE OR REPLACE FUNCTION public.omni_comms_priv_print_item_ensure_system(p_message_id uuid, p_attempt_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_msg public.omni_comms_message%ROWTYPE;
  v_att public.omni_comms_delivery_attempt%ROWTYPE;
  v_meta jsonb; v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.omni_comms_print_item WHERE message_id = p_message_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT * INTO v_msg FROM public.omni_comms_message WHERE id = p_message_id;
  IF v_msg.id IS NULL OR v_msg.channel <> 'print' THEN RETURN NULL; END IF;

  SELECT * INTO v_att FROM public.omni_comms_delivery_attempt WHERE id = p_attempt_id;
  IF v_att.id IS NULL OR v_att.status <> 'accepted' THEN RETURN NULL; END IF;

  v_meta := coalesce(v_att.safe_response_metadata, '{}'::jsonb);

  INSERT INTO public.omni_comms_print_item (
    organization_id, department_id, request_id, message_id, delivery_attempt_id,
    letter_reference, recipient_reference, recipient_display,
    postal_destination_snapshot, issuing_authority,
    template_family_id, template_version_id, template_provenance,
    artefact_bucket, artefact_path, artefact_checksum_sha256, artefact_byte_size,
    page_count, production_profile, production_account_id, physical_status
  ) VALUES (
    v_msg.organization_id, v_msg.department_id, v_msg.request_id, v_msg.id, v_att.id,
    coalesce(v_meta->>'letter_reference', 'LTR-' || upper(substr(replace(v_msg.id::text,'-',''),1,12))),
    coalesce(v_meta->>'recipient_reference', v_msg.destination_snapshot->>'reference'),
    coalesce(v_msg.destination_snapshot->>'display_name', v_meta->>'recipient_reference'),
    coalesce(v_msg.destination_snapshot, '{}'::jsonb),
    coalesce(v_msg.channel_setting_snapshot->>'issuing_authority', v_meta->>'issuing_authority'),
    v_msg.template_family_id, v_msg.template_version_id,
    jsonb_strip_nulls(jsonb_build_object(
      'template_family', v_meta->>'template_family',
      'template_version', v_meta->>'template_version')),
    v_meta->>'artefact_bucket', coalesce(v_meta->>'artefact_path', v_att.provider_message_id),
    v_meta->>'document_checksum_sha256', (v_meta->>'artefact_bytes')::int,
    (v_meta->>'page_count')::int,
    jsonb_build_object('paper_size','A4','sides','simplex','colour_mode','black_white',
                       'copies',1,'letterhead_profile',NULL,'envelope_profile',NULL,
                       'inserts','[]'::jsonb,'special_handling',NULL),
    coalesce(v_att.provider_account_id, v_msg.provider_account_id),
    'artefact_produced'
  )
  ON CONFLICT (message_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.omni_comms_print_item WHERE message_id = p_message_id;
  END IF;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_print_item_ensure_system(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_print_production_complete(p_attempt_id uuid, p_claim_token text, p_status text, p_artefact jsonb DEFAULT NULL::jsonb, p_error_code text DEFAULT NULL::text, p_error_detail text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_att public.omni_comms_delivery_attempt;
  v_a jsonb := coalesce(p_artefact,'{}'::jsonb);
  v_msg public.omni_comms_message%ROWTYPE;
  v_item_id uuid;
  v_cap integer := 6;
BEGIN
  IF p_status NOT IN ('accepted','failed') THEN
    RAISE EXCEPTION 'OC422 invalid_attempt_status' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_att FROM public.omni_comms_delivery_attempt WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC404 attempt_not_found' USING ERRCODE='P0001'; END IF;
  IF v_att.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'OC409 stale_claim' USING ERRCODE='P0001';
  END IF;
  IF v_att.status NOT IN ('started','dispatching') THEN
    RETURN jsonb_build_object('recorded', false, 'code','already_terminal');
  END IF;

  IF p_status = 'accepted' AND coalesce(btrim(v_a->>'artefact_path'),'') = '' THEN
    RAISE EXCEPTION 'OC422 print_artefact_missing' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_msg FROM public.omni_comms_message WHERE id = v_att.message_id;

  UPDATE public.omni_comms_delivery_attempt
     SET status = CASE WHEN p_status = 'accepted' THEN 'accepted' ELSE 'failed' END,
         completed_at = now(),
         latency_ms = greatest(0,(extract(epoch FROM (now() - started_at))*1000)::int),
         provider_message_id = nullif(btrim(coalesce(v_a->>'artefact_path','')),''),
         response_category = CASE WHEN p_status='accepted' THEN 'accepted' ELSE 'error' END,
         response_code = left(coalesce(p_error_code, p_status),100),
         error_code = left(p_error_code,200),
         error_detail = left(p_error_detail,1000),
         failure_category = CASE WHEN p_status='accepted' THEN NULL
                                 ELSE left(coalesce(p_error_code,'print_production_failed'),100) END,
         safe_response_metadata = jsonb_strip_nulls(jsonb_build_object(
            'category','print_production',
            'artefact_bucket', v_a->>'artefact_bucket',
            'artefact_path', v_a->>'artefact_path',
            'document_checksum_sha256', v_a->>'document_checksum_sha256',
            'artefact_bytes', v_a->>'artefact_bytes',
            'page_count', v_a->>'page_count',
            'letter_reference', v_a->>'letter_reference',
            'issuing_authority', v_a->>'issuing_authority',
            'recipient_reference', v_a->>'recipient_reference',
            'error_code', p_error_code)),
         claim_token = NULL
   WHERE id = v_att.id;

  IF p_status = 'accepted' THEN
    UPDATE public.omni_comms_dispatch_job
       SET status='completed', completed_at=now(), is_runnable=false,
           lock_token=NULL, locked_at=NULL, locked_by=NULL, lease_expires_at=NULL,
           updated_at=now()
     WHERE id = v_att.dispatch_job_id;
    UPDATE public.omni_comms_message SET status='accepted', updated_at=now()
     WHERE id = v_att.message_id;
    v_item_id := public.omni_comms_priv_print_item_ensure_system(v_att.message_id, v_att.id);
  ELSE
    UPDATE public.omni_comms_dispatch_job
       SET status = CASE WHEN v_att.attempt_number >= v_cap THEN 'failed' ELSE 'retry_wait' END,
           is_runnable = false,
           next_attempt_at = CASE WHEN v_att.attempt_number >= v_cap THEN NULL
                                  ELSE now() + (interval '1 minute' * v_att.attempt_number) END,
           completed_at = CASE WHEN v_att.attempt_number >= v_cap THEN now() ELSE NULL END,
           lock_token=NULL, locked_at=NULL, locked_by=NULL, lease_expires_at=NULL,
           updated_at=now()
     WHERE id = v_att.dispatch_job_id;
    IF v_att.attempt_number >= v_cap THEN
      UPDATE public.omni_comms_message SET status='failed', failed_at=now(), updated_at=now()
       WHERE id = v_att.message_id;
    END IF;
  END IF;

  INSERT INTO public.omni_comms_message_event (
    request_id, message_id, organization_id, event_type, event_sequence,
    safe_metadata, actor_type, actor_id)
  VALUES (v_msg.request_id, v_att.message_id, v_att.organization_id,
    CASE WHEN p_status='accepted' THEN 'print_artefact_produced' ELSE 'print_production_failed' END,
    public.omni_comms_priv_next_event_sequence(v_msg.request_id),
    jsonb_strip_nulls(jsonb_build_object('attempt_number', v_att.attempt_number,
                                         'error_code', p_error_code,
                                         'print_item_id', v_item_id)),
    'system','omni-comms-print-production');

  IF v_item_id IS NULL THEN
    SELECT id INTO v_item_id FROM public.omni_comms_print_item WHERE message_id = v_att.message_id;
  END IF;

  RETURN jsonb_build_object('recorded', true, 'print_item_id', v_item_id);
END;
$function$;
