-- Stage 1B DEF-S1B-08: capacity scheduler referenced ia_holidays.holiday_date, which does not exist
DO $mig$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
  FROM pg_proc WHERE proname = 'ia_capacity_schedule_candidates' AND pronamespace = 'public'::regnamespace;

  v_new := replace(v_def,
    'WHERE h.holiday_date BETWEEN v_slot_start AND v_slot_end',
    'WHERE COALESCE(h.is_active, true) = true AND h.date BETWEEN v_slot_start AND v_slot_end');

  IF v_new = v_def THEN
    RAISE NOTICE 'capacity scheduler holiday reference already correct';
  ELSE
    EXECUTE v_new;
  END IF;
END
$mig$;

DO $chk$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'ia_capacity_schedule_candidates'
             AND pronamespace = 'public'::regnamespace AND prosrc LIKE '%holiday_date%') THEN
    RAISE EXCEPTION 'DEF-S1B-08 fix did not apply';
  END IF;
END
$chk$;