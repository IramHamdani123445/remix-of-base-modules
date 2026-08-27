CREATE OR REPLACE FUNCTION public.fn_ce_legal_referral_pack_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_missing int;
  v_labels text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('PENDING_APPROVAL', 'APPROVED_FOR_SUBMISSION', 'SUBMITTED_TO_LEGAL')
     AND OLD.status IN ('DRAFT', 'RETURNED_BY_LEGAL', 'REJECTED') THEN
    SELECT count(*), string_agg(item_label, ', ' ORDER BY item_label)
      INTO v_missing, v_labels
      FROM public.ce_legal_pack_items
     WHERE referral_id = NEW.id
       AND coalesce(is_required, false) = true
       AND coalesce(is_satisfied, false) = false;

    IF coalesce(v_missing, 0) > 0 THEN
      RAISE EXCEPTION 'Handoff pack incomplete: % required item(s) outstanding (%)', v_missing, v_labels
        USING ERRCODE = '23514';
    END IF;

    IF NEW.pack_completed_at IS NULL THEN
      NEW.pack_completed_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ce_legal_referral_pack_guard ON public.ce_legal_referrals;
CREATE TRIGGER trg_ce_legal_referral_pack_guard
BEFORE UPDATE ON public.ce_legal_referrals
FOR EACH ROW EXECUTE FUNCTION public.fn_ce_legal_referral_pack_guard();