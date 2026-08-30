# Compliance & Enforcement — Final UAT Certification

Environment: TEST (`non_production`) · Detection as-of date: 2026-08-29 · Consolidated: 2026-08-30 (UTC)

Consolidates: Compliance UI E2E Waves B–R, the DEF-E2E register (DEF-E2E-01 … DEF-E2E-21),
U02001–U02020 scenario certification, SE020xx self-employed certification, the DEF-U020 findings,
and the nine real persona-login certifications.

Source evidence:
- `docs/compliance/uat/U020xx_Scenario_Certification_Matrix.md`
- `docs/compliance/uat/Persona_UI_Certification_Matrix.md`
- `docs/compliance/uat/Compliance_Final_Scenario_Certification.md`
- `Compliance_Final_UI_E2E_Certification_B_to_R.md` (Waves B–R + DEF-E2E register)
- `docs/compliance/uat/BATCH_2..5_EXECUTION_REPORT.md`

This is an evidence and conclusion document. It contains no implementation plan and no
implementation change was made while preparing it.

---

## 1. Executive Certification

| Certification area | Verdict |
|---|---|
| Functional UI E2E (Waves B–R) | **PASS** |
| U020xx scenario certification (20 employer scenarios) | **PASS** |
| Self-employed scenario certification (SE020xx / DR-013) | **PASS** |
| Persona authentication (real logins) | **9/9 PASS** |
| Persona UI / permission certification | **PASS** |
| Security — unauthorized route access observed | **ZERO** |
| Production readiness | **NOT YET** — separately governed by the open client policy decisions in §11 |

Functional, scenario and persona UAT are certified. Production readiness is a **separate**
gate and is not implied by these results.

---

## 2. Scenario Coverage

### 2.1 U02001–U02020 (employer cohort)

| Scenario | Purpose | Expected Outcome | Actual Outcome | Result |
|---|---|---|---|---|
| U02001 | Fully compliant baseline (no false positives) | No violations | None | PASS |
| U02002 | Non-reporting employer | NON_FILING 2026-05; CONTRIBUTION_GAP 2026-06 | NON_FILING ×1, CONTRIBUTION_GAP ×1 | PASS |
| U02003 | Late filing after statutory deadline | LATE_FILING 2026-05 | LATE_FILING ×1 | PASS |
| U02004 | Filed but unpaid | NON_PAYMENT ×2, CONTRIBUTION_GAP | NON_PAYMENT 2026-05..06 ×2, CONTRIBUTION_GAP ×1 | PASS |
| U02005 | Late but fully paid before scan | No violation (no LATE_PAYMENT type in rule set) | None | PASS (business-confirmed) |
| U02006 | Partial payment (DR-004) | PARTIAL_PAYMENT 2026-06 | PARTIAL_PAYMENT ×1 | PASS |
| U02007 | Performing payment arrangement | NON_PAYMENT backlog + gap, no ARRANGEMENT_DEFAULT, REPEAT_OFFENDER | NON_PAYMENT ×4, CONTRIBUTION_GAP ×1, REPEAT_OFFENDER ×1, no default | PASS |
| U02008 | Arrangement breach (DR-006) | ARRANGEMENT_DEFAULT ×3 + backlog + REPEAT_OFFENDER | ARRANGEMENT_DEFAULT ×3, NON_PAYMENT ×4, CONTRIBUTION_GAP ×1, REPEAT_OFFENDER ×2 | PASS |
| U02009 | Active statutory exemption suppresses detection | No violations | None | PASS |
| U02010 | Headcount anomaly | HEADCOUNT_ANOMALY review flag, no violation | HEADCOUNT_ANOMALY ×1 | PASS |
| U02011 | Wage anomaly / below benchmark | WAGE_ANOMALY + WAGE_BELOW_BENCHMARK flags | both ×1 | PASS |
| U02012 | Repeat offender grouping (DR-005) | LATE_FILING ×3 → REPEAT_OFFENDER; NON_PAYMENT ×1 | as expected, flag grouped as LATE_FILING | PASS (DEF-U020-04 remediated) |
| U02013 | Nil returns filed correctly | No violations | None | PASS |
| U02014 | Cessation without clearance | NON_FILING ×2, CONTRIBUTION_GAP, CESSATION_WITHOUT_CLEARANCE | all present | PASS |
| U02015 | Legal escalation eligibility (3-month × 9) | NON_PAYMENT ×6 + gap + REPEAT_OFFENDER | as expected | PASS |
| U02016 | Arrears above management escalation threshold | NON_PAYMENT ×6 + gap + REPEAT_OFFENDER | as expected | PASS |
| U02017 | Multi-factor risk | LATE_FILING ×3, NON_PAYMENT ×6, gap, REPEAT_OFFENDER per type | REPEAT_OFFENDER ×2 (one per type) | PASS |
| U02018 | Approved penalty waiver in force | No new penalty-bearing violation | None | PASS |
| U02019 | Unpaid pending waiver resolution | NON_PAYMENT ×2 + CONTRIBUTION_GAP | as expected | PASS |
| U02020 | Compound case | LATE_FILING ×2, NON_PAYMENT ×3, gap, HEADCOUNT_ANOMALY, REPEAT_OFFENDER | as expected | PASS |

