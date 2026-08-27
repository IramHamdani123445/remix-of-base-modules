-- ─────────────────────────────────────────────────────────────
-- DEF-1: Governed escalation office-holder designation
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ia_office_holder (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_code text NOT NULL CHECK (function_code IN ('HEAD_OF_INTERNAL_AUDIT','DEPARTMENT_HEAD')),
  scope_type text NOT NULL CHECK (scope_type IN ('organisation','department')),
  department_id uuid REFERENCES public.ia_departments(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  is_primary boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','active','superseded','revoked','rejected')),
  reason text,
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz,
  revoked_by uuid,
  revoked_at timestamptz,
  is_certification_fixture boolean NOT NULL DEFAULT false,
  fixture_tag text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ia_office_holder_scope_ck CHECK (
    (scope_type = 'department' AND department_id IS NOT NULL)
    OR (scope_type = 'organisation' AND department_id IS NULL)
  ),
  CONSTRAINT ia_office_holder_dates_ck CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS ia_office_holder_lookup_idx
  ON public.ia_office_holder (function_code, department_id, status, effective_from);

GRANT SELECT ON public.ia_office_holder TO authenticated;
GRANT ALL ON public.ia_office_holder TO service_role;
ALTER TABLE public.ia_office_holder ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ia_office_holder_read ON public.ia_office_holder;
CREATE POLICY ia_office_holder_read
  ON public.ia_office_holder FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- No direct write policy: all mutations must flow through the governed RPCs.

DROP TRIGGER IF EXISTS ia_office_holder_touch ON public.ia_office_holder;
CREATE TRIGGER ia_office_holder_touch
  BEFORE UPDATE ON public.ia_office_holder
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Authority check for office-holder configuration
CREATE OR REPLACE FUNCTION public.ia_can_configure_office_holders()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL
     AND ( public.has_role(auth.uid(), 'Admin'::public.app_role)
        OR public.ia_actor_can('internal_audit','configure')
        OR public.ia_actor_can('internal_audit','manage_settings') );
$$;

REVOKE ALL ON FUNCTION public.ia_can_configure_office_holders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_can_configure_office_holders() TO authenticated, service_role;

-- ── Canonical escalation recipient resolution ────────────────────────────
CREATE OR REPLACE FUNCTION public.ia_resolve_escalation_recipient(
  p_role text,
  p_department_id uuid DEFAULT NULL,
  p_engagement_id uuid DEFAULT NULL,
  p_action_id uuid DEFAULT NULL,
  p_as_of date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key text := lower(btrim(coalesce(p_role,'')));
  v_canon text;
  v_profile uuid;
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
      AND o.status = 'active' AND o.is_primary
      AND o.effective_from <= p_as_of
      AND (o.effective_to IS NULL OR o.effective_to >= p_as_of);

    IF v_count > 1 THEN
      RETURN jsonb_build_object('role', v_canon, 'fact_key', v_key,
        'outcome','CONFLICT', 'reason','MULTIPLE_ACTIVE_PRIMARY_DESIGNATIONS',
        'source','ia_office_holder', 'candidate_count', v_count);
    ELSIF v_count = 1 THEN
      SELECT o.profile_id INTO v_profile
      FROM public.ia_office_holder o
      WHERE o.function_code = 'HEAD_OF_INTERNAL_AUDIT'
        AND o.status = 'active' AND o.is_primary
        AND o.effective_from <= p_as_of
        AND (o.effective_to IS NULL OR o.effective_to >= p_as_of);
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
      AND o.status = 'active' AND o.is_primary
      AND o.effective_from <= p_as_of
      AND (o.effective_to IS NULL OR o.effective_to >= p_as_of);

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
        AND o.status = 'active' AND o.is_primary
        AND o.effective_from <= p_as_of
        AND (o.effective_to IS NULL OR o.effective_to >= p_as_of);
      v_source := 'ia_office_holder';
    ELSE
      SELECT d.head_profile_id INTO v_profile
      FROM public.ia_departments d WHERE d.id = p_department_id;
      IF v_profile IS NULL THEN
        RETURN jsonb_build_object('role', v_canon, 'fact_key', v_key,
          'outcome','UNRESOLVED', 'reason','DEPARTMENT_HEAD_NOT_PROFILE_LINKED',
          'source','ia_departments', 'department_id', p_department_id);
      END IF;
      v_source := 'ia_departments.head_profile_id';
    END IF;

  ELSIF v_canon = 'LEAD_AUDITOR' THEN
    IF p_engagement_id IS NULL THEN
      RETURN jsonb_build_object('role', v_canon, 'fact_key', v_key,
        'outcome','UNRESOLVED', 'reason','NO_ENGAGEMENT_CONTEXT', 'source', NULL);
    END IF;
    SELECT au.profile_id INTO v_profile
    FROM public.ia_audit_engagements e
    JOIN public.ia_auditors au ON au.id = e.lead_auditor_id
    WHERE e.id = p_engagement_id;
    IF v_profile IS NULL THEN
      RETURN jsonb_build_object('role', v_canon, 'fact_key', v_key,
        'outcome','UNRESOLVED', 'reason','LEAD_AUDITOR_NOT_ASSIGNED_OR_NOT_PROFILE_LINKED',
        'source','ia_audit_engagements.lead_auditor_id', 'engagement_id', p_engagement_id);
    END IF;
    v_source := 'ia_audit_engagements.lead_auditor_id';

  ELSIF v_canon = 'ACTION_OWNER' THEN
    SELECT a.responsible_profile_id INTO v_profile
    FROM public.ia_action_tracking a WHERE a.id = p_action_id;
    IF v_profile IS NULL THEN
      RETURN jsonb_build_object('role', v_canon, 'fact_key', v_key,
        'outcome','UNRESOLVED', 'reason','ACTION_OWNER_NOT_PROFILE_LINKED',
        'source','ia_action_tracking.responsible_profile_id', 'action_id', p_action_id);
    END IF;
    v_source := 'ia_action_tracking.responsible_profile_id';

  ELSE
    RETURN jsonb_build_object('role', v_canon, 'fact_key', v_key,
      'outcome','INVALID', 'reason','UNKNOWN_ESCALATION_ROLE', 'source', NULL);
  END IF;

  SELECT p.id, p.full_name, p.email, coalesce(p.is_active, true) AS is_active
    INTO v_p
  FROM public.profiles p WHERE p.id = v_profile;

  IF v_p.id IS NULL THEN
    RETURN jsonb_build_object('role', v_canon, 'fact_key', v_key,
      'outcome','INVALID', 'reason','PROFILE_NOT_FOUND',
      'source', v_source, 'profile_id', v_profile);
  END IF;

  IF NOT v_p.is_active THEN
    RETURN jsonb_build_object('role', v_canon, 'fact_key', v_key,
      'outcome','INACTIVE', 'reason','PROFILE_INACTIVE',
      'source', v_source, 'profile_id', v_p.id,
      'display_name', v_p.full_name);
  END IF;

  RETURN jsonb_build_object(
    'role', v_canon, 'fact_key', v_key, 'outcome','RESOLVED',
    'reason', CASE WHEN nullif(btrim(coalesce(v_p.email,'')),'') IS NULL
                   THEN 'EMAIL_UNAVAILABLE' ELSE NULL END,
    'source', v_source, 'profile_id', v_p.id,
    'display_name', coalesce(nullif(btrim(v_p.full_name),''), 'Recipient'),
    'email', nullif(btrim(coalesce(v_p.email,'')),''),
    'email_available', nullif(btrim(coalesce(v_p.email,'')),'') IS NOT NULL,
    'department_id', p_department_id);
END;
$$;

REVOKE ALL ON FUNCTION public.ia_resolve_escalation_recipient(text,uuid,uuid,uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_resolve_escalation_recipient(text,uuid,uuid,uuid,date) TO authenticated, service_role;

-- Head-of-audit helper now reads ONLY the governed register (no guessing)
CREATE OR REPLACE FUNCTION public.ia_comms_resolve_head_of_audit()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT nullif(public.ia_resolve_escalation_recipient('head_of_audit')->>'profile_id','')::uuid
  WHERE (public.ia_resolve_escalation_recipient('head_of_audit')->>'outcome') = 'RESOLVED';
$$;

-- ── Governed maker-checker designation RPCs ──────────────────────────────
CREATE OR REPLACE FUNCTION public.ia_office_holder_propose(
  p_function_code text,
  p_profile_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_effective_from date DEFAULT current_date,
  p_effective_to date DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_is_primary boolean DEFAULT true,
  p_fixture_tag text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_id uuid; v_scope text;
BEGIN
  IF NOT public.ia_can_configure_office_holders() THEN
    RAISE EXCEPTION 'NOT_AUTHORISED_TO_CONFIGURE_OFFICE_HOLDERS' USING ERRCODE = '42501';
  END IF;
  IF p_function_code NOT IN ('HEAD_OF_INTERNAL_AUDIT','DEPARTMENT_HEAD') THEN
    RAISE EXCEPTION 'UNKNOWN_OFFICE_FUNCTION';
  END IF;
  v_scope := CASE WHEN p_function_code = 'DEPARTMENT_HEAD' THEN 'department' ELSE 'organisation' END;
  IF v_scope = 'department' AND p_department_id IS NULL THEN
    RAISE EXCEPTION 'DEPARTMENT_REQUIRED_FOR_DEPARTMENT_HEAD';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile_id) THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;

  INSERT INTO public.ia_office_holder
    (function_code, scope_type, department_id, profile_id, is_primary,
     effective_from, effective_to, status, reason, assigned_by,
     is_certification_fixture, fixture_tag)
  VALUES
    (p_function_code, v_scope,
     CASE WHEN v_scope='department' THEN p_department_id END,
     p_profile_id, coalesce(p_is_primary,true),
     coalesce(p_effective_from, current_date), p_effective_to, 'proposed',
     p_reason, auth.uid(), p_fixture_tag IS NOT NULL, p_fixture_tag)
  RETURNING id INTO v_id;

  INSERT INTO public.ia_audit_event
    (event_code, entity_type, entity_id, actor_profile_id, actor_label,
     old_value, new_value, reason, source_command)
  VALUES ('INTERNAL_AUDIT.OFFICE_HOLDER.PROPOSED', 'ia_office_holder', v_id,
          auth.uid(), public.ia_actor_label(), NULL,
          jsonb_build_object('function_code', p_function_code, 'profile_id', p_profile_id,
                             'department_id', p_department_id,
                             'effective_from', p_effective_from, 'effective_to', p_effective_to,
                             'is_primary', p_is_primary, 'status','proposed'),
          p_reason, 'ia_office_holder_propose');

  RETURN jsonb_build_object('id', v_id, 'status', 'proposed');
END;
$$;

CREATE OR REPLACE FUNCTION public.ia_office_holder_approve(
  p_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_row public.ia_office_holder; v_superseded integer := 0;
BEGIN
  IF NOT public.ia_can_configure_office_holders() THEN
    RAISE EXCEPTION 'NOT_AUTHORISED_TO_CONFIGURE_OFFICE_HOLDERS' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.ia_office_holder WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'DESIGNATION_NOT_FOUND'; END IF;
  IF v_row.status <> 'proposed' THEN RAISE EXCEPTION 'DESIGNATION_NOT_PENDING'; END IF;
  IF v_row.assigned_by IS NOT NULL AND v_row.assigned_by = auth.uid() THEN
    RAISE EXCEPTION 'MAKER_CHECKER_VIOLATION_SELF_APPROVAL' USING ERRCODE = '42501';
  END IF;

  -- Effective-date the outgoing holder instead of deleting history
  UPDATE public.ia_office_holder o
     SET status = 'superseded',
         effective_to = LEAST(coalesce(o.effective_to, v_row.effective_from - 1),
                              v_row.effective_from - 1)
   WHERE o.id <> v_row.id
     AND o.function_code = v_row.function_code
     AND o.status = 'active'
     AND o.is_primary AND v_row.is_primary
     AND coalesce(o.department_id::text,'-') = coalesce(v_row.department_id::text,'-')
     AND (o.effective_to IS NULL OR o.effective_to >= v_row.effective_from);
  GET DIAGNOSTICS v_superseded = ROW_COUNT;

  UPDATE public.ia_office_holder
     SET status = 'active', approved_by = auth.uid(), approved_at = now(),
         reason = coalesce(p_reason, reason)
   WHERE id = p_id;

  INSERT INTO public.ia_audit_event
    (event_code, entity_type, entity_id, actor_profile_id, actor_label,
     old_value, new_value, reason, source_command)
  VALUES ('INTERNAL_AUDIT.OFFICE_HOLDER.ACTIVATED', 'ia_office_holder', p_id,
          auth.uid(), public.ia_actor_label(),
          jsonb_build_object('status','proposed','proposed_by', v_row.assigned_by),
          jsonb_build_object('status','active','function_code', v_row.function_code,
                             'profile_id', v_row.profile_id,
                             'department_id', v_row.department_id,
                             'effective_from', v_row.effective_from,
                             'superseded_count', v_superseded,
                             'approved_by', auth.uid()),
          p_reason, 'ia_office_holder_approve');

  RETURN jsonb_build_object('id', p_id, 'status','active', 'superseded', v_superseded);
END;
$$;

CREATE OR REPLACE FUNCTION public.ia_office_holder_revoke(
  p_id uuid,
  p_reason text DEFAULT NULL,
  p_effective_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_row public.ia_office_holder;
BEGIN
  IF NOT public.ia_can_configure_office_holders() THEN
    RAISE EXCEPTION 'NOT_AUTHORISED_TO_CONFIGURE_OFFICE_HOLDERS' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.ia_office_holder WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'DESIGNATION_NOT_FOUND'; END IF;

  UPDATE public.ia_office_holder
     SET status = 'revoked', revoked_by = auth.uid(), revoked_at = now(),
         effective_to = coalesce(p_effective_to, current_date),
         reason = coalesce(p_reason, reason)
   WHERE id = p_id;

  INSERT INTO public.ia_audit_event
    (event_code, entity_type, entity_id, actor_profile_id, actor_label,
     old_value, new_value, reason, source_command)
  VALUES ('INTERNAL_AUDIT.OFFICE_HOLDER.REVOKED', 'ia_office_holder', p_id,
          auth.uid(), public.ia_actor_label(),
          to_jsonb(v_row),
          jsonb_build_object('status','revoked','effective_to', coalesce(p_effective_to, current_date)),
          p_reason, 'ia_office_holder_revoke');

  RETURN jsonb_build_object('id', p_id, 'status','revoked');
END;
$$;

REVOKE ALL ON FUNCTION public.ia_office_holder_propose(text,uuid,uuid,date,date,text,boolean,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ia_office_holder_approve(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ia_office_holder_revoke(uuid,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_office_holder_propose(text,uuid,uuid,date,date,text,boolean,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ia_office_holder_approve(uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ia_office_holder_revoke(uuid,text,date) TO authenticated, service_role;

-- ── Configuration health read model ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ia_office_holder_health(p_as_of date DEFAULT current_date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_hia jsonb; v_depts jsonb; v_inactive jsonb; v_invalid jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501';
  END IF;

  v_hia := public.ia_resolve_escalation_recipient('head_of_audit', NULL, NULL, NULL, p_as_of);

  SELECT coalesce(jsonb_agg(x ORDER BY x->>'name'), '[]'::jsonb) INTO v_depts
  FROM (
    SELECT jsonb_build_object(
             'department_id', d.id, 'name', d.name,
             'resolution', public.ia_resolve_escalation_recipient('department_head', d.id, NULL, NULL, p_as_of)
           ) AS x
    FROM public.ia_departments d
  ) s
  WHERE (x->'resolution'->>'outcome') <> 'RESOLVED';

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'function_code', o.function_code,
           'department_id', o.department_id, 'profile_id', o.profile_id)), '[]'::jsonb)
    INTO v_inactive
  FROM public.ia_office_holder o
  JOIN public.profiles p ON p.id = o.profile_id
  WHERE o.status = 'active' AND coalesce(p.is_active, true) = false;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'function_code', o.function_code, 'profile_id', o.profile_id)), '[]'::jsonb)
    INTO v_invalid
  FROM public.ia_office_holder o
  LEFT JOIN public.profiles p ON p.id = o.profile_id
  WHERE o.status = 'active' AND p.id IS NULL;

  RETURN jsonb_build_object(
    'as_of', p_as_of,
    'hia', v_hia,
    'hia_configured', (v_hia->>'outcome') = 'RESOLVED',
    'hia_conflict', (v_hia->>'outcome') = 'CONFLICT',
    'departments_total', (SELECT count(*) FROM public.ia_departments),
    'departments_unresolved', v_depts,
    'departments_unresolved_count', jsonb_array_length(v_depts),
    'inactive_office_holders', v_inactive,
    'invalid_office_holders', v_invalid);
END;
$$;

REVOKE ALL ON FUNCTION public.ia_office_holder_health(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ia_office_holder_health(date) TO authenticated, service_role;