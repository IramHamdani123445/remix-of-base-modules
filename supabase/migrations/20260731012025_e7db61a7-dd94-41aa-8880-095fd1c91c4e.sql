ALTER TABLE public.omni_comms_recipient
  DROP CONSTRAINT omni_comms_recipient_recipient_type_check;
ALTER TABLE public.omni_comms_recipient
  ADD CONSTRAINT omni_comms_recipient_recipient_type_check
  CHECK (recipient_type = ANY (ARRAY['user','contact','group','external','system','synthetic_test']));