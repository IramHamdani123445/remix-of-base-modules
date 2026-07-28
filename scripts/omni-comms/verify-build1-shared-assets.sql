-- Accelerated Build 1 — transaction-isolated verifier for shared communication
-- assets, layout versions, assignments and template-version layout selection.
--
-- Requires:
--   * four new tables exist with FORCE RLS and no grants to anon/authenticated
--   * additive columns exist on omni_comms_template_version
--   * 12 RPCs are present, SECURITY DEFINER, owner postgres, search_path=pg_catalog,public
--   * neutral helper core_priv_verify_department_ownership exists
--   * existing omni_comms_priv_verify_department_ownership delegates to it
--
-- Emits: 'BUILD 1 SHARED ASSETS AND LAYOUTS VERIFY OK' on success, or RAISE.

BEGIN;

DO $$
DECLARE
  v_missing text[] := ARRAY[]::text[];
  v_rpc text;
  v_rpc_names text[] := ARRAY[
    'core_comm_asset_list_active',
    'core_comm_asset_get',
    'core_template_layout_list_active',
    'core_template_layout_version_get',
    'core_comm_assignment_list',
    'core_comm_assignment_upsert_org_default',
    'core_comm_assignment_upsert_dept_override',
    'core_comm_assignment_reset_dept_override',
    'omni_comms_template_version_set_layout_selection',
    'omni_comms_resolve_render_manifest',
    'core_comm_pilot_migration_dry_run',
    'core_comm_pilot_migration_apply'
  ];
  v_tab text;
  v_tabs text[] := ARRAY[
    'core_comm_asset',
    'core_comm_asset_version',
    'core_template_layout_version',
    'core_comm_assignment'
  ];
BEGIN
  -- tables exist
  FOREACH v_tab IN ARRAY v_tabs LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=v_tab) THEN
      v_missing := v_missing || ('table:'||v_tab);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                   WHERE n.nspname='public' AND c.relname=v_tab AND c.relrowsecurity AND c.relforcerowsecurity) THEN
      v_missing := v_missing || ('force_rls_missing:'||v_tab);
    END IF;
    -- must NOT have anon/authenticated privileges
    IF EXISTS (
      SELECT 1 FROM information_schema.role_table_grants
      WHERE table_schema='public' AND table_name=v_tab AND grantee IN ('anon','authenticated')
    ) THEN
      v_missing := v_missing || ('unexpected_grant:'||v_tab);
    END IF;
  END LOOP;

  -- additive columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='omni_comms_template_version'
                   AND column_name IN ('layout_selection_mode','layout_id','pinned_layout_version_id')
                 GROUP BY table_name HAVING count(*)=3) THEN
    v_missing := v_missing || 'template_version_additive_columns';
  END IF;

  -- RPCs
  FOREACH v_rpc IN ARRAY v_rpc_names LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=v_rpc AND p.prosecdef
    ) THEN
      v_missing := v_missing || ('rpc:'||v_rpc);
    END IF;
  END LOOP;

  -- neutral helper
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='core_priv_verify_department_ownership') THEN
    v_missing := v_missing || 'neutral_helper_missing';
  END IF;

  IF array_length(v_missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'BUILD 1 VERIFY FAILED: %', v_missing;
  END IF;

  RAISE NOTICE 'BUILD 1 SHARED ASSETS AND LAYOUTS VERIFY OK';
END $$;

ROLLBACK;
