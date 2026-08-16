-- ── Physical print production foundation (Phase 3A) ──────────────────────

CREATE TABLE public.omni_comms_print_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  department_id uuid,
  request_id uuid NOT NULL REFERENCES public.omni_comms_request(id) ON DELETE CASCADE,
  message_id uuid NOT NULL UNIQUE REFERENCES public.omni_comms_message(id) ON DELETE CASCADE,
  delivery_attempt_id uuid REFERENCES public.omni_comms_delivery_attempt(id),
  letter_reference text NOT NULL,
  recipient_reference text,
  recipient_display text,
  postal_destination_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  issuing_authority text,
  template_family_id uuid,
  template_version_id uuid,
  template_provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  artefact_bucket text,
  artefact_path text,
  artefact_checksum_sha256 text,
  artefact_byte_size integer,
  page_count integer,
  production_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  production_account_id uuid REFERENCES public.omni_comms_provider_account(id),
  physical_status text NOT NULL DEFAULT 'artefact_produced',
  hold_reason text,
  last_failure_reason text,
  attempt_count integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT omni_comms_print_item_status_chk CHECK (physical_status IN (
    'artefact_produced','queued_for_print','printing','printed',
    'print_failed','spoiled','held'))
);

CREATE INDEX omni_comms_print_item_org_status_idx
  ON public.omni_comms_print_item (organization_id, physical_status, created_at DESC);
CREATE INDEX omni_comms_print_item_request_idx
  ON public.omni_comms_print_item (request_id);

CREATE TABLE public.omni_comms_print_attempt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  print_item_id uuid NOT NULL REFERENCES public.omni_comms_print_item(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  production_provider_id uuid REFERENCES public.omni_comms_provider(id),
  production_account_id uuid REFERENCES public.omni_comms_provider_account(id),
  operator_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  outcome text NOT NULL DEFAULT 'in_progress',
  equipment_reference text,
  failure_reason text,
  page_count integer,
  correlation_id text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT omni_comms_print_attempt_outcome_chk CHECK (outcome IN
    ('in_progress','printed','failed','spoiled','abandoned')),
  CONSTRAINT omni_comms_print_attempt_unique UNIQUE (print_item_id, attempt_number)
);

CREATE INDEX omni_comms_print_attempt_item_idx
  ON public.omni_comms_print_attempt (print_item_id, attempt_number DESC);

GRANT SELECT ON public.omni_comms_print_item TO authenticated;
GRANT SELECT ON public.omni_comms_print_attempt TO authenticated;
GRANT ALL ON public.omni_comms_print_item TO service_role;
GRANT ALL ON public.omni_comms_print_attempt TO service_role;

-- ── Physical state machine ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.omni_comms_priv_print_transition_allowed(
  p_from text, p_to text
) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'pg_catalog','public'
AS $$
  SELECT (p_from, p_to) IN (
    ('artefact_produced','queued_for_print'),
    ('artefact_produced','held'),
    ('queued_for_print','printing'),
    ('queued_for_print','held'),
    ('printing','printed'),
    ('printing','print_failed'),
    ('printing','held'),
    ('print_failed','queued_for_print'),
    ('print_failed','spoiled'),
    ('print_failed','held'),
    ('printed','spoiled'),
    ('spoiled','queued_for_print'),
    ('held','queued_for_print'),
    ('held','artefact_produced')
  );
