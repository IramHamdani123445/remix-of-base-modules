-- =====================================================================
-- Compliance -> Approved Escalations : Post-Handover Legal Tracking
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.ce_approved_escalation_ref (
  domain        text NOT NULL,
  code          text NOT NULL,
  label         text NOT NULL,
  group_code    text,
  tone          text,
  display_order integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  aliases       text[] NOT NULL DEFAULT '{}',
  numeric_value numeric,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (domain, code)
);

GRANT SELECT ON public.ce_approved_escalation_ref TO authenticated;
GRANT ALL ON public.ce_approved_escalation_ref TO service_role;
ALTER TABLE public.ce_approved_escalation_ref ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ce_approved_escalation_ref' AND policyname='ce_approved_escalation_ref_read') THEN
    CREATE POLICY ce_approved_escalation_ref_read ON public.ce_approved_escalation_ref
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

INSERT INTO public.ce_approved_escalation_ref (domain, code, label, group_code, tone, display_order, aliases) VALUES
  ('STATUS','SUBMITTED_TO_LEGAL','Submitted to Legal','ACTIVE','info',10,ARRAY['SUBMITTED']),
  ('STATUS','ACCEPTED_BY_LEGAL','Accepted by Legal','ACTIVE','success',20,ARRAY['ACCEPTED']),
  ('STATUS','IN_LEGAL_PROCEEDINGS','In Legal Proceedings','ACTIVE','success',30,ARRAY['IN_PROCEEDINGS']),
  ('STATUS','RETURNED_BY_LEGAL','Returned by Legal','REWORK','warning',40,ARRAY['RETURNED']),
  ('STATUS','CLOSED','Closed','TERMINAL','muted',50,ARRAY[]::text[]),
  ('LEGAL_STATUS','AWAITING_LEGAL','Awaiting Legal Acceptance',NULL,'warning',10,ARRAY[]::text[]),
  ('LEGAL_STATUS','INTAKE_REVIEW','Intake Review',NULL,'info',20,ARRAY['INTAKE','INTAKE_ASSESSMENT','NEW']),
  ('LEGAL_STATUS','ACCEPTED','Accepted',NULL,'info',30,ARRAY['OPEN','ACTIVE']),
  ('LEGAL_STATUS','PRE_ACTION','Pre-Action',NULL,'info',40,ARRAY['PRE_ACTION_NOTICE','DEMAND']),
  ('LEGAL_STATUS','PROCEEDINGS','Proceedings',NULL,'info',50,ARRAY['FILED','IN_COURT','HEARING','LITIGATION']),
  ('LEGAL_STATUS','JUDGMENT','Judgment',NULL,'success',60,ARRAY['JUDGMENT_ISSUED','JUDGMENT_GRANTED','ORDER']),
  ('LEGAL_STATUS','ENFORCEMENT','Enforcement',NULL,'warning',70,ARRAY['EXECUTION']),
  ('LEGAL_STATUS','RECOVERY','Recovery',NULL,'info',80,ARRAY['RECOVERY_ONGOING','COLLECTION']),
  ('LEGAL_STATUS','CLOSED','Closed',NULL,'muted',90,ARRAY['DISPOSED','COMPLETED']),
  ('ORIGIN','CASE','Compliance Case',NULL,NULL,10,ARRAY['COMPLIANCE','CE_CASE']),
  ('ORIGIN','VIOLATION','Violation',NULL,NULL,20,ARRAY['CE_VIOLATION']),
  ('ORIGIN','ARRANGEMENT_BREACH','Arrangement Breach',NULL,NULL,30,ARRAY['BREACH','ARRANGEMENT']),
  ('ORIGIN','NOTICE','Notice Escalation',NULL,NULL,40,ARRAY['ENFORCEMENT_NOTICE']),
  ('ORIGIN','RECOMMENDATION','Legal Recommendation',NULL,NULL,50,ARRAY['LEGAL_RECOMMENDATION']),
  ('RECOVERY','NOT_STARTED','Not started',NULL,'muted',10,ARRAY[]::text[]),
  ('RECOVERY','IN_PROGRESS','Recovery in progress',NULL,'info',20,ARRAY[]::text[]),
  ('RECOVERY','ARRANGEMENT','Under arrangement',NULL,'info',30,ARRAY[]::text[]),
  ('RECOVERY','PARTIAL','Partially recovered',NULL,'warning',40,ARRAY[]::text[]),
  ('RECOVERY','FULLY_RECOVERED','Fully recovered',NULL,'success',50,ARRAY[]::text[]),
  ('RECOVERY','UNRECOVERABLE','Unrecoverable',NULL,'destructive',60,ARRAY[]::text[])
