-- =====================================================================
-- MEANS-TEST EPIC 8 — Verification and Clarification
-- Frozen-version verification: claim, decide, clarify, re-review, complete.
-- Calculation is NOT performed here.
-- =====================================================================

-- ---------- 1. Schema extensions -------------------------------------
ALTER TABLE public.bn_means_verification_work
  ADD COLUMN IF NOT EXISTS sequence_no              integer,
  ADD COLUMN IF NOT EXISTS outcome                  text,
  ADD COLUMN IF NOT EXISTS outcome_reason_code      text,
  ADD COLUMN IF NOT EXISTS outcome_note             text,
  ADD COLUMN IF NOT EXISTS decided_at               timestamptz,
  ADD COLUMN IF NOT EXISTS decided_by               uuid,
  ADD COLUMN IF NOT EXISTS claimed_at               timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by               uuid,
  ADD COLUMN IF NOT EXISTS clarification_request_id uuid,
  ADD COLUMN IF NOT EXISTS reopened_at              timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_by              uuid,
  ADD COLUMN IF NOT EXISTS reopen_reason_code       text,
  ADD COLUMN IF NOT EXISTS review_round             integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_by               uuid;

ALTER TABLE public.bn_means_verification_work
  DROP CONSTRAINT IF EXISTS bn_means_verification_work_status_chk;
ALTER TABLE public.bn_means_verification_work
  ADD CONSTRAINT bn_means_verification_work_status_chk CHECK (
    status IN ('PENDING','IN_PROGRESS','CLARIFICATION_PENDING','COMPLETED','CANCELLED'));

ALTER TABLE public.bn_means_verification_work
  DROP CONSTRAINT IF EXISTS bn_means_verification_work_outcome_chk;
