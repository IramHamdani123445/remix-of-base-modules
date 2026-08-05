# BN Medical Reviews — Controlled Vertical Slice (Phase 1 backend)

**Status:** Backend command and secured-query boundary complete. **Dark-launched**
(`app_modules.bn_medical_review.actions_enabled = false`). No React service layer or UI
in this turn. Legacy `bn_medical_review_schedule` remains untouched and read-only.

---

## 1. Applied database migrations (this turn)

| Order | Migration | Content |
| --- | --- | --- |
| 1 | `..._medical_review_foundation_hardening` | Authority separation, policy validation, complete routing snapshot, snapshot-driven Board resolver, per-session participation, scoped Board access, provider corrections, active-record uniqueness, communication/audit allowlists |
| 2 | `..._medical_review_commands_part1` | Command framework (idempotency, row-version, transition matrices) + policy, obligation, referral and appointment commands |
| 3 | `..._medical_review_commands_part2` | Assessment, Medical Board, administrative decision and award-proposal commands |
| 4 | `..._medical_review_reads` | Claimant-identity corrections + full secured read boundary |
| 5 | `..._medical_review_registry_permissions` | Module registry (dark launch), 30 granular permissions, shared adapter registration |

Previously applied (earlier turn, unchanged): governance schema foundation, provider registry,
Medical Board foundation, obligation/referral/appointment/assessment objects, evidence and
administrative-decision objects, Award Suspension proposal link, event/communication/scheduler/
idempotency objects, private guards.

---

## 2. Forward-only foundation corrections

### 2.1 Medical vs administrative authority
`bn_medical_review_policy` now carries, separately:

- `medical_determination_authority` — `ASSESSING_DOCTOR | INDEPENDENT_SPECIALIST |
  MEDICAL_BOARD_ADVISORY | MEDICAL_BOARD_BINDING | MEDICAL_PANEL`
- `administrative_decision_authority` — `BENEFITS_DECISION_OFFICER | BENEFITS_SUPERVISOR |
  ADJUDICATION_COMMITTEE | DIRECTOR`
- `maker_checker_required`, `maker_checker_chain`, `board_id`

A binding Board determination binds the **medical** conclusion only
(`prepare_decision` rejects departure with `E_BINDING_MEDICAL_DETERMINATION`). The formal benefit
decision is still recorded by an authorised administrative actor, and only that decision can
create an award proposal. Doctors and Board members have **no** command that mutates an award,
a payment or an arrears calculation.

### 2.2 Board-direct routing
`MEDICAL_BOARD_DIRECT` is treated as an **assessment model**. A Board is required when:
`assessment_model = MEDICAL_BOARD_DIRECT`, `board_mode = ALWAYS_REQUIRED`,
`board_mode = FINAL_MEDICAL_AUTHORITY`, or a snapshot trigger rule matches.

`_bn_mr_validate_policy()` rejects at publication: Board-direct with Board mode `NONE`;
specialty requirement without a provider-selection method; document-only with a mandatory
appointment; treating-doctor model when treating doctors are prohibited; a second-opinion
trigger with second opinions disabled; quorum below one; binding Board authority with no
configured Board; conditional Board mode with no active rules; Board medical authority with
Board mode `NONE`.

### 2.3 Policy snapshot (immutable routing)
`_bn_mr_policy_snapshot()` (v2) stores every policy field plus: active trigger rules with
order, conditions, required specialties, quorum, binding flag and completion offset; the
selected Board configuration (code, name, review mode, meeting mode, voting rule, minimum
quorum, binding flag, specialties); timezone and business-day rules; snapshot timestamp.
The resolver reads `evaluated_from = POLICY_SNAPSHOT` — amending live rules cannot re-route an
existing obligation.

### 2.4 Server-side fact construction
`_bn_mr_build_facts()` builds every trigger fact server-side: employment-injury classification,
review reason/type, medical outcome, incapacity nature, impairment percentage, conflicting
opinions, temporary-extension count, incapacity duration (product timezone), provider unable to
form an opinion, officer departure, high-risk/exceptional classification, authorised manual
referral, and the four distinct second-opinion states
(`RECOMMENDED`, `REQUESTED`, `RECEIVED`, `VALIDATED`). A recommendation is never treated as a
completed second opinion.