ON CONFLICT (domain, code) DO UPDATE
  SET label = EXCLUDED.label, tone = EXCLUDED.tone,
      group_code = EXCLUDED.group_code,
      display_order = EXCLUDED.display_order,
      aliases = EXCLUDED.aliases, updated_at = now();

INSERT INTO public.ce_settings (setting_key, setting_value, data_type, description, category)
VALUES
  ('compliance.legal.acceptance_sla_days','5','number','Days Legal has to accept a submitted referral before it is overdue','LEGAL'),
  ('compliance.legal.acceptance_due_soon_days','2','number','Days before the acceptance SLA at which a referral is flagged Due Soon','LEGAL'),
  ('compliance.legal.update_stale_days','14','number','Days without a Legal update after which a handed-over referral is flagged stale','LEGAL')
ON CONFLICT (setting_key) DO NOTHING;

-- ---------------------------------------------------------------------
-- Register view : one row per handed-over referral
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.ce_v_approved_escalation_register AS
WITH ret AS (
  SELECT DISTINCT ON (x.referral_id) x.referral_id, x.returned_at, x.reason, x.required_action, x.resolution_status
  FROM public.ce_legal_returns x
  ORDER BY x.referral_id, x.returned_at DESC NULLS LAST
)
SELECT
  r.id                                                     AS referral_id,
  r.referral_number,
  r.status                                                 AS referral_status,
  r.employer_id                                            AS employer_reg_no,
  r.employer_name,
  COALESCE(r.employer_zone, cc.territory)                  AS zone,
  cc.id                                                    AS ce_case_id,
  cc.case_number                                           AS ce_case_number,
  COALESCE(r.referral_reason_code,'UNSPECIFIED')           AS reason_code,
  r.referral_reason_text,
  COALESCE(NULLIF(r.source_module,''), 'CASE')             AS origin_code,
  r.source_reference_no,
  COALESCE(r.total_principal,0)                            AS principal_amount,
  COALESCE(r.total_penalties,0)                            AS penalty_amount,
  COALESCE(r.total_interest,0)                             AS interest_amount,
  COALESCE(NULLIF(r.grand_total,0), r.total_referred_amount, 0) AS total_referred,
  p.outstanding_amount,
  p.recovered_amount,
  COALESCE(p.recovery_status_code,'NOT_STARTED')           AS recovery_status_code,
  r.approved_at, r.approved_by,
  r.pack_completed_at,
  COALESCE(r.referred_by, r.created_by)                    AS submitted_by,
  r.submitted_date,
  r.accepted_date,
  r.accepted_by,
  r.lg_intake_id,
  r.lg_intake_no,
  COALESCE(r.lg_case_no, c.lg_case_no)                     AS lg_case_no,
  COALESCE(r.legal_case_id, c.id)                          AS legal_case_id,
  COALESCE(r.court_case_number, c.court_case_no)           AS court_case_no,
  c.court_name,
  COALESCE(r.legal_officer_assigned, c.assigned_team_code::text) AS legal_officer,
  c.next_hearing_date,
  ret.returned_at,
  ret.reason                                               AS return_reason,
  ret.resolution_status                                    AS return_resolution_status,
  r.returned_at                                            AS referral_returned_at,
  r.return_reason                                          AS referral_return_reason,
  -- Latest Legal status : authoritative source is the Legal case, falling back
  -- to the handover state when Legal has not yet opened a matter.
  CASE
    WHEN c.id IS NULL AND r.status = 'SUBMITTED_TO_LEGAL' THEN 'AWAITING_LEGAL'
    WHEN c.id IS NULL AND r.status = 'RETURNED_BY_LEGAL'  THEN 'INTAKE_REVIEW'
    WHEN c.id IS NULL AND r.status = 'CLOSED'             THEN 'CLOSED'
    WHEN c.id IS NULL                                     THEN 'ACCEPTED'
    ELSE COALESCE(NULLIF(c.current_stage_code::text,''), NULLIF(c.status_code::text,''), 'ACCEPTED')
  END                                                      AS legal_status_raw,
  GREATEST(
    COALESCE(p.last_legal_update, r.updated_at, r.created_at),
    COALESCE(c.updated_at,        r.updated_at, r.created_at),
    COALESCE(r.updated_at,        r.created_at)
  )                                                        AS last_legal_update,
  CASE
    WHEN r.submitted_date IS NULL THEN NULL
    ELSE EXTRACT(EPOCH FROM (COALESCE(r.accepted_date, now()) - r.submitted_date)) / 3600.0
  END                                                      AS waiting_hours,
  (r.status = 'SUBMITTED_TO_LEGAL')                        AS awaiting_acceptance,
  (r.status = 'CLOSED')                                    AS is_closed,
  r.created_at, r.updated_at
