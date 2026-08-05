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

## 9. Frontend integration layer and actor surfaces (this turn)

### 9.1 Service boundary

| File | Responsibility |
| --- | --- |
| `src/services/bn/medicalReviewQueryService.ts` | Secured reads. Every call goes through a `bn_medical_review_*_v1` query RPC; the `jsonb` envelope (`status`, `total`, `limit`, `offset`, `rows`) is normalised into typed rows. No `supabase.from()` against any `bn_medical_review*` table. |
| `src/services/bn/medicalReviewCommandService.ts` | Command boundary. 49 typed wrappers, each supplying `p_idempotency_key` (UUID, generated per attempt) and, where the RPC declares it, `p_expected_row_version`. Returns `{ status, replayed, noOp }` so callers distinguish `OK` / `REPLAYED` / `NO_OP`. |
| `src/features/bn/medical-reviews/model/errors.ts` | Maps stable `E_*` SQLSTATE codes to curated user-facing messages and UI states. Raw database text is never surfaced; unmatched throwables collapse to `E_UNKNOWN`. Longest-code-first matching prevents a short code shadowing a terminal one. |
| `src/features/bn/medical-reviews/model/permissions.ts` | Mirrors the 30 registered `bn.medical_review.*` actions and separates mutating from read-only sets. |
| `src/hooks/bn/useMedicalReviewActionsState.ts` | Reads `app_modules.actions_enabled` for `bn_medical_review`. Fails closed on loading/error/missing row. |

### 9.2 Authoritative dark launch

`MedicalReviewActionButton` is the only way a Medical Review screen renders a mutating control.
It composes two independent conditions — the caller's module action permission **and**
`app_modules.actions_enabled` — and renders disabled with an explanatory tooltip when either
fails. There is no hard-coded constant, build flag, or env var anywhere in the UI; flipping
`actions_enabled` in the database is the single switch. `MedicalReviewDarkLaunchBanner` states
the same fact to the operator.

`bn.servicing.medicalReview` is a **visibility** toggle only. It is now enabled so the workspace
is discoverable and readable, exactly as Life Certificates. It does not, and cannot, enable a
mutation.

### 9.3 Three separated actor surfaces

| Surface | Route | Data source | Authority |
| --- | --- | --- | --- |
| Benefits Medical Review Centre | `/bn/medical-reviews` | `worklist`, `awardContext`, obligation detail | Internal staff: obligations, referrals, assessments, administrative decision preparation and approval. |
| Medical Board Workspace | `/bn/medical-reviews/board` | `boardWorklist`, `boardCaseDetail` | Board members and secretaries: sessions, participation, conflicts, **medical determinations only**. No administrative approval, no award/payment/suspension mutation. |
| Restricted Medical Provider Portal | `/doctor/reviews` | `providerWorklist`, `providerReferralDetail` | External clinicians: only referrals issued to them. No award context, no Board deliberations, no other claimants. |

Scoping is enforced server-side by `_bn_mr_actor()` and the record guards; the screens simply
render what the RPCs return. Confidential clinical content is withheld behind
`bn.medical_review.view_confidential_medical_evidence` and replaced by an explicit notice.

The legacy scheduler is preserved unchanged at `/bn/medical-reviews/legacy-scheduler`, and
`bn_medical_review_schedule` is still untouched.

### 9.4 Award 360 deep link

`AwardMedicalReviewsTab` links to `/bn/medical-reviews?awardId=<uuid>`. A valid id scopes the
worklist and renders an award-context card with a return link to Award 360 and a "Clear filter"
control that removes **only** `awardId` from the query string. A malformed `awardId` is never
downgraded to the general worklist: no RPC runs at all and an explicit "Invalid award link" state
is rendered.

### 9.5 Frontend test evidence

| Suite | Coverage |
| --- | --- |
| `src/__tests__/bn/servicing/medicalReviewRouteRender.test.tsx` | 12 rendered-route behaviour tests: workspace renders, disabled flag renders `bn-workspace-unavailable`, permission denial stays on-route, `actions_enabled=false` disables controls and shows the banner, `actions_enabled=true` enables a permitted action, an unpermitted action stays disabled, deep-link pass-through, filter clearing preserves other params, malformed award makes zero RPC calls, and each actor surface loads only its own data source. |
| `src/__tests__/bn/medical_reviews_service_architecture.test.ts` | 18 service-architecture assertions: no direct browser table access or mutation anywhere in the Medical Review tree, all reads/commands are versioned RPCs, idempotency keys on every mutating command, `expected_row_version` propagation, replay/no-op distinction, Award Suspension remains proposal-only, error model never echoes database text, and actor-surface separation. |
| `src/__tests__/bn/medical_reviews_backend.test.ts` | 13 backend source assertions (unchanged). |

