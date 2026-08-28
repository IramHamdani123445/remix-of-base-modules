-- FINAL-E2E-DEF-03: Omni-Comms outbox enqueues obligations with status 'pending'
-- (table default). ia_comms_emit_mandatory omitted 'pending' from its success
-- allowlist, so every Internal Audit command carrying a mandatory communication
-- obligation failed closed with IA_COMMS_OBLIGATION_NOT_CREATED even though the
-- obligation row was created correctly.
CREATE OR REPLACE FUNCTION public.ia_comms_emit_mandatory(
  p_event_code text,
  p_entity_type text,
  p_entity_id text,
  p_occurrence text DEFAULT 'default',
  p_recipient_facts jsonb DEFAULT '{}'::jsonb,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_correlation_id text DEFAULT NULL,
  p_department_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v jsonb;
BEGIN
  v := public.ia_comms_emit(p_event_code, p_entity_type, p_entity_id, p_occurrence,
                            p_recipient_facts, p_payload, p_correlation_id, p_department_id);

  IF coalesce(v->>'status','failed') NOT IN
     ('pending','queued','accepted','duplicate','deduped','skipped_duplicate','processed') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'IA_COMMS_OBLIGATION_NOT_CREATED',
      DETAIL  = coalesce(v::text, '{}'),
      HINT    = upper(btrim(p_event_code));
  END IF;

  RETURN v;
END;
$function$;