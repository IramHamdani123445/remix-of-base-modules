
-- ============================================================
-- Legal Pack Preparation — Enterprise foundation
-- ============================================================

-- 1. Reference / configuration -------------------------------------------
CREATE TABLE IF NOT EXISTS public.ce_legal_pack_ref (
  domain        text NOT NULL,
  code          text NOT NULL,
  label         text NOT NULL,
  group_code    text,
  tone          text,
  display_order integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  numeric_value numeric,
  text_value    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (domain, code)
);
GRANT SELECT ON public.ce_legal_pack_ref TO authenticated;
GRANT ALL ON public.ce_legal_pack_ref TO service_role;

INSERT INTO public.ce_legal_pack_ref (domain, code, label, tone, display_order, numeric_value) VALUES
 ('READINESS','NOT_STARTED','Not started','muted',10,NULL),
 ('READINESS','IN_PROGRESS','In progress','info',20,NULL),
 ('READINESS','MISSING_MANDATORY','Missing mandatory items','destructive',30,NULL),
 ('READINESS','READY','Ready for approval','success',40,NULL),
 ('ITEM_STATUS','COMPLETE','Complete','success',10,NULL),
 ('ITEM_STATUS','MISSING','Missing','destructive',20,NULL),
 ('ITEM_STATUS','NOT_APPLICABLE','Not applicable','muted',30,NULL),
 ('ITEM_STATUS','REQUIRES_REVIEW','Requires review','warning',40,NULL),
 ('GROUP','CASE_EMPLOYER','Case & Employer',NULL,10,NULL),
 ('GROUP','FINANCIAL','Financial Evidence',NULL,20,NULL),
 ('GROUP','NOTICES','Notices / Communications',NULL,30,NULL),
 ('GROUP','INSPECTION','Inspection / Findings',NULL,40,NULL),
 ('GROUP','PAYMENTS','Payment / Arrangement History',NULL,50,NULL),
 ('GROUP','LEGAL_DOCS','Legal Documents',NULL,60,NULL),
 ('GROUP','APPROVALS','Management Approval / Certifications',NULL,70,NULL),
 ('THRESHOLD','PREPARATION_SLA_DAYS','Preparation SLA (days)',NULL,10,5),
 ('THRESHOLD','REWORK_SLA_DAYS','Rework SLA (days)',NULL,20,3),
 ('THRESHOLD','HIGH_VALUE_AMOUNT','High value exposure',NULL,30,50000)
ON CONFLICT (domain, code) DO NOTHING;

-- 2. Checklist definitions ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ce_legal_pack_item_def (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE,
  label              text NOT NULL,
  description        text,
  group_code         text NOT NULL DEFAULT 'CASE_EMPLOYER',
  is_required        boolean NOT NULL DEFAULT true,
  is_active          boolean NOT NULL DEFAULT true,
  display_order      integer NOT NULL DEFAULT 0,
  validation_mode    text NOT NULL DEFAULT 'MANUAL'
                     CHECK (validation_mode IN ('MANUAL','AUTO','HYBRID')),
  auto_source        text,
  requires_document  boolean NOT NULL DEFAULT false,
  document_type_code text,
  min_amount         numeric NOT NULL DEFAULT 0,
  applies_reason_codes text[] NOT NULL DEFAULT '{}',
  guidance           text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         text
);
GRANT SELECT ON public.ce_legal_pack_item_def TO authenticated;
GRANT ALL ON public.ce_legal_pack_item_def TO service_role;

