# Internal Audit — Stage 1B / E2E-5
## Cross-Year Follow-Up, 2027 Plan Closeout and 2028 Lineage

Executed against the TEST backend from repository HEAD `8d382cd6145704fdf2d8e049a1bf46301d26a0b9`.
No certified history from E2E-1 through E2E-4 was modified.

---

## 1. Frozen baseline — ENG-2027-004 (immutable reference)

| Item | Value |
| --- | --- |
| Engagement ID | `f157530a-f9e5-4ea9-89b4-c3b4f769d724` |
| Engagement Ref | ENG-2027-004 — Compliance / Contribution Processing (C3) |
| Closure status | `Closed` |
| Closure disposition | `Closed – Actions Pending` |
| Findings | `F-2027-004-01` (Critical, `a85746e1…`), `F-2027-004-02` (High, `e627d092…`) |
| Actions | ACT-2027-004-A (`009798c9…`, target 2027-06-30), ACT-2027-004-B (`efe04b93…`, target 2027-05-29) |
| Report | Issued (1 issued report, unchanged) |

Post-E2E-5 re-check: status `Closed`, execution status `Closed – Actions Pending`, 2 findings, 1 issued report — **unchanged**.

---

## 2. Governance remediation delivered in E2E-5

| Defect | Description | Remediation |
| --- | --- | --- |
| DEF-S1B-29 | Carry-forward held source evidence only; no target-year lineage | `ia_plan_carry_forward` extended with `target_plan_id`, `target_engagement_id`, `target_fiscal_year`, acceptance metadata; new governed command `ia_plan_accept_carry_forward` promotes a carry-forward into the next-year plan and creates the linked engagement |
| DEF-S1B-30 | Annual plan closure wrote no immutable audit history | `ia_close_annual_plan` now emits `IA.PLAN.CLOSED` with actor, timestamp, plan, fiscal year and final disposition counts |
| Closed-plan mutability | Closed plans/engagements were freely editable | `ia_guard_closed_annual_plan` / `ia_guard_closed_plan_engagement` triggers block ordinary mutation; `ia_reopen_annual_plan` is the only sanctioned unlock |
| DEF-S1B-31 | `ia_evaluate_plan_closure` did not treat `Carried Forward` as a terminal disposition, contradicting `ia_close_annual_plan` | Readiness evaluator aligned with the closure command |
| Carry-forward staffing | Promoted engagements had no lead auditor, blocking next-year plan readiness | Promotion now inherits the source audit's lead auditor (existing rows backfilled) |

---

## 3. 2027 year-end portfolio — all 22 audits

| Ref | Risk | Qtr | Final status / disposition | Findings | Carry-forward target |
| --- | --- | --- | --- | --- | --- |
| ENG-2027-001 | High | Q1 | Closed | 0 | — |
| ENG-2027-002 | Critical | Q1 | Closed | 3 | — |
| ENG-2027-003 | Critical | Q1 | Closed | 2 | — |
| ENG-2027-004 | Critical | Q1 | Closed – Actions Pending | 2 | — |
| ENG-2027-005 | Critical | Q1 | Carried Forward | 0 | 2028 / **ENG-2028-001** |
| ENG-2027-006 | High | Q1 | Carried Forward | 0 | 2028 (awaiting acceptance) |
| ENG-2027-007 | High | Q1 | Carried Forward | 0 | 2028 (awaiting acceptance) |
| ENG-2027-008 | High | Q2 | Carried Forward | 0 | 2028 (awaiting acceptance) |
| ENG-2027-009 | High | Q2 | Carried Forward | 0 | 2028 / **ENG-2028-002** |
| ENG-2027-010 | High | Q2 | Carried Forward | 0 | 2028 (awaiting acceptance) |
| ENG-2027-011 | High | Q2 | Carried Forward | 0 | 2028 (awaiting acceptance) |
| ENG-2027-012 | High | Q2 | Carried Forward | 0 | 2028 (awaiting acceptance) |
| ENG-2027-013 | High | Q2 | Carried Forward | 0 | 2028 (awaiting acceptance) |
| ENG-2027-014 | High | Q3 | Carried Forward | 0 | 2028 (awaiting acceptance) |
| ENG-2027-015 | High | Q3 | Carried Forward | 0 | 2028 (awaiting acceptance) |
| ENG-2027-016 | High | Q3 | Carried Forward | 0 | 2028 (awaiting acceptance) |
| ENG-2027-017 | High | Q3 | Carried Forward | 0 | 2028 (awaiting acceptance) |
| ENG-2027-018 | High | Q3 | Carried Forward | 0 | 2028 (awaiting acceptance) |
| ENG-2027-019 | High | Q3 | Carried Forward | 0 | 2028 (awaiting acceptance) |
| ENG-2027-020 | High | Q3 | Carried Forward | 0 | 2028 (awaiting acceptance) |
| ENG-2027-021 | High | Q4 | Cancelled | 0 | — |
| ENG-2027-022 | High | Q4 | Carried Forward | 0 | 2028 (awaiting acceptance) |

Totals: Closed 3 · Closed – Actions Pending 1 · Carried Forward 17 · Cancelled 1 = **22**.

Every carry-forward and the cancellation carry an evidence-based reason (audit never launched, preparation Not Started, zero hours charged, risk unmitigated); the cancellation additionally records the 2028 universe re-scoring decision of the Head of Internal Audit.

---

## 4. Plan closure sequence

