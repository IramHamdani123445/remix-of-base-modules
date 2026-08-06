-- =====================================================================
-- BN Mortality — M2 operational query model + M5 handoff lifecycle
-- No RLS (docs/ARCHITECTURE-NO-RLS-RULE.md). Mutations are RPC-only.
-- =====================================================================

-- ---------- 1. Canonical command definition table (26 commands) ----------
CREATE TABLE IF NOT EXISTS public.bn_mortality_command_definition (
  command_name          text PRIMARY KEY,
  action_name           text NOT NULL,
  display_name          text NOT NULL,
  valid_from_statuses   text[] NOT NULL DEFAULT '{}',
  creates_entity        boolean NOT NULL DEFAULT false,
  maker_source          text,
  requires_person_match boolean NOT NULL DEFAULT false,
  requires_evidence     boolean NOT NULL DEFAULT false,
  requires_open_actions_clear boolean NOT NULL DEFAULT false,
  requires_referral     boolean NOT NULL DEFAULT false,
  sort_order            int NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.bn_mortality_command_definition TO authenticated;
GRANT ALL ON public.bn_mortality_command_definition TO service_role;

INSERT INTO public.bn_mortality_command_definition
  (command_name, action_name, display_name, valid_from_statuses, creates_entity,
   maker_source, requires_person_match, requires_evidence,
   requires_open_actions_clear, requires_referral, sort_order)
VALUES
 ('BN_MORTALITY_DRAFT_SAVE','draft_save','Save draft','{DRAFT}',true,NULL,false,false,false,false,10),
 ('BN_MORTALITY_REGISTER_REPORT','write','Register death notification','{DRAFT}',true,NULL,false,false,false,false,20),
 ('BN_MORTALITY_CANCEL','cancel','Cancel notification','{DRAFT,REPORTED}',false,NULL,false,false,false,false,30),
 ('BN_MORTALITY_MATCH_PERSON','match_person','Match insured person','{DRAFT,REPORTED,VERIFICATION_PENDING,CONFLICT}',false,NULL,false,false,false,false,40),
 ('BN_MORTALITY_MARK_DUPLICATE','mark_duplicate','Mark as duplicate','{REPORTED,VERIFICATION_PENDING,CONFLICT}',false,NULL,false,false,false,false,50),
 ('BN_MORTALITY_ASSIGN','assign','Assign officer','{REPORTED,VERIFICATION_PENDING,CONFLICT,PROVISIONALLY_HELD,IMPACT_REVIEW,APPROVAL_PENDING}',false,NULL,false,false,false,false,60),
 ('BN_MORTALITY_ATTACH_EVIDENCE','write','Attach evidence','{DRAFT,REPORTED,VERIFICATION_PENDING,CONFLICT,PROVISIONALLY_HELD,IMPACT_REVIEW}',false,NULL,false,false,false,false,70),
 ('BN_MORTALITY_SUBMIT_FOR_VERIFICATION','write','Submit for verification','{REPORTED}',false,NULL,true,true,false,false,80),
 ('BN_MORTALITY_PLACE_PROVISIONAL_HOLD','decide','Place provisional hold','{REPORTED,VERIFICATION_PENDING,CONFLICT,IMPACT_REVIEW,APPROVAL_PENDING}',false,NULL,false,false,false,false,90),
 ('BN_MORTALITY_RELEASE_HOLD','release_hold','Release provisional hold','{PROVISIONALLY_HELD}',false,NULL,false,false,false,false,100),
 ('BN_MORTALITY_RECORD_CONFLICT','write','Record conflicting information','{REPORTED,VERIFICATION_PENDING}',false,NULL,false,false,false,false,110),
 ('BN_MORTALITY_RESOLVE_CONFLICT','resolve_conflict','Resolve conflict','{CONFLICT}',false,NULL,false,false,false,false,120),
 ('BN_MORTALITY_CONFIRM_VERIFICATION','verify','Confirm verification','{VERIFICATION_PENDING,PROVISIONALLY_HELD}',false,'BN_MORTALITY_SUBMIT_FOR_VERIFICATION',true,true,false,false,130),
 ('BN_MORTALITY_REJECT_REPORT','decide','Reject notification','{VERIFICATION_PENDING,PROVISIONALLY_HELD,CONFLICT}',false,'BN_MORTALITY_SUBMIT_FOR_VERIFICATION',false,false,false,false,140),
 ('BN_MORTALITY_PREPARE_IMPACT','prepare_impact','Prepare award impact','{VERIFIED,IMPACT_REVIEW}',false,NULL,false,false,false,false,150),
 ('BN_MORTALITY_SUBMIT_IMPACT','submit_impact','Submit impact for approval','{IMPACT_REVIEW}',false,NULL,false,false,false,false,160),
 ('BN_MORTALITY_RETURN_IMPACT','return_impact','Return impact for rework','{APPROVAL_PENDING}',false,NULL,false,false,false,false,170),
 ('BN_MORTALITY_APPROVE_IMPACT','approve_impact','Approve award impact','{APPROVAL_PENDING}',false,'BN_MORTALITY_SUBMIT_IMPACT',false,false,false,false,180),
 ('BN_MORTALITY_TERMINATE_AWARD','decide','Terminate affected award','{CONFIRMED,FOLLOW_ON_PROCESSING}',false,'BN_MORTALITY_APPROVE_IMPACT',false,false,false,false,190),
 ('BN_MORTALITY_CREATE_PAD_OVERPAYMENT','decide','Raise payment-after-death overpayment','{CONFIRMED,FOLLOW_ON_PROCESSING}',false,'BN_MORTALITY_APPROVE_IMPACT',false,false,false,false,200),
 ('BN_MORTALITY_INITIATE_SURVIVOR_ASSESSMENT','write','Initiate survivor assessment','{CONFIRMED,FOLLOW_ON_PROCESSING}',false,NULL,false,false,false,false,210),
 ('BN_MORTALITY_INITIATE_FUNERAL_GRANT','write','Initiate funeral grant','{CONFIRMED,FOLLOW_ON_PROCESSING}',false,NULL,false,false,false,false,220),
 ('BN_MORTALITY_COMPLETE_FOLLOWON','complete_followon','Complete follow-on processing','{FOLLOW_ON_PROCESSING}',false,NULL,false,false,false,true,230),
 ('BN_MORTALITY_REFER_LEGAL','decide','Refer to legal / estate','{CONFIRMED,FOLLOW_ON_PROCESSING}',false,'BN_MORTALITY_APPROVE_IMPACT',false,false,false,false,240),
 ('BN_MORTALITY_REVERSE_CONFIRMATION','reverse','Reverse confirmation','{VERIFIED,CONFIRMED,IMPACT_REVIEW,APPROVAL_PENDING,FOLLOW_ON_PROCESSING}',false,'BN_MORTALITY_CONFIRM_VERIFICATION',false,false,false,false,250),
 ('BN_MORTALITY_CLOSE_EVENT','decide','Close mortality event','{COMPLETED,REJECTED,CANCELLED,DUPLICATE,REVERSED}',false,NULL,false,false,true,false,260)
ON CONFLICT (command_name) DO UPDATE SET
  action_name = EXCLUDED.action_name,
  display_name = EXCLUDED.display_name,
  valid_from_statuses = EXCLUDED.valid_from_statuses,
  creates_entity = EXCLUDED.creates_entity,
  maker_source = EXCLUDED.maker_source,
  requires_person_match = EXCLUDED.requires_person_match,
  requires_evidence = EXCLUDED.requires_evidence,
  requires_open_actions_clear = EXCLUDED.requires_open_actions_clear,
  requires_referral = EXCLUDED.requires_referral,
  sort_order = EXCLUDED.sort_order;

-- ---------- 2. Canonical available-actions query (single source of truth) ----------
CREATE OR REPLACE FUNCTION public.bn_mortality_available_actions_v1(
  p_event_id uuid,
  p_actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event        public.bn_mortality_event%ROWTYPE;
  v_actions_on   boolean;
  v_state        text;
  v_version      bigint;
  v_open_actions int := 0;
  v_referrals    int := 0;
  v_evidence     int := 0;
  v_pending_hand int := 0;
  v_rows         jsonb := '[]'::jsonb;
  r              record;
  v_perm         jsonb;
  v_maker        uuid;
  v_enabled      boolean;
  v_code         text;
  v_msg          text;
  v_missing      text[];
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'E_UNAUTHENTICATED:bn_mortality_available_actions_v1';
  END IF;

  SELECT COALESCE(actions_enabled, false) INTO v_actions_on
    FROM public.app_modules WHERE name = 'bn_mortality';
  v_actions_on := COALESCE(v_actions_on, false);

  IF p_event_id IS NOT NULL THEN
    SELECT * INTO v_event FROM public.bn_mortality_event WHERE id = p_event_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ENTITY_NOT_FOUND:%', p_event_id;
    END IF;
    v_state   := v_event.status;
    v_version := v_event.row_version;

    SELECT count(*) INTO v_open_actions
      FROM public.bn_mortality_required_action
     WHERE event_id = p_event_id AND is_mandatory AND status = 'OPEN';
    SELECT count(*) INTO v_referrals
      FROM public.bn_mortality_referral WHERE event_id = p_event_id;
    SELECT count(*) INTO v_evidence
      FROM public.bn_mortality_evidence
     WHERE event_id = p_event_id AND status IN ('ATTACHED','RECEIVED');
    SELECT count(*) INTO v_pending_hand
      FROM public.bn_cross_module_handoff
     WHERE source_module = 'bn_mortality' AND source_record_id = p_event_id
       AND status IN ('RAISED','PENDING','ACCEPTED','FAILED');
  END IF;

  FOR r IN
    SELECT * FROM public.bn_mortality_command_definition ORDER BY sort_order
  LOOP
    v_enabled := true;
    v_code    := 'OK';
    v_msg     := 'Action is available.';
    v_missing := ARRAY[]::text[];

    v_perm := public.bn_mortality_check_actor_permission(p_actor_user_id, r.action_name, true);

    IF NOT v_actions_on THEN
      v_enabled := false;
      v_code := 'ACTIONS_DISABLED';
      v_msg  := 'Mortality actions are disabled for this environment (dark launch).';
    ELSIF NOT COALESCE((v_perm->>'ok')::boolean, false) THEN
      v_enabled := false;
      IF (v_perm->>'code') = 'ACTIONS_DISABLED' THEN
        v_code := 'ACTIONS_DISABLED';
        v_msg  := 'Mortality actions are disabled for this environment (dark launch).';
      ELSE
        v_code := 'PERMISSION_DENIED';
        v_msg  := 'You do not hold the required permission (' || r.action_name || ').';
      END IF;
    ELSIF p_event_id IS NULL THEN
      IF NOT r.creates_entity THEN
        v_enabled := false;
        v_code := 'INVALID_STATE';
        v_msg  := 'This action requires an existing mortality event.';
      END IF;
    ELSE
      IF v_state IN ('CLOSED') AND r.command_name <> 'BN_MORTALITY_CLOSE_EVENT' THEN
        v_enabled := false;
        v_code := 'ALREADY_COMPLETED';
        v_msg  := 'The mortality event is closed.';
      ELSIF NOT (v_state = ANY (r.valid_from_statuses)) THEN
        v_enabled := false;
        v_code := 'INVALID_STATE';
        v_msg  := 'Not permitted from state ' || v_state || '.';
      ELSIF r.requires_person_match AND v_event.matched_ip_id IS NULL THEN
        v_enabled := false;
        v_code := 'MISSING_PERSON_MATCH';
        v_msg  := 'The notification has not been matched to an insured person.';
        v_missing := array_append(v_missing, 'person_match');
      ELSIF r.requires_evidence AND v_evidence = 0 THEN
        v_enabled := false;
        v_code := 'MISSING_EVIDENCE';
        v_msg  := 'At least one item of death evidence must be attached.';
        v_missing := array_append(v_missing, 'evidence');
      ELSIF r.requires_referral AND v_referrals = 0 THEN
        v_enabled := false;
        v_code := 'HANDOFF_PENDING';
        v_msg  := 'No follow-on referral has been raised for this event.';
        v_missing := array_append(v_missing, 'referral');
      ELSIF r.requires_open_actions_clear AND v_open_actions > 0 THEN
        v_enabled := false;
        v_code := 'REQUIRED_ACTION_OUTSTANDING';
        v_msg  := v_open_actions || ' mandatory follow-on action(s) remain open.';
        v_missing := array_append(v_missing, 'required_actions');
      ELSIF r.maker_source IS NOT NULL THEN
        SELECT maker_user_id INTO v_maker
          FROM public.bn_mortality_command_maker
         WHERE event_id = p_event_id AND maker_role = r.maker_source;
        IF v_maker IS NULL THEN
          v_enabled := false;
          v_code := 'MAKER_CHECKER_REQUIRED';
          v_msg  := 'Requires a prior ' || r.maker_source || ' by another officer.';
          v_missing := array_append(v_missing, r.maker_source);
        ELSIF v_maker = p_actor_user_id THEN
          v_enabled := false;
          v_code := 'SELF_APPROVAL_DENIED';
          v_msg  := 'You performed the maker step and cannot also perform this action.';
        END IF;
      END IF;
    END IF;

    v_rows := v_rows || jsonb_build_object(
      'command', r.command_name,
      'display_name', r.display_name,
      'visible', true,
      'enabled', v_enabled,
      'reason_code', v_code,
      'reason_message', v_msg,
      'required_permission', 'bn_mortality:' || r.action_name,
      'current_state', v_state,
      'expected_row_version', v_version,
      'maker_checker_required', (r.maker_source IS NOT NULL),
      'maker_source_command', r.maker_source,
      'missing_prerequisites', to_jsonb(v_missing)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'event_id', p_event_id,
    'current_user_id', p_actor_user_id,
    'actions_enabled', v_actions_on,
    'current_state', v_state,
    'expected_row_version', v_version,
    'open_required_actions', v_open_actions,
    'pending_handoffs', v_pending_hand,
    'evidence_count', v_evidence,
    'actions', v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bn_mortality_available_actions_v1(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_mortality_available_actions_v1(uuid,uuid) TO authenticated, service_role;

-- ---------- 3. Shared handoff lifecycle ----------
ALTER TABLE public.bn_cross_module_handoff
  DROP CONSTRAINT IF EXISTS bn_cross_module_handoff_status_ck;
ALTER TABLE public.bn_cross_module_handoff
  ADD CONSTRAINT bn_cross_module_handoff_status_ck
  CHECK (status IN ('PENDING','RAISED','ACCEPTED','LINKED','COMPLETED','REJECTED','CANCELLED','FAILED'));

ALTER TABLE public.bn_cross_module_handoff
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS linked_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_reason_code text;

CREATE TABLE IF NOT EXISTS public.bn_cross_module_handoff_event (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handoff_id    uuid NOT NULL REFERENCES public.bn_cross_module_handoff(handoff_id) ON DELETE RESTRICT,
  from_status   text,
  to_status     text NOT NULL,
  command_name  text NOT NULL,
  actor_module  text NOT NULL,
  actor_user_id uuid,
  reason_code   text,
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.bn_cross_module_handoff_event TO authenticated;
GRANT ALL ON public.bn_cross_module_handoff_event TO service_role;
CREATE INDEX IF NOT EXISTS ix_bn_cmh_event_handoff
  ON public.bn_cross_module_handoff_event(handoff_id);

DROP INDEX IF EXISTS public.ux_bn_cmh_dedupe;
CREATE UNIQUE INDEX IF NOT EXISTS ux_bn_cmh_dedupe
  ON public.bn_cross_module_handoff(source_module, source_record_id, handoff_type)
  WHERE status IN ('PENDING','RAISED','ACCEPTED','LINKED');

-- Service-only lifecycle handler. The target module acts under its own
-- module identity; the source module may only CANCEL before acceptance.
CREATE OR REPLACE FUNCTION public.bn_cross_module_handoff_execute_v1(
  p_command       text,
  p_handoff_id    uuid,
  p_actor_module  text,
  p_actor_user_id uuid,
  p_reason_code   text DEFAULT NULL,
  p_payload       jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_h    public.bn_cross_module_handoff%ROWTYPE;
  v_from text;
  v_to   text;
BEGIN
  IF p_actor_module IS NULL OR p_actor_module = '' THEN
    RAISE EXCEPTION 'E_ACTOR_MODULE_REQUIRED:%', p_command;
  END IF;

  SELECT * INTO v_h FROM public.bn_cross_module_handoff
   WHERE handoff_id = p_handoff_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HANDOFF_NOT_FOUND:%', p_handoff_id;
  END IF;
  v_from := v_h.status;

  IF p_command = 'CANCEL' THEN
    IF p_actor_module <> v_h.source_module THEN
      RAISE EXCEPTION 'E_ACTOR_MODULE_MISMATCH:cancel requires source module %', v_h.source_module;
    END IF;
    IF v_from NOT IN ('RAISED','PENDING') THEN
      RAISE EXCEPTION 'E_HANDOFF_INVALID_STATE:% -> CANCELLED', v_from;
    END IF;
    v_to := 'CANCELLED';
  ELSE
    IF p_actor_module <> v_h.target_module THEN
      RAISE EXCEPTION 'E_ACTOR_MODULE_MISMATCH:% requires target module %', p_command, v_h.target_module;
    END IF;
    CASE p_command
      WHEN 'ACCEPT' THEN
        IF v_from NOT IN ('RAISED','PENDING') THEN
          RAISE EXCEPTION 'E_HANDOFF_INVALID_STATE:% -> ACCEPTED', v_from; END IF;
        v_to := 'ACCEPTED';
      WHEN 'LINK' THEN
        IF v_from <> 'ACCEPTED' THEN
          RAISE EXCEPTION 'E_HANDOFF_INVALID_STATE:% -> LINKED', v_from; END IF;
        IF COALESCE(p_payload->>'target_record_id','') = ''
           AND COALESCE(p_payload->>'target_reference','') = '' THEN
          RAISE EXCEPTION 'E_TARGET_REFERENCE_REQUIRED:%', p_handoff_id; END IF;
        v_to := 'LINKED';
      WHEN 'COMPLETE' THEN
        IF v_from <> 'LINKED' THEN
          RAISE EXCEPTION 'E_HANDOFF_INVALID_STATE:% -> COMPLETED', v_from; END IF;
        v_to := 'COMPLETED';
      WHEN 'REJECT' THEN
        IF v_from NOT IN ('RAISED','PENDING','ACCEPTED') THEN
          RAISE EXCEPTION 'E_HANDOFF_INVALID_STATE:% -> REJECTED', v_from; END IF;
        IF COALESCE(p_reason_code,'') = '' THEN
          RAISE EXCEPTION 'E_REASON_REQUIRED:REJECT'; END IF;
        v_to := 'REJECTED';
      WHEN 'FAIL' THEN
        IF v_from NOT IN ('RAISED','PENDING','ACCEPTED','LINKED') THEN
          RAISE EXCEPTION 'E_HANDOFF_INVALID_STATE:% -> FAILED', v_from; END IF;
        v_to := 'FAILED';
      WHEN 'RETRY' THEN
        IF v_from <> 'FAILED' THEN
          RAISE EXCEPTION 'E_HANDOFF_INVALID_STATE:% -> RAISED', v_from; END IF;
        v_to := 'RAISED';
      ELSE
        RAISE EXCEPTION 'HANDOFF_COMMAND_UNKNOWN:%', p_command;
    END CASE;
  END IF;

  UPDATE public.bn_cross_module_handoff SET
    status = v_to,
    accepted_by = CASE WHEN v_to = 'ACCEPTED' THEN p_actor_user_id ELSE accepted_by END,
    accepted_at = CASE WHEN v_to = 'ACCEPTED' THEN now() ELSE accepted_at END,
    target_record_id = COALESCE(NULLIF(p_payload->>'target_record_id',''), target_record_id),
    target_reference = COALESCE(NULLIF(p_payload->>'target_reference',''), target_reference),
    linked_at = CASE WHEN v_to = 'LINKED' THEN now() ELSE linked_at END,
    completed_at = CASE WHEN v_to = 'COMPLETED' THEN now() ELSE completed_at END,
    failure_reason = CASE WHEN v_to = 'FAILED' THEN COALESCE(p_reason_code, p_payload->>'failure_reason') ELSE failure_reason END,
    attempt_count = CASE WHEN p_command = 'RETRY' THEN attempt_count + 1 ELSE attempt_count END,
    closed_reason_code = CASE WHEN v_to IN ('REJECTED','CANCELLED') THEN p_reason_code ELSE closed_reason_code END,
    row_version = row_version + 1,
    updated_at = now()
  WHERE handoff_id = p_handoff_id
  RETURNING * INTO v_h;

  INSERT INTO public.bn_cross_module_handoff_event(
    handoff_id, from_status, to_status, command_name, actor_module,
    actor_user_id, reason_code, detail)
  VALUES (p_handoff_id, v_from, v_to, p_command, p_actor_module,
          p_actor_user_id, p_reason_code, COALESCE(p_payload,'{}'::jsonb));

  -- Terminal target outcomes settle the source module's required action.
  IF v_to IN ('COMPLETED','REJECTED','CANCELLED') THEN
    UPDATE public.bn_mortality_required_action
       SET status = CASE WHEN v_to = 'COMPLETED' THEN 'SATISFIED' ELSE 'CANCELLED' END,
           resolved_at = now(), resolved_by = p_actor_user_id
     WHERE handoff_id = p_handoff_id AND status = 'OPEN';
  END IF;

  RETURN jsonb_build_object(
    'handoff_id', p_handoff_id,
    'from_status', v_from,
    'status', v_to,
    'target_record_id', v_h.target_record_id,
    'target_reference', v_h.target_reference,
    'attempt_count', v_h.attempt_count,
    'row_version', v_h.row_version
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bn_cross_module_handoff_execute_v1(text,uuid,text,uuid,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bn_cross_module_handoff_execute_v1(text,uuid,text,uuid,text,jsonb)
  TO service_role;

-- The Mortality raiser now emits the canonical RAISED status.
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
     AND status IN ('PENDING','RAISED','ACCEPTED','LINKED');

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
    'RAISED', p_correlation_id, p_actor_user_id
  ) RETURNING handoff_id INTO v_handoff;

  INSERT INTO public.bn_cross_module_handoff_event(
    handoff_id, from_status, to_status, command_name, actor_module, actor_user_id, reason_code)
  VALUES (v_handoff, NULL, 'RAISED', 'RAISE', 'bn_mortality', p_actor_user_id, p_reason_code);

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

REVOKE ALL ON FUNCTION public._bn_mortality_raise_handoff(uuid,text,text,text,text,jsonb,uuid,uuid)
  FROM PUBLIC, anon, authenticated;