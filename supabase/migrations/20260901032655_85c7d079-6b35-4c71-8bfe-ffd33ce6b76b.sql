-- ============================================================
-- Compliance → Legal Proceedings & Enforcement Tracking Register
-- Read/track projection over Legal-owned data. Compliance does NOT
-- own stage/hearing/judgment values; they are sourced from lg_*.
-- ============================================================

-- 1) Canonical reference data for stage / outcome / recovery labels
CREATE TABLE IF NOT EXISTS public.ce_legal_proceeding_ref (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain        text NOT NULL CHECK (domain IN ('STAGE','OUTCOME','RECOVERY')),
  code          text NOT NULL,
  label         text NOT NULL,
  group_code    text,
  display_order integer NOT NULL DEFAULT 100,
  is_active     boolean NOT NULL DEFAULT true,
  aliases       text[] NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (domain, code)
);

GRANT SELECT ON public.ce_legal_proceeding_ref TO authenticated;
GRANT ALL ON public.ce_legal_proceeding_ref TO service_role;

ALTER TABLE public.ce_legal_proceeding_ref ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ce_legal_proceeding_ref_read" ON public.ce_legal_proceeding_ref;
CREATE POLICY "ce_legal_proceeding_ref_read"
  ON public.ce_legal_proceeding_ref FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "ce_legal_proceeding_ref_admin" ON public.ce_legal_proceeding_ref;
CREATE POLICY "ce_legal_proceeding_ref_admin"
  ON public.ce_legal_proceeding_ref FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.ce_legal_proceeding_ref_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_ce_legal_proceeding_ref_touch ON public.ce_legal_proceeding_ref;
CREATE TRIGGER trg_ce_legal_proceeding_ref_touch
  BEFORE UPDATE ON public.ce_legal_proceeding_ref
  FOR EACH ROW EXECUTE FUNCTION public.ce_legal_proceeding_ref_touch();

-- Seed STAGE from the canonical Legal stage vocabulary (lg_case_source_stage /
-- lg_case.current_stage_code), including legacy free-text aliases used by the
-- historic ce_legal_proceedings seed rows.
INSERT INTO public.ce_legal_proceeding_ref (domain, code, label, group_code, display_order, aliases) VALUES
  ('STAGE','AWAITING_LEGAL',        'Awaiting Legal Acceptance', 'PRE_COURT',   10, '{}'),
  ('STAGE','REFERRAL_RECEIVED',     'Referral Received',         'PRE_COURT',   20, '{}'),
  ('STAGE','LEGAL_REVIEW',          'Legal Review',              'PRE_COURT',   30, '{}'),
  ('STAGE','DEMAND_NOTICE',         'Demand Notice',             'PRE_COURT',   40, '{}'),
  ('STAGE','COURT_FILING',          'Court Filing',              'COURT',       50, ARRAY['Summons']),
  ('STAGE','HEARING',               'Hearing',                   'COURT',       60, ARRAY['Judgment Summons']),
  ('STAGE','SETTLEMENT_NEGOTIATION','Settlement Negotiation',    'COURT',       70, '{}'),
  ('STAGE','JUDGMENT',              'Judgment',                  'JUDGMENT',    80, '{}'),
  ('STAGE','JUDGMENT_ISSUED',       'Judgment Issued',           'JUDGMENT',    85, '{}'),
  ('STAGE','CONSENT_ORDER',         'Consent Order',             'JUDGMENT',    90, '{}'),
  ('STAGE','SETTLEMENT_AGREED',     'Settlement Agreed',         'JUDGMENT',    95, '{}'),
  ('STAGE','ENFORCEMENT',           'Enforcement',               'ENFORCEMENT',100, ARRAY['Writ of Execution','Commitment/JDS']),
  ('STAGE','FEES_AND_WAIVERS',      'Fees & Waivers',            'ENFORCEMENT',110, '{}'),
  ('STAGE','RECOVERY',              'Recovery Monitoring',       'RECOVERY',   120, ARRAY['Recovery Monitoring']),
  ('STAGE','CLOSED',                'Closed',                    'CLOSED',     130, '{}')
ON CONFLICT (domain, code) DO NOTHING;

INSERT INTO public.ce_legal_proceeding_ref (domain, code, label, group_code, display_order, aliases) VALUES
  ('OUTCOME','PENDING',            'Pending',             'OPEN',    10, ARRAY['Pending']),
  ('OUTCOME','JUDGMENT_GRANTED',   'Judgment Granted',    'JUDGMENT',20, ARRAY['Judgment Granted']),
  ('OUTCOME','JUDGMENT_DISMISSED', 'Judgment Dismissed',  'CLOSED',  30, ARRAY['Dismissed']),
  ('OUTCOME','CONSENT_ORDER',      'Consent Order',       'JUDGMENT',40, '{}'),
  ('OUTCOME','SETTLEMENT',         'Settlement',          'JUDGMENT',50, ARRAY['Settled']),
  ('OUTCOME','RECOVERY_ONGOING',   'Recovery Ongoing',    'RECOVERY',60, '{}'),
  ('OUTCOME','FULLY_RECOVERED',    'Fully Recovered',     'CLOSED',  70, '{}'),
  ('OUTCOME','CLOSED',             'Closed',              'CLOSED',  80, ARRAY['Closed'])
ON CONFLICT (domain, code) DO NOTHING;

INSERT INTO public.ce_legal_proceeding_ref (domain, code, label, group_code, display_order, aliases) VALUES
  ('RECOVERY','NOT_STARTED',   'Not Started',           'OPEN',    10, '{}'),
  ('RECOVERY','IN_PROGRESS',   'In Progress',           'ACTIVE',  20, '{}'),
  ('RECOVERY','PARTIAL',       'Partial Recovery',      'ACTIVE',  30, '{}'),
  ('RECOVERY','ARRANGEMENT',   'Payment Arrangement',   'ACTIVE',  40, '{}'),
  ('RECOVERY','FULLY_RECOVERED','Fully Recovered',      'CLOSED',  50, '{}'),
  ('RECOVERY','UNRECOVERABLE', 'Unrecoverable / Closed','CLOSED',  60, '{}')
