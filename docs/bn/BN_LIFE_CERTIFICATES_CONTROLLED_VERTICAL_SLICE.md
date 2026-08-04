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
| Evidence upload / linking | none | none | n/a | none | none | linked via `bn_claim_document`; version retained, integrity status recorded (no manufactured checksum) |
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


---

# Appendix A — Defect-correction and database-validation pass

This appendix supersedes any earlier claim in this document that conflicts with it.

## A1. Canonical scheduler RPC and result contract

Canonical name: **`bn_life_certificate_due_milestones_v1(p_as_of date, p_limit integer)`**.
The earlier `bn_life_certificate_due_for_milestone_v1` has been **dropped** and no
longer exists in `pg_proc` (verifier query 4).

Verified result contract (from `pg_get_function_result`):

```
TABLE(life_certificate_id uuid, bn_award_id uuid, milestone text,
      milestone_date date, attempts integer, row_version integer,
      obligation_status text)
```

The runner consumes exactly these fields. Milestone identity is
`DUE`, `GRACE`, `OVERDUE` or a numbered reminder `REMINDER_<n>` derived from the
obligation's snapshotted `reminder_offset_days`.

## A2. Attempt tracking

Object: `public.bn_life_certificate_scheduler_attempt`
(unique on obligation + milestone + milestone date).

- Failures are recorded through `bn_life_certificate_record_milestone_failure_v1`
  (service-role only; rejected when `auth.uid()` is present).
- Successful or replayed commands reset the counter — they are never failures.
- Five failed attempts set `manual_intervention_required` and the runner skips
  the row with `E_MAX_ATTEMPTS`.
- A later milestone is a different attempt row, so it is never blocked by an
  earlier milestone's failures.
- Technical detail goes to the restricted operational log via
  `_bn_susp_log_operational_error`; the runner, UI and RPC results only ever see
  a sanitized `E_*` code.
- Manual recovery: `bn_life_certificate_clear_milestone_attempts_v1` (requires
  the `escalate` action plus record-level access, and writes an audit entry).
- Visibility: the worklist exposes `manual_intervention_required`,
  `scheduler_failed_attempts`, `scheduler_last_error_code` and a
  `MANUAL_INTERVENTION` bucket.

## A3. Table and function grants (verified)

`supabase/verify/bn_life_certificate_effective_grants.sql` uses `aclexplode`
over `pg_class.relacl` and `pg_proc.proacl`. All five queries return **zero rows**:

1. No `anon` / `authenticated` / `PUBLIC` privilege on any `bn_life_certificate*` table
   (including `bn_life_certificate_policy`, `_event`,
   `_communication_intent`, `_scheduler_attempt`, `_case_evidence_link`).
2. No browser-role EXECUTE on any `_bn_lc_*` private helper.
3. No browser-role EXECUTE on the due-feed or failure-recording RPCs.
4. The retired due-feed name does not exist.
5. `bn_life_certificate_mark_milestone_v1` has no `p_as_of` parameter.

All browser reads go through `bn_life_certificate_worklist_v1`,
`bn_life_certificate_detail_v1` and `bn_life_certificate_timeline_v1`.

## A4. Record-level access and masking

`_bn_lc_can_access(actor, obligation)` grants access when the actor is an admin,
holds `bn_life_certificate.view_all_records`, is the claim's `assigned_to`
officer, is the assignee on an active `bn_claim_queue_assignment`, or is a member
of that assignment's workbasket via `bn_workbaskets_for_user`. It is enforced in
the worklist (row filter), detail, timeline, receipt, reinstatement proposal,
milestone command (user-invoked) and case-evidence query. Denials return
`E_RECORD_FORBIDDEN`.

