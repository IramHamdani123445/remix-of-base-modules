
ALTER TABLE public.ia_action_tracking
  ADD COLUMN IF NOT EXISTS recommendation_id uuid REFERENCES public.ia_recommendations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS evidence_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

CREATE UNIQUE INDEX IF NOT EXISTS ia_action_tracking_recommendation_uq
  ON public.ia_action_tracking (recommendation_id)
  WHERE recommendation_id IS NOT NULL;

-- ---------------------------------------------------------------
-- Progress evaluation
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_engagement_progress(p_engagement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eng           public.ia_audit_engagements%ROWTYPE;
  v_activities    int := 0;
  v_act_done      int := 0;
  v_findings      int := 0;
  v_find_draft    int := 0;
  v_responses     int := 0;
  v_actions       int := 0;
  v_actions_done  int := 0;
  v_recs          int := 0;
  v_recs_no_act   int := 0;
  v_report_issued boolean := false;
  v_qr_signed     boolean := false;
  v_stages        jsonb;
  v_done          int := 0;
BEGIN
  SELECT * INTO v_eng FROM public.ia_audit_engagements WHERE id = p_engagement_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT count(*), count(*) FILTER (WHERE COALESCE(status,'') IN ('Completed','Closed','Cancelled'))
    INTO v_activities, v_act_done
  FROM public.ia_activities WHERE engagement_id = p_engagement_id;

  SELECT count(*), count(*) FILTER (WHERE COALESCE(status,'Draft') IN ('Draft','In Review'))
    INTO v_findings, v_find_draft
  FROM public.ia_findings WHERE engagement_id = p_engagement_id;

  SELECT count(DISTINCT r.finding_id) INTO v_responses
  FROM public.ia_management_responses r
  JOIN public.ia_findings f ON f.id = r.finding_id
  WHERE f.engagement_id = p_engagement_id;

  SELECT count(*), count(*) FILTER (WHERE COALESCE(status,'') IN ('Completed','Verified','Closed'))
    INTO v_actions, v_actions_done
  FROM public.ia_action_tracking WHERE engagement_id = p_engagement_id;

  SELECT count(*) INTO v_recs
  FROM public.ia_recommendations rc
  JOIN public.ia_findings f ON f.id = rc.finding_id
  WHERE f.engagement_id = p_engagement_id;

  SELECT count(*) INTO v_recs_no_act
  FROM public.ia_recommendations rc
  JOIN public.ia_findings f ON f.id = rc.finding_id
  WHERE f.engagement_id = p_engagement_id
    AND NOT EXISTS (
      SELECT 1 FROM public.ia_action_tracking a WHERE a.recommendation_id = rc.id
    );

  SELECT EXISTS (
    SELECT 1 FROM public.ia_audit_reports
    WHERE engagement_id = p_engagement_id
      AND COALESCE(status,'') IN ('Issued','Final','Final Issued','Published')
  ) INTO v_report_issued;

  SELECT EXISTS (
    SELECT 1 FROM public.ia_quality_reviews
    WHERE engagement_id = p_engagement_id
      AND COALESCE(status,'') IN ('Completed','Signed Off','Approved')
  ) INTO v_qr_signed;

  v_stages := jsonb_build_array(
    jsonb_build_object('code','planning','label','Planning approved',
      'done', v_eng.approved_at IS NOT NULL OR COALESCE(v_eng.execution_status,'') <> 'Not Started',
      'detail', COALESCE(v_eng.status,'—')),
    jsonb_build_object('code','fieldwork','label','Fieldwork completed',
      'done', v_activities > 0 AND v_act_done = v_activities,
      'detail', v_act_done || ' of ' || v_activities || ' activities completed'),
    jsonb_build_object('code','findings','label','Findings finalised',
      'done', v_findings > 0 AND v_find_draft = 0,
      'detail', CASE WHEN v_findings = 0 THEN 'No findings raised'
                     ELSE v_find_draft || ' of ' || v_findings || ' still in draft/review' END),
    jsonb_build_object('code','responses','label','Management responses received',
      'done', v_findings > 0 AND v_responses >= v_findings,
      'detail', v_responses || ' of ' || v_findings || ' findings answered'),
    jsonb_build_object('code','actions','label','Recommendations converted to actions',
      'done', v_recs > 0 AND v_recs_no_act = 0,
      'detail', CASE WHEN v_recs = 0 THEN 'No recommendations recorded'
                     ELSE (v_recs - v_recs_no_act) || ' of ' || v_recs || ' recommendations tracked' END),
    jsonb_build_object('code','report','label','Report issued',
      'done', v_report_issued, 'detail', CASE WHEN v_report_issued THEN 'Issued' ELSE 'Not issued' END),
    jsonb_build_object('code','quality','label','Quality review signed off',
      'done', v_qr_signed, 'detail', CASE WHEN v_qr_signed THEN 'Signed off' ELSE 'Pending' END),
    jsonb_build_object('code','closure','label','Audit closed',
      'done', COALESCE(v_eng.execution_status,'') IN ('Closed','Closed – Actions Pending'),
      'detail', COALESCE(v_eng.execution_status,'—'))
  );

  SELECT count(*) INTO v_done
  FROM jsonb_array_elements(v_stages) s WHERE (s->>'done')::boolean;

  RETURN jsonb_build_object(
    'found', true,
    'execution_status', v_eng.execution_status,
    'stages', v_stages,
    'completed_stages', v_done,
    'total_stages', jsonb_array_length(v_stages),
    'percent', round((v_done::numeric / GREATEST(jsonb_array_length(v_stages),1)) * 100),
    'counts', jsonb_build_object(
      'activities', v_activities, 'activities_completed', v_act_done,
      'findings', v_findings, 'findings_draft', v_find_draft,
      'responses', v_responses,
      'actions', v_actions, 'actions_completed', v_actions_done,
      'recommendations', v_recs, 'recommendations_without_action', v_recs_no_act
    )
  );
END;
$$;

-- ---------------------------------------------------------------
-- Recommendation -> action conversion
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_create_action_from_recommendation(
  p_recommendation_id uuid,
  p_responsible_person text DEFAULT NULL,
  p_target_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec  public.ia_recommendations%ROWTYPE;
  v_eng  uuid;
  v_id   uuid;
BEGIN
  IF NOT public.ia_actor_can('InternalAudit', 'create_audit_actions')
     AND NOT public.ia_actor_can('InternalAudit', 'progress_audit_actions') THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are not permitted to raise audit actions.');
  END IF;

  SELECT * INTO v_rec FROM public.ia_recommendations WHERE id = p_recommendation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Recommendation not found.');
  END IF;

  SELECT engagement_id INTO v_eng FROM public.ia_findings WHERE id = v_rec.finding_id;
  IF v_eng IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Recommendation is not linked to an engagement finding.');
  END IF;

  IF EXISTS (SELECT 1 FROM public.ia_action_tracking WHERE recommendation_id = p_recommendation_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'An action already exists for this recommendation.');
  END IF;

  INSERT INTO public.ia_action_tracking (
    finding_id, engagement_id, recommendation_id, action_description,
    responsible_person, target_date, status, action_status, created_by
  ) VALUES (
    v_rec.finding_id, v_eng, p_recommendation_id, v_rec.recommendation_text,
    COALESCE(NULLIF(p_responsible_person,''), v_rec.responsible_party),
    COALESCE(p_target_date, v_rec.official_target_date, v_rec.suggested_target_date),
    'Open', 'Open', public.ia_actor_label()
  ) RETURNING id INTO v_id;

  UPDATE public.ia_recommendations
     SET status = COALESCE(NULLIF(status,''), 'Open'),
         updated_at = now(),
         updated_by = public.ia_actor_label()
   WHERE id = p_recommendation_id;

  RETURN jsonb_build_object('success', true, 'action_id', v_id, 'engagement_id', v_eng);
END;
$$;

-- ---------------------------------------------------------------
-- Evidence linking for actions
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_link_action_evidence(
  p_action_id uuid,
  p_evidence_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eng uuid;
  v_bad int;
BEGIN
  IF NOT public.ia_actor_can('InternalAudit', 'progress_audit_actions') THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are not permitted to update audit actions.');
  END IF;

  SELECT engagement_id INTO v_eng FROM public.ia_action_tracking WHERE id = p_action_id;
  IF v_eng IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Action not found or not linked to an engagement.');
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
$$;

REVOKE ALL ON FUNCTION public.ia_engagement_progress(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ia_create_action_from_recommendation(uuid, text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ia_link_action_evidence(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_engagement_progress(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_create_action_from_recommendation(uuid, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_link_action_evidence(uuid, uuid[]) TO authenticated;
