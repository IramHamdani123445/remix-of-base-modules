-- ============================================================
-- Legal Escalation Recommendation Review Workspace — foundation
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ce_legal_recommendation_ref (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  code text NOT NULL,
  label text NOT NULL,
  description text,
  tone text,
  display_order integer NOT NULL DEFAULT 100,
  aliases text[] NOT NULL DEFAULT ARRAY[]::text[],
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (domain, code)
);

GRANT SELECT ON public.ce_legal_recommendation_ref TO authenticated;
GRANT ALL ON public.ce_legal_recommendation_ref TO service_role;
ALTER TABLE public.ce_legal_recommendation_ref ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ce_legal_rec_ref_read" ON public.ce_legal_recommendation_ref;
CREATE POLICY "ce_legal_rec_ref_read" ON public.ce_legal_recommendation_ref
  FOR SELECT TO authenticated USING (true);

DROP TRIGGER IF EXISTS zz_ce_legal_rec_ref_touch ON public.ce_legal_recommendation_ref;
CREATE TRIGGER zz_ce_legal_rec_ref_touch
  BEFORE UPDATE ON public.ce_legal_recommendation_ref
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.ce_legal_recommendation_ref (domain, code, label, description, tone, display_order, aliases) VALUES
  ('REC_STATUS','PENDING_REVIEW','Pending Review','Awaiting management review','info',10,ARRAY['PENDING','PENDING_REVIEW','SUBMITTED']),
  ('REC_STATUS','APPROVED_FOR_REFERRAL','Approved for Referral','Approved; referral minted for pack preparation','success',20,ARRAY['APPROVED','APPROVED_FOR_REFERRAL']),
  ('REC_STATUS','REFERRAL_CREATED','Referral Created','Referral exists and is progressing','success',30,ARRAY['REFERRAL_CREATED']),
  ('REC_STATUS','REJECTED','Rejected','Management declined legal escalation','danger',40,ARRAY['REJECTED','DECLINED']),
  ('REC_STATUS','WITHDRAWN','Withdrawn','Withdrawn before review','muted',50,ARRAY['WITHDRAWN','CANCELLED']),

  ('RISK_BAND','CRITICAL','Critical','danger',NULL,10,ARRAY['CRITICAL','SEVERE']),
  ('RISK_BAND','HIGH','High',NULL,'danger',20,ARRAY['HIGH']),
  ('RISK_BAND','MEDIUM','Medium',NULL,'warning',30,ARRAY['MEDIUM','MODERATE']),
  ('RISK_BAND','LOW','Low',NULL,'success',40,ARRAY['LOW','MINIMAL']),
  ('RISK_BAND','UNRATED','Not Rated',NULL,'muted',50,ARRAY['','UNRATED','NONE']),

  ('SOURCE','RECOMMEND_LEGAL','Officer Recommendation',NULL,NULL,10,ARRAY['RECOMMEND_LEGAL']),
  ('SOURCE','REFER_TO_LEGAL','Case Referral',NULL,NULL,20,ARRAY['REFER_TO_LEGAL']),
  ('SOURCE','QUICK_FORWARD','Quick Forward (Expedited)',NULL,'warning',30,ARRAY['QUICK_FORWARD']),
  ('SOURCE','SYSTEM_DETECTION','System Detection',NULL,NULL,40,ARRAY['SYSTEM','DETECTION','AUTO']),

  ('LEGAL_STATE','NONE','No Referral',NULL,'muted',10,ARRAY['NONE']),
  ('LEGAL_STATE','DRAFT','Pack in Preparation',NULL,'info',20,ARRAY['DRAFT','PACK_PREPARATION','IN_PREPARATION']),
  ('LEGAL_STATE','PENDING_APPROVAL','Pending Handover Approval',NULL,'warning',30,ARRAY['PENDING_APPROVAL','AWAITING_APPROVAL','PACK_READY']),
  ('LEGAL_STATE','SUBMITTED','Submitted to Legal',NULL,'info',40,ARRAY['SUBMITTED','SUBMITTED_TO_LEGAL']),
  ('LEGAL_STATE','ACCEPTED','Accepted by Legal',NULL,'success',50,ARRAY['ACCEPTED','ACCEPTED_BY_LEGAL']),
  ('LEGAL_STATE','IN_PROCEEDINGS','In Legal Proceedings',NULL,'success',60,ARRAY['IN_LEGAL_PROCEEDINGS','IN_PROCEEDINGS']),
  ('LEGAL_STATE','RETURNED','Returned by Legal',NULL,'warning',70,ARRAY['RETURNED','RETURNED_BY_LEGAL']),
  ('LEGAL_STATE','CLOSED','Closed',NULL,'muted',80,ARRAY['CLOSED','COMPLETED','DISPOSED'])
