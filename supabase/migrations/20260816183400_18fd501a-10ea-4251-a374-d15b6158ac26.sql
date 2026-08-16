-- 1. Extend physical state machine with dispatch outcomes
ALTER TABLE public.omni_comms_print_item DROP CONSTRAINT IF EXISTS omni_comms_print_item_status_chk;
ALTER TABLE public.omni_comms_print_item ADD CONSTRAINT omni_comms_print_item_status_chk
  CHECK (physical_status = ANY (ARRAY['artefact_produced','queued_for_print','printing','printed',
                                      'print_failed','spoiled','held','dispatched','returned_undelivered']));

ALTER TABLE public.omni_comms_print_item
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatch_method text,
  ADD COLUMN IF NOT EXISTS dispatch_reference text,
  ADD COLUMN IF NOT EXISTS returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_reason text;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_print_transition_allowed(p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog','public' AS $$
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
    ('printed','dispatched'),
    ('spoiled','queued_for_print'),
    ('held','queued_for_print'),
    ('held','artefact_produced'),
    ('dispatched','returned_undelivered'),
    ('returned_undelivered','queued_for_print'),
    ('returned_undelivered','held')
  );
$$;

-- 2. Immutable dispatch record: what was posted, to which address, how, by whom
CREATE TABLE IF NOT EXISTS public.omni_comms_print_dispatch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  print_item_id uuid NOT NULL REFERENCES public.omni_comms_print_item(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  dispatch_sequence integer NOT NULL,
  dispatch_method text NOT NULL,
  carrier text,
  service_level text,
  tracking_reference text,
  postage_cost numeric(12,2),
  postage_currency text,
  addressee_display text,
  address_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  address_lines text[] NOT NULL DEFAULT '{}',
  enclosure_count integer,
  page_count integer,
  print_batch_id uuid REFERENCES public.omni_comms_print_batch(id),
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  dispatched_by uuid,
  notes text,
  return_reason text,
  returned_at timestamptz,
  returned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (print_item_id, dispatch_sequence)
);
CREATE INDEX IF NOT EXISTS omni_comms_print_dispatch_org_idx
  ON public.omni_comms_print_dispatch(organization_id, dispatched_at DESC);

GRANT SELECT ON public.omni_comms_print_dispatch TO authenticated;
GRANT ALL ON public.omni_comms_print_dispatch TO service_role;
ALTER TABLE public.omni_comms_print_dispatch DISABLE ROW LEVEL SECURITY;

