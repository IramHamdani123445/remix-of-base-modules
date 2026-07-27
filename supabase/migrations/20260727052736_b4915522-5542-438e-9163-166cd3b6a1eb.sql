DO $$
DECLARE
  v_src text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
    WHERE n.nspname='public' AND p.proname='attest_comm_hub_legacy_production_baseline';

  v_new := replace(v_src,
    'INSERT INTO public.audit_logs(user_id, action, resource_type, resource_id, metadata, created_at)',
    'INSERT INTO public.audit_logs(user_id, action_type, entity_type, entity_id, metadata, created_at)');

  IF v_new = v_src THEN
    RAISE EXCEPTION 'attestation audit-logs pattern not found';
  END IF;

  EXECUTE v_new;
END $$;