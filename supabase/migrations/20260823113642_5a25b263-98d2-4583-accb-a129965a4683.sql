CREATE OR REPLACE FUNCTION public.legal_referral_sync_from_ce()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE new_status TEXT;
BEGIN
  -- Map the Compliance-side lifecycle onto the canonical legal_referral
  -- vocabulary. Everything before hand-off stays DRAFT for Legal.
  new_status := CASE NEW.status
    WHEN 'PENDING_APPROVAL' THEN 'DRAFT'
    WHEN 'APPROVED_FOR_SUBMISSION' THEN 'DRAFT'
    WHEN 'RETURNED_BY_LEGAL' THEN 'INFO_REQUESTED'
    WHEN 'ACCEPTED_BY_LEGAL' THEN 'ACCEPTED'
    WHEN 'IN_LEGAL_PROCEEDINGS' THEN 'LEGAL_CASE_CREATED'
    ELSE NEW.status END;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.legal_referral (
      referral_no, source_module, source_record_type, source_record_id, source_reference_no,
      primary_entity_type, primary_entity_id, submitted_by, status, legal_case_id,
      source_ce_referral_id, lg_intake_id, summary, exposure_amount
    ) VALUES (
      NEW.referral_number, 'COMPLIANCE', 'CASE',
      COALESCE(NEW.source_record_id, NEW.source_case_id::text),
      COALESCE(NEW.source_reference_no, NEW.referral_number),
      'EMPLOYER', NEW.employer_id,
      COALESCE(NEW.referred_by, NEW.created_by),
      new_status, NEW.legal_case_id, NEW.id, NEW.lg_intake_id,
      NEW.referral_reason_text, NEW.grand_total
    ) ON CONFLICT (referral_no) DO NOTHING;
  ELSE
    UPDATE public.legal_referral SET
      status = new_status, legal_case_id = NEW.legal_case_id, lg_intake_id = NEW.lg_intake_id,
      last_status_at = now()
    WHERE source_ce_referral_id = NEW.id;
  END IF;
  RETURN NEW;
END $function$;