-- DEF-E2E-05: payment-arrangement submit/approve/reject were client-side table
-- UPDATEs with no server authorization and no segregation of duties.
ALTER TABLE public.ce_payment_arrangements
  ADD COLUMN IF NOT EXISTS created_by_user uuid,
  ADD COLUMN IF NOT EXISTS submitted_by text,
  ADD COLUMN IF NOT EXISTS submitted_by_user uuid,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by_user uuid,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

CREATE OR REPLACE FUNCTION public.ce_arrangement_governed_guard_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('PENDING_APPROVAL','ACTIVE','CANCELLED')
     AND OLD.status IN ('DRAFT','PENDING_APPROVAL')
     AND coalesce(current_setting('ce.arrangement_governed', true), '') <> '1'
     AND current_user NOT IN ('postgres','supabase_admin','service_role') THEN
    RAISE EXCEPTION 'CE-ARR-000: arrangement lifecycle changes must go through ce_arrangement_submit_v1 / ce_arrangement_approve_v1 / ce_arrangement_reject_v1'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_ce_arrangement_governed_guard ON public.ce_payment_arrangements;
CREATE TRIGGER zz_ce_arrangement_governed_guard
BEFORE UPDATE ON public.ce_payment_arrangements
FOR EACH ROW EXECUTE FUNCTION public.ce_arrangement_governed_guard_trg();

CREATE OR REPLACE FUNCTION public.ce_arrangement_submit_v1(p_arrangement_id uuid, p_note text DEFAULT NULL)
RETURNS public.ce_payment_arrangements
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.ce_payment_arrangements;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'CE-ARR-001: authentication required' USING ERRCODE='42501'; END IF;
  IF NOT public.ce_actor_can(v_uid, 'compliance.enforcement.arrangements') THEN
    RAISE EXCEPTION 'CE-ARR-002: you do not have the Compliance capability to submit payment arrangements' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_row FROM public.ce_payment_arrangements WHERE id = p_arrangement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CE-ARR-003: arrangement not found' USING ERRCODE='22023'; END IF;
  IF v_row.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'CE-ARR-004: only DRAFT arrangements can be submitted (current: %)', v_row.status USING ERRCODE='22023';
  END IF;
  PERFORM set_config('ce.arrangement_governed','1', true);
  UPDATE public.ce_payment_arrangements
     SET status='PENDING_APPROVAL', submitted_by_user=v_uid,
         submitted_by=coalesce(public.ce_actor_code(v_uid), v_uid::text),
         submitted_at=now(), terms_text=coalesce(p_note, terms_text),
         updated_by=coalesce(public.ce_actor_code(v_uid), v_uid::text), updated_at=now()
   WHERE id=p_arrangement_id RETURNING * INTO v_row;
  PERFORM set_config('ce.arrangement_governed','', true);
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.ce_arrangement_approve_v1(p_arrangement_id uuid, p_comments text DEFAULT NULL)
RETURNS public.ce_payment_arrangements
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.ce_payment_arrangements;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'CE-ARR-001: authentication required' USING ERRCODE='42501'; END IF;
  IF NOT public.ce_actor_can(v_uid, 'compliance.arrangement.approve') THEN
    RAISE EXCEPTION 'CE-ARR-005: you do not have the Compliance capability to approve payment arrangements' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_row FROM public.ce_payment_arrangements WHERE id = p_arrangement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CE-ARR-003: arrangement not found' USING ERRCODE='22023'; END IF;
  IF v_row.status <> 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'CE-ARR-006: only arrangements pending approval can be approved (current: %)', v_row.status USING ERRCODE='22023';
  END IF;
  IF v_uid = coalesce(v_row.submitted_by_user, v_row.created_by_user) THEN
    RAISE EXCEPTION 'CE-ARR-007: segregation of duties — the officer who created or submitted this arrangement cannot approve it' USING ERRCODE='42501';
  END IF;
  PERFORM set_config('ce.arrangement_governed','1', true);
  UPDATE public.ce_payment_arrangements
     SET status='ACTIVE', approved_by_user=v_uid,
         approved_by=coalesce(public.ce_actor_code(v_uid), v_uid::text), approved_at=now(),
         updated_by=coalesce(public.ce_actor_code(v_uid), v_uid::text), updated_at=now()
   WHERE id=p_arrangement_id RETURNING * INTO v_row;
  PERFORM set_config('ce.arrangement_governed','', true);
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.ce_arrangement_reject_v1(p_arrangement_id uuid, p_reason text)
RETURNS public.ce_payment_arrangements
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.ce_payment_arrangements;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'CE-ARR-001: authentication required' USING ERRCODE='42501'; END IF;
  IF NOT public.ce_actor_can(v_uid, 'compliance.arrangement.approve') THEN
    RAISE EXCEPTION 'CE-ARR-005: you do not have the Compliance capability to decide payment arrangements' USING ERRCODE='42501';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'CE-ARR-008: a rejection reason is required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_row FROM public.ce_payment_arrangements WHERE id = p_arrangement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CE-ARR-003: arrangement not found' USING ERRCODE='22023'; END IF;
  IF v_row.status NOT IN ('DRAFT','PENDING_APPROVAL') THEN
    RAISE EXCEPTION 'CE-ARR-009: only draft or pending arrangements can be rejected (current: %)', v_row.status USING ERRCODE='22023';
  END IF;
  IF v_row.status = 'PENDING_APPROVAL' AND v_uid = coalesce(v_row.submitted_by_user, v_row.created_by_user) THEN
    RAISE EXCEPTION 'CE-ARR-007: segregation of duties — the officer who submitted this arrangement cannot decide it' USING ERRCODE='42501';
  END IF;
  PERFORM set_config('ce.arrangement_governed','1', true);
  UPDATE public.ce_payment_arrangements
     SET status='CANCELLED', rejection_reason=p_reason, breach_reason=p_reason,
         updated_by=coalesce(public.ce_actor_code(v_uid), v_uid::text), updated_at=now()
   WHERE id=p_arrangement_id RETURNING * INTO v_row;
  PERFORM set_config('ce.arrangement_governed','', true);
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.ce_arrangement_submit_v1(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.ce_arrangement_approve_v1(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.ce_arrangement_reject_v1(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ce_arrangement_submit_v1(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_arrangement_approve_v1(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_arrangement_reject_v1(uuid, text) TO authenticated, service_role;