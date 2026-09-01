UPDATE public.ia_office_holder
   SET status = 'revoked',
       reason = coalesce(reason,'') || ' | Retired for MIPL UAT final acceptance designation'
 WHERE status = 'superseded'
   AND effective_from > current_date
   AND function_code IN ('HEAD_OF_INTERNAL_AUDIT','DEPARTMENT_HEAD');

UPDATE public.ia_office_holder
   SET effective_from = current_date
 WHERE fixture_tag = 'uat-mipl-final-acceptance'
   AND effective_from > current_date;