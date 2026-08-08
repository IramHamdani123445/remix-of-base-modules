# BN Risk / Fraud — Epic 7 Completion Record

**Module:** Benefits → Risk / Fraud (`bn_risk_*`)
**Certification date:** 8 August 2026
**Branch:** Lovable managed main
**Scope:** End-to-end completion and technical certification of the delivered
Risk/Fraud implementation (Epics 0–6). No redesign, no new business features.

---

## 1. Epic status

| Epic | Scope | Status |
| --- | --- | --- |
| Epic 0 | Signal intake, triage, linking, dismissal | COMPLETE |
| Epic 1 | Assessment creation, factors, evidence | COMPLETE |
| Epic 2 | Deterministic explainable scoring and review | COMPLETE |
| Epic 3 | Control recommendation and independent approval | COMPLETE |
| Epic 4 | Approved-control execution and governed handoffs | COMPLETE |
| Epic 5 | Outcome, completion, closure, audited reopening | COMPLETE |
| Epic 6 | Rule feedback, operational queues, reporting | COMPLETE |
| Epic 7 | End-to-end completion and technical certification | COMPLETE |

## 2. Certified lifecycle

```text
Detect → Signal → Triage → Assessment → Factors/Evidence → Explainable score
 → Human review → Human recommendation → Independent approval
 → Governed control / target-domain handoff → Outcome → Closure → Feedback

Exceptional: CLOSED → audited reopen → new review phase (closure retained)
```

## 3. Canonical command coverage (18 / 18 implemented)

Each command is dispatched by a governed `SECURITY DEFINER` SQL boundary and is
reachable from the browser only through its Risk service façade.

| Command | Capability | MC | Boundary RPC |
| --- | --- | --- | --- |
| BN_RISK_GENERATE_SIGNAL | write | – | `bn_risk_execute_command_v1` |
| BN_RISK_REGISTER_MANUAL_SIGNAL | write | – | `bn_risk_execute_command_v1` |
| BN_RISK_TRIAGE_SIGNAL | write | – | `bn_risk_execute_command_v1` |
| BN_RISK_LINK_SIGNALS | write | – | `bn_risk_execute_command_v1` |
| BN_RISK_DISMISS_SIGNAL | decide | – | `bn_risk_execute_command_v1` |
| BN_RISK_CREATE_ASSESSMENT | write | – | `bn_risk_assessment_command_v1` |
| BN_RISK_ADD_FACTOR | write | – | `bn_risk_assessment_command_v1` |
| BN_RISK_REQUEST_EVIDENCE | write | – | `bn_risk_assessment_command_v1` |
| BN_RISK_RECOMMEND_CONTROL | write | – | `bn_risk_control_command_v1` |
| BN_RISK_APPROVE_CONTROL | approve_control | yes | `bn_risk_control_command_v1` |
| BN_RISK_PLACE_PAYMENT_HOLD | approve_control | yes | `bn_risk_control_execution_command_v1` |
| BN_RISK_REQUEST_ENH_VERIFICATION | write | – | `bn_risk_control_execution_command_v1` |
| BN_RISK_REFER_TO_LEGAL | refer | yes | `bn_risk_control_execution_command_v1` |
| BN_RISK_REFER_TO_INVESTIGATION | refer | yes | `bn_risk_control_execution_command_v1` |
| BN_RISK_RECORD_OUTCOME | decide | – | `bn_risk_outcome_command_v1` |
| BN_RISK_CLOSE_ASSESSMENT | decide | – | `bn_risk_outcome_command_v1` |
| BN_RISK_REOPEN_ASSESSMENT | admin | – | `bn_risk_outcome_command_v1` |
| BN_RISK_UPDATE_RULE_FEEDBACK | rule_admin | – | `bn_risk_rule_feedback_command_v1` |

`BN_RISK_OP_*` operations (assign, correct factor, withdraw recommendation,
retry execution, correct outcome, correct feedback, …) remain **supporting
operations**; no 19th canonical business command was introduced.

## 4. State-machine certification

- **Signal:** NEW → TRIAGED → LINKED → UNDER_REVIEW → CONFIRMED → ACTIONED →
  CLOSED, with DISMISSED → CLOSED. Illegal shortcuts (NEW → CONFIRMED,
  NEW → ACTIONED, DISMISSED → CONFIRMED, CLOSED → NEW) rejected.
- **Assessment:** DRAFT → OPEN → INFORMATION_PENDING → REVIEW → RECOMMENDATION
  → APPROVAL_PENDING → CONTROL_ACTION | REFERRED → COMPLETED → CLOSED.
