-- ============================================================
-- BN Uprating — Epic 1 read services
-- ============================================================

CREATE OR REPLACE FUNCTION public.bn_uprating_run_list_v1(
  p_actor_user_id uuid, p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_rows jsonb; v_total int; v_search text;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  v_search := NULLIF(btrim(COALESCE(p_filters->>'search','')),'');
  SELECT count(*) INTO v_total FROM public.bn_uprating_run r
   WHERE (p_filters->>'status' IS NULL OR r.status = p_filters->>'status')
     AND (p_filters->>'policy_id' IS NULL OR r.policy_id = (p_filters->>'policy_id')::uuid)
     AND (v_search IS NULL OR r.run_reference ILIKE '%'||v_search||'%' OR COALESCE(r.run_name,'') ILIKE '%'||v_search||'%');
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'created_at' DESC),'[]'::jsonb) INTO v_rows FROM (
    SELECT to_jsonb(t) AS x FROM (
      SELECT r.run_id, r.run_reference, r.run_name, r.status,
             public._bn_uprating_ref_label('RUN_STATUS', r.status) AS status_label,
             r.country_code, r.target_effective_date, r.policy_id, p.policy_code, p.policy_name,
             r.policy_version_id, pv.version_reference, r.frozen_policy_type, r.frozen_rounding_mode,
             r.simulation_state, r.current_snapshot_version, r.current_simulation_version,
             r.row_version, r.created_by_name, r.created_at, r.updated_at,
             s.total_items, s.eligible_items, s.excluded_items, s.exception_items, s.blocking_exception_items,
             sim.delta_total_minor, sim.proposed_total_minor, sim.current_total_minor
        FROM public.bn_uprating_run r
        JOIN public.bn_uprating_policy p ON p.policy_id = r.policy_id
        JOIN public.bn_uprating_policy_version pv ON pv.policy_version_id = r.policy_version_id
        LEFT JOIN public.bn_uprating_run_snapshot s ON s.snapshot_id = r.current_snapshot_id
        LEFT JOIN public.bn_uprating_simulation sim ON sim.simulation_id = r.current_simulation_id
       WHERE (p_filters->>'status' IS NULL OR r.status = p_filters->>'status')
         AND (p_filters->>'policy_id' IS NULL OR r.policy_id = (p_filters->>'policy_id')::uuid)
         AND (v_search IS NULL OR r.run_reference ILIKE '%'||v_search||'%' OR COALESCE(r.run_name,'') ILIKE '%'||v_search||'%')
       ORDER BY r.created_at DESC
       LIMIT GREATEST(COALESCE(p_limit,25),1) OFFSET GREATEST(COALESCE(p_offset,0),0)
    ) t) q;
  RETURN jsonb_build_object('status','OK','data', jsonb_build_object('rows', v_rows,'total', v_total));
END; $fn$;

CREATE OR REPLACE FUNCTION public.bn_uprating_run_detail_v1(p_actor_user_id uuid, p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_run jsonb; v_snap jsonb; v_sim jsonb; v_events jsonb; v_hist jsonb;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  SELECT to_jsonb(t) INTO v_run FROM (
    SELECT r.*, p.policy_code, p.policy_name, p.policy_type AS policy_catalogue_type,
           pv.version_reference, pv.version_no, pv.effective_from AS policy_effective_from,
           pv.effective_to AS policy_effective_to, pv.status AS policy_version_status,
           pr.benefit_code AS scope_product_code, pr.benefit_name AS scope_product_name,
           public._bn_uprating_ref_label('RUN_STATUS', r.status) AS status_label
      FROM public.bn_uprating_run r
      JOIN public.bn_uprating_policy p ON p.policy_id = r.policy_id
      JOIN public.bn_uprating_policy_version pv ON pv.policy_version_id = r.policy_version_id
      LEFT JOIN public.bn_product pr ON pr.id = r.scope_product_id
     WHERE r.run_id = p_run_id) t;
  IF v_run IS NULL THEN
    RETURN jsonb_build_object('status','ERROR','code','E_NOT_FOUND','message','That uprating run could not be found.','data',NULL);
  END IF;
  SELECT to_jsonb(s) INTO v_snap FROM public.bn_uprating_run_snapshot s
   WHERE s.snapshot_id = (v_run->>'current_snapshot_id')::uuid;
  SELECT to_jsonb(x) INTO v_sim FROM public.bn_uprating_simulation x
   WHERE x.simulation_id = (v_run->>'current_simulation_id')::uuid;
  SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.occurred_at DESC),'[]'::jsonb) INTO v_events
    FROM public.bn_uprating_run_event e WHERE e.run_id = p_run_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('simulation_id', h.simulation_id,
      'simulation_version', h.simulation_version,'status', h.status,'simulated_at', h.simulated_at,
      'simulated_by_name', h.simulated_by_name,'delta_total_minor', h.delta_total_minor,
      'input_fingerprint', h.input_fingerprint) ORDER BY h.simulation_version DESC),'[]'::jsonb)
    INTO v_hist FROM public.bn_uprating_simulation h WHERE h.run_id = p_run_id;
  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'run', v_run,'snapshot', v_snap,'simulation', v_sim,
    'simulation_history', v_hist,'events', v_events));
