
-- ═══════════════════════════════════════════════════════════════════════════
-- Checkpoint D — Warning → Demand → Legal escalation & governed legal handoff
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Authoritative escalation stage configuration ────────────────────────
CREATE TABLE IF NOT EXISTS public.ce_escalation_stage_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_code text NOT NULL UNIQUE,
  stage_name text NOT NULL,
  stage_order integer NOT NULL,
  prerequisite_stage_code text NULL,
  delay_days integer NULL,
  delay_basis text NOT NULL DEFAULT 'PREREQUISITE_NOTICE_DATE'
    CHECK (delay_basis IN ('PREREQUISITE_NOTICE_DATE','VIOLATION_CREATED','OBLIGATION_DUE_DATE')),
  notice_template_code text NULL,
  requires_approval boolean NOT NULL DEFAULT false,
  target_state text NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  retired_at timestamptz NULL,
  retired_reason text NULL,
  applicable_funds text[] NOT NULL DEFAULT '{}',
  applicable_violation_type_ids uuid[] NOT NULL DEFAULT '{}',
  min_outstanding_amount numeric NOT NULL DEFAULT 0,
  open_decision_code text NULL,
  notes text NULL,
  created_by text NULL,
  updated_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ce_escalation_stage_config TO authenticated;
GRANT ALL ON public.ce_escalation_stage_config TO service_role;
ALTER TABLE public.ce_escalation_stage_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stage config readable by authenticated" ON public.ce_escalation_stage_config;
CREATE POLICY "stage config readable by authenticated"
  ON public.ce_escalation_stage_config FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "stage config managed by config authority" ON public.ce_escalation_stage_config;
CREATE POLICY "stage config managed by config authority"
  ON public.ce_escalation_stage_config FOR ALL TO authenticated
  USING (public.ce_actor_can(auth.uid(), 'compliance.config.manage'))
  WITH CHECK (public.ce_actor_can(auth.uid(), 'compliance.config.manage'));

INSERT INTO public.ce_escalation_stage_config
  (stage_code, stage_name, stage_order, prerequisite_stage_code, delay_days, delay_basis,
   notice_template_code, requires_approval, target_state, is_enabled, open_decision_code, notes)
VALUES
  ('WARNING','Warning Notice',10,NULL,0,'VIOLATION_CREATED',
   'WARNING_NOTICE',false,'WARNING_ISSUED',true,NULL,
   'First formal enforcement stage once the violation/eligibility condition holds.'),
  ('DEMAND','Demand Notice',20,'WARNING',NULL,'PREREQUISITE_NOTICE_DATE',
   'DEMAND_NOTICE',false,'DEMAND_ISSUED',true,'D-WARNING-TO-DEMAND-DELAY',
   'Waiting period after Warning is an OPEN client decision; generation fails visibly until configured.'),
  ('LEGAL_ELIGIBLE','Legal Referral Eligibility',30,'DEMAND',14,'PREREQUISITE_NOTICE_DATE',
   NULL,true,'LEGAL_ELIGIBLE',true,NULL,
   'St Kitts default: 14 days after the Demand Notice effective date. Eligibility never auto-refers.'),
  ('FINAL_DEMAND','Final Demand Notice (retired)',25,'DEMAND',NULL,'PREREQUISITE_NOTICE_DATE',
   'FINAL_DEMAND_NOTICE',false,'FINAL_DEMAND_ISSUED',false,NULL,
   'Retired from the active St Kitts workflow. Historical notices remain readable.')
ON CONFLICT (stage_code) DO NOTHING;

UPDATE public.ce_escalation_stage_config
   SET is_enabled = false,
       retired_at = COALESCE(retired_at, now()),
       retired_reason = COALESCE(retired_reason,
         'Final Demand removed from the active St Kitts escalation sequence (client decision, Aug 2026).')
 WHERE stage_code = 'FINAL_DEMAND';

INSERT INTO public.ce_open_business_decision (decision_code, title, rule_code, status,
  confirmed_basis, unconfirmed_items, runtime_guard, raised_by)
VALUES
 ('D-WARNING-TO-DEMAND-DELAY','Waiting period between Warning Notice and Demand Notice','CD-ESC-001','OPEN',
  'Warning precedes Demand; Demand precedes Legal eligibility by 14 days.',
  '["Number of days between Warning and Demand"]'::jsonb,
  'DEMAND_STAGE_DELAY_NOT_CONFIGURED','checkpoint-d'),
 ('D-LEGAL-ARREARS-MULTIPLIER','Management escalation arrears multiplier interpretation','CD-ESC-002','OPEN',
  'Threshold = average of the latest N valid monthly contribution liabilities × multiplier. Defaults N=3, multiplier=9. Exceeding the threshold triggers Management review only, never automatic Legal referral.',
  '["Treatment of employers with fewer than N valid periods","Whether penalties/interest ever count toward qualifying arrears"]'::jsonb,
  'MANAGEMENT_ESCALATION_REVIEW_ONLY','checkpoint-d')
