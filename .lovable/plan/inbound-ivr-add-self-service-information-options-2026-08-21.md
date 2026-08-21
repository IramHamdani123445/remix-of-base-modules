# Inbound IVR — Add Self-Service Information Options

Today, once a caller is identified and verified, the IVR speaks one fixed summary and hangs up. This adds a spoken menu after verification so callers can choose what they want to hear, with three new data-backed options per caller type, all read live from existing tables.

## New caller experience

After the date verification succeeds, the caller hears:

```text
Thank you, verification successful.
For your account summary, press 1.
For your last contribution details, press 2.
For your latest claim or payment status, press 3.   (person)
For your filing and payment status, press 3.        (employer)
To repeat this menu, press 9. To end the call, press 0.
```

After each answer, the menu is offered again instead of hanging up, so a caller can hear several items in one call. Invalid keys re-prompt; the existing 3-attempt limit and failure messages stay unchanged.

## What is spoken (all live data)

Person (identified by SSN):
1. Account summary — existing text: most recent claim + next scheduled benefit payment.
2. Last contribution — most recent wage record: contribution period, employer, wages reported and employee contribution amount, plus number of contribution periods recorded in the last 12 months.
3. Latest claim / payment status — most recent claim reference, status and decision date, plus the most recent payment instruction (amount, status, date) when one exists.

Employer (identified by registration number):
1. Account summary — existing text: arrears, penalties, total outstanding balance.
2. Last submission — last filing period and filing date, whether filings are current, and missed filings in the last 12 months.
3. Payment status — last payment date and period, number of payments and total paid over the last 12 months, plus the current outstanding balance.

If a section has no data, a plain spoken "no records" sentence is used, exactly as the existing summary does.

## Technical notes

- Data sources (all already present, read-only):
  - Person: `bn_claim`, `bn_payment_schedule`, `bn_payment_instruction`, `ip_wages` (by `ssn`).
  - Employer: `ce_v_employer_arrears_summary`, `ce_v_employer_filing_status`, `ce_v_employer_payment_status` (all keyed by `regno`).
- One migration, additive only:
  - New `SECURITY DEFINER` function `omni_comms_priv_inbound_voice_section(p_subject_kind, p_subject_key, p_section)` returning the spoken text for `summary | contribution | status`. Money via the existing `omni_comms_priv_inbound_voice_money`, dates via `FMDD FMMonth YYYY`, every `array_append` explicitly `::text` cast (the fix already applied for 22P02).
  - `omni_comms_priv_inbound_voice_summary` stays and is reused as the `summary` section, so nothing existing breaks.
  - `omni_comms_priv_inbound_voice_step` gains a `served` step: on successful verification it returns the new gather menu; on a menu key it speaks the section and re-gathers; `0` ends the call. Existing `menu`, `identify`, `verify` behaviour and attempt limits unchanged.
  - Grants: `service_role` only, `REVOKE` from public/anon/authenticated — matching current IVR functions.
- No edge-function change is required: `omni-comms-inbound-voice` and `omni-comms-inbound-voice-simulate` already render whatever `gather` / `say_hangup` the state machine returns. Nothing new is sent, no template, no provider call.
- Call evidence: `omni_comms_inbound_voice_call.spoken_text` accumulates the sections spoken, and `step` reflects `served`, so the Test Centre trace still shows the full transcript.
- Registry entries for the IVR object stay valid; only the description of the served step is refreshed.

## Verification

Run the in-app Inbound IVR simulator end to end for both paths using the known test identities (person SSN `950003` / DOB `05111978`; employer reg `655651` / date `14021978`), keying 1, 2 and 3 in the same simulated call, and confirm each section speaks real values from the database.
