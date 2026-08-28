-- E2E-2 certification: designate the Benefits management respondent persona
UPDATE public.profiles
   SET department_id = 'f75ab74f-9783-46d1-bb05-c1599efb7ba4'
 WHERE id = '72866da8-06c3-4e3a-b7aa-773eb411f792'
   AND department_id IS DISTINCT FROM 'f75ab74f-9783-46d1-bb05-c1599efb7ba4';

-- Named auditee contact on the engagement under certification
UPDATE public.ia_audit_engagements
   SET primary_auditee_contact_id = '72866da8-06c3-4e3a-b7aa-773eb411f792',
       updated_at = now()
 WHERE engagement_code = 'ENG-2027-002';