ON CONFLICT (domain, code) DO NOTHING;

-- 2) Indexes supporting the register joins / filters
CREATE INDEX IF NOT EXISTS idx_ce_legal_referrals_status        ON public.ce_legal_referrals (status);
CREATE INDEX IF NOT EXISTS idx_ce_legal_referrals_lg_intake     ON public.ce_legal_referrals (lg_intake_id);
CREATE INDEX IF NOT EXISTS idx_ce_legal_referrals_legal_case    ON public.ce_legal_referrals (legal_case_id);
CREATE INDEX IF NOT EXISTS idx_ce_legal_referrals_source_case   ON public.ce_legal_referrals (source_case_id);
CREATE INDEX IF NOT EXISTS idx_lg_case_source_intake            ON public.lg_case (source_intake_id);
CREATE INDEX IF NOT EXISTS idx_lg_case_compliance_referral      ON public.lg_case (compliance_referral_id);
CREATE INDEX IF NOT EXISTS idx_lg_case_no                       ON public.lg_case (lg_case_no);
CREATE INDEX IF NOT EXISTS idx_lg_hearing_case_date             ON public.lg_hearing (lg_case_id, hearing_date);
CREATE INDEX IF NOT EXISTS idx_lg_order_case                    ON public.lg_order (lg_case_id);
CREATE INDEX IF NOT EXISTS idx_lg_enforcement_action_case       ON public.lg_enforcement_action (case_id);
CREATE INDEX IF NOT EXISTS idx_lg_recoverable_liability_case    ON public.lg_recoverable_liability (lg_case_id);
CREATE INDEX IF NOT EXISTS idx_lg_court_proceeding_case         ON public.lg_court_proceeding (lg_case_id);
CREATE INDEX IF NOT EXISTS idx_lg_case_stage_history_case       ON public.lg_case_stage_history (lg_case_id, transitioned_at DESC);

