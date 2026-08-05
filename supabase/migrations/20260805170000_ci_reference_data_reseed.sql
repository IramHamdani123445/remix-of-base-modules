-- =====================================================================
-- Forward-only reference-data reseed for the regenerated clean-database
-- baseline (cutoff 20260805160341). supabase/baseline/schema.sql is
-- schema-only, so every registry/configuration row previously seeded by
-- a now-absorbed migration must be re-established here. Every statement
-- is idempotent and is a no-op against existing environments.
-- =====================================================================


-- Platform module registry -------------------------------------------------
INSERT INTO public.app_modules (id, name, display_name, description, icon, route, parent_id,
                                sort_order, is_enabled, show_in_menu, rollout_state,
                                routes_enabled, actions_enabled)
VALUES
  ('839cee37-4006-43a4-a53c-6d0cea76a6b0', 'benefits_management', 'Benefit Management',
   NULL, 'Heart', '', NULL, 250, true, true, 'public', true, true),
  ('421174f1-7916-4220-9a0f-1dba4a404d80', 'bn_servicing', 'Benefit Servicing',
   NULL, 'HeartHandshake', '', '839cee37-4006-43a4-a53c-6d0cea76a6b0', 25, true, true, 'public', true, false),
  ('d59a1a00-e1e7-4234-8f3a-98306c0b914a', 'bn_life_certificate', 'Life Certificates',
   'Life certificate obligations, verification and controlled escalation',
   'FileCheck2', '/bn/life-certificates',
   '421174f1-7916-4220-9a0f-1dba4a404d80', 41, true, false, 'public', true, false)
ON CONFLICT (name) DO NOTHING;

-- Life Certificate permission actions --------------------------------------
INSERT INTO public.module_actions (module_id, action_name, display_name, description, is_enabled)
SELECT m.id, a.action_name, a.display_name, a.description, true
  FROM public.app_modules m
  JOIN (VALUES
    ('view', 'View', 'Life Certificate action: view'),
    ('view_all_records', 'View All Life Certificate Records', 'Bypass record scope and view every obligation'),
    ('view_evidence', 'View Evidence', 'Life Certificate action: view_evidence'),
    ('view_confidential_evidence', 'View Confidential Evidence', 'Life Certificate action: view_confidential_evidence'),
    ('view_sensitive_identity', 'View Sensitive Identity', 'View unmasked claimant identity fields'),
    ('generate', 'Generate', 'Life Certificate action: generate'),
    ('send_reminder', 'Send Reminder', 'Life Certificate action: send_reminder'),
    ('receive', 'Receive', 'Life Certificate action: receive'),
    ('verify', 'Verify', 'Life Certificate action: verify'),
    ('reject', 'Reject', 'Life Certificate action: reject'),
    ('request_resubmission', 'Request Resubmission', 'Life Certificate action: request_resubmission'),
    ('defer', 'Defer', 'Life Certificate action: defer'),
    ('waive', 'Waive', 'Life Certificate action: waive'),
    ('escalate', 'Escalate', 'Life Certificate action: escalate'),
    ('propose_suspension', 'Propose Suspension', 'Life Certificate action: propose_suspension'),
    ('propose_reinstatement', 'Propose Reinstatement', 'Life Certificate action: propose_reinstatement'),
    ('clear_scheduler_attempts', 'Clear Scheduler Attempts', 'Clear failed scheduler attempts and manual intervention flags'),
    ('audit', 'Audit', 'Life Certificate action: audit'),
    ('admin', 'Admin', 'Life Certificate action: admin')
  ) AS a(action_name, display_name, description) ON true
 WHERE m.name = 'bn_life_certificate'
ON CONFLICT (module_id, action_name) DO NOTHING;

-- Approved Benefits communication source -----------------------------------
INSERT INTO public.bn_communication_adapter_source (source_module, source_table, is_enabled, notes)
VALUES ('BN_LIFE_CERTIFICATE', 'bn_life_certificate_communication_intent', true,
        'Only operational Benefits source. Other modules must register here before dispatch is supported.')
ON CONFLICT (source_module) DO NOTHING;

-- C3 filing window and penalty configuration --------------------------------
INSERT INTO public.c3_calculation_config
  (config_key, config_value, config_type, category, display_name, description, display_order, is_active)
