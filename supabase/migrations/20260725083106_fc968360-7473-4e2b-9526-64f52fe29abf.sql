CREATE OR REPLACE FUNCTION public.fn_ce_score_candidates_v3(p_zone_id uuid DEFAULT NULL::uuid, p_inspector_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 200)
 RETURNS TABLE(employer_id text, employer_name text, territory text, zone_id uuid, audit_program text, candidate_source text, candidate_reason text, derived_priority text, risk_band text, risk_score numeric, inherent_risk_score numeric, audit_priority_score numeric, days_since_last_inspection integer, last_audit_date date, next_due_date date, overdue_days integer, open_violation_count bigint, escalated_violation_count bigint, overdue_followup_count bigint, violation_count bigint, case_count bigint, financial_exposure numeric, notice_days_remaining integer, any_breach_detected boolean, carry_forward_count bigint, audit_cycle_due_date date, cycle_overdue_days integer, is_cycle_overdue boolean, recommendation_score numeric, recommendation_reasons jsonb, why_selected text, mandatory_class text, bucket text, estimated_effort numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inspector_zone uuid;
  w_inherent      numeric := 25;
  w_trigger       numeric := 25;
  w_dueness       numeric := 20;
  w_enforcement   numeric := 15;
  w_followup      numeric := 10;
  w_opfit         numeric := 5;
BEGIN
  IF p_zone_id IS NULL AND p_inspector_id IS NOT NULL THEN
    SELECT primary_zone_id INTO v_inspector_zone
      FROM public.ce_inspectors WHERE id = p_inspector_id;
  END IF;

  SELECT COALESCE(MAX(CASE WHEN weight_key='INHERENT_RISK'     THEN weight_pct END), w_inherent),
         COALESCE(MAX(CASE WHEN weight_key='TRIGGER_URGENCY'   THEN weight_pct END), w_trigger),
         COALESCE(MAX(CASE WHEN weight_key='AUDIT_DUENESS'     THEN weight_pct END), w_dueness),
         COALESCE(MAX(CASE WHEN weight_key='ENFORCEMENT_STAGE' THEN weight_pct END), w_enforcement),
         COALESCE(MAX(CASE WHEN weight_key='FOLLOW_UP_AGING'   THEN weight_pct END), w_followup),
         COALESCE(MAX(CASE WHEN weight_key='OPERATIONAL_FIT'   THEN weight_pct END), w_opfit)
    INTO w_inherent, w_trigger, w_dueness, w_enforcement, w_followup, w_opfit
    FROM public.ce_audit_priority_weights
   WHERE enabled = true;

  RETURN QUERY
  WITH base AS (
    SELECT
      c.*,
      rp.zone_id              AS rp_zone_id,
      rp.next_review_date     AS rp_next_review,
      rp.last_inspected_at    AS rp_last_inspected,
      rp.last_audit_date      AS rp_last_audit_date,
      rp.next_audit_due_date  AS rp_next_audit_due,
      rp.overdue_audit_days   AS rp_overdue_audit_days,
      rp.audit_program        AS rp_audit_program,
      rp.consecutive_cycles_skipped AS rp_skipped,
      CASE
        WHEN rp.next_audit_due_date IS NOT NULL
          THEN GREATEST(0, (CURRENT_DATE - rp.next_audit_due_date))
        WHEN rp.next_review_date IS NOT NULL
          THEN GREATEST(0, (CURRENT_DATE - rp.next_review_date))
        ELSE 0
      END AS rp_overdue_days,
      (SELECT COUNT(*) FROM public.ce_cases cs
        WHERE cs.employer_id = c.employer_id
          AND COALESCE(cs.status,'') NOT IN ('CLOSED','RESOLVED','WITHDRAWN')) AS case_cnt
    FROM public.ce_v_plan_candidates_v2 c
    LEFT JOIN public.ce_risk_profiles rp ON rp.employer_id = c.employer_id
  ),
  filtered AS (
    SELECT * FROM base
     WHERE (p_zone_id IS NULL AND v_inspector_zone IS NULL)
        OR (p_zone_id IS NOT NULL AND rp_zone_id = p_zone_id)
        OR (v_inspector_zone IS NOT NULL AND rp_zone_id = v_inspector_zone)
  ),
  deduped AS (
    SELECT DISTINCT ON (f.employer_id, COALESCE(f.rp_audit_program,'_'))
           f.*
      FROM filtered f
     ORDER BY f.employer_id, COALESCE(f.rp_audit_program,'_'),
              COALESCE(f.escalated_violation_count,0) DESC,
              COALESCE(f.open_violation_count,0) DESC
  ),
  scored AS (
    SELECT
      d.*,
      LEAST(100, COALESCE(d.risk_score, 0)) AS s_inherent,
      LEAST(100,
        (COALESCE(d.escalated_violation_count,0) * 25)
      + (COALESCE(d.open_violation_count,0) * 6)
      + (CASE WHEN d.any_breach_detected THEN 20 ELSE 0 END)
      + (CASE WHEN COALESCE(d.notice_days_remaining,99) <= 3 THEN 25
              WHEN COALESCE(d.notice_days_remaining,99) <= 7 THEN 15 ELSE 0 END)
      ) AS s_trigger,
      LEAST(100,
        (CASE WHEN d.rp_overdue_days > 0
              THEN LEAST(60, d.rp_overdue_days)
              ELSE 0 END)
      + (COALESCE(d.rp_skipped,0) * 20)
      + (CASE WHEN d.rp_next_audit_due IS NOT NULL
                AND d.rp_next_audit_due <= (CURRENT_DATE + INTERVAL '14 day')
              THEN 20 ELSE 0 END)
      ) AS s_dueness,
      LEAST(100,
        (d.case_cnt * 20)
      + (CASE WHEN COALESCE(d.financial_exposure,0) > 50000 THEN 30
              WHEN COALESCE(d.financial_exposure,0) > 10000 THEN 15
              WHEN COALESCE(d.financial_exposure,0) > 0     THEN 5 ELSE 0 END)
      ) AS s_enforcement,
      LEAST(100,
        (COALESCE(d.overdue_followup_count,0) * 15)
      + (COALESCE(d.carry_forward_count,0) * 10)
      ) AS s_followup,
      CASE
        WHEN p_zone_id IS NOT NULL AND d.rp_zone_id = p_zone_id THEN 100
        WHEN v_inspector_zone IS NOT NULL AND d.rp_zone_id = v_inspector_zone THEN 100
        WHEN d.rp_zone_id IS NOT NULL THEN 40
        ELSE 0
      END AS s_opfit
    FROM deduped d
  ),
  ranked AS (
    SELECT
      s.*,
      ROUND(
          (s.s_inherent    * w_inherent
         + s.s_trigger     * w_trigger
         + s.s_dueness     * w_dueness
         + s.s_enforcement * w_enforcement
         + s.s_followup    * w_followup
         + s.s_opfit       * w_opfit) / NULLIF(w_inherent+w_trigger+w_dueness+w_enforcement+w_followup+w_opfit, 0)
      , 2) AS audit_priority,
      CASE
        WHEN s.any_breach_detected
             OR (s.candidate_reason IN ('ARRANGEMENT_DEFAULT','ARRANGEMENT_AT_RISK'))
          THEN 'ARRANGEMENT_BREACH'
        WHEN s.case_cnt > 0 AND s.escalated_violation_count > 0
          THEN 'LEGAL_STAGE_TRIGGER'
        WHEN s.case_cnt > 0
          THEN 'POST_ENFORCEMENT_RECHECK'
        WHEN s.rp_overdue_days > 0 OR COALESCE(s.rp_skipped,0) > 0
          THEN 'ROUTINE_CYCLE_DUE'
        WHEN s.risk_band IN ('HIGH','CRITICAL') AND COALESCE(s.days_since_last_inspection, 9999) > 180
          THEN 'MANDATORY_HIGH_RISK_REVIEW'
        ELSE s.candidate_reason
      END AS reason_v3
    FROM scored s
  ),
  classified AS (
    SELECT
      r.*,
      CASE
        WHEN r.reason_v3 IN ('LEGAL_STAGE_TRIGGER','MANDATORY_HIGH_RISK_REVIEW','ARRANGEMENT_BREACH')
             OR (r.rp_overdue_days > 30 AND COALESCE(r.rp_skipped,0) >= 1)
             OR (r.escalated_violation_count > 0 AND r.case_cnt > 0)
          THEN 'MANDATORY'
        WHEN r.audit_priority >= 50
             OR r.escalated_violation_count > 0
             OR r.rp_overdue_days > 14
             OR COALESCE(r.notice_days_remaining,99) <= 7
          THEN 'PRIORITY'
        ELSE 'WATCHLIST'
      END AS mandatory_class_v,
      CASE
        WHEN r.reason_v3 IN ('LEGAL_STAGE_TRIGGER','MANDATORY_HIGH_RISK_REVIEW','ARRANGEMENT_BREACH')
          THEN 'MUST_SCHEDULE'
        WHEN r.case_cnt > 0
             OR r.escalated_violation_count > 0
             OR r.reason_v3 IN ('POST_ENFORCEMENT_RECHECK','OVERDUE_FOLLOW_UP')
          THEN 'REACTIVE_ENFORCEMENT'
        WHEN r.risk_band IN ('HIGH','CRITICAL')
             OR (COALESCE(r.days_since_last_inspection, 9999) > 180)
          THEN 'RISK_MONITORING'
        WHEN r.reason_v3 IN ('ROUTINE_CYCLE_DUE')
             OR r.rp_overdue_days > 0
          THEN 'ROUTINE_COVERAGE'
        ELSE 'CAMPAIGN_INTEL'
      END AS bucket_v,
      ROUND(
        CASE COALESCE(r.rp_audit_program,'')
          WHEN 'FULL_AUDIT'   THEN 6.0
          WHEN 'DESK_REVIEW'  THEN 2.0
          WHEN 'FOLLOW_UP'    THEN 1.5
          WHEN 'SPOT_CHECK'   THEN 1.0
          ELSE 3.0
        END
        + LEAST(2.0, COALESCE(r.open_violation_count,0) * 0.25)
      , 2) AS effort_hours
    FROM ranked r
  ),
  with_reasons AS (
    SELECT
      c.*,
      jsonb_strip_nulls(jsonb_build_array(
        CASE WHEN c.s_inherent    > 0 THEN jsonb_build_object('code','INHERENT_RISK','label','Inherent risk',           'weight', c.s_inherent)    END,
        CASE WHEN c.s_trigger     > 0 THEN jsonb_build_object('code','TRIGGER_URGENCY','label','Active triggers',       'weight', c.s_trigger)     END,
        CASE WHEN c.s_dueness     > 0 THEN jsonb_build_object('code','AUDIT_DUENESS','label','Audit due / overdue',     'weight', c.s_dueness)     END,
        CASE WHEN c.s_enforcement > 0 THEN jsonb_build_object('code','ENFORCEMENT_STAGE','label','Enforcement / cases', 'weight', c.s_enforcement) END,
        CASE WHEN c.s_followup    > 0 THEN jsonb_build_object('code','FOLLOW_UP_AGING','label','Follow-up / carry fwd', 'weight', c.s_followup)    END,
        CASE WHEN c.s_opfit       > 0 THEN jsonb_build_object('code','OPERATIONAL_FIT','label','Zone fit',              'weight', c.s_opfit)       END,
        CASE WHEN c.mandatory_class_v = 'MANDATORY' THEN jsonb_build_object('code','MANDATORY','label','Mandatory class','weight', 100) END
      )) AS reasons_json,
      CONCAT_WS(' • ',
        NULLIF(CASE WHEN c.mandatory_class_v = 'MANDATORY' THEN 'Mandatory' END,''),
        NULLIF(CASE WHEN c.risk_band IS NOT NULL THEN c.risk_band || ' risk' END,''),
        NULLIF(CASE WHEN c.rp_overdue_days > 0 THEN c.rp_overdue_days || 'd overdue' END,''),
        NULLIF(CASE WHEN c.open_violation_count > 0 THEN c.open_violation_count || ' open viol.' END,''),
        NULLIF(CASE WHEN c.case_cnt > 0 THEN c.case_cnt || ' active case(s)' END,''),
        NULLIF(CASE WHEN c.any_breach_detected THEN 'arrangement breach' END,''),
        NULLIF(CASE WHEN c.notice_days_remaining IS NOT NULL AND c.notice_days_remaining <= 7 THEN 'notice in ' || c.notice_days_remaining || 'd' END,'')
      ) AS why_line
    FROM classified c
  )
  SELECT
    w.employer_id::text,
    w.employer_name::text,
    w.territory::text,
    w.rp_zone_id,
    w.rp_audit_program::text,
    w.candidate_source::text,
    w.reason_v3::text,
    w.derived_priority::text,
    w.risk_band::text,
    w.risk_score,
    w.s_inherent      AS inherent_risk_score,
    w.audit_priority  AS audit_priority_score,
    w.days_since_last_inspection,
    w.rp_last_audit_date,
    w.rp_next_audit_due,
    w.rp_overdue_days::int,
    w.open_violation_count,
    w.escalated_violation_count,
    w.overdue_followup_count,
    w.open_violation_count AS violation_count,
    w.case_cnt::bigint     AS case_count,
    w.financial_exposure,
    w.notice_days_remaining,
    w.any_breach_detected,
    w.carry_forward_count,
    w.rp_next_review                    AS audit_cycle_due_date,
    w.rp_overdue_days::int              AS cycle_overdue_days,
    (w.rp_overdue_days > 0)             AS is_cycle_overdue,
    w.audit_priority                    AS recommendation_score,
    w.reasons_json                      AS recommendation_reasons,
    w.why_line                          AS why_selected,
    w.mandatory_class_v                 AS mandatory_class,
    w.bucket_v                          AS bucket,
    w.effort_hours                      AS estimated_effort
  FROM with_reasons w
  ORDER BY
    CASE w.mandatory_class_v WHEN 'MANDATORY' THEN 0 WHEN 'PRIORITY' THEN 1 ELSE 2 END,
    w.audit_priority DESC NULLS LAST,
    w.s_trigger DESC,
    w.s_dueness DESC
  LIMIT p_limit;
END
$function$;