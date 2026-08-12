DO $migration$
DECLARE
  v_oid oid;
  v_def text;
  v_old text := $old$  IF v_rel.id IS NULL THEN RAISE EXCEPTION 'release_control_missing' USING ERRCODE='42704'; END IF;
  IF v_rel.data_origin = 'reference_seed' THEN RAISE EXCEPTION 'reference_release_non_operational' USING ERRCODE='42501'; END IF;$old$;
  v_new text := $new$  IF v_rel.id IS NULL THEN RAISE EXCEPTION 'release_control_missing' USING ERRCODE='42704'; END IF;
  IF NOT public.has_permission(p_actor_id, 'omni_comms', 'operate') THEN
    RAISE EXCEPTION 'release_approval_permission_required' USING ERRCODE='42501';
  END IF;
  PERFORM public.omni_comms_priv_require_tenant_access(
    p_actor_id, v_rel.organization_id, v_rel.department_id);
  IF v_rel.data_origin = 'reference_seed' THEN RAISE EXCEPTION 'reference_release_non_operational' USING ERRCODE='42501'; END IF;$new$;
BEGIN
  SELECT p.oid, pg_get_functiondef(p.oid)
    INTO v_oid, v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'omni_comms_priv_channel_release_approve_activate'
     AND pg_get_function_identity_arguments(p.oid) = 'p_actor_id uuid, p_release_control_id uuid, p_expected_updated_at timestamp with time zone, p_expected_fingerprint text, p_deployed_revision text, p_approval_note text, p_correlation_id text';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'omni_comms approval function is missing';
  END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'omni_comms approval function has an unexpected shape';
  END IF;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END
$migration$;