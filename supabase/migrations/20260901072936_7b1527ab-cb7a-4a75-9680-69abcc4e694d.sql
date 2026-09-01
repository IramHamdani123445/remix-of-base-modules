-- ---------------------------------------------------------------- ref
CREATE TABLE IF NOT EXISTS public.ce_legal_candidate_ref (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain        text NOT NULL,
  code          text NOT NULL,
  label         text NOT NULL,
  description   text,
  tone          text,
  display_order int NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (domain, code)
);

GRANT SELECT ON public.ce_legal_candidate_ref TO authenticated;
GRANT ALL    ON public.ce_legal_candidate_ref TO service_role;
ALTER TABLE public.ce_legal_candidate_ref ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ce_legal_candidate_ref_read ON public.ce_legal_candidate_ref;
CREATE POLICY ce_legal_candidate_ref_read ON public.ce_legal_candidate_ref
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.ce_legal_candidate_ref (domain, code, label, description, tone, display_order) VALUES
 ('ELIGIBILITY','ELIGIBLE','Eligible now','Configured legal handoff rule satisfied - a legal recommendation may be raised.','success',10),
 ('ELIGIBILITY','RECOMMENDATION_REQUIRED','Recommendation required','Case flagged for legal escalation but no recommendation has been raised yet.','warning',20),
 ('ELIGIBILITY','AWAITING_RECOMMENDATION_APPROVAL','Awaiting recommendation approval','A legal recommendation is pending management review.','info',30),
 ('ELIGIBILITY','APPROVED_FOR_PACK','Approved for pack preparation','Recommendation approved - the legal pack must now be prepared.','info',40),
 ('ELIGIBILITY','ALREADY_REFERRED','Already referred','A legal referral already exists for this case.','neutral',50),
 ('ELIGIBILITY','WITH_LEGAL','With Legal','The referral has been submitted to or accepted by Legal.','neutral',60),
 ('ELIGIBILITY','RETURNED_FOR_REWORK','Returned for rework','Legal returned the referral - rework the existing pack.','danger',70),
 ('ELIGIBILITY','NOT_ELIGIBLE','Not eligible','Configured legal handoff prerequisites are not met.','muted',80),
 ('REFERRAL_STATE','NONE','No referral',NULL,'muted',10),
 ('REFERRAL_STATE','RECOMMENDATION_PENDING','Recommendation pending',NULL,'info',20),
 ('REFERRAL_STATE','RECOMMENDATION_APPROVED','Recommendation approved',NULL,'info',30),
 ('REFERRAL_STATE','RECOMMENDATION_REJECTED','Recommendation rejected',NULL,'danger',35),
 ('REFERRAL_STATE','PACK_IN_PREPARATION','Pack in preparation',NULL,'warning',40),
 ('REFERRAL_STATE','PENDING_REFERRAL_APPROVAL','Pending referral approval',NULL,'warning',50),
 ('REFERRAL_STATE','APPROVED_FOR_SUBMISSION','Approved for submission',NULL,'info',55),
 ('REFERRAL_STATE','SUBMITTED_TO_LEGAL','Submitted to Legal',NULL,'success',60),
 ('REFERRAL_STATE','ACCEPTED_BY_LEGAL','Accepted by Legal',NULL,'success',70),
 ('REFERRAL_STATE','RETURNED','Returned by Legal',NULL,'danger',80),
 ('REFERRAL_STATE','IN_PROCEEDINGS','In legal proceedings',NULL,'success',90),
 ('REFERRAL_STATE','REJECTED','Referral rejected',NULL,'danger',95),
 ('REFERRAL_STATE','CLOSED','Referral closed',NULL,'muted',99),
 ('CASE_STATUS','OPEN','Open',NULL,'info',10),
 ('CASE_STATUS','ACTIVE','Active',NULL,'info',20),
 ('CASE_STATUS','INVESTIGATION','Under investigation',NULL,'info',30),
 ('CASE_STATUS','IN_ARRANGEMENT','Payment arrangement in place',NULL,'warning',40),
 ('CASE_STATUS','CSTG_PAYMENT_ARRANGEMENT_ACTIVE','Payment arrangement active',NULL,'warning',50),
 ('CASE_STATUS','RECOMMENDED_FOR_LEGAL','Recommended for legal',NULL,'warning',60),
 ('CASE_STATUS','ESCALATED','Escalated',NULL,'warning',70),
 ('CASE_STATUS','ESCALATED_LEGAL','Escalated to Legal',NULL,'neutral',80),
 ('CASE_STATUS','COMPLETED','Completed',NULL,'muted',90),
 ('CASE_STATUS','CLOSED','Closed',NULL,'muted',95),
 ('CASE_STAGE','INTAKE','Intake / assessment','No enforcement notice issued yet.','muted',10),
 ('CASE_STAGE','INVESTIGATION','Investigation','Case under compliance investigation.','info',20),
 ('CASE_STAGE','WARNING_ISSUED','Warning issued','A warning notice has been served.','info',30),
 ('CASE_STAGE','DEMAND_ISSUED','Demand issued','A demand notice has been served.','warning',40),
 ('CASE_STAGE','FINAL_ENFORCEMENT','Final enforcement','Final enforcement notice served - legal escalation stage.','warning',50),
 ('CASE_STAGE','ARRANGEMENT_ACTIVE','Payment arrangement active','A live payment arrangement is curing the debt.','info',60),
 ('CASE_STAGE','ARRANGEMENT_DEFAULT','Payment arrangement default','The payment arrangement has breached or defaulted.','danger',70),
 ('CASE_STAGE','LEGAL_ESCALATION','Legal escalation','The case is in the legal escalation pipeline.','neutral',80),
 ('CASE_STAGE','CLOSED','Closed','Case closed or merged.','muted',90),
 ('BLOCK_REASON','CASE_CLOSED','Case is closed or merged',NULL,'muted',10),
 ('BLOCK_REASON','NO_RULE','No configured legal handoff rule applies',NULL,'muted',20),
 ('BLOCK_REASON','RULE_DISABLED','Legal handoff disabled by configuration',NULL,'muted',30),
 ('BLOCK_REASON','BELOW_THRESHOLD','Outstanding below configured legal threshold',NULL,'muted',40),
 ('BLOCK_REASON','NOTICES_INCOMPLETE','Required enforcement notices not completed',NULL,'warning',50),
 ('BLOCK_REASON','WAITING_PERIOD','Waiting period after final notice not elapsed',NULL,'warning',60),
 ('BLOCK_REASON','ARRANGEMENT_ACTIVE','Blocked - active payment arrangement',NULL,'warning',70),
 ('BLOCK_REASON','BREACH_REQUIRED','Rule requires an arrangement breach',NULL,'warning',80),
 ('BLOCK_REASON','NO_OPEN_VIOLATION','No unresolved violation on the case',NULL,'muted',90),
 ('BLOCK_REASON','ACTIVE_REFERRAL','An active legal referral already exists',NULL,'neutral',95),
 ('ELIG_REASON','FINAL_ENFORCEMENT_REACHED','Final enforcement stage reached',NULL,'success',10),
 ('ELIG_REASON','ARRANGEMENT_DEFAULT','Payment arrangement default',NULL,'success',20),
 ('ELIG_REASON','UNRESOLVED_VIOLATION','Unresolved violation beyond enforcement',NULL,'success',30),
 ('ELIG_REASON','THRESHOLD_EXCEEDED','Outstanding exceeds configured legal threshold',NULL,'success',40),
 ('ELIG_REASON','RECOMMENDATION_APPROVED','Legal recommendation approved',NULL,'success',50),
 ('ELIG_REASON','RECOMMENDATION_PENDING','Legal recommendation under review',NULL,'info',60),
 ('ELIG_REASON','REFERRAL_IN_FLIGHT','Legal referral already in progress',NULL,'neutral',70),
 ('ACTION','RECOMMEND_LEGAL','Recommend Legal','Raise a legal recommendation for management review.','primary',10),
 ('ACTION','OPEN_RECOMMENDATION','Open recommendation','Recommendation awaiting management decision.','secondary',20),
 ('ACTION','PREPARE_PACK','Prepare legal pack','Approved - assemble the legal pack.','primary',30),
 ('ACTION','OPEN_REFERRAL','Open existing referral','A referral already exists for this case.','secondary',40),
 ('ACTION','REWORK_REFERRAL','Rework referral','Legal returned this referral for correction.','primary',50),
 ('ACTION','TRACK_LEGAL','Track with Legal','Follow the matter in the Legal register.','secondary',60),
 ('ACTION','VIEW_CASE','View case','Case is not eligible for legal escalation.','ghost',70)