### 2.5 No hard-coded Board values
Quorum, completion period, board type and timezone all resolve from the snapshot and selected
Board. `_bn_mr_today(tz)` and `_bn_mr_add_days(from, days, business_only)` replace the
hard-coded `America/St_Kitts` helper.

### 2.6 Board access scoping
`_bn_mr_secretary_boards(actor)` limits secretaries to boards where they hold an active
`SECRETARY` assignment. Board members reach only cases they are assigned to. Recusal keeps the
case auditable but `_bn_mr_can_view_confidential()` denies newly released confidential evidence
and the vote command rejects recused members (`E_MEMBER_RECUSED`). Chair, secretary and member
permissions remain distinct keys.

### 2.7 Board session participation
New `bn_medical_board_session_participation` — unique `(session_id, member_id)` — carries
attendance, conflict, recusal and vote per session. Case-level assignment stays unique
`(board_case_id, member_id)`. Multiple sessions and adjournments are supported.

### 2.8 Provider approval uniqueness
`bn_mr_provider_approval_uq` on `(provider_id, bn_product_id, review_type)` with
`NULLS NOT DISTINCT` — duplicate wildcard approvals are impossible.

### 2.9 Provider conflict evaluation
`_bn_mr_conflict_check(provider, claim, award, person_ref, employer_ref)` evaluates JSON arrays
with the `?` containment operator across excluded claims, awards, persons, employers and
relationships, returns the matched rule, and the result is persisted on
`bn_medical_review_referral.conflict_check` and in the referral audit entry.

### 2.10 Provider snapshot
The referral snapshot records identity, internal/external classification, registration, licence
and licence validity, verification state, specialties, facility, contract status, fee
arrangement, effective dates, every active product/review-type approval, and the snapshot
timestamp. Historical validity no longer depends on later registry changes.

### 2.11 Individual practitioner vs facility
`bn_medical_provider.is_individual_practitioner`, `accountable_practitioner_id`,
`approved_panel_id` with a CHECK requiring one of them. `_bn_mr_accountable_practitioner()`
resolves the accountable clinical actor; `start_assessment` refuses a referral without one.

### 2.12 Provider-fee classifications
`provider_fee_responsibility` supports `SOCIAL_SECURITY | CLAIMANT | EMPLOYER |
GOVERNMENT_FACILITY | CONTRACT_RETAINER | PER_ASSESSMENT | PANEL_ALLOWANCE | NO_FEE | SHARED |
NOT_APPLICABLE`. No accounts-payable integration; claimant medical reimbursement tables are not
used.

### 2.13 Referential integrity added
Evidence link → Board case; suspension link → `bn_award_suspension_event`; referral → `bn_claim`
and `bn_award`; referral → parent referral and accountable practitioner; policy → Board;
provider → accountable practitioner.
Intentionally omitted: `claimant_person_id` (the claim model keys the claimant by SSN, not a
person UUID) — commands resolve the claimant reference from `bn_claim` on every write.

### 2.14 Active-record constraints
`bn_mr_active_referral_uq` (per obligation per concurrency group), `bn_mr_active_appointment_uq`,
`bn_mr_active_assessment_uq`, `bn_mr_active_decision_uq`, `bn_mr_open_board_case_uq`
(obligation + trigger), `bn_mr_proposal_uq` (decision + kind). Second opinions use
`referral_purpose = SECOND_OPINION` with `parent_referral_id` and their own concurrency group.

### 2.15 Communication privacy
`_bn_mr_safe_comm_context()` is a strict allowlist (review/referral/appointment references,
appointment date and time, safe location or facility label, operational deadline, safe status,
recipient category, correlation id, board reference/session date, notice type). Everything else
— including diagnosis, narrative, outcome, limitations, impairment, prognosis, evidence content,
deliberation and confidential reasons — is discarded. Delivery status is constrained to the
adapter's canonical 8-state set.

### 2.16 Audit correctness
`_bn_mr_audit(..., p_origin)` accepts `USER_RPC | PROVIDER_PORTAL | BOARD_WORKSPACE | SCHEDULER |
COMMUNICATION_ADAPTER | SYSTEM_REPAIR`; `is_system_generated` is true only for the last three.
Event detail passes through `_bn_mr_safe_detail()` (allowlist), so no clinical narrative can be
recorded accidentally.

