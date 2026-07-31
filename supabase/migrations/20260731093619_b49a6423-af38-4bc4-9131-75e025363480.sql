CREATE UNIQUE INDEX IF NOT EXISTS ux_ce_violations_active_auto_dedupe
ON public.ce_violations (
  employer_id,
  violation_type_id,
  COALESCE(LEFT(period_from, 7), '')
)
WHERE is_deleted = false
  AND status IN ('OPEN','IN_PROGRESS','ESCALATED','UNDER_REVIEW')
  AND source_type IN ('AUTOMATED','DETECTION_RULE')
  AND employer_id IS NOT NULL
  AND violation_type_id IS NOT NULL;