-- 3. Dispatch + return actions on the governed item action RPC
CREATE OR REPLACE FUNCTION public.omni_comms_print_item_action(
  p_id uuid, p_action text, p_expected_version integer, p_reason text DEFAULT NULL,
  p_production_account_id uuid DEFAULT NULL, p_equipment_reference text DEFAULT NULL,
  p_page_count integer DEFAULT NULL, p_correlation_id text DEFAULT NULL,
  p_dispatch jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $function$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('operate');
  v_item public.omni_comms_print_item%ROWTYPE;
  v_next text;
  v_attempt public.omni_comms_print_attempt%ROWTYPE;
  v_account uuid;
  v_d jsonb := coalesce(p_dispatch, '{}'::jsonb);
  v_lines text[];
  v_seq integer;
BEGIN
  SELECT * INTO v_item FROM public.omni_comms_print_item WHERE id = p_id FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'OC404 print_item_not_found' USING ERRCODE='P0001', DETAIL='print_item_not_found';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_item.organization_id, NULL);

  IF p_expected_version IS NOT NULL AND p_expected_version <> v_item.version THEN
    RAISE EXCEPTION 'OC413 concurrent_update' USING ERRCODE='P0001', DETAIL='concurrent_update';
  END IF;

  v_next := CASE p_action
    WHEN 'queue_for_print' THEN 'queued_for_print'
    WHEN 'start_printing'  THEN 'printing'
    WHEN 'confirm_printed' THEN 'printed'
    WHEN 'mark_failed'     THEN 'print_failed'
    WHEN 'mark_spoiled'    THEN 'spoiled'
    WHEN 'hold'            THEN 'held'
    WHEN 'requeue'         THEN 'queued_for_print'
    WHEN 'confirm_dispatched' THEN 'dispatched'
    WHEN 'mark_returned'      THEN 'returned_undelivered'
    ELSE NULL END;

  IF v_next IS NULL THEN
    RAISE EXCEPTION 'OC422 unknown_print_action' USING ERRCODE='P0001', DETAIL='unknown_print_action';
  END IF;

  IF NOT public.omni_comms_priv_print_transition_allowed(v_item.physical_status, v_next) THEN
    RAISE EXCEPTION 'OC412 invalid_print_transition'
      USING ERRCODE='P0001', DETAIL=format('%s->%s', v_item.physical_status, v_next);
  END IF;

  IF p_action IN ('hold','mark_failed','mark_spoiled','mark_returned')
     AND coalesce(btrim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'OC422 reason_required' USING ERRCODE='P0001', DETAIL='reason_required';
  END IF;

  IF p_action = 'start_printing' THEN
    v_account := coalesce(p_production_account_id, v_item.production_account_id);
    INSERT INTO public.omni_comms_print_attempt (
      print_item_id, organization_id, attempt_number, production_provider_id,
      production_account_id, operator_id, equipment_reference, correlation_id,
      idempotency_key, outcome)
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
    SELECT * INTO v_attempt FROM public.omni_comms_print_attempt
     WHERE print_item_id = v_item.id AND outcome = 'in_progress'
     ORDER BY attempt_number DESC LIMIT 1;
    IF v_attempt.id IS NOT NULL THEN
      UPDATE public.omni_comms_print_attempt
         SET outcome = CASE p_action WHEN 'confirm_printed' THEN 'printed'
                                     WHEN 'mark_failed' THEN 'failed' ELSE 'spoiled' END,
             completed_at = now(),
             failure_reason = CASE WHEN p_action = 'confirm_printed' THEN NULL ELSE p_reason END,
             page_count = coalesce(p_page_count, v_item.page_count)
       WHERE id = v_attempt.id;
    END IF;
  END IF;

  -- Dispatch evidence: the address ACTUALLY used is snapshotted at dispatch time.
  IF p_action = 'confirm_dispatched' THEN
    IF coalesce(btrim(v_d->>'dispatch_method'),'') = '' THEN
      RAISE EXCEPTION 'OC422 dispatch_method_required' USING ERRCODE='P0001', DETAIL='dispatch_method_required';
    END IF;
    IF coalesce(v_item.postal_destination_snapshot, '{}'::jsonb) = '{}'::jsonb THEN
      RAISE EXCEPTION 'OC422 postal_destination_missing' USING ERRCODE='P0001', DETAIL='postal_destination_missing';
    END IF;
    SELECT coalesce(array_agg(x), '{}') INTO v_lines
    FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(v_item.postal_destination_snapshot->'address_lines') = 'array'
           THEN v_item.postal_destination_snapshot->'address_lines' ELSE '[]'::jsonb END) AS t(x);

    SELECT coalesce(max(dispatch_sequence),0) + 1 INTO v_seq
    FROM public.omni_comms_print_dispatch WHERE print_item_id = v_item.id;

    INSERT INTO public.omni_comms_print_dispatch (
      print_item_id, organization_id, dispatch_sequence, dispatch_method, carrier,
      service_level, tracking_reference, postage_cost, postage_currency,
      addressee_display, address_snapshot, address_lines, enclosure_count, page_count,
      print_batch_id, dispatched_by, notes)
    VALUES (
      v_item.id, v_item.organization_id, v_seq, btrim(v_d->>'dispatch_method'),
      nullif(btrim(coalesce(v_d->>'carrier','')),''), nullif(btrim(coalesce(v_d->>'service_level','')),''),
      nullif(btrim(coalesce(v_d->>'tracking_reference','')),''),
      nullif(v_d->>'postage_cost','')::numeric, nullif(btrim(coalesce(v_d->>'postage_currency','')),''),
      v_item.recipient_display, v_item.postal_destination_snapshot, v_lines,
      nullif(v_d->>'enclosure_count','')::int, coalesce(p_page_count, v_item.page_count),
      (SELECT bi.print_batch_id FROM public.omni_comms_print_batch_item bi
        WHERE bi.print_item_id = v_item.id ORDER BY bi.created_at DESC LIMIT 1),
      v_uid, nullif(btrim(coalesce(v_d->>'notes','')),''));
  ELSIF p_action = 'mark_returned' THEN
    UPDATE public.omni_comms_print_dispatch
       SET return_reason = p_reason, returned_at = now(), returned_by = v_uid
     WHERE print_item_id = v_item.id AND returned_at IS NULL;
  END IF;

  UPDATE public.omni_comms_print_item
     SET physical_status = v_next,
         hold_reason = CASE WHEN p_action = 'hold' THEN p_reason
                            WHEN v_next = 'queued_for_print' THEN NULL ELSE hold_reason END,
         last_failure_reason = CASE WHEN p_action IN ('mark_failed','mark_spoiled')
                                    THEN p_reason ELSE last_failure_reason END,
         dispatched_at = CASE WHEN p_action = 'confirm_dispatched' THEN now() ELSE dispatched_at END,
         dispatch_method = CASE WHEN p_action = 'confirm_dispatched'
                                THEN btrim(v_d->>'dispatch_method') ELSE dispatch_method END,
         dispatch_reference = CASE WHEN p_action = 'confirm_dispatched'
                                   THEN nullif(btrim(coalesce(v_d->>'tracking_reference','')),'')
                                   ELSE dispatch_reference END,
         returned_at = CASE WHEN p_action = 'mark_returned' THEN now() ELSE returned_at END,
         return_reason = CASE WHEN p_action = 'mark_returned' THEN p_reason ELSE return_reason END,
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
            'production_account_id', p_production_account_id,
            'dispatch_method', v_item.dispatch_method,
            'dispatch_reference', v_item.dispatch_reference)));

  RETURN jsonb_build_object(
    'id', v_item.id, 'physical_status', v_item.physical_status, 'version', v_item.version,
    'attempt_count', v_item.attempt_count, 'updated_at', v_item.updated_at);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.omni_comms_print_item_action(uuid,text,integer,text,uuid,text,integer,text,jsonb) TO authenticated;
DROP FUNCTION IF EXISTS public.omni_comms_print_item_action(uuid,text,integer,text,uuid,text,integer,text);