SSN is masked to the last four digits unless the caller holds
`bn_life_certificate.view_sensitive_identity`; responses carry
`identity_masked`. Search requires at least 4 characters, escapes `%`, `_` and
`\`, is capped at 200 rows, and for masked callers only matches an SSN on exact
equality — wildcard SSN enumeration is not possible.

## A5. Policy eligibility enforced

Applied at generation: applicable benefit codes, award types, award statuses,
award start/end vs. the obligation period, policy effective dates, and
`min_claimant_age` (from `bn_claim_person_snapshot.date_of_birth`).
When age data is missing the award is counted in `review_required`, not treated
as eligible. `payment_jurisdictions` is configured-but-unavailable in the current
data model, so any policy that configures it yields an explicit
`REVIEW_JURISDICTION_UNKNOWN` exclusion rather than a silent pass.
The result payload reports `eligible`, `created`, `skipped_existing`,
`excluded_age` and `review_required`.

## A6. Calendar and reminder rules

`_bn_lc_today(tz)` is the date authority, using the policy timezone.
`_bn_lc_business_day(date, enabled)` shifts issue, due, grace, escalation and
reminder dates off weekends and off active `core_calendar_holidays` rows that
affect workflow deadlines, when `business_days_only` is set. Nothing is
hard-coded in React.

Reminders come from the snapshotted `reminder_offset_days`: offsets
`[-14, -3]` produce `REMINDER_1` (due − 14) and `REMINDER_2` (due − 3), each with
its own milestone date, idempotency identity
(`lc:<obligation>:<milestone>:<milestone_date>`), event
(`BN_LIFE_CERT_REMINDER_<n>`) and completion evidence. `reminder_count` is set to
the reminder index, so a reminder cannot repeat daily.

## A7. Milestone date enforcement

`bn_life_certificate_mark_milestone_v1(p_life_certificate_id, p_milestone,
p_idempotency_key, p_correlation_id)` no longer accepts an as-of date. It
recomputes the server date in the policy timezone and validates:
`DUE` (status `NOT_DUE` and due date reached), `REMINDER_<n>` (that reminder's
snapshotted date reached and `reminder_count < n`), `GRACE` (past due, within
grace, not already in grace), `OVERDUE` (past grace end). Early transitions raise
`E_MILESTONE_NOT_DUE`; terminal/received/verified/waived/deferred states return
`NO_OP`; repeats replay the stored receipt.

## A8. Award Suspension authority model

**Option A — dual permission** is the approved model, unchanged and now
documented. Life Certificate escalation and reinstatement require the Life
Certificate action (`propose_suspension` / `propose_reinstatement`) *and* the
Award Suspension boundary's own proposal authorization, which is enforced inside
`bn_award_suspension_propose_v1` / `bn_award_reinstatement_propose_v1`. Life
Certificates can only ever create proposals; approval and execution stay in Award
Suspension. Dark-launch dependency: if Life Certificate actions are enabled but
Award Suspension actions are disabled, the escalation command fails closed inside
the Award Suspension boundary and the obligation stays `OVERDUE`; if Award
Suspension is enabled but Life Certificates is disabled, no Life Certificate
command runs at all (`E_FEATURE_DISABLED`).

## A9. Evidence, DMS integrity and case linkage

The document boundary (`bn_claim_document`) exposes no content checksum, so no
checksum is manufactured from path or size any more: `evidence_checksum` is left
null and `evidence_integrity_status = 'UNAVAILABLE'` is recorded and surfaced in
the UI. Receipt validates the document belongs to the award's claim, is not
superseded, is of an accepted evidence type and has not been used by another
obligation.

`bn_life_certificate_case_evidence_link` records the obligation, document id,
evidence version, integrity status, verification decision, verifier and
correlation id against the reinstatement case, and is read through
`bn_life_certificate_case_evidence_v1` (permission + record-scope checked). The
document itself is never duplicated and no storage path is exposed.

## A10. Batch limit

200 everywhere: database (`LEAST(..., 200)` inside the generation RPC, so a
direct RPC caller cannot exceed it), `LIFE_CERTIFICATE_MAX_BATCH = 200` in the
client command service, `MAX_BATCH = 200` in the runner plan module, and the
tests assert the three agree.

## A11. Verification status

- Migration: applied to Test. Verifier `supabase/verify/bn_life_certificate_effective_grants.sql`
  returns zero rows on all five checks.
- Due-feed contract: verified from the catalogue (`pg_get_function_result`).
- Unit / contract tests: `src/__tests__/bn/servicing/lifeCertificateSlice.test.ts`
  — 36 passing, including executable due-feed → mark-milestone contract tests
  that import the runner's real planning module.
- Benefits suite: 1732 passing, 2 pre-existing Mortality failures unrelated to
  this slice.
- Typecheck: clean.
- Dark launch: unchanged — `actions_enabled = false`.

## A12. Remaining blockers (not closed in this pass)

1. **Communication façade adapter (requirement 13).**
   `bn_life_certificate_communication_intent` is still a module-local outbox with
   no consumer transferring rows into the shared Omnichannel/Communication
   request boundary. Reminder delivery is therefore **not** integrated end to end
   and no controlled test reminder has been delivered.
2. **Full database integration test harness (requirement 14).** The executable
   tests cover the scheduler contract, planning, batch caps and boundary rules;
   seeded end-to-end DB tests (generation → receipt → verification → suspension →
   reinstatement against a live schema) are not yet automated.
3. **Issuing-authority reference data (requirement 12).** Verification validates
   against the snapshotted `accepted_issuing_authorities` list, but authorities
   are still free text rather than a reference-data selector storing an id.
4. **Payment jurisdiction data.** No jurisdiction attribute exists on the award or
   claim, so jurisdiction-scoped policies can only produce review exclusions.

---

## Final source-security and lifecycle closure

### 1. Permission surface completed
All 18 Life Certificate actions plus `view` are now seeded in `module_actions`
for module `bn_life_certificate` (generate, send_reminder, receive, verify,
reject, request_resubmission, waive, defer, escalate, propose_suspension,
propose_reinstatement, clear_scheduler_attempts, view, view_all_records,
view_evidence, view_confidential_evidence, view_sensitive_identity, audit,
admin). Previously several commands checked a permission that did not exist,
which made them either unreachable or admin-only by accident.

`clear_milestone_attempts` no longer reuses an unrelated permission: it requires
the dedicated `clear_scheduler_attempts` action.

### 2. Record-scope enforcement
Every mutation command (`verify`, `reject`, `request_resubmission`, `waive`,
`defer`, `escalate_to_suspension`, `propose_reinstatement`, `receive`,
`mark_milestone`, `clear_milestone_attempts`) now calls
`_bn_lc_require_record(actor, life_certificate_id)` **after** the module
permission check. Holding a module permission is no longer sufficient to act on
an obligation the officer is not assigned to, unless they hold
`view_all_records`.

### 3. Honest evidence versioning
`evidence_version` is deprecated. Evidence now carries:

- `evidence_receipt_revision` (integer) — incremented once per accepted receipt.
- `evidence_document_snapshot` (jsonb) — file name, document type, mime type and
  size captured from `bn_claim_document` at receipt time.

`bn_life_certificate_detail_v1` exposes the revision and a safe document
summary; the reinstatement proposal links the exact revision and snapshot that
justified it, through `bn_life_certificate_case_evidence_link`.

### 4. Corrected milestone lifecycle

```text
NOT_DUE ──REMINDER_n──▶ REMINDER_SENT ──DUE──▶ DUE ──grace elapsed──▶ OVERDUE
   │                          │                  │                       │
   └──────────DUE─────────────┘                  │                       │
                                         evidence received               │
                                                 ▼                       ▼
                                     PENDING_VERIFICATION      SUSPENSION_PROPOSED
                                                 │                (proposal only)
                                          verified ▼
                                             SATISFIED