END; $fn$;

CREATE OR REPLACE FUNCTION public.bn_uprating_run_population_v1(
  p_actor_user_id uuid, p_run_id uuid, p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_snap uuid; v_rows jsonb; v_total int; v_search text;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  SELECT COALESCE(NULLIF(p_filters->>'snapshot_id','')::uuid, current_snapshot_id)
    INTO v_snap FROM public.bn_uprating_run WHERE run_id = p_run_id;
  IF v_snap IS NULL THEN
    RETURN jsonb_build_object('status','OK','data', jsonb_build_object('rows','[]'::jsonb,'total',0,'snapshot_id',NULL));
  END IF;
  v_search := NULLIF(btrim(COALESCE(p_filters->>'search','')),'');
  SELECT count(*) INTO v_total FROM public.bn_uprating_run_snapshot_item i
   WHERE i.snapshot_id = v_snap
     AND (p_filters->>'eligibility_status' IS NULL OR i.eligibility_status = p_filters->>'eligibility_status')
     AND (p_filters->>'exception_status' IS NULL OR i.exception_status = p_filters->>'exception_status')
     AND (v_search IS NULL OR i.award_reference ILIKE '%'||v_search||'%');
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.award_reference),'[]'::jsonb) INTO v_rows FROM (
    SELECT i.snapshot_item_id, i.award_reference, i.person_reference, i.product_code, i.product_name,
           i.product_version_id, i.award_type_code, i.award_component_code, i.award_status,
           i.base_amount_minor, i.currency_code, i.payment_frequency, i.award_start_date, i.award_end_date,
           i.source_row_version, i.eligibility_status, i.exclusion_reason_code,
           public._bn_uprating_ref_label('EXCLUSION_REASON', i.exclusion_reason_code) AS exclusion_reason_label,
           i.exception_status, i.inclusion_explanation
      FROM public.bn_uprating_run_snapshot_item i
     WHERE i.snapshot_id = v_snap
       AND (p_filters->>'eligibility_status' IS NULL OR i.eligibility_status = p_filters->>'eligibility_status')
       AND (p_filters->>'exception_status' IS NULL OR i.exception_status = p_filters->>'exception_status')
       AND (v_search IS NULL OR i.award_reference ILIKE '%'||v_search||'%')
     ORDER BY i.award_reference
     LIMIT GREATEST(COALESCE(p_limit,50),1) OFFSET GREATEST(COALESCE(p_offset,0),0)) t;
  RETURN jsonb_build_object('status','OK','data', jsonb_build_object('rows', v_rows,'total', v_total,'snapshot_id', v_snap));
END; $fn$;

