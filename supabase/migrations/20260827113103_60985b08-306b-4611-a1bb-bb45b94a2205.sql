-- =====================================================================
-- INTERNAL AUDIT — WAVE 1: TRUST, SECURITY & CANONICAL FOUNDATION
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CANONICAL IDENTITY + SCOPE HELPERS (ADR-06 / item 6, 7)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ia_current_profile_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT p.id FROM public.profiles p WHERE p.id = auth.uid() $$;

COMMENT ON FUNCTION public.ia_current_profile_id() IS
  'ADR-06: canonical Internal Audit identity = profiles.id = auth.uid().';

CREATE OR REPLACE FUNCTION public.ia_current_auditor_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT a.id FROM public.ia_auditors a
  WHERE auth.uid() IS NOT NULL
    AND (a.profile_id = auth.uid() OR a.user_id = auth.uid())
  ORDER BY a.created_at LIMIT 1
$$;

COMMENT ON FUNCTION public.ia_current_auditor_id() IS
  'ADR-06: professional-metadata record for the canonical profile identity. Never an authorization identity on its own.';

CREATE OR REPLACE FUNCTION public.ia_has(_module text, _action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND ( public.has_role(auth.uid(), 'Admin'::app_role)
        OR public.has_permission(auth.uid(), _module, _action) )
$$;

-- Explicit read-all capability (item 7: not implied by any IA role)
CREATE OR REPLACE FUNCTION public.ia_can_read_all()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND ( public.has_role(auth.uid(), 'Admin'::app_role)
        OR public.has_permission(auth.uid(), 'internal_audit', 'view_all') )
$$;

-- Any Internal Audit staff user (auditor record OR registry view permission)
CREATE OR REPLACE FUNCTION public.ia_is_ia_user()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND ( public.ia_can_read_all()
        OR public.has_permission(auth.uid(), 'internal_audit', 'view')
        OR EXISTS (SELECT 1 FROM public.ia_auditors a
                   WHERE a.profile_id = auth.uid() OR a.user_id = auth.uid()) )
$$;

-- Department respondent: head of an audited department (profile-based)
CREATE OR REPLACE FUNCTION public.ia_is_department_respondent(_department_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND _department_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.ia_departments d
       WHERE d.id = _department_id
         AND ( d.head_profile_id = auth.uid()
            OR d.source_department_id IN (
                 SELECT p.department_id FROM public.profiles p WHERE p.id = auth.uid()
               ) )
     )
$$;

-- INTERNAL (auditor-only) engagement scope: excludes management respondents
CREATE OR REPLACE FUNCTION public.ia_can_access_engagement_internal(_engagement_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN public.ia_can_read_all() THEN true
    WHEN _engagement_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.ia_audit_engagements e
      WHERE e.id = _engagement_id
        AND public.ia_current_auditor_id() IS NOT NULL
        AND ( e.lead_auditor_id::text = public.ia_current_auditor_id()::text
           OR COALESCE(e.team_member_ids, '[]'::jsonb) ? public.ia_current_auditor_id()::text
           OR COALESCE(e.supportive_auditor_ids, '[]'::jsonb) ? public.ia_current_auditor_id()::text )
    )
    OR EXISTS (   -- Quality Reviewer: only audits assigned for QA
      SELECT 1 FROM public.ia_quality_reviews q
      WHERE q.engagement_id = _engagement_id
        AND q.reviewer_id::text = public.ia_current_auditor_id()::text
    )
  END
$$;

COMMENT ON FUNCTION public.ia_can_access_engagement_internal(uuid) IS
  'Auditor-facing scope. Working papers, evidence, control tests, preparation and time are never exposed to management respondents.';

-- SHARED engagement scope: auditors + department respondents
CREATE OR REPLACE FUNCTION public.ia_can_access_engagement(_engagement_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.ia_can_access_engagement_internal(_engagement_id)
      OR ( _engagement_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.ia_audit_engagements e
             WHERE e.id = _engagement_id
               AND public.ia_is_department_respondent(e.department_id)
         ) )
$$;

GRANT EXECUTE ON FUNCTION public.ia_current_profile_id(), public.ia_current_auditor_id(),
  public.ia_has(text,text), public.ia_can_read_all(), public.ia_is_ia_user(),
  public.ia_is_department_respondent(uuid), public.ia_can_access_engagement_internal(uuid),
  public.ia_can_access_engagement(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. IMMUTABLE AUDIT EVENT STORE (ADR-09 / item 13)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ia_audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_code text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  engagement_id uuid,
  annual_plan_id uuid,
  actor_profile_id uuid,
  actor_label text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  old_value jsonb,
  new_value jsonb,
  reason text,
  correlation_id uuid,
  source_command text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ia_audit_event_engagement_idx ON public.ia_audit_event (engagement_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ia_audit_event_entity_idx ON public.ia_audit_event (entity_type, entity_id);

GRANT SELECT ON public.ia_audit_event TO authenticated;
GRANT ALL ON public.ia_audit_event TO service_role;
ALTER TABLE public.ia_audit_event ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ia_audit_event_read ON public.ia_audit_event;
CREATE POLICY ia_audit_event_read ON public.ia_audit_event
  FOR SELECT TO authenticated
  USING (public.ia_can_read_all() OR public.ia_can_access_engagement(engagement_id));
-- No INSERT/UPDATE/DELETE policy and no grant: append-only via SECURITY DEFINER only.

CREATE OR REPLACE FUNCTION public.ia_log_event(
  _event_code text, _entity_type text, _entity_id uuid,
  _engagement_id uuid DEFAULT NULL, _annual_plan_id uuid DEFAULT NULL,
  _old jsonb DEFAULT NULL, _new jsonb DEFAULT NULL,
  _reason text DEFAULT NULL, _correlation_id uuid DEFAULT NULL,
  _source_command text DEFAULT 'unspecified'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid; v_label text;
BEGIN
  SELECT COALESCE(p.full_name, p.email, auth.uid()::text) INTO v_label
  FROM public.profiles p WHERE p.id = auth.uid();

  INSERT INTO public.ia_audit_event(
    event_code, entity_type, entity_id, engagement_id, annual_plan_id,
    actor_profile_id, actor_label, old_value, new_value, reason,
    correlation_id, source_command)
  VALUES (_event_code, _entity_type, _entity_id, _engagement_id, _annual_plan_id,
    auth.uid(), v_label, _old, _new, _reason,
    COALESCE(_correlation_id, gen_random_uuid()), _source_command)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.ia_log_event(text,text,uuid,uuid,uuid,jsonb,jsonb,text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_log_event(text,text,uuid,uuid,uuid,jsonb,jsonb,text,uuid,text) TO service_role;

-- Hard immutability guard (defence in depth against future grants)
CREATE OR REPLACE FUNCTION public.ia_audit_event_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN
  RAISE EXCEPTION 'IA-AUDIT-IMMUTABLE: ia_audit_event is append-only (% denied)', TG_OP;
END $$;

DROP TRIGGER IF EXISTS ia_audit_event_no_update ON public.ia_audit_event;
CREATE TRIGGER ia_audit_event_no_update BEFORE UPDATE OR DELETE ON public.ia_audit_event
  FOR EACH ROW EXECUTE FUNCTION public.ia_audit_event_immutable();

-- ---------------------------------------------------------------------
-- 3. EMERGENCY ANON REVOCATION + CLASSIFIED RLS ACROSS ALL ia_* TABLES
-- ---------------------------------------------------------------------
DO $do$
DECLARE
  r record;
  v_class text;
  v_has_eng boolean;
  v_read text;
  v_write text;
  -- Class D: audit / log — append-only, no browser writes
  d_tables text[] := ARRAY['ia_engagement_execution_log','ia_auto_notification_log',
    'ia_notification_logs','ia_notification_queue','ia_plan_change_log',
    'ia_plan_distribution_logs','ia_change_events','ia_approval_actions','ia_audit_event'];
  -- Class E: legacy spine (ADR-01)
  e_tables text[] := ARRAY['ia_department_audits'];
  -- Class B/C: master & configuration — configuration authority writes
  bc_tables text[] := ARRAY['ia_audit_config','ia_audit_settings','ia_activity_types',
    'ia_holidays','ia_sla_rules','ia_escalation_rules','ia_notification_triggers',
    'ia_departments','ia_department_functions','ia_auditors','ia_audit_universe',
    'ia_risk_categories','ia_risk_criteria','ia_risk_criteria_weights',
    'ia_risk_impact_levels','ia_risk_likelihood_levels','ia_risk_scoring_models',
    'ia_risk_classification_thresholds','ia_risk_config_master','ia_risk_band_frequency_policy',
    'ia_control_effectiveness_levels','ia_mitigation_templates','ia_audit_plan_templates',
    'ia_checklist_templates','ia_checklist_template_items','ia_distribution_templates',
    'ia_distribution_recipients','ia_document_templates','ia_document_template_sections',
    'ia_document_template_settings','ia_document_section_library','ia_org_document_foundation',
    'ia_template_policy_matrix','ia_planning_parameters','ia_planning_scoring_weights',
    'ia_execution_gate_config','ia_audit_plan_profiles','ia_audit_plan_functions'];
BEGIN
  FOR r IN
    SELECT c.relname AS tbl
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'ia\_%'
    ORDER BY 1
  LOOP
    -- 3a. EMERGENCY: strip anonymous and PUBLIC privileges (GAP-21)
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', r.tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', r.tbl);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', r.tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', r.tbl);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tbl);

    -- drop any wave-1 policies so this migration is re-runnable
    EXECUTE format('DROP POLICY IF EXISTS ia_w1_read ON public.%I', r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS ia_w1_insert ON public.%I', r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS ia_w1_update ON public.%I', r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS ia_w1_delete ON public.%I', r.tbl);

    IF r.tbl = 'ia_audit_event' THEN CONTINUE; END IF;  -- handled above

    v_class := CASE
      WHEN r.tbl = ANY(d_tables)  THEN 'D'
      WHEN r.tbl = ANY(e_tables)  THEN 'E'
      WHEN r.tbl = ANY(bc_tables) THEN 'BC'
      ELSE 'A' END;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name=r.tbl AND column_name='engagement_id')
      INTO v_has_eng;

    IF v_class IN ('D','E') THEN
      -- read-only to the browser; all writes via governed SECURITY DEFINER commands
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated', r.tbl);
      EXECUTE format(
        'CREATE POLICY ia_w1_read ON public.%I FOR SELECT TO authenticated USING (public.ia_is_ia_user())',
        r.tbl);
      EXECUTE format('COMMENT ON TABLE public.%I IS %L', r.tbl,
        CASE WHEN v_class='D'
          THEN 'IA Wave 1 — Class D (audit/log). Append-only: browser writes denied, mutations only via governed SECURITY DEFINER commands.'
          ELSE 'IA Wave 1 — Class E (DEPRECATED legacy spine, ADR-01). Canonical audit record is ia_audit_engagements. No new operational writes.' END);

    ELSIF v_class = 'BC' THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', r.tbl);
      EXECUTE format(
        'CREATE POLICY ia_w1_read ON public.%I FOR SELECT TO authenticated USING (public.ia_is_ia_user())', r.tbl);
      EXECUTE format(
        'CREATE POLICY ia_w1_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.ia_has(''audit_configuration'',''configure''))', r.tbl);
      EXECUTE format(
        'CREATE POLICY ia_w1_update ON public.%I FOR UPDATE TO authenticated USING (public.ia_has(''audit_configuration'',''configure'')) WITH CHECK (public.ia_has(''audit_configuration'',''configure''))', r.tbl);
      EXECUTE format(
        'CREATE POLICY ia_w1_delete ON public.%I FOR DELETE TO authenticated USING (public.ia_has(''audit_configuration'',''configure''))', r.tbl);
      EXECUTE format('COMMENT ON TABLE public.%I IS %L', r.tbl,
        'IA Wave 1 — Class B/C (master/configuration). Authenticated IA read; writes require audit_configuration:configure.');

    ELSE
      -- Class A: active operational
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', r.tbl);

      IF r.tbl = 'ia_audit_engagements' THEN
        v_read  := 'public.ia_can_access_engagement(id)';
        v_write := 'public.ia_is_ia_user() AND public.ia_can_access_engagement_internal(id)';
      ELSIF v_has_eng AND r.tbl IN ('ia_working_papers','ia_evidence','ia_control_tests',
            'ia_control_test_results','ia_time_logs','ia_preparation_checklists',
            'ia_preparation_documents','ia_quality_reviews','ia_quality_review_checklist',
            'ia_audit_queries','ia_engagement_risk_overrides','ia_document_requests',
            'ia_availability_conflicts','ia_resource_recommendations','ia_communication_stages',
            'ia_communications') THEN
        -- auditor-only surfaces: management respondents excluded
        v_read  := 'public.ia_can_access_engagement_internal(engagement_id)';
        v_write := 'public.ia_is_ia_user() AND public.ia_can_access_engagement_internal(engagement_id)';
      ELSIF v_has_eng THEN
        v_read  := 'public.ia_can_access_engagement(engagement_id)';
        v_write := 'public.ia_can_access_engagement(engagement_id)';
      ELSE
        v_read  := 'public.ia_is_ia_user()';
        v_write := 'public.ia_is_ia_user()';
      END IF;

      EXECUTE format('CREATE POLICY ia_w1_read ON public.%I FOR SELECT TO authenticated USING (%s)', r.tbl, v_read);
      EXECUTE format('CREATE POLICY ia_w1_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)', r.tbl, v_write);
      EXECUTE format('CREATE POLICY ia_w1_update ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', r.tbl, v_write, v_write);
      EXECUTE format('CREATE POLICY ia_w1_delete ON public.%I FOR DELETE TO authenticated USING (%s)', r.tbl, v_write);
      EXECUTE format('COMMENT ON TABLE public.%I IS %L', r.tbl,
        'IA Wave 1 — Class A (active operational). Engagement-scoped RLS; closure/approval mutations governed by SECURITY DEFINER commands.');
    END IF;
  END LOOP;
END $do$;

-- ---------------------------------------------------------------------
-- 4. LEGACY SPINE HARD BLOCK (ADR-01 / item 4)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ia_department_audits_deprecated()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN
  RAISE EXCEPTION 'IA-LEGACY-SPINE: ia_department_audits is deprecated (ADR-01). Use ia_audit_engagements.';
END $$;

DROP TRIGGER IF EXISTS ia_department_audits_no_write ON public.ia_department_audits;
CREATE TRIGGER ia_department_audits_no_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.ia_department_audits
  FOR EACH ROW EXECUTE FUNCTION public.ia_department_audits_deprecated();

-- ---------------------------------------------------------------------
-- 5. SECURITY DEFINER ROUTINE LOCKDOWN (item 2)
-- ---------------------------------------------------------------------
DO $do$
DECLARE
  r record;
  -- trigger + internal-only routines: never browser-executable
  private_fns text[] := ARRAY['ia_update_updated_at','ia_enforce_engagement_execution_gate',
    'ia_departments_sync_from_master','ia_audit_event_immutable','ia_department_audits_deprecated',
    'ia_seed_ssb_audit_reference_data','ia_log_event'];
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND (p.proname LIKE 'ia\_%' OR p.proname LIKE '\_ia\_%')
  LOOP
    -- fixed, safe search_path on every routine
    EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = public, pg_temp', r.proname, r.args);
    -- no PUBLIC / anonymous execution anywhere in the IA namespace
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC', r.proname, r.args);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM anon', r.proname, r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', r.proname, r.args);

    IF r.proname = ANY(private_fns) OR r.proname LIKE '\_ia\_%' THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM authenticated', r.proname, r.args);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', r.proname, r.args);
    END IF;
  END LOOP;
END $do$;