ALTER TABLE public.bn_means_verification_work
  ADD CONSTRAINT bn_means_verification_work_outcome_chk CHECK (
    outcome IS NULL OR outcome IN ('VERIFIED','REJECTED','CLARIFICATION_REQUIRED','NOT_APPLICABLE'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bn_means_verification_work_clarification_fk'
  ) THEN
    ALTER TABLE public.bn_means_verification_work
      ADD CONSTRAINT bn_means_verification_work_clarification_fk
      FOREIGN KEY (clarification_request_id)
      REFERENCES public.bn_means_information_request(request_id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS bn_means_verification_work_open_idx
  ON public.bn_means_verification_work (status, assessment_id)
  WHERE status IN ('PENDING','IN_PROGRESS','CLARIFICATION_PENDING');

-- Immutable per-decision history keeps a pointer to the work item.
ALTER TABLE public.bn_means_verification
  ADD COLUMN IF NOT EXISTS work_id uuid,
  ADD COLUMN IF NOT EXISTS review_round integer NOT NULL DEFAULT 1;

-- Verification is a tracked section, so completion is auditable.
ALTER TABLE public.bn_means_section_completion
  DROP CONSTRAINT IF EXISTS bn_means_section_code_chk;
ALTER TABLE public.bn_means_section_completion
  ADD CONSTRAINT bn_means_section_code_chk CHECK (
    section_code IN ('CONTEXT','HOUSEHOLD','INCOME','ASSETS','DEDUCTIONS','EVIDENCE','VERIFICATION'));

-- Clarification requests raised during verification are marked as such.
ALTER TABLE public.bn_means_information_request
  ADD COLUMN IF NOT EXISTS origin_stage text NOT NULL DEFAULT 'INTAKE',
  ADD COLUMN IF NOT EXISTS work_id      uuid;

-- ---------- 2. Reference data ----------------------------------------
CREATE OR REPLACE FUNCTION public._bn_means_verification_reference()
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT jsonb_build_object(
    'outcomes', jsonb_build_array(
      jsonb_build_object('code','VERIFIED','label','Verify',
        'description','The declared fact is supported and may be used for calculation.',
        'requires_reason', false, 'requires_clarification', false),
      jsonb_build_object('code','REJECTED','label','Reject',
        'description','The declared fact is not supported by acceptable evidence.',
        'requires_reason', true, 'requires_clarification', false),
      jsonb_build_object('code','CLARIFICATION_REQUIRED','label','Request clarification',
        'description','More information is needed before this fact can be decided.',
        'requires_reason', true, 'requires_clarification', true),
      jsonb_build_object('code','NOT_APPLICABLE','label','Mark not applicable',
        'description','This fact does not apply to the assessment period or subject.',
        'requires_reason', false, 'requires_clarification', false)),
    'reject_reasons', jsonb_build_array(
      jsonb_build_object('code','EVIDENCE_MISSING','label','No supporting evidence'),
      jsonb_build_object('code','EVIDENCE_UNUSABLE','label','Evidence is not usable'),
      jsonb_build_object('code','VALUE_INCONSISTENT','label','Value inconsistent with evidence'),
      jsonb_build_object('code','PERIOD_INCONSISTENT','label','Period inconsistent with evidence'),
      jsonb_build_object('code','SUBJECT_INCORRECT','label','Wrong subject or owner'),
      jsonb_build_object('code','DUPLICATE_FACT','label','Duplicate of another declared fact'),
      jsonb_build_object('code','OTHER','label','Other (explain in the note)')),
    'clarification_reasons', jsonb_build_array(
      jsonb_build_object('code','EVIDENCE_MISSING','label','Supporting document missing'),
      jsonb_build_object('code','EVIDENCE_UNREADABLE','label','Document cannot be read'),
      jsonb_build_object('code','VALUE_UNCLEAR','label','Declared amount unclear'),
      jsonb_build_object('code','PERIOD_UNCLEAR','label','Declared period unclear'),
      jsonb_build_object('code','SUBJECT_UNCLEAR','label','Subject or ownership unclear'),
      jsonb_build_object('code','OTHER','label','Other (explain in the request)')),
    'not_applicable_reasons', jsonb_build_array(
      jsonb_build_object('code','OUTSIDE_PERIOD','label','Outside the assessment period'),
      jsonb_build_object('code','SUBJECT_NOT_IN_HOUSEHOLD','label','Subject not in the household'),
      jsonb_build_object('code','SUPERSEDED','label','Superseded by another fact')),
    'reopen_reasons', jsonb_build_array(
      jsonb_build_object('code','NEW_INFORMATION','label','New information received'),
      jsonb_build_object('code','DECISION_ERROR','label','Previous decision was incorrect'),
      jsonb_build_object('code','SUPERVISOR_DIRECTION','label','Reopened on supervisor direction')),
    'recipient_kinds', jsonb_build_array(
      jsonb_build_object('code','CLAIMANT','label','Claimant'),
      jsonb_build_object('code','HOUSEHOLD_MEMBER','label','Household member'),
      jsonb_build_object('code','EMPLOYER','label','Employer'),
      jsonb_build_object('code','THIRD_PARTY','label','Third party'),
      jsonb_build_object('code','INTERNAL','label','Internal team')),
    'response_kinds', jsonb_build_array(
      jsonb_build_object('code','FULL_RESPONSE','label','Full response received'),
      jsonb_build_object('code','PARTIAL_RESPONSE','label','Partial response received'),
      jsonb_build_object('code','WRONG_INFORMATION','label','Wrong information supplied'),
      jsonb_build_object('code','NO_RESPONSE','label','No response by due date')),
    'fact_kinds', jsonb_build_array(
      jsonb_build_object('code','ASSESSMENT','label','Assessment context'),
      jsonb_build_object('code','HOUSEHOLD','label','Household member'),
      jsonb_build_object('code','INCOME','label','Income'),
      jsonb_build_object('code','ASSET','label','Asset'),
      jsonb_build_object('code','DEDUCTION','label','Deduction or disregard'),
      jsonb_build_object('code','EVIDENCE','label','Evidence item')));
$function$;

CREATE OR REPLACE FUNCTION public._bn_means_verification_option(p_set text, p_code text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT el FROM jsonb_array_elements(
           COALESCE(public._bn_means_verification_reference()->p_set,'[]'::jsonb)) el
   WHERE el->>'code' = p_code LIMIT 1;
$function$;

-- ---------- 3. Frozen-version fact rendering -------------------------
CREATE OR REPLACE FUNCTION public._bn_means_verification_snapshot_key(p_kind text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT CASE p_kind
    WHEN 'HOUSEHOLD' THEN 'household'
    WHEN 'INCOME'    THEN 'income'
    WHEN 'ASSET'     THEN 'assets'
    WHEN 'DEDUCTION' THEN 'deductions'
    WHEN 'EVIDENCE'  THEN 'evidence'
    ELSE NULL END;
$function$;

CREATE OR REPLACE FUNCTION public._bn_means_verification_id_key(p_kind text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT CASE p_kind
    WHEN 'HOUSEHOLD' THEN 'member_id'
    WHEN 'INCOME'    THEN 'income_fact_id'
    WHEN 'ASSET'     THEN 'asset_fact_id'
    WHEN 'DEDUCTION' THEN 'deduction_fact_id'
    WHEN 'EVIDENCE'  THEN 'evidence_id'
    ELSE NULL END;
$function$;

/** The declared element exactly as frozen at submission. Never re-derived. */
CREATE OR REPLACE FUNCTION public._bn_means_verification_declared(
  p_snapshot jsonb, p_kind text, p_fact uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT CASE
    WHEN public._bn_means_verification_snapshot_key(p_kind) IS NULL OR p_fact IS NULL
      THEN NULL
    ELSE (
      SELECT el FROM jsonb_array_elements(
        COALESCE(p_snapshot->public._bn_means_verification_snapshot_key(p_kind),'[]'::jsonb)) el
       WHERE el->>public._bn_means_verification_id_key(p_kind) = p_fact::text
       LIMIT 1)
  END;
$function$;

/** Evidence linked to one verification subject, as governed metadata only. */
CREATE OR REPLACE FUNCTION public._bn_means_verification_evidence(
  p_assessment_id uuid, p_kind text, p_fact uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'link_id', l.link_id,
           'requirement_code', l.requirement_code,
           'document_title', COALESCE(NULLIF(btrim(l.document_title),''), l.document_ref),
           'document_type_code', l.document_type_code,
           'document_source', l.document_source,
           'evidence_type', l.evidence_type,
           'document_date', l.document_date,
           'period_from', l.period_from,
           'period_to', l.period_to,
           'expiry_date', l.expiry_date,
           'usability_status', l.usability_status,
           'usability_reason_code', l.usability_reason_code,
           'usability_note', l.usability_note,
           'usable', (l.usability_status = 'USABLE'),
           'linked_at', l.linked_at) ORDER BY l.linked_at), '[]'::jsonb)
    FROM public.bn_means_evidence_link l
   WHERE l.assessment_id = p_assessment_id
     AND l.link_status = 'LINKED'
     AND (
       (p_kind = 'HOUSEHOLD' AND l.subject_kind = 'HOUSEHOLD_MEMBER' AND l.subject_ref_id = p_fact)
       OR (p_kind = 'INCOME'    AND l.subject_kind = 'INCOME_FACT'    AND l.subject_ref_id = p_fact)
       OR (p_kind = 'ASSET'     AND l.subject_kind = 'ASSET_FACT'     AND l.subject_ref_id = p_fact)
       OR (p_kind = 'DEDUCTION' AND l.subject_kind = 'DEDUCTION_FACT' AND l.subject_ref_id = p_fact)
       OR (p_kind IN ('ASSESSMENT','EVIDENCE') AND l.subject_kind = 'ASSESSMENT'));
$function$;

/** Clarification request attached to one work item, with its responses. */
CREATE OR REPLACE FUNCTION public._bn_means_verification_clarification(p_request_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT CASE WHEN p_request_id IS NULL THEN NULL ELSE (
    SELECT jsonb_build_object(
      'request_id', r.request_id,
      'request_reference', r.request_reference,
      'request_type', r.request_type,
      'reason_code', r.reason_code,
      'information_required', r.information_required,
      'details', r.details,
      'recipient_kind', r.recipient_kind,
      'recipient_label', r.recipient_label,
      'status', r.status,
      'is_blocking', r.is_blocking,
      'due_date', r.due_date,
      'overdue', (r.due_date IS NOT NULL AND r.due_date < current_date
                  AND r.status NOT IN ('FULFILLED','CANCELLED')),
      'requested_at', r.requested_at,
      'requested_by', r.requested_by,
      'response_summary', r.response_summary,
      'closed_at', r.closed_at,
      'responses', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'response_id', p.response_id,
          'response_kind', p.response_kind,
          'note', p.note,
          'evidence_link_id', p.evidence_link_id,
          'recorded_at', p.recorded_at,
          'recorded_by', p.recorded_by) ORDER BY p.recorded_at)
          FROM public.bn_means_information_response p
         WHERE p.request_id = r.request_id), '[]'::jsonb))
      FROM public.bn_means_information_request r
     WHERE r.request_id = p_request_id) END;
$function$;

-- ---------- 4. Authoritative verification readiness -------------------
CREATE OR REPLACE FUNCTION public._bn_means_verification_readiness(p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE
  v_a     public.bn_means_assessment%ROWTYPE;
  v_av    public.bn_means_assessment_version%ROWTYPE;
  v_block jsonb := '[]'::jsonb;
  v_warn  jsonb := '[]'::jsonb;
  v_codes jsonb := '[]'::jsonb;
  v_total int := 0; v_pending int := 0; v_progress int := 0;
  v_clar int := 0; v_done int := 0; v_cancel int := 0;
  v_verified int := 0; v_rejected int := 0; v_na int := 0;
  v_open_reqs int := 0; v_hash_ok boolean := false;
  v_marked boolean := false;
BEGIN
  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('assessment_id', p_assessment_id, 'verification_complete', false,
      'reason_codes', jsonb_build_array('ASSESSMENT_NOT_FOUND'));
  END IF;

  SELECT * INTO v_av FROM public.bn_means_assessment_version
   WHERE assessment_id = p_assessment_id AND frozen_reason = 'SUBMITTED'
   ORDER BY version_no DESC LIMIT 1;

  IF NOT FOUND THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','FROZEN_VERSION_MISSING',
      'message','This assessment has not been submitted, so there is nothing to verify.'));
    v_codes := v_codes || '"FROZEN_VERSION_MISSING"'::jsonb;
  ELSE
    v_hash_ok := (encode(digest(v_av.snapshot::text,'sha256'),'hex') = v_av.snapshot_hash);
    IF NOT v_hash_ok THEN
      v_block := v_block || jsonb_build_array(jsonb_build_object(
        'code','FROZEN_VERSION_TAMPERED',
        'message','The submitted version no longer matches its recorded fingerprint.'));
      v_codes := v_codes || '"FROZEN_VERSION_TAMPERED"'::jsonb;
    END IF;

    SELECT
      count(*),
      count(*) FILTER (WHERE status = 'PENDING'),
      count(*) FILTER (WHERE status = 'IN_PROGRESS'),
      count(*) FILTER (WHERE status = 'CLARIFICATION_PENDING'),
      count(*) FILTER (WHERE status = 'COMPLETED'),
      count(*) FILTER (WHERE status = 'CANCELLED'),
      count(*) FILTER (WHERE status = 'COMPLETED' AND outcome = 'VERIFIED'),
      count(*) FILTER (WHERE status = 'COMPLETED' AND outcome = 'REJECTED'),
      count(*) FILTER (WHERE status = 'COMPLETED' AND outcome = 'NOT_APPLICABLE')
      INTO v_total, v_pending, v_progress, v_clar, v_done, v_cancel,
           v_verified, v_rejected, v_na
      FROM public.bn_means_verification_work
     WHERE assessment_version_id = v_av.assessment_version_id;

    SELECT count(*) INTO v_open_reqs
      FROM public.bn_means_information_request r
     WHERE r.assessment_id = p_assessment_id
       AND r.origin_stage = 'VERIFICATION'
       AND r.is_blocking
       AND r.status NOT IN ('FULFILLED','CANCELLED');
  END IF;

  IF v_total = 0 AND v_av.assessment_version_id IS NOT NULL THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','NO_VERIFICATION_WORK',
      'message','No verification work exists for the submitted version.'));
    v_codes := v_codes || '"NO_VERIFICATION_WORK"'::jsonb;
  END IF;

  IF v_pending + v_progress > 0 THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','OUTSTANDING_VERIFICATION',
      'message', (v_pending + v_progress) || ' fact(s) still awaiting a verification decision.'));
    v_codes := v_codes || '"OUTSTANDING_VERIFICATION"'::jsonb;
  END IF;

  IF v_clar > 0 THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','CLARIFICATION_OUTSTANDING',
      'message', v_clar || ' fact(s) are waiting on a clarification response.'));
    v_codes := v_codes || '"CLARIFICATION_OUTSTANDING"'::jsonb;
  END IF;

  IF v_open_reqs > 0 THEN
    v_block := v_block || jsonb_build_array(jsonb_build_object(
      'code','OPEN_CLARIFICATION_REQUEST',
      'message', v_open_reqs || ' blocking clarification request(s) remain open.'));
    v_codes := v_codes || '"OPEN_CLARIFICATION_REQUEST"'::jsonb;
  END IF;

  IF v_rejected > 0 THEN
    v_warn := v_warn || jsonb_build_array(jsonb_build_object(
      'code','REJECTED_FACTS',
      'message', v_rejected || ' fact(s) were rejected. They will be excluded from calculation.'));
    v_codes := v_codes || '"REJECTED_FACTS"'::jsonb;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.bn_means_section_completion sc
                  WHERE sc.assessment_id = p_assessment_id
                    AND sc.section_code = 'VERIFICATION' AND sc.reopened_at IS NULL)
    INTO v_marked;

  RETURN jsonb_build_object(
    'assessment_id', p_assessment_id,
    'assessment_version_id', v_av.assessment_version_id,
    'version_no', v_av.version_no,
    'frozen_at', v_av.frozen_at,
    'snapshot_hash_valid', v_hash_ok,
    'status', v_a.status,
    'verification_complete', (jsonb_array_length(v_block) = 0),
    'verification_marked_complete', v_marked,
    'verification_outcome', CASE
        WHEN jsonb_array_length(v_block) > 0 THEN NULL
        WHEN v_rejected > 0 THEN 'VERIFIED_WITH_REJECTIONS'
        ELSE 'VERIFIED' END,
    'section_status', CASE
        WHEN v_marked THEN 'COMPLETE'
        WHEN jsonb_array_length(v_block) > 0 AND v_done = 0 THEN 'NOT_STARTED'
        WHEN jsonb_array_length(v_block) > 0 THEN 'IN_PROGRESS'
        ELSE 'READY_TO_COMPLETE' END,
    'total_work', v_total,
    'pending_work', v_pending,
    'in_progress_work', v_progress,
    'clarification_pending_work', v_clar,
    'completed_work', v_done,
    'cancelled_work', v_cancel,
    'verified_facts', v_verified,
    'rejected_facts', v_rejected,
    'not_applicable_facts', v_na,
    'open_clarification_requests', v_open_reqs,
    'warnings', v_warn,
    'blockers', v_block,
    'reason_codes', v_codes);
