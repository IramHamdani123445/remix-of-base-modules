-- DEF-U020-04: DR-005 repeat-offender flags were grouped under an unresolved
-- "UNKNOWN" violation type, so mixed-type occurrences were counted together
-- despite same_type_only being enabled. Retire the affected U020xx flags so the
-- corrected scanner can regenerate them.
DELETE FROM public.ce_review_flag_events
WHERE flag_id IN (
  SELECT id FROM public.ce_compliance_review_flags
  WHERE flag_type = 'REPEAT_OFFENDER' AND employer_id LIKE 'U020%'
);
DELETE FROM public.ce_compliance_review_flags
WHERE flag_type = 'REPEAT_OFFENDER' AND employer_id LIKE 'U020%';