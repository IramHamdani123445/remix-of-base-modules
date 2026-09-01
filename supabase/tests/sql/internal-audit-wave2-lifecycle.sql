-- ============================================================================
-- Internal Audit — Wave 2 Executable Lifecycle Regression Suite
-- ----------------------------------------------------------------------------
-- Drives one complete engagement lifecycle through the governed commands and
-- asserts every gate, segregation-of-duty rule and audit-event obligation.
--
-- Run with a privileged (service_role / owner) connection:
--     psql "$SUPABASE_DB_URL" -f supabase/tests/sql/internal-audit-wave2-lifecycle.sql
--
-- Any failure RAISES EXCEPTION, so a non-zero exit means the Wave 2 lifecycle
-- has regressed. All fixtures are tagged WAVE2_TEST and removed at the end.
-- ============================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_actor_id   uuid;
  v_dept       uuid;
  v_lead       uuid;
  v_reviewer   uuid;
  v_eng        uuid;
  v_act        uuid;
  v_ev         uuid;
  v_wp         uuid;
  v_test       uuid;
  v_ctrl       uuid;
  v_find       uuid;
  v_resp       uuid;
  v_rec        uuid;
  v_action     uuid;
  v_qa         uuid;
  v_report     uuid;
  r            jsonb;
  v_n          integer;
  v_events_before integer;