---

## 3. Command pipeline

Every mutation performs, in order: authenticate (`_bn_mr_actor`) → dark-launch gate
(`_bn_mr_assert_enabled`) → granular permission (`_bn_mr_require`) → load and lock canonical row
`FOR UPDATE` → record-level access (`_bn_mr_assert_access`) → source-state and policy-snapshot
validation → row-version check (`_bn_mr_check_version` → `E_VERSION_CONFLICT`) → actor-category /
provider / Board assignment validation → maker-checker → idempotency
(`_bn_mr_cmd_begin` / `_bn_mr_cmd_finish`, SHA-256 fingerprint) → transition → row-version
increment → safe event → safe audit → operational communication intent → controlled JSON result.
Errors are stable `E_*` codes; raw SQL errors and clinical content are never returned.

### Commands delivered

**Policy / obligation:** `publish_policy`, `supersede_policy`, `preview_obligation`,
`generate_obligation`, `defer_review`, `close_review`.

**Provider / referral:** `assign_provider`, `nominate_treating_doctor`,
`verify_nominated_provider`, `issue_referral`, `accept_referral`, `decline_referral`,
`reassign_provider`, `expire_referral`, `request_second_opinion`.

**Appointment:** `schedule_appointment`, `reschedule_appointment`, `record_attendance`,
`record_non_attendance`, `record_provider_cancellation`, `record_reasonable_cause`.

**Assessment:** `start_assessment`, `save_assessment_draft`, `submit_assessment`,
`record_staff_receipt`, `validate_report`, `reject_report`, `request_clarification`,
`submit_clarification`, `lock_assessment`.

**Medical Board:** `refer_to_board`, `select_board`, `assign_board_members`,
`schedule_board_session`, `declare_board_conflict`, `record_recusal`,
`record_board_participation`, `request_board_evidence`, `record_board_vote`,
`finalise_board_determination`, `defer_board_case`, `reconvene_board_case`.

**Administrative decision:** `prepare_decision`, `submit_decision`, `approve_decision`,
`return_decision`, `complete_decision`.

**Award proposals:** `propose_suspension`, `propose_reinstatement` — proposal rows only
(`proposal_status = PROPOSED`, `executor = bn_award_suspension`).

All are `bn_medical_review_<command>_v1(...) RETURNS jsonb`.

---

## 4. Transition matrices

`_bn_mr_transition_allowed(entity, from, to)` and `_bn_mr_terminal(entity, status)` cover
`OBLIGATION`, `REFERRAL`, `APPOINTMENT`, `ASSESSMENT`, `BOARD_CASE`, `BOARD_SESSION`,
`DECISION`, `PROPOSAL`, `COMMUNICATION`. Illegal transitions raise
`E_INVALID_STATE_TRANSITION:<entity>:<from>-><to>`; terminal records raise
`E_STATE_TERMINAL:<entity>:<status>` and cannot be reopened without a separately authorised
correction command (not delivered in this phase).

Terminal states: obligation `COMPLETED`/`CLOSED`; referral `COMPLETED`/`CANCELLED`; appointment
`ATTENDED`/`CANCELLED`/`NOT_REQUIRED`; assessment `LOCKED`; board case `DETERMINED`/`CANCELLED`;
session `HELD`/`CANCELLED`; decision `COMPLETED`; proposal `EXECUTED`/`REJECTED`/`WITHDRAWN`;
communication `DELIVERED`/`FAILED`/`CANCELLED`.

---

## 5. Secured reads

`worklist`, `award_context`, `detail`, `referral_detail`, `appointment_history`,
`assessment_summary`, `confidential_evidence`, `provider_worklist`,
`provider_referral_detail`, `board_worklist`, `board_case_detail`, `board_session`,
`board_determination`, `decision_detail`, `communication_history`, `proposal_links`,
`audit_timeline`, `policy_config`, `provider_search`, `board_search` — all `_v1`, all `jsonb`.

