
-- ============================================================
-- INTERNAL AUDIT — WAVE 3 PART 1: ACTION LIFECYCLE
-- ============================================================

-- ---------- Schema: ia_action_tracking ----------
ALTER TABLE public.ia_action_tracking
  ADD COLUMN IF NOT EXISTS annual_plan_id uuid,
  ADD COLUMN IF NOT EXISTS department_id uuid,
  ADD COLUMN IF NOT EXISTS function_id uuid,
  ADD COLUMN IF NOT EXISTS responsible_profile_id uuid,
  ADD COLUMN IF NOT EXISTS accountable_department_id uuid,
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'Open',
  ADD COLUMN IF NOT EXISTS progress_pct integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS latest_update text,
  ADD COLUMN IF NOT EXISTS latest_update_at timestamptz,
  ADD COLUMN IF NOT EXISTS latest_update_by text,
  ADD COLUMN IF NOT EXISTS management_completion_date timestamptz,
  ADD COLUMN IF NOT EXISTS management_completion_by uuid,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'Not Started',
  ADD COLUMN IF NOT EXISTS verification_notes text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by_profile uuid,
  ADD COLUMN IF NOT EXISTS requires_ia_verification boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reopen_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by text,
  ADD COLUMN IF NOT EXISTS closure_date timestamptz,
  ADD COLUMN IF NOT EXISTS action_ref text;

CREATE SEQUENCE IF NOT EXISTS public.ia_action_ref_seq;

