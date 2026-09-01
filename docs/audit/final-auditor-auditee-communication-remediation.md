# Internal Audit — Auditor ↔ Auditee Communication Remediation Wave

Scope: closure of DEF-S1B-44 … DEF-S1B-52 under the command-owned
communication architecture. Platform (Omni-Comms) was **not** redeveloped —
only Internal Audit business ownership, vocabulary and semantics changed.

## Architectural rule applied

Communication *obligation creation* now belongs to the governed business
command or its database trigger, inside the same transaction as the business
state change. The UI raises nothing that a command already owns. Provider
outcome (Resend accept/reject, in-app delivery) never rolls back business
state — only obligation creation is transactional.

## Defect closure

| Defect | Resolution |
| --- | --- |
| DEF-S1B-44 | `ia_comms_payload_alias` (28 aliases) + `ia_comms_contract_project` derive contract vocabulary at source; producers may keep legacy keys. |
| DEF-S1B-45 | Real scheduling lifecycle: `ia_schedule_engagement` with `ia_engagement_schedule_history`. Scheduling automatically serves the formal intimation. |
| DEF-S1B-46 | `ia_reschedule_engagement`, `ia_postpone_engagement`, `ia_cancel_engagement` with distinct `ENGAGEMENT.RESCHEDULED / POSTPONED / CANCELLED` events. |
| DEF-S1B-47 | Auditee replies raise `QUERY.RESPONSE_RECEIVED` / `REQUEST.RESPONSE_RECEIVED`. `REQUEST.REMINDER` is no longer misused for a reply. |
| DEF-S1B-48 | Governed commands and `AFTER` triggers on findings, responses, reports, actions, follow-ups, requests and queries now own their notices. |
| DEF-S1B-49 | Releasing a finding stamps `response_due_date` and issues `FINDING.RESPONSE_REQUESTED`, so the chased obligation is genuinely served. |
| DEF-S1B-50 | `ia_comms_generate_request_reminders()` ages outstanding requests; scheduled once daily at 08:35 UTC (`ia-comms-request-reminders-daily`). |
| DEF-S1B-51 | Document call-up, audit query and schedule notice are separate events; stage map no longer collapses them. |
| DEF-S1B-52 | `ia_communication_stages` carries `omni_comms_request_id` and `event_code` for end-to-end traceability. |

## Duplicate producers retired

- `auditNotificationService.notifyActionAssigned` — no-op; owned by `ia_action_tracking`.
- `auditNotificationService.notifyQuerySent` — no-op; owned by `ia_audit_queries`.
- `auditNotificationService.notifyQueryResponse` — no-op; reply event owned by the database.
- `DocumentRequestsTab` operator send — now raises `REQUEST.REMINDER`, not a second `REQUEST.ISSUED`.

## Fail-early contract regression (verified)

`ia_comms_contract_project` projected all six representative events from
**legacy** producer vocabulary with no missing fields:

```
INTERNAL_AUDIT.ENGAGEMENT.INTIMATION_ISSUED | ok=true | missing=[]
INTERNAL_AUDIT.REQUEST.ISSUED               | ok=true | missing=[]
INTERNAL_AUDIT.FINDING.RESPONSE_REQUESTED   | ok=true | missing=[]
INTERNAL_AUDIT.REPORT.ISSUED                | ok=true | missing=[]
INTERNAL_AUDIT.ACTION.ASSIGNED              | ok=true | missing=[]
INTERNAL_AUDIT.FOLLOWUP.SCHEDULED           | ok=true | missing=[]
```

Missing facts return `IA_COMMS_CONTRACT_REQUIRED_FIELD_MISSING` before any
request is enqueued, so no poisoned request can reach dispatch.

## Verification

- Typecheck clean.
- Omni-Comms + Internal Audit communication suites: 90/90 passing.
- Event catalogue: 49 Internal Audit events registered with published
  contracts, templates and enabled routes.

Final full Internal Audit E2E has **not** been started, as instructed.