INSERT INTO public.ce_legal_pack_item_def
 (code,label,description,group_code,is_required,display_order,validation_mode,auto_source,requires_document,document_type_code) VALUES
 ('EMPLOYER_PROFILE','Employer profile','Registered employer identity attached to the referral.','CASE_EMPLOYER',true,10,'AUTO','EMPLOYER_PROFILE',false,NULL),
 ('CASE_SUMMARY','Case summary','Source compliance case with a recorded summary.','CASE_EMPLOYER',true,20,'AUTO','CASE_SUMMARY',false,NULL),
 ('LINKED_VIOLATIONS','Linked violations','At least one violation or referral item linked to the referral.','CASE_EMPLOYER',true,30,'AUTO','LINKED_VIOLATIONS',false,NULL),
 ('NOTICES_ISSUED','Notices issued','Statutory notices issued on the source case.','NOTICES',true,40,'AUTO','NOTICES_ISSUED',false,NULL),
 ('DELIVERY_PROOF','Delivery proof','Recorded delivery of at least one issued notice.','NOTICES',true,50,'AUTO','DELIVERY_PROOF',false,NULL),
 ('EMPLOYER_RESPONSES','Employer responses','Responses received from the employer, where any exist.','NOTICES',false,60,'AUTO','EMPLOYER_RESPONSES',false,NULL),
 ('PAYMENT_HISTORY','Payment history','Employer financial ledger history for the referred debt.','PAYMENTS',true,70,'AUTO','PAYMENT_HISTORY',false,NULL),
 ('ARRANGEMENT_BREACHES','Arrangement breaches','Payment arrangement breach history, where applicable.','PAYMENTS',false,80,'AUTO','ARRANGEMENT_BREACHES',false,NULL),
 ('INSPECTION_EVIDENCE','Inspection evidence','Inspection evidence captured against the case.','INSPECTION',false,90,'AUTO','INSPECTION_EVIDENCE',false,NULL),
 ('FINANCIAL_BREAKDOWN','Financial breakdown','Principal, penalty and interest breakdown recorded on the referral.','FINANCIAL',true,95,'AUTO','FINANCIAL_BREAKDOWN',false,NULL),
 ('SUPPORTING_DOCUMENTS','Supporting documents','Documents attached to the referral pack.','LEGAL_DOCS',true,100,'HYBRID','PACK_DOCUMENTS',true,'SUPPORTING'),
 ('OFFICER_RECOMMENDATION','Officer recommendation','Compliance officer recommendation confirming legal action.','APPROVALS',true,110,'MANUAL',NULL,false,NULL),
 ('TIMELINE','Timeline of events','Chronology of compliance action confirmed by the preparer.','APPROVALS',true,120,'MANUAL',NULL,false,NULL)
ON CONFLICT (code) DO NOTHING;

-- 3. Extend the existing pack items table ---------------------------------
ALTER TABLE public.ce_legal_pack_items
  ADD COLUMN IF NOT EXISTS item_status      text NOT NULL DEFAULT 'MISSING',
  ADD COLUMN IF NOT EXISTS completion_mode  text NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS group_code       text NOT NULL DEFAULT 'CASE_EMPLOYER',
  ADD COLUMN IF NOT EXISTS display_order    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_source      text,
  ADD COLUMN IF NOT EXISTS requires_document boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_evidence    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS satisfied_by_name text,
  ADD COLUMN IF NOT EXISTS pack_version_no  integer NOT NULL DEFAULT 1;

UPDATE public.ce_legal_pack_items SET item_status = CASE WHEN is_satisfied THEN 'COMPLETE' ELSE 'MISSING' END
 WHERE item_status = 'MISSING' AND is_satisfied;

CREATE INDEX IF NOT EXISTS ix_ce_legal_pack_items_referral ON public.ce_legal_pack_items(referral_id);

