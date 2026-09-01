CREATE OR REPLACE FUNCTION public.workflow_my_pending_tasks()
RETURNS TABLE (
  id uuid,
  instance_id uuid,
  workflow_name text,
  step_name text,
  source_record_id text,
  source_record_name text,
  source_module text,
  status text,
  created_at timestamptz,
  due_at timestamptz,
  is_overdue boolean,
  assigned_role text,
  assigned_designation text,
  assigned_to uuid,
  submitter_name text,
  eligibility_basis text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_active boolean;
  v_designation text;
BEGIN
  -- No session, no tasks. The identity is never taken from the caller's input,
  -- so a crafted user id cannot widen the result set.
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(p.is_active, true), p.designation_id::text
    INTO v_active, v_designation
  FROM public.profiles p
  WHERE p.id = v_uid;

  -- An unknown or deactivated user is entitled to nothing.
  IF v_active IS DISTINCT FROM true THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH me AS (
    SELECT v_uid AS uid
  ),
  -- Users this person may legitimately act for (approved, active, in-window).
  acting_for AS (
    SELECT v_uid AS user_id
    UNION
    SELECT d.delegator_user_id
    FROM public.core_user_delegations d
    WHERE d.delegate_user_id = v_uid
      AND COALESCE(d.is_active, false) = true
      AND COALESCE(d.approval_status, 'approved') = 'approved'
      AND (d.effective_from IS NULL OR d.effective_from <= now())
      AND (d.effective_to IS NULL OR d.effective_to >= now())
  ),
  my_role_names AS (
    SELECT lower(replace(ur.role::text, '_', ' ')) AS role_name
    FROM public.user_roles ur
    JOIN acting_for af ON af.user_id = ur.user_id
  ),
  my_role_ids AS (
    SELECT r.id
    FROM public.roles r
    JOIN my_role_names n
      ON lower(replace(r.role_name, '_', ' ')) = n.role_name
    WHERE COALESCE(r.is_active, true) = true
  )
  SELECT
    t.id,
    t.instance_id,
    COALESCE(wi.workflow_name, 'Unknown workflow') AS workflow_name,
    t.step_name,
    wi.source_record_id::text,
    COALESCE(wi.source_record_name, 'Unknown') AS source_record_name,
    wi.source_module::text,
    t.status::text,
    t.created_at,
    t.due_at,
    (t.due_at IS NOT NULL AND t.due_at < now()) AS is_overdue,
    t.assigned_role,
    t.assigned_designation,
    t.assigned_to,
    wi.started_by_name,
    CASE
      WHEN t.assigned_to IN (SELECT user_id FROM acting_for)
        THEN CASE WHEN t.assigned_to = v_uid THEN 'assignment' ELSE 'delegation' END
      WHEN t.assigned_role IS NOT NULL
           AND lower(replace(t.assigned_role, '_', ' ')) IN (SELECT role_name FROM my_role_names)
        THEN 'role'
      WHEN t.assigned_designation IS NOT NULL AND t.assigned_designation = v_designation
        THEN 'designation'
      ELSE 'step_approver'
    END AS eligibility_basis
  FROM public.workflow_tasks t
  JOIN public.workflow_instances wi ON wi.id = t.instance_id
  LEFT JOIN public.workflow_steps s ON s.id = t.step_id
  WHERE t.status::text IN ('Pending', 'InProgress')
    AND (
      -- Direct assignment (own, or a user this person may act for).
      t.assigned_to IN (SELECT user_id FROM acting_for)
      -- Role-addressed task.
      OR (
        t.assigned_role IS NOT NULL
        AND lower(replace(t.assigned_role, '_', ' ')) IN (SELECT role_name FROM my_role_names)
      )
      -- Designation-addressed task.
      OR (
        t.assigned_designation IS NOT NULL
        AND v_designation IS NOT NULL
        AND t.assigned_designation = v_designation
      )
      -- Step approver configuration, honoured strictly by approver type.
      OR (
        s.id IS NOT NULL
        AND (
          (
            COALESCE(s.approver_type, 'role') IN ('user', 'specific_users')
            AND s.approver_user_ids IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM acting_for af
              WHERE af.user_id::text = ANY (s.approver_user_ids::text[])
            )
          )
          OR (
            COALESCE(s.approver_type, 'role') = 'role'
            AND s.approver_role_ids IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM my_role_ids mr
              WHERE mr.id::text = ANY (s.approver_role_ids::text[])
            )
          )
          OR (
            COALESCE(s.approver_type, 'role') = 'designation'
            AND s.approver_designation_ids IS NOT NULL
            AND v_designation IS NOT NULL
            AND v_designation = ANY (s.approver_designation_ids::text[])
          )
        )
      )
    )
  ORDER BY t.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.workflow_my_pending_tasks() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workflow_my_pending_tasks() FROM anon;
GRANT EXECUTE ON FUNCTION public.workflow_my_pending_tasks() TO authenticated;

COMMENT ON FUNCTION public.workflow_my_pending_tasks() IS
'Governed personal task projection for /my-tasks. Scoping is decided server-side from auth.uid(): assignment, role, designation, step approver configuration and approved active delegation. Takes no caller-supplied identity, grants administrators no blanket visibility, and returns nothing for inactive users. Read-only: it can never approve, reject or assign.';