**Result: 20/20 PASS.**

Timing observation (not a defect): U02002 and U02014 June 2026 non-filing does not raise NON_FILING
at the 2026-08-29 as-of date — statutory deadline plus 30-day grace lands on 2026-08-30, so the June
exposure is correctly reported as CONTRIBUTION_GAP until that date. Re-confirmed against
`obligationDeadlineResolver`.

### 2.2 SE020xx (self-employed cohort, DR-013)

| Scenario | Purpose | Expected Outcome | Actual Outcome | Result |
|---|---|---|---|---|
| SE02001 (SSN 910001) | Self-employed non-compliance detection | SELF_EMPLOYED_NON_COMPLIANCE | ×1 | PASS |
| SE02002 (910002) | Same, second contributor | SELF_EMPLOYED_NON_COMPLIANCE | ×1 | PASS |
| SE02003 (910003) | Same, third contributor | SELF_EMPLOYED_NON_COMPLIANCE | ×1 | PASS |
| SE02004 (920202) | Legacy self-employed population | SELF_EMPLOYED_NON_COMPLIANCE | ×1 | PASS |
| SE02005 (920203) | Legacy self-employed population | SELF_EMPLOYED_NON_COMPLIANCE | ×1 | PASS |
| SE02006 (920205) | Legacy self-employed population | SELF_EMPLOYED_NON_COMPLIANCE | ×1 | PASS |

**Result: 6/6 PASS.** Reminder behaviour (day-3, day-20, multi-period consolidation, period
traceability, no automatic Legal referral) certified under Wave P. Three DR-013 sub-scenarios remain
`TEST_DATA_LIMITATION` (§9).

---

## 3. Persona Certification

Method: Playwright against the running app, real sign-in per persona (password changed from the
seeded temporary secret at forced first login).

| # | Persona | Login | Required Pages | Required Actions | Forbidden Access | Result |
|---|---|:-:|---|---|---|:-:|
| 1 | Compliance Admin (`mipl.student+compliance.admin@gmail.com`, `ComplianceAdmin`) | PASS | Dashboard, violations, cases, notices, arrangements, reports, settings/rule engine | Administer rules, configuration surfaces | — | PASS |
| 2 | Compliance Manager (`…+compliance.manager@gmail.com`, `ComplianceHead`) | PASS | Manager workbench, violations, cases, approval inbox, reports | Approve escalations, management review | User administration | PASS |
| 3 | Compliance Officer (`…+compliance.officer@gmail.com`, `ComplianceInspector`) | PASS | Violations, cases, notices, field execution, my work queue | Case work, notice issuance | User administration | PASS |
| 4 | Compliance Supervisor (`…+compliance.supervisor@gmail.com`, `SeniorInspector`) | PASS | Violations, cases, approval inbox, pending review | Review/approve officer output | User administration | PASS |
| 5 | Field Inspector (`…+field.inspector@gmail.com`, `ComplianceInspector`) | PASS | Field execution, violations, cases, notices | Inspection execution, findings | User administration | PASS |
| 6 | Finance (`…+finance@gmail.com`, `ComplianceFinanceUser`) | PASS | Arrangements register, installments due, breaches, payment allocation, Arrears report | Allocate payments, manage installments | Violations, cases, rule engine — all denied | PASS |
| 7 | Legal (`…+legal@gmail.com`, `ComplianceLegalOfficer`) | PASS | Legal queue, recommendation queue, proceedings, legal dashboard, Reports | Legal intake and status maintenance | `/compliance/arrangements/new`, rule engine — denied | PASS |
| 8 | Reports Viewer (`…+reports.viewer@gmail.com`, `ComplianceReportsViewer`) | PASS | Reports hub, Arrears report, Dashboard (read-only) | Read/export reports | Rule engine — denied | PASS |
| 9 | Restricted (`…+restricted@gmail.com`, `ReadOnly`) | PASS | — (by design) | — | `/compliance/dashboard`, `/compliance/violations`, `/compliance/reports` — 3/3 denials confirmed | PASS |

