DO $migration$
DECLARE
  v_oid oid;
  v_definition text;
  v_old text := $old$WHEN v_live THEN CASE WHEN v_rel.release_expires_at IS NULL OR v_rel.release_expires_at > now() THEN 'passed' ELSE 'failed' END
        WHEN v_rel.release_expires_at IS NOT NULL AND v_rel.release_expires_at > now() AND v_rel.release_expires_at <= coalesce(v_rel.release_starts_at, now()) + interval '7 days' THEN 'passed'
        ELSE 'failed' END$old$;
  v_new text := $new$WHEN v_live OR v_rel.release_expires_at IS NULL THEN 'passed'
        WHEN v_rel.release_expires_at > now() AND v_rel.release_expires_at <= coalesce(v_rel.release_starts_at, now()) + interval '7 days' THEN 'passed'
        ELSE 'failed' END$new$;
BEGIN
  SELECT p.oid
    INTO v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'omni_comms_priv_channel_release_prerequisites'
     AND pg_get_function_identity_arguments(p.oid) = 'p_organization_id uuid, p_department_id uuid, p_channel text, p_release_control_id uuid, p_deployed_revision text';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'omni_comms_priv_channel_release_prerequisites signature missing';
  END IF;

  v_definition := pg_get_functiondef(v_oid);
  IF position(v_old in v_definition) = 0 THEN
    RAISE EXCEPTION 'release_time_window_valid definition drifted; migration stopped safely';
  END IF;

  EXECUTE replace(v_definition, v_old, v_new);
END
$migration$;

DO $verify$
DECLARE
  v_source text;
BEGIN
  SELECT p.prosrc
    INTO v_source
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'omni_comms_priv_channel_release_prerequisites'
     AND pg_get_function_identity_arguments(p.oid) = 'p_organization_id uuid, p_department_id uuid, p_channel text, p_release_control_id uuid, p_deployed_revision text';

  IF position('v_live OR v_rel.release_expires_at IS NULL' in coalesce(v_source, '')) = 0 THEN
    RAISE EXCEPTION 'permanent live pre-approval rule was not installed';
  END IF;
END
$verify$;