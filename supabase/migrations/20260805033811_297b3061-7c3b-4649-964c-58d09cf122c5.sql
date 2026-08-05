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