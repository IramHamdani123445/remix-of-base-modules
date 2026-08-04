# BN Life Certificates — Controlled Vertical Slice

Status: **dark-launched** (`app_modules.bn_life_certificate.actions_enabled = false`).
Scope: Life Certificates only. Medical Reviews, Overpayments, Mortality, Appeals,
Means Tests, Uprating and Risk Management are explicitly out of scope.

## 1. Existing-state audit

| Capability | Current UI (before) | Current backend (before) | Real or mock | Permission | Mutation boundary | Gap closed |
| --- | --- | --- | --- | --- | --- | --- |
| Obligation generation | none | none | n/a | none | none | `bn_life_certificate_generate_obligations_v1` (policy-driven, preview + capped batch) |
| Due-date calculation | hard-coded JS dates | none | mock | n/a | browser | policy-driven in SQL, snapshotted per obligation |
| Worklist | flat table, direct select | `fetchLifeCertificates()` | real, unbounded | module view | direct table read | `bn_life_certificate_worklist_v1` (buckets, paging, cap 200) |
| Certificate receipt | none | none | n/a | none | none | `bn_life_certificate_receive_v1` with DMS validation |
| Evidence upload / linking | none | none | n/a | none | none | linked via `bn_claim_document`; version + checksum retained |
| Verification | dialog | direct `update` to `VERIFIED` | real, unsafe | generic edit | browser mutation | `bn_life_certificate_verify_v1`, maker-checker enforced |
| Rejection | none | none | n/a | none | none | `bn_life_certificate_reject_v1` (reason + narrative mandatory) |
| Resubmission | none | none | n/a | none | none | `bn_life_certificate_request_resubmission_v1` |
| Waiver / deferral | none | none | n/a | none | none | `bn_life_certificate_waive_v1`, `bn_life_certificate_defer_v1` |
| Reminders | remarks string append | `recordLifeCertificateReminder()` | mock | generic edit | browser mutation | milestone command + communication intent |
| Grace period | none | none | n/a | none | none | policy `grace_days`, `GRACE` state |
| Overdue escalation | none | none | n/a | none | none | milestone command → `OVERDUE` |
| Suspension proposal | none | none | n/a | none | none | `bn_life_certificate_escalate_to_suspension_v1` (proposal only) |
| Reinstatement proposal | none | none | n/a | none | none | `bn_life_certificate_propose_reinstatement_v1` (proposal only) |
| Audit | none | none | n/a | none | none | `bn_life_certificate_event` + core audit, same transaction |
| Reporting | none | none | n/a | none | none | worklist buckets + timeline query |

## 2. Schema and objects reused

Reused: `bn_award`, `bn_claim`, `bn_claim_document` (DMS boundary),
`bn_award_suspension_event` (suspension + reinstatement), `bn_reason_code`,
`app_modules` / `role_permissions` (permissions and dark-launch flag),
core audit infrastructure.

Added in this slice: `bn_life_certificate_policy` (versioned rules),
lifecycle columns on `bn_life_certificate`, `bn_life_certificate_event`
(history) and `bn_life_certificate_communication_intent` (transactional outbox).
No duplicate award, payment, arrears, template or notification tables.

## 3. State machine

```text
NOT_DUE → DUE → RECEIVED → UNDER_REVIEW → VERIFIED

DUE → REMINDER_SENT
DUE/REMINDER_SENT → GRACE → OVERDUE
RECEIVED/UNDER_REVIEW → REJECTED → RESUBMISSION_REQUIRED
OVERDUE → SUSPENSION_PROPOSAL_CREATED
VERIFIED (award suspended) → REINSTATEMENT_PROPOSAL_CREATED
DUE/GRACE → WAIVED | DEFERRED
```

Five independent status fields are kept separate: obligation, evidence,
verification, escalation and communication status. Every transition records
source state, permission, actor, timestamp, reason/narrative, expected row
version, idempotency key, correlation id and an audit event.

## 4. Policy model

`bn_life_certificate_policy` holds versioned rules: applicable benefit/award
types, age or pension category, jurisdiction, frequency, obligation period,
issue and due date derivation, grace days, reminder schedule, escalation
offset, accepted evidence types, verification requirements, waiver conditions
and the suspension / reinstatement reason codes. The policy code, version and
calculation inputs are snapshotted onto each obligation, so later policy edits
never rewrite historical obligations.

## 5. Commands and query boundaries

Commands (all `_v1`, SECURITY DEFINER, pinned `search_path`, permission checked,
audited, idempotent): `generate_obligations`, `receive`, `verify`, `reject`,
`request_resubmission`, `waive`, `defer`, `mark_milestone`,
`escalate_to_suspension`, `propose_reinstatement`.

