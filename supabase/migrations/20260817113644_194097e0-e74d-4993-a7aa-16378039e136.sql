-- Omni-Comms Print — governed print equipment registry (printers/devices).
CREATE TABLE IF NOT EXISTS public.omni_comms_print_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  department_id uuid NULL,
  code text NOT NULL,
  display_name text NOT NULL,
  location text NULL,
  device_type text NOT NULL DEFAULT 'printer',
  production_account_id uuid NULL REFERENCES public.omni_comms_provider_account(id),
  paper_sizes text[] NOT NULL DEFAULT ARRAY['A4']::text[],
  duplex_capable boolean NOT NULL DEFAULT true,
  colour_capable boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_by uuid NULL,
  CONSTRAINT omni_comms_print_equipment_code_uq UNIQUE (organization_id, code),
  CONSTRAINT omni_comms_print_equipment_type_chk CHECK (
    device_type = ANY (ARRAY['printer','mfp','high_volume_printer','mail_inserter','outsourced_bureau'])),
  CONSTRAINT omni_comms_print_equipment_status_chk CHECK (
    status = ANY (ARRAY['active','maintenance','retired']))
);

-- No Data API access: Omni-Comms tables are reached only through bounded
-- SECURITY DEFINER RPCs, mirroring every other omni_comms_print_* table.
GRANT ALL ON public.omni_comms_print_equipment TO service_role;

CREATE INDEX IF NOT EXISTS omni_comms_print_equipment_org_idx
  ON public.omni_comms_print_equipment (organization_id, status, code);

ALTER TABLE public.omni_comms_print_attempt
  ADD COLUMN IF NOT EXISTS equipment_id uuid NULL
    REFERENCES public.omni_comms_print_equipment(id);

CREATE OR REPLACE FUNCTION public.omni_comms_priv_print_attempt_bind_equipment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $fn$
DECLARE
  v_eq public.omni_comms_print_equipment%ROWTYPE;
BEGIN
  IF coalesce(btrim(NEW.equipment_reference),'') = '' THEN
    NEW.equipment_reference := NULL;
    NEW.equipment_id := NULL;
    RETURN NEW;
  END IF;

  SELECT * INTO v_eq
  FROM public.omni_comms_print_equipment
  WHERE organization_id = NEW.organization_id
    AND code = upper(btrim(NEW.equipment_reference));

  IF v_eq.id IS NULL THEN
    RAISE EXCEPTION 'OC422 print_equipment_unknown'
      USING ERRCODE='P0001', DETAIL=btrim(NEW.equipment_reference);
  END IF;
  IF v_eq.status <> 'active' THEN
    RAISE EXCEPTION 'OC422 print_equipment_not_active'
      USING ERRCODE='P0001', DETAIL=v_eq.code || ':' || v_eq.status;
  END IF;

  NEW.equipment_reference := v_eq.code;
  NEW.equipment_id := v_eq.id;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS omni_comms_print_attempt_bind_equipment
  ON public.omni_comms_print_attempt;
CREATE TRIGGER omni_comms_print_attempt_bind_equipment
  BEFORE INSERT OR UPDATE OF equipment_reference ON public.omni_comms_print_attempt
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_print_attempt_bind_equipment();

CREATE OR REPLACE FUNCTION public.omni_comms_print_equipment_list(
  p_organization_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_include_inactive boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $fn$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('view');
  v_items jsonb;
BEGIN
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id,
           'code', e.code,
           'display_name', e.display_name,
           'location', e.location,
           'device_type', e.device_type,
           'status', e.status,
           'department_id', e.department_id,
           'production_account_id', e.production_account_id,
           'production_account_name', pa.display_name,
           'paper_sizes', to_jsonb(e.paper_sizes),
           'duplex_capable', e.duplex_capable,
           'colour_capable', e.colour_capable,
           'notes', e.notes,
           'updated_at', e.updated_at
         ) ORDER BY e.status, e.display_name), '[]'::jsonb)
    INTO v_items
  FROM public.omni_comms_print_equipment e
  LEFT JOIN public.omni_comms_provider_account pa ON pa.id = e.production_account_id
  WHERE e.organization_id = p_organization_id
    AND (p_department_id IS NULL OR e.department_id IS NULL OR e.department_id = p_department_id)
    AND (coalesce(p_include_inactive,false) OR e.status = 'active');

  RETURN jsonb_build_object(
    'items', v_items,
    'manage_permitted', public.has_permission(v_uid, 'omni_comms', 'configure'),
    'generated_at', now());
END;
$fn$;

