-- Stage 1B: 2027 risk assessment baseline across the active audit universe
DO $seed$
DECLARE
  r RECORD;
  v_overall numeric;
  v_level text;
BEGIN
  -- Supersede prior assessments so the planning engine averages one current view per function
  UPDATE public.ia_risk_assessments
     SET is_active = false,
         updated_by = 'STAGE_1B',
         updated_at = now()
   WHERE is_active = true;

  FOR r IN
    SELECT * FROM (VALUES
      ('e2f1651e-135a-40f2-b738-b8f8ee86baf4'::uuid,3,3,3,2,2,2,'Operational','Fixed asset custody, tagging and disposal controls'),
      ('39058b86-2793-4501-9eec-5421df42147c'::uuid,2,2,3,2,1,1,'Operational','Facilities upkeep, utilities and premises safety'),
      ('a943ca03-a5e9-41f5-8c93-1446040d5ff3'::uuid,3,3,2,2,2,2,'Operational','Stores receipting, issue and stock-count integrity'),
      ('2a85ed97-47e0-46dd-94c5-fbeb5ea258c8'::uuid,4,4,2,3,4,4,'Procurement','Tendering, vendor selection and contract award integrity'),
      ('cecc56a8-4c80-470e-83da-7fc20dcca848'::uuid,5,4,3,4,5,5,'Financial','Accuracy, authorisation and timeliness of benefit payments'),
      ('c2cf28c7-d365-4e0a-9e87-9c816d225249'::uuid,4,3,3,3,4,3,'Compliance','Employment injury adjudication and medical certification'),
      ('fac31511-1c9b-4fc9-ae25-7ee4fe1caadf'::uuid,5,4,3,3,5,5,'Financial','Long-term pension entitlement, life certification and continuity'),
      ('d4ad390f-a25e-4cdd-b4ab-84454c1e8858'::uuid,3,3,3,2,3,3,'Operational','Medical board scheduling, quorum and decision recording'),
      ('a349708a-05fe-43d0-b2d7-96671e238f8e'::uuid,4,4,2,3,4,4,'Financial','Detection, calculation and recovery of overpaid benefits'),
      ('58ac91a5-7c20-45f7-9368-e3567f74196c'::uuid,4,4,3,3,4,3,'Operational','Short-term benefit eligibility and payment turnaround'),
      ('9ad1db2f-b39a-4588-bcb7-1e80f440f8d5'::uuid,4,4,2,3,3,3,'Financial','Arrears ageing, payment plans and write-off governance'),
      ('fcd15d62-b2b7-4acc-9837-7c6897210775'::uuid,5,4,3,4,5,4,'Financial','C3 contribution capture, posting and reconciliation'),
      ('7c418769-5d74-44db-9f4f-92ef9068df49'::uuid,4,3,3,2,4,3,'Compliance','Employer registration completeness and ongoing monitoring'),
      ('fd795c96-bbc9-448d-89be-cacbfec268ad'::uuid,3,3,3,2,3,3,'Compliance','Inspection coverage, evidence quality and follow-through'),
      ('f58aba7e-d09f-44fc-8d8e-26c8eaf80845'::uuid,4,4,2,3,4,3,'Compliance','Self-employed declaration accuracy and collection'),
      ('ea306288-a59e-4b77-8f40-9854b66ef012'::uuid,4,3,3,2,3,3,'Financial','Supplier payment authorisation and duplicate prevention'),
      ('bce721ce-885f-4c9b-8a46-303d13dac91a'::uuid,4,4,3,3,3,3,'Financial','Receivables ageing, collection effort and provisioning'),
      ('c76df778-7816-487b-ab77-f8f3a055c558'::uuid,3,2,4,2,3,2,'Strategic','Budget preparation, virement control and forecasting'),
      ('8e98eb77-4e09-40c9-9249-2ad79c068733'::uuid,4,3,4,2,4,3,'Financial','Ledger integrity, journal control and statutory reporting'),
      ('844d31aa-dea6-4559-ae0e-4351717bda02'::uuid,4,3,3,2,4,3,'People','Payroll accuracy, statutory deductions and masterfile control'),
      ('b4e322bb-b1a3-47ab-8859-d89c9860b409'::uuid,5,3,3,4,4,4,'Financial','Bank mandates, cash positioning and investment custody'),
      ('921073f4-2ac7-44d7-a394-8b0ccafa19b9'::uuid,2,3,3,2,2,2,'People','Leave entitlement, attendance capture and accrual accuracy'),
      ('c3df7839-a709-4f93-ad5b-2a30a73dbbff'::uuid,2,3,3,1,2,2,'People','Appraisal completion, moderation and consequence management'),
      ('971e4c75-9cb4-4dcd-9da0-bd506971cbf2'::uuid,3,3,3,2,3,3,'People','Recruitment fairness, vetting and onboarding controls'),
      ('b2c8f703-5a98-4216-9eaa-df77ca077f57'::uuid,2,2,3,1,1,2,'People','Training needs analysis, delivery and spend'),
      ('da2255fb-942e-4a79-8e3e-758d6e8c7e43'::uuid,4,4,3,4,3,3,'Technology','Change control, release management and code quality'),
      ('0ab4e5da-b091-4368-a9bd-70225ce3d8b4'::uuid,4,3,3,3,4,3,'Data Integrity','Data warehouse integrity and management reporting accuracy'),
      ('6bb39837-daf1-4994-b38b-09087e9bc62d'::uuid,4,3,3,4,3,4,'Technology','Infrastructure resilience, backup and network availability'),
      ('e2c29262-7208-4eb8-945d-1c40035c5928'::uuid,3,3,3,2,4,3,'Governance','IT policy framework, standards adherence and oversight'),
      ('42afc0cd-a38a-4d8e-82ba-ad8fc40a37f6'::uuid,5,4,2,5,5,5,'IT','Identity, privileged access and cyber-security controls'),
      ('26bc2ae5-b3b0-4cd3-b500-eb9c362e476e'::uuid,3,2,4,1,3,3,'Governance','Internal audit planning, execution and standards conformance'),
      ('df21d200-d3c7-49ae-a336-061deed64519'::uuid,2,2,4,1,2,2,'Governance','Quality assurance and improvement programme'),
      ('7c493b9f-f4f4-4384-ac77-c494adc475e5'::uuid,3,2,3,2,4,3,'Compliance','Legal advisory, litigation exposure and statutory interpretation'),
      ('7245acd0-1c08-412b-9dbb-51494605a342'::uuid,2,2,3,2,2,4,'Reputational','Public communications, media handling and disclosure control'),
      ('a207ae8d-c70c-4487-bdcc-458b3e6fcdc9'::uuid,3,2,4,2,2,3,'Strategic','Corporate strategy, policy development and performance tracking'),
      ('dd21136c-79df-42b1-9b70-ccdcd339c7a6'::uuid,4,4,2,3,4,4,'Data Integrity','Duplicate identity detection and master data quality'),
      ('db9a6e38-67c5-4030-9bd1-1ada2f5886b3'::uuid,4,4,3,3,4,4,'Data Integrity','Insured person registration accuracy and identity proofing'),
      ('90b05dd7-df9f-48e7-8826-11af8e22befa'::uuid,3,3,3,2,3,2,'Operational','Records retention, archival and retrieval controls')
    ) AS t(function_id, impact, likelihood, control_eff, velocity, regulatory, reputational, category, descr)
  LOOP
    -- Inherent/residual model: impact and likelihood dominate, weak controls increase residual risk
    v_overall := ROUND(
      ( r.impact * 0.30
      + r.likelihood * 0.25
      + (6 - r.control_eff) * 0.20
      + r.velocity * 0.10
      + r.regulatory * 0.10
      + r.reputational * 0.05
      ) * 20, 2);

    v_level := CASE
      WHEN v_overall >= 80 THEN 'Critical'
      WHEN v_overall >= 60 THEN 'High'
      WHEN v_overall >= 40 THEN 'Medium'
      ELSE 'Low'
    END;

    INSERT INTO public.ia_risk_assessments (
      function_id, audit_universe_id, assessment_date, assessment_year, assessed_by,
      impact_score, likelihood_score, control_effectiveness_score, velocity_score,
      regulatory_score, reputational_score, overall_risk_score, risk_level,
      risk_category, risk_description, risk_owner, notes, is_active, created_by, updated_by
    )
    SELECT
      r.function_id,
      (SELECT u.id FROM public.ia_audit_universe u
        WHERE u.function_id = r.function_id AND COALESCE(u.is_active, true) = true
        ORDER BY u.created_at DESC LIMIT 1),
      DATE '2026-10-01', '2027', 'Head of Internal Audit',
      r.impact, r.likelihood, r.control_eff, r.velocity,
      r.regulatory, r.reputational, v_overall, v_level,
      r.category, r.descr,
      COALESCE((SELECT d.head FROM public.ia_departments d
                 JOIN public.ia_department_functions f2 ON f2.department_id = d.id
                WHERE f2.id = r.function_id), 'Department Head'),
      'Stage 1B 2027 annual risk assessment. Residual score = (impact*0.30 + likelihood*0.25 + (6-control effectiveness)*0.20 + velocity*0.10 + regulatory*0.10 + reputational*0.05) * 20.',
      true, 'STAGE_1B', 'STAGE_1B';

    -- Keep the audit universe risk rating aligned with the current assessment
    UPDATE public.ia_department_functions
       SET risk_rating = v_level, updated_at = now()
     WHERE id = r.function_id;

    UPDATE public.ia_audit_universe
       SET risk_category = v_level,
           residual_risk_score = v_overall,
           updated_by = 'STAGE_1B',
           updated_at = now()
     WHERE function_id = r.function_id;
  END LOOP;
END
$seed$;

DO $chk$
DECLARE v_n integer; v_lv integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.ia_risk_assessments WHERE is_active = true AND assessment_year = '2027';
  IF v_n <> 38 THEN RAISE EXCEPTION 'Expected 38 active 2027 risk assessments, found %', v_n; END IF;
  SELECT count(DISTINCT risk_level) INTO v_lv FROM public.ia_risk_assessments WHERE is_active = true;
  IF v_lv < 3 THEN RAISE EXCEPTION 'Risk assessment did not differentiate risk levels (% distinct)', v_lv; END IF;
END
$chk$;