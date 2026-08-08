# BN Fraud, Error & Risk — Implementation Matrix

Module: `bn_risk_management` (Benefits Gap). Route: `/bn/risk-management`.
Rollout: `internal_pilot`, routes enabled, governed actions enabled.

## Epic 0 — Module foundation, signal intake and triage — COMPLETE

### Backend (governed boundary)

| Object | Purpose |
| --- | --- |
| `bn_risk_signal` | Canonical signal register (source, subject, category, status, de-dup key, row version) |
| `bn_risk_signal_link` | Officer-recorded relationships; both originals always preserved |
| `bn_risk_signal_note` | General and restricted narrative (restricted requires its own permission) |
| `bn_risk_signal_event` | Full history of every generation, triage, link and dismissal |
| `bn_risk_command_idempotency` | Replay register — repeats return the original result |
| `bn_risk_reference_value` | Controlled lists: categories, sources, statuses, priorities, classifications, routes, dismissal reasons, link types |

| RPC | Type |
| --- | --- |
| `bn_risk_execute_command_v1` | Command boundary (all five Epic 0 commands) |
| `bn_risk_signal_queue_v1` | Filtered, paged queue with status counts |
| `bn_risk_signal_detail_v1` | Signal detail, links, history, permitted notes |
| `bn_risk_related_signal_search_v1` | Link candidates |
| `bn_risk_available_actions_v1` | State- and permission-driven action list |
| `bn_risk_reference_data_v1` | Controlled values |
| `bn_risk_person_search_v1` | Person lookup (no raw identifiers typed) |
| `bn_risk_person_safe_summary_v1` | Privacy-safe Benefit 360 projection |
| `bn_risk_check_actor_permission` | Independent module/permission gate |

### Commands

| Command | Capability | State effect | Status |
| --- | --- | --- | --- |
| `BN_RISK_GENERATE_SIGNAL` | `write` | creates `NEW` | Implemented |
| `BN_RISK_REGISTER_MANUAL_SIGNAL` | `write` (+ justification) | creates `NEW` | Implemented |
| `BN_RISK_TRIAGE_SIGNAL` | `write` | `NEW → TRIAGED` (or `UNDER_REVIEW`) | Implemented |
| `BN_RISK_LINK_SIGNALS` | `write` | `→ LINKED` | Implemented |
| `BN_RISK_DISMISS_SIGNAL` | `decide` (+ reason and justification) | `→ DISMISSED` | Implemented |
| Remaining 13 canonical commands | — | — | Not implemented (rejected with a clear message) |

### De-duplication

The backend derives the de-duplication key from source module, source reference,
person, category, rule and source version. A repeated hand-off returns the
existing signal with `status: 'DUPLICATE'` — never a second record.

### Producer hand-offs

Business modules call `raiseMeansTestRiskSignal`, `raiseMortalityRiskSignal`,
`raisePaymentRiskSignal` or `raiseRiskSignal` in
`src/services/bn/risk/riskSignalIntake.ts`. Direct table writes are prohibited
and covered by tests.

### Frontend

- `src/pages/bn/risk/BnRiskManagementPage.tsx` — operational workspace (placeholder removed)
- `src/components/bn/risk/BnRiskSignalQueue.tsx` — server-side filtered queue
- `BnRiskSignalDetailPanel`, `BnRiskTriageDialog`, `BnRiskLinkSignalsDialog`,
  `BnRiskDismissDialog`, `BnRiskManualSignalDialog`
- `Benefit360RiskCard` — status only: "No active review", "Review in progress",
  "Action required". No category, rule, evidence or narrative.

### Boundaries respected

- Score alone can never terminate or hold a benefit; no benefit-affecting
  command exists in Epic 0.
- Confirmed signals wait for the assessment capability released in later epics.
- Every failed read returns an explicit status; an error is never shown as an
  empty queue.

## Epic 1 — Assessment creation, factors and evidence — COMPLETE

Confirmed signal → risk assessment → linked signals → governed factors →
evidence and information requests → complete information gathering → `REVIEW`.

Backend: `bn_risk_assessment_command_v1`, `bn_risk_assessment_detail_v1`,
`bn_risk_assessment_queue_v1`, `bn_risk_assessment_actions_v1`.
Frontend: `BnRiskAssessmentQueue`, `BnRiskAssessmentWorkspace`,
`BnRiskFactorsSection`, `BnRiskEvidenceSection`, `BnRiskInformationSection`,
`BnRiskCreateAssessmentDialog`.

## Epic 2 — Explainable deterministic scoring and assessment review — COMPLETE

A risk score is decision support. Nothing in Epic 2 stops a payment, suspends a
benefit or refers anyone to investigation.

### Backend (governed boundary)

| Object | Purpose |
| --- | --- |
| `bn_risk_scoring_command_v1` | `CALCULATE_SCORE`, `RECALCULATE_SCORE`, `COMPLETE_SCORING_REVIEW` |
| `bn_risk_scoring_config_command_v1` | Versioned configuration lifecycle |
| `_bn_risk_score_evaluate` | Deterministic rule evaluation (backend only) |
| `_bn_risk_score_fingerprint` | Input fingerprint used to detect stale scores |
| `bn_risk_scoring_readiness_v1` | May this assessment be scored; is the score current |
| `bn_risk_score_detail_v1` | Immutable score, contributions and score history |
| `bn_risk_review_readiness_v1` | May the scoring review be completed |
| `bn_risk_scoring_configuration_v1` | Configuration versions; detail for administrators |

Configuration lifecycle: `DRAFT → VALIDATED → ACTIVE → RETIRED`. Only one
version is in force; a version in force is never edited in place. Scoring fails
closed when no active configuration exists.

### Frontend

- `src/types/bn/risk/riskScoring.ts` — contracts only; no rule, weight, band or threshold
- `src/services/bn/risk/riskScoringService.ts` — governed RPC bindings
- `BnRiskScoringSection` — score, band, staleness and per-rule explanation
- `BnRiskAssessmentReviewSection` — officer review completion into `RECOMMENDATION`
- `BnRiskScoringConfigurationPanel` — read-only for officers, lifecycle for administrators
- `BnRiskAssessmentWorkspace` — journey strip through Review/Scoring
- `Benefit360RiskCard` — privacy-safe stage label only; never a score or band

### Boundaries respected

- Scoring is backend-only; the browser never computes or sends a score.
- Identical inputs and the same configuration version produce the same score.
- Score records are immutable; a change of inputs marks the score out of date
  and requires an explicit recalculation.
- No opaque model: every point on the score is traced to a named rule.

## Epics 3+ — Not started

Recommendations, controls, approvals, payment holds, referrals, outcomes and
rule feedback.
