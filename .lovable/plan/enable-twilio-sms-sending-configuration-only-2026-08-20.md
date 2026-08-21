# Enable Twilio SMS sending (configuration only)

The SMS code path is already wired end to end (dispatch claim, scheduler tick,
Twilio adapter, test delivery). What is missing is the **configuration data** and
the **credentials** with the names the Omni-Comms secret validator accepts.

Nothing outside the SMS/Twilio path is touched.

## 1. Credentials

Omni-Comms only accepts secret reference names matching
`OMNI_COMMS_TWILIO_*`, so the two values are stored as:

- `OMNI_COMMS_TWILIO_ACCOUNT_SID` — copied from the Account SID you supplied
- `OMNI_COMMS_TWILIO_AUTH_TOKEN` — requested from you via the secure secret form

The existing `TWILIO_ACCOUNT_SID` secret stays as-is; nothing else reads it.
No credential value ever enters the database or the frontend — only the
reference name is stored.

## 2. Channel configuration (all through existing Omni-Comms objects)

No new tables, RPCs, routes or edge functions.

1. **Provider account** — a Twilio SMS account row in
   `omni_comms_provider_account` (environment `production`), carrying the two
   secret reference names under purposes `account_sid` and `auth_token`.
2. **Sender identity** — an SMS identity in `omni_comms_sender_identity` with
   `identity_config.sender_number = +12603467005`.
3. **Binding** — identity → provider account in
   `omni_comms_sender_provider_binding`, priority 1.
4. **Channel setting** — SMS enabled for the organisation in
   `omni_comms_channel_setting`.
5. **Status callback endpoint** — the existing Twilio webhook endpoint
   registered for SMS delivery status, so outcomes land in Communication 360.

## 3. Verify, then release

1. Run credential verification on the Twilio account (Twilio's own auth check)
   and confirm the account shows `verified` / healthy on the SMS Diagnostics page.
2. Send an **SMS Test Delivery** to a number you nominate and confirm the
   provider message SID plus the delivery-status callback in Communication 360.
3. Only after the test passes, take SMS through Release Control (propose →
   approve → activate) so queued business SMS jobs start dispatching. You
   previously authorised activation once the gates are green.

## What I need from you

- The **Twilio Auth Token** via the secure form (I will send it next).
- A **test destination number** in E.164 for step 3.
- Confirm SMS should go live **organisation-wide** (default) rather than a
  single department first.
- A **Messaging Service SID** is optional — say so if you want it used instead
  of the plain from-number.
