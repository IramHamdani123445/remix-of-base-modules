# Internal Audit — Wave 4 Closure: DEF-1 Escalation Identity

Status: **CLOSED**
Scope: governed office-holder identity for escalation routing, explicit unresolved-role evidence, operator visibility.
No communication channels were activated. Stage 1B not started.

## 1. Defect being closed

`head_of_audit` and `department_head` escalation recipients were previously derived by fuzzy
name matching against `ia_auditors` / free-text department head fields. When a recipient could
not be derived, the escalation was **silently emitted without that recipient**, leaving no evidence.

## 2. Architecture delivered

| Component | Purpose |
| --- | --- |
| `public.ia_office_holder` | Governed register of explicit designations (`HEAD_OF_INTERNAL_AUDIT`, `DEPARTMENT_HEAD`) with scope, effective dating, primary flag, maker-checker columns, immutable audit trail. |
| `ia_office_holder_propose` / `_approve` / `_revoke` | Maker-checker commands; self-approval blocked; every transition written to `ia_audit_event`. |
| `ia_resolve_escalation_recipient(role, dept, engagement, action, as_of)` | Single canonical point-in-time resolver returning `RESOLVED` / `UNRESOLVED` / `CONFLICT` / `INACTIVE` / `INVALID` with a machine-readable `reason` and `source`. Never guesses office holders. |
| `ia_office_holder_valid_at(status, from, to, as_of)` | Point-in-time validity predicate; `active` and `superseded` rows remain valid **inside their own effective window**, so a same-day handover has no gap. `revoked` never resolves. |
| `ia_office_holder_health(as_of)` | Configuration-gap read model: HIA state, departments without a resolvable head, inactive/invalid holders. |
| `ia_comms_generate_reminders(as_of, limit)` | Per-role obligation derivation: one evidence row and one communication per required role, keyed by occurrence + role. |
| `ia_comms_reminder_run_log` | Run evidence: `run_id`, `policy_id`, `required_role`, `resolution_source`, `outcome`, `reason`. |
| `/audit/escalation-roles` (`EscalationRoles.tsx`, `useEscalationRoles.ts`) | Operator surface: designation register with propose/approve/revoke, configuration gaps, unresolved-escalation evidence. Menu: Internal Audit → Configuration → Escalation Roles. |

## 3. Certification matrix

All evidence rows are persisted in `public.ia_escalation_cert_log` and `public.ia_comms_reminder_run_log`.

| ID | Scenario | Expected | Result |
| --- | --- | --- | --- |
| T-SEC | Unauthenticated / ordinary auditor designates an office holder | denied `42501` | PASS |
| T-GOV | Proposer approves own designation | blocked (maker-checker) | PASS |
| R1 | Baseline resolution of HIA, Lead Auditor, Action Owner | `RESOLVED` from governed sources | PASS |
| T60-1 | 60-day escalation with **no** HIA designated | Owner + Lead emitted; HIA logged `escalation_role_unresolved / NO_ACTIVE_OFFICE_HOLDER_DESIGNATION`; Dept Head logged `DEPARTMENT_HEAD_NOT_PROFILE_LINKED`; run outcome `PARTIALLY_EMITTED_WITH_UNRESOLVED_ROLES` | PASS (emitted 2, unresolved 2, errors 0) |
| T60-2 | Same occurrence re-run after HIA designated | HIA emitted once; Owner + Lead deduplicated; Dept Head still unresolved | PASS (emitted 1, dedup 2, unresolved 1) |
| T30-1 | 30-day escalation with no department head | Owner + Lead emitted; Dept Head unresolved evidence | PASS (emitted 2, unresolved 1) |
| T30-2 | Same occurrence re-run after department head designated | Dept Head emitted once; others deduplicated; run outcome `COMPLETED` | PASS (emitted 1, dedup 2, unresolved 0) |
| C1 | Two active primary HIA designations | resolver `CONFLICT / MULTIPLE_ACTIVE_PRIMARY_DESIGNATIONS`; scheduler records the conflict and does not guess | PASS |
| C1c | Conflict cleared | resolution restored | PASS |
| C2 | Designated profile deactivated | `INACTIVE / PROFILE_INACTIVE` — not silently substituted | PASS |
| C3 | Designated profile without an email address | `RESOLVED` + `EMAIL_UNAVAILABLE`, `email_available=false` | PASS |
| C4/C6 | HIA replacement A→B with future effective date | outgoing holder resolves on the handover day, successor from the next day | PASS |
| C5/C6 | Department head replacement A→B | same effective-dated behaviour, scoped per department | PASS |
| C6e | Resolution before any designation existed | `UNRESOLVED / NO_ACTIVE_OFFICE_HOLDER_DESIGNATION` | PASS |

Handover-gap defect found and fixed during certification: the resolver originally accepted
`status = 'active'` only, so the outgoing holder disappeared on their final day in office.
Replaced with `ia_office_holder_valid_at`, then re-certified (C6a–C6d).

## 4. Failure isolation

Each required role is derived and emitted independently. A failure or unresolved role for one
action/role does not abort the daily run; the run completes and reports
`PARTIALLY_EMITTED_WITH_UNRESOLVED_ROLES` with per-role evidence.

## 5. Recovery semantics

Idempotency is keyed on occurrence + required role. Designating a missing office holder later
and re-running the same occurrence emits **only** the previously missing role; already-notified
recipients return `deduplicated`.

## 6. Not in scope / not done

- No communication channel was activated or released.
- No production office holders were designated; only certification fixtures (`W4-CERT-*`).
  Real office holders must be designated by the organisation through
  Internal Audit → Configuration → Escalation Roles.
- Stage 1B (20+ audit business E2E) not started.