ON CONFLICT (domain, code) DO UPDATE
  SET label = EXCLUDED.label, tone = EXCLUDED.tone, description = EXCLUDED.description,
      display_order = EXCLUDED.display_order, aliases = EXCLUDED.aliases, updated_at = now();

-- Label resolver: canonical business label, never a raw enum.
CREATE OR REPLACE FUNCTION public.ce_legal_rec_label(_domain text, _code text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object('code', r.code, 'label', r.label, 'tone', r.tone)
       FROM public.ce_legal_recommendation_ref r
      WHERE r.domain = _domain
        AND (r.code = upper(COALESCE(_code,'')) OR upper(COALESCE(_code,'')) = ANY (r.aliases))
      ORDER BY r.display_order
      LIMIT 1),
    jsonb_build_object('code', COALESCE(_code,''), 'label',
      CASE WHEN _domain = 'REC_STATUS' THEN 'Unmapped Recommendation Status'
           WHEN _domain = 'RISK_BAND' THEN 'Not Rated'
           WHEN _domain = 'LEGAL_STATE' THEN 'Unmapped Legal State'
           ELSE 'Unmapped Value' END,
      'tone','muted')
  );
$$;

-- ------------------------------------------------------------
-- Register view — one row per recommendation, no N+1 in callers
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.ce_v_legal_recommendation_register AS
SELECT
  rec.id                                        AS recommendation_id,
  rec.employer_id,
  rec.employer_name,
  COALESCE(NULLIF(rec.employer_zone,''),'Unassigned')       AS zone,
  UPPER(COALESCE(NULLIF(rec.risk_band,''),'UNRATED'))       AS risk_code,
  COALESCE(rec.risk_score,0)                    AS risk_score,
  CASE UPPER(COALESCE(rec.risk_band,''))
    WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END AS risk_rank,
  rec.status                                    AS status_code,
  rec.recommendation_type,
  COALESCE(rec.entry_path, CASE WHEN rec.recommended_by IS NULL THEN 'SYSTEM_DETECTION' ELSE 'RECOMMEND_LEGAL' END) AS source_code,
  rec.recommended_by,
  rec.recommendation_reason,
  rec.recommended_date,
  COALESCE(rec.recommended_at, rec.created_at)  AS recommended_at,
  rec.reviewed_by,
  rec.reviewed_date,
  rec.review_notes,
  rec.source_case_id,
  cse.case_number                               AS source_case_number,
  cse.status                                    AS source_case_status,
  cse.assigned_officer_name,
  COALESCE(rec.total_principal,0)               AS total_principal,
  COALESCE(rec.total_penalties,0)               AS total_penalties,
  COALESCE(rec.total_interest,0)                AS total_interest,
  COALESCE(rec.grand_total,0)                   AS grand_total,
  COALESCE(jsonb_array_length(COALESCE(rec.subcase_summary,'[]'::jsonb)), 0) AS qualifying_case_count,
  rec.subcase_summary,
  rec.triggered_rules,
  (SELECT string_agg(DISTINCT r->>'ruleName', ' • ')
     FROM jsonb_array_elements(COALESCE(rec.triggered_rules,'[]'::jsonb)) r) AS rule_summary,
  (SELECT array_agg(DISTINCT r->>'ruleName')
     FROM jsonb_array_elements(COALESCE(rec.triggered_rules,'[]'::jsonb)) r) AS rule_names,
  rec.eligibility_snapshot,
  rec.financial_snapshot,
  rec.policy_snapshot,
  -- referral linkage (approval mints exactly one referral)
  ref.id                                        AS referral_id,
  ref.referral_number,
  ref.status                                    AS referral_status,
  ref.created_at                                AS referral_created_at,
  ref.submitted_date                            AS referral_submitted_date,
  ref.accepted_date                             AS referral_accepted_date,
  ref.returned_at                               AS referral_returned_at,
  ref.lg_intake_no,
  ref.lg_case_no,
  ref.court_case_number,
  CASE
    WHEN ref.id IS NULL THEN 'NONE'
    WHEN ref.returned_at IS NOT NULL AND COALESCE(ref.status,'') NOT IN ('CLOSED','COMPLETED') THEN 'RETURNED'
    ELSE COALESCE(ref.status,'DRAFT')
  END                                           AS legal_state_code,
  GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(rec.recommended_at, rec.created_at))) / 3600.0)::numeric(12,2) AS waiting_hours,
  lower(concat_ws(' ',
    rec.employer_name, rec.employer_id, cse.case_number, ref.referral_number,
    ref.lg_intake_no, ref.lg_case_no, ref.court_case_number, rec.recommendation_reason,
    (SELECT string_agg(s->>'caseNumber',' ') FROM jsonb_array_elements(COALESCE(rec.subcase_summary,'[]'::jsonb)) s),
    (SELECT string_agg(r->>'ruleName',' ') FROM jsonb_array_elements(COALESCE(rec.triggered_rules,'[]'::jsonb)) r)
  ))                                            AS search_blob
