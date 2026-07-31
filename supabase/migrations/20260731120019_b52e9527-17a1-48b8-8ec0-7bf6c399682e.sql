DO $migration$
DECLARE
  v_signature regprocedure := 'public.omni_comms_setup_readiness(uuid,uuid,uuid,text,text)'::regprocedure;
  v_definition text;
  v_old text := $old$IF v_sender.id IS NOT NULL THEN
    SELECT * INTO v_bind FROM public.omni_comms_sender_provider_binding
     WHERE sender_identity_id = v_sender.id
       AND (v_acct.id IS NULL OR provider_account_id = v_acct.id)
     ORDER BY (status = 'active') DESC, priority ASC, updated_at DESC LIMIT 1;
  END IF;$old$;
  v_new text := $new$IF v_sender.id IS NOT NULL THEN
    SELECT * INTO v_bind FROM public.omni_comms_sender_provider_binding
     WHERE sender_identity_id = v_sender.id
     ORDER BY (status = 'active') DESC,
              (verification_status = 'verified') DESC,
              priority ASC,
              updated_at DESC
     LIMIT 1;
  END IF;

  IF v_bind.id IS NOT NULL THEN
    SELECT * INTO v_acct
      FROM public.omni_comms_provider_account
     WHERE id = v_bind.provider_account_id;

    IF v_acct.id IS NOT NULL THEN
      SELECT * INTO v_prov
        FROM public.omni_comms_provider
       WHERE id = v_acct.provider_id;
    END IF;
  END IF;$new$;
BEGIN
  SELECT pg_get_functiondef(v_signature) INTO v_definition;

  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Expected setup-readiness binding resolver block was not found';
  END IF;

  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;
END;
$migration$;

REVOKE ALL ON FUNCTION public.omni_comms_setup_readiness(uuid, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_setup_readiness(uuid, uuid, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_setup_readiness(uuid, uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_setup_readiness(uuid, uuid, uuid, text, text) TO service_role;