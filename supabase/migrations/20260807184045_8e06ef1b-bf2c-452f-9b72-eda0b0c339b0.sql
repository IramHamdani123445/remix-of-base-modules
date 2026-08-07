-- Epic 13: Means-Test operational queues and reporting

CREATE OR REPLACE FUNCTION public._bn_means_status_label(p_status text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE p_status
    WHEN 'DRAFT' THEN 'Draft'
    WHEN 'INCOMPLETE' THEN 'Incomplete'
    WHEN 'INFORMATION_PENDING' THEN 'Awaiting information'
    WHEN 'SUBMITTED' THEN 'Submitted'
    WHEN 'VERIFICATION_PENDING' THEN 'Awaiting verification'
    WHEN 'FAILED_VERIFICATION' THEN 'Verification failed'
    WHEN 'CALCULATED' THEN 'Calculated — pending approval'
    WHEN 'REVIEW_PENDING' THEN 'Returned to review'
    WHEN 'APPROVAL_PENDING' THEN 'Approval pending'
    WHEN 'APPROVED' THEN 'Approved — not yet active'
    WHEN 'ACTIVE' THEN 'Active'
    WHEN 'REASSESSMENT_DUE' THEN 'Reassessment due'
    WHEN 'EXPIRED' THEN 'Expired'
    WHEN 'SUPERSEDED' THEN 'Superseded'
    WHEN 'CLOSED' THEN 'Closed'
    WHEN 'REJECTED' THEN 'Rejected'
    WHEN 'CANCELLED' THEN 'Cancelled'
    WHEN 'UNDER_APPEAL' THEN 'Under appeal'
    ELSE initcap(replace(COALESCE(p_status,'Unknown'),'_',' '))
  END
$$;

CREATE OR REPLACE FUNCTION public._bn_means_ops_action(p_status text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE p_status
    WHEN 'DRAFT' THEN 'Complete assessment information'
    WHEN 'INCOMPLETE' THEN 'Complete outstanding sections'
    WHEN 'INFORMATION_PENDING' THEN 'Chase or record requested information'
    WHEN 'SUBMITTED' THEN 'Verify submitted facts'
    WHEN 'VERIFICATION_PENDING' THEN 'Verify submitted facts'
    WHEN 'FAILED_VERIFICATION' THEN 'Review failed verification'
    WHEN 'CALCULATED' THEN 'Approve assessment'
    WHEN 'REVIEW_PENDING' THEN 'Rework returned assessment'
    WHEN 'APPROVAL_PENDING' THEN 'Approve assessment'
    WHEN 'APPROVED' THEN 'Activate assessment'
    WHEN 'REASSESSMENT_DUE' THEN 'Start reassessment'
    WHEN 'EXPIRED' THEN 'Start reassessment'
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public._bn_means_ops_section(p_status text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE p_status
    WHEN 'DRAFT' THEN 'household'
    WHEN 'INCOMPLETE' THEN 'household'
    WHEN 'INFORMATION_PENDING' THEN 'evidence'
    WHEN 'SUBMITTED' THEN 'verification'
    WHEN 'VERIFICATION_PENDING' THEN 'verification'
    WHEN 'FAILED_VERIFICATION' THEN 'verification'
    WHEN 'CALCULATED' THEN 'decision'
    WHEN 'REVIEW_PENDING' THEN 'decision'
    WHEN 'APPROVAL_PENDING' THEN 'decision'
    WHEN 'APPROVED' THEN 'activation'
    WHEN 'ACTIVE' THEN 'lifecycle'
    WHEN 'REASSESSMENT_DUE' THEN 'lifecycle'
    WHEN 'EXPIRED' THEN 'lifecycle'
    ELSE 'overview'
  END
$$;

CREATE OR REPLACE FUNCTION public.bn_means_operational_queue_v1(
  p_actor_user_id uuid,
  p_queue_code text,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_sort text DEFAULT 'OLDEST'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_perm jsonb;
  v_f jsonb := COALESCE(p_filters, '{}'::jsonb);
  v_rows jsonb := '[]'::jsonb;
  v_total int := 0;
  v_limit int := GREATEST(LEAST(COALESCE(p_limit, 25), 200), 1);
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_sort text := COALESCE(NULLIF(p_sort, ''), 'OLDEST');
  v_search text := NULLIF(v_f->>'search', '');
  v_prog text := NULLIF(v_f->>'benefit_programme', '');
  v_status text := NULLIF(v_f->>'status', '');
  v_result text := NULLIF(v_f->>'result', '');
  v_reason text := NULLIF(v_f->>'assessment_reason', '');
  v_assigned text := NULLIF(v_f->>'assigned_to', '');
  v_assigned_uuid uuid;
  v_created_from date := NULLIF(v_f->>'created_from','')::date;
  v_created_to date := NULLIF(v_f->>'created_to','')::date;
  v_eff_from date := NULLIF(v_f->>'effective_from','')::date;
  v_eff_to date := NULLIF(v_f->>'effective_to','')::date;
  v_due_before date := NULLIF(v_f->>'reassessment_due_before','')::date;
  v_retryable text := NULLIF(v_f->>'retryable','');
  v_family text;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('status','DENIED','code', COALESCE(v_perm->>'code','FORBIDDEN'),'data', NULL);
  END IF;

  IF p_queue_code IS NULL OR p_queue_code NOT IN (
    'MY_WORK','TEAM_WORK','DRAFTS_IN_PROGRESS','AWAITING_INFORMATION',
    'INFORMATION_REQUEST_OPEN','INFORMATION_REQUEST_DUE_SOON','INFORMATION_REQUEST_OVERDUE',
    'INFORMATION_RESPONSE_RECEIVED','AWAITING_VERIFICATION','VERIFICATION_CLARIFICATION',
    'VERIFICATION_FAILED','ADJUSTMENTS_AWAITING_DECISION','ADJUSTMENTS_AWAITING_RECALCULATION',
    'ASSESSMENTS_AWAITING_APPROVAL','APPROVED_NOT_ACTIVE','ACTIVATION_INTEGRATION_PENDING',
    'ACTIVATION_INTEGRATION_FAILED','REASSESSMENT_DUE_SOON','REASSESSMENT_DUE','REASSESSMENT_OVERDUE',
    'SUCCESSOR_IN_PROGRESS','RETURNED_TO_REVIEW','REJECTED','CLOSED_OR_SUPERSEDED','SEARCH'
  ) THEN
    RETURN jsonb_build_object('status','INVALID','code','QUEUE_UNKNOWN','data', NULL);
  END IF;

  IF v_assigned = 'ME' THEN
    v_assigned_uuid := p_actor_user_id;
  ELSIF v_assigned IS NOT NULL THEN
    BEGIN v_assigned_uuid := v_assigned::uuid; EXCEPTION WHEN others THEN v_assigned_uuid := NULL; END;
  END IF;

  v_family := CASE
    WHEN p_queue_code LIKE 'INFORMATION_%' THEN 'INFO'
    WHEN p_queue_code LIKE 'ACTIVATION_INTEGRATION%' THEN 'INTEGRATION'
    ELSE 'ASSESSMENT' END;

  IF v_family = 'INFO' THEN
    WITH scoped AS (
      SELECT ir.*, a.assessment_reference, a.benefit_programme, a.status AS assessment_status,
             a.person_id, a.declared_person, a.assigned_to
        FROM public.bn_means_information_request ir
        JOIN public.bn_means_assessment a ON a.assessment_id = ir.assessment_id
       WHERE (
         (p_queue_code = 'INFORMATION_REQUEST_OPEN' AND ir.status IN ('OPEN','PARTIALLY_RECEIVED'))
         OR (p_queue_code = 'INFORMATION_REQUEST_DUE_SOON' AND ir.status IN ('OPEN','PARTIALLY_RECEIVED')
             AND ir.due_date IS NOT NULL AND ir.due_date >= CURRENT_DATE AND ir.due_date <= CURRENT_DATE + 5)
         OR (p_queue_code = 'INFORMATION_REQUEST_OVERDUE' AND ir.status IN ('OPEN','PARTIALLY_RECEIVED')
             AND ir.due_date IS NOT NULL AND ir.due_date < CURRENT_DATE)
         OR (p_queue_code = 'INFORMATION_RESPONSE_RECEIVED' AND ir.status IN ('RESPONDED','RESPONSE_RECEIVED','PARTIALLY_RECEIVED'))
       )
         AND (v_prog IS NULL OR a.benefit_programme = v_prog)
         AND (v_assigned_uuid IS NULL OR a.assigned_to = v_assigned_uuid)
         AND (v_search IS NULL OR a.assessment_reference ILIKE '%'||v_search||'%'
              OR COALESCE(ir.request_reference,'') ILIKE '%'||v_search||'%'
              OR COALESCE(a.declared_person->>'full_name','') ILIKE '%'||v_search||'%')
    ), page AS (
      SELECT * FROM scoped
       ORDER BY
         CASE WHEN v_sort = 'DUE_SOONEST' THEN COALESCE(due_date, DATE '9999-12-31') END ASC NULLS LAST,
         CASE WHEN v_sort = 'NEWEST' THEN requested_at END DESC NULLS LAST,
         CASE WHEN v_sort NOT IN ('DUE_SOONEST','NEWEST') THEN requested_at END ASC NULLS LAST
       LIMIT v_limit OFFSET v_offset
    )
    SELECT (SELECT count(*) FROM scoped),
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
             'row_kind','INFORMATION_REQUEST',
             'record_id', p.request_id,
             'record_reference', p.request_reference,
             'queue_code', p_queue_code,
             'assessment_id', p.assessment_id,
             'assessment_reference', p.assessment_reference,
             'person_label', COALESCE(p.declared_person->>'full_name','Claimant'),
             'person_masked_identifier', public._bn_means_mask_ssn(p.declared_person->>'ssn'),
             'benefit_programme', p.benefit_programme,
             'assessment_status', p.assessment_status,
             'status_label', public._bn_means_status_label(p.assessment_status),
             'request_type', p.request_type,
             'requirement_code', p.requirement_code,
             'information_required', p.information_required,
             'request_status', p.status,
             'request_status_label', initcap(replace(COALESCE(p.status,''),'_',' ')),
             'origin_stage', p.origin_stage,
             'requested_at', p.requested_at,
             'due_date', p.due_date,
             'responded_at', p.responded_at,
             'age_days', GREATEST(0, (EXTRACT(EPOCH FROM (now() - p.requested_at))/86400)::int),
             'days_overdue', CASE WHEN p.due_date IS NOT NULL AND p.due_date < CURRENT_DATE
                                    AND p.status IN ('OPEN','PARTIALLY_RECEIVED')
                                  THEN (CURRENT_DATE - p.due_date) ELSE NULL END,
             'communication_status', (SELECT ci.status FROM public.bn_means_communication_intent ci
                                       WHERE ci.assessment_id = p.assessment_id
                                       ORDER BY ci.created_at DESC LIMIT 1),
             'action_required', CASE WHEN p.status IN ('RESPONDED','RESPONSE_RECEIVED')
                                     THEN 'Review information response'
                                     ELSE 'Obtain outstanding information' END,
             'deep_link_section','evidence',
             'assigned_to', p.assigned_to,
             'is_mine', (p.assigned_to = p_actor_user_id)
           ) ORDER BY p.requested_at) FROM page p), '[]'::jsonb)
      INTO v_total, v_rows;

  ELSIF v_family = 'INTEGRATION' THEN
    WITH scoped AS (
      SELECT fp.*, a.assessment_reference, a.benefit_programme, a.status AS assessment_status,
             a.declared_person, a.assigned_to
        FROM public.bn_means_fact_publication fp
        JOIN public.bn_means_assessment a ON a.assessment_id = fp.assessment_id
       WHERE (
         (p_queue_code = 'ACTIVATION_INTEGRATION_FAILED'
           AND (fp.failure_code IS NOT NULL
                OR fp.status IN ('FAILED','REFUSED')
                OR fp.eligibility_status IN ('FAILED','ERROR')
                OR fp.determination_status = 'FAILED'))
         OR (p_queue_code = 'ACTIVATION_INTEGRATION_PENDING'
           AND fp.failure_code IS NULL
           AND COALESCE(fp.determination_status,'') <> 'COMPLETED'
           AND (fp.status IN ('PENDING','PUBLISHED','IN_PROGRESS')
                OR fp.eligibility_status IN ('REQUESTED','PENDING','IN_PROGRESS')))
       )
         AND (v_prog IS NULL OR a.benefit_programme = v_prog)
         AND (v_assigned_uuid IS NULL OR a.assigned_to = v_assigned_uuid)
         AND (v_retryable IS NULL OR
              (v_retryable = 'true') = (fp.failure_code IS NOT NULL AND COALESCE(fp.retry_count,0) < 5))
         AND (v_search IS NULL OR a.assessment_reference ILIKE '%'||v_search||'%'
              OR COALESCE(fp.publication_reference,'') ILIKE '%'||v_search||'%'
              OR COALESCE(a.declared_person->>'full_name','') ILIKE '%'||v_search||'%')
    ), page AS (
      SELECT * FROM scoped
       ORDER BY CASE WHEN v_sort = 'NEWEST' THEN created_at END DESC NULLS LAST,
                CASE WHEN v_sort <> 'NEWEST' THEN created_at END ASC NULLS LAST
       LIMIT v_limit OFFSET v_offset
    )
    SELECT (SELECT count(*) FROM scoped),
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
             'row_kind','INTEGRATION',
             'record_id', p.publication_id,
             'record_reference', p.publication_reference,
             'queue_code', p_queue_code,
             'assessment_id', p.assessment_id,
             'assessment_reference', p.assessment_reference,
             'person_label', COALESCE(p.declared_person->>'full_name','Claimant'),
             'person_masked_identifier', public._bn_means_mask_ssn(p.declared_person->>'ssn'),
             'benefit_programme', p.benefit_programme,
             'assessment_status', p.assessment_status,
             'status_label', public._bn_means_status_label(p.assessment_status),
             'integration_step', CASE
                WHEN p.status IN ('FAILED','REFUSED') THEN 'Fact publication'
                WHEN p.eligibility_status IN ('FAILED','ERROR') THEN 'Eligibility request'
                WHEN p.determination_status = 'FAILED' THEN 'Eligibility processing'
                WHEN p.award_review_handoff_id IS NULL AND p.determination_status = 'COMPLETED' THEN 'Award review handoff'
                WHEN p.eligibility_status IN ('REQUESTED','PENDING','IN_PROGRESS') THEN 'Eligibility processing'
                ELSE 'Fact publication' END,
             'publication_status', p.status,
             'eligibility_status', p.eligibility_status,
             'determination_status', p.determination_status,
             'failure_code', p.failure_code,
             'failure_summary', left(COALESCE(p.failure_detail, p.refusal_reason, ''), 240),
             'failed_at', p.published_at,
             'retry_count', COALESCE(p.retry_count, 0),
             'retryable', (p.failure_code IS NOT NULL AND COALESCE(p.retry_count,0) < 5),
             'created_at', p.created_at,
             'age_days', GREATEST(0, (EXTRACT(EPOCH FROM (now() - p.created_at))/86400)::int),
             'action_required', CASE WHEN p.failure_code IS NOT NULL
                                     THEN 'Retry Eligibility integration'
                                     ELSE 'Awaiting Eligibility outcome' END,
             'deep_link_section','activation',
             'assigned_to', p.assigned_to,
             'is_mine', (p.assigned_to = p_actor_user_id),
             'technical', jsonb_build_object(
                'publication_id', p.publication_id,
                'calculation_id', p.calculation_id,
                'eligibility_request_id', p.eligibility_request_id,
                'award_review_handoff_id', p.award_review_handoff_id,
                'correlation_id', p.correlation_id,
                'assessment_version_id', p.assessment_version_id)
           ) ORDER BY p.created_at) FROM page p), '[]'::jsonb)
      INTO v_total, v_rows;

  ELSE
    WITH base AS (
      SELECT a.*,
             (SELECT count(*) FROM public.bn_means_information_request ir
               WHERE ir.assessment_id = a.assessment_id AND ir.status IN ('OPEN','PARTIALLY_RECEIVED')) AS open_info,
             (SELECT count(*) FROM public.bn_means_information_request ir
               WHERE ir.assessment_id = a.assessment_id AND ir.status IN ('OPEN','PARTIALLY_RECEIVED')
                 AND ir.due_date IS NOT NULL AND ir.due_date < CURRENT_DATE) AS overdue_info,
             (SELECT count(*) FROM public.bn_means_adjustment adj
               WHERE adj.assessment_id = a.assessment_id AND adj.status = 'REQUESTED') AS open_adjustments,
             (SELECT count(*) FROM public.bn_means_adjustment adj
               WHERE adj.assessment_id = a.assessment_id AND adj.status = 'APPROVED_PENDING_APPLICATION') AS pending_recalc,
             (SELECT count(*) FROM public.bn_means_verification v
               WHERE v.assessment_id = a.assessment_id AND v.outcome ILIKE 'CLARIF%') AS clarifications,
             (SELECT count(*) FROM public.bn_means_verification v
               WHERE v.assessment_id = a.assessment_id AND v.outcome = 'FAIL') AS failed_verifications,
             (SELECT s.assessment_id FROM public.bn_means_assessment s
               WHERE s.supersedes_assessment_id = a.assessment_id
                 AND s.status NOT IN ('CANCELLED','REJECTED')
               ORDER BY s.created_at DESC LIMIT 1) AS successor_id,
             (SELECT s.assessment_reference FROM public.bn_means_assessment s
               WHERE s.supersedes_assessment_id = a.assessment_id
                 AND s.status NOT IN ('CANCELLED','REJECTED')
               ORDER BY s.created_at DESC LIMIT 1) AS successor_reference,
             (SELECT pr.assessment_reference FROM public.bn_means_assessment pr
               WHERE pr.assessment_id = a.supersedes_assessment_id) AS predecessor_reference
        FROM public.bn_means_assessment a
    ), scoped AS (
      SELECT b.* FROM base b
       WHERE (
         (p_queue_code = 'MY_WORK' AND b.assigned_to = p_actor_user_id
            AND b.status NOT IN ('SUPERSEDED','CLOSED','CANCELLED','REJECTED'))
         OR (p_queue_code = 'TEAM_WORK'
            AND b.status NOT IN ('SUPERSEDED','CLOSED','CANCELLED','REJECTED','ACTIVE','EXPIRED'))
         OR (p_queue_code = 'DRAFTS_IN_PROGRESS' AND b.status IN ('DRAFT','INCOMPLETE'))
         OR (p_queue_code = 'AWAITING_INFORMATION' AND (b.status = 'INFORMATION_PENDING' OR b.open_info > 0))
         OR (p_queue_code = 'AWAITING_VERIFICATION' AND b.status IN ('SUBMITTED','VERIFICATION_PENDING'))
         OR (p_queue_code = 'VERIFICATION_CLARIFICATION' AND b.clarifications > 0
             AND b.status IN ('SUBMITTED','VERIFICATION_PENDING','INFORMATION_PENDING'))
         OR (p_queue_code = 'VERIFICATION_FAILED' AND (b.status = 'FAILED_VERIFICATION' OR b.failed_verifications > 0))
         OR (p_queue_code = 'ADJUSTMENTS_AWAITING_DECISION' AND b.open_adjustments > 0)
         OR (p_queue_code = 'ADJUSTMENTS_AWAITING_RECALCULATION' AND b.pending_recalc > 0)
         OR (p_queue_code = 'ASSESSMENTS_AWAITING_APPROVAL' AND b.status IN ('CALCULATED','APPROVAL_PENDING'))
         OR (p_queue_code = 'APPROVED_NOT_ACTIVE' AND b.status = 'APPROVED')
         OR (p_queue_code = 'REASSESSMENT_DUE_SOON' AND b.status IN ('ACTIVE')
             AND b.reassessment_due IS NOT NULL AND b.reassessment_due > CURRENT_DATE
             AND b.reassessment_due <= CURRENT_DATE + 30)
         OR (p_queue_code = 'REASSESSMENT_DUE' AND (b.status = 'REASSESSMENT_DUE'
             OR (b.status = 'ACTIVE' AND b.reassessment_due = CURRENT_DATE)))
         OR (p_queue_code = 'REASSESSMENT_OVERDUE' AND b.status IN ('ACTIVE','REASSESSMENT_DUE','EXPIRED')
             AND b.reassessment_due IS NOT NULL AND b.reassessment_due < CURRENT_DATE)
         OR (p_queue_code = 'SUCCESSOR_IN_PROGRESS' AND b.successor_id IS NOT NULL
             AND b.status NOT IN ('SUPERSEDED','CLOSED'))
         OR (p_queue_code = 'RETURNED_TO_REVIEW' AND b.status = 'REVIEW_PENDING')
         OR (p_queue_code = 'REJECTED' AND b.status = 'REJECTED')
         OR (p_queue_code = 'CLOSED_OR_SUPERSEDED' AND b.status IN ('CLOSED','SUPERSEDED','EXPIRED','CANCELLED'))
         OR (p_queue_code = 'SEARCH')
       )
         AND (v_prog IS NULL OR b.benefit_programme = v_prog)
         AND (v_status IS NULL OR b.status = v_status)
         AND (v_result IS NULL OR b.result = v_result)
         AND (v_reason IS NULL OR b.assessment_reason = v_reason)
         AND (v_assigned_uuid IS NULL OR b.assigned_to = v_assigned_uuid)
         AND (v_created_from IS NULL OR b.created_at >= v_created_from)
         AND (v_created_to IS NULL OR b.created_at < v_created_to + 1)
         AND (v_eff_from IS NULL OR b.effective_from >= v_eff_from)
         AND (v_eff_to IS NULL OR b.effective_from <= v_eff_to)
         AND (v_due_before IS NULL OR b.reassessment_due <= v_due_before)
         AND (v_search IS NULL OR b.assessment_reference ILIKE '%'||v_search||'%'
              OR COALESCE(b.declared_person->>'full_name','') ILIKE '%'||v_search||'%'
              OR regexp_replace(COALESCE(b.declared_person->>'ssn',''),'[^0-9]','','g') ILIKE '%'||regexp_replace(v_search,'[^0-9]','','g')||'%'
                 AND regexp_replace(v_search,'[^0-9]','','g') <> ''
              OR COALESCE(b.claim_id::text,'') = v_search
              OR COALESCE(b.award_id::text,'') = v_search)
    ), page AS (
      SELECT * FROM scoped
       ORDER BY
         CASE WHEN v_sort = 'NEWEST' THEN updated_at END DESC NULLS LAST,
         CASE WHEN v_sort = 'DUE_SOONEST' THEN COALESCE(reassessment_due, DATE '9999-12-31') END ASC NULLS LAST,
         CASE WHEN v_sort = 'SUBMITTED' THEN submitted_at END ASC NULLS LAST,
         CASE WHEN v_sort = 'REFERENCE' THEN assessment_reference END ASC NULLS LAST,
         CASE WHEN v_sort NOT IN ('NEWEST','DUE_SOONEST','SUBMITTED','REFERENCE') THEN updated_at END ASC NULLS LAST
       LIMIT v_limit OFFSET v_offset
    )
    SELECT (SELECT count(*) FROM scoped),
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
             'row_kind','ASSESSMENT',
             'record_id', p.assessment_id,
             'record_reference', p.assessment_reference,
             'queue_code', p_queue_code,
             'assessment_id', p.assessment_id,
             'assessment_reference', p.assessment_reference,
             'person_label', COALESCE(p.declared_person->>'full_name','Claimant'),
             'person_masked_identifier', public._bn_means_mask_ssn(p.declared_person->>'ssn'),
             'benefit_programme', p.benefit_programme,
             'assessment_reason', p.assessment_reason,
             'assessment_status', p.status,
             'status_label', public._bn_means_status_label(p.status),
             'result', p.result,
             'assigned_to', p.assigned_to,
             'assigned_to_label', CASE WHEN p.assigned_to IS NULL THEN NULL
                                       ELSE public._bn_means_person_label(p.assigned_to) END,
             'is_mine', (p.assigned_to = p_actor_user_id),
             'created_at', p.created_at,
             'submitted_at', p.submitted_at,
             'approved_at', p.approved_at,
             'activated_at', p.activated_at,
             'updated_at', p.updated_at,
             'effective_from', p.effective_from,
             'valid_until', p.valid_until,
             'reassessment_due', p.reassessment_due,
             'days_to_reassessment', CASE WHEN p.reassessment_due IS NULL THEN NULL
                                          ELSE (p.reassessment_due - CURRENT_DATE) END,
             'days_overdue', CASE WHEN p.reassessment_due IS NOT NULL AND p.reassessment_due < CURRENT_DATE
                                  THEN (CURRENT_DATE - p.reassessment_due) ELSE NULL END,
             'age_days', GREATEST(0, (EXTRACT(EPOCH FROM (now() - p.updated_at))/86400)::int),
             'open_information_requests', p.open_info,
             'overdue_information_requests', p.overdue_info,
             'open_adjustments', p.open_adjustments,
             'pending_recalculations', p.pending_recalc,
             'clarifications', p.clarifications,
             'predecessor_reference', p.predecessor_reference,
             'successor_assessment_id', p.successor_id,
             'successor_reference', p.successor_reference,
             'is_read_only', (p.status IN ('SUPERSEDED','CLOSED','CANCELLED','REJECTED','EXPIRED')),
             'action_required', CASE
                WHEN p_queue_code = 'ADJUSTMENTS_AWAITING_DECISION' THEN 'Decide adjustment request'
                WHEN p_queue_code = 'ADJUSTMENTS_AWAITING_RECALCULATION' THEN 'Apply approved adjustment'
                WHEN p_queue_code = 'VERIFICATION_CLARIFICATION' THEN 'Review clarification response'
                WHEN p_queue_code IN ('REASSESSMENT_DUE','REASSESSMENT_DUE_SOON','REASSESSMENT_OVERDUE') THEN 'Start reassessment'
                WHEN p.overdue_info > 0 THEN 'Chase overdue information'
                ELSE public._bn_means_ops_action(p.status) END,
             'deep_link_section', CASE
                WHEN p_queue_code IN ('ADJUSTMENTS_AWAITING_DECISION','ADJUSTMENTS_AWAITING_RECALCULATION') THEN 'decision'
                WHEN p_queue_code IN ('REASSESSMENT_DUE','REASSESSMENT_DUE_SOON','REASSESSMENT_OVERDUE','SUCCESSOR_IN_PROGRESS') THEN 'lifecycle'
                WHEN p_queue_code IN ('ACTIVATION_INTEGRATION_PENDING','APPROVED_NOT_ACTIVE') THEN 'activation'
                WHEN p_queue_code = 'AWAITING_INFORMATION' THEN 'evidence'
                ELSE public._bn_means_ops_section(p.status) END,
             'row_version', p.row_version,
             'technical', jsonb_build_object(
                'assessment_id', p.assessment_id,
                'current_version', p.current_version,
                'policy_version_id', p.policy_version_id,
                'approved_calculation_id', p.approved_calculation_id,
                'correlation_id', p.correlation_id)
           ) ORDER BY p.updated_at) FROM page p), '[]'::jsonb)
      INTO v_total, v_rows;
  END IF;

  RETURN jsonb_build_object('status','OK','code', NULL,
    'data', jsonb_build_object(
      'queue_code', p_queue_code,
      'rows', v_rows,
      'total', v_total,
      'limit', v_limit,
      'offset', v_offset,
      'sort', v_sort));
