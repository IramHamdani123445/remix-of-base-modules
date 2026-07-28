-- Accelerated Build 1 — Documented rollback plan.
--
-- Reverses (only if strictly required) the four new shared tables, the 12
-- RPCs, the neutral helper, and the additive columns on
-- omni_comms_template_version. Does NOT touch Legacy tables, Epic 1–3
-- artefacts, Omni-Comms Events/Templates schema, navigation, permissions,
-- or core_audit_log.
--
-- WARNING: destructive. Do not run against Live without written approval.

BEGIN;

-- 1. Drop RPCs
DROP FUNCTION IF EXISTS public.core_comm_pilot_migration_apply(uuid,uuid,uuid,uuid,uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.core_comm_pilot_migration_dry_run(uuid,uuid,uuid,uuid,uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.omni_comms_resolve_render_manifest(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.omni_comms_template_version_set_layout_selection(uuid,text,uuid,uuid,timestamptz);
DROP FUNCTION IF EXISTS public.core_comm_assignment_reset_dept_override(uuid,uuid,text,text,text);
DROP FUNCTION IF EXISTS public.core_comm_assignment_upsert_dept_override(uuid,uuid,text,text,text,uuid,uuid);
DROP FUNCTION IF EXISTS public.core_comm_assignment_upsert_org_default(uuid,text,text,text,uuid,uuid);
DROP FUNCTION IF EXISTS public.core_comm_assignment_list(uuid,uuid,text);
DROP FUNCTION IF EXISTS public.core_template_layout_version_get(uuid);
DROP FUNCTION IF EXISTS public.core_template_layout_list_active(text);
DROP FUNCTION IF EXISTS public.core_comm_asset_get(uuid);
DROP FUNCTION IF EXISTS public.core_comm_asset_list_active(uuid,text);

-- 2. Drop tables (order respects FKs)
DROP TABLE IF EXISTS public.core_comm_assignment;
ALTER TABLE public.omni_comms_template_version DROP CONSTRAINT IF EXISTS omni_comms_template_version_layout_mode_chk;
ALTER TABLE public.omni_comms_template_version DROP COLUMN IF EXISTS pinned_layout_version_id;
ALTER TABLE public.omni_comms_template_version DROP COLUMN IF EXISTS layout_id;
ALTER TABLE public.omni_comms_template_version DROP COLUMN IF EXISTS layout_selection_mode;
DROP TRIGGER IF EXISTS omni_comms_template_version_layout_trg ON public.omni_comms_template_version;
DROP FUNCTION IF EXISTS public.omni_comms_priv_template_version_layout_guard();

ALTER TABLE public.core_comm_asset DROP CONSTRAINT IF EXISTS core_comm_asset_active_version_fk;
DROP TABLE IF EXISTS public.core_comm_asset_version;
DROP TABLE IF EXISTS public.core_template_layout_version;
DROP TABLE IF EXISTS public.core_comm_asset;

DROP FUNCTION IF EXISTS public.core_priv_asset_version_guard();
DROP FUNCTION IF EXISTS public.core_priv_asset_lifecycle_guard();
DROP FUNCTION IF EXISTS public.core_priv_layout_version_guard();
DROP FUNCTION IF EXISTS public.core_priv_assignment_guard();

-- 3. Restore original omni_comms_priv_verify_department_ownership body
CREATE OR REPLACE FUNCTION public.omni_comms_priv_verify_department_ownership(
  p_department_id uuid, p_organization_id uuid
) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.core_department WHERE id = p_department_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'OC404 not_found' USING ERRCODE='P0001', DETAIL='department_not_found';
  END IF;
  IF v_org IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'OC422 validation_error' USING ERRCODE='P0001', DETAIL='department_organization_mismatch';
  END IF;
END;
$$;

-- 4. Drop neutral helper LAST
DROP FUNCTION IF EXISTS public.core_priv_verify_department_ownership(uuid,uuid);

COMMIT;
