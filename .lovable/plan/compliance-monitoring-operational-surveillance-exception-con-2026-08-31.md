# Compliance Monitoring — Operational Surveillance & Exception Control

Scope: `/compliance/workbench/monitoring` only. No other dashboard is touched.

## 1. What the page is today

`src/pages/compliance/dashboards/ComplianceMonitoring.tsx` (244 lines) is an employer
compliance-status *list*: four KPI cards (Compliant / Non-Compliant / Under Review /
High Risk), four filters, and a paginated table over `ce_v_compliance_monitoring`.
It contains no exception detection, no SLA view, no automation health, no freshness
indicator. It is effectively a duplicate of an employer register — not a monitoring page.

## 2. What already exists and will be reused

Reused code patterns (identical visual language to the upgraded workbenches):
- `PageHeader`, filter-bar / KPI-card / panel patterns from
  `src/components/compliance/analytics/workspace/ComplianceAnalyticsPanels.tsx`
- Hook shape from `useComplianceAnalytics.ts` (server RPC + `availability` states, never
  rendering a failed query as zero)
- `useComplianceJobs.ts` (`ce_automation_jobs`, `ce_automation_job_runs`)
- Existing Compliance RBAC route gate (`ComplianceRouteGate`, `MODULE_NAMES.CE_MONITORING`)

Authoritative data sources discovered:

| Signal | Source |
|---|---|
| Automation truth (configured vs live cron) | `ce_v_automation_job_schedule_truth`, `ce_automation_jobs`, `ce_automation_job_runs` |
| Detection engine | `ce_detection_rules`, `ce_detection_event_queue` (event-driven), `JOB-VIOLATION-SCAN` run history (scheduled), manual runs via `triggered_by` |
| Violations / ageing / ownership | `ce_violations`, `ce_v_violation_ageing`, `ce_v_violation_ownership`, `ce_violation_history` |
| Cases | `ce_cases` (`target_resolution_date`), `ce_case_history` |
| Notices & delivery | `ce_notices` (`due_response_date`), `ce_notice_delivery_log` (attempts, `failure_reason`) |
| Arrangements | `ce_v_arrangement_health`, `ce_v_arrangement_installment_operational`, `ce_arrangement_breaches` |
| Obligations / financial exceptions | `ce_obligation_periods`, `ce_v_employer_arrears_summary`, `ce_reconciliation_exceptions`, `ce_partial_payment_requests` |
| Field ops | `ce_inspections`, `ce_planned_visits`, `ce_follow_up_actions` (`due_date`), `ce_weekly_plans` |
| Legal handoff | `ce_legal_recommendations`, `ce_legal_referrals` (approved/pack/handoff timestamps), `ce_legal_returns`, `ce_legal_proceedings` |
| Events feed | `ce_audit_log`, `ce_violation_history`, `ce_case_history`, `ce_escalation_log`, job runs |
| Thresholds | `ce_escalation_stage_config` (`delay_days`), `ce_arrangement_policies`, `ce_settings`, job `schedule_cron` |

## 3. Confirmed detection mechanics

Detection is **hybrid**: scheduled (`JOB-VIOLATION-SCAN`, cron `0 2 * * *`, last run
2026-08-30), event-driven (`ce_detection_event_queue` fed by `ce_detection_event_triggers`),
and manual (Rule Runner). Monitoring will report all three separately, and flag the
scheduled leg as *Degraded/Stale* when the last success is older than the configured cron
interval — never assume healthy.

## 4. Gaps (will be reported, not faked)

- No canonical **SLA policy table**. Deadlines will be read from real per-record date
  columns (`due_date`, `due_response_date`, `target_resolution_date`, `next_due_date`) plus
  `ce_escalation_stage_config.delay_days`. Stagnation/inactivity thresholds and the
  overall-health rules have no canonical config → they will be stored in `ce_settings`
  under `compliance.monitoring.*` keys with seeded defaults, editable, and every panel
  will name the threshold it used. Flagged as configuration gap `CFG-MON-01`.
- Several jobs (`LEDGER-*`) are enabled with no run history → shown as *Never run*, not healthy.
- Communication Hub delivery is only reliable for notices sent through `ce_notice_delivery_log`.

## 5. Build

**Backend** — one migration adding:
- `ce_settings` seed rows for monitoring thresholds (`stall_days` per area, detection
  freshness grace, arrangement grace days, legal handoff days, health-state rules).
- RPC `ce_monitoring_v1(p_window text, p_filters jsonb)` returning one `jsonb` payload with
  per-section `status` (`ok | no_data | disabled | stale | degraded | unavailable`) so a
  failed section can never read as healthy:
  `health`, `subsystems`, `exceptions[]` (unified queue with severity/area/owner/age/
  route), `sla_summary`, `sla_urgent[]`, `sla_trend`, `detection`, `detection_results`,
  `stalled_by_area`, `stalled_oldest[]`, `arrangements`, `financial_exceptions`,
  `communications`, `field_ops`, `legal_handoff`, `jobs[]`, `job_failures[]`, `events[]`,
  `thresholds`, `generated_at`.
- RBAC applied inside the RPC: enterprise-wide for Compliance Head/Manager/Admin,
  own-scope for Inspector/Officer (reusing `ce_actor_can` governance helpers); technical
  job diagnostics only for admin roles.

**Frontend**
- `src/hooks/compliance/useComplianceMonitoring.ts` — window (24h / 7d / 30d, default 24h),
  filters (severity, area, zone, owner, employer, alert type, status), quick-filter chips,
  auto-refresh (Off / 1m / 5m / 15m), `lastRefreshed`, per-section availability.
- `src/components/compliance/monitoring/MonitoringPanels.tsx` — health strip, subsystem
  status cards, exceptions queue table with chips + severity model
  (Critical/High/Medium/Info), SLA stacked bar + urgent table, 7-day SLA breach sparkline,
  detection engine panel, 7-day detected-violations stacked bar, stalled-by-area horizontal
  bar, longest-waiting table, arrangement exception donut, financial exceptions, delivery
  health, field ops, legal handoff, automation table, failure table (business-safe error
  summaries only), events feed.
- Rewrite `ComplianceMonitoring.tsx` in the prescribed section order; every row drills to an
  existing canonical route (violations, cases, arrangements, notices, inspections, legal,
  jobs admin) — no new routes, no workflow actions performed on this page.

**Verification** — real data probes for a breach, an approaching deadline, a failed job, a
disabled job, a stale job, a delivery failure, an unassigned critical item, plus a forced
query-failure check; browser pass with console check and a desktop screenshot; typecheck,
build and test suite.

## 6. Deliverable

Completion report covering files changed, reuse, signals implemented, jobs discovered, SLA
sources, definitions of "stalled" and each health state, refresh strategy, permissions, data
gaps, routes tested, and healthy/warning/critical/failed scenarios.