-- 3) Read projection: Compliance referral → Legal case → court/hearing/
--    judgment/enforcement/recovery rollups, plus legacy unlinked rows.
CREATE OR REPLACE VIEW public.ce_v_legal_proceeding_register AS
WITH linked AS (
  SELECT r.id AS referral_id, c.id AS lg_case_id
  FROM public.ce_legal_referrals r
  LEFT JOIN LATERAL (
    SELECT lc.* FROM public.lg_case lc
    WHERE lc.id = r.legal_case_id
       OR lc.compliance_referral_id = r.id
       OR (r.lg_case_no IS NOT NULL AND lc.lg_case_no = r.lg_case_no)
       OR (r.lg_intake_id IS NOT NULL AND lc.source_intake_id = r.lg_intake_id)
    ORDER BY lc.updated_at DESC NULLS LAST
    LIMIT 1
  ) c ON true
  WHERE r.lg_intake_id IS NOT NULL
     OR r.legal_case_id IS NOT NULL
     OR r.lg_case_no IS NOT NULL
     OR c.id IS NOT NULL
     OR r.status IN ('ACCEPTED_BY_LEGAL','IN_LEGAL_PROCEEDINGS')
),
hear AS (
  SELECT h.lg_case_id,
         count(*)::int AS hearing_count,
         min(COALESCE(h.hearing_date, h.scheduled_at::date))
           FILTER (WHERE COALESCE(h.hearing_date, h.scheduled_at::date) >= CURRENT_DATE
                     AND COALESCE(h.status,'') NOT IN ('CANCELLED','VACATED')) AS next_hearing_date,
         max(COALESCE(h.hearing_date, h.scheduled_at::date))
           FILTER (WHERE COALESCE(h.hearing_date, h.scheduled_at::date) < CURRENT_DATE) AS last_hearing_date,
         max(h.updated_at) AS last_hearing_update
  FROM public.lg_hearing h GROUP BY h.lg_case_id
),
hear_last AS (
  SELECT DISTINCT ON (h.lg_case_id) h.lg_case_id, h.outcome_code, h.outcome_notes, h.hearing_stage
  FROM public.lg_hearing h
  WHERE COALESCE(h.hearing_date, h.scheduled_at::date) < CURRENT_DATE
  ORDER BY h.lg_case_id, COALESCE(h.hearing_date, h.scheduled_at::date) DESC
),
ord AS (
  SELECT o.lg_case_id,
         max(COALESCE(o.granted_date, o.issued_date)) AS judgment_date,
         sum(COALESCE(o.ordered_amount,0)) AS judgment_amount,
         sum(COALESCE(o.costs_awarded,0) + COALESCE(o.interest_awarded,0) + COALESCE(o.penalty_awarded,0)) AS judgment_extras,
         count(*)::int AS order_count,
         bool_or(o.payment_arrangement_id IS NOT NULL) AS has_arrangement
  FROM public.lg_order o GROUP BY o.lg_case_id
),
enf AS (
  SELECT e.case_id AS lg_case_id,
         count(*)::int AS enforcement_count,
         sum(COALESCE(e.amount_targeted,0)) AS amount_targeted,
         sum(COALESCE(e.amount_recovered,0)) AS amount_recovered,
         max(COALESCE(e.execution_date, e.approved_date, e.requested_date)) AS last_enforcement_date,
         max(e.updated_at) AS last_enforcement_update
  FROM public.lg_enforcement_action e GROUP BY e.case_id
),
liab AS (
  SELECT l.lg_case_id,
         sum(COALESCE(l.total_assessed,0)) AS total_assessed,
         sum(COALESCE(l.paid,0))           AS total_paid,
         sum(COALESCE(l.outstanding,0))    AS total_outstanding,
         bool_or(upper(COALESCE(l.recovery_status,'')) = 'RECOVERED') AS any_recovered,
         bool_and(upper(COALESCE(l.recovery_status,'')) = 'RECOVERED') AS all_recovered,
         bool_or(upper(COALESCE(l.recovery_status,'')) = 'PARTIAL')   AS any_partial,
         bool_or(upper(COALESCE(l.arrangement_status,'')) IN ('ACTIVE','AGREED')) AS any_arrangement
  FROM public.lg_recoverable_liability l GROUP BY l.lg_case_id
),
cp AS (
  SELECT p.lg_case_id,
         min(p.filing_date) AS first_filing_date,
         max(p.judgment_amount) AS cp_judgment_amount
  FROM public.lg_court_proceeding p GROUP BY p.lg_case_id
),
stg AS (
  SELECT s.lg_case_id, max(s.transitioned_at) AS last_stage_change
  FROM public.lg_case_stage_history s GROUP BY s.lg_case_id
)
SELECT
  'LEGAL'::text                                        AS source,
  ('LEGAL:' || r.id::text)                             AS row_key,
  r.id                                                 AS referral_id,
  r.referral_number,
  r.status                                             AS referral_status,
  c.id                                                 AS lg_case_id,
  COALESCE(c.lg_case_no, r.lg_case_no)                 AS lg_case_no,
  COALESCE(c.court_case_no, r.court_case_number)       AS court_case_no,
  COALESCE(c.court_case_no, r.court_case_number, c.lg_case_no, r.lg_case_no, r.referral_number) AS proceeding_no,
  r.lg_intake_id,
  r.lg_intake_no,
  r.source_case_id                                     AS ce_case_id,
  cc.case_number                                       AS ce_case_number,
  COALESCE(r.employer_id, cc.employer_id)              AS employer_id,
  COALESCE(r.employer_name, cc.employer_name)          AS employer_name,
  r.employer_zone,
  CASE
    WHEN c.id IS NULL THEN 'AWAITING_LEGAL'
    ELSE COALESCE(c.current_stage_code, 'REFERRAL_RECEIVED')
  END::text                                            AS stage_code,
  COALESCE(c.court_code, ct.court_code)::text          AS court_code,
  COALESCE(c.court_name, ct.court_name)::text          AS court_name,
  COALESCE(cp.first_filing_date, c.opened_date, r.accepted_date::date, r.submitted_date::date) AS filed_date,
  COALESCE(h.next_hearing_date, c.next_hearing_date)   AS next_hearing_date,
  CASE WHEN h.next_hearing_date IS NOT NULL THEN 'HEARING_RECORD'
       WHEN c.next_hearing_date IS NOT NULL THEN 'CASE_CACHE' ELSE NULL END AS next_hearing_source,
  h.last_hearing_date,
  hl.outcome_code                                      AS last_hearing_outcome,
  COALESCE(h.hearing_count, 0)                         AS hearing_count,
  c.next_action,
  c.next_action_due_date                               AS next_action_due,
  COALESCE(r.legal_officer_assigned, c.assigned_team_code)::text AS legal_officer,
  COALESCE(r.grand_total, r.total_referred_amount, c.claim_amount, liab.total_assessed) AS referred_amount,
  COALESCE(NULLIF(ord.judgment_amount,0), cp.cp_judgment_amount) AS judgment_amount,
  COALESCE(ord.judgment_extras, 0)                     AS judgment_extras,
  ord.judgment_date,
  COALESCE(liab.total_paid, 0) + COALESCE(enf.amount_recovered, 0) AS recovered_amount,
  COALESCE(liab.total_outstanding, c.total_outstanding, c.outstanding_amount_snapshot,
           r.grand_total, 0)                           AS outstanding_amount,
  COALESCE(enf.enforcement_count, 0)                   AS enforcement_count,
  enf.last_enforcement_date,
  CASE
    WHEN COALESCE(liab.all_recovered,false)                             THEN 'FULLY_RECOVERED'
    WHEN COALESCE(liab.any_arrangement,false) OR COALESCE(ord.has_arrangement,false) THEN 'ARRANGEMENT'
    WHEN COALESCE(liab.any_partial,false)                               THEN 'PARTIAL'
    WHEN COALESCE(enf.enforcement_count,0) > 0                          THEN 'IN_PROGRESS'
    WHEN c.status_code = 'CLOSED' AND COALESCE(liab.total_outstanding, c.total_outstanding, 0) > 0 THEN 'UNRECOVERABLE'
    ELSE 'NOT_STARTED'
  END::text                                            AS recovery_status_code,
  CASE
    WHEN c.status_code = 'CLOSED'                                       THEN 'CLOSED'
    WHEN COALESCE(liab.all_recovered,false)                             THEN 'FULLY_RECOVERED'
    WHEN COALESCE(enf.enforcement_count,0) > 0                          THEN 'RECOVERY_ONGOING'
    WHEN c.current_stage_code = 'CONSENT_ORDER'                         THEN 'CONSENT_ORDER'
    WHEN c.current_stage_code = 'SETTLEMENT_AGREED'                     THEN 'SETTLEMENT'
    WHEN c.current_stage_code IN ('JUDGMENT','JUDGMENT_ISSUED') OR ord.order_count > 0 THEN 'JUDGMENT_GRANTED'
    ELSE 'PENDING'
  END::text                                            AS outcome_code,
  (c.status_code = 'CLOSED' OR c.current_stage_code = 'CLOSED') AS is_closed,
  c.opened_date,
  GREATEST(
    COALESCE(c.updated_at, r.updated_at, r.created_at),
    COALESCE(stg.last_stage_change, c.updated_at, r.updated_at, r.created_at),
    COALESCE(h.last_hearing_update, c.updated_at, r.updated_at, r.created_at),
    COALESCE(enf.last_enforcement_update, c.updated_at, r.updated_at, r.created_at)
  )                                                    AS last_legal_update,
  stg.last_stage_change,
  r.accepted_date,
  r.submitted_date,
  COALESCE(r.updated_at, r.created_at)                 AS referral_updated_at,
  c.payment_arrangement_id
FROM linked lk
JOIN public.ce_legal_referrals r ON r.id = lk.referral_id
LEFT JOIN public.lg_case c       ON c.id = lk.lg_case_id
LEFT JOIN public.ce_cases cc     ON cc.id = r.source_case_id
LEFT JOIN public.lg_court ct     ON ct.court_code = c.court_code
LEFT JOIN hear h                 ON h.lg_case_id = c.id
LEFT JOIN hear_last hl           ON hl.lg_case_id = c.id
LEFT JOIN ord                    ON ord.lg_case_id = c.id
LEFT JOIN enf                    ON enf.lg_case_id = c.id
LEFT JOIN liab                   ON liab.lg_case_id = c.id
LEFT JOIN cp                     ON cp.lg_case_id = c.id
LEFT JOIN stg                    ON stg.lg_case_id = c.id

