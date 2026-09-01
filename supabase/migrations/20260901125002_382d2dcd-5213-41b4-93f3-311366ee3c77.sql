-- Fix WF_NCP_Assistance_pension: the "Payment Authorization" step was bound to
-- stage code AWARD_SETUP, so claims in AWARD_SETUP status were routed into the
-- Payment Preparation basket. Rebind it to PAYMENT and add the missing
-- AWARD_SETUP stage owned by the Award Setup basket.
UPDATE public.bn_workflow_template
SET steps_config = jsonb_build_array(
  jsonb_build_object(
    'name','Intake','step','INTAKE','step_code','Intake','step_name','Intake',
    'step_type','INTAKE','role','CLAIMS_CLERK','assigned_role','BN_INTAKE_OFFICER',
    'sla_hours',24,'workbasket_id','63e2ed18-3cba-4ad2-b21b-fa02e5d9cb1c'
  ),
  jsonb_build_object(
    'name','Verification','step','VERIFICATION','step_code','MEANS_TEST',
    'step_type','CALCULATION','role','CLAIMS_OFFICER','assigned_role','BN_CALCULATION_OFFICER',
    'sla_hours',240,'workbasket_id','32af1ed1-acf9-4a58-817f-791da6bf086e'
  ),
  jsonb_build_object(
    'name','Eligibility & Calculation','step','ELIGIBILITY','step_code','EVIDENCE_REVIEW',
    'step_name','EVIDENCE_REVIEW','step_type','REVIEW','role','CLAIMS_OFFICER',
    'assigned_role','BN_ELIGIBILITY_OFFICER','sla_hours',112,
    'workbasket_id','c0a1687c-b2d6-4024-bf95-3bc5e43fa422'
  ),
  jsonb_build_object(
    'name','Approval','step','APPROVAL','step_code','DECISION','step_name','DECISION',
    'step_type','DECISION','role','CLAIMS_SUPERVISOR','assigned_role','BN_MANAGER',
    'sla_hours',120,'workbasket_id','6b1bab36-9c26-4f38-9528-dcfd320c7378'
  ),
  jsonb_build_object(
    'name','Award Setup','step','AWARD_SETUP','step_code','AWARD_SETUP','step_name','AWARD_SETUP',
    'step_type','AWARD','role','AWARD_OFFICER','assigned_role','BN_AWARD_OFFICER',
    'sla_hours',48,'workbasket_id','153c133d-7393-4bbb-9574-d72dfe06b8c2'
  ),
  jsonb_build_object(
    'name','Payment Authorization','step','PAYMENT','step_code','PAYMENT','step_name','PAYMENT',
    'step_type','PAYMENT','role','PAYMENTS_OFFICER','assigned_role','BN_PAYMENT_OFFICER',
    'sla_hours',24,'workbasket_id','274418ad-a30c-4cf3-9b48-12bde70ea0e1'
  )
)
WHERE id = '5e2ef365-a01c-47ee-be46-de84c9651d7d';