ON CONFLICT (decision_code) DO NOTHING;

-- ── 2. Management (arrears) escalation policy — retires flat EC$50,000 ─────
CREATE TABLE IF NOT EXISTS public.ce_management_escalation_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_code text NOT NULL UNIQUE,
  policy_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  history_period_count integer NOT NULL DEFAULT 3,
  multiplier numeric NOT NULL DEFAULT 9,
  liability_basis text NOT NULL DEFAULT 'C3_CONTRIBUTION_LIABILITY'
    CHECK (liability_basis IN ('C3_CONTRIBUTION_LIABILITY','PRINCIPAL_DUE')),
  include_penalties_in_arrears boolean NOT NULL DEFAULT false,
  include_interest_in_arrears boolean NOT NULL DEFAULT false,
  min_valid_periods integer NOT NULL DEFAULT 1,
  action_on_breach text NOT NULL DEFAULT 'MANAGEMENT_REVIEW'
    CHECK (action_on_breach IN ('MANAGEMENT_REVIEW','RECOMMEND_LEGAL','NONE')),
  retired_at timestamptz NULL,
  retired_reason text NULL,
  notes text NULL,
  created_by text NULL,
  updated_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ce_management_escalation_policy TO authenticated;
GRANT ALL ON public.ce_management_escalation_policy TO service_role;
ALTER TABLE public.ce_management_escalation_policy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mgmt policy readable" ON public.ce_management_escalation_policy;
CREATE POLICY "mgmt policy readable" ON public.ce_management_escalation_policy
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "mgmt policy managed" ON public.ce_management_escalation_policy;
CREATE POLICY "mgmt policy managed" ON public.ce_management_escalation_policy
  FOR ALL TO authenticated
  USING (public.ce_actor_can(auth.uid(), 'compliance.config.manage'))
  WITH CHECK (public.ce_actor_can(auth.uid(), 'compliance.config.manage'));

INSERT INTO public.ce_management_escalation_policy
 (policy_code, policy_name, is_active, history_period_count, multiplier, liability_basis, action_on_breach, notes)
VALUES
 ('SKN_ARREARS_AVG_MULTIPLIER','St Kitts arrears escalation (avg monthly liability × multiplier)',
  true, 3, 9, 'C3_CONTRIBUTION_LIABILITY','MANAGEMENT_REVIEW',
  'Average of the latest 3 valid monthly contribution liabilities × 9. Management review only.'),
 ('LEGACY_FLAT_50000','Legacy flat EC$50,000 arrears threshold (retired)',
  false, 0, 0, 'PRINCIPAL_DUE','NONE','Retired — replaced by the average × multiplier model.')
ON CONFLICT (policy_code) DO NOTHING;

UPDATE public.ce_management_escalation_policy
   SET is_active=false, retired_at=COALESCE(retired_at, now()),
       retired_reason=COALESCE(retired_reason,'Flat EC$50,000 threshold retired (client decision, Aug 2026).')
 WHERE policy_code='LEGACY_FLAT_50000';

CREATE TABLE IF NOT EXISTS public.ce_arrears_threshold_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id text NOT NULL,
  policy_code text NOT NULL,
  policy_snapshot jsonb NOT NULL,
  source_periods jsonb NOT NULL,
  monthly_liabilities jsonb NOT NULL,
  average_monthly_liability numeric NOT NULL,
  multiplier numeric NOT NULL,
  threshold_amount numeric NOT NULL,
  qualifying_arrears numeric NOT NULL,
  threshold_breached boolean NOT NULL,
  evaluation_notes text NULL,
  evaluated_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ce_arrears_eval_employer
  ON public.ce_arrears_threshold_evaluations (employer_id, created_at DESC);
GRANT SELECT ON public.ce_arrears_threshold_evaluations TO authenticated;
GRANT ALL ON public.ce_arrears_threshold_evaluations TO service_role;
ALTER TABLE public.ce_arrears_threshold_evaluations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "arrears evals readable" ON public.ce_arrears_threshold_evaluations;
CREATE POLICY "arrears evals readable" ON public.ce_arrears_threshold_evaluations
  FOR SELECT TO authenticated USING (true);