ON CONFLICT (domain, code) DO UPDATE
  SET label = EXCLUDED.label,
      description = EXCLUDED.description,
      tone = EXCLUDED.tone,
      display_order = EXCLUDED.display_order,
      is_active = true,
      updated_at = now();

-- ------------------------------------------------------------- label fn
CREATE OR REPLACE FUNCTION public.ce_legal_candidate_label(_domain text, _code text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object('code', r.code, 'label', r.label, 'tone', r.tone, 'description', r.description)
       FROM public.ce_legal_candidate_ref r
      WHERE r.domain = _domain AND r.code = _code AND r.is_active),
    CASE WHEN _code IS NULL OR btrim(_code) = ''
         THEN jsonb_build_object('code', NULL, 'label', '-', 'tone', 'muted', 'description', NULL)
         ELSE jsonb_build_object('code', _code, 'label', 'Unmapped ' ||
              CASE _domain WHEN 'CASE_STATUS' THEN 'case status'
                           WHEN 'CASE_STAGE' THEN 'case stage'
                           ELSE lower(replace(_domain,'_',' ')) END,
              'tone','muted','description', _code)
    END);
$$;

GRANT EXECUTE ON FUNCTION public.ce_legal_candidate_label(text, text) TO authenticated, service_role;

-- ------------------------------------------------------------- the view
DROP VIEW IF EXISTS public.ce_v_legal_referral_candidate CASCADE;
CREATE VIEW public.ce_v_legal_referral_candidate AS
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
), rule_pick AS (
  SELECT c.id AS case_id,
         (SELECT to_jsonb(h) FROM public.ce_legal_handoff_rules h
           WHERE h.enabled
             AND (h.applicable_funds IS NULL OR cardinality(h.applicable_funds) = 0
                  OR c.fund_type = ANY (h.applicable_funds))
           ORDER BY (h.code = 'DEFAULT') ASC, COALESCE(h.sort_order, 999) ASC, h.code ASC
           LIMIT 1) AS rule_json
    FROM public.ce_cases c
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

GRANT SELECT ON public.ce_v_legal_referral_candidate TO authenticated, service_role;