## 10. Operational frontend (this turn)

Section 9 delivered navigation and the service boundary. This section records the conversion of
those read-oriented surfaces into complete operational workflows. The module remains
dark-launched: `app_modules.bn_medical_review.actions_enabled` is still `false` in the database,
and every workflow below was built and tested against a mocked `actions_enabled = true`.

### 10.1 Confidential-evidence access

Confidential clinical evidence is no longer prefetched because a user holds the permission.
`src/components/bn/medical-reviews/ConfidentialEvidenceSection.tsx` renders a collapsed section
carrying the notice *"Access to confidential medical evidence is audited."* and issues the secured
RPC only after the operator selects **View confidential medical evidence**. It has a dedicated
loading state and reports permission-denied, recused-member, not-released and load-failure as four
distinct states. Content is cleared when the section closes, when the selected review changes, on
route change and on unmount, and is never written to the URL, local or session storage, a shared
query cache, analytics, the console, detail exports or print views.

### 10.2 Award deep-link ordering

`MedicalReviewCentre` validates the `awardId` UUID locally; an invalid value issues no RPC and
renders *Invalid award link*. A valid value loads the secured award-context RPC **first**. A
refusal (`E_FORBIDDEN`, `E_RECORD_FORBIDDEN`, `E_MEMBER_RECUSED`) renders a permission state, a
missing record renders a record-unavailable state, and in neither case is the worklist RPC called
— there is no fallback to the general worklist and award-context errors are never converted to
`null`. Clearing the award filter preserves every unrelated query parameter.

### 10.3 Section states and worklist behaviour

`useMedicalReviewSection` + `SectionStateView` give each secondary section six independent states
(loading, loaded, empty, permission denied, failed, not applicable). A failed assessment, decision,
Board or audit query is now rendered as a section-specific error with a retry control, never as
"none recorded", and never destroys the main detail. Search below the backend minimum issues no
RPC and shows *Enter at least 3 characters to search.*; clearing search resets the offset. Summary
figures are explicitly labelled **Current page** with a note that they are not total workload.

### 10.4 Idempotency lifecycle

`useMedicalReviewSubmission` mints one key when a submission starts and retains it across
rerenders, transport timeouts, lost responses and user-initiated retries of the same payload. A new
key is minted only after a success, a confirmed terminal outcome, an intentional payload change, or
a cancel-and-restart. The controller exposes pending, double-submit prevention, success, replay,
no-op, controlled error, version conflict and same-key retry.

### 10.5 Version-conflict flow

On `E_VERSION_CONFLICT` the dialog preserves entered form data and the attempted key, reloads the
canonical record, displays the previous and current row versions, explains that another user
changed the record, and disables resubmission until the operator confirms the refreshed state. The
refreshed row version is then used — the command is never silently replayed.

### 10.6 Workflows delivered

| Surface | Workflows |
| --- | --- |
| Benefits Medical Review Centre | Assign approved provider, nominate treating doctor, verify nominated provider, issue referral, reassign provider, expire referral, request second opinion; schedule/reschedule appointment, record attendance, claimant non-attendance, provider cancellation, reasonable-cause outcome; validate report, reject incomplete report, request clarification, request addendum, lock accepted assessment; evaluate Board requirement, refer to Board, select Board; prepare / submit / return / approve / complete decision; Create Suspension Proposal and Create Reinstatement Proposal. |
| Medical Provider Portal | Accept referral, decline referral, schedule/reschedule provider-owned appointment, record provider cancellation, start assessment, save structured draft, submit assessment, submit clarification/addendum. |
| Medical Board Workspace | Select Board, assign members, schedule session, declare conflict, record recusal, record attendance and participation, request additional evidence, record vote, finalise determination, defer case, reconvene case. |

Provider selection is only ever made through the secured provider-search RPC (`ProviderPicker`);
arbitrary provider UUID entry is impossible. Provider-side capability is derived by
`useMedicalReviewProviderCapabilities` from the server-returned provider linkage, referral
assignment and status, appointment responsibility, assessment status and the authoritative module
flag — there is no hard-coded provider permission and a browser-supplied provider id is never
trusted. Award controls are labelled *Create Suspension Proposal* / *Create Reinstatement
Proposal* only, with the boundary statement that Award Suspension remains responsible for approval,
execution, payment holds and arrears. No Board control can approve an administrative decision or
touch award or payment state.

