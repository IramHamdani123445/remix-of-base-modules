-- ============================================================
-- Checkpoint B2 — DR-005 .. DR-013 foundation
-- ============================================================

-- 1. Capability model extension ------------------------------
CREATE OR REPLACE FUNCTION public.ce_actor_can(_user_id uuid, _capability text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_caps text[];
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  IF public.is_admin(_user_id) THEN RETURN true; END IF;

  v_role := public.ce_compliance_role(_user_id);

  v_caps := CASE v_role
    WHEN 'head' THEN ARRAY[
      'compliance.field.execute','compliance.field.plan','compliance.field.approve_plans',
      'compliance.field.report','compliance.field.approve_reports','compliance.field.sampling',
      'compliance.violations.manage','compliance.violations.link_to_case',
      'compliance.cases.manage','compliance.cases.approve_requests',
      'compliance.cases.view_confidential_documents','compliance.inspections.view_employer_history',
      'compliance.enforcement.notices','compliance.enforcement.arrangements',
      'compliance.enforcement.legal','compliance.workbench.team','compliance.workbench.enterprise',
      'compliance.reports.operational','compliance.reports.analytics',
      'compliance.config.manage','compliance.schedule.manage',
      'compliance.waiver.approve','compliance.waiver.approve_high',
      'compliance.legal.override','compliance.workflow.override',
      'compliance.partial_payment.request','compliance.partial_payment.approve',
      'compliance.review_flag.review','compliance.management.resolve',
      'compliance.employer_status.change','compliance.benchmark.override',
      'compliance.registration_lead.manage','compliance.legal.recommend_approve',
      'compliance.exemption.manage']
    WHEN 'senior' THEN ARRAY[
      'compliance.field.execute','compliance.field.plan','compliance.field.approve_plans',
      'compliance.field.report','compliance.field.approve_reports','compliance.field.sampling',
      'compliance.violations.manage','compliance.violations.link_to_case',
      'compliance.cases.manage','compliance.inspections.view_employer_history',
      'compliance.enforcement.notices','compliance.enforcement.arrangements',
      'compliance.enforcement.legal','compliance.workbench.team','compliance.reports.operational',
      'compliance.waiver.approve',
      'compliance.partial_payment.request','compliance.partial_payment.approve',
      'compliance.review_flag.review','compliance.employer_status.change',
      'compliance.registration_lead.manage','compliance.legal.recommend_approve',
      'compliance.exemption.manage']
    WHEN 'inspector' THEN ARRAY[
      'compliance.field.execute','compliance.field.plan','compliance.field.report',
      'compliance.violations.manage','compliance.cases.manage',
      'compliance.enforcement.notices','compliance.reports.operational',
      'compliance.partial_payment.request','compliance.registration_lead.manage']
    ELSE ARRAY[]::text[]
  END;

  IF _capability = ANY (v_caps) THEN RETURN true; END IF;

  -- Governance capabilities never fall back to the legacy blanket permission.
  IF _capability IN ('compliance.config.manage','compliance.schedule.manage',
                     'compliance.waiver.approve_high','compliance.legal.override',
                     'compliance.workflow.override','compliance.partial_payment.approve',
                     'compliance.review_flag.review','compliance.management.resolve',
                     'compliance.employer_status.change','compliance.benchmark.override',
                     'compliance.legal.recommend_approve','compliance.exemption.manage') THEN
    RETURN false;
  END IF;

  IF _capability = 'compliance.partial_payment.request' THEN
    RETURN public.has_permission(_user_id, 'c3_payments', 'create')
        OR public.has_permission(_user_id, 'c3_payments', 'edit');
  END IF;

  IF _capability = 'compliance.waiver.approve' THEN
    RETURN public.has_permission(_user_id, 'manage_compliance', 'approve');
  END IF;

  RETURN public.has_permission(_user_id, 'manage_compliance',
           CASE WHEN _capability LIKE '%.approve%' THEN 'approve' ELSE 'edit' END);
END;
$function$;

-- ============================================================
-- 2. Review flag register (review-first detection output)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ce_compliance_review_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_number text NOT NULL,
  flag_type text NOT NULL,
  rule_code text,
  rule_id uuid,
  subject_type text NOT NULL DEFAULT 'EMPLOYER',
  subject_id text NOT NULL,
  subject_name text,
  employer_id text,
  period_key text,
  severity text NOT NULL DEFAULT 'Medium',
  status text NOT NULL DEFAULT 'OPEN',
  summary text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  triggering_violation_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  required_review_capability text NOT NULL DEFAULT 'compliance.review_flag.review',
  dedupe_key text NOT NULL,
  run_id uuid,
  reviewed_by text,
  reviewed_at timestamptz,
  disposition text,
  disposition_notes text,
  converted_violation_id uuid,
  excluded_from_risk boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ce_review_flag_status_chk CHECK (status IN ('OPEN','UNDER_REVIEW','CONFIRMED','DISMISSED','RESOLVED','SUPPRESSED')),
  CONSTRAINT ce_review_flag_subject_chk CHECK (subject_type IN ('EMPLOYER','PERSON','LEAD'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ce_review_flags_dedupe_uk ON public.ce_compliance_review_flags(dedupe_key);
CREATE INDEX IF NOT EXISTS ce_review_flags_subject_ix ON public.ce_compliance_review_flags(subject_type, subject_id, status);
CREATE INDEX IF NOT EXISTS ce_review_flags_type_ix ON public.ce_compliance_review_flags(flag_type, status);

GRANT SELECT, INSERT, UPDATE ON public.ce_compliance_review_flags TO authenticated;
GRANT ALL ON public.ce_compliance_review_flags TO service_role;
ALTER TABLE public.ce_compliance_review_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "review flags readable by compliance staff"
  ON public.ce_compliance_review_flags FOR SELECT TO authenticated USING (true);
CREATE POLICY "review flags writable by reviewers"
  ON public.ce_compliance_review_flags FOR INSERT TO authenticated
  WITH CHECK (public.ce_actor_can(auth.uid(),'compliance.violations.manage'));
CREATE POLICY "review flags updatable by reviewers"
  ON public.ce_compliance_review_flags FOR UPDATE TO authenticated
  USING (public.ce_actor_can(auth.uid(),'compliance.review_flag.review'))
  WITH CHECK (public.ce_actor_can(auth.uid(),'compliance.review_flag.review'));

CREATE TABLE IF NOT EXISTS public.ce_review_flag_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_id uuid NOT NULL REFERENCES public.ce_compliance_review_flags(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  notes text,
  actor text,
  actor_user_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ce_review_flag_events_ix ON public.ce_review_flag_events(flag_id, created_at DESC);
GRANT SELECT ON public.ce_review_flag_events TO authenticated;
GRANT ALL ON public.ce_review_flag_events TO service_role;
ALTER TABLE public.ce_review_flag_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "review flag events readable" ON public.ce_review_flag_events
  FOR SELECT TO authenticated USING (true);

-- ============================================================
-- 3. DR-007 contribution exemptions (person + employer + fund + period)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ce_contribution_exemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_ssn text NOT NULL,
  person_name text,
  employer_id text NOT NULL,
  fund_code text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  granting_authority text NOT NULL,
  authority_reference text,
  evidence_reference text,
  status text NOT NULL DEFAULT 'ACTIVE',
  notes text,
  recorded_by text,
  verified_by text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ce_exemption_fund_chk CHECK (fund_code IN ('LV','SV','SS')),
  CONSTRAINT ce_exemption_status_chk CHECK (status IN ('ACTIVE','REVOKED','EXPIRED','PENDING_VERIFICATION')),
  CONSTRAINT ce_exemption_period_chk CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS ce_exemptions_scope_ix
  ON public.ce_contribution_exemptions(person_ssn, employer_id, fund_code, effective_from);
GRANT SELECT, INSERT, UPDATE ON public.ce_contribution_exemptions TO authenticated;
GRANT ALL ON public.ce_contribution_exemptions TO service_role;
ALTER TABLE public.ce_contribution_exemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exemptions readable" ON public.ce_contribution_exemptions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "exemptions manageable" ON public.ce_contribution_exemptions
  FOR ALL TO authenticated
  USING (public.ce_actor_can(auth.uid(),'compliance.exemption.manage'))
  WITH CHECK (public.ce_actor_can(auth.uid(),'compliance.exemption.manage'));

-- ============================================================
-- 4. DR-009 headcount change tiers
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ce_headcount_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_code text NOT NULL UNIQUE,
  tier_label text NOT NULL,
  min_employer_size integer NOT NULL DEFAULT 0,
  max_employer_size integer,
  allowed_absolute_change integer NOT NULL,
  percentage_threshold numeric,
  is_enabled boolean NOT NULL DEFAULT true,
  requires_client_confirmation boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ce_headcount_tier_range_chk CHECK (max_employer_size IS NULL OR max_employer_size >= min_employer_size)
);
GRANT SELECT ON public.ce_headcount_tiers TO authenticated;
GRANT ALL ON public.ce_headcount_tiers TO service_role;
ALTER TABLE public.ce_headcount_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "headcount tiers readable" ON public.ce_headcount_tiers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "headcount tiers manageable" ON public.ce_headcount_tiers
  FOR ALL TO authenticated
  USING (public.ce_actor_can(auth.uid(),'compliance.config.manage'))
  WITH CHECK (public.ce_actor_can(auth.uid(),'compliance.config.manage'));
DROP TRIGGER IF EXISTS zz_ce_config_guard ON public.ce_headcount_tiers;
CREATE TRIGGER zz_ce_config_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ce_headcount_tiers
  FOR EACH ROW EXECUTE FUNCTION public.ce_config_guard_trg();

-- ============================================================
-- 5. DR-010 sector wage benchmarks
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ce_sector_wage_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_code text NOT NULL,
  sector_label text,
  calculated_minimum numeric,
  calculated_average numeric,
  sample_count integer NOT NULL DEFAULT 0,
  effective_from date NOT NULL,
  effective_to date,
  recalculated_at timestamptz,
  override_minimum numeric,
  override_average numeric,
  override_reason text,
  overridden_by text,
  overridden_at timestamptz,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ce_sector_benchmark_uk
  ON public.ce_sector_wage_benchmarks(sector_code, effective_from);
GRANT SELECT ON public.ce_sector_wage_benchmarks TO authenticated;
GRANT ALL ON public.ce_sector_wage_benchmarks TO service_role;
ALTER TABLE public.ce_sector_wage_benchmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "benchmarks readable" ON public.ce_sector_wage_benchmarks
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "benchmarks manageable" ON public.ce_sector_wage_benchmarks
  FOR ALL TO authenticated
  USING (public.ce_actor_can(auth.uid(),'compliance.config.manage'))
  WITH CHECK (public.ce_actor_can(auth.uid(),'compliance.config.manage'));

-- ============================================================
-- 6. DR-008 unregistered employer leads
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ce_unregistered_employer_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_number text NOT NULL UNIQUE,
  trade_name text NOT NULL,
  business_address text,
  parish text,
  contact_name text,
  contact_phone text,
  activity_type text,
  estimated_employees integer,
  source_type text NOT NULL DEFAULT 'INSPECTION',
  source_reference text,
  inspection_id uuid,
  matched_employer_id text,
  match_method text,
  match_confidence numeric,
  status text NOT NULL DEFAULT 'NEW',
  discovered_date date NOT NULL DEFAULT current_date,
  instructed_at timestamptz,
  register_by_date date,
  management_escalation_due date,
  escalated_at timestamptz,
  escalated_to text,
  legal_recommended boolean NOT NULL DEFAULT false,
  legal_recommended_by text,
  legal_recommended_at timestamptz,
  legal_approved_by text,
  legal_approved_at timestamptz,
  registered_employer_id text,
  resolved_at timestamptz,
  resolution_notes text,
  review_flag_id uuid,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ce_lead_status_chk CHECK (status IN
    ('NEW','MATCHED_REGISTERED','UNMATCHED','INSTRUCTED','REGISTERED','MANAGEMENT_QUEUE','LEGAL_RECOMMENDED','LEGAL_APPROVED','CLOSED'))
);
CREATE INDEX IF NOT EXISTS ce_leads_status_ix ON public.ce_unregistered_employer_leads(status, register_by_date);
GRANT SELECT, INSERT, UPDATE ON public.ce_unregistered_employer_leads TO authenticated;
GRANT ALL ON public.ce_unregistered_employer_leads TO service_role;
ALTER TABLE public.ce_unregistered_employer_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leads readable" ON public.ce_unregistered_employer_leads
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "leads manageable" ON public.ce_unregistered_employer_leads
  FOR ALL TO authenticated
  USING (public.ce_actor_can(auth.uid(),'compliance.registration_lead.manage'))
  WITH CHECK (public.ce_actor_can(auth.uid(),'compliance.registration_lead.manage'));

CREATE TABLE IF NOT EXISTS public.ce_unregistered_lead_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.ce_unregistered_employer_leads(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  notes text,
  actor text,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ce_unregistered_lead_events TO authenticated;
GRANT ALL ON public.ce_unregistered_lead_events TO service_role;
ALTER TABLE public.ce_unregistered_lead_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lead events readable" ON public.ce_unregistered_lead_events
  FOR SELECT TO authenticated USING (true);

-- ============================================================
-- 7. DR-011/012 authoritative employer status
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ce_employer_status_states (
  employer_id text PRIMARY KEY,
  status text NOT NULL,
  effective_date date NOT NULL DEFAULT current_date,
  evidence_type text NOT NULL,
  evidence_reference text,
  evidence_document_url text,
  clearance_certificate_reference text,
  reason text,
  changed_by text,
  changed_by_user_id uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ce_employer_status_chk CHECK (status IN ('ACTIVE','INACTIVE','CLOSED','CEASED')),
  CONSTRAINT ce_employer_status_evidence_chk CHECK (evidence_type IN
    ('INSPECTOR_VISIT','EMPLOYER_FORM','REGISTRY_NOTICE','COURT_ORDER','SYSTEM_MIGRATION','OTHER_DOCUMENTED'))
);
GRANT SELECT ON public.ce_employer_status_states TO authenticated;
GRANT ALL ON public.ce_employer_status_states TO service_role;
ALTER TABLE public.ce_employer_status_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY "employer status readable" ON public.ce_employer_status_states
  FOR SELECT TO authenticated USING (true);

-- ============================================================
-- 8. DR-013 self-employed / voluntary obligations + credits
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ce_self_employed_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_ssn text NOT NULL,
  person_name text,
  contributor_type text NOT NULL DEFAULT 'SELF_EMPLOYED',
  wage_period date NOT NULL,
  obligation_type text NOT NULL DEFAULT 'CONTRIBUTION_PAYMENT',
  expected_amount numeric NOT NULL DEFAULT 0,
  declared_amount numeric NOT NULL DEFAULT 0,
  paid_amount numeric NOT NULL DEFAULT 0,
  filing_received_date date,
  payment_received_date date,
  due_date date,
  grace_end_date date,
  status text NOT NULL DEFAULT 'OPEN',
  employer_reported boolean NOT NULL DEFAULT false,
  employer_reported_by text,
  suppressed boolean NOT NULL DEFAULT false,
  suppressed_reason text,
  suppressed_by text,
  suppressed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ce_se_contributor_chk CHECK (contributor_type IN ('SELF_EMPLOYED','VOLUNTARY')),
  CONSTRAINT ce_se_status_chk CHECK (status IN ('OPEN','SATISFIED','OUTSTANDING','SUPPRESSED','WAIVED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ce_se_obligation_uk
  ON public.ce_self_employed_obligations(person_ssn, wage_period, obligation_type);
GRANT SELECT, INSERT, UPDATE ON public.ce_self_employed_obligations TO authenticated;
GRANT ALL ON public.ce_self_employed_obligations TO service_role;
ALTER TABLE public.ce_self_employed_obligations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "se obligations readable" ON public.ce_self_employed_obligations
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "se obligations manageable" ON public.ce_self_employed_obligations
  FOR ALL TO authenticated
  USING (public.ce_actor_can(auth.uid(),'compliance.violations.manage'))
  WITH CHECK (public.ce_actor_can(auth.uid(),'compliance.violations.manage'));

CREATE TABLE IF NOT EXISTS public.ce_contribution_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_ssn text NOT NULL,
  employer_id text,
  wage_period date,
  source_type text NOT NULL DEFAULT 'OVER_CONTRIBUTION',
  amount numeric NOT NULL,
  applied_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'OPEN',
  finance_handoff_reference text,
  finance_handoff_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ce_credit_status_chk CHECK (status IN ('OPEN','PARTIALLY_APPLIED','APPLIED','HANDED_OFF_TO_FINANCE','CANCELLED')),
  CONSTRAINT ce_credit_amount_chk CHECK (amount > 0)
);
CREATE INDEX IF NOT EXISTS ce_credits_person_ix ON public.ce_contribution_credits(person_ssn, status);
GRANT SELECT, INSERT, UPDATE ON public.ce_contribution_credits TO authenticated;
GRANT ALL ON public.ce_contribution_credits TO service_role;
ALTER TABLE public.ce_contribution_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "credits readable" ON public.ce_contribution_credits
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "credits manageable" ON public.ce_contribution_credits
  FOR ALL TO authenticated
  USING (public.ce_actor_can(auth.uid(),'compliance.violations.manage'))
  WITH CHECK (public.ce_actor_can(auth.uid(),'compliance.violations.manage'));

-- ============================================================
-- 9. DR-006 installment reminders + management resolution
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ce_arrangement_installment_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arrangement_id uuid NOT NULL,
  installment_id uuid NOT NULL,
  employer_id text NOT NULL,
  installment_due_date date NOT NULL,
  reminder_date date NOT NULL,
  lead_days integer NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  dispatched_at timestamptz,
  dispatch_reference text,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ce_arr_reminder_status_chk CHECK (status IN ('PENDING','SENT','SKIPPED','FAILED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ce_arr_reminder_uk
  ON public.ce_arrangement_installment_reminders(installment_id, reminder_date);
GRANT SELECT ON public.ce_arrangement_installment_reminders TO authenticated;
GRANT ALL ON public.ce_arrangement_installment_reminders TO service_role;
ALTER TABLE public.ce_arrangement_installment_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "arrangement reminders readable" ON public.ce_arrangement_installment_reminders
  FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.ce_violation_resolution_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  description text,
  requires_management_authorization boolean NOT NULL DEFAULT false,
  requires_note boolean NOT NULL DEFAULT true,
  excluded_from_risk_scoring boolean NOT NULL DEFAULT false,
  is_payment_resolution boolean NOT NULL DEFAULT false,
  is_enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ce_violation_resolution_types TO authenticated;
GRANT ALL ON public.ce_violation_resolution_types TO service_role;
ALTER TABLE public.ce_violation_resolution_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "resolution types readable" ON public.ce_violation_resolution_types
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "resolution types manageable" ON public.ce_violation_resolution_types
  FOR ALL TO authenticated
  USING (public.ce_actor_can(auth.uid(),'compliance.config.manage'))
  WITH CHECK (public.ce_actor_can(auth.uid(),'compliance.config.manage'));
DROP TRIGGER IF EXISTS zz_ce_config_guard ON public.ce_violation_resolution_types;
CREATE TRIGGER zz_ce_config_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ce_violation_resolution_types
  FOR EACH ROW EXECUTE FUNCTION public.ce_config_guard_trg();

ALTER TABLE public.ce_violations
  ADD COLUMN IF NOT EXISTS resolution_type_code text,
  ADD COLUMN IF NOT EXISTS resolution_authorized_by text,
  ADD COLUMN IF NOT EXISTS resolution_authorized_at timestamptz,
  ADD COLUMN IF NOT EXISTS excluded_from_risk boolean NOT NULL DEFAULT false;

INSERT INTO public.ce_violation_resolution_types
  (code,label,description,requires_management_authorization,requires_note,excluded_from_risk_scoring,is_payment_resolution,sort_order)
VALUES
  ('PAYMENT_RECEIVED','Resolved by Payment','The underlying liability was settled in full.',false,false,false,true,10),
  ('FILING_RECEIVED','Resolved by Filing','The outstanding return was submitted.',false,false,false,false,20),
  ('WAIVED_RESOLVED_BY_AGREEMENT','Waived / Resolved by Agreement','Management authorised closure of the violation by agreement with the employer. The violation is retained with full history and excluded from risk scoring.',true,true,true,false,30),
  ('CORRECTED_IN_ERROR','Raised in Error','Detection was incorrect; retained for audit.',false,true,true,false,40)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 10. Governed actions
-- ============================================================
CREATE OR REPLACE FUNCTION public.ce_b2_audit(p_action text, p_entity text, p_entity_id text, p_payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid;
BEGIN
  BEGIN v_uid := auth.uid(); EXCEPTION WHEN OTHERS THEN v_uid := NULL; END;
  INSERT INTO public.system_audit_trail
    (action, module, entity_type, entity_id, severity, payload_json, user_id, user_name, timestamp)
  VALUES (p_action,'Compliance',p_entity,COALESCE(p_entity_id,'-'),'info',COALESCE(p_payload,'{}'::jsonb),
          v_uid, public.ce_actor_user_code(v_uid), now());
END $$;

-- 10a. Review a detection flag
CREATE OR REPLACE FUNCTION public.ce_review_flag_disposition_v1(
  p_flag_id uuid, p_disposition text, p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_flag public.ce_compliance_review_flags;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-FLAG-401: authentication required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_flag FROM public.ce_compliance_review_flags WHERE id = p_flag_id;
  IF v_flag.id IS NULL THEN
    RAISE EXCEPTION 'CE-FLAG-404: review flag not found' USING ERRCODE='22023';
  END IF;
  IF NOT public.ce_actor_can(v_uid, v_flag.required_review_capability) THEN
    RAISE EXCEPTION 'CE-FLAG-403: % is required to review this flag', v_flag.required_review_capability
      USING ERRCODE='42501';
  END IF;
  IF p_disposition NOT IN ('CONFIRMED','DISMISSED','RESOLVED','SUPPRESSED','UNDER_REVIEW') THEN
    RAISE EXCEPTION 'CE-FLAG-422: invalid disposition %', p_disposition USING ERRCODE='22023';
  END IF;
  IF p_disposition <> 'UNDER_REVIEW' AND COALESCE(trim(p_notes),'') = '' THEN
    RAISE EXCEPTION 'CE-FLAG-422: a review note is required' USING ERRCODE='22023';
  END IF;

  v_actor := left(public.ce_actor_user_code(v_uid),100);
  v_status := p_disposition;

  UPDATE public.ce_compliance_review_flags
     SET status = v_status,
         disposition = CASE WHEN p_disposition='UNDER_REVIEW' THEN disposition ELSE p_disposition END,
         disposition_notes = COALESCE(p_notes, disposition_notes),
         reviewed_by = v_actor,
         reviewed_at = now(),
         excluded_from_risk = (p_disposition IN ('DISMISSED','SUPPRESSED')),
         updated_at = now()
   WHERE id = p_flag_id;

  INSERT INTO public.ce_review_flag_events(flag_id,event_type,from_status,to_status,notes,actor,actor_user_id)
  VALUES (p_flag_id,'DISPOSITION',v_flag.status,v_status,p_notes,v_actor,v_uid);

  PERFORM public.ce_b2_audit('ce.review_flag.disposition','ce_compliance_review_flags',p_flag_id::text,
    jsonb_build_object('disposition',p_disposition,'flag_type',v_flag.flag_type,'subject',v_flag.subject_id));
  RETURN p_flag_id;
END $$;

-- 10b. Management resolution by agreement (DR-006)
CREATE OR REPLACE FUNCTION public.ce_resolve_violation_by_agreement_v1(
  p_violation_id uuid, p_notes text, p_resolution_code text DEFAULT 'WAIVED_RESOLVED_BY_AGREEMENT')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_type public.ce_violation_resolution_types;
  v_prev text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-VRES-401: authentication required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_type FROM public.ce_violation_resolution_types
   WHERE code = p_resolution_code AND is_enabled;
  IF v_type.id IS NULL THEN
    RAISE EXCEPTION 'CE-VRES-422: unknown resolution type %', p_resolution_code USING ERRCODE='22023';
  END IF;
  IF v_type.requires_management_authorization
     AND NOT public.ce_actor_can(v_uid,'compliance.management.resolve') THEN
    RAISE EXCEPTION 'CE-VRES-403: management authorisation is required for %', p_resolution_code
      USING ERRCODE='42501';
  END IF;
  IF v_type.requires_note AND COALESCE(trim(p_notes),'') = '' THEN
    RAISE EXCEPTION 'CE-VRES-422: a written reason is required for %', p_resolution_code USING ERRCODE='22023';
  END IF;

  SELECT status INTO v_prev FROM public.ce_violations WHERE id = p_violation_id;
  IF v_prev IS NULL THEN
    RAISE EXCEPTION 'CE-VRES-404: violation not found' USING ERRCODE='22023';
  END IF;

  v_actor := left(public.ce_actor_user_code(v_uid),100);

  UPDATE public.ce_violations
     SET status = 'RESOLVED',
         resolution_type_code = p_resolution_code,
         resolution_notes = p_notes,
         resolution_authorized_by = v_actor,
         resolution_authorized_at = now(),
         excluded_from_risk = v_type.excluded_from_risk_scoring,
         resolved_at = now(),
         resolved_by = v_actor,
         updated_by = v_actor,
         updated_at = now()
   WHERE id = p_violation_id;

  INSERT INTO public.ce_violation_history(violation_id, action, from_status, to_status, notes, performed_by, performed_at)
  VALUES (p_violation_id, 'RESOLVED_BY_AGREEMENT', v_prev, 'RESOLVED', p_notes, v_actor, now());

  PERFORM public.ce_b2_audit('ce.violation.resolved_by_agreement','ce_violations',p_violation_id::text,
    jsonb_build_object('resolution_code',p_resolution_code,'previous_status',v_prev));
  RETURN p_violation_id;
END $$;

-- 10c. Authoritative employer status change (DR-011/012)
CREATE OR REPLACE FUNCTION public.ce_set_employer_status_v1(
  p_employer_id text, p_status text, p_evidence_type text,
  p_evidence_reference text DEFAULT NULL, p_reason text DEFAULT NULL,
  p_effective_date date DEFAULT NULL, p_clearance_reference text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_prev text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-EST-401: authentication required' USING ERRCODE='42501';
  END IF;
  IF NOT public.ce_actor_can(v_uid,'compliance.employer_status.change') THEN
    RAISE EXCEPTION 'CE-EST-403: not authorised to change employer status' USING ERRCODE='42501';
  END IF;
  IF p_status NOT IN ('ACTIVE','INACTIVE','CLOSED','CEASED') THEN
    RAISE EXCEPTION 'CE-EST-422: invalid employer status %', p_status USING ERRCODE='22023';
  END IF;
  IF COALESCE(trim(p_evidence_type),'') = ''
     OR p_evidence_type NOT IN ('INSPECTOR_VISIT','EMPLOYER_FORM','REGISTRY_NOTICE','COURT_ORDER','SYSTEM_MIGRATION','OTHER_DOCUMENTED') THEN
    RAISE EXCEPTION 'CE-EST-422: supporting evidence type is required for a status change' USING ERRCODE='22023';
  END IF;
  IF COALESCE(trim(p_evidence_reference),'') = '' THEN
    RAISE EXCEPTION 'CE-EST-422: an evidence reference is required for a status change' USING ERRCODE='22023';
  END IF;

  v_actor := left(public.ce_actor_user_code(v_uid),100);
  SELECT status INTO v_prev FROM public.ce_employer_status_states WHERE employer_id = p_employer_id;

  INSERT INTO public.ce_employer_status_states AS s
    (employer_id,status,effective_date,evidence_type,evidence_reference,
     clearance_certificate_reference,reason,changed_by,changed_by_user_id,changed_at)
  VALUES (p_employer_id,p_status,COALESCE(p_effective_date,current_date),p_evidence_type,p_evidence_reference,
          p_clearance_reference,p_reason,v_actor,v_uid,now())
  ON CONFLICT (employer_id) DO UPDATE
    SET status = EXCLUDED.status,
        effective_date = EXCLUDED.effective_date,
        evidence_type = EXCLUDED.evidence_type,
        evidence_reference = EXCLUDED.evidence_reference,
        clearance_certificate_reference = EXCLUDED.clearance_certificate_reference,
        reason = EXCLUDED.reason,
        changed_by = EXCLUDED.changed_by,
        changed_by_user_id = EXCLUDED.changed_by_user_id,
        changed_at = now(),
        updated_at = now();

  INSERT INTO public.ce_employer_status_history(employer_id, previous_status, new_status, changed_at, changed_by, reason)
  VALUES (p_employer_id, v_prev, p_status, now(), v_actor,
          COALESCE(p_reason,'') || ' [evidence: ' || p_evidence_type || ' ' || COALESCE(p_evidence_reference,'') || ']');

  PERFORM public.ce_b2_audit('ce.employer_status.changed','ce_employer_status_states',p_employer_id,
    jsonb_build_object('from',v_prev,'to',p_status,'evidence_type',p_evidence_type,'evidence_reference',p_evidence_reference));
  RETURN p_status;
END $$;

-- 10d. Sector benchmark override (DR-010)
CREATE OR REPLACE FUNCTION public.ce_override_sector_benchmark_v1(
  p_benchmark_id uuid, p_override_minimum numeric, p_override_average numeric, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_actor text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-BMK-401: authentication required' USING ERRCODE='42501';
  END IF;
  IF NOT public.ce_actor_can(v_uid,'compliance.benchmark.override') THEN
    RAISE EXCEPTION 'CE-BMK-403: not authorised to override sector benchmarks' USING ERRCODE='42501';
  END IF;
  IF COALESCE(trim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'CE-BMK-422: an override reason is required' USING ERRCODE='22023';
  END IF;
  v_actor := left(public.ce_actor_user_code(v_uid),100);

  UPDATE public.ce_sector_wage_benchmarks
     SET override_minimum = p_override_minimum,
         override_average = p_override_average,
         override_reason = p_reason,
         overridden_by = v_actor,
         overridden_at = now(),
         updated_at = now()
   WHERE id = p_benchmark_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CE-BMK-404: benchmark not found' USING ERRCODE='22023';
  END IF;

  PERFORM public.ce_b2_audit('ce.sector_benchmark.override','ce_sector_wage_benchmarks',p_benchmark_id::text,
    jsonb_build_object('override_minimum',p_override_minimum,'override_average',p_override_average,'reason',p_reason));
  RETURN p_benchmark_id;
END $$;

-- 10e. Unregistered lead progression (DR-008)
CREATE OR REPLACE FUNCTION public.ce_progress_registration_lead_v1(
  p_lead_id uuid, p_action text, p_notes text DEFAULT NULL, p_registered_employer_id text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_lead public.ce_unregistered_employer_leads;
  v_to text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-LEAD-401: authentication required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_lead FROM public.ce_unregistered_employer_leads WHERE id = p_lead_id;
  IF v_lead.id IS NULL THEN
    RAISE EXCEPTION 'CE-LEAD-404: lead not found' USING ERRCODE='22023';
  END IF;
  IF NOT public.ce_actor_can(v_uid,'compliance.registration_lead.manage') THEN
    RAISE EXCEPTION 'CE-LEAD-403: not authorised to manage registration leads' USING ERRCODE='42501';
  END IF;
  IF p_action IN ('APPROVE_LEGAL') AND NOT public.ce_actor_can(v_uid,'compliance.legal.recommend_approve') THEN
    RAISE EXCEPTION 'CE-LEAD-403: management approval is required before legal escalation' USING ERRCODE='42501';
  END IF;
  IF COALESCE(trim(p_notes),'') = '' THEN
    RAISE EXCEPTION 'CE-LEAD-422: a note is required for every lead action' USING ERRCODE='22023';
  END IF;

  v_actor := left(public.ce_actor_user_code(v_uid),100);

  v_to := CASE p_action
    WHEN 'INSTRUCT'        THEN 'INSTRUCTED'
    WHEN 'REGISTERED'      THEN 'REGISTERED'
    WHEN 'ESCALATE'        THEN 'MANAGEMENT_QUEUE'
    WHEN 'RECOMMEND_LEGAL' THEN 'LEGAL_RECOMMENDED'
    WHEN 'APPROVE_LEGAL'   THEN 'LEGAL_APPROVED'
    WHEN 'CLOSE'           THEN 'CLOSED'
    ELSE NULL END;
  IF v_to IS NULL THEN
    RAISE EXCEPTION 'CE-LEAD-422: unknown action %', p_action USING ERRCODE='22023';
  END IF;

  UPDATE public.ce_unregistered_employer_leads
     SET status = v_to,
         instructed_at = CASE WHEN p_action='INSTRUCT' THEN now() ELSE instructed_at END,
         escalated_at = CASE WHEN p_action='ESCALATE' THEN now() ELSE escalated_at END,
         legal_recommended = CASE WHEN p_action IN ('RECOMMEND_LEGAL','APPROVE_LEGAL') THEN true ELSE legal_recommended END,
         legal_recommended_by = CASE WHEN p_action='RECOMMEND_LEGAL' THEN v_actor ELSE legal_recommended_by END,
         legal_recommended_at = CASE WHEN p_action='RECOMMEND_LEGAL' THEN now() ELSE legal_recommended_at END,
         legal_approved_by = CASE WHEN p_action='APPROVE_LEGAL' THEN v_actor ELSE legal_approved_by END,
         legal_approved_at = CASE WHEN p_action='APPROVE_LEGAL' THEN now() ELSE legal_approved_at END,
         registered_employer_id = COALESCE(p_registered_employer_id, registered_employer_id),
         resolved_at = CASE WHEN p_action IN ('REGISTERED','CLOSE') THEN now() ELSE resolved_at END,
         resolution_notes = CASE WHEN p_action IN ('REGISTERED','CLOSE') THEN p_notes ELSE resolution_notes END,
         updated_at = now()
   WHERE id = p_lead_id;

  INSERT INTO public.ce_unregistered_lead_events(lead_id,event_type,from_status,to_status,notes,actor,actor_user_id)
  VALUES (p_lead_id,p_action,v_lead.status,v_to,p_notes,v_actor,v_uid);

  IF p_action IN ('REGISTERED','CLOSE') AND v_lead.review_flag_id IS NOT NULL THEN
    UPDATE public.ce_compliance_review_flags
       SET status='RESOLVED', disposition='RESOLVED', disposition_notes=p_notes,
           reviewed_by=v_actor, reviewed_at=now(), updated_at=now()
     WHERE id = v_lead.review_flag_id;
  END IF;

  PERFORM public.ce_b2_audit('ce.registration_lead.'||lower(p_action),'ce_unregistered_employer_leads',p_lead_id::text,
    jsonb_build_object('from',v_lead.status,'to',v_to));
  RETURN v_to;
END $$;

-- 10f. Self-employed obligation suppression (DR-013)
CREATE OR REPLACE FUNCTION public.ce_suppress_self_employed_obligation_v1(
  p_obligation_id uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_actor text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-SE-401: authentication required' USING ERRCODE='42501';
  END IF;
  IF NOT public.ce_actor_can(v_uid,'compliance.violations.manage') THEN
    RAISE EXCEPTION 'CE-SE-403: not authorised' USING ERRCODE='42501';
  END IF;
  IF COALESCE(trim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'CE-SE-422: a suppression reason is required' USING ERRCODE='22023';
  END IF;
  v_actor := left(public.ce_actor_user_code(v_uid),100);
  UPDATE public.ce_self_employed_obligations
     SET suppressed = true, suppressed_reason = p_reason, suppressed_by = v_actor,
         suppressed_at = now(), status = 'SUPPRESSED', updated_at = now()
   WHERE id = p_obligation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CE-SE-404: obligation not found' USING ERRCODE='22023';
  END IF;
  PERFORM public.ce_b2_audit('ce.self_employed.suppressed','ce_self_employed_obligations',p_obligation_id::text,
    jsonb_build_object('reason',p_reason));
  RETURN p_obligation_id;
END $$;

-- ============================================================
-- 11. Seeds (defaults; slab values flagged for client confirmation)
-- ============================================================
INSERT INTO public.ce_headcount_tiers
  (tier_code,tier_label,min_employer_size,max_employer_size,allowed_absolute_change,percentage_threshold,is_enabled,requires_client_confirmation,sort_order,notes)
VALUES
  ('MICRO','Micro employer (1-5)',1,5,2,NULL,true,true,10,'Slab value pending client confirmation — absolute change only, percentage logic not applied below the minimum employer size.'),
  ('SMALL','Small employer (6-20)',6,20,3,30,true,true,20,'Slab value pending client confirmation.'),
  ('MEDIUM','Medium employer (21-100)',21,100,5,20,true,true,30,'Slab value pending client confirmation.'),
  ('LARGE','Large employer (101+)',101,NULL,10,10,true,true,40,'Slab value pending client confirmation.')
ON CONFLICT (tier_code) DO NOTHING;

-- Authoritative employer status backfill from the existing register.
INSERT INTO public.ce_employer_status_states(employer_id,status,effective_date,evidence_type,evidence_reference,reason,changed_by)
SELECT e.regno,
       CASE upper(COALESCE(e.status,'A'))
         WHEN 'A' THEN 'ACTIVE' WHEN 'I' THEN 'INACTIVE'
         WHEN 'C' THEN 'CLOSED' WHEN 'D' THEN 'CEASED' ELSE 'ACTIVE' END,
       current_date,'SYSTEM_MIGRATION','B2-BACKFILL','Backfilled from the employer register at Checkpoint B2.','SYSTEM'
FROM public.au_er_master e
ON CONFLICT (employer_id) DO NOTHING;

-- Detection rule realignment ---------------------------------
UPDATE public.ce_detection_rules SET
  name = 'Repeat Offender Review',
  auto_create_violation = false,
  parameters = jsonb_build_object(
    'violation_count_threshold',3,'rolling_months',12,'same_type_only',true,
    'require_consecutive',false,'count_basis','ALL_OCCURRENCES',
    'review_capability','compliance.review_flag.review'),
  updated_at = now()
WHERE rule_code = 'DR-005';

UPDATE public.ce_detection_rules SET
  name = 'Arrangement Breach Detection',
  auto_create_violation = true,
  parameters = jsonb_build_object(
    'grace_days_after_installment',0,'reminder_lead_days',15,
    'partial_installment_is_breach',true),
  updated_at = now()
WHERE rule_code = 'DR-006';

UPDATE public.ce_detection_rules SET
  name = 'Levy / Severance / Social Security Omission',
  auto_create_violation = true,
  parameters = jsonb_build_object(
    'check_funds', jsonb_build_array('LV','SV'),
    'zero_threshold',0,'lookback_months',24),
  updated_at = now()
WHERE rule_code = 'DR-007';

UPDATE public.ce_detection_rules SET
  name = 'Unregistered Employer Operating',
  auto_create_violation = false,
  parameters = jsonb_build_object(
    'registration_response_days',14,'management_escalation_days',21,
    'match_on_trade_name',true,'match_on_address',true),
  updated_at = now()
WHERE rule_code = 'DR-008';

UPDATE public.ce_detection_rules SET
  name = 'Employee Count Discrepancy / Headcount Anomaly',
  auto_create_violation = false,
  parameters = jsonb_build_object(
    'use_size_tiers',true,'historical_baseline_periods',6,
    'min_employer_size_for_percentage',5,
    'historical_change_percent',30,'historical_change_absolute',5),
  updated_at = now()
WHERE rule_code = 'DR-009';

UPDATE public.ce_detection_rules SET
  name = 'Wage Under-Declaration / Wage Anomaly',
  auto_create_violation = false,
  parameters = jsonb_build_object(
    'enable_sector_benchmark',true,'enable_historical_variance',true,
    'benchmark_variance_percent',30,'historical_variance_percent',30,
    'lookback_periods',6,'benchmark_recalc_cadence','MONTHLY'),
  updated_at = now()
WHERE rule_code = 'DR-010';

UPDATE public.ce_detection_rules SET
  name = 'Improper Cessation / Closure',
  auto_create_violation = true,
  parameters = jsonb_build_object(
    'trigger_on_status', jsonb_build_array('CLOSED','CEASED','INACTIVE'),
    'require_clearance_certificate',true,'min_outstanding_amount_xcd',0),
  updated_at = now()
WHERE rule_code = 'DR-011';

UPDATE public.ce_detection_rules SET
  name = 'Contribution / Reporting Gap',
  auto_create_violation = true,
  parameters = jsonb_build_object(
    'days_past_deadline',30,'min_missed_months',2,'lookback_months',120),
  updated_at = now()
WHERE rule_code = 'DR-012';

UPDATE public.ce_detection_rules SET
  name = 'Self-Employed / Voluntary Non-Compliance',
  trigger_event = 'self_employed_non_compliance',
  auto_create_violation = true,
  parameters = jsonb_build_object(
    'include_voluntary',true,'consolidate_reminders',true,
    'auto_legal_escalation',false,'over_contribution_creates_credit',true,
    'flag_employer_overlap',true,'lookback_months',24),
  description = 'Self-employed and voluntary contributor obligations follow the employer obligation timeline. Multi-period notices are consolidated; legal escalation stays manual.',
  updated_at = now()
WHERE rule_code = 'DR-013';