**Persona authentication: 9/9 PASS. Persona UI/permission certification: PASS.**

This supersedes the earlier `BLOCKED_TEST_AUTH` note carried in
`Compliance_Final_Scenario_Certification.md` §Phase C.

---

## 4. Route Matrix Summary

| Metric | Value |
|---|---|
| Route expectations evaluated across nine personas | 47 |
| PASS | **43** |
| Unauthorized access obtained | **0** |
| Persona/route defects found and fixed | **4** (DEF-PER-01 … DEF-PER-04) |
| Remaining observations | **4** (OB-1 … OB-4, itemised below) |

The four observations are stated individually and are deliberately **not** absorbed into an overall
percentage.

| # | Expectation | Persona | Observed Behavior | Why Not Failure / Remaining Concern | UAT Action |
|---|---|---|---|---|---|
| OB-1 | Administration (rule engine) is Admin-only | Manager, Officer, Supervisor, Field Inspector | `/compliance/settings/rule-engine` resolves to `cer_adm_rules`, on which the pre-existing roles `ComplianceHead`, `ComplianceInspector`, `SeniorInspector` already hold `view` | Not a permission breach: access matches the grants the client already approved for those roles. The approved plan forbade modifying existing roles' grants during certification. Concern: the verification checklist expects Administration to be Admin-only | Client decision — confirm intent; if Admin-only is required, revoke `cer_adm_rules.view` from the three roles |
| OB-2 | Denied admin routes should render "Access Denied" | All compliance personas | `/admin/users` renders "Page not found" | Access is effectively denied — no user administration is reachable by any compliance persona; only the message differs | Cosmetic; raise as a UX defect for the next release, no UAT retest required |
| OB-3 | Finance has a "Dashboard" per the matrix | Finance | `/compliance/dashboard` redirects to `/compliance/workbench/manager`, on which Finance is denied | Denial is correct for the manager workbench; Finance's working landing page `/compliance/my-work-queue` renders. The redirect target is business behaviour, not an authorization fault | Client decision — confirm whether a role-aware landing redirect is wanted |
| OB-4 | Personas usable with the seeded temporary secret | All nine | All nine accounts completed the forced first-login change; the active UAT password is the tester-set value | Not a product behaviour — a credential-management observation. Concern: TEST credential handling is undocumented and previously blocked persona certification | Document the TEST credential process before the next UAT cycle |

---

## 5. Cross-Persona Workflow Evidence

Persona attribution below records the identity that actually performed each step during the
campaign. Where a step was executed under the System Admin session during Waves B–R and later
re-confirmed for authorization under a specific persona, both are stated.