UNION ALL

-- Legacy Compliance-side proceedings (no Legal linkage; historic records)
SELECT
  'LEGACY'::text                       AS source,
  ('LEGACY:' || p.id::text)            AS row_key,
  NULL::uuid                           AS referral_id,
  NULL::text                           AS referral_number,
  NULL::text                           AS referral_status,
  NULL::uuid                           AS lg_case_id,
  NULL::text                           AS lg_case_no,
  p.case_number                        AS court_case_no,
  p.case_number                        AS proceeding_no,
  NULL::uuid                           AS lg_intake_id,
  NULL::text                           AS lg_intake_no,
  NULL::uuid                           AS ce_case_id,
  NULL::text                           AS ce_case_number,
  p.reg_no                             AS employer_id,
  p.employer_name,
  NULL::text                           AS employer_zone,
  COALESCE(sref.code, 'UNMAPPED')::text AS stage_code,
  lc.court_code::text                  AS court_code,
  p.court                              AS court_name,
  p.filed_date,
  p.next_hearing                       AS next_hearing_date,
  CASE WHEN p.next_hearing IS NOT NULL THEN 'LEGACY_FIELD' ELSE NULL END AS next_hearing_source,
  NULL::date                           AS last_hearing_date,
  NULL::text                           AS last_hearing_outcome,
  0                                    AS hearing_count,
  NULL::text                           AS next_action,
  NULL::date                           AS next_action_due,
  p.solicitor                          AS legal_officer,
  p.arrears                            AS referred_amount,
  NULL::numeric                        AS judgment_amount,
  0::numeric                           AS judgment_extras,
  NULL::date                           AS judgment_date,
  0::numeric                           AS recovered_amount,
  COALESCE(p.arrears, 0)               AS outstanding_amount,
  0                                    AS enforcement_count,
  NULL::date                           AS last_enforcement_date,
  'NOT_STARTED'::text                  AS recovery_status_code,
  COALESCE(oref.code, 'UNMAPPED')::text AS outcome_code,
  false                                AS is_closed,
  p.filed_date                         AS opened_date,
  COALESCE(p.updated_at, p.created_at) AS last_legal_update,
  NULL::timestamptz                    AS last_stage_change,
  NULL::timestamptz                    AS accepted_date,
  NULL::timestamptz                    AS submitted_date,
  COALESCE(p.updated_at, p.created_at) AS referral_updated_at,
  NULL::uuid                           AS payment_arrangement_id
FROM public.ce_legal_proceedings p
LEFT JOIN public.ce_legal_proceeding_ref sref
  ON sref.domain = 'STAGE' AND p.stage = ANY (sref.aliases)
LEFT JOIN public.ce_legal_proceeding_ref oref
  ON oref.domain = 'OUTCOME' AND p.outcome = ANY (oref.aliases)
LEFT JOIN public.lg_court lc ON lc.court_name = p.court;

