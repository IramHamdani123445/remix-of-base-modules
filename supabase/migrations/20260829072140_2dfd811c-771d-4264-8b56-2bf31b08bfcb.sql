
CREATE TABLE IF NOT EXISTS public.ce_legal_handoff_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid,
  case_id uuid,
  employer_id text,
  reason text NOT NULL,
  evaluation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  rule_codes text[] NOT NULL DEFAULT '{}',
  authorised_by_user_id uuid NOT NULL,
  authorised_by text NOT NULL,
  authorised_role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ce_legal_handoff_overrides TO authenticated;
GRANT ALL ON public.ce_legal_handoff_overrides TO service_role;

CREATE INDEX IF NOT EXISTS ce_legal_handoff_overrides_referral_idx
  ON public.ce_legal_handoff_overrides (referral_id);
CREATE INDEX IF NOT EXISTS ce_legal_handoff_overrides_case_idx
  ON public.ce_legal_handoff_overrides (case_id);

CREATE OR REPLACE FUNCTION public.ce_record_legal_handoff_override_v1(
  p_reason text,
  p_evaluation jsonb DEFAULT '{}'::jsonb,
  p_referral_id uuid DEFAULT NULL,
  p_case_id uuid DEFAULT NULL,
  p_employer_id text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_role text;
  v_codes text[];
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-LH-401: authentication required' USING ERRCODE='42501';
  END IF;
  IF coalesce(trim(p_reason),'') = '' OR length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'CE-LH-422: a documented override reason of at least 10 characters is required' USING ERRCODE='22023';
  END IF;

  v_actor := left(public.ce_actor_user_code(v_uid),100);
  v_role  := public.ce_compliance_role(v_uid);

  IF NOT public.ce_actor_can(v_uid, 'compliance.legal.override') THEN
    INSERT INTO public.system_audit_trail
      (action, module, entity_type, entity_id, severity, payload_json, user_id, user_name, timestamp)
    VALUES ('ce.legal.handoff_override_denied','Compliance','legal_referral',
            COALESCE(p_referral_id::text, p_case_id::text, '-'), 'warning',
            jsonb_build_object('actor_role', v_role, 'reason', p_reason),
            v_uid, v_actor, now());
    RAISE EXCEPTION 'CE-LH-403: legal handoff override authority is required' USING ERRCODE='42501';
  END IF;

  SELECT array_agg(DISTINCT x) INTO v_codes
  FROM jsonb_array_elements_text(COALESCE(p_evaluation->'failedRuleCodes','[]'::jsonb)) AS x;

  INSERT INTO public.ce_legal_handoff_overrides
    (referral_id, case_id, employer_id, reason, evaluation_snapshot, rule_codes,
     authorised_by_user_id, authorised_by, authorised_role)
  VALUES (p_referral_id, p_case_id, p_employer_id, trim(p_reason), COALESCE(p_evaluation,'{}'::jsonb),
          COALESCE(v_codes,'{}'), v_uid, v_actor, v_role)
  RETURNING id INTO v_id;

  INSERT INTO public.system_audit_trail
    (action, module, entity_type, entity_id, severity, after_value, payload_json, user_id, user_name, timestamp)
  VALUES ('ce.legal.handoff_override','Compliance','legal_referral',
          COALESCE(p_referral_id::text, p_case_id::text, v_id::text), 'warning',
          COALESCE(p_evaluation,'{}'::jsonb),
          jsonb_build_object('override_id', v_id, 'reason', trim(p_reason), 'actor_role', v_role),
          v_uid, v_actor, now());

  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.ce_record_legal_handoff_override_v1(text,jsonb,uuid,uuid,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ce_record_legal_handoff_override_v1(text,jsonb,uuid,uuid,text) TO authenticated, service_role;

-- append-only register
CREATE OR REPLACE FUNCTION public.ce_legal_handoff_override_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'CE-LH-409: legal handoff overrides are append-only' USING ERRCODE='42501';
END $$;

DROP TRIGGER IF EXISTS ce_legal_handoff_override_immutable_trg ON public.ce_legal_handoff_overrides;
CREATE TRIGGER ce_legal_handoff_override_immutable_trg
BEFORE UPDATE OR DELETE ON public.ce_legal_handoff_overrides
FOR EACH ROW EXECUTE FUNCTION public.ce_legal_handoff_override_immutable();