FROM public.ce_legal_recommendations rec
LEFT JOIN public.ce_cases cse ON cse.id = rec.source_case_id
LEFT JOIN LATERAL (
  SELECT r.* FROM public.ce_legal_referrals r
   WHERE r.id = rec.legal_referral_id OR r.recommendation_id = rec.id
   ORDER BY r.created_at DESC
   LIMIT 1
) ref ON true;

GRANT SELECT ON public.ce_v_legal_recommendation_register TO authenticated, service_role;

-- Repair legacy approvals whose referral link was never written back.
UPDATE public.ce_legal_recommendations rec
   SET legal_referral_id = r.id, updated_at = now()
  FROM public.ce_legal_referrals r
 WHERE r.recommendation_id = rec.id
   AND rec.legal_referral_id IS NULL;

-- ------------------------------------------------------------
-- Register RPC
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_legal_recommendation_register_v1(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort text DEFAULT 'priority',
  p_dir text DEFAULT 'desc',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_can_view boolean;
  v_can_decide boolean;
  v_can_generate boolean;
  v_sla_days numeric;
  v_high_value numeric;
  v_stall_days numeric;
  v_page integer := GREATEST(1, COALESCE(p_page,1));
  v_size integer := LEAST(200, GREATEST(1, COALESCE(p_page_size,25)));
  v_dir text := CASE WHEN lower(COALESCE(p_dir,'desc')) = 'asc' THEN 'asc' ELSE 'desc' END;
  v_rows jsonb;
  v_total bigint;
  v_kpis jsonb;
  v_tabs jsonb;
  v_attention jsonb;
  v_facets jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error','NOT_AUTHENTICATED');
  END IF;

  v_can_view := public.ce_actor_can(v_uid, 'compliance.enforcement.legal');
  IF NOT v_can_view THEN
    RETURN jsonb_build_object('error','NOT_AUTHORISED');
  END IF;

  v_actor        := public.ce_actor_user_code(v_uid);
  v_can_decide   := public.ce_actor_can(v_uid, 'compliance.legal.recommend_approve');
  v_can_generate := public.ce_actor_can(v_uid, 'compliance.config.manage')
                 OR public.ce_actor_can(v_uid, 'compliance.legal.recommend_approve');

  SELECT COALESCE(MAX(CASE WHEN setting_key='compliance.legal.approval_sla_days' THEN setting_value::numeric END), 3),
         COALESCE(MAX(CASE WHEN setting_key='compliance.legal.high_value_threshold' THEN setting_value::numeric END), 50000),
         COALESCE(MAX(CASE WHEN setting_key='compliance.monitoring.stall_days.legal_referral' THEN setting_value::numeric END), 7)
    INTO v_sla_days, v_high_value, v_stall_days
    FROM public.ce_settings
   WHERE setting_key IN ('compliance.legal.approval_sla_days',
                         'compliance.legal.high_value_threshold',
                         'compliance.monitoring.stall_days.legal_referral');

  CREATE TEMP TABLE IF NOT EXISTS tmp_noop_ce_rec (x int) ON COMMIT DROP;

  WITH base AS (
    SELECT v.*,
           (public.ce_legal_rec_label('REC_STATUS', v.status_code))    AS status_json,
           (public.ce_legal_rec_label('RISK_BAND',  v.risk_code))      AS risk_json,
           (public.ce_legal_rec_label('SOURCE',     v.source_code))    AS source_json,
           (public.ce_legal_rec_label('LEGAL_STATE',v.legal_state_code)) AS legal_json,
           (v.status_code = 'PENDING_REVIEW')                          AS is_pending,
           (v.status_code = 'PENDING_REVIEW' AND v.waiting_hours > v_sla_days * 24)      AS review_overdue,
           (v.status_code = 'PENDING_REVIEW' AND v.waiting_hours > (v_sla_days - 1) * 24
              AND v.waiting_hours <= v_sla_days * 24)                  AS review_due_soon,
           (v.grand_total >= v_high_value)                             AS high_value,
           (v.status_code IN ('APPROVED_FOR_REFERRAL','REFERRAL_CREATED') AND v.referral_id IS NULL) AS approved_no_referral,
           (v.referral_id IS NOT NULL AND v.legal_state_code = 'DRAFT'
              AND v.referral_created_at < now() - (v_stall_days || ' days')::interval)   AS pack_stalled,
           (v.recommended_by IS NOT NULL AND v.recommended_by = v_actor) AS is_own_recommendation
      FROM public.ce_v_legal_recommendation_register v
  ),
  filtered AS (
    SELECT b.* FROM base b
     WHERE (COALESCE(p_filters->>'search','') = ''
            OR b.search_blob LIKE '%' || lower(p_filters->>'search') || '%')
       AND (COALESCE(p_filters->>'status','') = ''
            OR (b.status_json->>'code') = p_filters->>'status')
       AND (COALESCE(p_filters->>'risk','') = ''
            OR (b.risk_json->>'code') = p_filters->>'risk')
       AND (COALESCE(p_filters->>'zone','') = '' OR b.zone = p_filters->>'zone')
       AND (COALESCE(p_filters->>'source','') = ''
            OR (b.source_json->>'code') = p_filters->>'source')
       AND (COALESCE(p_filters->>'legal_state','') = ''
            OR (b.legal_json->>'code') = p_filters->>'legal_state')
       AND (COALESCE(p_filters->>'rule','') = ''
            OR p_filters->>'rule' = ANY (COALESCE(b.rule_names, ARRAY[]::text[])))
       AND (COALESCE(p_filters->>'amount_min','') = ''
            OR b.grand_total >= (p_filters->>'amount_min')::numeric)
       AND (COALESCE(p_filters->>'amount_max','') = ''
            OR b.grand_total <= (p_filters->>'amount_max')::numeric)
       AND (COALESCE(p_filters->>'date_from','') = ''
            OR b.recommended_date >= (p_filters->>'date_from')::date)
       AND (COALESCE(p_filters->>'date_to','') = ''
            OR b.recommended_date <= (p_filters->>'date_to')::date)
       AND (COALESCE(p_filters->>'tab','ALL') = 'ALL'
            OR (p_filters->>'tab' = 'PENDING'    AND b.is_pending)
            OR (p_filters->>'tab' = 'OVERDUE'    AND b.review_overdue)
            OR (p_filters->>'tab' = 'APPROVED'   AND b.status_code IN ('APPROVED_FOR_REFERRAL','REFERRAL_CREATED'))
            OR (p_filters->>'tab' = 'REFERRED'   AND b.referral_id IS NOT NULL)
            OR (p_filters->>'tab' = 'REJECTED'   AND b.status_code = 'REJECTED')
            OR (p_filters->>'tab' = 'HIGH_RISK'  AND b.risk_rank >= 3)
            OR (p_filters->>'tab' = 'HIGH_VALUE' AND b.high_value))
  ),
  paged AS (
    SELECT f.* FROM filtered f
     ORDER BY
       CASE WHEN p_sort = 'priority'   THEN (CASE WHEN f.review_overdue THEN 1000000 ELSE 0 END
                                             + f.risk_rank * 10000 + LEAST(f.waiting_hours, 9000)) END DESC NULLS LAST,
       CASE WHEN p_sort = 'waiting'   AND v_dir='desc' THEN f.waiting_hours END DESC NULLS LAST,
       CASE WHEN p_sort = 'waiting'   AND v_dir='asc'  THEN f.waiting_hours END ASC  NULLS LAST,
       CASE WHEN p_sort = 'recommended' AND v_dir='desc' THEN f.recommended_at END DESC NULLS LAST,
       CASE WHEN p_sort = 'recommended' AND v_dir='asc'  THEN f.recommended_at END ASC  NULLS LAST,
       CASE WHEN p_sort = 'risk'      AND v_dir='desc' THEN f.risk_rank END DESC NULLS LAST,
       CASE WHEN p_sort = 'risk'      AND v_dir='asc'  THEN f.risk_rank END ASC  NULLS LAST,
       CASE WHEN p_sort = 'amount'    AND v_dir='desc' THEN f.grand_total END DESC NULLS LAST,
       CASE WHEN p_sort = 'amount'    AND v_dir='asc'  THEN f.grand_total END ASC  NULLS LAST,
       CASE WHEN p_sort = 'cases'     AND v_dir='desc' THEN f.qualifying_case_count END DESC NULLS LAST,
       CASE WHEN p_sort = 'cases'     AND v_dir='asc'  THEN f.qualifying_case_count END ASC  NULLS LAST,
       CASE WHEN p_sort = 'employer'  AND v_dir='asc'  THEN lower(f.employer_name) END ASC  NULLS LAST,
       CASE WHEN p_sort = 'employer'  AND v_dir='desc' THEN lower(f.employer_name) END DESC NULLS LAST,
       CASE WHEN p_sort = 'zone'      AND v_dir='asc'  THEN lower(f.zone) END ASC NULLS LAST,
       CASE WHEN p_sort = 'zone'      AND v_dir='desc' THEN lower(f.zone) END DESC NULLS LAST,
       CASE WHEN p_sort = 'status'    AND v_dir='asc'  THEN (f.status_json->>'label') END ASC NULLS LAST,
       CASE WHEN p_sort = 'status'    AND v_dir='desc' THEN (f.status_json->>'label') END DESC NULLS LAST,
       f.recommended_at DESC
     OFFSET (v_page - 1) * v_size
     LIMIT v_size
  )
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'recommendation_id', p.recommendation_id,
        'employer_id', p.employer_id,
        'employer_name', p.employer_name,
        'zone', p.zone,
        'risk_code', p.risk_json->>'code',
        'risk_label', p.risk_json->>'label',
        'risk_tone', p.risk_json->>'tone',
        'risk_score', p.risk_score,
        'status_code', p.status_json->>'code',
        'status_label', p.status_json->>'label',
        'status_tone', p.status_json->>'tone',
        'source_code', p.source_json->>'code',
        'source_label', p.source_json->>'label',
        'legal_state_code', p.legal_json->>'code',
        'legal_state_label', p.legal_json->>'label',
        'legal_state_tone', p.legal_json->>'tone',
        'recommended_by', p.recommended_by,
        'recommended_at', p.recommended_at,
        'recommended_date', p.recommended_date,
        'recommendation_reason', p.recommendation_reason,
        'rule_summary', p.rule_summary,
        'triggered_rules', COALESCE(p.triggered_rules,'[]'::jsonb),
        'qualifying_case_count', p.qualifying_case_count,
        'source_case_id', p.source_case_id,
        'source_case_number', p.source_case_number,
        'assigned_officer_name', p.assigned_officer_name,
        'total_principal', p.total_principal,
        'total_penalties', p.total_penalties,
        'total_interest', p.total_interest,
        'grand_total', p.grand_total,
        'referral_id', p.referral_id,
        'referral_number', p.referral_number,
        'referral_status', p.referral_status,
        'lg_intake_no', p.lg_intake_no,
        'lg_case_no', p.lg_case_no,
        'court_case_number', p.court_case_number,
        'reviewed_by', p.reviewed_by,
        'reviewed_date', p.reviewed_date,
        'review_notes', p.review_notes,
        'waiting_hours', p.waiting_hours,
        'is_pending', p.is_pending,
        'review_overdue', p.review_overdue,
        'review_due_soon', p.review_due_soon,
        'high_value', p.high_value,
        'approved_no_referral', p.approved_no_referral,
        'pack_stalled', p.pack_stalled,
        'is_own_recommendation', p.is_own_recommendation
      ) ORDER BY 1) FROM paged p), '[]'::jsonb),
    (SELECT count(*) FROM filtered),
    (SELECT jsonb_build_object(
        'pending', count(*) FILTER (WHERE b.is_pending),
        'overdue', count(*) FILTER (WHERE b.review_overdue),
        'high_risk_pending', count(*) FILTER (WHERE b.is_pending AND b.risk_rank >= 3),
        'approved', count(*) FILTER (WHERE b.status_code IN ('APPROVED_FOR_REFERRAL','REFERRAL_CREATED')),
        'rejected', count(*) FILTER (WHERE b.status_code = 'REJECTED'),
        'referred', count(*) FILTER (WHERE b.referral_id IS NOT NULL),
        'employers', count(DISTINCT b.employer_id),
        'qualifying_cases', COALESCE(sum(b.qualifying_case_count),0),
        'pending_exposure', COALESCE(sum(b.grand_total) FILTER (WHERE b.is_pending),0),
        'total_exposure', COALESCE(sum(b.grand_total),0),
        'oldest_pending_hours', COALESCE(max(b.waiting_hours) FILTER (WHERE b.is_pending),0)
      ) FROM base b),
    (SELECT jsonb_object_agg(k, v) FROM (
        SELECT 'ALL' AS k, count(*) AS v FROM base
        UNION ALL SELECT 'PENDING',    count(*) FROM base WHERE is_pending
        UNION ALL SELECT 'OVERDUE',    count(*) FROM base WHERE review_overdue
        UNION ALL SELECT 'APPROVED',   count(*) FROM base WHERE status_code IN ('APPROVED_FOR_REFERRAL','REFERRAL_CREATED')
        UNION ALL SELECT 'REFERRED',   count(*) FROM base WHERE referral_id IS NOT NULL
        UNION ALL SELECT 'REJECTED',   count(*) FROM base WHERE status_code = 'REJECTED'
        UNION ALL SELECT 'HIGH_RISK',  count(*) FROM base WHERE risk_rank >= 3
        UNION ALL SELECT 'HIGH_VALUE', count(*) FROM base WHERE high_value
      ) t),
    COALESCE((SELECT jsonb_agg(a ORDER BY a->>'priority') FROM (
        SELECT jsonb_build_object(
                 'recommendation_id', b.recommendation_id,
                 'employer_name', b.employer_name,
                 'amount', b.grand_total,
                 'status_label', b.status_json->>'label',
                 'priority', CASE reason WHEN 'REVIEW_OVERDUE' THEN 1 WHEN 'CRITICAL_PENDING' THEN 2
                                         WHEN 'APPROVED_NO_REFERRAL' THEN 3 WHEN 'PACK_STALLED' THEN 4
                                         WHEN 'HIGH_VALUE_PENDING' THEN 5 ELSE 6 END,
                 'reason', reason) AS a
          FROM base b
          CROSS JOIN LATERAL (
            SELECT unnest(ARRAY[
              CASE WHEN b.review_overdue THEN 'REVIEW_OVERDUE' END,
              CASE WHEN b.is_pending AND b.risk_rank = 4 THEN 'CRITICAL_PENDING' END,
              CASE WHEN b.approved_no_referral THEN 'APPROVED_NO_REFERRAL' END,
              CASE WHEN b.pack_stalled THEN 'PACK_STALLED' END,
              CASE WHEN b.is_pending AND b.high_value THEN 'HIGH_VALUE_PENDING' END,
              CASE WHEN b.is_pending AND b.source_case_id IS NULL
                    AND COALESCE(b.qualifying_case_count,0) = 0 THEN 'NO_SOURCE_CASE' END
            ]) AS reason
          ) r
         WHERE reason IS NOT NULL
         LIMIT 12
      ) s), '[]'::jsonb),
    jsonb_build_object(
      'statuses', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object(
                      'code', status_json->>'code', 'label', status_json->>'label')) FROM base), '[]'::jsonb),
      'risks',    COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object(
                      'code', risk_json->>'code', 'label', risk_json->>'label')) FROM base), '[]'::jsonb),
      'sources',  COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object(
                      'code', source_json->>'code', 'label', source_json->>'label')) FROM base), '[]'::jsonb),
      'legal_states', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object(
                      'code', legal_json->>'code', 'label', legal_json->>'label')) FROM base), '[]'::jsonb),
      'zones',    COALESCE((SELECT jsonb_agg(DISTINCT zone) FROM base), '[]'::jsonb),
      'rules',    COALESCE((SELECT jsonb_agg(DISTINCT rn) FROM base b2,
                      LATERAL unnest(COALESCE(b2.rule_names, ARRAY[]::text[])) rn), '[]'::jsonb)
    )
  INTO v_rows, v_total, v_kpis, v_tabs, v_attention, v_facets;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'page', v_page,
    'page_size', v_size,
    'kpis', v_kpis,
    'tab_counts', v_tabs,
    'attention', v_attention,
    'facets', v_facets,
    'thresholds', jsonb_build_object(
      'review_sla_days', v_sla_days,
      'high_value', v_high_value,
      'pack_stall_days', v_stall_days),
    'actor', jsonb_build_object(
      'user_code', v_actor,
      'can_decide', v_can_decide,
      'can_generate', v_can_generate)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ce_legal_recommendation_register_v1(jsonb, text, text, integer, integer) TO authenticated;

