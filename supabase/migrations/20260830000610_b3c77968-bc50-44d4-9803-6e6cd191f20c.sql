-- DEF-U020-05: DR-013 self-employed / voluntary non-compliance was recorded
-- under the SEVERANCE_OMISSION type, which is unrelated vocabulary. Give the
-- rule its own type and re-classify the existing detections.
INSERT INTO public.ce_violation_types (code, name, description, category, severity_default, auto_detect, is_active, sort_order)
VALUES ('SELF_EMPLOYED_NON_COMPLIANCE', 'Self-Employed / Voluntary Non-Compliance',
        'Self-employed or voluntary contributor with outstanding declared contributions after the statutory deadline. Detected by DR-013.',
        'Compliance', 'Medium', true, true, 130)
ON CONFLICT (code) DO UPDATE SET is_active = true, name = EXCLUDED.name;

UPDATE public.ce_violations v
SET violation_type_id = (SELECT id FROM public.ce_violation_types WHERE code = 'SELF_EMPLOYED_NON_COMPLIANCE')
FROM public.ce_detection_rules r
WHERE r.id = v.source_rule_id AND r.rule_code = 'DR-013';

UPDATE public.ce_detection_rules
SET violation_type_id = (SELECT id FROM public.ce_violation_types WHERE code = 'SELF_EMPLOYED_NON_COMPLIANCE')
WHERE rule_code = 'DR-013';