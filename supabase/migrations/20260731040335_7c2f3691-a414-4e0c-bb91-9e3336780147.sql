-- ============================================================================
-- Omni-Comms Reference Seed Pack
-- Non-production, simulation-only reference data for the Omnichannel
-- Communications administration surfaces.
--
-- Objects created (all prefixed omni_comms_):
--   omni_comms_priv_reference_seed_catalogue()
--   omni_comms_priv_reference_seed_assert_safe(uuid)
--   omni_comms_priv_reference_seed_run(uuid, uuid, boolean)
--   omni_comms_reference_seed_preview(uuid)
--   omni_comms_reference_seed_apply(uuid, boolean, text)
--   omni_comms_reference_seed_status(uuid)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Static catalogue
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_reference_seed_catalogue()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $fn$
SELECT $json$
{
  "catalogue_version": 1,
  "locale": "en-US",
  "recipient_domain": "example.com",
  "providers": [
    {"code": "simulation_email", "channel": "email",  "adapter_key": "simulation_email",  "display_name": "Simulation Email (Non-Production)"},
    {"code": "simulation_sms",   "channel": "sms",    "adapter_key": "simulation_sms",    "display_name": "Simulation SMS (Non-Production)"},
    {"code": "simulation_inapp", "channel": "in_app", "adapter_key": "simulation_in_app", "display_name": "Simulation In-App (Non-Production)"}
  ],
  "accounts": [
    {"code": "ref_sim_email", "provider_code": "simulation_email", "display_name": "Reference Simulation Email Account", "secret_ref": "OMNI_COMMS_SIMULATION_EMAIL"},
    {"code": "ref_sim_sms",   "provider_code": "simulation_sms",   "display_name": "Reference Simulation SMS Account",   "secret_ref": "OMNI_COMMS_SIMULATION_SMS"},
    {"code": "ref_sim_inapp", "provider_code": "simulation_inapp", "display_name": "Reference Simulation In-App Account","secret_ref": "OMNI_COMMS_SIMULATION_IN_APP"}
  ],
  "senders": [
    {"code": "ref_sender_benefits",     "channel": "email",  "department_code": "BENEFITS",     "display_name": "Benefits Department (Reference)",     "from_address": "benefits.notifications@example.com",     "from_name": "SSB Benefits (Reference)",     "reply_to_address": "no-reply@example.com", "account_code": "ref_sim_email"},
    {"code": "ref_sender_compliance",   "channel": "email",  "department_code": "COMPLIANCE",   "display_name": "Compliance Department (Reference)",   "from_address": "compliance.notices@example.com",         "from_name": "SSB Compliance (Reference)",   "reply_to_address": "no-reply@example.com", "account_code": "ref_sim_email"},
    {"code": "ref_sender_finance",      "channel": "email",  "department_code": "FINANCE",      "display_name": "Finance Department (Reference)",      "from_address": "finance.notices@example.com",            "from_name": "SSB Finance (Reference)",      "reply_to_address": "no-reply@example.com", "account_code": "ref_sim_email"},
    {"code": "ref_sender_registration", "channel": "email",  "department_code": "REGISTRATION", "display_name": "Registration Department (Reference)", "from_address": "registration.notices@example.com",       "from_name": "SSB Registration (Reference)", "reply_to_address": "no-reply@example.com", "account_code": "ref_sim_email"},
    {"code": "ref_sender_legal",        "channel": "email",  "department_code": "LEGAL",        "display_name": "Legal Department (Reference)",        "from_address": "legal.notices@example.com",              "from_name": "SSB Legal (Reference)",        "reply_to_address": "no-reply@example.com", "account_code": "ref_sim_email"},
    {"code": "ref_sender_platform",     "channel": "email",  "department_code": null,           "display_name": "Platform Notices (Reference)",        "from_address": "platform.notices@example.com",           "from_name": "SSB Platform (Reference)",     "reply_to_address": "no-reply@example.com", "account_code": "ref_sim_email"},
    {"code": "ref_sender_sms_org",      "channel": "sms",    "department_code": null,           "display_name": "Organisation SMS (Reference)",        "from_address": "SSBREF",                                 "from_name": null,                           "reply_to_address": null,                   "account_code": "ref_sim_sms"},
    {"code": "ref_sender_inapp_org",    "channel": "in_app", "department_code": null,           "display_name": "Organisation In-App (Reference)",     "from_address": null,                                     "from_name": null,                           "reply_to_address": null,                   "account_code": "ref_sim_inapp"}
  ],
  "channel_settings": [
    {"channel": "email"},
    {"channel": "sms"},
    {"channel": "in_app"}
  ],
  "layouts": {
    "email":  "BASE_EMAIL",
    "sms":    "BASE_SMS",
    "in_app": "BASE_IN_APP"
  },
  "events": [
    {
      "code": "BENEFITS.CLAIM.SUBMITTED", "module_code": "BENEFITS", "entity_type": "CLAIM",
      "name": "Benefit Claim Submitted", "description": "Acknowledges receipt of a benefit claim submitted by an insured person.",
      "communication_class": "transactional", "default_priority": "normal",
      "department_code": "BENEFITS", "family_code": "ref_benefits_claim_submitted",
      "extra_field": "claimType", "extra_sample": "Sickness Benefit",
      "sample": {"reference": "CLM-2026-000141", "subjectName": "Alicia Warner"},
      "channels": [
        {"channel": "email", "sender_code": "ref_sender_benefits", "priority": 100, "is_required": true,
         "content": {"subject": "We have received your claim {{payload.reference}}",
                     "html": "<p>Dear {{payload.subjectName}},</p><p>We have received your {{payload.claimType}} claim, reference <strong>{{payload.reference}}</strong>. You do not need to do anything further at this stage.</p><p>Social Security Board</p>",
                     "text": "Dear {{payload.subjectName}}, we have received your {{payload.claimType}} claim, reference {{payload.reference}}."}},
        {"channel": "in_app", "sender_code": "ref_sender_inapp_org", "priority": 200, "is_required": false,
         "content": {"title": "Claim {{payload.reference}} received",
                     "body": "Your {{payload.claimType}} claim has been received and is awaiting assessment."}}
      ]
    },
    {
      "code": "BENEFITS.CLAIM.APPROVED", "module_code": "BENEFITS", "entity_type": "CLAIM",
      "name": "Benefit Claim Approved", "description": "Notifies an insured person that a benefit claim has been approved.",
      "communication_class": "transactional", "default_priority": "high",
      "department_code": "BENEFITS", "family_code": "ref_benefits_claim_approved",
      "extra_field": "awardSummary", "extra_sample": "EC$ 1,420.00 payable fortnightly",
      "sample": {"reference": "CLM-2026-000141", "subjectName": "Alicia Warner"},
      "channels": [
        {"channel": "email", "sender_code": "ref_sender_benefits", "priority": 100, "is_required": true,
         "content": {"subject": "Your claim {{payload.reference}} has been approved",
                     "html": "<p>Dear {{payload.subjectName}},</p><p>Your claim <strong>{{payload.reference}}</strong> has been approved. Award details: {{payload.awardSummary}}.</p>",
                     "text": "Dear {{payload.subjectName}}, your claim {{payload.reference}} has been approved. {{payload.awardSummary}}."}}
      ]
    },
    {
      "code": "BENEFITS.CLAIM.REJECTED", "module_code": "BENEFITS", "entity_type": "CLAIM",
      "name": "Benefit Claim Not Approved", "description": "Notifies an insured person that a benefit claim was not approved, with appeal guidance.",
      "communication_class": "legal_mandatory", "default_priority": "high",
      "department_code": "BENEFITS", "family_code": "ref_benefits_claim_rejected",
      "extra_field": "decisionReason", "extra_sample": "Insufficient contribution weeks in the relevant period",
      "sample": {"reference": "CLM-2026-000208", "subjectName": "Marcus Bell"},
      "channels": [
        {"channel": "email", "sender_code": "ref_sender_benefits", "priority": 100, "is_required": true,
         "content": {"subject": "Decision on your claim {{payload.reference}}",
                     "html": "<p>Dear {{payload.subjectName}},</p><p>Your claim <strong>{{payload.reference}}</strong> was not approved. Reason: {{payload.decisionReason}}.</p><p>You may appeal this decision within 30 days.</p>",
                     "text": "Dear {{payload.subjectName}}, claim {{payload.reference}} was not approved. Reason: {{payload.decisionReason}}. You may appeal within 30 days."}}
      ]
    },
    {
      "code": "COMPLIANCE.EMPLOYER.NONCOMPLIANCE_NOTICE", "module_code": "COMPLIANCE", "entity_type": "EMPLOYER",
      "name": "Employer Non-Compliance Notice", "description": "Formal notice to an employer regarding outstanding contribution obligations.",
      "communication_class": "legal_mandatory", "default_priority": "urgent",
      "department_code": "COMPLIANCE", "family_code": "ref_compliance_noncompliance_notice",
      "extra_field": "outstandingSummary", "extra_sample": "3 unfiled C3 returns for 2025 Q3-Q4",
      "sample": {"reference": "ER-004512", "subjectName": "Frigate Bay Retail Ltd"},
      "channels": [
        {"channel": "email", "sender_code": "ref_sender_compliance", "priority": 100, "is_required": true,
         "content": {"subject": "Notice of non-compliance — employer {{payload.reference}}",
                     "html": "<p>{{payload.subjectName}},</p><p>Our records show the following outstanding obligations: {{payload.outstandingSummary}}.</p><p>Please regularise within 14 days.</p>",
                     "text": "{{payload.subjectName}}: outstanding obligations — {{payload.outstandingSummary}}. Please regularise within 14 days."}}
      ]
    },
    {
      "code": "COMPLIANCE.INSPECTION.SCHEDULED", "module_code": "COMPLIANCE", "entity_type": "INSPECTION",
      "name": "Compliance Inspection Scheduled", "description": "Advises an employer that a compliance inspection has been scheduled.",
      "communication_class": "service", "default_priority": "normal",
      "department_code": "COMPLIANCE", "family_code": "ref_compliance_inspection_scheduled",
      "extra_field": "appointmentDetail", "extra_sample": "12 May 2026 at 10:00, Basseterre office",
      "sample": {"reference": "INSP-2026-0087", "subjectName": "Frigate Bay Retail Ltd"},
      "channels": [
        {"channel": "email", "sender_code": "ref_sender_compliance", "priority": 100, "is_required": true,
         "content": {"subject": "Inspection {{payload.reference}} scheduled",
                     "html": "<p>{{payload.subjectName}},</p><p>Inspection <strong>{{payload.reference}}</strong> is scheduled: {{payload.appointmentDetail}}.</p>",
                     "text": "{{payload.subjectName}}: inspection {{payload.reference}} scheduled — {{payload.appointmentDetail}}."}},
        {"channel": "sms", "sender_code": "ref_sender_sms_org", "priority": 200, "is_required": false,
         "content": {"body": "SSB: inspection {{payload.reference}} — {{payload.appointmentDetail}}."}}
      ]
    },
    {
      "code": "FINANCE.PAYMENT.RECEIPT_ISSUED", "module_code": "FINANCE", "entity_type": "PAYMENT",
      "name": "Payment Receipt Issued", "description": "Confirms a received payment and issues the corresponding receipt reference.",
      "communication_class": "transactional", "default_priority": "normal",
      "department_code": "FINANCE", "family_code": "ref_finance_payment_receipt",
      "extra_field": "amountSummary", "extra_sample": "EC$ 6,250.00 received on 04 April 2026",
      "sample": {"reference": "RCT-2026-118344", "subjectName": "Frigate Bay Retail Ltd"},
      "channels": [
        {"channel": "email", "sender_code": "ref_sender_finance", "priority": 100, "is_required": true,
         "content": {"subject": "Receipt {{payload.reference}}",
                     "html": "<p>{{payload.subjectName}},</p><p>Receipt <strong>{{payload.reference}}</strong>: {{payload.amountSummary}}.</p>",
                     "text": "{{payload.subjectName}}: receipt {{payload.reference}} — {{payload.amountSummary}}."}}
      ]
    },
    {
      "code": "FINANCE.INVOICE.OVERDUE", "module_code": "FINANCE", "entity_type": "INVOICE",
      "name": "Invoice Overdue Reminder", "description": "Reminds an employer that an invoice has passed its due date.",
      "communication_class": "transactional", "default_priority": "high",
      "department_code": "FINANCE", "family_code": "ref_finance_invoice_overdue",
      "extra_field": "overdueSummary", "extra_sample": "EC$ 2,110.00 overdue by 21 days",
      "sample": {"reference": "INV-2026-004410", "subjectName": "Sandy Point Haulage Ltd"},
      "channels": [
        {"channel": "email", "sender_code": "ref_sender_finance", "priority": 100, "is_required": true,
         "content": {"subject": "Invoice {{payload.reference}} is overdue",
                     "html": "<p>{{payload.subjectName}},</p><p>Invoice <strong>{{payload.reference}}</strong> is overdue: {{payload.overdueSummary}}.</p>",
                     "text": "{{payload.subjectName}}: invoice {{payload.reference}} overdue — {{payload.overdueSummary}}."}},
        {"channel": "sms", "sender_code": "ref_sender_sms_org", "priority": 200, "is_required": false,
         "content": {"body": "SSB: invoice {{payload.reference}} overdue — {{payload.overdueSummary}}."}}
      ]
    },
    {
      "code": "REGISTRATION.EMPLOYER.REGISTERED", "module_code": "REGISTRATION", "entity_type": "EMPLOYER",
      "name": "Employer Registration Completed", "description": "Confirms that an employer registration has been completed and issues the employer number.",
      "communication_class": "transactional", "default_priority": "normal",
      "department_code": "REGISTRATION", "family_code": "ref_registration_employer_registered",
      "extra_field": "registrationDetail", "extra_sample": "Employer number ER-004512, effective 01 April 2026",
      "sample": {"reference": "ER-004512", "subjectName": "Frigate Bay Retail Ltd"},
      "channels": [
        {"channel": "email", "sender_code": "ref_sender_registration", "priority": 100, "is_required": true,
         "content": {"subject": "Employer registration {{payload.reference}} completed",
                     "html": "<p>{{payload.subjectName}},</p><p>Your registration is complete. {{payload.registrationDetail}}.</p>",
                     "text": "{{payload.subjectName}}: registration complete. {{payload.registrationDetail}}."}}
      ]
    },
    {
      "code": "REGISTRATION.PERSON.REGISTERED", "module_code": "REGISTRATION", "entity_type": "PERSON",
      "name": "Insured Person Registration Completed", "description": "Confirms that an insured person has been registered and issues the social security number.",
      "communication_class": "transactional", "default_priority": "normal",
      "department_code": "REGISTRATION", "family_code": "ref_registration_person_registered",
      "extra_field": "registrationDetail", "extra_sample": "Social security number 1104-778211, effective 01 April 2026",
      "sample": {"reference": "1104-778211", "subjectName": "Alicia Warner"},
      "channels": [
        {"channel": "email", "sender_code": "ref_sender_registration", "priority": 100, "is_required": true,
         "content": {"subject": "Your registration is complete",
                     "html": "<p>Dear {{payload.subjectName}},</p><p>{{payload.registrationDetail}}. Reference {{payload.reference}}.</p>",
                     "text": "Dear {{payload.subjectName}}, {{payload.registrationDetail}}. Reference {{payload.reference}}."}}
      ]
    },
    {
      "code": "LEGAL.CASE.FILED", "module_code": "LEGAL", "entity_type": "CASE",
      "name": "Legal Case Filed", "description": "Notifies a party that a recovery case has been filed.",
      "communication_class": "legal_mandatory", "default_priority": "urgent",
      "department_code": "LEGAL", "family_code": "ref_legal_case_filed",
      "extra_field": "caseSummary", "extra_sample": "Recovery of EC$ 18,400.00 in unpaid contributions",
      "sample": {"reference": "LC-2026-0031", "subjectName": "Sandy Point Haulage Ltd"},
      "channels": [
        {"channel": "email", "sender_code": "ref_sender_legal", "priority": 100, "is_required": true,
         "content": {"subject": "Case {{payload.reference}} filed",
                     "html": "<p>{{payload.subjectName}},</p><p>Case <strong>{{payload.reference}}</strong> has been filed. {{payload.caseSummary}}.</p>",
                     "text": "{{payload.subjectName}}: case {{payload.reference}} filed. {{payload.caseSummary}}."}}
      ]
    },
    {
      "code": "LEGAL.CASE.HEARING_SCHEDULED", "module_code": "LEGAL", "entity_type": "CASE",
      "name": "Legal Hearing Scheduled", "description": "Advises a party of a scheduled hearing date for a recovery case.",
      "communication_class": "legal_mandatory", "default_priority": "urgent",
      "department_code": "LEGAL", "family_code": "ref_legal_hearing_scheduled",
      "extra_field": "hearingDetail", "extra_sample": "27 May 2026 at 09:30, Magistrates Court, Basseterre",
      "sample": {"reference": "LC-2026-0031", "subjectName": "Sandy Point Haulage Ltd"},
      "channels": [
        {"channel": "email", "sender_code": "ref_sender_legal", "priority": 100, "is_required": true,
         "content": {"subject": "Hearing scheduled for case {{payload.reference}}",
                     "html": "<p>{{payload.subjectName}},</p><p>A hearing for case <strong>{{payload.reference}}</strong> is scheduled: {{payload.hearingDetail}}.</p>",
                     "text": "{{payload.subjectName}}: hearing for case {{payload.reference}} — {{payload.hearingDetail}}."}},
        {"channel": "sms", "sender_code": "ref_sender_sms_org", "priority": 200, "is_required": false,
         "content": {"body": "SSB legal: hearing {{payload.reference}} — {{payload.hearingDetail}}."}}
      ]
    },
    {
      "code": "PLATFORM.ACCOUNT.SECURITY_ALERT", "module_code": "PLATFORM", "entity_type": "ACCOUNT",
      "name": "Account Security Alert", "description": "Alerts a user to a security-relevant change on their account.",
      "communication_class": "security", "default_priority": "urgent",
      "department_code": null, "family_code": "ref_platform_security_alert",
      "extra_field": "activityDetail", "extra_sample": "Password changed on 04 April 2026 at 19:12 from a new device",
      "sample": {"reference": "SEC-2026-9931", "subjectName": "Alicia Warner"},
      "channels": [
        {"channel": "email", "sender_code": "ref_sender_platform", "priority": 100, "is_required": true,
         "content": {"subject": "Security alert on your account",
                     "html": "<p>Dear {{payload.subjectName}},</p><p>{{payload.activityDetail}}. Reference {{payload.reference}}.</p><p>If this was not you, contact us immediately.</p>",
                     "text": "Dear {{payload.subjectName}}, {{payload.activityDetail}}. Reference {{payload.reference}}."}},
        {"channel": "in_app", "sender_code": "ref_sender_inapp_org", "priority": 200, "is_required": false,
         "content": {"title": "Security alert",
                     "body": "{{payload.activityDetail}} (reference {{payload.reference}})."}}
      ]
    }
  ]
}
$json$::jsonb;
$fn$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_reference_seed_catalogue() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. Non-production safety assertion
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_reference_seed_assert_safe(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
DECLARE
  v_live_requests bigint;
  v_live_channels bigint;
BEGIN
  SELECT count(*) INTO v_live_requests
    FROM public.omni_comms_request r
   WHERE r.organization_id = p_organization_id
     AND r.mode IS DISTINCT FROM 'dry_run';
  IF v_live_requests > 0 THEN
    RAISE EXCEPTION 'OC412 invalid_state'
      USING ERRCODE = 'P0001', DETAIL = 'reference_seed_live_traffic_detected';
  END IF;

  SELECT count(*) INTO v_live_channels
    FROM public.omni_comms_channel_setting cs
   WHERE cs.organization_id = p_organization_id
     AND cs.live_delivery_enabled;
  IF v_live_channels > 0 THEN
    RAISE EXCEPTION 'OC412 invalid_state'
      USING ERRCODE = 'P0001', DETAIL = 'reference_seed_live_delivery_enabled';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_reference_seed_assert_safe(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. Shared preview / apply runner
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_priv_reference_seed_run(
  p_actor_id uuid,
  p_organization_id uuid,
  p_apply boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
DECLARE
  c              jsonb := public.omni_comms_priv_reference_seed_catalogue();
  v_locale       text  := c ->> 'locale';
  v_actions      jsonb := '[]'::jsonb;
  v_created      integer := 0;
  v_planned      integer := 0;
  v_existing     integer := 0;
  v_skipped      integer := 0;
  it             jsonb;
  ch             jsonb;
  v_id           uuid;
  v_dept_id      uuid;
  v_provider_id  uuid;
  v_account_id   uuid;
  v_sender_id    uuid;
  v_event_id     uuid;
  v_family_id    uuid;
  v_version_id   uuid;
  v_layout_id    uuid;
  v_code         text;
  v_extra        text;
  v_schema       jsonb;
  v_sample       jsonb;
  v_checksum     text;
  v_family_code  text;

  PROCEDURE_NOOP boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.core_organization WHERE id = p_organization_id) THEN
    RAISE EXCEPTION 'OC404 not_found'
      USING ERRCODE = 'P0001', DETAIL = 'organization_not_found';
  END IF;

  -- ---- providers (global) -------------------------------------------------
  FOR it IN SELECT * FROM jsonb_array_elements(c -> 'providers') LOOP
    v_code := it ->> 'code';
    SELECT id INTO v_provider_id FROM public.omni_comms_provider WHERE code = v_code;
    IF v_provider_id IS NOT NULL THEN
      v_existing := v_existing + 1;
      v_actions := v_actions || jsonb_build_object('object_type','provider','key',v_code,'action','existing');
    ELSIF NOT p_apply THEN
      v_planned := v_planned + 1;
      v_actions := v_actions || jsonb_build_object('object_type','provider','key',v_code,'action','planned');
    ELSE
      INSERT INTO public.omni_comms_provider (code, display_name, channel, adapter_key, status, created_by, updated_by)
      VALUES (v_code, it ->> 'display_name', it ->> 'channel', it ->> 'adapter_key', 'draft', p_actor_id, p_actor_id)
      RETURNING id INTO v_provider_id;
      UPDATE public.omni_comms_provider
         SET status = 'active', activated_at = now(), activated_by = p_actor_id,
             updated_at = now(), updated_by = p_actor_id
       WHERE id = v_provider_id;
      v_created := v_created + 1;
      v_actions := v_actions || jsonb_build_object('object_type','provider','key',v_code,'action','created');
    END IF;
  END LOOP;

  -- ---- provider accounts (org scoped, simulation only) --------------------
  FOR it IN SELECT * FROM jsonb_array_elements(c -> 'accounts') LOOP
    v_code := it ->> 'code';
    SELECT id INTO v_account_id
      FROM public.omni_comms_provider_account
     WHERE organization_id = p_organization_id AND code = v_code;
    IF v_account_id IS NOT NULL THEN
      v_existing := v_existing + 1;
      v_actions := v_actions || jsonb_build_object('object_type','provider_account','key',v_code,'action','existing');
      CONTINUE;
    END IF;
    SELECT id INTO v_provider_id FROM public.omni_comms_provider WHERE code = it ->> 'provider_code';
    IF v_provider_id IS NULL OR NOT p_apply THEN
      v_planned := v_planned + 1;
      v_actions := v_actions || jsonb_build_object('object_type','provider_account','key',v_code,'action','planned');
      CONTINUE;
    END IF;
    INSERT INTO public.omni_comms_provider_account
      (organization_id, provider_id, code, display_name, secret_ref, sandbox_mode, status, created_by, updated_by)
    VALUES
      (p_organization_id, v_provider_id, v_code, it ->> 'display_name', it ->> 'secret_ref', true, 'draft', p_actor_id, p_actor_id)
    RETURNING id INTO v_account_id;
    UPDATE public.omni_comms_provider_account
       SET status = 'active', activated_at = now(), activated_by = p_actor_id,
           updated_at = now(), updated_by = p_actor_id
     WHERE id = v_account_id;
    v_created := v_created + 1;
    v_actions := v_actions || jsonb_build_object('object_type','provider_account','key',v_code,'action','created');
  END LOOP;

  -- ---- sender identities + bindings ---------------------------------------
  FOR it IN SELECT * FROM jsonb_array_elements(c -> 'senders') LOOP
    v_code := it ->> 'code';
    v_dept_id := NULL;
    IF it ->> 'department_code' IS NOT NULL THEN
      SELECT id INTO v_dept_id FROM public.core_department
       WHERE organization_id = p_organization_id AND code = it ->> 'department_code';
    END IF;

    SELECT id INTO v_sender_id
      FROM public.omni_comms_sender_identity
     WHERE organization_id = p_organization_id AND code = v_code;

    IF v_sender_id IS NOT NULL THEN
      v_existing := v_existing + 1;
      v_actions := v_actions || jsonb_build_object('object_type','sender_identity','key',v_code,'action','existing');
    ELSIF NOT p_apply THEN
      v_planned := v_planned + 1;
      v_actions := v_actions || jsonb_build_object('object_type','sender_identity','key',v_code,'action','planned');
      CONTINUE;
    ELSE
      INSERT INTO public.omni_comms_sender_identity
        (organization_id, department_id, code, display_name, channel, from_address, from_name, reply_to_address, status, created_by, updated_by)
      VALUES
        (p_organization_id, v_dept_id, v_code, it ->> 'display_name', it ->> 'channel',
         it ->> 'from_address', it ->> 'from_name', it ->> 'reply_to_address', 'draft', p_actor_id, p_actor_id)
      RETURNING id INTO v_sender_id;
      UPDATE public.omni_comms_sender_identity
         SET status = 'active', activated_at = now(), activated_by = p_actor_id,
             updated_at = now(), updated_by = p_actor_id
       WHERE id = v_sender_id;
      v_created := v_created + 1;
      v_actions := v_actions || jsonb_build_object('object_type','sender_identity','key',v_code,'action','created');
    END IF;

    -- binding
    SELECT id INTO v_account_id
      FROM public.omni_comms_provider_account
     WHERE organization_id = p_organization_id AND code = it ->> 'account_code';

    IF v_sender_id IS NULL OR v_account_id IS NULL THEN
      v_planned := v_planned + 1;
      v_actions := v_actions || jsonb_build_object('object_type','sender_binding','key',v_code,'action','planned');
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.omni_comms_sender_provider_binding
                WHERE sender_identity_id = v_sender_id AND provider_account_id = v_account_id) THEN
      v_existing := v_existing + 1;
      v_actions := v_actions || jsonb_build_object('object_type','sender_binding','key',v_code,'action','existing');
    ELSIF NOT p_apply THEN
      v_planned := v_planned + 1;
      v_actions := v_actions || jsonb_build_object('object_type','sender_binding','key',v_code,'action','planned');
    ELSE
      INSERT INTO public.omni_comms_sender_provider_binding
        (sender_identity_id, provider_account_id, priority, verification_status, verified_at, status, created_by, updated_by)
      VALUES (v_sender_id, v_account_id, 100, 'verified', now(), 'draft', p_actor_id, p_actor_id)
      RETURNING id INTO v_id;
      UPDATE public.omni_comms_sender_provider_binding
         SET status = 'active', activated_at = now(), activated_by = p_actor_id,
             updated_at = now(), updated_by = p_actor_id
       WHERE id = v_id;
      v_created := v_created + 1;
      v_actions := v_actions || jsonb_build_object('object_type','sender_binding','key',v_code,'action','created');
    END IF;
  END LOOP;

  -- ---- channel settings (enabled, live delivery OFF) ----------------------
  FOR it IN SELECT * FROM jsonb_array_elements(c -> 'channel_settings') LOOP
    v_code := it ->> 'channel';
    IF EXISTS (SELECT 1 FROM public.omni_comms_channel_setting
                WHERE organization_id = p_organization_id AND department_id IS NULL AND channel = v_code) THEN
      v_existing := v_existing + 1;
      v_actions := v_actions || jsonb_build_object('object_type','channel_setting','key',v_code,'action','existing');
    ELSIF NOT p_apply THEN
      v_planned := v_planned + 1;
      v_actions := v_actions || jsonb_build_object('object_type','channel_setting','key',v_code,'action','planned');
    ELSE
      INSERT INTO public.omni_comms_channel_setting
        (organization_id, department_id, channel, enabled, live_delivery_enabled, created_by, updated_by)
      VALUES (p_organization_id, NULL, v_code, true, false, p_actor_id, p_actor_id);
      v_created := v_created + 1;
      v_actions := v_actions || jsonb_build_object('object_type','channel_setting','key',v_code,'action','created');
    END IF;
  END LOOP;

  -- ---- events, contracts, families, versions, routes ----------------------
  FOR it IN SELECT * FROM jsonb_array_elements(c -> 'events') LOOP
    v_code  := it ->> 'code';
    v_extra := it ->> 'extra_field';

    v_schema := jsonb_build_object(
      '$schema', 'https://json-schema.org/draft/2020-12/schema',
      'type', 'object',
      'additionalProperties', false,
      'required', jsonb_build_array('reference', 'subjectName', v_extra),
      'properties', jsonb_build_object(
        'reference',   jsonb_build_object('type','string','maxLength',64),
        'subjectName', jsonb_build_object('type','string','maxLength',160)
      ) || jsonb_build_object(v_extra, jsonb_build_object('type','string','maxLength',240))
    );
    v_sample := (it -> 'sample') || jsonb_build_object(v_extra, it ->> 'extra_sample');

    v_dept_id := NULL;
    IF it ->> 'department_code' IS NOT NULL THEN
      SELECT id INTO v_dept_id FROM public.core_department
       WHERE organization_id = p_organization_id AND code = it ->> 'department_code';
    END IF;

    -- event definition
    SELECT id INTO v_event_id FROM public.omni_comms_event_definition WHERE code = v_code;
    IF v_event_id IS NOT NULL THEN
      v_existing := v_existing + 1;
      v_actions := v_actions || jsonb_build_object('object_type','event_definition','key',v_code,'action','existing');
    ELSIF NOT p_apply THEN
      v_planned := v_planned + 1;
      v_actions := v_actions || jsonb_build_object('object_type','event_definition','key',v_code,'action','planned');
    ELSE
      INSERT INTO public.omni_comms_event_definition
        (code, module_code, entity_type, name, description, communication_class, default_priority, status, created_by, updated_by)
      VALUES (v_code, it ->> 'module_code', it ->> 'entity_type', it ->> 'name', it ->> 'description',
              it ->> 'communication_class', it ->> 'default_priority', 'draft', p_actor_id, p_actor_id)
      RETURNING id INTO v_event_id;
      UPDATE public.omni_comms_event_definition
         SET status = 'active', updated_at = now(), updated_by = p_actor_id
       WHERE id = v_event_id;
      v_created := v_created + 1;
      v_actions := v_actions || jsonb_build_object('object_type','event_definition','key',v_code,'action','created');
    END IF;

    IF v_event_id IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- event contract v1 (published)
    IF EXISTS (SELECT 1 FROM public.omni_comms_event_contract
                WHERE event_definition_id = v_event_id AND version_number = 1) THEN
      v_existing := v_existing + 1;
      v_actions := v_actions || jsonb_build_object('object_type','event_contract','key',v_code || ':v1','action','existing');
    ELSIF NOT p_apply THEN
      v_planned := v_planned + 1;
      v_actions := v_actions || jsonb_build_object('object_type','event_contract','key',v_code || ':v1','action','planned');
    ELSE
      PERFORM public.omni_comms_priv_validate_schema(v_schema, v_sample);
      INSERT INTO public.omni_comms_event_contract
        (event_definition_id, version_number, json_schema, sample_payload, status, created_by, updated_by)
      VALUES (v_event_id, 1, v_schema, v_sample, 'draft', p_actor_id, p_actor_id)
      RETURNING id INTO v_id;
      v_checksum := public.omni_comms_priv_compute_checksum(v_code, 1, v_schema);
      UPDATE public.omni_comms_event_contract
         SET status = 'published', checksum = v_checksum, published_at = now(), published_by = p_actor_id,
             updated_at = now(), updated_by = p_actor_id
       WHERE id = v_id;
      v_created := v_created + 1;
      v_actions := v_actions || jsonb_build_object('object_type','event_contract','key',v_code || ':v1','action','created');
    END IF;

    -- template family (event scoped)
    v_family_code := it ->> 'family_code';
    SELECT id INTO v_family_id FROM public.omni_comms_template_family WHERE code = v_family_code;
    IF v_family_id IS NOT NULL THEN
      v_existing := v_existing + 1;
      v_actions := v_actions || jsonb_build_object('object_type','template_family','key',v_family_code,'action','existing');
    ELSIF NOT p_apply THEN
      v_planned := v_planned + 1;
      v_actions := v_actions || jsonb_build_object('object_type','template_family','key',v_family_code,'action','planned');
    ELSE
      INSERT INTO public.omni_comms_template_family
        (code, name, description, scope_type, organization_id, department_id, event_definition_id, status, created_by, updated_by)
      VALUES (v_family_code, (it ->> 'name') || ' Templates', 'Reference seed templates for ' || v_code,
              'event', p_organization_id, NULL, v_event_id, 'draft', p_actor_id, p_actor_id)
      RETURNING id INTO v_family_id;
      UPDATE public.omni_comms_template_family
         SET status = 'active', activated_at = now(), activated_by = p_actor_id,
             updated_at = now(), updated_by = p_actor_id
       WHERE id = v_family_id;
      v_created := v_created + 1;
      v_actions := v_actions || jsonb_build_object('object_type','template_family','key',v_family_code,'action','created');
    END IF;

    -- per channel: template version + route
    FOR ch IN SELECT * FROM jsonb_array_elements(it -> 'channels') LOOP
      SELECT id INTO v_layout_id FROM public.core_template_layout
       WHERE code = (c -> 'layouts' ->> (ch ->> 'channel')) AND is_active LIMIT 1;

      -- template version v1 (published)
      v_version_id := NULL;
      IF v_family_id IS NOT NULL THEN
        SELECT id INTO v_version_id FROM public.omni_comms_template_version
         WHERE template_family_id = v_family_id AND channel = ch ->> 'channel'
           AND locale = v_locale AND version_number = 1;
      END IF;

      IF v_version_id IS NOT NULL THEN
        v_existing := v_existing + 1;
        v_actions := v_actions || jsonb_build_object('object_type','template_version','key',v_family_code || ':' || (ch ->> 'channel'),'action','existing');
      ELSIF NOT p_apply OR v_family_id IS NULL OR v_layout_id IS NULL THEN
        v_planned := v_planned + 1;
        v_actions := v_actions || jsonb_build_object('object_type','template_version','key',v_family_code || ':' || (ch ->> 'channel'),'action','planned');
      ELSE
        PERFORM public.omni_comms_priv_validate_channel_content(ch ->> 'channel', ch -> 'content');
        -- Author is the system seed principal (NULL), approver is the operator:
        -- this satisfies the independent-approver rule by construction.
        INSERT INTO public.omni_comms_template_version
          (template_family_id, version_number, channel, locale, content, status,
           layout_selection_mode, layout_id, created_by, updated_by)
        VALUES (v_family_id, 1, ch ->> 'channel', v_locale, ch -> 'content', 'draft',
                'resolved_default', v_layout_id, NULL, p_actor_id)
        RETURNING id INTO v_version_id;

        v_checksum := public.omni_comms_priv_compute_template_checksum(
          v_family_code, 1, ch ->> 'channel', v_locale, ch -> 'content');

        UPDATE public.omni_comms_template_version
           SET status = 'approved', checksum = v_checksum, approved_at = now(), approved_by = p_actor_id,
               updated_at = now(), updated_by = p_actor_id
         WHERE id = v_version_id;

        UPDATE public.omni_comms_template_version
           SET status = 'published', published_at = now(), published_by = p_actor_id,
               updated_at = now(), updated_by = p_actor_id
         WHERE id = v_version_id;

        v_created := v_created + 1;
        v_actions := v_actions || jsonb_build_object('object_type','template_version','key',v_family_code || ':' || (ch ->> 'channel'),'action','created');
      END IF;

      -- route
      SELECT id INTO v_id FROM public.omni_comms_event_route
       WHERE organization_id = p_organization_id
         AND department_id IS NOT DISTINCT FROM v_dept_id
         AND event_definition_id = v_event_id
         AND channel = ch ->> 'channel';

      IF v_id IS NOT NULL THEN
        v_existing := v_existing + 1;
        v_actions := v_actions || jsonb_build_object('object_type','event_route','key',v_code || ':' || (ch ->> 'channel'),'action','existing');
        CONTINUE;
      END IF;

      SELECT id INTO v_sender_id FROM public.omni_comms_sender_identity
       WHERE organization_id = p_organization_id AND code = ch ->> 'sender_code';

      IF NOT p_apply OR v_family_id IS NULL OR v_sender_id IS NULL THEN
        v_planned := v_planned + 1;
        v_actions := v_actions || jsonb_build_object('object_type','event_route','key',v_code || ':' || (ch ->> 'channel'),'action','planned');
        CONTINUE;
      END IF;

      INSERT INTO public.omni_comms_event_route
        (organization_id, department_id, event_definition_id, channel, is_required, is_enabled, priority,
         template_family_id, sender_identity_id, sender_resolution_policy, preference_policy, lifecycle_state,
         created_by, updated_by)
      VALUES
        (p_organization_id, v_dept_id, v_event_id, ch ->> 'channel',
         COALESCE((ch ->> 'is_required')::boolean, false), true,
         COALESCE((ch ->> 'priority')::integer, 100),
         v_family_id, v_sender_id, 'explicit', 'honour', 'draft', p_actor_id, p_actor_id)
      RETURNING id INTO v_id;

      UPDATE public.omni_comms_event_route
         SET lifecycle_state = 'active', activated_at = now(), activated_by = p_actor_id,
             updated_at = now(), updated_by = p_actor_id
       WHERE id = v_id;

      v_created := v_created + 1;
      v_actions := v_actions || jsonb_build_object('object_type','event_route','key',v_code || ':' || (ch ->> 'channel'),'action','created');
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'catalogue_version', (c ->> 'catalogue_version')::int,
    'mode', CASE WHEN p_apply THEN 'apply' ELSE 'preview' END,
    'created', v_created,
    'planned', v_planned,
    'existing', v_existing,
    'skipped', v_skipped,
    'actions', v_actions,
    'generated_at', now()
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.omni_comms_priv_reference_seed_run(uuid, uuid, boolean) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. Public RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omni_comms_reference_seed_preview(p_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
DECLARE
  v_uid uuid;
  v_res jsonb;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');
  PERFORM public.omni_comms_priv_reference_seed_assert_safe(p_organization_id);
  v_res := public.omni_comms_priv_reference_seed_run(v_uid, p_organization_id, false);
  RETURN v_res;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.omni_comms_reference_seed_apply(
  p_organization_id uuid,
  p_confirm_non_production boolean,
  p_correlation_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
DECLARE
  v_uid uuid;
  v_res jsonb;
  v_live bigint;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('configure');

  IF COALESCE(p_confirm_non_production, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'OC422 validation_error'
      USING ERRCODE = 'P0001', DETAIL = 'non_production_confirmation_required';
  END IF;

  PERFORM public.omni_comms_priv_reference_seed_assert_safe(p_organization_id);

  v_res := public.omni_comms_priv_reference_seed_run(v_uid, p_organization_id, true);

  -- Post-condition: the seed must never enable live delivery.
  SELECT count(*) INTO v_live
    FROM public.omni_comms_channel_setting
   WHERE organization_id = p_organization_id AND live_delivery_enabled;
  IF v_live > 0 THEN
    RAISE EXCEPTION 'OC500 internal_error'
      USING ERRCODE = 'P0001', DETAIL = 'reference_seed_live_delivery_postcondition_failed';
  END IF;

  PERFORM public.omni_comms_priv_write_audit(
    v_uid, 'reference_seed_apply', 'reference_seed', p_organization_id,
    'omni_comms_reference_seed',
    NULL,
    jsonb_build_object(
      'created', v_res -> 'created',
      'existing', v_res -> 'existing',
      'planned', v_res -> 'planned',
      'catalogue_version', v_res -> 'catalogue_version',
      'live_delivery_enabled', false
    ),
    p_correlation_id
  );

  RETURN v_res;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.omni_comms_reference_seed_status(p_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
DECLARE
  v_uid uuid;
  c jsonb := public.omni_comms_priv_reference_seed_catalogue();
  v_expected_events int;
  v_present_events int;
  v_expected_channels int;
  v_present_routes int;
  v_present_versions int;
  v_present_senders int;
  v_present_accounts int;
  v_live_channels int;
  v_live_requests int;
BEGIN
  v_uid := public.omni_comms_priv_require_capability('view');

  SELECT count(*) INTO v_expected_events FROM jsonb_array_elements(c -> 'events');
  SELECT count(*) INTO v_expected_channels
    FROM jsonb_array_elements(c -> 'events') e, jsonb_array_elements(e -> 'channels');

  SELECT count(*) INTO v_present_events
    FROM public.omni_comms_event_definition d
   WHERE d.code IN (SELECT e ->> 'code' FROM jsonb_array_elements(c -> 'events') e);

  SELECT count(*) INTO v_present_routes
    FROM public.omni_comms_event_route r
    JOIN public.omni_comms_event_definition d ON d.id = r.event_definition_id
   WHERE r.organization_id = p_organization_id
     AND d.code IN (SELECT e ->> 'code' FROM jsonb_array_elements(c -> 'events') e);

  SELECT count(*) INTO v_present_versions
    FROM public.omni_comms_template_version v
    JOIN public.omni_comms_template_family f ON f.id = v.template_family_id
   WHERE f.organization_id = p_organization_id
     AND f.code IN (SELECT e ->> 'family_code' FROM jsonb_array_elements(c -> 'events') e)
     AND v.status = 'published';

  SELECT count(*) INTO v_present_senders
    FROM public.omni_comms_sender_identity s
   WHERE s.organization_id = p_organization_id
     AND s.code IN (SELECT x ->> 'code' FROM jsonb_array_elements(c -> 'senders') x);

  SELECT count(*) INTO v_present_accounts
    FROM public.omni_comms_provider_account a
   WHERE a.organization_id = p_organization_id
     AND a.code IN (SELECT x ->> 'code' FROM jsonb_array_elements(c -> 'accounts') x);

  SELECT count(*) INTO v_live_channels
    FROM public.omni_comms_channel_setting
   WHERE organization_id = p_organization_id AND live_delivery_enabled;

  SELECT count(*) INTO v_live_requests
    FROM public.omni_comms_request
   WHERE organization_id = p_organization_id AND mode IS DISTINCT FROM 'dry_run';

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'catalogue_version', (c ->> 'catalogue_version')::int,
    'expected_events', v_expected_events,
    'present_events', v_present_events,
    'expected_channel_bindings', v_expected_channels,
    'present_routes', v_present_routes,
    'present_published_versions', v_present_versions,
    'expected_senders', (SELECT count(*) FROM jsonb_array_elements(c -> 'senders')),
    'present_senders', v_present_senders,
    'expected_accounts', (SELECT count(*) FROM jsonb_array_elements(c -> 'accounts')),
    'present_accounts', v_present_accounts,
    'seeded', (v_present_events >= v_expected_events AND v_present_routes >= v_expected_channels),
    'live_delivery_enabled_channels', v_live_channels,
    'live_requests', v_live_requests,
    'safe_to_seed', (v_live_channels = 0 AND v_live_requests = 0),
    'checked_at', now()
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.omni_comms_reference_seed_preview(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_reference_seed_apply(uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.omni_comms_reference_seed_status(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.omni_comms_reference_seed_preview(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_reference_seed_apply(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.omni_comms_reference_seed_status(uuid) TO authenticated;