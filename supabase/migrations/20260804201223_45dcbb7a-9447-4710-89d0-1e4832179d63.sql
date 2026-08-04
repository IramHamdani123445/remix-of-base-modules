-- ═══════════════════════════════════════════════════════════════════════
-- BN Life Certificates — lifecycle, record-scope, permission and evidence
-- correction pass. Forward-only. Module remains dark-launched.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Permission catalogue seed ──────────────────────────────────────
INSERT INTO public.module_actions (module_id, action_name, display_name, description, is_enabled)
SELECT m.id, a.action_name, a.display_name, a.description, true
  FROM public.app_modules m
  CROSS JOIN (VALUES
    ('view_all_records','View All Life Certificate Records','Bypass record scope and view every obligation'),
    ('view_sensitive_identity','View Sensitive Identity','View unmasked claimant identity fields'),
    ('view_evidence','View Evidence','View linked evidence metadata'),
    ('view_confidential_evidence','View Confidential Evidence','View evidence marked confidential'),
    ('generate','Generate Obligations','Generate life certificate obligations'),
    ('receive','Receive Evidence','Record receipt of life certificate evidence'),
    ('verify','Verify','Verify received evidence'),
    ('reject','Reject','Reject received evidence'),
    ('request_resubmission','Request Resubmission','Request replacement evidence'),
    ('waive','Waive','Waive the obligation'),
    ('defer','Defer','Defer the obligation'),
    ('send_reminder','Send Reminder','Process reminder milestones'),
    ('escalate','Escalate','Process due/grace/overdue milestones'),
    ('clear_scheduler_attempts','Clear Scheduler Attempts','Clear failed scheduler attempts and manual intervention flags'),
    ('propose_suspension','Propose Suspension','Raise an award suspension proposal'),
    ('propose_reinstatement','Propose Reinstatement','Raise an award reinstatement proposal'),
    ('audit','Audit','Read audit and timeline history'),
    ('admin','Administer','Administer life certificate policy and configuration')
  ) AS a(action_name, display_name, description)
 WHERE m.name = 'bn_life_certificate'
   AND NOT EXISTS (
     SELECT 1 FROM public.module_actions ex
      WHERE ex.module_id = m.id AND ex.action_name = a.action_name);

-- ── 2. Evidence semantics ─────────────────────────────────────────────
ALTER TABLE public.bn_life_certificate
  ADD COLUMN IF NOT EXISTS evidence_receipt_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS evidence_version_status text NOT NULL DEFAULT 'UNAVAILABLE',
  ADD COLUMN IF NOT EXISTS evidence_document_snapshot jsonb;

COMMENT ON COLUMN public.bn_life_certificate.evidence_receipt_revision IS
  'Number of times evidence was received or replaced for THIS obligation. Not a DMS document version.';
COMMENT ON COLUMN public.bn_life_certificate.evidence_version IS
  'DEPRECATED — always NULL. The document boundary exposes no DMS version. See evidence_version_status.';
COMMENT ON COLUMN public.bn_life_certificate.evidence_version_status IS
  'UNAVAILABLE — the document boundary exposes no authoritative document version.';

UPDATE public.bn_life_certificate
   SET evidence_receipt_revision = GREATEST(COALESCE(evidence_receipt_revision,0), COALESCE(evidence_version,0)),
       evidence_version = NULL,
       evidence_version_status = 'UNAVAILABLE'
 WHERE evidence_version IS NOT NULL OR evidence_version_status IS DISTINCT FROM 'UNAVAILABLE';

ALTER TABLE public.bn_life_certificate_case_evidence_link
  ADD COLUMN IF NOT EXISTS evidence_receipt_revision integer,
  ADD COLUMN IF NOT EXISTS evidence_version_status text NOT NULL DEFAULT 'UNAVAILABLE',
  ADD COLUMN IF NOT EXISTS evidence_document_snapshot jsonb;