END;
$function$;

CREATE OR REPLACE FUNCTION public.bn_means_operational_counts_v1(
  p_actor_user_id uuid,
  p_queue_codes text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_perm jsonb;
  v_codes text[] := COALESCE(p_queue_codes, ARRAY[
    'MY_WORK','TEAM_WORK','AWAITING_INFORMATION','INFORMATION_REQUEST_OVERDUE',
    'AWAITING_VERIFICATION','ADJUSTMENTS_AWAITING_DECISION','ASSESSMENTS_AWAITING_APPROVAL',
    'APPROVED_NOT_ACTIVE','ACTIVATION_INTEGRATION_FAILED','REASSESSMENT_DUE','REASSESSMENT_OVERDUE']);
  v_code text;
  v_res jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_config jsonb := NULL;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('status','DENIED','code', COALESCE(v_perm->>'code','FORBIDDEN'),'data', NULL);
  END IF;

  FOREACH v_code IN ARRAY v_codes LOOP
    v_res := public.bn_means_operational_queue_v1(p_actor_user_id, v_code, '{}'::jsonb, 1, 0, 'OLDEST');
    IF COALESCE(v_res->>'status','') = 'OK' THEN
      v_counts := v_counts || jsonb_build_object(v_code, jsonb_build_object(
        'status','OK','count', (v_res->'data'->>'total')::int));
    ELSE
      v_counts := v_counts || jsonb_build_object(v_code, jsonb_build_object(
        'status', COALESCE(v_res->>'status','FAILED'), 'count', NULL, 'code', v_res->>'code'));
    END IF;
  END LOOP;

  IF COALESCE((public.bn_means_check_actor_permission(p_actor_user_id, 'config', false)->>'ok')::boolean, false) THEN
    SELECT jsonb_build_object(
      'status','OK',
      'active_policies', (SELECT count(*) FROM public.bn_means_policy p
                           WHERE EXISTS (SELECT 1 FROM public.bn_means_policy_version v
                                          WHERE v.policy_id = p.policy_id AND v.status = 'ACTIVE')),
      'policies_without_active_version', (SELECT count(*) FROM public.bn_means_policy p
                           WHERE NOT EXISTS (SELECT 1 FROM public.bn_means_policy_version v
                                              WHERE v.policy_id = p.policy_id AND v.status = 'ACTIVE')),
      'draft_versions', (SELECT count(*) FROM public.bn_means_policy_version v WHERE v.status = 'DRAFT')
    ) INTO v_config;
  END IF;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'counts', v_counts, 'configuration_health', v_config, 'generated_at', now()));