-- ── 3. Notice stage + snapshot columns ─────────────────────────────────────
ALTER TABLE public.ce_notices
  ADD COLUMN IF NOT EXISTS stage_code text NULL,
  ADD COLUMN IF NOT EXISTS stage_config_snapshot jsonb NULL,
  ADD COLUMN IF NOT EXISTS financial_snapshot jsonb NULL,
  ADD COLUMN IF NOT EXISTS covered_periods jsonb NULL,
  ADD COLUMN IF NOT EXISTS effective_date date NULL,
  ADD COLUMN IF NOT EXISTS dms_document_ref text NULL,
  ADD COLUMN IF NOT EXISTS generation_idempotency_key text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_ce_notices_generation_key
  ON public.ce_notices (generation_idempotency_key)
  WHERE generation_idempotency_key IS NOT NULL;

-- ── 4. Canonical financial snapshot (never ce_ledger_periods.balance) ──────
CREATE OR REPLACE FUNCTION public.ce_canonical_financial_snapshot(p_employer_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v jsonb;
  v_interest_open boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.ce_open_business_decision
     WHERE decision_code = 'CR-002-RETROACTIVITY' AND status = 'OPEN'
  ) INTO v_interest_open;

  SELECT jsonb_build_object(
    'employer_id', p_employer_id,
    'source', 'ce_v_employer_outstanding',
    'captured_at', now(),
    'principal_outstanding', COALESCE(SUM(principal_outstanding),0),
    'principal_due', COALESCE(SUM(principal_due),0),
    'principal_paid', COALESCE(SUM(principal_paid),0),
    'penalties_outstanding', COALESCE(SUM(penalty_outstanding),0),
    'fines_outstanding', 0,
    'interest_outstanding', COALESCE(SUM(interest_outstanding),0),
    'credits_available', COALESCE(SUM(credit_available),0),
    'total_outstanding', COALESCE(SUM(total_outstanding),0),
    'periods_in_arrears', COALESCE(MAX(periods_in_arrears),0),
    'oldest_arrears_period', MIN(oldest_arrears_period),
    'interest_policy_review_required', v_interest_open,
    'total_collectible', CASE WHEN v_interest_open
        THEN COALESCE(SUM(principal_outstanding),0) + COALESCE(SUM(penalty_outstanding),0)
             - COALESCE(SUM(credit_available),0)
        ELSE COALESCE(SUM(total_outstanding),0) END
  )
  INTO v
  FROM public.ce_v_employer_outstanding
  WHERE employer_id = p_employer_id;

  RETURN COALESCE(v, jsonb_build_object('employer_id', p_employer_id, 'total_collectible', 0,
                                        'source','ce_v_employer_outstanding','captured_at', now()));
END;
$$;
REVOKE ALL ON FUNCTION public.ce_canonical_financial_snapshot(text) FROM public;
GRANT EXECUTE ON FUNCTION public.ce_canonical_financial_snapshot(text) TO authenticated, service_role;