- Proven prohibited: REVIEW → CONTROL_ACTION, REVIEW → REFERRED,
  OPEN → RECOMMENDATION, REVIEW → APPROVAL_PENDING,
  RECOMMENDATION → CONTROL_ACTION, CONTROL_ACTION → CLOSED, REVIEW → CLOSED,
  CLOSED → anything (reopen is an explicit audited command).

## 5. Governance gates

| Gate | Result |
| --- | --- |
| Scoring deterministic, backend-owned, versioned, explainable, staleness-aware | PASS |
| No black-box / ML / AI fraud classifier in Risk code | PASS |
| No score-driven automatic recommendation, approval or control | PASS |
| Maker-checker enforced server-side for controls requiring approval | PASS |
| Execution goes to the owning target domain, never a Risk direct write | PASS |
| No direct cross-domain writes (Claim, Award, Payment, Overpayment, Person, Legal, Investigation, Means-Test) | PASS |
| Means-Test consumed by reference/safe context only — no second Means engine | PASS |
| No second Risk document repository (references only) | PASS |
| Communication requested ≠ delivered; Hub owns delivery | PASS |
| Feedback immutable, corrections supersede; no auto-learning | PASS |
| Scoring configuration lifecycle governed and historically immutable | PASS |
| Privacy-safe Benefit 360 / Claim / Award projections (status only) | PASS |
| Restricted narrative gated by restricted permission | PASS |

## 6. Journeys A–J

| Journey | Description | Result |
| --- | --- | --- |
| A | Standard assessed case through approval, execution, outcome, closure | PASS |
| B | Mitigating evidence — explicit human recommendation, no auto adverse action | PASS |
| C | False positive / unsubstantiated concern, history retained | PASS |
| D | Payment control via governed Payment handoff only | PASS |
| E | Legal / Investigation referral with restricted data protected | PASS |
| F | Operational/system error outcome, not labelled fraud | PASS |
| G | Stale/concurrent work rejected by row-version guards | PASS |
| H | Closed assessment reopened; closure retained; no external reversal | PASS |
| I | Feedback recorded; active scoring configuration unchanged | PASS |
| J | Cross-module view returns safe status only | PASS |

## 7. Test and check results

- Risk/Fraud suite: **`src/__tests__/bn/risk/*` + `src/__tests__/bn/gap-modules/risk/*` +
  `src/types/bn/risk/__tests__/*` — all passing** (Epic 7 adds
  `riskEpic7Certification.test.ts`).
- Typecheck: `tsgo -p tsconfig.app.json` — clean.
- Architecture/security guards: Risk-scoped negative scans included in the Epic 7
  suite; no rule, permission or policy was weakened to obtain green results.

## 8. Live development-contract verification

The following Risk boundaries were confirmed present and callable in the managed
development database (read-only introspection; no destructive action):

`bn_risk_execute_command_v1`, `bn_risk_assessment_command_v1`,
`bn_risk_control_command_v1`, `bn_risk_control_execution_command_v1`,
`bn_risk_outcome_command_v1`, `bn_risk_rule_feedback_command_v1`,
`bn_risk_scoring_command_v1`, `bn_risk_scoring_config_command_v1`, plus the
readiness/query surfaces (`bn_risk_*_readiness_v1`, `bn_risk_*_queue_v1`,
`bn_risk_score_detail_v1`, `bn_risk_person_safe_summary_v1`,
`bn_risk_operational_metrics_v1`, `bn_risk_outcome_metrics_v1`,
`bn_risk_rule_feedback_metrics_v1`, `bn_risk_reference_data_v1`).

## 9. Known unrelated repository failures

Pre-existing failures in the Communication Hub live-database / filesystem-scan
harnesses are unrelated to Risk/Fraud. Risk/Fraud modified no Communication Hub
code in this epic. These are recorded as unrelated; the repository suite is
**not** claimed green in full.

## 10. Seeded scoring configuration caveat

The scoring configuration currently seeded in development is a **development
baseline**, not approved production Risk policy. Certification covers:

- scoring **engine** — certified;
- configuration **governance lifecycle** — certified;
- development baseline configuration — available;
- production policy activation (weights, thresholds, bands) — **separately
  governed and not approved by this record**.

## 11. Environment status

```text
Development implementation = COMPLETE
Technical certification     = COMPLETE
Controlled UAT readiness    = READY
External UAT execution      = NOT_STARTED / DEFERRED
Production activation       = NOT_STARTED
```

## 12. Deferred (non-blocking)

- Production Risk policy approval and threshold sign-off.
- Controlled UAT execution with real officer roles once an environment is
  provisioned.
- Investigation-domain target capability breadth beyond the referral handoff.

## 13. Final classification

**RISK/FRAUD — FUNCTIONALLY COMPLETE AND TECHNICALLY CERTIFIED — CONTROLLED UAT READY**
