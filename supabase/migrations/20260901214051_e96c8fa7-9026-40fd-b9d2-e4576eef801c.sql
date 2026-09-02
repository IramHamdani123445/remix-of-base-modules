do $$
declare
  v_user uuid := '22222222-aaaa-4aaa-8aaa-000000000004';
  v_dept uuid := '8ebc900a-3f89-41cc-8094-cfe572339200';
  v_staff uuid;
begin
  select id into v_staff from public.core_staff_profiles where user_id = v_user;
  if v_staff is null then
    insert into public.core_staff_profiles (user_id, display_name, work_email, employment_status, staff_type, is_active)
    values (v_user, 'Internal Audit Auditor One', 'audit.auditor1@mishainfotech.com', 'ACTIVE', 'PERMANENT', true)
    returning id into v_staff;
  end if;

  if not exists (
    select 1 from public.core_staff_assignments
    where user_id = v_user and department_id = v_dept and is_active
  ) then
    insert into public.core_staff_assignments
      (staff_profile_id, user_id, department_id, assignment_type, assignment_status,
       effective_from, is_primary, is_acting, is_active, reason)
    values
      (v_staff, v_user, v_dept, 'PRIMARY', 'ACTIVE', current_date, true, false, true,
       'Internal Audit Phase E certification operator');
  end if;
end $$;