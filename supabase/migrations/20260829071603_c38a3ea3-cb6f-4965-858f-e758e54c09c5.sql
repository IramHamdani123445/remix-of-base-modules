
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ===========================================================
-- 1. Reusable configuration audit (extends ce_rule_history)
-- ===========================================================
ALTER TABLE public.ce_rule_history
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS actor_user_id uuid,
  ADD COLUMN IF NOT EXISTS scope jsonb;

CREATE INDEX IF NOT EXISTS idx_ce_rule_history_table_time
  ON public.ce_rule_history (rule_table, changed_at DESC);

-- Optional reason channel for governed config writes
CREATE OR REPLACE FUNCTION public.ce_set_change_reason(p_reason text)
RETURNS void LANGUAGE sql VOLATILE SET search_path TO 'public' AS $$
  SELECT set_config('ce.change_reason', coalesce(p_reason,''), true)::void;
$$;
GRANT EXECUTE ON FUNCTION public.ce_set_change_reason(text) TO authenticated, service_role;

-- Is the current session a trusted backend session (migration / service role / cron)?
CREATE OR REPLACE FUNCTION public.ce_is_trusted_session()
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE v_uid uuid;
BEGIN
  BEGIN v_uid := auth.uid(); EXCEPTION WHEN OTHERS THEN v_uid := NULL; END;
  IF v_uid IS NOT NULL THEN RETURN false; END IF;
  RETURN current_user IN ('postgres','supabase_admin','service_role','supabase_auth_admin');
END $$;

-- ===========================================================
-- 2. Capability extension (reuses ce_actor_can model)
-- ===========================================================
CREATE OR REPLACE FUNCTION public.ce_actor_can(_user_id uuid, _capability text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
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
      'compliance.legal.override','compliance.workflow.override']
    WHEN 'senior' THEN ARRAY[
      'compliance.field.execute','compliance.field.plan','compliance.field.approve_plans',
      'compliance.field.report','compliance.field.approve_reports','compliance.field.sampling',
      'compliance.violations.manage','compliance.violations.link_to_case',
      'compliance.cases.manage','compliance.inspections.view_employer_history',
      'compliance.enforcement.notices','compliance.enforcement.arrangements',
      'compliance.enforcement.legal','compliance.workbench.team','compliance.reports.operational',
      'compliance.waiver.approve']
    WHEN 'inspector' THEN ARRAY[
      'compliance.field.execute','compliance.field.plan','compliance.field.report',
      'compliance.violations.manage','compliance.cases.manage',
      'compliance.enforcement.notices','compliance.reports.operational']
    ELSE ARRAY[]::text[]
  END;

  IF _capability = ANY (v_caps) THEN RETURN true; END IF;

  -- Governance capabilities never fall back to the legacy blanket permission.
  IF _capability IN ('compliance.config.manage','compliance.schedule.manage',
                     'compliance.waiver.approve_high','compliance.legal.override',
                     'compliance.workflow.override') THEN
    RETURN false;
  END IF;

  IF _capability = 'compliance.waiver.approve' THEN
    RETURN public.has_permission(_user_id, 'manage_compliance', 'approve');
  END IF;

  RETURN public.has_permission(_user_id, 'manage_compliance',
           CASE WHEN _capability LIKE '%.approve%' THEN 'approve' ELSE 'edit' END);
END;
$$;

-- ===========================================================
-- 3. Generic config authorization guard + history triggers
-- ===========================================================
CREATE OR REPLACE FUNCTION public.ce_config_guard_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid;
  v_row jsonb := to_jsonb(COALESCE(NEW, OLD));
  v_cap text := CASE WHEN TG_TABLE_NAME = 'ce_automation_jobs'
                     THEN 'compliance.schedule.manage'
                     ELSE 'compliance.config.manage' END;
BEGIN
  -- feature_flags is a platform-wide table: only govern compliance flags here
  IF TG_TABLE_NAME = 'feature_flags'
     AND COALESCE(v_row->>'flag_key','') NOT LIKE 'compliance.%' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF public.ce_is_trusted_session() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  BEGIN v_uid := auth.uid(); EXCEPTION WHEN OTHERS THEN v_uid := NULL; END;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-AUTHZ-001: authentication required to change % configuration', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.ce_actor_can(v_uid, v_cap) THEN
    INSERT INTO public.system_audit_trail
      (action, module, entity_type, entity_id, severity, payload_json, user_id, user_name, timestamp)
    VALUES ('ce.config.change_denied','Compliance',TG_TABLE_NAME,
            COALESCE(v_row->>'id','-'),'warning',
            jsonb_build_object('operation',TG_OP,'required_capability',v_cap),
            v_uid, public.ce_actor_user_code(v_uid), now());
    RAISE EXCEPTION 'CE-AUTHZ-002: % is required to change % configuration', v_cap, TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;

CREATE OR REPLACE FUNCTION public.ce_config_history_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid;
  v_before jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_after  jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  v_row jsonb := COALESCE(v_after, v_before);
  v_code text;
  v_actor text;
  v_reason text := NULLIF(current_setting('ce.change_reason', true), '');
