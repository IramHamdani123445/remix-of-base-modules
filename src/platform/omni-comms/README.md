# Omnichannel Communications (Omni-Comms)

This is the parallel replacement system for **Communication Hub — Legacy**. It
is being built in isolation. Nothing here may import from, read from, or write
to Legacy.

## Permanent architecture rules

1. **Parallel replacement.** Omni-Comms is the successor to the Legacy
   Communication Hub. Both run side-by-side; per-event migration is manual and
   explicitly authorised.
2. **No Legacy imports.** Code under `src/platform/omni-comms/**` must not
   import from `src/platform/communication-hub/**`, `src/pages/admin/communicationHub/**`,
   Legacy comm modules, or any `comm_hub_*` / `communication_*` / `core_template*`
   / `notification_*` service module.
3. **No Legacy communication-table reads or writes.** Direct access to
   `notification_queue`, `notification_logs`, `communication_request`,
   `communication_message`, `bn_communication_log`, `ce_audit_communications`,
   `ce_notice_delivery_log`, or any Legacy comm table is prohibited.
4. **Single public façade.** The only future public sending entry point is
   `sendCommunication()` exported from
   `src/platform/omni-comms/sendCommunication.ts`. It does not yet exist —
   business modules must not call anything from Omni-Comms until it does.
5. **Providers only in adapters.** Resend, Twilio, Meta/WhatsApp, Firebase,
   SendGrid, nodemailer and any other provider SDK may be imported only from
   `src/platform/omni-comms/adapters/providers/**` or from a server-side
   `omni-comms-*` edge function. Nowhere else.
6. **No runtime writes from React.** Components under `admin/**` must not
   write to runtime communication tables. Configuration UIs write only through
   approved application services.
7. **Object-registry approval required.** Every permanent DB object (table,
   view, function, policy, trigger, type) must appear on the approved
   Omni-Comms object catalogue **before** it is created. Unlisted names cannot
   be created.
8. **Single-source-of-truth per event.** One business event may never be live
   in both Legacy and Omni-Comms at the same time. Cutover is per-event.
9. **Legacy remains operational.** Legacy Hub stays fully functional until an
   explicit, authorised event migration is completed. Omni-Comms tasks must
   never rename, redirect, disable, quarantine, or modify Legacy behaviour.
10. **No automated production cutover.** No CI process, Lovable automation, or
    Omni-Comms code path may automatically switch a business event from
    Legacy to Omni-Comms. Production cutover is always a human, gated decision.

## Boundaries

- Source namespace: `src/platform/omni-comms/**`.
- Admin routes: `/admin/omnichannel-communications/*`.
- API routes: `/api/omni-comms/*` (future).
- Edge functions: names begin with `omni-comms-` (future).
- DB objects: `public` schema, prefix `omni_comms_` (future, catalogued).
- Queue/topic names: `omni-comms.*` (future).
- Sole public façade: `sendCommunication()` (not yet implemented).

## Current story scope (Epic 1 — Story 1)

Only these are established in this story:

- Folder skeleton (this file + `.gitkeep` placeholders).
- Six capability definitions in the shared permission registry.
- One route guard (`OmniCommsAdminRoute`) that reuses the shared auth/permission
  hooks and checks `omni_comms.view`.
- Seven admin routes rendering read-only "Not yet implemented" placeholders
  (except the landing view, which is a plain readiness placeholder).
- One nav module row (+ children) seeded into the DB-driven navigation.

No `sendCommunication`, no provider adapters, no channel adapters, no workers,
no API clients, no DB repositories, no communication tables, no edge functions,
no queues.