1. Pre-check `ia_evaluate_plan_closure(2027)` → `can_close = false`, `pending_count = 18`.
2. Negative — team member close → **DENIED** (no permission).
3. Negative — management close → **DENIED** (no permission).
4. Negative — carry-forward and cancellation without reason → **DENIED** (`Carry-forward reason is required`, `Cancellation reason is required`).
5. Dispositions applied for 17 audits with ENG-2027-022 deliberately left undisposed → closure **refused** (`ENG-2027-022 has no disposition`); readiness `can_close = false`, `pending_count = 1`.
6. Final disposition applied and plan closed by the Head of Internal Audit: `status = Closed`, `closed_by = w4-cert-hia@certification.invalid`, `closed_date = 2026-08-28`, `closure_summary` = planned 22 / completed 4 / actions-pending 1 / carried forward 17 / cancelled 1 / pending 0.
7. Immutable event `IA.PLAN.CLOSED` written with actor, timestamp and the same disposition counts.
8. Negative — after closure: plan title update, engagement rename and new engagement insert all **DENIED** by the closed-plan guards (verified unchanged in the database).

---

## 5. 2028 plan and engagement carry-forward lineage

- 2028 Risk-Based Annual Internal Audit Plan created by the Lead Auditor (`e1f144c7-58d1-4ab3-a3f1-c34c4aacfb67`).
- Two carry-forwards promoted through `ia_plan_accept_carry_forward`:
  - ENG-2027-005 (Critical, IT Security & Access Control) → **ENG-2028-001** (Q1)
  - ENG-2027-009 (High, Arrears Management) → **ENG-2028-002** (Q2)
- Lineage stored on each carry-forward: source plan, source engagement, reason, target plan, target engagement, target fiscal year, accepted by, accepted at; event `IA.PLAN.CARRY_FORWARD_ACCEPTED` recorded.
- Plan submitted by the Lead Auditor and approved by the Head of Internal Audit (SoD respected, version 2, `Approved`).

---

## 6. Cross-year corrective-action follow-up (ENG-2027-004)

- Follow-ups scheduled in 2028 against the original 2027 actions (no new 2028 finding created):
  - ACT-2027-004-A → follow-up `4b1145a3…`, due 2028-02-15, fiscal year 2028
  - ACT-2027-004-B → follow-up `ad5cf6bb…`, due 2028-03-15, fiscal year 2028
- Deterministic reminder runs against follow-up A:
  - `as_of 2028-02-08` (+7) → emitted 1 (`due_soon_7:action_owner`)
  - repeat of the same occurrence → emitted 0, deduplicated 1
  - `as_of 2028-02-15` (due) → emitted 1 (`due_today:action_owner`)
  - `as_of 2028-02-22` (overdue) → emitted 2 (`overdue_7:action_owner`, `overdue_7:lead_auditor` escalation)
  - errors 0, blocked 0, unresolved escalation recipients 0
- Negative — completion without evidence → `IA_EVIDENCE_REQUIRED`; completion with a non-existent evidence id → `IA_EVIDENCE_INVALID` (DEF-S1B-26 still enforced).
- Management completion submitted with real engagement evidence → status `Verification Required`.
- Negative — management self-verification and self-closure → **DENIED**.
- Intermediate follow-up outcome `Partially Implemented` recorded with remaining gap, then independent Internal Audit verification (`Verified`), action closure (`Closed`), and final follow-up outcome `Implemented` for both actions.
- Post-closure reminder runs at 2028-02-22, 2028-03-22 and 2028-06-30 → emitted 0.

---

## 7. Reporting and registers

- Corrective Action Register shows for both actions: original audit ENG-2027-004, original and current target dates, evidence attached, management completion date, verification status `Passed`, verifier notes, closure date and notes, follow-up state `Implemented`; `is_open`, `is_overdue`, `is_due_soon` all false.
- Findings by plan year: 2027 = 7 findings, 2028 = 0 — the 2027 findings were **not** reclassified into 2028 despite 2028 follow-up activity.
- Carry-forward register shows source plan, source engagement, reason, target plan, target engagement, target fiscal year, accepting actor and age.

---

## 8. E2E-5 cross-year matrix

| Check | Result |
| --- | --- |
| ENG-2027-004 historical disposition preserved | PASS |
| Original finding lineage | PASS |
| Original action lineage | PASS |
| 2028 follow-up created | PASS |
| Follow-up source year 2027 / target year 2028 | PASS |
| Follow-up +7 / due-date / overdue reminders | PASS |
| Follow-up dedupe | PASS |
| Management completion | PASS |
| DEF-S1B-26 evidence regression | PASS |
| Management self-verification | DENIED |
| Independent verification | PASS |
| Action A closed / Action B closed | PASS |
| Follow-up closed | PASS |
| Post-closure reminders | 0 |
| Carry-forward engagement test | PASS |
| Source → target plan lineage | PASS |
| 2027 plan pending before dispositions | PASS |
| All 22 have terminal disposition | PASS |
| Plan closure unauthorised negative | DENIED |
| Carry-forward without reason | DENIED |
| Undisposed audit negative | PASS |
| 2027 annual plan closed | PASS |
| Closure summary reconciliation | PASS |
| Immutable plan closure event | PASS |
| Closed-plan mutation negative | PASS |
| Cross-year reporting / findings by year | PASS |
| Action centre and registers | PASS |
| Security / SoD | PASS |
| New blocking defects | 0 |

**E2E-5: PASS**

---

## 9. Stage-1B master status

| Journey | Result |
| --- | --- |
| E2E-1 Clean audit | PASS |
| E2E-2 High-risk findings / actions | PASS |
| E2E-3 Disputed response | PASS |
| E2E-4 Overdue / escalation / actions-pending closure | PASS |
| E2E-5 Cross-year follow-up / plan closeout | PASS |
