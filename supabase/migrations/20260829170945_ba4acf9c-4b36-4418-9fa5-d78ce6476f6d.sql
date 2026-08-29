-- 1. Read access for the authoritative status state (policy existed, grant did not)
GRANT SELECT ON public.ce_employer_status_states TO authenticated;
GRANT ALL ON public.ce_employer_status_states TO service_role;

-- 2. Employer status history: read-only for staff, writes only via SECURITY DEFINER commands
ALTER TABLE public.ce_employer_status_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "employer status history readable" ON public.ce_employer_status_history;
CREATE POLICY "employer status history readable"
  ON public.ce_employer_status_history
  FOR SELECT TO authenticated
  USING (true);
GRANT SELECT ON public.ce_employer_status_history TO authenticated;
GRANT ALL ON public.ce_employer_status_history TO service_role;

-- 3. Correct the history insert inside the governed status-change command
CREATE OR REPLACE FUNCTION public.ce_set_employer_status_v1(p_employer_id text, p_status text, p_evidence_type text, p_evidence_reference text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_effective_date date DEFAULT NULL::date, p_clearance_reference text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_prev text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-EST-401: authentication required' USING ERRCODE='42501';
  END IF;
  IF NOT public.ce_actor_can(v_uid,'compliance.employer_status.change') THEN
    RAISE EXCEPTION 'CE-EST-403: not authorised to change employer status' USING ERRCODE='42501';
  END IF;
  IF p_status NOT IN ('ACTIVE','INACTIVE','CLOSED','CEASED') THEN
    RAISE EXCEPTION 'CE-EST-422: invalid employer status %', p_status USING ERRCODE='22023';
  END IF;
  IF COALESCE(trim(p_evidence_type),'') = ''
     OR p_evidence_type NOT IN ('INSPECTOR_VISIT','EMPLOYER_FORM','REGISTRY_NOTICE','COURT_ORDER','SYSTEM_MIGRATION','OTHER_DOCUMENTED') THEN
    RAISE EXCEPTION 'CE-EST-422: supporting evidence type is required for a status change' USING ERRCODE='22023';
  END IF;
  IF COALESCE(trim(p_evidence_reference),'') = '' THEN
    RAISE EXCEPTION 'CE-EST-422: an evidence reference is required for a status change' USING ERRCODE='22023';
  END IF;
  IF COALESCE(trim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'CE-EST-422: a reason is required for a status change' USING ERRCODE='22023';
  END IF;

  v_actor := left(public.ce_actor_user_code(v_uid),100);
  SELECT status INTO v_prev FROM public.ce_employer_status_states WHERE employer_id = p_employer_id;

  INSERT INTO public.ce_employer_status_states AS s
    (employer_id,status,effective_date,evidence_type,evidence_reference,
     clearance_certificate_reference,reason,changed_by,changed_by_user_id,changed_at)
  VALUES (p_employer_id,p_status,COALESCE(p_effective_date,current_date),p_evidence_type,p_evidence_reference,
          p_clearance_reference,p_reason,v_actor,v_uid,now())
  ON CONFLICT (employer_id) DO UPDATE
    SET status = EXCLUDED.status,
        effective_date = EXCLUDED.effective_date,
        evidence_type = EXCLUDED.evidence_type,
        evidence_reference = EXCLUDED.evidence_reference,
        clearance_certificate_reference = EXCLUDED.clearance_certificate_reference,
        reason = EXCLUDED.reason,
        changed_by = EXCLUDED.changed_by,
        changed_by_user_id = EXCLUDED.changed_by_user_id,
        changed_at = now(),
        updated_at = now();

  INSERT INTO public.ce_employer_status_history(
    employer_id, previous_status, new_status, changed_at, changed_by,
    change_reason, reason_detail, source_type, source_event)
  VALUES (p_employer_id, v_prev, p_status, now(), v_actor,
          p_reason,
          'evidence: ' || p_evidence_type || ' ' || COALESCE(p_evidence_reference,''),
          'GOVERNED_COMMAND', 'ce.employer_status.changed');

  PERFORM public.ce_b2_audit('ce.employer_status.changed','ce_employer_status_states',p_employer_id,
    jsonb_build_object('from',v_prev,'to',p_status,'evidence_type',p_evidence_type,'evidence_reference',p_evidence_reference));
  RETURN p_status;
END $function$;