-- ── 5. Arrears threshold evaluation (avg monthly liability × multiplier) ───
CREATE OR REPLACE FUNCTION public.ce_evaluate_arrears_threshold_v1(
  p_employer_id text,
  p_persist boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pol record;
  v_periods jsonb := '[]'::jsonb;
  v_liabs jsonb := '[]'::jsonb;
  v_avg numeric := 0;
  v_threshold numeric := 0;
  v_arrears numeric := 0;
  v_fin jsonb;
  v_count integer := 0;
  v_result jsonb;
  r record;
BEGIN
  SELECT * INTO v_pol FROM public.ce_management_escalation_policy
   WHERE is_active AND retired_at IS NULL ORDER BY updated_at DESC LIMIT 1;
  IF v_pol IS NULL THEN
    RETURN jsonb_build_object('status','configuration_error',
      'error','No active management escalation policy configured.');
  END IF;

  FOR r IN
    SELECT period, SUM(principal_due) AS liability
      FROM public.ce_v_ledger_period_balances
     WHERE employer_id = p_employer_id AND principal_due > 0
     GROUP BY period ORDER BY period DESC
     LIMIT GREATEST(v_pol.history_period_count, 0)
  LOOP
    v_periods := v_periods || to_jsonb(r.period::text);
    v_liabs := v_liabs || jsonb_build_object('period', r.period, 'liability', r.liability);
    v_avg := v_avg + r.liability;
    v_count := v_count + 1;
  END LOOP;

  IF v_count < v_pol.min_valid_periods THEN
    RETURN jsonb_build_object('status','insufficient_history','employer_id',p_employer_id,
      'valid_periods',v_count,'required_periods',v_pol.min_valid_periods,
      'open_decision','D-LEGAL-ARREARS-MULTIPLIER');
  END IF;

  v_avg := ROUND(v_avg / NULLIF(v_count,0), 2);
  v_threshold := ROUND(v_avg * v_pol.multiplier, 2);

  v_fin := public.ce_canonical_financial_snapshot(p_employer_id);
  v_arrears := COALESCE((v_fin->>'principal_outstanding')::numeric, 0)
    + CASE WHEN v_pol.include_penalties_in_arrears
           THEN COALESCE((v_fin->>'penalties_outstanding')::numeric,0) ELSE 0 END
    + CASE WHEN v_pol.include_interest_in_arrears
           THEN COALESCE((v_fin->>'interest_outstanding')::numeric,0) ELSE 0 END;

  v_result := jsonb_build_object(
    'status','evaluated',
    'employer_id', p_employer_id,
    'policy_code', v_pol.policy_code,
    'history_period_count', v_pol.history_period_count,
    'multiplier', v_pol.multiplier,
    'liability_basis', v_pol.liability_basis,
    'source_periods', v_periods,
    'monthly_liabilities', v_liabs,
    'average_monthly_liability', v_avg,
    'threshold_amount', v_threshold,
    'qualifying_arrears', v_arrears,
    'threshold_breached', v_arrears > v_threshold,
    'action_on_breach', v_pol.action_on_breach,
    'auto_refers_to_legal', false
  );

  IF p_persist THEN
    INSERT INTO public.ce_arrears_threshold_evaluations
      (employer_id, policy_code, policy_snapshot, source_periods, monthly_liabilities,
       average_monthly_liability, multiplier, threshold_amount, qualifying_arrears,
       threshold_breached, evaluated_by)
    VALUES (p_employer_id, v_pol.policy_code, to_jsonb(v_pol), v_periods, v_liabs,
       v_avg, v_pol.multiplier, v_threshold, v_arrears, v_arrears > v_threshold,
       public.ce_actor_user_code(auth.uid()));
  END IF;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.ce_evaluate_arrears_threshold_v1(text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.ce_evaluate_arrears_threshold_v1(text, boolean) TO authenticated, service_role;

-- ── 6. Stage eligibility + governed notice generation ──────────────────────
CREATE OR REPLACE FUNCTION public.ce_evaluate_stage_eligibility_v1(
  p_violation_id uuid,
  p_stage_code text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_stage record;
  v_viol record;
  v_basis timestamptz;
  v_prereq record;
  v_reasons text[] := '{}';
  v_due date;
BEGIN
  SELECT * INTO v_stage FROM public.ce_escalation_stage_config WHERE stage_code = p_stage_code;
  IF v_stage IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'status','configuration_error',
      'reasons', ARRAY['Unknown escalation stage: '||p_stage_code]);
  END IF;
  IF NOT v_stage.is_enabled THEN
    RETURN jsonb_build_object('eligible', false, 'status','stage_disabled',
      'reasons', ARRAY[v_stage.stage_name||' is not part of the active escalation sequence.']);
  END IF;
  IF v_stage.delay_days IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'status','configuration_error',
      'open_decision', v_stage.open_decision_code,
      'reasons', ARRAY['No waiting period configured for '||v_stage.stage_name||
                       '. Configure it in Escalation Stage Configuration before notices can be issued.']);
  END IF;

  SELECT id, employer_id, created_at, status INTO v_viol
    FROM public.ce_violations WHERE id = p_violation_id;
  IF v_viol IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'status','not_found',
      'reasons', ARRAY['Violation not found']);
  END IF;

  IF v_stage.prerequisite_stage_code IS NOT NULL THEN
    SELECT id, COALESCE(effective_date, sent_at::date, created_at::date) AS eff
      INTO v_prereq
      FROM public.ce_notices
     WHERE violation_id = p_violation_id
       AND stage_code = v_stage.prerequisite_stage_code
       AND COALESCE(status,'') <> 'CANCELLED'
     ORDER BY COALESCE(effective_date, sent_at::date, created_at::date) DESC
     LIMIT 1;
    IF v_prereq IS NULL THEN
      RETURN jsonb_build_object('eligible', false, 'status','prerequisite_missing',
        'reasons', ARRAY[v_stage.prerequisite_stage_code||' stage has not been completed for this violation.']);
    END IF;
    v_basis := v_prereq.eff::timestamptz;
  ELSE
    v_basis := v_viol.created_at;
  END IF;

  v_due := (v_basis + make_interval(days => v_stage.delay_days))::date;

  RETURN jsonb_build_object(
    'eligible', CURRENT_DATE >= v_due,
    'status', CASE WHEN CURRENT_DATE >= v_due THEN 'eligible' ELSE 'waiting' END,
    'stage_code', v_stage.stage_code,
    'stage_order', v_stage.stage_order,
    'requires_approval', v_stage.requires_approval,
    'basis_date', v_basis::date,
    'delay_days', v_stage.delay_days,
    'delay_basis', v_stage.delay_basis,
    'eligible_from', v_due,
    'stage_snapshot', to_jsonb(v_stage),
    'reasons', CASE WHEN CURRENT_DATE >= v_due THEN '{}'::text[]
                    ELSE ARRAY[v_stage.stage_name||' eligible from '||v_due::text] END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.ce_evaluate_stage_eligibility_v1(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.ce_evaluate_stage_eligibility_v1(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ce_generate_stage_notice_v1(
  p_violation_id uuid,
  p_stage_code text,
  p_delivery_method text DEFAULT 'EMAIL'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_elig jsonb;
  v_stage record;
  v_viol record;
  v_tmpl record;
  v_fin jsonb;
  v_key text;
  v_id uuid;
  v_no text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'CE-ESC-401: authentication required' USING ERRCODE='42501'; END IF;
  IF NOT public.ce_actor_can(v_uid, 'compliance.enforcement.notices') THEN
    RAISE EXCEPTION 'CE-ESC-403: compliance.enforcement.notices required' USING ERRCODE='42501';
  END IF;
  v_actor := public.ce_actor_user_code(v_uid);

  v_elig := public.ce_evaluate_stage_eligibility_v1(p_violation_id, p_stage_code);
  IF NOT (v_elig->>'eligible')::boolean THEN
    RETURN jsonb_build_object('status', v_elig->>'status', 'generated', false, 'evaluation', v_elig);
  END IF;

  SELECT * INTO v_stage FROM public.ce_escalation_stage_config WHERE stage_code = p_stage_code;
  SELECT id, violation_number, employer_id, employer_name, case_id
    INTO v_viol FROM public.ce_violations WHERE id = p_violation_id;

  SELECT * INTO v_tmpl FROM public.ce_notice_templates
   WHERE template_code = v_stage.notice_template_code AND is_active LIMIT 1;
  IF v_tmpl IS NULL THEN
    RETURN jsonb_build_object('status','template_missing','generated',false,
      'template_code', v_stage.notice_template_code);
  END IF;

  v_key := 'ESC-'||p_stage_code||'-'||p_violation_id::text;
  IF EXISTS (SELECT 1 FROM public.ce_notices WHERE generation_idempotency_key = v_key) THEN
    RETURN jsonb_build_object('status','already_generated','generated',false,'idempotency_key',v_key);
  END IF;

  v_fin := public.ce_canonical_financial_snapshot(v_viol.employer_id);
  v_no := 'NTC-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  INSERT INTO public.ce_notices
    (notice_number, employer_id, employer_name, case_id, violation_id, notice_type, status,
     subject, body, template_id, delivery_method, stage_code, stage_config_snapshot,
     financial_snapshot, effective_date, generation_idempotency_key, created_by)
  VALUES
    (v_no, v_viol.employer_id, v_viol.employer_name, v_viol.case_id, p_violation_id,
     p_stage_code, 'GENERATED', v_tmpl.subject, v_tmpl.body, v_tmpl.id, p_delivery_method,
     p_stage_code, to_jsonb(v_stage), v_fin, CURRENT_DATE, v_key, v_actor)
  RETURNING id INTO v_id;

  IF v_stage.target_state IS NOT NULL THEN
    UPDATE public.ce_violations SET status='ESCALATED', updated_at=now()
     WHERE id = p_violation_id AND status IN ('OPEN','UNDER_REVIEW');
  END IF;

  INSERT INTO public.system_audit_trail (module, action, entity_type, entity_id, severity, user_name, payload_json)
  VALUES ('COMPLIANCE_ESCALATION','STAGE_NOTICE_GENERATED','ce_notice', v_id::text,'info', v_actor,
          jsonb_build_object('stage', p_stage_code, 'violation_id', p_violation_id,
                             'financial_snapshot', v_fin, 'evaluation', v_elig));

  RETURN jsonb_build_object('status','generated','generated',true,'notice_id',v_id,
    'notice_number', v_no,'stage_code',p_stage_code,'financial_snapshot',v_fin);
END;
$$;
REVOKE ALL ON FUNCTION public.ce_generate_stage_notice_v1(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.ce_generate_stage_notice_v1(uuid, text, text) TO authenticated, service_role;

-- ── 7. Legal recommendation governance ─────────────────────────────────────
ALTER TABLE public.ce_legal_recommendations
  ADD COLUMN IF NOT EXISTS recommendation_type text NOT NULL DEFAULT 'ORDINARY',
  ADD COLUMN IF NOT EXISTS early_rule_code text NULL,
  ADD COLUMN IF NOT EXISTS recommendation_reason text NULL,
  ADD COLUMN IF NOT EXISTS recommended_by text NULL,
  ADD COLUMN IF NOT EXISTS recommended_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS eligibility_snapshot jsonb NULL,
  ADD COLUMN IF NOT EXISTS financial_snapshot jsonb NULL,
  ADD COLUMN IF NOT EXISTS policy_snapshot jsonb NULL,
  ADD COLUMN IF NOT EXISTS source_case_id uuid NULL,
  ADD COLUMN IF NOT EXISTS entry_path text NULL,
  ADD COLUMN IF NOT EXISTS approval_capability text NULL;

CREATE OR REPLACE FUNCTION public.ce_recommend_legal_v1(
  p_employer_id text,
  p_reason text,
  p_case_id uuid DEFAULT NULL,
  p_entry_path text DEFAULT 'RECOMMEND_LEGAL',
  p_early_rule_code text DEFAULT NULL,
  p_violation_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_fin jsonb;
  v_elig jsonb := NULL;
  v_arrears jsonb;
  v_type text := 'ORDINARY';
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'CE-LGL-401: authentication required' USING ERRCODE='42501'; END IF;
  IF NOT (public.ce_actor_can(v_uid,'compliance.legal.recommend')
          OR public.ce_actor_can(v_uid,'compliance.cases.manage')) THEN
    RAISE EXCEPTION 'CE-LGL-403: compliance.legal.recommend required' USING ERRCODE='42501';
  END IF;
  IF COALESCE(btrim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'CE-LGL-422: a recommendation reason is required' USING ERRCODE='22023';
  END IF;
  IF p_entry_path = 'QUICK_FORWARD' THEN
    IF NOT public.ce_feature_flag_enabled('compliance.legal.quick_forward') THEN
      RAISE EXCEPTION 'CE-LGL-503: expedited Quick Forward is disabled by configuration' USING ERRCODE='22023';
    END IF;
    IF NOT public.ce_actor_can(v_uid,'compliance.legal.override') THEN
      RAISE EXCEPTION 'CE-LGL-403: compliance.legal.override required for Quick Forward' USING ERRCODE='42501';
    END IF;
  END IF;

  v_actor := public.ce_actor_user_code(v_uid);
  v_fin := public.ce_canonical_financial_snapshot(p_employer_id);
  v_arrears := public.ce_evaluate_arrears_threshold_v1(p_employer_id, false);

  IF p_violation_id IS NOT NULL THEN
    v_elig := public.ce_evaluate_stage_eligibility_v1(p_violation_id, 'LEGAL_ELIGIBLE');
  END IF;

  IF p_early_rule_code IS NOT NULL OR p_entry_path = 'QUICK_FORWARD' THEN
    v_type := CASE WHEN p_entry_path='QUICK_FORWARD' THEN 'EXPEDITED' ELSE 'EARLY_SERIOUS' END;
    IF COALESCE(btrim(p_early_rule_code),'') = '' AND p_entry_path <> 'QUICK_FORWARD' THEN
      RAISE EXCEPTION 'CE-LGL-422: early recommendation requires a justifying rule code' USING ERRCODE='22023';
    END IF;
  END IF;

  INSERT INTO public.ce_legal_recommendations
    (employer_id, status, recommendation_type, early_rule_code, recommendation_reason,
     recommended_by, recommended_at, eligibility_snapshot, financial_snapshot, policy_snapshot,
     source_case_id, entry_path, total_principal, total_penalties, total_interest, grand_total,
     recommended_date, created_by)
  VALUES
    (p_employer_id, 'PENDING_APPROVAL', v_type, p_early_rule_code, p_reason,
     v_actor, now(), v_elig, v_fin, v_arrears, p_case_id, p_entry_path,
     COALESCE((v_fin->>'principal_outstanding')::numeric,0),
     COALESCE((v_fin->>'penalties_outstanding')::numeric,0),
     COALESCE((v_fin->>'interest_outstanding')::numeric,0),
     COALESCE((v_fin->>'total_collectible')::numeric,0),
     CURRENT_DATE, v_actor)
  RETURNING id INTO v_id;

  INSERT INTO public.system_audit_trail (module, action, entity_type, entity_id, severity, user_name, payload_json)
  VALUES ('COMPLIANCE_TO_LEGAL','LEGAL_RECOMMENDATION_SUBMITTED','ce_legal_recommendation', v_id::text,
          'info', v_actor, jsonb_build_object('entry_path',p_entry_path,'type',v_type,
          'reason',p_reason,'eligibility',v_elig,'financials',v_fin,'arrears',v_arrears));

  RETURN jsonb_build_object('status','pending_approval','recommendation_id',v_id,
    'recommendation_type',v_type,'entry_path',p_entry_path,
    'eligibility',v_elig,'financial_snapshot',v_fin,'arrears_evaluation',v_arrears);
END;
$$;
REVOKE ALL ON FUNCTION public.ce_recommend_legal_v1(text, text, uuid, text, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.ce_recommend_legal_v1(text, text, uuid, text, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ce_approve_legal_referral_v1(
  p_recommendation_id uuid,
  p_comments text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_rec record;
  v_ref_id uuid;
  v_no text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'CE-LGL-401: authentication required' USING ERRCODE='42501'; END IF;
  IF NOT public.ce_actor_can(v_uid,'compliance.legal.recommend_approve') THEN
    RAISE EXCEPTION 'CE-LGL-403: compliance.legal.recommend_approve required' USING ERRCODE='42501';
  END IF;
  v_actor := public.ce_actor_user_code(v_uid);

  SELECT * INTO v_rec FROM public.ce_legal_recommendations WHERE id = p_recommendation_id FOR UPDATE;
  IF v_rec IS NULL THEN RAISE EXCEPTION 'CE-LGL-404: recommendation not found' USING ERRCODE='22023'; END IF;
  IF v_rec.status <> 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'CE-LGL-409: recommendation is not pending approval (%).', v_rec.status USING ERRCODE='22023';
  END IF;
  IF v_rec.recommended_by IS NOT NULL AND v_rec.recommended_by = v_actor THEN
    RAISE EXCEPTION 'CE-LGL-409: separation of duties — the recommender cannot approve their own referral'
      USING ERRCODE='42501';
  END IF;

  UPDATE public.ce_legal_recommendations
     SET status='APPROVED', reviewed_by=v_actor, reviewed_date=now(), review_notes=p_comments,
         approval_capability='compliance.legal.recommend_approve', updated_by=v_actor, updated_at=now()
   WHERE id = p_recommendation_id;

  v_no := 'LREF-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  PERFORM set_config('ce.legal_referral_governed','1', true);
  INSERT INTO public.ce_legal_referrals
    (referral_number, recommendation_id, employer_id, employer_name, status,
     total_principal, total_penalties, total_interest, grand_total,
     source_case_id, source_module, created_via, created_by, referred_by,
     referral_reason_text, approved_at, approved_by, approval_notes)
  VALUES
    (v_no, p_recommendation_id, v_rec.employer_id, v_rec.employer_name, 'DRAFT',
     v_rec.total_principal, v_rec.total_penalties, v_rec.total_interest, v_rec.grand_total,
     v_rec.source_case_id, 'COMPLIANCE', COALESCE(v_rec.entry_path,'RECOMMEND_LEGAL'),
     v_actor, v_rec.recommended_by, v_rec.recommendation_reason, now(), v_actor, p_comments)
  RETURNING id INTO v_ref_id;
  PERFORM set_config('ce.legal_referral_governed','', true);

  UPDATE public.ce_legal_recommendations SET legal_referral_id = v_ref_id WHERE id = p_recommendation_id;

  INSERT INTO public.system_audit_trail (module, action, entity_type, entity_id, severity, user_name, payload_json)
  VALUES ('COMPLIANCE_TO_LEGAL','LEGAL_REFERRAL_APPROVED','ce_legal_recommendation',
          p_recommendation_id::text,'info', v_actor,
          jsonb_build_object('referral_id',v_ref_id,'comments',p_comments,
                             'recommended_by',v_rec.recommended_by,'next_stage','PACK_PREPARATION'));

  RETURN jsonb_build_object('status','approved','recommendation_id',p_recommendation_id,
    'referral_id',v_ref_id,'referral_number',v_no,'referral_status','DRAFT',
    'next_stage','PACK_PREPARATION');
END;
$$;
REVOKE ALL ON FUNCTION public.ce_approve_legal_referral_v1(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.ce_approve_legal_referral_v1(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ce_reject_legal_referral_v1(
  p_recommendation_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_rec record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'CE-LGL-401: authentication required' USING ERRCODE='42501'; END IF;
  IF NOT public.ce_actor_can(v_uid,'compliance.legal.recommend_approve') THEN
    RAISE EXCEPTION 'CE-LGL-403: compliance.legal.recommend_approve required' USING ERRCODE='42501';
  END IF;
  IF COALESCE(btrim(p_reason),'')='' THEN
    RAISE EXCEPTION 'CE-LGL-422: a rejection reason is required' USING ERRCODE='22023';
  END IF;
  v_actor := public.ce_actor_user_code(v_uid);

  SELECT * INTO v_rec FROM public.ce_legal_recommendations WHERE id=p_recommendation_id FOR UPDATE;
  IF v_rec IS NULL THEN RAISE EXCEPTION 'CE-LGL-404: recommendation not found' USING ERRCODE='22023'; END IF;
  IF v_rec.status <> 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'CE-LGL-409: recommendation is not pending approval (%).', v_rec.status USING ERRCODE='22023';
  END IF;

  UPDATE public.ce_legal_recommendations
     SET status='REJECTED', reviewed_by=v_actor, reviewed_date=now(), review_notes=p_reason,
         updated_by=v_actor, updated_at=now()
   WHERE id=p_recommendation_id;

  INSERT INTO public.system_audit_trail (module, action, entity_type, entity_id, severity, user_name, payload_json)
  VALUES ('COMPLIANCE_TO_LEGAL','LEGAL_REFERRAL_REJECTED','ce_legal_recommendation',
          p_recommendation_id::text,'warn', v_actor, jsonb_build_object('reason',p_reason));

  RETURN jsonb_build_object('status','rejected','recommendation_id',p_recommendation_id);
END;
$$;
REVOKE ALL ON FUNCTION public.ce_reject_legal_referral_v1(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.ce_reject_legal_referral_v1(uuid, text) TO authenticated, service_role;

-- ── 8. Referral lifecycle guard — no bypass of approval / pack / checklist ─
CREATE OR REPLACE FUNCTION public.ce_legal_referral_governance_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rec record;
  v_missing integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(current_setting('ce.legal_referral_governed', true),'') = '1' THEN
      RETURN NEW;
    END IF;
    IF NEW.recommendation_id IS NULL THEN
      RAISE EXCEPTION 'CE-LGL-403: legal referrals must originate from an approved recommendation (ce_recommend_legal_v1 → ce_approve_legal_referral_v1).'
        USING ERRCODE='42501';
    END IF;
    SELECT status INTO v_rec FROM public.ce_legal_recommendations WHERE id = NEW.recommendation_id;
    IF v_rec IS NULL OR v_rec.status <> 'APPROVED' THEN
      RAISE EXCEPTION 'CE-LGL-403: the linked recommendation is not approved by management.' USING ERRCODE='42501';
    END IF;
    IF NEW.status IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION 'CE-LGL-409: a new referral must start in DRAFT (Legal Pack Preparation).' USING ERRCODE='22023';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.status IN ('APPROVED_FOR_SUBMISSION','SUBMITTED_TO_LEGAL')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.recommendation_id IS NULL THEN
      RAISE EXCEPTION 'CE-LGL-403: referral has no approved recommendation.' USING ERRCODE='42501';
    END IF;
    SELECT status INTO v_rec FROM public.ce_legal_recommendations WHERE id = NEW.recommendation_id;
    IF v_rec IS NULL OR v_rec.status <> 'APPROVED' THEN
      RAISE EXCEPTION 'CE-LGL-403: management approval is missing for this referral.' USING ERRCODE='42501';
    END IF;
    IF NEW.pack_completed_at IS NULL THEN
      RAISE EXCEPTION 'CE-LGL-409: Legal Pack Preparation must be completed first.' USING ERRCODE='22023';
    END IF;
    SELECT count(*) INTO v_missing FROM public.ce_legal_pack_items
     WHERE referral_id = NEW.id AND is_required AND NOT is_satisfied;
    IF v_missing > 0 THEN
      RAISE EXCEPTION 'CE-LGL-409: % required handoff checklist item(s) are outstanding.', v_missing
        USING ERRCODE='22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_ce_legal_referral_governance ON public.ce_legal_referrals;
CREATE TRIGGER zz_ce_legal_referral_governance
  BEFORE INSERT OR UPDATE ON public.ce_legal_referrals
  FOR EACH ROW EXECUTE FUNCTION public.ce_legal_referral_governance_guard();

-- ── 9. Quick Forward is disabled by configuration ──────────────────────────
INSERT INTO public.feature_flags (flag_key, display_name, is_enabled, description)
VALUES ('compliance.legal.quick_forward', 'Compliance — Legal Quick Forward (expedited)', false,
        'Expedited Quick Forward into Legal. Disabled: current client policy requires the governed recommendation → management approval path.')
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = false, description = EXCLUDED.description;

DROP TRIGGER IF EXISTS trg_ce_escalation_stage_config_updated ON public.ce_escalation_stage_config;
CREATE TRIGGER trg_ce_escalation_stage_config_updated
  BEFORE UPDATE ON public.ce_escalation_stage_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
