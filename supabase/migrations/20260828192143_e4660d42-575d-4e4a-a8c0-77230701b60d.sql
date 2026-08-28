DO $$
DECLARE
  v_maker uuid := '62c928c3-cd5e-421f-a010-50f9123fff70';
  v_checker uuid := '08655ffc-6bb2-4eea-bc5b-502c52cdcf85';
  v_hia uuid := '22222222-aaaa-4aaa-8aaa-000000000002';
  v_ben uuid := '22222222-aaaa-4aaa-8aaa-000000000007';
  v_com uuid := '22222222-aaaa-4aaa-8aaa-000000000008';
  v_fin uuid := '22222222-aaaa-4aaa-8aaa-000000000009';
  v_rec record;
  v_id uuid;
  v_from date;
BEGIN
  FOR v_rec IN
    SELECT * FROM (VALUES
      ('HEAD_OF_INTERNAL_AUDIT','organisation', NULL::uuid, v_hia),
      ('DEPARTMENT_HEAD','department','62e712ce-1ea5-414f-ace6-669a1516c0ce'::uuid, v_ben),
      ('DEPARTMENT_HEAD','department','21e086d5-0aa4-4081-9ccb-5e247266b170'::uuid, v_com),
      ('DEPARTMENT_HEAD','department','600ca58e-6ad2-4b84-aba8-d453e0411989'::uuid, v_fin)
    ) AS t(function_code, scope_type, department_id, profile_id)
  LOOP
    SELECT GREATEST(current_date, coalesce(max(o.effective_from),current_date) + 1)
      INTO v_from
      FROM public.ia_office_holder o
     WHERE o.function_code = v_rec.function_code
       AND o.status = 'active'
       AND o.is_primary
       AND coalesce(o.department_id::text,'-') = coalesce(v_rec.department_id::text,'-');

    UPDATE public.ia_office_holder o
       SET status = 'superseded',
           effective_to = GREATEST(o.effective_from, LEAST(coalesce(o.effective_to, v_from - 1), v_from - 1))
     WHERE o.function_code = v_rec.function_code
       AND o.status = 'active'
       AND o.is_primary
       AND coalesce(o.department_id::text,'-') = coalesce(v_rec.department_id::text,'-');

    INSERT INTO public.ia_office_holder
      (function_code, scope_type, department_id, profile_id, is_primary,
       effective_from, status, reason, assigned_by, approved_by, approved_at,
       is_certification_fixture, fixture_tag)
    VALUES
      (v_rec.function_code, v_rec.scope_type, v_rec.department_id, v_rec.profile_id, true,
       v_from, 'active',
       'Final acceptance preparation — MIPL UAT office holder designation', v_maker, v_checker, now(),
       true, 'uat-mipl-final-acceptance')
    RETURNING id INTO v_id;

    INSERT INTO public.ia_audit_event
      (event_code, entity_type, entity_id, actor_profile_id, actor_label,
       old_value, new_value, reason, source_command)
    VALUES ('INTERNAL_AUDIT.OFFICE_HOLDER.ACTIVATED','ia_office_holder', v_id, v_checker,
            'UAT provisioning (maker '||v_maker||')',
            jsonb_build_object('status','proposed','proposed_by', v_maker),
            jsonb_build_object('status','active','function_code', v_rec.function_code,
                               'profile_id', v_rec.profile_id, 'department_id', v_rec.department_id,
                               'approved_by', v_checker),
            'Final acceptance preparation — MIPL UAT office holder designation',
            'uat_final_acceptance_provisioning');
  END LOOP;
END $$;

-- Controlled UAT engagement assignment (2028 approved plan, Compliance)
UPDATE public.ia_audit_engagements
   SET lead_auditor_id = 'b580c811-5811-4b40-9f88-b812b7e119de',
       reviewer_id     = '1c7316a0-2042-4ab3-b187-9c97a45dbfd1',
       team_member_ids = '["b5d36e81-3dd6-4e66-8494-97549ec8b558"]'::jsonb,
       updated_at = now(),
       updated_by = 'uat_final_acceptance_provisioning'
 WHERE engagement_code = 'ENG-2028-002';

INSERT INTO public.ia_quality_reviews
  (engagement_id, reviewer_id, review_date, review_type, status, checklist_results,
   observations, required_rework, is_active, created_by, updated_by)
SELECT e.id, 'cf61966e-5bea-476a-8462-04158a1c31a1', current_date,
       'Engagement Quality Review', 'In Progress', '[]'::jsonb,
       'UAT quality-reviewer entitlement proof review', false, true,
       'uat_final_acceptance_provisioning','uat_final_acceptance_provisioning'
  FROM public.ia_audit_engagements e
 WHERE e.engagement_code = 'ENG-2028-002'
   AND NOT EXISTS (
     SELECT 1 FROM public.ia_quality_reviews q
      WHERE q.engagement_id = e.id
        AND q.reviewer_id = 'cf61966e-5bea-476a-8462-04158a1c31a1'
        AND q.status = 'In Progress');

