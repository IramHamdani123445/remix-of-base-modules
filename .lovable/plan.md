# Comm Hub Go-Live — Stages 6 / 7 / 8

Sequenced per user decision: **all three stages, migrations first, then code**.

## Migration 1 (this turn) — Schema + core RPCs for Stages 6, 7, 8

Additive only. Does NOT alter existing controlled-stub RPCs. Existing Stage 5
flow remains unchanged.

### Stage 6 — Send One Real Email
- `communication_controlled_live_execution`
  - `send_context text NOT NULL DEFAULT 'STUB'`  CHECK IN ('STUB','REAL_EMAIL')
  - `provider_mode text` CHECK IN ('stub','real')
  - `real_email_authorised boolean NOT NULL DEFAULT false`
- `communication_controlled_live_grant`
  - `send_context text NOT NULL DEFAULT 'STUB'`  CHECK IN ('STUB','REAL_EMAIL')
- `comm_hub_controlled_live_scope_hash_v2(...)` — includes `send_context` so
  STAGE_5 grant hash ≠ STAGE_6 grant hash for same event/recipient.
- `communication_hub_real_email_gate` — event-level feature gate row required
  before a real send is authorised (platform-admin only).
- `begin_comm_hub_one_real_email(p_payload jsonb)` — SECURITY DEFINER:
  1. Require CONTROLLED_LIVE operating mode & no EMERGENCY_STOP.
  2. Require one **valid, non-invalidated** CONTROLLED_STUB certification
     for (module, event, channel) whose
     (preview_approval_id, dry_run_certification_id, recipient_set_hash,
     configuration_version, recipient_policy_version) exactly match input.
  3. Require exactly one To recipient, no cc/bcc.
  4. Require active sender profile + active real provider + open feature gate.
  5. Require canonical `evaluate_comm_hub_send_decision` = allowed for
     `send_context='REAL_EMAIL'`.
  6. Create execution (`send_context='REAL_EMAIL'`, `provider_mode='real'`,
     `real_email_authorised=true`) and grant with the v2 scope hash.
- `record_comm_hub_one_real_email_provider_attempt(payload)` — same evidence
  shape as controlled-stub variant but tagged `send_context='REAL_EMAIL'`.
- `finalize_comm_hub_one_real_email(payload)` — issues certification with
  `certification_kind='ONE_REAL_EMAIL'`.

### Stage 7 — Activate Manual Production
- `communication_hub_event_certification` — frozen manifest per (module,event,channel):
  - `status text` CHECK IN ('live_manual_only','live_cron_allowed','SUSPENDED','REVOKED')
  - Frozen: `controlled_stub_certification_id`, `one_real_email_certification_id`,
    `configuration_version`, `recipient_policy_version`,
    `template_version_id`, `template_manifest_hash`, `sender_profile_id`,
    `recipient_set_hash`.
  - Approval: `approved_by`, `approved_at`, `reason`.
  - Drift: `drift_detected_at`, `drift_reason`, `suspended_at`.
- `certify_comm_hub_event_manual_production(p_payload jsonb)` —
  requires ONE_REAL_EMAIL certification + inbox confirmation
  (`manual_verification_status='CONFIRMED'` OR provider
  `DELIVERED`). Writes frozen row, upserts
  `communication_hub_event_live_control.status='live_manual_only'`.
- Drift trigger — on `communication_hub_control_settings.configuration_version`
  bump OR `communication_hub_recipient_policy.version` bump for scope, sets
  drift_detected_at + status='SUSPENDED'; sends to
  `communication_hub_event_live_control.status='dry_run_only'`.

### Stage 8 — Activate Automated Production
- `communication_hub_automation_readiness` — one row per (module,event,channel),
  boolean+timestamp+by columns for:
  scheduler, automatic_triggers, retry_worker, dead_letter, rate_limits,
  batch_limits, provider_circuit_breaker, emergency_stop, alerting_monitoring.
- `certify_comm_hub_event_automated_production(p_payload)` —
  1. Require existing `live_manual_only` certification.
  2. Require ≥N successful manual sends observed since certification.
  3. Require all readiness columns TRUE + recent.
  4. Promotes certification `status='live_cron_allowed'` and updates
     `event_live_control.status='live_cron_allowed'`.
- `rollback_comm_hub_event_production(p_payload)` — moves certification back
  to `live_manual_only` or SUSPENDED, records reason.

## Migration 2 (follow-up) — Automation readiness bootstrap rows

Only after Migration 1 approved: seed catalog rows / defaults where safe.

## Frontend code (post-migration)
- Replace `OneRealEmailPanel` placeholder with real Stage 6 panel wired to
  `send-one-real-email` edge function.
- New `ManualProductionPanel` (Stage 7) — certify + freeze manifest.
- New `AutomatedProductionPanel` (Stage 8) — 9-check readiness board +
  certify.
- `useStageReadiness` extended to consume server evidence.

## Edge functions (post-migration)
- New `comm-hub-send-one-real-email` — reuses controlled-live dispatcher
  scaffold with `send_context='REAL_EMAIL'`, provider = Resend (only), no
  stub fallback, one-use grant consume after provider evidence persisted.

## Tests (post-migration)
- SQL harness `run_ch_stage_678_runtime_tests()` mirroring existing
  P3E-B pattern. Covers all Stage 6/7/8 assertions listed in the request.
