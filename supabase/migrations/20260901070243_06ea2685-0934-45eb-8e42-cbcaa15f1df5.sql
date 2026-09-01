
-- ─────────────────────────────────────────────────────────────
-- Enterprise Legal Return & Rework Control Queue
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ce_legal_return_ref (
  domain        text NOT NULL,
  code          text NOT NULL,
  label         text NOT NULL,
  tone          text,
  display_order integer NOT NULL DEFAULT 0,
  numeric_value numeric,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (domain, code)
);

GRANT SELECT ON public.ce_legal_return_ref TO authenticated;
GRANT ALL ON public.ce_legal_return_ref TO service_role;
ALTER TABLE public.ce_legal_return_ref ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ce_legal_return_ref_read" ON public.ce_legal_return_ref;
CREATE POLICY "ce_legal_return_ref_read" ON public.ce_legal_return_ref
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.ce_legal_return_ref (domain, code, label, tone, display_order) VALUES
  ('RETURN_REASON','MISSING_DOCUMENT','Missing document','destructive',10),
  ('RETURN_REASON','INCORRECT_CALCULATION','Incorrect financial calculation','destructive',20),
  ('RETURN_REASON','INCOMPLETE_EVIDENCE','Incomplete evidence','warning',30),
  ('RETURN_REASON','MISSING_APPROVAL','Missing approval','destructive',40),
  ('RETURN_REASON','INCORRECT_PARTY_DATA','Incorrect employer / case data','warning',50),
  ('RETURN_REASON','ADDITIONAL_INFO','Additional information required','info',60),
  ('RETURN_REASON','PACK_VERSION_ISSUE','Pack version issue','warning',70),
  ('RETURN_REASON','OTHER','Other (see comments)','muted',80),
  ('RETURN_STATUS','OPEN','Open','destructive',10),
  ('RETURN_STATUS','IN_PROGRESS','In rework','warning',20),
  ('RETURN_STATUS','RESOLVED','Resolved','success',30),
  ('RETURN_STATUS','CANCELLED','Cancelled','muted',40),
  ('REWORK_STATUS','NOT_STARTED','Not started','destructive',10),
  ('REWORK_STATUS','IN_REWORK','In rework','warning',20),
  ('REWORK_STATUS','WAITING_DOCUMENTS','Waiting for documents','warning',30),
  ('REWORK_STATUS','READY_FOR_RESUBMISSION','Ready for resubmission','info',40),
  ('REWORK_STATUS','RESUBMITTED','Resubmitted to approval','success',50),
  ('REWORK_STATUS','RESOLVED','Rework complete','success',60)
ON CONFLICT (domain, code) DO UPDATE
  SET label = EXCLUDED.label, tone = EXCLUDED.tone, display_order = EXCLUDED.display_order, updated_at = now();

-- ── Return record extension ──────────────────────────────────
ALTER TABLE public.ce_legal_returns
  ADD COLUMN IF NOT EXISTS return_seq            integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reason_code           text,
  ADD COLUMN IF NOT EXISTS comments              text,
  ADD COLUMN IF NOT EXISTS returned_by_name      text,
  ADD COLUMN IF NOT EXISTS returned_pack_version integer,
  ADD COLUMN IF NOT EXISTS rework_version_no     integer,
  ADD COLUMN IF NOT EXISTS rework_status         text NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN IF NOT EXISTS assigned_to           text,
  ADD COLUMN IF NOT EXISTS assigned_to_name      text,
  ADD COLUMN IF NOT EXISTS assigned_by           text,
  ADD COLUMN IF NOT EXISTS assigned_at           timestamptz,
  ADD COLUMN IF NOT EXISTS due_date              date,
  ADD COLUMN IF NOT EXISTS rework_started_at     timestamptz,
  ADD COLUMN IF NOT EXISTS rework_started_by     text,
  ADD COLUMN IF NOT EXISTS resolution_summary    text,
  ADD COLUMN IF NOT EXISTS resolved_by_name      text,
  ADD COLUMN IF NOT EXISTS resubmitted_at        timestamptz,
  ADD COLUMN IF NOT EXISTS resubmitted_by        text,
  ADD COLUMN IF NOT EXISTS follow_up_action_id   uuid;