Queries: `bn_life_certificate_worklist_v1` (bucketed, paginated, capped at 200),
`bn_life_certificate_detail_v1`, `bn_life_certificate_timeline_v1`,
`bn_life_certificate_due_milestones_v1` (scheduler only).

Frontend boundary: `src/services/bn/lifeCertificateCommandService.ts` and
`src/services/bn/lifeCertificateViewService.ts`. No component touches a table.

## 6. Permissions

Module `bn_life_certificate` with granular actions: `view`, `generate`,
`receive`, `verify`, `reject`, `request_resubmission`, `waive`, `defer`,
`view_evidence`, `view_confidential_evidence`, `send_reminder`, `escalate`,
`propose_suspension`, `propose_reinstatement`, `audit`, `admin`. Both the UI and
every server command enforce them; a generic Benefits edit permission cannot
verify, waive or defer.

## 7. Scheduler

`supabase/functions/bn-life-certificate-runner/index.ts`. Shared-secret header
`x-bn-life-certificate-runner-secret` (`BN_LIFE_CERTIFICATE_RUNNER_SECRET`),
bounded batches (200), max 5 attempts per obligation, deterministic idempotency
key `lc:<id>:<milestone>:<date>`, per-item failure isolation, sanitized short
error codes and no claimant PII in logs. It computes no business outcome — each
milestone calls `bn_life_certificate_mark_milestone_v1`. Cron cadence is not yet
enabled (dark launch).

## 8. Communication integration

Every milestone and decision records a communication intent row in the same
transaction as the state change (obligation created, due, first/final reminder,
grace started, overdue, received, verified, rejected, resubmission required,
waiver, deferral, suspension proposal, reinstatement proposal). Dispatch is left
to the shared communication façade; no email, SMS or letter is sent from a Life
Certificate database function, and a delivery failure never changes obligation
state.

## 9 / 10. Suspension and reinstatement integration

Life Certificates never set an award to `SUSPENDED` or `ACTIVE`, never release
payment holds and never compute arrears. Escalation creates an Award Suspension
*proposal* under the configured overdue reason; verification after suspension
creates a reinstatement *proposal* under the evidence-received reason. Both link
the obligation to the case, store the correlation id, keep maker-checker intact
and are replay-safe. Approval, execution, hold release, arrears and calculation
traces remain owned by the Award Suspension boundary.

## 11. Evidence / DMS handling

Evidence must be an existing `bn_claim_document` belonging to the claimant's
claim. Ownership, accepted evidence type, certificate date validity and reuse
across claimants are validated server-side. Version and checksum metadata are
preserved. Confidential metadata is masked unless the caller holds
`view_confidential_evidence`. No browser-local paths or unrestricted storage
URLs are stored, and the submission channel is recorded but never treated as
proof of authenticity.

## 12. Mocks and browser mutations removed

- `awardServicingService.verifyLifeCertificate()` — deleted.
- `awardServicingService.recordLifeCertificateReminder()` — deleted.
- Hard-coded due dates and reminder-in-remarks logic in the page — deleted.
- The page no longer selects `bn_life_certificate` directly.
- Regression tests forbid canonical Life Certificate code from importing legacy
  Benefits mutation services, `updateAwardStatus`, or calling `.insert/.update/
  .delete` on any table.

## 13. Tests

`src/__tests__/bn/servicing/lifeCertificateSlice.test.ts` — 26 targeted tests:
command routing and versioning, row-version propagation, batch caps, preview
generation, idempotency/correlation propagation, sanitized error mapping,
query-boundary and page caps, denied vs failed reads, boundary regressions
(no legacy imports, no direct writes, proposal-only escalation) and scheduler
contract (secret, deterministic key, batch/attempt limits, PII-free logs).

## 14. Deployment and readiness

| Environment | Status |
| --- | --- |
| Developer testing | Ready |
| Controlled Test | Pending controlled UAT run |
| UAT | Blocked on Test reminder-delivery verification |
| Pilot | Blocked |
| Production | Blocked |

Test deployment: migrations and functions applied to the Test database; runner
deployed with `verify_jwt = false` and secret-gated, cron **not** scheduled.
Live deployment: not applied.

## 15. Remaining risks

- Reminder delivery has not yet been exercised end-to-end through the shared
  communication façade in Test.
- Cron cadence, alerting for runner failures and the permission matrix still
  require operational sign-off before Test enablement.
- Legacy `/newbenefit`, `/nbenefit` life certificate screens remain in place for
  parity; retirement needs an approved redirect plan.
