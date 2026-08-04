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

## Architecture boundary enforcement (Story 4)

Ten architecture rules are enforced locally and in pull-request CI. They are
implemented under `src/platform/omni-comms/architecture/` and consumed by both
Vitest and the local command below.

**Local command**

```bash
bun run check:omni-comms-architecture
```

The command scans the repository read-only, prints file counts + baseline
status, and exits non-zero on any new unbaselined violation, invalid baseline,
or stale baseline entry.

**CI**

Wired into `.github/workflows/comm-hub-clean-db-ci.yml` as the
`omni-comms-architecture` job. The job runs on every pull request that touches
the new system, its tests, or the check script.

**Zero-tolerance scopes**

No architecture exception is allowed inside `src/platform/omni-comms/**` or
`src/pages/admin/omnichannel-communications/**`. The baseline validator rejects
any entry whose path falls inside these roots.

**Baseline discipline**

- Baseline entries record precise, pre-existing repository debt outside the
  new system: exact path, exact rule id, exact evidence, and a written reason.
- Baseline is technical-debt evidence, **not** approval.
- Wildcards, directory-wide entries, and duplicates are rejected by the
  validator.
- Stale entries (baseline entries that no longer match any active violation)
  fail the check.

**Remediation guidance**

When a rule fires, the printed remediation instructs how to remove the
violation — typically by moving code into an approved location (adapter,
edge function) or by adding an approved object to the correct registry. Do not
disable checks to pass CI.

**Registries do not bypass review.** Adding an entry to the object, route,
integration, or queue registry represents architecture approval; the entries
themselves are governed by the same review process as the code.

**Epic 7 façade-rule change.** Rule 9 currently prohibits every send façade.
Under Epic 7 this rule will be deliberately updated to allow exactly one
approved `sendCommunication` façade. That change is out of scope for Epic 1.

**Exceptions require architecture review.** Do not add baseline entries to
work around a rule without an explicit architecture-review decision recorded
in the reason field.

## Current story scope (Epic 1 — Story 1 baseline)

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

## Channel generalisation (CG1)

The Channels workspace is ONE shared administration model for every channel.
There are no per-channel copies of the workspace, the tabs or the resource
managers.

**Canonical capability matrix.** `domain/channelCatalogue.ts` is the single
source of truth. Each channel/resource pair declares:

- `schemaSupported` — the shared database object can store this channel;
- `uiApplicable` — the resource is part of the approved operator workflow.

A resource is offered only when `uiApplicable` is true. Database
representability alone is never sufficient. Tabs are derived from the matrix
(`deriveTabsFromCapabilities`); never hand-list tabs in a component.

Current decisions:

- SMS and WhatsApp expose Endpoints, mirroring the server contract in
  `omni_comms_priv_normalize_channel_endpoint`.
- Push identities stay hidden until the product model changes.
- In-App and Print keep their narrow surface.
- Release Control is Email-only.
- Webhook and Voice are planned: Overview only, no configuration surface.

**Generic configuration summary.** `application/channelConfigurationService.ts`
composes the EXISTING generic summary contracts. It creates no tables and no
RPCs, and it never invokes Release Control contracts for a non-Email channel.

**Two readiness concepts, never merged.**
`admin/views/channels/channelReadiness.ts` reports `configurationReadiness` and
`deliveryReadiness` independently, so "Configuration ready · Delivery adapter
not installed" is a valid, truthful result. Email delegates verbatim to
`projectEmailReadiness(...)`; the Email verdict is copied, never recomputed.

**Truthfulness.** Unloaded, unreadable and not-applicable counts render as
explicit states (`Loading…`, `Unavailable`, `Not applicable`, `Unknown`) and a
genuine zero renders as `Not configured`. Nothing outside Email claims provider
contact, callback verification or delivery acceptance.

**Coordinator rule.** `OmniCommsChannelsPage` selects and renders only. An
out-of-capability tab resolves to Overview and the URL is rewritten to match.
Changing channel clears the deep-linked `?resource=`.

