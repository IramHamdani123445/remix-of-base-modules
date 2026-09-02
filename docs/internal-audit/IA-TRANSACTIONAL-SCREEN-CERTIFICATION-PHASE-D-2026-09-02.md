# Internal Audit — Phase D Transactional Screen Certification (2026-09-02)

**Repository:** miplnoida/remix-of-base-modules
**Accepted Phase C baseline:** `132f8e06ab1d70a2295fa291c5af80602639f03a` — confirmed as current HEAD before testing began (no rebase drift).
**Scope:** pre-E2E transactional certification of business operations. Full end-to-end journeys are explicitly **not** started.

## 1. Method

Every case is a real business transaction, not a render check:

- Real persona sessions are minted for nine Internal Audit personas (Audit Admin, Head of Internal Audit, Audit Lead, two Auditors, Quality Reviewer, and three auditee management users) and used as the caller.
- Operations execute through the same backend path the UI uses (governed commands and table endpoints), so row-level security and capability checks apply exactly as they do in the product.
- After every write, the resulting record is re-read from the database and asserted — created values, preserved values on partial edit ("lossless edit"), derived values, status transitions, and dependent/downstream effects.
- A privileged channel is used only for fixture setup, post-state verification and cleanup — never to perform the operation under test.

Test contract applied per case: authorised path, unauthorised path, mandatory-field validation, reload fidelity, lossless edit, derived-value recomputation, status/lock behaviour, referential integrity, segregation of duties, historical-record preservation, and audit-trail proof.

## 2. Result summary

| Part | Area | Cases | Pass | Fail | Blocked |
|---|---|---|---|---|---|
| A | Audit Universe — Department Master, Auditable Functions | 19 | 19 | 0 | 0 |
| B | Risk — Risk Register, Risk Assessment, Risk Configuration | 20 | 20 | 0 | 0 |
| C | Annual Plan — header, portfolio, readiness, submission, approval, revision, audit trail | 28 | 28 | 0 | 0 |
| D | Engagement execution — launch, working papers, findings, management response, response review, report issuance, quality review, closure | 44 | 44 | 0 | 0 |
| **Total** | | **111** | **111** | **0** | **0** |

All 111 cases pass **after remediation**, in a single clean consecutive run. Nine defects were found on first execution; all nine are fixed and re-verified. See the defect register.

## 3. Certified business behaviour

**Audit Universe.** Departments and functions can only be created and maintained by authorised Internal Audit personas; auditee management is refused at the data layer. Mandatory fields are enforced at the database, not just the form. Deactivation is non-destructive: inactive entries disappear from selection lists but remain fully readable for history, and historical audits still resolve their department. Duplicate active departments are now prevented, and a function that already carries audit history can no longer be moved to another department.

**Risk.** Risk register entries carry correct derived scores and, for the first time, correct derived risk levels from the configured classification bands. Risk assessments now compute an overall score and level from the entered factor scores, and that score demonstrably propagates into engagement risk resolution used by planning. Changing risk configuration and re-running the recalculation command updates existing risks and writes a full recalculation history (old score/level, new score/level, reason, who triggered it). Manually overridden risks are skipped and logged rather than overwritten.

**Annual Plan.** The full lifecycle is now transactionally sound: create header (authorised users only, preparer taken from the session) → build the audit portfolio with full field fidelity → readiness evaluation → submit → return for changes with a mandatory reason → rework → resubmit → approve with committee name and minutes reference → revise an approved plan, with material revisions re-entering approval. Locking is correct in both directions, the preparer cannot decide their own plan, invalid transitions are refused with business-readable messages, version diff is produced against the approved baseline, and the approval action trail records every step with actor and comments.

**Engagement execution.** An audit can only be launched from an approved plan when its planning record is complete, and cannot be relaunched or replanned afterwards. Fieldwork is governed end to end: working papers edit losslessly and carry reviewer sign-off; findings follow a strict lifecycle (Draft → Under Review → Confirmed → Released → Responded → Closed) with segregation of duties — the author cannot confirm their own finding — and cannot be released without a recommendation or a resolvable department head. Management responses require a rationale on rejection or partial acceptance and an action plan on acceptance, only the responsible department may respond, and response review is fully versioned with revision, resubmission and reviewer independence enforced. Report issuance is gated on evidence, working papers, responses, draft-finding discussion and exit meeting, and an issued report version can no longer be altered. Closure is gated on report issuance and quality-review clearance, refuses invalid dispositions and repeat closure, and the execution log records launch and closure with actor and status transition.

## 4. Remediation applied during this phase

Nine defects fixed (one critical, four high, four medium) — full detail, business impact and verifying case IDs in `IA-TRANSACTIONAL-SCREEN-DEFECTS-PHASE-D-2026-09-02.md`. The most significant were:

- Annual plan submission was impossible platform-wide (approval workflow routing unregistered).
- Annual plan headers could be created by any signed-in business user.
- Risk assessment scoring was inert, and risk recalculation always failed.
- Finding and working paper reference numbers were generated in the browser from the clock, risking collisions and lost fieldwork; they are now issued as a guaranteed-unique yearly sequence by the system.

## 5. Evidence

- `IA-TRANSACTIONAL-SCREEN-MATRIX-PHASE-D-2026-09-02.md` — case-by-case matrix with persona, expected outcome, actual backend response and verified post-state.
- `IA-TRANSACTIONAL-SCREEN-DEFECTS-PHASE-D-2026-09-02.md` — defect register with severity, business impact, fix and verification.

## 6. Status and remaining scope

**Parts A–D are certified: Audit Universe, Risk, Annual Plan, and Engagement Execution through Closure.** Together these cover the full spine of an internal audit — from the auditable universe and risk assessment, through the approved annual plan, into fieldwork, findings, management response, reporting, quality review and formal closure.

Not yet executed in this phase: follow-up and corrective-action tracking transactions, resourcing/time and leave, distribution lists, and portfolio-level intelligence surfaces (these were already covered under earlier convergence and UAT waves). The persona harness, fixture estate and result pipeline remain reusable for those without rework.

**Phase D scope is complete and no full end-to-end journey was started**, in line with the phase instruction. Phase E (full E2E) can begin on this baseline.
