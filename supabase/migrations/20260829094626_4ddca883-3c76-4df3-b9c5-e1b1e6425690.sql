-- Align DR-005 / DR-009 / DR-010 live parameters with the published parameter spec
UPDATE public.ce_detection_rules
SET parameters = (parameters - 'count_basis')
  || jsonb_build_object('include_resolved_occurrences', (parameters->>'count_basis') IS DISTINCT FROM 'UNRESOLVED_ONLY'),
    updated_at = now()
WHERE rule_code = 'DR-005';

UPDATE public.ce_detection_rules
SET parameters = parameters
  || jsonb_build_object('min_employee_delta', 2, 'min_discrepancy_percent', 15),
    updated_at = now()
WHERE rule_code = 'DR-009';

UPDATE public.ce_detection_rules
SET parameters = (parameters - 'benchmark_recalc_cadence')
  || jsonb_build_object(
       'benchmark_recalc_months',
       CASE parameters->>'benchmark_recalc_cadence'
         WHEN 'QUARTERLY' THEN 3
         WHEN 'ANNUAL' THEN 12
         ELSE 1
       END),
    updated_at = now()
WHERE rule_code = 'DR-010';