VALUES
  ('week_start_day', 1, 'days', 'filing', 'Week Start Day',
   'Day of week considered the first day for C3 week calculations. 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday, 7=Sunday', 1, true),
  ('filing_window_unit', 1, 'amount', 'filing', 'Filing Window Unit',
   'Unit for measuring the allowed filing window and penalty thresholds. 1=Months, 2=Days', 2, true),
  ('filing_window_value', 1, 'amount', 'filing', 'Allowed Filing Window',
   'Number of months or days (depending on unit) allowed for filing after the C3 period ends. Filing received within this window incurs no penalty.', 3, true),
  ('penalty_initial_threshold', 1, 'amount', 'filing', 'Initial Penalty Threshold',
   'Threshold period (in configured unit) for applying the initial penalty/fine rate.', 4, true),
  ('penalty_subsequent_threshold', 12, 'amount', 'filing', 'Subsequent Penalty Threshold',
   'Maximum period (in configured unit) for applying the subsequent (additional) penalty/fine rate beyond the initial threshold.', 5, true)
ON CONFLICT (config_key) DO NOTHING;

-- =====================================================================
-- BN Medical Reviews — registry, permissions, adapter registration
-- =====================================================================

-- Module registry (dark-launched: actions_enabled = false)
INSERT INTO public.app_modules
  (name, display_name, description, icon, route, parent_id, sort_order,
   is_enabled, primary_table, primary_key_column, show_in_menu, base_url,
   rollout_state, internal_only, routes_enabled, actions_enabled)
SELECT 'bn_medical_review', 'Medical Reviews',
       'Medical review obligations, provider referrals, Medical Board and administrative decisions',
       'Stethoscope', '/bn/medical-reviews',
       (SELECT parent_id FROM public.app_modules WHERE name = 'bn_life_certificate'),
       42, true, 'bn_medical_review_obligation', 'id', false, NULL,
       'public', true, true, false
WHERE NOT EXISTS (SELECT 1 FROM public.app_modules WHERE name = 'bn_medical_review');

UPDATE public.app_modules
   SET actions_enabled = false, updated_at = now()
 WHERE name = 'bn_medical_review';

-- Granular permission registry
INSERT INTO public.core_permission_registry
  (permission_key, permission_name, description, module_code, domain_code,
   permission_scope, resource_type, action_code, is_platform_permission,
   is_sensitive_permission, is_admin_permission, risk_level, lifecycle_status,
   seeded_from_registry, source_file, is_active)