CREATE INDEX IF NOT EXISTS ix_ce_legal_returns_referral ON public.ce_legal_returns (referral_id);
CREATE INDEX IF NOT EXISTS ix_ce_legal_returns_status   ON public.ce_legal_returns (resolution_status, returned_at DESC);

-- ── Label helper ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ce_legal_return_label(_domain text, _code text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object('code', r.code, 'label', r.label, 'tone', r.tone)
       FROM public.ce_legal_return_ref r
      WHERE r.domain = _domain AND r.code = _code),
    CASE WHEN _code IS NULL THEN jsonb_build_object('code', NULL, 'label', '—', 'tone', 'muted')
         ELSE jsonb_build_object('code', _code, 'label', 'Unmapped ' ||
              CASE _domain WHEN 'RETURN_REASON' THEN 'return reason'
                           WHEN 'REWORK_STATUS' THEN 'rework status'
                           ELSE 'return status' END, 'tone', 'muted') END);
$$;

CREATE OR REPLACE FUNCTION public.ce_legal_return_setting(_key text, _default numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT NULLIF(s.setting_value, '')::numeric FROM public.ce_settings s
                    WHERE s.setting_key = _key), _default);
$$;

-- ── Canonical register view ──────────────────────────────────
CREATE OR REPLACE VIEW public.ce_v_legal_return_register AS
SELECT
  t.id                            AS return_id,
  t.referral_id,
  t.return_seq,
  t.returned_at,
  t.returned_by,
  COALESCE(t.returned_by_name, t.returned_by) AS returned_by_display,
  t.reason_code,
  t.reason                        AS reason_text,
  t.comments,
  t.required_action,
  t.resolution_status,
  t.rework_status,
  t.assigned_to,
  t.assigned_to_name,
  t.assigned_at,
  t.due_date,
  t.rework_started_at,
  t.resolved_at,
  t.resolved_by,
  t.resolution_notes,
  t.resolution_summary,
  t.resubmitted_at,
  t.returned_pack_version,
  t.follow_up_action_id,
  r.referral_number,
  r.status                        AS referral_status,
  r.employer_id                   AS employer_reg_no,
  r.employer_name,
  r.employer_zone                 AS zone,
  r.source_case_id                AS ce_case_id,
  c.case_number                   AS ce_case_number,
  r.lg_intake_id,
  r.lg_intake_no,
  r.lg_case_no,
  r.legal_case_id,
  r.court_case_number,
  r.total_principal,
  r.total_penalties,
  r.total_interest,
  COALESCE(r.grand_total, r.total_referred_amount, 0)::numeric AS total_referred,
  COALESCE(pk.required_items, 0)   AS pack_required_items,
  COALESCE(pk.required_complete,0) AS pack_required_complete,
  COALESCE(pk.missing_required, 0) AS pack_missing_required,
  COALESCE(pv.current_version, 0)  AS current_pack_version,
  (SELECT count(*) FROM public.ce_legal_returns x WHERE x.referral_id = t.referral_id) AS total_returns,
  EXTRACT(EPOCH FROM (COALESCE(t.resubmitted_at, t.resolved_at, now()) - t.returned_at)) / 3600.0 AS rework_hours
FROM public.ce_legal_returns t
JOIN public.ce_legal_referrals r ON r.id = t.referral_id
LEFT JOIN public.ce_cases c ON c.id = r.source_case_id
LEFT JOIN LATERAL (
  SELECT count(*) FILTER (WHERE i.is_required) AS required_items,
         count(*) FILTER (WHERE i.is_required AND i.is_satisfied) AS required_complete,
         count(*) FILTER (WHERE i.is_required AND NOT i.is_satisfied) AS missing_required
    FROM public.ce_legal_pack_items i WHERE i.referral_id = t.referral_id
) pk ON true
LEFT JOIN LATERAL (
  SELECT max(v.version_no) AS current_version
    FROM public.ce_legal_pack_version v WHERE v.referral_id = t.referral_id
) pv ON true;

GRANT SELECT ON public.ce_v_legal_return_register TO authenticated, service_role;

