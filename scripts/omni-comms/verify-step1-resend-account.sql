-- Omni-Comms Step 1 — Resend account verification verifier.
-- Prints "STEP 1 RESEND ACCOUNT VERIFY OK" when the surface is correct and
-- provably side-effect free.
DO $$
DECLARE v_missing text := '';
BEGIN
  -- 1. Bounded verification columns exist.
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema='public' AND table_name='omni_comms_provider_account'
         AND column_name IN ('verification_status','verification_result_code',
                             'verification_detail','verification_checked_at')) <> 4 THEN
    v_missing := v_missing || 'verification_columns ';
  END IF;

  -- 2. No column may hold key material.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='omni_comms_provider_account'
                AND column_name ~* '(api_key|secret_value|key_ciphertext|key_prefix)') THEN
    v_missing := v_missing || 'key_material_column ';
  END IF;

  -- 3. Trusted server-only functions exist and are service_role only.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public'
                    AND p.proname='omni_comms_priv_provider_account_verification_context') THEN
    v_missing := v_missing || 'context_fn ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public'
                    AND p.proname='omni_comms_priv_record_provider_verification') THEN
    v_missing := v_missing || 'record_fn ';
  END IF;
  IF has_function_privilege('authenticated',
       'public.omni_comms_priv_record_provider_verification(uuid,uuid,uuid,text,text,text,text)','EXECUTE')
     OR has_function_privilege('anon',
       'public.omni_comms_priv_record_provider_verification(uuid,uuid,uuid,text,text,text,text)','EXECUTE') THEN
    v_missing := v_missing || 'record_fn_exposed ';
  END IF;
  IF has_function_privilege('authenticated',
       'public.omni_comms_priv_provider_account_verification_context(uuid,uuid,uuid)','EXECUTE')
     OR has_function_privilege('anon',
       'public.omni_comms_priv_provider_account_verification_context(uuid,uuid,uuid)','EXECUTE') THEN
    v_missing := v_missing || 'context_fn_exposed ';
  END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'STEP 1 RESEND ACCOUNT VERIFY FAILED: %', v_missing;
  END IF;
  RAISE NOTICE 'STEP 1 RESEND ACCOUNT VERIFY OK';
END $$;