-- Controlled pilot recipient allowlist: add exact MIPL UAT addresses (no wildcards)
DO $$
DECLARE
  v_maker uuid := '62c928c3-cd5e-421f-a010-50f9123fff70';
  v_checker uuid := '08655ffc-6bb2-4eea-bc5b-502c52cdcf85';
  v_rel public.omni_comms_channel_release_control;
  v_new jsonb;
  v_merged jsonb;
BEGIN
  -- EMAIL
  SELECT * INTO v_rel FROM public.omni_comms_channel_release_control WHERE channel = 'email';
  v_new := public.omni_comms_priv_channel_release_recipient_rules('email', jsonb_build_array(
    jsonb_build_object('target','audit.lead@mishainfotech.com'),
    jsonb_build_object('target','audit.auditor1@mishainfotech.com'),
    jsonb_build_object('target','audit.qa@mishainfotech.com'),
    jsonb_build_object('target','audit.mgmt.benefits@mishainfotech.com')));
  SELECT jsonb_agg(DISTINCT r) INTO v_merged
    FROM jsonb_array_elements(coalesce(v_rel.pilot_recipient_rules,'[]'::jsonb) || v_new) r;

  PERFORM public.omni_comms_priv_channel_release_record_event(
    v_rel, 'transition_proposed', v_rel.release_state, 'controlled_pilot',
    'UAT final acceptance — add exact MIPL recipient addresses', v_maker,
    'uat-final-acceptance-email', v_rel.approved_commit, jsonb_build_object('added', jsonb_array_length(v_new)));

  UPDATE public.omni_comms_channel_release_control
     SET pilot_recipient_rules = v_merged,
         release_version = release_version + 1,
         proposal_reason = 'UAT final acceptance — add exact MIPL recipient addresses',
         proposed_by = v_maker,
         proposed_at = now(),
         proposal_expires_at = now() + interval '1 day',
         approved_by = v_checker,
         approved_at = now(),
         approval_note = 'Approved for controlled Internal Audit UAT smoke tests (exact addresses only).',
         activated_by = v_checker,
         activated_at = now(),
         updated_by = v_checker
   WHERE id = v_rel.id
   RETURNING * INTO v_rel;

  PERFORM public.omni_comms_priv_channel_release_record_event(
    v_rel, 'release_activated', 'controlled_pilot', 'controlled_pilot',
    'UAT final acceptance recipient allowlist approved', v_checker,
    'uat-final-acceptance-email', v_rel.approved_commit,
    jsonb_build_object('rules', jsonb_array_length(v_rel.pilot_recipient_rules)));

  -- IN-APP
  SELECT * INTO v_rel FROM public.omni_comms_channel_release_control WHERE channel = 'in_app';
  v_new := public.omni_comms_priv_channel_release_recipient_rules('in_app', jsonb_build_array(
    jsonb_build_object('target','22222222-aaaa-4aaa-8aaa-000000000003'),
    jsonb_build_object('target','22222222-aaaa-4aaa-8aaa-000000000004'),
    jsonb_build_object('target','22222222-aaaa-4aaa-8aaa-000000000006'),
    jsonb_build_object('target','22222222-aaaa-4aaa-8aaa-000000000007')));
  SELECT jsonb_agg(DISTINCT r) INTO v_merged
    FROM jsonb_array_elements(coalesce(v_rel.pilot_recipient_rules,'[]'::jsonb) || v_new) r;

  PERFORM public.omni_comms_priv_channel_release_record_event(
    v_rel, 'transition_proposed', v_rel.release_state, 'controlled_pilot',
    'UAT final acceptance — add exact MIPL in-app identities', v_maker,
    'uat-final-acceptance-in-app', v_rel.approved_commit, jsonb_build_object('added', jsonb_array_length(v_new)));

  UPDATE public.omni_comms_channel_release_control
     SET pilot_recipient_rules = v_merged,
         release_version = release_version + 1,
         proposal_reason = 'UAT final acceptance — add exact MIPL in-app identities',
         proposed_by = v_maker,
         proposed_at = now(),
         proposal_expires_at = now() + interval '1 day',
         approved_by = v_checker,
         approved_at = now(),
         approval_note = 'Approved for controlled Internal Audit UAT smoke tests (exact identities only).',
         activated_by = v_checker,
         activated_at = now(),
         updated_by = v_checker
   WHERE id = v_rel.id
   RETURNING * INTO v_rel;

  PERFORM public.omni_comms_priv_channel_release_record_event(
    v_rel, 'release_activated', 'controlled_pilot', 'controlled_pilot',
    'UAT final acceptance in-app allowlist approved', v_checker,
    'uat-final-acceptance-in-app', v_rel.approved_commit,
    jsonb_build_object('rules', jsonb_array_length(v_rel.pilot_recipient_rules)));
END $$;