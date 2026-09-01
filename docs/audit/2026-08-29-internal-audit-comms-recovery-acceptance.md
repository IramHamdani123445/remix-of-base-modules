# Internal Audit — Final Communication Recovery Acceptance

Date: 2026-08-29 (TEST environment, project ref `xynceskeiiisiefqlgxo`, environment kind `TEST` / runtime `non_production`)
Scope: complete the interrupted final Internal Audit E2E communication leg only. The 20+ engagement business portfolio was **not** restarted or rebuilt.

## 1. Preservation of the original defect evidence

- Internal Audit outbox rows total: **150**
- Rows still carrying `blocker_code = 'no_channel_configured'`: **83** (unchanged, untouched)

The original failure evidence is intact.

## 2. Routing architecture verified

`ia_comms_emit` continues to route on the communication owner department
(`ia_comms_owner_department_id()` = `8ebc900a-3f89-41cc-8094-cfe572339200`, `INTERNAL_AUDIT`),
while the audited department is preserved in the payload as
`auditedDepartmentId` / `auditedDepartmentName` before contract projection.

All 10 acceptance emissions returned `routing_department_id = 8ebc900a…` with the audited
department recorded separately (Benefits `8f09d401…`, Finance `600ca58e…`, Compliance `577421a6…`).

## 3. Governed pilot allowlist expansion (maker–checker)

Both controlled-pilot release controls were suspended, reconfigured, re-proposed and approved by a
different officer (proposer `62c928c3…`, approver `08655ffc…`):

| Channel | Release control | Rules before | Rules after | State | Approved commit |
| --- | --- | --- | --- | --- | --- |
| email | `c8c6e2c4…` | 12 | 14 | `controlled_pilot` | `03fcd61c…` |
| in_app | `efe71427…` | 12 | 14 | `controlled_pilot` | `03fcd61c…` |

Added recipients (exact-address hashes only): `audit.mgmt.finance@mishainfotech.com`,
`audit.mgmt.compliance@mishainfotech.com`, plus their in-app user references.

Rate caps were **not** relaxed: 20/hour, 100/day, 500 total (email); 20/hour, 100/day, 300 total (in-app).

## 4. Certification revision alignment

Dispatch was initially held with `certification_revision_mismatch`: `omni_comms_dispatch_activation.certified_revision`
was still pinned to the superseded revision `854a0d71…` while both the runtime certification record and the
deployed runtime/dispatcher report `03fcd61c75a933ebf3e750d52d925c34b1efea81`.

`omni_comms_priv_set_dispatch_certified_from()` re-pinned the activation to the uniformly observed
deployed revision. Every subsequent delivery attempt recorded
`deployed_revision_at_claim = certified_commit_at_claim = 03fcd61c…`.

## 5. Bounded real-email acceptance run

Ten distinct Internal Audit communication events across three audited departments
(occurrence `recovery-acceptance-20260830-r2`). All were dual-channel (email + in-app).

| Reference | Event | Audited dept | Recipient | Email | In-app | Provider |
| --- | --- | --- | --- | --- | --- | --- |
| RECOV2-BEN-01 | ENGAGEMENT.INTIMATION_ISSUED | Benefits | audit.mgmt.benefits@ | completed | completed | 200 accepted |
| RECOV2-BEN-02 | REQUEST.ISSUED | Benefits | audit.mgmt.benefits@ | completed | completed | 200 accepted |
| RECOV2-BEN-03 | REQUEST.REMINDER | Benefits | audit.mgmt.benefits@ | completed | completed | 200 accepted |
| RECOV2-BEN-04 | FOLLOWUP.SCHEDULED | Benefits | audit.mgmt.benefits@ | completed | completed | 200 accepted |
| RECOV2-FIN-01 | FINDING.RESPONSE_REQUESTED | Finance | audit.mgmt.finance@ | completed | completed | 200 accepted |
| RECOV2-FIN-02 | FINDING.RESPONSE_REJECTED | Finance | audit.mgmt.finance@ | completed | completed | 200 accepted |
| RECOV2-FIN-03 | ACTION.ASSIGNED | Finance | audit.mgmt.finance@ | completed | completed | 200 accepted |
| RECOV2-COM-01 | ENGAGEMENT.INTIMATION_ISSUED | Compliance | audit.mgmt.compliance@ | completed | completed | 200 accepted |
| RECOV2-COM-02 | ACTION.ASSIGNED | Compliance | audit.mgmt.compliance@ | completed | completed | 200 accepted |
| RECOV2-COM-03 | REPORT.ISSUED | Compliance | audit.mgmt.compliance@ | completed | completed | 200 accepted |

- 10/10 outbox rows: `status = processed`, `result_code = communication_requested`, no blocker.
- 10/10 email delivery attempts: `status = accepted`, `provider_status_code = 200`, provider message IDs recorded,
  `recipient_rule_matched = true`, `release_state_at_claim = controlled_pilot`, `execution_context = scheduler`.
- 10/10 in-app jobs completed.
- No cross-department recipient leakage: every `destination_snapshot.email` matched the audited department's
  management mailbox.

Email volume consumed by the acceptance run: **10** real messages (within the 8–12 budget and inside the
unchanged 20/hour and 100/day caps).

## 6. Negative allowlist control

`RECOV2-NEG-01` addressed to `audit.negative.test@certification.invalid` (not allowlisted):

- email job: `held`, in-app job: `held` (`recipient_not_allowlisted`)
- provider delivery attempts for that request: **0**

Governance still blocks non-allowlisted recipients.

## 7. Residual notes

- Two earlier routing-probe jobs from 20:25 (Finance/Compliance) remain `held` with their original
  hold reasons and are retained as evidence; they were not force-released.
- The first acceptance batch (occurrence `recovery-acceptance-20260830`) is retained in `held` state with
  `certification_revision_mismatch` as the documented evidence of the revision-alignment defect.
- Probe evidence rows are persisted in `public.ia_comms_recovery_probe`.

## Verdict

**INTERNAL AUDIT COMMUNICATION RECOVERY: ACCEPTED.** Real Internal Audit email and in-app notifications
now leave the platform end to end (business event → outbox → request → message → dispatch job → provider)
for all three audited departments, under unchanged pilot rate caps, with allowlist enforcement proven
by a negative control and with the original 83 failed obligations preserved.
