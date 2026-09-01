CREATE OR REPLACE FUNCTION public.ia_can_access_engagement_internal(_engagement_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN public.ia_can_read_all() THEN true
    WHEN _engagement_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.ia_audit_engagements e
      WHERE e.id = _engagement_id
        AND public.ia_current_auditor_id() IS NOT NULL
        AND ( e.lead_auditor_id::text = public.ia_current_auditor_id()::text
           OR e.reviewer_id::text = public.ia_current_auditor_id()::text
           OR COALESCE(e.team_member_ids, '[]'::jsonb) ? public.ia_current_auditor_id()::text
           OR COALESCE(e.supportive_auditor_ids, '[]'::jsonb) ? public.ia_current_auditor_id()::text )
    )
    OR EXISTS (
      SELECT 1 FROM public.ia_quality_reviews q
      WHERE q.engagement_id = _engagement_id
        AND q.reviewer_id::text = public.ia_current_auditor_id()::text
    )
  END
$function$;

CREATE OR REPLACE FUNCTION public.ia_start_quality_review(p_engagement_id uuid, p_review_type text DEFAULT 'Engagement QA'::text, p_reviewer_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor text := public.ia_actor_label();
  v_id uuid; v_open int; v_eng record; v_reviewer uuid;
BEGIN
  IF NOT public.ia_cmd_guard_elevated('quality_review', 'create', p_engagement_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_FORBIDDEN', 'error', 'You do not have permission to start a quality review');
  END IF;

  SELECT * INTO v_eng FROM public.ia_audit_engagements WHERE id = p_engagement_id;
  IF v_eng IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_NOT_FOUND', 'error', 'Engagement not found');
  END IF;

  SELECT count(*) INTO v_open FROM public.ia_quality_reviews
   WHERE engagement_id = p_engagement_id AND status IN ('Draft','In Progress','Rework Required');
  IF v_open > 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_QA_IN_PROGRESS', 'error', 'A quality review is already in progress for this engagement');
  END IF;

  v_reviewer := COALESCE(p_reviewer_id, v_eng.reviewer_id, public.ia_current_auditor_id());

  IF v_reviewer IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_NO_REVIEWER',
      'error', 'Assign an independent quality reviewer to this audit before starting quality assurance');
  END IF;

  IF v_eng.lead_auditor_id IS NOT NULL AND v_reviewer = v_eng.lead_auditor_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'IA_SOD_VIOLATION',
      'error', 'The engagement lead auditor cannot be the quality reviewer for their own engagement');
  END IF;

  INSERT INTO public.ia_quality_reviews(engagement_id, reviewer_id, review_date, review_type, status, created_by, updated_by)
  VALUES (p_engagement_id, v_reviewer, now(), p_review_type, 'In Progress', v_actor, v_actor)
  RETURNING id INTO v_id;

  PERFORM public.ia_log_event('IA.QA.STARTED', 'quality_review', v_id, p_engagement_id, NULL, NULL,
    jsonb_build_object('review_type', p_review_type, 'reviewer_id', v_reviewer), NULL, NULL, 'ia_start_quality_review');

  RETURN jsonb_build_object('success', true, 'quality_review_id', v_id, 'reviewer_id', v_reviewer);
END;
$function$;

DROP FUNCTION IF EXISTS public.ia_start_quality_review(uuid, text);