CREATE OR REPLACE FUNCTION public.ia_action_defaults()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_e record;
BEGIN
  IF NEW.action_ref IS NULL THEN
    NEW.action_ref := 'ACT-' || to_char(now(),'YYYY') || '-' ||
                      lpad(nextval('public.ia_action_ref_seq')::text, 5, '0');
  END IF;
  NEW.original_target_date := COALESCE(NEW.original_target_date, NEW.target_date, NEW.current_target_date);
  NEW.current_target_date  := COALESCE(NEW.current_target_date, NEW.target_date, NEW.original_target_date);
  IF NEW.engagement_id IS NOT NULL THEN
    SELECT annual_plan_id, department_id, function_id INTO v_e
      FROM public.ia_audit_engagements WHERE id = NEW.engagement_id;
    NEW.annual_plan_id := COALESCE(NEW.annual_plan_id, v_e.annual_plan_id);
    NEW.department_id  := COALESCE(NEW.department_id, v_e.department_id);
    NEW.function_id    := COALESCE(NEW.function_id, v_e.function_id);
  END IF;
  NEW.accountable_department_id := COALESCE(NEW.accountable_department_id, NEW.department_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ia_action_defaults ON public.ia_action_tracking;
CREATE TRIGGER trg_ia_action_defaults BEFORE INSERT ON public.ia_action_tracking
FOR EACH ROW EXECUTE FUNCTION public.ia_action_defaults();

-- backfill
UPDATE public.ia_action_tracking a
   SET action_ref = COALESCE(a.action_ref, 'ACT-LEG-' || lpad(nextval('public.ia_action_ref_seq')::text,5,'0')),
       original_target_date = COALESCE(a.original_target_date, a.target_date, a.current_target_date),
       current_target_date  = COALESCE(a.current_target_date, a.target_date, a.original_target_date),
       lifecycle_status = CASE
          WHEN COALESCE(a.status, a.action_status) IN ('Closed','Completed') THEN 'Closed'
          WHEN COALESCE(a.status, a.action_status) IN ('In Progress','Ongoing') THEN 'In Progress'
          WHEN COALESCE(a.status, a.action_status) = 'Cancelled' THEN 'Cancelled'
          ELSE 'Open' END,
       verification_status = CASE WHEN COALESCE(a.status,a.action_status) = 'Closed' THEN 'Passed' ELSE 'Not Started' END,
       closure_date = COALESCE(a.closure_date, a.closure_verified_at)
 WHERE a.action_ref IS NULL OR a.lifecycle_status = 'Open';

UPDATE public.ia_action_tracking a
   SET annual_plan_id = COALESCE(a.annual_plan_id, e.annual_plan_id),
       department_id  = COALESCE(a.department_id, e.department_id),
       function_id    = COALESCE(a.function_id, e.function_id),
       accountable_department_id = COALESCE(a.accountable_department_id, e.department_id)
  FROM public.ia_audit_engagements e
 WHERE e.id = a.engagement_id;

ALTER TABLE public.ia_action_tracking
  DROP CONSTRAINT IF EXISTS ia_action_lifecycle_chk;
ALTER TABLE public.ia_action_tracking
  ADD CONSTRAINT ia_action_lifecycle_chk CHECK (lifecycle_status IN
    ('Open','In Progress','Completed by Management','Verification Required','Verified','Closed',
     'Returned','Rejected','Reopened','Cancelled'));

CREATE INDEX IF NOT EXISTS idx_ia_action_lifecycle ON public.ia_action_tracking(lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_ia_action_owner ON public.ia_action_tracking(responsible_profile_id);
CREATE INDEX IF NOT EXISTS idx_ia_action_plan ON public.ia_action_tracking(annual_plan_id);
CREATE INDEX IF NOT EXISTS idx_ia_action_target ON public.ia_action_tracking(current_target_date);

-- ---------- Schema: ia_action_extensions ----------
ALTER TABLE public.ia_action_extensions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Approved',
  ADD COLUMN IF NOT EXISTS proposed_date date,
  ADD COLUMN IF NOT EXISTS requested_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS requested_by_profile uuid,
  ADD COLUMN IF NOT EXISTS decided_by_profile uuid,
  ADD COLUMN IF NOT EXISTS decision_comments text,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS sequence_no integer;

UPDATE public.ia_action_extensions
   SET proposed_date = COALESCE(proposed_date, new_target_date),
       decided_at = COALESCE(decided_at, approved_at);

ALTER TABLE public.ia_action_extensions DROP CONSTRAINT IF EXISTS ia_action_ext_status_chk;
ALTER TABLE public.ia_action_extensions
  ADD CONSTRAINT ia_action_ext_status_chk CHECK (status IN ('Requested','Approved','Rejected','Withdrawn'));

-- ---------- New table: progress log ----------
CREATE TABLE IF NOT EXISTS public.ia_action_progress_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL REFERENCES public.ia_action_tracking(id) ON DELETE CASCADE,
  engagement_id uuid,
  progress_pct integer,
  note text NOT NULL,
  evidence_ids uuid[],
  entry_type text NOT NULL DEFAULT 'Progress',
  actor_profile_id uuid,
  actor_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ia_action_progress_log TO authenticated;
GRANT ALL ON public.ia_action_progress_log TO service_role;
ALTER TABLE public.ia_action_progress_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ia_action_progress_read ON public.ia_action_progress_log;
CREATE POLICY ia_action_progress_read ON public.ia_action_progress_log FOR SELECT TO authenticated
  USING (public.ia_can_read_all() OR public.ia_can_access_engagement(engagement_id));
CREATE INDEX IF NOT EXISTS idx_ia_action_progress_action ON public.ia_action_progress_log(action_id);

-- ---------- Schema: ia_follow_ups ----------
ALTER TABLE public.ia_follow_ups
  ADD COLUMN IF NOT EXISTS action_id uuid,
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'Scheduled',
  ADD COLUMN IF NOT EXISTS outcome text,
  ADD COLUMN IF NOT EXISTS outcome_notes text,
  ADD COLUMN IF NOT EXISTS verified_by_profile uuid,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS fiscal_year text;

ALTER TABLE public.ia_follow_ups DROP CONSTRAINT IF EXISTS ia_followup_lifecycle_chk;
ALTER TABLE public.ia_follow_ups
  ADD CONSTRAINT ia_followup_lifecycle_chk CHECK (lifecycle_status IN
    ('Scheduled','Due','In Verification','Implemented','Partially Implemented','Not Implemented','Reopened','Cancelled'));
CREATE INDEX IF NOT EXISTS idx_ia_followup_action ON public.ia_follow_ups(action_id);

-- ============================================================
-- Guards
-- ============================================================
CREATE OR REPLACE FUNCTION public.ia_action_can_manage(p_action_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ia_action_tracking a
    WHERE a.id = p_action_id
      AND ( a.responsible_profile_id = auth.uid()
         OR public.ia_is_department_respondent(COALESCE(a.accountable_department_id, a.department_id))
         OR public.ia_cmd_guard('action_tracking','edit', a.engagement_id) )
  );
$$;

CREATE OR REPLACE FUNCTION public.ia_action_can_verify(p_action_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ia_action_tracking a
    WHERE a.id = p_action_id
      AND public.ia_is_ia_user()
      AND public.ia_cmd_guard_elevated('action_tracking','approve', a.engagement_id)
  );
$$;

-- ============================================================
-- Commands
-- ============================================================
CREATE OR REPLACE FUNCTION public.ia_action_assign(
  p_action_id uuid, p_responsible_profile_id uuid,
  p_accountable_department_id uuid DEFAULT NULL, p_function_id uuid DEFAULT NULL,
  p_target_date date DEFAULT NULL, p_description text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_a record; v_actor text := public.ia_actor_label();
BEGIN
  SELECT * INTO v_a FROM public.ia_action_tracking WHERE id = p_action_id;
  IF v_a IS NULL THEN RETURN jsonb_build_object('success',false,'code','IA_NOT_FOUND','error','Action not found'); END IF;
  IF NOT public.ia_cmd_guard('action_tracking','edit', v_a.engagement_id) THEN
    RETURN jsonb_build_object('success',false,'code','IA_FORBIDDEN','error','You do not have permission to assign this action');
  END IF;
  IF p_responsible_profile_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','IA_OWNER_REQUIRED','error','An accountable owner profile is required');
  END IF;
  IF v_a.lifecycle_status IN ('Closed','Cancelled') THEN
    RETURN jsonb_build_object('success',false,'code','IA_ACTION_FINAL','error','This action is already final');
  END IF;

  UPDATE public.ia_action_tracking
     SET responsible_profile_id = p_responsible_profile_id,
         accountable_department_id = COALESCE(p_accountable_department_id, accountable_department_id, department_id),
         function_id = COALESCE(p_function_id, function_id),
         action_description = COALESCE(p_description, action_description),
         original_target_date = COALESCE(original_target_date, p_target_date, target_date),
         current_target_date = COALESCE(p_target_date, current_target_date, target_date),
         target_date = COALESCE(p_target_date, target_date, current_target_date),
         responsible_person = COALESCE((SELECT COALESCE(full_name,email) FROM public.profiles WHERE id = p_responsible_profile_id), responsible_person),
         updated_at = now(), updated_by = v_actor
   WHERE id = p_action_id;

  PERFORM public.ia_log_event('IA.ACTION.ASSIGNED','action',p_action_id,v_a.engagement_id,v_a.annual_plan_id,
    jsonb_build_object('owner', v_a.responsible_profile_id),
    jsonb_build_object('owner', p_responsible_profile_id,'target_date', p_target_date),
    NULL, NULL, 'ia_action_assign');
  RETURN jsonb_build_object('success',true,'action_id',p_action_id);
END $$;

CREATE OR REPLACE FUNCTION public.ia_action_update_progress(
  p_action_id uuid, p_progress_pct integer, p_note text, p_evidence_ids uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_a record; v_actor text := public.ia_actor_label(); v_new text;
BEGIN
  SELECT * INTO v_a FROM public.ia_action_tracking WHERE id = p_action_id;
  IF v_a IS NULL THEN RETURN jsonb_build_object('success',false,'code','IA_NOT_FOUND','error','Action not found'); END IF;
  IF NOT public.ia_action_can_manage(p_action_id) THEN
    RETURN jsonb_build_object('success',false,'code','IA_FORBIDDEN','error','You are not the accountable owner of this action');
  END IF;
  IF v_a.lifecycle_status IN ('Closed','Cancelled','Verified') THEN
    RETURN jsonb_build_object('success',false,'code','IA_ACTION_FINAL','error','A '||v_a.lifecycle_status||' action cannot be progressed');
  END IF;
  IF COALESCE(trim(p_note),'') = '' THEN
    RETURN jsonb_build_object('success',false,'code','IA_NOTE_REQUIRED','error','A progress note is required');
  END IF;
  IF p_progress_pct IS NULL OR p_progress_pct < 0 OR p_progress_pct > 100 THEN
    RETURN jsonb_build_object('success',false,'code','IA_INVALID_PROGRESS','error','Progress must be between 0 and 100');
  END IF;

  v_new := CASE WHEN v_a.lifecycle_status IN ('Open','Returned','Reopened') AND p_progress_pct > 0
                THEN 'In Progress' ELSE v_a.lifecycle_status END;

  UPDATE public.ia_action_tracking
     SET progress_pct = p_progress_pct, latest_update = p_note, latest_update_at = now(),
         latest_update_by = v_actor, lifecycle_status = v_new,
         status = v_new, action_status = v_new,
         evidence_ids = CASE WHEN p_evidence_ids IS NULL THEN evidence_ids
                             ELSE (SELECT array_agg(DISTINCT x) FROM unnest(COALESCE(evidence_ids,'{}'::uuid[]) || p_evidence_ids) x) END,
         updated_at = now(), updated_by = v_actor
   WHERE id = p_action_id;

  INSERT INTO public.ia_action_progress_log(action_id, engagement_id, progress_pct, note, evidence_ids, entry_type, actor_profile_id, actor_label)
  VALUES (p_action_id, v_a.engagement_id, p_progress_pct, p_note, p_evidence_ids, 'Progress', auth.uid(), v_actor);

  PERFORM public.ia_log_event('IA.ACTION.PROGRESS_UPDATED','action',p_action_id,v_a.engagement_id,v_a.annual_plan_id,
    jsonb_build_object('progress', v_a.progress_pct), jsonb_build_object('progress', p_progress_pct,'status',v_new),
    p_note, NULL, 'ia_action_update_progress');
  RETURN jsonb_build_object('success',true,'action_id',p_action_id,'lifecycle_status',v_new);
END $$;

CREATE OR REPLACE FUNCTION public.ia_action_request_extension(
  p_action_id uuid, p_proposed_date date, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_a record; v_actor text := public.ia_actor_label(); v_id uuid; v_seq int;
BEGIN
  SELECT * INTO v_a FROM public.ia_action_tracking WHERE id = p_action_id;
  IF v_a IS NULL THEN RETURN jsonb_build_object('success',false,'code','IA_NOT_FOUND','error','Action not found'); END IF;
  IF NOT public.ia_action_can_manage(p_action_id) THEN
    RETURN jsonb_build_object('success',false,'code','IA_FORBIDDEN','error','You cannot request an extension for this action');
  END IF;
  IF v_a.lifecycle_status IN ('Closed','Cancelled') THEN
    RETURN jsonb_build_object('success',false,'code','IA_ACTION_FINAL','error','A closed action cannot be extended');
  END IF;
  IF COALESCE(trim(p_reason),'') = '' THEN
    RETURN jsonb_build_object('success',false,'code','IA_REASON_REQUIRED','error','A reason is required');
  END IF;
  IF p_proposed_date IS NULL OR (v_a.current_target_date IS NOT NULL AND p_proposed_date <= v_a.current_target_date) THEN
    RETURN jsonb_build_object('success',false,'code','IA_INVALID_DATE','error','The proposed date must be later than the current target date');
  END IF;
  IF EXISTS (SELECT 1 FROM public.ia_action_extensions WHERE action_id = p_action_id AND status = 'Requested') THEN
    RETURN jsonb_build_object('success',false,'code','IA_EXTENSION_PENDING','error','An extension request is already pending decision');
  END IF;

  SELECT COALESCE(max(sequence_no),0) + 1 INTO v_seq FROM public.ia_action_extensions WHERE action_id = p_action_id;

  INSERT INTO public.ia_action_extensions(action_id, engagement_id, previous_target_date, proposed_date,
      new_target_date, reason, requested_by, requested_by_profile, requested_at, status, sequence_no)
  VALUES (p_action_id, v_a.engagement_id, v_a.current_target_date, p_proposed_date,
      p_proposed_date, p_reason, v_actor, auth.uid(), now(), 'Requested', v_seq)
  RETURNING id INTO v_id;

  PERFORM public.ia_log_event('IA.ACTION.EXTENSION_REQUESTED','action_extension',v_id,v_a.engagement_id,v_a.annual_plan_id,
    jsonb_build_object('current_target_date', v_a.current_target_date),
    jsonb_build_object('proposed_date', p_proposed_date,'sequence_no', v_seq),
    p_reason, NULL, 'ia_action_request_extension');
  RETURN jsonb_build_object('success',true,'extension_id',v_id,'sequence_no',v_seq);
END $$;

CREATE OR REPLACE FUNCTION public.ia_action_decide_extension(
  p_extension_id uuid, p_decision text, p_comments text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_x record; v_a record; v_actor text := public.ia_actor_label();
BEGIN
  SELECT * INTO v_x FROM public.ia_action_extensions WHERE id = p_extension_id;
  IF v_x IS NULL THEN RETURN jsonb_build_object('success',false,'code','IA_NOT_FOUND','error','Extension request not found'); END IF;
  IF v_x.status <> 'Requested' THEN
    RETURN jsonb_build_object('success',false,'code','IA_ALREADY_DECIDED','error','This extension request has already been decided');
  END IF;
  SELECT * INTO v_a FROM public.ia_action_tracking WHERE id = v_x.action_id;
  IF NOT public.ia_action_can_verify(v_x.action_id) THEN
    RETURN jsonb_build_object('success',false,'code','IA_FORBIDDEN','error','You do not have permission to decide extension requests');
  END IF;
  IF v_x.requested_by_profile IS NOT NULL AND v_x.requested_by_profile = auth.uid() THEN
    RETURN jsonb_build_object('success',false,'code','IA_SOD','error','The requester cannot approve their own extension request');
  END IF;
  IF p_decision NOT IN ('Approved','Rejected') THEN
    RETURN jsonb_build_object('success',false,'code','IA_INVALID_DECISION','error','Decision must be Approved or Rejected');
  END IF;
  IF p_decision = 'Rejected' AND COALESCE(trim(p_comments),'') = '' THEN
    RETURN jsonb_build_object('success',false,'code','IA_REASON_REQUIRED','error','Rejection comments are required');
  END IF;

  UPDATE public.ia_action_extensions
     SET status = p_decision, decision_comments = p_comments, decided_at = now(),
         decided_by_profile = auth.uid(), approved_by = CASE WHEN p_decision='Approved' THEN v_actor ELSE approved_by END,
         approved_at = CASE WHEN p_decision='Approved' THEN now() ELSE approved_at END,
         new_target_date = v_x.proposed_date, updated_at = now()
   WHERE id = p_extension_id;

  IF p_decision = 'Approved' THEN
    UPDATE public.ia_action_tracking
       SET original_target_date = COALESCE(original_target_date, target_date, current_target_date),
           current_target_date = v_x.proposed_date,
           target_date = v_x.proposed_date,
           extension_count = COALESCE(extension_count,0) + 1,
           updated_at = now(), updated_by = v_actor
     WHERE id = v_x.action_id;
  END IF;

  PERFORM public.ia_log_event('IA.ACTION.EXTENSION_' || upper(p_decision),'action_extension',p_extension_id,
    v_a.engagement_id, v_a.annual_plan_id,
    jsonb_build_object('previous_target_date', v_x.previous_target_date),
    jsonb_build_object('decision', p_decision,'proposed_date', v_x.proposed_date),
    p_comments, NULL, 'ia_action_decide_extension');
  RETURN jsonb_build_object('success',true,'extension_id',p_extension_id,'decision',p_decision);
END $$;

CREATE OR REPLACE FUNCTION public.ia_action_submit_completion(
  p_action_id uuid, p_note text, p_evidence_ids uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_a record; v_actor text := public.ia_actor_label(); v_ev uuid[]; v_next text;
BEGIN
  SELECT * INTO v_a FROM public.ia_action_tracking WHERE id = p_action_id;
  IF v_a IS NULL THEN RETURN jsonb_build_object('success',false,'code','IA_NOT_FOUND','error','Action not found'); END IF;
  IF NOT public.ia_action_can_manage(p_action_id) THEN
    RETURN jsonb_build_object('success',false,'code','IA_FORBIDDEN','error','You are not the accountable owner of this action');
  END IF;
  IF v_a.lifecycle_status IN ('Closed','Cancelled','Verified','Verification Required') THEN
    RETURN jsonb_build_object('success',false,'code','IA_INVALID_STATE','error','This action cannot be submitted from status '||v_a.lifecycle_status);
  END IF;
  IF COALESCE(trim(p_note),'') = '' THEN
    RETURN jsonb_build_object('success',false,'code','IA_NOTE_REQUIRED','error','A completion note is required');
  END IF;
  v_ev := CASE WHEN p_evidence_ids IS NULL THEN v_a.evidence_ids
               ELSE (SELECT array_agg(DISTINCT x) FROM unnest(COALESCE(v_a.evidence_ids,'{}'::uuid[]) || p_evidence_ids) x) END;
  IF v_ev IS NULL OR array_length(v_ev,1) IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','IA_EVIDENCE_REQUIRED','error','Implementation evidence must be attached before submitting completion');
  END IF;

  v_next := CASE WHEN v_a.requires_ia_verification THEN 'Verification Required' ELSE 'Verified' END;

  UPDATE public.ia_action_tracking
     SET lifecycle_status = v_next, status = v_next, action_status = v_next,
         progress_pct = 100, evidence_ids = v_ev,
         evidence_of_implementation = COALESCE(evidence_of_implementation, ARRAY[]::text[]) || ARRAY[p_note],
         management_completion_date = now(), management_completion_by = auth.uid(),
         verification_status = CASE WHEN v_a.requires_ia_verification THEN 'Pending' ELSE 'Not Required' END,
         latest_update = p_note, latest_update_at = now(), latest_update_by = v_actor,
         updated_at = now(), updated_by = v_actor
   WHERE id = p_action_id;

  INSERT INTO public.ia_action_progress_log(action_id, engagement_id, progress_pct, note, evidence_ids, entry_type, actor_profile_id, actor_label)
  VALUES (p_action_id, v_a.engagement_id, 100, p_note, v_ev, 'Management Completion', auth.uid(), v_actor);

  PERFORM public.ia_log_event('IA.ACTION.MANAGEMENT_COMPLETION_SUBMITTED','action',p_action_id,v_a.engagement_id,v_a.annual_plan_id,
    jsonb_build_object('status', v_a.lifecycle_status), jsonb_build_object('status', v_next,'evidence_count', array_length(v_ev,1)),
    p_note, NULL, 'ia_action_submit_completion');
  RETURN jsonb_build_object('success',true,'action_id',p_action_id,'lifecycle_status',v_next);
END $$;

CREATE OR REPLACE FUNCTION public.ia_action_start_verification(p_action_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_a record; v_actor text := public.ia_actor_label();
BEGIN
  SELECT * INTO v_a FROM public.ia_action_tracking WHERE id = p_action_id;
  IF v_a IS NULL THEN RETURN jsonb_build_object('success',false,'code','IA_NOT_FOUND','error','Action not found'); END IF;
  IF NOT public.ia_action_can_verify(p_action_id) THEN
    RETURN jsonb_build_object('success',false,'code','IA_FORBIDDEN','error','You do not have permission to verify actions');
  END IF;
  IF v_a.lifecycle_status <> 'Verification Required' THEN
    RETURN jsonb_build_object('success',false,'code','IA_INVALID_STATE','error','Only actions awaiting verification can be picked up');
  END IF;
  UPDATE public.ia_action_tracking
     SET verification_status = 'In Verification', updated_at = now(), updated_by = v_actor
   WHERE id = p_action_id;
  PERFORM public.ia_log_event('IA.ACTION.VERIFICATION_STARTED','action',p_action_id,v_a.engagement_id,v_a.annual_plan_id,
    NULL, jsonb_build_object('verification_status','In Verification'), NULL, NULL, 'ia_action_start_verification');
  RETURN jsonb_build_object('success',true,'action_id',p_action_id);
END $$;

CREATE OR REPLACE FUNCTION public.ia_action_verify(p_action_id uuid, p_notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_a record; v_actor text := public.ia_actor_label();
BEGIN
  SELECT * INTO v_a FROM public.ia_action_tracking WHERE id = p_action_id;
  IF v_a IS NULL THEN RETURN jsonb_build_object('success',false,'code','IA_NOT_FOUND','error','Action not found'); END IF;
  IF NOT public.ia_action_can_verify(p_action_id) THEN
    RETURN jsonb_build_object('success',false,'code','IA_FORBIDDEN','error','You do not have permission to verify actions');
  END IF;
  IF v_a.lifecycle_status <> 'Verification Required' THEN
    RETURN jsonb_build_object('success',false,'code','IA_INVALID_STATE','error','Only actions awaiting verification can be verified');
  END IF;
  IF auth.uid() IS NOT NULL AND (auth.uid() = v_a.responsible_profile_id OR auth.uid() = v_a.management_completion_by) THEN
    RETURN jsonb_build_object('success',false,'code','IA_SOD','error','Management cannot verify their own corrective action');
  END IF;
  IF COALESCE(trim(p_notes),'') = '' THEN
    RETURN jsonb_build_object('success',false,'code','IA_NOTES_REQUIRED','error','Verification notes are required');
  END IF;

  UPDATE public.ia_action_tracking
     SET lifecycle_status = 'Verified', status = 'Verified', action_status = 'Verified',
         verification_status = 'Passed', verified_at = now(), verified_by_profile = auth.uid(),
         verified_by = v_actor, verified_date = now(), verification_date = now(),
         verification_notes = p_notes, updated_at = now(), updated_by = v_actor
   WHERE id = p_action_id;

  PERFORM public.ia_log_event('IA.ACTION.VERIFICATION_PASSED','action',p_action_id,v_a.engagement_id,v_a.annual_plan_id,
    jsonb_build_object('status', v_a.lifecycle_status), jsonb_build_object('status','Verified'),
    p_notes, NULL, 'ia_action_verify');
  RETURN jsonb_build_object('success',true,'action_id',p_action_id,'lifecycle_status','Verified');
END $$;

CREATE OR REPLACE FUNCTION public.ia_action_reject_verification(
  p_action_id uuid, p_reason text, p_request_more_evidence boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_a record; v_actor text := public.ia_actor_label();
BEGIN
  SELECT * INTO v_a FROM public.ia_action_tracking WHERE id = p_action_id;
  IF v_a IS NULL THEN RETURN jsonb_build_object('success',false,'code','IA_NOT_FOUND','error','Action not found'); END IF;
  IF NOT public.ia_action_can_verify(p_action_id) THEN
    RETURN jsonb_build_object('success',false,'code','IA_FORBIDDEN','error','You do not have permission to verify actions');
  END IF;
  IF v_a.lifecycle_status <> 'Verification Required' THEN
    RETURN jsonb_build_object('success',false,'code','IA_INVALID_STATE','error','Only actions awaiting verification can be rejected');
  END IF;
  IF COALESCE(trim(p_reason),'') = '' THEN
    RETURN jsonb_build_object('success',false,'code','IA_REASON_REQUIRED','error','A rejection reason is required');
  END IF;

  UPDATE public.ia_action_tracking
     SET lifecycle_status = 'Returned', status = 'Returned', action_status = 'Returned',
         verification_status = CASE WHEN p_request_more_evidence THEN 'Evidence Requested' ELSE 'Rejected' END,
         verification_notes = p_reason, progress_pct = LEAST(COALESCE(progress_pct,0), 90),
         management_completion_date = NULL,
         updated_at = now(), updated_by = v_actor
   WHERE id = p_action_id;

  INSERT INTO public.ia_action_progress_log(action_id, engagement_id, progress_pct, note, entry_type, actor_profile_id, actor_label)
  VALUES (p_action_id, v_a.engagement_id, NULL, p_reason,
          CASE WHEN p_request_more_evidence THEN 'Evidence Requested' ELSE 'Verification Rejected' END, auth.uid(), v_actor);

  PERFORM public.ia_log_event('IA.ACTION.VERIFICATION_REJECTED','action',p_action_id,v_a.engagement_id,v_a.annual_plan_id,
    jsonb_build_object('status', v_a.lifecycle_status), jsonb_build_object('status','Returned','more_evidence', p_request_more_evidence),
    p_reason, NULL, 'ia_action_reject_verification');
  RETURN jsonb_build_object('success',true,'action_id',p_action_id,'lifecycle_status','Returned');
END $$;

CREATE OR REPLACE FUNCTION public.ia_action_reopen(
  p_action_id uuid, p_reason text, p_new_target_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_a record; v_actor text := public.ia_actor_label(); v_seq int;
BEGIN
  SELECT * INTO v_a FROM public.ia_action_tracking WHERE id = p_action_id;
  IF v_a IS NULL THEN RETURN jsonb_build_object('success',false,'code','IA_NOT_FOUND','error','Action not found'); END IF;
  IF NOT public.ia_action_can_verify(p_action_id) THEN
    RETURN jsonb_build_object('success',false,'code','IA_FORBIDDEN','error','You do not have permission to reopen actions');
  END IF;
  IF v_a.lifecycle_status NOT IN ('Verified','Closed','Returned','Cancelled') THEN
    RETURN jsonb_build_object('success',false,'code','IA_INVALID_STATE','error','Only a verified, closed, returned or cancelled action can be reopened');
  END IF;
  IF COALESCE(trim(p_reason),'') = '' THEN
    RETURN jsonb_build_object('success',false,'code','IA_REASON_REQUIRED','error','A reopen reason is required');
  END IF;

  IF p_new_target_date IS NOT NULL THEN
    SELECT COALESCE(max(sequence_no),0)+1 INTO v_seq FROM public.ia_action_extensions WHERE action_id = p_action_id;
    INSERT INTO public.ia_action_extensions(action_id, engagement_id, previous_target_date, proposed_date, new_target_date,
      reason, requested_by, requested_by_profile, status, decided_by_profile, decided_at, approved_by, approved_at,
      decision_comments, sequence_no)
    VALUES (p_action_id, v_a.engagement_id, v_a.current_target_date, p_new_target_date, p_new_target_date,
      p_reason, v_actor, auth.uid(), 'Approved', auth.uid(), now(), v_actor, now(), 'Set on reopen', v_seq);
  END IF;

  UPDATE public.ia_action_tracking
     SET lifecycle_status = 'Reopened', status = 'Reopened', action_status = 'Reopened',
         verification_status = 'Not Started', verified_at = NULL, verified_by_profile = NULL,
         management_completion_date = NULL, closure_date = NULL,
         reopen_count = COALESCE(reopen_count,0) + 1,
         original_target_date = COALESCE(original_target_date, target_date, current_target_date),
         current_target_date = COALESCE(p_new_target_date, current_target_date),
         target_date = COALESCE(p_new_target_date, target_date),
         extension_count = COALESCE(extension_count,0) + CASE WHEN p_new_target_date IS NOT NULL THEN 1 ELSE 0 END,
         progress_pct = LEAST(COALESCE(progress_pct,0), 50),
         updated_at = now(), updated_by = v_actor
   WHERE id = p_action_id;

  PERFORM public.ia_log_event('IA.ACTION.REOPENED','action',p_action_id,v_a.engagement_id,v_a.annual_plan_id,
    jsonb_build_object('status', v_a.lifecycle_status), jsonb_build_object('status','Reopened','new_target_date', p_new_target_date),
    p_reason, NULL, 'ia_action_reopen');
  RETURN jsonb_build_object('success',true,'action_id',p_action_id,'lifecycle_status','Reopened');
END $$;

CREATE OR REPLACE FUNCTION public.ia_action_cancel(p_action_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_a record; v_actor text := public.ia_actor_label();
BEGIN
  SELECT * INTO v_a FROM public.ia_action_tracking WHERE id = p_action_id;
  IF v_a IS NULL THEN RETURN jsonb_build_object('success',false,'code','IA_NOT_FOUND','error','Action not found'); END IF;
  IF NOT public.ia_action_can_verify(p_action_id) THEN
    RETURN jsonb_build_object('success',false,'code','IA_FORBIDDEN','error','You do not have permission to cancel actions');
  END IF;
  IF COALESCE(trim(p_reason),'') = '' THEN
    RETURN jsonb_build_object('success',false,'code','IA_REASON_REQUIRED','error','A cancellation reason is required');
  END IF;
  IF v_a.lifecycle_status IN ('Closed','Cancelled') THEN
    RETURN jsonb_build_object('success',false,'code','IA_ACTION_FINAL','error','This action is already final');
  END IF;

  UPDATE public.ia_action_tracking
     SET lifecycle_status = 'Cancelled', status = 'Cancelled', action_status = 'Cancelled',
         cancelled_reason = p_reason, cancelled_at = now(), cancelled_by = v_actor,
         updated_at = now(), updated_by = v_actor
   WHERE id = p_action_id;

  PERFORM public.ia_log_event('IA.ACTION.CANCELLED','action',p_action_id,v_a.engagement_id,v_a.annual_plan_id,
    jsonb_build_object('status', v_a.lifecycle_status), jsonb_build_object('status','Cancelled'),
    p_reason, NULL, 'ia_action_cancel');
  RETURN jsonb_build_object('success',true,'action_id',p_action_id);
END $$;

CREATE OR REPLACE FUNCTION public.ia_action_close_v2(p_action_id uuid, p_closure_notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_a record; v_actor text := public.ia_actor_label();
BEGIN
  SELECT * INTO v_a FROM public.ia_action_tracking WHERE id = p_action_id;
  IF v_a IS NULL THEN RETURN jsonb_build_object('success',false,'code','IA_NOT_FOUND','error','Action not found'); END IF;
  IF NOT public.ia_action_can_verify(p_action_id) THEN
    RETURN jsonb_build_object('success',false,'code','IA_FORBIDDEN','error','You do not have permission to close actions');
  END IF;
  IF COALESCE(trim(p_closure_notes),'') = '' THEN
    RETURN jsonb_build_object('success',false,'code','IA_NOTES_REQUIRED','error','Closure notes are required');
  END IF;
  IF v_a.requires_ia_verification AND v_a.lifecycle_status <> 'Verified' THEN
    RETURN jsonb_build_object('success',false,'code','IA_VERIFICATION_REQUIRED',
      'error','This action must be independently verified before it can be closed');
  END IF;
  IF v_a.evidence_ids IS NULL OR array_length(v_a.evidence_ids,1) IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','IA_EVIDENCE_REQUIRED','error','Implementation evidence must be linked before closure');
  END IF;

  UPDATE public.ia_action_tracking
     SET lifecycle_status = 'Closed', status = 'Closed', action_status = 'Closed',
         closure_notes = p_closure_notes, closure_date = now(),
         closure_verified_by = v_actor, closure_verified_at = now(),
         updated_at = now(), updated_by = v_actor
   WHERE id = p_action_id;

  PERFORM public.ia_log_event('IA.ACTION.CLOSED','action',p_action_id,v_a.engagement_id,v_a.annual_plan_id,
    jsonb_build_object('status', v_a.lifecycle_status), jsonb_build_object('status','Closed'),
    p_closure_notes, NULL, 'ia_action_close_v2');
  RETURN jsonb_build_object('success',true,'action_id',p_action_id,'lifecycle_status','Closed');
END $$;

-- ---------- Follow-up commands ----------
CREATE OR REPLACE FUNCTION public.ia_followup_schedule(
  p_action_id uuid, p_scheduled_date date, p_follow_up_type text DEFAULT 'Action Verification',
  p_notes text DEFAULT NULL, p_fiscal_year text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_a record; v_actor text := public.ia_actor_label(); v_id uuid;
BEGIN
  SELECT * INTO v_a FROM public.ia_action_tracking WHERE id = p_action_id;
  IF v_a IS NULL THEN RETURN jsonb_build_object('success',false,'code','IA_NOT_FOUND','error','Action not found'); END IF;
  IF NOT public.ia_cmd_guard('follow_up_tracker','create', v_a.engagement_id) THEN
    RETURN jsonb_build_object('success',false,'code','IA_FORBIDDEN','error','You do not have permission to schedule follow-up');
  END IF;
  IF p_scheduled_date IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','IA_DATE_REQUIRED','error','A follow-up date is required');
  END IF;

  INSERT INTO public.ia_follow_ups(action_id, finding_id, engagement_id, annual_plan_id, department_id,
      action_required, due_date, scheduled_follow_up_date, follow_up_type, status, lifecycle_status,
      description, responsible_name, responsible_party, fiscal_year, created_by)
  VALUES (p_action_id, v_a.finding_id, v_a.engagement_id, v_a.annual_plan_id, v_a.department_id,
      COALESCE(v_a.action_description,'Verify corrective action implementation'), p_scheduled_date, p_scheduled_date,
      p_follow_up_type, 'Scheduled', 'Scheduled', p_notes, v_a.responsible_person,
      v_a.responsible_profile_id::text, COALESCE(p_fiscal_year, to_char(p_scheduled_date,'YYYY')), v_actor)
  RETURNING id INTO v_id;

  PERFORM public.ia_log_event('IA.FOLLOWUP.SCHEDULED','follow_up',v_id,v_a.engagement_id,v_a.annual_plan_id,
    NULL, jsonb_build_object('action_id', p_action_id,'scheduled_date', p_scheduled_date), p_notes, NULL, 'ia_followup_schedule');
  RETURN jsonb_build_object('success',true,'follow_up_id',v_id);
END $$;

CREATE OR REPLACE FUNCTION public.ia_followup_record_outcome(
  p_followup_id uuid, p_outcome text, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_f record; v_actor text := public.ia_actor_label();
BEGIN
  SELECT * INTO v_f FROM public.ia_follow_ups WHERE id = p_followup_id;
  IF v_f IS NULL THEN RETURN jsonb_build_object('success',false,'code','IA_NOT_FOUND','error','Follow-up not found'); END IF;
  IF NOT public.ia_cmd_guard('follow_up_tracker','edit', v_f.engagement_id) THEN
    RETURN jsonb_build_object('success',false,'code','IA_FORBIDDEN','error','You do not have permission to record follow-up outcomes');
  END IF;
  IF p_outcome NOT IN ('In Verification','Implemented','Partially Implemented','Not Implemented','Reopened') THEN
    RETURN jsonb_build_object('success',false,'code','IA_INVALID_OUTCOME','error','Invalid follow-up outcome');
  END IF;
  IF p_outcome IN ('Partially Implemented','Not Implemented') AND COALESCE(trim(p_notes),'') = '' THEN
    RETURN jsonb_build_object('success',false,'code','IA_NOTES_REQUIRED','error','Notes are required when implementation is incomplete');
  END IF;

  UPDATE public.ia_follow_ups
     SET lifecycle_status = p_outcome, outcome = p_outcome, outcome_notes = p_notes,
         status = p_outcome, resolution = COALESCE(p_notes, resolution),
         resolved_date = CASE WHEN p_outcome = 'Implemented' THEN now()::date ELSE resolved_date END,
         verified_by_profile = auth.uid(), verified_at = now(),
         updated_at = now(), updated_by = v_actor
   WHERE id = p_followup_id;

  PERFORM public.ia_log_event('IA.FOLLOWUP.OUTCOME_RECORDED','follow_up',p_followup_id, v_f.engagement_id, v_f.annual_plan_id,
    jsonb_build_object('status', v_f.lifecycle_status), jsonb_build_object('outcome', p_outcome),
    p_notes, NULL, 'ia_followup_record_outcome');
  RETURN jsonb_build_object('success',true,'follow_up_id',p_followup_id,'outcome',p_outcome);
END $$;

-- ---------- Grants ----------
GRANT EXECUTE ON FUNCTION public.ia_action_assign(uuid,uuid,uuid,uuid,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_action_update_progress(uuid,integer,text,uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_action_request_extension(uuid,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_action_decide_extension(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_action_submit_completion(uuid,text,uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_action_start_verification(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_action_verify(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_action_reject_verification(uuid,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_action_reopen(uuid,text,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_action_cancel(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_action_close_v2(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_followup_schedule(uuid,date,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_followup_record_outcome(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_action_can_manage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ia_action_can_verify(uuid) TO authenticated;
