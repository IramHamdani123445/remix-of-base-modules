-- =====================================================================
-- BN Medical Reviews — communication adapter dark-launch postflight.
--
-- Independent of `app_modules.actions_enabled`: the shared Benefits
-- communication adapter registry must still list exactly one Medical Review
-- source row, keyed `BN_MEDICAL_REVIEW`, pointing at
-- `bn_medical_review_communication_intent`, and it must be disabled.
--
-- Fails when: the row is missing, duplicated, enabled, or the canonical key
-- or source table has drifted.
-- =====================================================================
DO $adapter$
DECLARE
  v_count integer;
  v_enabled boolean;
  v_table text;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.bn_communication_adapter_source
   WHERE source_module = 'BN_MEDICAL_REVIEW';

  IF v_count = 0 THEN
    RAISE EXCEPTION 'BN_MEDICAL_REVIEW adapter source row is missing from bn_communication_adapter_source';
  END IF;

  IF v_count > 1 THEN
    RAISE EXCEPTION 'BN_MEDICAL_REVIEW adapter source is registered % times — exactly one row is required', v_count;
  END IF;

  SELECT is_enabled, source_table INTO v_enabled, v_table
    FROM public.bn_communication_adapter_source
   WHERE source_module = 'BN_MEDICAL_REVIEW';

  IF v_table IS DISTINCT FROM 'bn_medical_review_communication_intent' THEN
    RAISE EXCEPTION 'BN_MEDICAL_REVIEW adapter source table drifted to %', v_table;
  END IF;

  IF v_enabled THEN
    RAISE EXCEPTION 'BN_MEDICAL_REVIEW adapter source is_enabled is TRUE — adapter must stay dark-launched';
  END IF;

  -- No other Medical Review keyed source may exist under a drifted key.
  IF EXISTS (
    SELECT 1 FROM public.bn_communication_adapter_source
     WHERE source_table = 'bn_medical_review_communication_intent'
       AND source_module <> 'BN_MEDICAL_REVIEW'
  ) THEN
    RAISE EXCEPTION 'Medical Review intent table is registered under a non-canonical source key';
  END IF;

  RAISE NOTICE 'BN_MEDICAL_REVIEW adapter source is_enabled = false (dark-launched).';
END $adapter$;

SELECT 'BN_MR_ADAPTER_RESULT: PASS' AS result;
