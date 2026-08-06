ALTER TABLE public.bn_medical_review_schedule
  ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------
-- Governed legacy-schedule commands (RPC-only mutation boundary)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bn_medical_review_legacy_schedule_v1(
  p_schedule_id uuid,
  p_scheduled_date date,
  p_examining_provider text,
  p_expected_row_version integer,
  p_idempotency_key text,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('manage_appointment');
  v_payload jsonb := jsonb_build_object('schedule', p_schedule_id, 'date', p_scheduled_date,
                                        'provider', p_examining_provider);
  v_cached jsonb; v_before jsonb; v_after jsonb; v_row public.bn_medical_review_schedule;
BEGIN
  v_cached := public._bn_mr_cmd_begin('LEGACY_SCHEDULE', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_row FROM public.bn_medical_review_schedule WHERE id = p_schedule_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_RECORD_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF NOT public._bn_mr_can_access_award(v_actor, v_row.bn_award_id) THEN
    RAISE EXCEPTION 'E_RECORD_SCOPE_DENIED' USING ERRCODE='P0001';
  END IF;
  IF v_row.row_version IS DISTINCT FROM p_expected_row_version THEN
    RAISE EXCEPTION 'E_STALE_ROW_VERSION' USING ERRCODE='P0001';
  END IF;
  IF COALESCE(v_row.status,'') NOT IN ('PENDING','DUE','SCHEDULED') THEN
    RAISE EXCEPTION 'E_INVALID_TRANSITION' USING ERRCODE='P0001';
  END IF;
  IF p_scheduled_date IS NULL THEN
    RAISE EXCEPTION 'E_VALIDATION_FAILED' USING ERRCODE='P0001';
  END IF;

  v_before := to_jsonb(v_row) - 'remarks' - 'outcome';
  UPDATE public.bn_medical_review_schedule
     SET scheduled_date = p_scheduled_date,
         examining_provider = NULLIF(btrim(COALESCE(p_examining_provider,'')),''),
         status = 'SCHEDULED',
         modified_by = public._bn_susp_user_code(v_actor),
         row_version = v_row.row_version + 1
   WHERE id = p_schedule_id
   RETURNING * INTO v_row;
  v_after := to_jsonb(v_row) - 'remarks' - 'outcome';

  PERFORM public._bn_mr_audit('BN_MR_LEGACY_SCHEDULED', v_actor, p_schedule_id, 'SCHEDULE',
                              v_before, v_after, p_reason, NULL, 'USER_RPC');

  RETURN public._bn_mr_cmd_finish('LEGACY_SCHEDULE', p_idempotency_key, v_payload,
    jsonb_build_object('status','OK','schedule_id',p_schedule_id,'row_version',v_row.row_version), v_actor);
END $fn$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_legacy_record_outcome_v1(
  p_schedule_id uuid,
  p_outcome text,
  p_notes text,
  p_next_review_date date,
  p_expected_row_version integer,
  p_idempotency_key text,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('record_decision');
  v_payload jsonb := jsonb_build_object('schedule', p_schedule_id, 'outcome', p_outcome,
                                        'next_review', p_next_review_date);
  v_cached jsonb; v_before jsonb; v_after jsonb; v_row public.bn_medical_review_schedule;
  v_status text;
BEGIN
  v_cached := public._bn_mr_cmd_begin('LEGACY_RECORD_OUTCOME', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF COALESCE(p_outcome,'') NOT IN ('FIT','UNFIT','PARTIAL','REFER_BOARD','NO_SHOW') THEN
    RAISE EXCEPTION 'E_VALIDATION_FAILED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_row FROM public.bn_medical_review_schedule WHERE id = p_schedule_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_RECORD_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF NOT public._bn_mr_can_access_award(v_actor, v_row.bn_award_id) THEN
    RAISE EXCEPTION 'E_RECORD_SCOPE_DENIED' USING ERRCODE='P0001';
  END IF;
  IF v_row.row_version IS DISTINCT FROM p_expected_row_version THEN
    RAISE EXCEPTION 'E_STALE_ROW_VERSION' USING ERRCODE='P0001';
  END IF;
  IF COALESCE(v_row.status,'') NOT IN ('SCHEDULED','DUE') THEN
    RAISE EXCEPTION 'E_INVALID_TRANSITION' USING ERRCODE='P0001';
  END IF;

  v_status := CASE WHEN p_outcome = 'REFER_BOARD' THEN 'REFERRED_BOARD' ELSE 'COMPLETED' END;
  v_before := jsonb_build_object('status', v_row.status, 'row_version', v_row.row_version);

  UPDATE public.bn_medical_review_schedule
     SET outcome = p_outcome,
         remarks = p_notes,
         completed_date = CURRENT_DATE,
         next_review_date = p_next_review_date,
         status = v_status,
         modified_by = public._bn_susp_user_code(v_actor),
         row_version = v_row.row_version + 1
   WHERE id = p_schedule_id
   RETURNING * INTO v_row;
  v_after := jsonb_build_object('status', v_row.status, 'row_version', v_row.row_version,
                                'outcome', v_row.outcome);

  PERFORM public._bn_mr_audit('BN_MR_LEGACY_OUTCOME_RECORDED', v_actor, p_schedule_id, 'RECORD_OUTCOME',
                              v_before, v_after, p_reason, NULL, 'USER_RPC');

  RETURN public._bn_mr_cmd_finish('LEGACY_RECORD_OUTCOME', p_idempotency_key, v_payload,
    jsonb_build_object('status','OK','schedule_id',p_schedule_id,'row_version',v_row.row_version), v_actor);
END $fn$;

CREATE OR REPLACE FUNCTION public.bn_medical_review_legacy_provision_v1(
  p_award_id uuid,
  p_scheduled_date date,
  p_review_type text,
  p_idempotency_key text,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_actor uuid := public._bn_mr_cmd_actor('generate_obligation');
  v_payload jsonb := jsonb_build_object('award', p_award_id, 'date', p_scheduled_date,
                                        'type', p_review_type);
  v_cached jsonb; v_id uuid;
BEGIN
  v_cached := public._bn_mr_cmd_begin('LEGACY_PROVISION', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF p_award_id IS NULL OR p_scheduled_date IS NULL THEN
    RAISE EXCEPTION 'E_VALIDATION_FAILED' USING ERRCODE='P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bn_award WHERE id = p_award_id) THEN
    RAISE EXCEPTION 'E_RECORD_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  IF NOT public._bn_mr_can_access_award(v_actor, p_award_id) THEN
    RAISE EXCEPTION 'E_RECORD_SCOPE_DENIED' USING ERRCODE='P0001';
  END IF;

  INSERT INTO public.bn_medical_review_schedule
    (bn_award_id, scheduled_date, review_type, status, entered_by)
  VALUES
    (p_award_id, p_scheduled_date, COALESCE(NULLIF(btrim(COALESCE(p_review_type,'')),''),'PERIODIC'),
     'PENDING', public._bn_susp_user_code(v_actor))
  RETURNING id INTO v_id;

  PERFORM public._bn_mr_audit('BN_MR_LEGACY_PROVISIONED', v_actor, v_id, 'PROVISION',
                              NULL, jsonb_build_object('award', p_award_id, 'scheduled_date', p_scheduled_date),
                              p_reason, NULL, 'USER_RPC');

  RETURN public._bn_mr_cmd_finish('LEGACY_PROVISION', p_idempotency_key, v_payload,
    jsonb_build_object('status','OK','schedule_id',v_id), v_actor);
END $fn$;

-- ---------------------------------------------------------------
-- Close the direct write boundary
-- ---------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES
  ON public.bn_medical_review_schedule FROM authenticated;
REVOKE ALL ON public.bn_medical_review_schedule FROM anon, PUBLIC;
GRANT SELECT ON public.bn_medical_review_schedule TO authenticated;
GRANT ALL ON public.bn_medical_review_schedule TO service_role;

DROP POLICY IF EXISTS bn_medical_review_schedule_insert ON public.bn_medical_review_schedule;
DROP POLICY IF EXISTS bn_medical_review_schedule_update ON public.bn_medical_review_schedule;

REVOKE ALL ON FUNCTION public.bn_medical_review_legacy_schedule_v1(uuid,date,text,integer,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_medical_review_legacy_record_outcome_v1(uuid,text,text,date,integer,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bn_medical_review_legacy_provision_v1(uuid,date,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_medical_review_legacy_schedule_v1(uuid,date,text,integer,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bn_medical_review_legacy_record_outcome_v1(uuid,text,text,date,integer,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bn_medical_review_legacy_provision_v1(uuid,date,text,text,text) TO authenticated;