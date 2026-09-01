-- DEF-S1B-20: quality-assurance rework loop was unreachable.
-- ia_start_quality_review treated 'Rework Required' as an in-progress review, so once
-- a reviewer returned a report for rework no further quality review could ever be
-- started; the report could never be cleared, issued or the engagement closed.
-- A re-review may now be started after rework, but only once the report has actually
-- been revised (a newer report version exists after the rework was raised).

CREATE OR REPLACE FUNCTION public.ia_start_quality_review(
  p_engagement_id uuid,
  p_review_type text DEFAULT 'Engagement QA'::text,
  p_reviewer_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor text := public.ia_actor_label();
  v_id uuid; v_open int; v_eng record; v_reviewer uuid;
  v_rework record; v_revised int;
BEGIN
  IF NOT public.ia_cmd_guard_elevated('quality_review', 'create', p_engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'You do not have permission to start a quality review');
  END IF;

  SELECT * INTO v_eng FROM public.ia_audit_engagements WHERE id = p_engagement_id;
  IF v_eng IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Engagement not found');
  END IF;

  SELECT count(*) INTO v_open FROM public.ia_quality_reviews
   WHERE engagement_id = p_engagement_id AND status IN ('Draft','In Progress');
  IF v_open > 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_QA_IN_PROGRESS', 'error', 'A quality review is already in progress for this engagement');
  END IF;

  SELECT * INTO v_rework FROM public.ia_quality_reviews
   WHERE engagement_id = p_engagement_id AND status = 'Rework Required'
   ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 1;

  IF v_rework.id IS NOT NULL THEN
    SELECT count(*) INTO v_revised FROM public.ia_report_versions v
     WHERE v.engagement_id = p_engagement_id
       AND v.created_at > COALESCE(v_rework.updated_at, v_rework.created_at);
    IF v_revised = 0 THEN
      RETURN jsonb_build_object('success', false, 'code', 'IA_REWORK_OUTSTANDING',
        'error', 'Quality assurance returned the report for rework — issue a revised report version before requesting a re-review',
        'rework_notes', v_rework.rework_notes);
    END IF;
    UPDATE public.ia_quality_reviews SET status = 'Superseded', updated_at = now(), updated_by = v_actor
     WHERE id = v_rework.id;
  END IF;

  v_reviewer := COALESCE(p_reviewer_id, v_eng.reviewer_id, public.ia_current_auditor_id());

  IF v_eng.lead_auditor_id IS NOT NULL AND v_reviewer = v_eng.lead_auditor_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_SOD_VIOLATION',
      'error', 'The engagement lead auditor cannot be the quality reviewer for their own engagement');
  END IF;

  INSERT INTO public.ia_quality_reviews (engagement_id, reviewer_id, review_date, review_type, status, is_active, created_by)
  VALUES (p_engagement_id, v_reviewer, now(), p_review_type, 'In Progress', true, v_actor)
  RETURNING id INTO v_id;

  PERFORM public.ia_log_event('IA.QA.STARTED', 'quality_review', v_id, p_engagement_id, v_eng.annual_plan_id,
    NULL, jsonb_build_object('status', 'In Progress', 'reviewer_id', v_reviewer, 'review_type', p_review_type),
    NULL, NULL, 'ia_start_quality_review');

  RETURN jsonb_build_object('success', true, 'quality_review_id', v_id, 'reviewer_id', v_reviewer);
END;
$function$;