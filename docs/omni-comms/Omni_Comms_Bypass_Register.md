# Omni-Comms Bypass Register (Phase C)

Every code path that can reach a delivery provider without passing through
`sendCommunication()` and the Omni-Comms governance spine. A bypass is closed
only when the ungoverned call is removed — not when it is merely discouraged.

Status legend: **CLOSED** (call removed), **CONTAINED** (retained deliberately,
with the governing constraint stated), **OPEN** (still to migrate).

| # | Path | Provider reach | Status | Disposition |
|---|------|----------------|--------|-------------|
| C1 | `src/pages/admin/notifications/ProviderSettings.tsx` — provider "send test" | `send-email-campaign` → Resend | **CLOSED** | Direct invocation removed. Admins are directed to Omni-Comms → Channels → Test Delivery, which enforces sender authorisation, recipient allowlist and the evidence ledger. |
| C2 | `supabase/functions/send-notification` | Resend | **CONTAINED** | Retained as the legacy transactional transport for document email (invoice/receipt) only. No new producer may call it; see D-series migration. |
| C3 | `src/hooks/useEmailDeliveryConfig.ts` — `sendDocumentEmail` | via C2 | **CLOSED** | Wave 4: rewired to `financeDocumentProducer`. Client-side templating and PDF assembly removed. |
| C4 | `supabase/functions/send-email-campaign` | Resend | **CONTAINED** | Bulk campaign tool. Not a business-event producer; excluded from the sending spine by design, but no module may call it programmatically. |
| C5 | `supabase/functions/send-scheduled-legal-report` | Resend | **OPEN** | Scheduled Legal report distribution. Migrates to a scheduled Omni producer with a Legal event code. |
| C6 | `supabase/functions/ce-audit-communication-dispatch` | Resend | **OPEN** | Compliance audit dispatch. Superseded by the Compliance Omni producers; retire once the last consumer is cut over. |
| C7 | `supabase/functions/comm-hub-dispatch` + `_shared/communication-hub/transport-email.ts` | SMTP / Resend | **CONTAINED** | Communication Hub legacy spine. Kept for compatibility until legacy templates finish converging; no new bindings permitted. |
| C8 | `src/services/auditCommunicationService.ts` | `send-notification` (email + SMS) | **CLOSED** | Wave 5. Corrected classification: this is the **Compliance** employer audit/visit communication, not Internal Audit. `send()` now hands the approved communication to `complianceAuditCommunicationProducer`. Compliance keeps the record, approval gating and delivery ledger; no provider call remains. |
| C9 | `src/services/bn/bnNotificationIntegrationService.ts` | `in_app_notifications` direct write; `send-notification` via `dispatchExternal` | **CLOSED** | Wave 3 quarantined the in-app entry point; Wave 5 removed the `dispatchExternal` provider body (no live caller: its only chain starts at the quarantined `dispatchBnNotification`). The function now refuses so the bypass cannot be resurrected. |
| C10 | `src/platform/notifications/gateApprovalNotifications.ts` | `in_app_notifications` direct write | **CONTAINED** | Wave 4: the email leg goes through `platformApprovalAlertProducer`. The in-app row is retained as a compatibility record only. Retirement trigger: Platform in-app delivery certified live in the Hub. |
| C11 | `src/hooks/useApplicationsReview.ts` | `send-notification` | **CLOSED** | Wave 4: converged to `platformApprovalAlertProducer.emitWorkflowDecisionNotification` under `PLATFORM.WORKFLOW.DECISION_NOTIFIED`. |
| C12 | `src/services/legal/lgNotificationRuleEngine.ts` | `in_app_notifications` direct write | **CONTAINED** | Wave 5: judicial events now emit `LEGAL.JUDICIAL.EVENT_NOTIFIED` through `legalCommunicationProducer`. The in-app row is a compatibility record only. Rule evaluation, the document queue and case tasks stay owned by Legal. Retirement trigger: Legal in-app delivery certified live. |
| C13 | `src/services/legal/legalReferralUnifiedService.ts` | `send-transactional-email`; `in_app_notifications` | **CONTAINED** | Wave 5: both email legs replaced by `LEGAL.REFERRAL.INFO_REQUESTED` / `LEGAL.REFERRAL.INFO_RESPONDED`. No provider call remains; the in-app rows are compatibility records with the same retirement trigger as C12. |
| C14 | `src/services/legal/legalReferralCollaborationService.ts` | `send-transactional-email`; `in_app_notifications` | **CONTAINED** | Wave 5: same closure as C13 (`emitLegalInfoResponded`). Provider call removed; in-app row retained as a compatibility record. |

## Standing rules

1. No business module may invoke `send-notification`, `send-email-campaign`,
   `comm-hub-dispatch` or any provider SDK directly. The single entry point is
   `sendCommunication({ moduleCode, departmentCode, eventCode, channels,
   recipient, data, reference, idempotencyKey })`.
2. No client code may hold or forward provider credentials; the credential
   never leaves the trusted edge boundary.
3. Admin screens configure providers; they never dispatch through them. Test
   sends belong to the certified test-delivery boundary only.
4. A bypass may be marked CONTAINED only with a named retirement trigger. It is
   never a permanent exemption.
