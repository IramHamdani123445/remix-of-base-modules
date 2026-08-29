-- 1. Command-scope marker for exemption writes
CREATE OR REPLACE FUNCTION public.ce_exemption_command_active()
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT COALESCE(current_setting('ce.exemption_command', true), '') = '1'
$$;

-- 2. Governed upsert command
CREATE OR REPLACE FUNCTION public.ce_upsert_contribution_exemption_v1(
  p_id uuid,
  p_person_ssn text,
  p_person_name text,
  p_employer_id text,
  p_fund_code text,
  p_effective_from date,
  p_effective_to date,
  p_status text,
  p_granting_authority text,
  p_authority_reference text,
  p_evidence_reference text,
  p_notes text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_actor text; v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-EXM-401: authentication required' USING ERRCODE='42501';
  END IF;
  IF NOT public.ce_actor_can(v_uid,'compliance.exemption.manage') THEN
    RAISE EXCEPTION 'CE-EXM-403: not authorised to manage contribution exemptions' USING ERRCODE='42501';
  END IF;
  IF COALESCE(trim(p_person_ssn),'') = '' OR COALESCE(trim(p_employer_id),'') = '' THEN
    RAISE EXCEPTION 'CE-EXM-422: person and employer are required' USING ERRCODE='22023';
  END IF;
  IF COALESCE(trim(p_granting_authority),'') = '' THEN
    RAISE EXCEPTION 'CE-EXM-422: a granting authority is required' USING ERRCODE='22023';
  END IF;
  IF p_effective_from IS NULL THEN
    RAISE EXCEPTION 'CE-EXM-422: an effective-from date is required' USING ERRCODE='22023';
  END IF;
  IF COALESCE(p_status,'') NOT IN ('ACTIVE','REVOKED','EXPIRED','PENDING_VERIFICATION') THEN
    RAISE EXCEPTION 'CE-EXM-422: unknown exemption status %', p_status USING ERRCODE='22023';
  END IF;

  v_actor := left(public.ce_actor_user_code(v_uid),100);
  PERFORM set_config('ce.exemption_command','1',true);

  IF p_id IS NULL THEN
    INSERT INTO public.ce_contribution_exemptions
      (person_ssn, person_name, employer_id, fund_code, effective_from, effective_to,
       status, granting_authority, authority_reference, evidence_reference, notes, recorded_by)
    VALUES (p_person_ssn, p_person_name, p_employer_id, p_fund_code, p_effective_from, p_effective_to,
            p_status, p_granting_authority, p_authority_reference, p_evidence_reference, p_notes, v_actor)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.ce_contribution_exemptions
       SET person_ssn = p_person_ssn,
           person_name = p_person_name,
           employer_id = p_employer_id,
           fund_code = p_fund_code,
           effective_from = p_effective_from,
           effective_to = p_effective_to,
           status = p_status,
           granting_authority = p_granting_authority,
           authority_reference = p_authority_reference,
           evidence_reference = p_evidence_reference,
           notes = p_notes,
           recorded_by = v_actor,
           updated_at = now()
     WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'CE-EXM-404: exemption not found' USING ERRCODE='22023';
    END IF;
  END IF;

  PERFORM set_config('ce.exemption_command','0',true);

  PERFORM public.ce_b2_audit(
    CASE WHEN p_id IS NULL THEN 'ce.exemption.granted' ELSE 'ce.exemption.amended' END,
    'ce_contribution_exemptions', v_id::text,
    jsonb_build_object('person_ssn',p_person_ssn,'employer_id',p_employer_id,'fund_code',p_fund_code,
                       'status',p_status,'granting_authority',p_granting_authority,
                       'authority_reference',p_authority_reference));
  RETURN v_id;
END $$;

-- 3. Governed revocation command
CREATE OR REPLACE FUNCTION public.ce_revoke_contribution_exemption_v1(
  p_id uuid, p_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_actor text; v_found uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CE-EXM-401: authentication required' USING ERRCODE='42501';
  END IF;
  IF NOT public.ce_actor_can(v_uid,'compliance.exemption.manage') THEN
    RAISE EXCEPTION 'CE-EXM-403: not authorised to manage contribution exemptions' USING ERRCODE='42501';
  END IF;
  IF COALESCE(trim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'CE-EXM-422: a revocation reason is required' USING ERRCODE='22023';
  END IF;

  v_actor := left(public.ce_actor_user_code(v_uid),100);
  PERFORM set_config('ce.exemption_command','1',true);
  UPDATE public.ce_contribution_exemptions
     SET status = 'REVOKED',
         notes = COALESCE(notes || E'\n','') || 'Revoked: ' || p_reason,
         recorded_by = v_actor,
         updated_at = now()
   WHERE id = p_id
  RETURNING id INTO v_found;
  PERFORM set_config('ce.exemption_command','0',true);

  IF v_found IS NULL THEN
    RAISE EXCEPTION 'CE-EXM-404: exemption not found' USING ERRCODE='22023';
  END IF;

  PERFORM public.ce_b2_audit('ce.exemption.revoked','ce_contribution_exemptions',p_id::text,
    jsonb_build_object('reason',p_reason));
  RETURN p_id;
END $$;

-- 4. Direct-write guard on the exemption register
CREATE OR REPLACE FUNCTION public.ce_exemption_guard_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid; v_row jsonb := to_jsonb(COALESCE(NEW, OLD));
BEGIN
  IF public.ce_exemption_command_active() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF public.ce_is_trusted_session() THEN RETURN COALESCE(NEW, OLD); END IF;

  BEGIN v_uid := auth.uid(); EXCEPTION WHEN OTHERS THEN v_uid := NULL; END;
  INSERT INTO public.system_audit_trail
    (action, module, entity_type, entity_id, severity, payload_json, user_id, user_name, timestamp)
  VALUES ('ce.exemption.direct_write_denied','Compliance','ce_contribution_exemptions',
          COALESCE(v_row->>'id','-'),'warning', jsonb_build_object('operation',TG_OP),
          v_uid, COALESCE(public.ce_actor_user_code(v_uid),'anonymous'), now());
  RAISE EXCEPTION 'CE-AUTHZ-014: direct % on ce_contribution_exemptions is not permitted; use the governed exemption commands', TG_OP
    USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS zz_ce_exemption_guard ON public.ce_contribution_exemptions;
CREATE TRIGGER zz_ce_exemption_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.ce_contribution_exemptions
  FOR EACH ROW EXECUTE FUNCTION public.ce_exemption_guard_trg();

-- 5. Remove browser write access to governed registers (read stays)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ce_contribution_exemptions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ce_sector_wage_benchmarks FROM anon, authenticated;
GRANT SELECT ON public.ce_contribution_exemptions TO anon, authenticated;
GRANT SELECT ON public.ce_sector_wage_benchmarks TO anon, authenticated;
GRANT ALL ON public.ce_contribution_exemptions TO service_role;
GRANT ALL ON public.ce_sector_wage_benchmarks TO service_role;

GRANT EXECUTE ON FUNCTION public.ce_upsert_contribution_exemption_v1(uuid,text,text,text,text,date,date,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_revoke_contribution_exemption_v1(uuid,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.ce_upsert_contribution_exemption_v1(uuid,text,text,text,text,date,date,text,text,text,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ce_revoke_contribution_exemption_v1(uuid,text) FROM anon;

-- 6. Risk model factors inherit the configuration guard already on risk policies
DROP TRIGGER IF EXISTS zz_ce_config_guard ON public.ce_risk_policy_factors;
CREATE TRIGGER zz_ce_config_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.ce_risk_policy_factors
  FOR EACH ROW EXECUTE FUNCTION public.ce_config_guard_trg();