$$;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_print_mask_address(p_snapshot jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'pg_catalog','public'
AS $$
  SELECT nullif(trim(concat_ws(', ',
    nullif(coalesce(p_snapshot->>'city', p_snapshot->>'town'), ''),
    nullif(coalesce(p_snapshot->>'country', p_snapshot->>'country_code'), ''))), '');
$$;

-- ── Ensure exactly one print item per produced artefact ──────────────────

CREATE OR REPLACE FUNCTION public.omni_comms_print_item_ensure(
  p_message_id uuid,
  p_production_profile jsonb DEFAULT NULL,
  p_production_account_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('operate');
  v_msg public.omni_comms_message%ROWTYPE;
  v_att public.omni_comms_delivery_attempt%ROWTYPE;
  v_meta jsonb;
  v_id uuid;
  v_profile jsonb;
BEGIN
  SELECT * INTO v_msg FROM public.omni_comms_message WHERE id = p_message_id;
  IF v_msg.id IS NULL THEN
    RAISE EXCEPTION 'OC404 print_message_not_found'
      USING ERRCODE='P0001', DETAIL='print_message_not_found';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_msg.organization_id, NULL);

  IF v_msg.channel <> 'print' THEN
    RAISE EXCEPTION 'OC422 not_a_print_message'
      USING ERRCODE='P0001', DETAIL='not_a_print_message';
  END IF;

  SELECT id INTO v_id FROM public.omni_comms_print_item WHERE message_id = p_message_id;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT * INTO v_att
  FROM public.omni_comms_delivery_attempt a
  WHERE a.message_id = p_message_id
    AND a.status IN ('accepted','succeeded','success')
  ORDER BY a.attempt_number DESC
  LIMIT 1;

  IF v_att.id IS NULL THEN
    RAISE EXCEPTION 'OC412 artefact_not_produced'
      USING ERRCODE='P0001', DETAIL='artefact_not_produced';
  END IF;

  v_meta := coalesce(v_att.safe_response_metadata, '{}'::jsonb);
  v_profile := coalesce(p_production_profile, '{}'::jsonb);
  v_profile := jsonb_build_object(
    'paper_size',         coalesce(v_profile->>'paper_size', 'A4'),
    'sides',              coalesce(v_profile->>'sides', 'simplex'),
    'colour_mode',        coalesce(v_profile->>'colour_mode', 'black_white'),
    'copies',             coalesce((v_profile->>'copies')::int, 1),
    'letterhead_profile', v_profile->>'letterhead_profile',
    'envelope_profile',   v_profile->>'envelope_profile',
    'inserts',            coalesce(v_profile->'inserts', '[]'::jsonb),
    'special_handling',   v_profile->>'special_handling'
  );

  INSERT INTO public.omni_comms_print_item (
    organization_id, department_id, request_id, message_id, delivery_attempt_id,
    letter_reference, recipient_reference, recipient_display,
    postal_destination_snapshot, issuing_authority,
    template_family_id, template_version_id, template_provenance,
    artefact_bucket, artefact_path, artefact_checksum_sha256, artefact_byte_size,
    page_count, production_profile, production_account_id,
    physical_status, created_by, updated_by
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
    (v_meta->>'page_count')::int, v_profile,
    coalesce(p_production_account_id, v_att.provider_account_id, v_msg.provider_account_id),
    'artefact_produced', v_uid, v_uid
  )
  ON CONFLICT (message_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.omni_comms_print_item WHERE message_id = p_message_id;
  END IF;

  INSERT INTO public.audit_logs (user_id, action_type, module_name, entity_type, entity_id, metadata)
  VALUES (v_uid, 'omni_comms.print_item.created', 'omni_comms', 'omni_comms_print_item',
          v_id::text, jsonb_build_object('message_id', p_message_id));

  RETURN v_id;
END;
$$;

-- ── Governed physical action ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.omni_comms_print_item_action(
  p_id uuid,
  p_action text,
  p_expected_version integer,
  p_reason text DEFAULT NULL,
  p_production_account_id uuid DEFAULT NULL,
  p_equipment_reference text DEFAULT NULL,
  p_page_count integer DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('operate');
  v_item public.omni_comms_print_item%ROWTYPE;
  v_next text;
  v_attempt public.omni_comms_print_attempt%ROWTYPE;
  v_account uuid;
BEGIN
  SELECT * INTO v_item FROM public.omni_comms_print_item WHERE id = p_id FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'OC404 print_item_not_found'
      USING ERRCODE='P0001', DETAIL='print_item_not_found';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_item.organization_id, NULL);

  IF p_expected_version IS NOT NULL AND p_expected_version <> v_item.version THEN
    RAISE EXCEPTION 'OC413 concurrent_update'
      USING ERRCODE='P0001', DETAIL='concurrent_update';
  END IF;

  v_next := CASE p_action
    WHEN 'queue_for_print' THEN 'queued_for_print'
    WHEN 'start_printing'  THEN 'printing'
    WHEN 'confirm_printed' THEN 'printed'
    WHEN 'mark_failed'     THEN 'print_failed'
    WHEN 'mark_spoiled'    THEN 'spoiled'
    WHEN 'hold'            THEN 'held'
    WHEN 'requeue'         THEN 'queued_for_print'
    ELSE NULL END;

  IF v_next IS NULL THEN
    RAISE EXCEPTION 'OC422 unknown_print_action'
      USING ERRCODE='P0001', DETAIL='unknown_print_action';
  END IF;

  IF NOT public.omni_comms_priv_print_transition_allowed(v_item.physical_status, v_next) THEN
    RAISE EXCEPTION 'OC412 invalid_print_transition'
      USING ERRCODE='P0001', DETAIL=format('%s->%s', v_item.physical_status, v_next);
  END IF;

  IF p_action IN ('hold','mark_failed','mark_spoiled') AND coalesce(btrim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'OC422 reason_required'
      USING ERRCODE='P0001', DETAIL='reason_required';
  END IF;

  -- Physical attempts: start opens a new immutable attempt; outcomes close the
  -- open attempt only. Earlier attempts are never modified.
  IF p_action = 'start_printing' THEN
    v_account := coalesce(p_production_account_id, v_item.production_account_id);
    INSERT INTO public.omni_comms_print_attempt (
      print_item_id, organization_id, attempt_number, production_provider_id,
      production_account_id, operator_id, equipment_reference, correlation_id,
      idempotency_key, outcome
    )
    SELECT v_item.id, v_item.organization_id, v_item.attempt_count + 1,
           (SELECT provider_id FROM public.omni_comms_provider_account WHERE id = v_account),
           v_account, v_uid, p_equipment_reference, p_correlation_id,
           coalesce(p_correlation_id, v_item.id::text || ':' || (v_item.attempt_count + 1)::text),
           'in_progress';
    UPDATE public.omni_comms_print_item
       SET attempt_count = attempt_count + 1,
           production_account_id = coalesce(v_account, production_account_id)
     WHERE id = v_item.id;
  ELSIF p_action IN ('confirm_printed','mark_failed','mark_spoiled') THEN
    SELECT * INTO v_attempt
    FROM public.omni_comms_print_attempt
    WHERE print_item_id = v_item.id AND outcome = 'in_progress'
    ORDER BY attempt_number DESC LIMIT 1;
    IF v_attempt.id IS NOT NULL THEN
      UPDATE public.omni_comms_print_attempt
         SET outcome = CASE p_action
                          WHEN 'confirm_printed' THEN 'printed'
                          WHEN 'mark_failed' THEN 'failed'
                          ELSE 'spoiled' END,
             completed_at = now(),
             failure_reason = CASE WHEN p_action = 'confirm_printed' THEN NULL ELSE p_reason END,
             page_count = coalesce(p_page_count, v_item.page_count)
       WHERE id = v_attempt.id;
    END IF;
  END IF;

  UPDATE public.omni_comms_print_item
     SET physical_status = v_next,
         hold_reason = CASE WHEN p_action = 'hold' THEN p_reason
                            WHEN v_next = 'queued_for_print' THEN NULL
                            ELSE hold_reason END,
         last_failure_reason = CASE WHEN p_action IN ('mark_failed','mark_spoiled') THEN p_reason
                                    ELSE last_failure_reason END,
         page_count = coalesce(p_page_count, page_count),
         version = version + 1,
         updated_at = now(),
         updated_by = v_uid
   WHERE id = v_item.id
  RETURNING * INTO v_item;

  INSERT INTO public.audit_logs (user_id, action_type, module_name, entity_type, entity_id,
                                 old_value, new_value, metadata)
  VALUES (v_uid, 'omni_comms.print_item.' || p_action, 'omni_comms', 'omni_comms_print_item',
          v_item.id::text, v_item.physical_status, v_next,
          jsonb_strip_nulls(jsonb_build_object(
            'reason', p_reason,
            'equipment_reference', p_equipment_reference,
            'production_account_id', p_production_account_id)));

  RETURN jsonb_build_object(
    'id', v_item.id,
    'physical_status', v_item.physical_status,
    'version', v_item.version,
    'attempt_count', v_item.attempt_count,
    'updated_at', v_item.updated_at);
END;
$$;

-- ── Queue projection (masked by default) ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.omni_comms_print_queue_list(
  p_organization_id uuid,
  p_statuses text[] DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_production_account_id uuid DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('view');
  v_full boolean;
  v_rows jsonb;
  v_total bigint;
BEGIN
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);
  v_full := public.has_permission(v_uid, 'omni_comms', 'operate');

  SELECT count(*) INTO v_total
  FROM public.omni_comms_print_item i
  WHERE i.organization_id = p_organization_id
    AND (p_department_id IS NULL OR i.department_id = p_department_id)
    AND (p_statuses IS NULL OR i.physical_status = ANY (p_statuses))
    AND (p_production_account_id IS NULL OR i.production_account_id = p_production_account_id)
    AND (coalesce(btrim(p_search), '') = ''
         OR i.letter_reference ILIKE '%' || p_search || '%'
         OR coalesce(i.recipient_reference,'') ILIKE '%' || p_search || '%');

  SELECT coalesce(jsonb_agg(r ORDER BY r->>'created_at' DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', i.id,
      'created_at', i.created_at,
      'updated_at', i.updated_at,
      'letter_reference', i.letter_reference,
      'request_id', i.request_id,
      'message_id', i.message_id,
      'module_code', e.module_code,
      'event_code', e.event_code,
      'recipient_reference', i.recipient_reference,
      'recipient_display', CASE WHEN v_full THEN i.recipient_display
                                ELSE left(coalesce(i.recipient_display,'—'), 1) || '•••' END,
      'postal_summary', public.omni_comms_priv_print_mask_address(i.postal_destination_snapshot),
      'issuing_authority', i.issuing_authority,
      'page_count', i.page_count,
      'production_profile', i.production_profile,
      'production_account_id', i.production_account_id,
      'production_account_name', pa.display_name,
      'physical_status', i.physical_status,
      'attempt_count', i.attempt_count,
      'version', i.version,
      'hold_reason', i.hold_reason,
      'last_failure_reason', i.last_failure_reason,
      'age_hours', round(extract(epoch FROM (now() - i.created_at)) / 3600.0, 1)
    ) AS r
    FROM public.omni_comms_print_item i
    LEFT JOIN public.omni_comms_provider_account pa ON pa.id = i.production_account_id
    LEFT JOIN public.omni_comms_request req ON req.id = i.request_id
    LEFT JOIN public.omni_comms_event_definition e ON e.id = req.event_definition_id
    WHERE i.organization_id = p_organization_id
      AND (p_department_id IS NULL OR i.department_id = p_department_id)
      AND (p_statuses IS NULL OR i.physical_status = ANY (p_statuses))
      AND (p_production_account_id IS NULL OR i.production_account_id = p_production_account_id)
      AND (coalesce(btrim(p_search), '') = ''
           OR i.letter_reference ILIKE '%' || p_search || '%'
           OR coalesce(i.recipient_reference,'') ILIKE '%' || p_search || '%')
    ORDER BY i.created_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 50), 200))
    OFFSET greatest(0, coalesce(p_offset, 0))
  ) s;

  RETURN jsonb_build_object(
    'items', v_rows,
    'total', v_total,
    'full_detail_permitted', v_full,
    'generated_at', now());