BEGIN
  IF TG_OP = 'UPDATE' AND v_before = v_after THEN RETURN NULL; END IF;

  BEGIN v_uid := auth.uid(); EXCEPTION WHEN OTHERS THEN v_uid := NULL; END;

  v_code := COALESCE(v_row->>'rule_code', v_row->>'policy_code', v_row->>'code',
                     v_row->>'job_code', v_row->>'event_key', v_row->>'factor_code',
                     v_row->>'flag_key', v_row->>'id');

  v_actor := COALESCE(
    CASE WHEN v_uid IS NULL THEN NULL ELSE public.ce_actor_user_code(v_uid) END,
    v_row->>'updated_by', v_row->>'created_by', current_user);

  INSERT INTO public.ce_rule_history
    (rule_table, rule_id, rule_code, action, before_value, after_value,
     changed_by, changed_at, notes, reason, actor_user_id, scope)
  VALUES
    (TG_TABLE_NAME, NULLIF(v_row->>'id','')::uuid, v_code, TG_OP,
     v_before, v_after, left(v_actor, 100), now(), NULL, v_reason, v_uid,
     jsonb_strip_nulls(jsonb_build_object(
       'effective_from', v_row->>'effective_from',
       'effective_to',   v_row->>'effective_to',
       'version',        COALESCE(v_row->>'policy_version', v_row->>'version'),
       'scope_key',      v_row->>'scope_key')));

  INSERT INTO public.system_audit_trail
    (action, module, entity_type, entity_id, severity, before_value, after_value,
     payload_json, user_id, user_name, timestamp)
  VALUES
    ('ce.config.' || lower(TG_OP), 'Compliance', TG_TABLE_NAME,
     COALESCE(v_row->>'id','-'), 'info', v_before, v_after,
     jsonb_build_object('rule_code', v_code, 'reason', v_reason),
     v_uid, left(v_actor,100), now());

  RETURN NULL;
END $$;

DO $$
DECLARE
  t text;
  candidates text[] := ARRAY[
    'ce_detection_rules','ce_calculation_rules','ce_escalation_rules',
    'ce_compliance_policies','ce_risk_policies','ce_risk_config',
    'ce_arrangement_policies','ce_legal_handoff_rules','ce_waiver_rules',
    'ce_automation_jobs','ce_workflow_mappings','ce_legal_escalation_policies',
    'ce_comm_trigger_rules','ce_communication_trigger_rules','feature_flags',
    'ce_risk_bands','ce_risk_score_bands'];
BEGIN
  FOREACH t IN ARRAY candidates LOOP
    IF to_regclass('public.'||t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS zz_ce_config_guard ON public.%I', t);
    EXECUTE format('CREATE TRIGGER zz_ce_config_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.ce_config_guard_trg()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS zz_ce_config_history ON public.%I', t);
    EXECUTE format('CREATE TRIGGER zz_ce_config_history AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.ce_config_history_trg()', t);
  END LOOP;
END $$;

-- ===========================================================
-- 4. Active-policy integrity
-- ===========================================================
ALTER TABLE public.ce_arrangement_policies
  ADD COLUMN IF NOT EXISTS scope_key text NOT NULL DEFAULT 'DEFAULT';

UPDATE public.ce_arrangement_policies
   SET scope_key = 'HARDSHIP'
 WHERE policy_code = 'AP-HRD-001' AND scope_key = 'DEFAULT';

CREATE UNIQUE INDEX IF NOT EXISTS uq_ce_arrangement_policy_active_scope
  ON public.ce_arrangement_policies (scope_key) WHERE is_active;

ALTER TABLE public.ce_compliance_policies
  DROP CONSTRAINT IF EXISTS excl_ce_compliance_policy_active;
ALTER TABLE public.ce_compliance_policies
  ADD CONSTRAINT excl_ce_compliance_policy_active
  EXCLUDE USING gist (
    policy_code WITH =,
    daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[)') WITH &&
  ) WHERE (is_active);

ALTER TABLE public.ce_legal_escalation_policies
  DROP CONSTRAINT IF EXISTS excl_ce_legal_escalation_policy_active;
ALTER TABLE public.ce_legal_escalation_policies
  ADD CONSTRAINT excl_ce_legal_escalation_policy_active
  EXCLUDE USING gist (
    policy_code WITH =,
    daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[)') WITH &&
  ) WHERE (is_active);

ALTER TABLE public.ce_risk_policies
  DROP CONSTRAINT IF EXISTS excl_ce_risk_policy_active;
ALTER TABLE public.ce_risk_policies
  ADD CONSTRAINT excl_ce_risk_policy_active
  EXCLUDE USING gist (
    policy_code WITH =,
    daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[)') WITH &&
  ) WHERE (status = 'ACTIVE');

-- Deterministic, scope-aware arrangement grace resolution
CREATE OR REPLACE FUNCTION public.ce_arrangement_grace_days(p_scope_key text DEFAULT 'DEFAULT')
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(
    (SELECT breach_grace_days FROM public.ce_arrangement_policies
      WHERE is_active AND scope_key = COALESCE(p_scope_key,'DEFAULT') LIMIT 1),
    (SELECT breach_grace_days FROM public.ce_arrangement_policies
      WHERE is_active AND scope_key = 'DEFAULT' LIMIT 1)
  );
$$;
