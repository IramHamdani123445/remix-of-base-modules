-- Server-side guard for the Compliance -> Legal referral lifecycle.
CREATE OR REPLACE FUNCTION public.fn_ce_legal_referral_lifecycle_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed text[];
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  allowed := CASE OLD.status
    WHEN 'DRAFT' THEN ARRAY['PENDING_APPROVAL','APPROVED_FOR_SUBMISSION','REJECTED','CLOSED']
    WHEN 'PENDING_APPROVAL' THEN ARRAY['APPROVED_FOR_SUBMISSION','REJECTED','RETURNED_BY_LEGAL','DRAFT']
    WHEN 'APPROVED_FOR_SUBMISSION' THEN ARRAY['SUBMITTED_TO_LEGAL','REJECTED','RETURNED_BY_LEGAL']
    WHEN 'SUBMITTED_TO_LEGAL' THEN ARRAY['ACCEPTED_BY_LEGAL','RETURNED_BY_LEGAL','REJECTED','CLOSED']
    WHEN 'ACCEPTED_BY_LEGAL' THEN ARRAY['IN_LEGAL_PROCEEDINGS','RETURNED_BY_LEGAL','CLOSED']
    WHEN 'RETURNED_BY_LEGAL' THEN ARRAY['PENDING_APPROVAL','APPROVED_FOR_SUBMISSION','REJECTED','CLOSED','DRAFT']
    WHEN 'IN_LEGAL_PROCEEDINGS' THEN ARRAY['CLOSED']
    WHEN 'REJECTED' THEN ARRAY['DRAFT','CLOSED']
    WHEN 'CLOSED' THEN ARRAY[]::text[]
    ELSE NULL
  END;

  IF allowed IS NULL THEN
    RETURN NEW; -- unknown legacy status: do not block historical data
  END IF;

  IF NOT (NEW.status = ANY(allowed)) THEN
    RAISE EXCEPTION 'Legal referral transition % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  -- Maker-checker: the officer who requested approval may not approve it.
  IF NEW.status = 'APPROVED_FOR_SUBMISSION' AND OLD.status = 'PENDING_APPROVAL' THEN
    IF NEW.approved_by IS NULL THEN
      RAISE EXCEPTION 'An approver must be recorded when approving a legal referral'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.approval_requested_by IS NOT NULL
       AND upper(btrim(NEW.approved_by)) = upper(btrim(NEW.approval_requested_by)) THEN
      RAISE EXCEPTION 'Maker-checker violation: % requested this referral and cannot approve it', NEW.approved_by
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.status = 'REJECTED' AND coalesce(btrim(NEW.rejection_reason), '') = '' THEN
    RAISE EXCEPTION 'A rejection reason is required' USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'RETURNED_BY_LEGAL' AND coalesce(btrim(NEW.return_reason), '') = '' THEN
    RAISE EXCEPTION 'A return reason is required' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ce_legal_referral_lifecycle_guard ON public.ce_legal_referrals;
CREATE TRIGGER trg_ce_legal_referral_lifecycle_guard
BEFORE UPDATE ON public.ce_legal_referrals
FOR EACH ROW EXECUTE FUNCTION public.fn_ce_legal_referral_lifecycle_guard();

-- Case merge request integrity (no self-merge, target must be mergeable).
CREATE OR REPLACE FUNCTION public.fn_ce_case_request_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tgt record;
BEGIN
  IF coalesce(btrim(NEW.reason), '') = '' THEN
    RAISE EXCEPTION 'A reason is required for a case request' USING ERRCODE = '23514';
  END IF;

  IF NEW.request_type = 'MERGE' THEN
    IF NEW.target_case_id IS NULL THEN
      RAISE EXCEPTION 'A target case must be selected for a merge request' USING ERRCODE = '23514';
    END IF;
    IF NEW.target_case_id = NEW.case_id THEN
      RAISE EXCEPTION 'A case cannot be merged into itself' USING ERRCODE = '23514';
    END IF;
    SELECT id, status, is_merged, employer_id INTO tgt FROM ce_cases WHERE id = NEW.target_case_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target case not found' USING ERRCODE = '23503';
    END IF;
    IF coalesce(tgt.is_merged, false) THEN
      RAISE EXCEPTION 'Target case has already been merged into another case' USING ERRCODE = '23514';
    END IF;
    IF tgt.status IN ('CLOSED','RESOLVED','COMPLETED') THEN
      RAISE EXCEPTION 'Target case is % and cannot receive a merge', tgt.status USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM ce_case_requests r
      WHERE r.case_id = NEW.case_id AND r.request_type = 'MERGE' AND r.status = 'PENDING'
        AND (TG_OP = 'INSERT' OR r.id <> NEW.id)
    ) THEN
      RAISE EXCEPTION 'A merge request is already pending for this case' USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ce_case_request_guard ON public.ce_case_requests;
CREATE TRIGGER trg_ce_case_request_guard
BEFORE INSERT ON public.ce_case_requests
FOR EACH ROW EXECUTE FUNCTION public.fn_ce_case_request_guard();