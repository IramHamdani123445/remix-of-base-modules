-- Additive UAT grants: give the three new Compliance UAT roles `view` on the
-- route-bearing modules that back the screens their approved matrix already
-- entitles them to (Dashboard, Arrears report). No existing role touched.
insert into public.role_permissions (role_id, module_id, action_id, is_granted)
select r.id, m.id, a.id, true
from public.roles r
join public.app_modules m on m.name in ('compliance_dashboard', 'cer_rpt_arrears')
join public.module_actions a on a.module_id = m.id and a.action_name = 'view'
where r.role_name in ('ComplianceFinanceUser', 'ComplianceLegalOfficer', 'ComplianceReportsViewer')
on conflict (role_id, module_id, action_id) do update set is_granted = true;