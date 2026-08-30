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
| C3 | `src/hooks/useEmailDeliveryConfig.ts` — `sendDocumentEmail` | via C2 | **OPEN** | Finance document email. Migrates with the Finance producer wave; needs a Finance event code and attachment contract before it can move. |
| C4 | `supabase/functions/send-email-campaign` | Resend | **CONTAINED** | Bulk campaign tool. Not a business-event producer; excluded from the sending spine by design, but no module may call it programmatically. |
| C5 | `supabase/functions/send-scheduled-legal-report` | Resend | **OPEN** | Scheduled Legal report distribution. Migrates to a scheduled Omni producer with a Legal event code. |
| C6 | `supabase/functions/ce-audit-communication-dispatch` | Resend | **OPEN** | Compliance audit dispatch. Superseded by the Compliance Omni producers; retire once the last consumer is cut over. |
| C7 | `supabase/functions/comm-hub-dispatch` + `_shared/communication-hub/transport-email.ts` | SMTP / Resend | **CONTAINED** | Communication Hub legacy spine. Kept for compatibility until legacy templates finish converging; no new bindings permitted. |
| C8 | `src/services/auditCommunicationService.ts` | via C6 | **OPEN** | Internal Audit legacy client path. Omni equivalents already exist (`ia_comms_emit`); remove after consumer sweep. |
| C9 | `src/services/bn/bnNotificationIntegrationService.ts` | `in_app_notifications` direct write | **OPEN** | Benefits legacy in-app writes. Converges with the bell migration. |
| C10 | `src/platform/notifications/gateApprovalNotifications.ts` | `in_app_notifications` direct write | **OPEN** | Gate approval notices. Converges with the bell migration. |
| C11 | `src/hooks/useApplicationsReview.ts` | `send-notification` | **OPEN** | Applications review decision emails; needs a Registration event code. |

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
