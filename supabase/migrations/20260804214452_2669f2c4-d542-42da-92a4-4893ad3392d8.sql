-- =====================================================================
-- Forward-only reference-data repair for the clean-database baseline.
--
-- supabase/baseline/schema.sql is schema-only, so registry/configuration
-- rows that were originally seeded by pre-cutoff migrations are absent on
-- a freshly bootstrapped CI database. Every statement below is idempotent
-- and is a no-op against the existing environments.
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