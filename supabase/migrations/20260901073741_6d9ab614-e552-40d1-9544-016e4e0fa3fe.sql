CREATE OR REPLACE VIEW public.ce_v_legal_referral_candidate AS
WITH viol AS (
  SELECT v.case_id,
         count(*) FILTER (WHERE v.status IN ('OPEN','IN_PROGRESS','UNDER_REVIEW','PENDING_VERIFICATION','ESCALATED')) AS open_violations,
         count(*)                                                     AS total_violations,
         max(v.severity)                                              AS max_severity,
         max(v.discovered_date)                                       AS last_violation_date,
         (array_agg(v.violation_number ORDER BY v.total_amount DESC NULLS LAST))[1] AS principal_violation_number,
         (array_agg(v.id ORDER BY v.total_amount DESC NULLS LAST))[1]  AS principal_violation_id,
         string_agg(DISTINCT v.violation_type_id::text, ',')           AS violation_type_ids
    FROM public.ce_violations v
   WHERE COALESCE(v.is_deleted,false) = false
     AND v.case_id IS NOT NULL
   GROUP BY v.case_id
), case_notices AS (
  SELECT n.case_id,
         count(*)                                                                       AS notices_sent,
         max(n.sent_at)                                                                 AS last_notice_at,
         max(n.sent_at) FILTER (WHERE n.notice_type IN ('DEMAND','LEGAL_WARNING'))      AS final_notice_at,
         (array_agg(n.notice_type ORDER BY n.sent_at DESC NULLS LAST))[1]               AS last_notice_type,
         (array_agg(n.stage_code ORDER BY n.sent_at DESC NULLS LAST))[1]                AS last_notice_stage,
         max(n.response_date)                                                           AS last_employer_response
    FROM public.ce_notices n
   WHERE n.case_id IS NOT NULL AND n.sent_at IS NOT NULL
   GROUP BY n.case_id
), emp_notices AS (
  SELECT n.employer_id,
         count(*)                                                                  AS notices_sent,
         max(n.sent_at)                                                            AS last_notice_at,
         max(n.sent_at) FILTER (WHERE n.notice_type IN ('DEMAND','LEGAL_WARNING')) AS final_notice_at
    FROM public.ce_notices n
   WHERE n.case_id IS NULL AND n.employer_id IS NOT NULL AND n.sent_at IS NOT NULL
   GROUP BY n.employer_id
), arr AS (
  SELECT DISTINCT ON (a.case_id)
         a.case_id, a.id AS arrangement_id, a.arrangement_number, a.status AS arrangement_status,
         a.breach_detected, a.breach_date, a.missed_payments, a.next_due_date, a.total_debt
    FROM public.ce_payment_arrangements a
   WHERE a.case_id IS NOT NULL
   ORDER BY a.case_id, a.created_at DESC
), emp_arr AS (
  SELECT a.employer_id,
         bool_or(a.status = 'ACTIVE')                             AS has_active_arrangement,
         bool_or(a.status IN ('BREACHED','DEFAULTED') OR a.breach_detected) AS has_breach
    FROM public.ce_payment_arrangements a
   GROUP BY a.employer_id
), rec AS (
  SELECT DISTINCT ON (g.source_case_id)
         g.source_case_id AS case_id, g.id AS recommendation_id, g.status AS recommendation_status,
         g.recommended_at, g.recommended_by, g.recommendation_reason, g.recommendation_type,
         g.entry_path, g.reviewed_date, g.reviewed_by, g.legal_referral_id, g.grand_total AS rec_total
    FROM public.ce_legal_recommendations g
   WHERE g.source_case_id IS NOT NULL
   ORDER BY g.source_case_id, g.created_at DESC
), ref AS (
  SELECT DISTINCT ON (r.source_case_id)
         r.source_case_id AS case_id, r.id AS referral_id, r.referral_number, r.status AS referral_status,
         r.created_at AS referral_created_at, r.created_via, r.grand_total AS referral_total,
         r.lg_intake_id, r.lg_intake_no, r.lg_case_no, r.legal_case_id, r.court_case_number,
         r.returned_at, r.return_reason, r.submitted_date, r.accepted_date,
         r.approval_requested_at, r.approved_at, r.referred_by
    FROM public.ce_legal_referrals r
   WHERE r.source_case_id IS NOT NULL
   ORDER BY r.source_case_id, r.created_at DESC
), ret AS (
  SELECT t.referral_id,
         count(*) AS return_count,
         count(*) FILTER (WHERE t.resolution_status IN ('OPEN','IN_PROGRESS')) AS open_returns,
         max(t.id::text) FILTER (WHERE t.resolution_status IN ('OPEN','IN_PROGRESS')) AS open_return_id
    FROM public.ce_legal_returns t
   GROUP BY t.referral_id
), facts AS (
  SELECT c.id AS case_id,
         c.fund_type,
         GREATEST(COALESCE(cn.notices_sent,0), COALESCE(en.notices_sent,0)) AS notices_sent,
         CASE WHEN COALESCE(cn.final_notice_at, en.final_notice_at) IS NULL THEN NULL
              ELSE (EXTRACT(EPOCH FROM (now() - COALESCE(cn.final_notice_at, en.final_notice_at))) / 86400)::int
         END AS days_since_final_notice,
         GREATEST(0, COALESCE(c.total_amount,0) - COALESCE(c.amount_collected,0) - COALESCE(c.amount_waived,0)) AS outstanding_amount,
         (COALESCE(ar.breach_detected,false) OR COALESCE(ea.has_breach,false)) AS arrangement_breach,
         COALESCE(rt.return_count,0) AS return_count
    FROM public.ce_cases c
    LEFT JOIN case_notices cn ON cn.case_id = c.id
    LEFT JOIN emp_notices en  ON en.employer_id = c.employer_id
    LEFT JOIN arr ar          ON ar.case_id = c.id
    LEFT JOIN emp_arr ea      ON ea.employer_id = c.employer_id
    LEFT JOIN ref rf          ON rf.case_id = c.id
    LEFT JOIN ret rt          ON rt.referral_id = rf.referral_id
), rule_pick AS (
  SELECT f.case_id,
         (SELECT to_jsonb(h) FROM public.ce_legal_handoff_rules h
           WHERE h.enabled
             AND (h.applicable_funds IS NULL OR cardinality(h.applicable_funds) = 0
                  OR f.fund_type = ANY (h.applicable_funds))
           ORDER BY
             (f.notices_sent >= COALESCE(h.required_notice_count,0)
              AND COALESCE(f.days_since_final_notice, -1) >= COALESCE(h.days_after_final_notice,0)
              AND f.outstanding_amount >= COALESCE(h.min_outstanding_amount,0)
              AND (NOT COALESCE(h.require_arrangement_breach,false) OR f.arrangement_breach)
              AND (NOT COALESCE(h.require_repeat_default,false) OR f.return_count > 0 OR f.arrangement_breach)
             ) DESC,
             (h.code = 'DEFAULT') ASC, COALESCE(h.sort_order, 999) ASC, h.code ASC
           LIMIT 1) AS rule_json
    FROM facts f
)
SELECT
  c.id                                                          AS case_id,
  c.case_number,
  c.employer_id                                                 AS employer_reg_no,
  COALESCE(NULLIF(btrim(c.employer_name),''), c.employer_id)    AS employer_name,
  c.territory                                                   AS zone,
  c.status                                                      AS case_status_code,
  c.priority,
  c.case_type,
  c.fund_type,
  c.summary,
  c.risk_band,
  c.risk_score,
  c.assigned_officer_id,
  c.assigned_officer_name,
  c.opened_date,
  c.created_at,
  c.updated_at,
  GREATEST(0, (EXTRACT(EPOCH FROM (now() - c.created_at)) / 86400)::int) AS case_age_days,
  COALESCE(c.total_principal,0)                                 AS total_principal,
  COALESCE(c.total_penalties,0)                                 AS total_penalties,
  COALESCE(c.total_interest,0)                                  AS total_interest,
  GREATEST(0, COALESCE(c.total_amount,0) - COALESCE(c.amount_collected,0) - COALESCE(c.amount_waived,0)) AS outstanding_amount,
  COALESCE(c.total_amount,0)                                    AS gross_amount,
  COALESCE(c.amount_collected,0)                                AS amount_collected,
  COALESCE(c.amount_waived,0)                                   AS amount_waived,
  COALESCE(vi.open_violations,0)                                AS open_violations,
  COALESCE(vi.total_violations, COALESCE(c.violation_count,0))  AS total_violations,
  vi.principal_violation_number,
  vi.principal_violation_id,
  vi.last_violation_date,
  COALESCE(cn.notices_sent, 0)                                  AS case_notices_sent,
  GREATEST(COALESCE(cn.notices_sent,0), COALESCE(en.notices_sent,0)) AS notices_sent,
  COALESCE(cn.last_notice_at, en.last_notice_at)                AS last_notice_at,
  COALESCE(cn.final_notice_at, en.final_notice_at)              AS final_notice_at,
  cn.last_notice_type,
  cn.last_notice_stage,
  cn.last_employer_response,
  CASE WHEN COALESCE(cn.final_notice_at, en.final_notice_at) IS NULL THEN NULL
       ELSE (EXTRACT(EPOCH FROM (now() - COALESCE(cn.final_notice_at, en.final_notice_at))) / 86400)::int
  END                                                           AS days_since_final_notice,
  ar.arrangement_id,
  ar.arrangement_number,
  ar.arrangement_status,
  COALESCE(ar.breach_detected,false) OR COALESCE(ea.has_breach,false) AS arrangement_breach,
  (ar.arrangement_status = 'ACTIVE') OR COALESCE(ea.has_active_arrangement,false) AS arrangement_active,
  ar.missed_payments,
  ar.next_due_date,
  GREATEST(COALESCE(cn.last_notice_at, en.last_notice_at), c.updated_at) AS last_action_at,
  rc.recommendation_id, rc.recommendation_status, rc.recommended_at, rc.recommended_by,
  rc.recommendation_reason, rc.recommendation_type, rc.entry_path, rc.reviewed_date, rc.reviewed_by,
  rf.referral_id, rf.referral_number, rf.referral_status, rf.referral_created_at, rf.created_via,
  rf.referral_total, rf.lg_intake_id, rf.lg_intake_no, rf.lg_case_no, rf.legal_case_id,
  rf.court_case_number, rf.returned_at, rf.return_reason, rf.submitted_date, rf.accepted_date,
  COALESCE(rt.return_count,0)                                   AS return_count,
  COALESCE(rt.open_returns,0)                                   AS open_returns,
  rt.open_return_id,
  c.lg_intake_no                                                AS case_lg_intake_no,
  c.lg_case_no                                                  AS case_lg_case_no,
  rp.rule_json,
  (rp.rule_json->>'code')                                       AS rule_code,
  (rp.rule_json->>'name')                                       AS rule_name,
  COALESCE((rp.rule_json->>'integration_mode'),'DISABLED')      AS rule_mode,
  COALESCE((rp.rule_json->>'required_notice_count')::int, 0)    AS rule_required_notices,
  COALESCE((rp.rule_json->>'days_after_final_notice')::int, 0)  AS rule_days_after_final,
  COALESCE((rp.rule_json->>'min_outstanding_amount')::numeric,0) AS rule_min_outstanding,
  COALESCE((rp.rule_json->>'require_arrangement_breach')::boolean,false) AS rule_require_breach,
  COALESCE((rp.rule_json->>'require_repeat_default')::boolean,false)     AS rule_require_repeat,
  COALESCE((rp.rule_json->>'employer_response_window_days')::int,0)      AS rule_response_window,
  COALESCE(c.escalation_recommended,false)                      AS escalation_recommended