### 10.7 State-driven action availability

`src/features/bn/medical-reviews/model/actionAvailability.ts` centralises availability for
obligation, referral, appointment, assessment, Board case, Board session, administrative decision
and award proposal. Each result carries visible, enabled, permission required, required source
state, required row version, reason required, blocked reason and applicable actor surface.
Availability is never decided from permission and `actions_enabled` alone — the record lifecycle
state is always considered. The backend remains authoritative.

### 10.8 Refresh behaviour

After a successful command only the affected sections reload; the selected record stays open, the
returned row version is adopted, the form and its idempotency key are cleared, and replay/no-op
outcomes are surfaced verbatim. No command reloads the application.

### 10.9 Test results (actual)

| Suite | Result |
| --- | --- |
| `src/__tests__/bn/servicing/medicalReviewInteractions.test.tsx` (new) | **38 passed** — confidential-evidence privacy (8), award deep-link ordering (3), search and counters (4), section failure states (4), idempotency and concurrency (6), version-conflict dialog (1), award-proposal wording and gating (2), maker-checker (3), Board workspace separation (3), provider portal capability (4). |
| `src/__tests__/bn/servicing/medicalReviewRouteRender.test.tsx` | 13 passed (was 12; obligation generation is now additionally award-scoped, so the dark-launch case was split into scoped and unscoped assertions). |
| `src/__tests__/bn/medical_reviews_service_architecture.test.ts` | 18 passed (the shared-button assertion now accepts the hook value passed down as a prop and forbids a hard-coded `true`). |
| `src/__tests__/bn/medical_reviews_backend.test.ts` | 13 passed. |
| Benefits suite `src/__tests__/bn/` | **1835 passed**, 1 skipped, 14 todo, 3 failed — all three unrelated to Medical Reviews (section 10.10). |
| Typecheck (`tsgo --noEmit -p tsconfig.app.json`) | Clean, no diagnostics. |

### 10.10 Unrelated failures, recorded separately

Not modified by this change set.

| File | Test | Message | Reproduces without the Medical Review frontend changes |
| --- | --- | --- | --- |
| `src/__tests__/bn/gap-modules/mortality/mortalityLifecycleFoundation.test.ts` | `BN Mortality — command catalogue > registers all 15 canonical commands` | Stale command-catalogue expectation. | Yes — pre-existing. |
| `src/__tests__/bn/mortality/benefitsQueryBoundary.test.ts` | `no browser source calls .from("bn_mortality_*")` | Whole-repository source scan times out under full-suite load. | Yes — passes when the file is run on its own. |
| `src/__tests__/bn/awardSuspensionWorkspaceReadOnly.test.ts` | `awardSuspensionViewService.ts contains no Supabase write calls and only allow-listed RPCs` | Same whole-repository source-scan timeout under load. | Yes — passes when the file is run on its own. |

The complete Benefits suite is therefore **not** green, and is not claimed to be.

### 10.11 Seeded database harness

`supabase/tests/bn/medical_review_integration.sql` — **CREATED — EXECUTION PENDING.** No trusted
PostgreSQL/Supabase environment capable of authenticated RPC execution was available from this
environment, so `BN_MEDICAL_REVIEW_HARNESS_RESULT: PASS` has not been produced. The harness is not
claimed to have passed.

## 11. Remaining scope

**Dark-launch status:** unchanged. `actions_enabled = false`, the shared communication adapter
source stays disabled, no live scheduler, no live templates, no production providers, no production
Board membership, and award/payment execution remain unavailable.

**Remaining activation blockers:** execution of the seeded harness; production policy seeding;
production provider registry seeding; production Medical Board membership; live template
activation; the unresolved policy decisions listed below.

**Deliberately not started:** scheduler automation, provider invoicing, accounts-payable
integration, appeals, correction/reconsideration of terminal cases, live communications, and any
further Benefits slice.

**Unresolved Social Security policy decisions:** default provider-fee responsibility per product;
whether Medical Board determinations are binding for employment-injury products; standard
deferral limit and notice period per product; whether treating doctors may act as assessors for
periodic reviews; retention period for confidential clinical evidence.