Guarantees: award access checked before any award context; an unknown or forbidden award raises
`E_RECORD_FORBIDDEN` instead of falling back to the general list; providers see only their own
assigned referrals; Board queries are assignment or secretary scoped; confidential evidence
requires `view_confidential_medical_evidence`, is denied to recused members and writes to
`bn_medical_review_evidence_access_log`; Benefits users get safe summaries unless they hold
`view_medical_summary`; every list is paginated and capped (100, audit 200); search terms need
three characters and escape `% _ \`; SSNs are masked to `****NNNN`; no clinical narrative appears
in any worklist or timeline; no direct browser table reads exist (all `bn_medical*` tables have
zero `anon`/`authenticated` grants).

---

## 6. Permission matrix

30 keys under `bn.medical_review.*` in `core_permission_registry`, with `risk_level` and
`is_sensitive_permission` set: view, view_all_records, view_sensitive_identity,
view_medical_summary, view_confidential_medical_evidence, configure_policy, publish_policy,
manage_providers, verify_credentials, generate_obligations, defer_review, close_review,
assign_provider, issue_referral, manage_appointment, submit_assessment, validate_report,
request_second_opinion, refer_to_board, manage_board_case, manage_board_session,
declare_conflict, record_board_participation, record_board_determination, prepare_decision,
approve_decision, propose_suspension, propose_reinstatement, view_audit, administer_module.

CRITICAL: publish_policy, record_board_determination, approve_decision, propose_suspension,
propose_reinstatement, administer_module, view_confidential_medical_evidence.
No key is granted to any role automatically. No real doctors, Board members or product rules
were seeded.

---

## 7. Shared communication adapter

Registered in `bn_communication_adapter_source` as
`BN_MEDICAL_REVIEW → bn_medical_review_communication_intent`, `is_enabled = false` while the
module is dark-launched. Dispatch, retry, terminal-state monotonicity and idempotency are reused
from the hardened shared Benefits adapter — no duplicated logic. Intents are service-only
(no browser grants), recipient categories cover claimant, provider and Board, provider and Board
messages carry no clinical content, and a communication failure never changes Medical Review
business state.

---

## 8. Test evidence

Harness: `supabase/tests/bn/medical_review_integration.sql` — a single transaction that seeds
its own policy, trigger rules, Board and providers and ends in `ROLLBACK`.

Covers: Board-direct routing, Board mode none, always-required Board, conditional trigger,
second-opinion-received trigger, conflicting-opinion trigger, manual-referral trigger, policy
snapshot stability after a live rule amendment, product timezone usage, configured quorum,
wildcard provider-approval uniqueness, provider conflict detection, accountable-practitioner
enforcement, active-record uniqueness, terminal-state and transition protection, communication
allowlist and clinical-data exclusion, masking, search hardening, page caps, dark-launch state,
legacy table preservation, adapter registration, and a static proof that no Medical Review
function mutates an award or suspension event.

**Executed in this environment (catalog verification via psql):**

| Check | Result |
| --- | --- |
| Private `_bn_mr_*` helpers executable by `authenticated` | 0 |
| `bn_medical*` table grants to `anon`/`authenticated` | 0 |
| Active-record unique indexes present | 7 / 7 |
| Permissions registered | 30 |
| Adapter sources registered | 2 (Life Certificate + Medical Review) |
| `app_modules.bn_medical_review.actions_enabled` | `false` |

**CREATED — EXECUTION PENDING:** the RPC-executing portions of the harness. The sandbox psql role
cannot `EXECUTE` database functions, so scoped Board-secretary access, recused-member evidence
denial, maker-checker rejection, idempotent replay and stale row-version rejection must be run
from CI or a trusted database session. They are **not** claimed as passed.

---

## 9. Remaining scope

**Backend blockers:** none. A correction/reconsideration command for terminal records, and a
scheduler runner for notices and overdue transitions, are deliberately out of Phase 1.

**Deferred to the next turn (UI/service layer):**
`src/services/bn/medicalReviewCommandService.ts` and `medicalReviewQueryService.ts`,
the `/bn/medical-reviews` workspace (worklist, review detail, referral, appointment, assessment,
Board workspace, decision panel, proposal panel), provider portal screens, deep-link and
invalid-award handling, the authoritative dark-launch banner driven by
`app_modules.actions_enabled`, and React behaviour tests.

**Unresolved Social Security policy decisions:** default provider-fee responsibility per product;
whether Medical Board determinations are binding for employment-injury products; standard
deferral limit and notice period per product; whether treating doctors may act as assessors for
periodic reviews; retention period for confidential clinical evidence.
