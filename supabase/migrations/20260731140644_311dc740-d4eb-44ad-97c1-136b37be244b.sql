CREATE TABLE IF NOT EXISTS public.omni_comms_caller_module_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_code text NOT NULL UNIQUE,
  permission_module text NOT NULL,
  permission_action text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT omni_comms_caller_module_code_upper CHECK (module_code = upper(btrim(module_code)) AND module_code <> '')
);

GRANT ALL ON public.omni_comms_caller_module_registry TO service_role;

ALTER TABLE public.omni_comms_caller_module_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omni_comms_caller_module_registry FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS omni_comms_caller_module_registry_service_role ON public.omni_comms_caller_module_registry;
CREATE POLICY omni_comms_caller_module_registry_service_role
  ON public.omni_comms_caller_module_registry
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.omni_comms_caller_module_registry_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_omni_comms_caller_module_registry_touch ON public.omni_comms_caller_module_registry;
CREATE TRIGGER trg_omni_comms_caller_module_registry_touch
  BEFORE UPDATE ON public.omni_comms_caller_module_registry
  FOR EACH ROW EXECUTE FUNCTION public.omni_comms_caller_module_registry_touch();

INSERT INTO public.omni_comms_caller_module_registry
  (module_code, permission_module, permission_action, is_active, notes)
VALUES
  ('OMNI_COMMS_DIRECT',        'omni_comms',                'operate',   true,  'Approved direct-call policy: baseline Omni-Comms execution capability.'),
  ('OMNI_COMMS_ADMIN_DRY_RUN', 'omni_comms',                'configure', true,  'Bounded administration dry-run surface; additionally gated by the admin dry-run guard.'),
  ('BENEFITS',                 'benefits_management',       'view',      true,  'Benefits business module.'),
  ('COMPLIANCE',               'compliance_dashboard',      'view',      true,  'Compliance business module.'),
  ('LEGAL',                    'legal_enforcement',         'view',      true,  'Legal business module.'),
  ('FINANCE',                  'md_group_finance',          'view',      true,  'Finance business module.'),
  ('EMPLOYER_REGISTRATION',    'employers_management',      'view',      true,  'Employer registration business module.'),
  ('INSURED_PERSON',           'insured_person_management', 'view',      true,  'Insured person business module.'),
  ('PLATFORM',                 'omni_comms',                'administer',true,  'Platform-level operator caller module.')
ON CONFLICT (module_code) DO UPDATE
  SET permission_module = EXCLUDED.permission_module,
      permission_action = EXCLUDED.permission_action,
      is_active         = EXCLUDED.is_active,
      notes             = EXCLUDED.notes;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_authorize_runtime_actor(
  p_actor_id uuid,
  p_organization_id uuid,
  p_department_id uuid,
  p_caller_module_code text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_module      text;
  v_reg         public.omni_comms_caller_module_registry%ROWTYPE;
  v_org_ok      boolean := false;
  v_privileged  boolean := false;
  v_dept_org    uuid;
  v_dept_active boolean;
BEGIN
  IF p_actor_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'authentication_required');
  END IF;

  IF p_organization_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'organization_required');
  END IF;

  IF NOT public.has_permission(p_actor_id, 'omni_comms', 'operate') THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'permission_denied');
  END IF;

  v_module := upper(btrim(coalesce(p_caller_module_code, '')));
  SELECT * INTO v_reg
  FROM public.omni_comms_caller_module_registry
  WHERE module_code = v_module
    AND is_active = true;

  IF v_module = '' OR v_reg.module_code IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'caller_module_not_registered');
  END IF;

  IF NOT public.has_permission(p_actor_id, v_reg.permission_module, v_reg.permission_action) THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'permission_denied');
  END IF;

  v_privileged := public.is_admin(p_actor_id)
                  OR public.has_permission(p_actor_id, 'omni_comms', 'administer');

  SELECT true INTO v_org_ok
  FROM public.core_organization o
  WHERE o.id = p_organization_id
    AND coalesce(lower(o.status), 'active') NOT IN ('retired', 'archived', 'deleted')
  LIMIT 1;

  IF NOT coalesce(v_org_ok, false) THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'organization_access_denied');
  END IF;

  IF NOT v_privileged THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.core_staff_assignments a
      JOIN public.core_department d ON d.id = a.department_id
      WHERE a.user_id = p_actor_id
        AND a.is_active = true
        AND a.assignment_status = 'ACTIVE'
        AND (a.effective_to IS NULL OR a.effective_to >= CURRENT_DATE)
        AND d.organization_id = p_organization_id
    ) THEN
      RETURN jsonb_build_object('allowed', false, 'code', 'organization_access_denied');
    END IF;
  END IF;

  IF p_department_id IS NOT NULL THEN
    SELECT d.organization_id, coalesce(d.is_active, true)
      INTO v_dept_org, v_dept_active
    FROM public.core_department d
    WHERE d.id = p_department_id;

    IF v_dept_org IS NULL THEN
      RETURN jsonb_build_object('allowed', false, 'code', 'department_access_denied');
    END IF;

    IF v_dept_org <> p_organization_id THEN
      RETURN jsonb_build_object('allowed', false, 'code', 'department_organization_mismatch');
    END IF;

    IF NOT v_dept_active THEN
      RETURN jsonb_build_object('allowed', false, 'code', 'department_access_denied');
    END IF;

    IF NOT v_privileged THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.core_staff_assignments a
        WHERE a.user_id = p_actor_id
          AND a.department_id = p_department_id
          AND a.is_active = true
          AND a.assignment_status = 'ACTIVE'
          AND (a.effective_to IS NULL OR a.effective_to >= CURRENT_DATE)
      ) THEN
        RETURN jsonb_build_object('allowed', false, 'code', 'department_access_denied');
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('allowed', true, 'code', 'ok');
END;
$function$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_authorize_runtime_actor(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_priv_authorize_runtime_actor(uuid, uuid, uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_authorize_runtime_actor(uuid, uuid, uuid, text) TO service_role;