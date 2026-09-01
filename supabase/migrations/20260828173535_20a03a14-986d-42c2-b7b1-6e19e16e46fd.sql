CREATE OR REPLACE FUNCTION public.ia_action_submit_completion(p_action_id uuid, p_note text, p_evidence_ids uuid[] DEFAULT NULL::uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE v_a record; v_actor text := public.ia_actor_label(); v_ev uuid[]; v_new uuid[]; v_next text; v_bad int;
BEGIN
  SELECT * INTO v_a FROM public.ia_action_tracking WHERE id = p_action_id;
  IF v_a IS NULL THEN RETURN jsonb_build_object('success',false,'code','IA_NOT_FOUND','error','Action not found'); END IF;
  IF NOT public.ia_action_can_manage(p_action_id) THEN
    RETURN jsonb_build_object('success',false,'code','IA_FORBIDDEN','error','You are not the accountable owner of this action');
  END IF;
  IF v_a.lifecycle_status IN ('Closed','Cancelled','Verified','Verification Required') THEN
    RETURN jsonb_build_object('success',false,'code','IA_INVALID_STATE','error','This action cannot be submitted from status '||v_a.lifecycle_status);
  END IF;
  IF COALESCE(trim(p_note),'') = '' THEN
    RETURN jsonb_build_object('success',false,'code','IA_NOTE_REQUIRED','error','A completion note is required');
  END IF;

  -- DEF-S1B-26: null placeholders are not evidence, and every reference must be a
  -- real evidence record belonging to this engagement.
  SELECT array_agg(DISTINCT x) INTO v_new FROM unnest(COALESCE(p_evidence_ids,'{}'::uuid[])) x WHERE x IS NOT NULL;
  IF v_new IS NOT NULL THEN
    SELECT count(*) INTO v_bad FROM unnest(v_new) x
     WHERE NOT EXISTS (SELECT 1 FROM public.ia_evidence e
                        WHERE e.id = x
                          AND (v_a.engagement_id IS NULL OR e.engagement_id IS NOT DISTINCT FROM v_a.engagement_id));
    IF v_bad > 0 THEN
      RETURN jsonb_build_object('success',false,'code','IA_EVIDENCE_INVALID',
        'error','One or more evidence references do not exist for this engagement');
    END IF;
  END IF;

  SELECT array_agg(DISTINCT x) INTO v_ev
    FROM unnest(COALESCE(v_a.evidence_ids,'{}'::uuid[]) || COALESCE(v_new,'{}'::uuid[])) x
   WHERE x IS NOT NULL;

  IF v_ev IS NULL OR array_length(v_ev,1) IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','IA_EVIDENCE_REQUIRED','error','Implementation evidence must be attached before submitting completion');
  END IF;

  v_next := CASE WHEN v_a.requires_ia_verification THEN 'Verification Required' ELSE 'Verified' END;

  UPDATE public.ia_action_tracking
     SET lifecycle_status = v_next, status = v_next, action_status = v_next,
         progress_pct = 100, evidence_ids = v_ev,
         evidence_of_implementation = COALESCE(evidence_of_implementation, ARRAY[]::text[]) || ARRAY[p_note],
         management_completion_date = now(), management_completion_by = auth.uid(),
         verification_status = CASE WHEN v_a.requires_ia_verification THEN 'Pending' ELSE 'Not Required' END,
         latest_update = p_note, latest_update_at = now(), latest_update_by = v_actor,
         updated_at = now(), updated_by = v_actor
   WHERE id = p_action_id;

  PERFORM public.ia_log_event('IA.ACTION.COMPLETION_SUBMITTED','audit_action',p_action_id,v_a.engagement_id,NULL,
    jsonb_build_object('lifecycle_status', v_a.lifecycle_status),
    jsonb_build_object('lifecycle_status', v_next, 'evidence_count', array_length(v_ev,1)), v_actor);

  RETURN jsonb_build_object('success',true,'action_id',p_action_id,'lifecycle_status',v_next);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ia_link_action_evidence(p_action_id uuid, p_evidence_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE v_a record; v_actor text := public.ia_actor_label(); v_new uuid[]; v_ev uuid[]; v_bad int;
BEGIN
  SELECT * INTO v_a FROM public.ia_action_tracking WHERE id = p_action_id;
  IF v_a IS NULL THEN RETURN jsonb_build_object('success',false,'code','IA_NOT_FOUND','error','Action not found'); END IF;
  IF NOT (public.ia_action_can_manage(p_action_id) OR public.ia_cmd_guard('audit_actions','edit',v_a.engagement_id)) THEN
    RETURN jsonb_build_object('success',false,'code','IA_FORBIDDEN','error','You are not permitted to update audit actions for this engagement.');
  END IF;

  SELECT array_agg(DISTINCT x) INTO v_new FROM unnest(COALESCE(p_evidence_ids,'{}'::uuid[])) x WHERE x IS NOT NULL;
  IF v_new IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','IA_EVIDENCE_REQUIRED','error','At least one evidence record must be provided');
  END IF;
  SELECT count(*) INTO v_bad FROM unnest(v_new) x
   WHERE NOT EXISTS (SELECT 1 FROM public.ia_evidence e
                      WHERE e.id = x
                        AND (v_a.engagement_id IS NULL OR e.engagement_id IS NOT DISTINCT FROM v_a.engagement_id));
  IF v_bad > 0 THEN
    RETURN jsonb_build_object('success',false,'code','IA_EVIDENCE_INVALID',
      'error','One or more evidence references do not exist for this engagement');
  END IF;

  SELECT array_agg(DISTINCT x) INTO v_ev
    FROM unnest(COALESCE(v_a.evidence_ids,'{}'::uuid[]) || v_new) x WHERE x IS NOT NULL;

  UPDATE public.ia_action_tracking
     SET evidence_ids = v_ev, updated_at = now(), updated_by = v_actor
   WHERE id = p_action_id;

  PERFORM public.ia_log_event('IA.ACTION.EVIDENCE_LINKED','audit_action',p_action_id,v_a.engagement_id,NULL,
    jsonb_build_object('evidence_count', COALESCE(array_length(v_a.evidence_ids,1),0)),
    jsonb_build_object('evidence_count', array_length(v_ev,1)), v_actor);

  RETURN jsonb_build_object('success',true,'action_id',p_action_id,'evidence_count',array_length(v_ev,1));
END;
$function$;