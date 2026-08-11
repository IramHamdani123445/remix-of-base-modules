DO $mig$
DECLARE
  v_src text;
  v_new text;
BEGIN
  v_src := pg_get_functiondef(
    'public.omni_comms_priv_dispatch_claim_email(text,integer,text,text,jsonb,text)'::regprocedure);
  v_new := v_src;

  v_new := replace(v_new, '  v_secret     text;', '  v_secret     text;
  v_storage_mode text;');
  IF v_new = v_src THEN
    RAISE EXCEPTION 'omni_comms patch failed: v_secret declaration not found';
  END IF;

  v_new := replace(v_new,
    'SELECT s.secret_ref INTO v_secret',
    'SELECT s.secret_ref, s.storage_mode INTO v_secret, v_storage_mode');

  v_new := replace(v_new,
    '''secret_ref'', v_secret,',
    '''secret_ref'', v_secret,
      ''credential_storage_mode'', coalesce(v_storage_mode, ''edge_env''),');

  IF v_new NOT LIKE '%credential_storage_mode%'
     OR v_new NOT LIKE '%s.storage_mode INTO%' THEN
    RAISE EXCEPTION 'omni_comms patch failed: storage mode projection not applied';
  END IF;

  EXECUTE v_new;
END $mig$;