END;
$$;

CREATE OR REPLACE FUNCTION public.omni_comms_print_item_detail(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('view');
  v_item public.omni_comms_print_item%ROWTYPE;
  v_full boolean;
BEGIN
  SELECT * INTO v_item FROM public.omni_comms_print_item WHERE id = p_id;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'OC404 print_item_not_found'
      USING ERRCODE='P0001', DETAIL='print_item_not_found';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_item.organization_id, NULL);
  v_full := public.has_permission(v_uid, 'omni_comms', 'operate');

  RETURN jsonb_build_object(
    'item', jsonb_build_object(
      'id', v_item.id,
      'letter_reference', v_item.letter_reference,
      'request_id', v_item.request_id,
      'message_id', v_item.message_id,
      'physical_status', v_item.physical_status,
      'version', v_item.version,
      'attempt_count', v_item.attempt_count,
      'issuing_authority', v_item.issuing_authority,
      'page_count', v_item.page_count,
      'production_profile', v_item.production_profile,
      'production_account_id', v_item.production_account_id,
      'hold_reason', v_item.hold_reason,
      'last_failure_reason', v_item.last_failure_reason,
      'created_at', v_item.created_at,
      'updated_at', v_item.updated_at),
    'artefact', jsonb_build_object(
      'bucket', v_item.artefact_bucket,
      'path', CASE WHEN v_full THEN v_item.artefact_path ELSE NULL END,
      'checksum_sha256', v_item.artefact_checksum_sha256,
      'byte_size', v_item.artefact_byte_size,
      'page_count', v_item.page_count,
      'state', 'artefact_produced'),
    'recipient', jsonb_build_object(
      'reference', v_item.recipient_reference,
      'display', CASE WHEN v_full THEN v_item.recipient_display
                      ELSE left(coalesce(v_item.recipient_display,'—'),1) || '•••' END,
      'postal_destination', CASE WHEN v_full THEN v_item.postal_destination_snapshot ELSE NULL END,
      'postal_summary', public.omni_comms_priv_print_mask_address(v_item.postal_destination_snapshot)),
    'attempts', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'attempt_number', a.attempt_number,
        'outcome', a.outcome,
        'production_account_id', a.production_account_id,
        'production_account_name', pa.display_name,
        'operator_id', a.operator_id,
        'started_at', a.started_at,
        'completed_at', a.completed_at,
        'equipment_reference', a.equipment_reference,
        'failure_reason', a.failure_reason,
        'page_count', a.page_count) ORDER BY a.attempt_number)
      FROM public.omni_comms_print_attempt a
      LEFT JOIN public.omni_comms_provider_account pa ON pa.id = a.production_account_id
      WHERE a.print_item_id = v_item.id), '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.omni_comms_print_item_ensure(uuid, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_print_item_action(uuid, text, integer, text, uuid, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_print_queue_list(uuid, text[], text, uuid, uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_print_item_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_print_transition_allowed(text, text) TO authenticated;