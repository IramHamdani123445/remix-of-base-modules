# Internal Audit — Final E2E email delivery forensic reconciliation (read-only)

Scope: 2026-08-28 21:45 → 22:10 UTC final business E2E run. No writes, no new
test data, no configuration change was made during this check.

## 1. Business records created in the run window

Annual plans, engagements, findings, management responses, reports, actions and
follow-ups were all created and committed. The business pass is intact.

## 2. Communication obligations raised

82 `omni_comms_business_event_outbox` rows were raised by the governed commands
in the run window, across 8 event codes and 8 recipient personas
(`audit.lead`, `audit.auditor1`, `audit.mgmt.benefits`, `audit.mgmt.compliance`,
`audit.mgmt.finance`, all `recipient_type = user`, all with existing profiles).

## 3. End-to-end trace

| Stage | Count in run window |
| --- | --- |
| outbox rows | 82 |
| `omni_comms_request` | 0 |
| `omni_comms_message` | 0 |
| dispatch jobs | 0 |
| provider attempts | 0 |

Every outbox row is `status = processed`, `result_code =
no_communication_configured`, `blocker_code = no_channel_configured`.
Terminal classification — never retried, by design.

## 4. Failure point

**E. No email route.** `omni_comms_priv_ingest_business_event` calls
`omni_comms_priv_effective_channels(org, department_id, event_code, product)`.
That resolver only returns a channel when `omni_comms_event_route` has a row for
the same `department_id`, or a global row with `department_id IS NULL`.

Internal Audit routes exist for exactly two departments, both from
**`core_department`**:

- `8ebc900a…` Internal Audit — 41 events, 81 routes
- `c28f40f8…` Benefits Department 1 — 49 events, 97 routes

The final E2E emitted with `department_context_id` taken from
**`ia_departments`** (the *audited* department):

| department_context_id | name (ia_departments) | outbox rows |
| --- | --- | --- |
| 600ca58e… | Finance | 24 |
| 21e086d5… | Compliance | 23 |
| 62e712ce… | Benefits | 23 |
| 99c661ad… | Information Technology | 9 |
| d0710d80… | Administration | 3 |

These are IDs from a different table than the one the routes are keyed on, and
there is no global (`department_id IS NULL`) Internal Audit route. So zero
channels resolved for all 82 obligations. This is a **routing/identifier
mismatch defect**, not a provider, template, recipient or credential failure.

## 5. DEF-03 (`ia_comms_emit_mandatory`) — verified fixed

The deployed function accepts `pending | queued | accepted | duplicate |
deduped | skipped_duplicate | processed` and only raises
`IA_COMMS_OBLIGATION_NOT_CREATED` outside that set. Fix landed at 21:10 UTC,
before the 21:48 run. No business command in the run window rolled back for
communication reasons.

## 6. Stranded / blocked backlog

No `pending` Internal Audit outbox rows remain. 34 rows sit at `blocked` — all
predate the final run (the 18:00 `recipient_type_invalid` batch), none from it.

## 7. Last proven provider delivery

The last real provider sends were the pre-run canaries:

| Time (UTC) | Event | Channel | Destination | Outcome |
| --- | --- | --- | --- | --- |
| 20:06 | ACTION.DUE_SOON | in_app + email | pilot mailbox | accepted |
| 20:46 | ENGAGEMENT.INTIMATION_ISSUED | in_app + email | `audit.mgmt.benefits@mishainfotech.com` | accepted, `074f8677…` |
| 20:46 | REQUEST.ISSUED | in_app + email | `audit.mgmt.benefits@mishainfotech.com` | accepted, `24707e5c…` |

So the email pipeline itself (Resend, sender identity, templates, dispatch gate)
was operational 62 minutes before the run. If those two 20:46 mails were not
seen in an inbox, that is a **mailbox-existence question** for
`audit.mgmt.*@mishainfotech.com`, separate from this defect — the provider
accepted them.

## 8. Two latent blockers that would bite immediately after the routing fix

1. **Rate cap.** The email release control allows `max_messages_per_hour = 20`.
   A re-run producing 82 emails in ~15 minutes will be throttled.
2. **Release snapshot drift.** `approved_commit` and dispatch activation are
   both pinned to `03fcd61c…`; the current runtime revision is newer. This is
   the same condition that previously tripped the safety auto-suspend.

## Verdict

**Emails were never sent for the final Internal Audit E2E, and the failure is a
department-identifier routing mismatch at the ingest boundary — not a provider,
template, credential or recipient failure.** Business state is complete and
uncorrupted; the communication layer produced 82 correctly-formed obligations
that resolved to zero channels and were terminally classified
`no_communication_configured`.

Required fix (not applied): make Internal Audit event routing resolve against
the audited-department context — either by adding global
(`department_id IS NULL`) Internal Audit routes, or by having the IA producer
pass the owning `core_department` (Internal Audit, `8ebc900a…`) as the
communication department context while keeping the audited `ia_departments`
entity in the payload.

Stopped here as instructed. No remediation, no re-run, no new test data.