BEGIN
  -- ------------------------------------------------------------------
  -- FIXTURES (owner context)
  -- ------------------------------------------------------------------
  SELECT u.id INTO v_actor_id
    FROM public.profiles u JOIN public.user_roles ur ON ur.user_id = u.id AND ur.role = 'Admin'
   ORDER BY u.created_at LIMIT 1;
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'WAVE2-FIXTURE: no Admin user available to drive the lifecycle'; END IF;

  SELECT id INTO v_dept FROM public.ia_departments LIMIT 1;

  SELECT id INTO v_lead FROM public.ia_auditors
   WHERE COALESCE(profile_id, user_id) IS DISTINCT FROM v_actor_id ORDER BY created_at LIMIT 1;
  SELECT id INTO v_reviewer FROM public.ia_auditors
   WHERE id <> v_lead AND COALESCE(profile_id, user_id) IS DISTINCT FROM v_actor_id ORDER BY created_at LIMIT 1;
  IF v_lead IS NULL OR v_reviewer IS NULL THEN
    RAISE EXCEPTION 'WAVE2-FIXTURE: two auditors (not the acting admin) are required';
  END IF;

  INSERT INTO public.ia_audit_engagements(
    engagement_name, engagement_code, department_id, lead_auditor_id, reviewer_id,
    status, execution_status, created_by, updated_by)
  VALUES ('WAVE2_TEST Engagement', 'WAVE2-TEST', v_dept, v_lead, v_reviewer,
          'Approved', 'Planned', 'WAVE2_TEST', 'WAVE2_TEST')
  RETURNING id INTO v_eng;

  INSERT INTO public.ia_activities(engagement_id, name, title, status, created_by, updated_by)
  VALUES (v_eng, 'WAVE2_TEST Activity', 'WAVE2_TEST Activity', 'Planned', 'WAVE2_TEST', 'WAVE2_TEST')
  RETURNING id INTO v_act;

  SELECT count(*) INTO v_events_before FROM public.ia_audit_event WHERE engagement_id = v_eng;

  -- Impersonate the admin actor under RLS.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_actor_id::text, 'role', 'authenticated')::text, true);

  -- ==================================================================
  -- W2-01  Preparation cannot complete without auditee notification
  -- ==================================================================
  r := public.ia_complete_preparation(v_eng, 'attempt without notification');
  IF COALESCE((r->>'success')::boolean, false) OR r->>'code' <> 'IA_PREP_INCOMPLETE' THEN
    RAISE EXCEPTION 'W2-01 FAILED: preparation completed without notification (%)', r;
  END IF;

  -- ==================================================================
  -- W2-02  Preparation completes once notification is recorded
  -- ==================================================================
  INSERT INTO public.ia_communication_stages(engagement_id, stage_code, stage_order, delivery_status, created_by)
  VALUES (v_eng, 'ENGAGEMENT_NOTIFICATION', 1, 'Sent', 'WAVE2_TEST');

  r := public.ia_complete_preparation(v_eng, 'notification issued');
  IF NOT COALESCE((r->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'W2-02 FAILED: preparation did not complete (%)', r;
  END IF;

  -- ==================================================================
  -- W2-03  Activity assignment rejects owner == reviewer (SoD)
  -- ==================================================================
  r := public.ia_assign_activity(v_act, v_lead, v_lead, 10);
  IF r->>'code' <> 'IA_SOD_VIOLATION' THEN
    RAISE EXCEPTION 'W2-03 FAILED: owner==reviewer accepted (%)', r;
  END IF;

  -- ==================================================================
  -- W2-04  Valid assignment succeeds
  -- ==================================================================
  r := public.ia_assign_activity(v_act, v_lead, v_reviewer, 10);
  IF NOT COALESCE((r->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'W2-04 FAILED: valid assignment rejected (%)', r;
  END IF;

  -- ==================================================================
  -- W2-05  Activity cannot complete with no evidence / working paper
  -- ==================================================================
  r := public.ia_complete_activity(v_act, 8, 'no artefacts yet');
  IF r->>'code' <> 'IA_NO_ARTEFACT' THEN
    RAISE EXCEPTION 'W2-05 FAILED: activity completed without artefacts (%)', r;
  END IF;

  -- ==================================================================
  -- W2-06  Activity completes once evidence + working paper exist
  -- ==================================================================
  INSERT INTO public.ia_evidence(evidence_id, engagement_id, activity_id, file_name, description, created_by)
  VALUES ('WAVE2-EV-001', v_eng, v_act, 'wave2-test.pdf', 'WAVE2_TEST evidence', 'WAVE2_TEST') RETURNING id INTO v_ev;
  INSERT INTO public.ia_working_papers(working_paper_id, engagement_id, activity_id, title, status, created_by)
  VALUES ('WAVE2-WP-001', v_eng, v_act, 'WAVE2_TEST working paper', 'Draft', 'WAVE2_TEST') RETURNING id INTO v_wp;

  r := public.ia_complete_activity(v_act, 8, 'fieldwork done');
  IF NOT COALESCE((r->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'W2-06 FAILED: activity completion rejected (%)', r;
  END IF;

  -- ==================================================================
  -- W2-07  Activity review records outcome
  -- ==================================================================
  r := public.ia_review_activity(v_act, 'Reviewed', 'reviewed by manager');
  IF NOT COALESCE((r->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'W2-07 FAILED: activity review rejected (%)', r;
  END IF;

  -- ==================================================================
  -- W2-08  Control test with exceptions and no finding needs a rationale
  -- ==================================================================
  SELECT id INTO v_ctrl FROM public.ia_rcm_controls LIMIT 1;
  INSERT INTO public.ia_control_tests(rcm_control_id, engagement_id, test_date, sample_size, exceptions_found, created_by)
  VALUES (v_ctrl, v_eng, current_date, 25, 3, 'WAVE2_TEST') RETURNING id INTO v_test;

  r := public.ia_conclude_control_test(v_test, 'Ineffective', 'Three exceptions observed', NULL);
  IF r->>'code' <> 'IA_RATIONALE_REQUIRED' THEN
    RAISE EXCEPTION 'W2-08 FAILED: unexplained no-finding exception accepted (%)', r;
  END IF;

  -- ==================================================================
  -- W2-09  Control test concludes with a rationale
  -- ==================================================================
  r := public.ia_conclude_control_test(v_test, 'Ineffective', 'Three exceptions observed',
        'Exceptions were immaterial and remediated during fieldwork');
  IF NOT COALESCE((r->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'W2-09 FAILED: control test conclusion rejected (%)', r;
  END IF;

  -- ==================================================================
  -- W2-10  Finding severity change requires a reason
  -- ==================================================================
  INSERT INTO public.ia_findings(finding_id, engagement_id, control_test_id, title, condition, criteria, cause, effect,
                                 risk_rating, severity, lifecycle_status, created_by)
  VALUES ('WAVE2-FND-001', v_eng, v_test, 'WAVE2_TEST Finding', 'Condition', 'Criteria', 'Cause', 'Effect',
          'Medium', 'Medium', 'Draft', 'WAVE2_TEST_AUTHOR') RETURNING id INTO v_find;

  r := public.ia_change_finding_severity(v_find, 'High', '');
  IF r->>'code' <> 'IA_REASON_REQUIRED' THEN
    RAISE EXCEPTION 'W2-10 FAILED: severity change without reason accepted (%)', r;
  END IF;

  -- ==================================================================
  -- W2-11  Severity change with reason is written to history
  -- ==================================================================
  r := public.ia_change_finding_severity(v_find, 'High', 'Aggregated exposure across branches');
  IF NOT COALESCE((r->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'W2-11 FAILED: severity change rejected (%)', r;
  END IF;
  SELECT count(*) INTO v_n FROM public.ia_finding_severity_history
   WHERE finding_id = v_find AND old_severity = 'Medium' AND new_severity = 'High';
  IF v_n <> 1 THEN RAISE EXCEPTION 'W2-11 FAILED: severity history not recorded'; END IF;

  -- ==================================================================
  -- W2-12  Finding cannot skip straight from Draft to Released
  -- ==================================================================
  r := public.ia_transition_finding(v_find, 'Released', NULL);
  IF r->>'code' <> 'IA_INVALID_TRANSITION' THEN
    RAISE EXCEPTION 'W2-12 FAILED: illegal Draft->Released transition accepted (%)', r;
  END IF;

  -- ==================================================================
  -- W2-13  Draft -> Under Review -> Confirmed
  -- ==================================================================
  r := public.ia_transition_finding(v_find, 'Under Review', NULL);
  IF NOT COALESCE((r->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'W2-13 FAILED: Under Review rejected (%)', r;
  END IF;
  r := public.ia_transition_finding(v_find, 'Confirmed', NULL);
  IF NOT COALESCE((r->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'W2-13 FAILED: Confirmed rejected (%)', r;
  END IF;

  -- ==================================================================
  -- W2-14  Release blocked without a recommendation
  -- ==================================================================
  r := public.ia_transition_finding(v_find, 'Released', NULL);
  IF r->>'code' <> 'IA_NO_RECOMMENDATION' THEN
    RAISE EXCEPTION 'W2-14 FAILED: finding released with no recommendation (%)', r;
  END IF;

  -- ==================================================================
  -- W2-15  Release succeeds once a recommendation exists
  -- ==================================================================
  INSERT INTO public.ia_recommendations(finding_id, recommendation_text, priority, status, created_by)
  VALUES (v_find, 'Implement quarterly reconciliation', 'High', 'Open', 'WAVE2_TEST') RETURNING id INTO v_rec;

  r := public.ia_transition_finding(v_find, 'Released', NULL);
  IF NOT COALESCE((r->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'W2-15 FAILED: release rejected (%)', r;
  END IF;

  -- ==================================================================
  -- W2-16  Rejected management position requires a rationale
  -- ==================================================================
  r := public.ia_record_management_response(v_find, 'Rejected', 'We disagree', NULL, NULL, NULL, NULL);
  IF r->>'code' <> 'IA_RATIONALE_REQUIRED' THEN
    RAISE EXCEPTION 'W2-16 FAILED: rejection without rationale accepted (%)', r;
  END IF;

  -- ==================================================================
  -- W2-17  Accepted position requires action plan, owner and target date
  -- ==================================================================
  r := public.ia_record_management_response(v_find, 'Accepted', 'Agreed', NULL, NULL, NULL, NULL);
  IF r->>'code' <> 'IA_ACTION_PLAN_REQUIRED' THEN
    RAISE EXCEPTION 'W2-17 FAILED: acceptance without action plan accepted (%)', r;
  END IF;

  -- ==================================================================
  -- W2-18  Valid management response moves the finding to Responded
  -- ==================================================================
  r := public.ia_record_management_response(v_find, 'Accepted', 'Agreed with the observation',
        'Roll out quarterly reconciliation', 'Head of Finance', current_date + 60, NULL);
  IF NOT COALESCE((r->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'W2-18 FAILED: valid response rejected (%)', r;
  END IF;
  v_resp := (r->>'response_id')::uuid;
  IF (SELECT lifecycle_status FROM public.ia_findings WHERE id = v_find) <> 'Responded' THEN
    RAISE EXCEPTION 'W2-18 FAILED: finding not moved to Responded';
  END IF;

  -- ==================================================================
  -- W2-19  Action target extension requires a reason and a later date
  -- ==================================================================
  INSERT INTO public.ia_action_tracking(engagement_id, finding_id, response_id, recommendation_id,
    action_description, responsible_person, target_date, original_target_date, current_target_date,
    status, action_status, created_by)
  VALUES (v_eng, v_find, v_resp, v_rec, 'Implement quarterly reconciliation', 'Head of Finance',
          current_date + 60, current_date + 60, current_date + 60, 'Open', 'Open', 'WAVE2_TEST')
  RETURNING id INTO v_action;

  r := public.ia_extend_action_target(v_action, current_date + 30, 'earlier date', NULL);
  IF r->>'code' <> 'IA_INVALID_DATE' THEN
    RAISE EXCEPTION 'W2-19 FAILED: backwards extension accepted (%)', r;
  END IF;
  r := public.ia_extend_action_target(v_action, current_date + 120, '', NULL);
  IF r->>'code' <> 'IA_REASON_REQUIRED' THEN
    RAISE EXCEPTION 'W2-19 FAILED: extension without reason accepted (%)', r;
  END IF;

  -- ==================================================================
  -- W2-20  Approved extension is recorded in the extension history
  -- ==================================================================
  r := public.ia_extend_action_target(v_action, current_date + 120, 'Vendor delivery slipped', 'Head of Internal Audit');
  IF NOT COALESCE((r->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'W2-20 FAILED: extension rejected (%)', r;
  END IF;
  SELECT count(*) INTO v_n FROM public.ia_action_extensions WHERE action_id = v_action;
  IF v_n <> 1 THEN RAISE EXCEPTION 'W2-20 FAILED: extension history not recorded'; END IF;
  IF (SELECT extension_count FROM public.ia_action_tracking WHERE id = v_action) <> 1 THEN
    RAISE EXCEPTION 'W2-20 FAILED: extension counter not incremented';
  END IF;

  -- ==================================================================
  -- W2-21  Action closure requires verification evidence
  -- ==================================================================
  r := public.ia_close_action(v_action, 'Done', NULL);
  IF r->>'code' <> 'IA_EVIDENCE_REQUIRED' THEN
    RAISE EXCEPTION 'W2-21 FAILED: action closed without evidence (%)', r;
  END IF;
  r := public.ia_close_action(v_action, 'Reconciliation live from Q3', ARRAY[v_ev]);
  IF NOT COALESCE((r->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'W2-21 FAILED: valid action closure rejected (%)', r;
  END IF;

  -- ==================================================================
  -- W2-22  QA review starts, and cannot be started twice
  -- ==================================================================
  r := public.ia_start_quality_review(v_eng, 'Engagement QA');
  IF NOT COALESCE((r->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'W2-22 FAILED: QA start rejected (%)', r;
  END IF;
  v_qa := (r->>'quality_review_id')::uuid;
  r := public.ia_start_quality_review(v_eng, 'Engagement QA');
  IF r->>'code' <> 'IA_QA_IN_PROGRESS' THEN
    RAISE EXCEPTION 'W2-22 FAILED: duplicate QA review allowed (%)', r;
  END IF;

  -- ==================================================================
  -- W2-23  QA clearance requires a rating
  -- ==================================================================
  r := public.ia_conclude_quality_review(v_qa, 'Cleared', NULL, 'looks fine');
  IF r->>'code' <> 'IA_RATING_REQUIRED' THEN
    RAISE EXCEPTION 'W2-23 FAILED: QA cleared without a rating (%)', r;
  END IF;

  -- ==================================================================
  -- W2-24  Report cannot be issued before QA clearance
  -- ==================================================================
  INSERT INTO public.ia_audit_reports(engagement_id, title, report_type, status, created_by)
  VALUES (v_eng, 'WAVE2_TEST Report', 'Engagement Report', 'Draft', 'WAVE2_TEST') RETURNING id INTO v_report;

  r := public.ia_issue_report(v_report, NULL);
  IF r->>'code' NOT IN ('IA_NO_VERSION', 'IA_QA_NOT_CLEARED') THEN
    RAISE EXCEPTION 'W2-24 FAILED: report issued before versioning/QA (%)', r;
  END IF;

  -- ==================================================================
  -- W2-25  Report versioning
  -- ==================================================================
  r := public.ia_create_report_version(v_report, jsonb_build_object('summary', 'draft one'), 'initial draft', NULL);
  IF NOT COALESCE((r->>'success')::boolean, false) OR (r->>'version_number')::int <> 1 THEN
    RAISE EXCEPTION 'W2-25 FAILED: first report version not created (%)', r;
  END IF;
  r := public.ia_create_report_version(v_report, jsonb_build_object('summary', 'draft two'), 'after QA comments', NULL);
  IF (r->>'version_number')::int <> 2 THEN
    RAISE EXCEPTION 'W2-25 FAILED: report version did not increment (%)', r;
  END IF;

  -- ==================================================================
  -- W2-26  QA clears with a rating
  -- ==================================================================
  r := public.ia_conclude_quality_review(v_qa, 'Cleared', 'Satisfactory', 'No material rework required');
  IF NOT COALESCE((r->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'W2-26 FAILED: QA clearance rejected (%)', r;
  END IF;

  -- ==================================================================
  -- W2-27  Report issuance gate blocks until exit meeting + draft discussion
  -- ==================================================================
  r := public.ia_issue_report(v_report, NULL);
  IF r->>'code' <> 'IA_GATE_BLOCKED' THEN
    RAISE EXCEPTION 'W2-27 FAILED: report issued while the issuance gate was unsatisfied (%)', r;
  END IF;

  -- ==================================================================
  -- W2-28  Report issues once the gate is satisfied; version is frozen
  -- ==================================================================
  INSERT INTO public.ia_communication_stages(engagement_id, stage_code, stage_order, delivery_status, created_by)
  VALUES (v_eng, 'DRAFT_FINDING_DISCUSSION', 2, 'Sent', 'WAVE2_TEST'),
         (v_eng, 'EXIT_MEETING', 3, 'Sent', 'WAVE2_TEST');

  r := public.ia_issue_report(v_report, 'final issue');
  IF NOT COALESCE((r->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'W2-28 FAILED: report issuance rejected (%)', r;
  END IF;

  BEGIN
    UPDATE public.ia_report_versions SET content = '{"tampered":true}'::jsonb
     WHERE report_id = v_report AND is_issued;
    RAISE EXCEPTION 'W2-28 FAILED: issued report version was mutable';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%IA_REPORT_VERSION_IMMUTABLE%' AND SQLERRM NOT LIKE '%permission%'
       AND SQLERRM NOT LIKE '%row-level security%' AND SQLERRM NOT LIKE '%violates%' THEN
      RAISE EXCEPTION 'W2-28 FAILED: unexpected error protecting issued version: %', SQLERRM;
    END IF;
  END;

  -- ==================================================================
  -- W2-29  Closure readiness is satisfied for the completed lifecycle
  -- ==================================================================
  r := public.ia_evaluate_engagement_closure_v2(v_eng);
  IF NOT COALESCE((r->>'can_close')::boolean, false) THEN
    RAISE EXCEPTION 'W2-29 FAILED: engagement not closeable after a full lifecycle (%)', r;
  END IF;

  -- ==================================================================
  -- W2-30  Every governed command produced an immutable audit event
  -- ==================================================================
  SELECT count(*) INTO v_n FROM public.ia_audit_event WHERE engagement_id = v_eng;
  IF v_n - v_events_before < 15 THEN
    RAISE EXCEPTION 'W2-30 FAILED: only % lifecycle audit events recorded', v_n - v_events_before;
  END IF;

  SELECT count(*) INTO v_n FROM public.ia_audit_event
   WHERE engagement_id = v_eng
     AND source_command IN ('ia_complete_preparation','ia_assign_activity','ia_complete_activity',
        'ia_review_activity','ia_conclude_control_test','ia_change_finding_severity','ia_transition_finding',
        'ia_record_management_response','ia_extend_action_target','ia_close_action',
        'ia_start_quality_review','ia_conclude_quality_review','ia_create_report_version','ia_issue_report');
  IF v_n < 14 THEN
    RAISE EXCEPTION 'W2-30 FAILED: lifecycle commands under-logged (% events)', v_n;
  END IF;

  RAISE NOTICE 'WAVE 2 LIFECYCLE SUITE: all assertions passed (engagement %)', v_eng;

  -- ------------------------------------------------------------------
  -- CLEANUP — fixtures are tagged WAVE2_TEST. Recorded lifecycle events in
  -- ia_audit_event are immutable by design and are intentionally retained.
  -- The suite is designed to be run inside a transaction that is rolled back;
  -- when the runner lacks delete privileges the rollback is the cleanup.
  -- ------------------------------------------------------------------
  BEGIN
    DELETE FROM public.ia_report_versions WHERE report_id = v_report;
    DELETE FROM public.ia_audit_reports WHERE id = v_report;
    DELETE FROM public.ia_quality_reviews WHERE engagement_id = v_eng;
    DELETE FROM public.ia_action_extensions WHERE action_id = v_action;
    DELETE FROM public.ia_action_tracking WHERE id = v_action;
    DELETE FROM public.ia_management_responses WHERE finding_id = v_find;
    DELETE FROM public.ia_recommendations WHERE finding_id = v_find;
    DELETE FROM public.ia_finding_severity_history WHERE finding_id = v_find;
    DELETE FROM public.ia_findings WHERE id = v_find;
    DELETE FROM public.ia_control_tests WHERE id = v_test;
    DELETE FROM public.ia_working_papers WHERE id = v_wp;
    DELETE FROM public.ia_evidence WHERE id = v_ev;
    DELETE FROM public.ia_activities WHERE id = v_act;
    DELETE FROM public.ia_communication_stages WHERE engagement_id = v_eng;
    DELETE FROM public.ia_audit_engagements WHERE id = v_eng;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'WAVE2 CLEANUP SKIPPED (%) — roll back this transaction', SQLERRM;
  END;
END;
$$;
