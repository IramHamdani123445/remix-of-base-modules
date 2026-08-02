DO $mig$
DECLARE v_src text; v_new text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'omni_comms_email_config_summary';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'omni_comms_email_config_summary not found';
  END IF;
  v_new := replace(
    v_src,
    $old$      'verification_status',b.verification_status,'verified_at',b.verified_at,
      'status',b.status,'updated_at',b.updated_at$old$,
    $new$      'verification_status',b.verification_status,'verified_at',b.verified_at,
      'verification_source',b.verification_source,
      'verification_result_code',b.verification_result_code,
      'verification_checked_at',b.verification_checked_at,
      'channel_endpoint_id',b.channel_endpoint_id,
      'department_id',b.department_id,
      'data_origin',b.data_origin,
      'status',b.status,'updated_at',b.updated_at$new$);
  IF v_new = v_src THEN
    RAISE EXCEPTION 'omni_comms_email_config_summary binding projection anchor not found';
  END IF;
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.omni_comms_email_config_summary(p_organization_id uuid) '
    'RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''pg_catalog'',''public'' AS %L',
    v_new);
END $mig$;

REVOKE ALL ON FUNCTION public.omni_comms_email_config_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omni_comms_email_config_summary(uuid)
  TO authenticated, service_role;