# Internal Audit Module — Gap Remediation & Test Readiness

All fourteen queries in the uploaded response document were re-verified against this project's live code and database. The document's findings are accurate. Verification notes:

- `ia_audit_universe` has **0 rows**, and `ia_risk_register.audit_universe_id` still carries a foreign key to it — the Risk Register cannot save (Q9 confirmed).
- Internal Audit modules in the permission registry expose only a `view` action each; none of the ~19 audit permissions declared in `src/types/auth.ts` are registered (Q7 confirmed).
- The Actions tab is create-only in the UI even though an `update` mutation already exists in the data layer (Q3 — small fix).
- Audit progress % mixes lifecycle stage with record-existence checks (Q1 confirmed).
- Recommended Actions cards are built without any `onClick` (Q2 confirmed).
- There is a `ia_can_close_engagement` helper, but closure runs through the generic `ia_transition_execution_status`, so no gate is enforced (Q11/Q12 confirmed).
- No plan closure function or disposition capture exists; `ia_plan_carry_forward` does exist and can be reused (Q13 confirmed).

The module currently has 13 departments, 3 plans, 8 engagements, and zero findings/actions/follow-ups — so it is not yet testable end to end.

## Work plan

### Phase 1 — Unblock testing (do first)
1. **Register audit permissions (Q7).** Seed the 19 internal-audit permissions as real permission-registry actions under the existing Internal Audit module entries, so the Role & Permission screen can assign them. Then define the five roles from the document: Head of Internal Audit, Lead Auditor, Audit Team Member, Quality Reviewer, Management Respondent.
2. **Fix the Risk Register (Q9).** Repoint the risk register's department link to `ia_departments` (and optionally `ia_department_functions`), update the screen's fetch/join, and only then add it to the sidebar. `ia_audit_universe` is left untouched as dead legacy structure.

### Phase 2 — High-priority correctness
3. **Actions status lifecycle (Q3/Q4).** Bring the Actions tab to the same Create/Edit/View pattern as Findings and Follow-Ups, wired to the existing update mutation. Enforce the maker-checker sequence: Responsible Person moves Open → In Progress → Completed; only the audit team moves an action to Closed, and only once its linked Follow-Up (if any) is Resolved. Gate the transitions on the newly registered permissions.
4. **Department audit closure command (Q11/Q12).** Replace generic-transition closure with a dedicated server-side closure command validating: all activities Completed; no findings left in Draft/Under Review; every finding has a management response; the audit report is Issued; quality review signed off. It must return the specific blocking items, derive the actor from the authenticated session, require the closure-approval permission, and support the two terminal states **Closed** and **Closed – Actions Pending**. Actions/follow-ups explicitly do not block closure.
5. **Annual plan closure (Q13).** New capability: a Close Plan action requiring every linked department audit to carry a disposition (Closed / Closed – Actions Pending / Cancelled with reason / Carried Forward with reason, reusing `ia_plan_carry_forward`). Audits still sitting untouched at Planned block closure. Closure records a summary: planned, completed, carried forward, cancelled, completion rate.

### Phase 3 — Medium-priority fixes
6. **Progress bar (Q1).** Derive the percentage from lifecycle stage only, so a clean closure with zero findings shows 100%.
7. **Recommended Actions cards (Q2).** Wire each card to the same stage-transition action the stepper uses.
8. **Document linking (Q6).** Add Working Paper ↔ Finding and Activity linking selectors to the existing forms, so the evidence chain is clickable rather than described in free text.
9. **Risk assessment sync (Q8).** Call the existing department risk sync from the Risk Assessment save path so department ratings update from the intended screen.
10. **Plan supersede / revise guards (Q5/Q14).** On supersede, prompt per in-flight department audit for Carry Forward or Suspend, logged like existing supersede actions. Add a configurable Revise-Plan guard under Audit Settings with values Block / Warn (default) / Allow.

Q10 (Launch Audit) needs no change — it is correctly server-validated.

### Phase 4 — Master data & test plan
11. Seed the master data in the document's mandated order: audit universe config → departments with heads → business functions → auditor profiles → risk scoring config → risk assessments → roles → first annual plan.
12. Produce a written test plan in `docs/` covering a full lifecycle run: plan → approve → launch → fieldwork → finding → response → action → follow-up verification → report issue → quality review → audit closure → plan closure, plus negative tests for each closure gate and each permission boundary.

## Technical notes
- Terminology stays Internal-Audit specific: Audited Department, Management Respondent, Corrective Action Owner — never Employer or Auditee.
- Closure and plan-closure logic goes into dedicated `SECURITY DEFINER` database functions with grants, not client-side checks, consistent with `ia_launch_engagement`.
- Segregation-of-duties exceptions (Head of IA acting as both approver and quality reviewer) are recorded as logged exceptions rather than silent defaults.
- No new template, provider, or communication structures — audit notifications continue through the existing Omni-Comms façade.

Confirm and I'll start with Phase 1.