END;
$function$;

-- ---------- 5. Per-work allowed actions (backend-owned) ---------------
CREATE OR REPLACE FUNCTION public._bn_means_verification_work_actions(
  p_work public.bn_means_verification_work, p_actor uuid, p_can_verify boolean,
  p_independent boolean)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT CASE
    WHEN NOT p_can_verify OR NOT p_independent THEN '[]'::jsonb
    WHEN p_work.status = 'PENDING' THEN jsonb_build_array('BN_MEANS_CLAIM_VERIFICATION_WORK')
    WHEN p_work.status = 'IN_PROGRESS' AND p_work.claimed_by IS DISTINCT FROM p_actor
      THEN jsonb_build_array('BN_MEANS_CLAIM_VERIFICATION_WORK')
    WHEN p_work.status = 'IN_PROGRESS' THEN jsonb_build_array(
      'BN_MEANS_RECORD_VERIFICATION_DECISION','BN_MEANS_RELEASE_VERIFICATION_WORK')
    WHEN p_work.status = 'CLARIFICATION_PENDING' THEN jsonb_build_array(
      'BN_MEANS_RECORD_CLARIFICATION_RESPONSE','BN_MEANS_CANCEL_CLARIFICATION')
    WHEN p_work.status = 'COMPLETED' THEN jsonb_build_array('BN_MEANS_REOPEN_VERIFICATION_FACT')
    ELSE '[]'::jsonb END;
