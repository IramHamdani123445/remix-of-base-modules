CREATE OR REPLACE FUNCTION public.ia_resolve_escalation_recipient(
  p_role text,
  p_department_id uuid DEFAULT NULL,
  p_engagement_id uuid DEFAULT NULL,
  p_action_id uuid DEFAULT NULL,
  p_as_of date DEFAULT CURRENT_DATE
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_key text := lower(btrim(coalesce(p_role,'')));
  v_canon text;
  v_profile uuid;
  v_auditor uuid;
  v_source text;
  v_count integer := 0;
  v_p record;
BEGIN
  v_canon := CASE v_key
    WHEN 'head_of_audit' THEN 'HEAD_OF_INTERNAL_AUDIT'
    WHEN 'head_of_internal_audit' THEN 'HEAD_OF_INTERNAL_AUDIT'
    WHEN 'department_head' THEN 'DEPARTMENT_HEAD'
    WHEN 'lead_auditor' THEN 'LEAD_AUDITOR'
    WHEN 'action_owner' THEN 'ACTION_OWNER'
    WHEN 'auditee_contact' THEN 'MANAGEMENT_RESPONDENT'
    ELSE upper(v_key)
  END;

  IF v_canon = 'HEAD_OF_INTERNAL_AUDIT' THEN
    SELECT count(*) INTO v_count
    FROM public.ia_office_holder o
    WHERE o.function_code = 'HEAD_OF_INTERNAL_AUDIT'
      AND o.is_primary
      AND public.ia_office_holder_valid_at(o.status, o.effective_from, o.effective_to, p_as_of);

    IF v_count > 1 THEN
      RETURN jsonb_build_object('role', v_canon, 'fact_key', v_key,
        'outcome','CONFLICT', 'reason','MULTIPLE_ACTIVE_PRIMARY_DESIGNATIONS',
        'source','ia_office_holder', 'candidate_count', v_count);
    ELSIF v_count = 1 THEN
      SELECT o.profile_id INTO v_profile
      FROM public.ia_office_holder o
      WHERE o.function_code = 'HEAD_OF_INTERNAL_AUDIT'
        AND o.is_primary
        AND public.ia_office_holder_valid_at(o.status, o.effective_from, o.effective_to, p_as_of);
      v_source := 'ia_office_holder';
    ELSE
      RETURN jsonb_build_object('role', v_canon, 'fact_key', v_key,
        'outcome','UNRESOLVED', 'reason','NO_ACTIVE_OFFICE_HOLDER_DESIGNATION',
        'source','ia_office_holder');
    END IF;

  ELSIF v_canon = 'DEPARTMENT_HEAD' THEN
    IF p_department_id IS NULL THEN
      RETURN jsonb_build_object('role', v_canon, 'fact_key', v_key,
        'outcome','UNRESOLVED', 'reason','NO_DEPARTMENT_CONTEXT', 'source', NULL);
    END IF;

    SELECT count(*) INTO v_count
    FROM public.ia_office_holder o
    WHERE o.function_code = 'DEPARTMENT_HEAD'
      AND o.department_id = p_department_id
      AND o.is_primary
      AND public.ia_office_holder_valid_at(o.status, o.effective_from, o.effective_to, p_as_of);

    IF v_count > 1 THEN
      RETURN jsonb_build_object('role', v_canon, 'fact_key', v_key,
        'outcome','CONFLICT', 'reason','MULTIPLE_ACTIVE_PRIMARY_DESIGNATIONS',
        'source','ia_office_holder', 'department_id', p_department_id,
        'candidate_count', v_count);
    ELSIF v_count = 1 THEN
      SELECT o.profile_id INTO v_profile
      FROM public.ia_office_holder o
      WHERE o.function_code = 'DEPARTMENT_HEAD'
        AND o.department_id = p_department_id
        AND o.is_primary
        AND public.ia_office_holder_valid_at(o.status, o.effective_from, o.effective_to, p_as_of);
      v_source := 'ia_office_holder';
    ELSE
      SELECT d.head_profile_id INTO v_profile
      FROM public.ia_departments d
      WHERE d.id = p_department_id;

      IF v_profile IS NULL THEN
        RETURN jsonb_build_object('role', v_canon, 'fact_key', v_key,
          'outcome','UNRESOLVED', 'reason','DEPARTMENT_HEAD_NOT_PROFILE_LINKED',
          'source','ia_departments', 'department_id', p_department_id);
      END IF;
      v_source := 'ia_departments';
    END IF;

  ELSIF v_canon = 'LEAD_AUDITOR' THEN
    IF p_engagement_id IS NULL THEN
      RETURN jsonb_build_object('role', v_canon, 'fact_key', v_key,
        'outcome','UNRESOLVED', 'reason','NO_ENGAGEMENT_CONTEXT', 'source', NULL);
    END IF;
    SELECT e.lead_auditor_id INTO v_auditor
    FROM public.ia_audit_engagements e WHERE e.id = p_engagement_id;
    v_source := 'ia_audit_engagements.lead_auditor_id';
    IF v_auditor IS NULL THEN
      RETURN jsonb_build_object('role', v_canon, 'fact_key', v_key,
        'outcome','UNRESOLVED', 'reason','LEAD_AUDITOR_NOT_ASSIGNED',
        'source', v_source, 'engagement_id', p_engagement_id);
    END IF;

    -- DEF-S1B-28: lead_auditor_id references ia_auditors, not profiles.
    SELECT coalesce(a.profile_id, a.user_id) INTO v_profile
    FROM public.ia_auditors a WHERE a.id = v_auditor;

    IF v_profile IS NOT NULL THEN
      v_source := 'ia_auditors.profile_id';
    ELSIF EXISTS (SELECT 1 FROM public.ia_auditors a WHERE a.id = v_auditor) THEN
      RETURN jsonb_build_object('role', v_canon, 'fact_key', v_key,
        'outcome','UNRESOLVED', 'reason','LEAD_AUDITOR_NOT_PROFILE_LINKED',
        'source','ia_auditors', 'engagement_id', p_engagement_id,
        'auditor_id', v_auditor);
    ELSE
      -- Legacy rows where the column already holds a profile id.
      v_profile := v_auditor;
    END IF;

  ELSIF v_canon = 'ACTION_OWNER' THEN
    IF p_action_id IS NULL THEN
      RETURN jsonb_build_object('role', v_canon, 'fact_key', v_key,
        'outcome','UNRESOLVED', 'reason','NO_ACTION_CONTEXT', 'source', NULL);
    END IF;
    SELECT a.responsible_profile_id INTO v_profile
    FROM public.ia_action_tracking a WHERE a.id = p_action_id;
    v_source := 'ia_action_tracking.responsible_profile_id';
    IF v_profile IS NULL THEN
      RETURN jsonb_build_object('role', v_canon, 'fact_key', v_key,
        'outcome','UNRESOLVED', 'reason','ACTION_OWNER_NOT_PROFILE_LINKED',
        'source', v_source, 'action_id', p_action_id);
    END IF;

  ELSE
    RETURN jsonb_build_object('role', v_canon, 'fact_key', v_key,
      'outcome','INVALID', 'reason','UNKNOWN_ESCALATION_ROLE', 'source', NULL);
  END IF;

  SELECT p.id, p.full_name, p.email, coalesce(p.is_active, true) AS is_active
    INTO v_p
  FROM public.profiles p WHERE p.id = v_profile;

  IF v_p.id IS NULL THEN
    RETURN jsonb_build_object('role', v_canon, 'fact_key', v_key,
      'outcome','UNRESOLVED', 'reason','PROFILE_NOT_FOUND',
      'source', v_source, 'profile_id', v_profile);
  END IF;

  IF NOT v_p.is_active THEN
    RETURN jsonb_build_object('role', v_canon, 'fact_key', v_key,
      'outcome','INACTIVE', 'reason','PROFILE_INACTIVE', 'source', v_source,
      'profile_id', v_p.id, 'display_name', v_p.full_name);
  END IF;

  RETURN jsonb_build_object('role', v_canon, 'fact_key', v_key,
    'outcome','RESOLVED',
    'reason', CASE WHEN nullif(btrim(coalesce(v_p.email,'')),'') IS NULL
                   THEN 'EMAIL_UNAVAILABLE' ELSE NULL END,
    'source', v_source,
    'profile_id', v_p.id,
    'display_name', v_p.full_name,
    'email', nullif(btrim(coalesce(v_p.email,'')),''),
    'email_available', nullif(btrim(coalesce(v_p.email,'')),'') IS NOT NULL,
    'as_of', p_as_of);
END;
$fn$;