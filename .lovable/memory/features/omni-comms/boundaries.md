---
name: Omnichannel Communications — Permanent Boundaries
description: Namespace, route, DB prefix, façade, and legacy-isolation rules for the new Omni-Comms replacement system. Include verbatim in every implementation prompt.
type: constraint
---

The new Omnichannel Communications ("Omni-Comms") system is being built to
replace the Legacy Communication Hub. The following boundaries are permanent
and apply to every future task until this file is explicitly revised.

## Approved boundaries

- Source namespace: `src/platform/omni-comms/**` (nothing else).
- Admin routes: `/admin/omnichannel-communications/*`.
- Public API routes: `/api/omni-comms/*`.
- Edge functions: names begin with `omni-comms-`.
- Database objects: `public` schema, prefix `omni_comms_` (tables, views,
  functions, triggers, policies, types).
- Queue / topic names: `omni-comms.*`.
- Single public sending façade: `sendCommunication()` exported from
  `src/platform/omni-comms/sendCommunication.ts`. Business modules call
  ONLY this façade.

## Hard prohibitions

- No Legacy Communication Hub imports, reads, or writes from Omni-Comms code.
  Legacy Hub (`src/platform/communication-hub/**`, `comm_hub_*`,
  `communication_*`, `core_template*`, `notification_*`, `comm-hub-*` edge
  functions) must remain fully operational and untouched by Omni-Comms tasks.
- No provider SDK imports (Resend, Twilio, Meta/WhatsApp, Firebase, SendGrid,
  nodemailer, etc.) anywhere outside a dedicated Omni-Comms provider adapter
  under `src/platform/omni-comms/providers/` or a server-side omni-comms edge
  function. Business modules MUST NOT import a provider directly.
- No business module may write to `notification_queue`, `notification_logs`,
  `bn_communication_log`, `ce_audit_communications`, `ce_notice_delivery_log`,
  `communication_request`, `communication_message`, or any Omni-Comms table
  directly — always via `sendCommunication()`.
- No deprecation flags, telemetry hooks, event-disable guards, read-only
  restrictions, redirects, relabelling, or DB changes to Legacy Hub without
  explicit authorization in a later migration epic.

## Change-authorization rule

Any new DB object, route, edge function, or provider adapter for Omni-Comms
must be added to the approved Omni-Comms object catalogue BEFORE being
created. The catalogue is proposed in the pre-build audit and requires
explicit user approval; unlisted names cannot be created.

## Reminder to include in prompts

Every future Omni-Comms implementation prompt must restate these boundaries
verbatim. Project memory alone is not authoritative — the prompt is.
