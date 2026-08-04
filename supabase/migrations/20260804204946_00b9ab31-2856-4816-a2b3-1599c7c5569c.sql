-- Award-level access check for Benefits Life Certificates.
CREATE OR REPLACE FUNCTION public._bn_lc_can_access_award(p_actor uuid, p_award uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_claim uuid; v_code text;
BEGIN
  IF p_actor IS NULL OR p_award IS NULL THEN RETURN false; END IF;

  -- Documented administrator override / explicit view-all grant.
  IF public.is_admin(p_actor)
     OR public.has_permission(p_actor,'bn_life_certificate','view_all_records') THEN
    RETURN true;
  END IF;

  SELECT a.bn_claim_id INTO v_claim FROM public.bn_award a WHERE a.id = p_award;
  IF v_claim IS NULL THEN RETURN false; END IF;

  v_code := public._bn_susp_user_code(p_actor);
  IF v_code IS NULL THEN RETURN false; END IF;

  -- Explicit claim assignment.
  IF EXISTS (SELECT 1 FROM public.bn_claim WHERE id = v_claim AND assigned_to = v_code) THEN
    RETURN true;
  END IF;

  -- Queue / workbasket assignment (office or organisational scope).
  IF EXISTS (SELECT 1 FROM public.bn_claim_queue_assignment q
              WHERE q.claim_id = v_claim AND COALESCE(q.is_active,true)
                AND (q.assigned_to = v_code
                     OR q.workbasket_id IN (SELECT workbasket_id FROM public.bn_workbaskets_for_user(p_actor)))) THEN
    RETURN true;
  END IF;

  RETURN false;
END $function$;

REVOKE ALL ON FUNCTION public._bn_lc_can_access_award(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bn_lc_can_access_award(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.bn_life_certificate_worklist_v2(p_bucket text DEFAULT 'ALL'::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_award_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_actor uuid; v_limit integer := LEAST(GREATEST(COALESCE(p_limit,50),1),200);
        v_rows jsonb; v_total bigint; v_search text := NULLIF(btrim(COALESCE(p_search,'')),'');
        v_reveal boolean; v_pattern text; v_award record;
        v_award_ctx jsonb := NULL;
BEGIN
  v_actor := public._bn_lc_actor();
  PERFORM public._bn_lc_require(v_actor,'view');
  v_reveal := public.has_permission(v_actor,'bn_life_certificate','view_sensitive_identity')
              OR public.is_admin(v_actor);

  IF v_search IS NOT NULL AND length(v_search) < 4 THEN
    RAISE EXCEPTION 'E_SEARCH_TOO_SHORT' USING ERRCODE='P0001';
  END IF;
  v_pattern := CASE WHEN v_search IS NULL THEN NULL
                    ELSE '%'||replace(replace(replace(v_search,'\','\\'),'%','\%'),'_','\_')||'%' END;

  IF p_award_id IS NOT NULL THEN
    SELECT a.id, a.award_number, a.ssn, a.benefit_code, a.status
      INTO v_award FROM public.bn_award a WHERE a.id = p_award_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'E_AWARD_NOT_FOUND' USING ERRCODE='P0001';
    END IF;

    -- Award-level record scope. Identical response whether or not the award
    -- has Life Certificate obligations, so existence is never disclosed.
    IF NOT public._bn_lc_can_access_award(v_actor, p_award_id) THEN
      RAISE EXCEPTION 'E_RECORD_FORBIDDEN' USING ERRCODE='P0001';
    END IF;

    v_award_ctx := jsonb_build_object(
      'id', v_award.id,
      'award_number', v_award.award_number,
      'ssn', public._bn_lc_mask_ssn(v_award.ssn, v_reveal),
      'benefit_code', v_award.benefit_code,
      'status', v_award.status);
  END IF;

  WITH base AS (
    SELECT lc.*, a.award_number, a.ssn, a.benefit_code, a.status AS award_status,
           att.manual_intervention_required, att.failed_attempts, att.last_error_code
      FROM public.bn_life_certificate lc
      JOIN public.bn_award a ON a.id = lc.bn_award_id
      LEFT JOIN LATERAL (
        SELECT s.manual_intervention_required, s.failed_attempts, s.last_error_code
          FROM public.bn_life_certificate_scheduler_attempt s
         WHERE s.life_certificate_id = lc.id
         ORDER BY s.manual_intervention_required DESC, s.updated_at DESC LIMIT 1) att ON true
     WHERE public._bn_lc_can_access(v_actor, lc.id)
       AND (p_award_id IS NULL OR lc.bn_award_id = p_award_id)
       AND (p_bucket = 'ALL'
        OR (p_bucket='DUE' AND lc.obligation_status IN ('DUE','REMINDER_SENT'))
        OR (p_bucket='GRACE' AND lc.obligation_status='GRACE')
        OR (p_bucket='OVERDUE' AND lc.obligation_status='OVERDUE')
        OR (p_bucket='AWAITING_REVIEW' AND lc.obligation_status IN ('RECEIVED','UNDER_REVIEW'))
        OR (p_bucket='REJECTED' AND lc.obligation_status IN ('REJECTED','RESUBMISSION_REQUIRED'))
        OR (p_bucket='VERIFIED' AND lc.obligation_status='VERIFIED')
        OR (p_bucket='WAIVED_DEFERRED' AND lc.obligation_status IN ('WAIVED','DEFERRED'))
        OR (p_bucket='SUSPENSIONS' AND lc.suspension_event_id IS NOT NULL)
        OR (p_bucket='REINSTATEMENTS' AND lc.reinstatement_event_id IS NOT NULL)
        OR (p_bucket='MANUAL_INTERVENTION' AND COALESCE(att.manual_intervention_required,false)))
       AND (v_pattern IS NULL
            OR COALESCE(a.award_number,'') ILIKE v_pattern ESCAPE '\'
            OR (v_reveal AND a.ssn ILIKE v_pattern ESCAPE '\')
            OR (NOT v_reveal AND a.ssn = v_search))
  )
  SELECT COALESCE(jsonb_agg(t ORDER BY t.due_date), '[]'::jsonb), (SELECT count(*) FROM base)
    INTO v_rows, v_total
  FROM (
    SELECT b.id, b.bn_award_id, b.award_number,
           public._bn_lc_mask_ssn(b.ssn, v_reveal) AS ssn,
           b.benefit_code, b.award_status,
           b.obligation_period, b.due_date, b.grace_end_date, b.escalation_date,
           b.obligation_status, b.evidence_status, b.verification_status,
           b.escalation_status, b.communication_status, b.reminder_count,
           b.suspension_event_id, b.reinstatement_event_id, b.row_version,
           COALESCE(b.manual_intervention_required,false) AS manual_intervention_required,
           COALESCE(b.failed_attempts,0) AS scheduler_failed_attempts,
           b.last_error_code AS scheduler_last_error_code
      FROM base b
     ORDER BY b.due_date
     LIMIT v_limit OFFSET GREATEST(COALESCE(p_offset,0),0)
  ) t;

  RETURN jsonb_build_object('rows', v_rows,'total', v_total,'limit', v_limit,
                            'offset', COALESCE(p_offset,0),'identity_masked', NOT v_reveal,
                            'award', v_award_ctx);
END $function$;

REVOKE ALL ON FUNCTION public.bn_life_certificate_worklist_v2(text, text, integer, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_life_certificate_worklist_v2(text, text, integer, integer, uuid) TO authenticated, service_role;