$function$;

-- ---------- 6. Secured query surfaces ---------------------------------
CREATE OR REPLACE FUNCTION public.bn_means_verification_reference_v1(p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_perm jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  RETURN jsonb_build_object('status','OK','data', public._bn_means_verification_reference());
END;
$function$;

CREATE OR REPLACE FUNCTION public.bn_means_verification_readiness_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_perm jsonb;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id) THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data', NULL);
  END IF;
  RETURN jsonb_build_object('status','OK',
    'data', public._bn_means_verification_readiness(p_assessment_id));
END;
$function$;

/** The verification workspace: frozen header, fact cards, evidence, actions. */
CREATE OR REPLACE FUNCTION public.bn_means_verification_workspace_v1(
  p_actor_user_id uuid, p_assessment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_perm  jsonb;
  v_write jsonb;
  v_a     public.bn_means_assessment%ROWTYPE;
  v_av    public.bn_means_assessment_version%ROWTYPE;
  v_facts jsonb := '[]'::jsonb;
  v_w     public.bn_means_verification_work%ROWTYPE;
  v_can   boolean := false;
  v_indep boolean := true;
  v_reason text := NULL;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;

  SELECT * INTO v_a FROM public.bn_means_assessment WHERE assessment_id = p_assessment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','NOT_FOUND','code','NOT_FOUND','data', NULL);
  END IF;

  SELECT * INTO v_av FROM public.bn_means_assessment_version
   WHERE assessment_id = p_assessment_id AND frozen_reason = 'SUBMITTED'
   ORDER BY version_no DESC LIMIT 1;

  v_write := public.bn_means_check_actor_permission(p_actor_user_id, 'verify', true);
  v_can := COALESCE((v_write->>'ok')::boolean,false);
  IF NOT v_can THEN v_reason := COALESCE(v_write->>'code','PERMISSION_DENIED'); END IF;

  IF v_av.assessment_version_id IS NOT NULL
     AND v_av.frozen_by IS NOT NULL
     AND v_av.frozen_by = p_actor_user_id THEN
    v_indep := false;
    v_reason := COALESCE(v_reason,'SELF_VERIFICATION_DENIED');
  END IF;

  IF v_av.assessment_version_id IS NOT NULL THEN
    FOR v_w IN
      SELECT * FROM public.bn_means_verification_work
       WHERE assessment_version_id = v_av.assessment_version_id
       ORDER BY CASE fact_kind
                  WHEN 'ASSESSMENT' THEN 0 WHEN 'HOUSEHOLD' THEN 1 WHEN 'INCOME' THEN 2
                  WHEN 'ASSET' THEN 3 WHEN 'DEDUCTION' THEN 4 ELSE 5 END,
                created_at
    LOOP
      v_facts := v_facts || jsonb_build_array(jsonb_build_object(
        'work_id', v_w.work_id,
        'fact_kind', v_w.fact_kind,
        'fact_ref_id', v_w.fact_ref_id,
        'fact_summary', v_w.fact_summary,
        'priority', v_w.priority,
        'status', v_w.status,
        'outcome', v_w.outcome,
        'outcome_reason_code', v_w.outcome_reason_code,
        'outcome_note', v_w.outcome_note,
        'decided_at', v_w.decided_at,
        'decided_by', v_w.decided_by,
        'claimed_by', v_w.claimed_by,
        'claimed_at', v_w.claimed_at,
        'claimed_by_me', (v_w.claimed_by IS NOT NULL AND v_w.claimed_by = p_actor_user_id),
        'review_round', v_w.review_round,
        'declared', public._bn_means_verification_declared(
                      v_av.snapshot, v_w.fact_kind, v_w.fact_ref_id),
        'evidence', public._bn_means_verification_evidence(
                      p_assessment_id, v_w.fact_kind, v_w.fact_ref_id),
        'clarification', public._bn_means_verification_clarification(v_w.clarification_request_id),
        'allowed_actions', public._bn_means_verification_work_actions(
                             v_w, p_actor_user_id, v_can, v_indep),
        'decision_history', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'verification_id', d.verification_id,
            'outcome', d.outcome,
            'reason_code', d.reason_code,
            'notes', d.notes,
            'verified_by', d.verified_by,
            'verified_at', d.verified_at,
            'review_round', d.review_round) ORDER BY d.verified_at DESC)
            FROM public.bn_means_verification d
           WHERE d.work_id = v_w.work_id), '[]'::jsonb)));
    END LOOP;
  END IF;

  RETURN jsonb_build_object('status','OK','data', jsonb_build_object(
    'assessment', jsonb_build_object(
      'assessment_id', v_a.assessment_id,
      'assessment_reference', v_a.assessment_reference,
      'benefit_programme', v_a.benefit_programme,
      'assessment_reason', v_a.assessment_reason,
      'status', v_a.status,
      'currency_code', v_a.currency_code,
      'effective_from', v_a.effective_from,
      'effective_to', v_a.effective_to,
      'row_version', v_a.row_version),
    'frozen_version', CASE WHEN v_av.assessment_version_id IS NULL THEN NULL ELSE
      jsonb_build_object(
        'assessment_version_id', v_av.assessment_version_id,
        'version_no', v_av.version_no,
        'frozen_at', v_av.frozen_at,
        'frozen_by', v_av.frozen_by,
        'snapshot_hash', v_av.snapshot_hash,
        'snapshot_hash_valid',
          (encode(digest(v_av.snapshot::text,'sha256'),'hex') = v_av.snapshot_hash)) END,
    'actor', jsonb_build_object(
      'can_verify', (v_can AND v_indep),
      'is_submitter', NOT v_indep,
      'denied_reason', CASE WHEN v_can AND v_indep THEN NULL ELSE v_reason END),
    'facts', v_facts,
    'readiness', public._bn_means_verification_readiness(p_assessment_id),
    'reference', public._bn_means_verification_reference()));
END;
$function$;

