
ALTER TABLE public.ce_waiver_rules
  ADD COLUMN IF NOT EXISTS required_approval_role text NOT NULL DEFAULT 'senior',
  ADD COLUMN IF NOT EXISTS escalated_approval_role text NOT NULL DEFAULT 'head';

ALTER TABLE public.ce_waiver_rules
  DROP CONSTRAINT IF EXISTS ce_waiver_rules_approval_roles_chk;
ALTER TABLE public.ce_waiver_rules
  ADD CONSTRAINT ce_waiver_rules_approval_roles_chk
  CHECK (required_approval_role IN ('inspector','senior','head')
     AND escalated_approval_role IN ('inspector','senior','head'));

ALTER TABLE public.ce_waivers
  ADD COLUMN IF NOT EXISTS rule_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS approver_user_id uuid,
  ADD COLUMN IF NOT EXISTS decision_context jsonb;

-- map a configured approval role to a capability
CREATE OR REPLACE FUNCTION public.ce_waiver_role_capability(p_role text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE lower(coalesce(p_role,'senior'))
           WHEN 'head' THEN 'compliance.waiver.approve_high'
           ELSE 'compliance.waiver.approve'
         END;
$$;

CREATE OR REPLACE FUNCTION public.ce_waiver_deny(p_waiver_id uuid, p_uid uuid, p_code text, p_detail jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF p_waiver_id IS NOT NULL THEN
    INSERT INTO public.ce_waiver_decisions (waiver_id, action, reason, comments, acted_by)
    VALUES (p_waiver_id, 'APPROVAL_DENIED', p_code, p_detail::text,
            left(COALESCE(public.ce_actor_user_code(p_uid), 'UNKNOWN'), 100));
  END IF;
  INSERT INTO public.system_audit_trail
    (action, module, entity_type, entity_id, severity, payload_json, user_id, user_name, timestamp)
  VALUES ('ce.waiver.decision_denied','Compliance','waiver', COALESCE(p_waiver_id::text,'-'),
          'warning', jsonb_build_object('code', p_code) || COALESCE(p_detail,'{}'::jsonb),
          p_uid, left(COALESCE(public.ce_actor_user_code(p_uid),'ANONYMOUS'),100), now());
END $$;

-- ---------------- request ----------------
CREATE OR REPLACE FUNCTION public.ce_request_waiver_v1(
  p_employer_id text,
  p_waiver_type text,
  p_amount_requested numeric,
  p_justification text,
  p_case_id uuid DEFAULT NULL,
  p_violation_id uuid DEFAULT NULL,
  p_waiver_rule_id uuid DEFAULT NULL,
  p_reason_code text DEFAULT NULL,
  p_source text DEFAULT 'CASE',
  p_fund text DEFAULT NULL,
  p_supporting_documents jsonb DEFAULT '[]'::jsonb,
  p_workflow_definition_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_rule record;
  v_status text;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-WV-401: authentication required' USING ERRCODE='42501';
  END IF;
  IF NOT public.ce_feature_flag_enabled('compliance.payment.waiver_requests') THEN
    RAISE EXCEPTION 'CE-WV-503: waiver requests are disabled by feature toggle' USING ERRCODE='42501';
  END IF;
  IF NOT public.ce_actor_can(v_uid, 'compliance.enforcement.arrangements') THEN
    PERFORM public.ce_waiver_deny(NULL, v_uid, 'CE-WV-403-REQUEST', jsonb_build_object('employer', p_employer_id));
    RAISE EXCEPTION 'CE-WV-403: not authorised to raise waiver requests' USING ERRCODE='42501';
  END IF;
  IF coalesce(p_amount_requested,0) <= 0 THEN
    RAISE EXCEPTION 'CE-WV-422: requested amount must be greater than zero' USING ERRCODE='22023';
  END IF;
  IF coalesce(trim(p_justification),'') = '' THEN
    RAISE EXCEPTION 'CE-WV-422: justification is required' USING ERRCODE='22023';
  END IF;

  v_actor := left(public.ce_actor_user_code(v_uid),100);

  IF p_waiver_rule_id IS NOT NULL THEN
    SELECT * INTO v_rule FROM public.ce_waiver_rules WHERE id = p_waiver_rule_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'CE-WV-404: waiver rule not found' USING ERRCODE='22023'; END IF;
    IF NOT v_rule.enabled THEN RAISE EXCEPTION 'CE-WV-409: waiver rule % is disabled', v_rule.code USING ERRCODE='22023'; END IF;
    IF p_fund IS NOT NULL AND array_length(v_rule.applicable_funds,1) > 0
       AND NOT (p_fund = ANY (v_rule.applicable_funds)) THEN
      RAISE EXCEPTION 'CE-WV-422: fund % not permitted under rule %', p_fund, v_rule.code USING ERRCODE='22023';
    END IF;
    IF p_reason_code IS NOT NULL AND array_length(v_rule.valid_reasons,1) > 0
       AND NOT (p_reason_code = ANY (v_rule.valid_reasons)) THEN
      RAISE EXCEPTION 'CE-WV-422: reason % not permitted under rule %', p_reason_code, v_rule.code USING ERRCODE='22023';
    END IF;
  END IF;

  v_status := CASE WHEN p_workflow_definition_id IS NOT NULL THEN 'PENDING_APPROVAL' ELSE 'PENDING' END;

  INSERT INTO public.ce_waivers
    (waiver_number, employer_id, case_id, violation_id, waiver_rule_id, waiver_type, source,
     status, amount_requested, reason_code, justification, supporting_documents,
     workflow_definition_id, requested_by, created_by, updated_by)
  VALUES
    ('WV-' || to_char(now(),'YYMMDD') || '-' || lpad((floor(random()*100000))::text,5,'0'),
     p_employer_id, p_case_id, p_violation_id, p_waiver_rule_id, p_waiver_type, p_source,
     v_status, p_amount_requested, p_reason_code, p_justification, COALESCE(p_supporting_documents,'[]'::jsonb),
     p_workflow_definition_id, v_actor, v_actor, v_actor)
  RETURNING id INTO v_id;

  INSERT INTO public.ce_waiver_decisions
    (waiver_id, action, to_status, amount, reason, comments, workflow_definition_id, acted_by)
  VALUES (v_id, 'REQUESTED', v_status, p_amount_requested, p_reason_code, p_justification,
          p_workflow_definition_id, v_actor);

  INSERT INTO public.system_audit_trail
    (action, module, entity_type, entity_id, severity, payload_json, user_id, user_name, timestamp)
  VALUES ('ce.waiver.requested','Compliance','waiver', v_id::text,'info',
          jsonb_build_object('amount', p_amount_requested, 'rule_id', p_waiver_rule_id, 'fund', p_fund),
          v_uid, v_actor, now());

  RETURN v_id;
END $$;

-- ---------------- approve ----------------
CREATE OR REPLACE FUNCTION public.ce_approve_waiver_v1(
  p_waiver_id uuid,
  p_approved_amount numeric,
  p_comments text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_wv record;
  v_rule record;
  v_fund text;
  v_cap_amount numeric;
  v_required_role text := 'senior';
  v_capability text;
  v_snapshot jsonb;
  v_case_waived numeric;
BEGIN
  IF v_uid IS NULL THEN
    PERFORM public.ce_waiver_deny(p_waiver_id, NULL, 'CE-WV-401', '{}'::jsonb);
    RAISE EXCEPTION 'CE-WV-401: authentication required' USING ERRCODE='42501';
  END IF;
  IF NOT public.ce_feature_flag_enabled('compliance.payment.waiver_requests') THEN
    PERFORM public.ce_waiver_deny(p_waiver_id, v_uid, 'CE-WV-503', '{}'::jsonb);
    RAISE EXCEPTION 'CE-WV-503: waiver processing is disabled by feature toggle' USING ERRCODE='42501';
  END IF;

  v_actor := left(public.ce_actor_user_code(v_uid),100);

  SELECT * INTO v_wv FROM public.ce_waivers WHERE id = p_waiver_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CE-WV-404: waiver not found' USING ERRCODE='22023'; END IF;

  IF v_wv.status NOT IN ('PENDING','PENDING_APPROVAL') THEN
    PERFORM public.ce_waiver_deny(p_waiver_id, v_uid, 'CE-WV-409-STATE', jsonb_build_object('status', v_wv.status));
    RAISE EXCEPTION 'CE-WV-409: cannot approve a waiver in status %', v_wv.status USING ERRCODE='22023';
  END IF;

  IF p_approved_amount IS NULL OR p_approved_amount < 0 THEN
    RAISE EXCEPTION 'CE-WV-422: approved amount must be zero or greater' USING ERRCODE='22023';
  END IF;
  IF p_approved_amount > COALESCE(v_wv.amount_requested,0) THEN
    PERFORM public.ce_waiver_deny(p_waiver_id, v_uid, 'CE-WV-422-EXCEEDS_REQUEST',
      jsonb_build_object('requested', v_wv.amount_requested, 'attempted', p_approved_amount));
    RAISE EXCEPTION 'CE-WV-422: approved amount cannot exceed the requested amount' USING ERRCODE='22023';
  END IF;

  IF v_wv.waiver_rule_id IS NOT NULL THEN
    SELECT * INTO v_rule FROM public.ce_waiver_rules WHERE id = v_wv.waiver_rule_id;
    IF NOT FOUND OR NOT v_rule.enabled THEN
      PERFORM public.ce_waiver_deny(p_waiver_id, v_uid, 'CE-WV-409-RULE_DISABLED', jsonb_build_object('rule_id', v_wv.waiver_rule_id));
      RAISE EXCEPTION 'CE-WV-409: the configured waiver rule is missing or disabled' USING ERRCODE='22023';
    END IF;

    IF v_rule.waiver_type IS NOT NULL AND v_wv.waiver_type IS NOT NULL
       AND v_rule.waiver_type <> v_wv.waiver_type
       AND v_rule.waiver_type NOT IN ('FULL','PARTIAL') THEN
      PERFORM public.ce_waiver_deny(p_waiver_id, v_uid, 'CE-WV-422-TYPE',
        jsonb_build_object('rule_type', v_rule.waiver_type, 'waiver_type', v_wv.waiver_type));
      RAISE EXCEPTION 'CE-WV-422: waiver type % is not permitted under rule %', v_wv.waiver_type, v_rule.code USING ERRCODE='22023';
    END IF;

    -- permitted reason
    IF array_length(v_rule.valid_reasons,1) > 0
       AND NOT (COALESCE(v_wv.reason_code,'') = ANY (v_rule.valid_reasons)) THEN
      PERFORM public.ce_waiver_deny(p_waiver_id, v_uid, 'CE-WV-422-REASON',
        jsonb_build_object('reason', v_wv.reason_code, 'allowed', v_rule.valid_reasons));
      RAISE EXCEPTION 'CE-WV-422: reason % is not permitted under rule %', v_wv.reason_code, v_rule.code USING ERRCODE='22023';
    END IF;

    -- permitted fund (resolved from the linked violation or case when available)
    IF array_length(v_rule.applicable_funds,1) > 0 THEN
      SELECT COALESCE(
        (SELECT to_jsonb(v)->>'fund_type' FROM public.ce_violations v WHERE v.id = v_wv.violation_id),
        (SELECT to_jsonb(c)->>'fund_type' FROM public.ce_cases c WHERE c.id = v_wv.case_id)
      ) INTO v_fund;
      IF v_fund IS NOT NULL AND NOT (v_fund = ANY (v_rule.applicable_funds)) THEN
        PERFORM public.ce_waiver_deny(p_waiver_id, v_uid, 'CE-WV-422-FUND',
          jsonb_build_object('fund', v_fund, 'allowed', v_rule.applicable_funds));
        RAISE EXCEPTION 'CE-WV-422: fund % is not permitted under rule %', v_fund, v_rule.code USING ERRCODE='22023';
      END IF;
    END IF;

    -- percentage cap
    IF v_rule.max_percentage IS NOT NULL AND COALESCE(v_wv.amount_requested,0) > 0 THEN
      v_cap_amount := (v_wv.amount_requested * v_rule.max_percentage) / 100.0;
      IF p_approved_amount > v_cap_amount + 0.005 THEN
        PERFORM public.ce_waiver_deny(p_waiver_id, v_uid, 'CE-WV-422-CAP',
          jsonb_build_object('cap', v_cap_amount, 'attempted', p_approved_amount, 'max_percentage', v_rule.max_percentage));
        RAISE EXCEPTION 'CE-WV-422: approved amount exceeds the rule cap of %%% (%)', v_rule.max_percentage, round(v_cap_amount,2) USING ERRCODE='22023';
      END IF;
    END IF;

    v_required_role := v_rule.required_approval_role;
    IF v_rule.amount_threshold IS NOT NULL AND p_approved_amount > v_rule.amount_threshold THEN
      v_required_role := v_rule.escalated_approval_role;
    END IF;

    v_snapshot := jsonb_build_object(
      'rule_id', v_rule.id, 'rule_code', v_rule.code, 'rule_name', v_rule.name,
      'max_percentage', v_rule.max_percentage, 'amount_threshold', v_rule.amount_threshold,
      'applicable_funds', v_rule.applicable_funds, 'valid_reasons', v_rule.valid_reasons,
      'required_approval_role', v_rule.required_approval_role,
      'escalated_approval_role', v_rule.escalated_approval_role,
      'rule_updated_at', v_rule.updated_at, 'evaluated_at', now(),
      'resolved_required_role', v_required_role, 'resolved_fund', v_fund);
  ELSE
    -- No rule configured: the highest authority is required.
    v_required_role := 'head';
    v_snapshot := jsonb_build_object('rule_id', NULL, 'resolved_required_role', 'head', 'evaluated_at', now());
  END IF;

  v_capability := public.ce_waiver_role_capability(v_required_role);

  IF NOT public.ce_actor_can(v_uid, v_capability) THEN
    PERFORM public.ce_waiver_deny(p_waiver_id, v_uid, 'CE-WV-403-AUTHORITY',
      jsonb_build_object('required_role', v_required_role, 'required_capability', v_capability,
                         'actor_role', public.ce_compliance_role(v_uid), 'amount', p_approved_amount));
    RAISE EXCEPTION 'CE-WV-403: approval authority "%" is required for this amount', v_required_role USING ERRCODE='42501';
  END IF;

  -- Segregation of duties: a requester cannot approve their own waiver
  IF v_wv.requested_by IS NOT NULL AND v_wv.requested_by = v_actor
     AND NOT public.is_admin(v_uid) THEN
    PERFORM public.ce_waiver_deny(p_waiver_id, v_uid, 'CE-WV-403-SOD', jsonb_build_object('requested_by', v_wv.requested_by));
    RAISE EXCEPTION 'CE-WV-403: the requester cannot approve their own waiver' USING ERRCODE='42501';
  END IF;

  UPDATE public.ce_waivers
     SET status = 'APPROVED', amount_approved = p_approved_amount,
         approver_id = v_actor, approver_user_id = v_uid, approver_decision = 'APPROVED',
         approver_comments = p_comments, approved_at = now(),
         rule_snapshot = v_snapshot,
         decision_context = jsonb_build_object('capability', v_capability, 'actor_role', public.ce_compliance_role(v_uid)),
         updated_by = v_actor, updated_at = now()
   WHERE id = p_waiver_id;

  INSERT INTO public.ce_waiver_decisions
    (waiver_id, action, from_status, to_status, amount, comments, workflow_definition_id, acted_by)
  VALUES (p_waiver_id, 'APPROVED', v_wv.status, 'APPROVED', p_approved_amount, p_comments,
          v_wv.workflow_definition_id, v_actor);

  -- apply to case (never reduces the original amount)
  IF v_wv.case_id IS NOT NULL THEN
    SELECT COALESCE(amount_waived,0) INTO v_case_waived FROM public.ce_cases WHERE id = v_wv.case_id;
    UPDATE public.ce_cases
       SET amount_waived = COALESCE(v_case_waived,0) + p_approved_amount,
           updated_by = v_actor, updated_at = now()
     WHERE id = v_wv.case_id;
  END IF;

  UPDATE public.ce_waivers
     SET status = 'APPLIED', applied_at = now(), updated_by = v_actor, updated_at = now()
   WHERE id = p_waiver_id;

  INSERT INTO public.ce_waiver_decisions
    (waiver_id, action, from_status, to_status, amount, comments, acted_by)
  VALUES (p_waiver_id, 'APPLIED', 'APPROVED', 'APPLIED', p_approved_amount,
          CASE WHEN v_wv.case_id IS NULL THEN 'No linked case'
               ELSE 'Case amount_waived ' || COALESCE(v_case_waived,0) || ' -> ' || (COALESCE(v_case_waived,0) + p_approved_amount) END,
          v_actor);

  INSERT INTO public.system_audit_trail
    (action, module, entity_type, entity_id, severity, after_value, payload_json, user_id, user_name, timestamp)
  VALUES ('ce.waiver.approved','Compliance','waiver', p_waiver_id::text,'info',
          v_snapshot, jsonb_build_object('amount_approved', p_approved_amount, 'capability', v_capability),
          v_uid, v_actor, now());

  RETURN jsonb_build_object('status','APPLIED','amount_approved',p_approved_amount,'rule_snapshot',v_snapshot);
END $$;

-- ---------------- reject / cancel ----------------
CREATE OR REPLACE FUNCTION public.ce_reject_waiver_v1(
  p_waiver_id uuid, p_reason text, p_comments text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_actor text; v_wv record; v_required_role text := 'senior';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'CE-WV-401: authentication required' USING ERRCODE='42501'; END IF;
  v_actor := left(public.ce_actor_user_code(v_uid),100);
  SELECT * INTO v_wv FROM public.ce_waivers WHERE id = p_waiver_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CE-WV-404: waiver not found' USING ERRCODE='22023'; END IF;
  IF v_wv.status NOT IN ('PENDING','PENDING_APPROVAL') THEN
    RAISE EXCEPTION 'CE-WV-409: cannot reject a waiver in status %', v_wv.status USING ERRCODE='22023';
  END IF;
  IF coalesce(trim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'CE-WV-422: rejection reason is required' USING ERRCODE='22023';
  END IF;
  SELECT COALESCE(required_approval_role,'senior') INTO v_required_role
    FROM public.ce_waiver_rules WHERE id = v_wv.waiver_rule_id;
  IF NOT public.ce_actor_can(v_uid, public.ce_waiver_role_capability(COALESCE(v_required_role,'senior'))) THEN
    PERFORM public.ce_waiver_deny(p_waiver_id, v_uid, 'CE-WV-403-AUTHORITY-REJECT', jsonb_build_object('required_role', v_required_role));
    RAISE EXCEPTION 'CE-WV-403: not authorised to decide this waiver' USING ERRCODE='42501';
  END IF;

  UPDATE public.ce_waivers
     SET status='REJECTED', rejected_reason=p_reason, approver_id=v_actor, approver_user_id=v_uid,
         approver_decision='REJECTED', approver_comments=p_comments, approved_at=now(),
         updated_by=v_actor, updated_at=now()
   WHERE id=p_waiver_id;
  INSERT INTO public.ce_waiver_decisions (waiver_id, action, from_status, to_status, amount, reason, comments, acted_by)
  VALUES (p_waiver_id,'REJECTED',v_wv.status,'REJECTED',0,p_reason,p_comments,v_actor);
  INSERT INTO public.system_audit_trail (action, module, entity_type, entity_id, severity, payload_json, user_id, user_name, timestamp)
  VALUES ('ce.waiver.rejected','Compliance','waiver',p_waiver_id::text,'info',
          jsonb_build_object('reason',p_reason), v_uid, v_actor, now());
  RETURN jsonb_build_object('status','REJECTED');
END $$;

CREATE OR REPLACE FUNCTION public.ce_cancel_waiver_v1(
  p_waiver_id uuid, p_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_actor text; v_wv record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'CE-WV-401: authentication required' USING ERRCODE='42501'; END IF;
  v_actor := left(public.ce_actor_user_code(v_uid),100);
  SELECT * INTO v_wv FROM public.ce_waivers WHERE id = p_waiver_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CE-WV-404: waiver not found' USING ERRCODE='22023'; END IF;
  IF v_wv.status NOT IN ('PENDING','PENDING_APPROVAL') THEN
    RAISE EXCEPTION 'CE-WV-409: cannot cancel a waiver in status %', v_wv.status USING ERRCODE='22023';
  END IF;
  IF v_wv.requested_by <> v_actor AND NOT public.ce_actor_can(v_uid,'compliance.waiver.approve') THEN
    RAISE EXCEPTION 'CE-WV-403: only the requester or an approver can cancel this waiver' USING ERRCODE='42501';
  END IF;
  UPDATE public.ce_waivers SET status='CANCELLED', updated_by=v_actor, updated_at=now() WHERE id=p_waiver_id;
  INSERT INTO public.ce_waiver_decisions (waiver_id, action, from_status, to_status, reason, acted_by)
  VALUES (p_waiver_id,'CANCELLED',v_wv.status,'CANCELLED',p_reason,v_actor);
  RETURN jsonb_build_object('status','CANCELLED');
END $$;

-- ---------------- close the direct write path ----------------
REVOKE INSERT, UPDATE, DELETE ON public.ce_waivers FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.ce_waiver_decisions FROM anon, authenticated;
GRANT SELECT ON public.ce_waivers TO anon, authenticated;
GRANT SELECT ON public.ce_waiver_decisions TO anon, authenticated;
GRANT ALL ON public.ce_waivers TO service_role;
GRANT ALL ON public.ce_waiver_decisions TO service_role;

REVOKE EXECUTE ON FUNCTION public.ce_waiver_deny(uuid, uuid, text, jsonb) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.ce_request_waiver_v1(text,text,numeric,text,uuid,uuid,uuid,text,text,text,jsonb,uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.ce_approve_waiver_v1(uuid,numeric,text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.ce_reject_waiver_v1(uuid,text,text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.ce_cancel_waiver_v1(uuid,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ce_request_waiver_v1(text,text,numeric,text,uuid,uuid,uuid,text,text,text,jsonb,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_approve_waiver_v1(uuid,numeric,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_reject_waiver_v1(uuid,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ce_cancel_waiver_v1(uuid,text) TO authenticated, service_role;
