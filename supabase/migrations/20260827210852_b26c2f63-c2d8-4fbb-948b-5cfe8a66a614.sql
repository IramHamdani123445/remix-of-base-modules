-- Wave 4 DEF-4: governed pre-release quarantine of historical Internal Audit
-- communication obligations. Immutable business-event history is preserved:
-- rows are transitioned to the canonical terminal 'blocked' state carrying an
-- explicit, auditable blocker code. Nothing is deleted or rewritten.

CREATE TABLE IF NOT EXISTS public.ia_comms_pre_release_quarantine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id uuid NOT NULL,
  event_code text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  occurrence text,
  previous_status text NOT NULL,
  recipient_digest jsonb NOT NULL,
  reason_code text NOT NULL DEFAULT 'PRE_RELEASE_NOT_DISPATCHABLE',
  quarantined_at timestamptz NOT NULL DEFAULT now(),
  correlation_id text,
  UNIQUE (outbox_id)
);

GRANT SELECT ON public.ia_comms_pre_release_quarantine TO authenticated;
GRANT ALL ON public.ia_comms_pre_release_quarantine TO service_role;
ALTER TABLE public.ia_comms_pre_release_quarantine ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ia_comms_pre_release_quarantine_read ON public.ia_comms_pre_release_quarantine;
CREATE POLICY ia_comms_pre_release_quarantine_read
  ON public.ia_comms_pre_release_quarantine FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'Admin'::app_role));

CREATE OR REPLACE FUNCTION public.ia_comms_pre_release_quarantine_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'ia_comms_pre_release_quarantine is append-only';
END $$;

DROP TRIGGER IF EXISTS ia_comms_pre_release_quarantine_no_mutate ON public.ia_comms_pre_release_quarantine;
CREATE TRIGGER ia_comms_pre_release_quarantine_no_mutate
  BEFORE UPDATE OR DELETE ON public.ia_comms_pre_release_quarantine
  FOR EACH ROW EXECUTE FUNCTION public.ia_comms_pre_release_quarantine_append_only();

CREATE OR REPLACE FUNCTION public.ia_comms_priv_quarantine_pre_release_outbox(
  p_reason_code text DEFAULT 'PRE_RELEASE_NOT_DISPATCHABLE',
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_quarantined integer := 0;
  v_ids uuid[];
BEGIN
  IF p_reason_code IS NULL OR btrim(p_reason_code) = '' THEN
    RAISE EXCEPTION 'reason code required';
  END IF;

  WITH target AS (
    SELECT id, event_code, entity_type, entity_id, occurrence, status, recipient_facts
    FROM public.omni_comms_business_event_outbox
    WHERE module_code = 'INTERNAL_AUDIT'
      AND status IN ('pending','needs_review')
  ), logged AS (
    INSERT INTO public.ia_comms_pre_release_quarantine
      (outbox_id, event_code, entity_type, entity_id, occurrence,
       previous_status, recipient_digest, reason_code, correlation_id)
    SELECT t.id, t.event_code, t.entity_type, t.entity_id, t.occurrence,
           t.status, t.recipient_facts, p_reason_code, p_correlation_id
    FROM target t
    ON CONFLICT (outbox_id) DO NOTHING
    RETURNING outbox_id
  ), updated AS (
    UPDATE public.omni_comms_business_event_outbox o
       SET status = 'blocked',
           blocker_code = p_reason_code,
           result_code = p_reason_code,
           processed_at = now(),
           updated_at = now()
     WHERE o.id IN (SELECT outbox_id FROM logged)
    RETURNING o.id
  )
  SELECT count(*)::int, coalesce(array_agg(id), '{}') INTO v_quarantined, v_ids FROM updated;

  RETURN jsonb_build_object(
    'quarantined', v_quarantined,
    'reason_code', p_reason_code,
    'outbox_ids', to_jsonb(v_ids),
    'remaining_dispatchable', (
      SELECT count(*) FROM public.omni_comms_business_event_outbox
      WHERE module_code = 'INTERNAL_AUDIT' AND status IN ('pending','processing','needs_review'))
  );
END $$;

REVOKE ALL ON FUNCTION public.ia_comms_priv_quarantine_pre_release_outbox(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ia_comms_priv_quarantine_pre_release_outbox(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.ia_comms_priv_quarantine_pre_release_outbox(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ia_comms_priv_quarantine_pre_release_outbox(text, text) TO service_role;