-- ------------------------------------------------------------
-- Detail RPC — review panel with rule explainability + history
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_legal_recommendation_detail_v1(p_recommendation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_can_decide boolean;
  v_row jsonb;
  v_timeline jsonb;
  v_sla numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','NOT_AUTHENTICATED'); END IF;
  IF NOT public.ce_actor_can(v_uid, 'compliance.enforcement.legal') THEN
    RETURN jsonb_build_object('error','NOT_AUTHORISED');
  END IF;

  v_actor      := public.ce_actor_user_code(v_uid);
  v_can_decide := public.ce_actor_can(v_uid, 'compliance.legal.recommend_approve');

  SELECT COALESCE(setting_value::numeric, 3) INTO v_sla
    FROM public.ce_settings WHERE setting_key = 'compliance.legal.approval_sla_days';
  v_sla := COALESCE(v_sla, 3);

  SELECT to_jsonb(v) ||
         jsonb_build_object(
           'status_label',      public.ce_legal_rec_label('REC_STATUS',  v.status_code)->>'label',
           'status_tone',       public.ce_legal_rec_label('REC_STATUS',  v.status_code)->>'tone',
           'risk_label',        public.ce_legal_rec_label('RISK_BAND',   v.risk_code)->>'label',
           'source_label',      public.ce_legal_rec_label('SOURCE',      v.source_code)->>'label',
           'legal_state_label', public.ce_legal_rec_label('LEGAL_STATE', v.legal_state_code)->>'label',
           'review_overdue',    (v.status_code = 'PENDING_REVIEW' AND v.waiting_hours > v_sla * 24),
           'is_own_recommendation', (v.recommended_by IS NOT NULL AND v.recommended_by = v_actor))
    INTO v_row
    FROM public.ce_v_legal_recommendation_register v
   WHERE v.recommendation_id = p_recommendation_id;

  IF v_row IS NULL THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;

  SELECT COALESCE(jsonb_agg(e ORDER BY e->>'at'), '[]'::jsonb) INTO v_timeline
  FROM (
    SELECT jsonb_build_object('at', COALESCE(rec.recommended_at, rec.created_at),
                              'code','RECOMMENDED','label','Recommendation raised',
                              'actor', COALESCE(rec.recommended_by, rec.created_by)) AS e
      FROM public.ce_legal_recommendations rec WHERE rec.id = p_recommendation_id
    UNION ALL
    SELECT jsonb_build_object('at', rec.reviewed_date,
             'code', CASE WHEN rec.status='REJECTED' THEN 'REJECTED' ELSE 'APPROVED' END,
             'label', CASE WHEN rec.status='REJECTED' THEN 'Rejected by management'
                           ELSE 'Approved for referral' END,
             'actor', rec.reviewed_by, 'note', rec.review_notes)
      FROM public.ce_legal_recommendations rec
     WHERE rec.id = p_recommendation_id AND rec.reviewed_date IS NOT NULL
    UNION ALL
    SELECT jsonb_build_object('at', r.created_at, 'code','REFERRAL_CREATED',
             'label','Referral ' || r.referral_number || ' created (pack preparation)',
             'actor', r.created_by)
      FROM public.ce_legal_referrals r WHERE r.recommendation_id = p_recommendation_id
    UNION ALL
    SELECT jsonb_build_object('at', r.approval_requested_at, 'code','HANDOVER_REQUESTED',
             'label','Handover approval requested','actor', r.approval_requested_by)
      FROM public.ce_legal_referrals r
     WHERE r.recommendation_id = p_recommendation_id AND r.approval_requested_at IS NOT NULL
    UNION ALL
    SELECT jsonb_build_object('at', r.submitted_date, 'code','SUBMITTED','label','Submitted to Legal',
             'actor', r.referred_by)
      FROM public.ce_legal_referrals r
     WHERE r.recommendation_id = p_recommendation_id AND r.submitted_date IS NOT NULL
    UNION ALL
    SELECT jsonb_build_object('at', r.accepted_date, 'code','ACCEPTED','label','Accepted by Legal',
             'actor', r.accepted_by)
      FROM public.ce_legal_referrals r
     WHERE r.recommendation_id = p_recommendation_id AND r.accepted_date IS NOT NULL
    UNION ALL
    SELECT jsonb_build_object('at', r.returned_at, 'code','RETURNED','label','Returned by Legal',
             'actor', r.returned_by, 'note', r.return_reason)
      FROM public.ce_legal_referrals r
     WHERE r.recommendation_id = p_recommendation_id AND r.returned_at IS NOT NULL
  ) s;

  RETURN jsonb_build_object(
    'recommendation', v_row,
    'timeline', v_timeline,
    'actor', jsonb_build_object('user_code', v_actor, 'can_decide', v_can_decide)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ce_legal_recommendation_detail_v1(uuid) TO authenticated;