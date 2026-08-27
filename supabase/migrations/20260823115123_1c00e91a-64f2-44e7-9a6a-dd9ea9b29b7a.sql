-- 1. Principal waiver policy guard -------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ce_waiver_principal_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_type text := upper(coalesce(NEW.waiver_type, ''));
  v_allowed boolean;
BEGIN
  IF v_type = 'PRINCIPAL' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.ce_waiver_rules r
      WHERE r.enabled = true AND upper(r.waiver_type) = 'PRINCIPAL'
    ) INTO v_allowed;

    IF NOT v_allowed THEN
      RAISE EXCEPTION 'PRINCIPAL_WAIVER_NOT_PERMITTED: principal (contribution) waivers require an enabled PRINCIPAL waiver rule in Compliance > Waiver Rules'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.waiver_rule_id IS NULL THEN
      RAISE EXCEPTION 'PRINCIPAL_WAIVER_REQUIRES_RULE: a principal waiver must cite an enabled PRINCIPAL waiver rule'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ce_waiver_principal_guard ON public.ce_waivers;
CREATE TRIGGER trg_ce_waiver_principal_guard
BEFORE INSERT OR UPDATE OF waiver_type ON public.ce_waivers
FOR EACH ROW EXECUTE FUNCTION public.fn_ce_waiver_principal_guard();

-- 2. Case merge application ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_apply_case_merge(p_request_id uuid, p_actor text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_req record;
  v_src record;
  v_tgt record;
  v_violations int := 0;
  v_links int := 0;
  v_notices int := 0;
  v_actions int := 0;
BEGIN
  SELECT * INTO v_req FROM public.ce_case_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req IS NULL THEN RAISE EXCEPTION 'MERGE_REQUEST_NOT_FOUND'; END IF;
  IF v_req.request_type <> 'MERGE' THEN RAISE EXCEPTION 'NOT_A_MERGE_REQUEST'; END IF;
  IF v_req.target_case_id IS NULL THEN RAISE EXCEPTION 'MERGE_TARGET_MISSING'; END IF;
  IF v_req.case_id = v_req.target_case_id THEN RAISE EXCEPTION 'SELF_MERGE_BLOCKED'; END IF;

  SELECT * INTO v_src FROM public.ce_cases WHERE id = v_req.case_id FOR UPDATE;
  SELECT * INTO v_tgt FROM public.ce_cases WHERE id = v_req.target_case_id FOR UPDATE;
  IF v_src IS NULL OR v_tgt IS NULL THEN RAISE EXCEPTION 'CASE_NOT_FOUND'; END IF;
  IF coalesce(v_tgt.is_merged, false) THEN RAISE EXCEPTION 'TARGET_ALREADY_MERGED'; END IF;
  IF upper(coalesce(v_tgt.status,'')) IN ('RESOLVED','CLOSED','COMPLETED','CANCELLED') THEN
    RAISE EXCEPTION 'TARGET_CASE_CLOSED';
  END IF;
  IF coalesce(v_src.is_merged, false) THEN RAISE EXCEPTION 'SOURCE_ALREADY_MERGED'; END IF;

  -- remove link rows that would duplicate on the target, then move the rest
  DELETE FROM public.ce_case_violations scv
  WHERE scv.case_id = v_req.case_id
    AND EXISTS (
      SELECT 1 FROM public.ce_case_violations t
      WHERE t.case_id = v_req.target_case_id AND t.violation_id = scv.violation_id
    );

  UPDATE public.ce_case_violations SET case_id = v_req.target_case_id
  WHERE case_id = v_req.case_id;
  GET DIAGNOSTICS v_links = ROW_COUNT;

  UPDATE public.ce_violations SET case_id = v_req.target_case_id
  WHERE case_id = v_req.case_id;
  GET DIAGNOSTICS v_violations = ROW_COUNT;

  UPDATE public.ce_notices SET case_id = v_req.target_case_id
  WHERE case_id = v_req.case_id;
  GET DIAGNOSTICS v_notices = ROW_COUNT;

  UPDATE public.ce_case_actions SET case_id = v_req.target_case_id
  WHERE case_id = v_req.case_id;
  GET DIAGNOSTICS v_actions = ROW_COUNT;

  -- roll financial totals forward onto the surviving case
  UPDATE public.ce_cases c
  SET total_amount = coalesce((
        SELECT sum(coalesce(v.total_amount, 0)) FROM public.ce_violations v WHERE v.case_id = c.id
      ), 0),
      amount_waived = coalesce(v_tgt.amount_waived, 0) + coalesce(v_src.amount_waived, 0),
      updated_at = now()
  WHERE c.id = v_req.target_case_id;

  UPDATE public.ce_cases c
  SET is_merged = true,
      merged_into_case_id = v_req.target_case_id,
      total_amount = 0,
      amount_waived = 0,
      closed_date = current_date,
      closure_reason = 'Merged into ' || v_tgt.case_number || ': ' || coalesce(v_req.reason, ''),
      updated_at = now()
  WHERE c.id = v_req.case_id;

  INSERT INTO public.ce_case_merge_history (
    source_case_id, source_case_number, target_case_id, target_case_number,
    employer_id, violations_moved, notices_moved, actions_moved,
    merge_reason, merge_strategy, merged_by, merged_at, rollback_available
  ) VALUES (
    v_src.id, v_src.case_number, v_tgt.id, v_tgt.case_number,
    v_src.employer_id, greatest(v_violations, v_links), v_notices, v_actions,
    v_req.reason, 'REQUEST_APPROVAL', coalesce(p_actor, v_req.reviewed_by, 'SYSTEM'), now(), false
  );

  RETURN jsonb_build_object(
    'source_case_number', v_src.case_number,
    'target_case_number', v_tgt.case_number,
    'violations_moved', greatest(v_violations, v_links),
    'notices_moved', v_notices,
    'actions_moved', v_actions
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ce_apply_case_merge(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_apply_case_merge(uuid, text) TO service_role;