-- ── 3. Record-scope guard on every user-invoked mutation ──────────────
DO $mig$
DECLARE r record; v_def text; v_needle text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, a.action
      FROM (VALUES
        ('bn_life_certificate_verify_v1','verify'),
        ('bn_life_certificate_reject_v1','reject'),
        ('bn_life_certificate_request_resubmission_v1','request_resubmission'),
        ('bn_life_certificate_waive_v1','waive'),
        ('bn_life_certificate_defer_v1','defer'),
        ('bn_life_certificate_escalate_to_suspension_v1','propose_suspension')
      ) AS a(fname, action)
      JOIN pg_proc p ON p.proname = a.fname
      JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    IF position('_bn_lc_require_record' in v_def) > 0 THEN CONTINUE; END IF;
    v_needle := format('PERFORM public._bn_lc_require(v_actor,''%s'');', r.action);
    IF position(v_needle in v_def) = 0 THEN
      RAISE EXCEPTION 'record guard anchor not found in %', r.proname;
    END IF;
    v_def := replace(v_def, v_needle,
      v_needle || E'\n  PERFORM public._bn_lc_require_record(v_actor, p_life_certificate_id);');
    EXECUTE v_def;
  END LOOP;
END $mig$;

-- ── 4. Dedicated permission for clearing scheduler attempts ───────────
CREATE OR REPLACE FUNCTION public.bn_life_certificate_clear_milestone_attempts_v1(
  p_life_certificate_id uuid, p_milestone text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_actor uuid; v_count integer;
BEGIN
  PERFORM public._bn_lc_assert_enabled();
  v_actor := public._bn_lc_actor();
  PERFORM public._bn_lc_require(v_actor,'clear_scheduler_attempts');
  PERFORM public._bn_lc_require_record(v_actor, p_life_certificate_id);

  UPDATE public.bn_life_certificate_scheduler_attempt
     SET failed_attempts = 0, manual_intervention_required = false, last_error_code = NULL,
         cleared_by_user_id = v_actor, cleared_at = now(), updated_at = now()
   WHERE life_certificate_id = p_life_certificate_id
     AND (p_milestone IS NULL OR milestone = p_milestone);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM public._bn_lc_audit(v_actor,'BN.LIFE_CERT.SCHEDULER_ATTEMPTS_CLEARED','update',
    p_life_certificate_id::text,'{}'::jsonb,
    jsonb_build_object('milestone', p_milestone,'cleared', v_count), NULL, NULL);

  RETURN jsonb_build_object('status','CLEARED','cleared', v_count);
END $function$;

-- ── 5. Corrected reminder → due lifecycle (due feed) ──────────────────
CREATE OR REPLACE FUNCTION public.bn_life_certificate_due_milestones_v1(
  p_as_of date DEFAULT NULL::date, p_limit integer DEFAULT 200)
RETURNS TABLE(life_certificate_id uuid, bn_award_id uuid, milestone text, milestone_date date,
              attempts integer, row_version integer, obligation_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cand AS (
    SELECT lc.id, lc.bn_award_id, lc.obligation_status, lc.row_version,
           lc.due_date, lc.grace_end_date, lc.reminder_count, lc.submitted_date, lc.document_id,
           COALESCE(p_as_of, public._bn_lc_today(lc.policy_snapshot->>'timezone')) AS as_of
      FROM public.bn_life_certificate lc
     WHERE lc.obligation_status IN ('NOT_DUE','DUE','REMINDER_SENT','GRACE')
       AND lc.due_date IS NOT NULL
  ), resolved AS (
    SELECT c.*,
      CASE
        WHEN c.grace_end_date IS NOT NULL AND c.as_of > c.grace_end_date THEN 'OVERDUE'
        WHEN c.grace_end_date IS NOT NULL AND c.as_of > c.due_date
             AND c.obligation_status <> 'GRACE' THEN 'GRACE'
        -- DUE is reachable from NOT_DUE and from REMINDER_SENT: reminder
        -- history must never block the obligation becoming due.
        WHEN c.obligation_status IN ('NOT_DUE','REMINDER_SENT') AND c.as_of >= c.due_date THEN 'DUE'
        -- Reminders are pre-due only, and stop once evidence exists.
        WHEN c.obligation_status IN ('NOT_DUE','REMINDER_SENT') AND c.as_of < c.due_date
             AND c.submitted_date IS NULL AND c.document_id IS NULL THEN
          (SELECT r.milestone FROM public._bn_lc_reminder_schedule(c.id) r
            WHERE r.reminder_date <= c.as_of AND r.reminder_index > c.reminder_count
            ORDER BY r.reminder_index LIMIT 1)
        ELSE NULL
      END AS milestone
    FROM cand c
  ), dated AS (
    SELECT r.*,
      CASE r.milestone
        WHEN 'OVERDUE' THEN r.grace_end_date
        WHEN 'GRACE' THEN r.due_date
        WHEN 'DUE' THEN r.due_date
        ELSE (SELECT s.reminder_date FROM public._bn_lc_reminder_schedule(r.id) s
               WHERE s.milestone = r.milestone LIMIT 1)
      END AS m_date
    FROM resolved r
  )
  SELECT d.id, d.bn_award_id, d.milestone, d.m_date,
         COALESCE(a.failed_attempts,0)::integer, d.row_version, d.obligation_status
    FROM dated d
    LEFT JOIN public.bn_life_certificate_scheduler_attempt a
      ON a.life_certificate_id = d.id AND a.milestone = d.milestone AND a.milestone_date = d.m_date
   WHERE d.milestone IS NOT NULL
   ORDER BY d.due_date
   LIMIT LEAST(GREATEST(COALESCE(p_limit,200),1),200);
$function$;

-- ── 6. Corrected milestone command ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bn_life_certificate_mark_milestone_v1(
  p_life_certificate_id uuid, p_milestone text,
  p_idempotency_key text DEFAULT NULL::text, p_correlation_id text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_actor uuid := auth.uid(); v_cert public.bn_life_certificate%ROWTYPE;
        v_to text; v_corr text; v_hash text; v_cached jsonb; v_result jsonb; v_event text;
        v_today date; v_idx integer; v_rdate date; v_mdate date; v_kind text;
BEGIN
  PERFORM public._bn_lc_assert_enabled();
  IF v_actor IS NOT NULL THEN
    IF p_milestone LIKE 'REMINDER%' THEN PERFORM public._bn_lc_require(v_actor,'send_reminder');
    ELSE PERFORM public._bn_lc_require(v_actor,'escalate'); END IF;
    -- Record scope is checked before any record state is exposed.
    PERFORM public._bn_lc_require_record(v_actor, p_life_certificate_id);
  ELSIF current_setting('role', true) NOT IN ('service_role') AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'E_UNAUTHENTICATED' USING ERRCODE='P0001';
  END IF;

  v_kind := CASE WHEN p_milestone ~ '^REMINDER_[0-9]+$' THEN 'REMINDER' ELSE p_milestone END;
  IF v_kind NOT IN ('DUE','REMINDER','GRACE','OVERDUE') THEN
    RAISE EXCEPTION 'E_INVALID_MILESTONE' USING ERRCODE='P0001'; END IF;

  SELECT * INTO v_cert FROM public.bn_life_certificate WHERE id=p_life_certificate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_OBLIGATION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF v_cert.obligation_status NOT IN ('NOT_DUE','DUE','REMINDER_SENT','GRACE') THEN
    RETURN jsonb_build_object('status','NO_OP','reason','TERMINAL_STATE',
                              'obligation_status', v_cert.obligation_status);
  END IF;

  -- Server-side date authority in the policy timezone. p_as_of is not accepted.
  v_today := public._bn_lc_today(v_cert.policy_snapshot->>'timezone');

  IF v_kind = 'DUE' THEN
    -- NOT_DUE → DUE and REMINDER_SENT → DUE are both valid.
    IF v_cert.obligation_status NOT IN ('NOT_DUE','REMINDER_SENT')
       OR v_cert.due_date IS NULL OR v_today < v_cert.due_date THEN
      RAISE EXCEPTION 'E_MILESTONE_NOT_DUE' USING ERRCODE='P0001'; END IF;
    v_mdate := v_cert.due_date;
  ELSIF v_kind = 'REMINDER' THEN
    -- Late reminders are refused: reminders are pre-due only.
    IF v_cert.obligation_status NOT IN ('NOT_DUE','REMINDER_SENT') THEN
      RETURN jsonb_build_object('status','NO_OP','reason','REMINDER_WINDOW_CLOSED',
                                'obligation_status', v_cert.obligation_status); END IF;
    IF v_cert.due_date IS NOT NULL AND v_today >= v_cert.due_date THEN
      RETURN jsonb_build_object('status','NO_OP','reason','DUE_DATE_REACHED',
                                'obligation_status', v_cert.obligation_status); END IF;
    IF v_cert.submitted_date IS NOT NULL OR v_cert.document_id IS NOT NULL THEN
      RETURN jsonb_build_object('status','NO_OP','reason','EVIDENCE_ALREADY_RECEIVED',
                                'obligation_status', v_cert.obligation_status); END IF;
    v_idx := split_part(p_milestone,'_',2)::integer;
    SELECT r.reminder_date INTO v_rdate FROM public._bn_lc_reminder_schedule(v_cert.id) r
     WHERE r.reminder_index = v_idx;
    IF v_rdate IS NULL THEN RAISE EXCEPTION 'E_INVALID_MILESTONE' USING ERRCODE='P0001'; END IF;
    IF v_today < v_rdate THEN RAISE EXCEPTION 'E_MILESTONE_NOT_DUE' USING ERRCODE='P0001'; END IF;
    IF v_cert.reminder_count >= v_idx THEN
      RETURN jsonb_build_object('status','NO_OP','reason','REMINDER_ALREADY_SENT',
                                'milestone', p_milestone); END IF;
    v_mdate := v_rdate;
  ELSIF v_kind = 'GRACE' THEN
    IF v_cert.due_date IS NULL OR v_today <= v_cert.due_date
       OR v_cert.grace_end_date IS NULL OR v_today > v_cert.grace_end_date
       OR v_cert.obligation_status = 'GRACE' THEN
      RAISE EXCEPTION 'E_MILESTONE_NOT_DUE' USING ERRCODE='P0001'; END IF;
    v_mdate := v_cert.due_date;
  ELSE
    IF v_cert.grace_end_date IS NULL OR v_today <= v_cert.grace_end_date THEN
      RAISE EXCEPTION 'E_MILESTONE_NOT_DUE' USING ERRCODE='P0001'; END IF;
    v_mdate := v_cert.grace_end_date;
  END IF;

  v_hash := encode(digest(coalesce(p_life_certificate_id::text,'')||'|'||p_milestone||'|'||v_mdate::text,'sha256'),'hex');
  v_cached := public._bn_susp_receipt_lookup(v_actor,'bn_life_certificate_mark_milestone_v1', p_idempotency_key, v_hash);
  IF v_cached IS NOT NULL THEN RETURN v_cached || jsonb_build_object('status','REPLAYED'); END IF;

  v_corr := COALESCE(p_correlation_id, v_cert.correlation_id, gen_random_uuid()::text);
  v_to := CASE v_kind WHEN 'DUE' THEN 'DUE' WHEN 'REMINDER' THEN 'REMINDER_SENT'
                      WHEN 'GRACE' THEN 'GRACE' ELSE 'OVERDUE' END;
  v_event := CASE v_kind
    WHEN 'DUE' THEN 'BN_LIFE_CERT_DUE'
    WHEN 'REMINDER' THEN 'BN_LIFE_CERT_REMINDER_'||v_idx::text
    WHEN 'GRACE' THEN 'BN_LIFE_CERT_GRACE_STARTED'
    ELSE 'BN_LIFE_CERT_OVERDUE' END;

  -- reminder_count / last_reminder_at are preserved across the due transition.
  UPDATE public.bn_life_certificate SET
    obligation_status = v_to,
    status = CASE WHEN v_to='OVERDUE' THEN 'OVERDUE' ELSE status END,
    escalation_status = CASE WHEN v_to='OVERDUE' THEN 'PENDING' ELSE escalation_status END,
    reminder_count = CASE WHEN v_kind='REMINDER' THEN v_idx ELSE reminder_count END,
    last_reminder_at = CASE WHEN v_kind='REMINDER' THEN now() ELSE last_reminder_at END,
    row_version = row_version + 1, correlation_id = v_corr, modified_at = now()
  WHERE id = v_cert.id;

  PERFORM public._bn_lc_event(v_cert.id,'MILESTONE_'||p_milestone, v_cert.obligation_status, v_to,
    v_actor, NULL, NULL, v_corr, p_idempotency_key,
    jsonb_build_object('milestone', p_milestone,'milestone_date', v_mdate,'server_date', v_today));
  PERFORM public._bn_lc_audit(v_actor,'BN.LIFE_CERT.MILESTONE','update', v_cert.id::text,
    jsonb_build_object('obligation_status', v_cert.obligation_status),
    jsonb_build_object('obligation_status', v_to), v_corr, p_milestone);
  PERFORM public._bn_lc_comm(v_cert.id, v_cert.bn_award_id, v_event,
    jsonb_build_object('milestone', p_milestone,'milestone_date', v_mdate), v_corr,
    'lc-milestone:'||v_cert.id::text||':'||p_milestone||':'||v_mdate::text);

  UPDATE public.bn_life_certificate_scheduler_attempt
     SET failed_attempts = 0, manual_intervention_required = false,
         last_error_code = NULL, updated_at = now()
   WHERE life_certificate_id = v_cert.id AND milestone = p_milestone AND milestone_date = v_mdate;

  v_result := jsonb_build_object('status','APPLIED','life_certificate_id', v_cert.id,
    'milestone', p_milestone,'milestone_date', v_mdate,'obligation_status', v_to,
    'row_version', v_cert.row_version+1,'correlation_id', v_corr);
  PERFORM public._bn_susp_receipt_store(v_actor,'bn_life_certificate_mark_milestone_v1', p_idempotency_key, v_hash, v_result, v_corr);
  RETURN v_result;
END $function$;

-- ── 7. Evidence receipt with honest revision semantics ────────────────
CREATE OR REPLACE FUNCTION public.bn_life_certificate_receive_v1(
  p_life_certificate_id uuid, p_received_date date, p_document_id uuid, p_evidence_type text,
  p_issuing_authority text, p_certificate_date date, p_received_channel text,
  p_narrative text DEFAULT NULL::text, p_expected_row_version integer DEFAULT NULL::integer,
  p_idempotency_key text DEFAULT NULL::text, p_correlation_id text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid; v_hash text; v_cached jsonb; v_cert public.bn_life_certificate%ROWTYPE;
  v_award public.bn_award%ROWTYPE; v_doc public.bn_claim_document%ROWTYPE;
  v_corr text; v_result jsonb; v_accepted text[]; v_integrity text;
  v_revision integer; v_snapshot jsonb;
BEGIN
  PERFORM public._bn_lc_assert_enabled();
  v_actor := public._bn_lc_actor();
  PERFORM public._bn_lc_require(v_actor,'receive');
  PERFORM public._bn_lc_require_record(v_actor, p_life_certificate_id);

  v_hash := encode(digest(coalesce(p_life_certificate_id::text,'')||'|'||coalesce(p_received_date::text,'')||'|'||
    coalesce(p_document_id::text,'')||'|'||coalesce(p_evidence_type,'')||'|'||
    coalesce(p_certificate_date::text,''),'sha256'),'hex');
  v_cached := public._bn_susp_receipt_lookup(v_actor,'bn_life_certificate_receive_v1', p_idempotency_key, v_hash);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_cert FROM public.bn_life_certificate WHERE id = p_life_certificate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_OBLIGATION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF p_expected_row_version IS NOT NULL AND v_cert.row_version <> p_expected_row_version THEN
    RAISE EXCEPTION 'E_STALE_ROW_VERSION' USING ERRCODE='P0001';
  END IF;
  IF v_cert.obligation_status NOT IN ('NOT_DUE','DUE','REMINDER_SENT','GRACE','OVERDUE','RESUBMISSION_REQUIRED','REJECTED') THEN
    RAISE EXCEPTION 'E_INVALID_STATE' USING ERRCODE='P0001';
  END IF;
  v_corr := COALESCE(p_correlation_id, v_cert.correlation_id, gen_random_uuid()::text);

  SELECT * INTO v_award FROM public.bn_award WHERE id = v_cert.bn_award_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_AWARD_NOT_FOUND' USING ERRCODE='P0001'; END IF;

  IF p_document_id IS NULL THEN RAISE EXCEPTION 'E_EVIDENCE_REQUIRED' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_doc FROM public.bn_claim_document WHERE id = p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'E_EVIDENCE_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF v_award.bn_claim_id IS NULL OR v_doc.claim_id <> v_award.bn_claim_id THEN
    RAISE EXCEPTION 'E_EVIDENCE_WRONG_CLAIMANT' USING ERRCODE='P0001';
  END IF;
  IF COALESCE(v_doc.verification_status,'') = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'E_EVIDENCE_SUPERSEDED' USING ERRCODE='P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bn_life_certificate lc
             WHERE lc.document_id = p_document_id AND lc.id <> v_cert.id) THEN
    RAISE EXCEPTION 'E_EVIDENCE_ALREADY_USED' USING ERRCODE='P0001';
  END IF;

  v_accepted := COALESCE((SELECT array_agg(x::text) FROM jsonb_array_elements_text(
    COALESCE(v_cert.policy_snapshot->'accepted_evidence_types','[]'::jsonb)) x), '{}'::text[]);
  IF cardinality(v_accepted) > 0 AND NOT (p_evidence_type = ANY (v_accepted)) THEN
    RAISE EXCEPTION 'E_EVIDENCE_TYPE_NOT_ACCEPTED' USING ERRCODE='P0001';
  END IF;
  IF p_certificate_date IS NULL OR p_certificate_date > COALESCE(p_received_date, current_date) THEN
    RAISE EXCEPTION 'E_INVALID_CERTIFICATE_DATE' USING ERRCODE='P0001';
  END IF;

  -- The document boundary exposes neither a document version nor a content
  -- checksum. Both are recorded as UNAVAILABLE; only the obligation-level
  -- receipt revision is incremented, and only real metadata is snapshotted.
  v_integrity := 'UNAVAILABLE';
  v_revision := COALESCE(v_cert.evidence_receipt_revision,0) + 1;
  v_snapshot := jsonb_build_object(
    'document_id', v_doc.id,
    'document_type_code', v_doc.document_type_code,
    'document_name', v_doc.document_name,
    'file_name', v_doc.file_name,
    'file_size', v_doc.file_size,
    'mime_type', v_doc.mime_type,
    'document_created_at', COALESCE(v_doc.uploaded_at, v_doc.entered_at),
    'dms_integrity_status', v_integrity,
    'dms_version_status','UNAVAILABLE',
    'evidence_receipt_revision', v_revision,
    'evidence_received_at', now());

  UPDATE public.bn_life_certificate SET
    submitted_date = COALESCE(p_received_date, current_date),
    document_ref = v_doc.file_name,
    document_id = p_document_id,
    evidence_type = p_evidence_type,
    evidence_checksum = NULL,
    evidence_integrity_status = v_integrity,
    evidence_version = NULL,
    evidence_version_status = 'UNAVAILABLE',
    evidence_receipt_revision = v_revision,
    evidence_document_snapshot = v_snapshot,
    issuing_authority = p_issuing_authority,
    certificate_date = p_certificate_date,
    received_channel = p_received_channel,
    received_by_user_id = v_actor,
    received_at = now(),
    remarks = COALESCE(p_narrative, remarks),
    obligation_status = 'RECEIVED',
    evidence_status = 'LINKED',
    verification_status = 'NOT_STARTED',
    status = 'RECEIVED',
    row_version = row_version + 1,
    correlation_id = v_corr,
    modified_by = public._bn_susp_user_code(v_actor),
    modified_at = now()
  WHERE id = v_cert.id;

  PERFORM public._bn_lc_event(v_cert.id,'RECEIPT_RECORDED', v_cert.obligation_status,'RECEIVED',
    v_actor, NULL, p_narrative, v_corr, p_idempotency_key,
    jsonb_build_object('channel', p_received_channel,'evidence_type', p_evidence_type,
                       'evidence_integrity_status', v_integrity,
                       'evidence_version_status','UNAVAILABLE',
                       'evidence_receipt_revision', v_revision));
  PERFORM public._bn_lc_audit(v_actor,'BN.LIFE_CERT.RECEIVED','update', v_cert.id::text,
    jsonb_build_object('obligation_status', v_cert.obligation_status),
    jsonb_build_object('obligation_status','RECEIVED','evidence_receipt_revision', v_revision), v_corr, NULL);
  PERFORM public._bn_lc_comm(v_cert.id, v_cert.bn_award_id,'BN_LIFE_CERT_RECEIVED',
    jsonb_build_object('period', v_cert.obligation_period), v_corr,
    'lc-received:'||v_cert.id::text||':'||v_revision::text);

  v_result := jsonb_build_object('status','RECEIVED','life_certificate_id', v_cert.id,
    'evidence_integrity_status', v_integrity,
    'evidence_version_status','UNAVAILABLE',
    'evidence_receipt_revision', v_revision,
    'evidence_document_snapshot', v_snapshot,
    'row_version', v_cert.row_version + 1,'correlation_id', v_corr);
  PERFORM public._bn_susp_receipt_store(v_actor,'bn_life_certificate_receive_v1',
                                        p_idempotency_key, v_hash, v_result, v_corr);
  RETURN v_result;
END $function$;

-- ── 8. Reinstatement evidence link uses the corrected semantics ───────
DO $mig2$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='bn_life_certificate_propose_reinstatement_v1';

  v_def := replace(v_def,
    E'(suspension_event_id, life_certificate_id, case_kind, document_id, evidence_version,\n     evidence_integrity_status, verification_decision, verified_by_user_id, correlation_id)',
    E'(suspension_event_id, life_certificate_id, case_kind, document_id, evidence_version,\n     evidence_receipt_revision, evidence_version_status, evidence_document_snapshot,\n     evidence_integrity_status, verification_decision, verified_by_user_id, correlation_id)');
  v_def := replace(v_def,
    E'          v_cert.evidence_version, v_cert.evidence_integrity_status,''VERIFIED'',',
    E'          NULL, v_cert.evidence_receipt_revision, ''UNAVAILABLE'', v_cert.evidence_document_snapshot,\n          v_cert.evidence_integrity_status,''VERIFIED'',');
  v_def := replace(v_def,
    E'''evidence_version'', v_cert.evidence_version)',
    E'''evidence_receipt_revision'', v_cert.evidence_receipt_revision,\n                       ''evidence_version_status'',''UNAVAILABLE'')');

  IF position('evidence_receipt_revision' in v_def) = 0 THEN
    RAISE EXCEPTION 'reinstatement evidence-link rewrite anchors not found';
  END IF;
  EXECUTE v_def;
END $mig2$;