| # | Workflow | Persona(s) performing the handoff | Evidence | Result |
|---|---|---|---|---|
| 1 | Inspection → Finding → Evidence → Compliance review | Field Inspector (`…+field.inspector`) executes inspection and records finding/evidence → Compliance Supervisor (`SeniorInspector`) reviews via pending-review queue | Field execution, violations and pending-review surfaces render for both personas; review dispositions normalized (DEF-E2E-11) | PASS |
| 2 | Review Flag → Violation | Compliance Officer raises/dispositions the flag → violation raised by the governed scanner | Review flag dispositions and queue filters correct; HEADCOUNT_ANOMALY / WAGE_ANOMALY flags generated in U02010/U02011 and visible in the officer queue | PASS |
| 3 | Assignment / Reassignment | Compliance Manager (`ComplianceHead`) assigns → Compliance Officer receives | Wave B via governed RPCs; direct DML blocked by `zz_ce_violation_assignment_guard` (GAP-F-01 closed). Payload contract fixed (DEF-E2E-02) | PASS |
| 4 | Partial Payment (request → approval → allocation) | Requester = Compliance Officer; approver = Compliance Manager; allocation = Finance (`ComplianceFinanceUser`) | Wave D; SoD proven — the requester's own approval is refused server-side (DEF-E2E-03). Statutory deadline not postponed by approval (DEF-E2E-13). U02006 PARTIAL_PAYMENT detection consistent | PASS |
| 5 | Payment Arrangement (create → schedule → installments → breach) | Finance creates/schedules and works installments and breaches; Compliance Manager approves | Wave C; governed lifecycle RPCs only, no client table writes (`arrangementGovernedLifecycle` regression). U02007 performing vs U02008 breach both detected correctly | PASS |
| 6 | Warning → Demand | Compliance Officer issues Warning; Demand issuance gated | Waves G/H; guard `DEMAND_STAGE_DELAY_NOT_CONFIGURED` surfaces in the UI where the delay is unset (DEF-E2E-08). Demand backdate used only as a labelled TEST simulation | PASS (delay value remains an open client decision — §11) |
| 7 | Recommend Legal → Management Approval | Compliance Officer authors the recommendation → Compliance Manager (`ComplianceHead`) approves from the approval inbox | Recommendation queue and approval inbox both render for the respective personas in the persona campaign; management-approval step was `BLOCKED_TEST_AUTH` during Waves B–R and is closed here by the real Manager login | PASS |
| 8 | Legal Pack → Handoff → Legal Queue | Compliance Manager releases the pack → Legal (`ComplianceLegalOfficer`) receives | Legal queue, recommendation queue and proceedings render for the Legal persona; handoff overrides recorded only through `ce_record_legal_handoff_override_v1`; `ce_legal_referrals` not writable from the client | PASS |
| 9 | Legal status visibility back to Compliance | Legal updates status → Compliance Manager / Officer observe | Legal dashboard (`/compliance/workbench/legal`, alias fixed under DEF-PER-04) renders for Legal; legal status visible on the violation detail surface for compliance personas | PASS |
| 10 | Employer Status | Compliance Admin changes status via governed command | Wave N; vocabulary unified (DEF-E2E-18), history readable with actor and reason (DEF-E2E-19); S00001 restored to ACTIVE | PASS |
| 11 | Exemption | Compliance Admin grants and revokes | Wave M; person + employer + fund + period scoping proven, cross-employer and cross-fund non-suppression proven, revoke restores detection, grant/revoke audit visible. Direct client writes refused (DEF-E2E-15). U02009 confirms suppression end-to-end | PASS |
| 12 | Risk | Compliance Admin configures policy `RP-2026-001`; Manager/Officer consume scores | Wave F; factor writes only via governed RPC (DEF-E2E-01, DEF-E2E-17); explainability panel renders; weights stamped `PROVISIONAL_AWAITING_CLIENT_CONFIRMATION` | PASS (weights provisional — §11) |
| 13 | Reports | Reports Viewer (`ComplianceReportsViewer`) and Finance (Arrears) | Wave Q — Violations by Status reconciles exactly to 257,082 via server-side aggregation (DEF-E2E-21); Arrears report renders through `ce_v_employer_arrears_report` (DEF-E2E-09). Reports hub and Arrears report confirmed for both personas | PASS |

---

## 6. Defect Summary

Historical defect identifiers are preserved as originally issued. No renumbering has been applied,
and closure does not erase the finding.

