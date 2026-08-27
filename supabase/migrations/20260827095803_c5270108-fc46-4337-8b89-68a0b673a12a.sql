INSERT INTO public.ia_audit_universe (entity_name, entity_code, entity_type, department_id, risk_category, inherent_risk_score, residual_risk_score, materiality, audit_frequency, status, is_active, created_by, updated_by)
SELECT d.name,
       'AU-' || upper(regexp_replace(d.name, '[^a-zA-Z]', '', 'g')) || COALESCE('-' || d.office_code, ''),
       'Department',
       d.id,
       COALESCE(d.risk_rating, 'Medium'),
       CASE COALESCE(d.risk_rating,'Medium') WHEN 'High' THEN 16 WHEN 'Medium' THEN 9 ELSE 4 END,
       CASE COALESCE(d.risk_rating,'Medium') WHEN 'High' THEN 12 WHEN 'Medium' THEN 6 ELSE 3 END,
       CASE COALESCE(d.risk_rating,'Medium') WHEN 'High' THEN 'High' WHEN 'Medium' THEN 'Moderate' ELSE 'Low' END,
       CASE COALESCE(d.risk_rating,'Medium') WHEN 'High' THEN 'Annual' WHEN 'Medium' THEN 'Annual' ELSE 'Biennial' END,
       'Active', true, 'SYSTEM', 'SYSTEM'
FROM public.ia_departments d
WHERE d.is_active
  AND NOT EXISTS (
    SELECT 1 FROM public.ia_audit_universe u WHERE u.department_id = d.id
  );