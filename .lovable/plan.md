# Claim Communications screen — what it actually uses today, and how to move it onto Omni-Comms

## What I found on this screen

The tab you are looking at (Claim → Communications, with Request Evidence / Send Acknowledgement / Life Certificate Reminder and the Timeline / Letters / Emails / SMS / In-App / Failed tabs) is **not** running on Omnichannel Communications. It runs on the older Benefits-local communication stack:

- UI: `src/components/bn/workbench/CommunicationTab.tsx`
- Hooks: `src/hooks/bn/useBnClaimCommunication.ts`
- Engine: `src/services/bn/communication/bnCommunicationAdapter.ts`

That adapter does everything itself, in the browser:

- reads its own event/mapping tables `bn_comm_event`, `bn_comm_mapping`
- picks templates from `notification_templates`
- enqueues email/SMS into `notification_queue`, writes `notification_logs`, `in_app_notifications`
- renders and stores letters in `bn_letter`
- writes its own timeline into `bn_communication_log` + `bn_claim_event`
- lowercase event codes like `bn.eligibility.failed`

This is exactly the pattern the platform boundaries forbid: a business module choosing templates, enqueueing and logging directly instead of calling one façade. It is also why this screen's letters/emails never appear in Omni-Comms Activity, never respect the Benefits Email delivery gate, and use short ad-hoc templates instead of the 68 seeded Benefits letters.

Meanwhile the correct path already exists and is live:
`emitBenefitsCommunication()` → `emitBusinessCommunication()` → `sendCommunication()` → `omni-comms-runtime` → outbox/ingest → governed dispatch (Resend) → Activity, with the seeded `BENEFITS.*` catalogue, contracts, routes, templates and producer bindings.

## Recommended approach: cut the claim screen over to Omni-Comms (no parallel system)

### Phase 1 — Event mapping (no behaviour change)
Add a single mapping table in code from every legacy `bn_comm_event.event_code` (`bn.eligibility.failed`, `bn.claim.acknowledgement`, `bn.life_certificate.reminder`, …) to its canonical catalogue code (`BENEFITS.CLAIM.*`, `BENEFITS.LIFE_CERTIFICATE.*`). Anything with no catalogue match is reported as a gap rather than silently sent.

### Phase 2 — Emit through the façade
Rewrite `triggerClaimCommunication()` so the three action buttons and every automatic trigger call `emitBenefitsCommunication()` with the canonical event code, resolved recipients (semantic roles: `claimant`, `employer_contact`, `internal_officer`), and the payload built by the existing shared Benefits payload builder. Delete the local template lookup, `notification_queue` insert, `notification_logs` insert and `in_app_notifications` insert from the Benefits path. Channel choice, template, branding, approval and dispatch all become the Hub's decision.

### Phase 3 — Read the timeline from Omni-Comms
Replace `getClaimCommunicationHistory()` with the existing Omni-Comms activity reads (business-event activity list + email journey), filtered by `entityType = 'benefit_claim'` and the claim id. Keep the current tab layout (Timeline / Letters / Emails / SMS / In-App / Failed) but drive it from request/message/attempt status, so Retry and Mark Dispatched become governed Hub actions rather than direct row updates.

### Phase 4 — Letters
Letters keep using the generated-documents archive, but the letter is produced from the Omni-Comms template version for the event, not from `notification_templates`. `bn_letter` stays as a read-compatibility view of existing history.

### Phase 5 — Freeze legacy, keep history
`bn_comm_event` / `bn_comm_mapping` / `bn_communication_log` become read-only history. No deletions, no redirects on the legacy hub. New activity only flows through Omni-Comms.

## About the errors visible in your screenshot

- `LETTER BLOCKED — CLAIMANT is missing: postal address` and `Missing: internal user account` are recipient-resolution failures from the legacy adapter. Under Omni-Comms these become bounded blockers on the request with the same fix hint, but visible centrally in Activity and retryable through the governed path.
- `SMS QUEUED` / `EMAIL QUEUED` here are rows in `notification_queue` — nothing in Omni-Comms will ever pick them up, which is why they sit there. After Phase 2 they become real Omni-Comms dispatch jobs governed by the Benefits Email delivery toggle.

## Technical notes

- No new tables, no new edge functions, no new provider code. Reuses `emitBenefitsCommunication`, `benefitsTemplateRegistry`, the runtime, ingest worker and dispatcher already certified.
- Architecture checker will need the Benefits adapter removed from the direct-write allowance once Phase 2 lands.
- Suggested order: Phase 1+2 together (one claim event end-to-end first, e.g. Send Acknowledgement), then Phase 3, then 4/5.
