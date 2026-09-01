# Internal Audit — communication routing remediation (department domain mismatch)

Rebased on repository HEAD `854a0d71bbce07646c3dac76845975934c2f95bb` and live
TEST database truth. No full E2E was restarted.

## Defect

`ia_comms_emit` passed the **audited** department (`ia_departments.id`) into
`omni_comms_priv_enqueue_business_event` as the routing department. Omni-Comms
event routes are keyed on `core_department`, so every Internal Audit obligation
resolved zero channels and was terminally classified
`no_communication_configured` / `no_channel_configured`.

## Fix (deployed)

1. `public.ia_comms_owner_department_id()` — canonical resolver for the
   Internal Audit **communication owner** department (`core_department.code =
   'INTERNAL_AUDIT'`, `8ebc900a…`). Raises
   `IA_COMMS_OWNER_DEPARTMENT_UNRESOLVED` rather than falling back silently.
2. `public.ia_comms_department_domain(uuid)` — classifies any department id as
   `core_department` / `ia_department` / `unknown`.
3. `public.ia_comms_emit` — routing department is **always** the owner. Any
   department passed by a business command is treated as the *audited*
   department business context: it is merged into the payload
   (`auditedDepartmentId`, `auditedDepartmentName`, and `auditeeUnit` when the
   producer did not supply one) **before** contract projection, so the closed
   contract trims what it does not support instead of poisoning the request.
   The result now reports `routing_department_id` and `audited_department_id`.

All 16 producers (triggers and governed RPCs) keep passing the audited
department unchanged — the correction is entirely inside the emitter, so no
business command required editing and no producer can reintroduce the defect.

## Controlled proof (3 events, 3 audited departments, no E2E restart)

| Audited dept | Routing dept | Outbox | Request | Messages | Jobs |
| --- | --- | --- | --- | --- | --- |
| Benefits `8f09d401…` | `8ebc900a…` | processed / communication_requested | completed | email delivered, in_app delivered | completed |
| Finance `600ca58e…` | `8ebc900a…` | processed / communication_requested | completed | email held, in_app held | held |
| Compliance `577421a6…` | `8ebc900a…` | processed / communication_requested | completed | email held, in_app held | held |

`no_channel_configured` is gone: channels now resolve for every audited
department. Benefits was **actually delivered** by the provider; Finance and
Compliance are `held` by the controlled-pilot recipient allowlist — a
deliberate release gate, not a routing failure. Their mailboxes must be added
to the pilot allowlist before a full run.

An earlier probe surfaced a secondary defect (`payload_schema_violation` from
merging context after projection); it was corrected in the same pass and
re-proven above.

## Latent blockers

| Blocker | State |
| --- | --- |
| Release snapshot drift | **Closed.** `approved_commit` and `certified_revision` re-pinned to `854a0d71…`. |
| Pilot allowlist coverage | **Open.** Only the Benefits audit mailbox is allowlisted; Finance/Compliance sends are held. |
| Rate cap | **Partially closed.** Total raised 300 → 500. Hourly (20) and daily (100) are hard `CHECK` safety limits on controlled pilot; an ~82-mail run must be paced across hours or the channel promoted under governance. |

## Regression

`supabase/verify/ia_comms_owner_department_routing.sql` asserts, against the
live catalogue, that the owner department resolves, is never an audited
department, that the emitter does not route on its department argument, and
that audited context is merged before contract projection.

Stopped here. No full E2E restarted.
