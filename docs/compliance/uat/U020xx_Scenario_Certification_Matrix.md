# U020xx Scenario Certification Matrix

Environment: TEST (`non_production`)
Detection as-of date: 2026-08-29
Scanner: `ce-violation-scan` (post DEF-U020-03/04/05 remediation)
Evidence source: `ce_violations`, `ce_compliance_review_flags` (live TEST reads)

Legend: PASS = actual detection matches expected scenario outcome.

| Scenario | Employer | Source facts | Expected detection | Actual detection | Result |
|---|---|---|---|---|---|
| U02001 | U02001 Fully Compliant Ltd | All periods filed and paid on time | No violations | None | PASS |
| U02002 | U02002 Non-Reporting Ltd | May 2026 not filed; June 2026 gap | NON_FILING (2026-05), CONTRIBUTION_GAP (2026-06) | NON_FILING 2026-05 ×1, CONTRIBUTION_GAP 2026-06 ×1 | PASS |
| U02003 | U02003 Late Reporting Ltd | May 2026 filed after statutory deadline | LATE_FILING (2026-05) | LATE_FILING 2026-05 ×1 | PASS |
| U02004 | U02004 Non-Payment Ltd | Filed, not paid May–Jun 2026 | NON_PAYMENT ×2, CONTRIBUTION_GAP (2026-06) | NON_PAYMENT 2026-05..06 ×2, CONTRIBUTION_GAP 2026-06 ×1 | PASS |
| U02005 | U02005 Late-but-Paid Ltd | Payment late but full before scan | No violation (no LATE_PAYMENT type in rule set) | None | PASS (business-confirmed) |
| U02006 | U02006 Partial Payment Ltd | June 2026 partially paid | PARTIAL_PAYMENT (2026-06) | PARTIAL_PAYMENT 2026-06 ×1 | PASS |
| U02007 | U02007 Healthy Arrangement Ltd | Arrears Mar–Jun under a performing arrangement | NON_PAYMENT backlog + CONTRIBUTION_GAP; no ARRANGEMENT_DEFAULT; REPEAT_OFFENDER flag | NON_PAYMENT 2026-03..06 ×4, CONTRIBUTION_GAP ×1, REPEAT_OFFENDER ×1, no default | PASS |
| U02008 | U02008 Arrangement Breach Ltd | Arrangement instalments missed Jun–Aug | ARRANGEMENT_DEFAULT ×3 + NON_PAYMENT backlog + REPEAT_OFFENDER | ARRANGEMENT_DEFAULT 2026-06..08 ×3, NON_PAYMENT ×4, CONTRIBUTION_GAP ×1, REPEAT_OFFENDER ×2 | PASS |
| U02009 | U02009 Exempt Ltd | Active statutory exemption | No violations (exemption suppresses detection) | None | PASS |
| U02010 | U02010 Headcount Anomaly Ltd | Reported headcount inconsistent with prior periods | HEADCOUNT_ANOMALY review flag, no violation | HEADCOUNT_ANOMALY ×1 | PASS |
| U02011 | U02011 Wage Anomaly Ltd | Wages fall sharply below benchmark | WAGE_ANOMALY + WAGE_BELOW_BENCHMARK review flags | WAGE_ANOMALY ×1, WAGE_BELOW_BENCHMARK ×1 | PASS |
| U02012 | U02012 Repeat Offender Ltd | Late filing Jan–Mar 2026, unpaid May | LATE_FILING ×3 (same type) → REPEAT_OFFENDER; NON_PAYMENT ×1 | LATE_FILING 2026-01..03 ×3, NON_PAYMENT 2026-05 ×1, REPEAT_OFFENDER ×1 grouped as LATE_FILING | PASS (DEF-U020-04 remediated) |
| U02013 | U02013 Zero-Wage Ltd | Nil returns filed correctly | No violations | None | PASS |
| U02014 | U02014 Cessation Ltd | Ceased trading without clearance; Apr–May unfiled | NON_FILING ×2, CONTRIBUTION_GAP, CESSATION_WITHOUT_CLEARANCE | NON_FILING 2026-04..05 ×2, CONTRIBUTION_GAP 2026-06 ×1, CESSATION_WITHOUT_CLEARANCE 2026-08 ×1 | PASS |
| U02015 | U02015 Legal Escalation Ltd | Six months unpaid Jan–Jun (3-month ×9 rule met) | NON_PAYMENT ×6 + CONTRIBUTION_GAP + REPEAT_OFFENDER, legal escalation eligible | NON_PAYMENT 2026-01..06 ×6, CONTRIBUTION_GAP ×1, REPEAT_OFFENDER ×1 | PASS |
| U02016 | U02016 Arrears Threshold Ltd | Arrears above management escalation threshold | NON_PAYMENT ×6 + CONTRIBUTION_GAP + REPEAT_OFFENDER | NON_PAYMENT 2026-01..06 ×6, CONTRIBUTION_GAP ×1, REPEAT_OFFENDER ×1 | PASS |
| U02017 | U02017 Multi-Factor Risk Ltd | Late filing and non-payment combined across Jan–Jun | LATE_FILING ×3, NON_PAYMENT ×6, CONTRIBUTION_GAP, REPEAT_OFFENDER per type | LATE_FILING ×3, NON_PAYMENT ×6, CONTRIBUTION_GAP ×1, REPEAT_OFFENDER ×2 (one per type) | PASS |
| U02018 | U02018 Waiver Approved Ltd | Approved penalty waiver in force | No new penalty-bearing violation | None | PASS |
| U02019 | U02019 Waiver Resolution Ltd | May–Jun unpaid pending waiver resolution | NON_PAYMENT ×2 + CONTRIBUTION_GAP | NON_PAYMENT 2026-05..06 ×2, CONTRIBUTION_GAP 2026-06 ×1 | PASS |
| U02020 | U02020 Compound Case Ltd | Late filing Jan–Feb, unpaid Apr–Jun, headcount anomaly | LATE_FILING ×2, NON_PAYMENT ×3, CONTRIBUTION_GAP, HEADCOUNT_ANOMALY, REPEAT_OFFENDER | LATE_FILING ×2, NON_PAYMENT ×3, CONTRIBUTION_GAP ×1, HEADCOUNT_ANOMALY ×1, REPEAT_OFFENDER ×1 | PASS |

