
DO $$
DECLARE v_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.bn_risk_scoring_rule_set) THEN RETURN; END IF;

  INSERT INTO public.bn_risk_scoring_rule_set(rule_set_code, version_no, name, description,
    score_scale_min, score_scale_max, score_scale_label, status, effective_from,
    validated_at, activated_at)
  VALUES ('BN_STANDARD', 1, 'Benefits standard risk scoring',
    'Standard deterministic scoring configuration for benefit risk assessments. '
    || 'Each rule inspects factors recorded on the assessment and contributes a fixed number of points.',
    0, 100, 'points out of 100', 'ACTIVE', now(), now(), now())
  RETURNING rule_set_id INTO v_id;

  INSERT INTO public.bn_risk_scoring_rule(rule_set_id, rule_code, name, description,
    factor_type_code, direction_code, operator, comparison_numeric, comparison_code,
    requires_usable_evidence, contribution, max_contribution, sort_order)
  VALUES
    (v_id,'IDENTITY_CONCERN','Identity inconsistency recorded',
     'Adds points where an identity inconsistency factor is recorded against the person.',
     'IDENTITY_INCONSISTENCY','INCREASES_CONCERN','FACTOR_PRESENT',NULL,NULL,false,20,20,10),
    (v_id,'EMPLOYER_MISMATCH','Employer information does not match',
     'Adds points where recorded employment information conflicts with the claim.',
     'EMPLOYER_MISMATCH','INCREASES_CONCERN','FACTOR_PRESENT',NULL,NULL,false,12,24,20),
    (v_id,'INCOME_MATERIAL','Material income inconsistency',
     'Adds points where an income inconsistency is assessed as at least medium materiality.',
     'INCOME_INCONSISTENCY','INCREASES_CONCERN','MATERIALITY_AT_LEAST',NULL,'MEDIUM',false,15,30,30),
    (v_id,'ASSET_MATERIAL','Material asset inconsistency',
     'Adds points where an asset inconsistency is assessed as at least medium materiality.',
     'ASSET_INCONSISTENCY','INCREASES_CONCERN','MATERIALITY_AT_LEAST',NULL,'MEDIUM',false,12,24,40),
    (v_id,'PAYMENT_ANOMALY','Payment anomaly recorded',
     'Adds points where a payment anomaly factor is recorded.',
     'PAYMENT_ANOMALY','INCREASES_CONCERN','FACTOR_PRESENT',NULL,NULL,false,10,20,50),
    (v_id,'DUPLICATE_BENEFIT','Possible duplicate benefit',
     'Adds points where a duplicate benefit indicator is recorded.',
     'DUPLICATE_BENEFIT_INDICATOR','INCREASES_CONCERN','FACTOR_PRESENT',NULL,NULL,false,18,18,60),
    (v_id,'DATE_CONFLICT','Date of event conflict',
     'Adds points where recorded dates conflict with the benefit event.',
     'DATE_OF_EVENT_CONFLICT','INCREASES_CONCERN','FACTOR_PRESENT',NULL,NULL,false,10,20,70),
    (v_id,'CONCERN_VOLUME','Several concerns recorded together',
     'Adds points where three or more concern-increasing factors are recorded on the same assessment.',
     NULL,'INCREASES_CONCERN','FACTOR_COUNT_AT_LEAST',3,NULL,false,8,8,80),
    (v_id,'SUPPORTING_EXPLANATION','Accepted supporting explanation',
     'Reduces the score where a supporting explanation is recorded with usable evidence.',
     'SUPPORTING_EXPLANATION','REDUCES_CONCERN','FACTOR_PRESENT',NULL,NULL,true,-15,30,90),
    (v_id,'SYSTEM_OR_STAFF_ERROR','System or staff error identified',
     'Reduces the score where the cause is identified as a system or staff processing error with usable evidence.',
     'SYSTEM_CONFIGURATION_ERROR','REDUCES_CONCERN','FACTOR_PRESENT',NULL,NULL,true,-20,20,100);

  INSERT INTO public.bn_risk_scoring_band(rule_set_id, band_code, label, description,
    min_score, max_score, review_priority, sort_order)
  VALUES
    (v_id,'LOW','Low','Little or no indication of fraud or error.',0,19,'ROUTINE',10),
    (v_id,'MODERATE','Moderate','Some concerns recorded; officer review required.',20,39,'STANDARD',20),
    (v_id,'HIGH','High','Significant concerns recorded; priority officer review.',40,69,'PRIORITY',30),
    (v_id,'VERY_HIGH','Very high','Serious concerns recorded; senior review required.',70,100,'URGENT',40);

  INSERT INTO public.bn_risk_scoring_rule_set_event(rule_set_id, event_code, command_name,
    to_status, justification, entity_version)
  VALUES (v_id,'SCORING_CONFIG_ACTIVATED','SEED','ACTIVE',
    'Provided as the standard starting risk scoring configuration.',1);
END $$;