END;
$function$;

CREATE OR REPLACE FUNCTION public.bn_means_operational_report_v1(
  p_actor_user_id uuid,
  p_report_code text,
  p_filters jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_perm jsonb;
  v_f jsonb := COALESCE(p_filters,'{}'::jsonb);
  v_from date := COALESCE(NULLIF(v_f->>'date_from','')::date, (CURRENT_DATE - 30));
  v_to date := COALESCE(NULLIF(v_f->>'date_to','')::date, CURRENT_DATE);
  v_prog text := NULLIF(v_f->>'benefit_programme','');
  v_data jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('status','DENIED','code', COALESCE(v_perm->>'code','FORBIDDEN'),'data', NULL);
  END IF;

  IF p_report_code NOT IN ('STAGE_DISTRIBUTION','VOLUMES','AGEING','REASSESSMENT',
                           'INFORMATION_REQUESTS','INTEGRATION','OUTCOMES') THEN
    RETURN jsonb_build_object('status','INVALID','code','REPORT_UNKNOWN','data', NULL);
  END IF;

  IF p_report_code = 'STAGE_DISTRIBUTION' THEN
    SELECT jsonb_build_object('rows', COALESCE(jsonb_agg(jsonb_build_object(
              'key', s.status, 'label', public._bn_means_status_label(s.status), 'count', s.n)
              ORDER BY s.n DESC), '[]'::jsonb))
      INTO v_data
      FROM (SELECT a.status, count(*) AS n FROM public.bn_means_assessment a
             WHERE (v_prog IS NULL OR a.benefit_programme = v_prog)
             GROUP BY a.status) s;

  ELSIF p_report_code = 'VOLUMES' THEN
    SELECT jsonb_build_object('rows', jsonb_build_array(
        jsonb_build_object('key','CREATED','label','Assessments created','count',
          count(*) FILTER (WHERE a.created_at::date BETWEEN v_from AND v_to)),
        jsonb_build_object('key','SUBMITTED','label','Assessments submitted','count',
          count(*) FILTER (WHERE a.submitted_at::date BETWEEN v_from AND v_to)),
        jsonb_build_object('key','APPROVED','label','Assessments approved','count',
          count(*) FILTER (WHERE a.approved_at::date BETWEEN v_from AND v_to)),
        jsonb_build_object('key','ACTIVATED','label','Assessments activated','count',
          count(*) FILTER (WHERE a.activated_at::date BETWEEN v_from AND v_to)),
        jsonb_build_object('key','REJECTED','label','Assessments rejected','count',
          count(*) FILTER (WHERE a.status = 'REJECTED' AND a.decided_at::date BETWEEN v_from AND v_to)),
        jsonb_build_object('key','CALCULATED','label','Assessments calculated','count',
          (SELECT count(*) FROM public.bn_means_calculation c
             JOIN public.bn_means_assessment a2 ON a2.assessment_id = c.assessment_id
            WHERE c.calculated_at::date BETWEEN v_from AND v_to
              AND (v_prog IS NULL OR a2.benefit_programme = v_prog))),
        jsonb_build_object('key','VERIFIED','label','Verification decisions recorded','count',
          (SELECT count(*) FROM public.bn_means_verification vv
             JOIN public.bn_means_assessment a3 ON a3.assessment_id = vv.assessment_id
            WHERE vv.verified_at::date BETWEEN v_from AND v_to
              AND (v_prog IS NULL OR a3.benefit_programme = v_prog))),
        jsonb_build_object('key','REASSESSMENTS_STARTED','label','Reassessments started','count',
          count(*) FILTER (WHERE a.supersedes_assessment_id IS NOT NULL
                             AND a.created_at::date BETWEEN v_from AND v_to)),
        jsonb_build_object('key','REASSESSMENTS_COMPLETED','label','Reassessments completed','count',
          count(*) FILTER (WHERE a.supersedes_assessment_id IS NOT NULL
                             AND a.activated_at::date BETWEEN v_from AND v_to))
      )) INTO v_data
      FROM public.bn_means_assessment a
     WHERE (v_prog IS NULL OR a.benefit_programme = v_prog);

  ELSIF p_report_code = 'AGEING' THEN
    SELECT jsonb_build_object('rows', jsonb_build_array(
        jsonb_build_object('key','0_2','label','0–2 days','count', count(*) FILTER (WHERE d <= 2)),
        jsonb_build_object('key','3_5','label','3–5 days','count', count(*) FILTER (WHERE d BETWEEN 3 AND 5)),
        jsonb_build_object('key','6_10','label','6–10 days','count', count(*) FILTER (WHERE d BETWEEN 6 AND 10)),
        jsonb_build_object('key','11_30','label','11–30 days','count', count(*) FILTER (WHERE d BETWEEN 11 AND 30)),
        jsonb_build_object('key','30_plus','label','30+ days','count', count(*) FILTER (WHERE d > 30))
      )) INTO v_data
      FROM (SELECT (EXTRACT(EPOCH FROM (now() - a.updated_at))/86400)::int AS d
              FROM public.bn_means_assessment a
             WHERE a.status NOT IN ('ACTIVE','SUPERSEDED','CLOSED','CANCELLED','REJECTED','EXPIRED')
               AND (v_prog IS NULL OR a.benefit_programme = v_prog)) x;

  ELSIF p_report_code = 'REASSESSMENT' THEN
    SELECT jsonb_build_object('rows', jsonb_build_array(
        jsonb_build_object('key','DUE_SOON','label','Due soon','count', count(*) FILTER (
          WHERE a.reassessment_due > CURRENT_DATE AND a.reassessment_due <= CURRENT_DATE + 30)),
        jsonb_build_object('key','DUE','label','Due','count', count(*) FILTER (
          WHERE a.reassessment_due = CURRENT_DATE OR a.status = 'REASSESSMENT_DUE')),
        jsonb_build_object('key','OVERDUE','label','Overdue','count', count(*) FILTER (
          WHERE a.reassessment_due < CURRENT_DATE)),
        jsonb_build_object('key','SUCCESSOR_IN_PROGRESS','label','Successor in progress','count',
          (SELECT count(*) FROM public.bn_means_assessment s
            WHERE s.supersedes_assessment_id IS NOT NULL
              AND s.status NOT IN ('ACTIVE','REJECTED','CANCELLED','SUPERSEDED','CLOSED')
              AND (v_prog IS NULL OR s.benefit_programme = v_prog))),
        jsonb_build_object('key','COMPLETED','label','Completed during period','count',
          (SELECT count(*) FROM public.bn_means_assessment s
            WHERE s.supersedes_assessment_id IS NOT NULL
              AND s.activated_at::date BETWEEN v_from AND v_to
              AND (v_prog IS NULL OR s.benefit_programme = v_prog)))
      )) INTO v_data
      FROM public.bn_means_assessment a
     WHERE a.status IN ('ACTIVE','REASSESSMENT_DUE','EXPIRED')
       AND (v_prog IS NULL OR a.benefit_programme = v_prog);

  ELSIF p_report_code = 'INFORMATION_REQUESTS' THEN
    SELECT jsonb_build_object(
      'rows', jsonb_build_array(
        jsonb_build_object('key','OPEN','label','Open','count', count(*) FILTER (
          WHERE ir.status IN ('OPEN','PARTIALLY_RECEIVED'))),
        jsonb_build_object('key','DUE_SOON','label','Due soon','count', count(*) FILTER (
          WHERE ir.status IN ('OPEN','PARTIALLY_RECEIVED') AND ir.due_date >= CURRENT_DATE
            AND ir.due_date <= CURRENT_DATE + 5)),
        jsonb_build_object('key','OVERDUE','label','Overdue','count', count(*) FILTER (
          WHERE ir.status IN ('OPEN','PARTIALLY_RECEIVED') AND ir.due_date < CURRENT_DATE)),
        jsonb_build_object('key','RESPONSE_RECEIVED','label','Response received','count', count(*) FILTER (
          WHERE ir.status IN ('RESPONDED','RESPONSE_RECEIVED'))),
        jsonb_build_object('key','FULFILLED','label','Fulfilled','count', count(*) FILTER (
          WHERE ir.status IN ('CLOSED','FULFILLED')))
      ),
      'average_open_age_days', (
        SELECT CASE WHEN count(*) = 0 THEN NULL
               ELSE round(avg(EXTRACT(EPOCH FROM (now() - i.requested_at))/86400)::numeric, 1) END
          FROM public.bn_means_information_request i
          JOIN public.bn_means_assessment a2 ON a2.assessment_id = i.assessment_id
         WHERE i.status IN ('OPEN','PARTIALLY_RECEIVED')
           AND (v_prog IS NULL OR a2.benefit_programme = v_prog))
    ) INTO v_data
      FROM public.bn_means_information_request ir
      JOIN public.bn_means_assessment a ON a.assessment_id = ir.assessment_id
     WHERE (v_prog IS NULL OR a.benefit_programme = v_prog);

  ELSIF p_report_code = 'INTEGRATION' THEN
    SELECT jsonb_build_object('rows', jsonb_build_array(
        jsonb_build_object('key','PENDING','label','Pending','count', count(*) FILTER (
          WHERE fp.failure_code IS NULL AND COALESCE(fp.determination_status,'') <> 'COMPLETED')),
        jsonb_build_object('key','COMPLETED','label','Completed','count', count(*) FILTER (
          WHERE fp.determination_status = 'COMPLETED')),
        jsonb_build_object('key','FAILED','label','Failed','count', count(*) FILTER (
          WHERE fp.failure_code IS NOT NULL)),
        jsonb_build_object('key','RETRYABLE','label','Retryable','count', count(*) FILTER (
          WHERE fp.failure_code IS NOT NULL AND COALESCE(fp.retry_count,0) < 5)),
        jsonb_build_object('key','RECOVERED','label','Recovered after retry','count', count(*) FILTER (
          WHERE COALESCE(fp.retry_count,0) > 0 AND fp.failure_code IS NULL))
      )) INTO v_data
      FROM public.bn_means_fact_publication fp
      JOIN public.bn_means_assessment a ON a.assessment_id = fp.assessment_id
     WHERE (v_prog IS NULL OR a.benefit_programme = v_prog);

  ELSE -- OUTCOMES
    SELECT jsonb_build_object('rows', jsonb_build_array(
        jsonb_build_object('key','PASS','label','Means-Test PASS','count', count(*) FILTER (WHERE a.result = 'PASS')),
        jsonb_build_object('key','FAIL','label','Means-Test FAIL','count', count(*) FILTER (WHERE a.result = 'FAIL')),
        jsonb_build_object('key','REFER','label','Means-Test REFER','count', count(*) FILTER (WHERE a.result = 'REFER')),
        jsonb_build_object('key','PROVISIONAL','label','Provisional','count', count(*) FILTER (WHERE a.result = 'PROVISIONAL'))
      )) INTO v_data
      FROM public.bn_means_assessment a
     WHERE a.decided_at::date BETWEEN v_from AND v_to
       AND (v_prog IS NULL OR a.benefit_programme = v_prog);
  END IF;

  RETURN jsonb_build_object('status','OK','code', NULL, 'data',
    v_data || jsonb_build_object(
      'report_code', p_report_code,
      'period_from', v_from,
      'period_to', v_to,
      'benefit_programme', v_prog,
      'generated_at', now()));
END;
$function$;

CREATE OR REPLACE FUNCTION public.bn_means_operational_assign_v1(
  p_actor_user_id uuid,
  p_assessment_id uuid,
  p_action text,
  p_target_user_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_perm jsonb;
  v_row public.bn_means_assessment%ROWTYPE;
  v_new uuid;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'write', true);
  IF NOT COALESCE((v_perm->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('status','DENIED','code', COALESCE(v_perm->>'code','FORBIDDEN'),'data', NULL);
  END IF;
  IF p_action NOT IN ('CLAIM','RELEASE','REASSIGN') THEN
    RETURN jsonb_build_object('status','INVALID','code','ACTION_UNKNOWN','data', NULL);
  END IF;

  SELECT * INTO v_row FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','ASSESSMENT_NOT_FOUND','data', NULL);
  END IF;
  IF v_row.status IN ('SUPERSEDED','CLOSED','CANCELLED','REJECTED') THEN
    RETURN jsonb_build_object('status','INVALID','code','ASSESSMENT_NOT_ACTIONABLE','data', NULL);
  END IF;

  IF p_action = 'CLAIM' THEN
    IF v_row.assigned_to IS NOT NULL AND v_row.assigned_to <> p_actor_user_id THEN
      RETURN jsonb_build_object('status','INVALID','code','ALREADY_ASSIGNED','data', NULL);
    END IF;
    v_new := p_actor_user_id;
  ELSIF p_action = 'RELEASE' THEN
    IF v_row.assigned_to IS DISTINCT FROM p_actor_user_id
       AND NOT COALESCE((public.bn_means_check_actor_permission(p_actor_user_id,'admin',true)->>'ok')::boolean,false) THEN
      RETURN jsonb_build_object('status','DENIED','code','NOT_OWNER','data', NULL);
    END IF;
    v_new := NULL;
  ELSE
    IF NOT COALESCE((public.bn_means_check_actor_permission(p_actor_user_id,'admin',true)->>'ok')::boolean,false) THEN
      RETURN jsonb_build_object('status','DENIED','code','REASSIGN_NOT_PERMITTED','data', NULL);
    END IF;
    IF p_target_user_id IS NULL THEN
      RETURN jsonb_build_object('status','INVALID','code','TARGET_REQUIRED','data', NULL);
    END IF;
    v_new := p_target_user_id;
  END IF;

  UPDATE public.bn_means_assessment
     SET assigned_to = v_new, updated_at = now(), updated_by = p_actor_user_id
   WHERE assessment_id = p_assessment_id;

  INSERT INTO public.bn_means_event(assessment_id, event_code, command_name, from_status, to_status,
                                    reason_code, detail, actor_user_id, row_version)
  VALUES (p_assessment_id, 'WORK_ASSIGNMENT', 'bn_means_operational_assign_v1', v_row.status, v_row.status,
          p_action, jsonb_build_object('previous_assignee', v_row.assigned_to, 'new_assignee', v_new),
          p_actor_user_id, v_row.row_version);

  RETURN jsonb_build_object('status','OK','code', NULL,
    'data', jsonb_build_object('assessment_id', p_assessment_id, 'assigned_to', v_new, 'action', p_action));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bn_means_operational_queue_v1(uuid, text, jsonb, integer, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_means_operational_counts_v1(uuid, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_means_operational_report_v1(uuid, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bn_means_operational_assign_v1(uuid, uuid, text, uuid) TO authenticated, service_role;