CREATE OR REPLACE FUNCTION public.omni_comms_print_equipment_upsert(
  p_organization_id uuid,
  p_code text,
  p_display_name text,
  p_id uuid DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_device_type text DEFAULT 'printer',
  p_production_account_id uuid DEFAULT NULL,
  p_paper_sizes text[] DEFAULT NULL,
  p_duplex_capable boolean DEFAULT true,
  p_colour_capable boolean DEFAULT false,
  p_status text DEFAULT 'active',
  p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $fn$
DECLARE
  v_uid uuid := public.omni_comms_priv_require_capability('configure');
  v_row public.omni_comms_print_equipment%ROWTYPE;
  v_code text := upper(btrim(coalesce(p_code,'')));
BEGIN
  PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id);

  IF v_code = '' OR coalesce(btrim(p_display_name),'') = '' THEN
    RAISE EXCEPTION 'OC422 print_equipment_details_required'
      USING ERRCODE='P0001', DETAIL='code_and_name_required';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.omni_comms_print_equipment (
      organization_id, department_id, code, display_name, location, device_type,
      production_account_id, paper_sizes, duplex_capable, colour_capable, status,
      notes, created_by, updated_by)
    VALUES (
      p_organization_id, p_department_id, v_code, btrim(p_display_name),
      nullif(btrim(coalesce(p_location,'')),''), coalesce(p_device_type,'printer'),
      p_production_account_id, coalesce(p_paper_sizes, ARRAY['A4']::text[]),
      coalesce(p_duplex_capable,true), coalesce(p_colour_capable,false),
      coalesce(p_status,'active'), nullif(btrim(coalesce(p_notes,'')),''), v_uid, v_uid)
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.omni_comms_print_equipment
       SET code = v_code,
           display_name = btrim(p_display_name),
           department_id = p_department_id,
           location = nullif(btrim(coalesce(p_location,'')),''),
           device_type = coalesce(p_device_type, device_type),
           production_account_id = p_production_account_id,
           paper_sizes = coalesce(p_paper_sizes, paper_sizes),
           duplex_capable = coalesce(p_duplex_capable, duplex_capable),
           colour_capable = coalesce(p_colour_capable, colour_capable),
           status = coalesce(p_status, status),
           notes = nullif(btrim(coalesce(p_notes,'')),''),
           updated_at = now(),
           updated_by = v_uid
     WHERE id = p_id AND organization_id = p_organization_id
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'OC404 print_equipment_not_found' USING ERRCODE='P0001', DETAIL='print_equipment_not_found';
    END IF;
  END IF;

  INSERT INTO public.audit_logs (user_id, action_type, module_name, entity_type, entity_id,
                                 old_value, new_value, metadata)
  VALUES (v_uid, CASE WHEN p_id IS NULL THEN 'omni_comms.print_equipment.created'
                      ELSE 'omni_comms.print_equipment.updated' END,
          'omni_comms', 'omni_comms_print_equipment', v_row.id::text, NULL, v_row.code,
          jsonb_strip_nulls(jsonb_build_object(
            'display_name', v_row.display_name,
            'status', v_row.status,
            'device_type', v_row.device_type,
            'location', v_row.location)));

  RETURN jsonb_build_object(
    'id', v_row.id, 'code', v_row.code, 'display_name', v_row.display_name,
    'status', v_row.status, 'updated_at', v_row.updated_at);
END;
$fn$;

-- Existing free-text references are preserved as registered devices so no
-- historical attempt becomes unexplainable.
INSERT INTO public.omni_comms_print_equipment (organization_id, code, display_name, notes)
SELECT DISTINCT a.organization_id, upper(btrim(a.equipment_reference)),
       upper(btrim(a.equipment_reference)), 'Imported from historical print attempts.'
FROM public.omni_comms_print_attempt a
WHERE coalesce(btrim(a.equipment_reference),'') <> ''
ON CONFLICT (organization_id, code) DO NOTHING;

-- Every organisation that already produces letters gets a default device so
-- the operator dropdown is never empty.
INSERT INTO public.omni_comms_print_equipment (
  organization_id, code, display_name, location, device_type, notes)
SELECT DISTINCT i.organization_id, 'HQ-PRN-01', 'Head office letter printer',
       'Head office print room', 'printer',
       'Default device created with the print equipment registry.'
FROM public.omni_comms_print_item i
ON CONFLICT (organization_id, code) DO NOTHING;

UPDATE public.omni_comms_print_attempt a
   SET equipment_id = e.id, equipment_reference = e.code
  FROM public.omni_comms_print_equipment e
 WHERE e.organization_id = a.organization_id
   AND e.code = upper(btrim(coalesce(a.equipment_reference,'')))
   AND a.equipment_id IS NULL;

CREATE OR REPLACE FUNCTION public.omni_comms_print_item_action(p_id uuid, p_action text, p_expected_version integer, p_reason text DEFAULT NULL::text, p_production_account_id uuid DEFAULT NULL::uuid, p_equipment_reference text DEFAULT NULL::text, p_page_count integer DEFAULT NULL::integer, p_correlation_id text DEFAULT NULL::text, p_dispatch jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
             equipment_reference = coalesce(
               nullif(btrim(coalesce(p_equipment_reference,'')),''), equipment_reference),
             failure_reason = CASE WHEN p_action = 'confirm_printed' THEN NULL ELSE p_reason END,
             page_count = coalesce(p_page_count, v_item.page_count)
       WHERE id = v_attempt.id;
    ELSE
      -- No open attempt (e.g. the operator printed straight from the queue):
      -- physical evidence must still exist, so record a closed attempt.
      v_account := coalesce(p_production_account_id, v_item.production_account_id);
      INSERT INTO public.omni_comms_print_attempt (
        print_item_id, organization_id, attempt_number, production_provider_id,
        production_account_id, operator_id, equipment_reference, correlation_id,
        idempotency_key, outcome, completed_at, failure_reason, page_count)
      SELECT v_item.id, v_item.organization_id, v_item.attempt_count + 1,
             (SELECT provider_id FROM public.omni_comms_provider_account WHERE id = v_account),
             v_account, v_uid,
             nullif(btrim(coalesce(p_equipment_reference,'')),''), p_correlation_id,
             coalesce(p_correlation_id, v_item.id::text || ':' || (v_item.attempt_count + 1)::text),
             CASE p_action WHEN 'confirm_printed' THEN 'printed'
                           WHEN 'mark_failed' THEN 'failed' ELSE 'spoiled' END,
             now(),
             CASE WHEN p_action = 'confirm_printed' THEN NULL ELSE p_reason END,
             coalesce(p_page_count, v_item.page_count);
      UPDATE public.omni_comms_print_item
         SET attempt_count = attempt_count + 1,
             production_account_id = coalesce(v_account, production_account_id)
       WHERE id = v_item.id
      RETURNING * INTO v_item;
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