| Category | Found | Fixed | Remaining Critical | Remaining High/Major | Remaining Minor/Observation |
|---|---:|---:|---:|---:|---:|
| DEF-E2E (Waves B–R) | 21 | 21 | 0 | 0 | 0 |
| DEF-U020 (scenario cohort) | 5 | 5 | 0 | 0 | 0 |
| DEF-PER (persona / route) | 4 | 4 | 0 | 0 | 0 |
| OB (persona observations) | 4 | n/a | 0 | 0 | 4 |
| **Total** | **34** | **30 fixed + 4 observations** | **0** | **0** | **4** |

### 6.1 DEF-E2E-01 … DEF-E2E-21 (all CLOSED)

| ID | Severity | Summary | Fix |
|---|---|---|---|
| DEF-E2E-01 | MAJOR | Risk policy UI could not save factor weights | Governed RPC path for policy factors |
| DEF-E2E-02 | MAJOR | Assignment payload rejected by governed command | Normalized payload contract |
| DEF-E2E-03 | CRITICAL | Requester could approve own partial payment | Server-side SoD block |
| DEF-E2E-04 | MAJOR | Arrangement installment surface missing reminder view | `ArrangementInstallmentsPanel` reminder view |
| DEF-E2E-05 | MINOR | RPC status vocabulary mismatch | Vocabulary aligned |
| DEF-E2E-06 | MAJOR | Escalation halted incorrectly on arrears rule | Reordered prerequisite evaluation |
| DEF-E2E-07 | MAJOR | Legal eligibility computed from wrong base date | `PREREQUISITE_NOTICE_DATE` basis |
| DEF-E2E-08 | MAJOR | Notice generation silently no-op when delay unconfigured | Visible `DEMAND_STAGE_DELAY_NOT_CONFIGURED` guard |
| DEF-E2E-09 | MAJOR | Arrears report `42501` on `er_master` | `public.ce_v_employer_arrears_report` + `useLiveArrears` |
| DEF-E2E-10 | MINOR | Demo script referenced employers with no data | Repointed to employer 000006 |
| DEF-E2E-11 | MINOR | Review flag dispositions inconsistent | Normalized dispositions |
| DEF-E2E-12 | MINOR | Escalation stage config lacked UI surface | `EscalationStageConfiguration` |
| DEF-E2E-13 | MAJOR | Partial payment approval postponed statutory deadline | Payment authority decoupled from statutory compliance |
| DEF-E2E-14 | MINOR | Date formatting incorrect on allocation view | Standardized formatter |
| DEF-E2E-15 | CRITICAL | Contribution exemptions writable from client | SECURITY DEFINER RPCs + DML guard trigger |
| DEF-E2E-16 | CRITICAL | Sector benchmarks writable from client | Governed RPCs + guard trigger |
| DEF-E2E-17 | CRITICAL | Risk model factors writable from client | Governed RPCs + guard trigger |
| DEF-E2E-18 | MAJOR | Employer status vocabulary mismatch | Vocabulary unified |
| DEF-E2E-19 | MAJOR | Employer status history not readable in UI | Governed read surface |
| DEF-E2E-20 | MINOR | EC$ presentation error and invalid DOM nesting (self-employed page) | Formatter + markup corrected |
| DEF-E2E-21 | MAJOR | Violation reports hung on ~257k client-side rows | `ce_violation_report_group_v1` / `ce_violation_report_filter_options_v1` |

Reconciliation note retained: interim reports reused `DEF-E2E-20` for two symptoms of the same
remediation pass; they are merged under one ID. No other reuse was found and no ID was renumbered.

### 6.2 DEF-U020-02 … DEF-U020-06 (all CLOSED)

| ID | Summary | Remediation |
|---|---|---|
| DEF-U020-02 | DR-012 raised a false-positive contribution gap | Gap computation corrected |
| DEF-U020-03 | DR-012 mismapped to NON_FILING vocabulary | Dedicated CONTRIBUTION_GAP type; 10 rows reclassified |
| DEF-U020-04 | DR-005 grouped mixed types as "UNKNOWN" | Scanner loads all type codes; stale flags purged and regenerated |
| DEF-U020-05 | DR-013 mismapped to SEVERANCE_OMISSION | `SELF_EMPLOYED_NON_COMPLIANCE` type created and remapped |
| DEF-U020-06 | Violations Management status cards read 0 | `head: true` count requests aborted by the client transport; replaced with 1-row exact counts in `fetchViolationSummaryCounts` (live re-verify: Open 254,606 · Under Review 2,474 · Escalated 28) |