CREATE OR REPLACE FUNCTION public.bn_uprating_run_exceptions_v1(
  p_actor_user_id uuid, p_run_id uuid, p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_snap uuid; v_rows jsonb; v_total int; v_open int; v_block int;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  SELECT current_snapshot_id INTO v_snap FROM public.bn_uprating_run WHERE run_id = p_run_id;
  IF v_snap IS NULL THEN
    RETURN jsonb_build_object('status','OK','data', jsonb_build_object('rows','[]'::jsonb,'total',0,'open',0,'blocking',0));
  END IF;
  SELECT count(*), count(*) FILTER (WHERE resolution_status='OPEN'),
         count(*) FILTER (WHERE resolution_status='OPEN' AND is_blocking)
    INTO v_total, v_open, v_block
    FROM public.bn_uprating_run_exception WHERE snapshot_id = v_snap
      AND (p_filters->>'resolution_status' IS NULL OR resolution_status = p_filters->>'resolution_status')
      AND (p_filters->>'exception_code' IS NULL OR exception_code = p_filters->>'exception_code');
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.is_blocking DESC, t.award_reference),'[]'::jsonb) INTO v_rows FROM (
    SELECT e.exception_id, e.award_reference, e.snapshot_item_id, e.exception_code,
           public._bn_uprating_ref_label('EXCEPTION_CODE', e.exception_code) AS exception_label,
           e.severity, e.is_blocking, e.owning_domain, e.business_explanation, e.detected_at,
           e.resolution_status, e.resolution_code, e.resolution_label, e.justification,
           e.resolved_by_name, e.resolved_at, e.row_version,
           to_jsonb(ep.allowed_resolutions) AS allowed_resolutions,
           ep.requires_source_correction,
           (SELECT COALESCE(jsonb_agg(jsonb_build_object('sequence_no', h.sequence_no,
               'action_code', h.action_code,'resolution_code', h.resolution_code,
               'justification', h.justification,'actor_name', h.actor_name,'occurred_at', h.occurred_at)
             ORDER BY h.sequence_no),'[]'::jsonb)
              FROM public.bn_uprating_run_exception_history h WHERE h.exception_id = e.exception_id) AS history
      FROM public.bn_uprating_run_exception e
      JOIN public.bn_uprating_exception_policy ep ON ep.exception_code = e.exception_code
     WHERE e.snapshot_id = v_snap
       AND (p_filters->>'resolution_status' IS NULL OR e.resolution_status = p_filters->>'resolution_status')
       AND (p_filters->>'exception_code' IS NULL OR e.exception_code = p_filters->>'exception_code')
     ORDER BY e.is_blocking DESC, e.award_reference
     LIMIT GREATEST(COALESCE(p_limit,50),1) OFFSET GREATEST(COALESCE(p_offset,0),0)) t;
  RETURN jsonb_build_object('status','OK','data',
    jsonb_build_object('rows', v_rows,'total', v_total,'open', v_open,'blocking', v_block,'snapshot_id', v_snap));
END; $fn$;

CREATE OR REPLACE FUNCTION public.bn_uprating_simulation_result_v1(
  p_actor_user_id uuid, p_run_id uuid, p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_sim uuid; v_hdr jsonb; v_rows jsonb; v_total int; v_state text;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  SELECT COALESCE(NULLIF(p_filters->>'simulation_id','')::uuid, current_simulation_id), simulation_state
    INTO v_sim, v_state FROM public.bn_uprating_run WHERE run_id = p_run_id;
  IF v_sim IS NULL THEN
    RETURN jsonb_build_object('status','OK','data',
      jsonb_build_object('simulation',NULL,'rows','[]'::jsonb,'total',0,'simulation_state', COALESCE(v_state,'NONE')));
  END IF;
  SELECT to_jsonb(s) INTO v_hdr FROM public.bn_uprating_simulation s WHERE s.simulation_id = v_sim;
  SELECT count(*) INTO v_total FROM public.bn_uprating_simulation_item WHERE simulation_id = v_sim
    AND (p_filters->>'calculation_status' IS NULL OR calculation_status = p_filters->>'calculation_status');
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.award_reference),'[]'::jsonb) INTO v_rows FROM (
    SELECT si.simulation_item_id, si.award_reference, si.award_component_code, si.base_amount_minor,
           si.policy_method, si.unrounded_amount_minor, si.rounding_mode, si.proposed_amount_minor,
           si.delta_amount_minor, si.applied_percentage_bp, si.applied_fixed_amount_minor,
           si.applied_factor, si.matched_tier_sequence, si.calculation_status, si.exception_status,
           si.calculation_trace, si.input_fingerprint
      FROM public.bn_uprating_simulation_item si
     WHERE si.simulation_id = v_sim
       AND (p_filters->>'calculation_status' IS NULL OR si.calculation_status = p_filters->>'calculation_status')
     ORDER BY si.award_reference
     LIMIT GREATEST(COALESCE(p_limit,50),1) OFFSET GREATEST(COALESCE(p_offset,0),0)) t;
  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'simulation', v_hdr,'rows', v_rows,'total', v_total,'simulation_state', COALESCE(v_state,'NONE')));
END; $fn$;