SELECT v.key, v.name, v.descr, 'bn_medical_review', 'benefits',
       'MODULE', 'bn_medical_review', v.action, false,
       v.sensitive, v.admin, v.risk, 'ACTIVE', true,
       'supabase/migrations/bn_medical_review_permissions.sql', true
  FROM (VALUES
    ('bn.medical_review.view','View medical reviews','Read the Medical Review worklist and review detail','view',false,false,'LOW'),
    ('bn.medical_review.view_all_records','View all medical review records','Bypass caseload scoping and see every review','view_all_records',true,false,'HIGH'),
    ('bn.medical_review.view_sensitive_identity','View sensitive identity','See unmasked identity values on Medical Review screens','view_sensitive_identity',true,false,'HIGH'),
    ('bn.medical_review.view_medical_summary','View functional medical summary','See the functional medical conclusion and outcome','view_medical_summary',true,false,'HIGH'),
    ('bn.medical_review.view_confidential_medical_evidence','View confidential medical evidence','Access confidential clinical evidence metadata and narrative','view_confidential_medical_evidence',true,false,'CRITICAL'),
    ('bn.medical_review.configure_policy','Configure medical review policy','Create and amend medical review product policy drafts','configure_policy',false,true,'HIGH'),
    ('bn.medical_review.publish_policy','Publish medical review policy','Publish or supersede a medical review policy version','publish_policy',true,true,'CRITICAL'),
    ('bn.medical_review.manage_providers','Manage medical providers','Create and maintain the medical provider registry','manage_providers',true,true,'HIGH'),
    ('bn.medical_review.verify_credentials','Verify provider credentials','Verify provider registration, licence and approvals','verify_credentials',true,false,'HIGH'),
    ('bn.medical_review.generate_obligations','Generate review obligations','Create medical review obligations for an award','generate_obligations',false,false,'MEDIUM'),
    ('bn.medical_review.defer_review','Defer a medical review','Defer a review within the policy deferral limit','defer_review',false,false,'MEDIUM'),
    ('bn.medical_review.close_review','Close a medical review','Administratively close a medical review','close_review',false,false,'HIGH'),
    ('bn.medical_review.assign_provider','Assign a medical provider','Assign or reassign the assessing provider','assign_provider',false,false,'MEDIUM'),
    ('bn.medical_review.issue_referral','Issue a medical referral','Issue, expire or administratively respond to a referral','issue_referral',false,false,'MEDIUM'),
    ('bn.medical_review.manage_appointment','Manage medical appointments','Schedule, reschedule and record appointment outcomes','manage_appointment',false,false,'MEDIUM'),
    ('bn.medical_review.submit_assessment','Submit a medical assessment','Record and submit the structured medical assessment','submit_assessment',true,false,'HIGH'),
    ('bn.medical_review.validate_report','Validate a medical report','Validate, reject or request clarification on a report','validate_report',true,false,'HIGH'),
    ('bn.medical_review.request_second_opinion','Request a second opinion','Create a linked second-opinion referral','request_second_opinion',false,false,'MEDIUM'),
    ('bn.medical_review.refer_to_board','Refer a case to the Medical Board','Create a Medical Board case from a review','refer_to_board',false,false,'HIGH'),
    ('bn.medical_review.manage_board_case','Manage Medical Board cases','Select the Board, assign members and manage case state','manage_board_case',false,true,'HIGH'),
    ('bn.medical_review.manage_board_session','Manage Medical Board sessions','Schedule, adjourn and reconvene Board sessions','manage_board_session',false,false,'MEDIUM'),
    ('bn.medical_review.declare_conflict','Declare Board conflict or recusal','Record conflicts of interest and recusals','declare_conflict',true,false,'HIGH'),
    ('bn.medical_review.record_board_participation','Record Board participation','Record session attendance and participation','record_board_participation',false,false,'MEDIUM'),
    ('bn.medical_review.record_board_determination','Record Board determination','Record votes and finalise the Board determination','record_board_determination',true,true,'CRITICAL'),
    ('bn.medical_review.prepare_decision','Prepare administrative decision','Prepare the formal Benefits decision for a review','prepare_decision',true,false,'HIGH'),
    ('bn.medical_review.approve_decision','Approve administrative decision','Approve, return or complete the formal Benefits decision','approve_decision',true,true,'CRITICAL'),
    ('bn.medical_review.propose_suspension','Propose award suspension','Create a suspension proposal for the Award Suspension module','propose_suspension',true,true,'CRITICAL'),
    ('bn.medical_review.propose_reinstatement','Propose award reinstatement','Create a reinstatement proposal for the Award Suspension module','propose_reinstatement',true,true,'CRITICAL'),
    ('bn.medical_review.view_audit','View medical review audit','Read the safe Medical Review audit timeline','view_audit',true,false,'MEDIUM'),
    ('bn.medical_review.administer_module','Administer Medical Reviews','Administer module configuration and dark-launch state','administer_module',true,true,'CRITICAL')
  ) AS v(key, name, descr, action, sensitive, admin, risk)
WHERE NOT EXISTS (
  SELECT 1 FROM public.core_permission_registry r WHERE r.permission_key = v.key);

-- Shared Benefits communication adapter registration (disabled while dark-launched)
INSERT INTO public.bn_communication_adapter_source (source_module, source_table, is_enabled, notes)
SELECT 'BN_MEDICAL_REVIEW', 'bn_medical_review_communication_intent', false,
       'Medical Reviews reuses the shared Benefits adapter. Operational context only (allowlist enforced by _bn_mr_safe_comm_context). Enable together with app_modules.actions_enabled.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.bn_communication_adapter_source
   WHERE source_module = 'BN_MEDICAL_REVIEW');
-- BN Medical Reviews — Phase 1 UI enablement.
-- Forward-only, narrow correction: the registry migration seeded
-- core_permission_registry but not module_actions, so the permission-aware
-- frontend cannot resolve any Medical Review action for non-admin users.
-- This seeds the action catalogue ONLY. No role_permissions grants are made,
-- and actions_enabled remains false (dark launch).
INSERT INTO public.module_actions (module_id, action_name, display_name, description, is_enabled)
SELECT m.id,
       r.action_code,
       initcap(replace(r.action_code, '_', ' ')),
       r.description,
       true
