-- =====================================================================
-- BN Mortality — governance hardening (security gate, idempotency,
-- maker-checker, evidence, governed cross-module handoffs, closure gate)
-- Project rule: no RLS (docs/ARCHITECTURE-NO-RLS-RULE.md). Mutations are
-- SECURITY DEFINER RPC-only; browser roles get SELECT only.
-- =====================================================================

-- ---------- 1. Shared governed cross-module handoff register ----------
CREATE TABLE IF NOT EXISTS public.bn_cross_module_handoff (
  handoff_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_module     text NOT NULL,
  source_record_id  uuid NOT NULL,
  target_module     text NOT NULL,
  handoff_type      text NOT NULL,
  person_id         bigint,
  claim_id          uuid,
  award_id          uuid,
  reason_code       text,
  structured_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL DEFAULT 'PENDING',
  correlation_id    uuid,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  accepted_by       uuid,
  accepted_at       timestamptz,
  target_record_id  text,
  target_reference  text,
  row_version       bigint NOT NULL DEFAULT 1,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_cross_module_handoff_status_ck
    CHECK (status IN ('PENDING','ACCEPTED','REJECTED','COMPLETED','CANCELLED'))
);

GRANT SELECT ON public.bn_cross_module_handoff TO authenticated;
GRANT ALL ON public.bn_cross_module_handoff TO service_role;

CREATE INDEX IF NOT EXISTS ix_bn_cmh_source
  ON public.bn_cross_module_handoff(source_module, source_record_id);
CREATE INDEX IF NOT EXISTS ix_bn_cmh_target
  ON public.bn_cross_module_handoff(target_module, status);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bn_cmh_dedupe
  ON public.bn_cross_module_handoff(source_module, source_record_id, handoff_type)
  WHERE status IN ('PENDING','ACCEPTED');

-- ---------- 2. Mortality evidence (DMS boundary) ----------
CREATE TABLE IF NOT EXISTS public.bn_mortality_evidence (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES public.bn_mortality_event(id) ON DELETE RESTRICT,
  evidence_type   text NOT NULL,
  dms_document_id text,
  dms_reference   text,
  received_at     timestamptz,
  status          text NOT NULL DEFAULT 'ATTACHED',
  notes           text,
  correlation_id  uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  CONSTRAINT bn_mortality_evidence_status_ck
    CHECK (status IN ('REQUESTED','ATTACHED','RECEIVED','REJECTED'))
);

GRANT SELECT ON public.bn_mortality_evidence TO authenticated;
GRANT ALL ON public.bn_mortality_evidence TO service_role;
CREATE INDEX IF NOT EXISTS ix_bn_mortality_evidence_event
  ON public.bn_mortality_evidence(event_id);

-- ---------- 3. Required follow-on actions (closure gate) ----------
CREATE TABLE IF NOT EXISTS public.bn_mortality_required_action (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES public.bn_mortality_event(id) ON DELETE RESTRICT,
  action_code   text NOT NULL,
  is_mandatory  boolean NOT NULL DEFAULT true,
  status        text NOT NULL DEFAULT 'OPEN',
  handoff_id    uuid REFERENCES public.bn_cross_module_handoff(handoff_id),
  resolved_at   timestamptz,
  resolved_by   uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bn_mortality_required_action_status_ck
    CHECK (status IN ('OPEN','SATISFIED','WAIVED','CANCELLED'))
);

GRANT SELECT ON public.bn_mortality_required_action TO authenticated;
GRANT ALL ON public.bn_mortality_required_action TO service_role;
CREATE UNIQUE INDEX IF NOT EXISTS ux_bn_mortality_required_action
  ON public.bn_mortality_required_action(event_id, action_code);