-- 4) Register RPC ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_legal_proceeding_register_v1(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort text DEFAULT 'attention',
  p_dir text DEFAULT 'desc',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_can_view   boolean;
  v_can_money  boolean;
  v_can_legal  boolean;
  v_page       integer := GREATEST(COALESCE(p_page,1),1);
  v_size       integer := LEAST(GREATEST(COALESCE(p_page_size,25),1),200);
  v_sort       text := lower(COALESCE(p_sort,'attention'));
  v_desc       boolean := lower(COALESCE(p_dir,'desc')) <> 'asc';
  v_search     text := NULLIF(btrim(COALESCE(p_filters->>'search','')),'');
  v_tab        text := upper(COALESCE(p_filters->>'tab','ALL'));
  v_hearing_soon_days numeric := public.ce_setting_num('compliance.legal.hearing_soon_days', 7);
  v_stale_days        numeric := public.ce_setting_num('compliance.monitoring.stall_days.legal_proceeding', 30);
  v_high_value        numeric := public.ce_setting_num('compliance.legal.high_value_threshold', 50000);
  v_handover_days     numeric := public.ce_setting_num('compliance.monitoring.legal_handoff_days', 5);
  v_total      bigint := 0;
  v_rows       jsonb := '[]'::jsonb;
  v_kpis       jsonb := '{}'::jsonb;
  v_stages     jsonb := '[]'::jsonb;
  v_tabs       jsonb := '{}'::jsonb;
  v_attention  jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error','NOT_AUTHENTICATED');
  END IF;

  v_can_view := public.ce_actor_can(v_uid,'compliance.legal.court_monitoring')
             OR public.ce_actor_can(v_uid,'compliance.enforcement.legal')
             OR public.ce_actor_can(v_uid,'compliance.workbench.enterprise')
             OR public.ce_actor_can(v_uid,'compliance.workbench.team')
             OR public.is_admin(v_uid);
  IF NOT v_can_view THEN
    RETURN jsonb_build_object('error','NOT_AUTHORISED');
  END IF;

  v_can_money := public.is_admin(v_uid)
              OR public.ce_actor_can(v_uid,'compliance.workbench.enterprise')
              OR public.ce_actor_can(v_uid,'compliance.enforcement.legal');
  v_can_legal := public.is_admin(v_uid)
              OR public.ce_actor_can(v_uid,'compliance.legal.handoff');

  CREATE TEMP TABLE IF NOT EXISTS _ce_lp_scratch ON COMMIT DROP AS SELECT 1 WHERE false;

  WITH base AS (
    SELECT v.*,
      sr.label AS stage_label, sr.group_code AS stage_group, sr.display_order AS stage_order,
      orf.label AS outcome_label,
      rr.label AS recovery_label,
      (v.next_hearing_date IS NOT NULL AND v.next_hearing_date < CURRENT_DATE AND NOT v.is_closed) AS hearing_overdue,
      (v.next_hearing_date IS NOT NULL AND v.next_hearing_date >= CURRENT_DATE
        AND v.next_hearing_date <= CURRENT_DATE + (v_hearing_soon_days || ' days')::interval) AS hearing_soon,
      (v.outcome_code IN ('JUDGMENT_GRANTED','CONSENT_ORDER') AND v.enforcement_count = 0 AND NOT v.is_closed) AS judgment_no_enforcement,
      (v.next_hearing_date IS NULL AND v.next_action_due IS NULL AND NOT v.is_closed) AS no_next_action,
      (NOT v.is_closed AND v.last_legal_update < now() - (v_stale_days || ' days')::interval) AS legal_stale,
      (NOT v.is_closed AND COALESCE(v.outstanding_amount,0) >= v_high_value
        AND v.last_legal_update < now() - (v_stale_days || ' days')::interval) AS high_value_stalled,
      (v.stage_code = 'AWAITING_LEGAL' AND NOT v.is_closed
        AND COALESCE(v.accepted_date, v.submitted_date, v.referral_updated_at) < now() - (v_handover_days || ' days')::interval) AS awaiting_legal_overdue,
      (v.source = 'LEGACY') AS is_legacy
    FROM public.ce_v_legal_proceeding_register v
    LEFT JOIN public.ce_legal_proceeding_ref sr  ON sr.domain='STAGE'    AND sr.code = v.stage_code
    LEFT JOIN public.ce_legal_proceeding_ref orf ON orf.domain='OUTCOME' AND orf.code = v.outcome_code
    LEFT JOIN public.ce_legal_proceeding_ref rr  ON rr.domain='RECOVERY' AND rr.code = v.recovery_status_code
  ),
  scored AS (
    SELECT b.*,
      (CASE WHEN b.hearing_overdue THEN 100 ELSE 0 END
       + CASE WHEN b.judgment_no_enforcement THEN 80 ELSE 0 END
       + CASE WHEN b.awaiting_legal_overdue THEN 70 ELSE 0 END
       + CASE WHEN b.high_value_stalled THEN 60 ELSE 0 END
       + CASE WHEN b.legal_stale THEN 40 ELSE 0 END
       + CASE WHEN b.hearing_soon THEN 30 ELSE 0 END
       + CASE WHEN b.no_next_action THEN 20 ELSE 0 END) AS attention_score
    FROM base b
  ),
  filtered AS (
    SELECT s.* FROM scored s
    WHERE (v_search IS NULL OR (
            COALESCE(s.proceeding_no,'')   ILIKE '%'||v_search||'%'
         OR COALESCE(s.court_case_no,'')   ILIKE '%'||v_search||'%'
         OR COALESCE(s.lg_case_no,'')      ILIKE '%'||v_search||'%'
         OR COALESCE(s.lg_intake_no,'')    ILIKE '%'||v_search||'%'
         OR COALESCE(s.referral_number,'') ILIKE '%'||v_search||'%'
         OR COALESCE(s.ce_case_number,'')  ILIKE '%'||v_search||'%'
         OR COALESCE(s.employer_name,'')   ILIKE '%'||v_search||'%'
         OR COALESCE(s.employer_id,'')     ILIKE '%'||v_search||'%'
         OR COALESCE(s.court_name,'')      ILIKE '%'||v_search||'%'
         OR COALESCE(s.legal_officer,'')   ILIKE '%'||v_search||'%'))
      AND (COALESCE(p_filters->>'employer_id','') = '' OR s.employer_id = p_filters->>'employer_id')
      AND (COALESCE(p_filters->>'court','') = '' OR COALESCE(s.court_code, s.court_name) = p_filters->>'court')
      AND (COALESCE(p_filters->>'officer','') = '' OR s.legal_officer = p_filters->>'officer')
      AND (COALESCE(p_filters->>'ce_case_id','') = '' OR s.ce_case_id::text = p_filters->>'ce_case_id')
      AND (jsonb_array_length(COALESCE(p_filters->'stages','[]'::jsonb)) = 0
           OR s.stage_code IN (SELECT jsonb_array_elements_text(p_filters->'stages')))
      AND (jsonb_array_length(COALESCE(p_filters->'outcomes','[]'::jsonb)) = 0
           OR s.outcome_code IN (SELECT jsonb_array_elements_text(p_filters->'outcomes')))
      AND (jsonb_array_length(COALESCE(p_filters->'recovery','[]'::jsonb)) = 0
           OR s.recovery_status_code IN (SELECT jsonb_array_elements_text(p_filters->'recovery')))
      AND (COALESCE(p_filters->>'filed_from','') = '' OR s.filed_date >= (p_filters->>'filed_from')::date)
      AND (COALESCE(p_filters->>'filed_to','') = ''   OR s.filed_date <= (p_filters->>'filed_to')::date)
      AND (COALESCE(p_filters->>'amount_min','') = '' OR COALESCE(s.outstanding_amount,0) >= (p_filters->>'amount_min')::numeric)
      AND (COALESCE(p_filters->>'amount_max','') = '' OR COALESCE(s.outstanding_amount,0) <= (p_filters->>'amount_max')::numeric)
      AND (COALESCE(p_filters->>'hearing_window','') = ''
           OR (p_filters->>'hearing_window' = 'TODAY'    AND s.next_hearing_date = CURRENT_DATE)
           OR (p_filters->>'hearing_window' = 'NEXT_7'   AND s.next_hearing_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)
           OR (p_filters->>'hearing_window' = 'NEXT_30'  AND s.next_hearing_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30)
           OR (p_filters->>'hearing_window' = 'OVERDUE'  AND s.hearing_overdue)
           OR (p_filters->>'hearing_window' = 'NONE'     AND s.next_hearing_date IS NULL))
      AND (v_tab = 'ALL'
           OR (v_tab = 'ACTIVE'      AND NOT s.is_closed)
           OR (v_tab = 'HEARING'     AND (s.hearing_soon OR s.hearing_overdue))
           OR (v_tab = 'JUDGMENT'    AND s.stage_group = 'JUDGMENT')
           OR (v_tab = 'ENFORCEMENT' AND (s.stage_group = 'ENFORCEMENT' OR s.enforcement_count > 0))
           OR (v_tab = 'RECOVERY'    AND s.recovery_status_code IN ('IN_PROGRESS','PARTIAL','ARRANGEMENT'))
           OR (v_tab = 'HIGH_VALUE'  AND COALESCE(s.outstanding_amount,0) >= v_high_value)
           OR (v_tab = 'NO_HEARING'  AND s.next_hearing_date IS NULL AND NOT s.is_closed)
           OR (v_tab = 'STALLED'     AND s.legal_stale)
           OR (v_tab = 'ATTENTION'   AND s.attention_score > 0)
           OR (v_tab = 'CLOSED'      AND s.is_closed))
  ),
  paged AS (
    SELECT f.* FROM filtered f
    ORDER BY
      CASE WHEN v_sort='attention' THEN f.attention_score END DESC NULLS LAST,
      CASE WHEN v_sort='attention' THEN f.next_hearing_date END ASC NULLS LAST,
      CASE WHEN v_sort='attention' THEN COALESCE(f.outstanding_amount,0) END DESC,
      CASE WHEN v_sort='hearing'   AND NOT v_desc THEN f.next_hearing_date END ASC NULLS LAST,
      CASE WHEN v_sort='hearing'   AND v_desc     THEN f.next_hearing_date END DESC NULLS LAST,
      CASE WHEN v_sort='filed'     AND NOT v_desc THEN f.filed_date END ASC NULLS LAST,
      CASE WHEN v_sort='filed'     AND v_desc     THEN f.filed_date END DESC NULLS LAST,
      CASE WHEN v_sort='stage'     AND NOT v_desc THEN f.stage_order END ASC NULLS LAST,
      CASE WHEN v_sort='stage'     AND v_desc     THEN f.stage_order END DESC NULLS LAST,
      CASE WHEN v_sort='employer'  AND NOT v_desc THEN lower(f.employer_name) END ASC NULLS LAST,
      CASE WHEN v_sort='employer'  AND v_desc     THEN lower(f.employer_name) END DESC NULLS LAST,
      CASE WHEN v_sort='exposure'  AND NOT v_desc THEN COALESCE(f.outstanding_amount,0) END ASC,
      CASE WHEN v_sort='exposure'  AND v_desc     THEN COALESCE(f.outstanding_amount,0) END DESC,
      CASE WHEN v_sort='court'     AND NOT v_desc THEN lower(f.court_name) END ASC NULLS LAST,
      CASE WHEN v_sort='court'     AND v_desc     THEN lower(f.court_name) END DESC NULLS LAST,
      CASE WHEN v_sort='officer'   AND NOT v_desc THEN lower(f.legal_officer) END ASC NULLS LAST,
      CASE WHEN v_sort='officer'   AND v_desc     THEN lower(f.legal_officer) END DESC NULLS LAST,
      CASE WHEN v_sort='recovery'  AND NOT v_desc THEN f.recovery_status_code END ASC NULLS LAST,
      CASE WHEN v_sort='recovery'  AND v_desc     THEN f.recovery_status_code END DESC NULLS LAST,
      CASE WHEN v_sort='updated'   AND NOT v_desc THEN f.last_legal_update END ASC NULLS LAST,
      CASE WHEN v_sort='updated'   AND v_desc     THEN f.last_legal_update END DESC NULLS LAST,
      f.last_legal_update DESC NULLS LAST
    OFFSET (v_page-1)*v_size LIMIT v_size
  )
  SELECT
    (SELECT count(*) FROM filtered),
    COALESCE((SELECT jsonb_agg(to_jsonb(x) - (CASE WHEN v_can_money THEN ARRAY[]::text[]
              ELSE ARRAY['referred_amount','judgment_amount','judgment_extras','recovered_amount','outstanding_amount'] END))
              FROM paged x), '[]'::jsonb),
    jsonb_build_object(
      'active',      (SELECT count(*) FROM scored WHERE NOT is_closed),
      'hearings_30', (SELECT count(*) FROM scored WHERE next_hearing_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30),
      'hearings_overdue', (SELECT count(*) FROM scored WHERE hearing_overdue),
      'judgment_enforcement', (SELECT count(*) FROM scored WHERE stage_group IN ('JUDGMENT','ENFORCEMENT') OR enforcement_count > 0),
      'recovery_in_progress', (SELECT count(*) FROM scored WHERE recovery_status_code IN ('IN_PROGRESS','PARTIAL','ARRANGEMENT')),
      'attention',   (SELECT count(*) FROM scored WHERE attention_score > 0),
      'outstanding_exposure', CASE WHEN v_can_money
          THEN (SELECT COALESCE(sum(outstanding_amount),0) FROM scored WHERE NOT is_closed) ELSE NULL END
    ),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('code',d.stage_code,'label',d.label,'group',d.grp,'count',d.n) ORDER BY d.ord)
      FROM (SELECT s.stage_code,
                   COALESCE(s.stage_label,'Unmapped Stage') AS label,
                   COALESCE(s.stage_group,'UNMAPPED') AS grp,
                   COALESCE(min(s.stage_order), 999) AS ord,
                   count(*) AS n
            FROM scored s GROUP BY s.stage_code, s.stage_label, s.stage_group) d), '[]'::jsonb),
    jsonb_build_object(
      'ALL',        (SELECT count(*) FROM scored),
      'ACTIVE',     (SELECT count(*) FROM scored WHERE NOT is_closed),
      'HEARING',    (SELECT count(*) FROM scored WHERE hearing_soon OR hearing_overdue),
      'JUDGMENT',   (SELECT count(*) FROM scored WHERE stage_group='JUDGMENT'),
      'ENFORCEMENT',(SELECT count(*) FROM scored WHERE stage_group='ENFORCEMENT' OR enforcement_count>0),
      'RECOVERY',   (SELECT count(*) FROM scored WHERE recovery_status_code IN ('IN_PROGRESS','PARTIAL','ARRANGEMENT')),
      'HIGH_VALUE', (SELECT count(*) FROM scored WHERE COALESCE(outstanding_amount,0) >= v_high_value),
      'NO_HEARING', (SELECT count(*) FROM scored WHERE next_hearing_date IS NULL AND NOT is_closed),
      'STALLED',    (SELECT count(*) FROM scored WHERE legal_stale),
      'ATTENTION',  (SELECT count(*) FROM scored WHERE attention_score > 0),
      'CLOSED',     (SELECT count(*) FROM scored WHERE is_closed)
    ),
    COALESCE((SELECT jsonb_agg(a ORDER BY a->>'priority' DESC) FROM (
        SELECT jsonb_build_object(
          'row_key', s.row_key,
          'proceeding_no', s.proceeding_no,
          'employer_name', s.employer_name,
          'stage_label', COALESCE(s.stage_label,'Unmapped Stage'),
          'next_hearing_date', s.next_hearing_date,
          'outstanding_amount', CASE WHEN v_can_money THEN s.outstanding_amount ELSE NULL END,
          'priority', s.attention_score,
          'reason', CASE
            WHEN s.hearing_overdue          THEN 'Hearing date passed without update'
            WHEN s.judgment_no_enforcement  THEN 'Judgment obtained, enforcement not initiated'
            WHEN s.awaiting_legal_overdue   THEN 'Awaiting Legal case creation beyond hand-over SLA'
            WHEN s.high_value_stalled       THEN 'High-value matter with no recent Legal progress'
            WHEN s.legal_stale              THEN 'No Legal update within expected interval'
            WHEN s.hearing_soon             THEN 'Hearing due shortly'
            ELSE 'No upcoming hearing or next action' END
        ) AS a
        FROM scored s WHERE s.attention_score > 0
        ORDER BY s.attention_score DESC, s.next_hearing_date NULLS LAST
        LIMIT 8) t), '[]'::jsonb)
  INTO v_total, v_rows, v_kpis, v_stages, v_tabs, v_attention;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'page', v_page,
    'page_size', v_size,
    'kpis', v_kpis,
    'stage_distribution', v_stages,
    'tab_counts', v_tabs,
    'attention', v_attention,
    'actor', jsonb_build_object(
      'can_view_financials', v_can_money,
      'can_open_legal', v_can_legal,
      'can_follow_up', public.ce_actor_can(v_uid,'compliance.legal.court_monitoring') OR public.is_admin(v_uid)
    ),
    'thresholds', jsonb_build_object(
      'hearing_soon_days', v_hearing_soon_days,
      'stale_days', v_stale_days,
      'high_value_threshold', v_high_value,
      'handover_days', v_handover_days
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ce_legal_proceeding_register_v1(jsonb,text,text,integer,integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ce_legal_proceeding_register_v1(jsonb,text,text,integer,integer) TO authenticated, service_role;

-- 5) Facets RPC --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_legal_proceeding_facets_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','NOT_AUTHENTICATED'); END IF;
  IF NOT (public.ce_actor_can(v_uid,'compliance.legal.court_monitoring')
       OR public.ce_actor_can(v_uid,'compliance.enforcement.legal')
       OR public.ce_actor_can(v_uid,'compliance.workbench.enterprise')
       OR public.ce_actor_can(v_uid,'compliance.workbench.team')
       OR public.is_admin(v_uid)) THEN
    RETURN jsonb_build_object('error','NOT_AUTHORISED');
  END IF;

  RETURN jsonb_build_object(
    'stages', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',code,'label',label,'group',group_code) ORDER BY display_order)
                        FROM public.ce_legal_proceeding_ref WHERE domain='STAGE' AND is_active), '[]'::jsonb),
    'outcomes', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',code,'label',label) ORDER BY display_order)
                        FROM public.ce_legal_proceeding_ref WHERE domain='OUTCOME' AND is_active), '[]'::jsonb),
    'recovery', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',code,'label',label) ORDER BY display_order)
                        FROM public.ce_legal_proceeding_ref WHERE domain='RECOVERY' AND is_active), '[]'::jsonb),
    'courts', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',c,'label',l) ORDER BY l) FROM (
                        SELECT DISTINCT COALESCE(v.court_code, v.court_name) AS c, COALESCE(v.court_name, v.court_code) AS l
                        FROM public.ce_v_legal_proceeding_register v
                        WHERE COALESCE(v.court_code, v.court_name) IS NOT NULL) q), '[]'::jsonb),
    'employers', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',c,'label',l) ORDER BY l) FROM (
                        SELECT DISTINCT v.employer_id AS c, COALESCE(v.employer_name, v.employer_id) AS l
                        FROM public.ce_v_legal_proceeding_register v WHERE v.employer_id IS NOT NULL) q), '[]'::jsonb),
    'officers', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',c,'label',c) ORDER BY c) FROM (
                        SELECT DISTINCT v.legal_officer AS c FROM public.ce_v_legal_proceeding_register v
                        WHERE NULLIF(btrim(COALESCE(v.legal_officer,'')),'') IS NOT NULL) q), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ce_legal_proceeding_facets_v1() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ce_legal_proceeding_facets_v1() TO authenticated, service_role;