FROM public.core_permission_registry r
JOIN public.app_modules m ON m.name = 'bn_medical_review'
WHERE r.module_code = 'bn_medical_review'
  AND NOT EXISTS (
    SELECT 1 FROM public.module_actions ma
    WHERE ma.module_id = m.id AND ma.action_name = r.action_code
  );

-- Re-assert the dark-launch posture (defensive; must remain false).
UPDATE public.app_modules
SET actions_enabled = false
WHERE name = 'bn_medical_review';

-- =====================================================================
-- Award Suspension registry (module, actions, approval workflow).
-- These rows were seeded by pre-cutoff migrations and are therefore
-- absent from the schema-only baseline.
-- =====================================================================

INSERT INTO public.app_modules (name, display_name, description, icon, route, parent_id,
                                sort_order, is_enabled, show_in_menu, rollout_state,
                                internal_only, routes_enabled, actions_enabled,
                                primary_key_column)
SELECT 'bn_award_suspension', 'Award Suspension',
       'Suspend, resume, and terminate awards', 'PauseCircle', '/bn/award-suspension',
       (SELECT id FROM public.app_modules WHERE name = 'bn_servicing'),
       40, true, true, 'public', false, true, false, 'id'
ON CONFLICT (name) DO NOTHING;

-- Dark launch is the only safe default: activation is script-guarded.
UPDATE public.app_modules
   SET actions_enabled = false
 WHERE name = 'bn_award_suspension'
   AND actions_enabled IS DISTINCT FROM false
   AND NOT EXISTS (SELECT 1 FROM public.bn_award_suspension_event LIMIT 1);

INSERT INTO public.module_actions (module_id, action_name, display_name, description, is_enabled)
SELECT m.id, a.action_name, a.display_name, a.description, true
  FROM public.app_modules m
  JOIN (VALUES
    ('view', 'View', 'View award suspension records and history'),
    ('propose', 'Propose Suspension', 'Propose an award suspension for approval'),
    ('approve', 'Approve Suspension', 'Approve a proposed award suspension'),
    ('execute', 'Execute Suspension', 'Apply an approved suspension to the award and hold payments'),
    ('reverse', 'Reverse Suspension', 'Reverse an executed suspension action'),
    ('resume_propose', 'Propose Resumption', 'Propose resumption of a suspended award'),
    ('resume_approve', 'Approve Resumption', 'Approve a proposed award resumption'),
    ('resume_execute', 'Execute Reinstatement', 'Apply an approved reinstatement, release safe holds and create arrears'),
    ('view_payment_impact', 'View Payment Impact', 'View the payment records affected by a suspension'),
    ('resolve_payment_exception', 'Resolve Payment Exception', 'Resolve payment exceptions raised by a suspension'),
    ('audit', 'Audit Suspension History', 'Read-only access to suspension audit')
  ) AS a(action_name, display_name, description) ON true
 WHERE m.name = 'bn_award_suspension'
ON CONFLICT (module_id, action_name) DO NOTHING;

-- Approval workflow definition ----------------------------------------------
INSERT INTO public.core_workflow_definition
  (workflow_code, workflow_name, description, module_code, domain_code, entity_type,
   version, workflow_status, start_step_code, requires_reason_on_reject,
   allow_withdrawal, allow_delegation, allow_reassignment, is_active)
SELECT 'BN_AWARD_SUSPENSION', 'Benefits Award Suspension Approval',
       'Proposal and approval lifecycle for suspending a benefits award. Does not apply the suspension.',
       'bn_award_suspension', 'benefits', 'bn_award_suspension_event',
       1, 'ACTIVE', 'PROPOSED', true, true, true, true, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.core_workflow_definition
   WHERE workflow_code = 'BN_AWARD_SUSPENSION' AND version = 1);

INSERT INTO public.core_workflow_step
  (workflow_definition_id, step_code, step_name, step_type, assigned_permission_key,
   is_start_step, is_end_step, requires_reason, display_order, is_active)