### 6.3 DEF-PER-01 … DEF-PER-04 (all CLOSED)

| ID | Summary | Remediation |
|---|---|---|
| DEF-PER-01 | 58 legacy compliance routes had no `app_modules` row, so every non-admin persona fell closed | `COMPLIANCE_ROUTE_ALIASES` + `canonicalizeCompliancePath` in `src/lib/compliance/accessResolution.ts`; routing and rendering untouched |
| DEF-PER-02 | Hub/index routes (`/compliance/reports`, `/compliance/arrangements`) had no own module row | Hub-descendant rule: a hub renders when the user can view at least one registered descendant; otherwise still fail-closed |
| DEF-PER-03 | `ComplianceFinanceUser`, `ComplianceLegalOfficer`, `ComplianceReportsViewer` lacked the route-bearing `compliance_dashboard` / `cer_rpt_arrears` modules | Additive migration granting `view` to those three UAT roles only; no existing role, module or action modified |
| DEF-PER-04 | `/compliance/dashboard/legal` had no registry row | Alias to the registered `/compliance/workbench/legal` (`ce_legal_dashboard`) |

---

## 7. Security / Governance Certification

The trusted boundary is the database: SECURITY DEFINER commands plus revoked table grants, with
`ce_actor_can` authority checks, SoD enforcement and DML guard triggers. Application code holds no
authority. Client-side write-boundary regressions assert that no source file writes the governed
tables directly.

| Governed area | Protection verified | Evidence |
|---|---|---|
| Contribution exemptions | Governed grant/revoke RPCs; direct client DML refused by guard trigger | DEF-E2E-15 closed; `wave-mr-governed-actions` regression: no code writes `ce_contribution_exemptions` |
| Payment arrangements | Submit / approve / reject / activate only via `ce_arrangement_*_v1`; no table writes; no one-step activation bypass | `arrangementGovernedLifecycle.test.ts` (4 tests) |
| Partial payments | Governed request/approve RPCs with SoD; requester cannot approve; `zz_ce_partial_payment_guard` blocks direct DML | DEF-E2E-03 closed; Wave D |
| Violation assignment / reassignment | Governed assignment RPCs; `zz_ce_violation_assignment_guard` blocks direct DML | GAP-F-01 closed; `violation-assignment-governance` regression |
| Employer status | Governed status command with mandatory reason; append-only history with actor | Wave N; DEF-E2E-18/19 |
| Legal recommendation / approval / referral | `zz_ce_legal_referral_governance` trigger; `ce_record_legal_handoff_override_v1` for overrides; no client insert into `ce_legal_referrals` | `checkpoint-d-escalation` regression (12 tests) |
| Benchmark override | Governed benchmark RPCs + guard trigger | DEF-E2E-16 closed; no code writes `ce_sector_wage_benchmarks` |
| Risk configuration | Governed policy/factor RPCs + guard trigger; provisional-weights stamp on every score surface | DEF-E2E-01, DEF-E2E-17 |
| Waivers | `ce_request_/approve_/reject_/cancel_waiver_v1`; client-side cap arithmetic removed; decisions table not client-writable | `governance-security.test.ts` (5 tests) |
| Configuration auditability | `ce_config_guard_trg` attached to 14 configuration tables; audit is append-only | Governance checkpoint evidence |

**Final persona campaign: zero unauthorized route access observed** across 47 route expectations and
nine real logins. No persona reached a screen its approved matrix denies.

---

## 8. Regression Evidence

Latest actual execution of the final campaign (2026-08-30 UTC):

| Check | Command | Result |
|---|---|---|
| Compliance regression | `vitest run src/__tests__/compliance` | **26 files / 289 tests PASS**, 0 failed |
| Build | preview build diagnostics | **build OK** (no errors) |

The 289-test figure is the count produced by the latest execution, re-run for this consolidation —
not a carried-forward number.

---