/** Queue of submitted assessments carrying outstanding verification work. */
CREATE OR REPLACE FUNCTION public.bn_means_verification_queue_v1(
  p_actor_user_id uuid, p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_perm jsonb;
  v_rows jsonb;
  v_total int;
  v_scope text;
  v_search text;
BEGIN
  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'read', false);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RETURN jsonb_build_object('status','DENIED','code', v_perm->>'code','data', NULL);
  END IF;

  v_scope  := COALESCE(NULLIF(p_filters->>'scope',''),'ALL');
  v_search := NULLIF(btrim(COALESCE(p_filters->>'search','')),'');

  WITH base AS (
    SELECT a.assessment_id, a.assessment_reference, a.person_id, a.benefit_programme,
           a.assessment_reason, a.status, a.currency_code, a.effective_from, a.effective_to,
           v.assessment_version_id, v.version_no, v.frozen_at, v.frozen_by,
           count(*)                                                              AS total_work,
           count(*) FILTER (WHERE w.status = 'PENDING')                          AS pending_work,
           count(*) FILTER (WHERE w.status = 'IN_PROGRESS')                      AS in_progress_work,
           count(*) FILTER (WHERE w.status = 'CLARIFICATION_PENDING')            AS clarification_work,
           count(*) FILTER (WHERE w.status = 'COMPLETED')                        AS completed_work,
           count(*) FILTER (WHERE w.claimed_by = p_actor_user_id
                              AND w.status IN ('IN_PROGRESS','CLARIFICATION_PENDING')) AS my_work,
           max(w.priority)                                                       AS top_priority,
           min(w.created_at)                                                     AS oldest_work_at
      FROM public.bn_means_verification_work w
      JOIN public.bn_means_assessment_version v
        ON v.assessment_version_id = w.assessment_version_id
      JOIN public.bn_means_assessment a ON a.assessment_id = w.assessment_id
     WHERE w.status <> 'CANCELLED'
       AND (COALESCE(p_filters->>'benefit_programme','') = ''
            OR a.benefit_programme = p_filters->>'benefit_programme')
       AND (v_search IS NULL OR a.assessment_reference ILIKE '%' || v_search || '%')
     GROUP BY a.assessment_id, a.assessment_reference, a.person_id, a.benefit_programme,
              a.assessment_reason, a.status, a.currency_code, a.effective_from, a.effective_to,
              v.assessment_version_id, v.version_no, v.frozen_at, v.frozen_by
  ), scoped AS (
    SELECT * FROM base
     WHERE CASE v_scope
             WHEN 'OUTSTANDING' THEN (pending_work + in_progress_work + clarification_work) > 0
             WHEN 'UNASSIGNED'  THEN pending_work > 0
             WHEN 'MINE'        THEN my_work > 0
             WHEN 'CLARIFICATION' THEN clarification_work > 0
             WHEN 'COMPLETED'   THEN (pending_work + in_progress_work + clarification_work) = 0
             ELSE true END
  )
  SELECT count(*)::int,
         COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.oldest_work_at) FILTER (WHERE x.rn > p_offset AND x.rn <= p_offset + p_limit), '[]'::jsonb)
    INTO v_total, v_rows
    FROM (SELECT s.*, row_number() OVER (ORDER BY s.oldest_work_at) AS rn FROM scoped s) x;

  RETURN jsonb_build_object('status','OK','data', v_rows, 'total_count', v_total);
END;
$function$;