SELECT d.id, s.step_code, s.step_name, s.step_type,
       nullif(s.permission_key, ''), s.is_start, s.is_end, s.requires_reason, s.display_order, true
  FROM public.core_workflow_definition d
  JOIN (VALUES
    ('PROPOSED', 'Proposal submitted', 'SUBMIT', 'bn_award_suspension.propose', true, false, true, 10),
    ('PENDING_APPROVAL', 'Awaiting approval', 'APPROVAL', 'bn_award_suspension.approve', false, false, false, 20),
    ('APPROVED', 'Approved', 'END', '', false, true, false, 30),
    ('REJECTED', 'Rejected', 'END', '', false, true, true, 40),
    ('WITHDRAWN', 'Withdrawn by proposer', 'END', '', false, true, true, 50)
  ) AS s(step_code, step_name, step_type, permission_key, is_start, is_end, requires_reason, display_order)
    ON true
 WHERE d.workflow_code = 'BN_AWARD_SUSPENSION' AND d.version = 1
   AND NOT EXISTS (
     SELECT 1 FROM public.core_workflow_step x
      WHERE x.workflow_definition_id = d.id AND x.step_code = s.step_code);

INSERT INTO public.core_workflow_transition
  (workflow_definition_id, from_step_code, to_step_code, transition_code, transition_name,
   action_type, required_permission_key, requires_reason, requires_comment, is_terminal,
   display_order, is_active)
SELECT d.id, t.from_step, t.to_step, t.code, t.name, t.action_type, t.permission_key,
       t.requires_reason, t.requires_comment, t.is_terminal, t.display_order, true
  FROM public.core_workflow_definition d
  JOIN (VALUES
    ('PROPOSED', 'PENDING_APPROVAL', 'SUBMIT', 'Submit for approval', 'SUBMIT', 'bn_award_suspension.propose', false, false, false, 10),
    ('PENDING_APPROVAL', 'APPROVED', 'APPROVE', 'Approve suspension', 'APPROVE', 'bn_award_suspension.approve', false, false, true, 20),
    ('PENDING_APPROVAL', 'REJECTED', 'REJECT', 'Reject suspension', 'REJECT', 'bn_award_suspension.approve', true, true, true, 30),
    ('PROPOSED', 'WITHDRAWN', 'WITHDRAW', 'Withdraw proposal', 'WITHDRAW', 'bn_award_suspension.propose', true, false, true, 40),
    ('PENDING_APPROVAL', 'WITHDRAWN', 'WITHDRAW', 'Withdraw proposal', 'WITHDRAW', 'bn_award_suspension.propose', true, false, true, 41)
  ) AS t(from_step, to_step, code, name, action_type, permission_key,
         requires_reason, requires_comment, is_terminal, display_order) ON true
 WHERE d.workflow_code = 'BN_AWARD_SUSPENSION' AND d.version = 1
   AND NOT EXISTS (
     SELECT 1 FROM public.core_workflow_transition x
      WHERE x.workflow_definition_id = d.id
        AND x.from_step_code = t.from_step
        AND x.transition_code = t.code);

-- ---------------------------------------------------------------------
-- Award Suspension governance corrections (formerly 20260805160341).
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.bn_award_suspension_reject_v1(uuid, uuid, text, integer, text, text);

-- 2) Least-privilege operational grants for BN_MANAGER / BN_DIRECTOR.
INSERT INTO public.role_permissions (role_id, module_id, action_id, is_granted)
SELECT r.id, ma.module_id, ma.id, true
  FROM public.module_actions ma
  JOIN public.app_modules m ON m.id = ma.module_id AND m.name = 'bn_award_suspension'
  JOIN public.roles r ON r.role_name IN ('BN_MANAGER', 'BN_DIRECTOR')
 WHERE ma.action_name IN ('execute', 'resume_execute', 'view_payment_impact')
   AND NOT EXISTS (
     SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = r.id AND rp.action_id = ma.id
   );

-- Ensure any pre-existing rows for that matrix are actually granted.
UPDATE public.role_permissions rp
   SET is_granted = true
  FROM public.module_actions ma
  JOIN public.app_modules m ON m.id = ma.module_id AND m.name = 'bn_award_suspension'
  JOIN public.roles r ON r.role_name IN ('BN_MANAGER', 'BN_DIRECTOR')
 WHERE rp.action_id = ma.id
   AND rp.role_id = r.id
   AND ma.action_name IN ('execute', 'resume_execute', 'view_payment_impact')
   AND rp.is_granted = false;