-- 6) Detail RPC --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_legal_proceeding_detail_v1(p_row_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_money boolean;
  v_row   jsonb;
  v_case  uuid;
  v_ref   uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','NOT_AUTHENTICATED'); END IF;
  IF NOT (public.ce_actor_can(v_uid,'compliance.legal.court_monitoring')
       OR public.ce_actor_can(v_uid,'compliance.enforcement.legal')
       OR public.ce_actor_can(v_uid,'compliance.workbench.enterprise')
       OR public.ce_actor_can(v_uid,'compliance.workbench.team')
       OR public.is_admin(v_uid)) THEN
    RETURN jsonb_build_object('error','NOT_AUTHORISED');
  END IF;
  v_money := public.is_admin(v_uid)
          OR public.ce_actor_can(v_uid,'compliance.workbench.enterprise')
          OR public.ce_actor_can(v_uid,'compliance.enforcement.legal');

  SELECT to_jsonb(x) || jsonb_build_object(
           'stage_label',    COALESCE(sr.label,'Unmapped Stage'),
           'stage_group',    COALESCE(sr.group_code,'UNMAPPED'),
           'outcome_label',  COALESCE(orf.label,'Unmapped Outcome'),
           'recovery_label', COALESCE(rr.label,'Unmapped Status')),
         x.lg_case_id, x.referral_id
    INTO v_row, v_case, v_ref
  FROM public.ce_v_legal_proceeding_register x
  LEFT JOIN public.ce_legal_proceeding_ref sr  ON sr.domain='STAGE'    AND sr.code = x.stage_code
  LEFT JOIN public.ce_legal_proceeding_ref orf ON orf.domain='OUTCOME' AND orf.code = x.outcome_code
  LEFT JOIN public.ce_legal_proceeding_ref rr  ON rr.domain='RECOVERY' AND rr.code = x.recovery_status_code
  WHERE x.row_key = p_row_key;

  IF v_row IS NULL THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;

  IF NOT v_money THEN
    v_row := v_row - ARRAY['referred_amount','judgment_amount','judgment_extras','recovered_amount','outstanding_amount'];
  END IF;

  RETURN jsonb_build_object(
    'proceeding', v_row,
    'can_view_financials', v_money,
    'hearings', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',h.id,'hearing_number',h.hearing_number,'hearing_stage',h.hearing_stage,
        'hearing_date',COALESCE(h.hearing_date,h.scheduled_at::date),'status',h.status,
        'court_name',COALESCE(h.court_name,h.court_code),'outcome_code',h.outcome_code,
        'outcome_notes',h.outcome_notes,'judge_name',COALESCE(h.judge_name,h.magistrate_name),
        'adjournment_count',h.adjournment_count)
        ORDER BY COALESCE(h.hearing_date,h.scheduled_at::date) DESC)
      FROM public.lg_hearing h WHERE h.lg_case_id = v_case), '[]'::jsonb),
    'orders', CASE WHEN v_money THEN COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',o.id,'order_no',o.order_no,'order_type_code',o.order_type_code,
        'issued_date',COALESCE(o.granted_date,o.issued_date),'status',o.status,
        'ordered_amount',o.ordered_amount,'costs_awarded',o.costs_awarded,
        'interest_awarded',o.interest_awarded,'penalty_awarded',o.penalty_awarded,
        'compliance_status',o.compliance_status,'enforcement_status',o.enforcement_status,
        'court_file_no',o.court_file_no,'judge_name',o.judge_name)
        ORDER BY COALESCE(o.granted_date,o.issued_date) DESC)
      FROM public.lg_order o WHERE o.lg_case_id = v_case), '[]'::jsonb) ELSE '[]'::jsonb END,
    'enforcement', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',e.id,'enforcement_no',e.enforcement_no,'enforcement_type',e.enforcement_type,
        'status',e.status,'requested_date',e.requested_date,'execution_date',e.execution_date,
        'amount_targeted',CASE WHEN v_money THEN e.amount_targeted ELSE NULL END,
        'amount_recovered',CASE WHEN v_money THEN e.amount_recovered ELSE NULL END,
        'outcome',e.outcome,'next_action',e.next_action)
        ORDER BY COALESCE(e.execution_date,e.requested_date) DESC)
      FROM public.lg_enforcement_action e WHERE e.case_id = v_case), '[]'::jsonb),
    'liabilities', CASE WHEN v_money THEN COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',l.id,'assessment_number',l.assessment_number,'liability_type',l.liability_type,
        'total_assessed',l.total_assessed,'paid',l.paid,'outstanding',l.outstanding,
        'recovery_status',l.recovery_status,'arrangement_status',l.arrangement_status)
        ORDER BY l.outstanding DESC NULLS LAST)
      FROM public.lg_recoverable_liability l WHERE l.lg_case_id = v_case), '[]'::jsonb) ELSE '[]'::jsonb END,
    'history', COALESCE((SELECT jsonb_agg(ev ORDER BY ev->>'at' DESC) FROM (
        SELECT jsonb_build_object('at', s.transitioned_at, 'type','STAGE',
               'label', COALESCE(sr.label, s.to_stage_code), 'actor', s.transitioned_by,
               'notes', s.notes, 'source','LEGAL') AS ev
        FROM public.lg_case_stage_history s
        LEFT JOIN public.ce_legal_proceeding_ref sr ON sr.domain='STAGE' AND sr.code = s.to_stage_code
        WHERE s.lg_case_id = v_case
        UNION ALL
        SELECT jsonb_build_object('at', COALESCE(h.hearing_date, h.scheduled_at::date)::timestamptz, 'type','HEARING',
               'label', COALESCE(h.hearing_stage,'Hearing'), 'actor', COALESCE(h.judge_name,h.magistrate_name),
               'notes', COALESCE(h.outcome_notes, h.outcome_code), 'source','LEGAL')
        FROM public.lg_hearing h WHERE h.lg_case_id = v_case
        UNION ALL
        SELECT jsonb_build_object('at', COALESCE(e.execution_date,e.requested_date)::timestamptz, 'type','ENFORCEMENT',
               'label', COALESCE(e.enforcement_type,'Enforcement'), 'actor', e.officer_code,
               'notes', COALESCE(e.outcome, e.remarks), 'source','LEGAL')
        FROM public.lg_enforcement_action e WHERE e.case_id = v_case
        UNION ALL
        SELECT jsonb_build_object('at', r.submitted_date, 'type','REFERRAL',
               'label','Referred to Legal', 'actor', r.created_by_name, 'notes', r.referral_reason_text, 'source','COMPLIANCE')
        FROM public.ce_legal_referrals r WHERE r.id = v_ref AND r.submitted_date IS NOT NULL
        UNION ALL
        SELECT jsonb_build_object('at', r.accepted_date, 'type','REFERRAL',
               'label','Accepted by Legal', 'actor', r.accepted_by, 'notes', NULL, 'source','LEGAL')
        FROM public.ce_legal_referrals r WHERE r.id = v_ref AND r.accepted_date IS NOT NULL
      ) t), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ce_legal_proceeding_detail_v1(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ce_legal_proceeding_detail_v1(text) TO authenticated, service_role;