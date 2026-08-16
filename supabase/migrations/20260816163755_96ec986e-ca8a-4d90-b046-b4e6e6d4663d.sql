CREATE OR REPLACE FUNCTION public.omni_comms_priv_print_attempt_stamp_batch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog','public'
AS $$
BEGIN
  IF NEW.print_batch_id IS NULL THEN
    SELECT bi.batch_id INTO NEW.print_batch_id
    FROM public.omni_comms_print_batch_item bi
    JOIN public.omni_comms_print_batch b ON b.id = bi.batch_id
    WHERE bi.print_item_id = NEW.print_item_id
      AND bi.membership_status = 'active'
      AND b.status IN ('locked','in_production','reconciling')
    ORDER BY bi.added_at DESC
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS omni_comms_print_attempt_stamp_batch
  ON public.omni_comms_print_attempt;

CREATE TRIGGER omni_comms_print_attempt_stamp_batch
BEFORE INSERT ON public.omni_comms_print_attempt
FOR EACH ROW EXECUTE FUNCTION public.omni_comms_priv_print_attempt_stamp_batch();