FROM public.ce_legal_referrals r
LEFT JOIN public.ce_cases cc ON cc.id = r.source_case_id
LEFT JOIN LATERAL (
  SELECT lc.* FROM public.lg_case lc
  WHERE lc.id = r.legal_case_id
     OR lc.compliance_referral_id = r.id
     OR (r.lg_case_no IS NOT NULL AND lc.lg_case_no = r.lg_case_no)
     OR (r.lg_intake_id IS NOT NULL AND lc.source_intake_id = r.lg_intake_id)
  ORDER BY lc.updated_at DESC NULLS LAST
  LIMIT 1
) c ON true
LEFT JOIN public.ce_v_legal_proceeding_register p
       ON p.source = 'LEGAL' AND p.referral_id = r.id
LEFT JOIN ret ON ret.referral_id = r.id
WHERE r.status IN ('SUBMITTED_TO_LEGAL','ACCEPTED_BY_LEGAL','IN_LEGAL_PROCEEDINGS','RETURNED_BY_LEGAL','CLOSED');

GRANT SELECT ON public.ce_v_approved_escalation_register TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- Register RPC
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_approved_escalation_register_v1(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort text DEFAULT 'attention',
  p_dir text DEFAULT 'desc',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_can_view boolean; v_can_money boolean; v_can_legal boolean;
  v_page int := GREATEST(COALESCE(p_page,1),1);
  v_size int := LEAST(GREATEST(COALESCE(p_page_size,25),1),200);
  v_sort text := lower(COALESCE(p_sort,'attention'));
  v_desc boolean := lower(COALESCE(p_dir,'desc')) <> 'asc';
  v_search text := NULLIF(btrim(COALESCE(p_filters->>'search','')),'');
  v_tab text := upper(COALESCE(p_filters->>'tab','ALL'));
  v_status text := NULLIF(p_filters->>'status','');
  v_legal text := NULLIF(p_filters->>'legal_status','');
  v_zone text := NULLIF(p_filters->>'zone','');
  v_reason text := NULLIF(p_filters->>'reason_code','');
  v_origin text := NULLIF(p_filters->>'origin_code','');
  v_amin numeric := NULLIF(p_filters->>'amount_min','')::numeric;
  v_amax numeric := NULLIF(p_filters->>'amount_max','')::numeric;
  v_sfrom date := NULLIF(p_filters->>'submitted_from','')::date;
  v_sto   date := NULLIF(p_filters->>'submitted_to','')::date;
  v_upd   text := NULLIF(p_filters->>'update_window','');
  v_sla_days numeric := public.ce_setting_num('compliance.legal.acceptance_sla_days', 5);
  v_soon_days numeric := public.ce_setting_num('compliance.legal.acceptance_due_soon_days', 2);
  v_stale_days numeric := public.ce_setting_num('compliance.legal.update_stale_days', 14);
  v_high numeric := public.ce_setting_num('compliance.legal.high_value_threshold', 50000);
  v_total bigint := 0;
  v_rows jsonb := '[]'::jsonb; v_kpis jsonb := '{}'::jsonb;
  v_tabs jsonb := '{}'::jsonb; v_attention jsonb := '[]'::jsonb; v_facets jsonb := '{}'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','NOT_AUTHENTICATED'); END IF;

  v_can_view := public.is_admin(v_uid)
             OR public.ce_actor_can(v_uid,'compliance.legal.court_monitoring')
             OR public.ce_actor_can(v_uid,'compliance.enforcement.legal')
             OR public.ce_actor_can(v_uid,'compliance.workbench.enterprise')
             OR public.ce_actor_can(v_uid,'compliance.workbench.team');
  IF NOT v_can_view THEN RETURN jsonb_build_object('error','NOT_AUTHORISED'); END IF;

  v_can_money := public.is_admin(v_uid)
              OR public.ce_actor_can(v_uid,'compliance.workbench.enterprise')
              OR public.ce_actor_can(v_uid,'compliance.enforcement.legal');
  v_can_legal := public.is_admin(v_uid) OR public.ce_actor_can(v_uid,'compliance.legal.handoff');

  WITH base AS (
    SELECT v.*,
      COALESCE(sl.label,'Unmapped Referral Status') AS status_label,
      sl.tone AS status_tone,
      COALESCE(ll.label, lla.label, 'Unmapped Legal Status') AS legal_status_label,
      COALESCE(ll.code, lla.code, v.legal_status_raw) AS legal_status_code,
      COALESCE(rl.label,'Not started') AS recovery_label,
      COALESCE(orl.label, initcap(replace(v.origin_code,'_',' '))) AS origin_label,
      (v.awaiting_acceptance AND v.submitted_date < now() - (v_sla_days || ' days')::interval) AS acceptance_overdue,
      (v.awaiting_acceptance
        AND v.submitted_date >= now() - (v_sla_days || ' days')::interval
        AND v.submitted_date <  now() - ((v_sla_days - v_soon_days) || ' days')::interval) AS acceptance_due_soon,
      (NOT v.is_closed AND v.last_legal_update < now() - (v_stale_days || ' days')::interval) AS legal_stale,
      (v.referral_status = 'ACCEPTED_BY_LEGAL' AND v.lg_case_no IS NULL) AS accepted_no_case,
      (v.referral_status = 'RETURNED_BY_LEGAL') AS is_returned,
      (NOT v.is_closed AND COALESCE(v.total_referred,0) >= v_high) AS high_value
    FROM public.ce_v_approved_escalation_register v
    LEFT JOIN public.ce_approved_escalation_ref sl
           ON sl.domain='STATUS' AND sl.code = v.referral_status
    LEFT JOIN public.ce_approved_escalation_ref ll
           ON ll.domain='LEGAL_STATUS' AND ll.code = upper(v.legal_status_raw)
    LEFT JOIN public.ce_approved_escalation_ref lla
           ON lla.domain='LEGAL_STATUS' AND upper(v.legal_status_raw) = ANY (lla.aliases)
    LEFT JOIN public.ce_approved_escalation_ref rl
           ON rl.domain='RECOVERY' AND rl.code = v.recovery_status_code
    LEFT JOIN public.ce_approved_escalation_ref orl
           ON orl.domain='ORIGIN' AND (orl.code = upper(v.origin_code) OR upper(v.origin_code) = ANY (orl.aliases))
  ),
  scored AS (
    SELECT b.*,
      (CASE WHEN b.acceptance_overdue THEN 100 ELSE 0 END
       + CASE WHEN b.accepted_no_case THEN 80 ELSE 0 END
       + CASE WHEN b.is_returned THEN 75 ELSE 0 END
       + CASE WHEN b.high_value AND b.legal_stale THEN 60 ELSE 0 END
       + CASE WHEN b.legal_stale THEN 40 ELSE 0 END
       + CASE WHEN b.acceptance_due_soon THEN 25 ELSE 0 END) AS attention_score,
      CASE
        WHEN NOT b.awaiting_acceptance THEN NULL
        WHEN b.acceptance_overdue THEN 'OVERDUE'
        WHEN b.acceptance_due_soon THEN 'DUE_SOON'
        ELSE 'WITHIN_SLA'
      END AS acceptance_sla
    FROM base b
  ),
  filtered AS (
    SELECT s.* FROM scored s
    WHERE (v_tab = 'ALL'
        OR (v_tab='AWAITING'    AND s.awaiting_acceptance)
        OR (v_tab='ACCEPTED'    AND s.referral_status='ACCEPTED_BY_LEGAL')
        OR (v_tab='PROCEEDINGS' AND s.referral_status='IN_LEGAL_PROCEEDINGS')
        OR (v_tab='STALE'       AND s.legal_stale)
        OR (v_tab='HIGH_VALUE'  AND s.high_value)
        OR (v_tab='RETURNED'    AND s.is_returned)
        OR (v_tab='CLOSED'      AND s.is_closed))
      AND (v_status IS NULL OR s.referral_status = v_status)
      AND (v_legal IS NULL OR s.legal_status_code = v_legal)
      AND (v_zone IS NULL OR s.zone = v_zone)
      AND (v_reason IS NULL OR s.reason_code = v_reason)
      AND (v_origin IS NULL OR upper(s.origin_code) = v_origin)
      AND (v_amin IS NULL OR COALESCE(s.total_referred,0) >= v_amin)
      AND (v_amax IS NULL OR COALESCE(s.total_referred,0) <= v_amax)
      AND (v_sfrom IS NULL OR s.submitted_date >= v_sfrom)
      AND (v_sto IS NULL OR s.submitted_date < (v_sto + 1))
      AND (v_upd IS NULL
        OR (v_upd='TODAY'   AND s.last_legal_update >= date_trunc('day', now()))
        OR (v_upd='7D'      AND s.last_legal_update >= now() - interval '7 days')
        OR (v_upd='NO_7D'   AND s.last_legal_update <  now() - interval '7 days')
        OR (v_upd='NO_30D'  AND s.last_legal_update <  now() - interval '30 days'))
      AND (v_search IS NULL OR (
            s.referral_number ILIKE '%'||v_search||'%'
         OR s.employer_name ILIKE '%'||v_search||'%'
         OR s.employer_reg_no ILIKE '%'||v_search||'%'
         OR COALESCE(s.ce_case_number,'') ILIKE '%'||v_search||'%'
         OR COALESCE(s.lg_intake_no,'') ILIKE '%'||v_search||'%'
         OR COALESCE(s.lg_case_no,'') ILIKE '%'||v_search||'%'
         OR COALESCE(s.court_case_no,'') ILIKE '%'||v_search||'%'))
  ),
  page AS (
    SELECT f.* FROM filtered f
    ORDER BY
      CASE WHEN v_desc THEN
        CASE v_sort
          WHEN 'attention' THEN f.attention_score::numeric
          WHEN 'waiting' THEN COALESCE(f.waiting_hours,0)
          WHEN 'amount' THEN COALESCE(f.total_referred,0)
          WHEN 'submitted' THEN EXTRACT(EPOCH FROM COALESCE(f.submitted_date, to_timestamp(0)))
          WHEN 'accepted' THEN EXTRACT(EPOCH FROM COALESCE(f.accepted_date, to_timestamp(0)))
          WHEN 'last_update' THEN EXTRACT(EPOCH FROM COALESCE(f.last_legal_update, to_timestamp(0)))
          ELSE NULL END
      END DESC NULLS LAST,
      CASE WHEN NOT v_desc THEN
        CASE v_sort
          WHEN 'attention' THEN f.attention_score::numeric
          WHEN 'waiting' THEN COALESCE(f.waiting_hours,0)
          WHEN 'amount' THEN COALESCE(f.total_referred,0)
          WHEN 'submitted' THEN EXTRACT(EPOCH FROM COALESCE(f.submitted_date, to_timestamp(0)))
          WHEN 'accepted' THEN EXTRACT(EPOCH FROM COALESCE(f.accepted_date, to_timestamp(0)))
          WHEN 'last_update' THEN EXTRACT(EPOCH FROM COALESCE(f.last_legal_update, to_timestamp(0)))
          ELSE NULL END
      END ASC NULLS LAST,
      CASE WHEN v_desc THEN
        CASE v_sort WHEN 'employer' THEN f.employer_name
                    WHEN 'referral' THEN f.referral_number
                    WHEN 'legal_status' THEN f.legal_status_label
                    ELSE NULL END
      END DESC NULLS LAST,
      CASE WHEN NOT v_desc THEN
        CASE v_sort WHEN 'employer' THEN f.employer_name
                    WHEN 'referral' THEN f.referral_number
                    WHEN 'legal_status' THEN f.legal_status_label
                    ELSE NULL END
      END ASC NULLS LAST,
      f.submitted_date DESC NULLS LAST
    OFFSET (v_page-1)*v_size LIMIT v_size
  )
  SELECT
    (SELECT count(*) FROM filtered),
    COALESCE((SELECT jsonb_agg(to_jsonb(pg) - CASE WHEN v_can_money THEN '{}'::text[]
              ELSE ARRAY['principal_amount','penalty_amount','interest_amount','total_referred','outstanding_amount','recovered_amount'] END)
              FROM page pg), '[]'::jsonb),
    (SELECT jsonb_build_object(
        'awaiting', count(*) FILTER (WHERE awaiting_acceptance),
        'acceptance_overdue', count(*) FILTER (WHERE acceptance_overdue),
        'accepted', count(*) FILTER (WHERE referral_status='ACCEPTED_BY_LEGAL'),
        'proceedings', count(*) FILTER (WHERE referral_status='IN_LEGAL_PROCEEDINGS'),
        'returned', count(*) FILTER (WHERE is_returned),
        'closed', count(*) FILTER (WHERE is_closed),
        'stale', count(*) FILTER (WHERE legal_stale),
        'high_value', count(*) FILTER (WHERE high_value),
        'total_exposure', CASE WHEN v_can_money
            THEN COALESCE(sum(total_referred) FILTER (WHERE NOT is_closed),0) ELSE NULL END,
        'outstanding_exposure', CASE WHEN v_can_money
            THEN COALESCE(sum(COALESCE(outstanding_amount,total_referred)) FILTER (WHERE NOT is_closed),0) ELSE NULL END
      ) FROM scored),
    (SELECT jsonb_build_object(
        'ALL', count(*),
        'AWAITING', count(*) FILTER (WHERE awaiting_acceptance),
        'ACCEPTED', count(*) FILTER (WHERE referral_status='ACCEPTED_BY_LEGAL'),
        'PROCEEDINGS', count(*) FILTER (WHERE referral_status='IN_LEGAL_PROCEEDINGS'),
        'STALE', count(*) FILTER (WHERE legal_stale),
        'HIGH_VALUE', count(*) FILTER (WHERE high_value),
        'RETURNED', count(*) FILTER (WHERE is_returned),
        'CLOSED', count(*) FILTER (WHERE is_closed)
      ) FROM scored),
    COALESCE((SELECT jsonb_agg(a ORDER BY (a->>'priority')::int DESC) FROM (
        SELECT jsonb_build_object(
          'referral_id', s.referral_id,
          'referral_number', s.referral_number,
          'employer_name', s.employer_name,
          'status_label', s.status_label,
          'legal_status_label', s.legal_status_label,
          'amount', CASE WHEN v_can_money THEN s.total_referred ELSE NULL END,
          'priority', s.attention_score,
          'reason', CASE
             WHEN s.acceptance_overdue THEN 'Legal acceptance overdue'
             WHEN s.accepted_no_case THEN 'Accepted by Legal but no Legal case number recorded'
             WHEN s.is_returned THEN 'Returned by Legal — rework required'
             WHEN s.high_value AND s.legal_stale THEN 'High-value matter with no recent Legal update'
             WHEN s.legal_stale THEN 'No Legal update recently'
             ELSE 'Acceptance due soon' END
        ) a
        FROM scored s WHERE s.attention_score > 0
        ORDER BY s.attention_score DESC, s.submitted_date ASC NULLS LAST LIMIT 8
      ) q), '[]'::jsonb),
    jsonb_build_object(
      'statuses', (SELECT COALESCE(jsonb_agg(jsonb_build_object('code',code,'label',label,'tone',tone) ORDER BY display_order),'[]'::jsonb)
                    FROM public.ce_approved_escalation_ref WHERE domain='STATUS' AND is_active),
      'legal_statuses', (SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('code',legal_status_code,'label',legal_status_label)),'[]'::jsonb) FROM scored),
      'zones', (SELECT COALESCE(jsonb_agg(DISTINCT zone) FILTER (WHERE zone IS NOT NULL),'[]'::jsonb) FROM scored),
      'reasons', (SELECT COALESCE(jsonb_agg(DISTINCT reason_code) FILTER (WHERE reason_code IS NOT NULL),'[]'::jsonb) FROM scored),
      'origins', (SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('code',upper(origin_code),'label',origin_label)),'[]'::jsonb) FROM scored)
    )
  INTO v_total, v_rows, v_kpis, v_tabs, v_attention, v_facets;

  RETURN jsonb_build_object(
    'rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size,
    'kpis', v_kpis, 'tab_counts', v_tabs, 'attention', v_attention, 'facets', v_facets,
    'thresholds', jsonb_build_object('acceptance_sla_days', v_sla_days,
                                     'acceptance_due_soon_days', v_soon_days,
                                     'stale_days', v_stale_days,
                                     'high_value', v_high),
    'actor', jsonb_build_object('can_view_financials', v_can_money,
                                'can_open_legal', v_can_legal,
                                'can_view_legal_status', true)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ce_approved_escalation_register_v1(jsonb,text,text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ce_approved_escalation_register_v1(jsonb,text,text,integer,integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- Detail RPC (referral drill-down + timeline)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_approved_escalation_detail_v1(p_referral_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_can_view boolean; v_can_money boolean;
  v_row jsonb; v_timeline jsonb; v_violations jsonb; v_versions jsonb; v_docs jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','NOT_AUTHENTICATED'); END IF;
  v_can_view := public.is_admin(v_uid)
             OR public.ce_actor_can(v_uid,'compliance.legal.court_monitoring')
             OR public.ce_actor_can(v_uid,'compliance.enforcement.legal')
             OR public.ce_actor_can(v_uid,'compliance.workbench.enterprise')
             OR public.ce_actor_can(v_uid,'compliance.workbench.team');
  IF NOT v_can_view THEN RETURN jsonb_build_object('error','NOT_AUTHORISED'); END IF;
  v_can_money := public.is_admin(v_uid)
              OR public.ce_actor_can(v_uid,'compliance.workbench.enterprise')
              OR public.ce_actor_can(v_uid,'compliance.enforcement.legal');

  SELECT to_jsonb(v)
       || jsonb_build_object(
            'status_label', COALESCE(sl.label,'Unmapped Referral Status'),
            'legal_status_label', COALESCE(ll.label, lla.label, 'Unmapped Legal Status'),
            'recovery_label', COALESCE(rl.label,'Not started'))
       - CASE WHEN v_can_money THEN '{}'::text[]
              ELSE ARRAY['principal_amount','penalty_amount','interest_amount','total_referred','outstanding_amount','recovered_amount'] END
    INTO v_row
  FROM public.ce_v_approved_escalation_register v
  LEFT JOIN public.ce_approved_escalation_ref sl ON sl.domain='STATUS' AND sl.code=v.referral_status
  LEFT JOIN public.ce_approved_escalation_ref ll ON ll.domain='LEGAL_STATUS' AND ll.code=upper(v.legal_status_raw)
  LEFT JOIN public.ce_approved_escalation_ref lla ON lla.domain='LEGAL_STATUS' AND upper(v.legal_status_raw) = ANY (lla.aliases)
  LEFT JOIN public.ce_approved_escalation_ref rl ON rl.domain='RECOVERY' AND rl.code=v.recovery_status_code
  WHERE v.referral_id = p_referral_id;

  IF v_row IS NULL THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;

  -- Timeline from recorded events only (pack events + referral milestones + legal records)
  SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'at')), '[]'::jsonb) INTO v_timeline
  FROM (
    SELECT jsonb_build_object('at', e.created_at, 'code', e.event_code,
                              'label', COALESCE(NULLIF(e.description,''), initcap(replace(e.event_code,'_',' '))),
                              'actor', COALESCE(e.actor_name, e.actor_code), 'source','COMPLIANCE') t
      FROM public.ce_legal_pack_event e WHERE e.referral_id = p_referral_id
    UNION ALL
    SELECT jsonb_build_object('at', r.approved_at, 'code','APPROVED','label','Approval granted',
                              'actor', r.approved_by, 'source','COMPLIANCE')
      FROM public.ce_legal_referrals r WHERE r.id=p_referral_id AND r.approved_at IS NOT NULL
    UNION ALL
    SELECT jsonb_build_object('at', r.submitted_date, 'code','SUBMITTED','label','Submitted to Legal',
                              'actor', COALESCE(r.referred_by, r.created_by), 'source','COMPLIANCE')
      FROM public.ce_legal_referrals r WHERE r.id=p_referral_id AND r.submitted_date IS NOT NULL
    UNION ALL
    SELECT jsonb_build_object('at', r.accepted_date, 'code','ACCEPTED','label','Accepted by Legal',
                              'actor', r.accepted_by, 'source','LEGAL')
      FROM public.ce_legal_referrals r WHERE r.id=p_referral_id AND r.accepted_date IS NOT NULL
    UNION ALL
    SELECT jsonb_build_object('at', x.returned_at, 'code','RETURNED','label',
                              COALESCE('Returned by Legal — '||x.reason,'Returned by Legal'),
                              'actor', x.returned_by, 'source','LEGAL')
      FROM public.ce_legal_returns x WHERE x.referral_id = p_referral_id
    UNION ALL
    SELECT jsonb_build_object('at', c.created_at, 'code','LEGAL_CASE_CREATED',
                              'label','Legal case created — '||c.lg_case_no, 'actor', c.created_by, 'source','LEGAL')
      FROM public.lg_case c, public.ce_legal_referrals r
     WHERE r.id=p_referral_id AND (c.id=r.legal_case_id OR c.compliance_referral_id=r.id)
    UNION ALL
    SELECT jsonb_build_object('at', COALESCE(h.scheduled_at, h.hearing_date::timestamptz), 'code','HEARING',
                              'label','Hearing — '||COALESCE(h.outcome_code, h.status, 'scheduled'),
                              'actor', h.officer_code, 'source','LEGAL')
      FROM public.lg_hearing h, public.ce_legal_referrals r
     WHERE r.id=p_referral_id AND (h.lg_case_id=r.legal_case_id)
    UNION ALL
    SELECT jsonb_build_object('at', COALESCE(o.granted_date, o.issued_date)::timestamptz, 'code','ORDER',
                              'label','Order / judgment — '||COALESCE(o.order_no,o.order_type_code),
                              'actor', o.created_by, 'source','LEGAL')
      FROM public.lg_order o, public.ce_legal_referrals r
     WHERE r.id=p_referral_id AND o.lg_case_id=r.legal_case_id
  ) s(t)
  WHERE (t->>'at') IS NOT NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', l.id, 'case_number', l.case_number, 'case_type', l.case_type,
            'period_from', l.period_from, 'period_to', l.period_to, 'notes', l.line_notes,
            'principal', CASE WHEN v_can_money THEN l.principal_amount ELSE NULL END,
            'penalty',   CASE WHEN v_can_money THEN l.penalty_amount ELSE NULL END,
            'interest',  CASE WHEN v_can_money THEN l.interest_amount ELSE NULL END,
            'amount',    CASE WHEN v_can_money THEN l.total_amount ELSE NULL END)),'[]'::jsonb)
    INTO v_violations
  FROM public.ce_legal_referral_lines l WHERE l.referral_id = p_referral_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('version_no',pv.version_no,'status',pv.status,
            'submitted_at',pv.submitted_at,'submitted_by',COALESCE(pv.submitted_by_name,pv.submitted_by),
            'returned_at',pv.returned_at,'return_reason',pv.return_reason,
            'created_at',pv.created_at) ORDER BY pv.version_no DESC),'[]'::jsonb)
    INTO v_versions
  FROM public.ce_legal_pack_version pv WHERE pv.referral_id = p_referral_id;

  SELECT COALESCE(jsonb_agg(d),'[]'::jsonb) INTO v_docs
  FROM (
    SELECT jsonb_array_elements(COALESCE(pv.documents_snapshot,'[]'::jsonb)) d
    FROM public.ce_legal_pack_version pv
    WHERE pv.referral_id = p_referral_id
    ORDER BY pv.version_no DESC LIMIT 1
  ) s;

  RETURN jsonb_build_object('referral', v_row, 'timeline', v_timeline,
                            'items', v_violations, 'versions', v_versions, 'documents', v_docs,
                            'actor', jsonb_build_object('can_view_financials', v_can_money));
END;
$function$;

REVOKE ALL ON FUNCTION public.ce_approved_escalation_detail_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ce_approved_escalation_detail_v1(uuid) TO authenticated, service_role;