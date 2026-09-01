DO $seed$
DECLARE
  v_password text := 'IAUat@2027!';
  v_hash text;
  u RECORD;
  v_src_dept uuid;
BEGIN
  FOR u IN
    SELECT * FROM (VALUES
      ('22222222-aaaa-4aaa-8aaa-000000000001'::uuid,'audit.admin@mishainfotech.com','Audit System Administrator','Audit','System Administrator','IA_AUDIT_ADMIN','IA-ACC-ADMIN',NULL,NULL,NULL),
      ('22222222-aaaa-4aaa-8aaa-000000000002'::uuid,'audit.hia@mishainfotech.com','Head of Internal Audit','Head of','Internal Audit','IA_HEAD_OF_INTERNAL_AUDIT','IA-ACC-HIA','Head of Internal Audit','IA-HIA-100',NULL),
      ('22222222-aaaa-4aaa-8aaa-000000000003'::uuid,'audit.lead@mishainfotech.com','Lead Auditor','Lead','Auditor','IA_LEAD_AUDITOR','IA-ACC-LEAD','Lead Auditor','IA-LA-100',NULL),
      ('22222222-aaaa-4aaa-8aaa-000000000004'::uuid,'audit.auditor1@mishainfotech.com','Audit Team Member One','Audit Team','Member One','IA_TEAM_MEMBER','IA-ACC-AUDITOR1','Auditor','IA-AUD-101',NULL),
      ('22222222-aaaa-4aaa-8aaa-000000000005'::uuid,'audit.auditor2@mishainfotech.com','Audit Team Member Two','Audit Team','Member Two','IA_TEAM_MEMBER','IA-ACC-AUDITOR2','Auditor','IA-AUD-102',NULL),
      ('22222222-aaaa-4aaa-8aaa-000000000006'::uuid,'audit.qa@mishainfotech.com','Quality Reviewer','Quality','Reviewer','IA_QUALITY_REVIEWER','IA-ACC-QA','Quality Reviewer','IA-QA-100',NULL),
      ('22222222-aaaa-4aaa-8aaa-000000000007'::uuid,'audit.mgmt.benefits@mishainfotech.com','Benefits Management Respondent','Benefits','Management Respondent','IA_MANAGEMENT_RESPONDENT','IA-ACC-MGMT-BENEFITS',NULL,NULL,'Benefits'),
      ('22222222-aaaa-4aaa-8aaa-000000000008'::uuid,'audit.mgmt.compliance@mishainfotech.com','Compliance Management Respondent','Compliance','Management Respondent','IA_MANAGEMENT_RESPONDENT','IA-ACC-MGMT-COMPLIANCE',NULL,NULL,'Compliance'),
      ('22222222-aaaa-4aaa-8aaa-000000000009'::uuid,'audit.mgmt.finance@mishainfotech.com','Finance Management Respondent','Finance','Management Respondent','IA_MANAGEMENT_RESPONDENT','IA-ACC-MGMT-FINANCE',NULL,NULL,'Finance')
    ) AS t(uid,email,full_name,first_name,last_name,role_name,user_code,auditor_role,employee_no,dept_name)
  LOOP
    v_hash := crypt(v_password, gen_salt('bf'));

    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) VALUES (
      u.uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      u.email, v_hash, now(),
      jsonb_build_object('provider','email','providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', u.full_name, 'acceptance_fixture', true, 'fixture_tag', u.user_code),
      now(), now(), '', '', '', ''
    )
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      encrypted_password = EXCLUDED.encrypted_password,
      email_confirmed_at = COALESCE(auth.users.email_confirmed_at, now()),
      updated_at = now();

    INSERT INTO auth.identities (
      id, user_id, provider, provider_id, identity_data,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), u.uid, 'email', u.uid::text,
      jsonb_build_object('sub', u.uid::text, 'email', u.email, 'email_verified', true),
      now(), now(), now()
    )
    ON CONFLICT (provider, provider_id) DO UPDATE SET
      identity_data = EXCLUDED.identity_data, updated_at = now();

    v_src_dept := NULL;
    IF u.dept_name IS NOT NULL THEN
      SELECT d.source_department_id INTO v_src_dept
      FROM public.ia_departments d
      WHERE d.name = u.dept_name AND d.is_active AND d.source_department_id IS NOT NULL
      LIMIT 1;
    END IF;

    INSERT INTO public.profiles (
      id, email, full_name, first_name, last_name,
      department_id, user_code, is_active, force_password_change
    ) VALUES (
      u.uid, u.email, u.full_name, u.first_name, u.last_name,
      v_src_dept, u.user_code, true, false
    )
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      department_id = EXCLUDED.department_id,
      user_code = EXCLUDED.user_code,
      is_active = true;

    DELETE FROM public.user_roles ur WHERE ur.user_id = u.uid AND ur.role::text <> u.role_name;
    IF NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u.uid AND ur.role::text = u.role_name) THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (u.uid, u.role_name);
    END IF;

    IF u.auditor_role IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM public.ia_auditors a WHERE a.profile_id = u.uid) THEN
        UPDATE public.ia_auditors
           SET name = u.full_name, email = u.email, role = u.auditor_role,
               employment_status = 'Active', user_id = u.uid
         WHERE profile_id = u.uid;
      ELSE
        INSERT INTO public.ia_auditors (profile_id, user_id, employee_no, name, email, role, employment_status)
        VALUES (u.uid, u.uid, u.employee_no, u.full_name, u.email, u.auditor_role, 'Active');
      END IF;
    END IF;
  END LOOP;
END $seed$;