-- ---------- 7. Governed verification command boundary ------------------
CREATE OR REPLACE FUNCTION public._bn_means_verification_execute(
  p_command_name text, p_assessment_id uuid, p_actor_user_id uuid,
  p_correlation_id uuid, p_reason_code text, p_justification text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_av      public.bn_means_assessment_version%ROWTYPE;
  v_w       public.bn_means_verification_work%ROWTYPE;
  v_req     public.bn_means_information_request%ROWTYPE;
  v_outcome text;
  v_reason  text;
  v_kind    text;
  v_new     uuid;
  v_ready   jsonb;
  v_status  text;
BEGIN
  SELECT * INTO v_av FROM public.bn_means_assessment_version
   WHERE assessment_id = p_assessment_id AND frozen_reason = 'SUBMITTED'
   ORDER BY version_no DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_FROZEN_VERSION_MISSING:%', p_assessment_id; END IF;
  IF encode(digest(v_av.snapshot::text,'sha256'),'hex') <> v_av.snapshot_hash THEN
    RAISE EXCEPTION 'E_FROZEN_VERSION_TAMPERED:%', v_av.assessment_version_id;
  END IF;
  -- Independence: whoever froze the submitted version cannot verify it.
  IF v_av.frozen_by IS NOT NULL AND v_av.frozen_by = p_actor_user_id THEN
    RAISE EXCEPTION 'E_SELF_VERIFICATION_DENIED:%', p_command_name;
  END IF;

  IF p_command_name = 'BN_MEANS_CLAIM_VERIFICATION_WORK' THEN
    SELECT * INTO v_w FROM public.bn_means_verification_work
     WHERE work_id = NULLIF(p_payload->>'work_id','')::uuid
       AND assessment_version_id = v_av.assessment_version_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND:verification work'; END IF;
    IF v_w.status NOT IN ('PENDING','IN_PROGRESS') THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% cannot be claimed', v_w.status;
    END IF;
    UPDATE public.bn_means_verification_work
       SET status = 'IN_PROGRESS', claimed_by = p_actor_user_id, claimed_at = now(),
           updated_at = now(), updated_by = p_actor_user_id
     WHERE work_id = v_w.work_id;
    RETURN jsonb_build_object('work_id', v_w.work_id, 'work_status','IN_PROGRESS',
                              'event_code','VERIFICATION_STARTED');

  ELSIF p_command_name = 'BN_MEANS_RELEASE_VERIFICATION_WORK' THEN
    SELECT * INTO v_w FROM public.bn_means_verification_work
     WHERE work_id = NULLIF(p_payload->>'work_id','')::uuid
       AND assessment_version_id = v_av.assessment_version_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND:verification work'; END IF;
    IF v_w.status <> 'IN_PROGRESS' THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% cannot be released', v_w.status;
    END IF;
    IF v_w.claimed_by IS DISTINCT FROM p_actor_user_id THEN
      RAISE EXCEPTION 'E_WORK_NOT_OWNED:%', v_w.work_id;
    END IF;
    UPDATE public.bn_means_verification_work
       SET status = 'PENDING', claimed_by = NULL, claimed_at = NULL,
           updated_at = now(), updated_by = p_actor_user_id
     WHERE work_id = v_w.work_id;
    RETURN jsonb_build_object('work_id', v_w.work_id, 'work_status','PENDING',
                              'event_code','VERIFICATION_WORK_RELEASED');

  ELSIF p_command_name = 'BN_MEANS_RECORD_VERIFICATION_DECISION' THEN
    SELECT * INTO v_w FROM public.bn_means_verification_work
     WHERE work_id = NULLIF(p_payload->>'work_id','')::uuid
       AND assessment_version_id = v_av.assessment_version_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND:verification work'; END IF;
    IF v_w.status <> 'IN_PROGRESS' THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% is not open for decision', v_w.status;
    END IF;
    IF v_w.claimed_by IS DISTINCT FROM p_actor_user_id THEN
      RAISE EXCEPTION 'E_WORK_NOT_OWNED:%', v_w.work_id;
    END IF;

    v_outcome := upper(COALESCE(p_payload->>'outcome',''));
    IF public._bn_means_verification_option('outcomes', v_outcome) IS NULL THEN
      RAISE EXCEPTION 'E_INVALID_VALUE:outcome';
    END IF;
    v_reason := COALESCE(NULLIF(p_reason_code,''), NULLIF(p_payload->>'reason_code',''));
    IF COALESCE((public._bn_means_verification_option('outcomes', v_outcome)->>'requires_reason')::boolean,false)
       AND v_reason IS NULL THEN
      RAISE EXCEPTION 'E_REASON_CODE_REQUIRED:%', v_outcome;
    END IF;

    -- Immutable decision history against the frozen version.
    v_kind := CASE WHEN v_w.fact_kind = 'ASSESSMENT' THEN 'CONTEXT' ELSE v_w.fact_kind END;
    INSERT INTO public.bn_means_verification(
      assessment_id, assessment_version_id, fact_kind, fact_id, outcome,
      evidence_checked, evidence_id, reason_code, notes, verified_by,
      correlation_id, work_id, review_round)
    VALUES (p_assessment_id, v_av.assessment_version_id, v_kind,
      COALESCE(v_w.fact_ref_id, p_assessment_id), v_outcome,
      COALESCE((p_payload->>'evidence_checked')::boolean, false),
      NULLIF(p_payload->>'evidence_id','')::uuid, v_reason,
      COALESCE(NULLIF(p_payload->>'note',''), NULLIF(p_justification,'')),
      p_actor_user_id, p_correlation_id, v_w.work_id, v_w.review_round)
    RETURNING verification_id INTO v_new;

    IF v_outcome = 'CLARIFICATION_REQUIRED' THEN
      IF COALESCE(p_payload->>'information_required','') = '' THEN
        RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:information_required';
      END IF;
      INSERT INTO public.bn_means_information_request(
        assessment_id, request_code, request_type, request_reference, requirement_code,
        subject_kind, subject_ref_id, recipient_kind, recipient_label, reason_code,
        information_required, details, status, due_date, is_blocking,
        origin_stage, work_id, requested_at, requested_by, correlation_id)
      VALUES (p_assessment_id, 'VERIFICATION_CLARIFICATION', 'CLARIFICATION_REQUEST',
        'CL-' || to_char(now(),'YYYYMMDD') || '-' || substr(gen_random_uuid()::text,1,6),
        NULL, v_w.fact_kind, v_w.fact_ref_id,
        COALESCE(p_payload->>'recipient_kind','CLAIMANT'),
        NULLIF(p_payload->>'recipient_label',''), v_reason,
        p_payload->>'information_required', NULLIF(p_payload->>'details',''),
        'OPEN', COALESCE(NULLIF(p_payload->>'due_date','')::date, current_date + 14),
        true, 'VERIFICATION', v_w.work_id, now(), p_actor_user_id, p_correlation_id)
      RETURNING request_id INTO v_new;

      UPDATE public.bn_means_verification_work
         SET status = 'CLARIFICATION_PENDING', outcome = 'CLARIFICATION_REQUIRED',
             outcome_reason_code = v_reason,
             outcome_note = NULLIF(p_payload->>'note',''),
             clarification_request_id = v_new,
             updated_at = now(), updated_by = p_actor_user_id
       WHERE work_id = v_w.work_id;

      RETURN jsonb_build_object('work_id', v_w.work_id, 'request_id', v_new,
        'work_status','CLARIFICATION_PENDING', 'outcome', v_outcome,
        'event_code','INFORMATION_REQUESTED');
    END IF;

    UPDATE public.bn_means_verification_work
       SET status = 'COMPLETED', outcome = v_outcome, outcome_reason_code = v_reason,
           outcome_note = COALESCE(NULLIF(p_payload->>'note',''), NULLIF(p_justification,'')),
           decided_at = now(), decided_by = p_actor_user_id,
           updated_at = now(), updated_by = p_actor_user_id
     WHERE work_id = v_w.work_id;

    -- Mirror the decision onto the fact register for downstream readiness.
    IF v_w.fact_kind = 'INCOME' THEN
      UPDATE public.bn_means_income_fact SET verification_status = v_outcome
       WHERE income_fact_id = v_w.fact_ref_id AND assessment_id = p_assessment_id;
    ELSIF v_w.fact_kind = 'ASSET' THEN
      UPDATE public.bn_means_asset_fact SET verification_status = v_outcome
       WHERE asset_fact_id = v_w.fact_ref_id AND assessment_id = p_assessment_id;
    ELSIF v_w.fact_kind = 'DEDUCTION' THEN
      UPDATE public.bn_means_deduction_fact SET verification_status = v_outcome
       WHERE deduction_fact_id = v_w.fact_ref_id AND assessment_id = p_assessment_id;
    ELSIF v_w.fact_kind = 'HOUSEHOLD' THEN
      UPDATE public.bn_means_household_member SET verification_status = v_outcome
       WHERE member_id = v_w.fact_ref_id AND assessment_id = p_assessment_id;
    ELSIF v_w.fact_kind = 'EVIDENCE' THEN
      UPDATE public.bn_means_evidence SET verification_status = v_outcome
       WHERE evidence_id = v_w.fact_ref_id AND assessment_id = p_assessment_id;
    END IF;

    RETURN jsonb_build_object('work_id', v_w.work_id, 'verification_id', v_new,
      'work_status','COMPLETED', 'outcome', v_outcome,
      'event_code', CASE v_outcome WHEN 'REJECTED' THEN 'VERIFICATION_FAILED'
                                   ELSE 'VERIFICATION_PASSED' END);

  ELSIF p_command_name = 'BN_MEANS_RECORD_CLARIFICATION_RESPONSE' THEN
    SELECT * INTO v_req FROM public.bn_means_information_request
     WHERE request_id = NULLIF(p_payload->>'request_id','')::uuid
       AND assessment_id = p_assessment_id AND origin_stage = 'VERIFICATION' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND:clarification request'; END IF;
    IF v_req.status IN ('FULFILLED','CANCELLED') THEN
      RAISE EXCEPTION 'E_INVALID_STATE:request is already closed';
    END IF;
    IF public._bn_means_verification_option('response_kinds',
         COALESCE(p_payload->>'response_kind','')) IS NULL THEN
      RAISE EXCEPTION 'E_INVALID_VALUE:response_kind';
    END IF;

    INSERT INTO public.bn_means_information_response(
      request_id, assessment_id, response_kind, note, evidence_link_id,
      correlation_id, recorded_by)
    VALUES (v_req.request_id, p_assessment_id, p_payload->>'response_kind',
      NULLIF(p_payload->>'note',''), NULLIF(p_payload->>'evidence_link_id','')::uuid,
      p_correlation_id, p_actor_user_id)
    RETURNING response_id INTO v_new;

    UPDATE public.bn_means_information_request
       SET status = CASE p_payload->>'response_kind'
                      WHEN 'FULL_RESPONSE' THEN 'FULFILLED'
                      WHEN 'PARTIAL_RESPONSE' THEN 'PARTIALLY_RESPONDED'
                      ELSE 'RESPONDED' END,
           responded_at = now(), responded_by = p_actor_user_id,
           response_summary = NULLIF(p_payload->>'note',''),
           closed_at = CASE WHEN p_payload->>'response_kind' = 'FULL_RESPONSE'
                            THEN now() ELSE closed_at END,
           closed_by = CASE WHEN p_payload->>'response_kind' = 'FULL_RESPONSE'
                            THEN p_actor_user_id ELSE closed_by END,
           updated_at = now(), updated_by = p_actor_user_id
     WHERE request_id = v_req.request_id;

    -- The fact returns for re-review; the declaration itself is untouched.
    UPDATE public.bn_means_verification_work
       SET status = 'IN_PROGRESS', outcome = NULL, outcome_reason_code = NULL,
           claimed_by = p_actor_user_id, claimed_at = now(),
           review_round = review_round + 1,
           updated_at = now(), updated_by = p_actor_user_id
     WHERE clarification_request_id = v_req.request_id;

    RETURN jsonb_build_object('request_id', v_req.request_id, 'response_id', v_new,
      'work_status','IN_PROGRESS', 'event_code','INFORMATION_RECEIVED');

  ELSIF p_command_name = 'BN_MEANS_CANCEL_CLARIFICATION' THEN
    SELECT * INTO v_req FROM public.bn_means_information_request
     WHERE request_id = NULLIF(p_payload->>'request_id','')::uuid
       AND assessment_id = p_assessment_id AND origin_stage = 'VERIFICATION' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND:clarification request'; END IF;
    IF v_req.status IN ('FULFILLED','CANCELLED') THEN
      RAISE EXCEPTION 'E_INVALID_STATE:request is already closed';
    END IF;
    IF COALESCE(NULLIF(p_reason_code,''), NULLIF(p_payload->>'reason_code','')) IS NULL THEN
      RAISE EXCEPTION 'E_MISSING_REQUIRED_INFORMATION:reason_code';
    END IF;
    UPDATE public.bn_means_information_request
       SET status = 'CANCELLED', closed_at = now(), closed_by = p_actor_user_id,
           close_reason_code = COALESCE(NULLIF(p_reason_code,''), p_payload->>'reason_code'),
           updated_at = now(), updated_by = p_actor_user_id
     WHERE request_id = v_req.request_id;
    UPDATE public.bn_means_verification_work
       SET status = 'IN_PROGRESS', outcome = NULL, outcome_reason_code = NULL,
           claimed_by = p_actor_user_id, claimed_at = now(),
           updated_at = now(), updated_by = p_actor_user_id
     WHERE clarification_request_id = v_req.request_id;
    RETURN jsonb_build_object('request_id', v_req.request_id, 'work_status','IN_PROGRESS',
      'event_code','INFORMATION_REQUEST_CLOSED');

  ELSIF p_command_name = 'BN_MEANS_REOPEN_VERIFICATION_FACT' THEN
    SELECT * INTO v_w FROM public.bn_means_verification_work
     WHERE work_id = NULLIF(p_payload->>'work_id','')::uuid
       AND assessment_version_id = v_av.assessment_version_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND:verification work'; END IF;
    IF v_w.status <> 'COMPLETED' THEN
      RAISE EXCEPTION 'E_INVALID_STATE:% cannot be reopened', v_w.status;
    END IF;
    v_reason := COALESCE(NULLIF(p_reason_code,''), NULLIF(p_payload->>'reason_code',''));
    IF v_reason IS NULL THEN RAISE EXCEPTION 'E_REASON_CODE_REQUIRED:REOPEN'; END IF;
    IF EXISTS (SELECT 1 FROM public.bn_means_section_completion sc
                WHERE sc.assessment_id = p_assessment_id
                  AND sc.section_code = 'VERIFICATION' AND sc.reopened_at IS NULL) THEN
      UPDATE public.bn_means_section_completion
         SET reopened_at = now(), reopened_by = p_actor_user_id, updated_at = now()
       WHERE assessment_id = p_assessment_id AND section_code = 'VERIFICATION';
    END IF;
    UPDATE public.bn_means_verification_work
       SET status = 'IN_PROGRESS', outcome = NULL, outcome_reason_code = NULL,
           outcome_note = NULL, decided_at = NULL, decided_by = NULL,
           claimed_by = p_actor_user_id, claimed_at = now(),
           reopened_at = now(), reopened_by = p_actor_user_id,
           reopen_reason_code = v_reason, review_round = review_round + 1,
           updated_at = now(), updated_by = p_actor_user_id
     WHERE work_id = v_w.work_id;
    RETURN jsonb_build_object('work_id', v_w.work_id, 'work_status','IN_PROGRESS',
      'event_code','VERIFICATION_STARTED');

  ELSIF p_command_name = 'BN_MEANS_COMPLETE_VERIFICATION' THEN
    v_ready := public._bn_means_verification_readiness(p_assessment_id);
    IF NOT COALESCE((v_ready->>'verification_complete')::boolean,false) THEN
      RAISE EXCEPTION 'E_SECTION_NOT_READY:VERIFICATION %', v_ready->>'reason_codes';
    END IF;
    INSERT INTO public.bn_means_section_completion(
      assessment_id, section_code, completed_at, completed_by)
    VALUES (p_assessment_id, 'VERIFICATION', now(), p_actor_user_id)
    ON CONFLICT (assessment_id, section_code)
      DO UPDATE SET completed_at = now(), completed_by = p_actor_user_id,
                    reopened_at = NULL, reopened_by = NULL, updated_at = now();
    v_status := v_ready->>'verification_outcome';
    RETURN jsonb_build_object('section_code','VERIFICATION',
      'verification_outcome', v_status,
      'ready_for_calculation', true,
      'event_code', CASE WHEN COALESCE((v_ready->>'rejected_facts')::int,0) > 0
                         THEN 'VERIFICATION_FAILED' ELSE 'VERIFICATION_PASSED' END);
  END IF;

  RAISE EXCEPTION 'E_COMMAND_NOT_IMPLEMENTED:%', p_command_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bn_means_verification_command_v1(
  p_command_name text, p_assessment_id uuid, p_actor_user_id uuid, p_actor_user_code text,
  p_correlation_id uuid, p_expected_row_version bigint, p_reason_code text,
  p_justification text, p_payload jsonb, p_payload_hash text, p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_perm  jsonb;
  v_prior public.bn_means_command_idempotency%ROWTYPE;
  v_a     public.bn_means_assessment%ROWTYPE;
  v_from  text;
  v_res   jsonb;
BEGIN
  IF p_actor_user_id IS NULL THEN RAISE EXCEPTION 'E_UNAUTHENTICATED:%', p_command_name; END IF;
  IF p_command_name NOT IN (
      'BN_MEANS_CLAIM_VERIFICATION_WORK','BN_MEANS_RELEASE_VERIFICATION_WORK',
      'BN_MEANS_RECORD_VERIFICATION_DECISION','BN_MEANS_RECORD_CLARIFICATION_RESPONSE',
      'BN_MEANS_CANCEL_CLARIFICATION','BN_MEANS_REOPEN_VERIFICATION_FACT',
      'BN_MEANS_COMPLETE_VERIFICATION') THEN
    RAISE EXCEPTION 'E_COMMAND_UNKNOWN:%', p_command_name;
  END IF;

  v_perm := public.bn_means_check_actor_permission(p_actor_user_id, 'verify', true);
  IF NOT COALESCE((v_perm->>'ok')::boolean,false) THEN
    RAISE EXCEPTION 'E_FORBIDDEN:%', COALESCE(v_perm->>'code','FORBIDDEN');
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_prior FROM public.bn_means_command_idempotency
     WHERE idempotency_key = p_idempotency_key AND command_name = p_command_name;
    IF FOUND THEN
      IF COALESCE(v_prior.payload_hash,'') <> COALESCE(p_payload_hash,'') THEN
        RAISE EXCEPTION 'E_IDEMPOTENCY_PAYLOAD_MISMATCH:%', p_command_name;
      END IF;
      RETURN COALESCE(v_prior.result_json,'{}'::jsonb) || jsonb_build_object('status','REPLAYED');
    END IF;
  END IF;

  SELECT * INTO v_a FROM public.bn_means_assessment
   WHERE assessment_id = p_assessment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_NOT_FOUND:assessment'; END IF;
  IF p_expected_row_version IS NOT NULL AND p_expected_row_version <> v_a.row_version THEN
    RAISE EXCEPTION 'E_VERSION_CONFLICT:% <> %', p_expected_row_version, v_a.row_version;
  END IF;
  IF v_a.status NOT IN ('SUBMITTED','VERIFICATION_PENDING') THEN
    RAISE EXCEPTION 'E_INVALID_STATE:% is not in verification', v_a.status;
  END IF;
  v_from := v_a.status;

  v_res := public._bn_means_verification_execute(p_command_name, p_assessment_id,
             p_actor_user_id, p_correlation_id, p_reason_code, p_justification,
             COALESCE(p_payload,'{}'::jsonb));

  UPDATE public.bn_means_assessment
     SET status = CASE WHEN status = 'SUBMITTED' THEN 'VERIFICATION_PENDING' ELSE status END,
         row_version = row_version + 1, updated_at = now(), updated_by = p_actor_user_id
   WHERE assessment_id = p_assessment_id RETURNING * INTO v_a;

  v_res := v_res || jsonb_build_object('assessment_id', p_assessment_id,
                                       'entity_version', v_a.row_version,
                                       'to_status', v_a.status);

  PERFORM public._bn_means_event(p_assessment_id,
    COALESCE(v_res->>'event_code','VERIFICATION_STARTED'), p_command_name, v_from, v_a.status,
    p_reason_code, p_justification, v_res, p_actor_user_id, p_actor_user_code,
    p_correlation_id, v_a.row_version);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.bn_means_command_idempotency(
      idempotency_key, command_name, payload_hash, assessment_id, entity_version,
      result_json, status, completed_at, actor_user_id)
    VALUES (p_idempotency_key, p_command_name, COALESCE(p_payload_hash,''), p_assessment_id,
      v_a.row_version, v_res, 'COMPLETED', now(), p_actor_user_id)
    ON CONFLICT (idempotency_key, command_name) DO NOTHING;
  END IF;

  RETURN v_res || jsonb_build_object('status','EXECUTED');
END;
$function$;

-- ---------- 8. Command → action mapping --------------------------------
CREATE OR REPLACE FUNCTION public._bn_means_action_for_command(p_command_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_command_name
    WHEN 'BN_MEANS_VERIFY_INFORMATION'             THEN 'verify'
    WHEN 'BN_MEANS_CLAIM_VERIFICATION_WORK'        THEN 'verify'
    WHEN 'BN_MEANS_RELEASE_VERIFICATION_WORK'      THEN 'verify'
    WHEN 'BN_MEANS_RECORD_VERIFICATION_DECISION'   THEN 'verify'
    WHEN 'BN_MEANS_RECORD_CLARIFICATION_RESPONSE'  THEN 'verify'
    WHEN 'BN_MEANS_CANCEL_CLARIFICATION'           THEN 'verify'
    WHEN 'BN_MEANS_REOPEN_VERIFICATION_FACT'       THEN 'verify'
    WHEN 'BN_MEANS_COMPLETE_VERIFICATION'          THEN 'verify'
    WHEN 'BN_MEANS_CALCULATE'                      THEN 'decide'
    WHEN 'BN_MEANS_REQUEST_ADJUSTMENT'             THEN 'adjust_request'
    WHEN 'BN_MEANS_APPROVE_ADJUSTMENT'             THEN 'adjust_approve'
    WHEN 'BN_MEANS_APPROVE'                        THEN 'approve'
    WHEN 'BN_MEANS_REJECT'                         THEN 'approve'
    WHEN 'BN_MEANS_ACTIVATE'                       THEN 'approve'
    ELSE 'write' END;
$$;

-- ---------- 9. Grants ---------------------------------------------------
REVOKE ALL ON FUNCTION public.bn_means_verification_command_v1(text,uuid,uuid,text,uuid,bigint,text,text,jsonb,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_verification_command_v1(text,uuid,uuid,text,uuid,bigint,text,text,jsonb,text,uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public._bn_means_verification_execute(text,uuid,uuid,uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bn_means_verification_execute(text,uuid,uuid,uuid,text,text,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.bn_means_verification_workspace_v1(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_verification_workspace_v1(uuid,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bn_means_verification_readiness_v1(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_verification_readiness_v1(uuid,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bn_means_verification_reference_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_verification_reference_v1(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bn_means_verification_queue_v1(uuid,jsonb,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bn_means_verification_queue_v1(uuid,jsonb,int,int) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public._bn_means_verification_readiness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._bn_means_verification_readiness(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._bn_means_verification_reference() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._bn_means_verification_reference() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._bn_means_verification_option(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._bn_means_verification_option(text,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._bn_means_verification_declared(jsonb,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._bn_means_verification_declared(jsonb,text,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._bn_means_verification_evidence(uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._bn_means_verification_evidence(uuid,text,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._bn_means_verification_clarification(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._bn_means_verification_clarification(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._bn_means_verification_work_actions(public.bn_means_verification_work,uuid,boolean,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._bn_means_verification_work_actions(public.bn_means_verification_work,uuid,boolean,boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._bn_means_verification_snapshot_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._bn_means_verification_snapshot_key(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._bn_means_verification_id_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._bn_means_verification_id_key(text) TO authenticated, service_role;
