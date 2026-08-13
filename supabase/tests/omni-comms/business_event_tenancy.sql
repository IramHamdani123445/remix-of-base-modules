-- Omni-Comms — executable multi-organisation tenancy proof.
--
-- Proves that `omni_comms_priv_enqueue_business_event` derives the tenant from
-- deterministic trusted business configuration, and NEVER from "the first
-- active organisation".
--
-- Run inside a transaction and ROLL BACK. No provider call. No live data.

BEGIN;

DO $$
DECLARE
  organization_a uuid;
  organization_b uuid;
  v_result jsonb;
  v_msg text;
BEGIN
  -- Two ACTIVE organisations. A is created FIRST on purpose.
  INSERT INTO public.core_organization (id, org_code, legal_name, status, created_at)
  VALUES (gen_random_uuid(), 'TENANCY_PROBE_A', 'Tenancy Probe A',
          'ACTIVE', now() - interval '10 days')
  RETURNING id INTO organization_a;

  INSERT INTO public.core_organization (id, org_code, legal_name, status, created_at)
  VALUES (gen_random_uuid(), 'TENANCY_PROBE_B', 'Tenancy Probe B', 'ACTIVE', now())
  RETURNING id INTO organization_b;

  -- ================= Case 1: no ownership at all -> fail closed ==========
  BEGIN
    PERFORM public.omni_comms_priv_business_organization('TENANCY_PROBE_MODULE');
    RAISE EXCEPTION 'expected organization_unresolved';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE '%organization_unresolved%' THEN
      RAISE EXCEPTION 'expected organization_unresolved, got %', v_msg;
    END IF;
  END;

  -- ================= Case 2: ownership by organisation B ==================
  -- Module ownership points at B even though A is the older organisation.
  INSERT INTO public.core_department_profile
    (id, organization_id, module_code, department_code, department_name, status)
  VALUES
    (gen_random_uuid(), organization_b, 'TENANCY_PROBE_MODULE',
     'TPB', 'Tenancy Probe B', 'ACTIVE');

  IF public.omni_comms_priv_business_organization('TENANCY_PROBE_MODULE')
     IS DISTINCT FROM organization_b THEN
    RAISE EXCEPTION 'tenant must be organisation B, not the first active organisation';
  END IF;

  -- ================= Case 3: ambiguous ownership refuses ==================
  INSERT INTO public.core_department_profile
    (id, organization_id, module_code, department_code, department_name, status)
  VALUES
    (gen_random_uuid(), organization_a, 'TENANCY_PROBE_MODULE',
     'TPA', 'Tenancy Probe A', 'ACTIVE');

  BEGIN
    PERFORM public.omni_comms_priv_business_organization('TENANCY_PROBE_MODULE');
    RAISE EXCEPTION 'expected organization_ambiguous';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE '%organization_ambiguous%' THEN
      RAISE EXCEPTION 'expected organization_ambiguous, got %', v_msg;
    END IF;
  END;

  RAISE NOTICE 'omni-comms tenancy proof passed (A=%, B=%)', organization_a, organization_b;
END $$;

ROLLBACK;