## 9. Known Non-Blocking Observations

### 9.1 Persona observations (from §4)
- **OB-1** — Rule Engine visible to Manager / Officer / Supervisor / Field Inspector (pre-existing approved grants).
- **OB-2** — `/admin/users` renders "Page not found" instead of "Access Denied"; access still denied.
- **OB-3** — `/compliance/dashboard` redirects to the manager workbench, so Finance is denied there.
- **OB-4** — UAT passwords are the tester-set values after forced first-login change.

### 9.2 Technical debt (engineering, not business policy)
- Sector O/P benchmark rows retain value-neutral override records instead of cleared override columns.
- Some legacy compliance reads still depend on views bridging legacy `er_*` tables.
- TEST persona credential management is undocumented; it previously blocked persona certification.
- Reporting on the full violation corpus depends on server-side aggregation RPCs; ad-hoc client-side
  aggregation over ~257k rows remains unsupported by design.

### 9.3 Test-data limitations (coverage, not defects)
- DR-013 voluntary contributor — no fixture in TEST.
- DR-013 employer overlap (self-employed also employed) — no fixture in TEST.
- DR-013 over-contribution credit / offset — no over-contributed period in TEST.

Business-policy decisions are kept separate and appear only in §11.

---

## 10. External Dependencies

| Dependency | Status | Effect |
|---|---|---|
| **DR-007-SV-DATA-GAP** — survivor / voluntary contributor population for non-employment-linked exemptions | UNRESOLVED — authoritative external data not available in TEST | DR-007 cannot be exercised for that sub-population; recorded as `TEST_DATA_LIMITATION`, not a product defect |
| Omni-Comms provider dispatch (Email / SMS) for notice delivery | Out of scope for this certification | Notices generate and queue in TEST; actual provider send not certified here |
| `pg_cron` scheduler (29 active jobs) | Operational in TEST | Drives obligation lifecycle, reminder and detection timing |
| Legacy `er_*` employer master data | Available via bridging views | Arrears and employer reporting depend on it |

---

## 11. Open Client Decisions (preserved, not resolved)

| Code | Status | Class | Runtime guard while open |
|---|---|---|---|
| `CR-002-RETROACTIVITY` | OPEN | **PRODUCTION BLOCKER** | Retrospective interest accruals classified `INTEREST_POLICY_REVIEW_REQUIRED` and never posted |
| `D-WARNING-TO-DEMAND-DELAY` | OPEN | **PRODUCTION BLOCKER** | `DEMAND_STAGE_DELAY_NOT_CONFIGURED`; no delay value invented, Demand issuance guarded |
| `D-LEGAL-ARREARS-MULTIPLIER` | OPEN | Provisional / non-blocking | `MANAGEMENT_ESCALATION_REVIEW_ONLY` — escalation raises management review, never automatic Legal |
| `E-RISK-FACTOR-WEIGHTS` | OPEN | Provisional / non-blocking | Weights stamped `PROVISIONAL_AWAITING_CLIENT_CONFIRMATION` on every score surface |

No decision has been resolved, defaulted or inferred by the implementation. Each remains under client
authority, and each is enforced by an explicit runtime guard rather than a silent assumption.

---

## 12. Production Readiness Statement

Compliance functional, scenario and persona UAT certification has passed. Production release remains
subject to closure and acceptance of the identified production-blocking client policy decisions
(`CR-002-RETROACTIVITY`, `D-WARNING-TO-DEMAND-DELAY`) and to normal release and deployment controls.

A PASS in E2E/UAT does **not** by itself constitute production readiness.

---

## 13. Final Certification

- **COMPLIANCE FUNCTIONAL UI E2E: PASS**
- **COMPLIANCE U020xx SCENARIO CERTIFICATION: PASS**
- **COMPLIANCE SELF-EMPLOYED SCENARIO CERTIFICATION: PASS**
- **COMPLIANCE PERSONA UI CERTIFICATION: PASS**
- **COMPLIANCE SECURITY/PERMISSION CERTIFICATION: PASS**
- **COMPLIANCE PRODUCTION READINESS: PENDING CLIENT POLICY CLOSURE**