-- ── Create return (Legal-owned action) ───────────────────────
CREATE OR REPLACE FUNCTION public.ce_legal_return_create_v1(
  p_referral_id uuid,
  p_reason_code text,
  p_reason text,
  p_required_action text DEFAULT NULL,
  p_comments text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text; v_name text;
  r public.ce_legal_referrals%ROWTYPE;
  v_seq int; v_ver int; v_sla int; v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.ce_actor_can(v_uid, 'compliance.enforcement.legal') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED_LEGAL_RETURN';
  END IF;
  v_code := public.ce_actor_code(v_uid);
  v_name := public.ce_actor_display_name(v_uid);
  IF v_code IS NULL OR upper(v_code) = 'SYSTEM' THEN RAISE EXCEPTION 'ACTOR_NOT_RESOLVABLE'; END IF;

  SELECT * INTO r FROM public.ce_legal_referrals WHERE id = p_referral_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REFERRAL_NOT_FOUND'; END IF;

  SELECT COALESCE(max(return_seq), 0) + 1 INTO v_seq
    FROM public.ce_legal_returns WHERE referral_id = p_referral_id;
  SELECT max(version_no) INTO v_ver FROM public.ce_legal_pack_version WHERE referral_id = p_referral_id;
  v_sla := public.ce_legal_return_setting('compliance.legal.rework_sla_days', 5)::int;

  INSERT INTO public.ce_legal_returns
    (referral_id, return_seq, returned_at, returned_by, returned_by_name, reason_code, reason,
     comments, required_action, resolution_status, rework_status, returned_pack_version, due_date)
  VALUES (p_referral_id, v_seq, now(), v_code, v_name, COALESCE(p_reason_code,'OTHER'),
     COALESCE(p_reason, 'Returned by Legal'), p_comments, p_required_action,
     'OPEN', 'NOT_STARTED', v_ver, (now() + make_interval(days => v_sla))::date)
  RETURNING id INTO v_id;

  -- Referral re-enters Compliance rework, not a terminal rejection
  UPDATE public.ce_legal_referrals
     SET status = 'RETURNED',
         returned_at = now(), returned_by = v_code, return_reason = COALESCE(p_reason,'Returned by Legal'),
         updated_at = now(), updated_by = v_code
   WHERE id = p_referral_id;

  UPDATE public.ce_legal_pack_version
     SET status = 'RETURNED', returned_at = now(), returned_by = v_code,
         return_reason = COALESCE(p_reason,'Returned by Legal'), updated_at = now()
   WHERE referral_id = p_referral_id AND version_no = v_ver;

  INSERT INTO public.ce_legal_pack_event (referral_id, version_no, event_code, description, actor_code, actor_name, payload)
  VALUES (p_referral_id, v_ver, 'RETURNED_BY_LEGAL',
          'Return #' || v_seq || ' — ' || COALESCE(p_reason,'Returned by Legal'), v_code, v_name,
          jsonb_build_object('reason_code', p_reason_code, 'required_action', p_required_action, 'comments', p_comments));

  INSERT INTO public.ce_audit_log (entity_type, entity_id, action, description, performed_by, new_values)
  VALUES ('ce_legal_return', v_id, 'RETURNED_BY_LEGAL',
          'Referral ' || COALESCE(r.referral_number,'') || ' returned by Legal', v_code,
          jsonb_build_object('reason_code', p_reason_code, 'reason', p_reason, 'return_seq', v_seq));

  RETURN jsonb_build_object('status','RETURNED','return_id', v_id, 'return_seq', v_seq);
END $$;

GRANT EXECUTE ON FUNCTION public.ce_legal_return_create_v1(uuid, text, text, text, text) TO authenticated;

-- ── Assign rework owner (+ optional follow-up task) ──────────
CREATE OR REPLACE FUNCTION public.ce_legal_return_assign_v1(
  p_return_id uuid,
  p_assignee_code text,
  p_assignee_name text DEFAULT NULL,
  p_due_date date DEFAULT NULL,
  p_create_task boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text; v_name text;
  t public.ce_legal_returns%ROWTYPE;
  r public.ce_legal_referrals%ROWTYPE;
  v_task uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.ce_actor_can(v_uid, 'compliance.enforcement.legal') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED_RETURN_ASSIGN';
  END IF;
  v_code := public.ce_actor_code(v_uid);
  v_name := public.ce_actor_display_name(v_uid);
  IF v_code IS NULL OR upper(v_code) = 'SYSTEM' THEN RAISE EXCEPTION 'ACTOR_NOT_RESOLVABLE'; END IF;

  SELECT * INTO t FROM public.ce_legal_returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RETURN_NOT_FOUND'; END IF;
  IF t.resolution_status IN ('RESOLVED','CANCELLED') THEN RAISE EXCEPTION 'RETURN_ALREADY_CLOSED'; END IF;
  SELECT * INTO r FROM public.ce_legal_referrals WHERE id = t.referral_id;

  IF p_create_task AND t.follow_up_action_id IS NULL THEN
    INSERT INTO public.ce_follow_up_actions
      (employer_id, employer_name, action_type, description, priority, status,
       assigned_to_user_id, assigned_to_name, due_date, source, notes, created_by)
    VALUES (r.employer_id, r.employer_name, 'LEGAL_REWORK',
       'Legal return rework — referral ' || COALESCE(r.referral_number,'') || ': ' ||
         COALESCE(t.required_action, t.reason),
       'HIGH', 'PENDING', p_assignee_code, COALESCE(p_assignee_name, p_assignee_code),
       COALESCE(p_due_date, t.due_date), 'LEGAL_RETURN', t.reason, v_code)
    RETURNING id INTO v_task;
  END IF;

  UPDATE public.ce_legal_returns
     SET assigned_to = p_assignee_code,
         assigned_to_name = COALESCE(p_assignee_name, p_assignee_code),
         assigned_by = v_code, assigned_at = now(),
         due_date = COALESCE(p_due_date, due_date),
         follow_up_action_id = COALESCE(follow_up_action_id, v_task),
         updated_at = now()
   WHERE id = p_return_id;

  INSERT INTO public.ce_legal_pack_event (referral_id, version_no, event_code, description, actor_code, actor_name, payload)
  VALUES (t.referral_id, t.returned_pack_version, 'REWORK_ASSIGNED',
          'Rework assigned to ' || COALESCE(p_assignee_name, p_assignee_code), v_code, v_name,
          jsonb_build_object('return_id', p_return_id, 'task_id', v_task));

  RETURN jsonb_build_object('status','ASSIGNED','task_id', v_task);
END $$;

GRANT EXECUTE ON FUNCTION public.ce_legal_return_assign_v1(uuid, text, text, date, boolean) TO authenticated;

-- ── Start / progress rework ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.ce_legal_return_set_rework_status_v1(
  p_return_id uuid, p_rework_status text, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text; v_name text;
  t public.ce_legal_returns%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.ce_actor_can(v_uid, 'compliance.enforcement.legal') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED_RETURN_REWORK';
  END IF;
  IF p_rework_status NOT IN ('NOT_STARTED','IN_REWORK','WAITING_DOCUMENTS','READY_FOR_RESUBMISSION') THEN
    RAISE EXCEPTION 'INVALID_REWORK_STATUS_%', p_rework_status;
  END IF;
  v_code := public.ce_actor_code(v_uid);
  v_name := public.ce_actor_display_name(v_uid);
  IF v_code IS NULL OR upper(v_code) = 'SYSTEM' THEN RAISE EXCEPTION 'ACTOR_NOT_RESOLVABLE'; END IF;

  SELECT * INTO t FROM public.ce_legal_returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RETURN_NOT_FOUND'; END IF;
  IF t.resolution_status IN ('RESOLVED','CANCELLED') THEN RAISE EXCEPTION 'RETURN_ALREADY_CLOSED'; END IF;

  UPDATE public.ce_legal_returns
     SET rework_status = p_rework_status,
         resolution_status = CASE WHEN p_rework_status = 'NOT_STARTED' THEN 'OPEN' ELSE 'IN_PROGRESS' END,
         rework_started_at = COALESCE(rework_started_at, CASE WHEN p_rework_status <> 'NOT_STARTED' THEN now() END),
         rework_started_by = COALESCE(rework_started_by, CASE WHEN p_rework_status <> 'NOT_STARTED' THEN v_code END),
         updated_at = now()
   WHERE id = p_return_id;

  INSERT INTO public.ce_legal_pack_event (referral_id, version_no, event_code, description, actor_code, actor_name, payload)
  VALUES (t.referral_id, t.returned_pack_version, 'REWORK_' || p_rework_status,
          COALESCE(p_note, 'Rework status updated'), v_code, v_name,
          jsonb_build_object('return_id', p_return_id));

  RETURN jsonb_build_object('status', p_rework_status);
END $$;

GRANT EXECUTE ON FUNCTION public.ce_legal_return_set_rework_status_v1(uuid, text, text) TO authenticated;

-- ── Complete rework (governed) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.ce_legal_return_complete_rework_v1(
  p_return_id uuid,
  p_summary text,
  p_resubmit boolean DEFAULT true,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text; v_name text;
  t public.ce_legal_returns%ROWTYPE;
  r public.ce_legal_referrals%ROWTYPE;
  v_ro jsonb; v_submit jsonb; v_ver int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT (public.ce_actor_can(v_uid, 'compliance.legal.recommend_approve')
          OR public.ce_actor_can(v_uid, 'compliance.legal.override')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED_RETURN_COMPLETE';
  END IF;
  IF p_summary IS NULL OR length(btrim(p_summary)) < 10 THEN
    RAISE EXCEPTION 'REWORK_SUMMARY_REQUIRED';
  END IF;
  v_code := public.ce_actor_code(v_uid);
  v_name := public.ce_actor_display_name(v_uid);
  IF v_code IS NULL OR upper(v_code) = 'SYSTEM' THEN RAISE EXCEPTION 'ACTOR_NOT_RESOLVABLE'; END IF;

  SELECT * INTO t FROM public.ce_legal_returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RETURN_NOT_FOUND'; END IF;
  IF t.resolution_status = 'RESOLVED' THEN
    RETURN jsonb_build_object('status','ALREADY_RESOLVED','return_id', p_return_id);
  END IF;
  SELECT * INTO r FROM public.ce_legal_referrals WHERE id = t.referral_id;

  PERFORM public.ce_legal_pack_sync_v1(t.referral_id);
  v_ro := public.ce_legal_pack_rollup_v1(t.referral_id);
  IF (v_ro->>'missing_required')::int > 0 THEN
    RAISE EXCEPTION 'PACK_INCOMPLETE: % mandatory item(s) outstanding', (v_ro->>'missing_required');
  END IF;

  IF p_resubmit THEN
    v_submit := public.ce_legal_pack_submit_v1(t.referral_id, p_idempotency_key, p_summary);
    v_ver := (v_submit->>'version_no')::int;
  END IF;

  UPDATE public.ce_legal_returns
     SET resolution_status = 'RESOLVED',
         rework_status = CASE WHEN p_resubmit THEN 'RESUBMITTED' ELSE 'READY_FOR_RESUBMISSION' END,
         resolved_at = now(), resolved_by = v_code, resolved_by_name = v_name,
         resolution_summary = p_summary,
         resolution_notes = COALESCE(resolution_notes, p_summary),
         rework_version_no = COALESCE(v_ver, rework_version_no),
         resubmitted_at = CASE WHEN p_resubmit THEN now() ELSE resubmitted_at END,
         resubmitted_by = CASE WHEN p_resubmit THEN v_code ELSE resubmitted_by END,
         updated_at = now()
   WHERE id = p_return_id;

  UPDATE public.ce_follow_up_actions
     SET status = 'COMPLETED', completed_at = now(), completed_by = v_code,
         outcome = p_summary, updated_at = now(), updated_by = v_code
   WHERE id = t.follow_up_action_id AND status <> 'COMPLETED';

  INSERT INTO public.ce_legal_pack_event (referral_id, version_no, event_code, description, actor_code, actor_name, payload)
  VALUES (t.referral_id, COALESCE(v_ver, t.returned_pack_version), 'REWORK_COMPLETE',
          'Rework completed for return #' || t.return_seq, v_code, v_name,
          jsonb_build_object('return_id', p_return_id, 'summary', p_summary,
                             'resubmitted', p_resubmit, 'rollup', v_ro));

  INSERT INTO public.ce_audit_log (entity_type, entity_id, action, description, performed_by, new_values)
  VALUES ('ce_legal_return', p_return_id, 'REWORK_COMPLETE',
          'Rework completed for referral ' || COALESCE(r.referral_number,''), v_code,
          jsonb_build_object('summary', p_summary, 'resubmitted', p_resubmit, 'version_no', v_ver));

  RETURN jsonb_build_object('status', CASE WHEN p_resubmit THEN 'RESUBMITTED' ELSE 'READY' END,
                            'version_no', v_ver, 'rollup', v_ro, 'workflow', v_submit->'workflow');
END $$;

GRANT EXECUTE ON FUNCTION public.ce_legal_return_complete_rework_v1(uuid, text, boolean, text) TO authenticated;