FROM public.ce_cases c
LEFT JOIN viol vi        ON vi.case_id = c.id
LEFT JOIN case_notices cn ON cn.case_id = c.id
LEFT JOIN emp_notices en  ON en.employer_id = c.employer_id
LEFT JOIN arr ar          ON ar.case_id = c.id
LEFT JOIN emp_arr ea      ON ea.employer_id = c.employer_id
LEFT JOIN rec rc          ON rc.case_id = c.id
LEFT JOIN ref rf          ON rf.case_id = c.id
LEFT JOIN ret rt          ON rt.referral_id = rf.referral_id
LEFT JOIN rule_pick rp    ON rp.case_id = c.id
WHERE COALESCE(c.is_deleted,false) = false
  AND COALESCE(c.is_merged,false) = false;

CREATE OR REPLACE FUNCTION public.ce_legal_candidate_evaluate(_row public.ce_v_legal_referral_candidate)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_blocks   jsonb := '[]'::jsonb;
  v_reasons  jsonb := '[]'::jsonb;
  v_state    text;
  v_action   text;
  v_stage    text;
  v_refstate text;
  v_rule_ok  boolean;
BEGIN
  v_stage := CASE
    WHEN _row.case_status_code IN ('CLOSED','COMPLETED') THEN 'CLOSED'
    WHEN _row.referral_id IS NOT NULL OR _row.case_status_code = 'ESCALATED_LEGAL' THEN 'LEGAL_ESCALATION'
    WHEN _row.arrangement_breach THEN 'ARRANGEMENT_DEFAULT'
    WHEN _row.arrangement_active THEN 'ARRANGEMENT_ACTIVE'
    WHEN _row.final_notice_at IS NOT NULL THEN 'FINAL_ENFORCEMENT'
    WHEN _row.last_notice_stage = 'DEMAND' OR _row.last_notice_type = 'DEMAND' THEN 'DEMAND_ISSUED'
    WHEN _row.notices_sent > 0 THEN 'WARNING_ISSUED'
    WHEN _row.case_status_code = 'INVESTIGATION' THEN 'INVESTIGATION'
    ELSE 'INTAKE' END;

  v_refstate := CASE
    WHEN _row.referral_status = 'RETURNED_BY_LEGAL' THEN 'RETURNED'
    WHEN _row.referral_status = 'IN_LEGAL_PROCEEDINGS' THEN 'IN_PROCEEDINGS'
    WHEN _row.referral_status = 'ACCEPTED_BY_LEGAL' THEN 'ACCEPTED_BY_LEGAL'
    WHEN _row.referral_status = 'SUBMITTED_TO_LEGAL' THEN 'SUBMITTED_TO_LEGAL'
    WHEN _row.referral_status = 'APPROVED_FOR_SUBMISSION' THEN 'APPROVED_FOR_SUBMISSION'
    WHEN _row.referral_status = 'PENDING_APPROVAL' THEN 'PENDING_REFERRAL_APPROVAL'
    WHEN _row.referral_status = 'DRAFT' THEN 'PACK_IN_PREPARATION'
    WHEN _row.referral_status = 'REJECTED' THEN 'REJECTED'
    WHEN _row.referral_status = 'CLOSED' THEN 'CLOSED'
    WHEN _row.recommendation_status = 'APPROVED_FOR_REFERRAL' THEN 'RECOMMENDATION_APPROVED'
    WHEN _row.recommendation_status = 'PENDING_REVIEW' THEN 'RECOMMENDATION_PENDING'
    WHEN _row.recommendation_status = 'REJECTED' THEN 'RECOMMENDATION_REJECTED'
    ELSE 'NONE' END;

  IF _row.rule_json IS NULL THEN
    v_blocks := v_blocks || jsonb_build_object('code','NO_RULE','detail', NULL);
  ELSIF _row.rule_mode = 'DISABLED' THEN
    v_blocks := v_blocks || jsonb_build_object('code','RULE_DISABLED','detail', _row.rule_code);
  ELSE
    IF _row.notices_sent < _row.rule_required_notices THEN
      v_blocks := v_blocks || jsonb_build_object('code','NOTICES_INCOMPLETE',
        'detail', _row.notices_sent || ' of ' || _row.rule_required_notices || ' required notices issued');
    END IF;
    IF _row.rule_days_after_final > 0
       AND COALESCE(_row.days_since_final_notice, -1) < _row.rule_days_after_final THEN
      v_blocks := v_blocks || jsonb_build_object('code','WAITING_PERIOD',
        'detail', COALESCE(_row.days_since_final_notice, 0) || ' of ' || _row.rule_days_after_final || ' days elapsed since final notice');
    END IF;
    IF _row.outstanding_amount < _row.rule_min_outstanding THEN
      v_blocks := v_blocks || jsonb_build_object('code','BELOW_THRESHOLD',
        'detail', 'Configured minimum ' || _row.rule_min_outstanding::text);
    END IF;
    IF _row.rule_require_breach AND NOT _row.arrangement_breach THEN
      v_blocks := v_blocks || jsonb_build_object('code','BREACH_REQUIRED','detail', _row.rule_code);
    END IF;
    IF _row.rule_require_repeat AND COALESCE(_row.return_count,0) = 0 AND NOT _row.arrangement_breach THEN
      v_blocks := v_blocks || jsonb_build_object('code','BREACH_REQUIRED','detail','Repeat default required');
    END IF;
    IF _row.rule_response_window > 0
       AND _row.last_employer_response IS NOT NULL
       AND (now()::date - _row.last_employer_response::date) < _row.rule_response_window THEN
      v_blocks := v_blocks || jsonb_build_object('code','WAITING_PERIOD',
        'detail', 'Employer response window of ' || _row.rule_response_window || ' days not elapsed');
    END IF;
  END IF;

  IF _row.arrangement_active AND NOT _row.arrangement_breach THEN
    v_blocks := v_blocks || jsonb_build_object('code','ARRANGEMENT_ACTIVE','detail', _row.arrangement_number);
  END IF;
  IF COALESCE(_row.open_violations,0) = 0 AND COALESCE(_row.outstanding_amount,0) <= 0 THEN
    v_blocks := v_blocks || jsonb_build_object('code','NO_OPEN_VIOLATION','detail', NULL);
  END IF;

  v_rule_ok := (jsonb_array_length(v_blocks) = 0);

  IF _row.arrangement_breach THEN
    v_reasons := v_reasons || jsonb_build_object('code','ARRANGEMENT_DEFAULT','detail', _row.arrangement_number);
  END IF;
  IF _row.final_notice_at IS NOT NULL THEN
    v_reasons := v_reasons || jsonb_build_object('code','FINAL_ENFORCEMENT_REACHED','detail', _row.last_notice_type);
  END IF;
  IF COALESCE(_row.open_violations,0) > 0 THEN
    v_reasons := v_reasons || jsonb_build_object('code','UNRESOLVED_VIOLATION','detail', _row.principal_violation_number);
  END IF;
  IF _row.rule_json IS NOT NULL AND _row.outstanding_amount >= _row.rule_min_outstanding
     AND _row.rule_min_outstanding > 0 THEN
    v_reasons := v_reasons || jsonb_build_object('code','THRESHOLD_EXCEEDED','detail', _row.rule_code);
  END IF;

  IF _row.case_status_code IN ('CLOSED','COMPLETED') AND _row.referral_id IS NULL THEN
    v_state := 'NOT_ELIGIBLE'; v_action := 'VIEW_CASE';
    v_blocks := jsonb_build_array(jsonb_build_object('code','CASE_CLOSED','detail', _row.case_status_code)) || v_blocks;
  ELSIF _row.referral_status = 'RETURNED_BY_LEGAL' THEN
    v_state := 'RETURNED_FOR_REWORK'; v_action := 'REWORK_REFERRAL';
    v_reasons := v_reasons || jsonb_build_object('code','REFERRAL_IN_FLIGHT','detail', _row.referral_number);
  ELSIF _row.referral_status IN ('SUBMITTED_TO_LEGAL','ACCEPTED_BY_LEGAL','IN_LEGAL_PROCEEDINGS') THEN
    v_state := 'WITH_LEGAL'; v_action := 'TRACK_LEGAL';
    v_reasons := v_reasons || jsonb_build_object('code','REFERRAL_IN_FLIGHT','detail', _row.referral_number);
  ELSIF _row.referral_status IN ('DRAFT','PENDING_APPROVAL','APPROVED_FOR_SUBMISSION') THEN
    v_state := 'ALREADY_REFERRED';
    v_action := CASE WHEN _row.referral_status = 'DRAFT' THEN 'PREPARE_PACK' ELSE 'OPEN_REFERRAL' END;
    v_blocks := jsonb_build_array(jsonb_build_object('code','ACTIVE_REFERRAL','detail', _row.referral_number)) || v_blocks;
    v_reasons := v_reasons || jsonb_build_object('code','REFERRAL_IN_FLIGHT','detail', _row.referral_number);
  ELSIF _row.recommendation_status = 'APPROVED_FOR_REFERRAL' THEN
    v_state := 'APPROVED_FOR_PACK'; v_action := 'PREPARE_PACK';
    v_reasons := v_reasons || jsonb_build_object('code','RECOMMENDATION_APPROVED','detail', NULL);
  ELSIF _row.recommendation_status = 'PENDING_REVIEW' THEN
    v_state := 'AWAITING_RECOMMENDATION_APPROVAL'; v_action := 'OPEN_RECOMMENDATION';
    v_reasons := v_reasons || jsonb_build_object('code','RECOMMENDATION_PENDING','detail', NULL);
  ELSIF v_rule_ok THEN
    v_state := 'ELIGIBLE'; v_action := 'RECOMMEND_LEGAL';
  ELSIF _row.escalation_recommended OR _row.case_status_code = 'RECOMMENDED_FOR_LEGAL' THEN
    v_state := 'RECOMMENDATION_REQUIRED'; v_action := 'RECOMMEND_LEGAL';
  ELSE
    v_state := 'NOT_ELIGIBLE'; v_action := 'VIEW_CASE';
  END IF;

  RETURN jsonb_build_object(
    'eligibility_code', v_state,
    'action_code',      v_action,
    'stage_code',       v_stage,
    'referral_state_code', v_refstate,
    'rule_satisfied',   v_rule_ok,
    'blocks',           v_blocks,
    'reasons',          v_reasons,
    'can_initiate',     (v_state IN ('ELIGIBLE','RECOMMENDATION_REQUIRED')),
    'has_active_referral', (_row.referral_status IS NOT NULL
                            AND _row.referral_status NOT IN ('REJECTED','CLOSED'))
  );
END;
$$;