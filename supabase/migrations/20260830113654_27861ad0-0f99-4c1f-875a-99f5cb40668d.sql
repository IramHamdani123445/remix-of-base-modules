-- ============================================================
-- Internal Audit — UAT Remediation Wave 1
-- UAT-DEF-01 (audit admin reference data) + UAT-DEF-02 (management confidentiality)
-- ============================================================

-- 1. Canonical Audit System Administrator resolver -----------
CREATE OR REPLACE FUNCTION public.ia_is_audit_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND ( public.has_role(auth.uid(), 'Admin'::app_role)
        OR EXISTS (
             SELECT 1 FROM public.user_roles ur
             WHERE ur.user_id = auth.uid()
               AND ur.role::text = 'IA_AUDIT_ADMIN'
           )
        OR public.has_permission(auth.uid(), 'internal_audit_configuration', 'view')
        OR public.has_permission(auth.uid(), 'audit_configuration', 'configure') )
$function$;

GRANT EXECUTE ON FUNCTION public.ia_is_audit_admin() TO authenticated, service_role;

-- 2. Internal Audit user resolver includes the administrator --
CREATE OR REPLACE FUNCTION public.ia_is_ia_user()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND ( public.ia_can_read_all()
        OR public.ia_is_audit_admin()
        OR public.has_permission(auth.uid(), 'internal_audit', 'view')
        OR EXISTS (SELECT 1 FROM public.ia_auditors a
                   WHERE a.profile_id = auth.uid() OR a.user_id = auth.uid()) )
$function$;

-- 3. Reference / configuration maintenance for the administrator
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ia_departments','ia_department_functions','ia_audit_settings',
    'ia_auditors','ia_audit_universe'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS ia_w1_insert ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS ia_w1_update ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS ia_w1_delete ON public.%I', t);

    EXECUTE format($p$CREATE POLICY ia_w1_insert ON public.%I FOR INSERT TO authenticated
      WITH CHECK (public.ia_has('audit_configuration','configure') OR public.ia_is_audit_admin())$p$, t);
    EXECUTE format($p$CREATE POLICY ia_w1_update ON public.%I FOR UPDATE TO authenticated
      USING (public.ia_has('audit_configuration','configure') OR public.ia_is_audit_admin())
      WITH CHECK (public.ia_has('audit_configuration','configure') OR public.ia_is_audit_admin())$p$, t);
    EXECUTE format($p$CREATE POLICY ia_w1_delete ON public.%I FOR DELETE TO authenticated
      USING (public.ia_has('audit_configuration','configure') OR public.ia_is_audit_admin())$p$, t);
  END LOOP;
END $$;

-- 4. Fieldwork activities are auditor-private (UAT-DEF-02)
DROP POLICY IF EXISTS ia_w1_read ON public.ia_activities;
CREATE POLICY ia_w1_read ON public.ia_activities FOR SELECT TO authenticated
USING (public.ia_can_access_engagement_internal(engagement_id));

-- 5. The audited department sees released findings only (UAT-DEF-02)
DROP POLICY IF EXISTS ia_w1_read ON public.ia_findings;
CREATE POLICY ia_w1_read ON public.ia_findings FOR SELECT TO authenticated
USING (
  public.ia_can_access_engagement_internal(engagement_id)
  OR (
    public.ia_can_access_engagement(engagement_id)
    AND ( released_at IS NOT NULL
       OR COALESCE(lifecycle_status,'') IN ('Released','Responded','Closed') )
  )
);