-- DEF-U020-03: DR-012 Contribution / Reporting Gap was recorded under the
-- NON_FILING violation type, producing "non-filing" violations for employers
-- whose returns were actually filed. Give the gap rule its own type.

INSERT INTO public.ce_violation_types (code, name, description, category, severity_default, auto_detect, is_active, sort_order)
VALUES ('CONTRIBUTION_GAP', 'Contribution / Reporting Gap',
        'Consecutive wage periods where the contribution obligation (filing and/or payment) remained unsettled after the statutory deadline. Detected by DR-012.',
        'Compliance', 'High', true, true, 120)
ON CONFLICT (code) DO UPDATE SET is_active = true, name = EXCLUDED.name;

UPDATE public.ce_violations v
SET violation_type_id = (SELECT id FROM public.ce_violation_types WHERE code = 'CONTRIBUTION_GAP')
FROM public.ce_detection_rules r
WHERE r.id = v.source_rule_id AND r.rule_code = 'DR-012';

UPDATE public.ce_detection_rules
SET violation_type_id = (SELECT id FROM public.ce_violation_types WHERE code = 'CONTRIBUTION_GAP')
WHERE rule_code = 'DR-012';