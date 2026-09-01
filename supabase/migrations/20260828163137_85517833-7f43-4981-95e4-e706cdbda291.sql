-- DEF-S1B-19: corrective-action commands used a non-existent permission namespace
-- ia_actor_can('InternalAudit', 'create_audit_actions' / 'progress_audit_actions').
-- The canonical IA permission module is 'internal_audit' and every other action
-- command guards through ia_cmd_guard*('action_tracking', ...). As written, no
-- auditor -- not even the engagement lead auditor -- could raise or evidence a
-- corrective action. Align both commands with the governed engagement guard.

CREATE OR REPLACE FUNCTION public.ia_create_action_from_recommendation(
  p_recommendation_id uuid,
  p_responsible_person text DEFAULT NULL::text,
  p_target_date date DEFAULT NULL::date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rec  public.ia_recommendations%ROWTYPE;
  v_f    record;
  v_e    record;
  v_id   uuid;
  v_resp uuid;
BEGIN
  SELECT * INTO v_rec FROM public.ia_recommendations WHERE id = p_recommendation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Recommendation not found.');
  END IF;

  SELECT * INTO v_f FROM public.ia_findings WHERE id = v_rec.finding_id;
  IF v_f IS NULL OR v_f.engagement_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Recommendation is not linked to an engagement finding.');
  END IF;

  IF NOT public.ia_cmd_guard_elevated('action_tracking', 'edit', v_f.engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN',
      'error', 'You are not permitted to raise audit actions for this engagement.');
  END IF;

  SELECT * INTO v_e FROM public.ia_audit_engagements WHERE id = v_f.engagement_id;

  IF EXISTS (SELECT 1 FROM public.ia_action_tracking WHERE recommendation_id = p_recommendation_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'An action already exists for this recommendation.');
  END IF;

  SELECT id INTO v_resp FROM public.ia_management_responses
   WHERE finding_id = v_rec.finding_id ORDER BY created_at DESC LIMIT 1;

  INSERT INTO public.ia_action_tracking (
    finding_id, engagement_id, recommendation_id, response_id, action_description,
    annual_plan_id, department_id, function_id,
    responsible_person, target_date, original_target_date, current_target_date,
    status, action_status, lifecycle_status, created_by
  ) VALUES (
    v_rec.finding_id, v_f.engagement_id, p_recommendation_id, v_resp, v_rec.recommendation_text,
    COALESCE(v_f.annual_plan_id, v_e.annual_plan_id), COALESCE(v_f.department_id, v_e.department_id), v_e.function_id,
    COALESCE(NULLIF(p_responsible_person,''), v_rec.responsible_party),
    COALESCE(p_target_date, v_rec.official_target_date, v_rec.suggested_target_date),
    COALESCE(p_target_date, v_rec.official_target_date, v_rec.suggested_target_date),
    COALESCE(p_target_date, v_rec.official_target_date, v_rec.suggested_target_date),
    'Open', 'Open', 'Open', public.ia_actor_label()
  ) RETURNING id INTO v_id;

  UPDATE public.ia_recommendations
     SET status = COALESCE(NULLIF(status,''), 'Open'),
         updated_at = now(),
         updated_by = public.ia_actor_label()
   WHERE id = p_recommendation_id;

  PERFORM public.ia_log_event('IA.ACTION.RAISED', 'action', v_id, v_f.engagement_id,
    COALESCE(v_f.annual_plan_id, v_e.annual_plan_id), NULL,
    jsonb_build_object('recommendation_id', p_recommendation_id), NULL, NULL, 'ia_create_action_from_recommendation');

  RETURN jsonb_build_object('success', true, 'action_id', v_id, 'engagement_id', v_f.engagement_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ia_link_action_evidence(p_action_id uuid, p_evidence_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_eng uuid;
  v_bad int;
BEGIN
  SELECT engagement_id INTO v_eng FROM public.ia_action_tracking WHERE id = p_action_id;
  IF v_eng IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Action not found or not linked to an engagement.');
  END IF;

  IF NOT public.ia_cmd_guard('action_tracking', 'edit', v_eng) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN',
      'error', 'You are not permitted to update audit actions for this engagement.');
  END IF;

  SELECT count(*) INTO v_bad
  FROM unnest(COALESCE(p_evidence_ids, '{}'::uuid[])) x(eid)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.ia_evidence e WHERE e.id = x.eid AND e.engagement_id = v_eng
  );

  IF v_bad > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'One or more documents do not belong to this audit.');
  END IF;

  UPDATE public.ia_action_tracking
     SET evidence_ids = COALESCE(p_evidence_ids, '{}'::uuid[]),
         updated_at = now(),
         updated_by = public.ia_actor_label()
   WHERE id = p_action_id;

  RETURN jsonb_build_object('success', true, 'linked', COALESCE(array_length(p_evidence_ids,1),0));
END;
$function$;