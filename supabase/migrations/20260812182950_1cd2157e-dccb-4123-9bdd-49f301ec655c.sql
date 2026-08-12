CREATE TABLE IF NOT EXISTS public.omni_comms_scheduler_ticket (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nonce text NOT NULL UNIQUE,
  issued_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT now() + interval '2 minutes',
  consumed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT ALL ON public.omni_comms_scheduler_ticket TO service_role;
ALTER TABLE public.omni_comms_scheduler_ticket ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scheduler tickets are backend only" ON public.omni_comms_scheduler_ticket;
CREATE POLICY "scheduler tickets are backend only"
ON public.omni_comms_scheduler_ticket FOR ALL TO authenticated
USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.omni_comms_priv_scheduler_issue_ticket()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_nonce text;
BEGIN
  DELETE FROM public.omni_comms_scheduler_ticket
   WHERE expires_at < now() - interval '1 hour';
  v_nonce := encode(gen_random_bytes(32), 'hex');
  INSERT INTO public.omni_comms_scheduler_ticket (nonce) VALUES (v_nonce);
  RETURN v_nonce;
END $$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_scheduler_issue_ticket() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.omni_comms_priv_scheduler_consume_ticket(p_nonce text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  UPDATE public.omni_comms_scheduler_ticket
     SET consumed_at = now(), updated_at = now()
   WHERE nonce = coalesce(p_nonce,'')
     AND consumed_at IS NULL
     AND expires_at > now()
  RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.omni_comms_priv_scheduler_consume_ticket(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_priv_scheduler_consume_ticket(text) TO service_role;