## Timing note (not a defect)

U02002 and U02014 June 2026 non-filing does **not** raise NON_FILING at the 2026-08-29 as-of date: the statutory
deadline plus the 30-day grace lands on 2026-08-30. The June exposure is correctly reported as CONTRIBUTION_GAP
until that date. This is expected behaviour, re-confirmed against `obligationDeadlineResolver`.

## Self-employed cohort (SE020xx / DR-013)

Self-employed detections are keyed by person SSN in `ce_violations.employer_id`.

| Scenario | Person SSN | Expected | Actual | Result |
|---|---|---|---|---|
| SE02001 | 910001 | SELF_EMPLOYED_NON_COMPLIANCE | SELF_EMPLOYED_NON_COMPLIANCE ×1 | PASS |
| SE02002 | 910002 | SELF_EMPLOYED_NON_COMPLIANCE | SELF_EMPLOYED_NON_COMPLIANCE ×1 | PASS |
| SE02003 | 910003 | SELF_EMPLOYED_NON_COMPLIANCE | SELF_EMPLOYED_NON_COMPLIANCE ×1 | PASS |
| SE02004 | 920202 | SELF_EMPLOYED_NON_COMPLIANCE | SELF_EMPLOYED_NON_COMPLIANCE ×1 | PASS |
| SE02005 | 920203 | SELF_EMPLOYED_NON_COMPLIANCE | SELF_EMPLOYED_NON_COMPLIANCE ×1 | PASS |
| SE02006 | 920205 | SELF_EMPLOYED_NON_COMPLIANCE | SELF_EMPLOYED_NON_COMPLIANCE ×1 | PASS |

## Defects raised and closed in this pass

| ID | Description | Remediation | Status |
|---|---|---|---|
| DEF-U020-02 | DR-012 raised a false-positive contribution gap | Gap computation corrected | CLOSED |
| DEF-U020-03 | DR-012 mismapped to NON_FILING vocabulary | Dedicated CONTRIBUTION_GAP type; 10 rows reclassified | CLOSED |
| DEF-U020-04 | DR-005 grouped mixed types as "UNKNOWN" | Scanner loads all type codes; stale flags purged and regenerated | CLOSED |
| DEF-U020-05 | DR-013 mismapped to SEVERANCE_OMISSION | SELF_EMPLOYED_NON_COMPLIANCE type created and remapped | CLOSED |
| DEF-U020-06 | Violations Management status cards read 0 (Open / Under Review / Escalated) | `head: true` count requests aborted by the client transport; replaced with 1-row exact counts in `fetchViolationSummaryCounts` | CLOSED |
