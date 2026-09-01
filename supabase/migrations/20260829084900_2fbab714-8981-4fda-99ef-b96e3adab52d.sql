-- ============================================================
-- B1-C1 / B1-C2 / B1-C4 corrections
-- ============================================================

-- 1. Remove grace-extension semantics entirely -----------------
DROP FUNCTION IF EXISTS public.ce_approve_partial_payment_v1(uuid, numeric, jsonb, integer, text, integer);

ALTER TABLE public.ce_partial_payment_policies
  DROP CONSTRAINT IF EXISTS ce_pp_policies_days_chk;
ALTER TABLE public.ce_partial_payment_policies
  DROP COLUMN IF EXISTS extends_payment_grace,
  DROP COLUMN IF EXISTS max_grace_extension_days;
ALTER TABLE public.ce_partial_payment_policies
  ADD CONSTRAINT ce_pp_policies_days_chk CHECK (authority_validity_days > 0);

ALTER TABLE public.ce_partial_payment_requests
  DROP COLUMN IF EXISTS grace_extension_days,
  DROP COLUMN IF EXISTS grace_extended_to;

-- 2. Capability model -----------------------------------------
CREATE OR REPLACE FUNCTION public.ce_actor_can(_user_id uuid, _capability text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_caps text[];
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  IF public.is_admin(_user_id) THEN RETURN true; END IF;

  v_role := public.ce_compliance_role(_user_id);

  v_caps := CASE v_role
    WHEN 'head' THEN ARRAY[
      'compliance.field.execute','compliance.field.plan','compliance.field.approve_plans',
      'compliance.field.report','compliance.field.approve_reports','compliance.field.sampling',
      'compliance.violations.manage','compliance.violations.link_to_case',
      'compliance.cases.manage','compliance.cases.approve_requests',
      'compliance.cases.view_confidential_documents','compliance.inspections.view_employer_history',
      'compliance.enforcement.notices','compliance.enforcement.arrangements',
      'compliance.enforcement.legal','compliance.workbench.team','compliance.workbench.enterprise',
      'compliance.reports.operational','compliance.reports.analytics',
      'compliance.config.manage','compliance.schedule.manage',
      'compliance.waiver.approve','compliance.waiver.approve_high',
      'compliance.legal.override','compliance.workflow.override',
      'compliance.partial_payment.request','compliance.partial_payment.approve']
    WHEN 'senior' THEN ARRAY[
      'compliance.field.execute','compliance.field.plan','compliance.field.approve_plans',
      'compliance.field.report','compliance.field.approve_reports','compliance.field.sampling',
      'compliance.violations.manage','compliance.violations.link_to_case',
      'compliance.cases.manage','compliance.inspections.view_employer_history',
      'compliance.enforcement.notices','compliance.enforcement.arrangements',
      'compliance.enforcement.legal','compliance.workbench.team','compliance.reports.operational',
      'compliance.waiver.approve',
      'compliance.partial_payment.request','compliance.partial_payment.approve']
    WHEN 'inspector' THEN ARRAY[
      'compliance.field.execute','compliance.field.plan','compliance.field.report',
      'compliance.violations.manage','compliance.cases.manage',
      'compliance.enforcement.notices','compliance.reports.operational',
      'compliance.partial_payment.request']
    ELSE ARRAY[]::text[]
  END;

  IF _capability = ANY (v_caps) THEN RETURN true; END IF;

  -- Governance capabilities never fall back to the legacy blanket permission.
  IF _capability IN ('compliance.config.manage','compliance.schedule.manage',
                     'compliance.waiver.approve_high','compliance.legal.override',
                     'compliance.workflow.override','compliance.partial_payment.approve') THEN
    RETURN false;
  END IF;

  -- Cashier-assisted path: counter staff who can raise payments may raise a
  -- partial payment request on the employer's behalf, but can never approve it.
  IF _capability = 'compliance.partial_payment.request' THEN
    RETURN public.has_permission(_user_id, 'c3_payments', 'create')
        OR public.has_permission(_user_id, 'c3_payments', 'edit');
  END IF;

  IF _capability = 'compliance.waiver.approve' THEN
    RETURN public.has_permission(_user_id, 'manage_compliance', 'approve');
  END IF;

  RETURN public.has_permission(_user_id, 'manage_compliance',
           CASE WHEN _capability LIKE '%.approve%' THEN 'approve' ELSE 'edit' END);
END;
$function$;

-- 3. Request RPC uses the dedicated request capability ---------
CREATE OR REPLACE FUNCTION public.ce_request_partial_payment_v1(p_employer_id text, p_wage_period date, p_requested_amount numeric, p_justification text, p_allocations jsonb DEFAULT '[]'::jsonb, p_source text DEFAULT 'EMPLOYER'::text, p_reason_code text DEFAULT NULL::text, p_obligation_type text DEFAULT 'CONTRIBUTION_PAYMENT'::text, p_supporting_documents jsonb DEFAULT '[]'::jsonb, p_case_id uuid DEFAULT NULL::uuid, p_violation_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_policy public.ce_partial_payment_policies;
  v_liab jsonb;
  v_total numeric;
  v_alloc jsonb;
  v_sum numeric := 0;
  v_id uuid;
  v_oblig record;
  v_arr record;
  v_employer_name text;
  el jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-PP-401: authentication required' USING ERRCODE='42501';
  END IF;
  IF NOT public.ce_feature_flag_enabled('compliance.payment.partial_payment') THEN
    RAISE EXCEPTION 'CE-PP-503: partial payment requests are disabled by feature toggle' USING ERRCODE='42501';
  END IF;
  IF NOT public.ce_actor_can(v_uid, 'compliance.partial_payment.request') THEN
    PERFORM public.ce_pp_deny(NULL, v_uid, 'CE-PP-403-REQUEST', jsonb_build_object('employer', p_employer_id));
    RAISE EXCEPTION 'CE-PP-403: not authorised to raise partial payment requests' USING ERRCODE='42501';
  END IF;
  IF coalesce(p_source,'') NOT IN ('EMPLOYER','CASHIER','COMPLIANCE') THEN
    RAISE EXCEPTION 'CE-PP-422: invalid request source %', p_source USING ERRCODE='22023';
  END IF;
  IF coalesce(trim(p_justification),'') = '' THEN
    RAISE EXCEPTION 'CE-PP-422: a reason for the partial payment is required' USING ERRCODE='22023';
  END IF;
  IF coalesce(p_requested_amount,0) <= 0 THEN
    RAISE EXCEPTION 'CE-PP-422: the offered amount must be greater than zero' USING ERRCODE='22023';
  END IF;

  v_actor := left(public.ce_actor_user_code(v_uid),100);
  v_policy := public.ce_pp_active_policy('DEFAULT');
  IF v_policy.id IS NULL THEN
    RAISE EXCEPTION 'CE-PP-500: no active partial payment policy is configured' USING ERRCODE='22023';
  END IF;

  v_liab := public.ce_pp_liability(p_employer_id, p_wage_period, p_obligation_type);
  v_total := coalesce((v_liab->>'total_outstanding')::numeric, 0);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'CE-PP-409: no outstanding liability for % period %', p_employer_id, to_char(p_wage_period,'YYYY-MM')
      USING ERRCODE='22023';
  END IF;
  IF p_requested_amount > v_total THEN
    RAISE EXCEPTION 'CE-PP-422: the offered amount exceeds the outstanding liability of %', v_total USING ERRCODE='22023';
  END IF;
  IF p_requested_amount >= v_total THEN
    RAISE EXCEPTION 'CE-PP-422: a full settlement should be posted directly, not as a partial payment' USING ERRCODE='22023';
  END IF;
  IF v_policy.minimum_acceptable_amount > 0 AND p_requested_amount < v_policy.minimum_acceptable_amount THEN
    RAISE EXCEPTION 'CE-PP-422: the offered amount is below the configured minimum of %', v_policy.minimum_acceptable_amount
      USING ERRCODE='22023';
  END IF;
  IF v_policy.minimum_acceptable_percent > 0
     AND (p_requested_amount / v_total) * 100 < v_policy.minimum_acceptable_percent THEN
    RAISE EXCEPTION 'CE-PP-422: the offered amount is below the configured minimum of %%% of the liability',
      v_policy.minimum_acceptable_percent USING ERRCODE='22023';
  END IF;

  IF v_policy.block_when_arrangement_active THEN
    SELECT * INTO v_arr FROM public.ce_payment_arrangements
     WHERE employer_id = p_employer_id AND upper(coalesce(status,'')) IN ('ACTIVE','APPROVED')
     LIMIT 1;
    IF FOUND THEN
      PERFORM public.ce_pp_deny(NULL, v_uid, 'CE-PP-409-ARRANGEMENT',
        jsonb_build_object('arrangement', v_arr.arrangement_number));
      RAISE EXCEPTION 'CE-PP-409: employer has an active payment arrangement (%); vary the arrangement instead',
        v_arr.arrangement_number USING ERRCODE='22023';
    END IF;
  END IF;

  v_alloc := coalesce(p_allocations,'[]'::jsonb);
  IF jsonb_array_length(v_alloc) = 0 THEN
    v_alloc := public.ce_pp_default_allocation(v_liab, p_requested_amount, v_policy.allocation_order);
  END IF;

  FOR el IN SELECT jsonb_array_elements(v_alloc) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.tb_payment_type t WHERE t.payment_code = el->>'payment_code') THEN
      RAISE EXCEPTION 'CE-PP-422: unknown payment category %', el->>'payment_code' USING ERRCODE='22023';
    END IF;
    v_sum := v_sum + coalesce((el->>'amount')::numeric, (el->>'requested_amount')::numeric, 0);
  END LOOP;
  IF round(v_sum,2) <> round(p_requested_amount,2) THEN
    RAISE EXCEPTION 'CE-PP-422: the allocation total (%) does not equal the offered amount (%)', v_sum, p_requested_amount
      USING ERRCODE='22023';
  END IF;

  SELECT id, employer_name INTO v_oblig FROM public.ce_obligation_periods
   WHERE employer_id = p_employer_id AND wage_period = p_wage_period AND obligation_type = p_obligation_type
   ORDER BY updated_at DESC LIMIT 1;
  v_employer_name := v_oblig.employer_name;

  BEGIN
    INSERT INTO public.ce_partial_payment_requests
      (request_number, employer_id, employer_name, obligation_period_id, wage_period, obligation_type,
       source, status, policy_id, policy_snapshot, total_liability, requested_amount,
       reason_code, justification, supporting_documents, case_id, violation_id,
       requested_by, requested_by_user_id)
    VALUES
      ('PP-' || to_char(now(),'YYMMDD') || '-' || lpad((floor(random()*100000))::text,5,'0'),
       p_employer_id, v_employer_name, v_oblig.id, p_wage_period, p_obligation_type,
       p_source, 'PENDING_APPROVAL', v_policy.id, to_jsonb(v_policy), round(v_total,2), round(p_requested_amount,2),
       p_reason_code, p_justification, coalesce(p_supporting_documents,'[]'::jsonb), p_case_id, p_violation_id,
       v_actor, v_uid)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'CE-PP-409: an open partial payment request already exists for % period %',
      p_employer_id, to_char(p_wage_period,'YYYY-MM') USING ERRCODE='22023';
  END;

  INSERT INTO public.ce_partial_payment_allocations
    (request_id, payment_code, fund_code, bucket_label, outstanding_amount, requested_amount, allocation_sequence)
  SELECT v_id,
         e->>'payment_code',
         coalesce(e->>'fund_code', (SELECT fund_code FROM public.tb_payment_type t WHERE t.payment_code = e->>'payment_code')),
         coalesce(e->>'bucket_label', (SELECT payment_type_description FROM public.tb_payment_type t WHERE t.payment_code = e->>'payment_code')),
         coalesce((e->>'outstanding_amount')::numeric,0),
         coalesce((e->>'amount')::numeric, (e->>'requested_amount')::numeric, 0),
         ord
    FROM jsonb_array_elements(v_alloc) WITH ORDINALITY AS x(e, ord);

  INSERT INTO public.ce_partial_payment_events
    (request_id, action, to_status, amount, allocation_snapshot, reason, comments, acted_by, acted_by_user_id)
  VALUES (v_id, 'REQUESTED', 'PENDING_APPROVAL', p_requested_amount, v_alloc, p_reason_code, p_justification, v_actor, v_uid);

  INSERT INTO public.system_audit_trail
    (action, module, entity_type, entity_id, severity, payload_json, user_id, user_name, timestamp)
  VALUES ('ce.partial_payment.requested','Compliance','partial_payment', v_id::text,'info',
          jsonb_build_object('employer', p_employer_id, 'period', to_char(p_wage_period,'YYYY-MM'),
                             'requested', p_requested_amount, 'liability', v_total, 'source', p_source),
          v_uid, v_actor, now());

  RETURN v_id;
END $function$;

-- 4. Approval RPC: payment authority only, no deadline change ---
CREATE OR REPLACE FUNCTION public.ce_approve_partial_payment_v1(p_request_id uuid, p_approved_amount numeric, p_allocations jsonb DEFAULT NULL::jsonb, p_comments text DEFAULT NULL::text, p_expected_version integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_req public.ce_partial_payment_requests;
  v_policy public.ce_partial_payment_policies;
  v_required_role text;
  v_alloc jsonb;
  v_sum numeric := 0;
  v_expires date;
  v_inv_id integer;
  v_inv_no text;
  el jsonb;
BEGIN
  IF v_uid IS NULL THEN
    PERFORM public.ce_pp_deny(p_request_id, NULL, 'CE-PP-401', '{}'::jsonb);
    RAISE EXCEPTION 'CE-PP-401: authentication required' USING ERRCODE='42501';
  END IF;
  IF NOT public.ce_feature_flag_enabled('compliance.payment.partial_payment') THEN
    PERFORM public.ce_pp_deny(p_request_id, v_uid, 'CE-PP-503', '{}'::jsonb);
    RAISE EXCEPTION 'CE-PP-503: partial payment processing is disabled by feature toggle' USING ERRCODE='42501';
  END IF;
  IF NOT public.ce_actor_can(v_uid, 'compliance.partial_payment.approve') THEN
    PERFORM public.ce_pp_deny(p_request_id, v_uid, 'CE-PP-403-CAPABILITY', '{}'::jsonb);
    RAISE EXCEPTION 'CE-PP-403: not authorised to approve partial payment requests' USING ERRCODE='42501';
  END IF;

  v_actor := left(public.ce_actor_user_code(v_uid),100);

  SELECT * INTO v_req FROM public.ce_partial_payment_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CE-PP-404: request not found' USING ERRCODE='22023'; END IF;
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_req.row_version THEN
    RAISE EXCEPTION 'CE-PP-409: the request was changed by another user — reload and try again' USING ERRCODE='22023';
  END IF;
  IF v_req.status <> 'PENDING_APPROVAL' THEN
    PERFORM public.ce_pp_deny(p_request_id, v_uid, 'CE-PP-409-STATE', jsonb_build_object('status', v_req.status));
    RAISE EXCEPTION 'CE-PP-409: cannot approve a request in status %', v_req.status USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_policy FROM public.ce_partial_payment_policies WHERE id = v_req.policy_id;
  IF NOT FOUND THEN
    v_policy := public.ce_pp_active_policy('DEFAULT');
  END IF;

  IF coalesce(p_approved_amount,0) <= 0 THEN
    RAISE EXCEPTION 'CE-PP-422: the approved amount must be greater than zero' USING ERRCODE='22023';
  END IF;
  IF p_approved_amount > v_req.requested_amount THEN
    PERFORM public.ce_pp_deny(p_request_id, v_uid, 'CE-PP-422-EXCEEDS_REQUEST',
      jsonb_build_object('requested', v_req.requested_amount, 'attempted', p_approved_amount));
    RAISE EXCEPTION 'CE-PP-422: the approved amount cannot exceed the amount offered' USING ERRCODE='22023';
  END IF;
  IF p_approved_amount > v_req.total_liability THEN
    RAISE EXCEPTION 'CE-PP-422: the approved amount cannot exceed the outstanding liability' USING ERRCODE='22023';
  END IF;

  IF coalesce(v_policy.require_separate_approver, true)
     AND v_req.requested_by_user_id IS NOT NULL AND v_req.requested_by_user_id = v_uid THEN
    PERFORM public.ce_pp_deny(p_request_id, v_uid, 'CE-PP-403-SOD', '{}'::jsonb);
    RAISE EXCEPTION 'CE-PP-403: the officer who raised the request cannot approve it' USING ERRCODE='42501';
  END IF;

  v_required_role := coalesce(v_policy.required_approval_role,'senior');
  IF v_policy.escalation_threshold_amount IS NOT NULL
     AND p_approved_amount >= v_policy.escalation_threshold_amount THEN
    v_required_role := coalesce(v_policy.escalated_approval_role,'head');
  END IF;
  IF NOT public.ce_pp_can_approve(v_uid, v_required_role) THEN
    PERFORM public.ce_pp_deny(p_request_id, v_uid, 'CE-PP-403-AUTHORITY',
      jsonb_build_object('required_role', v_required_role, 'amount', p_approved_amount));
    RAISE EXCEPTION 'CE-PP-403: approving % requires the % authority', p_approved_amount, v_required_role
      USING ERRCODE='42501';
  END IF;

  IF p_allocations IS NOT NULL AND jsonb_array_length(p_allocations) > 0 THEN
    IF coalesce(v_policy.allow_allocation_override, true) = false THEN
      RAISE EXCEPTION 'CE-PP-409: the active policy does not allow the allocation to be changed' USING ERRCODE='22023';
    END IF;
    v_alloc := p_allocations;
  ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'payment_code', payment_code, 'fund_code', fund_code, 'bucket_label', bucket_label,
             'outstanding_amount', outstanding_amount,
             'amount', coalesce(approved_amount, requested_amount)) ORDER BY allocation_sequence), '[]'::jsonb)
      INTO v_alloc FROM public.ce_partial_payment_allocations WHERE request_id = p_request_id;
  END IF;

  FOR el IN SELECT jsonb_array_elements(v_alloc) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.tb_payment_type t WHERE t.payment_code = el->>'payment_code') THEN
      RAISE EXCEPTION 'CE-PP-422: unknown payment category %', el->>'payment_code' USING ERRCODE='22023';
    END IF;
    v_sum := v_sum + coalesce((el->>'amount')::numeric,0);
  END LOOP;
  IF round(v_sum,2) <> round(p_approved_amount,2) THEN
    RAISE EXCEPTION 'CE-PP-422: the approved allocation total (%) does not equal the approved amount (%)',
      v_sum, p_approved_amount USING ERRCODE='22023';
  END IF;

  -- The authority window governs how long the money may be accepted at the
  -- counter. It NEVER changes the statutory payment deadline.
  v_expires := (current_date + coalesce(v_policy.authority_validity_days,14))::date;

  v_inv_id := nextval('tb_invoices_id_seq');
  v_inv_no := 'PPA-' || to_char(now(),'YYMMDD') || '-' || v_inv_id::text;
  INSERT INTO public.cn_invoices
    (id, invoice_number, invoice_type, payment_source, payer_type, payer_id, payer_name,
     currency_code, exchange_rate, total_amount, total_amount_base, due_date, status,
     public_notes, internal_notes, created_by, updated_by)
  VALUES
    (v_inv_id, v_inv_no, 'PPA', 'CON', 'ER', v_req.employer_id, v_req.employer_name,
     'XCD', 1, round(p_approved_amount,2), round(p_approved_amount,2), v_expires, 'O',
     'Approved partial payment authority for wage period ' || to_char(v_req.wage_period,'YYYY-MM')
       || ' — statutory deadline and penalties are unaffected',
     coalesce(p_comments,''), v_actor, v_actor);

  INSERT INTO public.cn_invoice_lines (invoice_id, payment_code, currency_code, amount, exchange_rate, amount_base, sort_order, base_currency)
  SELECT v_inv_id, e->>'payment_code', 'XCD', round((e->>'amount')::numeric,2), 1, round((e->>'amount')::numeric,2), ord, 'XCD'
    FROM jsonb_array_elements(v_alloc) WITH ORDINALITY AS x(e, ord);

  DELETE FROM public.ce_partial_payment_allocations WHERE request_id = p_request_id;
  INSERT INTO public.ce_partial_payment_allocations
    (request_id, payment_code, fund_code, bucket_label, outstanding_amount, requested_amount, approved_amount, allocation_sequence)
  SELECT p_request_id, e->>'payment_code',
         coalesce(e->>'fund_code', (SELECT fund_code FROM public.tb_payment_type t WHERE t.payment_code = e->>'payment_code')),
         coalesce(e->>'bucket_label', (SELECT payment_type_description FROM public.tb_payment_type t WHERE t.payment_code = e->>'payment_code')),
         coalesce((e->>'outstanding_amount')::numeric,0),
         coalesce((e->>'amount')::numeric,0),
         coalesce((e->>'amount')::numeric,0),
         ord
    FROM jsonb_array_elements(v_alloc) WITH ORDINALITY AS x(e, ord);

  UPDATE public.ce_partial_payment_requests
     SET status = 'APPROVED',
         approved_amount = round(p_approved_amount,2),
         authority_invoice_id = v_inv_id,
         authority_number = v_inv_no,
         authority_issued_at = now(),
         authority_expires_on = v_expires,
         decided_by = v_actor,
         decided_by_user_id = v_uid,
         decided_at = now(),
         decision_comments = p_comments,
         decision_context = jsonb_build_object('required_role', v_required_role, 'policy_id', v_policy.id,
                                               'extends_statutory_deadline', false),
         row_version = row_version + 1,
         updated_at = now()
   WHERE id = p_request_id;

  INSERT INTO public.ce_partial_payment_events
    (request_id, action, from_status, to_status, amount, allocation_snapshot, comments, acted_by, acted_by_user_id)
  VALUES (p_request_id, 'APPROVED', 'PENDING_APPROVAL', 'APPROVED', p_approved_amount, v_alloc, p_comments, v_actor, v_uid);

  INSERT INTO public.system_audit_trail
    (action, module, entity_type, entity_id, severity, payload_json, user_id, user_name, timestamp)
  VALUES ('ce.partial_payment.approved','Compliance','partial_payment', p_request_id::text,'info',
          jsonb_build_object('approved', p_approved_amount, 'authority', v_inv_no,
                             'expires_on', v_expires, 'required_role', v_required_role,
                             'extends_statutory_deadline', false),
          v_uid, v_actor, now());

  RETURN jsonb_build_object(
    'request_id', p_request_id, 'status','APPROVED', 'approved_amount', round(p_approved_amount,2),
    'authority_number', v_inv_no, 'authority_invoice_id', v_inv_id,
    'authority_expires_on', v_expires, 'extends_statutory_deadline', false);
END $function$;

-- 5. Permission registry --------------------------------------
INSERT INTO public.core_permission_registry
  (permission_key, permission_name, description, module_code, domain_code, permission_scope,
   resource_type, resource_code, action_code, is_sensitive_permission, risk_level, source_file)
VALUES
  ('compliance.partial_payment.request','Raise partial payment request',
   'Raise a partial payment request on behalf of an employer (self-service or cashier-assisted). Does not authorise acceptance of money.',
   'COMPLIANCE','PAYMENTS','ACTION','partial_payment','ce_partial_payment_requests','request',
   true,'MEDIUM','supabase/migrations'),
  ('compliance.partial_payment.approve','Approve partial payment request',
   'Approve a partial payment request and issue the payment authority. Financial authorisation; never granted by the legacy blanket compliance permission.',
   'COMPLIANCE','PAYMENTS','ACTION','partial_payment','ce_partial_payment_requests','approve',
   true,'HIGH','supabase/migrations')
ON CONFLICT (permission_key) DO UPDATE
  SET permission_name = EXCLUDED.permission_name,
      description = EXCLUDED.description,
      is_sensitive_permission = EXCLUDED.is_sensitive_permission,
      risk_level = EXCLUDED.risk_level,
      updated_at = now();