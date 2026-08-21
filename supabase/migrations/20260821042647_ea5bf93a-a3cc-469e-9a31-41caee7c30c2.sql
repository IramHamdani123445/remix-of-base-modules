DO $$
DECLARE
  r record;
  v_def text;
  v_new text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'omni_comms_channel_binding_summary',
         'omni_comms_channel_endpoint_summary',
         'omni_comms_channel_identity_summary',
         'omni_comms_channel_policy_summary',
         'omni_comms_channel_test_centre_summary',
         'omni_comms_channel_test_delivery_set_approval',
         'omni_comms_channel_provider_upsert_draft',
         'omni_comms_priv_channel_identity_lifecycle',
         'omni_comms_priv_normalize_channel_policy',
         'omni_comms_priv_validate_binding',
         'omni_comms_priv_validate_channel'
       )
  LOOP
    v_def := pg_get_functiondef(r.oid);
    IF position('''voice''' in v_def) > 0 THEN
      CONTINUE;
    END IF;
    v_new := replace(v_def, '''email'',''sms'',''whatsapp'',''push'',''in_app'',''print''',
                            '''email'',''sms'',''whatsapp'',''push'',''in_app'',''print'',''voice''');
    v_new := replace(v_new, '''email'',''sms'',''whatsapp'',''in_app'',''print''',
                            '''email'',''sms'',''whatsapp'',''in_app'',''print'',''voice''');
    v_new := replace(v_new, '''email'',''sms'',''in_app'',''push'',''whatsapp'',''print''',
                            '''email'',''sms'',''in_app'',''push'',''whatsapp'',''print'',''voice''');
    v_new := replace(v_new, '''email'',''sms'',''whatsapp''',
                            '''email'',''sms'',''whatsapp'',''voice''');
    IF v_new = v_def THEN
      RAISE EXCEPTION 'No channel whitelist matched for %', r.proname;
    END IF;
    EXECUTE v_new;
  END LOOP;
END $$;