-- ---------- 4. Command → module action mapping ----------
CREATE OR REPLACE FUNCTION public._bn_mortality_action_for_command(p_command_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_command_name
    WHEN 'BN_MORTALITY_CONFIRM_VERIFICATION' THEN 'verify'
    WHEN 'BN_MORTALITY_APPROVE_IMPACT'       THEN 'approve_impact'
    WHEN 'BN_MORTALITY_REVERSE_CONFIRMATION' THEN 'reverse'
    WHEN 'BN_MORTALITY_DRAFT_SAVE'           THEN 'draft_save'
    WHEN 'BN_MORTALITY_MATCH_PERSON'         THEN 'match_person'
    WHEN 'BN_MORTALITY_MARK_DUPLICATE'       THEN 'mark_duplicate'
    WHEN 'BN_MORTALITY_ASSIGN'               THEN 'assign'
    WHEN 'BN_MORTALITY_CANCEL'               THEN 'cancel'
    WHEN 'BN_MORTALITY_PREPARE_IMPACT'       THEN 'prepare_impact'
    WHEN 'BN_MORTALITY_SUBMIT_IMPACT'        THEN 'submit_impact'
    WHEN 'BN_MORTALITY_RETURN_IMPACT'        THEN 'return_impact'
    WHEN 'BN_MORTALITY_RELEASE_HOLD'         THEN 'release_hold'
    WHEN 'BN_MORTALITY_RESOLVE_CONFLICT'     THEN 'resolve_conflict'
    WHEN 'BN_MORTALITY_COMPLETE_FOLLOWON'    THEN 'complete_followon'
    WHEN 'BN_MORTALITY_PLACE_PROVISIONAL_HOLD' THEN 'decide'
    WHEN 'BN_MORTALITY_TERMINATE_AWARD'      THEN 'decide'
    WHEN 'BN_MORTALITY_REJECT_REPORT'        THEN 'decide'
    WHEN 'BN_MORTALITY_CREATE_PAD_OVERPAYMENT' THEN 'decide'
    WHEN 'BN_MORTALITY_REFER_LEGAL'          THEN 'decide'
    WHEN 'BN_MORTALITY_CLOSE_EVENT'          THEN 'decide'
    ELSE 'write'
  END;
$$;

-- ---------- 5. Maker-checker metadata ----------
CREATE OR REPLACE FUNCTION public._bn_mortality_maker_source(p_command_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_command_name
    WHEN 'BN_MORTALITY_CONFIRM_VERIFICATION' THEN 'BN_MORTALITY_SUBMIT_FOR_VERIFICATION'
    WHEN 'BN_MORTALITY_REJECT_REPORT'        THEN 'BN_MORTALITY_SUBMIT_FOR_VERIFICATION'
    WHEN 'BN_MORTALITY_APPROVE_IMPACT'       THEN 'BN_MORTALITY_SUBMIT_IMPACT'
    WHEN 'BN_MORTALITY_TERMINATE_AWARD'      THEN 'BN_MORTALITY_APPROVE_IMPACT'
    WHEN 'BN_MORTALITY_CREATE_PAD_OVERPAYMENT' THEN 'BN_MORTALITY_APPROVE_IMPACT'
    WHEN 'BN_MORTALITY_REFER_LEGAL'          THEN 'BN_MORTALITY_APPROVE_IMPACT'
    WHEN 'BN_MORTALITY_REVERSE_CONFIRMATION' THEN 'BN_MORTALITY_CONFIRM_VERIFICATION'
    ELSE NULL
  END;
$$;

-- ---------- 6. Governed handoff raiser ----------
CREATE OR REPLACE FUNCTION public._bn_mortality_raise_handoff(
  p_event_id uuid,
  p_handoff_type text,
  p_target_module text,
  p_referral_type text,
  p_reason_code text,
  p_context jsonb,
  p_correlation_id uuid,
  p_actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event public.bn_mortality_event%ROWTYPE;
  v_handoff uuid;
  v_existing uuid;
BEGIN
  SELECT * INTO v_event FROM public.bn_mortality_event WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MORTALITY_EVENT_NOT_FOUND:%', p_event_id;
  END IF;

  SELECT handoff_id INTO v_existing
    FROM public.bn_cross_module_handoff
   WHERE source_module = 'bn_mortality'
     AND source_record_id = p_event_id
     AND handoff_type = p_handoff_type
     AND status IN ('PENDING','ACCEPTED');

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('handoff_id', v_existing, 'status', 'REPLAYED');
  END IF;

  INSERT INTO public.bn_cross_module_handoff(
    source_module, source_record_id, target_module, handoff_type,
    person_id, reason_code, structured_context, status, correlation_id, created_by
  ) VALUES (
    'bn_mortality', p_event_id, p_target_module, p_handoff_type,
    v_event.matched_ip_id, p_reason_code,
    COALESCE(p_context, '{}'::jsonb) || jsonb_build_object(
      'death_date', v_event.death_date,
      'event_reference', v_event.event_reference,
      'matched_person_ssn', v_event.matched_person_ssn
    ),
    'PENDING', p_correlation_id, p_actor_user_id
  ) RETURNING handoff_id INTO v_handoff;

  INSERT INTO public.bn_mortality_referral(
    event_id, referral_type, target_module, status,
    correlation_id, raised_by, target_ref_type, target_ref_id
  ) VALUES (
    p_event_id, p_referral_type, p_target_module, 'PENDING',
    p_correlation_id, p_actor_user_id, 'handoff', v_handoff::text
  );

  INSERT INTO public.bn_mortality_required_action(event_id, action_code, handoff_id)
  VALUES (p_event_id, p_handoff_type, v_handoff)
  ON CONFLICT (event_id, action_code) DO NOTHING;

  RETURN jsonb_build_object('handoff_id', v_handoff, 'status', 'RAISED',
                            'target_module', p_target_module);
END;
$$;

REVOKE ALL ON FUNCTION public._bn_mortality_raise_handoff(uuid,text,text,text,text,jsonb,uuid,uuid) FROM PUBLIC, anon, authenticated;

-- ---------- 7. Governed command entry point (v2) ----------
CREATE OR REPLACE FUNCTION public.bn_mortality_execute_command_v2(
  p_command_name text,
  p_entity_id uuid,
  p_actor_user_id uuid,
  p_actor_user_code text,
  p_correlation_id uuid,
  p_expected_row_version bigint,
  p_reason_code text,
  p_justification text,
  p_payload jsonb,
  p_payload_hash text,
  p_idempotency_key uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perm        jsonb;
  v_action      text;
  v_maker_src   text;
  v_maker_user  uuid;
  v_prior       public.bn_mortality_command_idempotency%ROWTYPE;
  v_open_reqs   int;
  v_referrals   int;
  v_result      jsonb;
  v_handoff     jsonb;
  v_event_id    uuid := p_entity_id;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'E_UNAUTHENTICATED:%', p_command_name;
  END IF;

  -- (a) dark-launch + granular permission gate
  v_action := public._bn_mortality_action_for_command(p_command_name);
  v_perm := public.bn_mortality_check_actor_permission(p_actor_user_id, v_action, true);
  IF NOT COALESCE((v_perm->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'E_%:%', v_perm->>'code', p_command_name;
  END IF;

  -- (b) idempotent replay
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_prior
      FROM public.bn_mortality_command_idempotency
     WHERE idempotency_key = p_idempotency_key AND command_name = p_command_name;
    IF FOUND THEN
      RETURN v_prior.result_json || jsonb_build_object('status', 'REPLAYED');
    END IF;
  END IF;

  -- (c) maker-checker + self-approval prohibition
  v_maker_src := public._bn_mortality_maker_source(p_command_name);
  IF v_maker_src IS NOT NULL AND v_event_id IS NOT NULL THEN
    SELECT maker_user_id INTO v_maker_user
      FROM public.bn_mortality_command_maker
     WHERE event_id = v_event_id AND maker_role = v_maker_src;
    IF v_maker_user IS NULL THEN
      RAISE EXCEPTION 'E_MAKER_REQUIRED:% needs prior %', p_command_name, v_maker_src;
    END IF;
    IF v_maker_user = p_actor_user_id THEN
      RAISE EXCEPTION 'E_SELF_APPROVAL:%', p_command_name;
    END IF;
  END IF;

  -- (d) closure / follow-on gates
  IF p_command_name = 'BN_MORTALITY_CLOSE_EVENT' AND v_event_id IS NOT NULL THEN
    SELECT count(*) INTO v_open_reqs
      FROM public.bn_mortality_required_action
     WHERE event_id = v_event_id AND is_mandatory AND status = 'OPEN';
    IF v_open_reqs > 0 THEN
      RAISE EXCEPTION 'E_OUTSTANDING_REQUIRED_ACTIONS:%', v_open_reqs;
    END IF;
  END IF;

  IF p_command_name = 'BN_MORTALITY_COMPLETE_FOLLOWON' AND v_event_id IS NOT NULL THEN
    SELECT count(*) INTO v_referrals
      FROM public.bn_mortality_referral WHERE event_id = v_event_id;
    IF v_referrals = 0 THEN
      RAISE EXCEPTION 'E_NO_FOLLOWON_RAISED:%', v_event_id;
    END IF;
  END IF;

  -- (e) evidence attachment (DMS boundary)
  IF p_command_name = 'BN_MORTALITY_ATTACH_EVIDENCE' THEN
    IF v_event_id IS NULL THEN
      RAISE EXCEPTION 'ENTITY_REQUIRED:%', p_command_name;
    END IF;
    IF COALESCE(p_payload->>'dms_document_id', '') = ''
       AND COALESCE(p_payload->>'dms_reference', '') = '' THEN
      RAISE EXCEPTION 'E_EVIDENCE_REFERENCE_REQUIRED:%', p_command_name;
    END IF;
    INSERT INTO public.bn_mortality_evidence(
      event_id, evidence_type, dms_document_id, dms_reference,
      received_at, status, notes, correlation_id, created_by
    ) VALUES (
      v_event_id, COALESCE(p_payload->>'evidence_type','DEATH_CERTIFICATE'),
      NULLIF(p_payload->>'dms_document_id',''), NULLIF(p_payload->>'dms_reference',''),
      COALESCE((p_payload->>'received_at')::timestamptz, now()),
      COALESCE(p_payload->>'status','ATTACHED'),
      p_payload->>'notes', p_correlation_id, p_actor_user_id
    );
  END IF;

  -- (f) core state machine / servicing orchestration
  v_result := public.bn_mortality_execute_command(
    p_command_name, p_entity_id, p_actor_user_id, p_actor_user_code,
    p_correlation_id, p_expected_row_version, p_reason_code,
    p_justification, p_payload, p_payload_hash
  );
  v_event_id := COALESCE((v_result->>'entity_id')::uuid, v_event_id);

  -- (g) governed cross-module handoffs (source module never mutates the target)
  IF p_command_name = 'BN_MORTALITY_CREATE_PAD_OVERPAYMENT' THEN
    v_handoff := public._bn_mortality_raise_handoff(
      v_event_id, 'POTENTIAL_OVERPAYMENT', 'bn_overpayments', 'OVERPAYMENT',
      COALESCE(p_reason_code,'PAYMENT_AFTER_DEATH'), p_payload, p_correlation_id, p_actor_user_id);
  ELSIF p_command_name = 'BN_MORTALITY_INITIATE_SURVIVOR_ASSESSMENT' THEN
    v_handoff := public._bn_mortality_raise_handoff(
      v_event_id, 'POTENTIAL_SURVIVOR_ASSESSMENT', 'bn_survivors', 'SURVIVOR',
      COALESCE(p_reason_code,'DEATH_CONFIRMED'), p_payload, p_correlation_id, p_actor_user_id);
  ELSIF p_command_name = 'BN_MORTALITY_INITIATE_FUNERAL_GRANT' THEN
    v_handoff := public._bn_mortality_raise_handoff(
      v_event_id, 'FUNERAL_GRANT_INTAKE', 'bn_claims', 'FUNERAL',
      COALESCE(p_reason_code,'DEATH_CONFIRMED'), p_payload, p_correlation_id, p_actor_user_id);
  ELSIF p_command_name = 'BN_MORTALITY_REFER_LEGAL' THEN
    v_handoff := public._bn_mortality_raise_handoff(
      v_event_id, 'LEGAL_ESTATE_REFERRAL', 'legal', 'LEGAL',
      COALESCE(p_reason_code,'ESTATE_RECOVERY'), p_payload, p_correlation_id, p_actor_user_id);
  END IF;

  IF v_handoff IS NOT NULL THEN
    v_result := v_result || jsonb_build_object('handoff', v_handoff);
  END IF;

  -- (h) follow-on completion satisfies outstanding required actions
  IF p_command_name = 'BN_MORTALITY_COMPLETE_FOLLOWON' AND v_event_id IS NOT NULL THEN
    UPDATE public.bn_mortality_required_action
       SET status = 'SATISFIED', resolved_at = now(), resolved_by = p_actor_user_id
     WHERE event_id = v_event_id AND status = 'OPEN';
  END IF;

  -- (i) record maker identity for downstream checker commands
  IF v_event_id IS NOT NULL THEN
    INSERT INTO public.bn_mortality_command_maker(event_id, maker_role, maker_user_id, correlation_id)
    VALUES (v_event_id, p_command_name, p_actor_user_id, p_correlation_id)
    ON CONFLICT (event_id, maker_role)
      DO UPDATE SET maker_user_id = EXCLUDED.maker_user_id,
                    recorded_at = now(),
                    correlation_id = EXCLUDED.correlation_id;
  END IF;

  -- (j) persist idempotency result
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.bn_mortality_command_idempotency(
      idempotency_key, command_name, payload_hash, entity_id, entity_version,
      result_json, status, completed_at, actor_user_id
    ) VALUES (
      p_idempotency_key, p_command_name, COALESCE(p_payload_hash,''), v_event_id,
      NULLIF(v_result->>'entity_version','')::bigint, v_result, 'COMPLETED', now(), p_actor_user_id
    ) ON CONFLICT (idempotency_key, command_name) DO NOTHING;
  END IF;

  RETURN v_result || jsonb_build_object('status', 'EXECUTED');
END;
$$;

REVOKE ALL ON FUNCTION public.bn_mortality_execute_command_v2(text,uuid,uuid,text,uuid,bigint,text,text,jsonb,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_mortality_execute_command_v2(text,uuid,uuid,text,uuid,bigint,text,text,jsonb,text,uuid) TO authenticated, service_role;

-- The unguarded v1 entry point must no longer be callable from the browser.
REVOKE ALL ON FUNCTION public.bn_mortality_execute_command(text,uuid,uuid,text,uuid,bigint,text,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bn_mortality_execute_command(text,uuid,uuid,text,uuid,bigint,text,text,jsonb,text) TO service_role;