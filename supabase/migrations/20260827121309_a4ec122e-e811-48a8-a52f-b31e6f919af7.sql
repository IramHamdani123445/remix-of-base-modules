CREATE OR REPLACE FUNCTION public.ia_complete_preparation(p_engagement_id uuid, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eng record; v_actor text := public.ia_actor_label();
  v_open int; v_notified boolean; v_reasons text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO v_eng FROM public.ia_audit_engagements WHERE id = p_engagement_id;
  IF v_eng IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Engagement not found'); END IF;
  IF NOT public.ia_cmd_guard('audit_engagements', 'edit', p_engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'You do not have permission to complete preparation for this engagement');
  END IF;

  SELECT count(*) INTO v_open FROM public.ia_preparation_checklists c
   WHERE c.engagement_id = p_engagement_id AND COALESCE(c.is_completed, false) = false;
  IF v_open > 0 THEN
    v_reasons := v_reasons || ARRAY[v_open || ' preparation checklist item(s) still open'];
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.ia_communication_stages cs
                  WHERE cs.engagement_id = p_engagement_id
                    AND cs.stage_code IN ('ENGAGEMENT_NOTIFICATION','AUDIT_NOTIFICATION')
                    AND cs.delivery_status IN ('Sent','Delivered','Acknowledged'))
    INTO v_notified;
  IF NOT v_notified THEN
    v_reasons := v_reasons || ARRAY['Engagement notification must be issued to the auditee before preparation is complete'];
  END IF;

  IF array_length(v_reasons, 1) IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_PREP_INCOMPLETE', 'error', array_to_string(v_reasons, '; '), 'reasons', to_jsonb(v_reasons));
  END IF;

  UPDATE public.ia_audit_engagements
     SET preparation_status = 'Complete',
         preparation_completed_at = now(),
         preparation_completed_by = v_actor,
         preparation_notes = COALESCE(p_notes, preparation_notes),
         updated_at = now(), updated_by = v_actor
   WHERE id = p_engagement_id;

  PERFORM public.ia_log_event('IA.PREPARATION.COMPLETED', 'engagement', p_engagement_id, p_engagement_id,
    v_eng.annual_plan_id, jsonb_build_object('preparation_status', v_eng.preparation_status),
    jsonb_build_object('preparation_status', 'Complete'), p_notes, NULL, 'ia_complete_preparation');

  RETURN jsonb_build_object('success', true, 'engagement_id', p_engagement_id, 'preparation_status', 'Complete');
END;
$$;

CREATE OR REPLACE FUNCTION public.ia_evaluate_engagement_closure_v2(p_engagement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_reasons text[] := ARRAY[]::text[];
  v_n int;
BEGIN
  IF NOT public.ia_can_access_engagement(p_engagement_id) THEN
    RETURN jsonb_build_object('can_close', false, 'reasons', to_jsonb(ARRAY['You do not have access to this engagement']));
  END IF;

  SELECT count(*) INTO v_n FROM public.ia_audit_reports
   WHERE engagement_id = p_engagement_id AND issued_at IS NOT NULL;
  IF v_n = 0 THEN v_reasons := v_reasons || ARRAY['A final audit report must be issued']; END IF;

  SELECT count(*) INTO v_n FROM public.ia_quality_reviews
   WHERE engagement_id = p_engagement_id AND status = 'Cleared';
  IF v_n = 0 THEN v_reasons := v_reasons || ARRAY['Quality assurance must be cleared']; END IF;

  SELECT count(*) INTO v_n FROM public.ia_findings
   WHERE engagement_id = p_engagement_id AND lifecycle_status NOT IN ('Responded','Closed','Withdrawn');
  IF v_n > 0 THEN v_reasons := v_reasons || ARRAY[v_n || ' finding(s) are not yet responded to, closed or withdrawn']; END IF;

  SELECT count(*) INTO v_n FROM public.ia_action_tracking
   WHERE engagement_id = p_engagement_id
     AND COALESCE(status, action_status) <> 'Closed'
     AND (COALESCE(trim(responsible_person), '') = '' OR COALESCE(current_target_date, target_date) IS NULL);
  IF v_n > 0 THEN v_reasons := v_reasons || ARRAY[v_n || ' open action(s) are missing an owner or a target date']; END IF;

  SELECT count(*) INTO v_n FROM public.ia_activities
   WHERE engagement_id = p_engagement_id AND status NOT IN ('Completed','Cancelled');
  IF v_n > 0 THEN v_reasons := v_reasons || ARRAY[v_n || ' fieldwork activity(ies) are not complete']; END IF;

  RETURN jsonb_build_object(
    'can_close', array_length(v_reasons, 1) IS NULL,
    'reasons', to_jsonb(v_reasons),
    'checked_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ia_complete_preparation(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ia_evaluate_engagement_closure_v2(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_complete_preparation(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ia_evaluate_engagement_closure_v2(uuid) TO authenticated, service_role;