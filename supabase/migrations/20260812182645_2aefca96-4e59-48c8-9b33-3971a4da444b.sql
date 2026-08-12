DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.omni_comms_priv_dispatch_claim_email(text,integer,text,text,jsonb,text,uuid,uuid)'::regprocedure);

  d := regexp_replace(d,
    'IF v_rel\.max_messages_per_hour IS NULL OR v_rel\.max_messages_per_day IS NULL\s+OR v_rel\.max_messages_total IS NULL THEN',
    'IF v_rel.max_messages_per_hour IS NULL OR v_rel.max_messages_per_day IS NULL THEN');

  d := regexp_replace(d,
    'AND v_total \+ 1 > v_rel\.max_messages_total\)',
    'AND v_rel.max_messages_total IS NOT NULL AND v_total + 1 > v_rel.max_messages_total)');

  IF d !~ 'max_messages_total IS NOT NULL AND v_total \+ 1'
     OR d ~ 'OR v_rel\.max_messages_total IS NULL THEN' THEN
    RAISE EXCEPTION 'claim_email_volume_patch_not_applied';
  END IF;

  EXECUTE d;
END $$;