-- 4. Pack versions ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ce_legal_pack_version (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id        uuid NOT NULL,
  version_no         integer NOT NULL,
  status             text NOT NULL DEFAULT 'SUBMITTED'
                     CHECK (status IN ('DRAFT','SUBMITTED','RETURNED','SUPERSEDED')),
  checklist_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  documents_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  totals_snapshot    jsonb NOT NULL DEFAULT '{}'::jsonb,
  workflow_snapshot  jsonb NOT NULL DEFAULT '{}'::jsonb,
  submission_key     text,
  submitted_at       timestamptz,
  submitted_by       text,
  submitted_by_name  text,
  returned_at        timestamptz,
  returned_by        text,
  return_reason      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (referral_id, version_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ce_legal_pack_version_key
  ON public.ce_legal_pack_version(referral_id, submission_key) WHERE submission_key IS NOT NULL;
GRANT SELECT ON public.ce_legal_pack_version TO authenticated;
GRANT ALL ON public.ce_legal_pack_version TO service_role;

-- 5. Pack history ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ce_legal_pack_event (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id  uuid NOT NULL,
  version_no   integer,
  event_code   text NOT NULL,
  description  text,
  actor_code   text,
  actor_name   text,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ce_legal_pack_event_referral ON public.ce_legal_pack_event(referral_id, created_at DESC);
GRANT SELECT ON public.ce_legal_pack_event TO authenticated;
GRANT ALL ON public.ce_legal_pack_event TO service_role;

-- 6. Automatic validation ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.ce_legal_pack_auto_v1(p_referral_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r          public.ce_legal_referrals%ROWTYPE;
  v_out      jsonb := '{}'::jsonb;
  v_case     public.ce_cases%ROWTYPE;
  v_n        integer;
BEGIN
  SELECT * INTO r FROM public.ce_legal_referrals WHERE id = p_referral_id;
  IF NOT FOUND THEN RETURN v_out; END IF;
  SELECT * INTO v_case FROM public.ce_cases WHERE id = r.source_case_id;

  v_out := v_out || jsonb_build_object('EMPLOYER_PROFILE', jsonb_build_object(
    'ok', (COALESCE(r.employer_id,'') <> '' AND COALESCE(r.employer_name,'') <> ''),
    'count', CASE WHEN COALESCE(r.employer_id,'') <> '' THEN 1 ELSE 0 END,
    'detail', COALESCE(r.employer_name,'No employer recorded on the referral')));

  v_out := v_out || jsonb_build_object('CASE_SUMMARY', jsonb_build_object(
    'ok', (v_case.id IS NOT NULL AND COALESCE(v_case.summary,'') <> ''),
    'count', CASE WHEN v_case.id IS NOT NULL THEN 1 ELSE 0 END,
    'detail', COALESCE(v_case.case_number, 'No source compliance case linked')));

  SELECT COUNT(*) INTO v_n FROM public.ce_violations v
   WHERE v.case_id = r.source_case_id AND COALESCE(v.is_deleted,false) = false;
  IF v_n = 0 THEN
    SELECT COUNT(*) INTO v_n FROM public.core_legal_referral_item i WHERE i.referral_id = r.id;
  END IF;
  v_out := v_out || jsonb_build_object('LINKED_VIOLATIONS', jsonb_build_object(
    'ok', v_n > 0, 'count', v_n, 'detail', v_n || ' violation(s) linked'));

  SELECT COUNT(*) INTO v_n FROM public.ce_notices n
   WHERE n.case_id = r.source_case_id AND UPPER(COALESCE(n.status,'')) NOT IN ('DRAFT','CANCELLED');
  v_out := v_out || jsonb_build_object('NOTICES_ISSUED', jsonb_build_object(
    'ok', v_n > 0, 'count', v_n, 'detail', v_n || ' notice(s) issued'));

  SELECT COUNT(*) INTO v_n FROM public.ce_notices n
   WHERE n.case_id = r.source_case_id
     AND (n.delivered_at IS NOT NULL
          OR EXISTS (SELECT 1 FROM public.ce_notice_delivery_log d
                      WHERE d.notice_id = n.id AND UPPER(COALESCE(d.status,'')) LIKE 'DELIVERED%'));
  v_out := v_out || jsonb_build_object('DELIVERY_PROOF', jsonb_build_object(
    'ok', v_n > 0, 'count', v_n, 'detail', v_n || ' notice(s) with recorded delivery'));

  SELECT COUNT(*) INTO v_n FROM public.ce_notice_responses x WHERE x.case_id = r.source_case_id;
  v_out := v_out || jsonb_build_object('EMPLOYER_RESPONSES', jsonb_build_object(
    'ok', v_n > 0, 'count', v_n, 'detail', v_n || ' employer response(s) recorded'));

  SELECT COUNT(*) INTO v_n FROM public.ce_employer_financial_ledger l
   WHERE l.employer_id = r.employer_id;
  v_out := v_out || jsonb_build_object('PAYMENT_HISTORY', jsonb_build_object(
    'ok', v_n > 0, 'count', v_n, 'detail', v_n || ' ledger entries available'));

  SELECT COUNT(*) INTO v_n FROM public.ce_arrangement_breaches b
   WHERE b.case_id = r.source_case_id;
  v_out := v_out || jsonb_build_object('ARRANGEMENT_BREACHES', jsonb_build_object(
    'ok', v_n > 0, 'count', v_n, 'detail', v_n || ' arrangement breach(es) recorded'));

  SELECT COUNT(*) INTO v_n FROM public.ce_inspection_evidence e
   WHERE e.inspection_id IN (SELECT i.id FROM public.ce_inspections i WHERE i.case_id = r.source_case_id)
     AND COALESCE(e.file_state,'AVAILABLE') <> 'MISSING';
  v_out := v_out || jsonb_build_object('INSPECTION_EVIDENCE', jsonb_build_object(
    'ok', v_n > 0, 'count', v_n, 'detail', v_n || ' evidence item(s) linked'));

  v_out := v_out || jsonb_build_object('FINANCIAL_BREAKDOWN', jsonb_build_object(
    'ok', COALESCE(r.grand_total, r.total_referred_amount, 0) > 0,
    'count', 1,
    'detail', 'Grand total ' || COALESCE(r.grand_total, r.total_referred_amount, 0)::text));

  SELECT COUNT(*) INTO v_n FROM public.core_legal_referral_document d
   WHERE d.referral_id = r.id
     AND (d.storage_path IS NOT NULL OR d.dms_document_id IS NOT NULL);
  v_out := v_out || jsonb_build_object('PACK_DOCUMENTS', jsonb_build_object(
    'ok', v_n > 0, 'count', v_n, 'detail', v_n || ' accessible document(s) attached'));

  RETURN v_out;
END $$;

-- 7. Sync checklist from configuration -------------------------------------
CREATE OR REPLACE FUNCTION public.ce_legal_pack_sync_v1(p_referral_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r     public.ce_legal_referrals%ROWTYPE;
  d     record;
  auto  jsonb;
  ev    jsonb;
  ok    boolean;
BEGIN
  SELECT * INTO r FROM public.ce_legal_referrals WHERE id = p_referral_id;
  IF NOT FOUND THEN RETURN; END IF;
  auto := public.ce_legal_pack_auto_v1(p_referral_id);

  FOR d IN
    SELECT * FROM public.ce_legal_pack_item_def
     WHERE is_active
       AND COALESCE(r.grand_total, r.total_referred_amount, 0) >= min_amount
       AND (cardinality(applies_reason_codes) = 0
            OR COALESCE(r.referral_reason_code,'') = ANY (applies_reason_codes))
     ORDER BY display_order
  LOOP
    INSERT INTO public.ce_legal_pack_items
      (referral_id, item_key, item_label, is_required, is_satisfied, item_status,
       completion_mode, group_code, display_order, auto_source, requires_document)
    SELECT p_referral_id, d.code, d.label, d.is_required, false, 'MISSING',
           CASE WHEN d.validation_mode = 'MANUAL' THEN 'MANUAL' ELSE 'AUTO' END,
           d.group_code, d.display_order, d.auto_source, d.requires_document
    WHERE NOT EXISTS (SELECT 1 FROM public.ce_legal_pack_items i
                       WHERE i.referral_id = p_referral_id AND i.item_key = d.code);

    UPDATE public.ce_legal_pack_items i
       SET item_label = d.label,
           is_required = d.is_required,
           group_code = d.group_code,
           display_order = d.display_order,
           auto_source = d.auto_source,
           requires_document = d.requires_document,
           completion_mode = CASE WHEN d.validation_mode = 'MANUAL' THEN 'MANUAL' ELSE 'AUTO' END
     WHERE i.referral_id = p_referral_id AND i.item_key = d.code;

    IF d.validation_mode IN ('AUTO','HYBRID') AND d.auto_source IS NOT NULL THEN
      ev := COALESCE(auto -> d.auto_source, '{}'::jsonb);
      ok := COALESCE((ev ->> 'ok')::boolean, false);
      UPDATE public.ce_legal_pack_items i
         SET is_satisfied = ok,
             item_status = CASE WHEN ok THEN 'COMPLETE'
                                WHEN d.is_required THEN 'MISSING' ELSE 'NOT_APPLICABLE' END,
             auto_evidence = ev,
             satisfied_by = CASE WHEN ok THEN 'SYSTEM' ELSE NULL END,
             satisfied_by_name = CASE WHEN ok THEN 'Automatic validation' ELSE NULL END,
             satisfied_at = CASE WHEN ok THEN now() ELSE NULL END,
             updated_at = now()
       WHERE i.referral_id = p_referral_id AND i.item_key = d.code;
    END IF;
  END LOOP;

  DELETE FROM public.ce_legal_pack_items i
   WHERE i.referral_id = p_referral_id
     AND NOT EXISTS (SELECT 1 FROM public.ce_legal_pack_item_def d2
                      WHERE d2.code = i.item_key AND d2.is_active)
     AND i.completion_mode <> 'MANUAL';
END $$;

-- 8. Approval workflow resolution (mirrors the compliance mapping rules) ----
CREATE OR REPLACE FUNCTION public.ce_legal_pack_workflow_v1(p_referral_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r        public.ce_legal_referrals%ROWTYPE;
  c        public.ce_cases%ROWTYPE;
  m        record;
  v_levels integer := 0;
  v_role   text;
BEGIN
  SELECT * INTO r FROM public.ce_legal_referrals WHERE id = p_referral_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','REFERRAL_NOT_FOUND'); END IF;
  SELECT * INTO c FROM public.ce_cases WHERE id = r.source_case_id;

  SELECT wm.*, wd.name AS wf_name, wd.is_active AS wf_active
    INTO m
    FROM public.ce_workflow_mappings wm
    LEFT JOIN public.workflow_definitions wd ON wd.id = wm.workflow_definition_id
   WHERE wm.event_key = 'legal.escalation_approval'
     AND (wm.applicable_fund IS NULL OR c.fund_type IS NULL OR wm.applicable_fund = c.fund_type)
     AND (wm.applicable_min_amount IS NULL
          OR COALESCE(r.grand_total, r.total_referred_amount, 0) >= wm.applicable_min_amount)
     AND wm.enabled AND wm.workflow_definition_id IS NOT NULL AND COALESCE(wd.is_active,true)
   ORDER BY (CASE WHEN wm.applicable_fund IS NOT NULL THEN 1 ELSE 0 END
             + CASE WHEN wm.applicable_min_amount IS NOT NULL THEN 1 ELSE 0 END) DESC,
            wm.priority ASC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'enabled', false, 'workflow_definition_id', NULL, 'workflow_name', NULL,
      'levels', 0, 'next_approver_role', NULL, 'auto_approve', true,
      'context', jsonb_build_object(
        'amount', COALESCE(r.grand_total, r.total_referred_amount, 0),
        'fund', c.fund_type, 'case_type', c.case_type, 'zone', r.employer_zone,
        'reason_code', r.referral_reason_code, 'risk_band', c.risk_band));
  END IF;

  SELECT COUNT(*), MIN(assigned_role) INTO v_levels, v_role
    FROM public.workflow_steps s WHERE s.workflow_id = m.workflow_definition_id;

  RETURN jsonb_build_object(
    'enabled', true,
    'workflow_definition_id', m.workflow_definition_id,
    'workflow_name', m.wf_name,
    'levels', COALESCE(v_levels,0),
    'next_approver_role', v_role,
    'auto_approve', false,
    'mapping_id', m.id,
    'context', jsonb_build_object(
      'amount', COALESCE(r.grand_total, r.total_referred_amount, 0),
      'fund', c.fund_type, 'case_type', c.case_type, 'zone', r.employer_zone,
      'reason_code', r.referral_reason_code, 'risk_band', c.risk_band));
END $$;

GRANT EXECUTE ON FUNCTION public.ce_legal_pack_auto_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_legal_pack_sync_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ce_legal_pack_workflow_v1(uuid) TO authenticated;
