# Compliance Executive Workbench — Professional Dashboard Enhancement

Scope: rebuild the **Head** view at `/compliance/workbench` as an executive command centre, keeping the existing role-aware entry point and leaving Inspector/Senior views intact.

## 1. What already exists and can be reused

Verified against the live database and code.

Views (real data present):
- `ce_v_compliance_kpis` — total/open/in-progress/under-review/escalated/resolved/closed violations, active & closed cases, overdue violations, avg resolution days, employers affected, notice response counts. One row.
- `ce_v_violation_trends` — 12 monthly rows: created / resolved / escalated.
- `ce_v_officer_performance` — 15 officers: assigned, active, resolved, overdue, avg resolution days, overdue %.
- `ce_v_arrangement_health` — 28 arrangements: status, total_debt, total_paid, missed_payments, breach_detected, health_status, overdue_installment_count.
- `ce_v_employer_outstanding` — per employer/fund: principal/penalty/interest outstanding, total_outstanding, periods_in_arrears, oldest_arrears_period.
- `ce_v_employer_arrears_report`, `ce_v_employer_legal_status`, `ce_v_case_financials`, `ce_v_violation_financials`, `ce_v_visit_execution_metrics`, `ce_v_weekly_report_summary`, `ce_v_arrangement_register`.

Tables: `ce_violations` (262k, has priority/severity/status/due_date/zone/assigned_to/total_amount), `ce_cases` (72), `ce_payment_arrangements` (28), `ce_arrangement_breaches` (17), `ce_breach_monitoring` (6), `ce_notices` (1357), `ce_legal_recommendations` (24, with `status`, `risk_band`, `grand_total`), `ce_legal_referrals` (18), `ce_risk_profiles` (2747, with `risk_band`, `total_score`, `factor_breakdown`), `ce_risk_bands` (4, configured), `ce_weekly_plans` (37) / `ce_weekly_plan_items` (121), `ce_compliance_review_flags` (20), `ce_inspections` (24).

Components/hooks to reuse rather than re-implement:
- `ComplianceKPICards`, `ViolationTrendChart`, `RiskDistributionChart`, `OfficerPerformanceTable`, `ArrangementHealthWidget` (all already used by `/compliance/dashboard/analytics`).
- `useComplianceRole`, `src/lib/compliance/capabilities.ts` (capability bundles), `ComplianceFeatureGate` + `isComplianceFeatureEnabled` / `useComplianceFeatureFlagsBootstrap`.
- `MetricCard`, `PageHeader`, shadcn cards/table/skeleton, recharts wrappers already in use.

## 2. What will be built

Split `RoleWorkbench` into role components, keeping `WorkbenchLanding` as the single entry:
- `workbench/HeadWorkbench.tsx` (new executive dashboard)
- `workbench/RoleWorkbench.tsx` (kept as-is for inspector/senior)

New data layer `src/hooks/compliance/useExecutiveWorkbench.ts` composed of small focused queries, each returning a discriminated result `{ status: 'ok' | 'unavailable', value }` so failures never render as zero.

Layout (matches requested hierarchy):
1. Header + last refreshed + **filter bar** (date range, zone, officer, employer, violation type, risk band + Reset). Filters are applied where the underlying source supports them (violations, cases, arrangements, plans); widgets fed by fixed aggregate views show a "module-wide" tooltip badge instead of pretending to be filtered.
2. **Executive KPI strip** — compact clickable tiles: Open Violations, Critical/High Violations, Open Cases, Overdue Items, Pending Approvals (plans + reports + notices + arrangements), Active Arrangements, Arrangement Breaches, Pending Legal Recommendations, Outstanding Exposure. Each links to its existing filtered page (`/compliance/violations`, `/compliance/cases`, `/compliance/enforcement/arrangements`, `/compliance/arrangements/breaches`, `/compliance/legal-recommendation-queue`, `/compliance/reports/arrears`, `/compliance/notices/pending-approval`, `/compliance/field/plan-review`…). Trend deltas only shown for metrics with real historical series (violations, via `ce_v_violation_trends`).
3. **Requires Attention** (prominent) + **Risk Overview** side by side. Attention queue is a union of overdue violations, unresolved breaches, plans/reports awaiting approval, notices pending approval, legal recommendations pending decision, review flags — with employer, type, priority, assignee, age, stage and an action link into the owning workflow screen (no workflow logic duplicated).
4. **Enforcement Pipeline** — stage counts derived from configured status/stage models (`ce_case_status_masters`, `ce_escalation_stages` config, `ce_violations.status`, notices → recommendations → referrals), clickable to filtered lists; bottleneck highlighting from age vs configured thresholds.
5. **Violation Trend | Violation Mix** — reuse `ViolationTrendChart`, plus by-type/by-status/ageing-bucket breakdowns from `ce_violations`.
6. **Financial Exposure | Arrangement Health** — outstanding exposure from `ce_v_employer_outstanding` (principal/penalty/interest kept separate, not merged), arrangement debt/paid/overdue/breached from `ce_v_arrangement_health`.
7. **Field Operations | Team Workload** — team-wide plan/visit counts from `ce_weekly_plan_items` + `ce_v_visit_execution_metrics`; reuse `OfficerPerformanceTable` for workload (no gamified ranking).
8. **Top Priority Employers** — top 10 by risk band + open violations + outstanding exposure, linking to `/compliance/employer-360/:employerId`.
9. **Legal & Escalation Snapshot** — recommendations pending, referrals in preparation, with Legal, returned/rejected, plus ageing; sourced from `ce_legal_recommendations` / `ce_legal_referrals` / `ce_legal_returns` only.

## 3. Data integrity change (item 15)

`safeCount()` currently converts every error to `0`. Replaced by a `metricResult()` helper: on error/permission failure the tile renders an "Unavailable" state with a neutral icon and tooltip ("This metric could not be loaded"), never a zero. Technical error text is logged, not shown.

## 4. Permissions and feature toggles

- Only `head` renders the executive dashboard; `senior`/`inspector` keep their current workbench.
- Sections are gated by existing capabilities: legal panel → `ENFORCEMENT_LEGAL`, arrangements/financial → `ENFORCEMENT_ARRANGEMENTS`, team performance → `WORKBENCH_TEAM`, risk → `REPORTS_ANALYTICS`.
- Feature-flag gating via existing `ComplianceFeatureGate` / compliance `feature_flags` cache; disabled features hide the widget instead of linking to a disabled route.
- RLS remains the server-side authority — no new privileged RPCs are introduced.

## 5. Known/likely data gaps (will be reported, not faked)

- **Collected/recovered amount attribution for a period** — no authoritative recovery attribution view exists; will be omitted unless `ce_v_ledger_period_balances` proves sufficient during implementation.
- **Estimated assessments outstanding** — needs confirmation of a distinct estimated-assessment source; omitted if not reliably separable.
- **Period-over-period deltas** for cases/arrangements/legal — no historical snapshot tables; no trend arrows will be displayed for these.
- **Inspection→violation attribution** — only partially derivable via `ce_violations.inspection_id`; shown only if coverage is non-trivial.

## 6. Verification

Playwright checks at desktop/tablet/mobile for head, senior and inspector roles: widget loading, real values vs unavailable states, filter behaviour, every drill-down link resolving (no 404), empty/loading states, console clean. Screenshots of the finished Head dashboard captured under `docs/compliance/screenshots/`.
