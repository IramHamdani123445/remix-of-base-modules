# SMS on Omni-Comms — mirror the Email structure

## What I found first (important)

The "SMS configuration" in the System Notification module is **not real configuration**.

- `System Admin → Notification Channel Settings → SMS Settings` reads from
  `src/services/mockData/notificationData.ts`. Provider, gateway URL, from-number,
  retries and daily limit are hard-coded demo values; "Save" and "Send Test SMS"
  only show a toast.
- The real provider table (`notification_providers`) contains exactly **one** row —
  the Resend email provider. There is **no SMS row, no SMS credential, no SMS gateway**
  anywhere in the backend.

So there is nothing genuine to copy across. What we can and should copy is the
**shape** — everything Email has in Omni-Comms, rebuilt for SMS — plus the legacy
screen's intent (provider choice, sender number, retries, daily cap, test send).

Omni-Comms already has an SMS skeleton: a simulation provider, a simulation account,
one org sender identity and an enabled org channel setting. It has no real adapter,
no credentials, no SMS templates and no release control.

## Plan

### 1. SMS provider adapter (server side)
- Add a Twilio SMS adapter under `src/platform/omni-comms/providers/`, mirroring the
  Resend adapter: server-only, secret read by NAME from Edge secrets, no SDK in app code.
- Mark `twilio` as `deliveryImplemented`/`verificationImplemented` in the provider
  adapter catalogue once the adapter is real (today both are `false`).
- Credential purposes: `account_sid`, `auth_token` (+ optional messaging service SID),
  stored as Edge secrets; the DB only ever holds the secret reference name.

### 2. Backend objects (all `omni_comms_` prefixed, no new tables)
Reuse the existing shared channel tables exactly as Email does:
- `omni_comms_provider` — Twilio SMS provider row.
- `omni_comms_provider_account` — one account per environment (sandbox / production),
  with `secret_ref`, health state and credential verification.
- `omni_comms_sender_identity` — SMS sender identities: long code / short code /
  alphanumeric sender ID, replacing the legacy "From Number" field.
- `omni_comms_sender_provider_binding` — identity → account, with priority and
  verification evidence.
- `omni_comms_channel_setting` (channel `sms`) — enabled, live delivery, quiet hours,
  per-minute limit, plus a daily cap to carry over the legacy `dailyLimit`.
- `omni_comms_channel_endpoint` — SMS delivery-status callback and inbound (STOP/HELP) callback.
- `omni_comms_module_sender_profile` — per-module SMS sender assignment (Benefits,
  Compliance, Legal, Registration, Finance), same resolution precedence as Email.

### 3. Release control and the master switch
- SMS release control is currently Email-only. Extend it so SMS gets the same
  governed OFF/ON delivery gate, second-person approval and pilot window.
- Surface the SMS toggle in the existing Control Center next to Email — one place,
  same gate semantics, same audit trail.

### 4. Templates
- Add SMS channel variants to the existing Benefits template families rather than
  new template tables: plain text, 160-char-aware, token-validated, same
  draft → published lifecycle.
- Seed an initial SMS set for the highest-value Benefits events (claim submitted,
  approved, disallowed, payment issued, life-certificate due, appointment reminder),
  then extend.

### 5. Routing and sending
- Business modules keep calling `sendCommunication()` / `emitBenefitsCommunication()`.
  Nothing in Benefits, Compliance, Legal or Finance changes: they request channels,
  the hub resolves SMS route → template → sender → account → provider.
- Extend the dispatcher so queued SMS jobs are claimed and delivered through the
  Twilio adapter with the same gate revalidation, retry policy and attempt logging
  that Email uses.
- Resolve recipient phone numbers to E.164 and fail closed on an unusable number.

### 6. Test, diagnostics and evidence
- SMS Test Centre send (approved technical test delivery, separate from business sends).
- SMS delivery callbacks recorded as normalized events; Activity / Email Journey
  surfaces gain the SMS equivalent.
- Diagnostics page shows credential verification, sender verification and send-readiness.

### 7. Legacy screen
- Leave `Notification Channel Settings` untouched and operational, then point its SMS
  tab at the Omni-Comms SMS workspace with a short "configuration has moved" note.
  No legacy deletion in this epic.

## Prerequisites from you

- A Twilio account (or the local SMS gateway you intend to use) — I will request the
  Account SID and Auth Token as secrets when we reach step 1.
- The sender number or alphanumeric sender ID to register for SKN.
- Confirmation on the initial SMS event list for Benefits.

## Suggested sequencing

Steps 1-3 first (provider + config + gate), then 4-5 (templates + live sending),
then 6-7 (evidence and legacy pointer). Each step ends with tests and a clean
architecture-boundary check.