CREATE OR REPLACE FUNCTION public.bn_uprating_run_actions_v1(p_actor_user_id uuid, p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE r public.bn_uprating_run%ROWTYPE; v_write boolean; v_decide boolean;
  v_block int := 0; v_actions jsonb := '[]'::jsonb;
BEGIN
  PERFORM public._bn_uprating_require(p_actor_user_id,'read',false);
  SELECT * INTO r FROM public.bn_uprating_run WHERE run_id = p_run_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','ERROR','code','E_NOT_FOUND','message','That uprating run could not be found.','data',NULL);
  END IF;
  v_write  := COALESCE((public.bn_uprating_check_actor_permission(p_actor_user_id,'write',true)->>'ok')::boolean,false);
  v_decide := COALESCE((public.bn_uprating_check_actor_permission(p_actor_user_id,'decide',true)->>'ok')::boolean,false);
  IF r.current_snapshot_id IS NOT NULL THEN
    SELECT count(*) INTO v_block FROM public.bn_uprating_run_exception
     WHERE snapshot_id = r.current_snapshot_id AND resolution_status='OPEN' AND is_blocking;
  END IF;

  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_UPDATE_RUN','label','Edit run',
    'available', v_write AND r.status='DRAFT',
    'reason', CASE WHEN NOT v_write THEN 'You do not have permission to edit runs.'
                   WHEN r.status<>'DRAFT' THEN 'Only a draft run can be edited.' ELSE NULL END);
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_PARAMETERISE_RUN','label','Lock parameters',
    'available', v_write AND r.status='DRAFT',
    'reason', CASE WHEN NOT v_write THEN 'You do not have permission to lock run parameters.'
                   WHEN r.status<>'DRAFT' THEN 'Parameters are already locked.' ELSE NULL END);
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_BUILD_POPULATION',
    'label', CASE WHEN r.current_snapshot_id IS NULL THEN 'Build population' ELSE 'Rebuild population' END,
    'available', v_decide AND r.status IN ('PARAMETERISED','ELIGIBILITY_SNAPSHOT','EXCLUSIONS_APPLIED','DRY_RUN'),
    'reason', CASE WHEN NOT v_decide THEN 'You do not have permission to build the population.'
                   WHEN r.status='DRAFT' THEN 'Lock the run parameters first.' ELSE NULL END);
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_RESOLVE_EXCEPTION','label','Resolve exceptions',
    'available', v_decide AND r.current_snapshot_id IS NOT NULL AND v_block > 0,
    'reason', CASE WHEN NOT v_decide THEN 'You do not have permission to resolve exceptions.'
                   WHEN r.current_snapshot_id IS NULL THEN 'Build the population first.'
                   WHEN v_block = 0 THEN 'There are no open blocking exceptions.' ELSE NULL END);
  v_actions := v_actions || jsonb_build_object('command','BN_UPRATING_SIMULATE','label','Run simulation',
    'available', v_decide AND r.current_snapshot_id IS NOT NULL AND v_block = 0
                 AND COALESCE(r.frozen_policy_type,'') NOT IN ('FORMULA_DRIVEN','MANUAL_IMPORT'),
    'reason', CASE WHEN NOT v_decide THEN 'You do not have permission to simulate.'
                   WHEN r.current_snapshot_id IS NULL THEN 'Build the population first.'
                   WHEN v_block > 0 THEN 'Resolve all blocking exceptions first.'
                   WHEN COALESCE(r.frozen_policy_type,'') IN ('FORMULA_DRIVEN','MANUAL_IMPORT')
                        THEN 'This policy method cannot be simulated automatically in this release.'
                   ELSE NULL END);

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'run_id', r.run_id,'status', r.status,'row_version', r.row_version,
    'simulation_state', r.simulation_state,'blocking_exceptions', v_block,'actions', v_actions));
END; $fn$;

DO $g$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'bn_uprating_run_list_v1(uuid,jsonb,integer,integer)',
    'bn_uprating_run_detail_v1(uuid,uuid)',
    'bn_uprating_run_population_v1(uuid,uuid,jsonb,integer,integer)',
    'bn_uprating_run_exceptions_v1(uuid,uuid,jsonb,integer,integer)',
    'bn_uprating_simulation_result_v1(uuid,uuid,jsonb,integer,integer)',
    'bn_uprating_run_actions_v1(uuid,uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM public', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $g$;