```

- `DUE` is reachable from both `NOT_DUE` and `REMINDER_SENT`; reminder history
  is preserved across the transition.
- Reminders are ignored once evidence exists, and late reminders never
  re-open a satisfied obligation.
- The scheduler feed and the command each validate the due date independently.

### 5. Date authority
`bn-life-certificate-runner` no longer accepts `asOf` from the request body.
The business date is computed server-side, so no caller can back-date or
forward-date a milestone scan.

### 6. Shared communication adapter
Benefits modules never send. They append to their own outbox; the shared
adapter is the only bridge to the sending spine:

```text
module outbox intent
   → bn_communication_adapter_pending_v1   (service-role feed)
   → bn_communication_adapter_dispatch_v1  (creates ONE communication_request)
   → communication hub (template, branding, sender, approval, dispatch)
   → bn_communication_adapter_sync_v1      (status back onto the intent)
```

- `bn_communication_dispatch` is the reusable ledger keyed by
  `(source_module, source_intent_id)` and by a deterministic `dispatch_key`, so
  a retry can never produce a second request.
- Recipients come from approved claim contact data; if none exists the intent
  fails with `E_NO_APPROVED_CONTACT` and the obligation is untouched.
- Communication failures only advance the intent's attempt count and delivery
  status. They never alter obligation state.
- `bn-communication-adapter` edge function drains the outbox on a schedule
  behind `BN_COMMUNICATION_ADAPTER_SECRET`.

### 7. Privilege verification
`supabase/verify/bn_life_certificate_effective_grants.sql` now uses
`has_table_privilege` and `has_function_privilege` and **raises an exception**
when `anon` or `authenticated` can reach any Life Certificate table, the BN
dispatch ledger, a private helper, or a scheduler/adapter command. It also
fails when a mutation command is missing the record-scope guard. Current run:
all checks pass.

### 8. Classified blockers before live use
| # | Blocker | Class | Owner |
|---|---------|-------|-------|
| 1 | `actions_enabled = false` — the module is dark-launched | Governance | Benefits business owner |
| 2 | Document store exposes no content hash, so integrity is snapshot-based only | Data | Documents platform |
| 3 | Communication templates for LC event codes not yet approved in the hub | Configuration | Communication Hub admin |
| 4 | Scheduler secrets not yet provisioned in the Live environment | Operations | Platform operations |
| 5 | Officer record assignments not yet loaded for production caseloads | Data | Benefits operations |

Life Certificates remain **dark-launched**: no action is reachable in the UI
until the module actions are enabled.
